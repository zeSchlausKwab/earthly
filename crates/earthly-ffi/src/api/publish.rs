//! Local SQLite draft persistence + canonical kind-37515 event preparation
//! (for NIP-55 Amber signing) + crash-safe SQLite outbox relay delivery.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::{
    ARTICLE_KIND, GEO_COMMENT_KIND, GEO_EDIT_PROPOSAL_KIND, GEO_EVENT_KIND, ImetaAttachment,
    LIVE_BEACON_KIND, MAP_CONTEXT_KIND, MODEL_VERSION, PROPOSAL_STATUS_APPLIED_KIND,
    PROPOSAL_STATUS_CLOSED_KIND, PROPOSAL_STATUS_DRAFT_KIND, PROPOSAL_STATUS_OPEN_KIND,
    TEMPORAL_SIGHTING_KIND, set_bbox, set_context_refs, set_geohash, set_hashtags, set_images,
    set_referenced_addresses,
};
use earthly_geo::validate_feature_collection;
use earthly_spatial::Bounds;
use earthly_storage::{
    DraftStore, OUTBOX_PROTOCOL_VERSION, OutboxEnqueueInput, OutboxRelayResultInput, OutboxRouting,
    OutboxStore, SaveDraftInput,
};
use nostr::nips::nip19::ToBech32;
use nostr::{Event, JsonUtil, Keys, PublicKey, UnsignedEvent};
use nostr_sdk::Client;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub struct LocalDraftDto {
    pub draft_id: String,
    pub d_tag: String,
    pub entity_kind: u16,
    pub title: String,
    pub description: Option<String>,
    pub audience_channel: String,
    pub audience_id: Option<String>,
    pub geojson: String,
    pub updated_at: u64,
}

#[derive(Clone, Debug)]
pub struct UnsignedMapEventDto {
    pub unsigned_event_json: String,
    pub d_tag: String,
    pub address: String,
    pub feature_count: u32,
    pub checksum: String,
}

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

/// Save or update a local working draft in SQLite (`earthly-storage`).
pub fn save_local_draft(
    database_path: String,
    draft_id: String,
    d_tag: String,
    title: String,
    description: Option<String>,
    audience_channel: String,
    audience_id: Option<String>,
    geojson: String,
) -> Result<LocalDraftDto, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let saved = store
        .save(SaveDraftInput {
            draft_id,
            d_tag,
            entity_kind: GEO_EVENT_KIND,
            title,
            description,
            audience_channel,
            audience_id,
            geojson,
        })
        .map_err(|e| e.to_string())?;
    Ok(LocalDraftDto {
        draft_id: saved.draft_id,
        d_tag: saved.d_tag,
        entity_kind: saved.entity_kind,
        title: saved.title,
        description: saved.description,
        audience_channel: saved.audience_channel,
        audience_id: saved.audience_id,
        geojson: saved.geojson,
        updated_at: saved.updated_at,
    })
}

/// Load a saved local working draft from SQLite.
pub fn load_local_draft(
    database_path: String,
    draft_id: String,
) -> Result<Option<LocalDraftDto>, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let found = store.load(&draft_id).map_err(|e| e.to_string())?;
    Ok(found.map(|d| LocalDraftDto {
        draft_id: d.draft_id,
        d_tag: d.d_tag,
        entity_kind: d.entity_kind,
        title: d.title,
        description: d.description,
        audience_channel: d.audience_channel,
        audience_id: d.audience_id,
        geojson: d.geojson,
        updated_at: d.updated_at,
    }))
}

pub fn delete_local_draft(database_path: String, draft_id: String) -> Result<bool, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    store.delete(&draft_id).map_err(|e| e.to_string())
}

/// Lists all locally persisted SQLite working drafts ordered by most recently updated.
pub fn list_local_drafts(database_path: String) -> Result<Vec<LocalDraftDto>, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let drafts = store.list().map_err(|e| e.to_string())?;
    Ok(drafts
        .into_iter()
        .map(|d| LocalDraftDto {
            draft_id: d.draft_id,
            d_tag: d.d_tag,
            entity_kind: d.entity_kind,
            title: d.title,
            description: d.description,
            audience_channel: d.audience_channel,
            audience_id: d.audience_id,
            geojson: d.geojson,
            updated_at: d.updated_at,
        })
        .collect())
}

