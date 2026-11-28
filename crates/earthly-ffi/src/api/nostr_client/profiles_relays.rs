//! User profiles, NIP-65 relay lists, NIP-66 (`nostr.watch`) relay discovery,
//! live WebSocket + NIP-11 relay quality probing, key encoding, LNURL zap
//! invoices, and Community Shoutbox queries.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::RawNostrEvent;
use earthly_storage::settings::{
    DEFAULT_PUBLIC_RELAYS, PRIMARY_EARTHLY_RELAY, PROFILE_DISCOVERY_RELAY, normalize_relay_url,
};
use nostr::nips::nip19::{FromBech32, Nip19, ToBech32};
use nostr::{Event, Filter, Kind, PublicKey};
use nostr_sdk::Client;
use tokio::sync::Semaphore;

use super::EARTHLY_CITY_DEVELOPER_NPUB;
use super::entities::event_to_raw;

const NIP66_RELAY_DISCOVERY_KIND: u16 = 30_166;
const MAX_CONCURRENT_RELAY_PROBES: usize = 8;
const SLOW_RELAY_RTT_THRESHOLD_MS: u32 = 800;

#[derive(Clone, Debug)]
pub struct ProfileMetadataDto {
    pub pubkey: String,
    pub name: Option<String>,
    pub display_name: Option<String>,
    pub about: Option<String>,
    pub picture: Option<String>,
    pub nip05: Option<String>,
    pub website: Option<String>,
    pub banner: Option<String>,
    pub lud16: Option<String>,
}

/// Fetches Nostr `kind 0` author metadata profiles for the requested hex pubkeys,
/// fanning out across `purplepag.es`, major public relays, user NIP-65 read relays,
/// and `relay.earthly.city` (unless loopback-only test relays are passed).
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

    let urls = crate::api::relay_pool::resolve_profile_discovery_relays(&relay_urls);
    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::Metadata)
        .authors(authors.clone())
        .limit(authors.len() * 3);

    let relay_res = client
        .fetch_events_from(&urls, filter.clone(), Duration::from_secs(6))
        .await;
    let mut events: Vec<Event> = match &relay_res {
        Ok(set) => set.iter().cloned().collect(),
        Err(_) => Vec::new(),
    };
    if relay_res.is_err() || events.len() < authors.len() {
        if let Ok(cached) = client.database().query(filter).await {
            events.extend(cached.into_iter());
        }
    }
    if events.is_empty() {
        if let Err(err) = relay_res {
            return Err(format!("failed to fetch author profiles: {err}"));
        }
    }

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
            website: pick_str("website"),
            banner: pick_str("banner"),
            lud16: pick_str("lud16"),
        });
    }
    Ok(out)
}

#[derive(Clone, Debug)]
pub struct RelayListEntryDto {
    pub url: String,
    pub read: bool,
    pub write: bool,
}

#[derive(Clone, Debug)]
pub struct RelayHealthDto {
    pub url: String,
    pub reachable: bool,
    pub latency_ms: u32,
    pub error: Option<String>,
}

/// Parsed NIP-11 relay information document (`Accept: application/nostr+json`).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RelayNip11InfoDto {
    pub name: Option<String>,
    pub description: Option<String>,
    pub software: Option<String>,
    pub version: Option<String>,
    pub supported_nips: Vec<u32>,
    pub auth_required: bool,
    pub payment_required: bool,
    pub restricted_writes: bool,
    pub max_message_length: Option<u64>,
}

/// Live relay connectivity, RTT, NIP-11 capability, and composite quality probe report.
#[derive(Clone, Debug)]
pub struct RelayQualityReportDto {
    pub url: String,
    pub reachable: bool,
    pub rtt_ms: u32,
    /// `"healthy"` | `"slow"` | `"offline"` | `"auth_required"`
    pub status: String,
    /// Composite quality score (`0..=100`).
    pub quality_score: u8,
    pub auth_required: bool,
    pub payment_required: bool,
    pub nip11: Option<RelayNip11InfoDto>,
    pub error: Option<String>,
    pub probed_at: u64,
}

/// NIP-66 (`kind 30166` / `nostr.watch`) discovered public relay candidate with
/// optional live probe verification.
#[derive(Clone, Debug)]
pub struct Nip66RelayCandidateDto {
    pub url: String,
    pub network: String,
    pub rtt_open_ms: Option<u32>,
    pub rtt_read_ms: Option<u32>,
    pub rtt_write_ms: Option<u32>,
    pub supported_nips: Vec<u32>,
    pub auth_required: bool,
    pub payment_required: bool,
    pub writes_restricted: bool,
    pub software: Option<String>,
    pub country_code: Option<String>,
    pub monitor_count: u32,
    pub last_seen_at: u64,
    pub live_probe: Option<RelayQualityReportDto>,
}

/// Status row for a single relay managed by the production Relay Manager.
#[derive(Clone, Debug)]
pub struct ManagedRelayStatusDto {
    pub url: String,
    pub read: bool,
    pub write: bool,
    /// `"earthly"` | `"public_default"` | `"nip65"` | `"nip66"` | `"custom"` | `"profile_discovery"`
    pub source: String,
    pub connected: bool,
    pub quality: Option<RelayQualityReportDto>,
}

/// Full Relay Manager snapshot exposed to Settings UI (configured relays, roles,
/// live quality metrics, NIP-65 merged list, and public relay policy).
#[derive(Clone, Debug)]
pub struct RelayManagerSnapshotDto {
    pub public_relays_enabled: bool,
    pub primary_earthly_relay: String,
    pub default_public_relays: Vec<String>,
    pub profile_discovery_relays: Vec<String>,
    pub active_user_pubkey: Option<String>,
    pub configured_relays: Vec<ManagedRelayStatusDto>,
    pub nip65_relays: Vec<RelayListEntryDto>,
}

pub(crate) fn parse_nip65_tags(tags: &[Vec<String>]) -> Vec<RelayListEntryDto> {
    let mut seen: BTreeMap<String, (bool, bool)> = BTreeMap::new();
    for tag in tags {
        if tag.first().map(|s| s.as_str()) != Some("r") {
            continue;
        }
        let Some(raw_url) = tag.get(1).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let Some(normalized) = normalize_relay_url(raw_url) else {
            continue;
        };
        let marker = tag.get(2).map(|s| s.trim().to_ascii_lowercase());
        let (r, w) = match marker.as_deref() {
            Some("read") => (true, false),
            Some("write") => (false, true),
            _ => (true, true),
        };
        seen.entry(normalized)
            .and_modify(|e| {
                e.0 |= r;
                e.1 |= w;
            })
            .or_insert((r, w));
    }
    seen.into_iter()
        .map(|(url, (read, write))| RelayListEntryDto { url, read, write })
        .collect()
}

