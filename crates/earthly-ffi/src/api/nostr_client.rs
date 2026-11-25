//! Native Nostr relay client fetching real Earthly v2 entities (Maps 37515,
//! Atlases 37518, Stories 37520, Live Beacons 37521, Sightings 37522) and
//! parsing them through `earthly-domain`.

use std::collections::{BTreeMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::{
    ARTICLE_KIND, AtlasGroup, GEO_COMMENT_KIND, GEO_EDIT_PROPOSAL_KIND, GEO_EVENT_KIND,
    GeoComment, GeoEditProposal, LIVE_BEACON_KIND, LiveBeacon, MAP_CONTEXT_KIND, MapDataset,
    PROPOSAL_STATUS_APPLIED_KIND, PROPOSAL_STATUS_CLOSED_KIND, PROPOSAL_STATUS_DRAFT_KIND,
    PROPOSAL_STATUS_OPEN_KIND, ProposalStatus, RawNostrEvent, StoryArticle,
    TEMPORAL_SIGHTING_KIND, TemporalSighting, diff_feature_collections, is_expired,
};
use nostr::nips::nip01::Coordinate;
use nostr::nips::nip19::{FromBech32, Nip19Coordinate, ToBech32};
use nostr::{Alphabet, Event, Filter, Kind, PublicKey, RelayUrl, SingleLetterTag, Timestamp};
use nostr_sdk::{Client, RelayPoolNotification};

pub const DEFAULT_EARTHLY_RELAY: &str = "wss://relay.earthly.city";

#[derive(Clone, Debug)]
pub struct MapSummaryDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub title: String,
    pub description: Option<String>,
    pub feature_count: u32,
    pub size_bytes: u32,
    pub geojson: String,
    pub west: Option<f64>,
    pub south: Option<f64>,
    pub east: Option<f64>,
    pub north: Option<f64>,
    pub hashtags: Vec<String>,
    pub labels: Vec<String>,
    pub context_refs: Vec<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct StorySummaryDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub title: String,
    pub summary: Option<String>,
    pub image: Option<String>,
    pub content: String,
    pub presentation_json: Option<String>,
    pub referenced_addresses: Vec<String>,
    pub published_at: u64,
}

#[derive(Clone, Debug)]
pub struct ProfileMetadataDto {
    pub pubkey: String,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub about: Option<String>,
    pub picture: Option<String>,
    pub nip05: Option<String>,
}