/// Validates a FeatureCollection with `earthly-geo`, attaches canonical Earthly
/// tags (`d`, `bbox`, multi-precision `g`, `crs`, `checksum`, `size`, `v`, `t`),
/// and returns an unsigned kind-37515 event JSON ready for NIP-55 Amber signing.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_map_event(
    pubkey_or_npub: String,
    d_tag: String,
    title: String,
    description: Option<String>,
    geojson: String,
    hashtags: Vec<String>,
    context_refs: Vec<String>,
    field_session_id: Option<String>,
) -> Result<UnsignedMapEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut fc: serde_json::Value =
        serde_json::from_str(&geojson).map_err(|err| format!("invalid GeoJSON: {err}"))?;
    let summary = validate_feature_collection(&fc).map_err(|err| err.to_string())?;
    if summary.feature_count == 0 {
        return Err("Draw at least one feature before publishing".to_owned());
    }

    if let Some(obj) = fc.as_object_mut() {
        if !title.trim().is_empty() {
            obj.insert(
                "name".to_owned(),
                serde_json::Value::String(title.trim().to_owned()),
            );
        }
        if let Some(desc) = description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            obj.insert(
                "description".to_owned(),
                serde_json::Value::String(desc.to_owned()),
            );
        }
    }

    let content = serde_json::to_string(&fc).map_err(|e| e.to_string())?;
    let checksum = format!("{:x}", Sha256::digest(content.as_bytes()));
    let size = content.len().to_string();

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["crs".to_owned(), "EPSG:4326".to_owned()],
        vec!["checksum".to_owned(), checksum.clone()],
        vec!["size".to_owned(), size],
        vec!["v".to_owned(), "1".to_owned()],
    ];
    tags = set_bbox(&tags, summary.bounds);
    tags = set_geohash(&tags, summary.centroid.map(|c| (c[0], c[1])), 6);
    tags = set_hashtags(&tags, &hashtags);
    if !context_refs.is_empty() {
        tags = set_context_refs(&tags, &context_refs);
    }
    if let Some(session_id) = field_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["h".to_owned(), session_id.to_owned()]);
    }

    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let unsigned = serde_json::json!({
        "kind": GEO_EVENT_KIND,
        "pubkey": pubkey_hex,
        "created_at": created_at,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedMapEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{GEO_EVENT_KIND}:{pubkey_hex}:{d_tag}"),
        feature_count: summary.feature_count as u32,
        checksum,
    })
}

#[derive(Clone, Debug)]
pub struct UnsignedSightingEventDto {
    pub unsigned_event_json: String,
    pub d_tag: String,
    pub address: String,
    pub start: u64,
    pub expires_at: u64,
}

/// Prepares a canonical Earthly v2 Temporal Sighting (kind 37522) event with
/// `modelVersion: "earthly/2"`, multi-precision `g` geohashes, `bbox`,
/// NIP-52 `start`, NIP-40 `expiration`, and optional NIP-92 `imeta` media tag.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_sighting_event(
    pubkey_or_npub: String,
    d_tag: String,
    title: Option<String>,
    note: String,
    lon: f64,
    lat: f64,
    duration_hours: u32,
    image_url: Option<String>,
    image_mime: Option<String>,
    image_sha256: Option<String>,
    hashtags: Vec<String>,
    field_session_id: Option<String>,
) -> Result<UnsignedSightingEventDto, String> {
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return Err("sighting coordinates out of WGS-84 range".to_owned());
    }
    let trimmed_note = note.trim();
    if trimmed_note.is_empty() && title.as_deref().map(str::trim).unwrap_or("").is_empty() {
        return Err("enter a title or observation note for the sighting".to_owned());
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let hours = duration_hours.clamp(1, 24 * 30) as u64;
    let expires_at = now.saturating_add(hours * 3600);

    let mut content_obj = serde_json::Map::new();
    content_obj.insert(
        "modelVersion".to_owned(),
        serde_json::Value::String(MODEL_VERSION.to_owned()),
    );
    if let Some(t) = title.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        content_obj.insert("title".to_owned(), serde_json::Value::String(t.to_owned()));
    }
    content_obj.insert(
        "note".to_owned(),
        serde_json::Value::String(trimmed_note.to_owned()),
    );
    content_obj.insert(
        "description".to_owned(),
        serde_json::Value::String(trimmed_note.to_owned()),
    );
    content_obj.insert(
        "geometry".to_owned(),
        serde_json::json!({ "type": "Point", "coordinates": [lon, lat] }),
    );
    content_obj.insert("lon".to_owned(), serde_json::json!(lon));
    content_obj.insert("lat".to_owned(), serde_json::json!(lat));
    content_obj.insert("start".to_owned(), serde_json::json!(now));
    content_obj.insert("end".to_owned(), serde_json::json!(expires_at));

    let content = serde_json::to_string(&serde_json::Value::Object(content_obj))
        .map_err(|e| e.to_string())?;

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["expiration".to_owned(), expires_at.to_string()],
    ];
    let bounds = Bounds::new(lon, lat, lon, lat).ok();
    tags = set_bbox(&tags, bounds);
    tags = set_geohash(&tags, Some((lon, lat)), 7);
    tags = set_hashtags(&tags, &hashtags);
    if let Some(session_id) = field_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["h".to_owned(), session_id.to_owned()]);
    }

    if let Some(url) = image_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        tags = set_images(
            &tags,
            &[ImetaAttachment {
                url: url.to_owned(),
                mime_type: image_mime,
                sha256: image_sha256,
                dimensions: None,
                blurhash: None,
                alt: title.clone(),
            }],
        )
        .map_err(|e| e.to_string())?;
    }

    let unsigned = serde_json::json!({
        "kind": TEMPORAL_SIGHTING_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedSightingEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{TEMPORAL_SIGHTING_KIND}:{pubkey_hex}:{d_tag}"),
        start: now,
        expires_at,
    })
}

