use std::fmt;
use std::net::SocketAddr;
use std::path::Path;

use nostr::Event;
use nostr_lmdb::NostrLMDB;
use nostr_relay_builder::builder::{
    PolicyResult, RateLimit, RelayBuilder, RelayBuilderNip42, RelayBuilderNip42Mode, WritePolicy,
};
use nostr_relay_builder::LocalRelay;
use url::Url;

use crate::{NodeConfig, NodeError, PairingCapability, PeerPolicy};

/// Running persistent Nostr relay owned by the local node.
#[derive(Debug, Clone)]
pub struct EmbeddedRelay {
    inner: LocalRelay,
    url: Url,
}

impl EmbeddedRelay {
    pub async fn start(config: &NodeConfig, peers: PeerPolicy) -> Result<Self, NodeError> {
        config.validate()?;
        let database_path = config.data_dir.join("relay").join("lmdb");
        tokio::fs::create_dir_all(&database_path).await?;
        let database = open_database(&database_path)?;

        let mut builder = RelayBuilder::default()
            .addr(config.bind.ip()?)
            .database(database)
            .max_connections(config.max_relay_connections)
            .rate_limit(RateLimit {
                max_reqs: config.max_relay_subscriptions,
                notes_per_minute: 120,
            })
            .max_filter_limit(config.max_relay_filter_limit)
            .default_filter_limit(config.max_relay_filter_limit.min(100))
            .write_policy(PairedAuthorPolicy { peers });

        if config.relay_port != 0 {
            builder = builder.port(config.relay_port);
        }
        if config.relay_nip42 {
            builder = builder.nip42(RelayBuilderNip42 {
                mode: RelayBuilderNip42Mode::Both,
            });
        }

        let relay = LocalRelay::new(builder);
        relay
            .run()
            .await
            .map_err(|error| NodeError::Relay(error.to_string()))?;
        let url = Url::parse(relay.url().await.as_str())
            .map_err(|error| NodeError::Relay(error.to_string()))?;

        Ok(Self { inner: relay, url })
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn shutdown(&self) {
        self.inner.shutdown();
    }
}

impl Drop for EmbeddedRelay {
    fn drop(&mut self) {
        self.shutdown();
    }
}

fn open_database(path: &Path) -> Result<NostrLMDB, NodeError> {
    NostrLMDB::builder(path)
        .map_size(1024 * 1024 * 1024)
        .max_readers(64)
        .build()
        .map_err(|error| NodeError::RelayDatabase(error.to_string()))
}

#[derive(Clone)]
struct PairedAuthorPolicy {
    peers: PeerPolicy,
}

impl fmt::Debug for PairedAuthorPolicy {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PairedAuthorPolicy")
            .finish_non_exhaustive()
    }
}

impl WritePolicy for PairedAuthorPolicy {
    fn admit_event<'a>(
        &'a self,
        event: &'a Event,
        _addr: &'a SocketAddr,
    ) -> nostr::util::BoxedFuture<'a, PolicyResult> {
        Box::pin(async move {
            if self
                .peers
                .allows_capability(&event.pubkey, PairingCapability::RelayWrite)
                .await
            {
                PolicyResult::Accept
            } else {
                PolicyResult::Reject("blocked: author is not paired".to_owned())
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NodeAvailability;
    use nostr::{EventBuilder, Keys};

    #[tokio::test]
    async fn relay_uses_ephemeral_loopback_port() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let relay = EmbeddedRelay::start(&config, PeerPolicy::default())
            .await
            .unwrap();

        assert_eq!(relay.url().host_str(), Some("127.0.0.1"));
        assert_ne!(relay.url().port(), Some(0));
        relay.shutdown();
    }

    #[tokio::test]
    async fn write_policy_rejects_unpaired_authors() {
        let peers = PeerPolicy::default();
        let policy = PairedAuthorPolicy {
            peers: peers.clone(),
        };
        let keys = Keys::generate();
        let event = EventBuilder::text_note("paired author policy")
            .sign_with_keys(&keys)
            .unwrap();
        let address = "127.0.0.1:12345".parse().unwrap();

        assert!(matches!(
            policy.admit_event(&event, &address).await,
            PolicyResult::Reject(_)
        ));
        peers.grant(keys.public_key()).await.unwrap();
        assert!(matches!(
            policy.admit_event(&event, &address).await,
            PolicyResult::Accept
        ));
    }
}
