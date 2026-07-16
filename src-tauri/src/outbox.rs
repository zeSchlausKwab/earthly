use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use nostr::{Event, JsonUtil, PublicKey, Url};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use tauri::State;

const PROTOCOL_VERSION: u8 = 1;
const LIVE_BEACON_KIND: u16 = 37_521;
const MAX_RETRY_DELAY_SECONDS: u64 = 15 * 60;
const SUMMARY_DELIVERED_HISTORY_LIMIT: u64 = 200;

#[derive(Debug)]
pub struct OutboxState {
    connection: Mutex<Connection>,
}

impl OutboxState {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, OutboxCommandError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                OutboxCommandError::new("outbox-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(&database_path)?;
        configure_and_migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, OutboxCommandError> {
        self.connection.lock().map_err(|_| {
            OutboxCommandError::new("outbox-lock-failed", "The publish outbox is unavailable")
        })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxCommandError {
    code: String,
    message: String,
}

impl OutboxCommandError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for OutboxCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("outbox-database-failed", error.to_string())
    }
}

impl std::fmt::Display for OutboxCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for OutboxCommandError {}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxRouting {
    Configured,
    Outbox,
    Inbox,
    Reply,
}

impl OutboxRouting {
    fn as_str(self) -> &'static str {
        match self {
            Self::Configured => "configured",
            Self::Outbox => "outbox",
            Self::Inbox => "inbox",
            Self::Reply => "reply",
        }
    }