/// Fetches Nostr `kind 0` author metadata profiles for the requested hex pubkeys.
pub async fn fetch_profiles(
    relay_urls: Vec<String>,
    pubkeys: Vec<String>,
) -> Result<Vec<ProfileMetadataDto>, String> {
    let mut authors = Vec::new();
    let mut seen = HashSet::new();
    for raw in pubkeys {
        if let Ok(pk) = PublicKey::parse(raw.trim()) {
            let hex = pk.to_hex();
            if seen.insert(hex) {
                authors.push(pk);
            }
        }
    }
    if authors.is_empty() {
        return Ok(Vec::new());
    }
    authors.truncate(60);

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let filter = Filter::new()
        .kind(Kind::Metadata)
        .authors(authors.clone())
        .limit(authors.len() * 2);

    let events = client
        .fetch_events(filter, Duration::from_secs(6))
        .await
        .map_err(|err| format!("failed to fetch author profiles: {err}"))?;
    client.disconnect().await;

    let mut latest: BTreeMap<String, (u64, String)> = BTreeMap::new();
    for ev in events.into_iter() {
        let pk = ev.pubkey.to_hex();
        let ts = ev.created_at.as_secs();
        let replace = latest.get(&pk).map(|(cur, _)| ts >= *cur).unwrap_or(true);
        if replace {
            latest.insert(pk, (ts, ev.content));
        }
    }

    let mut out = Vec::with_capacity(latest.len());
    for (pubkey, (_, content)) in latest {
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let pick_str = |key: &str| {
            json.get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
        };
        out.push(ProfileMetadataDto {
            pubkey,
            name: pick_str("name"),
            display_name: pick_str("display_name").or_else(|| pick_str("displayName")),
            about: pick_str("about"),
            picture: pick_str("picture"),
            nip05: pick_str("nip05"),
        });
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct PlaceSearchResultDto {
    pub name: String,
    pub subtitle: String,
    pub lon: f64,
    pub lat: f64,
    pub west: Option<f64>,
    pub south: Option<f64>,
    pub east: Option<f64>,
    pub north: Option<f64>,
}

/// Searches places via Photon (OpenStreetMap geocoder, zero API key) for fast
/// map jump-to navigation.
pub async fn search_places(query: String) -> Result<Vec<PlaceSearchResultDto>, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let resp = client
        .get("https://photon.komoot.io/api/")
        .query(&[("q", trimmed), ("limit", "6")])
        .send()
        .await
        .map_err(|e| format!("place search failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("geocoder HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid geocoder JSON: {e}"))?;

    let mut out = Vec::new();
    let Some(features) = body.get("features").and_then(|v| v.as_array()) else {
        return Ok(out);
    };
    for feat in features {
        let Some(coords) = feat
            .get("geometry")
            .and_then(|g| g.get("coordinates"))
            .and_then(|c| c.as_array())
        else {
            continue;
        };
        if coords.len() < 2 {
            continue;
        }
        let (Some(lon), Some(lat)) = (coords[0].as_f64(), coords[1].as_f64()) else {
            continue;
        };
        let props = feat.get("properties");
        let str_prop = |k: &str| {
            props
                .and_then(|p| p.get(k))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        let name = str_prop("name")
            .or_else(|| str_prop("street"))
            .or_else(|| str_prop("city"))
            .unwrap_or(trimmed)
            .to_owned();
        let mut sub_parts = Vec::new();
        for key in ["street", "city", "state", "country"] {
            if let Some(val) = str_prop(key) {
                if val != name && !sub_parts.contains(&val) {
                    sub_parts.push(val);
                }
            }
        }
        let extent = props
            .and_then(|p| p.get("extent"))
            .and_then(|e| e.as_array())
            .filter(|a| a.len() == 4);
        // Photon extent order is [west, north, east, south].
        let (west, north, east, south) = if let Some(ext) = extent {
            (
                ext[0].as_f64(),
                ext[1].as_f64(),
                ext[2].as_f64(),
                ext[3].as_f64(),
            )
        } else {
            (None, None, None, None)
        };
        out.push(PlaceSearchResultDto {
            name,
            subtitle: sub_parts.join(", "),
            lon,
            lat,
            west,
            south,
            east,
            north,
        });
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct DecodedNaddrDto {
    pub kind: u16,
    pub pubkey: String,
    pub d_tag: String,
    pub address: String,
    pub feature_id: Option<String>,
    pub relays: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct GeoCommentDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub text: String,
    pub geojson: Option<String>,
    pub root_address: Option<String>,
    pub parent_address: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct GeoProposalDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub target_address: String,
    pub description: Option<String>,
    pub status: String,
    pub geojson: String,
    pub added_count: u32,
    pub modified_count: u32,
    pub removed_count: u32,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct EntityDiscussionSnapshot {
    pub root_address: String,
    pub comments: Vec<GeoCommentDto>,
    pub proposals: Vec<GeoProposalDto>,
}

#[derive(Clone, Debug)]
pub struct AtlasSummaryDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub name: String,
    pub description: Option<String>,
    pub image: Option<String>,
    pub governance: String,
    pub pinned_addresses: Vec<String>,
    pub hashtags: Vec<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct SightingSummaryDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub title: Option<String>,
    pub note: String,
    pub lon: f64,
    pub lat: f64,
    pub image_url: Option<String>,
    pub start: u64,
    pub expires_at: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct LiveBeaconDto {
    pub address: String,
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub lon: f64,
    pub lat: f64,
    pub status: Option<String>,
    pub image_url: Option<String>,
    pub expires_at: Option<u64>,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct EarthlyCatalogSnapshot {
    pub relay_urls: Vec<String>,
    pub maps: Vec<MapSummaryDto>,
    pub stories: Vec<StorySummaryDto>,
    pub atlases: Vec<AtlasSummaryDto>,
    pub sightings: Vec<SightingSummaryDto>,
    pub beacons: Vec<LiveBeaconDto>,
}

/// Real-time parsed Earthly event pushed over a persistent relay WebSocket
/// subscription (`StreamSink<LiveRelayEventDto>`).
#[derive(Clone, Debug)]
pub struct LiveRelayEventDto {
    pub relay_url: String,
    pub kind: u16,
    pub map: Option<MapSummaryDto>,
    pub story: Option<StorySummaryDto>,
    pub atlas: Option<AtlasSummaryDto>,
    pub sighting: Option<SightingSummaryDto>,
    pub beacon: Option<LiveBeaconDto>,
}

/// Fetches the latest Earthly Maps, Stories, Atlases, and non-expired Sightings
/// from the specified relay URLs (defaulting to `wss://relay.earthly.city`).
pub async fn fetch_earthly_catalog(
    relay_urls: Vec<String>,
    limit_per_kind: u32,
) -> Result<EarthlyCatalogSnapshot, String> {
    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };
    let limit = (limit_per_kind as usize).clamp(1, 300);

    let client = Client::default();
    for url in &urls {
        client
            .add_relay(url)
            .await
            .map_err(|err| format!("invalid relay URL {url}: {err}"))?;
    }
    client.connect().await;

    // Query each Earthly entity kind in its own dedicated filter so busy kinds
    // (e.g. 100+ Maps) never starve Stories, Atlases, Beacons, or Sightings!
    let maps_filter = Filter::new().kind(Kind::Custom(GEO_EVENT_KIND)).limit(limit);
    let atlases_filter = Filter::new()
        .kind(Kind::Custom(MAP_CONTEXT_KIND))
        .limit(limit.min(150));
    let stories_filter = Filter::new()
        .kind(Kind::Custom(ARTICLE_KIND))
        .limit(limit.min(200));
    let beacons_filter = Filter::new()
        .kind(Kind::Custom(LIVE_BEACON_KIND))
        .limit(limit.min(100));
    let sightings_filter = Filter::new()
        .kind(Kind::Custom(TEMPORAL_SIGHTING_KIND))
        .limit(limit.min(150));

    let timeout = Duration::from_secs(9);
    let (maps_res, atlases_res, stories_res, beacons_res, sightings_res) = tokio::join!(
        client.fetch_events(maps_filter, timeout),
        client.fetch_events(atlases_filter, timeout),
        client.fetch_events(stories_filter, timeout),
        client.fetch_events(beacons_filter, timeout),
        client.fetch_events(sightings_filter, timeout),
    );

    client.disconnect().await;

    let mut all_events = Vec::new();
    let mut last_err: Option<String> = None;
    for res in [maps_res, atlases_res, stories_res, beacons_res, sightings_res] {
        match res {
            Ok(set) => all_events.extend(set.into_iter()),
            Err(err) => last_err = Some(err.to_string()),
        }
    }
    if all_events.is_empty() {
        if let Some(err) = last_err {
            return Err(format!("failed to fetch catalog from relays: {err}"));
        }
    }

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Deduplicate parameterized-replaceable events by (kind, pubkey, d), keeping newest.
    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for event in all_events {
        let raw = event_to_raw(&event);
        let Some(addr) = raw.address_coordinate() else {
            continue;
        };
        let replace = match latest_by_addr.get(&addr) {
            None => true,
            Some(existing) => {
                raw.created_at > existing.created_at
                    || (raw.created_at == existing.created_at && raw.id < existing.id)
            }
        };
        if replace {
            latest_by_addr.insert(addr, raw);
        }
    }

    // Also merge in any locally ingested / Nearby Field Session synced events
    // from the running embedded LocalNode (no NIP-42 WebSocket overhead needed!).
    if let Some(node) = crate::api::spike::current_node() {
        if let Ok(local_events) = node.query_earthly_events(160).await {
            for event in local_events {
                let raw = event_to_raw(&event);
                let Some(addr) = raw.address_coordinate() else {
                    continue;
                };
                let replace = match latest_by_addr.get(&addr) {
                    None => true,
                    Some(existing) => {
                        raw.created_at > existing.created_at
                            || (raw.created_at == existing.created_at && raw.id < existing.id)
                    }
                };
                if replace {
                    latest_by_addr.insert(addr, raw);
                }
            }
        }
    }

    let mut maps = Vec::new();
    let mut stories = Vec::new();
    let mut atlases = Vec::new();
    let mut sightings = Vec::new();
    let mut beacons = Vec::new();

    for (address, raw) in latest_by_addr {
        match raw.kind {
            GEO_EVENT_KIND => {
                if let Ok(dataset) = MapDataset::parse(&raw) {
                    maps.push(map_to_dto(address, dataset));
                }
            }
            ARTICLE_KIND => {
                if let Ok(story) = StoryArticle::parse(&raw) {
                    stories.push(story_to_dto(address, story));
                }
            }
            MAP_CONTEXT_KIND => {
                if let Ok(group) = AtlasGroup::parse(&raw) {
                    atlases.push(atlas_to_dto(address, group));
                }
            }
            LIVE_BEACON_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(beacon) = LiveBeacon::parse(&raw) {
                    beacons.push(beacon_to_dto(address, beacon));
                }
            }
            TEMPORAL_SIGHTING_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(sighting) = TemporalSighting::parse(&raw) {
                    sightings.push(sighting_to_dto(address, sighting));
                }
            }
            _ => {}
        }
    }

    maps.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    stories.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    atlases.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sightings.sort_by(|a, b| b.start.cmp(&a.start));
    beacons.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(EarthlyCatalogSnapshot {
        relay_urls: urls,
        maps,
        stories,
        atlases,
        sightings,
        beacons,
    })
}

/// Fast (~1 ms) local-only catalog read from the running embedded `LocalNode`
/// LMDB database — powers real-time live listening for incoming Nearby Field
/// Session Maps, Stories, Atlases, Sightings, and Live Beacons without hitting
/// public relays.
pub async fn fetch_local_node_catalog() -> Result<EarthlyCatalogSnapshot, String> {
    let Some(node) = crate::api::spike::current_node() else {
        return Ok(EarthlyCatalogSnapshot {
            relay_urls: Vec::new(),
            maps: Vec::new(),
            stories: Vec::new(),
            atlases: Vec::new(),
            sightings: Vec::new(),
            beacons: Vec::new(),
        });
    };
    let local_events = node
        .query_earthly_events(160)
        .await
        .map_err(|err| format!("failed to read local node events: {err}"))?;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for event in local_events {
        let raw = event_to_raw(&event);
        let Some(addr) = raw.address_coordinate() else {
            continue;
        };
        let replace = match latest_by_addr.get(&addr) {
            None => true,
            Some(existing) => {
                raw.created_at > existing.created_at
                    || (raw.created_at == existing.created_at && raw.id < existing.id)
            }
        };
        if replace {
            latest_by_addr.insert(addr, raw);
        }
    }

    let mut maps = Vec::new();
    let mut stories = Vec::new();
    let mut atlases = Vec::new();
    let mut sightings = Vec::new();
    let mut beacons = Vec::new();

    for (address, raw) in latest_by_addr {
        match raw.kind {
            GEO_EVENT_KIND => {
                if let Ok(dataset) = MapDataset::parse(&raw) {
                    maps.push(map_to_dto(address, dataset));
                }
            }
            ARTICLE_KIND => {
                if let Ok(story) = StoryArticle::parse(&raw) {
                    stories.push(story_to_dto(address, story));
                }
            }
            MAP_CONTEXT_KIND => {
                if let Ok(group) = AtlasGroup::parse(&raw) {
                    atlases.push(atlas_to_dto(address, group));
                }
            }
            LIVE_BEACON_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(beacon) = LiveBeacon::parse(&raw) {
                    beacons.push(beacon_to_dto(address, beacon));
                }
            }
            TEMPORAL_SIGHTING_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(sighting) = TemporalSighting::parse(&raw) {
                    sightings.push(sighting_to_dto(address, sighting));
                }
            }
            _ => {}
        }
    }

    maps.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    stories.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    atlases.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sightings.sort_by(|a, b| b.start.cmp(&a.start));
    beacons.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(EarthlyCatalogSnapshot {
        relay_urls: vec![node.descriptor().relay_url.to_string()],
        maps,
        stories,
        atlases,
        sightings,
        beacons,
    })
}

/// Opens a persistent Nostr WebSocket subscription to the configured relays for
/// live Earthly v2 entities (`37515`, `37518`, `37520`, `37521`, `37522`) arriving
/// after connect, pushing parsed events directly into Flutter via `StreamSink`.
pub async fn subscribe_earthly_relay_stream(
    relay_urls: Vec<String>,
    sink: crate::frb_generated::StreamSink<LiveRelayEventDto>,
) -> Result<(), String> {
    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        client
            .add_relay(url)
            .await
            .map_err(|err| format!("invalid relay URL {url}: {err}"))?;
    }
    client.connect().await;

    let filter = Filter::new()
        .kinds([
            Kind::Custom(GEO_EVENT_KIND),
            Kind::Custom(MAP_CONTEXT_KIND),
            Kind::Custom(ARTICLE_KIND),
            Kind::Custom(LIVE_BEACON_KIND),
            Kind::Custom(TEMPORAL_SIGHTING_KIND),
        ])
        .since(Timestamp::now());

    client
        .subscribe(filter, None)
        .await
        .map_err(|err| format!("failed to subscribe to Earthly relays: {err}"))?;

    let mut notifications = client.notifications();
    let mut seen_ids: HashSet<String> = HashSet::new();

    loop {
        match notifications.recv().await {
            Ok(RelayPoolNotification::Event {
                relay_url, event, ..
            }) => {
                let raw = event_to_raw(&event);
                if !seen_ids.insert(raw.id.clone()) {
                    continue;
                }
                if seen_ids.len() > 2048 {
                    seen_ids.clear();
                }
                let now = SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                if let Some(dto) = parse_live_relay_event(relay_url.to_string(), &raw, now) {
                    if sink.add(dto).is_err() {
                        break;
                    }
                }
            }
            Ok(RelayPoolNotification::Shutdown) => break,
            Ok(_) => {}
            Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }

    client.disconnect().await;
    Ok(())
}

/// Decodes a `nostr:naddr1...` (with optional `#featureId` fragment) or bare
/// `naddr1...` into its canonical `<kind>:<pubkey>:<d>` coordinate and optional
/// percent-decoded feature id (`SPEC.md` §2.4).
pub fn decode_naddr_coordinate(naddr_uri: String) -> Option<DecodedNaddrDto> {
    let trimmed = naddr_uri.trim();
    let without_scheme = trimmed
        .strip_prefix("nostr:")
        .or_else(|| trimmed.strip_prefix("NOSTR:"))
        .unwrap_or(trimmed);
    let (bech32_part, raw_fragment) = match without_scheme.split_once('#') {
        Some((b, f)) => (b, Some(f)),
        None => (without_scheme, None),
    };
    let clean_bech32 = bech32_part.trim_end_matches(|c: char| {
        matches!(c, '.' | ',' | ';' | ')' | ']' | '!' | '?' | '"' | '\'')
    });
    let coord = Nip19Coordinate::from_bech32(clean_bech32).ok()?;
    let kind = coord.coordinate.kind.as_u16();
    let pubkey = coord.coordinate.public_key.to_hex();
    let d_tag = coord.coordinate.identifier;
    let address = format!("{kind}:{pubkey}:{d_tag}");
    let feature_id = raw_fragment
        .map(|frag| {
            let trimmed_frag = frag.trim_end_matches(|c: char| {
                matches!(c, '.' | ',' | ';' | ')' | ']' | '!' | '?' | '"' | '\'')
            });
            percent_decode_fragment(trimmed_frag)
        })
        .filter(|f| !f.is_empty());
    let relays = coord.relays.into_iter().map(|r| r.to_string()).collect();

    Some(DecodedNaddrDto {
        kind,
        pubkey,
        d_tag,
        address,
        feature_id,
        relays,
    })
}

/// Encodes an Earthly entity coordinate (`kind`, `pubkey_hex`, `d_tag`, relay
/// hints, and optional `#feature_id`) into a canonical shareable `nostr:naddr1...`
/// URI (`SPEC.md` §2.4).
pub fn encode_naddr_coordinate(
    kind: u16,
    pubkey_hex: String,
    d_tag: String,
    relays: Vec<String>,
    feature_id: Option<String>,
) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_hex.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let coordinate = Coordinate::new(Kind::Custom(kind), pk).identifier(d_tag);
    let parsed_relays: Vec<RelayUrl> = relays
        .into_iter()
        .filter_map(|r| RelayUrl::parse(r.trim()).ok())
        .take(3)
        .collect();
    let nip19 = Nip19Coordinate::new(coordinate, parsed_relays);
    let bech32 = nip19
        .to_bech32()
        .map_err(|err| format!("failed to encode naddr: {err}"))?;
    let mut uri = format!("nostr:{bech32}");
    if let Some(frag) = feature_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        uri.push('#');
        uri.push_str(frag);
    }
    Ok(uri)
}

/// Fetches a single addressable Earthly entity (Map `37515`, Story `37520`, or
/// Atlas `37518`) by its canonical `<kind>:<pubkey>:<d>` coordinate — used when
/// opening shared `nostr:naddr1...` links or QR codes.
pub async fn fetch_entity_by_address(
    relay_urls: Vec<String>,
    address: String,
) -> Result<Option<LiveRelayEventDto>, String> {
    let mut parts = address.splitn(3, ':');
    let kind_num = parts
        .next()
        .and_then(|s| s.parse::<u16>().ok())
        .ok_or_else(|| "invalid address kind".to_owned())?;
    let pk_hex = parts.next().ok_or_else(|| "missing address pubkey".to_owned())?;
    let d_tag = parts.next().ok_or_else(|| "missing address d-tag".to_owned())?;
    if d_tag.is_empty() {
        return Err("empty address d-tag".to_owned());
    }
    let pk = PublicKey::from_hex(pk_hex)
        .map_err(|err| format!("invalid address pubkey: {err}"))?;

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let filter = Filter::new()
        .kind(Kind::Custom(kind_num))
        .author(pk)
        .identifier(d_tag)
        .limit(3);

    let events = client
        .fetch_events(filter, Duration::from_secs(8))
        .await
        .map_err(|err| format!("failed to fetch entity: {err}"))?;
    client.disconnect().await;

    let mut newest: Option<RawNostrEvent> = None;
    for ev in events.into_iter() {
        let raw = event_to_raw(&ev);
        if raw.address_coordinate().as_deref() != Some(address.as_str()) {
            continue;
        }
        let replace = newest
            .as_ref()
            .map(|cur| raw.created_at > cur.created_at)
            .unwrap_or(true);
        if replace {
            newest = Some(raw);
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(newest.and_then(|raw| parse_live_relay_event(urls[0].clone(), &raw, now)))
}

/// Fetches specific kind-37515 Map Datasets by their canonical
/// `37515:<pubkey>:<d-tag>` coordinates (used when opening a Story or Atlas
/// whose referenced datasets are not yet in the local catalog).
pub async fn fetch_maps_by_addresses(
    relay_urls: Vec<String>,
    addresses: Vec<String>,
) -> Result<Vec<MapSummaryDto>, String> {
    let mut parsed_targets: Vec<(PublicKey, String, String)> = Vec::new();
    let mut wanted_set: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();

    for addr in addresses {
        let mut parts = addr.splitn(3, ':');
        let Some(kind_str) = parts.next() else {
            continue;
        };
        let Some(pubkey_str) = parts.next() else {
            continue;
        };
        let Some(d_tag) = parts.next() else {
            continue;
        };
        if kind_str.parse::<u16>().ok() != Some(GEO_EVENT_KIND) || d_tag.is_empty() {
            continue;
        }
        let Ok(pk) = PublicKey::from_hex(pubkey_str) else {
            continue;
        };
        let canonical = format!("{GEO_EVENT_KIND}:{}:{d_tag}", pk.to_hex());
        if wanted_set.insert(canonical.clone()) {
            parsed_targets.push((pk, d_tag.to_owned(), canonical));
        }
    }

    if parsed_targets.is_empty() {
        return Ok(Vec::new());
    }

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let authors: Vec<PublicKey> = parsed_targets.iter().map(|(pk, _, _)| *pk).collect();
    let identifiers: Vec<String> = parsed_targets.iter().map(|(_, d, _)| d.clone()).collect();
    let filter = Filter::new()
        .kind(Kind::Custom(GEO_EVENT_KIND))
        .authors(authors)
        .identifiers(identifiers)
        .limit(parsed_targets.len().max(1) * 3);

    let events = client
        .fetch_events(filter, Duration::from_secs(8))
        .await
        .map_err(|err| format!("failed to fetch referenced maps: {err}"))?;
    client.disconnect().await;

    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for event in events.into_iter() {
        let raw = event_to_raw(&event);
        let Some(addr) = raw.address_coordinate() else {
            continue;
        };
        if !wanted_set.contains(&addr) {
            continue;
        }
        let replace = match latest_by_addr.get(&addr) {
            None => true,
            Some(existing) => {
                raw.created_at > existing.created_at
                    || (raw.created_at == existing.created_at && raw.id < existing.id)
            }
        };
        if replace {
            latest_by_addr.insert(addr, raw);
        }
    }

    let mut out = Vec::new();
    for (address, raw) in latest_by_addr {
        if let Ok(dataset) = MapDataset::parse(&raw) {
            out.push(map_to_dto(address, dataset));
        }
    }
    Ok(out)
}

/// Fetches NIP-22 Geo Comments (`kind 37517`), Geo Edit Proposals (`kind 37519`),
/// and NIP-34 proposal status events (`1630`–`1633`) attached to a target Earthly
/// entity address (e.g. `37515:<pubkey>:<d>` or `37520:<pubkey>:<d>`).
///
/// When `base_geojson` is provided, computes deterministic `+added / ~modified / -removed`
/// feature diffs via `earthly_domain::diff_feature_collections`.
pub async fn fetch_entity_discussion(
    relay_urls: Vec<String>,
    root_address: String,
    base_geojson: Option<String>,
) -> Result<EntityDiscussionSnapshot, String> {
    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };
    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let comments_filter_upper = Filter::new()
        .kind(Kind::Custom(GEO_COMMENT_KIND))
        .custom_tag(SingleLetterTag::uppercase(Alphabet::A), root_address.clone())
        .limit(80);
    let comments_filter_lower = Filter::new()
        .kind(Kind::Custom(GEO_COMMENT_KIND))
        .custom_tag(SingleLetterTag::lowercase(Alphabet::A), root_address.clone())
        .limit(80);
    let proposals_filter = Filter::new()
        .kind(Kind::Custom(GEO_EDIT_PROPOSAL_KIND))
        .custom_tag(SingleLetterTag::lowercase(Alphabet::A), root_address.clone())
        .limit(40);

    let (upper_ev, lower_ev, prop_ev) = tokio::join!(
        client.fetch_events(comments_filter_upper, Duration::from_secs(6)),
        client.fetch_events(comments_filter_lower, Duration::from_secs(6)),
        client.fetch_events(proposals_filter, Duration::from_secs(6)),
    );

    let mut latest_comments: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for set in [upper_ev, lower_ev].into_iter().flatten() {
        for ev in set.into_iter() {
            let raw = event_to_raw(&ev);
            let key = raw.address_coordinate().unwrap_or_else(|| raw.id.clone());
            let replace = latest_comments
                .get(&key)
                .map(|cur| raw.created_at > cur.created_at)
                .unwrap_or(true);
            if replace {
                latest_comments.insert(key, raw);
            }
        }
    }

    let mut latest_proposals: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    if let Ok(set) = prop_ev {
        for ev in set.into_iter() {
            let raw = event_to_raw(&ev);
            let Some(addr) = raw.address_coordinate() else {
                continue;
            };
            let replace = latest_proposals
                .get(&addr)
                .map(|cur| raw.created_at > cur.created_at)
                .unwrap_or(true);
            if replace {
                latest_proposals.insert(addr, raw);
            }
        }
    }

    // Fetch NIP-34 status events (1630..=1633) for discovered proposals.
    let mut status_by_proposal: BTreeMap<String, (u64, ProposalStatus)> = BTreeMap::new();
    if !latest_proposals.is_empty() {
        let prop_addrs: Vec<String> = latest_proposals.keys().cloned().collect();
        let status_filter = Filter::new()
            .kinds([
                Kind::Custom(PROPOSAL_STATUS_OPEN_KIND),
                Kind::Custom(PROPOSAL_STATUS_APPLIED_KIND),
                Kind::Custom(PROPOSAL_STATUS_CLOSED_KIND),
                Kind::Custom(PROPOSAL_STATUS_DRAFT_KIND),
            ])
            .custom_tags(SingleLetterTag::lowercase(Alphabet::A), prop_addrs)
            .limit(80);
        if let Ok(status_events) = client
            .fetch_events(status_filter, Duration::from_secs(5))
            .await
        {
            for ev in status_events.into_iter() {
                let raw = event_to_raw(&ev);
                let Some(status) = ProposalStatus::from_status_kind(raw.kind) else {
                    continue;
                };
                if let Some(prop_addr) = earthly_domain::get_tag_value(&raw.tags, "a") {
                    let replace = status_by_proposal
                        .get(prop_addr)
                        .map(|(ts, _)| raw.created_at >= *ts)
                        .unwrap_or(true);
                    if replace {
                        status_by_proposal.insert(prop_addr.to_owned(), (raw.created_at, status));
                    }
                }
            }
        }
    }

    client.disconnect().await;

    let mut comments = Vec::new();
    for (address, raw) in latest_comments {
        if let Ok(c) = GeoComment::parse(&raw) {
            let geojson = c
                .geojson
                .as_ref()
                .and_then(|v| serde_json::to_string(v).ok());
            comments.push(GeoCommentDto {
                address,
                event_id: c.event_id,
                pubkey: c.pubkey,
                d_tag: c.d_tag,
                text: c.text,
                geojson,
                root_address: c.root_address,
                parent_address: c.parent_address,
                created_at: c.created_at,
            });
        }
    }
    comments.sort_by(|a, b| a.created_at.cmp(&b.created_at));

    let base_fc: Option<serde_json::Value> = base_geojson
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok());

    let mut proposals = Vec::new();
    for (address, raw) in latest_proposals {
        if let Ok(p) = GeoEditProposal::parse(&raw) {
            let status_enum = status_by_proposal
                .get(&address)
                .map(|(_, s)| *s)
                .unwrap_or(ProposalStatus::Open);
            let status = match status_enum {
                ProposalStatus::Open => "open",
                ProposalStatus::Applied => "applied",
                ProposalStatus::Closed => "closed",
                ProposalStatus::Draft => "draft",
            };
            let diff = base_fc
                .as_ref()
                .map(|base| diff_feature_collections(base, &p.feature_collection))
                .unwrap_or_default();
            let geojson = serde_json::to_string(&p.feature_collection).unwrap_or_default();
            proposals.push(GeoProposalDto {
                address,
                event_id: p.event_id,
                pubkey: p.pubkey,
                d_tag: p.d_tag,
                target_address: p.target_address,
                description: p.description,
                status: status.to_owned(),
                geojson,
                added_count: diff.added.len() as u32,
                modified_count: diff.modified.len() as u32,
                removed_count: diff.removed.len() as u32,
                created_at: p.created_at,
            });
        }
    }
    proposals.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(EntityDiscussionSnapshot {
        root_address,
        comments,
        proposals,
    })
}

fn percent_decode_fragment(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_owned())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn event_to_raw(event: &Event) -> RawNostrEvent {
    RawNostrEvent {
        id: event.id.to_hex(),
        pubkey: event.pubkey.to_hex(),
        created_at: event.created_at.as_secs(),
        kind: event.kind.as_u16(),
        tags: event
            .tags
            .iter()
            .map(|tag| tag.as_slice().to_vec())
            .collect(),
        content: event.content.clone(),
    }
}

fn map_to_dto(address: String, dataset: MapDataset) -> MapSummaryDto {
    let feature_count = dataset
        .feature_collection
        .get("features")
        .and_then(|v| v.as_array())
        .map(|arr| arr.len() as u32)
        .unwrap_or(0);
    let title = dataset
        .name
        .unwrap_or_else(|| format!("Map {}", &dataset.d_tag));
    let geojson = serde_json::to_string(&dataset.feature_collection).unwrap_or_default();
    let size_bytes = geojson.len() as u32;

    MapSummaryDto {
        address,
        event_id: dataset.event_id,
        pubkey: dataset.pubkey,
        d_tag: dataset.d_tag,
        title,
        description: dataset.description,
        feature_count,
        size_bytes,
        geojson,
        west: dataset.bbox.map(|b| b.west),
        south: dataset.bbox.map(|b| b.south),
        east: dataset.bbox.map(|b| b.east),
        north: dataset.bbox.map(|b| b.north),
        hashtags: dataset.hashtags,
        labels: dataset.labels,
        context_refs: dataset.context_refs,
        created_at: dataset.created_at,
    }
}

fn story_to_dto(address: String, story: StoryArticle) -> StorySummaryDto {
    let presentation_json = story
        .presentation
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());
    StorySummaryDto {
        address,
        event_id: story.event_id,
        pubkey: story.pubkey,
        d_tag: story.d_tag,
        title: story.title,
        summary: story.summary,
        image: story.image,
        content: story.content,
        presentation_json,
        referenced_addresses: story.referenced_addresses,
        published_at: story.published_at,
    }
}

