use std::collections::BTreeSet;
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

const FIELD_SESSION_TAG: SingleLetterTag = SingleLetterTag::lowercase(Alphabet::H);

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
            .nip42_policy(PairedSessionPolicy {
                peers,
                database: Arc::clone(&database),
            });

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
            .custom_tag(FIELD_SESSION_TAG, session_id.to_owned())
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
    database: Arc<dyn NostrDatabase>,
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
            if self.peers.has_any_capability(public_key, capability).await {
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

    fn admit_event<'a>(
        &'a self,
        public_key: &'a nostr::PublicKey,
        event: &'a Event,
        _addr: &'a SocketAddr,
    ) -> nostr::util::BoxedFuture<'a, PolicyResult> {
        Box::pin(async move {
            let capability = PairingCapability::RelayWrite;
            if self.peers.allows_capability(public_key, capability).await {
                return PolicyResult::Accept;
            }
            let Some(session_id) = event_field_session_id(event) else {
                return PolicyResult::Reject(
                    "field-session writes require exactly one authorized h tag".to_owned(),
                );
            };
            if self
                .peers
                .allows_scoped_capability(public_key, capability, Some(session_id))
                .await
            {
                PolicyResult::Accept
            } else {
                PolicyResult::Reject("event belongs to an unauthorized field session".to_owned())
            }
        })
    }

    fn admit_query<'a>(
        &'a self,
        public_key: &'a nostr::PublicKey,
        filter: &'a Filter,
        _addr: &'a SocketAddr,
    ) -> nostr::util::BoxedFuture<'a, PolicyResult> {
        Box::pin(async move {
            let capability = PairingCapability::RelayRead;
            if self.peers.allows_capability(public_key, capability).await {
                return PolicyResult::Accept;
            }
            let Some(session_id) = filter_field_session_id(filter) else {
                if !is_id_hydration_filter(filter) {
                    return PolicyResult::Reject(
                        "field-session reads require exactly one authorized #h filter".to_owned(),
                    );
                }
                let expected = filter.ids.as_ref().map_or(0, BTreeSet::len);
                let events = match self.database.query(filter.clone()).await {
                    Ok(events) => events.into_iter().collect::<Vec<_>>(),
                    Err(_) => {
                        return PolicyResult::Reject(
                            "unable to authorize field-session event hydration".to_owned(),
                        )
                    }
                };
                if events.len() != expected {
                    return PolicyResult::Reject(
                        "field-session hydration contains an unknown event".to_owned(),
                    );
                }
                for event in &events {
                    let Some(session_id) = event_field_session_id(event) else {
                        return PolicyResult::Reject(
                            "field-session hydration contains an unscoped event".to_owned(),
                        );
                    };
                    if !self
                        .peers
                        .allows_scoped_capability(public_key, capability, Some(session_id))
                        .await
                    {
                        return PolicyResult::Reject(
                            "field-session hydration contains an unauthorized event".to_owned(),
                        );
                    }
                }
                return PolicyResult::Accept;
            };
            if self
                .peers
                .allows_scoped_capability(public_key, capability, Some(session_id))
                .await
            {
                PolicyResult::Accept
            } else {
                PolicyResult::Reject("query belongs to an unauthorized field session".to_owned())
            }
        })
    }
}

fn is_id_hydration_filter(filter: &Filter) -> bool {
    filter.ids.as_ref().is_some_and(|ids| !ids.is_empty())
        && filter.authors.is_none()
        && filter.kinds.is_none()
        && filter.search.is_none()
        && filter.since.is_none()
        && filter.until.is_none()
        && filter.generic_tags.is_empty()
}

fn event_field_session_id(event: &Event) -> Option<&str> {
    let mut values = event
        .tags
        .iter()
        .filter(|tag| tag.single_letter_tag() == Some(FIELD_SESSION_TAG))
        .filter_map(|tag| tag.content());
    let session_id = values.next()?;
    values.next().is_none().then_some(session_id)
}

fn filter_field_session_id(filter: &Filter) -> Option<&str> {
    let values = filter.generic_tags.get(&FIELD_SESSION_TAG)?;
    (values.len() == 1).then(|| values.iter().next().expect("length checked").as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NodeAvailability;
    use nostr::{EventBuilder, Keys, Tag};
    use nostr_sdk::{Client, Filter, SyncDirection, SyncOptions};
    use std::time::Duration;

    fn policy_addr() -> SocketAddr {
        "127.0.0.1:4242".parse().unwrap()
    }

    #[tokio::test]
    async fn paired_session_policy_rejects_cross_session_reads_and_writes() {
        let peer = Keys::generate();
        let peers = PeerPolicy::default();
        peers
            .grant_for_field_session(
                peer.public_key(),
                "survey-a".to_owned(),
                vec![PairingCapability::RelayRead, PairingCapability::RelayWrite],
            )
            .await
            .unwrap();
        let policy = PairedSessionPolicy {
            peers,
            database: Arc::new(nostr_database::MemoryDatabase::default()),
        };
        let allowed_event = EventBuilder::text_note("allowed")
            .tags([Tag::parse(["h", "survey-a"]).unwrap()])
            .sign_with_keys(&peer)
            .unwrap();
        let denied_event = EventBuilder::text_note("denied")
            .tags([Tag::parse(["h", "survey-b"]).unwrap()])
            .sign_with_keys(&peer)
            .unwrap();
        let allowed_filter = Filter::new().custom_tag(FIELD_SESSION_TAG, "survey-a");
        let denied_filter = Filter::new().custom_tag(FIELD_SESSION_TAG, "survey-b");

        assert!(matches!(
            policy
                .admit_event(&peer.public_key(), &allowed_event, &policy_addr())
                .await,
            PolicyResult::Accept
        ));
        assert!(matches!(
            policy
                .admit_event(&peer.public_key(), &denied_event, &policy_addr())
                .await,
            PolicyResult::Reject(_)
        ));
        assert!(matches!(
            policy
                .admit_query(&peer.public_key(), &allowed_filter, &policy_addr())
                .await,
            PolicyResult::Accept
        ));
        assert!(matches!(
            policy
                .admit_query(&peer.public_key(), &denied_filter, &policy_addr())
                .await,
            PolicyResult::Reject(_)
        ));
    }

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
            database: Arc::new(nostr_database::MemoryDatabase::default()),
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
