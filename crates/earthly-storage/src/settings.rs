use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const SETTINGS_KEY: &str = "earthly.native.settings.v1";
const DEFAULT_CORDN_PUBKEY: &str =
    "fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37";
const DEFAULT_BLOSSOM_SERVER_URL: &str = "https://blossom.earthly.city";

fn default_cordn_pubkey() -> String {
    DEFAULT_CORDN_PUBKEY.to_owned()
}

fn default_blossom_server_url() -> String {
    DEFAULT_BLOSSOM_SERVER_URL.to_owned()
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
}

impl Default for PersistedAppSettings {
    fn default() -> Self {
        Self {
            relay_urls: vec!["wss://relay.earthly.city".to_owned()],
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
                if parsed.relay_urls.is_empty() {
                    parsed.relay_urls = vec!["wss://relay.earthly.city".to_owned()];
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
        mut settings: PersistedAppSettings,
    ) -> Result<PersistedAppSettings, SettingsStoreError> {
        settings.relay_urls = settings
            .relay_urls
            .into_iter()
            .map(|r| r.trim().to_owned())
            .filter(|r| r.starts_with("wss://") || r.starts_with("ws://"))
            .collect();
        if settings.relay_urls.is_empty() {
            settings.relay_urls.push("wss://relay.earthly.city".to_owned());
        }
        let value_json = serde_json::to_string(&settings)
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
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_settings_persist_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("earthly.sqlite3");
        let store = AppSettingsStore::open(&db).unwrap();
        assert_eq!(store.load().unwrap().relay_urls, vec!["wss://relay.earthly.city"]);

        let mut s = PersistedAppSettings::default();
        s.relay_urls.push("wss://relay.damus.io".to_owned());
        s.local_pubkey_hex = Some("a".repeat(64));
        s.agent_preset = "Local Ollama".to_owned();
        s.agent_base_url = "http://127.0.0.1:11434/v1".to_owned();
        s.agent_model = "qwen2.5:7b".to_owned();
        s.pinned_entity_ids = vec!["map:37515:abc:vienna".to_owned()];
        s.recent_entity_ids = vec!["story:37520:abc:bushby".to_owned()];
        let saved = store.save(s).unwrap();
        drop(store);

        let reopened = AppSettingsStore::open(&db).unwrap();
        let loaded = reopened.load().unwrap();
        assert_eq!(loaded.relay_urls, saved.relay_urls);
        assert_eq!(loaded.saved_accounts.len(), 1);
        assert_eq!(loaded.saved_accounts[0].pubkey_hex, "a".repeat(64));
        assert_eq!(loaded.active_account_id, Some(format!("amber:{}", "a".repeat(64))));
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
}
