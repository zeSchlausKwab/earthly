use std::sync::Arc;
use std::time::Duration;
use std::{collections::BTreeSet, iter};

use nostr::{Alphabet, Event, Filter, Keys, Kind, SingleLetterTag};
use nostr_database::NostrDatabase;
use nostr_sdk::prelude::{ClientBuilder, SyncDirection, SyncOptions};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{PairingCapability, PairingStatus, RemoteNodeError, RemoteNodeRecord, RemoteNodeStore};

const EARTHLY_SYNC_KIND_NUMBERS: &[u16] = &[
    5, 7, 1630, 1631, 1632, 1633, 9735, 34_444, 37_515, 37_517, 37_518, 37_519, 37_520, 37_521,
    37_522, 37_523,
];
const MAX_RESPONSE_EVENTS: usize = 2_000;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSyncResult {
    pub node_id: String,
    pub received_events: usize,
    pub hydrated_events: usize,
    pub events_truncated: bool,
    pub events: Vec<Event>,
    pub discovered_blob_hashes: Vec<String>,
    pub remote_node: RemoteNodeRecord,
}

#[derive(Debug, Error)]
pub enum RemoteSyncError {
    #[error(transparent)]
    RemoteNode(#[from] RemoteNodeError),
    #[error("the host has not approved this installation")]
    NotAccepted,
    #[error("the approved grant does not include relay-read access; request a new invitation")]
    MissingRelayRead,
    #[error("remote relay synchronization failed: {0}")]
    Relay(String),
    #[error("local relay database failed: {0}")]
    Database(String),
    #[error("failed to serialize a synchronized event: {0}")]
    Serialization(#[from] serde_json::Error),
}

pub(crate) async fn sync_remote_node(
    keys: Keys,
    database: Arc<dyn NostrDatabase>,
    remote_nodes: &RemoteNodeStore,
    node_id: &str,
) -> Result<RemoteSyncResult, RemoteSyncError> {
    let record = remote_nodes.get(node_id).await?;
    if record.status != PairingStatus::Accepted {
        return Err(RemoteSyncError::NotAccepted);
    }
    if !record.capabilities.contains(&PairingCapability::RelayRead) {
        return Err(RemoteSyncError::MissingRelayRead);
    }

    let relay_url = record.descriptor.relay_url.to_string();
    let client = ClientBuilder::new()
        .signer(keys)
        .database(Arc::clone(&database))
        .build();
    client
        .add_relay(&relay_url)
        .await
        .map_err(|error| RemoteSyncError::Relay(error.to_string()))?;
    client.connect().await;

    let options = SyncOptions::new()
        .direction(SyncDirection::Down)
        .initial_timeout(Duration::from_secs(5));
    let first_reconciliation = client
        .sync_with(
            [relay_url.as_str()],
            synchronization_filter(
                record
                    .field_session
                    .as_ref()
                    .map(|session| session.id.as_str()),
            ),
            &options,
        )
        .await;
    let reconciliation = match first_reconciliation {
        Ok(reconciliation) if !reconciliation.success.is_empty() => reconciliation,
        first_attempt => {
            // NIP-77 does not define an auth replay. A private relay challenges the first NEG-OPEN,
            // the SDK completes NIP-42 on that connection, and Earthly explicitly replays the
            // reconciliation once rather than weakening the relay's read gate.
            let first_error = match first_attempt {
                Ok(reconciliation) => reconciliation
                    .failed
                    .values()
                    .next()
                    .cloned()
                    .unwrap_or_else(|| "the host did not complete reconciliation".to_owned()),
                Err(error) => error.to_string(),
            };
            match client
                .sync_with(
                    [relay_url.as_str()],
                    synchronization_filter(
                        record
                            .field_session
                            .as_ref()
                            .map(|session| session.id.as_str()),
                    ),
                    &options,
                )
                .await
            {
                Ok(reconciliation) => reconciliation,
                Err(retry_error) => {
                    client.disconnect().await;
                    return Err(RemoteSyncError::Relay(format!(
                        "{first_error}; authenticated retry failed: {retry_error}"
                    )));
                }
            }
        }
    };

    let mut received_ids = reconciliation.received.clone();
    if received_ids.len() < reconciliation.remote.len() {
        // A NIP-42 relay can challenge the first post-negentropy REQ. The pool authenticates the
        // installation, but nostr-sdk 0.44 does not replay that closed REQ. Reconcile once more on
        // the now-authenticated connection so the missing events are actually downloaded.
        let retry = match client
            .sync_with(
                [relay_url.as_str()],
                synchronization_filter(
                    record
                        .field_session
                        .as_ref()
                        .map(|session| session.id.as_str()),
                ),
                &options,
            )
            .await
        {
            Ok(retry) => retry,
            Err(error) => {
                client.disconnect().await;
                return Err(RemoteSyncError::Relay(error.to_string()));
            }
        };
        received_ids.extend(retry.received.iter().copied());
    }
    client.disconnect().await;

    if reconciliation.success.is_empty() {
        let reason = reconciliation
            .failed
            .values()
            .next()
            .cloned()
            .unwrap_or_else(|| "the host did not complete reconciliation".to_owned());
        return Err(RemoteSyncError::Relay(reason));
    }
    if received_ids.len() < reconciliation.remote.len() {
        return Err(RemoteSyncError::Relay(format!(
            "the host advertised {} missing records but delivered only {}; authentication or read access may have failed",
            reconciliation.remote.len(),
            received_ids.len()
        )));
    }

    let received_events = received_ids.len();
    let mut received = Vec::with_capacity(received_events.min(MAX_RESPONSE_EVENTS));
    for event_id in &received_ids {
        if let Some(event) = database
            .event_by_id(event_id)
            .await
            .map_err(|error| RemoteSyncError::Database(error.to_string()))?
        {
            received.push(event);
        }
    }
    received.sort_by(|left, right| {
        right
            .created_at
            .cmp(&left.created_at)
            .then_with(|| right.id.cmp(&left.id))
    });

    let discovered_blob_hashes = extract_blob_hashes(&received);
    let mut response_bytes = 0usize;
    let mut events = Vec::with_capacity(received.len().min(MAX_RESPONSE_EVENTS));
    for event in received {
        let event_bytes = serde_json::to_vec(&event)?.len();
        if events.len() >= MAX_RESPONSE_EVENTS
            || response_bytes.saturating_add(event_bytes) > MAX_RESPONSE_BYTES
        {
            break;
        }
        response_bytes += event_bytes;
        events.push(event);
    }

    let remote_node = remote_nodes
        .record_sync(node_id, received_events, &discovered_blob_hashes)
        .await?;
    Ok(RemoteSyncResult {
        node_id: node_id.to_owned(),
        received_events,
        hydrated_events: events.len(),
        events_truncated: events.len() < received_events,
        events,
        discovered_blob_hashes,
        remote_node,
    })
}

fn synchronization_filter(field_session_id: Option<&str>) -> Filter {
    let kinds = EARTHLY_SYNC_KIND_NUMBERS
        .iter()
        .copied()
        .map(Kind::from)
        .collect::<Vec<_>>();
    let filter = Filter::new().kinds(kinds);
    match field_session_id {
        Some(session_id) => filter.custom_tag(
            SingleLetterTag::lowercase(Alphabet::H),
            session_id.to_owned(),
        ),
        None => filter,
    }
}

fn extract_blob_hashes(events: &[Event]) -> Vec<String> {
    let mut hashes = BTreeSet::new();
    for event in events {
        for tag in event.tags.iter() {
            let values = tag.as_slice();
            let candidates: Box<dyn Iterator<Item = &str> + '_> =
                match values.first().map(String::as_str) {
                    Some("blob") => Box::new(
                        values
                            .iter()
                            .skip(3)
                            .filter_map(|value| value.strip_prefix("sha256=")),
                    ),
                    Some("imeta") => Box::new(values.iter().skip(1).filter_map(|value| {
                        value
                            .strip_prefix("x ")
                            .or_else(|| value.strip_prefix("x="))
                            .or_else(|| value.strip_prefix("sha256="))
                    })),
                    _ => Box::new(iter::empty()),
                };
            hashes.extend(candidates.filter(|hash| is_sha256(hash)).map(str::to_owned));
        }
    }
    hashes.into_iter().collect()
}

fn is_sha256(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synchronization_filter_stays_scoped_to_earthly_content() {
        assert!(EARTHLY_SYNC_KIND_NUMBERS.contains(&37_515));
        assert!(EARTHLY_SYNC_KIND_NUMBERS.contains(&37_522));
        assert!(!EARTHLY_SYNC_KIND_NUMBERS.contains(&0));
        assert!(!EARTHLY_SYNC_KIND_NUMBERS.contains(&17_375));
    }

    #[test]
    fn field_session_synchronization_filter_contains_exact_h_scope() {
        let filter = synchronization_filter(Some("survey-a"));
        let values = filter
            .generic_tags
            .get(&SingleLetterTag::lowercase(Alphabet::H))
            .unwrap();
        assert_eq!(
            values.iter().map(String::as_str).collect::<Vec<_>>(),
            ["survey-a"]
        );
    }

    #[test]
    fn extracts_only_valid_dataset_and_media_hashes() {
        use nostr::{EventBuilder, Keys, Tag};

        let hash_a = "a".repeat(64);
        let hash_b = "b".repeat(64);
        let event = EventBuilder::new(Kind::Custom(37_515), "{}")
            .tags([
                Tag::parse([
                    "blob",
                    "collection",
                    "https://example.test/a",
                    &format!("sha256={hash_a}"),
                ])
                .unwrap(),
                Tag::parse([
                    "imeta",
                    "url https://example.test/b",
                    &format!("x {hash_b}"),
                ])
                .unwrap(),
                Tag::parse([
                    "blob",
                    "collection",
                    "https://example.test/c",
                    "sha256=not-a-hash",
                ])
                .unwrap(),
            ])
            .sign_with_keys(&Keys::generate())
            .unwrap();

        assert_eq!(extract_blob_hashes(&[event]), vec![hash_a, hash_b]);
    }
}
