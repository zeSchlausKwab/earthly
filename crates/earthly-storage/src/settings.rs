use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::secret_box::{is_encrypted_secret, SecretBox};

const SETTINGS_KEY: &str = "earthly.native.settings.v1";
const DEFAULT_CORDN_PUBKEY: &str =
    "fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37";
const DEFAULT_BLOSSOM_SERVER_URL: &str = "https://blossom.earthly.city";

/// Dedicated Earthly primary geo relay.
pub const PRIMARY_EARTHLY_RELAY: &str = "wss://relay.earthly.city";

/// Well-known production public Nostr relays connected by default alongside the Earthly relay.
pub const DEFAULT_PUBLIC_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
];

/// Specialized profile & NIP-65 discovery relay used for kind 0 / 10002 lookups.
pub const PROFILE_DISCOVERY_RELAY: &str = "wss://purplepag.es";

/// Schema version for default public relay migration from v0.2.0 Earthly-only installs.
pub const CURRENT_RELAY_MIGRATION_VERSION: u32 = 1;

/// Canonical production relay list: Earthly primary relay followed by default public relays.
pub fn default_production_relay_urls() -> Vec<String> {
    let mut urls = Vec::with_capacity(1 + DEFAULT_PUBLIC_RELAYS.len());
    urls.push(PRIMARY_EARTHLY_RELAY.to_owned());
    for relay in DEFAULT_PUBLIC_RELAYS {
        urls.push((*relay).to_owned());
    }
    urls
}

/// Normalizes a WebSocket relay URL (trims whitespace, lowercases scheme+host,
/// strips trailing slash). Returns `None` for non-ws/wss or malformed URLs.
pub fn normalize_relay_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    let (scheme, rest) = if let Some(r) = trimmed.strip_prefix("wss://") {
        ("wss://", r)
    } else if let Some(r) = trimmed.strip_prefix("ws://") {
        ("ws://", r)
    } else if let Some(r) = trimmed
        .get(..6)
        .filter(|s| s.eq_ignore_ascii_case("wss://"))
        .map(|_| &trimmed[6..])
    {
        ("wss://", r)
    } else if let Some(r) = trimmed
        .get(..5)
        .filter(|s| s.eq_ignore_ascii_case("ws://"))
        .map(|_| &trimmed[5..])
    {
        ("ws://", r)
    } else {
        return None;
    };
    let rest = rest.trim_end_matches('/');
    if rest.is_empty() || rest.chars().any(char::is_whitespace) {
        return None;
    }
    let normalized = match rest.split_once('/') {
        Some((host, path)) => {
            if host.is_empty() {
                return None;
            }
            format!("{scheme}{}/{path}", host.to_ascii_lowercase())
        }
        None => format!("{scheme}{}", rest.to_ascii_lowercase()),
    };
    Some(normalized)
}

fn dedup_normalized_relays(urls: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut out = Vec::new();
    for raw in urls {
        if let Some(norm) = normalize_relay_url(&raw) {
            if !out.contains(&norm) {
                out.push(norm);
            }
        }
    }
    out
}

fn default_public_relays_enabled() -> bool {
    true
}

fn default_cordn_pubkey() -> String {
    DEFAULT_CORDN_PUBKEY.to_owned()
}

fn default_blossom_server_url() -> String {
    DEFAULT_BLOSSOM_SERVER_URL.to_owned()
}

fn default_theme_mode() -> String {
    "system".to_owned()
}

fn default_basemap_style() -> String {
    "auto".to_owned()
}

fn default_satellite_mode() -> String {
    "osm".to_owned()
}

fn default_satellite_opacity() -> f64 {
    0.75
}

fn default_point_clustering_enabled() -> bool {
    true
}

fn default_point_cluster_radius() -> u32 {
    50
}

fn default_point_cluster_max_zoom() -> u8 {
    14
}