    fn parse(value: &str) -> Result<Self, OutboxCommandError> {
        match value {
            "configured" => Ok(Self::Configured),
            "outbox" => Ok(Self::Outbox),
            "inbox" => Ok(Self::Inbox),
            "reply" => Ok(Self::Reply),
            _ => Err(OutboxCommandError::new(
                "outbox-corrupt",
                format!("Unknown persisted outbox routing: {value}"),
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxItemState {
    Queued,
    Delivering,
    Delivered,
    Partial,
    RetryWait,
    Rejected,
    Discarded,
}

impl OutboxItemState {
    fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Delivering => "delivering",
            Self::Delivered => "delivered",
            Self::Partial => "partial",
            Self::RetryWait => "retry_wait",
            Self::Rejected => "rejected",
            Self::Discarded => "discarded",
        }
    }

    fn parse(value: &str) -> Result<Self, OutboxCommandError> {
        match value {
            "queued" => Ok(Self::Queued),
            "delivering" => Ok(Self::Delivering),
            "delivered" => Ok(Self::Delivered),
            "partial" => Ok(Self::Partial),
            "retry_wait" => Ok(Self::RetryWait),
            "rejected" => Ok(Self::Rejected),
            "discarded" => Ok(Self::Discarded),
            _ => Err(OutboxCommandError::new(
                "outbox-corrupt",
                format!("Unknown persisted outbox state: {value}"),
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutboxRelayState {
    Pending,
    Acknowledged,
    Rejected,
}

impl OutboxRelayState {
    fn parse(value: &str) -> Result<Self, OutboxCommandError> {
        match value {
            "pending" => Ok(Self::Pending),
            "acknowledged" => Ok(Self::Acknowledged),
            "rejected" => Ok(Self::Rejected),
            _ => Err(OutboxCommandError::new(
                "outbox-corrupt",
                format!("Unknown persisted relay state: {value}"),
            )),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutboxEnqueueInput {
    version: u8,
    event_json: String,
    routing: OutboxRouting,
    target_pubkey: Option<String>,
    relay_urls: Vec<String>,
    required_relay_urls: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutboxRelayResultInput {
    relay_url: String,
    ok: bool,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxRelayView {
    relay_url: String,
    required: bool,
    state: OutboxRelayState,
    attempts: u64,
    acknowledged_at: Option<u64>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItemView {
    version: u8,
    id: String,
    event_json: String,
    event_id: String,
    event_kind: u16,
    routing: OutboxRouting,
    target_pubkey: Option<String>,
    state: OutboxItemState,
    attempt_count: u64,
    next_attempt_at: Option<u64>,
    created_at: u64,
    updated_at: u64,
    last_error: Option<String>,
    relays: Vec<OutboxRelayView>,
}

/// Delivery-ledger row returned to the webview. Deliberately omits
/// `event_json`: a signed GeoJSON event can be large and the status UI never
/// needs to clone those bytes across IPC.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxItemSummaryView {
    version: u8,
    id: String,
    event_id: String,
    event_kind: u16,
    routing: OutboxRouting,
    target_pubkey: Option<String>,
    state: OutboxItemState,
    attempt_count: u64,
    next_attempt_at: Option<u64>,
    created_at: u64,
    updated_at: u64,
    last_error: Option<String>,
    relays: Vec<OutboxRelayView>,
}

impl From<OutboxItemView> for OutboxItemSummaryView {
    fn from(item: OutboxItemView) -> Self {
        Self {
            version: item.version,
            id: item.id,
            event_id: item.event_id,
            event_kind: item.event_kind,
            routing: item.routing,
            target_pubkey: item.target_pubkey,
            state: item.state,
            attempt_count: item.attempt_count,
            next_attempt_at: item.next_attempt_at,
            created_at: item.created_at,
            updated_at: item.updated_at,
            last_error: item.last_error,
            relays: item.relays,
        }
    }
}

fn configure_and_migrate(connection: &Connection) -> Result<(), OutboxCommandError> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS outbox_items (
           id TEXT PRIMARY KEY,
           event_json TEXT NOT NULL,
           event_id TEXT NOT NULL UNIQUE,
           event_kind INTEGER NOT NULL,
           routing TEXT NOT NULL,
           target_pubkey TEXT,
           state TEXT NOT NULL,
           attempt_count INTEGER NOT NULL DEFAULT 0,
           next_attempt_at INTEGER,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           last_error TEXT
         );
         CREATE TABLE IF NOT EXISTS outbox_relays (
           outbox_id TEXT NOT NULL REFERENCES outbox_items(id) ON DELETE CASCADE,
           relay_url TEXT NOT NULL,
           required INTEGER NOT NULL DEFAULT 1,
           state TEXT NOT NULL,
           attempts INTEGER NOT NULL DEFAULT 0,
           acknowledged_at INTEGER,
           last_error TEXT,
           PRIMARY KEY (outbox_id, relay_url)
         );
         CREATE INDEX IF NOT EXISTS outbox_delivery_queue
           ON outbox_items(state, next_attempt_at, created_at);",
    )?;
    let now = now_seconds();
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?1)",
        params![now],
    )?;
    // A process can die after claiming an item and before recording relay results.
    // Reopening the database makes those claims eligible for byte-identical replay.
    connection.execute(
        "UPDATE outbox_items
         SET state = 'queued', next_attempt_at = NULL, updated_at = ?1
         WHERE state = 'delivering'",
        params![now],
    )?;
    Ok(())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn validate_version(version: u8) -> Result<(), OutboxCommandError> {
    if version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(OutboxCommandError::new(
            "unsupported-outbox-version",
            format!("Outbox protocol version {version} is not supported"),
        ))
    }
}

fn normalize_relay_urls(values: Vec<String>) -> Result<Vec<String>, OutboxCommandError> {
    let mut normalized = BTreeSet::new();
    for value in values {
        let url = Url::parse(&value).map_err(|_| {
            OutboxCommandError::new("invalid-relay-url", format!("Invalid relay URL: {value}"))
        })?;
        if !matches!(url.scheme(), "ws" | "wss") {
            return Err(OutboxCommandError::new(
                "invalid-relay-url",
                format!("Relay URL must use ws:// or wss://: {value}"),
            ));
        }
        normalized.insert(url.to_string());
    }
    if normalized.is_empty() {
        return Err(OutboxCommandError::new(
            "missing-relays",
            "At least one relay is required for a durable publish",
        ));
    }
    Ok(normalized.into_iter().collect())
}

fn validate_target(
    routing: OutboxRouting,
    target_pubkey: Option<String>,
) -> Result<Option<String>, OutboxCommandError> {
    match (routing, target_pubkey) {
        (OutboxRouting::Inbox | OutboxRouting::Reply, Some(target)) => {
            PublicKey::parse(&target).map_err(|_| {
                OutboxCommandError::new("invalid-target-pubkey", "Invalid target public key")
            })?;
            Ok(Some(target))
        }
        (OutboxRouting::Inbox | OutboxRouting::Reply, None) => Err(OutboxCommandError::new(
            "missing-target-pubkey",
            "Inbox and reply publishes require a target public key",
        )),
        (_, Some(_)) => Err(OutboxCommandError::new(
            "unexpected-target-pubkey",
            "Configured and outbox publishes cannot carry a target public key",
        )),
        (_, None) => Ok(None),
    }
}

fn enqueue(
    connection: &mut Connection,
    input: OutboxEnqueueInput,
) -> Result<OutboxItemView, OutboxCommandError> {
    validate_version(input.version)?;
    let event = Event::from_json(&input.event_json).map_err(|error| {
        OutboxCommandError::new(
            "invalid-signed-event",
            format!("Invalid event JSON: {error}"),
        )
    })?;
    event.verify().map_err(|error| {
        OutboxCommandError::new(
            "invalid-signed-event",
            format!("Event signature verification failed: {error}"),
        )
    })?;
    if event.kind.as_u16() == LIVE_BEACON_KIND {
        return Err(OutboxCommandError::new(
            "ephemeral-event-not-durable",
            "Live beacon heartbeats are intentionally excluded from the durable outbox",
        ));
    }

    let target_pubkey = validate_target(input.routing, input.target_pubkey)?;
    let relay_urls = normalize_relay_urls(input.relay_urls)?;
    let required_relay_urls = normalize_relay_urls(input.required_relay_urls)?;
    let relay_set: BTreeSet<_> = relay_urls.iter().cloned().collect();
    if required_relay_urls
        .iter()
        .any(|relay| !relay_set.contains(relay))
    {
        return Err(OutboxCommandError::new(
            "invalid-required-relays",
            "Every required relay must also be a delivery target",
        ));
    }

    let event_id = event.id.to_hex();
    if let Some(existing) = load_item(connection, &event_id)? {
        let existing_relays: Vec<_> = existing
            .relays
            .iter()
            .map(|relay| relay.relay_url.clone())
            .collect();
        let existing_required: Vec<_> = existing
            .relays
            .iter()
            .filter(|relay| relay.required)
            .map(|relay| relay.relay_url.clone())
            .collect();
        if existing.event_json != input.event_json
            || existing.routing != input.routing
            || existing.target_pubkey != target_pubkey
            || existing_relays != relay_urls
            || existing_required != required_relay_urls
        {
            return Err(OutboxCommandError::new(
                "outbox-idempotency-conflict",
                "That signed event is already queued with different immutable delivery metadata",
            ));
        }
        return Ok(existing);
    }

    let now = now_seconds();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO outbox_items(
           id, event_json, event_id, event_kind, routing, target_pubkey, state,
           attempt_count, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'queued', 0, ?7, ?7)",
        params![
            event_id,
            input.event_json,
            event_id,
            event.kind.as_u16(),
            input.routing.as_str(),
            target_pubkey,
            now,
        ],
    )?;
    let required: BTreeSet<_> = required_relay_urls.into_iter().collect();
    for relay_url in relay_urls {
        transaction.execute(
            "INSERT INTO outbox_relays(
               outbox_id, relay_url, required, state, attempts
             ) VALUES (?1, ?2, ?3, 'pending', 0)",
            params![event_id, relay_url, required.contains(&relay_url)],
        )?;
    }
    transaction.commit()?;
    load_item(connection, &event_id)?.ok_or_else(|| {
        OutboxCommandError::new(
            "outbox-write-failed",
            "The queued event could not be reloaded",
        )
    })
}

fn load_item(
    connection: &Connection,
    id: &str,
) -> Result<Option<OutboxItemView>, OutboxCommandError> {
    let item = connection
        .query_row(
            "SELECT id, event_json, event_id, event_kind, routing, target_pubkey, state,
                    attempt_count, next_attempt_at, created_at, updated_at, last_error
             FROM outbox_items WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u16>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, u64>(7)?,
                    row.get::<_, Option<u64>>(8)?,
                    row.get::<_, u64>(9)?,
                    row.get::<_, u64>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        event_json,
        event_id,
        event_kind,
        routing,
        target_pubkey,
        state,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at,
        last_error,
    )) = item
    else {
        return Ok(None);
    };

    let mut statement = connection.prepare(
        "SELECT relay_url, required, state, attempts, acknowledged_at, last_error
         FROM outbox_relays WHERE outbox_id = ?1 ORDER BY relay_url",
    )?;
    let relays = statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, bool>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u64>(3)?,
                row.get::<_, Option<u64>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })?
        .map(|row| {
            let (relay_url, required, state, attempts, acknowledged_at, last_error) = row?;
            Ok(OutboxRelayView {
                relay_url,
                required,
                state: OutboxRelayState::parse(&state)?,
                attempts,
                acknowledged_at,
                last_error,
            })
        })
        .collect::<Result<Vec<_>, OutboxCommandError>>()?;

    Ok(Some(OutboxItemView {
        version: PROTOCOL_VERSION,
        id,
        event_json,
        event_id,
        event_kind,
        routing: OutboxRouting::parse(&routing)?,
        target_pubkey,
        state: OutboxItemState::parse(&state)?,
        attempt_count,
        next_attempt_at,
        created_at,
        updated_at,
        last_error,
        relays,
    }))
}

fn list(connection: &Connection) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    let mut statement = connection.prepare(
        "SELECT id FROM outbox_items WHERE state != 'discarded' ORDER BY created_at, id",
    )?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.into_iter()
        .map(|id| {
            load_item(connection, &id)?.ok_or_else(|| {
                OutboxCommandError::new("outbox-corrupt", "An outbox item disappeared")
            })
        })
        .collect()
}

fn list_summaries(
    connection: &Connection,
) -> Result<Vec<OutboxItemSummaryView>, OutboxCommandError> {
    let mut statement = connection.prepare(
        "SELECT id FROM (
             SELECT id, created_at FROM outbox_items
             WHERE state NOT IN ('discarded', 'delivered')
             UNION ALL
             SELECT id, created_at FROM (
                 SELECT id, created_at FROM outbox_items
                 WHERE state = 'delivered'
                 ORDER BY created_at DESC, id DESC
                 LIMIT ?1
             )
         )
         ORDER BY created_at DESC, id DESC",
    )?;
    let ids = statement
        .query_map(params![SUMMARY_DELIVERED_HISTORY_LIMIT], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<Result<Vec<_>, _>>()?;
    ids.into_iter()
        .map(|id| {
            load_item(connection, &id)?
                .map(OutboxItemSummaryView::from)
                .ok_or_else(|| {
                    OutboxCommandError::new("outbox-corrupt", "An outbox item disappeared")
                })
        })
        .collect()
}

fn flush(connection: &mut Connection) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    let now = now_seconds();
    let transaction = connection.transaction()?;
    let ids = due_item_ids(&transaction, now)?;
    for id in &ids {
        transaction.execute(
            "UPDATE outbox_items
             SET state = 'delivering', updated_at = ?2
             WHERE id = ?1",
            params![id, now],
        )?;
    }
    transaction.commit()?;
    ids.into_iter()
        .map(|id| {
            load_item(connection, &id)?.ok_or_else(|| {
                OutboxCommandError::new("outbox-corrupt", "A claimed outbox item disappeared")
            })
        })
        .collect()
}

fn due_item_ids(
    transaction: &Transaction<'_>,
    now: u64,
) -> Result<Vec<String>, OutboxCommandError> {
    let mut statement = transaction.prepare(
        "SELECT id FROM outbox_items
         WHERE state IN ('queued', 'partial', 'retry_wait', 'rejected')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?1)
         ORDER BY created_at, id",
    )?;
    let ids = statement
        .query_map(params![now], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ids)
}

fn record_results(
    connection: &mut Connection,
    id: &str,
    results: Vec<OutboxRelayResultInput>,
) -> Result<OutboxItemView, OutboxCommandError> {
    if results.is_empty() {
        return Err(OutboxCommandError::new(
            "missing-relay-results",
            "At least one relay result is required",
        ));
    }
    let item = load_item(connection, id)?.ok_or_else(|| {
        OutboxCommandError::new("outbox-item-not-found", "The outbox item does not exist")
    })?;
    if matches!(
        item.state,
        OutboxItemState::Delivered | OutboxItemState::Discarded
    ) {
        return Ok(item);
    }

    let expected: BTreeSet<_> = item
        .relays
        .iter()
        .map(|relay| relay.relay_url.clone())
        .collect();
    let mut normalized = BTreeMap::new();
    for result in results {
        let relay_url = normalize_relay_urls(vec![result.relay_url.clone()])?
            .into_iter()
            .next()
            .expect("normalization rejects an empty relay list");
        if !expected.contains(&relay_url) {
            return Err(OutboxCommandError::new(
                "unexpected-relay-result",
                format!("The relay was not part of this delivery: {relay_url}"),
            ));
        }
        normalized.insert(relay_url, result);
    }

    let now = now_seconds();
    let transaction = connection.transaction()?;
    for (relay_url, result) in normalized {
        let (state, acknowledged_at, last_error) = if result.ok {
            ("acknowledged", Some(now), None)
        } else {
            (
                "rejected",
                None,
                Some(
                    result
                        .message
                        .unwrap_or_else(|| "Relay rejected the event".to_string()),
                ),
            )
        };
        transaction.execute(
            "UPDATE outbox_relays
             SET state = ?3, attempts = attempts + 1, acknowledged_at = ?4, last_error = ?5
             WHERE outbox_id = ?1 AND relay_url = ?2 AND state != 'acknowledged'",
            params![id, relay_url, state, acknowledged_at, last_error],
        )?;
    }

    let (total, acknowledged, required_total, required_acknowledged): (u64, u64, u64, u64) =
        transaction.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN state = 'acknowledged' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN required = 1 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN required = 1 AND state = 'acknowledged' THEN 1 ELSE 0 END)
             FROM outbox_relays WHERE outbox_id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )?;
    let attempt_count: u64 = transaction.query_row(
        "SELECT attempt_count + 1 FROM outbox_items WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    let (state, next_attempt_at) = if acknowledged == total {
        (OutboxItemState::Delivered, None)
    } else if required_acknowledged == required_total {
        (
            OutboxItemState::Partial,
            Some(now.saturating_add(retry_delay(attempt_count))),
        )
    } else {
        (
            OutboxItemState::RetryWait,
            Some(now.saturating_add(retry_delay(attempt_count))),
        )
    };
    let last_error: Option<String> = transaction
        .query_row(
            "SELECT last_error FROM outbox_relays
             WHERE outbox_id = ?1 AND state != 'acknowledged' AND last_error IS NOT NULL
             ORDER BY relay_url LIMIT 1",
            params![id],
            |row| row.get(0),
        )
        .optional()?;
    transaction.execute(
        "UPDATE outbox_items
         SET state = ?2, attempt_count = ?3, next_attempt_at = ?4,
             updated_at = ?5, last_error = ?6
         WHERE id = ?1",
        params![
            id,
            state.as_str(),
            attempt_count,
            next_attempt_at,
            now,
            last_error,
        ],
    )?;
    transaction.commit()?;
    load_item(connection, id)?.ok_or_else(|| {
        OutboxCommandError::new(
            "outbox-write-failed",
            "The updated event could not be reloaded",
        )
    })
}

