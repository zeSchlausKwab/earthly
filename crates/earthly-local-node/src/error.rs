use std::io;

use thiserror::Error;

use crate::{NodeConfigError, NodeDescriptorError, PairingError, RemoteNodeError};

#[derive(Debug, Error)]
pub enum NodeError {
    #[error(transparent)]
    Config(#[from] NodeConfigError),
    #[error(transparent)]
    Descriptor(#[from] NodeDescriptorError),
    #[error("local node data directory is already in use")]
    DataDirectoryInUse,
    #[error("node identity is invalid: {0}")]
    InvalidIdentity(String),
    #[error("relay database failed: {0}")]
    RelayDatabase(String),
    #[error("relay failed: {0}")]
    Relay(String),
    #[error("Blossom server failed: {0}")]
    Blossom(String),
    #[error("peer policy store failed: {0}")]
    PolicyStore(String),
    #[error(transparent)]
    Pairing(#[from] PairingError),
    #[error(transparent)]
    Remote(#[from] RemoteNodeError),
    #[error(transparent)]
    Io(#[from] io::Error),
}
