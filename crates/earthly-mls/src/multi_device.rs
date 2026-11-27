//! Multi-Device Blossom Sync (`spec/applications/multi-device.md`).
//!
//! Enables Desktop & Android devices logged into the same Nostr identity to sync and
//! adopt MLS Circles via encrypted Blossom documents + an opaque NIP-78 (`kind 30078`,
//! `d: "cordn-md-tip-v1"`) tip pointer event:
//! - Group Document (`schemaVersion: 1`, `type: "group"`): per-group snapshot with MLS
//!   `clientState`, `cursor`, `gid`, `coordinator`, `coordinatorRelays`, optional `prev`
//!   hash chain, plus optional Earthly metadata (`workspaceId`, `adminPubkey`, `metadata`,
//!   `envelopes`, `epochMediaKeys`, `envelopeEpochs`).
//! - Meta Document (`schemaVersion: 1`, `type: "meta"`): `removed` tombstones and
//!   `lastResortKeyPackage`.
//! - Documents are sealed/unsealed with NIP-44 v2 (`nostr::nips::nip44::v2`) using a
//!   per-identity 32-byte DEK.
//! - The opaque tip pointer (`kind 30078`, `d: "cordn-md-tip-v1"`) self-seals the DEK
//!   and document `x` hashes + Blossom URLs using NIP-44 v2 to the user's own pubkey,
//!   leaking zero group IDs or blob hashes to Nostr relays.

