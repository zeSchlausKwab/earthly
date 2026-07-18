use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{EndpointScope, NodeAvailability};

pub const DEFAULT_RELAY_PORT: u16 = 17_447;
pub const DEFAULT_BLOSSOM_PORT: u16 = 17_448;

/// Explicit listener binding. Wildcard and public addresses are never accepted.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "scope", content = "address", rename_all = "kebab-case")]
pub enum NodeBind {
    #[default]
    Loopback,
    LocalNetwork(IpAddr),
}

impl NodeBind {
    pub fn ip(self) -> Result<IpAddr, NodeConfigError> {
        match self {
            Self::Loopback => Ok(IpAddr::V4(Ipv4Addr::LOCALHOST)),
            Self::LocalNetwork(ip) if is_private_or_link_local(ip) => Ok(ip),
            Self::LocalNetwork(ip) => Err(NodeConfigError::UnsafeBindAddress(ip)),
        }
    }

    pub const fn scope(self) -> EndpointScope {
        match self {
            Self::Loopback => EndpointScope::Loopback,
            Self::LocalNetwork(_) => EndpointScope::LocalNetwork,
        }
    }
}

/// Complete configuration shared by the relay and Blossom runtimes.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeConfig {
    pub data_dir: PathBuf,
    pub bind: NodeBind,
    /// Zero selects an ephemeral port and is intended for tests.
    pub relay_port: u16,
    /// Zero selects an ephemeral port and is intended for tests.
    pub blossom_port: u16,
    pub availability: NodeAvailability,
    pub relay_nip42: bool,
    pub max_relay_connections: usize,
    pub max_relay_subscriptions: usize,
    pub max_relay_filter_limit: usize,
    pub max_blob_bytes: u64,
}

impl NodeConfig {
    pub fn loopback(data_dir: impl Into<PathBuf>, availability: NodeAvailability) -> Self {
        Self {
            data_dir: data_dir.into(),
            bind: NodeBind::Loopback,
            relay_port: DEFAULT_RELAY_PORT,
            blossom_port: DEFAULT_BLOSSOM_PORT,
            availability,
            relay_nip42: true,
            max_relay_connections: 64,
            max_relay_subscriptions: 32,
            max_relay_filter_limit: 500,
            max_blob_bytes: 2 * 1024 * 1024 * 1024,
        }
    }

    pub fn with_ephemeral_ports(mut self) -> Self {
        self.relay_port = 0;
        self.blossom_port = 0;
        self
    }

    pub fn validate(&self) -> Result<(), NodeConfigError> {
        if self.data_dir.as_os_str().is_empty() {
            return Err(NodeConfigError::EmptyDataDirectory);
        }
        self.bind.ip()?;
        if self.max_relay_connections == 0 {
            return Err(NodeConfigError::ZeroLimit("maxRelayConnections"));
        }
        if self.max_relay_subscriptions == 0 {
            return Err(NodeConfigError::ZeroLimit("maxRelaySubscriptions"));
        }
        if self.max_relay_filter_limit == 0 {
            return Err(NodeConfigError::ZeroLimit("maxRelayFilterLimit"));
        }
        if self.max_blob_bytes == 0 {
            return Err(NodeConfigError::ZeroLimit("maxBlobBytes"));
        }
        Ok(())
    }
}

fn is_private_or_link_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_link_local(),
        IpAddr::V6(ip) => is_unique_local_v6(ip) || is_link_local_v6(ip),
    }
}

fn is_unique_local_v6(ip: Ipv6Addr) -> bool {
    ip.octets()[0] & 0xfe == 0xfc
}

fn is_link_local_v6(ip: Ipv6Addr) -> bool {
    let octets = ip.octets();
    octets[0] == 0xfe && octets[1] & 0xc0 == 0x80
}

#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum NodeConfigError {
    #[error("node data directory cannot be empty")]
    EmptyDataDirectory,
    #[error("refusing to bind local node to unsafe address {0}")]
    UnsafeBindAddress(IpAddr),
    #[error("node limit {0} must be greater than zero")]
    ZeroLimit(&'static str),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_defaults_are_bounded() {
        let config = NodeConfig::loopback("/tmp/earthly-node", NodeAvailability::Process);

        assert_eq!(config.bind.ip().unwrap(), IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert!(config.validate().is_ok());
    }

    #[test]
    fn rejects_wildcard_and_public_bind_addresses() {
        for ip in ["0.0.0.0", "8.8.8.8", "::", "2606:4700:4700::1111"] {
            let mut config = NodeConfig::loopback("/tmp/earthly-node", NodeAvailability::Process);
            config.bind = NodeBind::LocalNetwork(ip.parse().unwrap());

            assert!(matches!(
                config.validate(),
                Err(NodeConfigError::UnsafeBindAddress(_))
            ));
        }
    }

    #[test]
    fn accepts_private_and_link_local_addresses() {
        for ip in [
            "192.168.1.50",
            "10.0.0.2",
            "169.254.1.10",
            "fd00::1",
            "fe80::1",
        ] {
            let bind = NodeBind::LocalNetwork(ip.parse().unwrap());
            assert!(bind.ip().is_ok());
        }
    }
}