fn atlas_to_dto(address: String, group: AtlasGroup) -> AtlasSummaryDto {
    let governance = match group.governance {
        earthly_domain::GovernanceMode::Open => "open",
        earthly_domain::GovernanceMode::Schema => "schema",
        earthly_domain::GovernanceMode::Closed => "closed",
    };
    AtlasSummaryDto {
        address,
        event_id: group.event_id,
        pubkey: group.pubkey,
        d_tag: group.d_tag,
        name: group.name,
        description: group.description,
        image: group.image,
        governance: governance.to_owned(),
        pinned_addresses: group.pinned_addresses,
        hashtags: group.hashtags,
        created_at: group.created_at,
    }
}

fn sighting_to_dto(address: String, sighting: TemporalSighting) -> SightingSummaryDto {
    SightingSummaryDto {
        address,
        event_id: sighting.event_id,
        pubkey: sighting.pubkey,
        d_tag: sighting.d_tag,
        title: sighting.title,
        note: sighting.note,
        lon: sighting.lon,
        lat: sighting.lat,
        image_url: sighting.images.first().map(|img| img.url.clone()),
        start: sighting.start,
        expires_at: sighting.expires_at,
    }
}

fn beacon_to_dto(address: String, beacon: LiveBeacon) -> LiveBeaconDto {
    LiveBeaconDto {
        address,
        event_id: beacon.event_id,
        pubkey: beacon.pubkey,
        d_tag: beacon.d_tag,
        lon: beacon.lon,
        lat: beacon.lat,
        status: beacon.status,
        image_url: beacon.images.first().map(|img| img.url.clone()),
        expires_at: beacon.expires_at,
        created_at: beacon.created_at,
    }
}

