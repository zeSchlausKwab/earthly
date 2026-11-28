//! Durable SQLite storage for Earthly Circles (MLS states, KeyPackages, Pending Joins,
//! Crash-Recovery Journals, Sync Health, and Epoch Media Keys).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use nostr::PublicKey;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::envelope::PrivateWorkspaceEnvelope;
use crate::mls::{GeneratedKeyPackage, PersistedMlsState};

pub const CURRENT_MLS_SCHEMA_VERSION: u32 = 2;

pub const SYNC_HEALTH_HEALTHY: &str = "healthy";
pub const SYNC_HEALTH_BEHIND: &str = "behind";
pub const SYNC_HEALTH_FORKED: &str = "forked";
pub const SYNC_HEALTH_REMOVED: &str = "removed";

fn default_attempt() -> u32 {
    1
}

fn default_sync_health() -> String {
    SYNC_HEALTH_HEALTHY.to_owned()
}

fn default_role() -> String {
    "member".to_owned()
}

fn default_status() -> String {
    "active".to_owned()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// Canonicalizes an owner Nostr pubkey (lowercase 64-char hex, accepting `npub1…`
/// or mixed-case hex) so upgrades never split workspaces across pubkey formats.
pub fn normalize_owner_pubkey(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    PublicKey::parse(trimmed)
        .map(|pk| pk.to_hex())
        .unwrap_or_else(|_| trimmed.to_ascii_lowercase())
}

/// Process-wide per-`(owner_pubkey, workspace_id)` async mutex serializing all MLS + SQLite
/// state transitions (background syncs, streaming push frames, sends, approvals, removals,
/// and multi-device reconciliation).
static WORKSPACE_LOCKS: OnceLock<Mutex<HashMap<(String, String), Arc<tokio::sync::Mutex<()>>>>> =
    OnceLock::new();

pub fn workspace_mutex(owner_pubkey: &str, workspace_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let map = WORKSPACE_LOCKS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    Arc::clone(
        guard
            .entry((owner_pubkey.to_owned(), workspace_id.to_owned()))
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(()))),
    )
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMetadata {
    pub name: String,
    pub description: Option<String>,
    pub recommended_basemap: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceOutbound {
    pub cursor: u64,
    pub envelope: PrivateWorkspaceEnvelope,
}

/// Write-ahead crash-recovery journal for a single application record currently being posted.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceApplication {
    pub version: u8,
    pub envelope: PrivateWorkspaceEnvelope,
    pub forwarded: bool,
    pub basis_cursor: u64,
    pub basis_mls_state: PersistedMlsState,
    pub msg_base64: String,
    pub final_mls_state: PersistedMlsState,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceApprovalMessage {
    #[serde(rename = "type")]
    pub msg_type: String, // "commit" | "application"
    pub msg_base64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub envelope: Option<PrivateWorkspaceEnvelope>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<u64>,
}

/// Crash-recovery journal for the multi-message Add + checkpoint + Welcome + join-request consume sequence.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceApproval {
    pub version: u8,
    pub target_pubkey: String,
    pub key_package_ref: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_package_base64: Option<String>,
    pub request_at: u64,
    pub basis_cursor: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub basis_mls_state: Option<PersistedMlsState>,
    pub welcome_base64: String,
    pub final_mls_state: PersistedMlsState,
    pub messages: Vec<PendingWorkspaceApprovalMessage>,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub welcome_stored_at: Option<u64>,
    #[serde(default)]
    pub local_finalized: bool,
}