/// Fetches a user's NIP-65 (`kind 10002`) relay list metadata across configured
/// relays, `wss://purplepag.es`, and major public discovery relays.
pub async fn fetch_user_relay_list(
    relay_urls: Vec<String>,
    pubkey_or_npub: String,
) -> Result<Vec<RelayListEntryDto>, String> {
    let author = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|e| format!("invalid Nostr public key: {e}"))?;
    let urls = crate::api::relay_pool::resolve_profile_discovery_relays(&relay_urls);
    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::RelayList)
        .author(author)
        .limit(8);
    let relay_res = client
        .fetch_events_from(&urls, filter.clone(), Duration::from_secs(6))
        .await;
    let mut events: Vec<Event> = match &relay_res {
        Ok(set) => set.iter().cloned().collect(),
        Err(_) => Vec::new(),
    };
    if events.is_empty() {
        if let Ok(cached) = client.database().query(filter).await {
            events.extend(cached.into_iter());
        }
    }
    if events.is_empty() {
        if let Err(err) = relay_res {
            return Err(format!("failed to fetch NIP-65 relay list: {err}"));
        }
    }

    let newest = events
        .into_iter()
        .max_by_key(|ev| (ev.created_at.as_secs(), ev.id));
    Ok(match newest {
        Some(ev) => {
            let raw = event_to_raw(&ev);
            parse_nip65_tags(&raw.tags)
        }
        None => Vec::new(),
    })
}

/// Fetches the signed-in user's NIP-65 (`kind 10002`) relay list and merges it
/// (respecting read/write markers) directly into the active Rust Relay Manager
/// and shared relay pool.
pub async fn sync_user_nip65_relays(
    pubkey_or_npub: String,
    seed_relays: Vec<String>,
) -> Result<Vec<RelayListEntryDto>, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|e| format!("invalid Nostr public key: {e}"))?;
    let pk_hex = pk.to_hex();
    let entries = fetch_user_relay_list(seed_relays, pk_hex.clone()).await?;
    crate::api::relay_pool::merge_user_nip65_relays(pk_hex, entries.clone());
    // Best-effort warm up connections to newly merged NIP-65 relays in the shared pool.
    let to_connect: Vec<String> = entries
        .iter()
        .filter(|e| !crate::api::relay_pool::is_local_or_private_relay_url(&e.url))
        .map(|e| e.url.clone())
        .collect();
    if !to_connect.is_empty() {
        let _ = crate::api::relay_pool::shared_client(&to_connect).await;
    }
    Ok(entries)
}

/// Marks a relay URL added from NIP-66 discovery so the Relay Manager tags its source.
pub fn mark_nip66_relay_added(url: String) {
    crate::api::relay_pool::record_nip66_relay_source(&url);
}

/// Returns the current Relay Manager state including live pool connectivity,
/// cached quality/NIP-11 probe metrics, read/write roles, and NIP-65 entries.
pub async fn get_relay_manager_snapshot(
    configured_relays: Vec<String>,
) -> Result<RelayManagerSnapshotDto, String> {
    if !configured_relays.is_empty() {
        crate::api::relay_pool::sync_configured_relays(&configured_relays);
    }
    let state = crate::api::relay_pool::snapshot_relay_manager_state();
    let connected_map = crate::api::relay_pool::connected_relay_urls().await;

    let nip65_by_url: HashMap<String, (bool, bool)> = state
        .nip65_entries
        .iter()
        .map(|e| (e.url.clone(), (e.read, e.write)))
        .collect();

    let effective_urls = if !configured_relays.is_empty() {
        let mut out = Vec::new();
        for raw in configured_relays {
            if let Some(norm) = normalize_relay_url(&raw) {
                if !out.contains(&norm) {
                    out.push(norm);
                }
            }
        }
        out
    } else {
        state.configured_relays.clone()
    };

    let mut rows = Vec::with_capacity(effective_urls.len());
    for url in effective_urls {
        let (read, write) = nip65_by_url.get(&url).copied().unwrap_or((true, true));
        let source = state.relay_sources.get(&url).cloned().unwrap_or_else(|| {
            if url == PRIMARY_EARTHLY_RELAY {
                "earthly".to_owned()
            } else if DEFAULT_PUBLIC_RELAYS.contains(&url.as_str()) {
                "public_default".to_owned()
            } else if nip65_by_url.contains_key(&url) {
                "nip65".to_owned()
            } else if crate::api::relay_pool::is_profile_directory_relay(&url) {
                "profile_discovery".to_owned()
            } else {
                "custom".to_owned()
            }
        });
        let connected = connected_map.get(&url).copied().unwrap_or(false);
        let quality = state.quality_cache.get(&url).cloned();
        rows.push(ManagedRelayStatusDto {
            url,
            read,
            write,
            source,
            connected,
            quality,
        });
    }

    Ok(RelayManagerSnapshotDto {
        public_relays_enabled: state.public_relays_enabled,
        primary_earthly_relay: PRIMARY_EARTHLY_RELAY.to_owned(),
        default_public_relays: DEFAULT_PUBLIC_RELAYS
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
        profile_discovery_relays: vec![PROFILE_DISCOVERY_RELAY.to_owned()],
        active_user_pubkey: state.active_user_pubkey,
        configured_relays: rows,
        nip65_relays: state.nip65_entries,
    })
}

fn ws_url_to_nip11_http_url(ws_url: &str) -> Option<String> {
    let norm = normalize_relay_url(ws_url)?;
    if let Some(rest) = norm.strip_prefix("wss://") {
        Some(format!("https://{rest}"))
    } else if let Some(rest) = norm.strip_prefix("ws://") {
        Some(format!("http://{rest}"))
    } else {
        None
    }
}

