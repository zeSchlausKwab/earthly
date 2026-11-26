//! Crash-safe SQLite outbox relay delivery and Nearby Field Session publishing.

use std::time::Duration;

use earthly_storage::{
    OUTBOX_PROTOCOL_VERSION, OutboxEnqueueInput, OutboxItemState, OutboxItemSummaryView,
    OutboxItemView, OutboxRelayResultInput, OutboxRelayState, OutboxRelayView, OutboxRouting,
    OutboxStore,
};
use nostr::{Event, JsonUtil};

#[derive(Clone, Debug)]
pub struct RelayDeliveryStatusDto {
    pub relay_url: String,
    pub ok: bool,
    pub message: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PublishOutcomeDto {
    pub event_id: String,
    pub outbox_state: String,
    pub relays: Vec<RelayDeliveryStatusDto>,
}

#[derive(Clone, Debug)]
pub struct OutboxRelayItemDto {
    pub relay_url: String,
    pub state: String,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug)]
pub struct OutboxItemDto {
    pub id: String,
    pub event_id: String,
    pub kind: u16,
    pub state: String,
    pub attempt_count: u64,
    pub next_retry_at: Option<u64>,
    pub created_at: u64,
    pub relays: Vec<OutboxRelayItemDto>,
}

#[derive(Clone, Debug)]
pub struct OutboxFlushReportDto {
    pub attempted: u32,
    pub delivered: u32,
    pub retrying: u32,
    pub failed: u32,
    pub remaining: u32,
}

fn outbox_item_state_str(state: OutboxItemState) -> &'static str {
    match state {
        OutboxItemState::Queued => "queued",
        OutboxItemState::Delivering => "delivering",
        OutboxItemState::Delivered => "delivered",
        OutboxItemState::Partial => "partial",
        OutboxItemState::RetryWait => "retry_wait",
        OutboxItemState::Rejected => "rejected",
        OutboxItemState::Discarded => "discarded",
    }
}

fn outbox_relay_state_str(state: OutboxRelayState) -> &'static str {
    match state {
        OutboxRelayState::Pending => "pending",
        OutboxRelayState::Acknowledged => "acknowledged",
        OutboxRelayState::Rejected => "rejected",
    }
}

fn build_outbox_item_dto(
    id: String,
    event_id: String,
    kind: u16,
    state: OutboxItemState,
    attempt_count: u64,
    next_retry_at: Option<u64>,
    created_at: u64,
    relays: Vec<OutboxRelayView>,
) -> OutboxItemDto {
    OutboxItemDto {
        id,
        event_id,
        kind,
        state: outbox_item_state_str(state).to_owned(),
        attempt_count,
        next_retry_at,
        created_at,
        relays: relays
            .into_iter()
            .map(|r| OutboxRelayItemDto {
                relay_url: r.relay_url,
                state: outbox_relay_state_str(r.state).to_owned(),
                last_error: r.last_error,
            })
            .collect(),
    }
}

impl From<OutboxItemSummaryView> for OutboxItemDto {
    fn from(item: OutboxItemSummaryView) -> Self {
        build_outbox_item_dto(
            item.id,
            item.event_id,
            item.event_kind,
            item.state,
            item.attempt_count,
            item.next_attempt_at,
            item.created_at,
            item.relays,
        )
    }
}

impl From<OutboxItemView> for OutboxItemDto {
    fn from(item: OutboxItemView) -> Self {
        build_outbox_item_dto(
            item.id,
            item.event_id,
            item.event_kind,
            item.state,
            item.attempt_count,
            item.next_attempt_at,
            item.created_at,
            item.relays,
        )
    }
}

