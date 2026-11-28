//! Unsigned Nostr event builders for Earthly v2 entities (Maps, Sightings,
//! Live Beacons, Stories, Atlases, Comments, Proposals, Profiles, NIP-65, Zaps,
//! Reactions, Deletions, and Community Shoutbox).

use std::time::{SystemTime, UNIX_EPOCH};

use earthly_domain::{
    ARTICLE_KIND, GEO_COMMENT_KIND, GEO_EDIT_PROPOSAL_KIND, GEO_EVENT_KIND, ImetaAttachment,
    LIVE_BEACON_KIND, MAP_CONTEXT_KIND, MODEL_VERSION, PROPOSAL_STATUS_APPLIED_KIND,
    PROPOSAL_STATUS_CLOSED_KIND, PROPOSAL_STATUS_DRAFT_KIND, PROPOSAL_STATUS_OPEN_KIND,
    TEMPORAL_SIGHTING_KIND, set_bbox, set_context_refs, set_geohash, set_hashtags, set_images,
    set_referenced_addresses,
};
use earthly_geo::validate_feature_collection;
use earthly_spatial::Bounds;
use nostr::PublicKey;
use sha2::{Digest, Sha256};

use super::validation::compute_canonical_schema_hash;
use crate::api::nostr_client::RelayListEntryDto;

#[derive(Clone, Debug)]
pub struct ExternalGeoBlobDto {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug)]
pub struct UnsignedMapEventDto {
    pub unsigned_event_json: String,
    pub d_tag: String,
    pub address: String,
    pub feature_count: u32,
    pub checksum: String,
}