/// Prepares a canonical Earthly v2 Live Beacon (`kind 37521`) event with
/// `modelVersion: "earthly/2"`, live coordinates (`lon`/`lat`), optional short
/// status message, `bbox`, multi-precision `g`, NIP-40 `expiration`, and
/// optional Nearby Field Session `h` tag.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_beacon_event(
    pubkey_or_npub: String,
    d_tag: String,
    lon: f64,
    lat: f64,
    status: Option<String>,
    duration_minutes: u32,
    field_session_id: Option<String>,
) -> Result<UnsignedSightingEventDto, String> {
    if !lon.is_finite()
        || !lat.is_finite()
        || !(-180.0..=180.0).contains(&lon)
        || !(-90.0..=90.0).contains(&lat)
    {
        return Err("beacon coordinates out of WGS-84 range".to_owned());
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let minutes = duration_minutes.clamp(5, 24 * 60) as u64;
    let expires_at = now.saturating_add(minutes * 60);

    let mut content_obj = serde_json::Map::new();
    content_obj.insert(
        "modelVersion".to_owned(),
        serde_json::Value::String(MODEL_VERSION.to_owned()),
    );
    content_obj.insert(
        "geometry".to_owned(),
        serde_json::json!({ "type": "Point", "coordinates": [lon, lat] }),
    );
    content_obj.insert("lon".to_owned(), serde_json::json!(lon));
    content_obj.insert("lat".to_owned(), serde_json::json!(lat));
    if let Some(st) = status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        content_obj.insert("label".to_owned(), serde_json::Value::String(st.to_owned()));
        content_obj.insert("status".to_owned(), serde_json::Value::String(st.to_owned()));
    }
    let content = serde_json::to_string(&serde_json::Value::Object(content_obj))
        .map_err(|e| e.to_string())?;

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["expiration".to_owned(), expires_at.to_string()],
    ];
    let bounds = Bounds::new(lon, lat, lon, lat).ok();
    tags = set_bbox(&tags, bounds);
    tags = set_geohash(&tags, Some((lon, lat)), 7);
    if let Some(session_id) = field_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["h".to_owned(), session_id.to_owned()]);
    }

    let unsigned = serde_json::json!({
        "kind": LIVE_BEACON_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedSightingEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{LIVE_BEACON_KIND}:{pubkey_hex}:{d_tag}"),
        start: now,
        expires_at,
    })
}

#[derive(Clone, Debug)]
pub struct UnsignedCommentEventDto {
    pub unsigned_event_json: String,
    pub d_tag: String,
    pub address: String,
}

