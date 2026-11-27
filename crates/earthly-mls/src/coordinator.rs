//! Native Rust Cordn ContextVM-over-Nostr client (`src/lib/private-workspace/coordinator.ts`).
//!
//! Speaks the exact `@contextvm/sdk` wire protocol (`kind 25910`, `EncryptionMode.DISABLED`,
//! `isStateless: true`, JSON-RPC 2.0 `tools/call`, CEP-22 oversized transfer chunking/reassembly,
//! and `support_open_stream` live push streaming) over a process-wide persistent connection pool
//! (`CordnConnectionPool`) supporting BOTH Cordn v0.4.0 and Cordn v0.5.8 / `cordn-rs` v0.5.1.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use nostr::{Event, EventBuilder, Filter, Keys, Kind, PublicKey, Tag, Timestamp};
use nostr_sdk::{Client as NostrClient, RelayPoolNotification};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::sync::{mpsc, Mutex as AsyncMutex};

use crate::envelope::{LocalKeysSigner, NostrEventSigner, ReadOnlyNostrSigner};
use crate::is_valid_hex_pubkey;

pub const CTXVM_MESSAGES_KIND: u16 = 25_910;
pub const CORDN_REQUEST_TIMEOUT_SECS: u64 = 25;
const STREAM_HANDSHAKE_PROBE_MS: u64 = 1_500;
const STREAM_CHANNEL_CAPACITY: usize = 256;
const OVERSIZED_THRESHOLD_BYTES: usize = 44_000;
const OVERSIZED_CHUNK_BYTES: usize = 36_000;

fn default_true() -> bool {
    true
}

/// Negotiated Cordn server protocol generation cached per pooled coordinator endpoint.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CordnProtocolMode {
    Unknown,
    V5,
    V4,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoordinatorStreamError {
    /// Coordinator does not support `msg_sub_many` / `support_open_stream` (e.g., Cordn v0.4).
    /// Callers should fall back cleanly to fast pooled polling.
    UnsupportedStreaming(String),
    /// Network, relay, or protocol transport failure.
    Transport(String),
}

impl fmt::Display for CoordinatorStreamError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::UnsupportedStreaming(msg) => write!(f, "Unsupported Cordn streaming: {msg}"),
            Self::Transport(msg) => write!(f, "Cordn streaming transport error: {msg}"),
        }
    }
}

