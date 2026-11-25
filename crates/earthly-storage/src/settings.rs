use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

const SETTINGS_KEY: &str = "earthly.native.settings.v1";

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
        assert_eq!(reopened.load().unwrap(), saved);
    }
}
