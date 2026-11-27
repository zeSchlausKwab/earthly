//! Flutter Rust Bridge facade for Earthly Circles (RFC 9420 MLS + Cordn ContextVM v0.4/v0.5).

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_mls::coordinator::{
    canonical_cordn_pool_key, CoordinatorMessage, CoordinatorStreamError, CordnCoordinatorClient,
    CordnPoolKey, GroupCursorQuery, PendingJoinRequest, PrivateWorkspaceCoordinator,
};
use earthly_mls::envelope::{
    compute_nostr_event_id, parse_nostr_tags, LocalKeysSigner, NostrEventSigner,
    ReadOnlyNostrSigner,
};
use earthly_mls::group_ref::{decode_cordn_group_ref, encode_cordn_group_ref, CordnGroupRef};
use earthly_mls::invitation::decode_private_map_invitation;
use earthly_mls::media::{
    build_imeta_tag, decrypt_media_attachment, encrypt_cordn_media, encrypt_persistent_map_media,
    randomize_attachment_filename, strip_image_metadata, EncryptedMediaImeta,
    CORDN_ENCRYPTED_MEDIA_VERSION, EARTHLY_PERSISTENT_MEDIA_VERSION,
};
use earthly_mls::multi_device::{
    build_group_document_from_workspace, build_signed_tip_event, build_tip_event_template,
    generate_multi_device_dek, reconcile_remote_group_document_locked, seal_group_document,
    seal_meta_document, unseal_group_document, unseal_meta_document, unseal_tip_payload_for_self,
    validate_tip_payload, MultiDeviceDocPointer, MultiDeviceMetaDocument, MultiDeviceRemovedGroup,
    MultiDeviceTipPayload, ReconcileOutcome, MULTI_DEVICE_DOC_TYPE_META,
    MULTI_DEVICE_SCHEMA_VERSION, MULTI_DEVICE_TIP_D_TAG, MULTI_DEVICE_TIP_KIND,
};
use earthly_mls::service::{PrivateWorkspaceService, MAX_AUTO_APPROVE_BATCH};
use earthly_mls::storage::{
    workspace_mutex, SqlitePrivateWorkspaceStore, StoredWorkspace, WorkspaceMetadata,
    SYNC_HEALTH_REMOVED,
};
use earthly_mls::DEFAULT_CORDN_SERVER_PUBKEY;
use flutter_rust_bridge::DartFnFuture;
use nostr::{Event, EventBuilder, Filter, JsonUtil, Keys, Kind, PublicKey, Timestamp};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tokio::sync::mpsc;

use crate::api::blossom::{
    prepare_unsigned_blossom_upload_auth, upload_blob_to_blossom, DEFAULT_BLOSSOM_SERVER_URL,
};
use crate::api::nip46::Nip46CircleSigner;

const DEFAULT_CIRCLE_RELAY: &str = "wss://relay.earthly.city";
const MAX_ENCRYPTED_MEDIA_BYTES: usize = 30 * 1024 * 1024;
const HTTP_MEDIA_TIMEOUT_SECS: u64 = 30;
const POLL_ACTIVE_MS: u64 = 1_500;
const POLL_WARM_MS: u64 = 3_000;
const POLL_QUIET_MS: u64 = 5_000;
const STREAM_MEMBERSHIP_CHECK_MS: u64 = 3_000;
const STREAM_TRANSPORT_BACKOFF_SECS: u64 = 15;

type ExternalSignCallback = Arc<dyn Fn(String) -> DartFnFuture<String> + Send + Sync>;

#[derive(Clone)]
struct RegisteredExternalSigner {
    pubkey_hex: String,
    sign_fn: ExternalSignCallback,
}

static EXTERNAL_CIRCLE_SIGNER: OnceLock<RwLock<Option<RegisteredExternalSigner>>> = OnceLock::new();

fn external_signer_lock() -> &'static RwLock<Option<RegisteredExternalSigner>> {
    EXTERNAL_CIRCLE_SIGNER.get_or_init(|| RwLock::new(None))
}

fn normalize_pubkey_hex(raw: &str) -> Result<String, String> {
    PublicKey::parse(raw.trim())
        .map(|pk| pk.to_hex())
        .map_err(|e| format!("Invalid Nostr public key: {e}"))
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn encode_hex_lower(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn decode_hex_32(raw: &str, label: &str) -> Result<[u8; 32], String> {
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.len() != 64 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(format!("{label} must be a 64-char hex string"));
    }
    let mut out = [0u8; 32];
    for (idx, slot) in out.iter_mut().enumerate() {
        let byte_str = &trimmed[idx * 2..idx * 2 + 2];
        *slot = u8::from_str_radix(byte_str, 16)
            .map_err(|_| format!("Invalid hex in {label}"))?;
    }
    Ok(out)
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn normalize_http_base_url(raw: &str, default_url: &str, label: &str) -> Result<String, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    let chosen = if trimmed.is_empty() {
        default_url
    } else {
        trimmed
    };
    if !chosen.starts_with("https://") && !chosen.starts_with("http://") {
        return Err(format!("Invalid {label} URL: {chosen}"));
    }
    Ok(chosen.to_owned())
}

fn normalize_relay_urls(relay_urls: Vec<String>) -> Vec<String> {
    let mut out: Vec<String> = relay_urls
        .into_iter()
        .map(|r| r.trim().to_owned())
        .filter(|r| !r.is_empty())
        .collect();
    if out.is_empty() {
        out.push(DEFAULT_CIRCLE_RELAY.to_owned());
    }
    out
}

fn sanitize_attachment_filename(raw: &str) -> String {
    let base = raw
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("")
        .replace('\0', "")
        .trim()
        .to_owned();
    if base.len() > 160 {
        base.chars().take(160).collect()
    } else {
        base
    }
}

fn adaptive_poll_interval_ms(quiet_cycles: u32) -> u64 {
    match quiet_cycles {
        0 => POLL_ACTIVE_MS,
        1 => POLL_WARM_MS,
        _ => POLL_QUIET_MS,
    }
}

#[derive(Deserialize)]
struct ExternalSignEnvelope {
    ok: Option<ExternalSignPayload>,
    err: Option<String>,
}

#[derive(Deserialize)]
struct ExternalSignPayload {
    event: Option<String>,
    signature: Option<String>,
}

fn parse_external_signed_event(
    expected_id: &str,
    pubkey_hex: &str,
    created_at: u64,
    kind: u16,
    tags: &[Vec<String>],
    content: &str,
    response_json: &str,
) -> Result<Event, String> {
    let envelope: ExternalSignEnvelope = serde_json::from_str(response_json)
        .map_err(|e| format!("Invalid external signer response: {e}"))?;
    if let Some(err) = envelope.err.filter(|s| !s.trim().is_empty()) {
        return Err(err);
    }
    let payload = envelope
        .ok
        .ok_or_else(|| "External signer returned an empty signing response".to_owned())?;

    let event = if let Some(raw_event) = payload
        .event
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Event::from_json(raw_event)
            .map_err(|e| format!("External signer returned invalid signed event JSON: {e}"))?
    } else if let Some(sig) = payload
        .signature
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let assembled = serde_json::json!({
            "id": expected_id,
            "pubkey": pubkey_hex,
            "created_at": created_at,
            "kind": kind,
            "tags": tags,
            "content": content,
            "sig": sig,
        });
        Event::from_json(assembled.to_string()).map_err(|e| {
            format!("External signer returned invalid signature for event: {e}")
        })?
    } else {
        return Err("External signer did not return a signed event or signature".to_owned());
    };

    event
        .verify()
        .map_err(|e| format!("External signer produced invalid Nostr signature: {e}"))?;
    Ok(event)
}

#[derive(Clone)]
struct ExternalDartCircleSigner {
    pubkey_hex: String,
    sign_fn: ExternalSignCallback,
}

impl NostrEventSigner for ExternalDartCircleSigner {
    fn pubkey_hex(&self) -> String {
        self.pubkey_hex.clone()
    }