fn retry_delay(attempt_count: u64) -> u64 {
    let exponent = attempt_count.saturating_sub(1).min(8) as u32;
    5_u64
        .saturating_mul(2_u64.saturating_pow(exponent))
        .min(MAX_RETRY_DELAY_SECONDS)
}

fn retry(connection: &Connection, id: &str) -> Result<OutboxItemView, OutboxCommandError> {
    let changed = connection.execute(
        "UPDATE outbox_items
         SET state = 'queued', next_attempt_at = NULL, updated_at = ?2, last_error = NULL
         WHERE id = ?1 AND state IN ('partial', 'retry_wait', 'rejected')",
        params![id, now_seconds()],
    )?;
    if changed > 0 {
        connection.execute(
            "UPDATE outbox_relays SET state = 'pending', last_error = NULL
             WHERE outbox_id = ?1 AND state != 'acknowledged'",
            params![id],
        )?;
    }
    load_item(connection, id)?.ok_or_else(|| {
        OutboxCommandError::new("outbox-item-not-found", "The outbox item does not exist")
    })
}

fn discard(connection: &Connection, id: &str) -> Result<OutboxItemView, OutboxCommandError> {
    let item = load_item(connection, id)?.ok_or_else(|| {
        OutboxCommandError::new("outbox-item-not-found", "The outbox item does not exist")
    })?;
    if item.state == OutboxItemState::Delivered {
        return Err(OutboxCommandError::new(
            "outbox-already-delivered",
            "A delivered event cannot be discarded",
        ));
    }
    connection.execute(
        "UPDATE outbox_items
         SET state = 'discarded', next_attempt_at = NULL, updated_at = ?2
         WHERE id = ?1",
        params![id, now_seconds()],
    )?;
    load_item(connection, id)?.ok_or_else(|| {
        OutboxCommandError::new(
            "outbox-write-failed",
            "The discarded event could not be reloaded",
        )
    })
}