impl std::error::Error for CoordinatorStreamError {}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublishedKeyPackage {
    pub pk: String,
    pub kp_ref: String,
    pub last_resort: bool,
    pub at: u64,
    pub event: serde_json::Value,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AvailableKeyPackage {
    pub pk: String,
    pub kp_ref: String,
    pub last_resort: bool,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PendingWelcome {
    pub kp_ref: String,
    pub welcome_64: String,
    pub at: u64,
    pub after: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingJoinRequest {
    pub pk: String,
    pub kp_ref: String,
    pub at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PendingGroupJoinRequest {
    pub gid: String,
    pub pk: String,
    pub kp_ref: String,
    pub at: u64,
}

impl PendingGroupJoinRequest {
    pub fn into_pending_join_request(self) -> PendingJoinRequest {
        PendingJoinRequest {
            pk: self.pk,
            kp_ref: self.kp_ref,
            at: self.at,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CoordinatorMessage {
    pub cursor: u64,
    pub gid: String,
    pub msg_64: String,
    pub at: u64,
    /// Defaults to `true` so Cordn v0.5+ (encrypted-only, omits `encrypted`) works while
    /// Cordn v0.4 explicit `false` continues to work.
    #[serde(default = "default_true")]
    pub encrypted: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupCursorQuery {
    pub gid: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub after: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupQuery {
    pub gid: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublishKeyPackageResult {
    pub kp_ref: String,
    pub last_resort: bool,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ListKeyPackagesResult {
    #[serde(rename = "keyPackages")]
    pub key_packages: Vec<AvailableKeyPackage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeKeyPackageResult {
    #[serde(rename = "keyPackage")]
    pub key_package: Option<PublishedKeyPackage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveKeyPackagesResult {
    pub kp_refs: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeWelcomesResult {
    pub welcomes: Vec<PendingWelcome>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoreWelcomeResult {
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoreJoinRequestResult {
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeJoinRequestsResult {
    pub requests: Vec<PendingJoinRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TakeManyJoinRequestsResult {
    pub requests: Vec<PendingGroupJoinRequest>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PostMessageResult {
    pub cursor: u64,
    pub gid: String,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FetchMessagesResult {
    pub messages: Vec<CoordinatorMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsumedWelcome {
    pub kp_ref: String,
    pub at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConsumedJoinRequest {
    pub pk: String,
    pub at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ConsumedGroupJoinRequest {
    pub pk: String,
    pub at: u64,
    pub gid: String,
}

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;
pub type StreamBoxFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<mpsc::Receiver<CoordinatorMessage>, CoordinatorStreamError>>
            + Send
            + 'a,
    >,
>;

pub trait PrivateWorkspaceCoordinator: Send + Sync {
    fn publish_key_package(
        &self,
        kp_ref: String,
        kp_64: String,
    ) -> BoxFuture<'_, PublishKeyPackageResult>;

    fn list_key_packages(&self) -> BoxFuture<'_, ListKeyPackagesResult>;

    fn take_key_package(&self, id: String) -> BoxFuture<'_, TakeKeyPackageResult>;

    fn remove_key_packages(
        &self,
        kp_refs: Vec<String>,
    ) -> BoxFuture<'_, RemoveKeyPackagesResult>;

    fn take_welcomes(
        &self,
        consumed: Option<Vec<ConsumedWelcome>>,
    ) -> BoxFuture<'_, TakeWelcomesResult>;

    fn store_welcome(
        &self,
        target_pk: String,
        kp_ref: String,
        welcome_64: String,
        after: Option<u64>,
    ) -> BoxFuture<'_, StoreWelcomeResult>;

    fn store_join_request(
        &self,
        gid: String,
        kp_ref: String,
    ) -> BoxFuture<'_, StoreJoinRequestResult>;

    fn take_join_requests(
        &self,
        gid: String,
        consumed: Option<Vec<ConsumedJoinRequest>>,
    ) -> BoxFuture<'_, TakeJoinRequestsResult>;

    fn post_message(&self, gid: String, msg_64: String) -> BoxFuture<'_, PostMessageResult>;

    fn fetch_messages(
        &self,
        gid: String,
        after: Option<u64>,
    ) -> BoxFuture<'_, FetchMessagesResult>;

    /// Cordn v0.5 batched message fetch across multiple groups (`msg_fetch_many`),
    /// defaulting to sequential `fetch_messages` for v0.4 servers and test mocks.
    fn fetch_many_messages(
        &self,
        groups: Vec<GroupCursorQuery>,
    ) -> BoxFuture<'_, FetchMessagesResult> {
        Box::pin(async move {
            let mut all = Vec::new();
            for group in groups {
                let res = self.fetch_messages(group.gid, group.after).await?;
                all.extend(res.messages);
            }
            Ok(FetchMessagesResult { messages: all })
        })
    }

    /// Cordn v0.5 batched join-request fetch/ack across multiple groups (`join_request_take_many`),
    /// defaulting to sequential `take_join_requests` for v0.4 servers and test mocks.
    fn take_many_join_requests(
        &self,
        groups: Vec<GroupQuery>,
        consumed: Option<Vec<ConsumedGroupJoinRequest>>,
    ) -> BoxFuture<'_, TakeManyJoinRequestsResult> {
        Box::pin(async move {
            let mut all = Vec::new();
            for group in groups {
                let group_consumed: Option<Vec<ConsumedJoinRequest>> = consumed.as_ref().map(|c| {
                    c.iter()
                        .filter(|item| item.gid == group.gid)
                        .map(|item| ConsumedJoinRequest {
                            pk: item.pk.clone(),
                            at: item.at,
                        })
                        .collect()
                });
                let non_empty_consumed = group_consumed.filter(|v| !v.is_empty());
                let res = self
                    .take_join_requests(group.gid.clone(), non_empty_consumed)
                    .await?;
                for req in res.requests {
                    all.push(PendingGroupJoinRequest {
                        gid: group.gid.clone(),
                        pk: req.pk,
                        kp_ref: req.kp_ref,
                        at: req.at,
                    });
                }
            }
            Ok(TakeManyJoinRequestsResult { requests: all })
        })
    }

    /// Cordn v0.5 live push subscription across multiple groups (`msg_sub_many` over
    /// `support_open_stream`). Returns `Err(CoordinatorStreamError::UnsupportedStreaming)` on
    /// v0.4 coordinators or mocks that don't implement push streaming.
    fn subscribe_many_messages(&self, _groups: Vec<GroupCursorQuery>) -> StreamBoxFuture<'_> {
        Box::pin(async {
            Err(CoordinatorStreamError::UnsupportedStreaming(
                "Coordinator does not support live streaming".to_owned(),
            ))
        })
    }
}

// ---------------------------------------------------------------------------
// Process-Wide Persistent Cordn Connection Pool
// ---------------------------------------------------------------------------

pub type CordnPoolKey = (String, Vec<String>);

pub fn canonical_cordn_pool_key(server_pubkey: &str, relays: &[String]) -> CordnPoolKey {
    let mut sorted: Vec<String> = relays
        .iter()
        .map(|r| r.trim().to_owned())
        .filter(|r| !r.is_empty())
        .collect();
    sorted.sort();
    sorted.dedup();
    (server_pubkey.trim().to_owned(), sorted)
}

pub struct PooledCordnConnection {
    client: NostrClient,
    delivery_signer: Arc<LocalKeysSigner>,
    protocol_mode: RwLock<CordnProtocolMode>,
    subscribed_pubkeys: AsyncMutex<HashSet<String>>,
}

impl PooledCordnConnection {
    fn new(client: NostrClient) -> Self {
        Self {
            client,
            delivery_signer: Arc::new(LocalKeysSigner::new(Keys::generate())),
            protocol_mode: RwLock::new(CordnProtocolMode::Unknown),
            subscribed_pubkeys: AsyncMutex::new(HashSet::new()),
        }
    }

    pub fn client(&self) -> &NostrClient {
        &self.client
    }

    pub fn delivery_signer(&self) -> &Arc<LocalKeysSigner> {
        &self.delivery_signer
    }

    pub fn protocol_mode(&self) -> CordnProtocolMode {
        *self
            .protocol_mode
            .read()
            .unwrap_or_else(|e| e.into_inner())
    }

    pub fn set_protocol_mode(&self, mode: CordnProtocolMode) {
        let mut guard = self
            .protocol_mode
            .write()
            .unwrap_or_else(|e| e.into_inner());
        *guard = mode;
    }

    async fn ensure_response_subscription(
        &self,
        server_pk: PublicKey,
        listener_pk: PublicKey,
    ) -> Result<(), String> {
        let listener_hex = listener_pk.to_hex();
        let mut subs = self.subscribed_pubkeys.lock().await;
        if subs.contains(&listener_hex) {
            return Ok(());
        }
        let filter = Filter::new()
            .kind(Kind::Custom(CTXVM_MESSAGES_KIND))
            .author(server_pk)
            .pubkey(listener_pk)
            .since(Timestamp::now() - Duration::from_secs(10));
        self.client
            .subscribe(filter, None)
            .await
            .map_err(|e| format!("Failed to subscribe to Cordn responses: {e}"))?;
        subs.insert(listener_hex);
        Ok(())
    }
}

/// Process-wide persistent pool of long-lived `NostrClient` sessions keyed by
/// `(server_pubkey, sorted_relays)`.
pub struct CordnConnectionPool {
    entries: AsyncMutex<HashMap<CordnPoolKey, Arc<PooledCordnConnection>>>,
}

impl CordnConnectionPool {
    fn new() -> Self {
        Self {
            entries: AsyncMutex::new(HashMap::new()),
        }
    }

    /// Returns an existing persistent connection or establishes and caches a new one.
    pub async fn get_or_connect(
        &self,
        server_pubkey: &str,
        relays: &[String],
    ) -> Result<Arc<PooledCordnConnection>, String> {
        let key = canonical_cordn_pool_key(server_pubkey, relays);
        if !is_valid_hex_pubkey(&key.0) {
            return Err("The Cordn coordinator pubkey is not configured".to_owned());
        }
        if key.1.is_empty() {
            return Err("The Cordn coordinator needs at least one relay".to_owned());
        }

        let mut map = self.entries.lock().await;
        if let Some(existing) = map.get(&key) {
            return Ok(Arc::clone(existing));
        }

        let client = NostrClient::default();
        for relay in &key.1 {
            let _ = client.add_relay(relay).await;
        }
        client.connect().await;
        let conn = Arc::new(PooledCordnConnection::new(client));
        map.insert(key, Arc::clone(&conn));
        Ok(conn)
    }

    /// Reads the cached protocol mode for `(server_pubkey, relays)` without connecting.
    pub async fn cached_protocol_mode(
        &self,
        server_pubkey: &str,
        relays: &[String],
    ) -> CordnProtocolMode {
        let key = canonical_cordn_pool_key(server_pubkey, relays);
        let map = self.entries.lock().await;
        map.get(&key)
            .map(|c| c.protocol_mode())
            .unwrap_or(CordnProtocolMode::Unknown)
    }

    /// Inserts an unconnected pooled handle (for deterministic tests / mode inspection).
    #[cfg(test)]
    pub(crate) async fn insert_for_test(
        &self,
        server_pubkey: &str,
        relays: &[String],
        mode: CordnProtocolMode,
    ) -> Arc<PooledCordnConnection> {
        let key = canonical_cordn_pool_key(server_pubkey, relays);
        let conn = Arc::new(PooledCordnConnection::new(NostrClient::default()));
        conn.set_protocol_mode(mode);
        let mut map = self.entries.lock().await;
        map.insert(key, Arc::clone(&conn));
        conn
    }

    /// Drops and disconnects the pooled connection for `(server_pubkey, relays)` so the next
    /// RPC establishes a fresh WebSocket session and delivery key.
    pub async fn reset_connection(&self, server_pubkey: &str, relays: &[String]) {
        let key = canonical_cordn_pool_key(server_pubkey, relays);
        let removed = {
            let mut map = self.entries.lock().await;
            map.remove(&key)
        };
        if let Some(conn) = removed {
            conn.client.disconnect().await;
        }
    }

    pub async fn active_connection_count(&self) -> usize {
        self.entries.lock().await.len()
    }
}

static CORDN_POOL: OnceLock<CordnConnectionPool> = OnceLock::new();

pub fn cordn_pool() -> &'static CordnConnectionPool {
    CORDN_POOL.get_or_init(CordnConnectionPool::new)
}

/// Resets a pooled Cordn connection (e.g., on transient transport timeout or relay disconnect).
pub async fn reset_cordn_pool_connection(server_pubkey: &str, relays: &[String]) {
    cordn_pool().reset_connection(server_pubkey, relays).await;
}

/// Detects Cordn v0.4 / MCP "unknown tool" or JSON-RPC `-32601` "method not found" errors
/// that trigger automatic downgrade from v0.5 batched/streaming RPCs to v0.4 single-group RPCs.
pub fn is_unsupported_tool_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("unknown tool")
        || lower.contains("tool not found")
        || lower.contains("method not found")
        || lower.contains("-32601")
        || lower.contains("no such tool")
        || lower.contains("unknown method")
        || lower.contains("not implemented")
        || lower.contains("not supported")
        || lower.contains("unsupported tool")
}

/// Detects transient transport/network errors where resetting the pooled relay connection
/// and retrying is appropriate.
pub fn is_transient_transport_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("connection closed")
        || lower.contains("connection reset")
        || lower.contains("connection lost")
        || lower.contains("disconnected")
        || lower.contains("not connected")
        || lower.contains("broken pipe")
        || lower.contains("relay") && (lower.contains("unavailable") || lower.contains("failed"))
        || lower.contains("network") && lower.contains("unavailable")
        || lower.contains("failed to publish cordn rpc")
        || lower.contains("failed to subscribe to cordn")
}

/// CEP-41 `open-stream` control frames sent inside `notifications/progress` (`params.cvm`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OpenStreamControlFrame {
    Ping { nonce: Option<String> },
    Close,
    Abort(String),
}

/// Inspects a JSON-RPC `notifications/progress` frame for CEP-41 `open-stream` control signals
/// (`ping`, `close`, `abort`).
pub fn parse_open_stream_control(frame: &serde_json::Value) -> Option<OpenStreamControlFrame> {
    if frame.get("method").and_then(|m| m.as_str()) != Some("notifications/progress") {
        return None;
    }
    let cvm = frame.pointer("/params/cvm")?;
    if cvm.get("type").and_then(|t| t.as_str()) != Some("open-stream") {
        return None;
    }
    match cvm.get("frameType").and_then(|f| f.as_str()) {
        Some("ping") => {
            let nonce = cvm
                .get("nonce")
                .and_then(|n| n.as_str())
                .map(ToOwned::to_owned);
            Some(OpenStreamControlFrame::Ping { nonce })
        }
        Some("close") => Some(OpenStreamControlFrame::Close),
        Some("abort") => {
            let reason = cvm
                .get("reason")
                .and_then(|r| r.as_str())
                .unwrap_or("aborted")
                .to_owned();
            Some(OpenStreamControlFrame::Abort(reason))
        }
        _ => None,
    }
}

/// Builds a CEP-41 `open-stream` keepalive `pong` `notifications/progress` payload replying to
/// a server `ping`.
pub fn build_open_stream_pong_frame(
    progress_token: &str,
    progress: u64,
    nonce: Option<&str>,
) -> serde_json::Value {
    let mut cvm = serde_json::json!({
        "type": "open-stream",
        "frameType": "pong",
    });
    if let Some(n) = nonce {
        cvm["nonce"] = serde_json::json!(n);
    }
    serde_json::json!({
        "jsonrpc": "2.0",
        "method": "notifications/progress",
        "params": {
            "progressToken": progress_token,
            "progress": progress,
            "cvm": cvm,
        }
    })
}

/// Builds the Nostr event tags (`["p", server_pubkey]`, `["e", request_event_id]`) for a CEP-41
/// `open-stream` keepalive `pong`.
pub fn build_open_stream_pong_tags(server_pubkey: &str, request_event_id: &str) -> Vec<Vec<String>> {
    vec![
        vec!["p".to_owned(), server_pubkey.to_owned()],
        vec!["e".to_owned(), request_event_id.to_owned()],
    ]
}

async fn send_open_stream_pong(
    client: &NostrClient,
    signer: &dyn NostrEventSigner,
    server_pubkey: &str,
    request_event_id: &str,
    progress_token: &str,
    progress: u64,
    nonce: Option<&str>,
) -> Result<(), String> {
    let payload = build_open_stream_pong_frame(progress_token, progress, nonce);
    let tags = build_open_stream_pong_tags(server_pubkey, request_event_id);
    let ev = signer
        .sign_event_template(
            CTXVM_MESSAGES_KIND,
            Timestamp::now().as_secs(),
            tags,
            payload.to_string(),
        )
        .await?;
    client
        .send_event(&ev)
        .await
        .map(|_| ())
        .map_err(|e| format!("Failed to publish CEP-41 open-stream pong: {e}"))
}

/// Executes a Cordn v0.5 RPC with cached protocol-mode detection and automatic downgrade
/// to the Cordn v0.4 fallback when the server rejects unknown tool / method not found.
async fn execute_with_v5_v4_fallback<T, FV5, FutV5, FV4, FutV4>(
    conn: &PooledCordnConnection,
    try_v5: FV5,
    fallback_v4: FV4,
) -> Result<T, String>
where
    FV5: FnOnce() -> FutV5,
    FutV5: Future<Output = Result<T, String>>,
    FV4: FnOnce() -> FutV4,
    FutV4: Future<Output = Result<T, String>>,
{
    if conn.protocol_mode() == CordnProtocolMode::V4 {
        return fallback_v4().await;
    }
    match try_v5().await {
        Ok(val) => {
            conn.set_protocol_mode(CordnProtocolMode::V5);
            Ok(val)
        }
        Err(err) if is_unsupported_tool_error(&err) => {
            conn.set_protocol_mode(CordnProtocolMode::V4);
            fallback_v4().await
        }
        Err(err) => Err(err),
    }
}

/// Parses one or more `CoordinatorMessage` items out of a streaming ContextVM
/// `notifications/progress` JSON-RPC frame produced by Cordn v0.5 (`msg_sub_many`).
pub fn parse_stream_progress_messages(frame: &serde_json::Value) -> Vec<CoordinatorMessage> {
    if frame.get("method").and_then(|m| m.as_str()) != Some("notifications/progress") {
        return Vec::new();
    }
    let Some(params) = frame.get("params") else {
        return Vec::new();
    };
    // Skip CEP-22 oversized-transfer control frames; those are handled by the reassembler.
    if params
        .pointer("/cvm/type")
        .and_then(|t| t.as_str())
        == Some("oversized-transfer")
    {
        return Vec::new();
    }
    // Skip CEP-41 open-stream control frames (ping/close/abort).
    if parse_open_stream_control(frame).is_some() {
        return Vec::new();
    }

    let mut out = Vec::new();
    extract_messages_from_value(params, &mut out);
    if !out.is_empty() {
        return out;
    }

    // Check nested containers used across @contextvm/sdk, cordn v0.5.8, and cordn-rs v0.5.1.
    let candidate_pointers = [
        "/cvm/messages",
        "/cvm/message",
        "/cvm/data",
        "/cvm/chunk",
        "/cvm",
        "/structuredContent/messages",
        "/structuredContent/message",
        "/structuredContent",
        "/messages",
        "/message",
        "/data/messages",
        "/data/message",
        "/data",
        "/result/structuredContent/messages",
        "/result/structuredContent",
        "/content/0/text",
    ];
    for ptr in candidate_pointers {
        if let Some(val) = params.pointer(ptr) {
            extract_messages_from_value(val, &mut out);
            if !out.is_empty() {
                return out;
            }
        }
    }
    out
}

fn extract_messages_from_value(val: &serde_json::Value, out: &mut Vec<CoordinatorMessage>) {
    match val {
        serde_json::Value::Array(items) => {
            for item in items {
                if let Ok(msg) = serde_json::from_value::<CoordinatorMessage>(item.clone()) {
                    out.push(msg);
                }
            }
        }
        serde_json::Value::Object(map) => {
            if let Ok(msg) = serde_json::from_value::<CoordinatorMessage>(val.clone()) {
                out.push(msg);
                return;
            }
            if let Some(arr) = map.get("messages").and_then(|m| m.as_array()) {
                for item in arr {
                    if let Ok(msg) = serde_json::from_value::<CoordinatorMessage>(item.clone()) {
                        out.push(msg);
                    }
                }
            }
        }
        serde_json::Value::String(s) => {
            let trimmed = s.trim();
            if trimmed.is_empty() || !trimmed.contains("msg_64") {
                return;
            }
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
                extract_messages_from_value(&parsed, out);
                return;
            }
            // Fallback: NDJSON (newline-delimited JSON chunks emitted by CEP-41 open-stream).
            for line in trimmed.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(line) {
                    extract_messages_from_value(&parsed, out);
                }
            }
        }
        _ => {}
    }
}

// ---------------------------------------------------------------------------
// Real ContextVM-over-Nostr Cordn Client (Backed by Persistent Pool)
// ---------------------------------------------------------------------------

pub struct CordnCoordinatorClient {
    server_pubkey: String,
    relays: Vec<String>,
    stable_signer: Arc<dyn NostrEventSigner>,
}

impl CordnCoordinatorClient {
    pub fn new(
        server_pubkey: String,
        relays: Vec<String>,
        stable_signer: Arc<dyn NostrEventSigner>,
    ) -> Result<Self, String> {
        let (norm_pk, norm_relays) = canonical_cordn_pool_key(&server_pubkey, &relays);
        if !is_valid_hex_pubkey(&norm_pk) {
            return Err("The Cordn coordinator pubkey is not configured".to_owned());
        }
        if norm_relays.is_empty() {
            return Err("The Cordn coordinator needs at least one relay".to_owned());
        }
        Ok(Self {
            server_pubkey: norm_pk,
            relays: norm_relays,
            stable_signer,
        })
    }

    /// Creates a delivery-only coordinator client backed by a dummy read-only identity
    /// (for background `msg_fetch` / `msg_fetch_many` / `msg_sub_many` with ZERO user signing).
    pub fn new_delivery_only(
        server_pubkey: String,
        relays: Vec<String>,
        owner_pubkey: String,
    ) -> Result<Self, String> {
        let readonly = Arc::new(ReadOnlyNostrSigner::new(owner_pubkey)?);
        Self::new(server_pubkey, relays, readonly)
    }

    pub fn server_pubkey(&self) -> &str {
        &self.server_pubkey
    }

    pub fn relays(&self) -> &[String] {
        &self.relays
    }

    async fn call_tool<T: for<'de> Deserialize<'de>>(
        &self,
        use_stable_identity: bool,
        method: &str,
        args: serde_json::Value,
    ) -> Result<T, String> {
        let conn = cordn_pool()
            .get_or_connect(&self.server_pubkey, &self.relays)
            .await?;

        let signer: &dyn NostrEventSigner = if use_stable_identity {
            self.stable_signer.as_ref()
        } else {
            conn.delivery_signer().as_ref()
        };
        let client_pk = PublicKey::from_hex(&signer.pubkey_hex())
            .map_err(|e| format!("Invalid client pubkey: {e}"))?;
        let server_pk = PublicKey::from_hex(&self.server_pubkey)
            .map_err(|e| format!("Invalid Cordn server pubkey: {e}"))?;

        if let Err(err) = conn
            .ensure_response_subscription(server_pk, client_pk)
            .await
        {
            reset_cordn_pool_connection(&self.server_pubkey, &self.relays).await;
            return Err(err);
        }

        // Subscribe to the broadcast stream BEFORE publishing the RPC event.
        let mut notifications = conn.client().notifications();

        let progress_token = format!("pt-{}", uuid::Uuid::new_v4().simple());
        let rpc_req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {
                "name": method,
                "arguments": args,
                "_meta": {
                    "progressToken": progress_token,
                }
            }
        });
        let serialized_req = serde_json::to_string(&rpc_req)
            .map_err(|e| format!("Failed to encode ContextVM request: {e}"))?;

        let base_tags = vec![
            vec!["p".to_owned(), self.server_pubkey.clone()],
            vec!["support_oversized_transfer".to_owned()],
            vec!["support_open_stream".to_owned()],
        ];

        let send_res = if serialized_req.len() > OVERSIZED_THRESHOLD_BYTES {
            self.send_oversized_request(
                conn.client(),
                &mut notifications,
                signer,
                &serialized_req,
                &progress_token,
                &base_tags,
            )
            .await
        } else {
            let event = signer
                .sign_event_template(
                    CTXVM_MESSAGES_KIND,
                    Timestamp::now().as_secs(),
                    base_tags,
                    serialized_req,
                )
                .await?;
            let id_hex = event.id.to_hex();
            conn.client()
                .send_event(&event)
                .await
                .map(|_| id_hex)
                .map_err(|e| format!("Failed to publish Cordn RPC {method}: {e}"))
        };

        let correlated_event_id = match send_res {
            Ok(id) => id,
            Err(err) => {
                if is_transient_transport_error(&err) {
                    reset_cordn_pool_connection(&self.server_pubkey, &self.relays).await;
                }
                return Err(err);
            }
        };

        let result_val = self
            .await_rpc_response(&mut notifications, &correlated_event_id, method)
            .await;

        let structured = match result_val {
            Ok(v) => v,
            Err(err) => {
                if is_transient_transport_error(&err) {
                    reset_cordn_pool_connection(&self.server_pubkey, &self.relays).await;
                }
                return Err(err);
            }
        };

        serde_json::from_value(structured)
            .map_err(|e| format!("Cordn {method} structuredContent mismatch: {e}"))
    }

    async fn send_oversized_request(
        &self,
        client: &NostrClient,
        notifications: &mut tokio::sync::broadcast::Receiver<RelayPoolNotification>,
        signer: &dyn NostrEventSigner,
        serialized: &str,
        progress_token: &str,
        start_tags: &[Vec<String>],
    ) -> Result<String, String> {
        let bytes = serialized.as_bytes();
        let digest = format!("sha256:{}", hex::encode(Sha256::digest(bytes)));
        let mut chunks: Vec<String> = Vec::new();
        let mut cursor = 0usize;
        while cursor < serialized.len() {
            let mut end = (cursor + OVERSIZED_CHUNK_BYTES).min(serialized.len());
            while end > cursor && !serialized.is_char_boundary(end) {
                end -= 1;
            }
            chunks.push(serialized[cursor..end].to_owned());
            cursor = end;
        }
        let total_chunks = chunks.len();
        let start_msg = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": progress_token,
                "progress": 1,
                "cvm": {
                    "type": "oversized-transfer",
                    "frameType": "start",
                    "totalBytes": bytes.len(),
                    "totalChunks": total_chunks,
                    "digest": digest,
                }
            }
        });
        let start_event = signer
            .sign_event_template(
                CTXVM_MESSAGES_KIND,
                Timestamp::now().as_secs(),
                start_tags.to_vec(),
                start_msg.to_string(),
            )
            .await?;
        client
            .send_event(&start_event)
            .await
            .map_err(|e| format!("Failed to publish CEP-22 start frame: {e}"))?;

        let accept_deadline =
            tokio::time::Instant::now() + Duration::from_secs(CORDN_REQUEST_TIMEOUT_SECS);
        loop {
            let remaining = accept_deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err("Timed out waiting for Cordn oversized-transfer accept".to_owned());
            }
            match tokio::time::timeout(remaining, notifications.recv()).await {
                Ok(Ok(RelayPoolNotification::Event { event, .. })) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&event.content) {
                        let cvm = v.pointer("/params/cvm");
                        let tok = v.pointer("/params/progressToken").and_then(|t| t.as_str());
                        if tok == Some(progress_token)
                            && cvm.and_then(|c| c.get("type")).and_then(|t| t.as_str())
                                == Some("oversized-transfer")
                        {
                            match cvm.and_then(|c| c.get("frameType")).and_then(|f| f.as_str()) {
                                Some("accept") => break,
                                Some("abort") => {
                                    let reason = cvm
                                        .and_then(|c| c.get("reason"))
                                        .and_then(|r| r.as_str())
                                        .unwrap_or("aborted");
                                    return Err(format!("Cordn aborted oversized upload: {reason}"));
                                }
                                _ => {}
                            }
                        }
                    }
                }
                Ok(Ok(_)) => continue,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(_)) | Err(_) => {
                    return Err("Timed out waiting for Cordn oversized-transfer accept".to_owned())
                }
            }
        }

        let cont_tags = vec![vec!["p".to_owned(), self.server_pubkey.clone()]];
        for (idx, chunk) in chunks.into_iter().enumerate() {
            let frame = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "notifications/progress",
                "params": {
                    "progressToken": progress_token,
                    "progress": idx + 3,
                    "cvm": {
                        "type": "oversized-transfer",
                        "frameType": "chunk",
                        "data": chunk,
                    }
                }
            });
            let ev = signer
                .sign_event_template(
                    CTXVM_MESSAGES_KIND,
                    Timestamp::now().as_secs(),
                    cont_tags.clone(),
                    frame.to_string(),
                )
                .await?;
            client
                .send_event(&ev)
                .await
                .map_err(|e| format!("Failed to publish CEP-22 chunk {}: {e}", idx + 1))?;
        }

        let end_frame = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": progress_token,
                "progress": total_chunks + 3,
                "cvm": {
                    "type": "oversized-transfer",
                    "frameType": "end",
                }
            }
        });
        let end_ev = signer
            .sign_event_template(
                CTXVM_MESSAGES_KIND,
                Timestamp::now().as_secs(),
                cont_tags,
                end_frame.to_string(),
            )
            .await?;
        let end_id = end_ev.id.to_hex();
        client
            .send_event(&end_ev)
            .await
            .map_err(|e| format!("Failed to publish CEP-22 end frame: {e}"))?;
        Ok(end_id)
    }