/// Crash-recovery journal for concurrent MLS member removals.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceMembershipCommit {
    pub version: u8,
    pub operation: String, // "remove"
    pub target_pubkey: String,
    pub basis_cursor: u64,
    pub basis_mls_state: PersistedMlsState,
    pub msg_base64: String,
    pub final_mls_state: PersistedMlsState,
    #[serde(default = "default_attempt")]
    pub attempt: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedCoordinatorMessage {
    pub cursor: u64,
    pub reason: String, // "rejected" | "stale-or-invalid"
    pub recorded_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredWorkspace {
    pub workspace_id: String,
    pub group_id: String,
    pub owner_pubkey: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    #[serde(default)]
    pub relays: Vec<String>,
    #[serde(default = "default_role")]
    pub role: String, // "administrator" | "member"
    #[serde(default = "default_status")]
    pub status: String, // "active" | "removed"
    pub mls_state: PersistedMlsState,
    #[serde(default)]
    pub cursor: u64,
    #[serde(default)]
    pub metadata: Option<WorkspaceMetadata>,
    #[serde(default)]
    pub envelopes: Vec<PrivateWorkspaceEnvelope>,
    #[serde(default)]
    pub pending_outbound: Vec<PendingWorkspaceOutbound>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_application: Option<PendingWorkspaceApplication>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_approval: Option<PendingWorkspaceApproval>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pending_membership_commit: Option<PendingWorkspaceMembershipCommit>,
    #[serde(default)]
    pub skipped_coordinator_messages: Vec<SkippedCoordinatorMessage>,
    #[serde(default)]
    pub consecutive_decrypt_errors: u32,
    #[serde(default = "default_sync_health")]
    pub sync_health: String, // "healthy" | "behind" | "forked" | "removed"
    #[serde(default)]
    pub auto_approve_joins: bool,
    #[serde(default)]
    pub envelope_epochs: BTreeMap<String, u64>,
    #[serde(default)]
    pub epoch_media_keys: BTreeMap<u64, String>,
    #[serde(default)]
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeyPackage {
    pub owner_pubkey: String,
    pub kp_ref: String,
    pub bundle: GeneratedKeyPackage,
    #[serde(default)]
    pub published: bool,
    #[serde(default)]
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingWorkspaceJoin {
    pub owner_pubkey: String,
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    #[serde(default)]
    pub relays: Vec<String>,
    pub key_package_ref: String,
    #[serde(default)]
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRemovedGroup {
    pub gid: String,
    pub removed_at: u64,
}

/// Per-identity persisted multi-device snapshot metadata (DEK reuse, `prev` blob hash chain,
/// last published tip event, and intentional local deletion tombstones).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredMultiDeviceState {
    pub owner_pubkey: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dek_hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_tip_event_id: Option<String>,
    #[serde(default)]
    pub last_tip_updated_at: u64,
    #[serde(default)]
    pub blossom_servers: Vec<String>,
    #[serde(default)]
    pub group_doc_hashes: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meta_doc_hash: Option<String>,
    #[serde(default)]
    pub removed_groups: Vec<StoredRemovedGroup>,
    #[serde(default)]
    pub updated_at_ms: u64,
}

pub struct SqlitePrivateWorkspaceStore {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl SqlitePrivateWorkspaceStore {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, String> {
        let path = path.as_ref().to_path_buf();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create MLS storage directory: {e}"))?;
        }
        let conn = Connection::open(&path)
            .map_err(|e| format!("Failed to open MLS SQLite database: {e}"))?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;",
        )
        .map_err(|e| format!("Failed to configure MLS SQLite pragmas: {e}"))?;

        let existing_version: u32 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap_or(0);

        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS private_workspaces (
               owner_pubkey TEXT NOT NULL,
               workspace_id TEXT NOT NULL,
               value_json TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               PRIMARY KEY (owner_pubkey, workspace_id)
             );
             CREATE TABLE IF NOT EXISTS mls_key_packages (
               owner_pubkey TEXT NOT NULL,
               kp_ref TEXT NOT NULL,
               value_json TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               PRIMARY KEY (owner_pubkey, kp_ref)
             );
             CREATE TABLE IF NOT EXISTS pending_joins (
               owner_pubkey TEXT NOT NULL,
               kp_ref TEXT NOT NULL,
               value_json TEXT NOT NULL,
               created_at_ms INTEGER NOT NULL,
               PRIMARY KEY (owner_pubkey, kp_ref)
             );
             CREATE TABLE IF NOT EXISTS multi_device_state (
               owner_pubkey TEXT PRIMARY KEY,
               value_json TEXT NOT NULL,
               updated_at_ms INTEGER NOT NULL
             );",
        )
        .map_err(|e| format!("Failed to initialize MLS SQLite schema: {e}"))?;

        if existing_version < CURRENT_MLS_SCHEMA_VERSION {
            Self::create_pre_migration_backup_if_non_empty(&conn, &path, existing_version);
            Self::migrate_legacy_owner_pubkeys(&conn);
            let _ = conn.execute_batch(&format!(
                "PRAGMA user_version = {CURRENT_MLS_SCHEMA_VERSION};"
            ));
        }

        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    fn create_pre_migration_backup_if_non_empty(
        conn: &Connection,
        path: &Path,
        old_version: u32,
    ) {
        let total_rows: i64 = conn
            .query_row(
                "SELECT
                   (SELECT COUNT(*) FROM private_workspaces) +
                   (SELECT COUNT(*) FROM mls_key_packages) +
                   (SELECT COUNT(*) FROM pending_joins)",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        if total_rows <= 0 {
            return;
        }
        let Some(file_name) = path.file_name().and_then(|s| s.to_str()) else {
            return;
        };
        let backup_path = path.with_file_name(format!("{file_name}.v{old_version}.bak"));
        if backup_path.exists() {
            return;
        }
        let escaped = backup_path.to_string_lossy().replace('\'', "''");
        let _ = conn.execute_batch(&format!("VACUUM INTO '{escaped}';"));
    }

    fn migrate_legacy_owner_pubkeys(conn: &Connection) {
        for (table, key_col) in [
            ("private_workspaces", "workspace_id"),
            ("mls_key_packages", "kp_ref"),
            ("pending_joins", "kp_ref"),
        ] {
            let sql = format!("SELECT owner_pubkey, {key_col}, value_json, created_at_ms FROM {table}");
            let Ok(mut stmt) = conn.prepare(&sql) else {
                continue;
            };
            let rows: Vec<(String, String, String, i64)> = stmt
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                })
                .ok()
                .map(|iter| iter.flatten().collect())
                .unwrap_or_default();
            drop(stmt);

            for (raw_owner, item_key, raw_json, created_at_ms) in rows {
                let canonical = normalize_owner_pubkey(&raw_owner);
                if canonical.is_empty() || canonical == raw_owner {
                    continue;
                }
                let updated_json = match serde_json::from_str::<serde_json::Value>(&raw_json) {
                    Ok(mut val) => {
                        if let Some(obj) = val.as_object_mut() {
                            obj.insert(
                                "ownerPubkey".to_owned(),
                                serde_json::Value::String(canonical.clone()),
                            );
                        }
                        serde_json::to_string(&val).unwrap_or(raw_json.clone())
                    }
                    Err(_) => raw_json.clone(),
                };
                let insert_sql = format!(
                    "INSERT OR IGNORE INTO {table} (owner_pubkey, {key_col}, value_json, created_at_ms)
                     VALUES (?1, ?2, ?3, ?4)"
                );
                if conn
                    .execute(
                        &insert_sql,
                        params![canonical, item_key, updated_json, created_at_ms],
                    )
                    .is_ok()
                {
                    let delete_sql =
                        format!("DELETE FROM {table} WHERE owner_pubkey = ?1 AND {key_col} = ?2");
                    let _ = conn.execute(&delete_sql, params![raw_owner, item_key]);
                }
            }
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list_workspaces(&self, owner_pubkey: &str) -> Result<Vec<StoredWorkspace>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT value_json FROM private_workspaces
                 WHERE owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("Failed to query workspaces: {e}"))?;
        let rows = stmt
            .query_map(params![canonical], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read workspaces: {e}"))?;
        let mut out = Vec::new();
        let mut seen_ids = std::collections::HashSet::new();
        for row in rows {
            let Ok(json) = row else {
                continue;
            };
            // Resilient per-row deserialization: never let one corrupt row hide all healthy Circles.
            let Ok(mut ws) = serde_json::from_str::<StoredWorkspace>(&json) else {
                continue;
            };
            if !seen_ids.insert(ws.workspace_id.clone()) {
                continue;
            }
            ws.owner_pubkey = normalize_owner_pubkey(&ws.owner_pubkey);
            if ws.status == "removed" {
                ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
            }
            out.push(ws);
        }
        Ok(out)
    }

    pub fn get_workspace(
        &self,
        owner_pubkey: &str,
        workspace_id: &str,
    ) -> Result<Option<StoredWorkspace>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM private_workspaces
                 WHERE (owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1)
                   AND workspace_id = ?2",
                params![canonical, workspace_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to load workspace: {e}"))?;
        match raw {
            None => Ok(None),
            Some(json) => {
                let mut ws: StoredWorkspace = serde_json::from_str(&json)
                    .map_err(|e| format!("Corrupt stored workspace JSON: {e}"))?;
                ws.owner_pubkey = normalize_owner_pubkey(&ws.owner_pubkey);
                if ws.status == "removed" {
                    ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                }
                Ok(Some(ws))
            }
        }
    }

    pub fn get_workspace_by_group_id(
        &self,
        owner_pubkey: &str,
        group_id: &str,
    ) -> Result<Option<StoredWorkspace>, String> {
        let list = self.list_workspaces(owner_pubkey)?;
        Ok(list.into_iter().find(|ws| ws.group_id == group_id))
    }

    pub fn put_workspace(&self, workspace: &StoredWorkspace) -> Result<(), String> {
        let mut normalized = workspace.clone();
        normalized.owner_pubkey = normalize_owner_pubkey(&workspace.owner_pubkey);
        let json = serde_json::to_string(&normalized)
            .map_err(|e| format!("Failed to serialize workspace: {e}"))?;
        {
            let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
            conn.execute(
                "INSERT INTO private_workspaces (owner_pubkey, workspace_id, value_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)
                 ON CONFLICT(owner_pubkey, workspace_id) DO UPDATE SET
                   value_json = excluded.value_json,
                   created_at_ms = excluded.created_at_ms",
                params![
                    normalized.owner_pubkey,
                    normalized.workspace_id,
                    json,
                    normalized.created_at_ms as i64
                ],
            )
            .map_err(|e| format!("Failed to persist workspace: {e}"))?;
        }
        if normalized.status != "removed" {
            let _ = self.clear_removed_group_tombstone(
                &normalized.owner_pubkey,
                &normalized.group_id,
            );
        }
        Ok(())
    }

    pub fn delete_workspace(&self, owner_pubkey: &str, workspace_id: &str) -> Result<(), String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "DELETE FROM private_workspaces
             WHERE (owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1)
               AND workspace_id = ?2",
            params![canonical, workspace_id],
        )
        .map_err(|e| format!("Failed to delete workspace: {e}"))?;
        Ok(())
    }

    pub fn put_key_package(&self, kp: &StoredKeyPackage) -> Result<(), String> {
        let mut normalized = kp.clone();
        normalized.owner_pubkey = normalize_owner_pubkey(&kp.owner_pubkey);
        let json = serde_json::to_string(&normalized)
            .map_err(|e| format!("Failed to serialize key package: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO mls_key_packages (owner_pubkey, kp_ref, value_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, kp_ref) DO UPDATE SET
               value_json = excluded.value_json",
            params![
                normalized.owner_pubkey,
                normalized.kp_ref,
                json,
                normalized.created_at_ms as i64
            ],
        )
        .map_err(|e| format!("Failed to persist key package: {e}"))?;
        Ok(())
    }

    pub fn get_key_package(
        &self,
        owner_pubkey: &str,
        kp_ref: &str,
    ) -> Result<Option<StoredKeyPackage>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM mls_key_packages
                 WHERE (owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1)
                   AND kp_ref = ?2",
                params![canonical, kp_ref],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to load key package: {e}"))?;
        match raw {
            None => Ok(None),
            Some(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("Corrupt key package JSON: {e}")),
        }
    }

    pub fn list_key_packages(&self, owner_pubkey: &str) -> Result<Vec<StoredKeyPackage>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT value_json FROM mls_key_packages
                 WHERE owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("Failed to query key packages: {e}"))?;
        let rows = stmt
            .query_map(params![canonical], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read key packages: {e}"))?;
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for row in rows {
            let Ok(json) = row else {
                continue;
            };
            let Ok(mut kp) = serde_json::from_str::<StoredKeyPackage>(&json) else {
                continue;
            };
            if !seen.insert(kp.kp_ref.clone()) {
                continue;
            }
            kp.owner_pubkey = normalize_owner_pubkey(&kp.owner_pubkey);
            out.push(kp);
        }
        Ok(out)
    }

    pub fn put_pending_join(&self, join: &PendingWorkspaceJoin) -> Result<(), String> {
        let mut normalized = join.clone();
        normalized.owner_pubkey = normalize_owner_pubkey(&join.owner_pubkey);
        let json = serde_json::to_string(&normalized)
            .map_err(|e| format!("Failed to serialize pending join: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO pending_joins (owner_pubkey, kp_ref, value_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, kp_ref) DO UPDATE SET
               value_json = excluded.value_json",
            params![
                normalized.owner_pubkey,
                normalized.key_package_ref,
                json,
                normalized.created_at_ms as i64
            ],
        )
        .map_err(|e| format!("Failed to persist pending join: {e}"))?;
        Ok(())
    }

    pub fn list_pending_joins(&self, owner_pubkey: &str) -> Result<Vec<PendingWorkspaceJoin>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT value_json FROM pending_joins
                 WHERE owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("Failed to query pending joins: {e}"))?;
        let rows = stmt
            .query_map(params![canonical], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read pending joins: {e}"))?;
        let mut out = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for row in rows {
            let Ok(json) = row else {
                continue;
            };
            let Ok(mut item) = serde_json::from_str::<PendingWorkspaceJoin>(&json) else {
                continue;
            };
            if !seen.insert(item.key_package_ref.clone()) {
                continue;
            }
            item.owner_pubkey = normalize_owner_pubkey(&item.owner_pubkey);
            out.push(item);
        }
        Ok(out)
    }

    pub fn delete_pending_join(&self, owner_pubkey: &str, kp_ref: &str) -> Result<(), String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "DELETE FROM pending_joins
             WHERE (owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1)
               AND kp_ref = ?2",
            params![canonical, kp_ref],
        )
        .map_err(|e| format!("Failed to delete pending join: {e}"))?;
        Ok(())
    }

    pub fn get_multi_device_state(
        &self,
        owner_pubkey: &str,
    ) -> Result<Option<StoredMultiDeviceState>, String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM multi_device_state
                 WHERE owner_pubkey = ?1 OR LOWER(TRIM(owner_pubkey)) = ?1",
                params![canonical],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to load multi-device state: {e}"))?;
        match raw {
            None => Ok(None),
            Some(json) => Ok(serde_json::from_str::<StoredMultiDeviceState>(&json).ok()),
        }
    }

    pub fn put_multi_device_state(&self, state: &StoredMultiDeviceState) -> Result<(), String> {
        let mut normalized = state.clone();
        normalized.owner_pubkey = normalize_owner_pubkey(&state.owner_pubkey);
        if normalized.updated_at_ms == 0 {
            normalized.updated_at_ms = now_ms();
        }
        let json = serde_json::to_string(&normalized)
            .map_err(|e| format!("Failed to serialize multi-device state: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO multi_device_state (owner_pubkey, value_json, updated_at_ms)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(owner_pubkey) DO UPDATE SET
               value_json = excluded.value_json,
               updated_at_ms = excluded.updated_at_ms",
            params![normalized.owner_pubkey, json, normalized.updated_at_ms as i64],
        )
        .map_err(|e| format!("Failed to persist multi-device state: {e}"))?;
        Ok(())
    }

    pub fn record_removed_group_tombstone(
        &self,
        owner_pubkey: &str,
        gid: &str,
        removed_at_secs: u64,
    ) -> Result<(), String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        if canonical.is_empty() || gid.trim().is_empty() {
            return Ok(());
        }
        let mut state = self
            .get_multi_device_state(&canonical)?
            .unwrap_or_else(|| StoredMultiDeviceState {
                owner_pubkey: canonical.clone(),
                ..StoredMultiDeviceState::default()
            });
        state.removed_groups.retain(|r| r.gid != gid);
        state.removed_groups.push(StoredRemovedGroup {
            gid: gid.to_owned(),
            removed_at: removed_at_secs,
        });
        state.updated_at_ms = now_ms();
        self.put_multi_device_state(&state)
    }

    pub fn clear_removed_group_tombstone(
        &self,
        owner_pubkey: &str,
        gid: &str,
    ) -> Result<(), String> {
        let canonical = normalize_owner_pubkey(owner_pubkey);
        let Some(mut state) = self.get_multi_device_state(&canonical)? else {
            return Ok(());
        };
        let before = state.removed_groups.len();
        state.removed_groups.retain(|r| r.gid != gid);
        if state.removed_groups.len() != before {
            state.updated_at_ms = now_ms();
            self.put_multi_device_state(&state)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mls::{create_workspace_group, generate_mls_key_package};
    use nostr::{Keys, ToBech32};

    fn sample_workspace(owner_pubkey: &str, ws_id: &str, gid: &str) -> StoredWorkspace {
        let mls_state = create_workspace_group(gid, &normalize_owner_pubkey(owner_pubkey)).unwrap();
        StoredWorkspace {
            workspace_id: ws_id.to_owned(),
            group_id: gid.to_owned(),
            owner_pubkey: owner_pubkey.to_owned(),
            admin_pubkey: normalize_owner_pubkey(owner_pubkey),
            coordinator_pubkey: Keys::generate().public_key().to_hex(),
            relays: vec!["wss://relay.earthly.city".to_owned()],
            role: "administrator".to_owned(),
            status: "active".to_owned(),
            mls_state,
            cursor: 0,
            metadata: Some(WorkspaceMetadata {
                name: format!("Circle {ws_id}"),
                description: None,
                recommended_basemap: None,
            }),
            envelopes: Vec::new(),
            pending_outbound: Vec::new(),
            pending_application: None,
            pending_approval: None,
            pending_membership_commit: None,
            skipped_coordinator_messages: Vec::new(),
            consecutive_decrypt_errors: 0,
            sync_health: SYNC_HEALTH_HEALTHY.to_owned(),
            auto_approve_joins: false,
            envelope_epochs: BTreeMap::new(),
            epoch_media_keys: BTreeMap::new(),
            created_at_ms: now_ms(),
        }
    }

    #[test]
    fn schema_v0_migration_backs_up_db_normalizes_owners_and_survives_corrupt_row() {
        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("legacy_mls.sqlite3");

        let keys = Keys::generate();
        let lower_hex = keys.public_key().to_hex();
        let upper_hex = format!("  {}  ", lower_hex.to_ascii_uppercase());
        let npub = keys.public_key().to_bech32().unwrap();

        let ws_upper = sample_workspace(&upper_hex, "ws-upper", "earthly:upper");
        let ws_npub = sample_workspace(&npub, "ws-npub", "earthly:npub");
        let generated_kp = generate_mls_key_package(&lower_hex, true).unwrap();
        let stored_kp = StoredKeyPackage {
            kp_ref: generated_kp.kp_ref.clone(),
            owner_pubkey: npub.clone(),
            bundle: generated_kp,
            published: true,
            created_at_ms: now_ms(),
        };

        // Seed a legacy v0 SQLite database (no `multi_device_state`, `PRAGMA user_version = 0`).
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.execute_batch(
                "
                CREATE TABLE private_workspaces (
                    owner_pubkey TEXT NOT NULL,
                    workspace_id TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    PRIMARY KEY (owner_pubkey, workspace_id)
                );
                CREATE TABLE mls_key_packages (
                    owner_pubkey TEXT NOT NULL,
                    kp_ref TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    PRIMARY KEY (owner_pubkey, kp_ref)
                );
                CREATE TABLE pending_joins (
                    owner_pubkey TEXT NOT NULL,
                    kp_ref TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    created_at_ms INTEGER NOT NULL,
                    PRIMARY KEY (owner_pubkey, kp_ref)
                );
                PRAGMA user_version = 0;
                ",
            )
            .unwrap();
            conn.execute(
                "INSERT INTO private_workspaces (owner_pubkey, workspace_id, value_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    upper_hex,
                    ws_upper.workspace_id,
                    serde_json::to_string(&ws_upper).unwrap(),
                    100i64
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO private_workspaces (owner_pubkey, workspace_id, value_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    npub,
                    ws_npub.workspace_id,
                    serde_json::to_string(&ws_npub).unwrap(),
                    200i64
                ],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO private_workspaces (owner_pubkey, workspace_id, value_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![lower_hex, "ws-corrupt", "{not-valid-json", 300i64],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO mls_key_packages (owner_pubkey, kp_ref, value_json, created_at_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    npub,
                    stored_kp.kp_ref,
                    serde_json::to_string(&stored_kp).unwrap(),
                    400i64
                ],
            )
            .unwrap();
        }

        let store = SqlitePrivateWorkspaceStore::open(&db_path).unwrap();

        // Pre-migration backup was created alongside the database.
        let backup_path = dir.path().join("legacy_mls.sqlite3.v0.bak");
        assert!(backup_path.exists(), "expected v0 backup at {:?}", backup_path);

        // Both healthy rows survive migration & corrupt row does not hide them.
        let by_hex = store.list_workspaces(&lower_hex).unwrap();
        let by_npub = store.list_workspaces(&npub).unwrap();
        assert_eq!(by_hex.len(), 2);
        assert_eq!(by_npub.len(), 2);
        assert!(by_hex.iter().all(|w| w.owner_pubkey == lower_hex));

        // KeyPackage stored under npub was migrated to canonical lowercase hex.
        let kps = store.list_key_packages(&lower_hex).unwrap();
        assert_eq!(kps.len(), 1);
        assert_eq!(kps[0].kp_ref, stored_kp.kp_ref);
        assert_eq!(kps[0].owner_pubkey, lower_hex);
    }

    #[test]
    fn multi_device_state_and_tombstone_lifecycle() {
        let dir = tempfile::tempdir().unwrap();
        let store = SqlitePrivateWorkspaceStore::open(dir.path().join("md.sqlite3")).unwrap();
        let owner = Keys::generate().public_key().to_hex();

        store
            .record_removed_group_tombstone(&owner, "earthly:deleted", 1_760_000_000)
            .unwrap();
        let state = store.get_multi_device_state(&owner).unwrap().unwrap();
        assert_eq!(state.removed_groups.len(), 1);
        assert_eq!(state.removed_groups[0].gid, "earthly:deleted");

        // Re-adding an active workspace with the same gid clears its stale tombstone.
        let ws = sample_workspace(&owner, "ws-rejoined", "earthly:deleted");
        store.put_workspace(&ws).unwrap();
        let state_after = store.get_multi_device_state(&owner).unwrap().unwrap();
        assert!(state_after.removed_groups.is_empty());
    }
}