use std::collections::{BTreeMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::OsRng;
use nostr::nips::nip44::{self, v2::ConversationKey};
use nostr::{Event, EventBuilder, Keys, Kind, SecretKey, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::envelope::{assert_private_envelope_authorization, PrivateWorkspaceEnvelope};
use crate::is_valid_hex_pubkey;
use crate::mls::{derive_encrypted_media_key_with_epoch, inspect_group_summary, PersistedMlsState};
use crate::policy::reduce_administrator_policy;
use crate::storage::{
    SqlitePrivateWorkspaceStore, StoredWorkspace, WorkspaceMetadata, SYNC_HEALTH_HEALTHY,
    SYNC_HEALTH_REMOVED,
};

pub const MULTI_DEVICE_SCHEMA_VERSION: u8 = 1;
pub const MULTI_DEVICE_DOC_TYPE_GROUP: &str = "group";
pub const MULTI_DEVICE_DOC_TYPE_META: &str = "meta";
pub const MULTI_DEVICE_TIP_KIND: u16 = 30_078;
pub const MULTI_DEVICE_TIP_D_TAG: &str = "cordn-md-tip-v1";
pub const EARTHLY_MLS_RS_STATE_FORMAT: &str = "earthly-mls-rs-v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceGroupDocument {
    pub schema_version: u8,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub issued_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev: Option<String>,
    pub gid: String,
    pub coordinator: String,
    pub coordinator_relays: Vec<String>,
    pub client_state: String,
    pub cursor: u64,
    // Optional Earthly extensions (ignored by non-Earthly Cordn clients; all #[serde(default)])
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_format: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin_pubkey: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<WorkspaceMetadata>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub envelopes: Vec<PrivateWorkspaceEnvelope>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub epoch_media_keys: BTreeMap<u64, String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub envelope_epochs: BTreeMap<String, u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceRemovedGroup {
    pub gid: String,
    pub removed_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceLastResortKeyPackage {
    pub kp_ref: String,
    pub kp_64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_kp_64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rust_bundle_b64: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub published_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceMetaDocument {
    pub schema_version: u8,
    #[serde(rename = "type")]
    pub doc_type: String,
    pub issued_at: u64,
    #[serde(default)]
    pub removed: Vec<MultiDeviceRemovedGroup>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_resort_key_package: Option<MultiDeviceLastResortKeyPackage>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceDocPointer {
    /// Lowercase 64-char hex SHA-256 of the sealed Blossom blob.
    pub x: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub urls: Vec<String>,
}

/// Inner content of the opaque `kind 30078` (`d: "cordn-md-tip-v1"`) tip event.
/// Always NIP-44 v2 self-encrypted before placing into `event.content`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiDeviceTipPayload {
    pub schema_version: u8,
    /// Lowercase 64-char hex 32-byte per-identity DEK used to seal/unseal Blossom docs.
    pub dek_hex: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta: Option<MultiDeviceDocPointer>,
    #[serde(default)]
    pub groups: Vec<MultiDeviceDocPointer>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blossom_servers: Vec<String>,
    pub updated_at: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReconcileOutcome {
    AdoptedNew,
    UpdatedExisting,
    MergedMetadataOnly,
    AlreadyUpToDate,
}

#[derive(Clone, Debug)]
pub struct ReconcileGroupDocumentResult {
    pub outcome: ReconcileOutcome,
    pub workspace: StoredWorkspace,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn is_sha256_hex(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Generates a fresh 32-byte OS CSPRNG data encryption key (DEK) for multi-device documents.
pub fn generate_multi_device_dek() -> [u8; 32] {
    let mut dek = [0u8; 32];
    OsRng.fill_bytes(&mut dek);
    dek
}

/// Encodes a `PersistedMlsState` into base64 for `MultiDeviceGroupDocument.client_state`.
pub fn encode_rust_client_state(state: &PersistedMlsState) -> Result<String, String> {
    let json = serde_json::to_vec(state)
        .map_err(|e| format!("Failed to serialize Rust MLS state for multi-device sync: {e}"))?;
    Ok(BASE64.encode(json))
}

/// Decodes `MultiDeviceGroupDocument.client_state` as a Rust `PersistedMlsState`.
pub fn decode_rust_client_state(client_state: &str) -> Result<PersistedMlsState, String> {
    let raw = BASE64
        .decode(client_state.trim())
        .map_err(|_| "Invalid base64 in multi-device clientState".to_owned())?;
    serde_json::from_slice(&raw)
        .map_err(|e| format!("clientState is not a Rust earthly-mls-rs PersistedMlsState: {e}"))
}

/// Builds a `MultiDeviceGroupDocument` snapshot from a local `StoredWorkspace`.
pub fn build_group_document_from_workspace(
    ws: &StoredWorkspace,
    prev: Option<String>,
    issued_at: u64,
    include_envelopes: bool,
) -> Result<MultiDeviceGroupDocument, String> {
    let mut epoch_media_keys = ws.epoch_media_keys.clone();
    if let Ok((epoch, key)) = derive_encrypted_media_key_with_epoch(&ws.mls_state) {
        epoch_media_keys
            .entry(epoch)
            .or_insert_with(|| hex::encode(key));
    }
    let doc = MultiDeviceGroupDocument {
        schema_version: MULTI_DEVICE_SCHEMA_VERSION,
        doc_type: MULTI_DEVICE_DOC_TYPE_GROUP.to_owned(),
        issued_at,
        prev,
        gid: ws.group_id.clone(),
        coordinator: ws.coordinator_pubkey.clone(),
        coordinator_relays: ws.relays.clone(),
        client_state: encode_rust_client_state(&ws.mls_state)?,
        cursor: ws.cursor,
        state_format: Some(EARTHLY_MLS_RS_STATE_FORMAT.to_owned()),
        workspace_id: Some(ws.workspace_id.clone()),
        admin_pubkey: Some(ws.admin_pubkey.clone()),
        metadata: ws.metadata.clone(),
        envelopes: if include_envelopes {
            ws.envelopes.clone()
        } else {
            Vec::new()
        },
        epoch_media_keys,
        envelope_epochs: if include_envelopes {
            ws.envelope_epochs.clone()
        } else {
            BTreeMap::new()
        },
    };
    validate_group_document(&doc)?;
    Ok(doc)
}

pub fn validate_group_document(doc: &MultiDeviceGroupDocument) -> Result<(), String> {
    if doc.schema_version != MULTI_DEVICE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported multi-device schemaVersion: {}",
            doc.schema_version
        ));
    }
    if doc.doc_type != MULTI_DEVICE_DOC_TYPE_GROUP {
        return Err(format!(
            "Expected multi-device document type `group`, got `{}`",
            doc.doc_type
        ));
    }
    if doc.gid.trim().is_empty() {
        return Err("Multi-device group document requires non-empty `gid`".to_owned());
    }
    if !is_valid_hex_pubkey(&doc.coordinator) {
        return Err("Multi-device group document `coordinator` must be 64-char hex".to_owned());
    }
    if doc.coordinator_relays.is_empty()
        || !doc
            .coordinator_relays
            .iter()
            .all(|r| r.starts_with("wss://") || r.starts_with("ws://"))
    {
        return Err("Multi-device group document has invalid `coordinatorRelays`".to_owned());
    }
    if doc.client_state.trim().is_empty() {
        return Err("Multi-device group document requires non-empty `clientState`".to_owned());
    }
    if let Some(prev) = &doc.prev {
        if !is_sha256_hex(prev) {
            return Err("Multi-device group document `prev` must be 64-char hex sha256".to_owned());
        }
    }
    if let Some(admin) = &doc.admin_pubkey {
        if !is_valid_hex_pubkey(admin) {
            return Err("Multi-device group document `adminPubkey` must be 64-char hex".to_owned());
        }
    }
    Ok(())
}

pub fn validate_meta_document(doc: &MultiDeviceMetaDocument) -> Result<(), String> {
    if doc.schema_version != MULTI_DEVICE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported multi-device schemaVersion: {}",
            doc.schema_version
        ));
    }
    if doc.doc_type != MULTI_DEVICE_DOC_TYPE_META {
        return Err(format!(
            "Expected multi-device document type `meta`, got `{}`",
            doc.doc_type
        ));
    }
    Ok(())
}

/// Seals a UTF-8 JSON document string with NIP-44 v2 using a 32-byte per-identity DEK.
/// Wire-compatible with `nostr-tools` `nip44.v2.encrypt(json, dek)`.
pub fn seal_multi_device_document(plaintext_json: &str, dek: &[u8; 32]) -> Result<String, String> {
    if plaintext_json.is_empty() {
        return Err("Multi-device document plaintext cannot be empty".to_owned());
    }
    let ck = ConversationKey::new(*dek);
    let raw = nip44::v2::encrypt_to_bytes(&ck, plaintext_json.as_bytes())
        .map_err(|e| format!("NIP-44 v2 multi-device seal failed: {e}"))?;
    Ok(BASE64.encode(raw))
}

/// Unseals a NIP-44 v2 base64 document payload using the 32-byte per-identity DEK.
/// Wire-compatible with `nostr-tools` `nip44.v2.decrypt(payload, dek)`.
pub fn unseal_multi_device_document(
    sealed_base64: &str,
    dek: &[u8; 32],
) -> Result<String, String> {
    let raw = BASE64
        .decode(sealed_base64.trim())
        .map_err(|_| "Invalid base64 in sealed multi-device document".to_owned())?;
    if raw.first().copied() != Some(0x02) {
        return Err("Unsupported NIP-44 payload version in multi-device document".to_owned());
    }
    let ck = ConversationKey::new(*dek);
    let plaintext = nip44::v2::decrypt_to_bytes(&ck, &raw)
        .map_err(|e| format!("NIP-44 v2 multi-device unseal failed: {e}"))?;
    String::from_utf8(plaintext)
        .map_err(|_| "Unsealed multi-device document is not valid UTF-8".to_owned())
}

/// Seals a `MultiDeviceGroupDocument` and returns `(sealed_payload, sha256_hex_of_sealed_utf8)`.
pub fn seal_group_document(
    doc: &MultiDeviceGroupDocument,
    dek: &[u8; 32],
) -> Result<(String, String), String> {
    validate_group_document(doc)?;
    let json = serde_json::to_string(doc)
        .map_err(|e| format!("Failed to encode multi-device group document: {e}"))?;
    let sealed = seal_multi_device_document(&json, dek)?;
    let x = hex::encode(Sha256::digest(sealed.as_bytes()));
    Ok((sealed, x))
}

pub fn unseal_group_document(
    sealed_base64: &str,
    dek: &[u8; 32],
) -> Result<MultiDeviceGroupDocument, String> {
    let json = unseal_multi_device_document(sealed_base64, dek)?;
    let doc: MultiDeviceGroupDocument = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid multi-device group document JSON: {e}"))?;
    validate_group_document(&doc)?;
    Ok(doc)
}

/// Seals a `MultiDeviceMetaDocument` and returns `(sealed_payload, sha256_hex_of_sealed_utf8)`.
pub fn seal_meta_document(
    doc: &MultiDeviceMetaDocument,
    dek: &[u8; 32],
) -> Result<(String, String), String> {
    validate_meta_document(doc)?;
    let json = serde_json::to_string(doc)
        .map_err(|e| format!("Failed to encode multi-device meta document: {e}"))?;
    let sealed = seal_multi_device_document(&json, dek)?;
    let x = hex::encode(Sha256::digest(sealed.as_bytes()));
    Ok((sealed, x))
}

pub fn unseal_meta_document(
    sealed_base64: &str,
    dek: &[u8; 32],
) -> Result<MultiDeviceMetaDocument, String> {
    let json = unseal_multi_device_document(sealed_base64, dek)?;
    let doc: MultiDeviceMetaDocument = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid multi-device meta document JSON: {e}"))?;
    validate_meta_document(&doc)?;
    Ok(doc)
}

pub fn validate_tip_payload(payload: &MultiDeviceTipPayload) -> Result<[u8; 32], String> {
    if payload.schema_version != MULTI_DEVICE_SCHEMA_VERSION {
        return Err(format!(
            "Unsupported multi-device tip schemaVersion: {}",
            payload.schema_version
        ));
    }
    if !is_sha256_hex(&payload.dek_hex) {
        return Err("Multi-device tip `dekHex` must be 64-char lowercase hex".to_owned());
    }
    if let Some(meta) = &payload.meta {
        if !is_sha256_hex(&meta.x) {
            return Err("Multi-device tip meta `x` must be 64-char lowercase hex".to_owned());
        }
    }
    for g in &payload.groups {
        if !is_sha256_hex(&g.x) {
            return Err("Multi-device tip group `x` must be 64-char lowercase hex".to_owned());
        }
    }
    let dek_bytes = hex::decode(&payload.dek_hex).map_err(|_| "Invalid dekHex".to_owned())?;
    let mut dek = [0u8; 32];
    dek.copy_from_slice(&dek_bytes);
    Ok(dek)
}

/// NIP-44 v2 self-seals the opaque `MultiDeviceTipPayload` using the user's own identity key.
pub fn seal_tip_payload_for_self(
    secret_key: &SecretKey,
    payload: &MultiDeviceTipPayload,
) -> Result<String, String> {
    let _ = validate_tip_payload(payload)?;
    let keys = Keys::new(secret_key.clone());
    let json = serde_json::to_string(payload)
        .map_err(|e| format!("Failed to serialize multi-device tip payload: {e}"))?;
    nip44::encrypt(
        keys.secret_key(),
        &keys.public_key(),
        json,
        nip44::Version::V2,
    )
    .map_err(|e| format!("Failed to NIP-44 self-seal multi-device tip: {e}"))
}

/// Decrypts a NIP-44 v2 self-sealed `MultiDeviceTipPayload`.
pub fn unseal_tip_payload_for_self(
    secret_key: &SecretKey,
    encrypted_content: &str,
) -> Result<MultiDeviceTipPayload, String> {
    let keys = Keys::new(secret_key.clone());
    let json = nip44::decrypt(keys.secret_key(), &keys.public_key(), encrypted_content)
        .map_err(|e| format!("Failed to decrypt multi-device tip payload: {e}"))?;
    let payload: MultiDeviceTipPayload = serde_json::from_str(&json)
        .map_err(|e| format!("Invalid multi-device tip JSON: {e}"))?;
    let _ = validate_tip_payload(&payload)?;
    Ok(payload)
}

/// Builds the opaque `kind 30078` (`d: "cordn-md-tip-v1"`) unsigned event template
/// `(kind, created_at, tags, content)` for signing via local keys, NIP-46, or Amber NIP-55.
pub fn build_tip_event_template(
    encrypted_content: String,
    created_at: u64,
) -> (u16, u64, Vec<Vec<String>>, String) {
    (
        MULTI_DEVICE_TIP_KIND,
        created_at,
        vec![vec!["d".to_owned(), MULTI_DEVICE_TIP_D_TAG.to_owned()]],
        encrypted_content,
    )
}

/// Signs an opaque `kind 30078` (`d: "cordn-md-tip-v1"`) multi-device tip event locally.
pub fn build_signed_tip_event(
    keys: &Keys,
    payload: &MultiDeviceTipPayload,
    created_at: u64,
) -> Result<Event, String> {
    let content = seal_tip_payload_for_self(keys.secret_key(), payload)?;
    let d_tag = Tag::parse(["d", MULTI_DEVICE_TIP_D_TAG])
        .map_err(|e| format!("Failed to build tip d-tag: {e}"))?;
    EventBuilder::new(Kind::Custom(MULTI_DEVICE_TIP_KIND), content)
        .tag(d_tag)
        .custom_created_at(Timestamp::from(created_at))
        .sign_with_keys(keys)
        .map_err(|e| format!("Failed to sign multi-device tip event: {e}"))
}

/// Verifies and decrypts an opaque `kind 30078` (`d: "cordn-md-tip-v1"`) multi-device tip event.
pub fn parse_signed_tip_event(keys: &Keys, event: &Event) -> Result<MultiDeviceTipPayload, String> {
    event
        .verify()
        .map_err(|_| "Invalid multi-device tip event signature".to_owned())?;
    if event.kind != Kind::Custom(MULTI_DEVICE_TIP_KIND) {
        return Err("Event is not a multi-device tip (kind 30078)".to_owned());
    }
    if event.pubkey != keys.public_key() {
        return Err("Multi-device tip event author does not match local identity".to_owned());
    }
    let has_d = event.tags.iter().any(|t| {
        let s = t.as_slice();
        s.len() >= 2 && s[0] == "d" && s[1] == MULTI_DEVICE_TIP_D_TAG
    });
    if !has_d {
        return Err("Multi-device tip event is missing d-tag `cordn-md-tip-v1`".to_owned());
    }
    unseal_tip_payload_for_self(keys.secret_key(), &event.content)
}

fn verify_and_collect_envelopes(
    envelopes: &[PrivateWorkspaceEnvelope],
    expected_gid: &str,
) -> Vec<PrivateWorkspaceEnvelope> {
    let mut seen = HashSet::new();
    let mut valid = Vec::new();
    for env in envelopes {
        if !seen.insert(env.id.as_str()) {
            continue;
        }
        if assert_private_envelope_authorization(env, expected_gid).is_ok() {
            valid.push(env.clone());
        }
    }
    valid
}

/// Reconciles a remote `MultiDeviceGroupDocument` into the local `SqlitePrivateWorkspaceStore`
/// so Desktop & Android logged into the same account can adopt/sync MLS workspaces seamlessly.
///
/// - If the workspace does not exist locally, validates the Rust `PersistedMlsState` inside
///   `doc.client_state` and adopts the workspace into SQLite.
/// - If the workspace already exists locally, merges verified envelopes, `epoch_media_keys`,
///   `envelope_epochs`, metadata, and adopts the remote `mls_state` + `cursor` whenever the
///   remote snapshot is strictly ahead (higher `cursor`, or equal `cursor` with higher MLS epoch).
pub fn reconcile_remote_group_document(
    store: &SqlitePrivateWorkspaceStore,
    owner_pubkey: &str,
    doc: &MultiDeviceGroupDocument,
) -> Result<ReconcileGroupDocumentResult, String> {
    if !is_valid_hex_pubkey(owner_pubkey) {
        return Err("Invalid owner pubkey for multi-device reconciliation".to_owned());
    }
    validate_group_document(doc)?;

    // Look up existing workspace either by workspace_id or by group_id.
    let existing = match doc.workspace_id.as_deref() {
        Some(ws_id) if !ws_id.is_empty() => match store.get_workspace(owner_pubkey, ws_id)? {
            Some(ws) => Some(ws),
            None => store.get_workspace_by_group_id(owner_pubkey, &doc.gid)?,
        },
        _ => store.get_workspace_by_group_id(owner_pubkey, &doc.gid)?,
    };

    let verified_envelopes = verify_and_collect_envelopes(&doc.envelopes, &doc.gid);
    let parsed_remote_state = decode_rust_client_state(&doc.client_state).ok();

    if let Some(mut ws) = existing {
        if ws.group_id != doc.gid {
            return Err("Remote group document gid does not match local workspace".to_owned());
        }

        let mut changed = false;
        let mut state_upgraded = false;

        if let Some(remote_state) = parsed_remote_state {
            if remote_state.group_id == doc.gid && remote_state.owner_pubkey == owner_pubkey {
                let (local_epoch, _) = inspect_group_summary(&ws.mls_state)?;
                let (remote_epoch, remote_members) = inspect_group_summary(&remote_state)?;
                let remote_is_ahead = doc.cursor > ws.cursor
                    || (doc.cursor == ws.cursor && remote_epoch > local_epoch);
                if remote_is_ahead {
                    ws.mls_state = remote_state;
                    ws.cursor = doc.cursor;
                    ws.coordinator_pubkey = doc.coordinator.clone();
                    ws.relays = doc.coordinator_relays.clone();
                    ws.consecutive_decrypt_errors = 0;
                    if remote_members.iter().any(|p| p == owner_pubkey) {
                        ws.status = "active".to_owned();
                        ws.sync_health = SYNC_HEALTH_HEALTHY.to_owned();
                    } else {
                        ws.status = "removed".to_owned();
                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                    }
                    if let Ok((ep, key)) = derive_encrypted_media_key_with_epoch(&ws.mls_state) {
                        ws.epoch_media_keys
                            .entry(ep)
                            .or_insert_with(|| hex::encode(key));
                    }
                    state_upgraded = true;
                    changed = true;
                }
            }
        }

        // Merge verified envelopes that we do not yet have locally.
        let mut existing_ids: HashSet<String> =
            ws.envelopes.iter().map(|e| e.id.clone()).collect();
        for env in verified_envelopes {
            if existing_ids.insert(env.id.clone()) {
                ws.envelopes.push(env);
                changed = true;
            }
        }

        // Merge epoch media keys and envelope epochs.
        for (ep, key_hex) in &doc.epoch_media_keys {
            if is_sha256_hex(key_hex) && !ws.epoch_media_keys.contains_key(ep) {
                ws.epoch_media_keys.insert(*ep, key_hex.clone());
                changed = true;
            }
        }
        for (env_id, ep) in &doc.envelope_epochs {
            if !ws.envelope_epochs.contains_key(env_id) {
                ws.envelope_epochs.insert(env_id.clone(), *ep);
                changed = true;
            }
        }
        if ws.metadata.is_none() && doc.metadata.is_some() {
            ws.metadata = doc.metadata.clone();
            changed = true;
        }

        if changed {
            if let Ok(policy) = reduce_administrator_policy(&ws.admin_pubkey, &ws.envelopes) {
                ws.role = if policy.administrators.iter().any(|p| p == owner_pubkey) {
                    "administrator".to_owned()
                } else {
                    "member".to_owned()
                };
            }
            store.put_workspace(&ws)?;
        }

        let outcome = if state_upgraded {
            ReconcileOutcome::UpdatedExisting
        } else if changed {
            ReconcileOutcome::MergedMetadataOnly
        } else {
            ReconcileOutcome::AlreadyUpToDate
        };
        return Ok(ReconcileGroupDocumentResult {
            outcome,
            workspace: ws,
        });
    }

    // Adopting a brand-new workspace onto this device requires a valid Rust PersistedMlsState.
    let remote_state = parsed_remote_state.ok_or_else(|| {
        "Remote group document clientState is not compatible with Rust mls-rs state format"
            .to_owned()
    })?;
    if remote_state.group_id != doc.gid {
        return Err("Remote clientState group_id does not match document gid".to_owned());
    }
    if remote_state.owner_pubkey != owner_pubkey {
        return Err("Remote clientState owner_pubkey does not match local identity".to_owned());
    }
    let (epoch, members) = inspect_group_summary(&remote_state)?;
    let is_member = members.iter().any(|p| p == owner_pubkey);

    let admin_pubkey = doc
        .admin_pubkey
        .clone()
        .unwrap_or_else(|| owner_pubkey.to_owned());
    let policy = reduce_administrator_policy(&admin_pubkey, &verified_envelopes)?;
    let role = if policy.administrators.iter().any(|p| p == owner_pubkey) {
        "administrator".to_owned()
    } else {
        "member".to_owned()
    };

    let mut epoch_media_keys = BTreeMap::new();
    for (ep, k) in &doc.epoch_media_keys {
        if is_sha256_hex(k) {
            epoch_media_keys.insert(*ep, k.clone());
        }
    }
    if let Ok((_, key)) = derive_encrypted_media_key_with_epoch(&remote_state) {
        epoch_media_keys
            .entry(epoch)
            .or_insert_with(|| hex::encode(key));
    }

    let workspace_id = doc
        .workspace_id
        .clone()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let ws = StoredWorkspace {
        workspace_id,
        group_id: doc.gid.clone(),
        owner_pubkey: owner_pubkey.to_owned(),
        admin_pubkey,
        coordinator_pubkey: doc.coordinator.clone(),
        relays: doc.coordinator_relays.clone(),
        role,
        status: if is_member {
            "active".to_owned()
        } else {
            "removed".to_owned()
        },
        mls_state: remote_state,
        cursor: doc.cursor,
        metadata: doc.metadata.clone(),
        envelopes: verified_envelopes,
        pending_outbound: Vec::new(),
        pending_application: None,
        pending_approval: None,
        pending_membership_commit: None,
        skipped_coordinator_messages: Vec::new(),
        consecutive_decrypt_errors: 0,
        sync_health: if is_member {
            SYNC_HEALTH_HEALTHY.to_owned()
        } else {
            SYNC_HEALTH_REMOVED.to_owned()
        },
        auto_approve_joins: false,
        envelope_epochs: doc.envelope_epochs.clone(),
        epoch_media_keys,
        created_at_ms: now_ms(),
    };
    store.put_workspace(&ws)?;
    Ok(ReconcileGroupDocumentResult {
        outcome: ReconcileOutcome::AdoptedNew,
        workspace: ws,
    })
}

/// Async locked wrapper around `reconcile_remote_group_document` that acquires the
/// process-wide per-`(owner_pubkey, workspace_id)` mutex before mutating SQLite.
pub async fn reconcile_remote_group_document_locked(
    store: &SqlitePrivateWorkspaceStore,
    owner_pubkey: &str,
    doc: &MultiDeviceGroupDocument,
) -> Result<ReconcileGroupDocumentResult, String> {
    let lock_id = doc
        .workspace_id
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(&doc.gid);
    let lock = crate::storage::workspace_mutex(owner_pubkey, lock_id);
    let _guard = lock.lock().await;
    reconcile_remote_group_document(store, owner_pubkey, doc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls::{add_workspace_member, create_workspace_group, generate_mls_key_package};

    #[test]
    fn group_and_meta_doc_nip44_dek_seal_unseal_and_tip_event_roundtrip() {
        let keys = Keys::generate();
        let owner_pk = keys.public_key().to_hex();
        let coord_pk = Keys::generate().public_key().to_hex();
        let dek = generate_multi_device_dek();

        let state = create_workspace_group("earthly:md-test", &owner_pk).unwrap();
        let group_doc = MultiDeviceGroupDocument {
            schema_version: 1,
            doc_type: "group".to_owned(),
            issued_at: 1_760_000_000,
            prev: None,
            gid: "earthly:md-test".to_owned(),
            coordinator: coord_pk,
            coordinator_relays: vec!["wss://relay.earthly.city".to_owned()],
            client_state: encode_rust_client_state(&state).unwrap(),
            cursor: 7,
            state_format: Some(EARTHLY_MLS_RS_STATE_FORMAT.to_owned()),
            workspace_id: Some("ws-md-1".to_owned()),
            admin_pubkey: Some(owner_pk.clone()),
            metadata: Some(WorkspaceMetadata {
                name: "Synced Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            }),
            envelopes: Vec::new(),
            epoch_media_keys: BTreeMap::new(),
            envelope_epochs: BTreeMap::new(),
        };

        let (sealed_group, group_x) = seal_group_document(&group_doc, &dek).unwrap();
        assert_eq!(group_x.len(), 64);
        assert_eq!(unseal_group_document(&sealed_group, &dek).unwrap(), group_doc);

        // Wrong DEK must fail
        let wrong_dek = generate_multi_device_dek();
        assert!(unseal_group_document(&sealed_group, &wrong_dek).is_err());

        // Meta doc roundtrip
        let meta_doc = MultiDeviceMetaDocument {
            schema_version: 1,
            doc_type: "meta".to_owned(),
            issued_at: 1_760_000_005,
            removed: vec![MultiDeviceRemovedGroup {
                gid: "earthly:old-group".to_owned(),
                removed_at: 1_759_000_000,
            }],
            last_resort_key_package: None,
        };
        let (sealed_meta, meta_x) = seal_meta_document(&meta_doc, &dek).unwrap();
        assert_eq!(unseal_meta_document(&sealed_meta, &dek).unwrap(), meta_doc);

        // Opaque kind 30078 tip event roundtrip
        let tip = MultiDeviceTipPayload {
            schema_version: 1,
            dek_hex: hex::encode(dek),
            meta: Some(MultiDeviceDocPointer {
                x: meta_x,
                urls: vec!["https://blossom.earthly.city/meta".to_owned()],
            }),
            groups: vec![MultiDeviceDocPointer {
                x: group_x,
                urls: vec!["https://blossom.earthly.city/grp".to_owned()],
            }],
            blossom_servers: vec!["https://blossom.earthly.city".to_owned()],
            updated_at: 1_760_000_010,
        };
        let tip_ev = build_signed_tip_event(&keys, &tip, 1_760_000_010).unwrap();
        assert_eq!(tip_ev.kind, Kind::Custom(30_078));
        // Opaque check: tags only contain `d` = `cordn-md-tip-v1`, NO cleartext gid or hashes!
        assert_eq!(tip_ev.tags.len(), 1);
        assert!(!tip_ev.content.contains("earthly:md-test"));
        assert!(!tip_ev.content.contains(&tip.dek_hex));

        let parsed_tip = parse_signed_tip_event(&keys, &tip_ev).unwrap();
        assert_eq!(parsed_tip, tip);

        // Another user cannot decrypt our self-sealed tip
        let other = Keys::generate();
        assert!(parse_signed_tip_event(&other, &tip_ev).is_err());
    }

    #[test]
    fn reconcile_adopts_new_workspace_and_upgrades_cursor_on_second_device() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqlitePrivateWorkspaceStore::open(dir.path().join("device2.sqlite3")).unwrap();
        let owner_keys = Keys::generate();
        let owner_pk = owner_keys.public_key().to_hex();
        let bob_pk = Keys::generate().public_key().to_hex();
        let coord_pk = Keys::generate().public_key().to_hex();

        let state0 = create_workspace_group("earthly:sync-dev", &owner_pk).unwrap();
        let doc1 = MultiDeviceGroupDocument {
            schema_version: 1,
            doc_type: "group".to_owned(),
            issued_at: 1_760_000_000,
            prev: None,
            gid: "earthly:sync-dev".to_owned(),
            coordinator: coord_pk.clone(),
            coordinator_relays: vec!["wss://relay.earthly.city".to_owned()],
            client_state: encode_rust_client_state(&state0).unwrap(),
            cursor: 3,
            state_format: Some(EARTHLY_MLS_RS_STATE_FORMAT.to_owned()),
            workspace_id: Some("ws-sync-1".to_owned()),
            admin_pubkey: Some(owner_pk.clone()),
            metadata: Some(WorkspaceMetadata {
                name: "Desktop Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            }),
            envelopes: Vec::new(),
            epoch_media_keys: BTreeMap::new(),
            envelope_epochs: BTreeMap::new(),
        };

        let adopted = reconcile_remote_group_document(&store, &owner_pk, &doc1).unwrap();
        assert_eq!(adopted.outcome, ReconcileOutcome::AdoptedNew);
        assert_eq!(adopted.workspace.cursor, 3);
        assert_eq!(adopted.workspace.epoch_media_keys.len(), 1);

        // Advance epoch & cursor on device 1, then reconcile onto device 2
        let bob_kp = generate_mls_key_package(&bob_pk, true).unwrap();
        let added = add_workspace_member(&state0, &bob_kp.kp_64, &[owner_pk.clone()]).unwrap();
        let doc2 = MultiDeviceGroupDocument {
            cursor: 9,
            client_state: encode_rust_client_state(&added.new_state).unwrap(),
            issued_at: 1_760_000_050,
            ..doc1
        };

        let upgraded = reconcile_remote_group_document(&store, &owner_pk, &doc2).unwrap();
        assert_eq!(upgraded.outcome, ReconcileOutcome::UpdatedExisting);
        assert_eq!(upgraded.workspace.cursor, 9);
        assert_eq!(
            inspect_group_summary(&upgraded.workspace.mls_state).unwrap().0,
            1
        );
    }
}
