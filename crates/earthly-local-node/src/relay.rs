use std::fmt;
use std::net::SocketAddr;
use std::path::Path;
use std::sync::Arc;

use nostr::{Alphabet, Event, Filter, Kind, SingleLetterTag};
use nostr_database::{NostrDatabase, SaveEventStatus};
use nostr_lmdb::NostrLMDB;
use nostr_relay_builder::builder::{
    Nip42Policy, Nip42PolicyAction, PolicyResult, RateLimit, RelayBuilder, RelayBuilderNip42,
    RelayBuilderNip42Mode,
};
use nostr_relay_builder::LocalRelay;
use url::Url;

use crate::{NodeConfig, NodeError, PairingCapability, PeerPolicy};

/// Running persistent Nostr relay owned by the local node.
#[derive(Debug, Clone)]
pub struct EmbeddedRelay {
    inner: LocalRelay,
    url: Url,
    database: Arc<dyn NostrDatabase>,
}

impl EmbeddedRelay {
    pub async fn start(config: &NodeConfig, peers: PeerPolicy) -> Result<Self, NodeError> {
        config.validate()?;
        let database_path = config.data_dir.join("relay").join("lmdb");
        tokio::fs::create_dir_all(&database_path).await?;
        let database: Arc<dyn NostrDatabase> = Arc::new(open_database(&database_path)?);

        let mut builder = RelayBuilder::default()
            .addr(config.bind.ip()?)
            .database(Arc::clone(&database))
            .max_connections(config.max_relay_connections)
            .rate_limit(RateLimit {
                max_reqs: config.max_relay_subscriptions,
                notes_per_minute: 120,
            })
            .max_filter_limit(config.max_relay_filter_limit)
            .default_filter_limit(config.max_relay_filter_limit.min(100))
            .nip42_policy(PairedSessionPolicy { peers });

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

        Ok(Self {
            inner: relay,
            url,
            database,
        })
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub(crate) fn database(&self) -> Arc<dyn NostrDatabase> {
        Arc::clone(&self.database)
    }

    pub async fn field_session_events(&self, session_id: &str) -> Result<Vec<Event>, NodeError> {
        if session_id.is_empty()
            || session_id.len() > 96
            || !session_id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(NodeError::RelayDatabase(
                "invalid field-session identifier".to_owned(),
            ));
        }
        let kinds = [
            5_u16, 7, 1_630, 1_631, 1_632, 1_633, 9_735, 34_444, 37_515, 37_517, 37_518, 37_519,
            37_520, 37_521, 37_522, 37_523,
        ]
        .into_iter()
        .map(Kind::from)
        .collect::<Vec<_>>();
        let filter = Filter::new()
            .kinds(kinds)
            .custom_tag(
                SingleLetterTag::lowercase(Alphabet::H),
                session_id.to_owned(),
            )
            .limit(2_000);
        let events = self
            .database
            .query(filter)
            .await
            .map_err(|error| NodeError::RelayDatabase(error.to_string()))?;
        let mut events = events.into_iter().collect::<Vec<_>>();
        events.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(events)
    }

    /// Persist a signed event through the trusted in-process path.
    ///
    /// This path is intentionally separate from relay writes: it verifies the original event and
    /// preserves its author while allowing native synchronization to mirror third-party events.
    pub async fn ingest_verified_event(&self, event: &Event) -> Result<bool, NodeError> {
        event
            .verify()
            .map_err(|error| NodeError::RelayDatabase(error.to_string()))?;
        let status = self
            .database
            .save_event(event)
            .await
            .map_err(|error| NodeError::RelayDatabase(error.to_string()))?;
        let saved = matches!(status, SaveEventStatus::Success);
        if saved {
            // The trusted in-process path shares the same live semantics as an
            // ordinary relay EVENT: connected field-session subscribers should
            // not have to wait for a reconciliation pass to observe it.
            self.inner.notify_event(event.clone());
        }
        Ok(saved)
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
struct PairedSessionPolicy {
    peers: PeerPolicy,
}

impl fmt::Debug for PairedSessionPolicy {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PairedSessionPolicy")
            .finish_non_exhaustive()
    }
}

impl Nip42Policy for PairedSessionPolicy {
    fn admit_session<'a>(
        &'a self,
        public_key: &'a nostr::PublicKey,
        action: Nip42PolicyAction,
        _addr: &'a SocketAddr,
    ) -> nostr::util::BoxedFuture<'a, PolicyResult> {
        Box::pin(async move {
            let capability = match action {
                Nip42PolicyAction::Read => PairingCapability::RelayRead,
                Nip42PolicyAction::Write => PairingCapability::RelayWrite,
            };
            if self.peers.allows_capability(public_key, capability).await {
                PolicyResult::Accept
            } else {
                PolicyResult::Reject(format!(
                    "authenticated peer lacks {} access",
                    match action {
                        Nip42PolicyAction::Read => "relay-read",
                        Nip42PolicyAction::Write => "relay-write",
                    }
                ))
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NodeAvailability;
    use nostr::{EventBuilder, Keys};
    use nostr_sdk::{Client, Filter, SyncDirection, SyncOptions};
    use std::time::Duration;

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
    async fn session_policy_enforces_read_and_write_capabilities_independently() {
        let peers = PeerPolicy::default();
        let policy = PairedSessionPolicy {
            peers: peers.clone(),
        };
        let peer = Keys::generate().public_key();
        let address = "127.0.0.1:12345".parse().unwrap();

        assert!(matches!(
            policy
                .admit_session(&peer, Nip42PolicyAction::Read, &address)
                .await,
            PolicyResult::Reject(_)
        ));
        peers
            .grant_with_capabilities(peer, vec![PairingCapability::RelayRead])
            .await
            .unwrap();
        assert!(matches!(
            policy
                .admit_session(&peer, Nip42PolicyAction::Read, &address)
                .await,
            PolicyResult::Accept
        ));
        assert!(matches!(
            policy
                .admit_session(&peer, Nip42PolicyAction::Write, &address)
                .await,
            PolicyResult::Reject(_)
        ));
    }

    #[tokio::test]
    async fn authenticated_but_unpaired_client_cannot_read_stored_events() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let relay = EmbeddedRelay::start(&config, PeerPolicy::default())
            .await
            .unwrap();
        let stored = EventBuilder::text_note("paired relay secret")
            .sign_with_keys(&Keys::generate())
            .unwrap();
        relay.ingest_verified_event(&stored).await.unwrap();

        let client = Client::new(Keys::generate());
        client.add_relay(relay.url().as_str()).await.unwrap();
        client.connect().await;
        let mut leaked = false;
        for _ in 0..2 {
            leaked |= client
                .fetch_events(Filter::new().id(stored.id), Duration::from_secs(2))
                .await
                .is_ok_and(|events| events.iter().any(|event| event.id == stored.id));
        }
        let sync_options = SyncOptions::new()
            .direction(SyncDirection::Down)
            .initial_timeout(Duration::from_secs(2));
        for _ in 0..2 {
            let _ = client
                .sync_with(
                    [relay.url().as_str()],
                    Filter::new().id(stored.id),
                    &sync_options,
                )
                .await;
        }
        leaked |= client
            .database()
            .event_by_id(&stored.id)
            .await
            .unwrap()
            .is_some();
        client.disconnect().await;

        assert!(!leaked, "an unpaired NIP-42 key read a stored event");
    }
}
