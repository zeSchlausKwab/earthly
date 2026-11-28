//! Durable SQLite application settings (custom Nostr relays, persisted
//! desktop/local Nostr identity, NIP-46 bunker session, Cordn coordinator,
//! AI Agent provider settings, mounted offline `.pmtiles`/`.atlas` packs,
//! and Favorites / Recents).

use std::sync::{OnceLock, RwLock};

use earthly_storage::settings::{
    CURRENT_RELAY_MIGRATION_VERSION, DEFAULT_PUBLIC_RELAYS, PRIMARY_EARTHLY_RELAY,
    default_production_relay_urls,
};
use earthly_storage::{
    decode_master_key, AppSettingsStore, MountedAtlasWorkspaceRecord, PersistedAppSettings,
    SavedAccountSessionRecord, SavedOfflinePackRecord,
};

static SETTINGS_MASTER_KEY: OnceLock<RwLock<Option<String>>> = OnceLock::new();

fn master_key_lock() -> &'static RwLock<Option<String>> {
    SETTINGS_MASTER_KEY.get_or_init(|| RwLock::new(None))
}

fn current_master_key() -> Result<Option<String>, String> {
    let guard = master_key_lock()
        .read()
        .map_err(|_| "Settings master key lock poisoned".to_owned())?;
    Ok(guard.clone())
}

pub fn set_settings_master_key(master_key_base64: String) -> Result<(), String> {
    decode_master_key(&master_key_base64)?;
    let mut guard = master_key_lock()
        .write()
        .map_err(|_| "Settings master key lock poisoned".to_owned())?;
    *guard = Some(master_key_base64.trim().to_owned());
    Ok(())
}

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
    pub nip60_wallet_enabled: bool,
    pub point_clustering_enabled: bool,
    pub point_cluster_radius: u32,
    pub point_cluster_max_zoom: u8,
    pub agent_provider_type: Option<String>,
    pub agent_auto_pay_cashu: bool,
    pub agent_cashu_max_sats: u32,
    pub public_relays_enabled: Option<bool>,
}

pub fn load_app_settings(database_path: String) -> Result<AppSettingsDto, String> {
    let master_key = current_master_key()?;
    let store = AppSettingsStore::open(database_path).map_err(|e| e.to_string())?;
    let loaded = store
        .load_with_master_key(master_key.as_deref())
        .map_err(|e| e.to_string())?;
    crate::api::relay_pool::set_relay_manager_public_enabled(loaded.public_relays_enabled);
    crate::api::relay_pool::sync_configured_relays(&loaded.relay_urls);
    Ok(from_record(loaded))
}

pub fn save_app_settings(
    database_path: String,
    settings: AppSettingsDto,
) -> Result<AppSettingsDto, String> {
    let master_key = current_master_key()?;
    let store = AppSettingsStore::open(database_path).map_err(|e| e.to_string())?;
    let existing_public_enabled = if settings.public_relays_enabled.is_some() {
        settings.public_relays_enabled.unwrap_or(true)
    } else {
        store
            .load_with_master_key(master_key.as_deref())
            .map(|s| s.public_relays_enabled)
            .unwrap_or(true)
    };
    let record = to_record(settings, existing_public_enabled);
    let saved = store
        .save_with_master_key(&record, master_key.as_deref())
        .map_err(|e| e.to_string())?;
    crate::api::relay_pool::set_relay_manager_public_enabled(saved.public_relays_enabled);
    crate::api::relay_pool::sync_configured_relays(&saved.relay_urls);
    Ok(from_record(saved))
}

