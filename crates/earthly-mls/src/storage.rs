//! Durable SQLite storage for Earthly Circles (MLS states, KeyPackages, Pending Joins,
//! Crash-Recovery Journals, Sync Health, and Epoch Media Keys).

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::envelope::PrivateWorkspaceEnvelope;
use crate::mls::{GeneratedKeyPackage, PersistedMlsState};

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
    pub relays: Vec<String>,
    pub role: String,   // "administrator" | "member"
    pub status: String, // "active" | "removed"
    pub mls_state: PersistedMlsState,
    pub cursor: u64,
    pub metadata: Option<WorkspaceMetadata>,
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
    pub created_at_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredKeyPackage {
    pub owner_pubkey: String,
    pub kp_ref: String,
    pub bundle: GeneratedKeyPackage,
    pub published: bool,
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
    pub relays: Vec<String>,
    pub key_package_ref: String,
    pub created_at_ms: u64,
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
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS private_workspaces (
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
             );",
        )
        .map_err(|e| format!("Failed to initialize MLS SQLite schema: {e}"))?;
        Ok(Self {
            conn: Mutex::new(conn),
            path,
        })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn list_workspaces(&self, owner_pubkey: &str) -> Result<Vec<StoredWorkspace>, String> {
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT value_json FROM private_workspaces
                 WHERE owner_pubkey = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("Failed to query workspaces: {e}"))?;
        let rows = stmt
            .query_map(params![owner_pubkey], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read workspaces: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            let json = row.map_err(|e| format!("Failed to read workspace row: {e}"))?;
            let mut ws: StoredWorkspace = serde_json::from_str(&json)
                .map_err(|e| format!("Corrupt stored workspace JSON: {e}"))?;
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
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM private_workspaces
                 WHERE owner_pubkey = ?1 AND workspace_id = ?2",
                params![owner_pubkey, workspace_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| format!("Failed to load workspace: {e}"))?;
        match raw {
            None => Ok(None),
            Some(json) => {
                let mut ws: StoredWorkspace = serde_json::from_str(&json)
                    .map_err(|e| format!("Corrupt stored workspace JSON: {e}"))?;
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
        let json = serde_json::to_string(workspace)
            .map_err(|e| format!("Failed to serialize workspace: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO private_workspaces (owner_pubkey, workspace_id, value_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, workspace_id) DO UPDATE SET
               value_json = excluded.value_json,
               created_at_ms = excluded.created_at_ms",
            params![
                workspace.owner_pubkey,
                workspace.workspace_id,
                json,
                workspace.created_at_ms as i64
            ],
        )
        .map_err(|e| format!("Failed to persist workspace: {e}"))?;
        Ok(())
    }

    pub fn delete_workspace(&self, owner_pubkey: &str, workspace_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "DELETE FROM private_workspaces WHERE owner_pubkey = ?1 AND workspace_id = ?2",
            params![owner_pubkey, workspace_id],
        )
        .map_err(|e| format!("Failed to delete workspace: {e}"))?;
        Ok(())
    }

    pub fn put_key_package(&self, kp: &StoredKeyPackage) -> Result<(), String> {
        let json = serde_json::to_string(kp)
            .map_err(|e| format!("Failed to serialize key package: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO mls_key_packages (owner_pubkey, kp_ref, value_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, kp_ref) DO UPDATE SET
               value_json = excluded.value_json",
            params![kp.owner_pubkey, kp.kp_ref, json, kp.created_at_ms as i64],
        )
        .map_err(|e| format!("Failed to persist key package: {e}"))?;
        Ok(())
    }

    pub fn get_key_package(
        &self,
        owner_pubkey: &str,
        kp_ref: &str,
    ) -> Result<Option<StoredKeyPackage>, String> {
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let raw: Option<String> = conn
            .query_row(
                "SELECT value_json FROM mls_key_packages
                 WHERE owner_pubkey = ?1 AND kp_ref = ?2",
                params![owner_pubkey, kp_ref],
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

    pub fn put_pending_join(&self, join: &PendingWorkspaceJoin) -> Result<(), String> {
        let json = serde_json::to_string(join)
            .map_err(|e| format!("Failed to serialize pending join: {e}"))?;
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "INSERT INTO pending_joins (owner_pubkey, kp_ref, value_json, created_at_ms)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(owner_pubkey, kp_ref) DO UPDATE SET
               value_json = excluded.value_json",
            params![
                join.owner_pubkey,
                join.key_package_ref,
                json,
                join.created_at_ms as i64
            ],
        )
        .map_err(|e| format!("Failed to persist pending join: {e}"))?;
        Ok(())
    }

    pub fn list_pending_joins(&self, owner_pubkey: &str) -> Result<Vec<PendingWorkspaceJoin>, String> {
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        let mut stmt = conn
            .prepare(
                "SELECT value_json FROM pending_joins
                 WHERE owner_pubkey = ?1
                 ORDER BY created_at_ms DESC",
            )
            .map_err(|e| format!("Failed to query pending joins: {e}"))?;
        let rows = stmt
            .query_map(params![owner_pubkey], |row| row.get::<_, String>(0))
            .map_err(|e| format!("Failed to read pending joins: {e}"))?;
        let mut out = Vec::new();
        for row in rows {
            let json = row.map_err(|e| format!("Failed to read pending join row: {e}"))?;
            let item: PendingWorkspaceJoin = serde_json::from_str(&json)
                .map_err(|e| format!("Corrupt pending join JSON: {e}"))?;
            out.push(item);
        }
        Ok(out)
    }

    pub fn delete_pending_join(&self, owner_pubkey: &str, kp_ref: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|_| "MLS store lock poisoned")?;
        conn.execute(
            "DELETE FROM pending_joins WHERE owner_pubkey = ?1 AND kp_ref = ?2",
            params![owner_pubkey, kp_ref],
        )
        .map_err(|e| format!("Failed to delete pending join: {e}"))?;
        Ok(())
    }
}
