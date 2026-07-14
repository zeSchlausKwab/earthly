use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use fs2::FileExt;
use nostr::{Keys, PublicKey, SecretKey};

use crate::NodeError;

const IDENTITY_FILE: &str = "node-identity.secret";
const LOCK_FILE: &str = "node.lock";

/// Stable node identity and exclusive ownership of its data directory.
#[derive(Debug)]
pub struct NodeIdentity {
    keys: Keys,
    _directory_lock: File,
}

impl NodeIdentity {
    pub fn load_or_create(data_dir: impl AsRef<Path>) -> Result<Self, NodeError> {
        let data_dir = data_dir.as_ref();
        fs::create_dir_all(data_dir)?;

        let lock_path = data_dir.join(LOCK_FILE);
        let lock = secure_open(&lock_path, false)?;
        lock.try_lock_exclusive()
            .map_err(|_| NodeError::DataDirectoryInUse)?;

        let identity_path = data_dir.join(IDENTITY_FILE);
        let keys = if identity_path.exists() {
            read_identity(&identity_path)?
        } else {
            create_identity(&identity_path)?
        };

        Ok(Self {
            keys,
            _directory_lock: lock,
        })
    }

    pub fn public_key(&self) -> PublicKey {
        self.keys.public_key()
    }

    pub fn public_key_hex(&self) -> String {
        self.public_key().to_hex()
    }
}

fn read_identity(path: &Path) -> Result<Keys, NodeError> {
    let mut secret = String::new();
    File::open(path)?.read_to_string(&mut secret)?;
    let secret = SecretKey::from_hex(secret.trim())
        .map_err(|error| NodeError::InvalidIdentity(error.to_string()))?;
    Ok(Keys::new(secret))
}

fn create_identity(path: &Path) -> Result<Keys, NodeError> {
    let keys = Keys::generate();
    let temp_path = temporary_identity_path(path);
    let mut file = secure_open(&temp_path, true)?;
    file.write_all(keys.secret_key().to_secret_hex().as_bytes())?;
    file.write_all(b"\n")?;
    file.sync_all()?;
    fs::rename(&temp_path, path)?;
    sync_parent(path)?;
    Ok(keys)
}

fn temporary_identity_path(path: &Path) -> PathBuf {
    let mut name = path
        .file_name()
        .expect("identity path has a file name")
        .to_os_string();
    name.push(format!(".{}.tmp", std::process::id()));
    path.with_file_name(name)
}

fn secure_open(path: &Path, create_new: bool) -> Result<File, std::io::Error> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    if create_new {
        options.create_new(true);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path)
}

fn sync_parent(path: &Path) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_stable_and_exclusively_locked() {
        let dir = tempfile::tempdir().unwrap();
        let first = NodeIdentity::load_or_create(dir.path()).unwrap();
        let public_key = first.public_key();

        assert!(matches!(
            NodeIdentity::load_or_create(dir.path()),
            Err(NodeError::DataDirectoryInUse)
        ));

        drop(first);
        let reopened = NodeIdentity::load_or_create(dir.path()).unwrap();
        assert_eq!(reopened.public_key(), public_key);
    }

    #[cfg(unix)]
    #[test]
    fn identity_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().unwrap();
        let _identity = NodeIdentity::load_or_create(dir.path()).unwrap();
        let mode = fs::metadata(dir.path().join(IDENTITY_FILE))
            .unwrap()
            .permissions()
            .mode()
            & 0o777;

        assert_eq!(mode, 0o600);
    }
}