fn parse_live_relay_event(
    relay_url: String,
    raw: &RawNostrEvent,
    now: u64,
) -> Option<LiveRelayEventDto> {
    let address = raw.address_coordinate()?;
    match raw.kind {
        GEO_EVENT_KIND => MapDataset::parse(raw).ok().map(|d| LiveRelayEventDto {
            relay_url,
            kind: raw.kind,
            map: Some(map_to_dto(address, d)),
            story: None,
            atlas: None,
            sighting: None,
            beacon: None,
        }),
        ARTICLE_KIND => StoryArticle::parse(raw).ok().map(|s| LiveRelayEventDto {
            relay_url,
            kind: raw.kind,
            map: None,
            story: Some(story_to_dto(address, s)),
            atlas: None,
            sighting: None,
            beacon: None,
        }),
        MAP_CONTEXT_KIND => AtlasGroup::parse(raw).ok().map(|g| LiveRelayEventDto {
            relay_url,
            kind: raw.kind,
            map: None,
            story: None,
            atlas: Some(atlas_to_dto(address, g)),
            sighting: None,
            beacon: None,
        }),
        LIVE_BEACON_KIND => {
            if is_expired(&raw.tags, now) {
                return None;
            }
            LiveBeacon::parse(raw).ok().map(|b| LiveRelayEventDto {
                relay_url,
                kind: raw.kind,
                map: None,
                story: None,
                atlas: None,
                sighting: None,
                beacon: Some(beacon_to_dto(address, b)),
            })
        }
        TEMPORAL_SIGHTING_KIND => {
            if is_expired(&raw.tags, now) {
                return None;
            }
            TemporalSighting::parse(raw).ok().map(|s| LiveRelayEventDto {
                relay_url,
                kind: raw.kind,
                map: None,
                story: None,
                atlas: None,
                sighting: Some(sighting_to_dto(address, s)),
                beacon: None,
            })
        }
        _ => None,
    }
}

