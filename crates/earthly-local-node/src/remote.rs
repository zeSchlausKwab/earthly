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
    FieldSessionInfo, NodeDescriptor, PairingCapability, PairingClaimContent, PairingClaimReceipt,
    PairingClaimRequest, PairingError, PairingInvitation, PairingStatus, PAIRING_CLAIMS_PATH,
};

pub const REMOTE_NODE_RECORD_VERSION: u8 = 1;
const MAX_REMOTE_BLOB_HASHES: usize = 4_096;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncCheckpoint {
    pub synced_at: u64,
    pub received_events: usize,
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field_session: Option<FieldSessionInfo>,
    pub status: PairingStatus,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync: Option<RemoteSyncCheckpoint>,
    #[serde(default)]
    pub discovered_blob_hashes: Vec<String>,
    #[serde(default)]
    pub mirrored_blob_hashes: Vec<String>,
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
        if let Some(field_session) = &self.field_session {
            field_session
                .validate()
                .map_err(|error| RemoteNodeError::InvalidRecord(error.to_string()))?;
            if field_session.allow_peer_writes
                != self.capabilities.contains(&PairingCapability::RelayWrite)
            {
                return Err(RemoteNodeError::InvalidRecord(
                    "field-session contribution policy does not match relay grant".to_owned(),
                ));
            }
        }
        if self
            .last_sync
            .as_ref()
            .is_some_and(|checkpoint| checkpoint.synced_at == 0)
        {
            return Err(RemoteNodeError::InvalidRecord(
                "sync timestamp must be positive".to_owned(),
            ));
        }
        validate_blob_hash_inventory(&self.discovered_blob_hashes)?;
        validate_blob_hash_inventory(&self.mirrored_blob_hashes)?;
        if self
            .mirrored_blob_hashes
            .iter()
            .any(|hash| !self.discovered_blob_hashes.contains(hash))
        {
            return Err(RemoteNodeError::InvalidRecord(
                "mirrored blob inventory must be a subset of discovered blobs".to_owned(),
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
            field_session: invitation_content.field_session,
            status: receipt.status,
            updated_at: Timestamp::now().as_secs(),
            last_sync: None,
            discovered_blob_hashes: Vec::new(),
            mirrored_blob_hashes: Vec::new(),
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

    pub async fn get(&self, node_id: &str) -> Result<RemoteNodeRecord, RemoteNodeError> {
        self.load(node_id).await
    }

    pub async fn record_sync(
        &self,
        node_id: &str,
        received_events: usize,
        discovered_blob_hashes: &[String],
    ) -> Result<RemoteNodeRecord, RemoteNodeError> {
        let mut record = self.load(node_id).await?;
        let synced_at = Timestamp::now().as_secs();
        record.updated_at = synced_at;
        record.last_sync = Some(RemoteSyncCheckpoint {
            synced_at,
            received_events,
        });
        let mut inventory = record
            .discovered_blob_hashes
            .into_iter()
            .chain(discovered_blob_hashes.iter().cloned())
            .collect::<BTreeSet<_>>();
        if inventory.len() > MAX_REMOTE_BLOB_HASHES {
            return Err(RemoteNodeError::InvalidRecord(format!(
                "remote blob inventory exceeds {MAX_REMOTE_BLOB_HASHES} hashes"
            )));
        }
        record.discovered_blob_hashes = std::mem::take(&mut inventory).into_iter().collect();
        self.persist(record).await
    }

    pub async fn record_mirrored_blobs(
        &self,
        node_id: &str,
        hashes: &[String],
    ) -> Result<RemoteNodeRecord, RemoteNodeError> {
        let mut record = self.load(node_id).await?;
        if hashes
            .iter()
            .any(|hash| !record.discovered_blob_hashes.contains(hash))
        {
            return Err(RemoteNodeError::InvalidRecord(
                "cannot mark an undiscovered blob as mirrored".to_owned(),
            ));
        }
        let mut mirrored = record
            .mirrored_blob_hashes
            .into_iter()
            .chain(hashes.iter().cloned())
            .collect::<BTreeSet<_>>();
        record.mirrored_blob_hashes = std::mem::take(&mut mirrored).into_iter().collect();
        record.updated_at = Timestamp::now().as_secs();
        self.persist(record).await
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

fn validate_blob_hash_inventory(hashes: &[String]) -> Result<(), RemoteNodeError> {
    if hashes.len() > MAX_REMOTE_BLOB_HASHES {
        return Err(RemoteNodeError::InvalidRecord(format!(
            "remote blob inventory exceeds {MAX_REMOTE_BLOB_HASHES} hashes"
        )));
    }
    if hashes.windows(2).any(|pair| pair[0] >= pair[1])
        || hashes.iter().any(|hash| {
            hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    {
        return Err(RemoteNodeError::InvalidRecord(
            "remote blob hashes must be unique, sorted, lowercase SHA-256 values".to_owned(),
        ));
    }
    Ok(())
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