    async fn await_rpc_response(
        &self,
        notifications: &mut tokio::sync::broadcast::Receiver<RelayPoolNotification>,
        request_event_id: &str,
        method: &str,
    ) -> Result<serde_json::Value, String> {
        let deadline =
            tokio::time::Instant::now() + Duration::from_secs(CORDN_REQUEST_TIMEOUT_SECS);
        let mut oversized_total_bytes: Option<usize> = None;
        let mut oversized_digest: Option<String> = None;
        let mut oversized_chunks: BTreeMap<u64, String> = BTreeMap::new();

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err(format!(
                    "Cordn {method} timed out after {CORDN_REQUEST_TIMEOUT_SECS}s"
                ));
            }
            match tokio::time::timeout(remaining, notifications.recv()).await {
                Ok(Ok(RelayPoolNotification::Event { event, .. })) => {
                    if event.pubkey.to_hex() != self.server_pubkey {
                        continue;
                    }
                    let e_tag = event_tag_value(&event, "e");
                    if e_tag.as_deref() != Some(request_event_id) {
                        continue;
                    }
                    let Ok(msg) = serde_json::from_str::<serde_json::Value>(&event.content) else {
                        continue;
                    };

                    if msg.get("method").and_then(|m| m.as_str()) == Some("notifications/progress") {
                        if let Some(cvm) = msg.pointer("/params/cvm") {
                            if cvm.get("type").and_then(|t| t.as_str())
                                == Some("oversized-transfer")
                            {
                                let progress = msg
                                    .pointer("/params/progress")
                                    .and_then(|p| p.as_u64())
                                    .unwrap_or(0);
                                match cvm.get("frameType").and_then(|f| f.as_str()) {
                                    Some("start") => {
                                        oversized_total_bytes = cvm
                                            .get("totalBytes")
                                            .and_then(|n| n.as_u64())
                                            .map(|n| n as usize);
                                        oversized_digest = cvm
                                            .get("digest")
                                            .and_then(|d| d.as_str())
                                            .map(ToOwned::to_owned);
                                        oversized_chunks.clear();
                                    }
                                    Some("chunk") => {
                                        if let Some(data) =
                                            cvm.get("data").and_then(|d| d.as_str())
                                        {
                                            oversized_chunks.insert(progress, data.to_owned());
                                        }
                                    }
                                    Some("end") => {
                                        let assembled: String =
                                            oversized_chunks.values().cloned().collect();
                                        if let Some(expected_len) = oversized_total_bytes {
                                            if assembled.len() != expected_len {
                                                return Err(
                                                    "Cordn oversized response byte length mismatch"
                                                        .to_owned(),
                                                );
                                            }
                                        }
                                        if let Some(expected_digest) = &oversized_digest {
                                            let actual = format!(
                                                "sha256:{}",
                                                hex::encode(Sha256::digest(assembled.as_bytes()))
                                            );
                                            if &actual != expected_digest {
                                                return Err(
                                                    "Cordn oversized response SHA-256 mismatch"
                                                        .to_owned(),
                                                );
                                            }
                                        }
                                        let reassembled: serde_json::Value =
                                            serde_json::from_str(&assembled).map_err(|e| {
                                                format!("Invalid reassembled Cordn JSON: {e}")
                                            })?;
                                        return extract_structured_content(&reassembled, method);
                                    }
                                    Some("abort") => {
                                        let reason = cvm
                                            .get("reason")
                                            .and_then(|r| r.as_str())
                                            .unwrap_or("aborted");
                                        return Err(format!(
                                            "Cordn aborted oversized response: {reason}"
                                        ));
                                    }
                                    _ => {}
                                }
                            }
                        }
                        continue;
                    }

                    if msg.get("result").is_some() || msg.get("error").is_some() {
                        return extract_structured_content(&msg, method);
                    }
                }
                Ok(Ok(_)) => continue,
                Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                Ok(Err(_)) | Err(_) => {
                    return Err(format!(
                        "Cordn {method} timed out after {CORDN_REQUEST_TIMEOUT_SECS}s"
                    ));
                }
            }
        }
    }

    async fn fetch_messages_v4(
        &self,
        gid: String,
        after: Option<u64>,
    ) -> Result<FetchMessagesResult, String> {
        let mut obj = serde_json::json!({ "gid": gid });
        if let Some(cursor) = after {
            obj["after"] = serde_json::json!(cursor);
        }
        self.call_tool(false, "msg_fetch", obj).await
    }

    async fn take_join_requests_v4(
        &self,
        gid: String,
        consumed: Option<Vec<ConsumedJoinRequest>>,
    ) -> Result<TakeJoinRequestsResult, String> {
        let mut obj = serde_json::json!({ "gid": gid });
        if let Some(items) = consumed.filter(|v| !v.is_empty()) {
            obj["consumed"] = serde_json::json!(items);
        }
        self.call_tool(false, "join_request_take", obj).await
    }

    async fn fetch_many_v4_fallback(
        &self,
        groups: Vec<GroupCursorQuery>,
    ) -> Result<FetchMessagesResult, String> {
        let mut all = Vec::new();
        for group in groups {
            let res = self.fetch_messages_v4(group.gid, group.after).await?;
            all.extend(res.messages);
        }
        Ok(FetchMessagesResult { messages: all })
    }

    async fn take_many_join_requests_v4_fallback(
        &self,
        groups: Vec<GroupQuery>,
        consumed: Option<Vec<ConsumedGroupJoinRequest>>,
    ) -> Result<TakeManyJoinRequestsResult, String> {
        let mut all = Vec::new();
        for group in groups {
            let group_consumed: Option<Vec<ConsumedJoinRequest>> = consumed.as_ref().map(|c| {
                c.iter()
                    .filter(|item| item.gid == group.gid)
                    .map(|item| ConsumedJoinRequest {
                        pk: item.pk.clone(),
                        at: item.at,
                    })
                    .collect()
            });
            let non_empty = group_consumed.filter(|v| !v.is_empty());
            let res = self
                .take_join_requests_v4(group.gid.clone(), non_empty)
                .await?;
            for req in res.requests {
                all.push(PendingGroupJoinRequest {
                    gid: group.gid.clone(),
                    pk: req.pk,
                    kp_ref: req.kp_ref,
                    at: req.at,
                });
            }
        }
        Ok(TakeManyJoinRequestsResult { requests: all })
    }
}

