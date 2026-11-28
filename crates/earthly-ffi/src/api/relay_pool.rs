//! Process-wide persistent Nostr relay pool backed by `nostr-lmdb`, the
//! production Relay Manager (default public relays, NIP-65 read/write routing,
//! live quality cache), plus a disk-backed SHA-256 Blossom GeoJSON LRU cache.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock as StdRwLock};

use earthly_storage::settings::{
    DEFAULT_PUBLIC_RELAYS, PRIMARY_EARTHLY_RELAY, PROFILE_DISCOVERY_RELAY,
    default_production_relay_urls, normalize_relay_url,
};
use nostr::RelayUrl;
use nostr_lmdb::NostrLMDB;
use nostr_sdk::Client;
use nostr_sdk::prelude::{MemoryDatabase, MemoryDatabaseOptions};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock as AsyncRwLock;

use crate::api::nostr_client::{RelayListEntryDto, RelayQualityReportDto};

/// Maximum total size of cached Blossom GeoJSON payloads (64 MiB).
pub(crate) const BLOSSOM_CACHE_MAX_BYTES: usize = 64 * 1024 * 1024;
const LMDB_SUBDIR: &str = "nostr-cache.lmdb";
const BLOSSOM_SUBDIR: &str = "blossom_cache";
const LRU_INDEX_FILE: &str = ".lru_index.json";
const LMDB_MAP_SIZE_BYTES: usize = 512 * 1024 * 1024;
const MAX_FANOUT_WRITE_RELAYS: usize = 12;
const MAX_FANOUT_READ_RELAYS: usize = 14;

/// Default NIP-66 (`nostr.watch`) monitor relays publishing `kind 30166` events.
pub(crate) const NIP66_MONITOR_RELAYS: &[&str] = &[
    "wss://relay.nostr.watch",
    "wss://history.nostr.watch",
];

#[derive(Clone)]
pub(crate) struct SharedRelayPool {
    client: Client,
    data_dir: Option<PathBuf>,
}

#[derive(Clone, Debug)]
pub(crate) struct RelayManagerState {
    pub public_relays_enabled: bool,
    pub configured_relays: Vec<String>,
    pub active_user_pubkey: Option<String>,
    pub nip65_entries: Vec<RelayListEntryDto>,
    pub relay_sources: HashMap<String, String>,
    pub quality_cache: HashMap<String, RelayQualityReportDto>,
}

impl Default for RelayManagerState {
    fn default() -> Self {
        let mut relay_sources = HashMap::new();
        relay_sources.insert(PRIMARY_EARTHLY_RELAY.to_owned(), "earthly".to_owned());
        for url in DEFAULT_PUBLIC_RELAYS {
            relay_sources.insert((*url).to_owned(), "public_default".to_owned());
        }
        relay_sources.insert(
            PROFILE_DISCOVERY_RELAY.to_owned(),
            "profile_discovery".to_owned(),
        );
        Self {
            public_relays_enabled: true,
            configured_relays: default_production_relay_urls(),
            active_user_pubkey: None,
            nip65_entries: Vec::new(),
            relay_sources,
            quality_cache: HashMap::new(),
        }
    }
}

static RELAY_POOL: OnceLock<AsyncRwLock<Option<SharedRelayPool>>> = OnceLock::new();
static RELAY_MANAGER: OnceLock<StdRwLock<RelayManagerState>> = OnceLock::new();
static BLOSSOM_CACHE: OnceLock<Mutex<BlossomBlobCache>> = OnceLock::new();
static BLOSSOM_DATA_DIR: OnceLock<StdRwLock<Option<PathBuf>>> = OnceLock::new();

fn relay_pool_lock() -> &'static AsyncRwLock<Option<SharedRelayPool>> {
    RELAY_POOL.get_or_init(|| AsyncRwLock::new(None))
}

pub(crate) fn relay_manager_lock() -> &'static StdRwLock<RelayManagerState> {
    RELAY_MANAGER.get_or_init(|| StdRwLock::new(RelayManagerState::default()))
}