fn parse_nip11_json(value: &serde_json::Value) -> Option<RelayNip11InfoDto> {
    let obj = value.as_object()?;
    let pick_str = |key: &str| {
        obj.get(key)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
    };
    let mut nips_set = BTreeSet::new();
    if let Some(arr) = obj.get("supported_nips").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(n) = item.as_u64() {
                if n <= u32::MAX as u64 {
                    nips_set.insert(n as u32);
                }
            } else if let Some(s) = item.as_str() {
                if let Ok(n) = s.trim().parse::<u32>() {
                    nips_set.insert(n);
                }
            }
        }
    }
    let limitation = obj.get("limitation").and_then(|v| v.as_object());
    let limit_bool = |key: &str| {
        limitation
            .and_then(|l| l.get(key))
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
    };
    let max_message_length = limitation
        .and_then(|l| l.get("max_message_length"))
        .and_then(|v| v.as_u64());

    let dto = RelayNip11InfoDto {
        name: pick_str("name"),
        description: pick_str("description"),
        software: pick_str("software"),
        version: pick_str("version"),
        supported_nips: nips_set.into_iter().collect(),
        auth_required: limit_bool("auth_required"),
        payment_required: limit_bool("payment_required"),
        restricted_writes: limit_bool("restricted_writes"),
        max_message_length,
    };
    if dto.name.is_none()
        && dto.description.is_none()
        && dto.software.is_none()
        && dto.supported_nips.is_empty()
        && !dto.auth_required
        && !dto.payment_required
        && !dto.restricted_writes
    {
        return None;
    }
    Some(dto)
}

async fn fetch_nip11_info(http: &reqwest::Client, ws_url: &str) -> Option<RelayNip11InfoDto> {
    let http_url = ws_url_to_nip11_http_url(ws_url)?;
    let resp = http
        .get(&http_url)
        .header("Accept", "application/nostr+json")
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let text = resp.text().await.ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    parse_nip11_json(&json)
}

/// Computes canonical relay health status (`healthy` / `slow` / `offline` / `auth_required`)
/// and composite quality score (`0..=100`).
pub(crate) fn compute_relay_quality(
    reachable: bool,
    rtt_ms: u32,
    auth_required: bool,
    payment_required: bool,
    nip11: Option<&RelayNip11InfoDto>,
) -> (String, u8) {
    if !reachable {
        return ("offline".to_owned(), 0);
    }

    let latency_score: i32 = if rtt_ms <= 120 {
        95
    } else if rtt_ms <= 250 {
        88
    } else if rtt_ms <= 450 {
        78
    } else if rtt_ms <= SLOW_RELAY_RTT_THRESHOLD_MS {
        66
    } else if rtt_ms <= 1_500 {
        48
    } else {
        32
    };

    let mut score = latency_score;
    if let Some(info) = nip11 {
        if info.supported_nips.contains(&1) {
            score += 3;
        }
        if info.supported_nips.contains(&11) || info.supported_nips.contains(&33) {
            score += 2;
        }
        if info.restricted_writes {
            score -= 12;
        }
    }
    if payment_required {
        score -= 18;
    }
    if auth_required {
        score = score.min(55) - 10;
        return ("auth_required".to_owned(), score.clamp(10, 55) as u8);
    }
    if rtt_ms > SLOW_RELAY_RTT_THRESHOLD_MS {
        return ("slow".to_owned(), score.clamp(15, 65) as u8);
    }
    ("healthy".to_owned(), score.clamp(20, 100) as u8)
}

async fn probe_single_relay_quality(
    http: &reqwest::Client,
    raw_url: String,
) -> RelayQualityReportDto {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let Some(url) = normalize_relay_url(&raw_url) else {
        return RelayQualityReportDto {
            url: raw_url.trim().to_owned(),
            reachable: false,
            rtt_ms: 0,
            status: "offline".to_owned(),
            quality_score: 0,
            auth_required: false,
            payment_required: false,
            nip11: None,
            error: Some("Unsupported URL scheme".to_owned()),
            probed_at: now,
        };
    };

    // Run isolated WebSocket handshake RTT measurement and NIP-11 HTTP fetch concurrently.
    let ws_fut = async {
        let client = Client::default();
        if let Err(err) = client.add_relay(&url).await {
            return (false, 0u32, Some(err.to_string()));
        }
        let started = std::time::Instant::now();
        let outcome = match client.try_connect_relay(&url, Duration::from_secs(4)).await {
            Ok(()) => {
                let elapsed = started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
                (true, elapsed, None)
            }
            Err(err) => (false, 0u32, Some(err.to_string())),
        };
        client.disconnect().await;
        outcome
    };

    let nip11_fut = fetch_nip11_info(http, &url);
    let ((reachable, rtt_ms, error), nip11) = tokio::join!(ws_fut, nip11_fut);

    let err_suggests_auth = error.as_deref().is_some_and(|e| {
        let lower = e.to_ascii_lowercase();
        lower.contains("auth-required")
            || lower.contains("auth required")
            || lower.contains("authentication required")
    });
    let auth_required = nip11.as_ref().is_some_and(|n| n.auth_required) || err_suggests_auth;
    let payment_required = nip11.as_ref().is_some_and(|n| n.payment_required);
    let (status, quality_score) = compute_relay_quality(
        reachable,
        rtt_ms,
        auth_required,
        payment_required,
        nip11.as_ref(),
    );

    RelayQualityReportDto {
        url,
        reachable,
        rtt_ms,
        status,
        quality_score,
        auth_required,
        payment_required,
        nip11,
        error,
        probed_at: now,
    }
}

/// Probes live WebSocket handshake RTT, NIP-11 metadata (`Accept: application/nostr+json`),
/// auth/payment restrictions, and composite quality score/status concurrently for every relay.
pub async fn probe_relays_quality(
    relay_urls: Vec<String>,
) -> Result<Vec<RelayQualityReportDto>, String> {
    if relay_urls.is_empty() {
        return Ok(Vec::new());
    }
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(3))
        .timeout(Duration::from_secs(4))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build NIP-11 HTTP client: {e}"))?;

    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_RELAY_PROBES));
    let mut join_set = tokio::task::JoinSet::new();

    for (idx, url) in relay_urls.into_iter().enumerate() {
        let sem = Arc::clone(&semaphore);
        let http_clone = http.clone();
        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await.ok();
            let report = probe_single_relay_quality(&http_clone, url).await;
            (idx, report)
        });
    }

    let mut indexed = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(pair) = res {
            indexed.push(pair);
        }
    }
    indexed.sort_by_key(|(idx, _)| *idx);
    let ordered: Vec<RelayQualityReportDto> = indexed.into_iter().map(|(_, r)| r).collect();
    crate::api::relay_pool::record_relay_quality_reports(&ordered);
    Ok(ordered)
}