#[derive(Clone, Debug)]
pub struct AuthorPortfolioDto {
    pub pubkey: String,
    pub npub: String,
    pub profile: Option<ProfileMetadataDto>,
    pub maps: Vec<MapSummaryDto>,
    pub stories: Vec<StorySummaryDto>,
    pub atlases: Vec<AtlasSummaryDto>,
}

/// Event-derived Inbox notification matching Earthly Web's `src/features/inbox/deriveInbox.ts`.
#[derive(Clone, Debug)]
pub struct InboxItemDto {
    pub id: String,
    pub event_id: String,
    /// `proposal` | `accepted` | `declined` | `reply` | `mention` | `atlas_arrival` | `follow` | `reaction` | `zap`
    pub kind: String,
    /// `proposals` | `replies` | `activity`
    pub category: String,
    pub actor_pubkey: String,
    pub created_at: u64,
    pub action: String,
    pub thing_label: String,
    pub preview: Option<String>,
    pub target_address: Option<String>,
    pub target_kind: Option<u16>,
    /// `details` | `comments` | `person`
    pub target_tab: Option<String>,
}

/// Encodes a 64-char hex pubkey (or normalizes an existing `npub1...`) to canonical `npub1...`.
pub fn pubkey_to_npub(pubkey_or_npub: String) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    pk.to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))
}