    fn sign_event_template(
        &self,
        kind: u16,
        created_at: u64,
        tags: Vec<Vec<String>>,
        content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>
    {
        let pubkey_hex = self.pubkey_hex.clone();
        let sign_fn = Arc::clone(&self.sign_fn);
        Box::pin(async move {
            let expected_id =
                compute_nostr_event_id(&pubkey_hex, created_at, kind, &tags, &content)?;
            let unsigned_json = serde_json::json!({
                "id": expected_id,
                "pubkey": pubkey_hex,
                "created_at": created_at,
                "kind": kind,
                "tags": tags,
                "content": content,
            })
            .to_string();
            let response_json = (sign_fn)(unsigned_json).await;
            parse_external_signed_event(
                &expected_id,
                &pubkey_hex,
                created_at,
                kind,
                &tags,
                &content,
                &response_json,
            )
        })
    }
}

/// Registers an external Dart-backed Nostr event signer (such as Android Amber
/// NIP-55) so MLS Circles and Cordn ContextVM operations work seamlessly
/// without a local `nsec` or NIP-46 bunker.
pub fn register_external_circle_signer(
    pubkey_or_npub: String,
    sign_event: impl Fn(String) -> DartFnFuture<String> + Send + Sync + 'static,
) -> Result<String, String> {
    let pubkey_hex = normalize_pubkey_hex(&pubkey_or_npub)?;
    let mut guard = external_signer_lock()
        .write()
        .map_err(|_| "External circle signer lock poisoned".to_owned())?;
    *guard = Some(RegisteredExternalSigner {
        pubkey_hex: pubkey_hex.clone(),
        sign_fn: Arc::new(sign_event),
    });
    Ok(pubkey_hex)
}

/// Clears any registered external Dart-backed Circle signer.
pub fn clear_external_circle_signer() -> Result<(), String> {
    let mut guard = external_signer_lock()
        .write()
        .map_err(|_| "External circle signer lock poisoned".to_owned())?;
    *guard = None;
    Ok(())
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct CircleMediaAttachmentDto {
    pub url: String,
    pub mime_type: String,
    pub filename: String,
    pub sha256_hex: String,
    pub nonce_hex: String,
    pub version: String,
    pub dim: Option<String>,
    pub blurhash: Option<String>,
    pub alt: Option<String>,
    pub persistent_key_hex: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PreparedCircleMediaDto {
    pub encrypted_bytes: Vec<u8>,
    pub encrypted_sha256_hex: String,
    pub plaintext_sha256_hex: String,
    pub nonce_hex: String,
    pub mime_type: String,
    pub sanitized_filename: String,
    pub version: String,
    pub persistent_key_hex: Option<String>,
}

#[derive(Clone, Debug)]
pub struct CircleDatasetDto {
    pub workspace_id: String,
    pub envelope_id: String,
    pub dataset_id: String,
    pub title: String,
    pub pubkey: String,
    pub created_at: u64,
    pub geojson_json: String,
    pub feature_count: u32,
    pub media_attachments: Vec<CircleMediaAttachmentDto>,
    pub epoch: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CircleMessageDto {
    pub envelope_id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16,
    pub text: String,
    pub geojson_json: Option<String>,
    pub geometry_feature_count: u32,
    pub media_attachments: Vec<CircleMediaAttachmentDto>,
    pub epoch: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CircleProposalDto {
    pub workspace_id: String,
    pub envelope_id: String,
    pub proposal_id: String,
    pub target_dataset_id: String,
    pub target_author_pubkey: String,
    pub pubkey: String,
    pub created_at: u64,
    pub title: String,
    pub summary: String,
    pub geojson_json: String,
    pub feature_count: u32,
    pub status: String,
    pub status_note: Option<String>,
    pub status_updated_by: Option<String>,
    pub status_updated_at: Option<u64>,
    pub epoch: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CircleWorkspaceDto {
    pub workspace_id: String,
    pub group_id: String,
    pub name: String,
    pub description: Option<String>,
    pub recommended_basemap: Option<String>,
    pub role: String,
    pub status: String,
    pub cursor: u64,
    pub epoch: u64,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub members: Vec<String>,
    pub administrators: Vec<String>,
    pub datasets: Vec<CircleDatasetDto>,
    pub messages: Vec<CircleMessageDto>,
    pub proposals: Vec<CircleProposalDto>,
    pub created_at_ms: u64,
    pub sync_health: String,
    pub consecutive_decrypt_errors: u32,
    pub auto_approve_joins: bool,
    pub cordn_group_ref: String,
}

#[derive(Clone, Debug)]
pub struct CirclePendingJoinDto {
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub key_package_ref: String,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct CircleJoinRequestDto {
    pub workspace_id: String,
    pub pk: String,
    pub kp_ref: String,
    pub at: u64,
}

#[derive(Clone, Debug)]
pub struct CircleSnapshotDto {
    pub workspaces: Vec<CircleWorkspaceDto>,
    pub pending_joins: Vec<CirclePendingJoinDto>,
    pub default_cordn_pubkey: String,
}

#[derive(Clone, Debug)]
pub struct DecodedCircleInviteDto {
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub expires_at: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct DecodedCordnGroupRefDto {
    pub gid: String,
    pub relays: Vec<String>,
    pub coordinator_pubkey: Option<String>,
}

#[derive(Clone, Debug)]
pub struct MultiDeviceUploadBlobDto {
    /// `"group"` or `"meta"`.
    pub kind: String,
    /// Group ID (`gid`) for `"group"` blobs; `None` for `"meta"`.
    pub gid: Option<String>,
    /// Lowercase 64-char hex SHA-256 of `encrypted_bytes` (Blossom `x` hash).
    pub x_hex: String,
    /// UTF-8 bytes of the NIP-44 v2 sealed base64 document ready for Blossom `PUT /upload`.
    pub encrypted_bytes: Vec<u8>,
    /// Unix seconds timestamp embedded in the document (`issuedAt`).
    pub issued_at: u64,
}

#[derive(Clone, Debug)]
pub struct PreparedMultiDevicePublishDto {
    pub dek_hex: String,
    pub blossom_servers: Vec<String>,
    pub blobs: Vec<MultiDeviceUploadBlobDto>,
    /// Pre-assembled `MultiDeviceTipPayload` JSON using default `<blossom_server>/<x_hex>` URLs.
    pub default_tip_plaintext_json: String,
}

#[derive(Clone, Debug)]
pub struct FetchedMultiDeviceTipDto {
    pub event_id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub encrypted_content: String,
}

#[derive(Clone, Debug)]
pub struct MultiDeviceSyncSummaryDto {
    pub dek_hex: Option<String>,
    pub tip_event_id: Option<String>,
    pub tip_updated_at: Option<u64>,
    pub uploaded_blobs: u32,
    pub adopted_groups: u32,
    pub updated_groups: u32,
    pub merged_groups: u32,
    pub unchanged_groups: u32,
    pub removed_groups_marked: u32,
    pub skipped_errors: Vec<String>,
    pub workspaces: Vec<CircleWorkspaceDto>,
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

fn media_imeta_to_dto(m: EncryptedMediaImeta) -> CircleMediaAttachmentDto {
    CircleMediaAttachmentDto {
        url: m.url,
        mime_type: m.mime,
        filename: m.filename,
        sha256_hex: m.sha256_hex,
        nonce_hex: m.nonce_hex,
        version: m.version,
        dim: m.dim,
        blurhash: m.blurhash,
        alt: m.alt,
        persistent_key_hex: m.key_hex,
    }
}

fn workspace_dto_fingerprint(dto: &CircleWorkspaceDto) -> String {
    let mut hasher = Sha256::new();
    hasher.update(dto.workspace_id.as_bytes());
    hasher.update(b"|");
    hasher.update(dto.group_id.as_bytes());
    hasher.update(b"|");
    hasher.update(dto.name.as_bytes());
    hasher.update(b"|");
    hasher.update(dto.description.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(dto.recommended_basemap.as_deref().unwrap_or("").as_bytes());
    hasher.update(b"|");
    hasher.update(dto.role.as_bytes());
    hasher.update(b"|");
    hasher.update(dto.status.as_bytes());
    hasher.update(b"|");
    hasher.update(dto.cursor.to_le_bytes());
    hasher.update(dto.epoch.to_le_bytes());
    hasher.update(dto.sync_health.as_bytes());
    hasher.update(dto.consecutive_decrypt_errors.to_le_bytes());
    hasher.update([u8::from(dto.auto_approve_joins)]);
    hasher.update(dto.cordn_group_ref.as_bytes());
    for m in &dto.members {
        hasher.update(b"|m:");
        hasher.update(m.as_bytes());
    }
    for a in &dto.administrators {
        hasher.update(b"|a:");
        hasher.update(a.as_bytes());
    }
    for d in &dto.datasets {
        hasher.update(b"|d:");
        hasher.update(d.envelope_id.as_bytes());
        hasher.update(d.dataset_id.as_bytes());
        hasher.update(d.feature_count.to_le_bytes());
        hasher.update((d.media_attachments.len() as u64).to_le_bytes());
    }
    for msg in &dto.messages {
        hasher.update(b"|msg:");
        hasher.update(msg.envelope_id.as_bytes());
        hasher.update((msg.media_attachments.len() as u64).to_le_bytes());
    }
    for prop in &dto.proposals {
        hasher.update(b"|prop:");
        hasher.update(prop.envelope_id.as_bytes());
        hasher.update(prop.status.as_bytes());
        hasher.update(prop.status_updated_at.unwrap_or(0).to_le_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn workspace_to_dto(ws: &StoredWorkspace) -> CircleWorkspaceDto {
    let (epoch, members) = PrivateWorkspaceService::inspect_summary(ws)
        .unwrap_or_else(|_| (0, Vec::new()));

    let datasets = PrivateWorkspaceService::project_datasets(ws)
        .into_iter()
        .map(|d| CircleDatasetDto {
            workspace_id: d.workspace_id,
            envelope_id: d.envelope_id,
            dataset_id: d.dataset_id,
            title: d.title,
            pubkey: d.pubkey,
            created_at: d.created_at,
            geojson_json: d.geojson_json,
            feature_count: d.feature_count as u32,
            media_attachments: d
                .media_attachments
                .into_iter()
                .map(media_imeta_to_dto)
                .collect(),
            epoch: d.epoch,
        })
        .collect();

    let messages = PrivateWorkspaceService::project_messages(ws)
        .into_iter()
        .map(|m| CircleMessageDto {
            envelope_id: m.envelope_id,
            pubkey: m.pubkey,
            created_at: m.created_at,
            kind: m.kind,
            text: m.text,
            geojson_json: m.geojson_json,
            geometry_feature_count: m.geometry_feature_count as u32,
            media_attachments: m
                .media_attachments
                .into_iter()
                .map(media_imeta_to_dto)
                .collect(),
            epoch: m.epoch,
        })
        .collect();

    let proposals = PrivateWorkspaceService::project_proposals(ws)
        .into_iter()
        .map(|p| CircleProposalDto {
            workspace_id: p.workspace_id,
            envelope_id: p.envelope_id,
            proposal_id: p.proposal_id,
            target_dataset_id: p.target_dataset_id,
            target_author_pubkey: p.target_author_pubkey,
            pubkey: p.pubkey,
            created_at: p.created_at,
            title: p.title,
            summary: p.summary,
            geojson_json: p.geojson_json,
            feature_count: p.feature_count as u32,
            status: p.status,
            status_note: p.status_note,
            status_updated_by: p.status_updated_by,
            status_updated_at: p.status_updated_at,
            epoch: p.epoch,
        })
        .collect();

    let cordn_group_ref = encode_cordn_group_ref(&CordnGroupRef {
        gid: ws.group_id.clone(),
        relays: ws.relays.clone(),
        coordinator_pubkey: Some(ws.coordinator_pubkey.clone()),
    })
    .unwrap_or_default();

    CircleWorkspaceDto {
        workspace_id: ws.workspace_id.clone(),
        group_id: ws.group_id.clone(),
        name: ws
            .metadata
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Decrypting Circle…".to_owned()),
        description: ws.metadata.as_ref().and_then(|m| m.description.clone()),
        recommended_basemap: ws
            .metadata
            .as_ref()
            .and_then(|m| m.recommended_basemap.clone()),
        role: ws.role.clone(),
        status: ws.status.clone(),
        cursor: ws.cursor,
        epoch,
        coordinator_pubkey: ws.coordinator_pubkey.clone(),
        relays: ws.relays.clone(),
        members,
        administrators: PrivateWorkspaceService::administrators(ws),
        datasets,
        messages,
        proposals,
        created_at_ms: ws.created_at_ms,
        sync_health: ws.sync_health.clone(),
        consecutive_decrypt_errors: ws.consecutive_decrypt_errors,
        auto_approve_joins: ws.auto_approve_joins,
        cordn_group_ref,
    }
}

async fn resolve_signer(
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
) -> Result<Arc<dyn NostrEventSigner>, String> {
    if let Some(nsec) = signer_nsec.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(Arc::new(LocalKeysSigner::from_nsec_or_hex(nsec)?));
    }
    if let (Some(uri), Some(client)) = (
        bunker_uri.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        bunker_client_nsec
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    ) {
        let signer = Nip46CircleSigner::connect(uri.to_owned(), client.to_owned()).await?;
        return Ok(Arc::new(signer));
    }
    if let Ok(guard) = external_signer_lock().read() {
        if let Some(entry) = guard.as_ref() {
            return Ok(Arc::new(ExternalDartCircleSigner {
                pubkey_hex: entry.pubkey_hex.clone(),
                sign_fn: Arc::clone(&entry.sign_fn),
            }));
        }
    }
    Err(
        "MLS Groups require a signing account (Amber NIP-55, NIP-46 remote bunker, or local keypair — open Account to sign in)"
            .to_owned(),
    )
}

async fn fetch_http_bytes_capped(
    client: &reqwest::Client,
    url: &str,
    max_bytes: usize,
) -> Result<Vec<u8>, String> {
    let trimmed = url.trim();
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return Err(format!("Unsupported media URL scheme: {trimmed}"));
    }
    let mut resp = client
        .get(trimmed)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch encrypted blob from {trimmed}: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Encrypted blob fetch failed ({status}) for {trimmed}"));
    }
    if let Some(len) = resp.content_length() {
        if len as usize > max_bytes {
            return Err(format!(
                "Encrypted blob exceeds {} MiB limit ({} bytes)",
                max_bytes / (1024 * 1024),
                len
            ));
        }
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Failed while reading encrypted blob from {trimmed}: {e}"))?
    {
        if buf.len().saturating_add(chunk.len()) > max_bytes {
            return Err(format!(
                "Encrypted blob exceeds {} MiB safety limit",
                max_bytes / (1024 * 1024)
            ));
        }
        buf.extend_from_slice(&chunk);
    }
    if buf.is_empty() {
        return Err(format!("Downloaded encrypted blob from {trimmed} is empty"));
    }
    Ok(buf)
}

fn decrypt_circle_media_ciphertext(
    ws: &StoredWorkspace,
    ciphertext: &[u8],
    imeta: &EncryptedMediaImeta,
    message_epoch: Option<u64>,
) -> Result<Vec<u8>, String> {
    if imeta.version == EARTHLY_PERSISTENT_MEDIA_VERSION {
        return decrypt_media_attachment(ciphertext, imeta, None);
    }
    if imeta.version != CORDN_ENCRYPTED_MEDIA_VERSION {
        return Err(format!("Unsupported encrypted media version: {}", imeta.version));
    }

    // 1. Exact message epoch key if caller provided it.
    if let Some(ep) = message_epoch {
        if let Some(key) = PrivateWorkspaceService::media_key_for_epoch(ws, ep) {
            if let Ok(plain) = decrypt_media_attachment(ciphertext, imeta, Some(&key)) {
                return Ok(plain);
            }
        }
    }

    // 2. Try current epoch media key first.
    let mut tried_epochs = HashSet::new();
    if let Ok((cur_epoch, cur_key)) = PrivateWorkspaceService::current_media_key(ws) {
        tried_epochs.insert(cur_epoch);
        if let Ok(plain) = decrypt_media_attachment(ciphertext, imeta, Some(&cur_key)) {
            return Ok(plain);
        }
    }

    // 3. Fall back across retained historical epoch media keys (newest first).
    for (&ep, hex_key) in ws.epoch_media_keys.iter().rev() {
        if !tried_epochs.insert(ep) {
            continue;
        }
        if let Ok(key) = decode_hex_32(hex_key, "epoch media key") {
            if let Ok(plain) = decrypt_media_attachment(ciphertext, imeta, Some(&key)) {
                return Ok(plain);
            }
        }
    }

    Err(
        "Unable to decrypt cordn-em-v1 media attachment with any retained MLS epoch key"
            .to_owned(),
    )
}

fn sign_blossom_upload_auth_local(
    keys: &Keys,
    sha256_hex_str: &str,
    message: &str,
) -> Result<Event, String> {
    let unsigned_json = prepare_unsigned_blossom_upload_auth(
        keys.public_key().to_hex(),
        sha256_hex_str.to_owned(),
        Some(message.to_owned()),
    )?;
    let val: serde_json::Value = serde_json::from_str(&unsigned_json)
        .map_err(|e| format!("Failed to parse unsigned Blossom auth JSON: {e}"))?;
    let kind = val
        .get("kind")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Missing kind in unsigned Blossom auth".to_owned())? as u16;
    let created_at = val
        .get("created_at")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Missing created_at in unsigned Blossom auth".to_owned())?;
    let content = val
        .get("content")
        .and_then(|v| v.as_str())
        .unwrap_or(message)
        .to_owned();
    let raw_tags: Vec<Vec<String>> = val
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|row| {
                    row.as_array().map(|items| {
                        items
                            .iter()
                            .filter_map(|s| s.as_str().map(ToOwned::to_owned))
                            .collect()
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let parsed_tags = parse_nostr_tags(&raw_tags)?;
    EventBuilder::new(Kind::Custom(kind), content)
        .tags(parsed_tags)
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(keys)
        .map_err(|e| format!("Failed to sign Blossom upload auth event: {e}"))
}

async fn publish_event_to_relays(event: &Event, relay_urls: &[String]) -> Result<(), String> {
    let client = crate::api::relay_pool::shared_client(relay_urls).await?;
    let _ = client.database().save_event(event).await;

    let mut acknowledged = 0usize;
    let mut last_err: Option<String> = None;
    for relay_url in relay_urls {
        match tokio::time::timeout(
            Duration::from_secs(8),
            client.send_event_to([relay_url.as_str()], event),
        )
        .await
        {
            Ok(Ok(output)) if !output.success.is_empty() => {
                acknowledged += 1;
            }
            Ok(Ok(output)) => {
                if let Some((_, reason)) = output.failed.into_iter().next() {
                    last_err = Some(reason);
                } else {
                    last_err = Some(format!("Relay {relay_url} did not acknowledge event"));
                }
            }
            Ok(Err(err)) => {
                last_err = Some(err.to_string());
            }
            Err(_) => {
                last_err = Some(format!("Publish to {relay_url} timed out"));
            }
        }
    }

    if acknowledged == 0 {
        return Err(last_err.unwrap_or_else(|| {
            "No Nostr relays acknowledged the multi-device tip event".to_owned()
        }));
    }
    Ok(())
}

async fn fetch_sealed_multi_device_blob(
    client: &reqwest::Client,
    pointer: &MultiDeviceDocPointer,
    fallback_servers: &[String],
) -> Result<String, String> {
    let mut candidates: Vec<String> = Vec::new();
    for url in &pointer.urls {
        let trimmed = url.trim();
        if !trimmed.is_empty() && !candidates.iter().any(|u| u == trimmed) {
            candidates.push(trimmed.to_owned());
        }
    }
    for server in fallback_servers {
        let base = server.trim().trim_end_matches('/');
        if base.starts_with("https://") || base.starts_with("http://") {
            let derived = format!("{base}/{}", pointer.x);
            if !candidates.iter().any(|u| u == &derived) {
                candidates.push(derived);
            }
        }
    }
    if candidates.is_empty() {
        return Err(format!(
            "No Blossom download URL available for multi-device blob {}",
            pointer.x
        ));
    }

    let mut last_err = String::new();
    for url in candidates {
        match fetch_http_bytes_capped(client, &url, MAX_ENCRYPTED_MEDIA_BYTES).await {
            Ok(bytes) => {
                let actual_x = sha256_hex(&bytes);
                if actual_x != pointer.x {
                    last_err = format!(
                        "Multi-device blob hash mismatch from {url}: expected {}, got {actual_x}",
                        pointer.x
                    );
                    continue;
                }
                return String::from_utf8(bytes).map_err(|_| {
                    format!("Multi-device sealed blob from {url} is not valid UTF-8")
                });
            }
            Err(err) => {
                last_err = err;
            }
        }
    }
    Err(last_err)
}

// ---------------------------------------------------------------------------
// Public FFI — Basics & Invites
// ---------------------------------------------------------------------------

pub fn default_cordn_coordinator_pubkey() -> String {
    DEFAULT_CORDN_SERVER_PUBKEY.to_owned()
}

pub fn decode_circle_invite_link(raw_link: String) -> Result<DecodedCircleInviteDto, String> {
    let inv = decode_private_map_invitation(&raw_link)?;
    Ok(DecodedCircleInviteDto {
        workspace_id: inv.workspace_id,
        group_id: inv.group_id,
        admin_pubkey: inv.admin_pubkey,
        coordinator_pubkey: inv.coordinator_pubkey,
        relays: inv.relays,
        expires_at: inv.expires_at,
    })
}

pub fn decode_cordn_group_ref_link(raw_link: String) -> Result<DecodedCordnGroupRefDto, String> {
    let decoded = decode_cordn_group_ref(&raw_link)?;
    Ok(DecodedCordnGroupRefDto {
        gid: decoded.gid,
        relays: decoded.relays,
        coordinator_pubkey: decoded.coordinator_pubkey,
    })
}

pub fn load_circles_snapshot(
    database_path: String,
    owner_pubkey_hex: String,
) -> Result<CircleSnapshotDto, String> {
    let normalized_owner =
        normalize_pubkey_hex(&owner_pubkey_hex).unwrap_or_else(|_| owner_pubkey_hex.trim().to_owned());
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let workspaces = store
        .list_workspaces(&normalized_owner)?
        .iter()
        .map(workspace_to_dto)
        .collect();
    let pending_joins = store
        .list_pending_joins(&normalized_owner)?
        .into_iter()
        .map(|p| CirclePendingJoinDto {
            workspace_id: p.workspace_id,
            group_id: p.group_id,
            admin_pubkey: p.admin_pubkey,
            coordinator_pubkey: p.coordinator_pubkey,
            relays: p.relays,
            key_package_ref: p.key_package_ref,
            created_at_ms: p.created_at_ms,
        })
        .collect();
    Ok(CircleSnapshotDto {
        workspaces,
        pending_joins,
        default_cordn_pubkey: DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
    })
}

// ---------------------------------------------------------------------------
// Public FFI — Read-Only Sync & Unified Live Stream (ZERO Amber Prompts)
// ---------------------------------------------------------------------------

/// Syncs a single Circle workspace using an ephemeral delivery key ONLY (zero user signer calls).
pub async fn sync_circle_workspace_readonly(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
) -> Result<CircleWorkspaceDto, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let ws =
        PrivateWorkspaceService::sync_workspace_readonly(store, &normalized_owner, &workspace_id)
            .await?;
    Ok(workspace_to_dto(&ws))
}

/// Batched read-only sync across ALL active Circles for `owner_pubkey_hex` using Cordn v0.5
/// `msg_fetch_many` (with automatic v0.4 fallback) and ZERO user signer calls.
pub async fn sync_all_circle_workspaces_readonly(
    database_path: String,
    owner_pubkey_hex: String,
) -> Result<Vec<CircleWorkspaceDto>, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let workspaces =
        PrivateWorkspaceService::sync_all_workspaces_readonly(store, &normalized_owner).await?;
    Ok(workspaces.iter().map(workspace_to_dto).collect())
}

enum CircleStreamEvent {
    Message(CoordinatorMessage),
    Closed(CordnPoolKey),
}

struct ActiveEndpointStream {
    group_ids: BTreeSet<String>,
    handle: tokio::task::JoinHandle<()>,
}

struct ActiveStreamsGuard {
    streams: HashMap<CordnPoolKey, ActiveEndpointStream>,
}

impl ActiveStreamsGuard {
    fn new() -> Self {
        Self {
            streams: HashMap::new(),
        }
    }

    fn abort_all(&mut self) {
        for (_, entry) in self.streams.drain() {
            entry.handle.abort();
        }
    }
}

impl Drop for ActiveStreamsGuard {
    fn drop(&mut self) {
        self.abort_all();
    }
}

/// Unified real-time Circle update stream (`StreamSink<CircleWorkspaceDto>`) with ZERO Amber prompts.
///
/// - Groups active SQLite workspaces by `(coordinator_pubkey, relays)` and attempts Cordn v0.5
///   live push streaming (`msg_sub_many`), ingesting each arrived frame via
///   `PrivateWorkspaceService::ingest_streamed_message` and emitting updated DTOs immediately.
/// - Whenever a coordinator returns `UnsupportedStreaming` (e.g. Cordn v0.4) or encounters a
///   transient streaming error, falls back seamlessly to fast adaptive pooled polling
///   (`1500ms` active -> `3000ms` -> `5000ms` quiet, resetting to `1500ms` on any change) and
///   re-checks SQLite every cycle for newly joined/created workspaces.
/// - Stops cleanly as soon as `sink.add(...)` fails or the Dart stream is cancelled.
pub async fn stream_circle_updates(
    database_path: String,
    owner_pubkey_hex: String,
    sink: crate::frb_generated::StreamSink<CircleWorkspaceDto>,
) -> Result<(), String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);

    // Seed last-emitted fingerprints from initial local SQLite state so we emit strictly on change
    // or when new workspaces appear.
    let mut last_fingerprints: HashMap<String, String> = HashMap::new();
    if let Ok(initial) = store.list_workspaces(&normalized_owner) {
        for ws in &initial {
            let dto = workspace_to_dto(ws);
            last_fingerprints.insert(ws.workspace_id.clone(), workspace_dto_fingerprint(&dto));
        }
    }

    let (event_tx, mut event_rx) = mpsc::channel::<CircleStreamEvent>(256);
    let mut active_streams = ActiveStreamsGuard::new();
    let mut unsupported_endpoints: HashSet<CordnPoolKey> = HashSet::new();
    let mut stream_backoff_until: HashMap<CordnPoolKey, tokio::time::Instant> = HashMap::new();
    let mut quiet_cycles: u32 = 0;

    loop {
        let workspaces = match store.list_workspaces(&normalized_owner) {
            Ok(list) => list,
            Err(_) => {
                tokio::time::sleep(Duration::from_millis(POLL_QUIET_MS)).await;
                continue;
            }
        };

        let mut active_by_endpoint: HashMap<CordnPoolKey, Vec<StoredWorkspace>> = HashMap::new();
        let mut gid_to_ws_id: HashMap<String, String> = HashMap::new();
        let mut active_count = 0usize;

        for ws in workspaces {
            if ws.status == "removed" {
                continue;
            }
            active_count += 1;
            gid_to_ws_id.insert(ws.group_id.clone(), ws.workspace_id.clone());
            let key = canonical_cordn_pool_key(&ws.coordinator_pubkey, &ws.relays);
            active_by_endpoint.entry(key).or_default().push(ws);
        }

        // Tear down any active streams whose endpoint disappeared or whose group set changed.
        let keys_to_drop: Vec<CordnPoolKey> = active_streams
            .streams
            .iter()
            .filter_map(|(ep, entry)| {
                let Some(group_list) = active_by_endpoint.get(ep) else {
                    return Some(ep.clone());
                };
                let desired_gids: BTreeSet<String> =
                    group_list.iter().map(|w| w.group_id.clone()).collect();
                if desired_gids != entry.group_ids {
                    Some(ep.clone())
                } else {
                    None
                }
            })
            .collect();
        for key in keys_to_drop {
            if let Some(removed) = active_streams.streams.remove(&key) {
                removed.handle.abort();
            }
        }

        // Attempt Cordn v0.5 `msg_sub_many` for eligible endpoints not yet streaming.
        let now = tokio::time::Instant::now();
        for (endpoint, group_workspaces) in &active_by_endpoint {
            if active_streams.streams.contains_key(endpoint)
                || unsupported_endpoints.contains(endpoint)
            {
                continue;
            }
            if let Some(&retry_at) = stream_backoff_until.get(endpoint) {
                if now < retry_at {
                    continue;
                }
            }

            let queries: Vec<GroupCursorQuery> = group_workspaces
                .iter()
                .map(|ws| GroupCursorQuery {
                    gid: ws.group_id.clone(),
                    after: if ws.cursor > 0 { Some(ws.cursor) } else { None },
                })
                .collect();

            let Ok(client) = CordnCoordinatorClient::new_delivery_only(
                endpoint.0.clone(),
                endpoint.1.clone(),
                normalized_owner.clone(),
            ) else {
                continue;
            };

            match client.subscribe_many_messages(queries).await {
                Ok(mut rx) => {
                    stream_backoff_until.remove(endpoint);
                    let gids: BTreeSet<String> = group_workspaces
                        .iter()
                        .map(|w| w.group_id.clone())
                        .collect();
                    let tx_clone = event_tx.clone();
                    let ep_clone = endpoint.clone();
                    let handle = tokio::spawn(async move {
                        while let Some(msg) = rx.recv().await {
                            if tx_clone.send(CircleStreamEvent::Message(msg)).await.is_err() {
                                return;
                            }
                        }
                        let _ = tx_clone.send(CircleStreamEvent::Closed(ep_clone)).await;
                    });
                    active_streams
                        .streams
                        .insert(endpoint.clone(), ActiveEndpointStream { group_ids: gids, handle });
                }
                Err(CoordinatorStreamError::UnsupportedStreaming(_)) => {
                    unsupported_endpoints.insert(endpoint.clone());
                }
                Err(CoordinatorStreamError::Transport(_)) => {
                    stream_backoff_until.insert(
                        endpoint.clone(),
                        tokio::time::Instant::now()
                            + Duration::from_secs(STREAM_TRANSPORT_BACKOFF_SECS),
                    );
                }
            }
        }

        // Poll any workspaces not covered by an active live stream (or with pending journals).
        let mut non_streaming_ws_ids: Vec<String> = Vec::new();
        for (endpoint, group_workspaces) in &active_by_endpoint {
            let is_streaming = active_streams.streams.contains_key(endpoint);
            for ws in group_workspaces {
                let has_journal = ws.pending_application.is_some()
                    || ws.pending_membership_commit.is_some()
                    || ws
                        .pending_approval
                        .as_ref()
                        .map(|a| a.local_finalized)
                        .unwrap_or(false);
                if !is_streaming || has_journal {
                    non_streaming_ws_ids.push(ws.workspace_id.clone());
                }
            }
        }

        let mut any_change = false;
        if !non_streaming_ws_ids.is_empty() {
            let synced_list: Vec<StoredWorkspace> = if non_streaming_ws_ids.len() == active_count {
                PrivateWorkspaceService::sync_all_workspaces_readonly(
                    Arc::clone(&store),
                    &normalized_owner,
                )
                .await
                .unwrap_or_default()
            } else {
                let mut collected = Vec::with_capacity(non_streaming_ws_ids.len());
                for ws_id in &non_streaming_ws_ids {
                    if let Ok(updated) = PrivateWorkspaceService::sync_workspace_readonly(
                        Arc::clone(&store),
                        &normalized_owner,
                        ws_id,
                    )
                    .await
                    {
                        collected.push(updated);
                    }
                }
                collected
            };

            for ws in synced_list {
                let dto = workspace_to_dto(&ws);
                let fp = workspace_dto_fingerprint(&dto);
                let changed = last_fingerprints
                    .get(&ws.workspace_id)
                    .map(|prev| prev != &fp)
                    .unwrap_or(true);
                if changed {
                    last_fingerprints.insert(ws.workspace_id.clone(), fp);
                    any_change = true;
                    if sink.add(dto).is_err() {
                        active_streams.abort_all();
                        return Ok(());
                    }
                }
            }
        }

        if any_change {
            quiet_cycles = 0;
        } else {
            quiet_cycles = quiet_cycles.saturating_add(1);
        }

        let all_streaming = active_count > 0
            && !active_by_endpoint.is_empty()
            && active_by_endpoint
                .keys()
                .all(|ep| active_streams.streams.contains_key(ep));
        let wait_ms = if all_streaming {
            STREAM_MEMBERSHIP_CHECK_MS
        } else {
            adaptive_poll_interval_ms(quiet_cycles)
        };
        let deadline = tokio::time::Instant::now() + Duration::from_millis(wait_ms);

        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                break;
            }
            tokio::select! {
                _ = tokio::time::sleep(remaining) => {
                    break;
                }
                maybe_ev = event_rx.recv() => {
                    match maybe_ev {
                        Some(CircleStreamEvent::Message(msg)) => {
                            let ws_id = if let Some(id) = gid_to_ws_id.get(&msg.gid) {
                                Some(id.clone())
                            } else {
                                store
                                    .get_workspace_by_group_id(&normalized_owner, &msg.gid)
                                    .ok()
                                    .flatten()
                                    .map(|w| w.workspace_id)
                            };
                            if let Some(ws_id) = ws_id {
                                if let Ok(Some(updated)) = PrivateWorkspaceService::ingest_streamed_message(
                                    Arc::clone(&store),
                                    &normalized_owner,
                                    &ws_id,
                                    msg,
                                )
                                .await
                                {
                                    let dto = workspace_to_dto(&updated);
                                    let fp = workspace_dto_fingerprint(&dto);
                                    last_fingerprints.insert(updated.workspace_id.clone(), fp);
                                    quiet_cycles = 0;
                                    if sink.add(dto).is_err() {
                                        active_streams.abort_all();
                                        return Ok(());
                                    }
                                }
                            }
                        }
                        Some(CircleStreamEvent::Closed(endpoint)) => {
                            if let Some(removed) = active_streams.streams.remove(&endpoint) {
                                removed.handle.abort();
                            }
                            stream_backoff_until.insert(
                                endpoint,
                                tokio::time::Instant::now()
                                    + Duration::from_secs(STREAM_TRANSPORT_BACKOFF_SECS),
                            );
                            // Break immediately so the outer loop falls back to polling / reconnects.
                            break;
                        }
                        None => {
                            active_streams.abort_all();
                            return Ok(());
                        }
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Public FFI — Encrypted Media (`cordn-em-v1` + `earthly-pm-v1`)
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub fn prepare_circle_encrypted_media(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
    bytes: Vec<u8>,
    mime_type: String,
    filename: String,
    persistent_for_map: bool,
    strip_metadata: bool,
) -> Result<PreparedCircleMediaDto, String> {
    if bytes.is_empty() {
        return Err("Cannot encrypt an empty media payload".to_owned());
    }
    if bytes.len() > MAX_ENCRYPTED_MEDIA_BYTES {
        return Err("Media attachment exceeds 30 MiB size limit".to_owned());
    }

    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let mut ws = store
        .get_workspace(&normalized_owner, &workspace_id)?
        .ok_or_else(|| "Circle was not found in this device profile".to_owned())?;

    let mime = if mime_type.trim().is_empty() {
        "application/octet-stream".to_owned()
    } else {
        mime_type.trim().to_owned()
    };

    let plaintext = if strip_metadata {
        strip_image_metadata(&bytes, &mime)
    } else {
        bytes
    };

    let cleaned_name = sanitize_attachment_filename(&filename);
    let sanitized_filename = if strip_metadata || cleaned_name.is_empty() {
        randomize_attachment_filename(&mime)
    } else {
        cleaned_name
    };

    let blob = if persistent_for_map {
        encrypt_persistent_map_media(&plaintext, &mime, &sanitized_filename)?
    } else {
        let (epoch, key) = PrivateWorkspaceService::current_media_key(&ws)?;
        if !ws.epoch_media_keys.contains_key(&epoch) {
            ws.epoch_media_keys.insert(epoch, encode_hex_lower(&key));
            let _ = store.put_workspace(&ws);
        }
        encrypt_cordn_media(&plaintext, &key, &mime, &sanitized_filename)?
    };

    Ok(PreparedCircleMediaDto {
        encrypted_bytes: blob.ciphertext,
        encrypted_sha256_hex: blob.ciphertext_sha256_hex,
        plaintext_sha256_hex: blob.plaintext_sha256_hex,
        nonce_hex: blob.nonce_hex,
        mime_type: blob.mime,
        sanitized_filename: blob.filename,
        version: blob.version,
        persistent_key_hex: blob.key_hex,
    })
}

#[allow(clippy::too_many_arguments)]
pub fn build_circle_imeta_tag(
    url: String,
    mime_type: String,
    filename: String,
    sha256_hex: String,
    nonce_hex: String,
    version: String,
    dim: Option<String>,
    blurhash: Option<String>,
    alt: Option<String>,
    persistent_key_hex: Option<String>,
) -> Result<Vec<String>, String> {
    let imeta = EncryptedMediaImeta {
        url,
        mime: mime_type,
        filename,
        sha256_hex,
        nonce_hex,
        version,
        key_hex: persistent_key_hex,
        dim,
        blurhash,
        thumbhash: None,
        alt,
    };
    build_imeta_tag(&imeta)
}

#[allow(clippy::too_many_arguments)]
pub async fn download_and_decrypt_circle_media(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
    url: String,
    mime_type: String,
    filename: String,
    sha256_hex: String,
    nonce_hex: String,
    version: String,
    persistent_key_hex: Option<String>,
    message_epoch: Option<u64>,
) -> Result<Vec<u8>, String> {
    let imeta = EncryptedMediaImeta {
        url: url.clone(),
        mime: mime_type,
        filename,
        sha256_hex,
        nonce_hex,
        version: version.clone(),
        key_hex: persistent_key_hex,
        dim: None,
        blurhash: None,
        thumbhash: None,
        alt: None,
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_MEDIA_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;
    let ciphertext = fetch_http_bytes_capped(&client, &url, MAX_ENCRYPTED_MEDIA_BYTES).await?;

    if version == EARTHLY_PERSISTENT_MEDIA_VERSION {
        return decrypt_media_attachment(&ciphertext, &imeta, None);
    }

    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let ws = store
        .get_workspace(&normalized_owner, &workspace_id)?
        .ok_or_else(|| "Circle was not found in this device profile".to_owned())?;
    decrypt_circle_media_ciphertext(&ws, &ciphertext, &imeta, message_epoch)
}

// ---------------------------------------------------------------------------
// Public FFI — Auto-Approve & Sync Health Repair
// ---------------------------------------------------------------------------

/// Toggles automatic approval of incoming join requests on an admin's Circle (no signer prompt).
pub async fn set_circle_auto_approve(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
    enabled: bool,
) -> Result<CircleWorkspaceDto, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let readonly_signer: Arc<dyn NostrEventSigner> =
        Arc::new(ReadOnlyNostrSigner::new(normalized_owner)?);
    let svc = PrivateWorkspaceService::new(
        readonly_signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let ws = svc.set_auto_approve_joins(&workspace_id, enabled).await?;
    Ok(workspace_to_dto(&ws))
}

/// Polls pending join requests and auto-approves up to `MAX_AUTO_APPROVE_BATCH` when enabled.
pub async fn poll_and_auto_approve_circle_requests(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let res = svc
        .poll_and_auto_approve_join_requests(&workspace_id, MAX_AUTO_APPROVE_BATCH)
        .await?;
    Ok(workspace_to_dto(&res.workspace))
}

/// Resets transient decrypt-error/fork counters, clears stuck unfinalized journals, ensures the
/// current epoch media key is cached, and attempts a fresh read-only catch-up sync.
pub async fn repair_circle_sync_state(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
) -> Result<CircleWorkspaceDto, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let repaired = PrivateWorkspaceService::repair_workspace_sync_state_local(
        Arc::clone(&store),
        &normalized_owner,
        &workspace_id,
    )
    .await?;

    match tokio::time::timeout(
        Duration::from_secs(10),
        PrivateWorkspaceService::sync_workspace_readonly(store, &normalized_owner, &workspace_id),
    )
    .await
    {
        Ok(Ok(synced)) => Ok(workspace_to_dto(&synced)),
        _ => Ok(workspace_to_dto(&repaired)),
    }
}

// ---------------------------------------------------------------------------
// Public FFI — Multi-Device Blossom Sync (`kind 30078`, `d: "cordn-md-tip-v1"`)
// ---------------------------------------------------------------------------

/// Seals every active Circle Group document + Meta document with a 32-byte DEK via NIP-44 v2,
/// returning blobs ready for Blossom upload plus a pre-built tip JSON payload.
pub fn prepare_multi_device_publish(
    database_path: String,
    owner_pubkey_hex: String,
    blossom_server_url: String,
    existing_dek_hex: Option<String>,
) -> Result<PreparedMultiDevicePublishDto, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let blossom_base =
        normalize_http_base_url(&blossom_server_url, DEFAULT_BLOSSOM_SERVER_URL, "Blossom")?;
    let dek = match existing_dek_hex
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(hex_str) => decode_hex_32(hex_str, "existing_dek_hex")?,
        None => generate_multi_device_dek(),
    };
    let dek_hex = encode_hex_lower(&dek);

    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let workspaces = store.list_workspaces(&normalized_owner)?;
    let issued_at = now_secs();

    let mut blobs = Vec::new();
    let mut groups_map: BTreeMap<String, MultiDeviceDocPointer> = BTreeMap::new();
    let mut removed: Vec<MultiDeviceRemovedGroup> = Vec::new();

    for ws in &workspaces {
        if ws.status == "removed" {
            removed.push(MultiDeviceRemovedGroup {
                gid: ws.group_id.clone(),
                removed_at: issued_at,
            });
            continue;
        }
        let doc = build_group_document_from_workspace(ws, None, issued_at, true)?;
        let (sealed_b64, x_hex) = seal_group_document(&doc, &dek)?;
        groups_map.insert(
            ws.group_id.clone(),
            MultiDeviceDocPointer {
                x: x_hex.clone(),
                urls: vec![format!("{blossom_base}/{x_hex}")],
                issued_at,
            },
        );
        blobs.push(MultiDeviceUploadBlobDto {
            kind: "group".to_owned(),
            gid: Some(ws.group_id.clone()),
            x_hex,
            encrypted_bytes: sealed_b64.into_bytes(),
            issued_at,
        });
    }

    let meta_doc = MultiDeviceMetaDocument {
        schema_version: MULTI_DEVICE_SCHEMA_VERSION,
        doc_type: MULTI_DEVICE_DOC_TYPE_META.to_owned(),
        issued_at,
        removed,
        last_resort_key_package: None,
    };
    let (sealed_meta, meta_x) = seal_meta_document(&meta_doc, &dek)?;
    let meta_pointer = MultiDeviceDocPointer {
        x: meta_x.clone(),
        urls: vec![format!("{blossom_base}/{meta_x}")],
        issued_at,
    };
    blobs.push(MultiDeviceUploadBlobDto {
        kind: "meta".to_owned(),
        gid: None,
        x_hex: meta_x,
        encrypted_bytes: sealed_meta.into_bytes(),
        issued_at,
    });

    let tip = MultiDeviceTipPayload {
        schema_version: MULTI_DEVICE_SCHEMA_VERSION,
        dek_hex: dek_hex.clone(),
        blossom_servers: vec![blossom_base.clone()],
        groups: groups_map,
        meta: Some(meta_pointer),
        updated_at: issued_at,
    };
    let _ = validate_tip_payload(&tip)?;
    let default_tip_plaintext_json = serde_json::to_string(&tip)
        .map_err(|e| format!("Failed to encode multi-device tip JSON: {e}"))?;

    Ok(PreparedMultiDevicePublishDto {
        dek_hex,
        blossom_servers: vec![blossom_base],
        blobs,
        default_tip_plaintext_json,
    })
}

/// Builds a validated shared `MultiDeviceTipPayload` JSON string ready for NIP-44 self-encryption
/// (via local key, NIP-46 bunker, or Android Amber NIP-55 `nip44Encrypt`).
pub fn build_multi_device_tip_plaintext(
    dek_hex: String,
    blossom_servers: Vec<String>,
    group_pointers_json: String,
    meta_pointer_json: Option<String>,
) -> Result<String, String> {
    let groups: BTreeMap<String, MultiDeviceDocPointer> =
        serde_json::from_str(&group_pointers_json)
            .map_err(|e| format!("Invalid group_pointers_json: {e}"))?;
    let meta: Option<MultiDeviceDocPointer> = match meta_pointer_json
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(raw) => Some(
            serde_json::from_str(raw)
                .map_err(|e| format!("Invalid meta_pointer_json: {e}"))?,
        ),
        None => None,
    };

    let servers: Vec<String> = blossom_servers
        .into_iter()
        .map(|s| s.trim().trim_end_matches('/').to_owned())
        .filter(|s| !s.is_empty())
        .collect();

    let payload = MultiDeviceTipPayload {
        schema_version: MULTI_DEVICE_SCHEMA_VERSION,
        dek_hex: dek_hex.trim().to_ascii_lowercase(),
        blossom_servers: servers,
        groups,
        meta,
        updated_at: now_secs(),
    };
    let _ = validate_tip_payload(&payload)?;
    serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize multi-device tip JSON: {e}"))
}

/// Builds an unsigned `kind 30078` (`d: "cordn-md-tip-v1"`) event template JSON ready for
/// signing by Android Amber NIP-55, NIP-46 bunker, or a local key.
pub fn prepare_unsigned_multi_device_tip_event(
    owner_pubkey_hex: String,
    encrypted_tip_content: String,
) -> Result<String, String> {
    let pubkey_hex = normalize_pubkey_hex(&owner_pubkey_hex)?;
    if encrypted_tip_content.trim().is_empty() {
        return Err("Encrypted multi-device tip content cannot be empty".to_owned());
    }
    let (kind, created_at, tags, content) =
        build_tip_event_template(encrypted_tip_content, now_secs());
    let id = compute_nostr_event_id(&pubkey_hex, created_at, kind, &tags, &content)?;
    Ok(serde_json::json!({
        "id": id,
        "pubkey": pubkey_hex,
        "created_at": created_at,
        "kind": kind,
        "tags": tags,
        "content": content,
    })
    .to_string())
}

/// Verifies and publishes a signed `kind 30078` (`d: "cordn-md-tip-v1"`) tip event to Nostr relays.
pub async fn publish_signed_multi_device_tip_event(
    signed_event_json: String,
    relay_urls: Vec<String>,
) -> Result<String, String> {
    let event = Event::from_json(signed_event_json.trim())
        .map_err(|e| format!("Invalid signed multi-device tip event JSON: {e}"))?;
    event
        .verify()
        .map_err(|e| format!("Invalid multi-device tip event signature: {e}"))?;
    if event.kind != Kind::Custom(MULTI_DEVICE_TIP_KIND) {
        return Err("Signed event is not kind 30078".to_owned());
    }
    let has_d = event.tags.iter().any(|t| {
        let s = t.as_slice();
        s.len() >= 2 && s[0] == "d" && s[1] == MULTI_DEVICE_TIP_D_TAG
    });
    if !has_d {
        return Err("Signed tip event is missing d-tag `cordn-md-tip-v1`".to_owned());
    }
    let relays = normalize_relay_urls(relay_urls);
    publish_event_to_relays(&event, &relays).await?;
    Ok(event.id.to_hex())
}

/// One-shot end-to-end multi-device snapshot publish for local `nsec` users:
/// seals all Circles + Meta with a per-identity DEK, uploads blobs to Blossom with BUD-02 auth,
/// self-encrypts the tip via NIP-44 v2, signs `kind 30078`, and publishes to relays.
pub async fn publish_multi_device_snapshot_direct(
    database_path: String,
    signer_nsec: String,
    blossom_server_url: String,
    relay_urls: Vec<String>,
) -> Result<MultiDeviceSyncSummaryDto, String> {
    let signer = LocalKeysSigner::from_nsec_or_hex(&signer_nsec)?;
    let keys = signer.keys().clone();
    let owner_pubkey = signer.pubkey_hex();
    let blossom_base =
        normalize_http_base_url(&blossom_server_url, DEFAULT_BLOSSOM_SERVER_URL, "Blossom")?;
    let relays = normalize_relay_urls(relay_urls);

    // Best-effort reuse of an existing per-identity DEK if a prior tip is already accessible.
    let existing_dek_hex = match tokio::time::timeout(
        Duration::from_secs(4),
        fetch_multi_device_tip_event(owner_pubkey.clone(), relays.clone()),
    )
    .await
    {
        Ok(Ok(Some(fetched))) => {
            unseal_tip_payload_for_self(keys.secret_key(), &fetched.encrypted_content)
                .ok()
                .map(|tip| tip.dek_hex)
        }
        _ => None,
    };

    let prepared = prepare_multi_device_publish(
        database_path.clone(),
        owner_pubkey.clone(),
        blossom_base.clone(),
        existing_dek_hex,
    )?;

    let mut groups_map: BTreeMap<String, MultiDeviceDocPointer> = BTreeMap::new();
    let mut meta_ptr: Option<MultiDeviceDocPointer> = None;
    let mut uploaded_blobs: u32 = 0;

    for blob in prepared.blobs {
        let auth_ev = sign_blossom_upload_auth_local(
            &keys,
            &blob.x_hex,
            "Upload encrypted Circle sync snapshot",
        )?;
        let uploaded = upload_blob_to_blossom(
            blossom_base.clone(),
            blob.encrypted_bytes,
            "text/plain".to_owned(),
            auth_ev.as_json(),
        )
        .await?;
        let mut urls = vec![uploaded.url];
        let canonical_url = format!("{blossom_base}/{}", blob.x_hex);
        if !urls.iter().any(|u| u == &canonical_url) {
            urls.push(canonical_url);
        }
        let ptr = MultiDeviceDocPointer {
            x: blob.x_hex,
            urls,
            issued_at: blob.issued_at,
        };
        if blob.kind == "group" {
            if let Some(gid) = blob.gid {
                groups_map.insert(gid, ptr);
            }
        } else if blob.kind == "meta" {
            meta_ptr = Some(ptr);
        }
        uploaded_blobs = uploaded_blobs.saturating_add(1);
    }

    let updated_at = now_secs();
    let tip = MultiDeviceTipPayload {
        schema_version: MULTI_DEVICE_SCHEMA_VERSION,
        dek_hex: prepared.dek_hex.clone(),
        blossom_servers: vec![blossom_base],
        groups: groups_map,
        meta: meta_ptr,
        updated_at,
    };
    let tip_event = build_signed_tip_event(&keys, &tip, updated_at)?;
    publish_event_to_relays(&tip_event, &relays).await?;

    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let workspaces = store
        .list_workspaces(&owner_pubkey)?
        .iter()
        .map(workspace_to_dto)
        .collect();

    Ok(MultiDeviceSyncSummaryDto {
        dek_hex: Some(prepared.dek_hex),
        tip_event_id: Some(tip_event.id.to_hex()),
        tip_updated_at: Some(updated_at),
        uploaded_blobs,
        adopted_groups: 0,
        updated_groups: 0,
        merged_groups: 0,
        unchanged_groups: 0,
        removed_groups_marked: 0,
        skipped_errors: Vec::new(),
        workspaces,
    })
}

/// Fetches the latest `kind 30078` (`d: "cordn-md-tip-v1"`) multi-device tip event for
/// `owner_pubkey_hex` from Nostr relays (with local LMDB cache fallback).
pub async fn fetch_multi_device_tip_event(
    owner_pubkey_hex: String,
    relay_urls: Vec<String>,
) -> Result<Option<FetchedMultiDeviceTipDto>, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let pk = PublicKey::from_hex(&normalized_owner)
        .map_err(|e| format!("Invalid owner pubkey hex: {e}"))?;
    let relays = normalize_relay_urls(relay_urls);
    let client = crate::api::relay_pool::shared_client(&relays).await?;

    let filter = Filter::new()
        .kind(Kind::Custom(MULTI_DEVICE_TIP_KIND))
        .author(pk)
        .identifier(MULTI_DEVICE_TIP_D_TAG)
        .limit(10);

    let mut events: Vec<Event> = Vec::new();
    let mut relay_err: Option<String> = None;
    match client
        .fetch_events_from(&relays, filter.clone(), Duration::from_secs(9))
        .await
    {
        Ok(set) => events.extend(set.into_iter()),
        Err(err) => relay_err = Some(err.to_string()),
    }

    if events.is_empty() {
        if let Ok(cached) = client.database().query(filter).await {
            events.extend(cached.into_iter());
        }
    }

    let latest = events
        .into_iter()
        .filter(|ev| {
            ev.pubkey == pk
                && ev.kind == Kind::Custom(MULTI_DEVICE_TIP_KIND)
                && ev.tags.iter().any(|t| {
                    let s = t.as_slice();
                    s.len() >= 2 && s[0] == "d" && s[1] == MULTI_DEVICE_TIP_D_TAG
                })
                && ev.verify().is_ok()
        })
        .max_by(|a, b| {
            a.created_at
                .cmp(&b.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });

    if latest.is_none() {
        if let Some(err) = relay_err {
            return Err(format!(
                "Failed to fetch multi-device tip event from relays: {err}"
            ));
        }
    }

    Ok(latest.map(|ev| FetchedMultiDeviceTipDto {
        event_id: ev.id.to_hex(),
        pubkey: ev.pubkey.to_hex(),
        created_at: ev.created_at.as_secs(),
        encrypted_content: ev.content,
    }))
}

/// Applies an already NIP-44-decrypted multi-device tip JSON (e.g. decrypted in Dart via
/// Android Amber NIP-55 or NIP-46): downloads every referenced sealed blob from Blossom,
/// unseals with `tip.dek_hex`, applies removed tombstones, and reconciles all Group documents
/// into SQLite.
pub async fn apply_decrypted_multi_device_tip(
    database_path: String,
    owner_pubkey_hex: String,
    tip_plaintext_json: String,
) -> Result<MultiDeviceSyncSummaryDto, String> {
    let normalized_owner = normalize_pubkey_hex(&owner_pubkey_hex)?;
    let tip: MultiDeviceTipPayload = serde_json::from_str(tip_plaintext_json.trim())
        .map_err(|e| format!("Invalid decrypted multi-device tip JSON: {e}"))?;
    let dek = validate_tip_payload(&tip)?;

    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_MEDIA_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {e}"))?;

    let mut adopted_groups: u32 = 0;
    let mut updated_groups: u32 = 0;
    let mut merged_groups: u32 = 0;
    let mut unchanged_groups: u32 = 0;
    let mut removed_groups_marked: u32 = 0;
    let mut skipped_errors: Vec<String> = Vec::new();
    let mut removed_gids: HashSet<String> = HashSet::new();

    if let Some(meta_ptr) = &tip.meta {
        match fetch_sealed_multi_device_blob(&http, meta_ptr, &tip.blossom_servers).await {
            Ok(sealed_meta) => match unseal_meta_document(&sealed_meta, &dek) {
                Ok(meta_doc) => {
                    for entry in meta_doc.removed {
                        removed_gids.insert(entry.gid.clone());
                        if let Ok(Some(existing)) =
                            store.get_workspace_by_group_id(&normalized_owner, &entry.gid)
                        {
                            if existing.status != "removed" {
                                let lock = workspace_mutex(&normalized_owner, &existing.workspace_id);
                                let _guard = lock.lock().await;
                                if let Ok(Some(mut ws)) = store
                                    .get_workspace(&normalized_owner, &existing.workspace_id)
                                {
                                    if ws.status != "removed" {
                                        ws.status = "removed".to_owned();
                                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                                        if store.put_workspace(&ws).is_ok() {
                                            removed_groups_marked =
                                                removed_groups_marked.saturating_add(1);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                Err(err) => skipped_errors.push(format!("meta unseal failed: {err}")),
            },
            Err(err) => skipped_errors.push(format!("meta fetch failed: {err}")),
        }
    }

    for (gid, group_ptr) in &tip.groups {
        if removed_gids.contains(gid) {
            continue;
        }
        let sealed = match fetch_sealed_multi_device_blob(&http, group_ptr, &tip.blossom_servers)
            .await
        {
            Ok(s) => s,
            Err(err) => {
                skipped_errors.push(format!("{gid}: fetch failed: {err}"));
                continue;
            }
        };
        let doc = match unseal_group_document(&sealed, &dek) {
            Ok(d) => d,
            Err(err) => {
                skipped_errors.push(format!("{gid}: unseal failed: {err}"));
                continue;
            }
        };
        if doc.gid != *gid {
            skipped_errors.push(format!(
                "{gid}: document gid mismatch (found {})",
                doc.gid
            ));
            continue;
        }
        match reconcile_remote_group_document_locked(&store, &normalized_owner, &doc).await {
            Ok(res) => match res.outcome {
                ReconcileOutcome::AdoptedNew => {
                    adopted_groups = adopted_groups.saturating_add(1);
                }
                ReconcileOutcome::UpdatedExisting => {
                    updated_groups = updated_groups.saturating_add(1);
                }
                ReconcileOutcome::MergedMetadataOnly => {
                    merged_groups = merged_groups.saturating_add(1);
                }
                ReconcileOutcome::AlreadyUpToDate => {
                    unchanged_groups = unchanged_groups.saturating_add(1);
                }
            },
            Err(err) => skipped_errors.push(format!("{gid}: reconcile failed: {err}")),
        }
    }

    let workspaces = store
        .list_workspaces(&normalized_owner)?
        .iter()
        .map(workspace_to_dto)
        .collect();

    Ok(MultiDeviceSyncSummaryDto {
        dek_hex: Some(tip.dek_hex),
        tip_event_id: None,
        tip_updated_at: Some(tip.updated_at),
        uploaded_blobs: 0,
        adopted_groups,
        updated_groups,
        merged_groups,
        unchanged_groups,
        removed_groups_marked,
        skipped_errors,
        workspaces,
    })
}

/// One-shot multi-device sync for local `nsec` users: fetches the latest `kind 30078` tip event,
/// decrypts it with NIP-44 v2, downloads sealed Blossom blobs, unseals with the DEK, and
/// reconciles all Group & Meta documents into SQLite.
pub async fn sync_multi_device_direct(
    database_path: String,
    signer_nsec: String,
    relay_urls: Vec<String>,
) -> Result<MultiDeviceSyncSummaryDto, String> {
    let signer = LocalKeysSigner::from_nsec_or_hex(&signer_nsec)?;
    let keys = signer.keys().clone();
    let owner_pubkey = signer.pubkey_hex();

    let Some(fetched) = fetch_multi_device_tip_event(owner_pubkey.clone(), relay_urls).await?
    else {
        let store = SqlitePrivateWorkspaceStore::open(database_path)?;
        let workspaces = store
            .list_workspaces(&owner_pubkey)?
            .iter()
            .map(workspace_to_dto)
            .collect();
        return Ok(MultiDeviceSyncSummaryDto {
            dek_hex: None,
            tip_event_id: None,
            tip_updated_at: None,
            uploaded_blobs: 0,
            adopted_groups: 0,
            updated_groups: 0,
            merged_groups: 0,
            unchanged_groups: 0,
            removed_groups_marked: 0,
            skipped_errors: Vec::new(),
            workspaces,
        });
    };

    let tip = unseal_tip_payload_for_self(keys.secret_key(), &fetched.encrypted_content)?;
    let tip_json = serde_json::to_string(&tip)
        .map_err(|e| format!("Failed to encode decrypted tip payload: {e}"))?;
    let mut summary =
        apply_decrypted_multi_device_tip(database_path, owner_pubkey, tip_json).await?;
    summary.tip_event_id = Some(fetched.event_id);
    Ok(summary)
}

// ---------------------------------------------------------------------------
// Public FFI — Circle Lifecycle, Messaging & Membership
// ---------------------------------------------------------------------------

#[allow(clippy::too_many_arguments)]
pub async fn create_circle_workspace(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    coordinator_pubkey: String,
    relays: Vec<String>,
    name: String,
    description: Option<String>,
    recommended_basemap: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let coord_pk = if coordinator_pubkey.trim().is_empty() {
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned()
    } else {
        coordinator_pubkey.trim().to_owned()
    };
    let relays = normalize_relay_urls(relays);
    let svc = PrivateWorkspaceService::new(signer, store, coord_pk, relays);
    let ws = svc.create_workspace(WorkspaceMetadata {
        name,
        description,
        recommended_basemap,
    })?;
    Ok(workspace_to_dto(&ws))
}

pub async fn create_circle_invite_url(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<String, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    svc.create_invitation_url(&workspace_id).await
}

pub async fn request_join_circle(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    raw_invitation: String,
) -> Result<CirclePendingJoinDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let p = svc.request_to_join(&raw_invitation).await?;
    Ok(CirclePendingJoinDto {
        workspace_id: p.workspace_id,
        group_id: p.group_id,
        admin_pubkey: p.admin_pubkey,
        coordinator_pubkey: p.coordinator_pubkey,
        relays: p.relays,
        key_package_ref: p.key_package_ref,
        created_at_ms: p.created_at_ms,
    })
}

pub async fn accept_circle_welcomes(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
) -> Result<Vec<CircleWorkspaceDto>, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let joined = svc.accept_pending_welcomes().await?;
    Ok(joined.iter().map(workspace_to_dto).collect())
}

pub async fn fetch_circle_join_requests(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<Vec<CircleJoinRequestDto>, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let list = svc.fetch_join_requests(&workspace_id).await?;
    Ok(list
        .into_iter()
        .map(|r| CircleJoinRequestDto {
            workspace_id: workspace_id.clone(),
            pk: r.pk,
            kp_ref: r.kp_ref,
            at: r.at,
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn approve_circle_join_request(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    pk: String,
    kp_ref: String,
    at: u64,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let ws = svc
        .approve_join_request(&workspace_id, &PendingJoinRequest { pk, kp_ref, at })
        .await?;
    Ok(workspace_to_dto(&ws))
}

pub async fn sync_circle_workspace(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let ws = svc.sync_workspace(&workspace_id).await?;
    Ok(workspace_to_dto(&ws))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_comment(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    text: String,
    geojson_json: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    send_circle_comment_with_media(
        database_path,
        signer_nsec,
        bunker_uri,
        bunker_client_nsec,
        workspace_id,
        text,
        geojson_json,
        Vec::new(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_comment_with_media(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    text: String,
    geojson_json: Option<String>,
    imeta_tags: Vec<Vec<String>>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    svc.send_comment_with_media(&workspace_id, &text, geojson_json.as_deref(), imeta_tags)
        .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after send".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_dataset(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    geojson_json: String,
    dataset_id: Option<String>,
    name: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    send_circle_dataset_with_media(
        database_path,
        signer_nsec,
        bunker_uri,
        bunker_client_nsec,
        workspace_id,
        geojson_json,
        dataset_id,
        name,
        Vec::new(),
    )
    .await
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_dataset_with_media(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    geojson_json: String,
    dataset_id: Option<String>,
    name: Option<String>,
    imeta_tags: Vec<Vec<String>>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    svc.send_dataset_with_media(
        &workspace_id,
        &geojson_json,
        dataset_id.as_deref(),
        name.as_deref(),
        imeta_tags,
    )
    .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after dataset send".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_dataset_proposal(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    target_dataset_id: String,
    target_author_pubkey: String,
    geojson_json: String,
    name: Option<String>,
    summary: Option<String>,
    proposal_id: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    svc.send_dataset_proposal(
        &workspace_id,
        &target_dataset_id,
        &target_author_pubkey,
        &geojson_json,
        name.as_deref(),
        summary.as_deref(),
        proposal_id.as_deref(),
    )
    .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after proposal send".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

#[allow(clippy::too_many_arguments)]
pub async fn respond_circle_dataset_proposal(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    proposal_id: String,
    status_kind: u16,
    note: Option<String>,
    apply_updated_geojson: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    svc.respond_dataset_proposal(
        &workspace_id,
        &proposal_id,
        status_kind,
        note.as_deref(),
        apply_updated_geojson.as_deref(),
    )
    .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after proposal response".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

pub async fn remove_circle_member(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    member_pubkey: String,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let ws = svc.remove_member(&workspace_id, &member_pubkey).await?;
    Ok(workspace_to_dto(&ws))
}

pub async fn set_circle_administrator(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    member_pubkey: String,
    administrator: bool,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec![DEFAULT_CIRCLE_RELAY.to_owned()],
    );
    let ws = svc
        .set_administrator(&workspace_id, &member_pubkey, administrator)
        .await?;
    Ok(workspace_to_dto(&ws))
}

pub fn delete_circle_workspace(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
) -> Result<(), String> {
    let normalized_owner =
        normalize_pubkey_hex(&owner_pubkey_hex).unwrap_or_else(|_| owner_pubkey_hex.trim().to_owned());
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    store.delete_workspace(&normalized_owner, &workspace_id)
}

#[cfg(test)]
mod tests {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    use super::*;
    use earthly_mls::storage::{SkippedCoordinatorMessage, SYNC_HEALTH_FORKED, SYNC_HEALTH_HEALTHY};
    use nostr::nips::nip19::ToBech32;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    /// Spins up an ephemeral loopback HTTP server serving `path -> bytes` for offline tests.
    fn spawn_loopback_http_server(routes: HashMap<String, Vec<u8>>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind loopback http");
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let mut stream = stream;
                let mut req_buf = [0u8; 4096];
                let n = match stream.read(&mut req_buf) {
                    Ok(n) if n > 0 => n,
                    _ => continue,
                };
                let req_str = String::from_utf8_lossy(&req_buf[..n]);
                let path = req_str
                    .lines()
                    .next()
                    .and_then(|line| line.split_whitespace().nth(1))
                    .unwrap_or("/");
                if let Some(body) = routes.get(path) {
                    let header = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
                        body.len()
                    );
                    let _ = stream.write_all(header.as_bytes());
                    let _ = stream.write_all(body);
                } else {
                    let _ = stream.write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 9\r\nConnection: close\r\n\r\nnot found",
                    );
                }
                let _ = stream.flush();
            }
        });
        format!("http://127.0.0.1:{}", addr.port())
    }

    #[tokio::test]
    async fn external_circle_signer_signs_full_event_and_signature_only_responses() {
        let keys = Keys::generate();
        let npub = keys.public_key().to_bech32().expect("npub");
        let hex_pk = keys.public_key().to_hex();

        // 1. Full signed event response (Amber `returnType: "event"`)
        let keys_full = keys.clone();
        let registered = register_external_circle_signer(npub.clone(), move |unsigned_json| {
            let k = keys_full.clone();
            Box::pin(async move {
                let v: serde_json::Value = serde_json::from_str(&unsigned_json).unwrap();
                let kind = v["kind"].as_u64().unwrap() as u16;
                let created_at = v["created_at"].as_u64().unwrap();
                let content = v["content"].as_str().unwrap().to_owned();
                let tags: Vec<Tag> = v["tags"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|arr| {
                        let items: Vec<String> = arr
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|s| s.as_str().unwrap().to_owned())
                            .collect();
                        Tag::parse(items).unwrap()
                    })
                    .collect();
                let signed = EventBuilder::new(Kind::Custom(kind), content)
                    .tags(tags)
                    .custom_created_at(Timestamp::from(created_at))
                    .sign_with_keys(&k)
                    .unwrap();
                serde_json::json!({ "ok": { "event": signed.as_json() } }).to_string()
            })
        })
        .expect("register external signer");
        assert_eq!(registered, hex_pk);

        let signer = resolve_signer(None, None, None)
            .await
            .expect("resolve external signer");
        assert_eq!(signer.pubkey_hex(), hex_pk);
        let ev = signer
            .sign_event_template(
                27_523,
                1_760_000_000,
                vec![vec![
                    "t".to_owned(),
                    "earthly-private-workspace-authorization-v1".to_owned(),
                ]],
                "digest-hex".to_owned(),
            )
            .await
            .expect("sign via full event response");
        ev.verify().expect("valid signature");
        assert_eq!(ev.pubkey.to_hex(), hex_pk);

        // 2. Signature-only response (some NIP-55 ContentProviders return only `signature`)
        let keys_sig = keys.clone();
        register_external_circle_signer(hex_pk.clone(), move |unsigned_json| {
            let k = keys_sig.clone();
            Box::pin(async move {
                let v: serde_json::Value = serde_json::from_str(&unsigned_json).unwrap();
                let kind = v["kind"].as_u64().unwrap() as u16;
                let created_at = v["created_at"].as_u64().unwrap();
                let content = v["content"].as_str().unwrap().to_owned();
                let signed = EventBuilder::new(Kind::Custom(kind), content)
                    .custom_created_at(Timestamp::from(created_at))
                    .sign_with_keys(&k)
                    .unwrap();
                serde_json::json!({ "ok": { "signature": signed.sig.to_string() } }).to_string()
            })
        })
        .expect("register sig-only signer");

        let signer2 = resolve_signer(None, None, None).await.unwrap();
        let ev2 = signer2
            .sign_event_template(25_910, 1_760_000_005, vec![], "hello".to_owned())
            .await
            .expect("sign via signature-only response");
        ev2.verify().expect("valid sig-only event");

        // 3. Creating & loading workspace via npub normalization + verifying new DTO fields
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("mls.sqlite3").to_string_lossy().to_string();
        let created = create_circle_workspace(
            db.clone(),
            None,
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["wss://relay.earthly.city".to_owned()],
            "Amber Field Crew".to_owned(),
            None,
            None,
        )
        .await
        .expect("create workspace with external signer");
        assert_eq!(created.name, "Amber Field Crew");
        assert_eq!(created.sync_health, SYNC_HEALTH_HEALTHY);
        assert_eq!(created.consecutive_decrypt_errors, 0);
        assert!(!created.auto_approve_joins);
        assert!(created.cordn_group_ref.starts_with("cordn1"));

        let snap = load_circles_snapshot(db, npub).expect("load snapshot by npub");
        assert_eq!(snap.workspaces.len(), 1);
        assert_eq!(snap.workspaces[0].workspace_id, created.workspace_id);
        assert_eq!(snap.workspaces[0].cordn_group_ref, created.cordn_group_ref);

        clear_external_circle_signer().expect("clear external signer");
    }

    #[tokio::test]
    async fn readonly_sync_auto_approve_repair_and_cordn_group_ref_decode() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let npub = keys.public_key().to_bech32().unwrap();
        let hex_pk = keys.public_key().to_hex();

        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("circles.sqlite3").to_string_lossy().to_string();

        // Empty read-only batched sync works with npub and zero signer!
        let empty = sync_all_circle_workspaces_readonly(db.clone(), npub.clone())
            .await
            .expect("empty readonly sync");
        assert!(empty.is_empty());

        // Create a workspace using an unreachable loopback relay so offline repair returns quickly.
        let ws = create_circle_workspace(
            db.clone(),
            Some(nsec.clone()),
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["ws://127.0.0.1:9".to_owned()],
            "Alpine Survey".to_owned(),
            Some("High-elevation gauges".to_owned()),
            Some("OpenFreeMap Liberty".to_owned()),
        )
        .await
        .expect("create workspace");

        // Verify cordn1... group reference round-trip including URL fragment extraction.
        assert!(ws.cordn_group_ref.starts_with("cordn1"));
        let decoded = decode_cordn_group_ref_link(format!(
            "https://earthly.city/circle/{}#{}",
            ws.workspace_id, ws.cordn_group_ref
        ))
        .expect("decode cordn1 link");
        assert_eq!(decoded.gid, ws.group_id);
        assert_eq!(decoded.relays, vec!["ws://127.0.0.1:9".to_owned()]);
        assert_eq!(
            decoded.coordinator_pubkey.as_deref(),
            Some(DEFAULT_CORDN_SERVER_PUBKEY)
        );

        // Toggle auto-approve without any signer (npub accepted).
        let enabled = set_circle_auto_approve(db.clone(), npub.clone(), ws.workspace_id.clone(), true)
            .await
            .expect("enable auto-approve");
        assert!(enabled.auto_approve_joins);
        let disabled =
            set_circle_auto_approve(db.clone(), hex_pk.clone(), ws.workspace_id.clone(), false)
                .await
                .expect("disable auto-approve");
        assert!(!disabled.auto_approve_joins);

        // Simulate forked sync health + skipped coordinator messages, then repair via FFI.
        {
            let store = SqlitePrivateWorkspaceStore::open(&db).unwrap();
            let mut stored = store
                .get_workspace(&hex_pk, &ws.workspace_id)
                .unwrap()
                .unwrap();
            stored.consecutive_decrypt_errors = 6;
            stored.sync_health = SYNC_HEALTH_FORKED.to_owned();
            stored.skipped_coordinator_messages.push(SkippedCoordinatorMessage {
                cursor: 42,
                reason: "stale-or-invalid".to_owned(),
                recorded_at_ms: 1_760_000_000_000,
            });
            // Also verify readonly sync on a "removed" workspace returns immediately with ZERO network.
            stored.status = "removed".to_owned();
            store.put_workspace(&stored).unwrap();
        }
        let removed_synced =
            sync_circle_workspace_readonly(db.clone(), npub.clone(), ws.workspace_id.clone())
                .await
                .expect("readonly sync on removed workspace returns immediately");
        assert_eq!(removed_synced.status, "removed");
        assert_eq!(removed_synced.sync_health, SYNC_HEALTH_REMOVED);

        // Switch back to active+forked and run repair_circle_sync_state.
        {
            let store = SqlitePrivateWorkspaceStore::open(&db).unwrap();
            let mut stored = store
                .get_workspace(&hex_pk, &ws.workspace_id)
                .unwrap()
                .unwrap();
            stored.status = "active".to_owned();
            stored.sync_health = SYNC_HEALTH_FORKED.to_owned();
            stored.consecutive_decrypt_errors = 6;
            store.put_workspace(&stored).unwrap();
        }
        let repaired = repair_circle_sync_state(db.clone(), npub, ws.workspace_id.clone())
            .await
            .expect("repair sync state");
        assert_eq!(repaired.sync_health, SYNC_HEALTH_HEALTHY);
        assert_eq!(repaired.consecutive_decrypt_errors, 0);

        // Check adaptive polling backoff schedule helper.
        assert_eq!(adaptive_poll_interval_ms(0), 1_500);
        assert_eq!(adaptive_poll_interval_ms(1), 3_000);
        assert_eq!(adaptive_poll_interval_ms(2), 5_000);
        assert_eq!(adaptive_poll_interval_ms(9), 5_000);
    }

    #[tokio::test]
    async fn encrypted_media_prepare_imeta_and_http_download_decrypt_roundtrip() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let npub = keys.public_key().to_bech32().unwrap();

        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("media.sqlite3").to_string_lossy().to_string();

        let ws = create_circle_workspace(
            db.clone(),
            Some(nsec),
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["wss://relay.earthly.city".to_owned()],
            "Media Field Ops".to_owned(),
            None,
            None,
        )
        .await
        .expect("create workspace");

        // Build a synthetic JPEG containing an EXIF APP1 block so we verify EXIF stripping too.
        let mut jpeg_with_exif = vec![0xFF, 0xD8]; // SOI
        let exif_body = b"Exif\0\0GPS:48.2082,16.3738";
        let app1_len = (exif_body.len() + 2) as u16;
        jpeg_with_exif.extend_from_slice(&[0xFF, 0xE1]);
        jpeg_with_exif.extend_from_slice(&app1_len.to_be_bytes());
        jpeg_with_exif.extend_from_slice(exif_body);
        jpeg_with_exif.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x04, 0x11, 0x22, 0xFF, 0xD9]);

        // 1. Ephemeral epoch-bound `cordn-em-v1` with metadata stripping + randomized filename.
        let prepared_em = prepare_circle_encrypted_media(
            db.clone(),
            npub.clone(),
            ws.workspace_id.clone(),
            jpeg_with_exif.clone(),
            "image/jpeg".to_owned(),
            "IMG_HOME_PRIVATE.jpg".to_owned(),
            false,
            true,
        )
        .expect("prepare cordn-em-v1");
        assert_eq!(prepared_em.version, CORDN_ENCRYPTED_MEDIA_VERSION);
        assert!(prepared_em.persistent_key_hex.is_none());
        assert_ne!(prepared_em.sanitized_filename, "IMG_HOME_PRIVATE.jpg");
        assert!(prepared_em.sanitized_filename.ends_with(".jpg"));
        assert_eq!(
            prepared_em.encrypted_sha256_hex,
            sha256_hex(&prepared_em.encrypted_bytes)
        );

        // 2. Persistent map media `earthly-pm-v1` preserving document filename.
        let geo_pdf = b"%PDF-1.7 Earthly hydro survey report".to_vec();
        let prepared_pm = prepare_circle_encrypted_media(
            db.clone(),
            npub.clone(),
            ws.workspace_id.clone(),
            geo_pdf.clone(),
            "application/pdf".to_owned(),
            "/tmp/secret/hydro-report.pdf".to_owned(),
            true,
            false,
        )
        .expect("prepare earthly-pm-v1");
        assert_eq!(prepared_pm.version, EARTHLY_PERSISTENT_MEDIA_VERSION);
        assert!(prepared_pm.persistent_key_hex.is_some());
        assert_eq!(prepared_pm.sanitized_filename, "hydro-report.pdf");

        // Serve both encrypted blobs over a loopback HTTP server and verify full download+decrypt!
        let mut routes = HashMap::new();
        routes.insert(
            format!("/{}", prepared_em.encrypted_sha256_hex),
            prepared_em.encrypted_bytes.clone(),
        );
        routes.insert(
            format!("/{}", prepared_pm.encrypted_sha256_hex),
            prepared_pm.encrypted_bytes.clone(),
        );
        let base_url = spawn_loopback_http_server(routes);
        let em_url = format!("{base_url}/{}", prepared_em.encrypted_sha256_hex);
        let pm_url = format!("{base_url}/{}", prepared_pm.encrypted_sha256_hex);

        // Verify NIP-92 `imeta` tag construction for both versions.
        let em_tag = build_circle_imeta_tag(
            em_url.clone(),
            prepared_em.mime_type.clone(),
            prepared_em.sanitized_filename.clone(),
            prepared_em.plaintext_sha256_hex.clone(),
            prepared_em.nonce_hex.clone(),
            prepared_em.version.clone(),
            Some("1600x1200".to_owned()),
            Some("LEHV6nWB2yk8pyo0adR*.7kCMdnj".to_owned()),
            Some("Bridge gauge".to_owned()),
            None,
        )
        .expect("build cordn-em-v1 imeta tag");
        assert_eq!(em_tag[0], "imeta");
        assert!(em_tag.contains(&"v cordn-em-v1".to_owned()));

        let pm_tag = build_circle_imeta_tag(
            pm_url.clone(),
            prepared_pm.mime_type.clone(),
            prepared_pm.sanitized_filename.clone(),
            prepared_pm.plaintext_sha256_hex.clone(),
            prepared_pm.nonce_hex.clone(),
            prepared_pm.version.clone(),
            None,
            None,
            None,
            prepared_pm.persistent_key_hex.clone(),
        )
        .expect("build earthly-pm-v1 imeta tag");
        assert!(pm_tag.contains(&"v earthly-pm-v1".to_owned()));

        // Download & decrypt `cordn-em-v1` (confirming EXIF bytes were stripped!).
        let decrypted_em = download_and_decrypt_circle_media(
            db.clone(),
            npub.clone(),
            ws.workspace_id.clone(),
            em_url.clone(),
            prepared_em.mime_type.clone(),
            prepared_em.sanitized_filename.clone(),
            prepared_em.plaintext_sha256_hex.clone(),
            prepared_em.nonce_hex.clone(),
            prepared_em.version.clone(),
            None,
            Some(ws.epoch),
        )
        .await
        .expect("download & decrypt cordn-em-v1");
        assert!(decrypted_em.starts_with(&[0xFF, 0xD8]));
        assert!(!decrypted_em.windows(4).any(|w| w == b"Exif"));

        // Tampered MIME must fail AEAD AAD authentication.
        assert!(download_and_decrypt_circle_media(
            db.clone(),
            npub.clone(),
            ws.workspace_id.clone(),
            em_url,
            "image/png".to_owned(),
            prepared_em.sanitized_filename.clone(),
            prepared_em.plaintext_sha256_hex.clone(),
            prepared_em.nonce_hex.clone(),
            prepared_em.version.clone(),
            None,
            Some(ws.epoch),
        )
        .await
        .is_err());

        // Download & decrypt `earthly-pm-v1`.
        let decrypted_pm = download_and_decrypt_circle_media(
            db,
            npub,
            ws.workspace_id,
            pm_url,
            prepared_pm.mime_type,
            prepared_pm.sanitized_filename,
            prepared_pm.plaintext_sha256_hex,
            prepared_pm.nonce_hex,
            prepared_pm.version,
            prepared_pm.persistent_key_hex,
            None,
        )
        .await
        .expect("download & decrypt earthly-pm-v1");
        assert_eq!(decrypted_pm, geo_pdf);
    }

    #[tokio::test]
    async fn multi_device_prepare_tip_build_and_reconcile_adopts_workspace_on_second_device() {
        let keys = Keys::generate();
        let nsec = keys.secret_key().to_bech32().unwrap();
        let npub = keys.public_key().to_bech32().unwrap();

        let dir_a = tempfile::tempdir().unwrap();
        let db_a = dir_a
            .path()
            .join("device_a.sqlite3")
            .to_string_lossy()
            .to_string();
        let dir_b = tempfile::tempdir().unwrap();
        let db_b = dir_b
            .path()
            .join("device_b.sqlite3")
            .to_string_lossy()
            .to_string();

        // Device A creates two workspaces, one active and one marked removed.
        let ws_active = create_circle_workspace(
            db_a.clone(),
            Some(nsec.clone()),
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["wss://relay.earthly.city".to_owned()],
            "Cross-Device Circle".to_owned(),
            Some("Synced desktop -> Android".to_owned()),
            None,
        )
        .await
        .expect("create active workspace");
        let ws_removed = create_circle_workspace(
            db_a.clone(),
            Some(nsec),
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["wss://relay.earthly.city".to_owned()],
            "Old Removed Circle".to_owned(),
            None,
            None,
        )
        .await
        .expect("create second workspace");
        {
            let store = SqlitePrivateWorkspaceStore::open(&db_a).unwrap();
            let pk = keys.public_key().to_hex();
            let mut st = store.get_workspace(&pk, &ws_removed.workspace_id).unwrap().unwrap();
            st.status = "removed".to_owned();
            st.sync_health = SYNC_HEALTH_REMOVED.to_owned();
            store.put_workspace(&st).unwrap();
        }

        // Prepare sealed multi-device blobs on Device A.
        let prepared = prepare_multi_device_publish(
            db_a.clone(),
            npub.clone(),
            "https://blossom.earthly.city".to_owned(),
            None,
        )
        .expect("prepare multi-device publish");
        assert_eq!(prepared.dek_hex.len(), 64);
        assert_eq!(prepared.blobs.len(), 2); // 1 active group + 1 meta doc

        // Host the sealed blobs on an ephemeral loopback Blossom server.
        let mut routes = HashMap::new();
        for blob in &prepared.blobs {
            routes.insert(format!("/{}", blob.x_hex), blob.encrypted_bytes.clone());
        }
        let server_url = spawn_loopback_http_server(routes);

        // Rebuild tip plaintext JSON with loopback URLs via `build_multi_device_tip_plaintext`.
        let mut group_ptrs: BTreeMap<String, serde_json::Value> = BTreeMap::new();
        let mut meta_ptr_json: Option<String> = None;
        for blob in &prepared.blobs {
            let ptr = serde_json::json!({
                "x": blob.x_hex,
                "urls": [format!("{server_url}/{}", blob.x_hex)],
                "issuedAt": blob.issued_at,
            });
            if blob.kind == "group" {
                group_ptrs.insert(blob.gid.clone().unwrap(), ptr);
            } else {
                meta_ptr_json = Some(ptr.to_string());
            }
        }
        let tip_plaintext = build_multi_device_tip_plaintext(
            prepared.dek_hex.clone(),
            vec![server_url.clone()],
            serde_json::to_string(&group_ptrs).unwrap(),
            meta_ptr_json,
        )
        .expect("build multi-device tip plaintext");

        // Verify unsigned kind 30078 event template helper for Amber/NIP-46 flow.
        let unsigned_ev_json = prepare_unsigned_multi_device_tip_event(
            npub.clone(),
            "nip44-ciphertext-placeholder".to_owned(),
        )
        .expect("prepare unsigned tip event");
        let unsigned_val: serde_json::Value = serde_json::from_str(&unsigned_ev_json).unwrap();
        assert_eq!(unsigned_val["kind"], MULTI_DEVICE_TIP_KIND);
        assert_eq!(unsigned_val["pubkey"], keys.public_key().to_hex());
        assert_eq!(
            unsigned_val["tags"],
            serde_json::json!([["d", MULTI_DEVICE_TIP_D_TAG]])
        );

        // Device B (fresh SQLite DB) applies the decrypted tip and adopts the active Circle!
        let summary = apply_decrypted_multi_device_tip(db_b.clone(), npub.clone(), tip_plaintext.clone())
            .await
            .expect("apply decrypted tip on Device B");
        assert_eq!(summary.adopted_groups, 1);
        assert_eq!(summary.updated_groups, 0);
        assert!(summary.skipped_errors.is_empty());
        assert_eq!(summary.workspaces.len(), 1);
        assert_eq!(summary.workspaces[0].workspace_id, ws_active.workspace_id);
        assert_eq!(summary.workspaces[0].group_id, ws_active.group_id);
        assert_eq!(summary.workspaces[0].name, "Cross-Device Circle");
        assert_eq!(summary.workspaces[0].cordn_group_ref, ws_active.cordn_group_ref);

        // Applying the same tip a second time is idempotent (`unchanged_groups == 1`).
        let summary2 = apply_decrypted_multi_device_tip(db_b, npub, tip_plaintext)
            .await
            .expect("idempotent re-apply on Device B");
        assert_eq!(summary2.adopted_groups, 0);
        assert_eq!(summary2.unchanged_groups, 1);
    }
}
