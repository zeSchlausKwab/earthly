use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const DRAFT_STORE_VERSION: u8 = 1;
const MAX_DRAFT_GEOJSON_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug)]
pub struct DraftStore {
    connection: Mutex<Connection>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDraft {
    pub draft_id: String,
    pub d_tag: String,
    pub entity_kind: u16,
    pub title: String,
    pub description: Option<String>,
    pub audience_channel: String,
    pub audience_id: Option<String>,
    pub geojson: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveDraftInput {
    pub draft_id: String,
    pub d_tag: String,
    pub entity_kind: u16,
    pub title: String,
    pub description: Option<String>,
    pub audience_channel: String,
    pub audience_id: Option<String>,
    pub geojson: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftStoreError {
    pub code: String,
    pub message: String,
}

impl DraftStoreError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for DraftStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("draft-database-failed", error.to_string())
    }
}

impl std::fmt::Display for DraftStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for DraftStoreError {}

impl DraftStore {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, DraftStoreError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| DraftStoreError::new("draft-open-failed", error.to_string()))?;
        }
        let connection = Connection::open(database_path)?;
        configure_and_migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, DraftStoreError> {
        self.connection.lock().map_err(|_| {
            DraftStoreError::new("draft-lock-failed", "The local draft store is unavailable")
        })
    }

    pub fn save(&self, input: SaveDraftInput) -> Result<PersistedDraft, DraftStoreError> {
        if input.draft_id.trim().is_empty() || input.d_tag.trim().is_empty() {
            return Err(DraftStoreError::new(
                "invalid-draft-id",
                "draft_id and d_tag must be non-empty",
            ));
        }
        if input.geojson.len() > MAX_DRAFT_GEOJSON_BYTES {
            return Err(DraftStoreError::new(
                "draft-too-large",
                "Draft GeoJSON exceeds the 16 MiB local draft cap",
            ));
        }
        let parsed: serde_json::Value = serde_json::from_str(&input.geojson)
            .map_err(|err| DraftStoreError::new("invalid-draft-geojson", err.to_string()))?;
        if parsed.get("type").and_then(|v| v.as_str()) != Some("FeatureCollection") {
            return Err(DraftStoreError::new(
                "invalid-draft-geojson",
                "Draft payload must be a GeoJSON FeatureCollection",
            ));
        }

        let now = now_seconds();
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO local_drafts (
               draft_id, d_tag, entity_kind, title, description,
               audience_channel, audience_id, geojson, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
             ON CONFLICT(draft_id) DO UPDATE SET
               d_tag = excluded.d_tag,
               entity_kind = excluded.entity_kind,
               title = excluded.title,
               description = excluded.description,
               audience_channel = excluded.audience_channel,
               audience_id = excluded.audience_id,
               geojson = excluded.geojson,
               updated_at = excluded.updated_at",
            params![
                input.draft_id,
                input.d_tag,
                input.entity_kind,
                input.title,
                input.description,
                input.audience_channel,
                input.audience_id,
                input.geojson,
                now,
            ],
        )?;
        load_one(&connection, &input.draft_id)?.ok_or_else(|| {
            DraftStoreError::new("draft-write-failed", "Saved draft could not be reloaded")
        })
    }

    pub fn load(&self, draft_id: &str) -> Result<Option<PersistedDraft>, DraftStoreError> {
        let connection = self.connection()?;
        load_one(&connection, draft_id)
    }

    pub fn list(&self) -> Result<Vec<PersistedDraft>, DraftStoreError> {
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT draft_id, d_tag, entity_kind, title, description,
                    audience_channel, audience_id, geojson, created_at, updated_at
             FROM local_drafts
             ORDER BY updated_at DESC, draft_id ASC",
        )?;
        let rows = statement
            .query_map([], row_to_draft)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn delete(&self, draft_id: &str) -> Result<bool, DraftStoreError> {
        let connection = self.connection()?;
        let affected = connection.execute(
            "DELETE FROM local_drafts WHERE draft_id = ?1",
            params![draft_id],
        )?;
        Ok(affected > 0)
    }
}

fn configure_and_migrate(connection: &Connection) -> Result<(), DraftStoreError> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS local_drafts (
           draft_id TEXT PRIMARY KEY,
           d_tag TEXT NOT NULL,
           entity_kind INTEGER NOT NULL,
           title TEXT NOT NULL,
           description TEXT,
           audience_channel TEXT NOT NULL,
           audience_id TEXT,
           geojson TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

fn load_one(
    connection: &Connection,
    draft_id: &str,
) -> Result<Option<PersistedDraft>, DraftStoreError> {
    let draft = connection
        .query_row(
            "SELECT draft_id, d_tag, entity_kind, title, description,
                    audience_channel, audience_id, geojson, created_at, updated_at
             FROM local_drafts
             WHERE draft_id = ?1",
            params![draft_id],
            row_to_draft,
        )
        .optional()?;
    Ok(draft)
}

fn row_to_draft(row: &rusqlite::Row<'_>) -> rusqlite::Result<PersistedDraft> {
    Ok(PersistedDraft {
        draft_id: row.get(0)?,
        d_tag: row.get(1)?,
        entity_kind: row.get(2)?,
        title: row.get(3)?,
        description: row.get(4)?,
        audience_channel: row.get(5)?,
        audience_id: row.get(6)?,
        geojson: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn drafts_persist_across_reopen_and_delete_cleanly() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("earthly.sqlite3");
        let store = DraftStore::open(&db).unwrap();
        let saved = store
            .save(SaveDraftInput {
                draft_id: "active-map".to_owned(),
                d_tag: "vienna-walk".to_owned(),
                entity_kind: 37_515,
                title: "Vienna Walk".to_owned(),
                description: Some("Morning loop".to_owned()),
                audience_channel: "public".to_owned(),
                audience_id: None,
                geojson: r#"{"type":"FeatureCollection","features":[]}"#.to_owned(),
            })
            .unwrap();
        drop(store);

        let reopened = DraftStore::open(&db).unwrap();
        assert_eq!(reopened.load("active-map").unwrap(), Some(saved));
        assert_eq!(reopened.list().unwrap().len(), 1);
        assert!(reopened.delete("active-map").unwrap());
        assert!(reopened.list().unwrap().is_empty());
    }
}