/// Fetches a single author's `kind 0` profile and all published Earthly Maps (`37515`),
/// Stories (`37520`), and Atlases (`37518`) from the configured Nostr relays.
pub async fn fetch_author_portfolio(
    relay_urls: Vec<String>,
    pubkey_or_npub: String,
) -> Result<AuthorPortfolioDto, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid author public key: {err}"))?;
    let pubkey_hex = pk.to_hex();
    let npub = pk
        .to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))?;

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let filter_entities = Filter::new()
        .author(pk)
        .kinds([
            Kind::Metadata,
            Kind::Custom(GEO_EVENT_KIND),
            Kind::Custom(ARTICLE_KIND),
            Kind::Custom(MAP_CONTEXT_KIND),
        ])
        .limit(120);

    let events = client
        .fetch_events(filter_entities, Duration::from_secs(7))
        .await
        .map_err(|err| format!("failed to fetch author portfolio: {err}"))?;
    client.disconnect().await;

    let mut latest_profile: Option<(u64, ProfileMetadataDto)> = None;
    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();

    for event in events {
        if event.kind == Kind::Metadata {
            let created_at = event.created_at.as_secs();
            let should_replace = latest_profile
                .as_ref()
                .map(|(ts, _)| created_at >= *ts)
                .unwrap_or(true);
            if should_replace {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&event.content) {
                    let opt = |k: &str| {
                        parsed
                            .get(k)
                            .and_then(|v| v.as_str())
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_owned)
                    };
                    latest_profile = Some((
                        created_at,
                        ProfileMetadataDto {
                            pubkey: pubkey_hex.clone(),
                            name: opt("name"),
                            display_name: opt("display_name").or_else(|| opt("displayName")),
                            about: opt("about"),
                            picture: opt("picture"),
                            nip05: opt("nip05"),
                        },
                    ));
                }
            }
            continue;
        }
        let raw = event_to_raw(&event);
        let Some(addr) = raw.address_coordinate() else {
            continue;
        };
        let replace = match latest_by_addr.get(&addr) {
            None => true,
            Some(existing) => {
                raw.created_at > existing.created_at
                    || (raw.created_at == existing.created_at && raw.id < existing.id)
            }
        };
        if replace {
            latest_by_addr.insert(addr, raw);
        }
    }

    let mut maps = Vec::new();
    let mut stories = Vec::new();
    let mut atlases = Vec::new();
    for (address, raw) in latest_by_addr {
        match raw.kind {
            GEO_EVENT_KIND => {
                if let Ok(dataset) = MapDataset::parse(&raw) {
                    maps.push(map_to_dto(address, dataset));
                }
            }
            ARTICLE_KIND => {
                if let Ok(story) = StoryArticle::parse(&raw) {
                    stories.push(story_to_dto(address, story));
                }
            }
            MAP_CONTEXT_KIND => {
                if let Ok(group) = AtlasGroup::parse(&raw) {
                    atlases.push(atlas_to_dto(address, group));
                }
            }
            _ => {}
        }
    }

    maps.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    stories.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    atlases.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(AuthorPortfolioDto {
        pubkey: pubkey_hex,
        npub,
        profile: latest_profile.map(|(_, p)| p),
        maps,
        stories,
        atlases,
    })
}

/// Fetches account-directed Earthly Inbox events (Edit Proposals `37519`,
/// Proposal Decisions `1631`/`1632`, Comments/Replies/Mentions `37517`,
/// Atlas Arrivals `37515` with `#c`, Follows `3`, Reactions `7`, Zaps `9735`)
/// matching Earthly Web's `src/features/inbox/deriveInbox.ts`.
pub async fn fetch_inbox_items(
    relay_urls: Vec<String>,
    current_user_pubkey: String,
    owned_atlas_addresses: Vec<String>,
    known_titles_json: Option<String>,
) -> Result<Vec<InboxItemDto>, String> {
    let pk = PublicKey::parse(current_user_pubkey.trim())
        .map_err(|err| format!("invalid user public key: {err}"))?;
    let user_hex = pk.to_hex();

    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = Client::default();
    for url in &urls {
        let _ = client.add_relay(url).await;
    }
    client.connect().await;

    let mut all_raw: BTreeMap<String, RawNostrEvent> = BTreeMap::new();

    // 1. Events directed to the user via `#p` (comments, proposals, follows, reactions, zaps)
    let directed_filter = Filter::new()
        .pubkey(pk)
        .kinds([
            Kind::Custom(GEO_COMMENT_KIND),
            Kind::Custom(GEO_EDIT_PROPOSAL_KIND),
            Kind::ContactList,
            Kind::Reaction,
            Kind::ZapReceipt,
        ])
        .limit(120);
    if let Ok(events) = client
        .fetch_events(directed_filter, Duration::from_secs(6))
        .await
    {
        for ev in events {
            let raw = event_to_raw(&ev);
            all_raw.insert(raw.id.clone(), raw);
        }
    }

    // 2. Comments addressing root via uppercase `#P`
    let upper_p_filter = Filter::new()
        .custom_tag(SingleLetterTag::uppercase(Alphabet::P), user_hex.clone())
        .kind(Kind::Custom(GEO_COMMENT_KIND))
        .limit(80);
    if let Ok(events) = client
        .fetch_events(upper_p_filter, Duration::from_secs(5))
        .await
    {
        for ev in events {
            let raw = event_to_raw(&ev);
            all_raw.insert(raw.id.clone(), raw);
        }
    }

    // 3. User's own authored proposals + proposal status updates (1631/1632)
    let own_proposals_filter = Filter::new()
        .author(pk)
        .kind(Kind::Custom(GEO_EDIT_PROPOSAL_KIND))
        .limit(50);
    let mut own_proposal_addrs: Vec<String> = Vec::new();
    if let Ok(events) = client
        .fetch_events(own_proposals_filter, Duration::from_secs(5))
        .await
    {
        for ev in events {
            let raw = event_to_raw(&ev);
            if let Some(addr) = raw.address_coordinate() {
                own_proposal_addrs.push(addr);
            }
            all_raw.insert(raw.id.clone(), raw);
        }
    }

    if !own_proposal_addrs.is_empty() {
        let status_filter = Filter::new()
            .custom_tags(SingleLetterTag::lowercase(Alphabet::A), own_proposal_addrs)
            .kinds([
                Kind::Custom(PROPOSAL_STATUS_APPLIED_KIND),
                Kind::Custom(PROPOSAL_STATUS_CLOSED_KIND),
            ])
            .limit(80);
        if let Ok(events) = client
            .fetch_events(status_filter, Duration::from_secs(5))
            .await
        {
            for ev in events {
                let raw = event_to_raw(&ev);
                all_raw.insert(raw.id.clone(), raw);
            }
        }
    }

    // 4. Maps arriving into the user's owned Atlases via `#c`
    let clean_atlases: Vec<String> = owned_atlas_addresses
        .into_iter()
        .map(|s| s.trim().to_owned())
        .filter(|s| s.starts_with("37518:"))
        .collect();
    if !clean_atlases.is_empty() {
        let arrivals_filter = Filter::new()
            .custom_tags(
                SingleLetterTag::lowercase(Alphabet::C),
                clean_atlases.clone(),
            )
            .kind(Kind::Custom(GEO_EVENT_KIND))
            .limit(80);
        if let Ok(events) = client
            .fetch_events(arrivals_filter, Duration::from_secs(5))
            .await
        {
            for ev in events {
                let raw = event_to_raw(&ev);
                all_raw.insert(raw.id.clone(), raw);
            }
        }
    }

    client.disconnect().await;

    let known_titles: BTreeMap<String, String> = known_titles_json
        .as_deref()
        .and_then(|raw| serde_json::from_str::<BTreeMap<String, String>>(raw).ok())
        .unwrap_or_default();

    let events_vec: Vec<RawNostrEvent> = all_raw.into_values().collect();
    Ok(derive_inbox_items_from_events(
        &user_hex,
        &events_vec,
        &clean_atlases,
        &known_titles,
    ))
}