#[tauri::command]
pub fn outbox_enqueue_v1(
    state: State<'_, OutboxState>,
    input: OutboxEnqueueInput,
) -> Result<OutboxItemView, OutboxCommandError> {
    let mut connection = state.connection()?;
    enqueue(&mut connection, input)
}

#[tauri::command]
pub fn outbox_list_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    let connection = state.connection()?;
    list(&connection)
}

#[tauri::command]
pub fn outbox_list_summaries_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemSummaryView>, OutboxCommandError> {
    let connection = state.connection()?;
    list_summaries(&connection)
}

#[tauri::command]
pub fn outbox_flush_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    let mut connection = state.connection()?;
    flush(&mut connection)
}

#[tauri::command]
pub fn outbox_record_results_v1(
    state: State<'_, OutboxState>,
    id: String,
    results: Vec<OutboxRelayResultInput>,
) -> Result<OutboxItemView, OutboxCommandError> {
    let mut connection = state.connection()?;
    record_results(&mut connection, &id, results)
}

#[tauri::command]
pub fn outbox_retry_v1(
    state: State<'_, OutboxState>,
    id: String,
) -> Result<OutboxItemView, OutboxCommandError> {
    let connection = state.connection()?;
    retry(&connection, &id)
}

#[tauri::command]
pub fn outbox_discard_v1(
    state: State<'_, OutboxState>,
    id: String,
) -> Result<OutboxItemView, OutboxCommandError> {
    let connection = state.connection()?;
    discard(&connection, &id)
}

