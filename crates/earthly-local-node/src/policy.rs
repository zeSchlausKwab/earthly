use std::collections::HashSet;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use nostr::PublicKey;
use tokio::sync::RwLock;

use crate::NodeError;

/// Shared, runtime-updatable pubkey allowlist used by node services.
#[derive(Clone, Debug)]
pub struct PeerPolicy {
    allowed: Arc<RwLock<HashSet<PublicKey>>>,
    store_dir: Option<Arc<PathBuf>>,
}

impl PeerPolicy {
    pub async fn load(store_dir: impl Into<PathBuf>) -> Result<Self, NodeError> {
        let store_dir = store_dir.into();
        tokio::fs::create_dir_all(&store_dir).await?;
        let mut allowed = HashSet::new();
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
            let public_key = PublicKey::from_hex(&name).map_err(|_| {
                NodeError::PolicyStore(format!("invalid peer grant filename {name}"))
            })?;
            allowed.insert(public_key);
        }
        Ok(Self {
            allowed: Arc::new(RwLock::new(allowed)),
            store_dir: Some(Arc::new(store_dir)),
        })
    }

    pub async fn grant(&self, public_key: PublicKey) -> Result<bool, NodeError> {
        let mut allowed = self.allowed.write().await;
        if allowed.contains(&public_key) {
            return Ok(false);
        }
        if let Some(store_dir) = &self.store_dir {
            persist_grant(store_dir, &public_key).await?;
        }
        allowed.insert(public_key);
        Ok(true)
    }

    pub async fn revoke(&self, public_key: &PublicKey) -> Result<bool, NodeError> {
        let mut allowed = self.allowed.write().await;
        if !allowed.contains(public_key) {
            return Ok(false);
        }
        if let Some(store_dir) = &self.store_dir {
            remove_grant(store_dir, public_key).await?;
        }
        allowed.remove(public_key);
        Ok(true)
    }

    pub async fn allows(&self, public_key: &PublicKey) -> bool {
        self.allowed.read().await.contains(public_key)
    }

    pub async fn len(&self) -> usize {
        self.allowed.read().await.len()
    }

    pub async fn is_empty(&self) -> bool {
        self.allowed.read().await.is_empty()
    }
}

impl Default for PeerPolicy {
    fn default() -> Self {
        Self {
            allowed: Arc::new(RwLock::new(HashSet::new())),
            store_dir: None,
        }
    }
}

async fn persist_grant(store_dir: &Path, public_key: &PublicKey) -> Result<(), NodeError> {
    let path = store_dir.join(public_key.to_hex());
    let file = match tokio::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
    {
        Ok(file) => file,
        Err(error) if error.kind() == ErrorKind::AlreadyExists => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    file.sync_all().await?;
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
}