async fn deliver_event_to_relays(
    event: &Event,
    relay_urls: &[String],
) -> (Vec<OutboxRelayResultInput>, Vec<RelayDeliveryStatusDto>) {
    let mut results = Vec::with_capacity(relay_urls.len());
    let mut ui_statuses = Vec::with_capacity(relay_urls.len());

    let client = match crate::api::relay_pool::shared_client(relay_urls).await {
        Ok(client) => client,
        Err(err) => {
            for relay_url in relay_urls {
                results.push(OutboxRelayResultInput {
                    relay_url: relay_url.clone(),
                    ok: false,
                    message: Some(err.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: relay_url.clone(),
                    ok: false,
                    message: Some(err.clone()),
                });
            }
            return (results, ui_statuses);
        }
    };

    for relay_url in relay_urls {
        let attempt = async {
            let output = tokio::time::timeout(
                Duration::from_secs(8),
                client.send_event_to([relay_url.as_str()], event),
            )
            .await
            .map_err(|_| "relay publish timed out".to_owned())?
            .map_err(|e| e.to_string())?;
            if !output.success.is_empty() {
                Ok("accepted".to_owned())
            } else if let Some((_, reason)) = output.failed.into_iter().next() {
                Err(reason)
            } else {
                Err("relay did not acknowledge event".to_owned())
            }
        }
        .await;

        match attempt {
            Ok(msg) => {
                results.push(OutboxRelayResultInput {
                    relay_url: relay_url.clone(),
                    ok: true,
                    message: Some(msg.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: relay_url.clone(),
                    ok: true,
                    message: Some(msg),
                });
            }
            Err(err) => {
                results.push(OutboxRelayResultInput {
                    relay_url: relay_url.clone(),
                    ok: false,
                    message: Some(err.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: relay_url.clone(),
                    ok: false,
                    message: Some(err),
                });
            }
        }
    }

    (results, ui_statuses)
}

/// Persists an already-signed Nostr event into the crash-safe SQLite outbox
/// BEFORE network transmission, delivers it to each target relay via the shared
/// `nostr-sdk` relay pool, records per-relay acknowledgements, and returns the
/// live outcome.
pub async fn publish_signed_event_via_outbox(
    database_path: String,
    signed_event_json: String,
    relay_urls: Vec<String>,
) -> Result<PublishOutcomeDto, String> {
    let urls = if relay_urls.is_empty() {
        vec!["wss://relay.earthly.city".to_owned()]
    } else {
        relay_urls
    };

    let event =
        Event::from_json(&signed_event_json).map_err(|err| format!("invalid signed event: {err}"))?;
    event
        .verify()
        .map_err(|err| format!("signed event signature verification failed: {err}"))?;

    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let queued = store
        .enqueue(OutboxEnqueueInput {
            version: OUTBOX_PROTOCOL_VERSION,
            event_json: signed_event_json,
            routing: OutboxRouting::Configured,
            target_pubkey: None,
            relay_urls: urls.clone(),
            required_relay_urls: vec![urls[0].clone()],
        })
        .map_err(|e| e.to_string())?;

    // Claim for delivery and attempt transmission via the shared relay pool.
    let _ = store.flush();
    let target_urls: Vec<String> = queued
        .relays
        .iter()
        .map(|r| r.relay_url.clone())
        .collect();
    let (results, ui_statuses) = deliver_event_to_relays(&event, &target_urls).await;

    let updated = store
        .record_results(&queued.id, results)
        .map_err(|e| e.to_string())?;
    let state_str = outbox_item_state_str(updated.state).to_owned();

    Ok(PublishOutcomeDto {
        event_id: updated.event_id,
        outbox_state: state_str,
        relays: ui_statuses,
    })
}

/// Lists all non-discarded outbox queue items from SQLite.
pub fn list_outbox_items(database_path: String) -> Result<Vec<OutboxItemDto>, String> {
    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let items = store.list_summaries().map_err(|e| e.to_string())?;
    Ok(items.into_iter().map(OutboxItemDto::from).collect())
}

/// Claims all ready outbox items via `OutboxStore::flush`, attempts delivery via
/// the shared relay pool, records per-relay results, and returns a flush report.
pub async fn flush_outbox_queue(database_path: String) -> Result<OutboxFlushReportDto, String> {
    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let claimed = store.flush().map_err(|e| e.to_string())?;

    let attempted = claimed.len() as u32;
    let mut delivered = 0u32;
    let mut retrying = 0u32;
    let mut failed = 0u32;

    for item in claimed {
        let mut target_urls: Vec<String> = item
            .relays
            .iter()
            .filter(|r| r.state != OutboxRelayState::Acknowledged)
            .map(|r| r.relay_url.clone())
            .collect();
        if target_urls.is_empty() {
            target_urls = item.relays.iter().map(|r| r.relay_url.clone()).collect();
        }

        let results = match Event::from_json(&item.event_json)
            .map_err(|e| format!("invalid signed event in outbox: {e}"))
            .and_then(|ev| {
                ev.verify()
                    .map_err(|e| format!("outbox event verification failed: {e}"))?;
                Ok(ev)
            }) {
            Ok(event) => deliver_event_to_relays(&event, &target_urls).await.0,
            Err(err) => target_urls
                .into_iter()
                .map(|relay_url| OutboxRelayResultInput {
                    relay_url,
                    ok: false,
                    message: Some(err.clone()),
                })
                .collect(),
        };

        let updated = store
            .record_results(&item.id, results)
            .map_err(|e| e.to_string())?;
        match updated.state {
            OutboxItemState::Delivered => delivered += 1,
            OutboxItemState::Partial | OutboxItemState::RetryWait | OutboxItemState::Queued => {
                retrying += 1
            }
            OutboxItemState::Rejected => failed += 1,
            OutboxItemState::Delivering | OutboxItemState::Discarded => {}
        }
    }

    let summary = store.diagnostic_summary().map_err(|e| e.to_string())?;
    let remaining = (summary.queued
        + summary.delivering
        + summary.partial
        + summary.retry_wait
        + summary.rejected) as u32;

    Ok(OutboxFlushReportDto {
        attempted,
        delivered,
        retrying,
        failed,
        remaining,
    })
}

/// Resets a failed/partial/retry-wait outbox item back to `queued` for immediate retry.
pub fn retry_outbox_item(database_path: String, item_id: String) -> Result<OutboxItemDto, String> {
    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let updated = store.retry(&item_id).map_err(|e| e.to_string())?;
    Ok(OutboxItemDto::from(updated))
}

/// Marks an undelivered outbox item as `discarded` so it will not be retried.
pub fn discard_outbox_item(
    database_path: String,
    item_id: String,
) -> Result<OutboxItemDto, String> {
    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let updated = store.discard(&item_id).map_err(|e| e.to_string())?;
    Ok(OutboxItemDto::from(updated))
}

/// Publishes a signed Nostr event to the local embedded `LocalNode` (trusted
/// in-process LMDB ingest, zero auth friction) AND pushes it with full NIP-42
/// authentication to every approved paired Nearby peer node via
/// `LocalNode::publish_remote_event`, recording all outcomes in the SQLite Outbox.
pub async fn publish_nearby_event_via_outbox(
    database_path: String,
    signed_event_json: String,
    remote_node_ids: Vec<String>,
) -> Result<PublishOutcomeDto, String> {
    let node = crate::api::spike::current_node()
        .ok_or_else(|| "local node is not running".to_owned())?;
    let event =
        Event::from_json(&signed_event_json).map_err(|err| format!("invalid signed event: {err}"))?;
    event
        .verify()
        .map_err(|err| format!("signed event signature verification failed: {err}"))?;

    let local_url = node.descriptor().relay_url.to_string();
    let remotes = node.remote_nodes().await.unwrap_or_default();
    let target_remotes: Vec<_> = remotes
        .into_iter()
        .filter(|r| {
            if remote_node_ids.is_empty() {
                matches!(r.status, earthly_local_node::PairingStatus::Accepted)
            } else {
                remote_node_ids.contains(&r.node_id)
            }
        })
        .collect();

    let mut relay_urls = vec![local_url.clone()];
    for r in &target_remotes {
        relay_urls.push(r.descriptor.relay_url.to_string());
    }

    let store = OutboxStore::open(&database_path).map_err(|e| e.to_string())?;
    let queued = store
        .enqueue(OutboxEnqueueInput {
            version: OUTBOX_PROTOCOL_VERSION,
            event_json: signed_event_json,
            routing: OutboxRouting::Configured,
            target_pubkey: None,
            relay_urls: relay_urls.clone(),
            required_relay_urls: vec![local_url.clone()],
        })
        .map_err(|e| e.to_string())?;
    let _ = store.flush();

    let mut results = Vec::new();
    let mut ui_statuses = Vec::new();

    // 1. Trusted in-process ingest into this device's local LMDB relay.
    match node.ingest_verified_event(&event).await {
        Ok(stored) => {
            let msg = if stored {
                "stored locally".to_owned()
            } else {
                "already present locally".to_owned()
            };
            results.push(OutboxRelayResultInput {
                relay_url: local_url.clone(),
                ok: true,
                message: Some(msg.clone()),
            });
            ui_statuses.push(RelayDeliveryStatusDto {
                relay_url: local_url,
                ok: true,
                message: Some(msg),
            });
        }
        Err(err) => {
            let msg = err.to_string();
            results.push(OutboxRelayResultInput {
                relay_url: local_url.clone(),
                ok: false,
                message: Some(msg.clone()),
            });
            ui_statuses.push(RelayDeliveryStatusDto {
                relay_url: local_url,
                ok: false,
                message: Some(msg),
            });
        }
    }

    // 2. NIP-42 authenticated WebSocket publish to every approved paired peer.
    for remote in target_remotes {
        let remote_url = remote.descriptor.relay_url.to_string();
        match node.publish_remote_event(&remote.node_id, event.clone()).await {
            Ok(_) => {
                let msg = "accepted (NIP-42 paired)".to_owned();
                results.push(OutboxRelayResultInput {
                    relay_url: remote_url.clone(),
                    ok: true,
                    message: Some(msg.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: remote_url,
                    ok: true,
                    message: Some(msg),
                });
            }
            Err(err) => {
                let msg = err.to_string();
                results.push(OutboxRelayResultInput {
                    relay_url: remote_url.clone(),
                    ok: false,
                    message: Some(msg.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: remote_url,
                    ok: false,
                    message: Some(msg),
                });
            }
        }
    }

    let updated = store
        .record_results(&queued.id, results)
        .map_err(|e| e.to_string())?;
    let state_str = outbox_item_state_str(updated.state).to_owned();

    Ok(PublishOutcomeDto {
        event_id: updated.event_id,
        outbox_state: state_str,
        relays: ui_statuses,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[tokio::test]
    async fn outbox_list_retry_flush_and_discard_lifecycle() {
        let dir = tempfile::TempDir::new().unwrap();
        let db_path = dir.path().join("outbox.sqlite3");
        let db_str = db_path.to_string_lossy().to_string();

        // Empty queue flush returns zeroes.
        let empty_report = flush_outbox_queue(db_str.clone()).await.unwrap();
        assert_eq!(empty_report.attempted, 0);
        assert_eq!(empty_report.remaining, 0);
        assert!(list_outbox_items(db_str.clone()).unwrap().is_empty());

        // Enqueue a valid signed event targeting an unreachable loopback relay.
        let keys = Keys::generate();
        let event = nostr::EventBuilder::new(
            nostr::Kind::Custom(37_515),
            r#"{"type":"FeatureCollection","features":[]}"#,
        )
        .tag(nostr::Tag::identifier("outbox-ffi-test"))
        .sign_with_keys(&keys)
        .unwrap();
        let store = OutboxStore::open(&db_path).unwrap();
        let queued = store
            .enqueue(OutboxEnqueueInput {
                version: OUTBOX_PROTOCOL_VERSION,
                event_json: event.as_json(),
                routing: OutboxRouting::Configured,
                target_pubkey: None,
                relay_urls: vec!["ws://127.0.0.1:9".to_owned()],
                required_relay_urls: vec!["ws://127.0.0.1:9".to_owned()],
            })
            .unwrap();
        drop(store);

        let listed = list_outbox_items(db_str.clone()).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, queued.id);
        assert_eq!(listed[0].kind, 37_515);
        assert_eq!(listed[0].state, "queued");
        assert_eq!(listed[0].relays[0].state, "pending");

        // Flush fails against closed loopback port -> transitions to retry_wait.
        let report = flush_outbox_queue(db_str.clone()).await.unwrap();
        assert_eq!(report.attempted, 1);
        assert_eq!(report.delivered, 0);
        assert_eq!(report.retrying, 1);
        assert_eq!(report.remaining, 1);

        let after_flush = list_outbox_items(db_str.clone()).unwrap();
        assert_eq!(after_flush[0].state, "retry_wait");
        assert_eq!(after_flush[0].attempt_count, 1);
        assert!(after_flush[0].next_retry_at.is_some());
        assert_eq!(after_flush[0].relays[0].state, "rejected");

        // Manual retry resets state back to queued and clears next_retry_at.
        let retried = retry_outbox_item(db_str.clone(), queued.id.clone()).unwrap();
        assert_eq!(retried.state, "queued");
        assert!(retried.next_retry_at.is_none());
        assert_eq!(retried.relays[0].state, "pending");

        // Discard hides the item from active outbox list.
        let discarded = discard_outbox_item(db_str.clone(), queued.id.clone()).unwrap();
        assert_eq!(discarded.state, "discarded");
        assert!(list_outbox_items(db_str).unwrap().is_empty());
    }
}
