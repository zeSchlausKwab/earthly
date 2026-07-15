use std::collections::{BTreeSet, HashMap};
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nostr::PublicKey;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;

use crate::{NodeError, PairingCapability};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerGrant {
    pub peer_pubkey: String,
    pub capabilities: Vec<PairingCapability>,
}

/// Shared, runtime-updatable pubkey allowlist used by node services.
#[derive(Clone, Debug)]
pub struct PeerPolicy {
    allowed: Arc<RwLock<HashMap<PublicKey, BTreeSet<PairingCapability>>>>,
    store_dir: Option<Arc<PathBuf>>,
}

impl PeerPolicy {
    pub async fn load(store_dir: impl Into<PathBuf>) -> Result<Self, NodeError> {
        let store_dir = store_dir.into();
        tokio::fs::create_dir_all(&store_dir).await?;
        secure_directory(&store_dir).await?;
        let mut allowed = HashMap::new();
        let mut entries = tokio::fs::read_dir(&store_dir).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                return Err(NodeError::PolicyStore(
                    "peer policy directory contains a non-file entry".to_owned(),
                ));
            }
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| NodeError::PolicyStore("peer grant name is not UTF-8".to_owned()))?;
            if name.starts_with('.') && name.ends_with(".tmp") {
                tokio::fs::remove_file(entry.path()).await?;
                continue;
            }
            secure_grant_file(&entry.path()).await?;
            let public_key = PublicKey::from_hex(&name).map_err(|_| {
                NodeError::PolicyStore(format!("invalid peer grant filename {name}"))
            })?;
            let bytes = tokio::fs::read(entry.path()).await?;
            let capabilities = if bytes.is_empty() {
                PairingCapability::initial_set().into_iter().collect()
            } else {
                let record = serde_json::from_slice::<GrantRecord>(&bytes)
                    .map_err(|error| NodeError::PolicyStore(error.to_string()))?
                    .capabilities;
                if record.is_empty() {
                    return Err(NodeError::PolicyStore(format!(
                        "peer grant {name} has no capabilities"
                    )));
                }
                record
            };
            allowed.insert(public_key, capabilities);
        }
        Ok(Self {
            allowed: Arc::new(RwLock::new(allowed)),
            store_dir: Some(Arc::new(store_dir)),
        })
    }

    pub async fn grant(&self, public_key: PublicKey) -> Result<bool, NodeError> {
        self.grant_with_capabilities(public_key, PairingCapability::initial_set())
            .await
    }

    pub async fn grant_with_capabilities(
        &self,
        public_key: PublicKey,
        capabilities: Vec<PairingCapability>,
    ) -> Result<bool, NodeError> {
        let input_len = capabilities.len();
        if input_len == 0 {
            return Err(NodeError::PolicyStore(
                "peer capabilities must not be empty".to_owned(),
            ));
        }
        let mut allowed = self.allowed.write().await;
        let capabilities: BTreeSet<_> = capabilities.into_iter().collect();
        if capabilities.len() != input_len {
            return Err(NodeError::PolicyStore(
                "peer capabilities must be unique".to_owned(),
            ));
        }
        if allowed.get(&public_key) == Some(&capabilities) {
            return Ok(false);
        }
        if let Some(store_dir) = &self.store_dir {
            persist_grant(store_dir, &public_key, &capabilities).await?;
        }
        allowed.insert(public_key, capabilities);
        Ok(true)
    }

    pub async fn revoke(&self, public_key: &PublicKey) -> Result<bool, NodeError> {
        let mut allowed = self.allowed.write().await;
        if !allowed.contains_key(public_key) {
            return Ok(false);
        }
        if let Some(store_dir) = &self.store_dir {
            remove_grant(store_dir, public_key).await?;
        }
        allowed.remove(public_key);
        Ok(true)
    }

    pub async fn allows(&self, public_key: &PublicKey) -> bool {
        self.allowed.read().await.contains_key(public_key)
    }

    pub async fn allows_capability(
        &self,
        public_key: &PublicKey,
        capability: PairingCapability,
    ) -> bool {
        self.allowed
            .read()
            .await
            .get(public_key)
            .is_some_and(|capabilities| capabilities.contains(&capability))
    }

    pub async fn len(&self) -> usize {
        self.allowed.read().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.allowed.read().await.is_empty()
    }

    pub async fn grants(&self) -> Vec<PeerGrant> {
        let allowed = self.allowed.read().await;
        let mut grants: Vec<_> = allowed
            .iter()
            .map(|(peer, capabilities)| PeerGrant {
                peer_pubkey: peer.to_hex(),
                capabilities: capabilities.iter().copied().collect(),
            })
            .collect();
        grants.sort_by(|left, right| left.peer_pubkey.cmp(&right.peer_pubkey));
        grants
    }
}

