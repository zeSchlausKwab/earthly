//! NIP-50 relay catalog search and Photon OSM geocoding/reverse-geocoding.

use std::collections::BTreeMap;
use std::time::Duration;

use earthly_domain::{
    ARTICLE_KIND, AtlasGroup, GEO_EVENT_KIND, MAP_CONTEXT_KIND, MapDataset, RawNostrEvent,
    StoryArticle,
};
use nostr::{Filter, Kind};

use super::DEFAULT_EARTHLY_RELAY;
use super::catalog::EarthlyCatalogSnapshot;
use super::entities::{atlas_to_dto, event_to_raw, map_to_dto, story_to_dto};

#[derive(Clone, Debug)]
pub struct ReverseGeocodeDto {
    pub display_name: String,
    pub subtitle: String,
    pub lat: f64,
    pub lon: f64,
    pub country: Option<String>,
    pub city: Option<String>,
    pub street: Option<String>,
}

/// Reverse-geocodes a tapped map location using Photon (OSM, zero API key) with
/// graceful fallback to formatted WGS-84 coordinates.
pub async fn reverse_geocode_location(lat: f64, lon: f64) -> Result<ReverseGeocodeDto, String> {
    if !lat.is_finite()
        || !lon.is_finite()
        || !(-90.0..=90.0).contains(&lat)
        || !(-180.0..=180.0).contains(&lon)
    {
        return Err("Invalid WGS-84 coordinates".to_owned());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(6))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let resp = client
        .get("https://photon.komoot.io/reverse")
        .query(&[
            ("lat", format!("{lat:.6}")),
            ("lon", format!("{lon:.6}")),
            ("limit", "1".to_owned()),
        ])
        .send()
        .await;

    let fallback_name = format!("{lat:.5}, {lon:.5}");
    let Ok(resp) = resp else {
        return Ok(ReverseGeocodeDto {
            display_name: fallback_name,
            subtitle: "WGS-84 coordinate".to_owned(),
            lat,
            lon,
            country: None,
            city: None,
            street: None,
        });
    };
    if !resp.status().is_success() {
        return Ok(ReverseGeocodeDto {
            display_name: fallback_name,
            subtitle: "WGS-84 coordinate".to_owned(),
            lat,
            lon,
            country: None,
            city: None,
            street: None,
        });
    }
    let body: serde_json::Value = resp.json().await.unwrap_or(serde_json::Value::Null);
    let props = body
        .get("features")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .and_then(|f| f.get("properties"));

    let pick = |k: &str| {
        props
            .and_then(|p| p.get(k))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let name = pick("name");
    let street = pick("street");
    let housenumber = pick("housenumber");
    let city = pick("city")
        .or_else(|| pick("town"))
        .or_else(|| pick("village"));
    let country = pick("country");

    let street_line = match (street.as_ref(), housenumber.as_ref()) {
        (Some(s), Some(n)) => Some(format!("{s} {n}")),
        (Some(s), None) => Some(s.clone()),
        _ => None,
    };
    let display_name = name
        .or_else(|| street_line.clone())
        .or_else(|| city.clone())
        .or_else(|| country.clone())
        .unwrap_or(fallback_name);

    let mut sub_parts = Vec::new();
    for item in [street_line.as_ref(), city.as_ref(), country.as_ref()]
        .into_iter()
        .flatten()
    {
        if item != &display_name && !sub_parts.contains(item) {
            sub_parts.push(item.clone());
        }
    }
    let subtitle = if sub_parts.is_empty() {
        "OSM location".to_owned()
    } else {
        sub_parts.join(", ")
    };

    Ok(ReverseGeocodeDto {
        display_name,
        subtitle,
        lat,
        lon,
        country,
        city,
        street: street_line,
    })
}

/// Runs a NIP-50 full-text search query across configured Nostr relays for
/// Maps (`37515`), Stories (`37520`), and Atlases (`37518`).
pub async fn search_relay_catalog_nip50(
    relay_urls: Vec<String>,
    query: String,
) -> Result<EarthlyCatalogSnapshot, String> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(EarthlyCatalogSnapshot {
            relay_urls,
            maps: Vec::new(),
            stories: Vec::new(),
            atlases: Vec::new(),
            sightings: Vec::new(),
            beacons: Vec::new(),
        });
    }
    let urls = if relay_urls.is_empty() {
        vec![DEFAULT_EARTHLY_RELAY.to_owned()]
    } else {
        relay_urls
    };

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kinds([
            Kind::Custom(GEO_EVENT_KIND),
            Kind::Custom(ARTICLE_KIND),
            Kind::Custom(MAP_CONTEXT_KIND),
        ])
        .search(trimmed)
        .limit(40);
    let events = client
        .fetch_events_from(&urls, filter, Duration::from_secs(6))
        .await
        .map_err(|e| format!("NIP-50 search failed: {e}"))?;

    let mut latest_by_addr: BTreeMap<String, RawNostrEvent> = BTreeMap::new();
    for event in events {
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

    Ok(EarthlyCatalogSnapshot {
        relay_urls: urls,
        maps,
        stories,
        atlases,
        sightings: Vec::new(),
        beacons: Vec::new(),
    })
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