/// Probes WebSocket reachability and handshake latency (ms) concurrently for each relay URL.
pub async fn probe_relays_health(relay_urls: Vec<String>) -> Result<Vec<RelayHealthDto>, String> {
    if relay_urls.is_empty() {
        return Ok(Vec::new());
    }
    let semaphore = Arc::new(Semaphore::new(MAX_CONCURRENT_RELAY_PROBES));
    let mut join_set = tokio::task::JoinSet::new();

    for (idx, raw) in relay_urls.into_iter().enumerate() {
        let sem = Arc::clone(&semaphore);
        join_set.spawn(async move {
            let _permit = sem.acquire_owned().await.ok();
            let url = raw.trim().to_owned();
            if !url.starts_with("wss://") && !url.starts_with("ws://") {
                return (
                    idx,
                    RelayHealthDto {
                        url,
                        reachable: false,
                        latency_ms: 0,
                        error: Some("Unsupported URL scheme".to_owned()),
                    },
                );
            }
            let client = Client::default();
            if let Err(err) = client.add_relay(&url).await {
                return (
                    idx,
                    RelayHealthDto {
                        url,
                        reachable: false,
                        latency_ms: 0,
                        error: Some(err.to_string()),
                    },
                );
            }
            let started = std::time::Instant::now();
            let dto = match client.try_connect_relay(&url, Duration::from_secs(4)).await {
                Ok(()) => {
                    let elapsed = started.elapsed().as_millis().min(u128::from(u32::MAX)) as u32;
                    RelayHealthDto {
                        url,
                        reachable: true,
                        latency_ms: elapsed,
                        error: None,
                    }
                }
                Err(err) => RelayHealthDto {
                    url,
                    reachable: false,
                    latency_ms: 0,
                    error: Some(err.to_string()),
                },
            };
            client.disconnect().await;
            (idx, dto)
        });
    }

    let mut indexed = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(pair) = res {
            indexed.push(pair);
        }
    }
    indexed.sort_by_key(|(idx, _)| *idx);
    Ok(indexed.into_iter().map(|(_, dto)| dto).collect())
}

#[derive(Clone, Debug)]
struct ParsedNip66Observation {
    url: String,
    monitor_pubkey: String,
    created_at: u64,
    network: String,
    rtt_open_ms: Option<u32>,
    rtt_read_ms: Option<u32>,
    rtt_write_ms: Option<u32>,
    supported_nips: Vec<u32>,
    auth_required: bool,
    payment_required: bool,
    writes_restricted: bool,
    software: Option<String>,
    country_code: Option<String>,
}

fn is_clearnet_public_wss_url(url: &str) -> bool {
    if !url.starts_with("wss://") {
        return false;
    }
    if crate::api::relay_pool::is_local_or_private_relay_url(url) {
        return false;
    }
    let host = url
        .trim_start_matches("wss://")
        .split('/')
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    if host.is_empty()
        || !host.contains('.')
        || host.ends_with(".onion")
        || host.ends_with(".i2p")
        || host.ends_with(".loki")
    {
        return false;
    }
    true
}

fn parse_nip66_rtt_ms(raw: &str) -> Option<u32> {
    let val = raw.trim().parse::<u32>().ok()?;
    (val > 0 && val <= 60_000).then_some(val)
}

fn parse_nip66_event(raw: &RawNostrEvent) -> Option<ParsedNip66Observation> {
    if raw.kind != NIP66_RELAY_DISCOVERY_KIND {
        return None;
    }
    let d_raw = raw.d_tag()?;
    let url = normalize_relay_url(d_raw)?;
    if !is_clearnet_public_wss_url(&url) {
        return None;
    }

    let mut network = "clearnet".to_owned();
    let mut rtt_open_ms = None;
    let mut rtt_read_ms = None;
    let mut rtt_write_ms = None;
    let mut nips_set = BTreeSet::new();
    let mut auth_required = false;
    let mut payment_required = false;
    let mut writes_restricted = false;
    let mut software: Option<String> = None;
    let mut country_code: Option<String> = None;

    for tag in &raw.tags {
        let Some(k) = tag.first().map(String::as_str) else {
            continue;
        };
        let v1 = tag.get(1).map(|s| s.trim()).unwrap_or("");
        match k {
            "n" if !v1.is_empty() => {
                network = v1.to_ascii_lowercase();
            }
            "rtt-open" => {
                rtt_open_ms = rtt_open_ms.or_else(|| parse_nip66_rtt_ms(v1));
            }
            "rtt-read" => {
                rtt_read_ms = rtt_read_ms.or_else(|| parse_nip66_rtt_ms(v1));
            }
            "rtt-write" => {
                rtt_write_ms = rtt_write_ms.or_else(|| parse_nip66_rtt_ms(v1));
            }
            "N" => {
                if let Ok(nip) = v1.parse::<u32>() {
                    nips_set.insert(nip);
                }
            }
            "R" => match v1.to_ascii_lowercase().as_str() {
                "auth" => auth_required = true,
                "!auth" => auth_required = false,
                "payment" => payment_required = true,
                "!payment" => payment_required = false,
                "!writes" | "restricted" | "restricted_writes" => writes_restricted = true,
                _ => {}
            },
            "s" if !v1.is_empty() => {
                software = Some(v1.to_owned());
            }
            "l" if !v1.is_empty() => {
                if tag
                    .get(2)
                    .map(|ns| ns.trim().eq_ignore_ascii_case("countryCode"))
                    .unwrap_or(false)
                {
                    country_code = Some(v1.to_ascii_uppercase());
                }
            }
            _ => {}
        }
    }

    if network != "clearnet" {
        return None;
    }

    // Parse optional embedded NIP-11 JSON in event content as fallback enrichment.
    if !raw.content.trim().is_empty() {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw.content) {
            if let Some(nip11) = parse_nip11_json(&val) {
                if software.is_none() {
                    software = nip11.software;
                }
                for n in nip11.supported_nips {
                    nips_set.insert(n);
                }
                auth_required |= nip11.auth_required;
                payment_required |= nip11.payment_required;
                writes_restricted |= nip11.restricted_writes;
            }
        }
    }

    Some(ParsedNip66Observation {
        url,
        monitor_pubkey: raw.pubkey.clone(),
        created_at: raw.created_at,
        network,
        rtt_open_ms,
        rtt_read_ms,
        rtt_write_ms,
        supported_nips: nips_set.into_iter().collect(),
        auth_required,
        payment_required,
        writes_restricted,
        software,
        country_code,
    })
}