/// Prepares a canonical NIP-22 Geo Comment (`kind 37517`) targeting an Earthly
/// entity (`root_address` e.g. `37515:<pubkey>:<d>`), optionally carrying a
/// GeoJSON FeatureCollection annotation with `bbox` and multi-precision `g`.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_comment_event(
    pubkey_or_npub: String,
    d_tag: String,
    root_address: String,
    root_kind: u16,
    root_pubkey: String,
    text: String,
    geojson: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("Comment text cannot be empty".to_owned());
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut body = serde_json::Map::new();
    body.insert(
        "text".to_owned(),
        serde_json::Value::String(trimmed.to_owned()),
    );

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["A".to_owned(), root_address.clone()],
        vec!["K".to_owned(), root_kind.to_string()],
        vec!["a".to_owned(), root_address],
        vec!["k".to_owned(), root_kind.to_string()],
    ];
    if !root_pubkey.trim().is_empty() {
        tags.push(vec!["P".to_owned(), root_pubkey.trim().to_owned()]);
        tags.push(vec!["p".to_owned(), root_pubkey.trim().to_owned()]);
    }

    if let Some(raw_geo) = geojson.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let fc: serde_json::Value = serde_json::from_str(raw_geo)
            .map_err(|err| format!("invalid comment GeoJSON: {err}"))?;
        let summary = validate_feature_collection(&fc).map_err(|err| err.to_string())?;
        if summary.feature_count > 0 {
            body.insert("geojson".to_owned(), fc);
            tags = set_bbox(&tags, summary.bounds);
            tags = set_geohash(&tags, summary.centroid.map(|c| (c[0], c[1])), 6);
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = serde_json::to_string(&serde_json::Value::Object(body))
        .map_err(|e| e.to_string())?;
    let unsigned = serde_json::json!({
        "kind": GEO_COMMENT_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{GEO_COMMENT_KIND}:{pubkey_hex}:{d_tag}"),
    })
}

/// Prepares a canonical Geo Edit Proposal (`kind 37519`) proposing a full
/// replacement FeatureCollection for an existing `37515` Map (`SPEC.md` §11).
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_proposal_event(
    pubkey_or_npub: String,
    d_tag: String,
    target_address: String,
    target_owner_pubkey: String,
    base_event_id: Option<String>,
    description: String,
    proposed_geojson: String,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let fc: serde_json::Value = serde_json::from_str(&proposed_geojson)
        .map_err(|err| format!("invalid proposed GeoJSON: {err}"))?;
    let summary = validate_feature_collection(&fc).map_err(|err| err.to_string())?;
    if summary.feature_count == 0 {
        return Err("Proposed map must contain at least one feature".to_owned());
    }

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["a".to_owned(), target_address],
        vec!["p".to_owned(), target_owner_pubkey],
    ];
    if let Some(base_id) = base_event_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        tags.push(vec!["base-version".to_owned(), base_id.to_owned()]);
    }
    if !description.trim().is_empty() {
        tags.push(vec![
            "description".to_owned(),
            description.trim().to_owned(),
        ]);
    }
    tags = set_bbox(&tags, summary.bounds);
    tags = set_geohash(&tags, summary.centroid.map(|c| (c[0], c[1])), 6);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = serde_json::to_string(&fc).map_err(|e| e.to_string())?;
    let unsigned = serde_json::json!({
        "kind": GEO_EDIT_PROPOSAL_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{GEO_EDIT_PROPOSAL_KIND}:{pubkey_hex}:{d_tag}"),
    })
}

#[derive(Clone, Debug)]
pub struct LocalKeypairDto {
    pub pubkey_hex: String,
    pub npub: String,
    pub nsec: String,
}

/// Generates a fresh Nostr keypair for Desktop (macOS/Linux/Windows) or offline
/// Field Session testing where Android NIP-55 Amber is not available.
pub fn generate_local_nostr_keypair() -> Result<LocalKeypairDto, String> {
    let keys = Keys::generate();
    let pubkey_hex = keys.public_key().to_hex();
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode npub: {e}"))?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode nsec: {e}"))?;
    Ok(LocalKeypairDto {
        pubkey_hex,
        npub,
        nsec,
    })
}

/// Validates and imports an existing `nsec1...` (or 64-char hex secret key),
/// returning its canonical `pubkey_hex`, `npub`, and `nsec` for persistent storage.
pub fn import_local_nostr_nsec(nsec_or_hex: String) -> Result<LocalKeypairDto, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|err| format!("invalid Nostr secret key: {err}"))?;
    let pubkey_hex = keys.public_key().to_hex();
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode npub: {e}"))?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode nsec: {e}"))?;
    Ok(LocalKeypairDto {
        pubkey_hex,
        npub,
        nsec,
    })
}

