//! Durable SQLite application settings (custom Nostr relays, persisted
//! desktop/local Nostr identity, AI Agent provider settings, and mounted
//! offline `.pmtiles` packs).

use earthly_storage::{AppSettingsStore, PersistedAppSettings, SavedOfflinePackRecord};

#[derive(Clone, Debug)]
pub struct SavedOfflinePackDto {
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

#[derive(Clone, Debug)]
pub struct AppSettingsDto {
    pub relay_urls: Vec<String>,
    pub local_pubkey_hex: Option<String>,
    pub local_nsec: Option<String>,
    pub agent_preset: String,
    pub agent_base_url: String,
    pub agent_model: String,
    pub agent_api_key: String,
    pub offline_packs: Vec<SavedOfflinePackDto>,
}

pub fn load_app_settings(database_path: String) -> Result<AppSettingsDto, String> {
    let store = AppSettingsStore::open(database_path).map_err(|e| e.to_string())?;
    let loaded = store.load().map_err(|e| e.to_string())?;
    Ok(from_record(loaded))
}

pub fn save_app_settings(
    database_path: String,
    settings: AppSettingsDto,
) -> Result<AppSettingsDto, String> {
    let store = AppSettingsStore::open(database_path).map_err(|e| e.to_string())?;
    let saved = store
        .save(to_record(settings))
        .map_err(|e| e.to_string())?;
    Ok(from_record(saved))
}

fn from_record(r: PersistedAppSettings) -> AppSettingsDto {
    AppSettingsDto {
        relay_urls: r.relay_urls,
        local_pubkey_hex: r.local_pubkey_hex,
        local_nsec: r.local_nsec,
        agent_preset: r.agent_preset,
        agent_base_url: r.agent_base_url,
        agent_model: r.agent_model,
        agent_api_key: r.agent_api_key,
        offline_packs: r
            .offline_packs
            .into_iter()
            .map(|p| SavedOfflinePackDto {
                label: p.label,
                sha256: p.sha256,
                size_bytes: p.size_bytes,
                format: p.format,
                min_zoom: p.min_zoom,
                max_zoom: p.max_zoom,
                west: p.west,
                south: p.south,
                east: p.east,
                north: p.north,
                center_lon: p.center_lon,
                center_lat: p.center_lat,
                center_zoom: p.center_zoom,
            })
            .collect(),
    }
}

fn to_record(d: AppSettingsDto) -> PersistedAppSettings {
    PersistedAppSettings {
        relay_urls: d.relay_urls,
        local_pubkey_hex: d.local_pubkey_hex,
        local_nsec: d.local_nsec,
        agent_preset: d.agent_preset,
        agent_base_url: d.agent_base_url,
        agent_model: d.agent_model,
        agent_api_key: d.agent_api_key,
        offline_packs: d
            .offline_packs
            .into_iter()
            .map(|p| SavedOfflinePackRecord {
                label: p.label,
                sha256: p.sha256,
                size_bytes: p.size_bytes,
                format: p.format,
                min_zoom: p.min_zoom,
                max_zoom: p.max_zoom,
                west: p.west,
                south: p.south,
                east: p.east,
                north: p.north,
                center_lon: p.center_lon,
                center_lat: p.center_lat,
                center_zoom: p.center_zoom,
            })
            .collect(),
    }
}
