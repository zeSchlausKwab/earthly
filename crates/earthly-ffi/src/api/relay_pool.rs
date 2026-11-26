//! Process-wide persistent Nostr relay pool backed by `nostr-lmdb` plus a
//! disk-backed SHA-256 Blossom GeoJSON LRU cache (with in-memory fallbacks).

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock, RwLock as StdRwLock};

use nostr::RelayUrl;
use nostr_lmdb::NostrLMDB;
use nostr_sdk::Client;
use nostr_sdk::prelude::{MemoryDatabase, MemoryDatabaseOptions};
use sha2::{Digest, Sha256};
use tokio::sync::RwLock as AsyncRwLock;

/// Maximum total size of cached Blossom GeoJSON payloads (64 MiB).
pub(crate) const BLOSSOM_CACHE_MAX_BYTES: usize = 64 * 1024 * 1024;
const LMDB_SUBDIR: &str = "nostr-cache.lmdb";
const BLOSSOM_SUBDIR: &str = "blossom_cache";
const LRU_INDEX_FILE: &str = ".lru_index.json";
const LMDB_MAP_SIZE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Clone)]
pub(crate) struct SharedRelayPool {
    client: Client,
    data_dir: Option<PathBuf>,
}

static RELAY_POOL: OnceLock<AsyncRwLock<Option<SharedRelayPool>>> = OnceLock::new();
static BLOSSOM_CACHE: OnceLock<Mutex<BlossomBlobCache>> = OnceLock::new();
static BLOSSOM_DATA_DIR: OnceLock<StdRwLock<Option<PathBuf>>> = OnceLock::new();

fn relay_pool_lock() -> &'static AsyncRwLock<Option<SharedRelayPool>> {
    RELAY_POOL.get_or_init(|| AsyncRwLock::new(None))
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

    for raw in relay_urls {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed = RelayUrl::parse(trimmed)
            .map_err(|err| format!("invalid relay URL {trimmed}: {err}"))?;
        if let Some(relay) = existing.get(&parsed) {
            if !relay.is_connected() {
                needs_connect = true;
            }
        } else {
            client
                .add_relay(&parsed)
                .await
                .map_err(|err| format!("invalid relay URL {trimmed}: {err}"))?;
            needs_connect = true;
        }
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

    ensure_relays_connected(&client, &relay_urls).await
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
}