/// Prepares a canonical NIP-34 Proposal Status event (`1630` Open, `1631`
/// Applied/Merged, `1632` Closed, or `1633` Draft) targeting a `37519` Geo Edit Proposal.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_proposal_status_event(
    pubkey_or_npub: String,
    proposal_address: String,
    proposal_event_id: String,
    proposal_author_pubkey: String,
    status_kind: u16,
    note: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    if !matches!(
        status_kind,
        PROPOSAL_STATUS_OPEN_KIND
            | PROPOSAL_STATUS_APPLIED_KIND
            | PROPOSAL_STATUS_CLOSED_KIND
            | PROPOSAL_STATUS_DRAFT_KIND
    ) {
        return Err(format!("invalid NIP-34 proposal status kind {status_kind}"));
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut tags: Vec<Vec<String>> = vec![vec!["a".to_owned(), proposal_address.clone()]];
    if !proposal_event_id.trim().is_empty() {
        tags.push(vec!["e".to_owned(), proposal_event_id.trim().to_owned()]);
    }
    if !proposal_author_pubkey.trim().is_empty() {
        tags.push(vec!["p".to_owned(), proposal_author_pubkey.trim().to_owned()]);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = note.unwrap_or_default().trim().to_owned();
    let unsigned = serde_json::json!({
        "kind": status_kind,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: proposal_event_id,
        address: proposal_address,
    })
}

/// Parses an `nsec1...` or 64-char hex secret key and signs an unsigned Nostr
/// event JSON cleanly in Rust.
pub async fn sign_event_with_nsec(
    nsec_or_hex: String,
    unsigned_event_json: String,
) -> Result<String, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|err| format!("invalid Nostr secret key: {err}"))?;
    let mut unsigned = UnsignedEvent::from_json(&unsigned_event_json)
        .map_err(|err| format!("invalid unsigned event JSON: {err}"))?;
    unsigned.pubkey = keys.public_key();
    unsigned.ensure_id();
    let signed = unsigned
        .sign(&keys)
        .await
        .map_err(|err| format!("failed to sign event: {err}"))?;
    Ok(signed.as_json())
}

/// Prepares a canonical Earthly v2 Story / Article (`kind 37520`) event with
/// `modelVersion: "earthly/2"`, Markdown `content`, optional embedded
/// `presentation` JSON (views + layers), mirrored `a` dataset coordinates, and `t` tags.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_story_event(
    pubkey_or_npub: String,
    d_tag: String,
    title: String,
    summary: Option<String>,
    image: Option<String>,
    markdown_content: String,
    referenced_map_addresses: Vec<String>,
    presentation_json: Option<String>,
    hashtags: Vec<String>,
    field_session_id: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err("Story title cannot be empty".to_owned());
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut body = serde_json::Map::new();
    body.insert(
        "modelVersion".to_owned(),
        serde_json::Value::String(MODEL_VERSION.to_owned()),
    );
    body.insert(
        "title".to_owned(),
        serde_json::Value::String(trimmed_title.to_owned()),
    );
    if let Some(s) = summary.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body.insert("summary".to_owned(), serde_json::Value::String(s.to_owned()));
    }
    let clean_image = image
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if let Some(ref img) = clean_image {
        body.insert("image".to_owned(), serde_json::Value::String(img.clone()));
    }
    body.insert("publishedAt".to_owned(), serde_json::json!(now));
    body.insert(
        "content".to_owned(),
        serde_json::Value::String(markdown_content),
    );
    if let Some(pres) = presentation_json
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(parsed_pres) = serde_json::from_str::<serde_json::Value>(pres) {
            body.insert("presentation".to_owned(), parsed_pres);
        }
    }

    let mut tags: Vec<Vec<String>> = vec![vec!["d".to_owned(), d_tag.clone()]];
    if let Some(img) = clean_image {
        tags.push(vec!["image".to_owned(), img]);
    }
    tags = set_referenced_addresses(&tags, &referenced_map_addresses);
    tags = set_hashtags(&tags, &hashtags);
    if let Some(session_id) = field_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["h".to_owned(), session_id.to_owned()]);
    }

    let content = serde_json::to_string(&serde_json::Value::Object(body))
        .map_err(|e| e.to_string())?;
    let unsigned = serde_json::json!({
        "kind": ARTICLE_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{ARTICLE_KIND}:{pubkey_hex}:{d_tag}"),
    })
}