fn nip66_candidate_rank_key(c: &Nip66RelayCandidateDto) -> (u8, u8, i32, u32) {
    // Tier 0 = live healthy open relay; Tier 1 = unprobed open; Tier 2 = auth/paid/slow; Tier 3 = offline.
    let live_tier = match c.live_probe.as_ref() {
        Some(p) if !p.reachable => 3,
        Some(p) if p.status == "healthy" && !p.auth_required && !p.payment_required => 0,
        Some(_) => 2,
        None if !c.auth_required && !c.payment_required && !c.writes_restricted => 1,
        None => 2,
    };
    let restriction_penalty = u8::from(c.auth_required) + u8::from(c.payment_required) + u8::from(c.writes_restricted);
    let score_desc = c
        .live_probe
        .as_ref()
        .map(|p| -(p.quality_score as i32))
        .unwrap_or_else(|| -(c.monitor_count.min(10) as i32 * 5 + c.supported_nips.len().min(20) as i32));
    let rtt = c
        .live_probe
        .as_ref()
        .filter(|p| p.reachable)
        .map(|p| p.rtt_ms)
        .or(c.rtt_open_ms)
        .or(c.rtt_read_ms)
        .unwrap_or(5_000);
    (live_tier, restriction_penalty, score_desc, rtt)
}

pub(crate) fn aggregate_nip66_candidates(
    events: &[RawNostrEvent],
    limit: usize,
) -> Vec<Nip66RelayCandidateDto> {
    struct Acc {
        monitors: HashSet<String>,
        latest: ParsedNip66Observation,
        nips: BTreeSet<u32>,
        best_open: Option<u32>,
        best_read: Option<u32>,
        best_write: Option<u32>,
        software: Option<String>,
        country_code: Option<String>,
    }

    let mut by_url: HashMap<String, Acc> = HashMap::new();
    for raw in events {
        let Some(obs) = parse_nip66_event(raw) else {
            continue;
        };
        let entry = by_url.entry(obs.url.clone()).or_insert_with(|| {
            let mut monitors = HashSet::new();
            monitors.insert(obs.monitor_pubkey.clone());
            let nips: BTreeSet<u32> = obs.supported_nips.iter().copied().collect();
            Acc {
                monitors,
                best_open: obs.rtt_open_ms,
                best_read: obs.rtt_read_ms,
                best_write: obs.rtt_write_ms,
                software: obs.software.clone(),
                country_code: obs.country_code.clone(),
                latest: obs.clone(),
                nips,
            }
        });
        entry.monitors.insert(obs.monitor_pubkey.clone());
        entry.nips.extend(obs.supported_nips.iter().copied());
        if let Some(v) = obs.rtt_open_ms {
            entry.best_open = Some(entry.best_open.map_or(v, |cur| cur.min(v)));
        }
        if let Some(v) = obs.rtt_read_ms {
            entry.best_read = Some(entry.best_read.map_or(v, |cur| cur.min(v)));
        }
        if let Some(v) = obs.rtt_write_ms {
            entry.best_write = Some(entry.best_write.map_or(v, |cur| cur.min(v)));
        }
        if entry.software.is_none() && obs.software.is_some() {
            entry.software = obs.software.clone();
        }
        if entry.country_code.is_none() && obs.country_code.is_some() {
            entry.country_code = obs.country_code.clone();
        }
        if obs.created_at >= entry.latest.created_at {
            entry.latest = obs;
        }
    }

    let mut candidates: Vec<Nip66RelayCandidateDto> = by_url
        .into_values()
        .map(|acc| Nip66RelayCandidateDto {
            url: acc.latest.url,
            network: acc.latest.network,
            rtt_open_ms: acc.best_open,
            rtt_read_ms: acc.best_read,
            rtt_write_ms: acc.best_write,
            supported_nips: acc.nips.into_iter().collect(),
            auth_required: acc.latest.auth_required,
            payment_required: acc.latest.payment_required,
            writes_restricted: acc.latest.writes_restricted,
            software: acc.software,
            country_code: acc.country_code,
            monitor_count: acc.monitors.len() as u32,
            last_seen_at: acc.latest.created_at,
            live_probe: None,
        })
        .collect();

    candidates.sort_by(|a, b| {
        nip66_candidate_rank_key(a)
            .cmp(&nip66_candidate_rank_key(b))
            .then_with(|| a.url.cmp(&b.url))
    });
    candidates.truncate(limit);
    candidates
}

/// Queries NIP-66 (`kind 30166`) relay discovery events from `nostr.watch`
/// monitors (`wss://relay.nostr.watch`, `wss://history.nostr.watch`), parses
/// clearnet public relay metadata, and optionally live-probes the top candidates
/// for real-time WebSocket RTT & NIP-11 capabilities.
pub async fn discover_public_relays_nip66(
    monitor_relays: Option<Vec<String>>,
    limit: u32,
    probe_candidates: bool,
) -> Result<Vec<Nip66RelayCandidateDto>, String> {
    let clamped_limit = (limit as usize).clamp(1, 50);
    let monitors: Vec<String> = match monitor_relays {
        Some(list) if !list.is_empty() => list
            .into_iter()
            .filter_map(|u| normalize_relay_url(&u))
            .collect(),
        _ => crate::api::relay_pool::NIP66_MONITOR_RELAYS
            .iter()
            .map(|s| (*s).to_owned())
            .collect(),
    };
    if monitors.is_empty() {
        return Err("No valid NIP-66 monitor relay URLs provided".to_owned());
    }

    // Use a dedicated ephemeral client so NIP-66 monitor relays never pollute the main pool.
    let client = Client::default();
    let mut added = 0usize;
    for url in &monitors {
        if client.add_relay(url).await.is_ok() {
            added += 1;
        }
    }
    if added == 0 {
        return Err("Failed to register any NIP-66 monitor relay".to_owned());
    }
    client.connect().await;

    let filter = Filter::new()
        .kind(Kind::Custom(NIP66_RELAY_DISCOVERY_KIND))
        .limit(250);
    let events_res = client
        .fetch_events_from(&monitors, filter, Duration::from_secs(8))
        .await;
    client.disconnect().await;

    let events = events_res.map_err(|e| format!("NIP-66 discovery query failed: {e}"))?;
    let raw_events: Vec<RawNostrEvent> = events.iter().map(event_to_raw).collect();
    let mut candidates = aggregate_nip66_candidates(&raw_events, clamped_limit);

    if probe_candidates && !candidates.is_empty() {
        let probe_count = candidates.len().min(12);
        let probe_urls: Vec<String> = candidates[..probe_count]
            .iter()
            .map(|c| c.url.clone())
            .collect();
        if let Ok(reports) = probe_relays_quality(probe_urls).await {
            let by_url: HashMap<String, RelayQualityReportDto> = reports
                .into_iter()
                .map(|r| (r.url.clone(), r))
                .collect();
            for candidate in &mut candidates {
                if let Some(report) = by_url.get(&candidate.url).cloned() {
                    candidate.auth_required |= report.auth_required;
                    candidate.payment_required |= report.payment_required;
                    if let Some(ref nip11) = report.nip11 {
                        if candidate.software.is_none() {
                            candidate.software = nip11.software.clone();
                        }
                        let mut merged_nips: BTreeSet<u32> =
                            candidate.supported_nips.iter().copied().collect();
                        merged_nips.extend(nip11.supported_nips.iter().copied());
                        candidate.supported_nips = merged_nips.into_iter().collect();
                        candidate.writes_restricted |= nip11.restricted_writes;
                    }
                    candidate.live_probe = Some(report);
                }
            }
            candidates.sort_by(|a, b| {
                nip66_candidate_rank_key(a)
                    .cmp(&nip66_candidate_rank_key(b))
                    .then_with(|| a.url.cmp(&b.url))
            });
        }
    }

    Ok(candidates)
}

