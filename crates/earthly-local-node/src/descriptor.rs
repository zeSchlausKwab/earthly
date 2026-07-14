use serde::{Deserialize, Serialize};
use thiserror::Error;
use url::Url;

pub const DESCRIPTOR_VERSION: u8 = 1;

/// Describes who may reach a running local node.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum EndpointScope {
    /// Only clients on the same device may connect.
    #[default]
    Loopback,
    /// Paired clients on the local network may connect.
    LocalNetwork,
}

/// Describes the lifecycle guarantee of the host platform.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NodeAvailability {
    /// Available while the Earthly process is running.
    Process,
    /// Available only while Earthly is in the foreground.
    Foreground,
    /// Available while a visible platform service is running.
    ForegroundService,
}

/// Versioned discovery document shared with local clients after pairing.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeDescriptor {
    pub version: u8,
    pub node_id: String,
    pub relay_url: Url,
    pub blossom_url: Url,
    pub scope: EndpointScope,
    pub availability: NodeAvailability,
}

impl NodeDescriptor {
    pub fn new(
        node_id: impl Into<String>,
        relay_url: Url,
        blossom_url: Url,
        scope: EndpointScope,
        availability: NodeAvailability,
    ) -> Result<Self, NodeDescriptorError> {
        let descriptor = Self {
            version: DESCRIPTOR_VERSION,
            node_id: node_id.into(),
            relay_url,
            blossom_url,
            scope,
            availability,
        };
        descriptor.validate()?;
        Ok(descriptor)
    }

    pub fn validate(&self) -> Result<(), NodeDescriptorError> {
        if self.version != DESCRIPTOR_VERSION {
            return Err(NodeDescriptorError::UnsupportedVersion(self.version));
        }

        if self.node_id.len() != 64
            || !self
                .node_id
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(NodeDescriptorError::InvalidNodeId);
        }

        if !matches!(self.relay_url.scheme(), "ws" | "wss") {
            return Err(NodeDescriptorError::InvalidRelayScheme(
                self.relay_url.scheme().to_owned(),
            ));
        }

        if !matches!(self.blossom_url.scheme(), "http" | "https") {
            return Err(NodeDescriptorError::InvalidBlossomScheme(
                self.blossom_url.scheme().to_owned(),
            ));
        }

        Ok(())
    }
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum NodeDescriptorError {
    #[error("unsupported node descriptor version {0}")]
    UnsupportedVersion(u8),
    #[error("node id must be a lowercase 32-byte hex public key")]
    InvalidNodeId,
    #[error("relay endpoint must use ws or wss, got {0}")]
    InvalidRelayScheme(String),
    #[error("Blossom endpoint must use http or https, got {0}")]
    InvalidBlossomScheme(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_descriptor() -> NodeDescriptor {
        NodeDescriptor::new(
            "a".repeat(64),
            Url::parse("ws://127.0.0.1:7447").unwrap(),
            Url::parse("http://127.0.0.1:7448").unwrap(),
            EndpointScope::Loopback,
            NodeAvailability::Process,
        )
        .unwrap()
    }

    #[test]
    fn constructs_a_valid_descriptor() {
        let descriptor = valid_descriptor();

        assert_eq!(descriptor.version, DESCRIPTOR_VERSION);
        assert_eq!(descriptor.scope, EndpointScope::Loopback);
    }

    #[test]
    fn rejects_a_non_nostr_node_id() {
        let mut descriptor = valid_descriptor();
        descriptor.node_id = "not-a-public-key".to_owned();

        assert_eq!(
            descriptor.validate(),
            Err(NodeDescriptorError::InvalidNodeId)
        );
    }

    #[test]
    fn rejects_non_websocket_relay_endpoints() {
        let mut descriptor = valid_descriptor();
        descriptor.relay_url = Url::parse("http://127.0.0.1:7447").unwrap();

        assert_eq!(
            descriptor.validate(),
            Err(NodeDescriptorError::InvalidRelayScheme("http".to_owned()))
        );
    }
}
