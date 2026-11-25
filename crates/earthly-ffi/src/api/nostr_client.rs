//! Native Nostr relay client fetching real Earthly v2 entities (Maps 37515,
//! Atlases 37518, Stories 37520, Sightings 37522) and parsing them through
//! `earthly-domain`.

use std::collections::BTreeMap;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::{
    ARTICLE_KIND, AtlasGroup, GEO_COMMENT_KIND, GEO_EDIT_PROPOSAL_KIND, GEO_EVENT_KIND,
    GeoComment, GeoEditProposal, MAP_CONTEXT_KIND, MapDataset, PROPOSAL_STATUS_APPLIED_KIND,
    PROPOSAL_STATUS_CLOSED_KIND, PROPOSAL_STATUS_DRAFT_KIND, PROPOSAL_STATUS_OPEN_KIND,
    ProposalStatus, RawNostrEvent, StoryArticle, TEMPORAL_SIGHTING_KIND, TemporalSighting,
    diff_feature_collections, is_expired,
};
use nostr::nips::nip19::{FromBech32, Nip19Coordinate};
use nostr::{Alphabet, Event, Filter, Kind, PublicKey, SingleLetterTag};
use nostr_sdk::Client;

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
    pub geojson: String,
    pub west: Option<f64>,
    pub south: Option<f64>,
    pub east: Option<f64>,
    pub north: Option<f64>,
    pub hashtags: Vec<String>,
    pub labels: Vec<String>,
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
    pub governance: String,
    pub pinned_addresses: Vec<String>,
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
pub struct EarthlyCatalogSnapshot {
    pub relay_urls: Vec<String>,
    pub maps: Vec<MapSummaryDto>,
    pub stories: Vec<StorySummaryDto>,
    pub atlases: Vec<AtlasSummaryDto>,
    pub sightings: Vec<SightingSummaryDto>,
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
    let limit = (limit_per_kind as usize).clamp(1, 80);

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
            Kind::Custom(TEMPORAL_SIGHTING_KIND),
        ])
        .limit(limit * 4);

    let events = client
        .fetch_events(filter, Duration::from_secs(8))
        .await
        .map_err(|err| format!("failed to fetch catalog from relays: {err}"))?;

    client.disconnect().await;

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    // Deduplicate parameterized-replaceable events by (kind, pubkey, d), keeping newest.
    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for event in events.into_iter() {
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

    for (address, raw) in latest_by_addr {
        match raw.kind {
            GEO_EVENT_KIND => {
                if let Ok(dataset) = MapDataset::parse(&raw) {
                    maps.push(map_to_dto(address, dataset));
                }
            }
            ARTICLE_KIND => {
                if let Ok(story) = StoryArticle::parse(&raw) {
                    let presentation_json = story
                        .presentation
                        .as_ref()
                        .and_then(|v| serde_json::to_string(v).ok());
                    stories.push(StorySummaryDto {
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
                    });
                }
            }
            MAP_CONTEXT_KIND => {
                if let Ok(group) = AtlasGroup::parse(&raw) {
                    let governance = match group.governance {
                        earthly_domain::GovernanceMode::Open => "open",
                        earthly_domain::GovernanceMode::Schema => "schema",
                        earthly_domain::GovernanceMode::Closed => "closed",
                    };
                    atlases.push(AtlasSummaryDto {
                        address,
                        event_id: group.event_id,
                        pubkey: group.pubkey,
                        d_tag: group.d_tag,
                        name: group.name,
                        description: group.description,
                        governance: governance.to_owned(),
                        pinned_addresses: group.pinned_addresses,
                        created_at: group.created_at,
                    });
                }
            }
            TEMPORAL_SIGHTING_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(sighting) = TemporalSighting::parse(&raw) {
                    sightings.push(SightingSummaryDto {
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
                    });
                }
            }
            _ => {}
        }
    }

    maps.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    stories.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    atlases.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sightings.sort_by(|a, b| b.start.cmp(&a.start));

    Ok(EarthlyCatalogSnapshot {
        relay_urls: urls,
        maps,
        stories,
        atlases,
        sightings,
    })
}

/// Fast (~1 ms) local-only catalog read from the running embedded `LocalNode`
/// LMDB database — powers real-time live listening for incoming Nearby Field
/// Session Maps, Stories, Atlases, and Sightings without hitting public relays.
pub async fn fetch_local_node_catalog() -> Result<EarthlyCatalogSnapshot, String> {
    let Some(node) = crate::api::spike::current_node() else {
        return Ok(EarthlyCatalogSnapshot {
            relay_urls: Vec::new(),
            maps: Vec::new(),
            stories: Vec::new(),
            atlases: Vec::new(),
            sightings: Vec::new(),
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

    for (address, raw) in latest_by_addr {
        match raw.kind {
            GEO_EVENT_KIND => {
                if let Ok(dataset) = MapDataset::parse(&raw) {
                    maps.push(map_to_dto(address, dataset));
                }
            }
            ARTICLE_KIND => {
                if let Ok(story) = StoryArticle::parse(&raw) {
                    let presentation_json = story
                        .presentation
                        .as_ref()
                        .and_then(|v| serde_json::to_string(v).ok());
                    stories.push(StorySummaryDto {
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
                    });
                }
            }
            MAP_CONTEXT_KIND => {
                if let Ok(group) = AtlasGroup::parse(&raw) {
                    let governance = match group.governance {
                        earthly_domain::GovernanceMode::Open => "open",
                        earthly_domain::GovernanceMode::Schema => "schema",
                        earthly_domain::GovernanceMode::Closed => "closed",
                    };
                    atlases.push(AtlasSummaryDto {
                        address,
                        event_id: group.event_id,
                        pubkey: group.pubkey,
                        d_tag: group.d_tag,
                        name: group.name,
                        description: group.description,
                        governance: governance.to_owned(),
                        pinned_addresses: group.pinned_addresses,
                        created_at: group.created_at,
                    });
                }
            }
            TEMPORAL_SIGHTING_KIND => {
                if is_expired(&raw.tags, now) {
                    continue;
                }
                if let Ok(sighting) = TemporalSighting::parse(&raw) {
                    sightings.push(SightingSummaryDto {
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
                    });
                }
            }
            _ => {}
        }
    }

    maps.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    stories.sort_by(|a, b| b.published_at.cmp(&a.published_at));
    atlases.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    sightings.sort_by(|a, b| b.start.cmp(&a.start));

    Ok(EarthlyCatalogSnapshot {
        relay_urls: vec![node.descriptor().relay_url.to_string()],
        maps,
        stories,
        atlases,
        sightings,
    })
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

    MapSummaryDto {
        address,
        event_id: dataset.event_id,
        pubkey: dataset.pubkey,
        d_tag: dataset.d_tag,
        title,
        description: dataset.description,
        feature_count,
        geojson,
        west: dataset.bbox.map(|b| b.west),
        south: dataset.bbox.map(|b| b.south),
        east: dataset.bbox.map(|b| b.east),
        north: dataset.bbox.map(|b| b.north),
        hashtags: dataset.hashtags,
        labels: dataset.labels,
        created_at: dataset.created_at,
    }
}
