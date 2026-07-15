use std::collections::BTreeSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use nostr::{Event, EventId, PublicKey, Timestamp};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::{
    NodeDescriptor, PairingCapability, PairingClaimContent, PairingClaimReceipt,
    PairingClaimRequest, PairingError, PairingInvitation, PairingStatus, PAIRING_CLAIMS_PATH,
};

pub const REMOTE_NODE_RECORD_VERSION: u8 = 1;

/// A host that this installation has requested or received access to.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteNodeRecord {
    pub version: u8,
    pub node_id: String,
    pub descriptor: NodeDescriptor,
    pub claim_id: String,
    pub peer_pubkey: String,
    pub peer_name: Option<String>,
    pub capabilities: Vec<PairingCapability>,
    pub status: PairingStatus,
    pub updated_at: u64,
}

impl RemoteNodeRecord {
    fn validate(&self) -> Result<(), RemoteNodeError> {
        if self.version != REMOTE_NODE_RECORD_VERSION {
            return Err(RemoteNodeError::InvalidRecord(format!(
                "unsupported record version {}",
                self.version
            )));
        }
        self.descriptor
            .validate()
            .map_err(|error| RemoteNodeError::InvalidRecord(error.to_string()))?;
        if self.node_id != self.descriptor.node_id {
            return Err(RemoteNodeError::InvalidRecord(
                "record node id does not match its descriptor".to_owned(),
            ));
        }
        EventId::from_hex(&self.claim_id)
            .map_err(|_| RemoteNodeError::InvalidRecord("invalid claim id".to_owned()))?;
        PublicKey::from_hex(&self.peer_pubkey)
            .map_err(|_| RemoteNodeError::InvalidRecord("invalid peer public key".to_owned()))?;
        let unique: BTreeSet<_> = self.capabilities.iter().copied().collect();
        if unique.is_empty() || unique.len() != self.capabilities.len() {
            return Err(RemoteNodeError::InvalidRecord(
                "capabilities must be unique and non-empty".to_owned(),
            ));
        }
        Ok(())
    }
}

/// Durable client-side pairing state and the fixed-path HTTP transport used to update it.
#[derive(Clone, Debug)]
pub struct RemoteNodeStore {
    root: Arc<PathBuf>,
    mutation: Arc<Mutex<()>>,
    http: Client,
}

impl RemoteNodeStore {
    pub async fn open(root: impl Into<PathBuf>) -> Result<Self, RemoteNodeError> {
        let root = root.into();
        tokio::fs::create_dir_all(&root).await?;
        secure_directory(&root).await?;
        cleanup_temporary_records(&root).await?;
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()?;
        Ok(Self {
            root: Arc::new(root),
            mutation: Arc::new(Mutex::new(())),
            http,
        })
    }

    pub async fn submit_claim(
        &self,
        invitation: &PairingInvitation,
        claim: Event,
    ) -> Result<RemoteNodeRecord, RemoteNodeError> {
        let invitation_content = invitation.validate()?;
        let claim_content: PairingClaimContent = serde_json::from_str(&claim.content)?;
        let claims_url = invitation_content
            .descriptor
            .blossom_url
            .join(PAIRING_CLAIMS_PATH.trim_start_matches('/'))?;
        let response = self
            .http
            .post(claims_url)
            .json(&PairingClaimRequest {
                claim: claim.clone(),
            })
            .send()
            .await?;
        let receipt: PairingClaimReceipt = decode_response(response).await?;
        if receipt.claim_id != claim.id.to_hex() {
            return Err(RemoteNodeError::InvalidRecord(
                "host returned a receipt for a different claim".to_owned(),
            ));
        }
        let record = RemoteNodeRecord {
            version: REMOTE_NODE_RECORD_VERSION,
            node_id: invitation_content.descriptor.node_id.clone(),
            descriptor: invitation_content.descriptor,
            claim_id: receipt.claim_id,
            peer_pubkey: claim.pubkey.to_hex(),
            peer_name: claim_content.peer_name,
            capabilities: claim_content.requested_capabilities,
            status: receipt.status,
            updated_at: Timestamp::now().as_secs(),
        };
        self.persist(record).await
    }

    pub async fn refresh(&self, node_id: &str) -> Result<RemoteNodeRecord, RemoteNodeError> {
        let mut record = self.load(node_id).await?;
        let status_url = record.descriptor.blossom_url.join(&format!(
            "{}/{}",
            PAIRING_CLAIMS_PATH.trim_start_matches('/'),
            record.claim_id
        ))?;
        let response = self.http.get(status_url).send().await?;
        record.status = decode_response(response).await?;
        record.updated_at = Timestamp::now().as_secs();
        self.persist(record).await
    }

    pub async fn list(&self) -> Result<Vec<RemoteNodeRecord>, RemoteNodeError> {
        let _guard = self.mutation.lock().await;
        self.list_unlocked().await
    }