/// Encodes a 64-char hex pubkey (or normalizes an existing `npub1...`) to canonical `npub1...`.
pub fn pubkey_to_npub(pubkey_or_npub: String) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    pk.to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))
}

/// Decodes a `nostr:npub1…`, `npub1…`, `nostr:nprofile1…`, `nprofile1…`, or 64-char hex
/// pubkey string into canonical lowercase 64-char hex.
pub fn decode_npub_to_hex(pubkey_or_npub: String) -> Option<String> {
    let trimmed = pubkey_or_npub
        .trim()
        .strip_prefix("nostr:")
        .or_else(|| pubkey_or_npub.trim().strip_prefix("NOSTR:"))
        .unwrap_or(pubkey_or_npub.trim());
    if let Ok(pk) = PublicKey::parse(trimmed) {
        return Some(pk.to_hex());
    }
    if let Ok(Nip19::Profile(profile)) = Nip19::from_bech32(trimmed) {
        return Some(profile.public_key.to_hex());
    }
    None
}

#[derive(Clone, Debug)]
pub struct ZapInvoiceDto {
    pub pr: String,
    pub verify_url: Option<String>,
    pub callback: String,
    pub min_sats: u64,
    pub max_sats: u64,
    pub allows_nostr: bool,
    pub amount_sats: u64,
}

#[derive(Clone, Debug)]
pub struct ShoutboxPostDto {
    pub event_id: String,
    pub pubkey: String,
    pub content: String,
    pub category: String,
    pub created_at: u64,
    pub hashtags: Vec<String>,
}

/// Encodes a 64-char hex pubkey (or `npub1...`) into canonical `npub1...`.
pub fn encode_hex_to_npub(pubkey_hex: String) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_hex.trim())
        .map_err(|err| format!("invalid public key: {err}"))?;
    pk.to_bech32()
        .map_err(|err| format!("failed to encode npub: {err}"))
}

fn resolve_lud16_to_lnurlp_url(lud16: &str) -> Result<String, String> {
    let trimmed = lud16.trim();
    let Some((user, domain)) = trimmed.split_once('@') else {
        return Err("Invalid Lightning Address (expected user@domain)".to_owned());
    };
    let user = user.trim();
    let domain = domain.trim();
    if user.is_empty()
        || domain.is_empty()
        || user.contains(['/', '?', '#', ' '])
        || domain.contains(['/', '?', '#', ' '])
    {
        return Err("Invalid Lightning Address format".to_owned());
    }
    let host_only = domain.split(':').next().unwrap_or(domain).to_ascii_lowercase();
    let scheme = if host_only == "localhost" || host_only == "127.0.0.1" {
        "http"
    } else {
        "https"
    };
    Ok(format!("{scheme}://{domain}/.well-known/lnurlp/{user}"))
}

/// Resolves a Lightning Address (`lud16`) via LNURL-pay and requests a BOLT-11
/// invoice (`pr`), attaching an optional signed NIP-57 `kind 9734` Zap Request.
pub async fn fetch_lnurl_zap_invoice(
    lud16: String,
    amount_sats: u64,
    signed_zap_request_json: Option<String>,
    comment: Option<String>,
) -> Result<ZapInvoiceDto, String> {
    if amount_sats == 0 {
        return Err("Zap amount must be at least 1 sat".to_owned());
    }
    let lnurl_url = resolve_lud16_to_lnurlp_url(&lud16)?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let meta_resp = client
        .get(&lnurl_url)
        .send()
        .await
        .map_err(|e| format!("LNURL lookup failed for {lud16}: {e}"))?;
    if !meta_resp.status().is_success() {
        return Err(format!(
            "LNURL endpoint returned HTTP {} for {lud16}",
            meta_resp.status()
        ));
    }
    let meta: serde_json::Value = meta_resp
        .json()
        .await
        .map_err(|e| format!("invalid LNURL JSON metadata: {e}"))?;
    if meta.get("status").and_then(|v| v.as_str()) == Some("ERROR") {
        let reason = meta
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("LNURL error");
        return Err(reason.to_owned());
    }

    let callback = meta
        .get("callback")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "LNURL metadata missing callback URL".to_owned())?
        .to_owned();
    let min_sendable = meta
        .get("minSendable")
        .and_then(|v| v.as_u64())
        .unwrap_or(1_000);
    let max_sendable = meta
        .get("maxSendable")
        .and_then(|v| v.as_u64())
        .unwrap_or(100_000_000_000);
    let allows_nostr = meta
        .get("allowsNostr")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let comment_allowed = meta
        .get("commentAllowed")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let min_sats = min_sendable.div_ceil(1000).max(1);
    let max_sats = (max_sendable / 1000).max(min_sats);
    let amount_msats = amount_sats.saturating_mul(1000);
    if amount_msats < min_sendable || amount_msats > max_sendable {
        return Err(format!(
            "Recipient accepts between {min_sats} and {max_sats} sats"
        ));
    }

    let mut cb_url = reqwest::Url::parse(&callback)
        .map_err(|e| format!("invalid LNURL callback URL: {e}"))?;
    {
        let mut qp = cb_url.query_pairs_mut();
        qp.append_pair("amount", &amount_msats.to_string());
        if allows_nostr {
            if let Some(zap_json) = signed_zap_request_json
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                qp.append_pair("nostr", zap_json);
            }
        }
        if comment_allowed > 0 {
            if let Some(clean_comment) = comment
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                let truncated: String =
                    clean_comment.chars().take(comment_allowed as usize).collect();
                qp.append_pair("comment", &truncated);
            }
        }
    }

    let inv_resp = client
        .get(cb_url)
        .send()
        .await
        .map_err(|e| format!("failed to fetch BOLT-11 invoice: {e}"))?;
    if !inv_resp.status().is_success() {
        return Err(format!(
            "LNURL callback returned HTTP {}",
            inv_resp.status()
        ));
    }
    let inv: serde_json::Value = inv_resp
        .json()
        .await
        .map_err(|e| format!("invalid LNURL invoice JSON: {e}"))?;
    if inv.get("status").and_then(|v| v.as_str()) == Some("ERROR") {
        let reason = inv
            .get("reason")
            .and_then(|v| v.as_str())
            .unwrap_or("LNURL invoice error");
        return Err(reason.to_owned());
    }
    let pr = inv
        .get("pr")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "LNURL callback returned no BOLT-11 payment request".to_owned())?
        .to_owned();
    let verify_url = inv
        .get("verify")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);

    Ok(ZapInvoiceDto {
        pr,
        verify_url,
        callback,
        min_sats,
        max_sats,
        allows_nostr,
        amount_sats,
    })
}

