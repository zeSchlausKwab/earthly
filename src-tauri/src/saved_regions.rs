use std::collections::{BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use earthly_local_node::{BlobDescriptor, LocalBlobIntegrity, PublicBlobDownloadError};
use nostr::{EventId, PublicKey};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::local_node::LocalNodeState;

const PROTOCOL_VERSION: u8 = 1;
const MAX_REGION_BLOBS: usize = 2_048;
const PROGRESS_EVENT: &str = "saved-region-progress-v1";
const MIN_FREE_SPACE_RESERVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FREE_SPACE_RESERVE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub struct SavedRegionState {
    connection: Mutex<Connection>,
    downloads: Mutex<HashMap<String, CancellationToken>>,
    maintenance: tokio::sync::RwLock<()>,
}

impl SavedRegionState {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, SavedRegionCommandError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                SavedRegionCommandError::new("region-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(database_path)?;
        configure_and_migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            downloads: Mutex::new(HashMap::new()),
            maintenance: tokio::sync::RwLock::new(()),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, SavedRegionCommandError> {
        self.connection.lock().map_err(|_| {
            SavedRegionCommandError::new(
                "region-database-unavailable",
                "The saved-region database lock is unavailable",
            )
        })
    }

    fn begin_download(&self, id: &str) -> Result<CancellationToken, SavedRegionCommandError> {
        let mut downloads = self.downloads.lock().map_err(|_| {
            SavedRegionCommandError::new(
                "region-download-unavailable",
                "The saved-region download lock is unavailable",
            )
        })?;
        if downloads.contains_key(id) {
            return Err(SavedRegionCommandError::new(
                "region-download-active",
                "This region is already downloading",
            ));
        }
        let cancellation = CancellationToken::new();
        downloads.insert(id.to_owned(), cancellation.clone());
        Ok(cancellation)
    }

    fn finish_download(&self, id: &str) {
        if let Ok(mut downloads) = self.downloads.lock() {
            downloads.remove(id);
        }
    }

    fn cancel_download(&self, id: &str) -> Result<bool, SavedRegionCommandError> {
        let downloads = self.downloads.lock().map_err(|_| {
            SavedRegionCommandError::new(
                "region-download-unavailable",
                "The saved-region download lock is unavailable",
            )
        })?;
        let Some(cancellation) = downloads.get(id) else {
            return Ok(false);
        };
        cancellation.cancel();
        Ok(true)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedRegionCreateInput {
    version: u8,
    id: String,
    name: String,
    bbox: [f64; 4],
    source_pubkey: String,
    announcement_id: String,
    blobs: Vec<SavedRegionBlobInput>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedRegionBlobInput {
    sha256: String,
    role: SavedRegionBlobRole,
    required: bool,
    ordinal: u32,
    expected_size: Option<u64>,
    mirror_urls: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SavedRegionBlobRole {
    Basemap,
    Overlay,
    Style,
    Sprite,
}

impl SavedRegionBlobRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Basemap => "basemap",
            Self::Overlay => "overlay",
            Self::Style => "style",
            Self::Sprite => "sprite",
        }
    }

    fn parse(value: &str) -> Result<Self, SavedRegionCommandError> {
        match value {
            "basemap" => Ok(Self::Basemap),
            "overlay" => Ok(Self::Overlay),
            "style" => Ok(Self::Style),
            "sprite" => Ok(Self::Sprite),
            _ => Err(SavedRegionCommandError::new(
                "region-database-corrupt",
                "A saved region contains an invalid blob role",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SavedRegionStatus {
    Planned,
    Downloading,
    Ready,
    Failed,
}

impl SavedRegionStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Downloading => "downloading",
            Self::Ready => "ready",
            Self::Failed => "failed",
        }
    }

    fn parse(value: &str) -> Result<Self, SavedRegionCommandError> {
        match value {
            "planned" => Ok(Self::Planned),
            "downloading" => Ok(Self::Downloading),
            "ready" => Ok(Self::Ready),
            "failed" => Ok(Self::Failed),
            _ => Err(SavedRegionCommandError::new(
                "region-database-corrupt",
                "A saved region contains an invalid status",
            )),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SavedRegionBlobState {
    Missing,
    Available,
    Failed,
}

impl SavedRegionBlobState {
    fn parse(value: &str) -> Result<Self, SavedRegionCommandError> {
        match value {
            "missing" => Ok(Self::Missing),
            "available" => Ok(Self::Available),
            "failed" => Ok(Self::Failed),
            _ => Err(SavedRegionCommandError::new(
                "region-database-corrupt",
                "A saved region contains an invalid blob state",
            )),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionBlobView {
    sha256: String,
    role: SavedRegionBlobRole,
    required: bool,
    ordinal: u32,
    expected_size: Option<u64>,
    actual_size: Option<u64>,
    media_type: Option<String>,
    state: SavedRegionBlobState,
    mirror_urls: Vec<String>,
    last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionView {
    version: u8,
    id: String,
    name: String,
    bbox: [f64; 4],
    source_pubkey: String,
    announcement_id: String,
    status: SavedRegionStatus,
    bytes_total: Option<u64>,
    bytes_done: u64,
    blobs_total: usize,
    blobs_done: usize,
    created_at: u64,
    updated_at: u64,
    last_error: Option<String>,
    blobs: Vec<SavedRegionBlobView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionProgress {
    region_id: String,
    status: SavedRegionStatus,
    bytes_total: Option<u64>,
    bytes_done: u64,
    blobs_total: usize,
    blobs_done: usize,
    current_hash: Option<String>,
    error_code: Option<String>,
    message: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionGarbageCollection {
    removed_blobs: usize,
    reclaimed_bytes: u64,
    retained_blobs: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionCommandError {
    code: String,
    message: String,
}

impl SavedRegionCommandError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl std::fmt::Display for SavedRegionCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for SavedRegionCommandError {}

impl From<rusqlite::Error> for SavedRegionCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("region-database-failed", error.to_string())
    }
}

impl From<serde_json::Error> for SavedRegionCommandError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("region-database-corrupt", error.to_string())
    }
}

fn configure_and_migrate(connection: &Connection) -> Result<(), SavedRegionCommandError> {
    connection.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         CREATE TABLE IF NOT EXISTS schema_migrations (
           version INTEGER PRIMARY KEY,
           applied_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS saved_regions (
           id TEXT PRIMARY KEY,
           name TEXT NOT NULL,
           bbox_json TEXT NOT NULL,
           source_pubkey TEXT NOT NULL,
           announcement_id TEXT NOT NULL,
           status TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           last_error TEXT
         );
         CREATE TABLE IF NOT EXISTS saved_region_blobs (
           region_id TEXT NOT NULL REFERENCES saved_regions(id) ON DELETE CASCADE,
           sha256 TEXT NOT NULL,
           role TEXT NOT NULL,
           required INTEGER NOT NULL,
           ordinal INTEGER NOT NULL,
           expected_size INTEGER,
           actual_size INTEGER,
           media_type TEXT,
           state TEXT NOT NULL,
           mirror_urls_json TEXT NOT NULL,
           last_error TEXT,
           PRIMARY KEY (region_id, sha256, role)
         );
         CREATE INDEX IF NOT EXISTS saved_region_status
           ON saved_regions(status, updated_at);
         CREATE INDEX IF NOT EXISTS saved_region_blob_hash
           ON saved_region_blobs(sha256);
         CREATE TABLE IF NOT EXISTS saved_region_managed_blobs (
           sha256 TEXT PRIMARY KEY,
           actual_size INTEGER NOT NULL,
           created_at INTEGER NOT NULL,
           last_error TEXT
         );",
    )?;
    let now = now_seconds();
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (2, ?1)",
        params![now],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (3, ?1)",
        params![now],
    )?;
    connection.execute(
        "UPDATE saved_regions
         SET status = 'planned', updated_at = ?1,
             last_error = 'Download interrupted; choose Resume to continue.'
         WHERE status = 'downloading'",
        params![now],
    )?;
    Ok(())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn validate_create(input: &SavedRegionCreateInput) -> Result<(), SavedRegionCommandError> {
    if input.version != PROTOCOL_VERSION {
        return Err(SavedRegionCommandError::new(
            "unsupported-region-version",
            format!(
                "Saved-region protocol version {} is not supported",
                input.version
            ),
        ));
    }
    if input.id.is_empty()
        || input.id.len() > 64
        || !input
            .id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(SavedRegionCommandError::new(
            "invalid-region-id",
            "Region id must contain only letters, numbers, hyphens, or underscores",
        ));
    }
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(SavedRegionCommandError::new(
            "invalid-region-name",
            "Region name must contain between 1 and 120 characters",
        ));
    }
    validate_bbox(input.bbox)?;
    PublicKey::parse(&input.source_pubkey).map_err(|_| {
        SavedRegionCommandError::new("invalid-region-source", "Invalid Mapnolia publisher key")
    })?;
    EventId::parse(&input.announcement_id).map_err(|_| {
        SavedRegionCommandError::new(
            "invalid-region-announcement",
            "Invalid Mapnolia announcement id",
        )
    })?;
    if input.blobs.is_empty() || input.blobs.len() > MAX_REGION_BLOBS {
        return Err(SavedRegionCommandError::new(
            "invalid-region-blobs",
            format!("Select between 1 and {MAX_REGION_BLOBS} region files"),
        ));
    }
    let mut hashes = BTreeSet::new();
    for blob in &input.blobs {
        if !is_sha256(&blob.sha256) || !hashes.insert((blob.sha256.clone(), blob.role.as_str())) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-blob",
                "Region files must have unique lowercase SHA-256 identities",
            ));
        }
        if blob.mirror_urls.is_empty() || blob.mirror_urls.len() > 8 {
            return Err(SavedRegionCommandError::new(
                "invalid-region-mirrors",
                "Each region file requires between 1 and 8 mirrors",
            ));
        }
        if blob.expected_size == Some(0) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-size",
                "Expected file size must be greater than zero",
            ));
        }
    }
    Ok(())
}

fn validate_bbox([west, south, east, north]: [f64; 4]) -> Result<(), SavedRegionCommandError> {
    if [west, south, east, north]
        .iter()
        .any(|value| !value.is_finite())
        || !(-180.0..=180.0).contains(&west)
        || !(-180.0..=180.0).contains(&east)
        || !(-90.0..=90.0).contains(&south)
        || !(-90.0..=90.0).contains(&north)
        || west > east
        || south > north
    {
        return Err(SavedRegionCommandError::new(
            "invalid-region-bbox",
            "Region bounds are invalid",
        ));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn create_region(
    connection: &mut Connection,
    input: SavedRegionCreateInput,
) -> Result<SavedRegionView, SavedRegionCommandError> {
    validate_create(&input)?;
    if connection
        .query_row(
            "SELECT 1 FROM saved_regions WHERE id = ?1",
            params![input.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(SavedRegionCommandError::new(
            "region-already-exists",
            "A saved region with this id already exists",
        ));
    }
    let now = now_seconds();
    let transaction = connection.transaction()?;
    transaction.execute(
        "INSERT INTO saved_regions(
           id, name, bbox_json, source_pubkey, announcement_id,
           status, created_at, updated_at, last_error
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'planned', ?6, ?6, NULL)",
        params![
            input.id,
            input.name.trim(),
            serde_json::to_string(&input.bbox)?,
            input.source_pubkey,
            input.announcement_id,
            now,
        ],
    )?;
    for blob in input.blobs {
        transaction.execute(
            "INSERT INTO saved_region_blobs(
               region_id, sha256, role, required, ordinal, expected_size,
               actual_size, media_type, state, mirror_urls_json, last_error
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, NULL, 'missing', ?7, NULL)",
            params![
                input.id,
                blob.sha256,
                blob.role.as_str(),
                blob.required,
                blob.ordinal,
                blob.expected_size,
                serde_json::to_string(&blob.mirror_urls)?,
            ],
        )?;
    }
    transaction.commit()?;
    load_region(connection, &input.id)?.ok_or_else(|| {
        SavedRegionCommandError::new("region-write-failed", "Saved region could not be reloaded")
    })
}

fn load_region(
    connection: &Connection,
    id: &str,
) -> Result<Option<SavedRegionView>, SavedRegionCommandError> {
    let row = connection
        .query_row(
            "SELECT id, name, bbox_json, source_pubkey, announcement_id,
                    status, created_at, updated_at, last_error
             FROM saved_regions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, u64>(6)?,
                    row.get::<_, u64>(7)?,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;
    let Some((
        id,
        name,
        bbox_json,
        source_pubkey,
        announcement_id,
        status,
        created_at,
        updated_at,
        last_error,
    )) = row
    else {
        return Ok(None);
    };
    let mut statement = connection.prepare(
        "SELECT sha256, role, required, ordinal, expected_size, actual_size,
                media_type, state, mirror_urls_json, last_error
         FROM saved_region_blobs WHERE region_id = ?1 ORDER BY ordinal, role, sha256",
    )?;
    let blobs = statement
        .query_map(params![id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, u32>(3)?,
                row.get::<_, Option<u64>>(4)?,
                row.get::<_, Option<u64>>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<String>>(9)?,
            ))
        })?
        .map(|row| {
            let (
                sha256,
                role,
                required,
                ordinal,
                expected_size,
                actual_size,
                media_type,
                state,
                mirror_urls_json,
                last_error,
            ) = row?;
            Ok(SavedRegionBlobView {
                sha256,
                role: SavedRegionBlobRole::parse(&role)?,
                required,
                ordinal,
                expected_size,
                actual_size,
                media_type,
                state: SavedRegionBlobState::parse(&state)?,
                mirror_urls: serde_json::from_str(&mirror_urls_json)?,
                last_error,
            })
        })
        .collect::<Result<Vec<_>, SavedRegionCommandError>>()?;
    let bytes_total = blobs
        .iter()
        .map(|blob| blob.expected_size)
        .collect::<Option<Vec<_>>>()
        .map(|sizes| sizes.into_iter().sum());
    let bytes_done = blobs
        .iter()
        .filter(|blob| blob.state == SavedRegionBlobState::Available)
        .filter_map(|blob| blob.actual_size.or(blob.expected_size))
        .sum();
    let blobs_done = blobs
        .iter()
        .filter(|blob| blob.state == SavedRegionBlobState::Available)
        .count();
    Ok(Some(SavedRegionView {
        version: PROTOCOL_VERSION,
        id,
        name,
        bbox: serde_json::from_str(&bbox_json)?,
        source_pubkey,
        announcement_id,
        status: SavedRegionStatus::parse(&status)?,
        bytes_total,
        bytes_done,
        blobs_total: blobs.len(),
        blobs_done,
        created_at,
        updated_at,
        last_error,
        blobs,
    }))
}

fn list_regions(connection: &Connection) -> Result<Vec<SavedRegionView>, SavedRegionCommandError> {
    let mut statement = connection
        .prepare("SELECT id FROM saved_regions ORDER BY updated_at DESC, created_at DESC, id")?;
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    ids.into_iter()
        .map(|id| {
            load_region(connection, &id)?.ok_or_else(|| {
                SavedRegionCommandError::new(
                    "region-database-corrupt",
                    "A saved region disappeared while it was loading",
                )
            })
        })
        .collect()
}

fn update_region_status(
    connection: &Connection,
    id: &str,
    status: SavedRegionStatus,
    last_error: Option<&str>,
) -> Result<(), SavedRegionCommandError> {
    let changed = connection.execute(
        "UPDATE saved_regions SET status = ?2, updated_at = ?3, last_error = ?4 WHERE id = ?1",
        params![id, status.as_str(), now_seconds(), last_error],
    )?;
    if changed == 0 {
        return Err(SavedRegionCommandError::new(
            "region-not-found",
            "The saved region does not exist",
        ));
    }
    Ok(())
}

fn mark_blob(
    connection: &Connection,
    region_id: &str,
    blob: &SavedRegionBlobView,
    descriptor: &BlobDescriptor,
) -> Result<(), SavedRegionCommandError> {
    if blob
        .expected_size
        .is_some_and(|expected| expected != descriptor.size)
    {
        let message = format!(
            "Announcement expected {} bytes, verified file contains {} bytes",
            blob.expected_size.unwrap_or_default(),
            descriptor.size
        );
        connection.execute(
            "UPDATE saved_region_blobs
             SET state = 'failed', actual_size = ?4, media_type = ?5, last_error = ?6
             WHERE region_id = ?1 AND sha256 = ?2 AND role = ?3",
            params![
                region_id,
                blob.sha256,
                blob.role.as_str(),
                descriptor.size,
                descriptor.media_type,
                message,
            ],
        )?;
        return Err(SavedRegionCommandError::new(
            "region-size-mismatch",
            message,
        ));
    }
    connection.execute(
        "UPDATE saved_region_blobs
         SET state = 'available', actual_size = ?4, media_type = ?5, last_error = NULL
         WHERE region_id = ?1 AND sha256 = ?2 AND role = ?3",
        params![
            region_id,
            blob.sha256,
            blob.role.as_str(),
            descriptor.size,
            descriptor.media_type,
        ],
    )?;
    Ok(())
}

fn record_managed_blob(
    connection: &Connection,
    descriptor: &BlobDescriptor,
) -> Result<(), SavedRegionCommandError> {
    connection.execute(
        "INSERT INTO saved_region_managed_blobs(sha256, actual_size, created_at, last_error)
         VALUES (?1, ?2, ?3, NULL)
         ON CONFLICT(sha256) DO UPDATE SET actual_size = excluded.actual_size, last_error = NULL",
        params![descriptor.sha256, descriptor.size, now_seconds()],
    )?;
    Ok(())
}

fn mark_hash_missing(
    connection: &mut Connection,
    hash: &str,
    message: &str,
) -> Result<(), SavedRegionCommandError> {
    let transaction = connection.transaction()?;
    transaction.execute(
        "UPDATE saved_region_blobs
         SET state = 'missing', actual_size = NULL, media_type = NULL, last_error = ?2
         WHERE sha256 = ?1",
        params![hash, message],
    )?;
    transaction.execute(
        "UPDATE saved_regions
         SET status = 'planned', updated_at = ?2, last_error = ?3
         WHERE id IN (SELECT DISTINCT region_id FROM saved_region_blobs WHERE sha256 = ?1)",
        params![hash, now_seconds(), message],
    )?;
    transaction.commit()?;
    Ok(())
}

fn remove_region_manifest(
    connection: &mut Connection,
    id: &str,
) -> Result<(bool, Vec<String>), SavedRegionCommandError> {
    let transaction = connection.transaction()?;
    let candidates = {
        let mut statement = transaction.prepare(
            "SELECT DISTINCT managed.sha256
             FROM saved_region_managed_blobs managed
             JOIN saved_region_blobs region_blob ON region_blob.sha256 = managed.sha256
             WHERE region_blob.region_id = ?1",
        )?;
        let rows = statement
            .query_map(params![id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    let removed = transaction.execute("DELETE FROM saved_regions WHERE id = ?1", params![id])? > 0;
    let mut orphaned = Vec::new();
    if removed {
        for hash in candidates {
            let references: u64 = transaction.query_row(
                "SELECT COUNT(*) FROM saved_region_blobs WHERE sha256 = ?1",
                params![hash],
                |row| row.get(0),
            )?;
            if references == 0 {
                orphaned.push(hash);
            }
        }
    }
    transaction.commit()?;
    Ok((removed, orphaned))
}

fn orphaned_managed_blobs(
    connection: &Connection,
) -> Result<Vec<(String, u64)>, SavedRegionCommandError> {
    let mut statement = connection.prepare(
        "SELECT managed.sha256, managed.actual_size
         FROM saved_region_managed_blobs managed
         WHERE NOT EXISTS (
           SELECT 1 FROM saved_region_blobs region_blob
           WHERE region_blob.sha256 = managed.sha256
         )
         ORDER BY managed.created_at, managed.sha256",
    )?;
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn forget_managed_blob(connection: &Connection, hash: &str) -> Result<(), SavedRegionCommandError> {
    connection.execute(
        "DELETE FROM saved_region_managed_blobs WHERE sha256 = ?1",
        params![hash],
    )?;
    Ok(())
}

fn progress(region: &SavedRegionView, current_hash: Option<String>) -> SavedRegionProgress {
    SavedRegionProgress {
        region_id: region.id.clone(),
        status: region.status,
        bytes_total: region.bytes_total,
        bytes_done: region.bytes_done,
        blobs_total: region.blobs_total,
        blobs_done: region.blobs_done,
        current_hash,
        error_code: None,
        message: region.last_error.clone(),
    }
}

fn download_error(error: PublicBlobDownloadError) -> SavedRegionCommandError {
    let message = error.to_string();
    match error {
        PublicBlobDownloadError::Authentication(_) => {
            SavedRegionCommandError::new("region-auth-required", message)
        }
        PublicBlobDownloadError::Payment => {
            SavedRegionCommandError::new("region-payment-required", message)
        }
        PublicBlobDownloadError::Cancelled => {
            SavedRegionCommandError::new("region-download-cancelled", message)
        }
        PublicBlobDownloadError::UnsafeUrl(_) => {
            SavedRegionCommandError::new("region-unsafe-mirror", message)
        }
        _ => SavedRegionCommandError::new("region-download-failed", message),
    }
}

async fn ensure_download_space(
    node: &earthly_local_node::LocalNode,
    region: &SavedRegionView,
) -> Result<(), SavedRegionCommandError> {
    let mut required_bytes = 0_u64;
    let mut checked = BTreeSet::new();
    for blob in &region.blobs {
        if !checked.insert(blob.sha256.clone()) {
            continue;
        }
        match node.local_blob_descriptor(&blob.sha256).await {
            Ok(Some(_)) => continue,
            Ok(None) => {
                required_bytes = required_bytes.saturating_add(blob.expected_size.unwrap_or(0));
            }
            Err(error) => {
                return Err(SavedRegionCommandError::new(
                    "region-storage-failed",
                    error.to_string(),
                ))
            }
        }
    }
    let storage = node.blob_storage_status().map_err(|error| {
        SavedRegionCommandError::new("region-storage-failed", error.to_string())
    })?;
    let reserve = (storage.total_bytes / 50)
        .clamp(MIN_FREE_SPACE_RESERVE_BYTES, MAX_FREE_SPACE_RESERVE_BYTES);
    if required_bytes > storage.available_bytes.saturating_sub(reserve) {
        return Err(SavedRegionCommandError::new(
            "region-insufficient-storage",
            format!(
                "This offline map needs about {required_bytes} more bytes, but the device must keep {reserve} bytes free"
            ),
        ));
    }
    Ok(())
}

async fn collect_orphaned_blobs(
    state: &SavedRegionState,
    node: &earthly_local_node::LocalNode,
) -> Result<SavedRegionGarbageCollection, SavedRegionCommandError> {
    let orphans = {
        let connection = state.connection()?;
        orphaned_managed_blobs(&connection)?
    };
    let protected = node
        .remote_nodes()
        .await
        .map_err(|error| SavedRegionCommandError::new("region-storage-failed", error.to_string()))?
        .into_iter()
        .flat_map(|remote| remote.mirrored_blob_hashes)
        .collect::<BTreeSet<_>>();
    let mut removed_blobs = 0;
    let mut reclaimed_bytes = 0_u64;
    let mut retained_blobs = 0;
    for (hash, size) in orphans {
        if protected.contains(&hash) {
            retained_blobs += 1;
            continue;
        }
        match node.remove_local_blob(&hash).await {
            Ok(removed) => {
                let connection = state.connection()?;
                forget_managed_blob(&connection, &hash)?;
                if removed {
                    removed_blobs += 1;
                    reclaimed_bytes = reclaimed_bytes.saturating_add(size);
                }
            }
            Err(error) => {
                retained_blobs += 1;
                let connection = state.connection()?;
                connection.execute(
                    "UPDATE saved_region_managed_blobs SET last_error = ?2 WHERE sha256 = ?1",
                    params![hash, error.to_string()],
                )?;
            }
        }
    }
    Ok(SavedRegionGarbageCollection {
        removed_blobs,
        reclaimed_bytes,
        retained_blobs,
    })
}

#[tauri::command]
pub async fn saved_region_create_v1(
    state: State<'_, SavedRegionState>,
    input: SavedRegionCreateInput,
) -> Result<SavedRegionView, SavedRegionCommandError> {
    let _maintenance = state.maintenance.read().await;
    let mut connection = state.connection()?;
    create_region(&mut connection, input)
}

#[tauri::command]
pub fn saved_region_list_v1(
    state: State<'_, SavedRegionState>,
) -> Result<Vec<SavedRegionView>, SavedRegionCommandError> {
    let connection = state.connection()?;
    list_regions(&connection)
}

#[tauri::command]
pub async fn saved_region_download_v1(
    app: AppHandle,
    state: State<'_, SavedRegionState>,
    node_state: State<'_, LocalNodeState>,
    id: String,
) -> Result<SavedRegionView, SavedRegionCommandError> {
    let _maintenance = state.maintenance.read().await;
    let cancellation = state.begin_download(&id)?;
    let result = async {
        let node = node_state.node().map_err(|error| {
            SavedRegionCommandError::new("region-node-unavailable", error.to_string())
        })?;
        let mut initial = {
            let connection = state.connection()?;
            load_region(&connection, &id)?
        }
        .ok_or_else(|| {
            SavedRegionCommandError::new("region-not-found", "The saved region does not exist")
        })?;
        ensure_download_space(&node, &initial).await?;
        {
            let connection = state.connection()?;
            update_region_status(&connection, &id, SavedRegionStatus::Downloading, None)?;
        }
        initial.status = SavedRegionStatus::Downloading;
        initial.last_error = None;
        let _ = app.emit(PROGRESS_EVENT, progress(&initial, None));

        for blob in initial.blobs {
            if cancellation.is_cancelled() {
                return Err(SavedRegionCommandError::new(
                    "region-download-cancelled",
                    "Region download was cancelled",
                ));
            }
            let (descriptor, managed) = match node.local_blob_descriptor(&blob.sha256).await {
                Ok(Some(descriptor)) => (descriptor, false),
                Ok(None) => {
                    let current = {
                        let connection = state.connection()?;
                        load_region(&connection, &id)?
                    }
                    .ok_or_else(|| {
                        SavedRegionCommandError::new(
                            "region-not-found",
                            "The saved region does not exist",
                        )
                    })?;
                    let _ = app.emit(
                        PROGRESS_EVENT,
                        progress(&current, Some(blob.sha256.clone())),
                    );
                    let progress_app = app.clone();
                    let progress_region_id = id.clone();
                    let progress_hash = blob.sha256.clone();
                    let completed_bytes = current.bytes_done;
                    let bytes_total = current.bytes_total;
                    let blobs_total = current.blobs_total;
                    let blobs_done = current.blobs_done;
                    let report_progress = move |downloaded_bytes: u64| {
                        let _ = progress_app.emit(
                            PROGRESS_EVENT,
                            SavedRegionProgress {
                                region_id: progress_region_id.clone(),
                                status: SavedRegionStatus::Downloading,
                                bytes_total,
                                bytes_done: completed_bytes.saturating_add(downloaded_bytes),
                                blobs_total,
                                blobs_done,
                                current_hash: Some(progress_hash.clone()),
                                error_code: None,
                                message: None,
                            },
                        );
                    };
                    let downloaded = node
                        .download_public_blob(
                            &blob.sha256,
                            blob.mirror_urls.clone(),
                            &cancellation,
                            Some(&report_progress),
                        )
                        .await
                        .map_err(download_error)?;
                    (downloaded.descriptor, downloaded.created)
                }
                Err(error) => {
                    return Err(SavedRegionCommandError::new(
                        "region-storage-failed",
                        error.to_string(),
                    ))
                }
            };
            {
                let connection = state.connection()?;
                if managed {
                    record_managed_blob(&connection, &descriptor)?;
                }
                mark_blob(&connection, &id, &blob, &descriptor)?;
            }
            let current = {
                let connection = state.connection()?;
                load_region(&connection, &id)?
            }
            .ok_or_else(|| {
                SavedRegionCommandError::new("region-not-found", "The saved region does not exist")
            })?;
            let _ = app.emit(PROGRESS_EVENT, progress(&current, None));
        }

        let connection = state.connection()?;
        update_region_status(&connection, &id, SavedRegionStatus::Ready, None)?;
        load_region(&connection, &id)?.ok_or_else(|| {
            SavedRegionCommandError::new("region-not-found", "The saved region does not exist")
        })
    }
    .await;

    let final_result = match result {
        Ok(region) => Ok(region),
        Err(error) => {
            if let Ok(connection) = state.connection() {
                let status = if error.code == "region-download-cancelled" {
                    SavedRegionStatus::Planned
                } else {
                    SavedRegionStatus::Failed
                };
                let _ = update_region_status(&connection, &id, status, Some(&error.message));
                if let Ok(Some(region)) = load_region(&connection, &id) {
                    let mut event = progress(&region, None);
                    event.error_code = Some(error.code.clone());
                    let _ = app.emit(PROGRESS_EVENT, event);
                }
            }
            Err(error)
        }
    };
    state.finish_download(&id);
    final_result
}

#[tauri::command]
pub async fn saved_region_repair_v1(
    state: State<'_, SavedRegionState>,
    node_state: State<'_, LocalNodeState>,
    id: String,
) -> Result<SavedRegionView, SavedRegionCommandError> {
    let _maintenance = state.maintenance.write().await;
    if state
        .downloads
        .lock()
        .map_err(|_| {
            SavedRegionCommandError::new(
                "region-download-unavailable",
                "The saved-region download lock is unavailable",
            )
        })?
        .contains_key(&id)
    {
        return Err(SavedRegionCommandError::new(
            "region-download-active",
            "Cancel the active download before repairing this region",
        ));
    }
    let node = node_state.node().map_err(|error| {
        SavedRegionCommandError::new("region-node-unavailable", error.to_string())
    })?;
    let initial = {
        let connection = state.connection()?;
        load_region(&connection, &id)?
    }
    .ok_or_else(|| {
        SavedRegionCommandError::new("region-not-found", "The saved region does not exist")
    })?;
    let mut missing = 0usize;
    for blob in &initial.blobs {
        match node
            .verify_local_blob(&blob.sha256)
            .await
            .map_err(|error| {
                SavedRegionCommandError::new("region-storage-failed", error.to_string())
            })? {
            LocalBlobIntegrity::Verified(descriptor) => {
                let connection = state.connection()?;
                if let Err(error) = mark_blob(&connection, &id, blob, &descriptor) {
                    update_region_status(
                        &connection,
                        &id,
                        SavedRegionStatus::Failed,
                        Some(&error.message),
                    )?;
                    return Err(error);
                }
            }
            LocalBlobIntegrity::Missing => {
                missing += 1;
                let mut connection = state.connection()?;
                mark_hash_missing(
                    &mut connection,
                    &blob.sha256,
                    "An offline map file is missing; choose Resume to restore it.",
                )?;
            }
            LocalBlobIntegrity::Corrupt { actual_sha256 } => {
                missing += 1;
                node.remove_local_blob(&blob.sha256)
                    .await
                    .map_err(|error| {
                        SavedRegionCommandError::new("region-storage-failed", error.to_string())
                    })?;
                let mut connection = state.connection()?;
                mark_hash_missing(
                    &mut connection,
                    &blob.sha256,
                    &format!(
                        "An offline map file failed verification ({actual_sha256}); choose Resume to restore it."
                    ),
                )?;
            }
        }
    }
    let connection = state.connection()?;
    update_region_status(
        &connection,
        &id,
        if missing == 0 {
            SavedRegionStatus::Ready
        } else {
            SavedRegionStatus::Planned
        },
        (missing > 0).then_some("Some offline map files need to be downloaded again."),
    )?;
    load_region(&connection, &id)?.ok_or_else(|| {
        SavedRegionCommandError::new("region-not-found", "The saved region does not exist")
    })
}

#[tauri::command]
pub fn saved_region_cancel_v1(
    state: State<'_, SavedRegionState>,
    id: String,
) -> Result<bool, SavedRegionCommandError> {
    state.cancel_download(&id)
}

#[tauri::command]
pub async fn saved_region_remove_v1(
    state: State<'_, SavedRegionState>,
    node_state: State<'_, LocalNodeState>,
    id: String,
) -> Result<bool, SavedRegionCommandError> {
    let _maintenance = state.maintenance.write().await;
    if state
        .downloads
        .lock()
        .map_err(|_| {
            SavedRegionCommandError::new(
                "region-download-unavailable",
                "The saved-region download lock is unavailable",
            )
        })?
        .contains_key(&id)
    {
        return Err(SavedRegionCommandError::new(
            "region-download-active",
            "Cancel the active download before removing this region",
        ));
    }
    let (removed, _orphaned) = {
        let mut connection = state.connection()?;
        remove_region_manifest(&mut connection, &id)?
    };
    if removed {
        let node = node_state.node().map_err(|error| {
            SavedRegionCommandError::new("region-node-unavailable", error.to_string())
        })?;
        let _ = collect_orphaned_blobs(&state, &node).await?;
    }
    Ok(removed)
}

#[tauri::command]
pub async fn saved_region_collect_garbage_v1(
    state: State<'_, SavedRegionState>,
    node_state: State<'_, LocalNodeState>,
) -> Result<SavedRegionGarbageCollection, SavedRegionCommandError> {
    let _maintenance = state.maintenance.write().await;
    let node = node_state.node().map_err(|error| {
        SavedRegionCommandError::new("region-node-unavailable", error.to_string())
    })?;
    collect_orphaned_blobs(&state, &node).await
}

#[cfg(test)]
mod tests {
    use tempfile::TempDir;

    use super::*;

    fn state() -> (TempDir, SavedRegionState) {
        let directory = TempDir::new().unwrap();
        let state = SavedRegionState::open(directory.path().join("earthly.sqlite3")).unwrap();
        (directory, state)
    }

    fn input(id: &str, hash: &str) -> SavedRegionCreateInput {
        SavedRegionCreateInput {
            version: 1,
            id: id.to_owned(),
            name: "Wachau hike".to_owned(),
            bbox: [15.0, 48.2, 15.6, 48.5],
            source_pubkey: "2".repeat(64),
            announcement_id: "3".repeat(64),
            blobs: vec![SavedRegionBlobInput {
                sha256: hash.to_owned(),
                role: SavedRegionBlobRole::Basemap,
                required: true,
                ordinal: 0,
                expected_size: Some(42),
                mirror_urls: vec![format!("https://maps.example/{hash}.pmtiles")],
            }],
        }
    }

    #[test]
    fn region_catalog_round_trips_and_removes_manifests() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let created = create_region(&mut connection, input("wachau", &"a".repeat(64))).unwrap();
        assert_eq!(created.status, SavedRegionStatus::Planned);
        assert_eq!(created.bytes_total, Some(42));
        assert_eq!(created.blobs.len(), 1);
        assert_eq!(list_regions(&connection).unwrap().len(), 1);
        assert_eq!(
            connection
                .execute("DELETE FROM saved_regions WHERE id = 'wachau'", [])
                .unwrap(),
            1
        );
        assert!(list_regions(&connection).unwrap().is_empty());
    }

    #[test]
    fn interrupted_download_is_resumable_after_reopen() {
        let (directory, state) = state();
        {
            let mut connection = state.connection().unwrap();
            create_region(&mut connection, input("restart", &"b".repeat(64))).unwrap();
            update_region_status(&connection, "restart", SavedRegionStatus::Downloading, None)
                .unwrap();
        }
        drop(state);

        let reopened = SavedRegionState::open(directory.path().join("earthly.sqlite3")).unwrap();
        let region = load_region(&reopened.connection().unwrap(), "restart")
            .unwrap()
            .unwrap();
        assert_eq!(region.status, SavedRegionStatus::Planned);
        assert!(region.last_error.unwrap().contains("interrupted"));
    }

    #[test]
    fn rejects_unbounded_or_untrusted_region_inputs() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let mut invalid = input("invalid", &"c".repeat(64));
        invalid.bbox = [200.0, 0.0, 201.0, 1.0];
        assert_eq!(
            create_region(&mut connection, invalid).unwrap_err().code,
            "invalid-region-bbox"
        );

        let mut duplicate = input("duplicate", &"d".repeat(64));
        duplicate.blobs.push(duplicate.blobs[0].clone());
        assert_eq!(
            create_region(&mut connection, duplicate).unwrap_err().code,
            "invalid-region-blob"
        );
    }

    #[test]
    fn managed_blob_is_collectable_only_after_its_last_region_reference() {
        let (_directory, state) = state();
        let hash = "e".repeat(64);
        let mut connection = state.connection().unwrap();
        create_region(&mut connection, input("north", &hash)).unwrap();
        create_region(&mut connection, input("south", &hash)).unwrap();
        record_managed_blob(
            &connection,
            &BlobDescriptor {
                url: format!("http://127.0.0.1/{hash}.pmtiles").parse().unwrap(),
                sha256: hash.clone(),
                size: 42,
                media_type: "application/vnd.pmtiles".to_owned(),
                uploaded: now_seconds(),
            },
        )
        .unwrap();

        let (removed, orphaned) = remove_region_manifest(&mut connection, "north").unwrap();
        assert!(removed);
        assert!(orphaned.is_empty());
        assert!(orphaned_managed_blobs(&connection).unwrap().is_empty());

        let (removed, orphaned) = remove_region_manifest(&mut connection, "south").unwrap();
        assert!(removed);
        assert_eq!(orphaned, vec![hash.clone()]);
        assert_eq!(
            orphaned_managed_blobs(&connection).unwrap(),
            vec![(hash, 42)]
        );
    }

    #[test]
    fn integrity_failure_invalidates_every_region_sharing_the_hash() {
        let (_directory, state) = state();
        let hash = "f".repeat(64);
        let mut connection = state.connection().unwrap();
        create_region(&mut connection, input("first", &hash)).unwrap();
        create_region(&mut connection, input("second", &hash)).unwrap();
        connection
            .execute(
                "UPDATE saved_region_blobs SET state = 'available', actual_size = 42",
                [],
            )
            .unwrap();
        connection
            .execute("UPDATE saved_regions SET status = 'ready'", [])
            .unwrap();

        mark_hash_missing(&mut connection, &hash, "integrity check failed").unwrap();

        for id in ["first", "second"] {
            let region = load_region(&connection, id).unwrap().unwrap();
            assert_eq!(region.status, SavedRegionStatus::Planned);
            assert_eq!(region.blobs[0].state, SavedRegionBlobState::Missing);
            assert_eq!(region.last_error.as_deref(), Some("integrity check failed"));
        }
    }
}