fn first_tag<'a>(raw: &'a RawNostrEvent, name: &str) -> Option<&'a str> {
    raw.tags
        .iter()
        .find(|t| t.first().map(String::as_str) == Some(name))
        .and_then(|t| t.get(1))
        .map(String::as_str)
}

fn parse_coord(coord: &str) -> Option<(u16, &str, &str)> {
    let mut parts = coord.splitn(3, ':');
    let kind = parts.next()?.parse::<u16>().ok()?;
    let pubkey = parts.next()?;
    let ident = parts.next()?;
    if pubkey.is_empty() || ident.is_empty() {
        return None;
    }
    Some((kind, pubkey, ident))
}

fn humanize_ident(ident: &str) -> String {
    let spaced = ident.replace(['-', '_'], " ");
    let trimmed = spaced.trim();
    if trimmed.is_empty() {
        "Untitled".to_owned()
    } else {
        trimmed.to_owned()
    }
}

fn inbox_entity_label(coord: Option<&str>, labels: &BTreeMap<String, String>) -> String {
    let Some(c) = coord else {
        return "your work".to_owned();
    };
    if let Some(known) = labels.get(c) {
        if !known.trim().is_empty() {
            return known.clone();
        }
    }
    let Some((kind, _, ident)) = parse_coord(c) else {
        return "your work".to_owned();
    };
    let prefix = match kind {
        MAP_CONTEXT_KIND => "Atlas",
        ARTICLE_KIND => "Story",
        TEMPORAL_SIGHTING_KIND => "Sighting",
        LIVE_BEACON_KIND => "Live map",
        _ => "Map",
    };
    format!("{prefix} “{}”", humanize_ident(ident))
}

fn compact_preview(text: Option<&str>) -> Option<String> {
    let raw = text?;
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.is_empty() {
        return None;
    }
    if collapsed.chars().count() <= 120 {
        Some(collapsed)
    } else {
        let mut s: String = collapsed.chars().take(119).collect();
        s.push('…');
        Some(s)
    }
}