/// Validates a FeatureCollection with `earthly-geo`, attaches canonical Earthly
/// tags (`d`, `bbox`, multi-precision `g`, `crs`, `checksum`, `size`, `v`, `t`),
/// and returns an unsigned kind-37515 event JSON ready for signing.
///
/// When `external_blob` is supplied (for datasets exceeding the relay event size
/// budget, SPEC §1.5), attaches the canonical `["blob", "collection", url, ...]`
/// tag and keeps the event content as a lightweight metadata stub while
/// preserving full-dataset `bbox`, `g`, `checksum`, and `size`.
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
    external_blob: Option<ExternalGeoBlobDto>,
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

    let full_content = serde_json::to_string(&fc).map_err(|e| e.to_string())?;
    let checksum = format!("{:x}", Sha256::digest(full_content.as_bytes()));
    let size = full_content.len().to_string();

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["crs".to_owned(), "EPSG:4326".to_owned()],
        vec!["checksum".to_owned(), checksum.clone()],
        vec!["size".to_owned(), size],
        vec!["v".to_owned(), "1".to_owned()],
    ];

    let content = if let Some(blob) = external_blob {
        tags.push(vec![
            "blob".to_owned(),
            "collection".to_owned(),
            blob.url.trim().to_owned(),
            format!("sha256={}", blob.sha256.trim().to_lowercase()),
            format!("size={}", blob.size_bytes),
            "mime=application/geo+json".to_owned(),
        ]);
        let mut stub = serde_json::Map::new();
        stub.insert(
            "type".to_owned(),
            serde_json::Value::String("FeatureCollection".to_owned()),
        );
        if !title.trim().is_empty() {
            stub.insert(
                "name".to_owned(),
                serde_json::Value::String(title.trim().to_owned()),
            );
        }
        if let Some(desc) = description.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            stub.insert(
                "description".to_owned(),
                serde_json::Value::String(desc.to_owned()),
            );
        }
        stub.insert("features".to_owned(), serde_json::Value::Array(Vec::new()));
        serde_json::to_string(&serde_json::Value::Object(stub)).map_err(|e| e.to_string())?
    } else {
        full_content
    };
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
    if !lon.is_finite()
        || !lat.is_finite()
        || !(-180.0..=180.0).contains(&lon)
        || !(-90.0..=90.0).contains(&lat)
    {
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
/// entity (`root_address` e.g. `37515:<pubkey>:<d>`), or replying to an existing
/// comment when `parent_address` / `parent_event_id` are supplied, optionally
/// carrying a GeoJSON FeatureCollection annotation with `bbox` and `g`.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_comment_event(
    pubkey_or_npub: String,
    d_tag: String,
    root_address: String,
    root_kind: u16,
    root_pubkey: String,
    text: String,
    geojson: Option<String>,
    parent_address: Option<String>,
    parent_event_id: Option<String>,
    parent_pubkey: Option<String>,
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

    let is_reply = parent_address
        .as_deref()
        .map(str::trim)
        .is_some_and(|s| !s.is_empty())
        || parent_event_id
            .as_deref()
            .map(str::trim)
            .is_some_and(|s| !s.is_empty());

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["A".to_owned(), root_address.clone()],
        vec!["K".to_owned(), root_kind.to_string()],
    ];
    if !root_pubkey.trim().is_empty() {
        tags.push(vec!["P".to_owned(), root_pubkey.trim().to_owned()]);
    }

    if is_reply {
        if let Some(p_addr) = parent_address
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            tags.push(vec!["a".to_owned(), p_addr.to_owned()]);
        } else {
            tags.push(vec!["a".to_owned(), root_address]);
        }
        if let Some(p_ev) = parent_event_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            tags.push(vec!["e".to_owned(), p_ev.to_owned()]);
        }
        tags.push(vec!["k".to_owned(), GEO_COMMENT_KIND.to_string()]);
        let target_p = parent_pubkey
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(root_pubkey.trim());
        if !target_p.is_empty() {
            tags.push(vec!["p".to_owned(), target_p.to_owned()]);
        }
    } else {
        tags.push(vec!["a".to_owned(), root_address]);
        tags.push(vec!["k".to_owned(), root_kind.to_string()]);
        if !root_pubkey.trim().is_empty() {
            tags.push(vec!["p".to_owned(), root_pubkey.trim().to_owned()]);
        }
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
/// optional draft-2020-12 `schema` + `schema-hash`, pinned coordinates, and tags.
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
    schema_json: Option<String>,
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

    let mut computed_schema_hash: Option<String> = None;
    if gov == "schema" {
        if let Some(raw_schema) = schema_json.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            let parsed_schema: serde_json::Value = serde_json::from_str(raw_schema)
                .map_err(|e| format!("invalid Atlas schema JSON: {e}"))?;
            if !parsed_schema.is_object() {
                return Err("Atlas schema must be a JSON object".to_owned());
            }
            computed_schema_hash = Some(compute_canonical_schema_hash(&parsed_schema));
            body.insert("schema".to_owned(), parsed_schema);
        }
    }

    let mut tags: Vec<Vec<String>> = vec![vec!["d".to_owned(), d_tag.clone()]];
    if let Some(img) = clean_image {
        tags.push(vec!["image".to_owned(), img]);
    }
    if let Some(hash) = computed_schema_hash {
        tags.push(vec!["schema-hash".to_owned(), hash]);
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
/// (`name`, `display_name`, `about`, `picture`, `nip05`, `website`, `banner`,
/// `lud16`) for signing and publishing to configured relays.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_profile_event(
    pubkey_or_npub: String,
    name: Option<String>,
    display_name: Option<String>,
    about: Option<String>,
    picture: Option<String>,
    nip05: Option<String>,
    website: Option<String>,
    banner: Option<String>,
    lud16: Option<String>,
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
    insert_opt("website", website);
    insert_opt("banner", banner);
    insert_opt("lud16", lud16);

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

/// Prepares a canonical NIP-65 Relay List Metadata event (`kind 10002`)
/// declaring the user's read/write Nostr relays.
pub fn prepare_unsigned_relay_list_event(
    pubkey_or_npub: String,
    relays: Vec<RelayListEntryDto>,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut tags: Vec<Vec<String>> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for entry in relays {
        let clean = entry.url.trim().trim_end_matches('/').to_owned();
        if (!clean.starts_with("wss://") && !clean.starts_with("ws://"))
            || (!entry.read && !entry.write)
            || !seen.insert(clean.clone())
        {
            continue;
        }
        if entry.read && entry.write {
            tags.push(vec!["r".to_owned(), clean]);
        } else if entry.read {
            tags.push(vec!["r".to_owned(), clean, "read".to_owned()]);
        } else {
            tags.push(vec!["r".to_owned(), clean, "write".to_owned()]);
        }
    }
    if tags.is_empty() {
        return Err("Provide at least one valid wss:// relay URL for NIP-65".to_owned());
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let unsigned = serde_json::json!({
        "kind": 10002,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": "",
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: "relay-list".to_owned(),
        address: format!("10002:{pubkey_hex}:"),
    })
}

/// Prepares a canonical Story Edit Proposal (`kind 37519`) targeting an existing
/// `37520` Story (`SPEC.md` §17 / `STORY-06`) carrying the proposed replacement
/// Markdown body as raw `content`.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_story_proposal_event(
    pubkey_or_npub: String,
    d_tag: String,
    target_address: String,
    target_owner_pubkey: String,
    base_event_id: Option<String>,
    description: String,
    proposed_markdown: String,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();
    if proposed_markdown.trim().is_empty() {
        return Err("Proposed story content cannot be empty".to_owned());
    }

    let mut tags: Vec<Vec<String>> = vec![
        vec!["d".to_owned(), d_tag.clone()],
        vec!["a".to_owned(), target_address],
        vec!["p".to_owned(), target_owner_pubkey],
    ];
    if let Some(base_id) = base_event_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["base-version".to_owned(), base_id.to_owned()]);
    }
    if !description.trim().is_empty() {
        tags.push(vec![
            "description".to_owned(),
            description.trim().to_owned(),
        ]);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let unsigned = serde_json::json!({
        "kind": GEO_EDIT_PROPOSAL_KIND,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": proposed_markdown,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: d_tag.clone(),
        address: format!("{GEO_EDIT_PROPOSAL_KIND}:{pubkey_hex}:{d_tag}"),
    })
}

