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
mod policy;
mod relay;

pub use blossom::{BlobDescriptor, EmbeddedBlossom};
pub use config::{NodeBind, NodeConfig, NodeConfigError};
pub use descriptor::{
    EndpointScope, NodeAvailability, NodeDescriptor, NodeDescriptorError, DESCRIPTOR_VERSION,
};
pub use error::NodeError;
pub use identity::NodeIdentity;
pub use node::LocalNode;
pub use policy::PeerPolicy;
pub use relay::EmbeddedRelay;