fn event_tag_value(event: &Event, name: &str) -> Option<String> {
    event
        .tags
        .iter()
        .find(|t| t.as_slice().first().map(String::as_str) == Some(name))
        .and_then(|t| t.as_slice().get(1))
        .cloned()
}

fn extract_structured_content(
    rpc_msg: &serde_json::Value,
    method: &str,
) -> Result<serde_json::Value, String> {
    if let Some(err) = rpc_msg.get("error") {
        let code = err.get("code").and_then(|c| c.as_i64());
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Cordn RPC error");
        return match code {
            Some(c) => Err(format!("Cordn {method} failed ({c}): {message}")),
            None => Err(format!("Cordn {method} failed: {message}")),
        };
    }
    let result = rpc_msg
        .get("result")
        .ok_or_else(|| format!("Cordn {method} returned no result"))?;
    if result.get("isError").and_then(|v| v.as_bool()) == Some(true) {
        let text = result
            .pointer("/content/0/text")
            .and_then(|t| t.as_str())
            .unwrap_or("Cordn tool returned an error");
        return Err(format!("Cordn {method} error: {text}"));
    }
    result
        .get("structuredContent")
        .cloned()
        .ok_or_else(|| format!("Coordinator returned no structured result for {method}"))
}

impl PrivateWorkspaceCoordinator for CordnCoordinatorClient {
    fn publish_key_package(
        &self,
        kp_ref: String,
        kp_64: String,
    ) -> BoxFuture<'_, PublishKeyPackageResult> {
        Box::pin(async move {
            self.call_tool(
                true,
                "kp_publish",
                serde_json::json!({ "kp_ref": kp_ref, "kp_64": kp_64 }),
            )
            .await
        })
    }

    fn list_key_packages(&self) -> BoxFuture<'_, ListKeyPackagesResult> {
        Box::pin(async move { self.call_tool(false, "kp_list", serde_json::json!({})).await })
    }

    fn take_key_package(&self, id: String) -> BoxFuture<'_, TakeKeyPackageResult> {
        Box::pin(async move {
            self.call_tool(false, "kp_take", serde_json::json!({ "id": id }))
                .await
        })
    }

    fn remove_key_packages(
        &self,
        kp_refs: Vec<String>,
    ) -> BoxFuture<'_, RemoveKeyPackagesResult> {
        Box::pin(async move {
            self.call_tool(true, "kp_remove", serde_json::json!({ "kp_refs": kp_refs }))
                .await
        })
    }

    fn take_welcomes(
        &self,
        consumed: Option<Vec<ConsumedWelcome>>,
    ) -> BoxFuture<'_, TakeWelcomesResult> {
        Box::pin(async move {
            let args = match consumed {
                Some(items) => serde_json::json!({ "consumed": items }),
                None => serde_json::json!({}),
            };
            self.call_tool(true, "welcome_take", args).await
        })
    }

    fn store_welcome(
        &self,
        target_pk: String,
        kp_ref: String,
        welcome_64: String,
        after: Option<u64>,
    ) -> BoxFuture<'_, StoreWelcomeResult> {
        Box::pin(async move {
            let mut obj = serde_json::json!({
                "target_pk": target_pk,
                "kp_ref": kp_ref,
                "welcome_64": welcome_64,
            });
            if let Some(cursor) = after {
                obj["after"] = serde_json::json!(cursor);
            }
            self.call_tool(false, "welcome_store", obj).await
        })
    }

    fn store_join_request(
        &self,
        gid: String,
        kp_ref: String,
    ) -> BoxFuture<'_, StoreJoinRequestResult> {
        Box::pin(async move {
            self.call_tool(
                true,
                "join_request_store",
                serde_json::json!({ "gid": gid, "kp_ref": kp_ref }),
            )
            .await
        })
    }

    fn take_join_requests(
        &self,
        gid: String,
        consumed: Option<Vec<ConsumedJoinRequest>>,
    ) -> BoxFuture<'_, TakeJoinRequestsResult> {
        Box::pin(async move {
            let conn = cordn_pool()
                .get_or_connect(&self.server_pubkey, &self.relays)
                .await?;
            let gid_v5 = gid.clone();
            let consumed_v5 = consumed.clone();
            let gid_v4 = gid.clone();
            execute_with_v5_v4_fallback(
                conn.as_ref(),
                move || async move {
                    let mut args = serde_json::json!({
                        "groups": [GroupQuery { gid: gid_v5.clone() }],
                    });
                    if let Some(items) = consumed_v5.filter(|v| !v.is_empty()) {
                        let mapped: Vec<ConsumedGroupJoinRequest> = items
                            .into_iter()
                            .map(|c| ConsumedGroupJoinRequest {
                                pk: c.pk,
                                at: c.at,
                                gid: gid_v5.clone(),
                            })
                            .collect();
                        args["consumed"] = serde_json::json!(mapped);
                    }
                    let res: TakeManyJoinRequestsResult = self
                        .call_tool(false, "join_request_take_many", args)
                        .await?;
                    let requests = res
                        .requests
                        .into_iter()
                        .filter(|r| r.gid == gid_v5)
                        .map(PendingGroupJoinRequest::into_pending_join_request)
                        .collect();
                    Ok(TakeJoinRequestsResult { requests })
                },
                move || async move { self.take_join_requests_v4(gid_v4, consumed).await },
            )
            .await
        })
    }

    fn post_message(&self, gid: String, msg_64: String) -> BoxFuture<'_, PostMessageResult> {
        Box::pin(async move {
            self.call_tool(
                false,
                "msg_post",
                serde_json::json!({ "gid": gid, "msg_64": msg_64 }),
            )
            .await
        })
    }

    fn fetch_messages(
        &self,
        gid: String,
        after: Option<u64>,
    ) -> BoxFuture<'_, FetchMessagesResult> {
        Box::pin(async move {
            let conn = cordn_pool()
                .get_or_connect(&self.server_pubkey, &self.relays)
                .await?;
            let gid_v5 = gid.clone();
            let gid_v4 = gid.clone();
            execute_with_v5_v4_fallback(
                conn.as_ref(),
                move || async move {
                    let res: FetchMessagesResult = self
                        .call_tool(
                            false,
                            "msg_fetch_many",
                            serde_json::json!({
                                "groups": [GroupCursorQuery {
                                    gid: gid_v5.clone(),
                                    after,
                                }]
                            }),
                        )
                        .await?;
                    let messages = res
                        .messages
                        .into_iter()
                        .filter(|m| m.gid == gid_v5)
                        .collect();
                    Ok(FetchMessagesResult { messages })
                },
                move || async move { self.fetch_messages_v4(gid_v4, after).await },
            )
            .await
        })
    }

    fn fetch_many_messages(
        &self,
        groups: Vec<GroupCursorQuery>,
    ) -> BoxFuture<'_, FetchMessagesResult> {
        Box::pin(async move {
            if groups.is_empty() {
                return Ok(FetchMessagesResult {
                    messages: Vec::new(),
                });
            }
            let conn = cordn_pool()
                .get_or_connect(&self.server_pubkey, &self.relays)
                .await?;
            let groups_v5 = groups.clone();
            execute_with_v5_v4_fallback(
                conn.as_ref(),
                move || async move {
                    self.call_tool::<FetchMessagesResult>(
                        false,
                        "msg_fetch_many",
                        serde_json::json!({ "groups": groups_v5 }),
                    )
                    .await
                },
                move || async move { self.fetch_many_v4_fallback(groups).await },
            )
            .await
        })
    }

    fn take_many_join_requests(
        &self,
        groups: Vec<GroupQuery>,
        consumed: Option<Vec<ConsumedGroupJoinRequest>>,
    ) -> BoxFuture<'_, TakeManyJoinRequestsResult> {
        Box::pin(async move {
            if groups.is_empty() {
                return Ok(TakeManyJoinRequestsResult {
                    requests: Vec::new(),
                });
            }
            let conn = cordn_pool()
                .get_or_connect(&self.server_pubkey, &self.relays)
                .await?;
            let groups_v5 = groups.clone();
            let consumed_v5 = consumed.clone();
            execute_with_v5_v4_fallback(
                conn.as_ref(),
                move || async move {
                    let mut args = serde_json::json!({ "groups": groups_v5 });
                    if let Some(items) = consumed_v5.as_ref().filter(|v| !v.is_empty()) {
                        args["consumed"] = serde_json::json!(items);
                    }
                    self.call_tool::<TakeManyJoinRequestsResult>(
                        false,
                        "join_request_take_many",
                        args,
                    )
                    .await
                },
                move || async move {
                    self.take_many_join_requests_v4_fallback(groups, consumed)
                        .await
                },
            )
            .await
        })
    }

    fn subscribe_many_messages(&self, groups: Vec<GroupCursorQuery>) -> StreamBoxFuture<'_> {
        Box::pin(async move {
            if groups.is_empty() {
                return Err(CoordinatorStreamError::Transport(
                    "msg_sub_many requires at least one group".to_owned(),
                ));
            }
            let conn = cordn_pool()
                .get_or_connect(&self.server_pubkey, &self.relays)
                .await
                .map_err(CoordinatorStreamError::Transport)?;
            if conn.protocol_mode() == CordnProtocolMode::V4 {
                return Err(CoordinatorStreamError::UnsupportedStreaming(
                    "Coordinator negotiated Cordn v0.4 (msg_sub_many unavailable)".to_owned(),
                ));
            }

            let signer = conn.delivery_signer();
            let client_pk = PublicKey::from_hex(&signer.pubkey_hex())
                .map_err(|e| CoordinatorStreamError::Transport(format!("Invalid delivery pk: {e}")))?;
            let server_pk = PublicKey::from_hex(&self.server_pubkey)
                .map_err(|e| CoordinatorStreamError::Transport(format!("Invalid server pk: {e}")))?;

            if let Err(err) = conn.ensure_response_subscription(server_pk, client_pk).await {
                reset_cordn_pool_connection(&self.server_pubkey, &self.relays).await;
                return Err(CoordinatorStreamError::Transport(err));
            }

            let mut notifications = conn.client().notifications();
            let progress_token = format!("sub-{}", uuid::Uuid::new_v4().simple());
            let rpc_req = serde_json::json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": {
                    "name": "msg_sub_many",
                    "arguments": { "groups": groups },
                    "_meta": {
                        "progressToken": progress_token,
                    }
                }
            });
            let serialized_req = serde_json::to_string(&rpc_req).map_err(|e| {
                CoordinatorStreamError::Transport(format!("Failed to encode msg_sub_many: {e}"))
            })?;
            let tags = vec![
                vec!["p".to_owned(), self.server_pubkey.clone()],
                vec!["support_oversized_transfer".to_owned()],
                vec!["support_open_stream".to_owned()],
            ];
            let event = signer
                .sign_event_template(
                    CTXVM_MESSAGES_KIND,
                    Timestamp::now().as_secs(),
                    tags,
                    serialized_req,
                )
                .await
                .map_err(CoordinatorStreamError::Transport)?;
            let request_event_id = event.id.to_hex();
            if let Err(err) = conn.client().send_event(&event).await {
                reset_cordn_pool_connection(&self.server_pubkey, &self.relays).await;
                return Err(CoordinatorStreamError::Transport(format!(
                    "Failed to publish Cordn msg_sub_many: {err}"
                )));
            }

            let (tx, rx) = mpsc::channel(STREAM_CHANNEL_CAPACITY);
            let probe_deadline =
                tokio::time::Instant::now() + Duration::from_millis(STREAM_HANDSHAKE_PROBE_MS);
            let mut pong_progress: u64 = 1;

            // Brief probe window so a v0.4 coordinator's immediate `-32601` / Unknown tool error
            // surfaces synchronously as `Err(CoordinatorStreamError::UnsupportedStreaming)`.
            loop {
                let remaining =
                    probe_deadline.saturating_duration_since(tokio::time::Instant::now());
                if remaining.is_zero() {
                    break;
                }
                match tokio::time::timeout(remaining, notifications.recv()).await {
                    Ok(Ok(RelayPoolNotification::Event { event, .. })) => {
                        if event.pubkey.to_hex() != self.server_pubkey {
                            continue;
                        }
                        let Ok(val) = serde_json::from_str::<serde_json::Value>(&event.content)
                        else {
                            continue;
                        };
                        let matches_event =
                            event_tag_value(&event, "e").as_deref() == Some(&request_event_id);
                        let matches_token = val
                            .pointer("/params/progressToken")
                            .and_then(|t| t.as_str())
                            == Some(&progress_token);
                        if !matches_event && !matches_token {
                            continue;
                        }
                        if val.get("method").and_then(|m| m.as_str())
                            == Some("notifications/progress")
                        {
                            conn.set_protocol_mode(CordnProtocolMode::V5);
                            if let Some(ctrl) = parse_open_stream_control(&val) {
                                match ctrl {
                                    OpenStreamControlFrame::Ping { nonce } => {
                                        let _ = send_open_stream_pong(
                                            conn.client(),
                                            signer.as_ref(),
                                            &self.server_pubkey,
                                            &request_event_id,
                                            &progress_token,
                                            pong_progress,
                                            nonce.as_deref(),
                                        )
                                        .await;
                                        pong_progress += 1;
                                        break;
                                    }
                                    OpenStreamControlFrame::Close => {
                                        return Ok(rx);
                                    }
                                    OpenStreamControlFrame::Abort(reason) => {
                                        return Err(CoordinatorStreamError::Transport(format!(
                                            "Cordn aborted open-stream: {reason}"
                                        )));
                                    }
                                }
                            }
                            for msg in parse_stream_progress_messages(&val) {
                                let _ = tx.try_send(msg);
                            }
                            break;
                        }
                        if val.get("result").is_some() || val.get("error").is_some() {
                            match extract_structured_content(&val, "msg_sub_many") {
                                Ok(structured) => {
                                    conn.set_protocol_mode(CordnProtocolMode::V5);
                                    let mut msgs = Vec::new();
                                    extract_messages_from_value(&structured, &mut msgs);
                                    for msg in msgs {
                                        let _ = tx.try_send(msg);
                                    }
                                    return Ok(rx);
                                }
                                Err(err) if is_unsupported_tool_error(&err) => {
                                    conn.set_protocol_mode(CordnProtocolMode::V4);
                                    return Err(CoordinatorStreamError::UnsupportedStreaming(err));
                                }
                                Err(err) => {
                                    return Err(CoordinatorStreamError::Transport(err));
                                }
                            }
                        }
                    }
                    Ok(Ok(_)) => continue,
                    Ok(Err(tokio::sync::broadcast::error::RecvError::Lagged(_))) => continue,
                    Ok(Err(_)) => {
                        return Err(CoordinatorStreamError::Transport(
                            "Cordn notification stream closed during handshake".to_owned(),
                        ));
                    }
                    Err(_) => break,
                }
            }

            // Spawn background pump forwarding subsequent streaming `notifications/progress`
            // frames and replying to CEP-41 `open-stream` keepalive `ping` frames with `pong`
            // until the receiver is dropped or the stream closes/aborts.
            let server_pubkey = self.server_pubkey.clone();
            let conn_clone = Arc::clone(&conn);
            tokio::spawn(async move {
                let mut oversized_chunks: BTreeMap<u64, String> = BTreeMap::new();
                while !tx.is_closed() {
                    match notifications.recv().await {
                        Ok(RelayPoolNotification::Event { event, .. }) => {
                            if event.pubkey.to_hex() != server_pubkey {
                                continue;
                            }
                            let Ok(val) = serde_json::from_str::<serde_json::Value>(&event.content)
                            else {
                                continue;
                            };
                            let matches_event =
                                event_tag_value(&event, "e").as_deref() == Some(&request_event_id);
                            let matches_token = val
                                .pointer("/params/progressToken")
                                .and_then(|t| t.as_str())
                                == Some(&progress_token);
                            if !matches_event && !matches_token {
                                continue;
                            }

                            if val.get("method").and_then(|m| m.as_str())
                                == Some("notifications/progress")
                            {
                                // Handle CEP-41 open-stream control frames (ping/pong, close, abort).
                                if let Some(ctrl) = parse_open_stream_control(&val) {
                                    conn_clone.set_protocol_mode(CordnProtocolMode::V5);
                                    match ctrl {
                                        OpenStreamControlFrame::Ping { nonce } => {
                                            let _ = send_open_stream_pong(
                                                conn_clone.client(),
                                                conn_clone.delivery_signer().as_ref(),
                                                &server_pubkey,
                                                &request_event_id,
                                                &progress_token,
                                                pong_progress,
                                                nonce.as_deref(),
                                            )
                                            .await;
                                            pong_progress += 1;
                                            continue;
                                        }
                                        OpenStreamControlFrame::Close
                                        | OpenStreamControlFrame::Abort(_) => {
                                            break;
                                        }
                                    }
                                }

                                // Support CEP-22 chunked progress payloads if a streamed frame is oversized.
                                if val.pointer("/params/cvm/type").and_then(|t| t.as_str())
                                    == Some("oversized-transfer")
                                {
                                    let progress = val
                                        .pointer("/params/progress")
                                        .and_then(|p| p.as_u64())
                                        .unwrap_or(0);
                                    match val
                                        .pointer("/params/cvm/frameType")
                                        .and_then(|f| f.as_str())
                                    {
                                        Some("start") => oversized_chunks.clear(),
                                        Some("chunk") => {
                                            if let Some(data) = val
                                                .pointer("/params/cvm/data")
                                                .and_then(|d| d.as_str())
                                            {
                                                oversized_chunks.insert(progress, data.to_owned());
                                            }
                                        }
                                        Some("end") => {
                                            let assembled: String =
                                                oversized_chunks.values().cloned().collect();
                                            oversized_chunks.clear();
                                            if let Ok(reassembled) =
                                                serde_json::from_str::<serde_json::Value>(
                                                    &assembled,
                                                )
                                            {
                                                let mut msgs = Vec::new();
                                                extract_messages_from_value(&reassembled, &mut msgs);
                                                for msg in msgs {
                                                    if tx.send(msg).await.is_err() {
                                                        return;
                                                    }
                                                }
                                            }
                                        }
                                        Some("abort") => oversized_chunks.clear(),
                                        _ => {}
                                    }
                                    continue;
                                }

                                conn_clone.set_protocol_mode(CordnProtocolMode::V5);
                                for msg in parse_stream_progress_messages(&val) {
                                    if tx.send(msg).await.is_err() {
                                        return;
                                    }
                                }
                            } else if val.get("result").is_some() || val.get("error").is_some() {
                                if let Err(err) = extract_structured_content(&val, "msg_sub_many") {
                                    if is_unsupported_tool_error(&err) {
                                        conn_clone.set_protocol_mode(CordnProtocolMode::V4);
                                    }
                                }
                                break;
                            }
                        }
                        Ok(_) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                    }
                }
            });

            Ok(rx)
        })
    }
}