fn default_agent_cashu_max_sats() -> u32 {
    25
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedAccountSessionRecord {
    pub id: String,
    /// `"local"` | `"bunker"` | `"amber"` | `"readonly"`
    pub kind: String,
    pub pubkey_hex: String,
    #[serde(default)]
    pub local_nsec: Option<String>,
    #[serde(default)]
    pub bunker_uri: Option<String>,
    #[serde(default)]
    pub bunker_client_nsec: Option<String>,
    #[serde(default)]
    pub signer_package: Option<String>,
    #[serde(default)]
    pub label: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountedAtlasWorkspaceRecord {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub families: Vec<String>,
    pub coverage_summary: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedOfflinePackRecord {
    pub label: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub format: String,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub west: f64,
    pub south: f64,
    pub east: f64,
    pub north: f64,
    pub center_lon: f64,
    pub center_lat: f64,
    pub center_zoom: u8,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAppSettings {
    pub relay_urls: Vec<String>,
    pub local_pubkey_hex: Option<String>,
    pub local_nsec: Option<String>,
    pub agent_preset: String,
    pub agent_base_url: String,
    pub agent_model: String,
    pub agent_api_key: String,
    pub offline_packs: Vec<SavedOfflinePackRecord>,
    #[serde(default)]
    pub pinned_entity_ids: Vec<String>,
    #[serde(default)]
    pub recent_entity_ids: Vec<String>,
    #[serde(default = "default_cordn_pubkey")]
    pub cordn_server_pubkey: String,
    #[serde(default)]
    pub bunker_uri: Option<String>,
    #[serde(default)]
    pub bunker_client_nsec: Option<String>,
    #[serde(default)]
    pub mounted_atlas_workspaces: Vec<MountedAtlasWorkspaceRecord>,
    #[serde(default = "default_blossom_server_url")]
    pub blossom_server_url: String,
    #[serde(default)]
    pub inbox_read_all_before: u64,
    #[serde(default)]
    pub inbox_read_ids: Vec<String>,
    #[serde(default)]
    pub saved_accounts: Vec<SavedAccountSessionRecord>,
    #[serde(default)]
    pub active_account_id: Option<String>,
    #[serde(default)]
    pub muted_pubkeys: Vec<String>,
    #[serde(default = "default_theme_mode")]
    pub theme_mode: String,
    #[serde(default = "default_basemap_style")]
    pub basemap_style: String,
    #[serde(default = "default_satellite_mode")]
    pub satellite_mode: String,
    #[serde(default = "default_satellite_opacity")]
    pub satellite_opacity: f64,
    #[serde(default)]
    pub story_draft_json: Option<String>,
    #[serde(default)]
    pub agent_messages_json: Option<String>,
    #[serde(default)]
    pub nwc_uri: Option<String>,
    #[serde(default)]
    pub nip60_wallet_enabled: bool,
    #[serde(default = "default_point_clustering_enabled")]
    pub point_clustering_enabled: bool,
    #[serde(default = "default_point_cluster_radius")]
    pub point_cluster_radius: u32,
    #[serde(default = "default_point_cluster_max_zoom")]
    pub point_cluster_max_zoom: u8,
    #[serde(default)]
    pub agent_provider_type: Option<String>,
    #[serde(default)]
    pub agent_auto_pay_cashu: bool,
    #[serde(default = "default_agent_cashu_max_sats")]
    pub agent_cashu_max_sats: u32,
    #[serde(default = "default_public_relays_enabled")]
    pub public_relays_enabled: bool,
    #[serde(default)]
    pub relay_migration_version: u32,
}

impl Default for PersistedAppSettings {
    fn default() -> Self {
        Self {
            relay_urls: default_production_relay_urls(),
            local_pubkey_hex: None,
            local_nsec: None,
            agent_preset: "Offline Rust Spatial".to_owned(),
            agent_base_url: String::new(),
            agent_model: "offline-spatial".to_owned(),
            agent_api_key: String::new(),
            offline_packs: Vec::new(),
            pinned_entity_ids: Vec::new(),
            recent_entity_ids: Vec::new(),
            cordn_server_pubkey: default_cordn_pubkey(),
            bunker_uri: None,
            bunker_client_nsec: None,
            mounted_atlas_workspaces: Vec::new(),
            blossom_server_url: default_blossom_server_url(),
            inbox_read_all_before: 0,
            inbox_read_ids: Vec::new(),
            saved_accounts: Vec::new(),
            active_account_id: None,
            muted_pubkeys: Vec::new(),
            theme_mode: default_theme_mode(),
            basemap_style: default_basemap_style(),
            satellite_mode: default_satellite_mode(),
            satellite_opacity: default_satellite_opacity(),
            story_draft_json: None,
            agent_messages_json: None,
            nwc_uri: None,
            nip60_wallet_enabled: false,
            point_clustering_enabled: default_point_clustering_enabled(),
            point_cluster_radius: default_point_cluster_radius(),
            point_cluster_max_zoom: default_point_cluster_max_zoom(),
            agent_provider_type: None,
            agent_auto_pay_cashu: false,
            agent_cashu_max_sats: default_agent_cashu_max_sats(),
            public_relays_enabled: default_public_relays_enabled(),
            relay_migration_version: CURRENT_RELAY_MIGRATION_VERSION,
        }
    }
}

#[derive(Debug)]
pub struct AppSettingsStore {
    connection: Mutex<Connection>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsStoreError {
    pub code: String,
    pub message: String,
}

impl SettingsStoreError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for SettingsStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("settings-database-failed", error.to_string())
    }
}

impl std::fmt::Display for SettingsStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for SettingsStoreError {}

impl AppSettingsStore {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, SettingsStoreError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                SettingsStoreError::new("settings-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(database_path)?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS app_settings (
               key TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at INTEGER NOT NULL
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    pub fn load(&self) -> Result<PersistedAppSettings, SettingsStoreError> {
        self.load_with_master_key(None)
    }

    pub fn load_with_master_key(
        &self,
        master_key_b64: Option<&str>,
    ) -> Result<PersistedAppSettings, SettingsStoreError> {
        let secret_box = parse_secret_box(master_key_b64)?;
        let connection = self.connection.lock().map_err(|_| {
            SettingsStoreError::new("settings-lock-failed", "Settings store unavailable")
        })?;
        let raw: Option<String> = connection
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = ?1",
                params![SETTINGS_KEY],
                |row| row.get(0),
            )
            .optional()?;
        match raw {
            None => Ok(PersistedAppSettings::default()),
            Some(json) => {
                let mut parsed: PersistedAppSettings = serde_json::from_str(&json)
                    .unwrap_or_else(|_| PersistedAppSettings::default());
                decrypt_sensitive_fields(&mut parsed, secret_box.as_ref())?;
                parsed.relay_urls = dedup_normalized_relays(parsed.relay_urls);
                if parsed.relay_urls.is_empty() {
                    parsed.relay_urls = if parsed.public_relays_enabled {
                        default_production_relay_urls()
                    } else {
                        vec![PRIMARY_EARTHLY_RELAY.to_owned()]
                    };
                }
                // One-time transparent upgrade migration from v0.2.0 installs that only
                // persisted `["wss://relay.earthly.city"]` (preserving all custom relays).
                if parsed.relay_migration_version < CURRENT_RELAY_MIGRATION_VERSION {
                    if parsed.public_relays_enabled {
                        for relay in DEFAULT_PUBLIC_RELAYS {
                            let url = (*relay).to_owned();
                            if !parsed.relay_urls.contains(&url) {
                                parsed.relay_urls.push(url);
                            }
                        }
                    }
                    parsed.relay_migration_version = CURRENT_RELAY_MIGRATION_VERSION;
                }
                // Transparent migration from single-account fields to multi-session list.
                if parsed.saved_accounts.is_empty() {
                    if let Some(pk) = parsed.local_pubkey_hex.clone().filter(|s| !s.is_empty()) {
                        let (kind, id) = if parsed.bunker_uri.as_deref().is_some_and(|u| !u.is_empty()) {
                            ("bunker".to_owned(), format!("bunker:{pk}"))
                        } else if parsed.local_nsec.as_deref().is_some_and(|s| !s.is_empty()) {
                            ("local".to_owned(), format!("local:{pk}"))
                        } else {
                            ("amber".to_owned(), format!("amber:{pk}"))
                        };
                        parsed.saved_accounts.push(SavedAccountSessionRecord {
                            id: id.clone(),
                            kind,
                            pubkey_hex: pk,
                            local_nsec: parsed.local_nsec.clone(),
                            bunker_uri: parsed.bunker_uri.clone(),
                            bunker_client_nsec: parsed.bunker_client_nsec.clone(),
                            signer_package: None,
                            label: None,
                        });
                        parsed.active_account_id = Some(id);
                    }
                }
                Ok(parsed)
            }
        }
    }

    pub fn save(
        &self,
        settings: PersistedAppSettings,
    ) -> Result<PersistedAppSettings, SettingsStoreError> {
        self.save_with_master_key(&settings, None)
    }

    pub fn save_with_master_key(
        &self,
        settings: &PersistedAppSettings,
        master_key_b64: Option<&str>,
    ) -> Result<PersistedAppSettings, SettingsStoreError> {
        let secret_box = parse_secret_box(master_key_b64)?;
        let mut normalized = settings.clone();
        normalized.relay_urls = dedup_normalized_relays(normalized.relay_urls);
        if normalized.relay_urls.is_empty() {
            normalized.relay_urls = if normalized.public_relays_enabled {
                default_production_relay_urls()
            } else {
                vec![PRIMARY_EARTHLY_RELAY.to_owned()]
            };
        }
        normalized.relay_migration_version = normalized
            .relay_migration_version
            .max(CURRENT_RELAY_MIGRATION_VERSION);
        normalized.satellite_opacity = if normalized.satellite_opacity.is_finite() {
            normalized.satellite_opacity.clamp(0.0, 1.0)
        } else {
            default_satellite_opacity()
        };
        normalized.point_cluster_radius = normalized.point_cluster_radius.clamp(20, 120);
        normalized.point_cluster_max_zoom = normalized.point_cluster_max_zoom.clamp(4, 18);
        normalized.agent_cashu_max_sats = normalized.agent_cashu_max_sats.clamp(1, 100_000);

        let mut persisted = normalized.clone();
        if let Some(ref box_cipher) = secret_box {
            encrypt_sensitive_fields(&mut persisted, box_cipher)?;
        }

        let value_json = serde_json::to_string(&persisted)
            .map_err(|e| SettingsStoreError::new("settings-serialize-failed", e.to_string()))?;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let connection = self.connection.lock().map_err(|_| {
            SettingsStoreError::new("settings-lock-failed", "Settings store unavailable")
        })?;
        connection.execute(
            "INSERT INTO app_settings (key, value_json, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at = excluded.updated_at",
            params![SETTINGS_KEY, value_json, now],
        )?;
        Ok(normalized)
    }
}

fn parse_secret_box(master_key_b64: Option<&str>) -> Result<Option<SecretBox>, SettingsStoreError> {
    master_key_b64
        .map(|key| {
            SecretBox::from_base64_key(key)
                .map_err(|e| SettingsStoreError::new("settings-invalid-master-key", e))
        })
        .transpose()
}

fn has_encrypted_sensitive_fields(settings: &PersistedAppSettings) -> bool {
    let top_level_encrypted = settings
        .local_nsec
        .as_deref()
        .is_some_and(is_encrypted_secret)
        || settings
            .bunker_client_nsec
            .as_deref()
            .is_some_and(is_encrypted_secret)
        || settings.nwc_uri.as_deref().is_some_and(is_encrypted_secret)
        || is_encrypted_secret(&settings.agent_api_key);

    top_level_encrypted
        || settings.saved_accounts.iter().any(|account| {
            account
                .local_nsec
                .as_deref()
                .is_some_and(is_encrypted_secret)
                || account
                    .bunker_client_nsec
                    .as_deref()
                    .is_some_and(is_encrypted_secret)
        })
}

fn encrypt_sensitive_fields(
    settings: &mut PersistedAppSettings,
    secret_box: &SecretBox,
) -> Result<(), SettingsStoreError> {
    let map_err = |e: String| SettingsStoreError::new("settings-encrypt-failed", e);
    settings.local_nsec = secret_box
        .encrypt_option(settings.local_nsec.as_deref())
        .map_err(map_err)?;
    settings.bunker_client_nsec = secret_box
        .encrypt_option(settings.bunker_client_nsec.as_deref())
        .map_err(map_err)?;
    settings.nwc_uri = secret_box
        .encrypt_option(settings.nwc_uri.as_deref())
        .map_err(map_err)?;
    settings.agent_api_key = secret_box
        .encrypt_str(&settings.agent_api_key)
        .map_err(map_err)?;
    for account in &mut settings.saved_accounts {
        account.local_nsec = secret_box
            .encrypt_option(account.local_nsec.as_deref())
            .map_err(map_err)?;
        account.bunker_client_nsec = secret_box
            .encrypt_option(account.bunker_client_nsec.as_deref())
            .map_err(map_err)?;
    }
    Ok(())
}

fn decrypt_sensitive_fields(
    settings: &mut PersistedAppSettings,
    secret_box: Option<&SecretBox>,
) -> Result<(), SettingsStoreError> {
    let Some(secret_box) = secret_box else {
        if has_encrypted_sensitive_fields(settings) {
            return Err(SettingsStoreError::new(
                "settings-decrypt-failed",
                "Encrypted settings present but no master key was provided",
            ));
        }
        return Ok(());
    };

    let map_err = |e: String| SettingsStoreError::new("settings-decrypt-failed", e);
    settings.local_nsec = secret_box
        .decrypt_option(settings.local_nsec.as_deref())
        .map_err(map_err)?;
    settings.bunker_client_nsec = secret_box
        .decrypt_option(settings.bunker_client_nsec.as_deref())
        .map_err(map_err)?;
    settings.nwc_uri = secret_box
        .decrypt_option(settings.nwc_uri.as_deref())
        .map_err(map_err)?;
    settings.agent_api_key = secret_box
        .decrypt_str(&settings.agent_api_key)
        .map_err(map_err)?;
    for account in &mut settings.saved_accounts {
        account.local_nsec = secret_box
            .decrypt_option(account.local_nsec.as_deref())
            .map_err(map_err)?;
        account.bunker_client_nsec = secret_box
            .decrypt_option(account.bunker_client_nsec.as_deref())
            .map_err(map_err)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_settings_persist_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("earthly.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();
        let fresh = store.load().unwrap();
        assert_eq!(fresh.relay_urls, default_production_relay_urls());
        assert!(fresh.public_relays_enabled);
        assert_eq!(fresh.relay_migration_version, CURRENT_RELAY_MIGRATION_VERSION);

        let mut s = PersistedAppSettings::default();
        s.relay_urls.push("wss://relay.custom.example/".to_owned());
        s.local_pubkey_hex = Some("a".repeat(64));
        s.agent_preset = "Local Ollama".to_owned();
        s.agent_base_url = "http://127.0.0.1:11434/v1".to_owned();
        s.agent_model = "qwen2.5:7b".to_owned();
        s.pinned_entity_ids = vec!["map:37515:abc:vienna".to_owned()];
        s.recent_entity_ids = vec!["story:37520:abc:bushby".to_owned()];
        let saved = store.save(s).unwrap();
        assert!(saved.relay_urls.contains(&"wss://relay.custom.example".to_owned()));
        drop(store);

        let reopened = AppSettingsStore::open(&db).unwrap();
        let loaded = reopened.load().unwrap();
        assert_eq!(loaded.relay_urls, saved.relay_urls);
        assert_eq!(loaded.saved_accounts.len(), 1);
        assert_eq!(loaded.saved_accounts[0].pubkey_hex, "a".repeat(64));
        assert_eq!(loaded.active_account_id, Some(format!("amber:{}", "a".repeat(64))));
    }

    #[test]
    fn migrates_v020_earthly_only_install_to_public_relays_preserving_custom_relays() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("v020-upgrade.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();

        // Simulate a v0.2.0 SQLite row missing `publicRelaysEnabled` and `relayMigrationVersion`.
        let legacy_json = serde_json::json!({
            "relayUrls": ["wss://relay.earthly.city/", "wss://my-field-relay.example/"],
            "localPubkeyHex": null,
            "localNsec": null,
            "agentPreset": "Offline Rust Spatial",
            "agentBaseUrl": "",
            "agentModel": "offline-spatial",
            "agentApiKey": "",
            "offlinePacks": []
        })
        .to_string();
        {
            let conn = Connection::open(&db).unwrap();
            conn.execute(
                "INSERT INTO app_settings (key, value_json, updated_at) VALUES (?1, ?2, 1700000000)",
                params![SETTINGS_KEY, legacy_json],
            )
            .unwrap();
        }

        let migrated = store.load().unwrap();
        assert!(migrated.public_relays_enabled);
        assert_eq!(migrated.relay_migration_version, CURRENT_RELAY_MIGRATION_VERSION);
        assert_eq!(migrated.relay_urls[0], "wss://relay.earthly.city");
        assert_eq!(migrated.relay_urls[1], "wss://my-field-relay.example");
        for pub_relay in DEFAULT_PUBLIC_RELAYS {
            assert!(
                migrated.relay_urls.contains(&(*pub_relay).to_owned()),
                "missing default public relay {pub_relay}"
            );
        }

        // After saving a customized relay list (e.g. removing nos.lol), migration does NOT re-add it.
        let mut customized = migrated;
        customized.relay_urls.retain(|u| u != "wss://nos.lol");
        store.save(customized.clone()).unwrap();
        let reloaded = store.load().unwrap();
        assert!(!reloaded.relay_urls.contains(&"wss://nos.lol".to_owned()));
        assert!(reloaded.relay_urls.contains(&"wss://my-field-relay.example".to_owned()));
        assert!(reloaded.relay_urls.contains(&"wss://relay.damus.io".to_owned()));
    }

    #[test]
    fn public_relays_disabled_policy_respects_earthly_only_preference() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("public-disabled.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();

        let mut s = PersistedAppSettings::default();
        s.public_relays_enabled = false;
        s.relay_urls = vec!["wss://relay.earthly.city".to_owned()];
        store.save(s).unwrap();

        let reloaded = store.load().unwrap();
        assert!(!reloaded.public_relays_enabled);
        assert_eq!(reloaded.relay_urls, vec!["wss://relay.earthly.city"]);
    }

    #[test]
    fn persists_multiple_saved_account_sessions() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("multi.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();
        let mut s = PersistedAppSettings::default();
        s.saved_accounts = vec![
            SavedAccountSessionRecord {
                id: format!("local:{}", "1".repeat(64)),
                kind: "local".to_owned(),
                pubkey_hex: "1".repeat(64),
                local_nsec: Some("nsec1alice".to_owned()),
                bunker_uri: None,
                bunker_client_nsec: None,
                signer_package: None,
                label: Some("Alice".to_owned()),
            },
            SavedAccountSessionRecord {
                id: format!("bunker:{}", "2".repeat(64)),
                kind: "bunker".to_owned(),
                pubkey_hex: "2".repeat(64),
                local_nsec: None,
                bunker_uri: Some("bunker://bob?relay=wss://relay.earthly.city".to_owned()),
                bunker_client_nsec: Some("nsec1client".to_owned()),
                signer_package: None,
                label: Some("Bob Bunker".to_owned()),
            },
        ];
        s.active_account_id = Some(format!("bunker:{}", "2".repeat(64)));
        store.save(s.clone()).unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.saved_accounts.len(), 2);
        assert_eq!(loaded.active_account_id, s.active_account_id);
        assert_eq!(loaded.saved_accounts[1].label.as_deref(), Some("Bob Bunker"));
    }

    fn test_master_key(byte: u8) -> String {
        use base64::engine::general_purpose::STANDARD;
        use base64::Engine as _;
        STANDARD.encode([byte; 32])
    }

    fn read_raw_settings_json(db: &std::path::Path) -> String {
        let conn = Connection::open(db).unwrap();
        conn.query_row(
            "SELECT value_json FROM app_settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get(0),
        )
        .unwrap()
    }

    #[test]
    fn encrypts_sensitive_fields_at_rest_and_round_trips_with_master_key() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("encrypted.sqlite3");
        let key_a = test_master_key(0x1a);

        let mut s = PersistedAppSettings::default();
        s.local_pubkey_hex = Some("a".repeat(64));
        s.local_nsec = Some("nsec1topsecretlocalnsecvalue".to_owned());
        s.bunker_client_nsec = Some("nsec1topsecretbunkerclient".to_owned());
        s.nwc_uri = Some("nostr+walletconnect://pk?relay=wss%3A%2F%2Frelay.earthly.city&secret=supersecret".to_owned());
        s.agent_api_key = "sk-live-secret-api-key".to_owned();
        s.saved_accounts = vec![
            SavedAccountSessionRecord {
                id: format!("local:{}", "1".repeat(64)),
                kind: "local".to_owned(),
                pubkey_hex: "1".repeat(64),
                local_nsec: Some("nsec1accountonelocal".to_owned()),
                bunker_uri: None,
                bunker_client_nsec: Some("nsec1accountonebunker".to_owned()),
                signer_package: None,
                label: Some("Alice".to_owned()),
            },
        ];

        let store = AppSettingsStore::open(&db).unwrap();
        let saved = store.save_with_master_key(&s, Some(&key_a)).unwrap();
        // Returned value stays decrypted for in-memory callers.
        assert_eq!(saved.local_nsec, s.local_nsec);
        assert_eq!(saved.bunker_client_nsec, s.bunker_client_nsec);
        assert_eq!(saved.nwc_uri, s.nwc_uri);
        assert_eq!(saved.agent_api_key, s.agent_api_key);
        assert_eq!(saved.saved_accounts[0].local_nsec, s.saved_accounts[0].local_nsec);
        assert_eq!(
            saved.saved_accounts[0].bunker_client_nsec,
            s.saved_accounts[0].bunker_client_nsec
        );
        drop(store);

        let raw_json = read_raw_settings_json(&db);
        assert!(!raw_json.contains("nsec1topsecretlocalnsecvalue"));
        assert!(!raw_json.contains("nsec1topsecretbunkerclient"));
        assert!(!raw_json.contains("nostr+walletconnect://"));
        assert!(!raw_json.contains("sk-live-secret-api-key"));
        assert!(!raw_json.contains("nsec1accountonelocal"));
        assert!(!raw_json.contains("nsec1accountonebunker"));

        let persisted_raw: PersistedAppSettings = serde_json::from_str(&raw_json).unwrap();
        assert!(persisted_raw
            .local_nsec
            .as_deref()
            .is_some_and(is_encrypted_secret));
        assert!(persisted_raw
            .bunker_client_nsec
            .as_deref()
            .is_some_and(is_encrypted_secret));
        assert!(persisted_raw
            .nwc_uri
            .as_deref()
            .is_some_and(is_encrypted_secret));
        assert!(is_encrypted_secret(&persisted_raw.agent_api_key));
        assert!(persisted_raw.saved_accounts[0]
            .local_nsec
            .as_deref()
            .is_some_and(is_encrypted_secret));
        assert!(persisted_raw.saved_accounts[0]
            .bunker_client_nsec
            .as_deref()
            .is_some_and(is_encrypted_secret));

        let reopened = AppSettingsStore::open(&db).unwrap();
        let loaded = reopened.load_with_master_key(Some(&key_a)).unwrap();
        assert_eq!(loaded.local_nsec, s.local_nsec);
        assert_eq!(loaded.bunker_client_nsec, s.bunker_client_nsec);
        assert_eq!(loaded.nwc_uri, s.nwc_uri);
        assert_eq!(loaded.agent_api_key, s.agent_api_key);
        assert_eq!(loaded.saved_accounts, s.saved_accounts);
    }

    #[test]
    fn migrates_legacy_plaintext_settings_on_next_save() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("legacy.sqlite3");
        let key = test_master_key(0x2b);

        let mut legacy = PersistedAppSettings::default();
        legacy.local_nsec = Some("nsec1legacyuserkey".to_owned());
        legacy.bunker_client_nsec = Some("nsec1legacybunker".to_owned());
        legacy.nwc_uri = Some("nostr+walletconnect://legacy?secret=123".to_owned());
        legacy.agent_api_key = "sk-legacy-key".to_owned();
        legacy.saved_accounts = vec![SavedAccountSessionRecord {
            id: format!("local:{}", "3".repeat(64)),
            kind: "local".to_owned(),
            pubkey_hex: "3".repeat(64),
            local_nsec: Some("nsec1legacysaved".to_owned()),
            bunker_uri: None,
            bunker_client_nsec: None,
            signer_package: None,
            label: None,
        }];

        let store = AppSettingsStore::open(&db).unwrap();
        store.save(legacy.clone()).unwrap();

        let raw_before = read_raw_settings_json(&db);
        assert!(raw_before.contains("nsec1legacyuserkey"));
        assert!(raw_before.contains("sk-legacy-key"));

        let loaded = store.load_with_master_key(Some(&key)).unwrap();
        assert_eq!(loaded.local_nsec, legacy.local_nsec);
        assert_eq!(loaded.bunker_client_nsec, legacy.bunker_client_nsec);
        assert_eq!(loaded.nwc_uri, legacy.nwc_uri);
        assert_eq!(loaded.agent_api_key, legacy.agent_api_key);
        assert_eq!(loaded.saved_accounts, legacy.saved_accounts);

        store.save_with_master_key(&loaded, Some(&key)).unwrap();
        let raw_after = read_raw_settings_json(&db);
        assert!(!raw_after.contains("nsec1legacyuserkey"));
        assert!(!raw_after.contains("nsec1legacybunker"));
        assert!(!raw_after.contains("nostr+walletconnect://legacy"));
        assert!(!raw_after.contains("sk-legacy-key"));
        assert!(!raw_after.contains("nsec1legacysaved"));

        let reloaded = store.load_with_master_key(Some(&key)).unwrap();
        assert_eq!(reloaded.local_nsec, legacy.local_nsec);
        assert_eq!(reloaded.agent_api_key, legacy.agent_api_key);
    }

    #[test]
    fn wrong_or_missing_master_key_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("wrong-key.sqlite3");
        let key_a = test_master_key(0x3c);
        let key_b = test_master_key(0x4d);

        let mut s = PersistedAppSettings::default();
        s.local_nsec = Some("nsec1protected".to_owned());
        s.nwc_uri = Some("nostr+walletconnect://protected?secret=xyz".to_owned());

        let store = AppSettingsStore::open(&db).unwrap();
        store.save_with_master_key(&s, Some(&key_a)).unwrap();

        let wrong_err = store.load_with_master_key(Some(&key_b)).unwrap_err();
        assert_eq!(wrong_err.code, "settings-decrypt-failed");

        let missing_err = store.load_with_master_key(None).unwrap_err();
        assert_eq!(missing_err.code, "settings-decrypt-failed");
        assert_eq!(store.load().unwrap_err().code, "settings-decrypt-failed");

        let bad_key_err = store.load_with_master_key(Some("not-valid-base64!")).unwrap_err();
        assert_eq!(bad_key_err.code, "settings-invalid-master-key");
    }

    #[test]
    fn nip60_wallet_enabled_defaults_false_and_persists_true() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("nip60-setting.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();

        // Fresh store defaults to false.
        let fresh = store.load().unwrap();
        assert!(!fresh.nip60_wallet_enabled);

        // Legacy JSON missing the `nip60WalletEnabled` field defaults to false.
        let mut legacy_json: serde_json::Value =
            serde_json::to_value(PersistedAppSettings::default()).unwrap();
        legacy_json
            .as_object_mut()
            .unwrap()
            .remove("nip60WalletEnabled");
        let legacy_parsed: PersistedAppSettings = serde_json::from_value(legacy_json).unwrap();
        assert!(!legacy_parsed.nip60_wallet_enabled);

        // Persisting `true` survives reopen.
        let mut updated = fresh;
        updated.nip60_wallet_enabled = true;
        let saved = store.save(updated).unwrap();
        assert!(saved.nip60_wallet_enabled);
        drop(store);

        let reopened = AppSettingsStore::open(&db).unwrap();
        let reloaded = reopened.load().unwrap();
        assert!(reloaded.nip60_wallet_enabled);
    }
}