/// Prepares a canonical NIP-25 Reaction (`kind 7`) liking an Earthly entity
/// (`37515` Map, `37520` Story, `37518` Atlas, `37517` Comment, etc.).
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_reaction_event(
    pubkey_or_npub: String,
    target_address: String,
    target_event_id: Option<String>,
    target_pubkey: String,
    target_kind: u16,
    content: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();

    let mut tags: Vec<Vec<String>> = Vec::new();
    if !target_address.trim().is_empty() {
        tags.push(vec!["a".to_owned(), target_address.trim().to_owned()]);
    }
    tags.push(vec!["k".to_owned(), target_kind.to_string()]);
    if let Some(ev_id) = target_event_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["e".to_owned(), ev_id.to_owned()]);
    }
    if !target_pubkey.trim().is_empty() {
        tags.push(vec!["p".to_owned(), target_pubkey.trim().to_owned()]);
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let reaction_content = content
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("+")
        .to_owned();

    let unsigned = serde_json::json!({
        "kind": 7,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": reaction_content,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: target_address.clone(),
        address: target_address,
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

    let mut tags: Vec<Vec<String>> = Vec::new();
    if !target_address.trim().is_empty() {
        tags.push(vec!["a".to_owned(), target_address.trim().to_owned()]);
    }
    tags.push(vec!["k".to_owned(), target_kind.to_string()]);
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

fn shoutbox_filter_tag(category: &str) -> Result<&'static str, String> {
    match category.trim().to_ascii_lowercase().as_str() {
        "announcements" | "blog" => Ok("blog"),
        "features" | "feature" => Ok("feature"),
        "greetings" => Ok("greetings"),
        "bugs" | "bug" => Ok("bug"),
        other => Err(format!("Unsupported shoutbox category: {other}")),
    }
}

/// Prepares a NIP-57 Zap Request (`kind 9734`) unsigned Nostr event ready for
/// signing and passing as the `nostr` query parameter to an LNURL-pay callback.
#[allow(clippy::too_many_arguments)]
pub fn prepare_unsigned_zap_request_event(
    sender_pubkey_or_npub: String,
    recipient_pubkey_hex: String,
    amount_sats: u64,
    relay_urls: Vec<String>,
    target_event_id: Option<String>,
    target_address: Option<String>,
    comment: Option<String>,
    lnurl: Option<String>,
) -> Result<UnsignedCommentEventDto, String> {
    if amount_sats == 0 {
        return Err("Zap amount must be at least 1 sat".to_owned());
    }
    let sender = PublicKey::parse(sender_pubkey_or_npub.trim())
        .map_err(|err| format!("invalid sender public key: {err}"))?;
    let recipient = PublicKey::parse(recipient_pubkey_hex.trim())
        .map_err(|err| format!("invalid recipient public key: {err}"))?;
    let sender_hex = sender.to_hex();
    let recipient_hex = recipient.to_hex();
    let amount_msats = amount_sats.saturating_mul(1000);

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let clean_relays = crate::api::relay_pool::resolve_write_relays(&relay_urls, Some(9735));
    let mut relays_tag = Vec::with_capacity(1 + clean_relays.len());
    relays_tag.push("relays".to_owned());
    relays_tag.extend(clean_relays);

    let mut tags: Vec<Vec<String>> = vec![
        relays_tag,
        vec!["amount".to_owned(), amount_msats.to_string()],
        vec!["p".to_owned(), recipient_hex.clone()],
    ];
    if let Some(eid) = target_event_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["e".to_owned(), eid.to_owned()]);
    }
    let clean_addr = target_address
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    if let Some(ref addr) = clean_addr {
        tags.push(vec!["a".to_owned(), addr.clone()]);
    }
    if let Some(l) = lnurl
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tags.push(vec!["lnurl".to_owned(), l.to_owned()]);
    }

    let clean_comment = comment.unwrap_or_default().trim().to_owned();
    let unsigned = serde_json::json!({
        "kind": 9734,
        "pubkey": sender_hex,
        "created_at": now,
        "tags": tags,
        "content": clean_comment,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: format!("zap-{amount_sats}"),
        address: clean_addr.unwrap_or(recipient_hex),
    })
}