#[allow(dead_code)]
fn _tag_unused_marker(_: Tag, _: EventBuilder) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn coordinator_message_encrypted_defaults_true_for_v5_and_honors_v4_false() {
        // Cordn v0.5+ omits `encrypted` (encrypted-only).
        let v5_json = r#"{"cursor":12,"gid":"earthly:g1","msg_64":"AAAA","at":1760000000}"#;
        let v5_msg: CoordinatorMessage = serde_json::from_str(v5_json).unwrap();
        assert!(v5_msg.encrypted);
        assert_eq!(v5_msg.cursor, 12);

        // Cordn v0.4 explicit `encrypted: false` still works.
        let v4_plain_json =
            r#"{"cursor":13,"gid":"earthly:g1","msg_64":"BBBB","at":1760000001,"encrypted":false}"#;
        let v4_msg: CoordinatorMessage = serde_json::from_str(v4_plain_json).unwrap();
        assert!(!v4_msg.encrypted);

        let v4_enc_json =
            r#"{"cursor":14,"gid":"earthly:g1","msg_64":"CCCC","at":1760000002,"encrypted":true}"#;
        let v4_enc: CoordinatorMessage = serde_json::from_str(v4_enc_json).unwrap();
        assert!(v4_enc.encrypted);
    }

    #[test]
    fn parses_streaming_progress_frames_across_v5_shapes() {
        // Shape 1: params.messages array (omitting `encrypted`)
        let f1 = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-1",
                "progress": 1,
                "messages": [
                    {"cursor": 5, "gid": "earthly:a", "msg_64": "M1", "at": 100},
                    {"cursor": 6, "gid": "earthly:b", "msg_64": "M2", "at": 101}
                ]
            }
        });
        let m1 = parse_stream_progress_messages(&f1);
        assert_eq!(m1.len(), 2);
        assert!(m1[0].encrypted);
        assert_eq!(m1[1].gid, "earthly:b");

        // Shape 2: params.cvm.message single object
        let f2 = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-1",
                "progress": 2,
                "cvm": {
                    "type": "open-stream",
                    "message": {"cursor": 9, "gid": "earthly:a", "msg_64": "M3", "at": 105}
                }
            }
        });
        let m2 = parse_stream_progress_messages(&f2);
        assert_eq!(m2.len(), 1);
        assert_eq!(m2[0].cursor, 9);

        // Shape 3: params.message JSON string
        let f3 = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-1",
                "progress": 3,
                "message": r#"{"cursor":10,"gid":"earthly:a","msg_64":"M4","at":109}"#
            }
        });
        let m3 = parse_stream_progress_messages(&f3);
        assert_eq!(m3.len(), 1);
        assert_eq!(m3[0].msg_64, "M4");

        // Shape 4: CEP-22 oversized-transfer frames must NOT be treated as message frames
        let f4 = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "pt-1",
                "progress": 1,
                "cvm": { "type": "oversized-transfer", "frameType": "accept" }
            }
        });
        assert!(parse_stream_progress_messages(&f4).is_empty());
    }

    #[test]
    fn canonical_pool_key_sorts_and_deduplicates_relays() {
        let pk = "fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37";
        let k1 = canonical_cordn_pool_key(
            pk,
            &[
                "wss://b.example".to_owned(),
                "wss://a.example".to_owned(),
                "wss://b.example".to_owned(),
            ],
        );
        let k2 = canonical_cordn_pool_key(
            pk,
            &[" wss://a.example ".to_owned(), "wss://b.example".to_owned()],
        );
        assert_eq!(k1, k2);
        assert_eq!(k1.1, vec!["wss://a.example", "wss://b.example"]);
    }

    #[tokio::test]
    async fn pool_caches_protocol_mode_and_v4_stream_returns_unsupported_streaming() {
        let server_pk = Keys::generate().public_key().to_hex();
        let owner_pk = Keys::generate().public_key().to_hex();
        let relays = vec!["wss://v4-test.invalid".to_owned()];

        let pool = cordn_pool();
        let conn = pool
            .insert_for_test(&server_pk, &relays, CordnProtocolMode::V4)
            .await;
        assert_eq!(conn.protocol_mode(), CordnProtocolMode::V4);
        assert_eq!(
            pool.cached_protocol_mode(&server_pk, &relays).await,
            CordnProtocolMode::V4
        );

        let client =
            CordnCoordinatorClient::new_delivery_only(server_pk.clone(), relays.clone(), owner_pk)
                .unwrap();
        let err = client
            .subscribe_many_messages(vec![GroupCursorQuery {
                gid: "earthly:test".to_owned(),
                after: None,
            }])
            .await
            .unwrap_err();
        assert!(matches!(err, CoordinatorStreamError::UnsupportedStreaming(_)));

        // Reset removes the cached connection cleanly.
        reset_cordn_pool_connection(&server_pk, &relays).await;
        assert_eq!(
            pool.cached_protocol_mode(&server_pk, &relays).await,
            CordnProtocolMode::Unknown
        );
    }

    #[test]
    fn detects_unsupported_tool_and_transient_errors() {
        assert!(is_unsupported_tool_error(
            "Cordn msg_fetch_many failed (-32601): Method not found"
        ));
        assert!(is_unsupported_tool_error(
            "Cordn msg_sub_many error: Unknown tool: msg_sub_many"
        ));
        assert!(!is_unsupported_tool_error(
            "Cordn msg_fetch_many timed out after 25s"
        ));
        assert!(is_transient_transport_error(
            "Cordn msg_fetch timed out after 25s"
        ));
        assert!(is_transient_transport_error(
            "Failed to publish Cordn RPC msg_post: relay disconnected"
        ));
    }

    #[tokio::test]
    async fn single_group_v5_to_v4_fallback_caches_mode_and_preserves_transient_errors() {
        let server_pk = Keys::generate().public_key().to_hex();
        let relays = vec!["wss://fallback-test.invalid".to_owned()];
        let conn = cordn_pool()
            .insert_for_test(&server_pk, &relays, CordnProtocolMode::Unknown)
            .await;

        // 1. Transient error must NOT downgrade protocol_mode to V4.
        let err = execute_with_v5_v4_fallback(
            conn.as_ref(),
            || async { Err::<&str, String>("Cordn msg_fetch_many timed out after 25s".to_owned()) },
            || async { Ok("v4") },
        )
        .await
        .unwrap_err();
        assert!(err.contains("timed out"));
        assert_eq!(conn.protocol_mode(), CordnProtocolMode::Unknown);

        // 2. Unknown-tool error downgrades protocol_mode to V4 and runs the v0.4 fallback.
        let mut v5_calls = 0usize;
        let mut v4_calls = 0usize;
        let res = execute_with_v5_v4_fallback(
            conn.as_ref(),
            || {
                v5_calls += 1;
                async {
                    Err::<&str, String>(
                        "Cordn msg_fetch_many failed (-32601): Method not found".to_owned(),
                    )
                }
            },
            || {
                v4_calls += 1;
                async { Ok("v4-single") }
            },
        )
        .await
        .unwrap();
        assert_eq!(res, "v4-single");
        assert_eq!(v5_calls, 1);
        assert_eq!(v4_calls, 1);
        assert_eq!(conn.protocol_mode(), CordnProtocolMode::V4);

        // 3. Subsequent single-group call skips v0.5 completely because V4 is cached.
        let mut v5_calls_after = 0usize;
        let res2 = execute_with_v5_v4_fallback(
            conn.as_ref(),
            || {
                v5_calls_after += 1;
                async { Ok("v5-should-not-run") }
            },
            || async { Ok("v4-cached") },
        )
        .await
        .unwrap();
        assert_eq!(res2, "v4-cached");
        assert_eq!(v5_calls_after, 0);

        // 4. Fresh connection succeeding on v0.5 caches V5.
        reset_cordn_pool_connection(&server_pk, &relays).await;
        let conn_v5 = cordn_pool()
            .insert_for_test(&server_pk, &relays, CordnProtocolMode::Unknown)
            .await;
        let res_v5 = execute_with_v5_v4_fallback(
            conn_v5.as_ref(),
            || async { Ok("v5-ok") },
            || async { Ok("v4-unused") },
        )
        .await
        .unwrap();
        assert_eq!(res_v5, "v5-ok");
        assert_eq!(conn_v5.protocol_mode(), CordnProtocolMode::V5);
        reset_cordn_pool_connection(&server_pk, &relays).await;
    }

    #[test]
    fn parses_cep41_open_stream_ping_pong_close_abort_and_ndjson_chunks() {
        let ping = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-abc",
                "progress": 1,
                "cvm": {
                    "type": "open-stream",
                    "frameType": "ping",
                    "nonce": "n-12345"
                }
            }
        });
        assert_eq!(
            parse_open_stream_control(&ping),
            Some(OpenStreamControlFrame::Ping {
                nonce: Some("n-12345".to_owned())
            })
        );
        // Control frames do not produce CoordinatorMessages.
        assert!(parse_stream_progress_messages(&ping).is_empty());

        let pong = build_open_stream_pong_frame("sub-abc", 2, Some("n-12345"));
        assert_eq!(pong["method"], "notifications/progress");
        assert_eq!(pong["params"]["progressToken"], "sub-abc");
        assert_eq!(pong["params"]["cvm"]["type"], "open-stream");
        assert_eq!(pong["params"]["cvm"]["frameType"], "pong");
        assert_eq!(pong["params"]["cvm"]["nonce"], "n-12345");
        let pong_tags = build_open_stream_pong_tags("serverpk", "reqeventid");
        assert_eq!(
            pong_tags,
            vec![
                vec!["p".to_owned(), "serverpk".to_owned()],
                vec!["e".to_owned(), "reqeventid".to_owned()],
            ]
        );

        let close = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-abc",
                "cvm": { "type": "open-stream", "frameType": "close" }
            }
        });
        assert_eq!(
            parse_open_stream_control(&close),
            Some(OpenStreamControlFrame::Close)
        );

        let abort = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-abc",
                "cvm": { "type": "open-stream", "frameType": "abort", "reason": "ping timeout" }
            }
        });
        assert_eq!(
            parse_open_stream_control(&abort),
            Some(OpenStreamControlFrame::Abort("ping timeout".to_owned()))
        );

        // NDJSON chunk payload inside `params.cvm.data`
        let ndjson_frame = serde_json::json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": {
                "progressToken": "sub-abc",
                "progress": 3,
                "cvm": {
                    "type": "open-stream",
                    "frameType": "chunk",
                    "data": "{\"cursor\":21,\"gid\":\"earthly:g1\",\"msg_64\":\"AAA\",\"at\":100}\n{\"cursor\":22,\"gid\":\"earthly:g2\",\"msg_64\":\"BBB\",\"at\":101,\"encrypted\":false}\n"
                }
            }
        });
        assert_eq!(parse_open_stream_control(&ndjson_frame), None);
        let parsed = parse_stream_progress_messages(&ndjson_frame);
        assert_eq!(parsed.len(), 2);
        assert_eq!(parsed[0].cursor, 21);
        assert!(parsed[0].encrypted);
        assert_eq!(parsed[1].cursor, 22);
        assert!(!parsed[1].encrypted);
    }
}
