//! Reusable primitives and runtime boundary for Earthly's embedded local node.
//!
//! The networking implementation will live behind this crate's public API so
//! Tauri lifecycle code does not leak into the relay or Blossom services.

mod blossom;
mod config;
mod descriptor;
mod error;
mod identity;
mod node;
mod pairing;
mod policy;
mod public_blob;
mod relay;
mod remote;
mod remote_blob;
mod remote_publish;
mod remote_sync;

pub use blossom::{
    BlobDescriptor, BlobStorageStatus, EmbeddedBlossom, LocalBlobIntegrity, LocalBlobRead,
    LocalBlobReadError,
};
pub use config::{NodeBind, NodeConfig, NodeConfigError};
pub use descriptor::{
    EndpointScope, NodeAvailability, NodeDescriptor, NodeDescriptorError, DESCRIPTOR_VERSION,
};
pub use error::NodeError;
pub use identity::NodeIdentity;
pub use node::{LocalBlobAccess, LocalNode};
pub use pairing::{
    FieldSessionConversationPolicy, FieldSessionInfo, FieldSessionInternetPolicy,
    PairingCapability, PairingClaimContent, PairingClaimReceipt, PairingClaimRequest, PairingError,
    PairingInvitation, PairingInvitationContent, PairingManager, PairingStatus,
    PendingPairingClaim, PAIRING_CLAIMS_PATH, PAIRING_CLAIM_KIND, PAIRING_INVITATION_KIND,
    PAIRING_PROTOCOL_VERSION,
};
pub use policy::{PeerGrant, PeerPolicy};
pub use public_blob::{PublicBlobDownload, PublicBlobDownloadError};
pub use relay::EmbeddedRelay;
pub use remote::{
    RemoteNodeError, RemoteNodeRecord, RemoteNodeStore, RemoteSyncCheckpoint,
    REMOTE_NODE_RECORD_VERSION,
};
pub use remote_blob::{
    RemoteBlobMirrorError, RemoteBlobMirrorItem, RemoteBlobMirrorResult, RemoteBlobMirrorState,
};
pub use remote_publish::{RemotePublishError, RemotePublishResult};
pub use remote_sync::{RemoteSyncError, RemoteSyncResult};