/// Prepares a Community Shoutbox note (`kind 1`) tagged `earthlycity` and the
/// requested category tag (`blog` / `feature` / `greetings` / `bug`).
pub fn prepare_unsigned_shoutbox_post(
    pubkey_or_npub: String,
    category: String,
    content: String,
) -> Result<UnsignedCommentEventDto, String> {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return Err("Shoutbox post cannot be empty".to_owned());
    }
    if trimmed.chars().count() > 4000 {
        return Err("Shoutbox post cannot exceed 4000 characters".to_owned());
    }
    let filter_tag = shoutbox_filter_tag(&category)?;
    let pubkey = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let pubkey_hex = pubkey.to_hex();
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let tags = vec![
        vec!["t".to_owned(), "earthlycity".to_owned()],
        vec!["t".to_owned(), filter_tag.to_owned()],
    ];
    let unsigned = serde_json::json!({
        "kind": 1,
        "pubkey": pubkey_hex,
        "created_at": now,
        "tags": tags,
        "content": trimmed,
    });
    let unsigned_event_json = serde_json::to_string(&unsigned).map_err(|e| e.to_string())?;
    Ok(UnsignedCommentEventDto {
        unsigned_event_json,
        d_tag: category,
        address: format!("1:{pubkey_hex}"),
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
            None,
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
    fn prepares_externalized_blossom_map_event_with_blob_tag_and_stub_content() {
        let keys = Keys::generate();
        let fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"pt-1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Stephansdom"}}]}"#;
        let sha = "a".repeat(64);
        let prepared = prepare_unsigned_map_event(
            keys.public_key().to_hex(),
            "large-vienna".to_owned(),
            "Large Vienna Dataset".to_owned(),
            Some("Externalized via Blossom".to_owned()),
            fc.to_owned(),
            vec!["vienna".to_owned()],
            vec![],
            None,
            Some(ExternalGeoBlobDto {
                url: format!("https://blossom.earthly.city/{sha}.geojson"),
                sha256: sha.clone(),
                size_bytes: 120_000,
            }),
        )
        .unwrap();

        assert_eq!(prepared.feature_count, 1);
        let raw: serde_json::Value = serde_json::from_str(&prepared.unsigned_event_json).unwrap();
        let content: serde_json::Value =
            serde_json::from_str(raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(content["name"], "Large Vienna Dataset");
        assert_eq!(content["features"].as_array().unwrap().len(), 0);
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "bbox"));
        assert!(tags.iter().any(|t| t[0] == "checksum" && t[1] == prepared.checksum));
        assert!(tags.iter().any(|t| {
            t[0] == "blob"
                && t[1] == "collection"
                && t[2] == format!("https://blossom.earthly.city/{sha}.geojson")
                && t[3] == format!("sha256={sha}")
                && t[4] == "size=120000"
                && t[5] == "mime=application/geo+json"
        }));
    }

    #[test]
    fn prepares_threaded_comment_story_proposal_and_reaction_events() {
        let keys = Keys::generate();
        let pk = keys.public_key().to_hex();
        let root_addr = format!("37520:{pk}:alpine-story");

        let reply = prepare_unsigned_comment_event(
            pk.clone(),
            "reply-1".to_owned(),
            root_addr.clone(),
            ARTICLE_KIND,
            pk.clone(),
            "Great trail notes!".to_owned(),
            None,
            Some(format!("37517:{pk}:parent-c1")),
            Some("deadbeef".to_owned()),
            Some("b".repeat(64)),
        )
        .unwrap();
        let reply_raw: serde_json::Value =
            serde_json::from_str(&reply.unsigned_event_json).unwrap();
        let r_tags = reply_raw["tags"].as_array().unwrap();
        assert!(r_tags.iter().any(|t| t[0] == "A" && t[1] == root_addr));
        assert!(r_tags.iter().any(|t| t[0] == "K" && t[1] == "37520"));
        assert!(r_tags.iter().any(|t| t[0] == "a" && t[1] == format!("37517:{pk}:parent-c1")));
        assert!(r_tags.iter().any(|t| t[0] == "e" && t[1] == "deadbeef"));
        assert!(r_tags.iter().any(|t| t[0] == "k" && t[1] == "37517"));
        assert!(r_tags.iter().any(|t| t[0] == "p" && t[1] == "b".repeat(64)));

        let story_pr = prepare_unsigned_story_proposal_event(
            pk.clone(),
            "story-pr-1".to_owned(),
            root_addr.clone(),
            pk.clone(),
            Some("base123".to_owned()),
            "Fix elevation typo".to_owned(),
            "# Updated Heading\n\nNew paragraph.".to_owned(),
        )
        .unwrap();
        let pr_raw: serde_json::Value =
            serde_json::from_str(&story_pr.unsigned_event_json).unwrap();
        assert_eq!(pr_raw["kind"], 37_519);
        assert_eq!(pr_raw["content"], "# Updated Heading\n\nNew paragraph.");
        let pr_tags = pr_raw["tags"].as_array().unwrap();
        assert!(pr_tags.iter().any(|t| t[0] == "a" && t[1] == root_addr));
        assert!(pr_tags.iter().any(|t| t[0] == "description" && t[1] == "Fix elevation typo"));

        let reaction = prepare_unsigned_reaction_event(
            pk.clone(),
            root_addr.clone(),
            Some("ev123".to_owned()),
            pk.clone(),
            ARTICLE_KIND,
            None,
        )
        .unwrap();
        let rx_raw: serde_json::Value =
            serde_json::from_str(&reaction.unsigned_event_json).unwrap();
        assert_eq!(rx_raw["kind"], 7);
        assert_eq!(rx_raw["content"], "+");
        let rx_tags = rx_raw["tags"].as_array().unwrap();
        assert!(rx_tags.iter().any(|t| t[0] == "a" && t[1] == root_addr));
        assert!(rx_tags.iter().any(|t| t[0] == "e" && t[1] == "ev123"));
        assert!(rx_tags.iter().any(|t| t[0] == "k" && t[1] == "37520"));

        let unlike = prepare_unsigned_deletion_event(
            pk,
            String::new(),
            Some("rx-event-id".to_owned()),
            7,
            Some("Unliked".to_owned()),
        )
        .unwrap();
        let unlike_raw: serde_json::Value =
            serde_json::from_str(&unlike.unsigned_event_json).unwrap();
        let u_tags = unlike_raw["tags"].as_array().unwrap();
        assert!(!u_tags.iter().any(|t| t[0] == "a"));
        assert!(u_tags.iter().any(|t| t[0] == "e" && t[1] == "rx-event-id"));
        assert!(u_tags.iter().any(|t| t[0] == "k" && t[1] == "7"));
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
        let schema_a = r#"{"type":"object","required":["hutName"],"properties":{"hutName":{"type":"string"},"geometry":{"type":"object","properties":{"type":{"enum":["Point"]}}}}}"#;
        let schema_b = r#"{"properties":{"geometry":{"properties":{"type":{"enum":["Point"]}},"type":"object"},"hutName":{"type":"string"}},"required":["hutName"],"type":"object"}"#;
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
            Some(schema_a.to_owned()),
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
        assert!(content["schema"].is_object());
        let tags = raw["tags"].as_array().unwrap();
        assert!(tags
            .iter()
            .any(|t| t[0] == "image" && t[1] == "https://blossom.earthly.city/cover.jpg"));
        assert!(tags
            .iter()
            .any(|t| t[0] == "a" && t[1] == format!("37515:{pk}:huts-2026")));
        assert!(tags.iter().any(|t| t[0] == "t" && t[1] == "alps"));
        let published_hash = tags
            .iter()
            .find(|t| t[0] == "schema-hash")
            .and_then(|t| t.get(1))
            .and_then(|v| v.as_str())
            .expect("schema-hash tag must be set")
            .to_owned();
        // Canonical schema hash is key-order independent!
        assert_eq!(
            compute_canonical_schema_hash(
                &serde_json::from_str::<serde_json::Value>(schema_b).unwrap()
            ),
            published_hash
        );

        let valid_fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[11.4,47.2]},"properties":{"hutName":"Olpererhutte"}}]}"#;
        let ok = super::super::validate_map_against_atlas_schema(
            valid_fc.to_owned(),
            schema_a.to_owned(),
            Some(published_hash.clone()),
        )
        .unwrap();
        assert!(ok.valid && ok.hash_verified);

        let bad_fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"l1","geometry":{"type":"LineString","coordinates":[[11.4,47.2],[11.5,47.3]]},"properties":{}}]}"#;
        let invalid = super::super::validate_map_against_atlas_schema(
            bad_fc.to_owned(),
            schema_a.to_owned(),
            Some(published_hash),
        )
        .unwrap();
        assert!(!invalid.valid && invalid.hash_verified);
        assert!(invalid.errors.len() >= 2);

        let tampered = super::super::validate_map_against_atlas_schema(
            valid_fc.to_owned(),
            schema_a.to_owned(),
            Some("sha256:0000".to_owned()),
        )
        .unwrap();
        assert!(!tampered.valid && !tampered.hash_verified);
    }

    #[test]
    fn prepares_proposal_status_and_imports_nsec() {
        let kp = super::super::generate_local_nostr_keypair().unwrap();
        let imported = super::super::import_local_nostr_nsec(kp.nsec.clone()).unwrap();
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
            Some("https://earthly.city".to_owned()),
            Some("https://example.org/banner.jpg".to_owned()),
            Some("cartographer@getalby.com".to_owned()),
        )
        .unwrap();
        let prof_raw: serde_json::Value =
            serde_json::from_str(&profile.unsigned_event_json).unwrap();
        assert_eq!(prof_raw["kind"], 0);
        let prof_content: serde_json::Value =
            serde_json::from_str(prof_raw["content"].as_str().unwrap()).unwrap();
        assert_eq!(prof_content["display_name"], "Field Cartographer");
        assert_eq!(prof_content["nip05"], "cartographer@earthly.city");
        assert_eq!(prof_content["website"], "https://earthly.city");
        assert_eq!(prof_content["banner"], "https://example.org/banner.jpg");
        assert_eq!(prof_content["lud16"], "cartographer@getalby.com");

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
        assert!(del_tags
            .iter()
            .any(|t| t[0] == "a" && t[1] == format!("37515:{}:old-map", kp.pubkey_hex)));
        assert!(del_tags.iter().any(|t| t[0] == "k" && t[1] == "37515"));

        let nip65 = prepare_unsigned_relay_list_event(
            kp.pubkey_hex.clone(),
            vec![
                RelayListEntryDto {
                    url: "wss://relay.earthly.city".to_owned(),
                    read: true,
                    write: true,
                },
                RelayListEntryDto {
                    url: "wss://nos.lol".to_owned(),
                    read: true,
                    write: false,
                },
            ],
        )
        .unwrap();
        let nip65_raw: serde_json::Value =
            serde_json::from_str(&nip65.unsigned_event_json).unwrap();
        assert_eq!(nip65_raw["kind"], 10002);
        let r_tags = nip65_raw["tags"].as_array().unwrap();
        assert_eq!(r_tags.len(), 2);
        assert_eq!(r_tags[0], serde_json::json!(["r", "wss://relay.earthly.city"]));
        assert_eq!(r_tags[1], serde_json::json!(["r", "wss://nos.lol", "read"]));

        let zap_req = prepare_unsigned_zap_request_event(
            kp.pubkey_hex.clone(),
            kp.pubkey_hex.clone(),
            210,
            vec!["wss://relay.earthly.city".to_owned()],
            Some("ev-123".to_owned()),
            Some(format!("37515:{}:vienna", kp.pubkey_hex)),
            Some("Great trail map!".to_owned()),
            None,
        )
        .unwrap();
        let zap_raw: serde_json::Value =
            serde_json::from_str(&zap_req.unsigned_event_json).unwrap();
        assert_eq!(zap_raw["kind"], 9734);
        assert_eq!(zap_raw["content"], "Great trail map!");
        let zap_tags = zap_raw["tags"].as_array().unwrap();
        assert!(zap_tags.iter().any(|t| t[0] == "amount" && t[1] == "210000"));
        assert!(zap_tags.iter().any(|t| t[0] == "p" && t[1] == kp.pubkey_hex));
        assert!(zap_tags.iter().any(|t| t[0] == "e" && t[1] == "ev-123"));

        let shout = prepare_unsigned_shoutbox_post(
            kp.pubkey_hex.clone(),
            "features".to_owned(),
            "Add contour hillshading support".to_owned(),
        )
        .unwrap();
        let shout_raw: serde_json::Value =
            serde_json::from_str(&shout.unsigned_event_json).unwrap();
        assert_eq!(shout_raw["kind"], 1);
        let shout_tags = shout_raw["tags"].as_array().unwrap();
        assert!(shout_tags
            .iter()
            .any(|t| t[0] == "t" && t[1] == "earthlycity"));
        assert!(shout_tags.iter().any(|t| t[0] == "t" && t[1] == "feature"));
    }
}
