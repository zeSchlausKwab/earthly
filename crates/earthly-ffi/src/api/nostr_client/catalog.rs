//! Catalog fetching from relays, NostrLMDB offline fallback, local node, and live subscriptions.

use std::collections::{BTreeMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::{
    ARTICLE_KIND, AtlasGroup, GEO_EVENT_KIND, LIVE_BEACON_KIND, LiveBeacon, MAP_CONTEXT_KIND,
    MapDataset, RawNostrEvent, StoryArticle, TEMPORAL_SIGHTING_KIND, TemporalSighting, is_expired,
};
use nostr::{Filter, Kind, Timestamp};
use nostr_sdk::RelayPoolNotification;

use super::DEFAULT_EARTHLY_RELAY;
use super::entities::{
    AtlasSummaryDto, LiveBeaconDto, MapSummaryDto, SightingSummaryDto, StorySummaryDto,
    atlas_to_dto, beacon_to_dto, event_to_raw, map_to_dto, parse_live_relay_event,
    sighting_to_dto, story_to_dto,
};

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

    let client = crate::api::relay_pool::shared_client(&urls).await?;

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
        client.fetch_events_from(&urls, maps_filter.clone(), timeout),
        client.fetch_events_from(&urls, atlases_filter.clone(), timeout),
        client.fetch_events_from(&urls, stories_filter.clone(), timeout),
        client.fetch_events_from(&urls, beacons_filter.clone(), timeout),
        client.fetch_events_from(&urls, sightings_filter.clone(), timeout),
    );

    let mut all_events = Vec::new();
    let mut last_err: Option<String> = None;
    for res in [maps_res, atlases_res, stories_res, beacons_res, sightings_res] {
        match res {
            Ok(set) => all_events.extend(set.into_iter()),
            Err(err) => last_err = Some(err.to_string()),
        }
    }

    // Instant offline fallback to local NostrLMDB when relays fail, time out,
    // or return no events (fresh relay events are merged into LMDB by nostr-sdk).
    if last_err.is_some() || all_events.is_empty() {
        let db = client.database();
        let (c_maps, c_atlases, c_stories, c_beacons, c_sightings) = tokio::join!(
            db.query(maps_filter),
            db.query(atlases_filter),
            db.query(stories_filter),
            db.query(beacons_filter),
            db.query(sightings_filter),
        );
        for res in [c_maps, c_atlases, c_stories, c_beacons, c_sightings] {
            if let Ok(set) = res {
                all_events.extend(set.into_iter());
            }
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

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kinds([
            Kind::Custom(GEO_EVENT_KIND),
            Kind::Custom(MAP_CONTEXT_KIND),
            Kind::Custom(ARTICLE_KIND),
            Kind::Custom(LIVE_BEACON_KIND),
            Kind::Custom(TEMPORAL_SIGHTING_KIND),
        ])
        .since(Timestamp::now());

    let sub_output = client
        .subscribe_to(&urls, filter, None)
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

    client.unsubscribe(&sub_output.val).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[tokio::test]
    async fn catalog_and_profiles_fall_back_to_local_pool_database_when_relay_offline() {
        let unreachable = vec!["ws://127.0.0.1:9".to_owned()];
        let client = crate::api::relay_pool::shared_client(&unreachable)
            .await
            .unwrap();

        let keys = Keys::generate();
        let pk_hex = keys.public_key().to_hex();

        let profile_ev = nostr::EventBuilder::new(
            Kind::Metadata,
            r#"{"name":"offline-mapper","display_name":"Offline Mapper"}"#,
        )
        .sign_with_keys(&keys)
        .unwrap();
        let map_ev = nostr::EventBuilder::new(
            Kind::Custom(GEO_EVENT_KIND),
            r#"{"type":"FeatureCollection","name":"Cached Trail","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.21]},"properties":{}}]}"#,
        )
        .tag(nostr::Tag::identifier("cached-trail"))
        .sign_with_keys(&keys)
        .unwrap();

        client.database().save_event(&profile_ev).await.unwrap();
        client.database().save_event(&map_ev).await.unwrap();

        let profiles = super::super::fetch_profiles(unreachable.clone(), vec![pk_hex.clone()])
            .await
            .unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].pubkey, pk_hex);
        assert_eq!(profiles[0].name.as_deref(), Some("offline-mapper"));

        let catalog = fetch_earthly_catalog(unreachable, 20).await.unwrap();
        assert!(catalog
            .maps
            .iter()
            .any(|m| m.d_tag == "cached-trail" && m.pubkey == pk_hex));
    }
}