fn derive_inbox_items_from_events(
    current_user_pubkey: &str,
    events: &[RawNostrEvent],
    owned_atlas_addresses: &[String],
    known_titles: &BTreeMap<String, String>,
) -> Vec<InboxItemDto> {
    let owned_atlases: HashSet<&str> = owned_atlas_addresses.iter().map(String::as_str).collect();
    let mut proposals_by_coord: BTreeMap<String, &RawNostrEvent> = BTreeMap::new();
    for ev in events {
        if ev.kind == GEO_EDIT_PROPOSAL_KIND {
            if let Some(addr) = ev.address_coordinate() {
                proposals_by_coord.insert(addr, ev);
            }
        }
    }

    let mut items: Vec<InboxItemDto> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();

    for ev in events {
        if ev.pubkey == current_user_pubkey {
            continue;
        }

        match ev.kind {
            GEO_EDIT_PROPOSAL_KIND => {
                let target_addr = first_tag(ev, "a");
                let Some((t_kind, t_pk, _)) = target_addr.and_then(parse_coord) else {
                    continue;
                };
                if t_pk != current_user_pubkey {
                    continue;
                }
                let id = format!("proposal:{}", ev.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                items.push(InboxItemDto {
                    id,
                    event_id: ev.id.clone(),
                    kind: "proposal".to_owned(),
                    category: "proposals".to_owned(),
                    actor_pubkey: ev.pubkey.clone(),
                    created_at: ev.created_at,
                    action: "proposed changes to".to_owned(),
                    thing_label: inbox_entity_label(target_addr, known_titles),
                    preview: compact_preview(first_tag(ev, "description")),
                    target_address: target_addr.map(str::to_owned),
                    target_kind: Some(t_kind),
                    target_tab: Some("comments".to_owned()),
                });
            }
            PROPOSAL_STATUS_APPLIED_KIND | PROPOSAL_STATUS_CLOSED_KIND => {
                let Some(prop_addr) = first_tag(ev, "a") else {
                    continue;
                };
                let Some(ref_prop) = proposals_by_coord.get(prop_addr) else {
                    continue;
                };
                if ref_prop.pubkey != current_user_pubkey {
                    continue;
                }
                let target_addr = first_tag(ref_prop, "a");
                let Some((t_kind, t_pk, _)) = target_addr.and_then(parse_coord) else {
                    continue;
                };
                if t_pk != ev.pubkey {
                    continue;
                }
                let accepted = ev.kind == PROPOSAL_STATUS_APPLIED_KIND;
                let kind_str = if accepted { "accepted" } else { "declined" };
                let id = format!("{kind_str}:{}", ev.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                items.push(InboxItemDto {
                    id,
                    event_id: ev.id.clone(),
                    kind: kind_str.to_owned(),
                    category: "proposals".to_owned(),
                    actor_pubkey: ev.pubkey.clone(),
                    created_at: ev.created_at,
                    action: if accepted {
                        "accepted your proposal for".to_owned()
                    } else {
                        "closed your proposal for".to_owned()
                    },
                    thing_label: inbox_entity_label(target_addr, known_titles),
                    preview: compact_preview(Some(&ev.content)),
                    target_address: target_addr.map(str::to_owned),
                    target_kind: Some(t_kind),
                    target_tab: Some("comments".to_owned()),
                });
            }
            GEO_COMMENT_KIND => {
                let addresses_user = ev.tags.iter().any(|t| {
                    matches!(t.first().map(String::as_str), Some("p" | "P"))
                        && t.get(1).map(String::as_str) == Some(current_user_pubkey)
                });
                if !addresses_user {
                    continue;
                }
                let root_addr = first_tag(ev, "A").or_else(|| first_tag(ev, "a"));
                let root_pk = first_tag(ev, "P")
                    .or_else(|| root_addr.and_then(parse_coord).map(|(_, pk, _)| pk));
                let parent_kind = first_tag(ev, "k");
                let parent_pk = first_tag(ev, "p");
                let is_direct_reply = parent_kind == Some("37517")
                    && parent_pk == Some(current_user_pubkey);
                let is_on_owned = root_pk == Some(current_user_pubkey);
                let kind_str = if is_direct_reply || is_on_owned {
                    "reply"
                } else {
                    "mention"
                };
                let id = format!("{kind_str}:{}", ev.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                let parsed_text = serde_json::from_str::<serde_json::Value>(&ev.content)
                    .ok()
                    .and_then(|v| v.get("text").and_then(|t| t.as_str()).map(str::to_owned))
                    .unwrap_or_else(|| ev.content.clone());
                let t_kind = root_addr.and_then(parse_coord).map(|(k, _, _)| k);
                items.push(InboxItemDto {
                    id,
                    event_id: ev.id.clone(),
                    kind: kind_str.to_owned(),
                    category: "replies".to_owned(),
                    actor_pubkey: ev.pubkey.clone(),
                    created_at: ev.created_at,
                    action: if is_direct_reply {
                        "replied on".to_owned()
                    } else if is_on_owned {
                        "commented on".to_owned()
                    } else {
                        "mentioned you in".to_owned()
                    },
                    thing_label: inbox_entity_label(root_addr, known_titles),
                    preview: compact_preview(Some(&parsed_text)),
                    target_address: root_addr.map(str::to_owned),
                    target_kind: t_kind,
                    target_tab: Some("comments".to_owned()),
                });
            }
            GEO_EVENT_KIND => {
                let Some(map_coord) = ev.address_coordinate() else {
                    continue;
                };
                let map_label = MapDataset::parse(ev)
                    .ok()
                    .and_then(|d| d.name)
                    .unwrap_or_else(|| inbox_entity_label(Some(&map_coord), known_titles));
                for tag in &ev.tags {
                    if tag.first().map(String::as_str) != Some("c") {
                        continue;
                    }
                    let Some(atlas_coord) = tag.get(1).map(String::as_str) else {
                        continue;
                    };
                    if !owned_atlases.contains(atlas_coord) {
                        continue;
                    }
                    let id = format!("atlas_arrival:{}:{atlas_coord}", ev.id);
                    if !seen_ids.insert(id.clone()) {
                        continue;
                    }
                    items.push(InboxItemDto {
                        id,
                        event_id: ev.id.clone(),
                        kind: "atlas_arrival".to_owned(),
                        category: "activity".to_owned(),
                        actor_pubkey: ev.pubkey.clone(),
                        created_at: ev.created_at,
                        action: "added a map to".to_owned(),
                        thing_label: inbox_entity_label(Some(atlas_coord), known_titles),
                        preview: compact_preview(Some(&map_label)),
                        target_address: Some(map_coord.clone()),
                        target_kind: Some(GEO_EVENT_KIND),
                        target_tab: Some("details".to_owned()),
                    });
                }
            }
            3 => {
                let follows_me = ev.tags.iter().any(|t| {
                    t.first().map(String::as_str) == Some("p")
                        && t.get(1).map(String::as_str) == Some(current_user_pubkey)
                });
                if !follows_me {
                    continue;
                }
                let id = format!("follow:{}", ev.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                items.push(InboxItemDto {
                    id,
                    event_id: ev.id.clone(),
                    kind: "follow".to_owned(),
                    category: "activity".to_owned(),
                    actor_pubkey: ev.pubkey.clone(),
                    created_at: ev.created_at,
                    action: "followed".to_owned(),
                    thing_label: "you".to_owned(),
                    preview: None,
                    target_address: None,
                    target_kind: None,
                    target_tab: Some("person".to_owned()),
                });
            }
            7 | 9735 => {
                let tags_me = ev.tags.iter().any(|t| {
                    t.first().map(String::as_str) == Some("p")
                        && t.get(1).map(String::as_str) == Some(current_user_pubkey)
                });
                if !tags_me {
                    continue;
                }
                let is_zap = ev.kind == 9735;
                let actor = if is_zap {
                    first_tag(ev, "description")
                        .and_then(|d| serde_json::from_str::<serde_json::Value>(d).ok())
                        .and_then(|v| v.get("pubkey").and_then(|p| p.as_str()).map(str::to_owned))
                        .unwrap_or_else(|| ev.pubkey.clone())
                } else {
                    ev.pubkey.clone()
                };
                if actor == current_user_pubkey {
                    continue;
                }
                let target_addr = first_tag(ev, "a");
                let kind_str = if is_zap { "zap" } else { "reaction" };
                let id = format!("{kind_str}:{}", ev.id);
                if !seen_ids.insert(id.clone()) {
                    continue;
                }
                items.push(InboxItemDto {
                    id,
                    event_id: ev.id.clone(),
                    kind: kind_str.to_owned(),
                    category: "activity".to_owned(),
                    actor_pubkey: actor,
                    created_at: ev.created_at,
                    action: if is_zap {
                        "zapped".to_owned()
                    } else {
                        "reacted to".to_owned()
                    },
                    thing_label: inbox_entity_label(target_addr, known_titles),
                    preview: if !is_zap {
                        compact_preview(Some(&ev.content))
                    } else {
                        None
                    },
                    target_address: target_addr.map(str::to_owned),
                    target_kind: target_addr.and_then(parse_coord).map(|(k, _, _)| k),
                    target_tab: Some("details".to_owned()),
                });
            }
            _ => {}
        }
    }

    items.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| b.id.cmp(&a.id)));
    items
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn encodes_and_decodes_naddr_coordinate_round_trip() {
        let keys = Keys::generate();
        let pk = keys.public_key().to_hex();
        let encoded = encode_naddr_coordinate(
            GEO_EVENT_KIND,
            pk.clone(),
            "vienna-parks".to_owned(),
            vec![DEFAULT_EARTHLY_RELAY.to_owned()],
            Some("gate-north".to_owned()),
        )
        .unwrap();
        assert!(encoded.starts_with("nostr:naddr1"));
        assert!(encoded.ends_with("#gate-north"));

        let decoded = decode_naddr_coordinate(encoded).unwrap();
        assert_eq!(decoded.kind, GEO_EVENT_KIND);
        assert_eq!(decoded.pubkey, pk);
        assert_eq!(decoded.d_tag, "vienna-parks");
        assert_eq!(decoded.feature_id.as_deref(), Some("gate-north"));
        assert_eq!(decoded.relays, vec![DEFAULT_EARTHLY_RELAY.to_owned()]);
    }

    #[test]
    fn derives_inbox_proposals_replies_and_atlas_arrivals() {
        let me = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let bob = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let my_map = format!("37515:{me}:danube-route");
        let my_atlas = format!("37518:{me}:vienna-atlas");

        let mut titles = BTreeMap::new();
        titles.insert(my_map.clone(), "Danube Route".to_owned());
        titles.insert(my_atlas.clone(), "Vienna Atlas".to_owned());

        let events = vec![
            RawNostrEvent {
                id: "ev-prop-1".to_owned(),
                pubkey: bob.to_owned(),
                created_at: 200,
                kind: GEO_EDIT_PROPOSAL_KIND,
                tags: vec![
                    vec!["d".to_owned(), "pr-1".to_owned()],
                    vec!["a".to_owned(), my_map.clone()],
                    vec!["p".to_owned(), me.to_owned()],
                    vec!["description".to_owned(), "Fix northern bridge bend".to_owned()],
                ],
                content: "{}".to_owned(),
            },
            RawNostrEvent {
                id: "ev-comment-1".to_owned(),
                pubkey: bob.to_owned(),
                created_at: 300,
                kind: GEO_COMMENT_KIND,
                tags: vec![
                    vec!["d".to_owned(), "c-1".to_owned()],
                    vec!["A".to_owned(), my_map.clone()],
                    vec!["P".to_owned(), me.to_owned()],
                    vec!["p".to_owned(), me.to_owned()],
                ],
                content: r#"{"text":"Great river path!"}"#.to_owned(),
            },
            RawNostrEvent {
                id: "ev-arrival-1".to_owned(),
                pubkey: bob.to_owned(),
                created_at: 100,
                kind: GEO_EVENT_KIND,
                tags: vec![
                    vec!["d".to_owned(), "bob-map".to_owned()],
                    vec!["c".to_owned(), my_atlas.clone()],
                ],
                content: r#"{"type":"FeatureCollection","name":"Prater Paths","features":[]}"#
                    .to_owned(),
            },
        ];

        let items = derive_inbox_items_from_events(me, &events, &[my_atlas], &titles);
        assert_eq!(items.len(), 3);
        assert_eq!(items[0].kind, "reply");
        assert_eq!(items[0].thing_label, "Danube Route");
        assert_eq!(items[0].preview.as_deref(), Some("Great river path!"));
        assert_eq!(items[1].kind, "proposal");
        assert_eq!(items[1].category, "proposals");
        assert_eq!(items[2].kind, "atlas_arrival");
        assert_eq!(items[2].thing_label, "Vienna Atlas");
    }
}
