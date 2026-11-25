//! Durable SQLite application settings (custom Nostr relays, persisted
//! desktop/local Nostr identity, NIP-46 bunker session, Cordn coordinator,
//! AI Agent provider settings, mounted offline `.pmtiles`/`.atlas` packs,
//! and Favorites / Recents).

use earthly_storage::{
    AppSettingsStore, MountedAtlasWorkspaceRecord, PersistedAppSettings,
    SavedAccountSessionRecord, SavedOfflinePackRecord,
};

#[derive(Clone, Debug)]
pub struct SavedAccountSessionDto {
    pub id: String,
    pub kind: String,
    pub pubkey_hex: String,
    pub local_nsec: Option<String>,
    pub bunker_uri: Option<String>,
    pub bunker_client_nsec: Option<String>,
    pub signer_package: Option<String>,
    pub label: Option<String>,
}

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
pub struct MountedAtlasWorkspaceDto {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub families: Vec<String>,
    pub coverage_summary: String,
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
    pub pinned_entity_ids: Vec<String>,
    pub recent_entity_ids: Vec<String>,
    pub cordn_server_pubkey: String,
    pub bunker_uri: Option<String>,
    pub bunker_client_nsec: Option<String>,
    pub mounted_atlas_workspaces: Vec<MountedAtlasWorkspaceDto>,
    pub blossom_server_url: String,
    pub inbox_read_all_before: u64,
    pub inbox_read_ids: Vec<String>,
    pub saved_accounts: Vec<SavedAccountSessionDto>,
    pub active_account_id: Option<String>,
    pub muted_pubkeys: Vec<String>,
    pub theme_mode: String,
    pub basemap_style: String,
    pub satellite_mode: String,
    pub satellite_opacity: f64,
    pub story_draft_json: Option<String>,
    pub agent_messages_json: Option<String>,
    pub nwc_uri: Option<String>,
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
        pinned_entity_ids: r.pinned_entity_ids,
        recent_entity_ids: r.recent_entity_ids,
        cordn_server_pubkey: r.cordn_server_pubkey,
        bunker_uri: r.bunker_uri,
        bunker_client_nsec: r.bunker_client_nsec,
        mounted_atlas_workspaces: r
            .mounted_atlas_workspaces
            .into_iter()
            .map(|w| MountedAtlasWorkspaceDto {
                name: w.name,
                path: w.path,
                size_bytes: w.size_bytes,
                families: w.families,
                coverage_summary: w.coverage_summary,
            })
            .collect(),
        blossom_server_url: r.blossom_server_url,
        inbox_read_all_before: r.inbox_read_all_before,
        inbox_read_ids: r.inbox_read_ids,
        saved_accounts: r
            .saved_accounts
            .into_iter()
            .map(|a| SavedAccountSessionDto {
                id: a.id,
                kind: a.kind,
                pubkey_hex: a.pubkey_hex,
                local_nsec: a.local_nsec,
                bunker_uri: a.bunker_uri,
                bunker_client_nsec: a.bunker_client_nsec,
                signer_package: a.signer_package,
                label: a.label,
            })
            .collect(),
        active_account_id: r.active_account_id,
        muted_pubkeys: r.muted_pubkeys,
        theme_mode: r.theme_mode,
        basemap_style: r.basemap_style,
        satellite_mode: r.satellite_mode,
        satellite_opacity: r.satellite_opacity,
        story_draft_json: r.story_draft_json,
        agent_messages_json: r.agent_messages_json,
        nwc_uri: r.nwc_uri,
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
        pinned_entity_ids: d.pinned_entity_ids,
        recent_entity_ids: d.recent_entity_ids,
        cordn_server_pubkey: d.cordn_server_pubkey,
        bunker_uri: d.bunker_uri,
        bunker_client_nsec: d.bunker_client_nsec,
        mounted_atlas_workspaces: d
            .mounted_atlas_workspaces
            .into_iter()
            .map(|w| MountedAtlasWorkspaceRecord {
                name: w.name,
                path: w.path,
                size_bytes: w.size_bytes,
                families: w.families,
                coverage_summary: w.coverage_summary,
            })
            .collect(),
        blossom_server_url: d.blossom_server_url,
        inbox_read_all_before: d.inbox_read_all_before,
        inbox_read_ids: d.inbox_read_ids,
        saved_accounts: d
            .saved_accounts
            .into_iter()
            .map(|a| SavedAccountSessionRecord {
                id: a.id,
                kind: a.kind,
                pubkey_hex: a.pubkey_hex,
                local_nsec: a.local_nsec,
                bunker_uri: a.bunker_uri,
                bunker_client_nsec: a.bunker_client_nsec,
                signer_package: a.signer_package,
                label: a.label,
            })
            .collect(),
        active_account_id: d.active_account_id,
        muted_pubkeys: d.muted_pubkeys,
        theme_mode: d.theme_mode,
        basemap_style: d.basemap_style,
        satellite_mode: d.satellite_mode,
        satellite_opacity: d.satellite_opacity,
        story_draft_json: d.story_draft_json,
        agent_messages_json: d.agent_messages_json,
        nwc_uri: d.nwc_uri,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn round_trips_blossom_and_inbox_read_state() {
        let dir = tempdir().unwrap();
        let db = dir.path().join("settings.sqlite3").display().to_string();
        let mut s = load_app_settings(db.clone()).unwrap();
        assert_eq!(s.blossom_server_url, "https://blossom.earthly.city");
        assert_eq!(s.theme_mode, "system");
        assert_eq!(s.basemap_style, "auto");
        assert_eq!(s.satellite_mode, "osm");
        s.blossom_server_url = "https://blossom.primal.net".to_owned();
        s.inbox_read_all_before = 1_790_000_000;
        s.inbox_read_ids = vec!["reply:abc".to_owned()];
        s.muted_pubkeys = vec!["f".repeat(64)];
        s.theme_mode = "dark".to_owned();
        s.basemap_style = "fiord".to_owned();
        s.satellite_mode = "combined".to_owned();
        s.satellite_opacity = 0.6;
        s.story_draft_json = Some(r#"{"title":"Field Log"}"#.to_owned());
        s.agent_messages_json = Some(r#"[{"role":"user","content":"Measure draft"}]"#.to_owned());
        s.nwc_uri = Some("nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.earthly.city&secret=def".to_owned());
        let saved = save_app_settings(db.clone(), s).unwrap();
        assert_eq!(saved.blossom_server_url, "https://blossom.primal.net");
        assert_eq!(saved.muted_pubkeys, vec!["f".repeat(64)]);
        let reloaded = load_app_settings(db).unwrap();
        assert_eq!(reloaded.inbox_read_all_before, 1_790_000_000);
        assert_eq!(reloaded.inbox_read_ids, vec!["reply:abc".to_owned()]);
        assert_eq!(reloaded.muted_pubkeys, vec!["f".repeat(64)]);
        assert_eq!(reloaded.theme_mode, "dark");
        assert_eq!(reloaded.basemap_style, "fiord");
        assert_eq!(reloaded.satellite_mode, "combined");
        assert!((reloaded.satellite_opacity - 0.6).abs() < 1e-6);
        assert_eq!(
            reloaded.story_draft_json.as_deref(),
            Some(r#"{"title":"Field Log"}"#)
        );
        assert_eq!(
            reloaded.agent_messages_json.as_deref(),
            Some(r#"[{"role":"user","content":"Measure draft"}]"#)
        );
        assert_eq!(
            reloaded.nwc_uri.as_deref(),
            Some("nostr+walletconnect://abc?relay=wss%3A%2F%2Frelay.earthly.city&secret=def")
        );
    }
}