impl Default for PeerPolicy {
    fn default() -> Self {
        Self {
            allowed: Arc::new(RwLock::new(HashMap::new())),
            store_dir: None,
        }
    }
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct GrantRecord {
    capabilities: BTreeSet<PairingCapability>,
}

async fn persist_grant(
    store_dir: &Path,
    public_key: &PublicKey,
    capabilities: &BTreeSet<PairingCapability>,
) -> Result<(), NodeError> {
    use tokio::io::AsyncWriteExt;

    let path = store_dir.join(public_key.to_hex());
    let temp_path = store_dir.join(format!(
        ".{}.{}.tmp",
        public_key.to_hex(),
        std::process::id()
    ));
    if temp_path.exists() {
        tokio::fs::remove_file(&temp_path).await?;
    }
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(&temp_path).await?;
    let bytes = serde_json::to_vec(&GrantRecord {
        capabilities: capabilities.clone(),
    })
    .map_err(|error| NodeError::PolicyStore(error.to_string()))?;
    file.write_all(&bytes).await?;
    file.sync_all().await?;
    tokio::fs::rename(temp_path, path).await?;
    sync_directory(store_dir).await
}

async fn remove_grant(store_dir: &Path, public_key: &PublicKey) -> Result<(), NodeError> {
    match tokio::fs::remove_file(store_dir.join(public_key.to_hex())).await {
        Ok(()) => sync_directory(store_dir).await,
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

#[cfg(unix)]
async fn secure_directory(path: &Path) -> Result<(), NodeError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn secure_directory(_path: &Path) -> Result<(), NodeError> {
    Ok(())
}

#[cfg(unix)]
async fn secure_grant_file(path: &Path) -> Result<(), NodeError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn secure_grant_file(_path: &Path) -> Result<(), NodeError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_directory(path: &Path) -> Result<(), NodeError> {
    let directory = tokio::fs::File::open(path).await?;
    directory.sync_all().await?;
    Ok(())
}

#[cfg(not(unix))]
async fn sync_directory(_path: &Path) -> Result<(), NodeError> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[tokio::test]
    async fn grants_and_revocations_survive_reload() {
        let dir = tempfile::tempdir().unwrap();
        let public_key = Keys::generate().public_key();
        let policy = PeerPolicy::load(dir.path()).await.unwrap();

        assert!(policy.grant(public_key).await.unwrap());
        assert!(
            PeerPolicy::load(dir.path())
                .await
                .unwrap()
                .allows(&public_key)
                .await
        );
        assert!(policy.revoke(&public_key).await.unwrap());
        assert!(
            !PeerPolicy::load(dir.path())
                .await
                .unwrap()
                .allows(&public_key)
                .await
        );
    }

    #[tokio::test]
    async fn persists_and_enforces_narrow_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let public_key = Keys::generate().public_key();
        let policy = PeerPolicy::load(dir.path()).await.unwrap();
        policy
            .grant_with_capabilities(public_key, vec![PairingCapability::RelayWrite])
            .await
            .unwrap();

        let restored = PeerPolicy::load(dir.path()).await.unwrap();
        assert!(
            restored
                .allows_capability(&public_key, PairingCapability::RelayWrite)
                .await
        );
        assert!(
            !restored
                .allows_capability(&public_key, PairingCapability::BlobWrite)
                .await
        );
    }

    #[tokio::test]
    async fn rejects_empty_or_duplicate_capability_grants() {
        let dir = tempfile::tempdir().unwrap();
        let policy = PeerPolicy::load(dir.path()).await.unwrap();

        assert!(policy
            .grant_with_capabilities(Keys::generate().public_key(), vec![])
            .await
            .is_err());
        assert!(policy
            .grant_with_capabilities(
                Keys::generate().public_key(),
                vec![PairingCapability::RelayWrite, PairingCapability::RelayWrite,],
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn cleans_up_interrupted_temporary_grants() {
        let dir = tempfile::tempdir().unwrap();
        let temp = dir.path().join(".interrupted.1.tmp");
        tokio::fs::write(&temp, b"partial").await.unwrap();

        PeerPolicy::load(dir.path()).await.unwrap();

        assert!(!temp.exists());
    }

    #[tokio::test]
    async fn lists_grants_with_stable_order_and_capabilities() {
        let dir = tempfile::tempdir().unwrap();
        let policy = PeerPolicy::load(dir.path()).await.unwrap();
        let first = Keys::generate().public_key();
        let second = Keys::generate().public_key();

        policy
            .grant_with_capabilities(first, vec![PairingCapability::RelayWrite])
            .await
            .unwrap();
        policy
            .grant_with_capabilities(
                second,
                vec![PairingCapability::BlobRead, PairingCapability::BlobWrite],
            )
            .await
            .unwrap();

        let grants = policy.grants().await;
        assert_eq!(grants.len(), 2);
        assert!(grants[0].peer_pubkey < grants[1].peer_pubkey);
        assert!(grants.iter().any(|grant| {
            grant.peer_pubkey == first.to_hex()
                && grant.capabilities == vec![PairingCapability::RelayWrite]
        }));
    }
}
