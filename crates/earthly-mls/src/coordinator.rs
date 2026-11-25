//! Native Rust Cordn ContextVM-over-Nostr client (`src/lib/private-workspace/coordinator.ts`).
//!
//! Speaks the exact `@contextvm/sdk` wire protocol (`kind 25910`, `EncryptionMode.DISABLED`,
//! `isStateless: true`, JSON-RPC 2.0 `tools/call`, CEP-22 oversized transfer chunking/reassembly)
//! with `stable` identity for account-bound RPCs and ephemeral `delivery` keys for group traffic.

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use nostr::{Event, EventBuilder, Filter, Keys, Kind, PublicKey, Tag, Timestamp};
use nostr_sdk::{Client as NostrClient, RelayPoolNotification};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::envelope::{LocalKeysSigner, NostrEventSigner};
use crate::is_valid_hex_pubkey;

pub const CTXVM_MESSAGES_KIND: u16 = 25_910;
pub const CORDN_REQUEST_TIMEOUT_SECS: u64 = 25;
const OVERSIZED_THRESHOLD_BYTES: usize = 44_000;
const OVERSIZED_CHUNK_BYTES: usize = 36_000;

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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CoordinatorMessage {
    pub cursor: u64,
    pub gid: String,
    pub msg_64: String,
    pub at: u64,
    #[serde(default)]
    pub encrypted: bool,
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

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

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
}

/// Real ContextVM-over-Nostr Cordn client.
pub struct CordnCoordinatorClient {
    server_pubkey: String,
    relays: Vec<String>,
    stable_signer: Arc<dyn NostrEventSigner>,
    delivery_signer: Arc<LocalKeysSigner>,
}

impl CordnCoordinatorClient {
    pub fn new(
        server_pubkey: String,
        relays: Vec<String>,
        stable_signer: Arc<dyn NostrEventSigner>,
    ) -> Result<Self, String> {
        if !is_valid_hex_pubkey(&server_pubkey) {
            return Err("The Cordn coordinator pubkey is not configured".to_owned());
        }
        if relays.is_empty() {
            return Err("The Cordn coordinator needs at least one relay".to_owned());
        }
        Ok(Self {
            server_pubkey,
            relays,
            stable_signer,
            delivery_signer: Arc::new(LocalKeysSigner::new(Keys::generate())),
        })
    }

    async fn call_tool<T: for<'de> Deserialize<'de>>(
        &self,
        use_stable_identity: bool,
        method: &str,
        args: serde_json::Value,
    ) -> Result<T, String> {
        let signer: &dyn NostrEventSigner = if use_stable_identity {
            self.stable_signer.as_ref()
        } else {
            self.delivery_signer.as_ref()
        };
        let client_pk = PublicKey::from_hex(&signer.pubkey_hex())
            .map_err(|e| format!("Invalid client pubkey: {e}"))?;
        let server_pk = PublicKey::from_hex(&self.server_pubkey)
            .map_err(|e| format!("Invalid Cordn server pubkey: {e}"))?;

        let client = NostrClient::default();
        for relay in &self.relays {
            let _ = client.add_relay(relay).await;
        }
        client.connect().await;

        let filter = Filter::new()
            .kind(Kind::Custom(CTXVM_MESSAGES_KIND))
            .author(server_pk)
            .pubkey(client_pk)
            .since(Timestamp::now() - Duration::from_secs(10));
        let mut notifications = client.notifications();
        let sub_id = client
            .subscribe(filter, None)
            .await
            .map_err(|e| format!("Failed to subscribe to Cordn responses: {e}"))?
            .val;

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

        let correlated_event_id = if serialized_req.len() > OVERSIZED_THRESHOLD_BYTES {
            self.send_oversized_request(
                &client,
                &mut notifications,
                signer,
                &serialized_req,
                &progress_token,
                &base_tags,
            )
            .await?
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
            client
                .send_event(&event)
                .await
                .map_err(|e| format!("Failed to publish Cordn RPC {method}: {e}"))?;
            id_hex
        };

        let result_val = self
            .await_rpc_response(&mut notifications, &correlated_event_id, method)
            .await;

        let _ = client.unsubscribe(&sub_id).await;
        client.disconnect().await;

        let structured = result_val?;
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
        // Split safely on UTF-8 char boundaries.
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

        // Wait for server `accept` frame.
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
        // Reassembly buffer for CEP-22 oversized server responses.
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

                    // Handle CEP-22 oversized response frames if server chunks a large reply.
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
        let message = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("Cordn RPC error");
        return Err(format!("Cordn {method} failed: {message}"));
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
            let mut obj = serde_json::json!({ "gid": gid });
            if let Some(items) = consumed {
                obj["consumed"] = serde_json::json!(items);
            }
            self.call_tool(false, "join_request_take", obj).await
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
            let mut obj = serde_json::json!({ "gid": gid });
            if let Some(cursor) = after {
                obj["after"] = serde_json::json!(cursor);
            }
            self.call_tool(false, "msg_fetch", obj).await
        })
    }
}

#[allow(dead_code)]
fn _tag_unused_marker(_: Tag, _: EventBuilder) {}