/// Prepares a canonical Earthly v2 Atlas / Group (`kind 37518`) event with
/// `modelVersion: "earthly/2"`, governance (`open` | `schema` | `closed`),
/// pinned dataset/story `a` tags, hashtags, and optional Nearby `h` tag.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_atlas_event(
    pubkey_or_npub: String,
    d_tag: String,
    name: String,
    description: Option<String>,
    image: Option<String>,
    governance: String,
    pinned_addresses: Vec<String>,
    hashtags: Vec<String>,
    field_session_id: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let trimmed_name = name.trim();
    if trimmed_name.is_empty() {
        return Err("Atlas name cannot be empty".to_owned());
    }
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let gov = match governance.trim().to_lowercase().as_str() {
        "schema" => "schema",
        "closed" => "closed",
        _ => "open",
    };
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut body = serde_json::Map::new();
    body.insert(
        "modelVersion".to_owned(),
        serde_json::Value::String(MODEL_VERSION.to_owned()),
    );
    body.insert(
        "name".to_owned(),
        serde_json::Value::String(trimmed_name.to_owned()),
    );
    if let Some(desc) = description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        body.insert(
            "description".to_owned(),
            serde_json::Value::String(desc.to_owned()),
        );
    }
    let clean_image = image
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if let Some(ref img) = clean_image {
        body.insert("image".to_owned(), serde_json::Value::String(img.clone()));
    }
    body.insert(
        "governance".to_owned(),
        serde_json::Value::String(gov.to_owned()),
    );

    let mut tags: Vec<Vec<String>> = vec![vec!["d".to_owned(), d_tag.clone()]];
    if let Some(img) = clean_image {
        tags.push(vec!["image".to_owned(), img]);
    }
    tags = set_referenced_addresses(&tags, &pinned_addresses);
    tags = set_hashtags(&tags, &hashtags);
    if let Some(session_id) = field_session_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["h".to_owned(), session_id.to_owned()]);
    }

    let content = serde_json::to_string(&serde_json::Value::Object(body))
        .map_err(|e| e.to_string())?;
    let unsigned = serde_json::json!({
        "kind": MAP_CONTEXT_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;

    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{MAP_CONTEXT_KIND}:{pubkey_hex}:{d_tag}"),
    })
}

/// Prepares a canonical Nostr `kind 0` user profile metadata event JSON
/// (`name`, `display_name`, `about`, `picture`, `nip05`) for signing and
/// publishing to configured relays.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_profile_event(
    pubkey_or_npub: String,
    name: Option<String>,
    display_name: Option<String>,
    about: Option<String>,
    picture: Option<String>,
    nip05: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut body = serde_json::Map::new();
    let mut insert_opt = |k: &str, v: Option<String>| {
        if let Some(clean) = v.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            body.insert(k.to_owned(), serde_json::Value::String(clean.to_owned()));
        }
    };
    insert_opt("name", name);
    insert_opt("display_name", display_name);
    insert_opt("about", about);
    insert_opt("picture", picture);
    insert_opt("nip05", nip05);

    if body.is_empty() {
        return Err("Enter at least a display name or handle before saving profile".to_owned());
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = serde_json::to_string(&serde_json::Value::Object(body))
        .map_err(|e| e.to_string())?;
    let unsigned = serde_json::json!({
        "kind": 0,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": [],
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: "profile".to_owned(),
        address: format!("0:{pubkey_hex}:profile"),
    })
}

/// Prepares a canonical NIP-09 deletion request (`kind 5`) targeting an owned
/// Earthly entity (Map `37515`, Story `37520`, Atlas `37518`, etc.).
pub fn prepare_unsigned_deletion_event(
    pubkey_or_npub: String,
    target_address: String,
    target_event_id: Option<String>,
    target_kind: u16,
    reason: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut tags: Vec<Vec<String>> = vec![
        vec!["a".to_owned(), target_address.clone()],
        vec!["k".to_owned(), target_kind.to_string()],
    ];
    if let Some(ev_id) = target_event_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["e".to_owned(), ev_id.to_owned()]);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let content = reason
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Deleted via Earthly")
        .to_owned();
    let unsigned = serde_json::json!({
        "kind": 5,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: target_address.clone(),
        address: target_address,
    })
}