/// Toggles the production `public_relays_enabled` policy cleanly in SQLite and updates
/// the live Relay Manager, merging or removing default public relays while preserving
/// the primary Earthly relay and any user custom relays.
pub fn set_public_relays_enabled(
    database_path: String,
    enabled: bool,
) -> Result<AppSettingsDto, String> {
    let master_key = current_master_key()?;
    let store = AppSettingsStore::open(database_path).map_err(|e| e.to_string())?;
    let mut current = store
        .load_with_master_key(master_key.as_deref())
        .map_err(|e| e.to_string())?;
    current.public_relays_enabled = enabled;
    current.relay_migration_version = CURRENT_RELAY_MIGRATION_VERSION;
    if enabled {
        if !current.relay_urls.iter().any(|u| u == PRIMARY_EARTHLY_RELAY) {
            current.relay_urls.insert(0, PRIMARY_EARTHLY_RELAY.to_owned());
        }
        for pub_relay in DEFAULT_PUBLIC_RELAYS {
            let owned = (*pub_relay).to_owned();
            if !current.relay_urls.contains(&owned) {
                current.relay_urls.push(owned);
            }
        }
    } else {
        current
            .relay_urls
            .retain(|u| !DEFAULT_PUBLIC_RELAYS.contains(&u.as_str()));
        if current.relay_urls.is_empty() {
            current.relay_urls.push(PRIMARY_EARTHLY_RELAY.to_owned());
        }
    }
    let saved = store
        .save_with_master_key(&current, master_key.as_deref())
        .map_err(|e| e.to_string())?;
    crate::api::relay_pool::set_relay_manager_public_enabled(saved.public_relays_enabled);
    crate::api::relay_pool::sync_configured_relays(&saved.relay_urls);
    Ok(from_record(saved))
}

/// Returns the canonical production default relay list (`relay.earthly.city` + public relays).
pub fn default_public_relay_urls() -> Vec<String> {
    default_production_relay_urls()
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
        nip60_wallet_enabled: r.nip60_wallet_enabled,
        point_clustering_enabled: r.point_clustering_enabled,
        point_cluster_radius: r.point_cluster_radius,
        point_cluster_max_zoom: r.point_cluster_max_zoom,
        agent_provider_type: r.agent_provider_type,
        agent_auto_pay_cashu: r.agent_auto_pay_cashu,
        agent_cashu_max_sats: r.agent_cashu_max_sats,
        public_relays_enabled: Some(r.public_relays_enabled),
    }
}