#[cfg(test)]
mod tests {
    use nostr::{EventBuilder, Keys, Kind};
    use tempfile::TempDir;

    use super::*;

    fn test_state() -> (TempDir, OutboxState) {
        let directory = TempDir::new().expect("temporary directory");
        let state =
            OutboxState::open(directory.path().join("earthly.sqlite3")).expect("outbox database");
        (directory, state)
    }

    fn signed_event(kind: u16) -> Event {
        EventBuilder::new(Kind::Custom(kind), "offline-safe event")
            .sign_with_keys(&Keys::generate())
            .expect("signed event")
    }

    fn enqueue_input(event: &Event) -> OutboxEnqueueInput {
        OutboxEnqueueInput {
            version: 1,
            event_json: event.as_json(),
            routing: OutboxRouting::Configured,
            target_pubkey: None,
            relay_urls: vec![
                "wss://optional.example".to_string(),
                "wss://required.example".to_string(),
            ],
            required_relay_urls: vec!["wss://required.example".to_string()],
        }
    }

    #[test]
    fn enqueue_is_idempotent_and_preserves_signed_bytes() {
        let (_directory, state) = test_state();
        let event = signed_event(1);
        let input = enqueue_input(&event);
        let mut connection = state.connection().expect("connection");
        let first = enqueue(&mut connection, input.clone()).expect("first enqueue");
        let second = enqueue(&mut connection, input).expect("idempotent enqueue");

        assert_eq!(first.id, event.id.to_hex());
        assert_eq!(first.event_json, event.as_json());
        assert_eq!(second.id, first.id);
        assert_eq!(list(&connection).expect("list").len(), 1);
        let summaries = list_summaries(&connection).expect("summaries");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].event_id, event.id.to_hex());
        assert_eq!(summaries[0].event_kind, 1);
    }

    #[test]
    fn summary_history_never_hides_actionable_items() {
        let (_directory, state) = test_state();
        let pending_event = signed_event(1);
        let mut connection = state.connection().expect("connection");
        let pending = enqueue(&mut connection, enqueue_input(&pending_event)).expect("pending");

        for _ in 0..=SUMMARY_DELIVERED_HISTORY_LIMIT {
            let delivered_event = signed_event(1);
            let delivered =
                enqueue(&mut connection, enqueue_input(&delivered_event)).expect("delivered");
            connection
                .execute(
                    "UPDATE outbox_items SET state = 'delivered' WHERE id = ?1",
                    params![delivered.id],
                )
                .expect("mark delivered");
        }

        let summaries = list_summaries(&connection).expect("summaries");
        assert_eq!(
            summaries
                .iter()
                .filter(|item| item.state == OutboxItemState::Delivered)
                .count(),
            SUMMARY_DELIVERED_HISTORY_LIMIT as usize
        );
        assert!(summaries.iter().any(|item| item.event_id == pending.id));
    }

    #[test]
    fn rejects_live_beacons_and_invalid_signatures() {
        let (_directory, state) = test_state();
        let mut connection = state.connection().expect("connection");
        let beacon = signed_event(LIVE_BEACON_KIND);
        let error = enqueue(&mut connection, enqueue_input(&beacon)).expect_err("beacon rejected");
        assert_eq!(error.code, "ephemeral-event-not-durable");

        let event = signed_event(1);
        let mut value: serde_json::Value = serde_json::from_str(&event.as_json()).expect("event");
        value["content"] = serde_json::Value::String("tampered".to_string());
        let mut input = enqueue_input(&event);
        input.event_json = value.to_string();
        let error = enqueue(&mut connection, input).expect_err("signature rejected");
        assert_eq!(error.code, "invalid-signed-event");
    }

    #[test]
    fn partial_delivery_retries_only_unacknowledged_relays() {
        let (_directory, state) = test_state();
        let event = signed_event(1);
        let mut connection = state.connection().expect("connection");
        let queued = enqueue(&mut connection, enqueue_input(&event)).expect("enqueue");
        let partial = record_results(
            &mut connection,
            &queued.id,
            vec![
                OutboxRelayResultInput {
                    relay_url: "wss://required.example".to_string(),
                    ok: true,
                    message: Some("saved".to_string()),
                },
                OutboxRelayResultInput {
                    relay_url: "wss://optional.example".to_string(),
                    ok: false,
                    message: Some("offline".to_string()),
                },
            ],
        )
        .expect("record partial delivery");
        assert_eq!(partial.state, OutboxItemState::Partial);

        let retried = retry(&connection, &queued.id).expect("retry");
        assert_eq!(retried.state, OutboxItemState::Queued);
        assert_eq!(
            retried
                .relays
                .iter()
                .find(|relay| relay.relay_url == "wss://required.example/")
                .expect("required relay")
                .state,
            OutboxRelayState::Acknowledged
        );
        assert_eq!(
            retried
                .relays
                .iter()
                .find(|relay| relay.relay_url == "wss://optional.example/")
                .expect("optional relay")
                .state,
            OutboxRelayState::Pending
        );
    }

    #[test]
    fn delivering_claim_recovers_after_process_restart() {
        let (directory, state) = test_state();
        let event = signed_event(1);
        let id = {
            let mut connection = state.connection().expect("connection");
            let queued = enqueue(&mut connection, enqueue_input(&event)).expect("enqueue");
            let claimed = flush(&mut connection).expect("flush");
            assert_eq!(claimed[0].state, OutboxItemState::Delivering);
            queued.id
        };
        drop(state);

        let reopened =
            OutboxState::open(directory.path().join("earthly.sqlite3")).expect("reopened outbox");
        let item = load_item(&reopened.connection().expect("connection"), &id)
            .expect("load")
            .expect("item");
        assert_eq!(item.state, OutboxItemState::Queued);
    }
}