/// Persists an already-signed Nostr event into the crash-safe SQLite outbox
/// BEFORE network transmission, delivers it to each target relay via `nostr-sdk`,
/// records per-relay acknowledgements, and returns the live outcome.
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

    // Claim for delivery and attempt transmission to each target relay.
    let _ = store.flush();
    let mut results = Vec::with_capacity(queued.relays.len());
    let mut ui_statuses = Vec::with_capacity(queued.relays.len());

    for relay in &queued.relays {
        let client = Client::default();
        let attempt = async {
            client
                .add_relay(&relay.relay_url)
                .await
                .map_err(|e| e.to_string())?;
            client.connect().await;
            let output = tokio::time::timeout(
                Duration::from_secs(8),
                client.send_event(&event),
            )
            .await
            .map_err(|_| "relay publish timed out".to_owned())?
            .map_err(|e| e.to_string())?;
            client.disconnect().await;
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
                    relay_url: relay.relay_url.clone(),
                    ok: true,
                    message: Some(msg.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: relay.relay_url.clone(),
                    ok: true,
                    message: Some(msg),
                });
            }
            Err(err) => {
                results.push(OutboxRelayResultInput {
                    relay_url: relay.relay_url.clone(),
                    ok: false,
                    message: Some(err.clone()),
                });
                ui_statuses.push(RelayDeliveryStatusDto {
                    relay_url: relay.relay_url.clone(),
                    ok: false,
                    message: Some(err),
                });
            }
        }
    }

    let updated = store
        .record_results(&queued.id, results)
        .map_err(|e| e.to_string())?;
    let state_str = format!("{:?}", updated.state).to_lowercase();

    Ok(PublishOutcomeDto {
        event_id: updated.event_id,
        outbox_state: state_str,
        relays: ui_statuses,
    })
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
    let state_str = format!("{:?}", updated.state).to_lowercase();

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

    #[test]
    fn prepares_canonical_unsigned_map_event_with_bbox_geohash_and_checksum() {
        let keys = Keys::generate();
        let fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"pt-1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Stephansdom"}}]}"#;
        let prepared = prepare_unsigned_map_event(
            keys.public_key().to_hex(),
            "vienna-test".to_owned(),
            "Vienna Landmarks".to_owned(),
            Some("Quick field map".to_owned()),
            fc.to_owned(),
            vec!["vienna".to_owned()],
            vec!["37518:abc:alpine-atlas".to_owned()],
            Some("field-1".to_owned()),
        )
        .unwrap();

        assert_eq!(prepared.feature_count, 1);
        assert!(prepared.address.starts_with("37515:"));
        let raw: serde_json::Value = serde_json::from_str(&prepared.unsigned_event_json).unwrap();
        assert_eq!(raw["kind"], 37_515);
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "bbox"));
        assert!(tags.iter().any(|t| t[0] == "g"));
        assert!(tags.iter().any(|t| t[0] == "c" && t[1] == "37518:abc:alpine-atlas"));
        assert!(tags.iter().any(|t| t[0] == "h" && t[1] == "field-1"));
        assert!(tags.iter().any(|t| t[0] == "checksum" && t[1] == prepared.checksum));
    }

    #[test]
    fn prepares_canonical_unsigned_sighting_event_with_imeta_and_expiry() {
        let keys = Keys::generate();
        let prepared = prepare_unsigned_sighting_event(
            keys.public_key().to_hex(),
            "sighting-1".to_owned(),
            Some("Peregrine Falcon".to_owned()),
            "Spotted near tower".to_owned(),
            16.3738,
            48.2082,
            24,
            Some("http://127.0.0.1:8080/abc.jpg".to_owned()),
            Some("image/jpeg".to_owned()),
            Some("deadbeef".to_owned()),
            vec!["wildlife".to_owned()],
            None,
        )
        .unwrap();

        assert!(prepared.address.starts_with("37522:"));
        assert!(prepared.expires_at > prepared.start);
        let raw: serde_json::Value = serde_json::from_str(&prepared.unsigned_event_json).unwrap();
        assert_eq!(raw["kind"], 37_522);
        let content: serde_json::Value =
            serde_json::from_str(raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["modelVersion"], "earthly/2");
        assert_eq!(content["title"], "Peregrine Falcon");
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "expiration"));
        assert!(tags.iter().any(|t| t[0] == "imeta"));
        assert!(tags.iter().any(|t| t[0] == "g"));
    }

    #[test]
    fn prepares_canonical_unsigned_live_beacon_event() {
        let keys = Keys::generate();
        let prepared = prepare_unsigned_beacon_event(
            keys.public_key().to_hex(),
            "live-field-beacon".to_owned(),
            16.3738,
            48.2082,
            Some("Surveying Danube bridge".to_owned()),
            60,
            Some("field-session-9".to_owned()),
        )
        .unwrap();

        assert!(prepared.address.starts_with("37521:"));
        assert_eq!(prepared.expires_at, prepared.start + 3600);
        let raw: serde_json::Value = serde_json::from_str(&prepared.unsigned_event_json).unwrap();
        assert_eq!(raw["kind"], 37_521);
        let content: serde_json::Value =
            serde_json::from_str(raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["modelVersion"], "earthly/2");
        assert_eq!(content["status"], "Surveying Danube bridge");
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "expiration"));
        assert!(tags.iter().any(|t| t[0] == "h" && t[1] == "field-session-9"));
        assert!(tags.iter().any(|t| t[0] == "g"));
    }

    #[test]
    fn prepares_canonical_unsigned_atlas_event() {
        let keys = Keys::generate();
        let pk = keys.public_key().to_hex();
        let prepared = prepare_unsigned_atlas_event(
            pk.clone(),
            "alpine-atlas".to_owned(),
            "Alpine Huts Atlas".to_owned(),
            Some("Curated trails and shelters".to_owned()),
            Some("https://blossom.earthly.city/cover.jpg".to_owned()),
            "schema".to_owned(),
            vec![format!("37515:{pk}:huts-2026")],
            vec!["alps".to_owned(), "hiking".to_owned()],
            None,
        )
        .unwrap();

        assert!(prepared.address.starts_with("37518:"));
        let raw: serde_json::Value = serde_json::from_str(&prepared.unsigned_event_json).unwrap();
        assert_eq!(raw["kind"], 37_518);
        let content: serde_json::Value =
            serde_json::from_str(raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["modelVersion"], "earthly/2");
        assert_eq!(content["governance"], "schema");
        assert_eq!(content["image"], "https://blossom.earthly.city/cover.jpg");
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "image" && t[1] == "https://blossom.earthly.city/cover.jpg"));
        assert!(tags.iter().any(|t| t[0] == "a" && t[1] == format!("37515:{pk}:huts-2026")));
        assert!(tags.iter().any(|t| t[0] == "t" && t[1] == "alps"));
    }

    #[test]
    fn prepares_proposal_status_and_imports_nsec() {
        let kp = generate_local_nostr_keypair().unwrap();
        let imported = import_local_nostr_nsec(kp.nsec.clone()).unwrap();
        assert_eq!(imported.pubkey_hex, kp.pubkey_hex);
        assert_eq!(imported.npub, kp.npub);

        let status = prepare_unsigned_proposal_status_event(
            kp.pubkey_hex.clone(),
            format!("37519:{}:pr-1", kp.pubkey_hex),
            "deadbeef".to_owned(),
            kp.pubkey_hex.clone(),
            PROPOSAL_STATUS_APPLIED_KIND,
            Some("Merged into map".to_owned()),
        )
        .unwrap();
        let raw: serde_json::Value = serde_json::from_str(&status.unsigned_event_json).unwrap();
        assert_eq!(raw["kind"], 1631);
        assert_eq!(raw["content"], "Merged into map");

        let profile = prepare_unsigned_profile_event(
            kp.pubkey_hex.clone(),
            Some("cartographer".to_owned()),
            Some("Field Cartographer".to_owned()),
            Some("Mapping alpine trails".to_owned()),
            Some("https://example.org/avatar.jpg".to_owned()),
            Some("cartographer@earthly.city".to_owned()),
        )
        .unwrap();
        let prof_raw: serde_json::Value =
            serde_json::from_str(&profile.unsigned_event_json).unwrap();
        assert_eq!(prof_raw["kind"], 0);
        let prof_content: serde_json::Value =
            serde_json::from_str(prof_raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(prof_content["display_name"], "Field Cartographer");
        assert_eq!(prof_content["nip05"], "cartographer@earthly.city");

        let del = prepare_unsigned_deletion_event(
            kp.pubkey_hex.clone(),
            format!("37515:{}:old-map", kp.pubkey_hex),
            Some("deadbeef".to_owned()),
            GEO_EVENT_KIND,
            Some("Replaced".to_owned()),
        )
        .unwrap();
        let del_raw: serde_json::Value = serde_json::from_str(&del.unsigned_event_json).unwrap();
        assert_eq!(del_raw["kind"], 5);
        assert_eq!(del_raw["content"], "Replaced");
        let del_tags = del_raw["tags"].as_array().unwrap();
        assert!(del_tags.iter().any(|t| t[0] == "a" && t[1] == format!("37515:{}:old-map", kp.pubkey_hex)));
        assert!(del_tags.iter().any(|t| t[0] == "k" && t[1] == "37515"));
    }
}