fn to_record(d: AppSettingsDto, resolved_public_relays_enabled: bool) -> PersistedAppSettings {
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
        nip60_wallet_enabled: d.nip60_wallet_enabled,
        point_clustering_enabled: d.point_clustering_enabled,
        point_cluster_radius: d.point_cluster_radius,
        point_cluster_max_zoom: d.point_cluster_max_zoom,
        agent_provider_type: d.agent_provider_type,
        agent_auto_pay_cashu: d.agent_auto_pay_cashu,
        agent_cashu_max_sats: d.agent_cashu_max_sats,
        public_relays_enabled: d
            .public_relays_enabled
            .unwrap_or(resolved_public_relays_enabled),
        relay_migration_version: CURRENT_RELAY_MIGRATION_VERSION,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine as _;
    use std::sync::{Mutex, MutexGuard};
    use tempfile::tempdir;

    static TEST_MASTER_KEY_MUTEX: Mutex<()> = Mutex::new(());

    struct MasterKeyTestGuard {
        _lock: MutexGuard<'static, ()>,
        prev_relay_state: crate::api::relay_pool::RelayManagerState,
    }

    impl MasterKeyTestGuard {
        fn acquire() -> Self {
            let lock = TEST_MASTER_KEY_MUTEX
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            *master_key_lock().write().unwrap() = None;
            let prev_relay_state = crate::api::relay_pool::snapshot_relay_manager_state();
            Self {
                _lock: lock,
                prev_relay_state,
            }
        }
    }

    impl Drop for MasterKeyTestGuard {
        fn drop(&mut self) {
            if let Ok(mut guard) = master_key_lock().write() {
                *guard = None;
            }
            if let Ok(mut guard) = crate::api::relay_pool::relay_manager_lock().write() {
                *guard = self.prev_relay_state.clone();
            }
        }
    }

    fn test_key_b64(byte: u8) -> String {
        STANDARD.encode([byte; 32])
    }

    #[test]
    fn round_trips_blossom_and_inbox_read_state() {
        let _guard = MasterKeyTestGuard::acquire();
        let dir = tempdir().unwrap();
        let db = dir.path().join("settings.sqlite3").display().to_string();
        let mut s = load_app_settings(db.clone()).unwrap();
        assert!(!s.nip60_wallet_enabled);
        assert!(s.point_clustering_enabled);
        assert_eq!(s.point_cluster_radius, 50);
        assert_eq!(s.point_cluster_max_zoom, 14);
        assert!(!s.agent_auto_pay_cashu);
        assert_eq!(s.agent_cashu_max_sats, 25);
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
        s.nip60_wallet_enabled = true;
        s.point_clustering_enabled = false;
        s.point_cluster_radius = 80;
        s.point_cluster_max_zoom = 12;
        s.agent_provider_type = Some("routstr".to_owned());
        s.agent_auto_pay_cashu = true;
        s.agent_cashu_max_sats = 40;
        let saved = save_app_settings(db.clone(), s).unwrap();
        assert!(saved.nip60_wallet_enabled);
        assert!(!saved.point_clustering_enabled);
        assert_eq!(saved.point_cluster_radius, 80);
        assert_eq!(saved.point_cluster_max_zoom, 12);
        assert_eq!(saved.agent_provider_type.as_deref(), Some("routstr"));
        assert!(saved.agent_auto_pay_cashu);
        assert_eq!(saved.agent_cashu_max_sats, 40);
        assert_eq!(saved.blossom_server_url, "https://blossom.primal.net");
        assert_eq!(saved.muted_pubkeys, vec!["f".repeat(64)]);
        let reloaded = load_app_settings(db).unwrap();
        assert!(reloaded.nip60_wallet_enabled);
        assert!(!reloaded.point_clustering_enabled);
        assert_eq!(reloaded.point_cluster_radius, 80);
        assert_eq!(reloaded.point_cluster_max_zoom, 12);
        assert_eq!(reloaded.agent_provider_type.as_deref(), Some("routstr"));
        assert!(reloaded.agent_auto_pay_cashu);
        assert_eq!(reloaded.agent_cashu_max_sats, 40);
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

    #[test]
    fn set_settings_master_key_validates_and_encrypts_ffi_persistence() {
        let _guard = MasterKeyTestGuard::acquire();
        assert!(set_settings_master_key("not-base64".to_owned()).is_err());
        assert!(set_settings_master_key(STANDARD.encode([1u8; 16])).is_err());

        let key_a = test_key_b64(0x7a);
        let key_b = test_key_b64(0x8b);
        set_settings_master_key(key_a.clone()).unwrap();

        let dir = tempdir().unwrap();
        let db_path = dir.path().join("ffi-encrypted.sqlite3");
        let db = db_path.display().to_string();

        let mut s = load_app_settings(db.clone()).unwrap();
        s.local_nsec = Some("nsec1ffilocalnsec".to_owned());
        s.bunker_client_nsec = Some("nsec1ffibunkernsec".to_owned());
        s.nwc_uri = Some("nostr+walletconnect://ffi?secret=supersecret".to_owned());
        s.agent_api_key = "sk-ffi-secret-key".to_owned();
        s.saved_accounts = vec![SavedAccountSessionDto {
            id: format!("local:{}", "4".repeat(64)),
            kind: "local".to_owned(),
            pubkey_hex: "4".repeat(64),
            local_nsec: Some("nsec1ffisavedlocal".to_owned()),
            bunker_uri: None,
            bunker_client_nsec: Some("nsec1ffisavedbunker".to_owned()),
            signer_package: None,
            label: Some("Primary".to_owned()),
        }];

        let saved = save_app_settings(db.clone(), s).unwrap();
        assert_eq!(saved.local_nsec.as_deref(), Some("nsec1ffilocalnsec"));
        assert_eq!(saved.agent_api_key, "sk-ffi-secret-key");

        // Verify SQLite storage files contain no plaintext secrets.
        for candidate in [
            db_path.clone(),
            dir.path().join("ffi-encrypted.sqlite3-wal"),
        ] {
            if candidate.exists() {
                let bytes = std::fs::read(&candidate).unwrap();
                let text = String::from_utf8_lossy(&bytes);
                assert!(!text.contains("nsec1ffilocalnsec"));
                assert!(!text.contains("nsec1ffibunkernsec"));
                assert!(!text.contains("nostr+walletconnect://ffi"));
                assert!(!text.contains("sk-ffi-secret-key"));
                assert!(!text.contains("nsec1ffisavedlocal"));
                assert!(!text.contains("nsec1ffisavedbunker"));
            }
        }

        let loaded = load_app_settings(db.clone()).unwrap();
        assert_eq!(loaded.local_nsec.as_deref(), Some("nsec1ffilocalnsec"));
        assert_eq!(loaded.bunker_client_nsec.as_deref(), Some("nsec1ffibunkernsec"));
        assert_eq!(
            loaded.nwc_uri.as_deref(),
            Some("nostr+walletconnect://ffi?secret=supersecret")
        );
        assert_eq!(loaded.agent_api_key, "sk-ffi-secret-key");
        assert_eq!(
            loaded.saved_accounts[0].local_nsec.as_deref(),
            Some("nsec1ffisavedlocal")
        );
        assert_eq!(
            loaded.saved_accounts[0].bunker_client_nsec.as_deref(),
            Some("nsec1ffisavedbunker")
        );

        // Wrong master key must fail closed.
        set_settings_master_key(key_b).unwrap();
        assert!(load_app_settings(db.clone()).is_err());

        // Restoring original master key succeeds again.
        set_settings_master_key(key_a).unwrap();
        assert_eq!(
            load_app_settings(db).unwrap().local_nsec.as_deref(),
            Some("nsec1ffilocalnsec")
        );
    }

    #[test]
    fn set_public_relays_enabled_and_optional_save_preserve_policy() {
        let _guard = MasterKeyTestGuard::acquire();
        let dir = tempdir().unwrap();
        let db = dir.path().join("public-relays-ffi.sqlite3").display().to_string();

        let fresh = load_app_settings(db.clone()).unwrap();
        assert_eq!(fresh.public_relays_enabled, Some(true));
        assert_eq!(fresh.relay_urls, default_public_relay_urls());

        // Add a custom relay and toggle public relays OFF.
        let mut with_custom = fresh;
        with_custom.relay_urls.push("wss://field.custom.example".to_owned());
        save_app_settings(db.clone(), with_custom).unwrap();

        let disabled = set_public_relays_enabled(db.clone(), false).unwrap();
        assert_eq!(disabled.public_relays_enabled, Some(false));
        assert!(disabled.relay_urls.contains(&PRIMARY_EARTHLY_RELAY.to_owned()));
        assert!(disabled.relay_urls.contains(&"wss://field.custom.example".to_owned()));
        assert!(!disabled.relay_urls.contains(&"wss://relay.damus.io".to_owned()));

        // Saving with `public_relays_enabled: None` (backward-compatible caller) preserves `false`.
        let mut compat_save = disabled;
        compat_save.public_relays_enabled = None;
        let saved = save_app_settings(db.clone(), compat_save).unwrap();
        assert_eq!(saved.public_relays_enabled, Some(false));

        // Toggling public relays back ON merges default public relays while preserving custom relay.
        let reenabled = set_public_relays_enabled(db, true).unwrap();
        assert_eq!(reenabled.public_relays_enabled, Some(true));
        assert!(reenabled.relay_urls.contains(&PRIMARY_EARTHLY_RELAY.to_owned()));
        assert!(reenabled.relay_urls.contains(&"wss://field.custom.example".to_owned()));
        assert!(reenabled.relay_urls.contains(&"wss://relay.damus.io".to_owned()));
        assert!(reenabled.relay_urls.contains(&"wss://nos.lol".to_owned()));
        assert!(reenabled.relay_urls.contains(&"wss://relay.primal.net".to_owned()));
    }
}