/// Returns `true` when `raw_url` points to a loopback or private-LAN host
/// (`localhost`, `127.*`, `[::1]`, RFC-1918, `.local`).
pub(crate) fn is_local_or_private_relay_url(raw_url: &str) -> bool {
    let trimmed = raw_url.trim();
    let without_scheme = trimmed
        .strip_prefix("wss://")
        .or_else(|| trimmed.strip_prefix("ws://"))
        .or_else(|| {
            trimmed
                .get(..6)
                .filter(|s| s.eq_ignore_ascii_case("wss://"))
                .map(|_| &trimmed[6..])
        })
        .or_else(|| {
            trimmed
                .get(..5)
                .filter(|s| s.eq_ignore_ascii_case("ws://"))
                .map(|_| &trimmed[5..])
        })
        .unwrap_or(trimmed);
    let authority = without_scheme.split('/').next().unwrap_or("");
    let host_part = authority.rsplit('@').next().unwrap_or(authority);
    let host = if let Some(bracketed) = host_part.strip_prefix('[') {
        bracketed.split(']').next().unwrap_or("").to_ascii_lowercase()
    } else {
        host_part
            .split(':')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
    };

    if host.is_empty() {
        return false;
    }
    if host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host == "::1"
        || host == "0.0.0.0"
        || host.starts_with("127.")
        || host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
    {
        return true;
    }
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(octet_str) = rest.split('.').next() {
            if let Ok(second) = octet_str.parse::<u8>() {
                if (16..=31).contains(&second) {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn is_all_local_relays(urls: &[String]) -> bool {
    !urls.is_empty() && urls.iter().all(|u| is_local_or_private_relay_url(u))
}

/// Returns `true` for specialized profile/relay-list directory relays (e.g. `purplepag.es`)
/// that only serve kinds 0, 3, and 10002 and reject general Earthly/wallet writes.
pub(crate) fn is_profile_directory_relay(raw_url: &str) -> bool {
    normalize_relay_url(raw_url).is_some_and(|norm| {
        norm == PROFILE_DISCOVERY_RELAY || norm.starts_with("wss://purplepag.es/")
    })
}

/// Returns `true` for private MLS / Cordn / NIP-59 gift-wrap event kinds that must
/// NEVER be automatically broadcast to public Nostr relays.
pub(crate) fn is_private_mls_event_kind(kind: u16) -> bool {
    matches!(kind, 444 | 445 | 1059 | 25_910)
}

fn push_unique_relay(target: &mut Vec<String>, raw: &str, max_len: usize) {
    if target.len() >= max_len {
        return;
    }
    if let Some(norm) = normalize_relay_url(raw) {
        if !target.contains(&norm) {
            target.push(norm);
        }
    }
}

/// Updates the process-wide `public_relays_enabled` policy in the Relay Manager.
pub(crate) fn set_relay_manager_public_enabled(enabled: bool) {
    if let Ok(mut guard) = relay_manager_lock().write() {
        guard.public_relays_enabled = enabled;
    }
}

/// Updates the configured relay list in the Relay Manager (ignoring loopback-only test URLs).
pub(crate) fn sync_configured_relays(relay_urls: &[String]) {
    let normalized: Vec<String> = relay_urls
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if normalized.is_empty() || is_all_local_relays(&normalized) {
        return;
    }
    if let Ok(mut guard) = relay_manager_lock().write() {
        let mut deduped = Vec::new();
        for url in normalized {
            if !deduped.contains(&url) {
                guard.relay_sources.entry(url.clone()).or_insert_with(|| {
                    if url == PRIMARY_EARTHLY_RELAY {
                        "earthly".to_owned()
                    } else if DEFAULT_PUBLIC_RELAYS.contains(&url.as_str()) {
                        "public_default".to_owned()
                    } else if is_profile_directory_relay(&url) {
                        "profile_discovery".to_owned()
                    } else {
                        "custom".to_owned()
                    }
                });
                deduped.push(url);
            }
        }
        guard.configured_relays = deduped;
    }
}

/// Records the active signed-in user's NIP-65 (`kind 10002`) relay list (respecting
/// read/write markers) into the Relay Manager.
pub(crate) fn merge_user_nip65_relays(pubkey_hex: String, entries: Vec<RelayListEntryDto>) {
    if let Ok(mut guard) = relay_manager_lock().write() {
        guard.active_user_pubkey = Some(pubkey_hex);
        let mut cleaned = Vec::new();
        for entry in entries {
            let Some(norm) = normalize_relay_url(&entry.url) else {
                continue;
            };
            if is_local_or_private_relay_url(&norm) {
                continue;
            }
            if !entry.read && !entry.write {
                continue;
            }
            guard.relay_sources.entry(norm.clone()).or_insert_with(|| {
                if norm == PRIMARY_EARTHLY_RELAY {
                    "earthly".to_owned()
                } else if DEFAULT_PUBLIC_RELAYS.contains(&norm.as_str()) {
                    "public_default".to_owned()
                } else {
                    "nip65".to_owned()
                }
            });
            if let Some(existing) = cleaned
                .iter_mut()
                .find(|e: &&mut RelayListEntryDto| e.url == norm)
            {
                existing.read |= entry.read;
                existing.write |= entry.write;
            } else {
                cleaned.push(RelayListEntryDto {
                    url: norm,
                    read: entry.read,
                    write: entry.write,
                });
            }
        }
        guard.nip65_entries = cleaned;
    }
}

/// Records a relay URL added from NIP-66 discovery so UI badges show its origin.
pub(crate) fn record_nip66_relay_source(url: &str) {
    if let Some(norm) = normalize_relay_url(url) {
        if let Ok(mut guard) = relay_manager_lock().write() {
            guard.relay_sources.insert(norm, "nip66".to_owned());
        }
    }
}

/// Caches live relay quality probe results in the Relay Manager.
pub(crate) fn record_relay_quality_reports(reports: &[RelayQualityReportDto]) {
    if let Ok(mut guard) = relay_manager_lock().write() {
        for report in reports {
            if let Some(norm) = normalize_relay_url(&report.url) {
                let mut cloned = report.clone();
                cloned.url = norm.clone();
                guard.quality_cache.insert(norm, cloned);
            }
        }
    }
}

/// Returns a snapshot of the current Relay Manager state.
pub(crate) fn snapshot_relay_manager_state() -> RelayManagerState {
    relay_manager_lock()
        .read()
        .map(|g| g.clone())
        .unwrap_or_default()
}

/// Resolves target read relays for Earthly entities (`37515`, `37517`, `37518`,
/// `37519`, `37520`, `37521`, `37522`, comments, proposals, inbox, shoutbox).
///
/// Loopback/private-LAN-only lists are preserved untouched for offline tests and LAN isolation.
pub(crate) fn resolve_read_relays(explicit: &[String]) -> Vec<String> {
    let norm_explicit: Vec<String> = explicit
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if is_all_local_relays(&norm_explicit) {
        return norm_explicit;
    }

    let state = snapshot_relay_manager_state();
    let mut out = Vec::new();
    for url in &norm_explicit {
        if !is_profile_directory_relay(url) {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
    }
    push_unique_relay(&mut out, PRIMARY_EARTHLY_RELAY, MAX_FANOUT_READ_RELAYS);

    if state.public_relays_enabled {
        for url in &state.configured_relays {
            if !is_local_or_private_relay_url(url) && !is_profile_directory_relay(url) {
                push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
            }
        }
        if out.len() <= 1 {
            for url in DEFAULT_PUBLIC_RELAYS {
                push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
            }
        }
    }

    for entry in &state.nip65_entries {
        if entry.read
            && !is_local_or_private_relay_url(&entry.url)
            && !is_profile_directory_relay(&entry.url)
        {
            push_unique_relay(&mut out, &entry.url, MAX_FANOUT_READ_RELAYS);
        }
    }

    if out.is_empty() {
        out.push(PRIMARY_EARTHLY_RELAY.to_owned());
    }
    out
}

/// Resolves target write relays for publishing signed public Nostr events.
///
/// Strictly prevents leaking private MLS kinds (`444`, `445`, `1059`, `25910`)
/// or loopback/LAN-only publishes to public relays, and respects NIP-65 `write`
/// markers (never broadcasting writes to read-only NIP-65 relays).
pub(crate) fn resolve_write_relays(explicit: &[String], event_kind: Option<u16>) -> Vec<String> {
    let norm_explicit: Vec<String> = explicit
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if is_all_local_relays(&norm_explicit) {
        return norm_explicit;
    }
    if event_kind.is_some_and(is_private_mls_event_kind) {
        return if norm_explicit.is_empty() {
            vec![PRIMARY_EARTHLY_RELAY.to_owned()]
        } else {
            norm_explicit
        };
    }

    let is_profile_or_relay_list = matches!(event_kind, Some(0 | 3 | 10_002));
    let state = snapshot_relay_manager_state();
    let mut out = Vec::new();

    for url in &norm_explicit {
        if is_profile_or_relay_list || !is_profile_directory_relay(url) {
            push_unique_relay(&mut out, url, MAX_FANOUT_WRITE_RELAYS);
        }
    }
    push_unique_relay(&mut out, PRIMARY_EARTHLY_RELAY, MAX_FANOUT_WRITE_RELAYS);

    if state.public_relays_enabled {
        for url in &state.configured_relays {
            if !is_local_or_private_relay_url(url)
                && (is_profile_or_relay_list || !is_profile_directory_relay(url))
            {
                push_unique_relay(&mut out, url, MAX_FANOUT_WRITE_RELAYS);
            }
        }
        if out.len() <= 1 {
            for url in DEFAULT_PUBLIC_RELAYS {
                push_unique_relay(&mut out, url, MAX_FANOUT_WRITE_RELAYS);
            }
        }
    }

    for entry in &state.nip65_entries {
        if entry.write
            && !is_local_or_private_relay_url(&entry.url)
            && (is_profile_or_relay_list || !is_profile_directory_relay(&entry.url))
        {
            push_unique_relay(&mut out, &entry.url, MAX_FANOUT_WRITE_RELAYS);
        }
    }

    if is_profile_or_relay_list && state.public_relays_enabled {
        push_unique_relay(&mut out, PROFILE_DISCOVERY_RELAY, MAX_FANOUT_WRITE_RELAYS);
    }

    if out.is_empty() {
        out.push(PRIMARY_EARTHLY_RELAY.to_owned());
    }
    out
}

/// Resolves profile & metadata discovery relays (`kind 0`, `kind 10002`, `kind 10019`):
/// fans out across `purplepag.es`, major public relays, user NIP-65 read relays, and
/// `relay.earthly.city` while preserving loopback-only isolation for offline tests.
pub(crate) fn resolve_profile_discovery_relays(explicit: &[String]) -> Vec<String> {
    let norm_explicit: Vec<String> = explicit
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if is_all_local_relays(&norm_explicit) {
        return norm_explicit;
    }

    let state = snapshot_relay_manager_state();
    let mut out = Vec::new();
    for url in &norm_explicit {
        push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
    }
    push_unique_relay(&mut out, PRIMARY_EARTHLY_RELAY, MAX_FANOUT_READ_RELAYS);
    push_unique_relay(&mut out, PROFILE_DISCOVERY_RELAY, MAX_FANOUT_READ_RELAYS);

    if state.public_relays_enabled {
        for url in DEFAULT_PUBLIC_RELAYS {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
        for url in &state.configured_relays {
            if !is_local_or_private_relay_url(url) {
                push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
            }
        }
    }

    for entry in &state.nip65_entries {
        if entry.read && !is_local_or_private_relay_url(&entry.url) {
            push_unique_relay(&mut out, &entry.url, MAX_FANOUT_READ_RELAYS);
        }
    }
    out
}

/// Resolves relays for NIP-57 Zap receipts (`kind 9735`) and NIP-25 reactions (`kind 7`).
pub(crate) fn resolve_zap_read_relays(explicit: &[String]) -> Vec<String> {
    let norm_explicit: Vec<String> = explicit
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if is_all_local_relays(&norm_explicit) {
        return norm_explicit;
    }

    let state = snapshot_relay_manager_state();
    let mut out = Vec::new();
    for url in &norm_explicit {
        if !is_profile_directory_relay(url) {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
    }
    push_unique_relay(&mut out, PRIMARY_EARTHLY_RELAY, MAX_FANOUT_READ_RELAYS);
    if state.public_relays_enabled {
        for url in DEFAULT_PUBLIC_RELAYS {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
        for url in &state.configured_relays {
            if !is_local_or_private_relay_url(url) && !is_profile_directory_relay(url) {
                push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
            }
        }
    }
    for entry in &state.nip65_entries {
        if entry.read
            && !is_local_or_private_relay_url(&entry.url)
            && !is_profile_directory_relay(&entry.url)
        {
            push_unique_relay(&mut out, &entry.url, MAX_FANOUT_READ_RELAYS);
        }
    }
    out
}

/// Resolves relays for NIP-60/61 Cashu Wallet sync (`17375`, `7375`, `7376`, `9321`, `10019`):
/// combines explicit relays, user NIP-65 read+write relays, major public relays, and Earthly relay.
pub(crate) fn resolve_wallet_relays(explicit: &[String]) -> Vec<String> {
    let norm_explicit: Vec<String> = explicit
        .iter()
        .filter_map(|u| normalize_relay_url(u))
        .collect();
    if is_all_local_relays(&norm_explicit) {
        return norm_explicit;
    }

    let state = snapshot_relay_manager_state();
    let mut out = Vec::new();
    for url in &norm_explicit {
        if !is_profile_directory_relay(url) {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
    }
    push_unique_relay(&mut out, PRIMARY_EARTHLY_RELAY, MAX_FANOUT_READ_RELAYS);
    if state.public_relays_enabled {
        for url in DEFAULT_PUBLIC_RELAYS {
            push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
        }
        for url in &state.configured_relays {
            if !is_local_or_private_relay_url(url) && !is_profile_directory_relay(url) {
                push_unique_relay(&mut out, url, MAX_FANOUT_READ_RELAYS);
            }
        }
    }
    for entry in &state.nip65_entries {
        if !is_local_or_private_relay_url(&entry.url) && !is_profile_directory_relay(&entry.url) {
            push_unique_relay(&mut out, &entry.url, MAX_FANOUT_READ_RELAYS);
        }
    }
    out
}

/// Returns the set of currently connected relay URLs in the shared pool (if initialized).
pub(crate) async fn connected_relay_urls() -> HashMap<String, bool> {
    let client = {
        let guard = relay_pool_lock().read().await;
        guard.as_ref().map(|p| p.client.clone())
    };
    let mut map = HashMap::new();
    if let Some(client) = client {
        for (url, relay) in client.relays().await {
            if let Some(norm) = normalize_relay_url(&url.to_string()) {
                map.insert(norm, relay.is_connected());
            }
        }
    }
    map
}

fn blossom_data_dir_lock() -> &'static StdRwLock<Option<PathBuf>> {
    BLOSSOM_DATA_DIR.get_or_init(|| StdRwLock::new(None))
}

fn blossom_cache_lock() -> &'static Mutex<BlossomBlobCache> {
    BLOSSOM_CACHE.get_or_init(|| {
        let dir = blossom_data_dir_lock()
            .read()
            .ok()
            .and_then(|g| g.clone())
            .map(|p| p.join(BLOSSOM_SUBDIR));
        Mutex::new(BlossomBlobCache::new(dir, BLOSSOM_CACHE_MAX_BYTES))
    })
}

fn build_memory_client() -> Client {
    let db = MemoryDatabase::with_opts(MemoryDatabaseOptions {
        events: true,
        max_events: Some(35_000),
    });
    Client::builder().database(db).build()
}

fn build_lmdb_client(data_dir: &Path) -> Result<Client, String> {
    let lmdb_dir = data_dir.join(LMDB_SUBDIR);
    std::fs::create_dir_all(&lmdb_dir)
        .map_err(|err| format!("failed to create nostr-cache.lmdb directory: {err}"))?;
    let db = NostrLMDB::builder(&lmdb_dir)
        .map_size(LMDB_MAP_SIZE_BYTES)
        .max_readers(64)
        .build()
        .map_err(|err| format!("failed to open nostr-cache.lmdb: {err}"))?;
    Ok(Client::builder().database(db).build())
}

fn update_blossom_cache_dir(data_dir: Option<&Path>) {
    let cache_dir = data_dir.map(|d| d.join(BLOSSOM_SUBDIR));
    if let Ok(mut guard) = blossom_data_dir_lock().write() {
        *guard = data_dir.map(Path::to_path_buf);
    }
    if let Some(cache_mutex) = BLOSSOM_CACHE.get() {
        if let Ok(mut cache) = cache_mutex.lock() {
            cache.set_cache_dir(cache_dir);
        }
    }
}

async fn ensure_relays_connected(client: &Client, relay_urls: &[String]) -> Result<(), String> {
    let existing = client.relays().await;
    let mut needs_connect = false;
    let mut valid_count = 0usize;
    let mut last_err: Option<String> = None;

    for raw in relay_urls {
        let Some(clean) = normalize_relay_url(raw) else {
            if !raw.trim().is_empty() {
                last_err = Some(format!("invalid relay URL {}", raw.trim()));
            }
            continue;
        };
        let parsed = match RelayUrl::parse(&clean) {
            Ok(url) => url,
            Err(err) => {
                last_err = Some(format!("invalid relay URL {clean}: {err}"));
                continue;
            }
        };
        valid_count += 1;
        if let Some(relay) = existing.get(&parsed) {
            if !relay.is_connected() {
                needs_connect = true;
            }
        } else {
            if let Err(err) = client.add_relay(&parsed).await {
                last_err = Some(format!("failed to add relay {clean}: {err}"));
                continue;
            }
            needs_connect = true;
        }
    }

    if valid_count == 0 && !relay_urls.is_empty() {
        return Err(last_err.unwrap_or_else(|| "no valid relay URLs provided".to_owned()));
    }

    if needs_connect {
        client.connect().await;
    }
    Ok(())
}

/// Initializes the process-wide persistent Nostr relay pool backed by
/// `NostrLMDB` at `<data_dir>/nostr-cache.lmdb` and configures the disk-backed
/// Blossom cache at `<data_dir>/blossom_cache/`.
///
/// Reuses an existing pool if already initialized for the same `data_dir`.
pub async fn init_relay_pool(data_dir: String, relay_urls: Vec<String>) -> Result<(), String> {
    let trimmed_dir = data_dir.trim();
    let target_dir = if trimmed_dir.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed_dir))
    };

    update_blossom_cache_dir(target_dir.as_deref());
    sync_configured_relays(&relay_urls);

    let effective_urls = if relay_urls.is_empty() {
        default_production_relay_urls()
    } else {
        resolve_read_relays(&relay_urls)
    };

    let client = {
        let mut guard = relay_pool_lock().write().await;
        match (&*guard, &target_dir) {
            (Some(existing), Some(wanted)) if existing.data_dir.as_ref() == Some(wanted) => {
                existing.client.clone()
            }
            (Some(existing), None) if existing.data_dir.is_none() => existing.client.clone(),
            (prev, Some(wanted)) => {
                if let Some(old) = prev {
                    old.client.disconnect().await;
                }
                let client = build_lmdb_client(wanted)?;
                *guard = Some(SharedRelayPool {
                    client: client.clone(),
                    data_dir: Some(wanted.clone()),
                });
                client
            }
            (prev, None) => {
                if let Some(old) = prev {
                    old.client.disconnect().await;
                }
                let client = build_memory_client();
                *guard = Some(SharedRelayPool {
                    client: client.clone(),
                    data_dir: None,
                });
                client
            }
        }
    };

    ensure_relays_connected(&client, &effective_urls).await
}

/// Returns the process-wide shared `nostr_sdk::Client`, falling back to an
/// in-memory shared client if `init_relay_pool` has not been called yet, and
/// ensures all requested `relay_urls` are added and connected without tearing
/// down the pool between operations.
pub(crate) async fn shared_client(relay_urls: &[String]) -> Result<Client, String> {
    let client = {
        let read_guard = relay_pool_lock().read().await;
        if let Some(pool) = &*read_guard {
            pool.client.clone()
        } else {
            drop(read_guard);
            let mut write_guard = relay_pool_lock().write().await;
            if let Some(pool) = &*write_guard {
                pool.client.clone()
            } else {
                let fallback = build_memory_client();
                *write_guard = Some(SharedRelayPool {
                    client: fallback.clone(),
                    data_dir: None,
                });
                fallback
            }
        }
    };

    ensure_relays_connected(&client, relay_urls).await?;
    Ok(client)
}

/// Reads a cached Blossom GeoJSON payload by key (`sha256:<hex>` or URL),
/// refreshing its LRU position.
pub(crate) fn read_cached_blossom_blob(cache_key: &str) -> Option<String> {
    blossom_cache_lock().lock().ok()?.read(cache_key)
}

/// Writes a Blossom GeoJSON payload into the LRU cache (disk-backed when
/// `data_dir` was configured, in-memory fallback otherwise), evicting oldest
/// entries once total cached bytes exceed 64 MiB.
pub(crate) fn write_cached_blossom_blob(cache_key: &str, payload: &str) {
    if let Ok(mut guard) = blossom_cache_lock().lock() {
        guard.write(cache_key, payload);
    }
}

/// Bounded LRU blob cache supporting `<data_dir>/blossom_cache/` disk storage
/// with automatic fallback to in-memory LRU when no disk directory is set.
#[derive(Debug)]
pub(crate) struct BlossomBlobCache {
    cache_dir: Option<PathBuf>,
    max_bytes: usize,
    disk_order: VecDeque<(String, usize)>,
    disk_bytes: usize,
    disk_hydrated: bool,
    mem_entries: HashMap<String, String>,
    mem_order: VecDeque<(String, usize)>,
    mem_bytes: usize,
}

impl BlossomBlobCache {
    pub(crate) fn new(cache_dir: Option<PathBuf>, max_bytes: usize) -> Self {
        Self {
            cache_dir,
            max_bytes,
            disk_order: VecDeque::new(),
            disk_bytes: 0,
            disk_hydrated: false,
            mem_entries: HashMap::new(),
            mem_order: VecDeque::new(),
            mem_bytes: 0,
        }
    }

    pub(crate) fn set_cache_dir(&mut self, cache_dir: Option<PathBuf>) {
        if self.cache_dir != cache_dir {
            self.cache_dir = cache_dir;
            self.disk_order.clear();
            self.disk_bytes = 0;
            self.disk_hydrated = false;
        }
    }

    pub(crate) fn read(&mut self, cache_key: &str) -> Option<String> {
        if let Some(dir) = self.cache_dir.clone() {
            self.ensure_disk_hydrated(&dir);
            let file_name = cache_file_name(cache_key);
            let path = dir.join(&file_name);
            let content = match std::fs::read_to_string(&path) {
                Ok(text) => text,
                Err(_) => {
                    self.remove_disk_entry(&file_name);
                    return None;
                }
            };
            let size = content.len();
            self.touch_disk_entry(&file_name, size);
            self.persist_disk_index(&dir);
            Some(content)
        } else {
            let content = self.mem_entries.get(cache_key)?.clone();
            let size = content.len();
            self.touch_mem_entry(cache_key, size);
            Some(content)
        }
    }

    pub(crate) fn write(&mut self, cache_key: &str, payload: &str) {
        let size = payload.len();
        if size > self.max_bytes {
            return;
        }

        if let Some(dir) = self.cache_dir.clone() {
            if std::fs::create_dir_all(&dir).is_err() {
                return;
            }
            self.ensure_disk_hydrated(&dir);
            let file_name = cache_file_name(cache_key);
            let path = dir.join(&file_name);
            if std::fs::write(&path, payload.as_bytes()).is_err() {
                return;
            }
            self.touch_disk_entry(&file_name, size);
            while self.disk_bytes > self.max_bytes {
                let Some((evict_file, evict_size)) = self.disk_order.pop_front() else {
                    break;
                };
                self.disk_bytes = self.disk_bytes.saturating_sub(evict_size);
                let _ = std::fs::remove_file(dir.join(evict_file));
            }
            self.persist_disk_index(&dir);
        } else {
            self.mem_entries
                .insert(cache_key.to_owned(), payload.to_owned());
            self.touch_mem_entry(cache_key, size);
            while self.mem_bytes > self.max_bytes {
                let Some((evict_key, evict_size)) = self.mem_order.pop_front() else {
                    break;
                };
                self.mem_bytes = self.mem_bytes.saturating_sub(evict_size);
                self.mem_entries.remove(&evict_key);
            }
        }
    }

    fn ensure_disk_hydrated(&mut self, dir: &Path) {
        if self.disk_hydrated {
            return;
        }
        self.disk_hydrated = true;
        self.disk_order.clear();
        self.disk_bytes = 0;

        let index_path = dir.join(LRU_INDEX_FILE);
        if let Ok(raw) = std::fs::read_to_string(&index_path) {
            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let Some(entries) = parsed.get("entries").and_then(|v| v.as_array()) {
                    for entry in entries {
                        let Some(file_name) = entry.get("file_name").and_then(|v| v.as_str()) else {
                            continue;
                        };
                        let path = dir.join(file_name);
                        if let Ok(meta) = std::fs::metadata(&path) {
                            let actual_size = meta.len() as usize;
                            self.disk_bytes = self.disk_bytes.saturating_add(actual_size);
                            self.disk_order
                                .push_back((file_name.to_owned(), actual_size));
                        }
                    }
                }
            }
        }

        // Discover any unindexed `.geojson` files in `dir` (sorted by mtime).
        if let Ok(read_dir) = std::fs::read_dir(dir) {
            let mut extra = Vec::new();
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.extension().and_then(|e| e.to_str()) != Some("geojson") {
                    continue;
                }
                let Some(file_name) = path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(str::to_owned)
                else {
                    continue;
                };
                if self.disk_order.iter().any(|(name, _)| name == &file_name) {
                    continue;
                }
                if let Ok(meta) = entry.metadata() {
                    let mtime = meta.modified().ok();
                    extra.push((mtime, file_name, meta.len() as usize));
                }
            }
            extra.sort_by_key(|(mtime, _, _)| *mtime);
            for (_, file_name, size) in extra {
                self.disk_bytes = self.disk_bytes.saturating_add(size);
                self.disk_order.push_back((file_name, size));
            }
        }
    }

    fn remove_disk_entry(&mut self, file_name: &str) {
        if let Some(pos) = self.disk_order.iter().position(|(name, _)| name == file_name) {
            if let Some((_, size)) = self.disk_order.remove(pos) {
                self.disk_bytes = self.disk_bytes.saturating_sub(size);
            }
        }
    }

    fn touch_disk_entry(&mut self, file_name: &str, size: usize) {
        self.remove_disk_entry(file_name);
        self.disk_bytes = self.disk_bytes.saturating_add(size);
        self.disk_order.push_back((file_name.to_owned(), size));
    }

    fn persist_disk_index(&self, dir: &Path) {
        let entries: Vec<serde_json::Value> = self
            .disk_order
            .iter()
            .map(|(file_name, size_bytes)| {
                serde_json::json!({
                    "file_name": file_name,
                    "size_bytes": size_bytes,
                })
            })
            .collect();
        let index = serde_json::json!({ "entries": entries });
        if let Ok(json) = serde_json::to_string(&index) {
            let _ = std::fs::write(dir.join(LRU_INDEX_FILE), json.as_bytes());
        }
    }

    fn touch_mem_entry(&mut self, key: &str, size: usize) {
        if let Some(pos) = self.mem_order.iter().position(|(k, _)| k == key) {
            if let Some((_, old_size)) = self.mem_order.remove(pos) {
                self.mem_bytes = self.mem_bytes.saturating_sub(old_size);
            }
        }
        self.mem_bytes = self.mem_bytes.saturating_add(size);
        self.mem_order.push_back((key.to_owned(), size));
    }
}

fn cache_file_name(cache_key: &str) -> String {
    let trimmed = cache_key.trim();
    let candidate = trimmed.strip_prefix("sha256:").unwrap_or(trimmed);
    if candidate.len() == 64 && candidate.bytes().all(|b| b.is_ascii_hexdigit()) {
        return format!("{}.geojson", candidate.to_ascii_lowercase());
    }
    let digest = format!("{:x}", Sha256::digest(trimmed.as_bytes()));
    format!("url-{digest}.geojson")
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::{EventBuilder, Keys, Kind};
    use nostr_sdk::Filter;
    use tempfile::TempDir;

    #[test]
    fn disk_blossom_cache_evicts_least_recently_used_and_persists_across_reopen() {
        let dir = TempDir::new().unwrap();
        let cache_dir = dir.path().join(BLOSSOM_SUBDIR);

        let key_a = format!("sha256:{}", "a".repeat(64));
        let key_b = format!("sha256:{}", "b".repeat(64));
        let key_c = format!("sha256:{}", "c".repeat(64));

        let payload_a = "A".repeat(40);
        let payload_b = "B".repeat(40);
        let payload_c = "C".repeat(40);

        {
            let mut cache = BlossomBlobCache::new(Some(cache_dir.clone()), 100);
            cache.write(&key_a, &payload_a);
            cache.write(&key_b, &payload_b);
            // Reading A promotes it ahead of B in LRU order.
            assert_eq!(cache.read(&key_a).as_deref(), Some(payload_a.as_str()));
            // Writing C (total 120 > 100) must evict B, keeping A and C.
            cache.write(&key_c, &payload_c);

            assert_eq!(cache.read(&key_a).as_deref(), Some(payload_a.as_str()));
            assert!(cache.read(&key_b).is_none());
            assert_eq!(cache.read(&key_c).as_deref(), Some(payload_c.as_str()));
            assert!(!cache_dir.join(format!("{}.geojson", "b".repeat(64))).exists());
        }

        // Re-opening from disk preserves persisted index & entries.
        let mut reopened = BlossomBlobCache::new(Some(cache_dir), 100);
        assert_eq!(reopened.read(&key_a).as_deref(), Some(payload_a.as_str()));
        assert!(reopened.read(&key_b).is_none());
        assert_eq!(reopened.read(&key_c).as_deref(), Some(payload_c.as_str()));
    }

    #[test]
    fn memory_fallback_blossom_cache_evicts_lru_when_data_dir_unset() {
        let mut cache = BlossomBlobCache::new(None, 90);
        let payload_1 = "1".repeat(40);
        let payload_2 = "2".repeat(40);
        let payload_3 = "3".repeat(40);

        cache.write("https://blossom.example/1.geojson", &payload_1);
        cache.write("https://blossom.example/2.geojson", &payload_2);
        assert_eq!(
            cache.read("https://blossom.example/1.geojson").as_deref(),
            Some(payload_1.as_str())
        );

        cache.write("https://blossom.example/3.geojson", &payload_3);
        assert!(cache.read("https://blossom.example/1.geojson").is_some());
        assert!(cache.read("https://blossom.example/2.geojson").is_none());
        assert!(cache.read("https://blossom.example/3.geojson").is_some());
    }

    #[tokio::test]
    async fn lmdb_client_persists_events_for_offline_database_queries() {
        let dir = TempDir::new().unwrap();
        let client = build_lmdb_client(dir.path()).unwrap();

        let keys = Keys::generate();
        let event = EventBuilder::new(Kind::Custom(37_515), r#"{"type":"FeatureCollection","features":[]}"#)
            .tag(nostr::Tag::identifier("offline-lmdb-map"))
            .sign_with_keys(&keys)
            .unwrap();
        client.database().save_event(&event).await.unwrap();
        drop(client);

        // Re-open NostrLMDB at the same data_dir and verify offline query succeeds.
        let reopened = build_lmdb_client(dir.path()).unwrap();
        let found = reopened
            .database()
            .query(Filter::new().kind(Kind::Custom(37_515)).author(keys.public_key()))
            .await
            .unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found.first().unwrap().id, event.id);
    }

    #[tokio::test]
    async fn shared_client_reuses_pool_without_teardown() {
        let urls = vec!["wss://relay.earthly.city".to_owned()];
        let first = shared_client(&urls).await.unwrap();
        let second = shared_client(&urls).await.unwrap();
        let relays_first = first.relays().await;
        let relays_second = second.relays().await;
        assert!(relays_first.contains_key(&RelayUrl::parse("wss://relay.earthly.city").unwrap()));
        assert!(relays_second.contains_key(&RelayUrl::parse("wss://relay.earthly.city").unwrap()));
    }

    #[test]
    fn relay_manager_routing_respects_nip65_markers_mls_privacy_and_local_isolation() {
        // Guard against global state pollution across parallel unit tests.
        let prev = snapshot_relay_manager_state();
        set_relay_manager_public_enabled(true);
        sync_configured_relays(&default_production_relay_urls());
        merge_user_nip65_relays(
            "a".repeat(64),
            vec![
                RelayListEntryDto {
                    url: "wss://read-only.example/".to_owned(),
                    read: true,
                    write: false,
                },
                RelayListEntryDto {
                    url: "wss://write-only.example/".to_owned(),
                    read: false,
                    write: true,
                },
                RelayListEntryDto {
                    url: "wss://both.example".to_owned(),
                    read: true,
                    write: true,
                },
            ],
        );

        let seed = vec![PRIMARY_EARTHLY_RELAY.to_owned()];

        // 1. Entity reads include Earthly + public defaults + NIP-65 read relays (never write-only or purplepag.es).
        let reads = resolve_read_relays(&seed);
        assert!(reads.contains(&PRIMARY_EARTHLY_RELAY.to_owned()));
        assert!(reads.contains(&"wss://relay.damus.io".to_owned()));
        assert!(reads.contains(&"wss://nos.lol".to_owned()));
        assert!(reads.contains(&"wss://relay.primal.net".to_owned()));
        assert!(reads.contains(&"wss://read-only.example".to_owned()));
        assert!(reads.contains(&"wss://both.example".to_owned()));
        assert!(!reads.contains(&"wss://write-only.example".to_owned()));
        assert!(!reads.contains(&PROFILE_DISCOVERY_RELAY.to_owned()));

        // 2. Public geo, story, atlas, sighting, comment, reaction, and wallet writes include
        // Earthly + public defaults + NIP-65 write relays (never read-only or purplepag.es).
        for public_kind in [37_515u16, 37_517, 37_518, 37_520, 37_522, 30_023, 7, 7_375, 7_376, 9_321, 10_019, 17_375] {
            let writes = resolve_write_relays(&seed, Some(public_kind));
            assert!(writes.contains(&PRIMARY_EARTHLY_RELAY.to_owned()), "kind {public_kind}");
            assert!(writes.contains(&"wss://relay.damus.io".to_owned()), "kind {public_kind}");
            assert!(writes.contains(&"wss://nos.lol".to_owned()), "kind {public_kind}");
            assert!(writes.contains(&"wss://relay.primal.net".to_owned()), "kind {public_kind}");
            assert!(writes.contains(&"wss://write-only.example".to_owned()), "kind {public_kind}");
            assert!(writes.contains(&"wss://both.example".to_owned()), "kind {public_kind}");
            assert!(!writes.contains(&"wss://read-only.example".to_owned()), "kind {public_kind}");
            assert!(!writes.contains(&PROFILE_DISCOVERY_RELAY.to_owned()), "kind {public_kind}");
        }

        // 3. Profile (kind 0) and NIP-65 (kind 10002) writes include purplepag.es!
        let profile_writes = resolve_write_relays(&seed, Some(0));
        assert!(profile_writes.contains(&PROFILE_DISCOVERY_RELAY.to_owned()));
        let nip65_writes = resolve_write_relays(&seed, Some(10_002));
        assert!(nip65_writes.contains(&PROFILE_DISCOVERY_RELAY.to_owned()));

        // 4. Profile discovery reads include purplepag.es + public relays + NIP-65 read relays.
        let prof_reads = resolve_profile_discovery_relays(&seed);
        assert!(prof_reads.contains(&PROFILE_DISCOVERY_RELAY.to_owned()));
        assert!(prof_reads.contains(&"wss://relay.damus.io".to_owned()));
        assert!(prof_reads.contains(&"wss://read-only.example".to_owned()));

        // 5. NIP-60 wallet relays include Earthly + public relays + all NIP-65 relays (excluding purplepag.es).
        let wallet = resolve_wallet_relays(&seed);
        assert!(wallet.contains(&PRIMARY_EARTHLY_RELAY.to_owned()));
        assert!(wallet.contains(&"wss://relay.damus.io".to_owned()));
        assert!(wallet.contains(&"wss://read-only.example".to_owned()));
        assert!(wallet.contains(&"wss://write-only.example".to_owned()));
        assert!(!wallet.contains(&PROFILE_DISCOVERY_RELAY.to_owned()));

        // 6. Private MLS kinds MUST NEVER expand to public relays!
        for private_kind in [444u16, 445, 1059, 25_910] {
            let mls_targets = resolve_write_relays(&seed, Some(private_kind));
            assert_eq!(mls_targets, vec![PRIMARY_EARTHLY_RELAY.to_owned()]);
        }

        // 7. Loopback / LAN-only relay targets MUST NEVER fan out to public relays!
        let lan_only = vec!["ws://127.0.0.1:7777".to_owned(), "ws://192.168.1.42:8080".to_owned()];
        assert_eq!(resolve_read_relays(&lan_only), lan_only);
        assert_eq!(resolve_write_relays(&lan_only, Some(37_515)), lan_only);
        assert_eq!(resolve_profile_discovery_relays(&lan_only), lan_only);
        assert_eq!(resolve_wallet_relays(&lan_only), lan_only);
        assert_eq!(resolve_zap_read_relays(&lan_only), lan_only);

        // 8. Disabling public_relays_enabled MUST gate DEFAULT_PUBLIC_RELAYS across
        // ALL resolvers (including zap reads and Cashu wallet sync).
        set_relay_manager_public_enabled(false);
        sync_configured_relays(&[PRIMARY_EARTHLY_RELAY.to_owned()]);
        merge_user_nip65_relays("a".repeat(64), Vec::new());
        for list in [
            resolve_read_relays(&seed),
            resolve_write_relays(&seed, Some(37_515)),
            resolve_profile_discovery_relays(&seed),
            resolve_zap_read_relays(&seed),
            resolve_wallet_relays(&seed),
        ] {
            for default_pub in DEFAULT_PUBLIC_RELAYS {
                assert!(
                    !list.iter().any(|u| u == default_pub),
                    "expected {default_pub} to be excluded when public_relays_enabled=false; got {list:?}"
                );
            }
            assert!(list.contains(&PRIMARY_EARTHLY_RELAY.to_owned()));
        }

        // Restore previous state.
        if let Ok(mut guard) = relay_manager_lock().write() {
            *guard = prev;
        }
    }
}
