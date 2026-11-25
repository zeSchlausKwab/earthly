//! Durable SQLite storage for Earthly Circles (MLS states, KeyPackages, Pending Joins).

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::envelope::PrivateWorkspaceEnvelope;
use crate::mls::{GeneratedKeyPackage, PersistedMlsState};

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
            let ws: StoredWorkspace = serde_json::from_str(&json)
                .map_err(|e| format!("Corrupt stored workspace JSON: {e}"))?;
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
            Some(json) => serde_json::from_str(&json)
                .map(Some)
                .map_err(|e| format!("Corrupt stored workspace JSON: {e}")),
        }
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