fn shoutbox_filter_tag(category: &str) -> Result<(&'static str, &'static str), String> {
    match category.trim().to_ascii_lowercase().as_str() {
        "announcements" | "blog" => Ok(("announcements", "blog")),
        "features" | "feature" => Ok(("features", "feature")),
        "greetings" => Ok(("greetings", "greetings")),
        "bugs" | "bug" => Ok(("bugs", "bug")),
        other => Err(format!("Unsupported shoutbox category: {other}")),
    }
}

/// Fetches Community Shoutbox (`kind 1`, `#earthlycity`) notes for a specific
/// category (`announcements` | `features` | `greetings` | `bugs`).
pub async fn fetch_shoutbox_posts(
    relay_urls: Vec<String>,
    category: String,
    limit: u32,
) -> Result<Vec<ShoutboxPostDto>, String> {
    let (canonical_category, filter_tag) = shoutbox_filter_tag(&category)?;
    let urls = crate::api::relay_pool::resolve_read_relays(&relay_urls);

    let client = crate::api::relay_pool::shared_client(&urls).await?;

    let filter = Filter::new()
        .kind(Kind::TextNote)
        .hashtag("earthlycity")
        .limit((limit as usize).clamp(1, 150));
    let events_res = client
        .fetch_events_from(&urls, filter, Duration::from_secs(8))
        .await;

    let events = events_res.map_err(|e| format!("failed to fetch shoutbox posts: {e}"))?;
    let dev_hex = PublicKey::parse(EARTHLY_CITY_DEVELOPER_NPUB)
        .map(|pk| pk.to_hex())
        .ok();

    let mut seen = HashSet::new();
    let mut posts = Vec::new();
    for ev in events {
        let raw = event_to_raw(&ev);
        if !seen.insert(raw.id.clone()) {
            continue;
        }
        let hashtags: Vec<String> = raw
            .tags
            .iter()
            .filter(|t| t.first().map(String::as_str) == Some("t"))
            .filter_map(|t| t.get(1).cloned())
            .collect();
        let has_category = hashtags
            .iter()
            .any(|t| t.eq_ignore_ascii_case(filter_tag));
        if !has_category {
            continue;
        }
        if canonical_category == "announcements" {
            if dev_hex.as_deref() != Some(raw.pubkey.as_str()) {
                continue;
            }
        }
        posts.push(ShoutboxPostDto {
            event_id: raw.id,
            pubkey: raw.pubkey,
            content: raw.content,
            category: canonical_category.to_owned(),
            created_at: raw.created_at,
            hashtags,
        });
    }

    posts.sort_by(|a, b| {
        b.created_at
            .cmp(&a.created_at)
            .then_with(|| a.event_id.cmp(&b.event_id))
    });
    Ok(posts)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn parses_nip65_relay_list_tags() {
        let tags = vec![
            vec!["r".to_owned(), "wss://relay.earthly.city/".to_owned()],
            vec![
                "r".to_owned(),
                "wss://nos.lol".to_owned(),
                "read".to_owned(),
            ],
            vec![
                "r".to_owned(),
                "wss://relay.damus.io".to_owned(),
                "write".to_owned(),
            ],
            vec!["r".to_owned(), "https://not-a-relay.invalid".to_owned()],
        ];
        let parsed = parse_nip65_tags(&tags);
        assert_eq!(parsed.len(), 3);
        let damus = parsed
            .iter()
            .find(|e| e.url == "wss://relay.damus.io")
            .unwrap();
        assert!(!damus.read && damus.write);
        let nos = parsed.iter().find(|e| e.url == "wss://nos.lol").unwrap();
        assert!(nos.read && !nos.write);
        let earthly = parsed
            .iter()
            .find(|e| e.url == "wss://relay.earthly.city")
            .unwrap();
        assert!(earthly.read && earthly.write);
    }

    #[test]
    fn resolves_lud16_lnurl_and_encodes_npub() {
        assert_eq!(
            resolve_lud16_to_lnurlp_url("satoshi@earthly.city").unwrap(),
            "https://earthly.city/.well-known/lnurlp/satoshi"
        );
        assert_eq!(
            resolve_lud16_to_lnurlp_url("dev@localhost:8080").unwrap(),
            "http://localhost:8080/.well-known/lnurlp/dev"
        );
        assert!(resolve_lud16_to_lnurlp_url("invalid-address").is_err());

        let keys = Keys::generate();
        let hex = keys.public_key().to_hex();
        let npub = encode_hex_to_npub(hex.clone()).unwrap();
        assert!(npub.starts_with("npub1"));
        assert_eq!(decode_npub_to_hex(npub).unwrap(), hex);

        let dev_hex = PublicKey::parse(EARTHLY_CITY_DEVELOPER_NPUB)
            .unwrap()
            .to_hex();
        assert_eq!(
            dev_hex,
            "3aa5817273c3b2f94f491840e0472f049d0f10009e23de63006166bca9b36ea3"
        );
    }

    #[test]
    fn parses_and_ranks_nip66_relay_discovery_events() {
        let events = vec![
            // Fast clearnet relay seen by monitor 1
            RawNostrEvent {
                id: "1".repeat(64),
                pubkey: "a".repeat(64),
                created_at: 1_750_000_100,
                kind: 30_166,
                tags: vec![
                    vec!["d".to_owned(), "wss://fast-public.example/".to_owned()],
                    vec!["n".to_owned(), "clearnet".to_owned()],
                    vec!["rtt-open".to_owned(), "65".to_owned()],
                    vec!["rtt-read".to_owned(), "90".to_owned()],
                    vec!["rtt-write".to_owned(), "110".to_owned()],
                    vec!["N".to_owned(), "1".to_owned()],
                    vec!["N".to_owned(), "11".to_owned()],
                    vec!["N".to_owned(), "33".to_owned()],
                    vec!["R".to_owned(), "!auth".to_owned()],
                    vec!["R".to_owned(), "!payment".to_owned()],
                    vec!["s".to_owned(), "strfry".to_owned()],
                    vec!["l".to_owned(), "de".to_owned(), "countryCode".to_owned()],
                ],
                content: String::new(),
            },
            // Same fast relay corroborated by monitor 2
            RawNostrEvent {
                id: "2".repeat(64),
                pubkey: "b".repeat(64),
                created_at: 1_750_000_200,
                kind: 30_166,
                tags: vec![
                    vec!["d".to_owned(), "wss://FAST-PUBLIC.example".to_owned()],
                    vec!["n".to_owned(), "clearnet".to_owned()],
                    vec!["rtt-open".to_owned(), "58".to_owned()],
                    vec!["N".to_owned(), "50".to_owned()],
                ],
                content: String::new(),
            },
            // Paid + auth-gated relay (should rank lower than open relay)
            RawNostrEvent {
                id: "3".repeat(64),
                pubkey: "a".repeat(64),
                created_at: 1_750_000_150,
                kind: 30_166,
                tags: vec![
                    vec!["d".to_owned(), "wss://paid-auth.example".to_owned()],
                    vec!["n".to_owned(), "clearnet".to_owned()],
                    vec!["rtt-open".to_owned(), "40".to_owned()],
                    vec!["R".to_owned(), "auth".to_owned()],
                    vec!["R".to_owned(), "payment".to_owned()],
                ],
                content: r#"{"software":"khatru","supported_nips":[1,42]}"#.to_owned(),
            },
            // Tor relay (must be filtered out)
            RawNostrEvent {
                id: "4".repeat(64),
                pubkey: "a".repeat(64),
                created_at: 1_750_000_300,
                kind: 30_166,
                tags: vec![
                    vec!["d".to_owned(), "wss://hiddenrelay.onion".to_owned()],
                    vec!["n".to_owned(), "tor".to_owned()],
                    vec!["rtt-open".to_owned(), "120".to_owned()],
                ],
                content: String::new(),
            },
        ];

        let ranked = aggregate_nip66_candidates(&events, 10);
        assert_eq!(ranked.len(), 2);
        assert_eq!(ranked[0].url, "wss://fast-public.example");
        assert_eq!(ranked[0].monitor_count, 2);
        assert_eq!(ranked[0].rtt_open_ms, Some(58));
        assert_eq!(ranked[0].rtt_read_ms, Some(90));
        assert_eq!(ranked[0].rtt_write_ms, Some(110));
        assert_eq!(ranked[0].supported_nips, vec![1, 11, 33, 50]);
        assert!(!ranked[0].auth_required && !ranked[0].payment_required);
        assert_eq!(ranked[0].software.as_deref(), Some("strfry"));
        assert_eq!(ranked[0].country_code.as_deref(), Some("DE"));

        assert_eq!(ranked[1].url, "wss://paid-auth.example");
        assert!(ranked[1].auth_required && ranked[1].payment_required);
        assert_eq!(ranked[1].software.as_deref(), Some("khatru"));
        assert_eq!(ranked[1].supported_nips, vec![1, 42]);
    }

    #[test]
    fn parses_nip11_and_computes_relay_quality_scores() {
        assert_eq!(
            ws_url_to_nip11_http_url("wss://relay.damus.io/").as_deref(),
            Some("https://relay.damus.io")
        );
        assert_eq!(
            ws_url_to_nip11_http_url("ws://127.0.0.1:7777/").as_deref(),
            Some("http://127.0.0.1:7777")
        );

        let doc = serde_json::json!({
            "name": "Earthly Relay",
            "description": "GeoJSON Nostr relay",
            "software": "khatru",
            "version": "0.9.1",
            "supported_nips": [1, 11, "33", 50],
            "limitation": {
                "auth_required": false,
                "payment_required": false,
                "restricted_writes": false,
                "max_message_length": 524288
            }
        });
        let nip11 = parse_nip11_json(&doc).unwrap();
        assert_eq!(nip11.name.as_deref(), Some("Earthly Relay"));
        assert_eq!(nip11.software.as_deref(), Some("khatru"));
        assert_eq!(nip11.supported_nips, vec![1, 11, 33, 50]);
        assert_eq!(nip11.max_message_length, Some(524_288));

        let (st_fast, sc_fast) = compute_relay_quality(true, 85, false, false, Some(&nip11));
        assert_eq!(st_fast, "healthy");
        assert_eq!(sc_fast, 100);

        let (st_slow, sc_slow) = compute_relay_quality(true, 1_100, false, false, Some(&nip11));
        assert_eq!(st_slow, "slow");
        assert!(sc_slow < sc_fast && sc_slow >= 15);

        let (st_auth, sc_auth) = compute_relay_quality(true, 70, true, false, Some(&nip11));
        assert_eq!(st_auth, "auth_required");
        assert!(sc_auth <= 55);

        let (st_off, sc_off) = compute_relay_quality(false, 0, false, false, None);
        assert_eq!(st_off, "offline");
        assert_eq!(sc_off, 0);
    }
}