    pub async fn forget(&self, node_id: &str) -> Result<bool, RemoteNodeError> {
        validate_node_id(node_id)?;
        let _guard = self.mutation.lock().await;
        match tokio::fs::remove_file(self.record_path(node_id)).await {
            Ok(()) => {
                sync_directory(&self.root).await?;
                Ok(true)
            }
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    async fn persist(&self, record: RemoteNodeRecord) -> Result<RemoteNodeRecord, RemoteNodeError> {
        record.validate()?;
        let _guard = self.mutation.lock().await;
        persist_record(&self.root, &record).await?;
        Ok(record)
    }

    async fn load(&self, node_id: &str) -> Result<RemoteNodeRecord, RemoteNodeError> {
        validate_node_id(node_id)?;
        let _guard = self.mutation.lock().await;
        let bytes = match tokio::fs::read(self.record_path(node_id)).await {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == ErrorKind::NotFound => {
                return Err(RemoteNodeError::NotFound)
            }
            Err(error) => return Err(error.into()),
        };
        let record: RemoteNodeRecord = serde_json::from_slice(&bytes)?;
        record.validate()?;
        Ok(record)
    }

    async fn list_unlocked(&self) -> Result<Vec<RemoteNodeRecord>, RemoteNodeError> {
        let mut records = Vec::new();
        let mut entries = tokio::fs::read_dir(&*self.root).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                return Err(RemoteNodeError::InvalidRecord(
                    "remote-node store contains a non-file entry".to_owned(),
                ));
            }
            let name = entry.file_name().into_string().map_err(|_| {
                RemoteNodeError::InvalidRecord("record name is not UTF-8".to_owned())
            })?;
            if name.starts_with('.') && name.ends_with(".tmp") {
                continue;
            }
            validate_node_id(&name)?;
            secure_record_file(&entry.path()).await?;
            let record: RemoteNodeRecord =
                serde_json::from_slice(&tokio::fs::read(entry.path()).await?)?;
            record.validate()?;
            records.push(record);
        }
        records.sort_by(|left, right| left.node_id.cmp(&right.node_id));
        Ok(records)
    }

    fn record_path(&self, node_id: &str) -> PathBuf {
        self.root.join(node_id)
    }
}

async fn decode_response<T: for<'de> Deserialize<'de>>(
    response: reqwest::Response,
) -> Result<T, RemoteNodeError> {
    let status = response.status();
    if !status.is_success() {
        let message = response.text().await.unwrap_or_default();
        return Err(RemoteNodeError::RequestRejected {
            status,
            message: if message.is_empty() {
                "the host rejected the request".to_owned()
            } else {
                message
            },
        });
    }
    Ok(response.json().await?)
}

fn validate_node_id(node_id: &str) -> Result<(), RemoteNodeError> {
    PublicKey::from_hex(node_id)
        .map(|_| ())
        .map_err(|_| RemoteNodeError::InvalidRecord("invalid node id".to_owned()))
}

async fn persist_record(root: &Path, record: &RemoteNodeRecord) -> Result<(), RemoteNodeError> {
    let path = root.join(&record.node_id);
    let temp_path = root.join(format!(".{}.{}.tmp", record.node_id, std::process::id()));
    if temp_path.exists() {
        tokio::fs::remove_file(&temp_path).await?;
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temp_path).await?;
    file.write_all(&serde_json::to_vec(record)?).await?;
    file.sync_all().await?;
    tokio::fs::rename(temp_path, path).await?;
    sync_directory(root).await
}

async fn cleanup_temporary_records(root: &Path) -> Result<(), RemoteNodeError> {
    let mut entries = tokio::fs::read_dir(root).await?;
    while let Some(entry) = entries.next_entry().await? {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if entry.file_type().await?.is_file() && name.starts_with('.') && name.ends_with(".tmp") {
            tokio::fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

#[cfg(unix)]
async fn secure_directory(path: &Path) -> Result<(), RemoteNodeError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn secure_directory(_path: &Path) -> Result<(), RemoteNodeError> {
    Ok(())
}

#[cfg(unix)]
async fn secure_record_file(path: &Path) -> Result<(), RemoteNodeError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn secure_record_file(_path: &Path) -> Result<(), RemoteNodeError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_directory(path: &Path) -> Result<(), RemoteNodeError> {
    let directory = tokio::fs::File::open(path).await?;
    directory.sync_all().await?;
    Ok(())
}

#[cfg(not(unix))]
async fn sync_directory(_path: &Path) -> Result<(), RemoteNodeError> {
    Ok(())
}

#[derive(Debug, Error)]
pub enum RemoteNodeError {
    #[error(transparent)]
    Pairing(#[from] PairingError),
    #[error("remote pairing record is invalid: {0}")]
    InvalidRecord(String),
    #[error("remote pairing record was not found")]
    NotFound,
    #[error("remote host returned HTTP {status}: {message}")]
    RequestRejected { status: StatusCode, message: String },
    #[error(transparent)]
    Transport(#[from] reqwest::Error),
    #[error(transparent)]
    Url(#[from] url::ParseError),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}
