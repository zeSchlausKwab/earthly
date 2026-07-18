use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use earthly_local_node::{BlobDescriptor, LocalBlobIntegrity, PublicBlobDownloadError};
use nostr::{Event, EventId, Kind, PublicKey};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio_util::sync::CancellationToken;

use crate::local_node::LocalNodeState;

const PROTOCOL_VERSION: u8 = 1;
const MAX_SAVED_REGIONS: usize = 16;
const MAX_REGION_BLOBS: usize = 2_048;
const MAX_REGION_EVENTS: usize = 4_096;
const MAX_REGION_EVENT_BYTES: usize = 16 * 1024 * 1024;
const MAX_RETAINED_REGION_EVENTS: usize = MAX_REGION_EVENTS * 2;
const MAX_RETAINED_REGION_EVENT_BYTES: usize = MAX_REGION_EVENT_BYTES * 2;
const MAX_REGION_EVENT_PAGE: usize = 128;
const MAX_REGION_CONTENT_BLOB_BYTES: u64 = 50 * 1024 * 1024;
const MAX_REGION_BASEMAP_BLOB_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const MAX_REGION_MIRRORS_PER_BLOB: usize = 8;
const MAX_REGION_MIRROR_URL_BYTES: usize = 2_048;
const MAX_REGION_MIRROR_URL_BYTES_TOTAL: usize = 4 * 1024 * 1024;
const MAX_DELETION_TARGET_POINTERS: usize = 4_096;
const MAX_RETAINED_DELETIONS_PER_CALL: usize = 128;
const MAX_DELETION_JOURNAL_EVENTS: usize = 4_096;
const MAX_DELETION_JOURNAL_BYTES: usize = 16 * 1024 * 1024;
const DELETION_JOURNAL_TTL_SECONDS: u64 = 5 * 60;
const COMPILED_MAPNOLIA_TRUSTED_PUBKEYS: &str = env!("EARTHLY_MAPNOLIA_TRUSTED_PUBKEYS");
const PROGRESS_EVENT: &str = "saved-region-progress-v1";
const MIN_FREE_SPACE_RESERVE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_FREE_SPACE_RESERVE_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug)]
pub struct SavedRegionState {
    connection: Mutex<Connection>,
    downloads: Mutex<HashMap<String, CancellationToken>>,
    maintenance: tokio::sync::RwLock<()>,
    trusted_mapnolia_pubkeys: BTreeSet<String>,
}

impl SavedRegionState {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, SavedRegionCommandError> {
        let trusted_mapnolia_pubkeys =
            parse_trusted_mapnolia_pubkeys(COMPILED_MAPNOLIA_TRUSTED_PUBKEYS)?;
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
            trusted_mapnolia_pubkeys,
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

    pub(crate) fn diagnostic_summary(
        &self,
    ) -> Result<SavedRegionDiagnosticSummary, SavedRegionCommandError> {
        let connection = self.connection()?;
        let (total, planned, downloading, ready, failed) = connection.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(status = 'planned'), 0),
                    COALESCE(SUM(status = 'downloading'), 0),
                    COALESCE(SUM(status = 'ready'), 0),
                    COALESCE(SUM(status = 'failed'), 0)
             FROM saved_regions",
            [],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                ))
            },
        )?;
        let (blob_references, unique_available_blobs) = connection.query_row(
            "SELECT COUNT(*),
                    COUNT(DISTINCT CASE WHEN state = 'available' THEN sha256 END)
             FROM saved_region_blobs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let (managed_blobs, managed_bytes) = connection.query_row(
            "SELECT COUNT(*), COALESCE(SUM(actual_size), 0)
             FROM saved_region_managed_blobs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        let orphaned_managed_blobs = orphaned_managed_blobs(&connection)?.len() as u64;
        drop(connection);
        let active_downloads = self
            .downloads
            .lock()
            .map_err(|_| {
                SavedRegionCommandError::new(
                    "region-download-unavailable",
                    "The saved-region download lock is unavailable",
                )
            })?
            .len() as u64;
        Ok(SavedRegionDiagnosticSummary {
            total,
            planned,
            downloading,
            ready,
            failed,
            active_downloads,
            blob_references,
            unique_available_blobs,
            managed_blobs,
            managed_bytes,
            orphaned_managed_blobs,
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
    layer_id: String,
    source_pubkey: String,
    announcement_id: String,
    blobs: Vec<SavedRegionBlobInput>,
    #[serde(default)]
    events: Vec<Event>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedRegionDeletionRetentionInput {
    version: u8,
    events: Vec<Event>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionDeletionRetention {
    retained_events: usize,
    region_attachments: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedMapLayerSet {
    version: u8,
    layers: Vec<SignedMapLayer>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedMapLayer {
    id: String,
    kind: String,
    #[serde(default)]
    blossom_servers: Vec<String>,
    #[serde(default)]
    blossom_server: Option<String>,
    #[serde(default)]
    announcement: BTreeMap<String, SignedMapChunk>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SignedMapChunk {
    bbox: [f64; 4],
    file: String,
    max_zoom: u8,
    size: Option<u64>,
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

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SavedRegionBlobRole {
    Basemap,
    Content,
    Overlay,
    Style,
    Sprite,
}

impl SavedRegionBlobRole {
    fn as_str(self) -> &'static str {
        match self {
            Self::Basemap => "basemap",
            Self::Content => "content",
            Self::Overlay => "overlay",
            Self::Style => "style",
            Self::Sprite => "sprite",
        }
    }

    fn parse(value: &str) -> Result<Self, SavedRegionCommandError> {
        match value {
            "basemap" => Ok(Self::Basemap),
            "content" => Ok(Self::Content),
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
    events_count: usize,
    created_at: u64,
    updated_at: u64,
    last_error: Option<String>,
    blobs: Vec<SavedRegionBlobView>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionEventHydration {
    region_id: String,
    expected_events: usize,
    cursor: usize,
    next_cursor: Option<usize>,
    events: Vec<Event>,
    missing_event_ids: Vec<String>,
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

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedRegionDiagnosticSummary {
    total: u64,
    planned: u64,
    downloading: u64,
    ready: u64,
    failed: u64,
    active_downloads: u64,
    blob_references: u64,
    unique_available_blobs: u64,
    managed_blobs: u64,
    managed_bytes: u64,
    orphaned_managed_blobs: u64,
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

fn parse_trusted_mapnolia_pubkeys(
    value: &str,
) -> Result<BTreeSet<String>, SavedRegionCommandError> {
    let mut trusted = BTreeSet::new();
    for candidate in value
        .split(',')
        .map(str::trim)
        .filter(|key| !key.is_empty())
    {
        if !is_sha256(candidate)
            || PublicKey::parse(candidate)
                .map(|key| key.to_hex() != candidate)
                .unwrap_or(true)
        {
            return Err(SavedRegionCommandError::new(
                "invalid-mapnolia-trust-config",
                "The native Mapnolia publisher allowlist is invalid",
            ));
        }
        trusted.insert(candidate.to_owned());
    }
    if trusted.is_empty() {
        return Err(SavedRegionCommandError::new(
            "invalid-mapnolia-trust-config",
            "The native Mapnolia publisher allowlist is empty",
        ));
    }
    Ok(trusted)
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
         );
         CREATE TABLE IF NOT EXISTS saved_region_event_objects (
           event_id TEXT PRIMARY KEY,
           event_json TEXT NOT NULL,
           kind INTEGER NOT NULL,
           author_pubkey TEXT NOT NULL,
           stored_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS saved_region_events (
           region_id TEXT NOT NULL REFERENCES saved_regions(id) ON DELETE CASCADE,
           event_id TEXT NOT NULL,
           kind INTEGER NOT NULL,
           author_pubkey TEXT NOT NULL,
           ordinal INTEGER NOT NULL,
           PRIMARY KEY (region_id, event_id)
         );
         CREATE INDEX IF NOT EXISTS saved_region_event_id
           ON saved_region_events(event_id);
         CREATE INDEX IF NOT EXISTS saved_region_event_region_order
           ON saved_region_events(region_id, ordinal);
         CREATE TABLE IF NOT EXISTS saved_region_deletion_journal (
           event_id TEXT PRIMARY KEY,
           event_json TEXT NOT NULL,
           author_pubkey TEXT NOT NULL,
           created_at INTEGER NOT NULL,
           stored_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS saved_region_deletion_journal_order
           ON saved_region_deletion_journal(created_at, event_id);",
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
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (4, ?1)",
        params![now],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (5, ?1)",
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

fn validate_create(
    input: &SavedRegionCreateInput,
    trusted_mapnolia_pubkeys: &BTreeSet<String>,
) -> Result<(), SavedRegionCommandError> {
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
    if input.layer_id.is_empty() || input.layer_id.len() > 128 {
        return Err(SavedRegionCommandError::new(
            "invalid-region-layer",
            "The saved map layer identity is invalid",
        ));
    }
    PublicKey::parse(&input.source_pubkey).map_err(|_| {
        SavedRegionCommandError::new("invalid-region-source", "Invalid Mapnolia publisher key")
    })?;
    if !trusted_mapnolia_pubkeys.contains(&input.source_pubkey) {
        return Err(SavedRegionCommandError::new(
            "untrusted-region-source",
            "The map announcement publisher is not trusted by this Earthly build",
        ));
    }
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
    validate_region_mirror_urls(&input.blobs, false)?;
    let mut hashes = BTreeSet::new();
    for blob in &input.blobs {
        if !is_sha256(&blob.sha256) || !hashes.insert((blob.sha256.clone(), blob.role.as_str())) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-blob",
                "Region files must have unique lowercase SHA-256 identities",
            ));
        }
        if blob.expected_size == Some(0) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-size",
                "Expected file size must be greater than zero",
            ));
        }
        if blob.role == SavedRegionBlobRole::Basemap
            && blob
                .expected_size
                .is_some_and(|size| size > MAX_REGION_BASEMAP_BLOB_BYTES)
        {
            return Err(SavedRegionCommandError::new(
                "region-basemap-too-large",
                "Offline basemap files are limited to 2 GiB each",
            ));
        }
        if blob.role == SavedRegionBlobRole::Content
            && blob
                .expected_size
                .is_some_and(|size| size > MAX_REGION_CONTENT_BLOB_BYTES)
        {
            return Err(SavedRegionCommandError::new(
                "region-content-too-large",
                "External GeoJSON files are limited to 50 MiB each",
            ));
        }
    }
    validate_region_events(input)?;
    validate_signed_blob_manifest(input)?;
    Ok(())
}

fn validate_region_mirror_urls(
    blobs: &[SavedRegionBlobInput],
    allow_test_loopback: bool,
) -> Result<(), SavedRegionCommandError> {
    let mut total_bytes = 0usize;
    for blob in blobs {
        if blob.mirror_urls.is_empty() || blob.mirror_urls.len() > MAX_REGION_MIRRORS_PER_BLOB {
            return Err(SavedRegionCommandError::new(
                "invalid-region-mirrors",
                format!(
                    "Each region file requires between 1 and {MAX_REGION_MIRRORS_PER_BLOB} mirrors"
                ),
            ));
        }
        for value in &blob.mirror_urls {
            let bytes = value.len();
            if bytes == 0 || bytes > MAX_REGION_MIRROR_URL_BYTES {
                return Err(SavedRegionCommandError::new(
                    "invalid-region-mirrors",
                    format!(
                        "Region mirror URLs must contain between 1 and {MAX_REGION_MIRROR_URL_BYTES} UTF-8 bytes"
                    ),
                ));
            }
            total_bytes = total_bytes.checked_add(bytes).ok_or_else(|| {
                SavedRegionCommandError::new(
                    "invalid-region-mirrors",
                    "Region mirror URLs exceed the safe aggregate size limit",
                )
            })?;
            if total_bytes > MAX_REGION_MIRROR_URL_BYTES_TOTAL {
                return Err(SavedRegionCommandError::new(
                    "invalid-region-mirrors",
                    "Region mirror URLs exceed the 4 MiB aggregate size limit",
                ));
            }

            if canonical_region_mirror_url(value, allow_test_loopback).is_none() {
                return Err(SavedRegionCommandError::new(
                    "invalid-region-mirrors",
                    "Region mirror URLs must be credential-free HTTPS URLs without query strings or fragments",
                ));
            }
        }
    }
    Ok(())
}

fn canonical_region_mirror_url(value: &str, allow_test_loopback: bool) -> Option<String> {
    if value.is_empty() || value.len() > MAX_REGION_MIRROR_URL_BYTES {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.host().is_none()
    {
        return None;
    }
    let loopback = match url.host() {
        Some(url::Host::Domain(host)) => {
            host.eq_ignore_ascii_case("localhost")
                || host.to_ascii_lowercase().ends_with(".localhost")
        }
        Some(url::Host::Ipv4(address)) => address.is_loopback(),
        Some(url::Host::Ipv6(address)) => address.is_loopback(),
        None => false,
    };
    let test_http = cfg!(test) && allow_test_loopback && loopback && url.scheme() == "http";
    (url.scheme() == "https" || test_http).then(|| url.to_string())
}

fn validate_region_events(input: &SavedRegionCreateInput) -> Result<(), SavedRegionCommandError> {
    if input.events.is_empty() || input.events.len() > MAX_REGION_EVENTS {
        return Err(SavedRegionCommandError::new(
            "invalid-region-events",
            format!("Save between 1 and {MAX_REGION_EVENTS} signed Earthly records"),
        ));
    }
    let mut ids = BTreeSet::new();
    let mut serialized_bytes = 0usize;
    let mut source_matches = 0usize;
    for event in &input.events {
        event.verify().map_err(|_| {
            SavedRegionCommandError::new(
                "invalid-region-event",
                "A saved-region record has an invalid id or signature",
            )
        })?;
        if !ids.insert(event.id) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-event",
                "Saved-region record ids must be unique",
            ));
        }
        let kind = event.kind.as_u16();
        if !matches!(
            kind,
            0 | 5 | 34_444 | 37_515 | 37_517 | 37_518 | 37_520 | 37_522
        ) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-event-kind",
                format!("Record kind {kind} is not retained by saved maps"),
            ));
        }
        if event
            .tags
            .iter()
            .any(|tag| tag.as_slice().first().is_some_and(|name| name == "h"))
        {
            return Err(SavedRegionCommandError::new(
                "private-region-event",
                "Field-session records cannot be pinned into an ordinary saved map",
            ));
        }
        serialized_bytes = serialized_bytes
            .checked_add(serde_json::to_vec(event)?.len())
            .ok_or_else(|| {
                SavedRegionCommandError::new(
                    "region-events-too-large",
                    "Saved-region records exceed the safe size limit",
                )
            })?;
        if serialized_bytes > MAX_REGION_EVENT_BYTES {
            return Err(SavedRegionCommandError::new(
                "region-events-too-large",
                format!(
                    "Saved-region records exceed the {} MiB limit",
                    MAX_REGION_EVENT_BYTES / (1024 * 1024)
                ),
            ));
        }
        if kind == 34_444
            && event.id.to_hex() == input.announcement_id
            && event.pubkey.to_hex() == input.source_pubkey
        {
            source_matches += 1;
        }
    }
    if source_matches != 1 {
        return Err(SavedRegionCommandError::new(
            "missing-region-announcement",
            "The signed map announcement must be retained with its saved region",
        ));
    }
    validate_region_deletions(&input.events)?;
    Ok(())
}

fn retained_event_coordinate(event: &Event) -> Option<String> {
    let kind = event.kind.as_u16();
    let identifier = if matches!(kind, 0 | 3) || (10_000..20_000).contains(&kind) {
        String::new()
    } else if (30_000..40_000).contains(&kind) {
        event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("d"))
                .then(|| values.get(1).cloned())
                .flatten()
        })?
    } else {
        return None;
    };
    Some(format!("{kind}:{}:{identifier}", event.pubkey.to_hex()))
}

fn validate_region_deletions(events: &[Event]) -> Result<(), SavedRegionCommandError> {
    let retained = events
        .iter()
        .filter(|event| event.kind.as_u16() != 5)
        .collect::<Vec<_>>();
    let by_id = retained
        .iter()
        .map(|event| (event.id.to_hex(), *event))
        .collect::<HashMap<_, _>>();
    let by_coordinate = retained
        .iter()
        .filter_map(|event| retained_event_coordinate(event).map(|coordinate| (coordinate, *event)))
        .collect::<HashMap<_, _>>();

    for deletion in events.iter().filter(|event| event.kind.as_u16() == 5) {
        if deletion_target_pointer_count(deletion) > MAX_DELETION_TARGET_POINTERS {
            return Err(SavedRegionCommandError::new(
                "region-deletion-too-large",
                format!(
                    "A retained deletion exceeds the {MAX_DELETION_TARGET_POINTERS} target-pointer limit"
                ),
            ));
        }
        let authorized = deletion.tags.iter().any(|tag| {
            let values = tag.as_slice();
            let target = match values.first().map(String::as_str) {
                Some("e") => values
                    .get(1)
                    .and_then(|event_id| by_id.get(event_id).copied()),
                Some("a") => values
                    .get(1)
                    .and_then(|coordinate| by_coordinate.get(coordinate).copied()),
                _ => None,
            };
            target.is_some_and(|target| {
                target.pubkey == deletion.pubkey && target.created_at <= deletion.created_at
            })
        });
        if !authorized {
            return Err(SavedRegionCommandError::new(
                "unbound-region-deletion",
                "A retained deletion does not target an included record by the same author",
            ));
        }
    }
    Ok(())
}

#[derive(Debug, Default)]
struct DeletionTargetPointers {
    event_ids: BTreeSet<String>,
    replaceable_kinds: BTreeSet<u16>,
    addressable_identifiers: BTreeSet<(u16, String)>,
    addresses: BTreeSet<String>,
}

impl DeletionTargetPointers {
    fn from_event(deletion: &Event) -> Self {
        let mut pointers = Self::default();
        let deletion_pubkey = deletion.pubkey.to_hex();
        for tag in deletion.tags.iter() {
            let values = tag.as_slice();
            match values.first().map(String::as_str) {
                Some("e") => {
                    if let Some(event_id) = values.get(1).filter(|value| is_sha256(value)) {
                        pointers.event_ids.insert(event_id.clone());
                    }
                }
                Some("a") => {
                    let Some(pointer) = values.get(1) else {
                        continue;
                    };
                    let mut parts = pointer.split(':');
                    let Some(kind_text) = parts.next() else {
                        continue;
                    };
                    let Some(pubkey) = parts.next() else {
                        continue;
                    };
                    let Ok(kind_number) = kind_text.parse::<u16>() else {
                        continue;
                    };
                    if kind_number.to_string() != kind_text || pubkey != deletion_pubkey {
                        continue;
                    }
                    let identifier = parts.collect::<Vec<_>>().join(":");
                    let kind = Kind::from(kind_number);
                    if kind.is_addressable() {
                        pointers
                            .addressable_identifiers
                            .insert((kind_number, identifier.clone()));
                    } else if kind.is_replaceable() {
                        pointers.replaceable_kinds.insert(kind_number);
                    } else {
                        continue;
                    }
                    pointers
                        .addresses
                        .insert(format!("{kind_number}:{pubkey}:{identifier}"));
                }
                _ => {}
            }
        }
        pointers
    }

    fn len(&self) -> usize {
        self.event_ids
            .len()
            .saturating_add(self.replaceable_kinds.len())
            .saturating_add(self.addressable_identifiers.len())
    }

    fn keys(&self, deletion: &Event) -> BTreeSet<String> {
        let pubkey = deletion.pubkey.to_hex();
        self.event_ids
            .iter()
            .map(|event_id| format!("e:{pubkey}:{event_id}"))
            .chain(self.addresses.iter().map(|address| format!("a:{address}")))
            .collect()
    }

    fn matching_keys(&self, deletion: &Event, target: &Event) -> BTreeSet<String> {
        if target.pubkey != deletion.pubkey || target.created_at > deletion.created_at {
            return BTreeSet::new();
        }
        let mut matches = BTreeSet::new();
        let event_id = target.id.to_hex();
        if self.event_ids.contains(&event_id) {
            matches.insert(format!("e:{}:{event_id}", deletion.pubkey.to_hex()));
        }
        if let Some(address) =
            retained_event_coordinate(target).filter(|address| self.addresses.contains(address))
        {
            matches.insert(format!("a:{address}"));
        }
        matches
    }
}

fn deletion_target_pointer_count(deletion: &Event) -> usize {
    DeletionTargetPointers::from_event(deletion).len()
}

fn validate_deletion_retention_input(
    input: &SavedRegionDeletionRetentionInput,
) -> Result<Vec<(Event, String, DeletionTargetPointers)>, SavedRegionCommandError> {
    if input.version != PROTOCOL_VERSION {
        return Err(SavedRegionCommandError::new(
            "unsupported-region-version",
            format!(
                "Saved-region protocol version {} is not supported",
                input.version
            ),
        ));
    }
    if input.events.is_empty() || input.events.len() > MAX_RETAINED_DELETIONS_PER_CALL {
        return Err(SavedRegionCommandError::new(
            "invalid-region-deletions",
            format!(
                "Retain between 1 and {MAX_RETAINED_DELETIONS_PER_CALL} deletion records at once"
            ),
        ));
    }
    let mut ids = BTreeSet::new();
    let mut total_bytes = 0usize;
    let mut validated = Vec::with_capacity(input.events.len());
    for event in &input.events {
        if event.kind.as_u16() != 5 || event.verify().is_err() || !ids.insert(event.id) {
            return Err(SavedRegionCommandError::new(
                "invalid-region-deletion",
                "Every retained deletion must be a unique signature-verified kind-5 record",
            ));
        }
        let event_json = serde_json::to_string(event)?;
        total_bytes = total_bytes.checked_add(event_json.len()).ok_or_else(|| {
            SavedRegionCommandError::new(
                "region-events-too-large",
                "Retained deletion records exceed the safe size limit",
            )
        })?;
        if total_bytes > MAX_REGION_EVENT_BYTES {
            return Err(SavedRegionCommandError::new(
                "region-events-too-large",
                format!(
                    "Retained deletion records exceed the {} MiB limit",
                    MAX_REGION_EVENT_BYTES / (1024 * 1024)
                ),
            ));
        }
        let pointers = DeletionTargetPointers::from_event(event);
        if pointers.len() == 0 {
            return Err(SavedRegionCommandError::new(
                "invalid-region-deletion-targets",
                "A retained deletion must contain at least one recognized e or a target pointer",
            ));
        }
        if pointers.len() > MAX_DELETION_TARGET_POINTERS {
            return Err(SavedRegionCommandError::new(
                "region-deletion-too-large",
                format!(
                    "A retained deletion exceeds the {MAX_DELETION_TARGET_POINTERS} target-pointer limit"
                ),
            ));
        }
        validated.push((event.clone(), event_json, pointers));
    }
    Ok(validated)
}

fn manifest_error(message: impl Into<String>) -> SavedRegionCommandError {
    SavedRegionCommandError::new("invalid-region-manifest", message)
}

fn announced_file_hash(file: &str) -> Option<String> {
    let hash = file.strip_suffix(".pmtiles").unwrap_or(file);
    is_sha256(hash).then(|| hash.to_owned())
}

fn bboxes_intersect(left: [f64; 4], right: [f64; 4]) -> bool {
    !(left[2] < right[0] || left[0] > right[2] || left[3] < right[1] || left[1] > right[3])
}

fn feature_blob_scope_is_valid(scope: &str) -> bool {
    if scope == "collection" {
        return true;
    }
    let Some(identifier) = scope.strip_prefix("feature:") else {
        return false;
    };
    !identifier.is_empty()
        && identifier
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

fn validate_signed_blob_manifest(
    input: &SavedRegionCreateInput,
) -> Result<(), SavedRegionCommandError> {
    let announcement = input
        .events
        .iter()
        .find(|event| {
            event.kind.as_u16() == 34_444
                && event.id.to_hex() == input.announcement_id
                && event.pubkey.to_hex() == input.source_pubkey
        })
        .ok_or_else(|| manifest_error("The signed map announcement is missing"))?;
    let layer_set: SignedMapLayerSet = serde_json::from_str(&announcement.content)
        .map_err(|_| manifest_error("The signed map announcement is malformed"))?;
    if layer_set.version != PROTOCOL_VERSION {
        return Err(manifest_error(
            "The signed map announcement version is unsupported",
        ));
    }
    if layer_set.layers.is_empty() || layer_set.layers.len() > 64 {
        return Err(manifest_error(
            "The signed map announcement has an invalid layer count",
        ));
    }
    let mut matching_layers = layer_set
        .layers
        .iter()
        .filter(|layer| layer.id == input.layer_id);
    let layer = matching_layers
        .next()
        .ok_or_else(|| manifest_error("The selected layer is not in the signed announcement"))?;
    if matching_layers.next().is_some()
        || layer.kind != "chunked-vector"
        || layer.announcement.is_empty()
        || layer.announcement.len() > 50_000
    {
        return Err(manifest_error(
            "The selected signed map layer is ambiguous or unsupported",
        ));
    }

    let signed_mirror_values = layer
        .blossom_servers
        .iter()
        .chain(layer.blossom_server.iter())
        .collect::<Vec<_>>();
    if signed_mirror_values.is_empty() || signed_mirror_values.len() > MAX_REGION_MIRRORS_PER_BLOB {
        return Err(manifest_error(
            "The signed map layer has an invalid mirror count",
        ));
    }
    let signed_mirror_bases = signed_mirror_values
        .into_iter()
        .map(|value| {
            canonical_region_mirror_url(value, false)
                .map(|url| url.trim_end_matches('/').to_owned())
                .ok_or_else(|| manifest_error("The signed map layer contains an unsafe mirror URL"))
        })
        .collect::<Result<BTreeSet<_>, _>>()?;

    let mut announced_basemap = BTreeMap::<String, (u64, BTreeSet<String>)>::new();
    for chunk in layer.announcement.values() {
        validate_bbox(chunk.bbox)
            .map_err(|_| manifest_error("The signed map announcement has invalid bounds"))?;
        if chunk.max_zoom > 24 {
            return Err(manifest_error(
                "A signed map chunk publishes an unsupported maximum zoom",
            ));
        }
        if !bboxes_intersect(input.bbox, chunk.bbox) {
            continue;
        }
        let hash = announced_file_hash(&chunk.file).ok_or_else(|| {
            manifest_error("A signed map chunk is not bound to a lowercase SHA-256 hash")
        })?;
        let signed_size = chunk.size.ok_or_else(|| {
            manifest_error("A signed map chunk does not publish its download size")
        })?;
        if signed_size == 0 || signed_size > MAX_REGION_BASEMAP_BLOB_BYTES {
            return Err(manifest_error(
                "A signed map chunk has an invalid or unsupported download size",
            ));
        }
        let signed_urls = signed_mirror_bases
            .iter()
            .map(|base| format!("{base}/{}", chunk.file))
            .map(|value| {
                canonical_region_mirror_url(&value, false).ok_or_else(|| {
                    manifest_error("A signed map chunk produces an invalid mirror URL")
                })
            })
            .collect::<Result<BTreeSet<_>, _>>()?;
        match announced_basemap.entry(hash) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert((signed_size, signed_urls));
            }
            std::collections::btree_map::Entry::Occupied(mut entry) => {
                if entry.get().0 != signed_size {
                    return Err(manifest_error(
                        "A signed map hash has conflicting file sizes",
                    ));
                }
                entry.get_mut().1.extend(signed_urls);
            }
        }
    }
    if announced_basemap.is_empty() {
        return Err(manifest_error(
            "The selected area has no chunks in the signed map announcement",
        ));
    }

    let basemap_blobs = input
        .blobs
        .iter()
        .filter(|blob| blob.role == SavedRegionBlobRole::Basemap)
        .collect::<Vec<_>>();
    if basemap_blobs.len() != announced_basemap.len() {
        return Err(manifest_error(
            "The native map manifest does not contain every signed chunk for this area",
        ));
    }
    for blob in basemap_blobs {
        let (signed_size, signed_urls) = announced_basemap.get(&blob.sha256).ok_or_else(|| {
            manifest_error("A requested map file is not in the signed announcement")
        })?;
        if !blob.required || blob.expected_size != Some(*signed_size) {
            return Err(manifest_error(
                "A requested map file does not match its signed size and requirement",
            ));
        }
        if blob.mirror_urls.iter().any(|value| {
            canonical_region_mirror_url(value, false)
                .is_none_or(|canonical| !signed_urls.contains(&canonical))
        }) {
            return Err(manifest_error(
                "A requested map mirror is not authorized by the signed announcement",
            ));
        }
    }

    let mut announced_content = BTreeMap::<String, (BTreeSet<u64>, BTreeSet<String>)>::new();
    for event in input
        .events
        .iter()
        .filter(|event| event.kind.as_u16() == 37_515)
    {
        for tag in event.tags.iter() {
            let values = tag.as_slice();
            if values.first().map(String::as_str) != Some("blob") {
                continue;
            }
            let scope = values.get(1).map(String::as_str).unwrap_or_default();
            let signed_url = values
                .get(2)
                .and_then(|value| canonical_region_mirror_url(value, false));
            if !feature_blob_scope_is_valid(scope) || signed_url.is_none() {
                return Err(manifest_error(
                    "A signed dataset contains a malformed external geometry reference",
                ));
            }
            let hashes = values
                .iter()
                .skip(3)
                .filter_map(|entry| entry.strip_prefix("sha256="))
                .collect::<Vec<_>>();
            if hashes.len() != 1 || !is_sha256(hashes[0]) {
                return Err(manifest_error(
                    "Every external geometry reference needs one lowercase SHA-256 hash",
                ));
            }
            let raw_sizes = values
                .iter()
                .skip(3)
                .filter_map(|entry| entry.strip_prefix("size="))
                .collect::<Vec<_>>();
            if raw_sizes.len() > 1
                || raw_sizes.first().is_some_and(|size| {
                    size.is_empty()
                        || size.starts_with('0')
                        || !size.bytes().all(|byte| byte.is_ascii_digit())
                })
            {
                return Err(manifest_error("An external geometry size is invalid"));
            }
            let sizes = raw_sizes
                .into_iter()
                .map(|size| size.parse::<u64>())
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| manifest_error("An external geometry size is invalid"))?;
            if sizes
                .first()
                .is_some_and(|size| *size == 0 || *size > MAX_REGION_CONTENT_BLOB_BYTES)
            {
                return Err(manifest_error(
                    "An external geometry size is invalid or above 50 MiB",
                ));
            }
            let entry = announced_content.entry(hashes[0].to_owned()).or_default();
            if let Some(size) = sizes.first() {
                entry.0.insert(*size);
            }
            entry
                .1
                .insert(signed_url.expect("signed URL was validated"));
        }
    }

    let content_blobs = input
        .blobs
        .iter()
        .filter(|blob| blob.role == SavedRegionBlobRole::Content)
        .collect::<Vec<_>>();
    if content_blobs.len() != announced_content.len() {
        return Err(manifest_error(
            "The native content manifest does not contain every signed geometry file",
        ));
    }
    for blob in content_blobs {
        let (signed_sizes, signed_urls) = announced_content.get(&blob.sha256).ok_or_else(|| {
            manifest_error("A requested content file is not referenced by a signed dataset")
        })?;
        if signed_sizes.len() > 1 {
            return Err(manifest_error(
                "Signed external geometry references disagree on their file size",
            ));
        }
        let signed_size = signed_sizes.first().copied();
        if !blob.required || blob.expected_size != signed_size {
            return Err(manifest_error(
                "A requested content file does not match its signed size and requirement",
            ));
        }
        if blob.mirror_urls.iter().any(|value| {
            canonical_region_mirror_url(value, false)
                .is_none_or(|canonical| !signed_urls.contains(&canonical))
        }) {
            return Err(manifest_error(
                "A requested content mirror is not authorized by its signed dataset reference",
            ));
        }
    }
    if input.blobs.iter().any(|blob| {
        !matches!(
            blob.role,
            SavedRegionBlobRole::Basemap | SavedRegionBlobRole::Content
        )
    }) {
        return Err(manifest_error(
            "This saved-region version only accepts signed basemap and content files",
        ));
    }
    let ordinals = input
        .blobs
        .iter()
        .map(|blob| blob.ordinal)
        .collect::<BTreeSet<_>>();
    if ordinals.len() != input.blobs.len()
        || ordinals.iter().copied().ne(0..input.blobs.len() as u32)
    {
        return Err(manifest_error(
            "Saved-region files must use one contiguous deterministic order",
        ));
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
    mut input: SavedRegionCreateInput,
    trusted_mapnolia_pubkeys: &BTreeSet<String>,
) -> Result<SavedRegionView, SavedRegionCommandError> {
    validate_create(&input, trusted_mapnolia_pubkeys)?;
    input.events.sort_by(|left, right| {
        let left_is_deletion = left.kind.as_u16() == 5;
        let right_is_deletion = right.kind.as_u16() == 5;
        right_is_deletion.cmp(&left_is_deletion).then_with(|| {
            if left_is_deletion && right_is_deletion {
                left.created_at
                    .cmp(&right.created_at)
                    .then_with(|| left.id.to_hex().cmp(&right.id.to_hex()))
            } else {
                std::cmp::Ordering::Equal
            }
        })
    });
    let now = now_seconds();
    let transaction = connection.transaction()?;
    compact_deletion_journal(&transaction, now, &BTreeSet::new())?;
    if transaction
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
    let region_count = transaction.query_row("SELECT COUNT(*) FROM saved_regions", [], |row| {
        row.get::<_, usize>(0)
    })?;
    if region_count >= MAX_SAVED_REGIONS {
        return Err(SavedRegionCommandError::new(
            "saved-region-limit-reached",
            format!(
                "Earthly can retain at most {MAX_SAVED_REGIONS} offline regions on this device"
            ),
        ));
    }
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
    for (ordinal, event) in input.events.into_iter().enumerate() {
        transaction.execute(
            "INSERT INTO saved_region_event_objects(
               event_id, event_json, kind, author_pubkey, stored_at
             ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(event_id) DO UPDATE SET
               event_json = excluded.event_json,
               kind = excluded.kind,
               author_pubkey = excluded.author_pubkey",
            params![
                event.id.to_hex(),
                serde_json::to_string(&event)?,
                event.kind.as_u16(),
                event.pubkey.to_hex(),
                now,
            ],
        )?;
        transaction.execute(
            "INSERT INTO saved_region_events(
               region_id, event_id, kind, author_pubkey, ordinal
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                input.id,
                event.id.to_hex(),
                event.kind.as_u16(),
                event.pubkey.to_hex(),
                ordinal,
            ],
        )?;
    }
    attach_journal_deletions_to_region(&transaction, &input.id)?;
    transaction.commit()?;
    load_region(connection, &input.id)?.ok_or_else(|| {
        SavedRegionCommandError::new("region-write-failed", "Saved region could not be reloaded")
    })
}

fn normalize_region_event_order(
    transaction: &rusqlite::Transaction<'_>,
    region_id: &str,
) -> Result<(), SavedRegionCommandError> {
    let mut statement = transaction.prepare(
        "SELECT manifest.event_id, manifest.kind, manifest.ordinal, objects.event_json
         FROM saved_region_events manifest
         LEFT JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
         WHERE manifest.region_id = ?1",
    )?;
    let mut rows = statement
        .query_map(params![region_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, u16>(1)?,
                row.get::<_, u32>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    rows.sort_by(
        |(left_id, left_kind, left_ordinal, left_json),
         (right_id, right_kind, right_ordinal, right_json)| {
            let left_deletion = *left_kind == 5;
            let right_deletion = *right_kind == 5;
            right_deletion.cmp(&left_deletion).then_with(|| {
                if left_deletion && right_deletion {
                    let left_created_at = left_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str::<Event>(value).ok())
                        .map(|event| event.created_at.as_secs())
                        .unwrap_or(u64::MAX);
                    let right_created_at = right_json
                        .as_deref()
                        .and_then(|value| serde_json::from_str::<Event>(value).ok())
                        .map(|event| event.created_at.as_secs())
                        .unwrap_or(u64::MAX);
                    left_created_at
                        .cmp(&right_created_at)
                        .then_with(|| left_id.cmp(right_id))
                } else {
                    left_ordinal
                        .cmp(right_ordinal)
                        .then_with(|| left_id.cmp(right_id))
                }
            })
        },
    );
    for (ordinal, (event_id, _, _, _)) in rows.into_iter().enumerate() {
        transaction.execute(
            "UPDATE saved_region_events SET ordinal = ?3
             WHERE region_id = ?1 AND event_id = ?2",
            params![region_id, event_id, ordinal],
        )?;
    }
    Ok(())
}

fn compact_deletion_journal(
    transaction: &rusqlite::Transaction<'_>,
    now: u64,
    protected_new_ids: &BTreeSet<String>,
) -> Result<(), SavedRegionCommandError> {
    let cutoff = now.saturating_sub(DELETION_JOURNAL_TTL_SECONDS);
    transaction.execute(
        "DELETE FROM saved_region_deletion_journal WHERE stored_at <= ?1",
        params![cutoff],
    )?;

    let mut statement = transaction.prepare(
        "SELECT event_id, event_json
         FROM saved_region_deletion_journal
         ORDER BY created_at DESC, event_id DESC",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let mut covered_keys = BTreeSet::new();
    for (event_id, event_json) in rows {
        // Rows enter this native-only table only after signature verification. Re-check the
        // bounded structure here without repeating thousands of secp256k1 operations per call.
        let parsed = serde_json::from_str::<Event>(&event_json).ok();
        let pointers = parsed.as_ref().map(DeletionTargetPointers::from_event);
        let valid = parsed.as_ref().is_some_and(|event| {
            event.id.to_hex() == event_id
                && event.kind.as_u16() == 5
                && pointers
                    .as_ref()
                    .is_some_and(|value| !value.event_ids.is_empty() || !value.addresses.is_empty())
                && pointers
                    .as_ref()
                    .is_some_and(|value| value.len() <= MAX_DELETION_TARGET_POINTERS)
        });
        if !valid {
            transaction.execute(
                "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![event_id],
            )?;
            continue;
        }
        let event = parsed.expect("validated journal event");
        let keys = pointers.expect("validated journal pointers").keys(&event);
        if keys.iter().all(|key| covered_keys.contains(key)) {
            transaction.execute(
                "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![event_id],
            )?;
        } else {
            covered_keys.extend(keys);
        }
    }

    let mut statement = transaction.prepare(
        "SELECT event_id, LENGTH(CAST(event_json AS BLOB))
         FROM saved_region_deletion_journal
         ORDER BY stored_at, created_at, event_id",
    )?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, usize>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut count = rows.len();
    let mut bytes = rows.iter().try_fold(0usize, |total, (_, size)| {
        total.checked_add(*size).ok_or_else(|| {
            SavedRegionCommandError::new(
                "region-deletion-journal-full",
                "The durable deletion journal exceeds its safe size limit",
            )
        })
    })?;
    for (event_id, size) in rows
        .into_iter()
        .filter(|(event_id, _)| !protected_new_ids.contains(event_id))
    {
        if count <= MAX_DELETION_JOURNAL_EVENTS && bytes <= MAX_DELETION_JOURNAL_BYTES {
            break;
        }
        transaction.execute(
            "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
            params![event_id],
        )?;
        count = count.saturating_sub(1);
        bytes = bytes.saturating_sub(size);
    }
    if count > MAX_DELETION_JOURNAL_EVENTS || bytes > MAX_DELETION_JOURNAL_BYTES {
        return Err(SavedRegionCommandError::new(
            "region-deletion-journal-full",
            "The current deletion batch exceeds the durable journal's safe size limits",
        ));
    }
    Ok(())
}

fn deletion_is_fully_attached(
    transaction: &rusqlite::Transaction<'_>,
    deletion: &Event,
    pointers: &DeletionTargetPointers,
) -> Result<bool, SavedRegionCommandError> {
    let mut statement = transaction.prepare(
        "SELECT manifest.region_id, objects.event_id, objects.event_json
         FROM saved_region_events manifest
         JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
         WHERE manifest.author_pubkey = ?1 AND manifest.kind != 5",
    )?;
    let rows = statement
        .query_map(params![deletion.pubkey.to_hex()], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    let mut matched_keys = BTreeSet::new();
    for (region_id, target_id, target_json) in rows {
        let Some(target) = serde_json::from_str::<Event>(&target_json)
            .ok()
            .filter(|event| event.id.to_hex() == target_id)
        else {
            continue;
        };
        let keys = pointers.matching_keys(deletion, &target);
        if keys.is_empty() {
            continue;
        }
        matched_keys.extend(keys);
        let attached = transaction
            .query_row(
                "SELECT 1 FROM saved_region_events WHERE region_id = ?1 AND event_id = ?2",
                params![region_id, deletion.id.to_hex()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !attached {
            return Ok(false);
        }
    }
    Ok(matched_keys == pointers.keys(deletion))
}

fn region_event_bytes(
    transaction: &rusqlite::Transaction<'_>,
    region_id: &str,
) -> Result<usize, SavedRegionCommandError> {
    Ok(transaction.query_row(
        "SELECT COALESCE(SUM(LENGTH(CAST(objects.event_json AS BLOB))), 0)
         FROM saved_region_events manifest
         JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
         WHERE manifest.region_id = ?1",
        params![region_id],
        |row| row.get::<_, usize>(0),
    )?)
}

fn attach_journal_deletions_to_region(
    transaction: &rusqlite::Transaction<'_>,
    region_id: &str,
) -> Result<usize, SavedRegionCommandError> {
    let mut target_statement = transaction.prepare(
        "SELECT objects.event_id, objects.event_json
         FROM saved_region_events manifest
         JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
         WHERE manifest.region_id = ?1 AND manifest.kind != 5",
    )?;
    let targets = target_statement
        .query_map(params![region_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .map(|row| {
            let (event_id, event_json) = row?;
            let event = serde_json::from_str::<Event>(&event_json).map_err(|_| {
                SavedRegionCommandError::new(
                    "region-database-corrupt",
                    "A saved-region event object cannot be decoded",
                )
            })?;
            if event.id.to_hex() != event_id || event.verify().is_err() {
                return Err(SavedRegionCommandError::new(
                    "region-database-corrupt",
                    "A saved-region event object failed verification",
                ));
            }
            Ok(event)
        })
        .collect::<Result<Vec<_>, SavedRegionCommandError>>()?;
    drop(target_statement);

    let mut journal_statement = transaction.prepare(
        "SELECT event_id, event_json FROM saved_region_deletion_journal
         ORDER BY created_at, event_id",
    )?;
    let journal = journal_statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    drop(journal_statement);

    let mut matches = Vec::<(Event, String, DeletionTargetPointers)>::new();
    for (event_id, event_json) in journal {
        let deletion = serde_json::from_str::<Event>(&event_json).map_err(|_| {
            SavedRegionCommandError::new(
                "region-database-corrupt",
                "A durable deletion journal record cannot be decoded",
            )
        })?;
        let pointers = DeletionTargetPointers::from_event(&deletion);
        if deletion.id.to_hex() != event_id
            || deletion.kind.as_u16() != 5
            || pointers.len() == 0
            || pointers.len() > MAX_DELETION_TARGET_POINTERS
        {
            return Err(SavedRegionCommandError::new(
                "region-database-corrupt",
                "A durable deletion journal record failed verification",
            ));
        }
        let already_attached = transaction
            .query_row(
                "SELECT 1 FROM saved_region_events WHERE region_id = ?1 AND event_id = ?2",
                params![region_id, event_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if already_attached {
            if deletion_is_fully_attached(transaction, &deletion, &pointers)? {
                transaction.execute(
                    "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![event_id],
                )?;
            }
            continue;
        }
        let matched_keys = targets
            .iter()
            .flat_map(|target| pointers.matching_keys(&deletion, target))
            .collect::<BTreeSet<_>>();
        if !matched_keys.is_empty() {
            matches.push((deletion, event_json, pointers));
        }
    }
    if matches.is_empty() {
        return Ok(0);
    }

    let current_count = transaction.query_row(
        "SELECT COUNT(*) FROM saved_region_events WHERE region_id = ?1",
        params![region_id],
        |row| row.get::<_, usize>(0),
    )?;
    let current_bytes = region_event_bytes(transaction, region_id)?;
    let added_bytes = matches
        .iter()
        .try_fold(0usize, |total, (_, event_json, _)| {
            total.checked_add(event_json.len()).ok_or_else(|| {
                SavedRegionCommandError::new(
                    "region-events-too-large",
                    "Durable deletion records exceed the reserved saved-region capacity",
                )
            })
        })?;
    if current_count
        .checked_add(matches.len())
        .is_none_or(|count| count > MAX_RETAINED_REGION_EVENTS)
        || current_bytes
            .checked_add(added_bytes)
            .is_none_or(|bytes| bytes > MAX_RETAINED_REGION_EVENT_BYTES)
    {
        return Err(SavedRegionCommandError::new(
            "region-events-too-large",
            "Durable deletion records exceed the reserved saved-region capacity",
        ));
    }

    let mut next_ordinal = transaction.query_row(
        "SELECT COALESCE(MAX(ordinal) + 1, 0) FROM saved_region_events WHERE region_id = ?1",
        params![region_id],
        |row| row.get::<_, u32>(0),
    )?;
    let now = now_seconds();
    for (deletion, event_json, pointers) in &matches {
        transaction.execute(
            "INSERT INTO saved_region_event_objects(
               event_id, event_json, kind, author_pubkey, stored_at
             ) VALUES (?1, ?2, 5, ?3, ?4)
             ON CONFLICT(event_id) DO UPDATE SET
               event_json = excluded.event_json,
               kind = excluded.kind,
               author_pubkey = excluded.author_pubkey",
            params![
                deletion.id.to_hex(),
                event_json,
                deletion.pubkey.to_hex(),
                now,
            ],
        )?;
        transaction.execute(
            "INSERT INTO saved_region_events(
               region_id, event_id, kind, author_pubkey, ordinal
             ) VALUES (?1, ?2, 5, ?3, ?4)",
            params![
                region_id,
                deletion.id.to_hex(),
                deletion.pubkey.to_hex(),
                next_ordinal,
            ],
        )?;
        next_ordinal = next_ordinal.saturating_add(1);
        if deletion_is_fully_attached(transaction, deletion, pointers)? {
            transaction.execute(
                "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![deletion.id.to_hex()],
            )?;
        }
    }
    normalize_region_event_order(transaction, region_id)?;
    Ok(matches.len())
}

fn retain_region_deletions(
    connection: &mut Connection,
    input: SavedRegionDeletionRetentionInput,
) -> Result<SavedRegionDeletionRetention, SavedRegionCommandError> {
    let deletions = validate_deletion_retention_input(&input)?;
    let transaction = connection.transaction()?;
    let now = now_seconds();
    compact_deletion_journal(&transaction, now, &BTreeSet::new())?;
    let mut preexisting_journal_indices = BTreeSet::new();
    for (index, (deletion, _, _)) in deletions.iter().enumerate() {
        let exists = transaction
            .query_row(
                "SELECT 1 FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![deletion.id.to_hex()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if exists {
            preexisting_journal_indices.insert(index);
        }
    }
    let mut pending = BTreeMap::<String, BTreeSet<usize>>::new();
    let mut matched_keys = vec![BTreeSet::<String>::new(); deletions.len()];

    for (index, (deletion, _, pointers)) in deletions.iter().enumerate() {
        let mut statement = transaction.prepare(
            "SELECT manifest.region_id, objects.event_id, objects.event_json
             FROM saved_region_events manifest
             JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
             WHERE manifest.author_pubkey = ?1 AND manifest.kind != 5",
        )?;
        let rows = statement
            .query_map(params![deletion.pubkey.to_hex()], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        for (region_id, target_id, target_json) in rows {
            let Some(target) = serde_json::from_str::<Event>(&target_json)
                .ok()
                .filter(|event| event.id.to_hex() == target_id)
            else {
                continue;
            };
            let keys = pointers.matching_keys(deletion, &target);
            if !keys.is_empty() {
                matched_keys[index].extend(keys);
                pending.entry(region_id).or_default().insert(index);
            }
        }
    }

    for (region_id, indices) in &mut pending {
        let mut new_indices = BTreeSet::new();
        for index in indices.iter().copied() {
            let exists = transaction
                .query_row(
                    "SELECT 1 FROM saved_region_events WHERE region_id = ?1 AND event_id = ?2",
                    params![region_id, deletions[index].0.id.to_hex()],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !exists {
                new_indices.insert(index);
            }
        }
        *indices = new_indices;
    }
    pending.retain(|_, indices| !indices.is_empty());

    for (region_id, indices) in &pending {
        let current_count = transaction.query_row(
            "SELECT COUNT(*) FROM saved_region_events WHERE region_id = ?1",
            params![region_id],
            |row| row.get::<_, usize>(0),
        )?;
        if current_count
            .checked_add(indices.len())
            .is_none_or(|count| count > MAX_RETAINED_REGION_EVENTS)
        {
            return Err(SavedRegionCommandError::new(
                "region-events-too-large",
                "A saved region has exhausted its reserved durable-deletion capacity",
            ));
        }
        let mut statement = transaction.prepare(
            "SELECT objects.event_json
             FROM saved_region_events manifest
             JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
             WHERE manifest.region_id = ?1",
        )?;
        let existing_json = statement
            .query_map(params![region_id], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(statement);
        let existing_bytes = existing_json.iter().try_fold(0usize, |total, value| {
            total.checked_add(value.len()).ok_or_else(|| {
                SavedRegionCommandError::new(
                    "region-events-too-large",
                    "Saved-region records exceed the safe size limit",
                )
            })
        })?;
        let retained_bytes = indices.iter().try_fold(0usize, |total, index| {
            total.checked_add(deletions[*index].1.len()).ok_or_else(|| {
                SavedRegionCommandError::new(
                    "region-events-too-large",
                    "Saved-region records exceed the safe size limit",
                )
            })
        })?;
        if existing_bytes
            .checked_add(retained_bytes)
            .is_none_or(|bytes| bytes > MAX_RETAINED_REGION_EVENT_BYTES)
        {
            return Err(SavedRegionCommandError::new(
                "region-events-too-large",
                "A saved region has exhausted its reserved durable-deletion byte capacity",
            ));
        }
    }

    let attached_indices = pending
        .values()
        .flat_map(|indices| indices.iter().copied())
        .collect::<BTreeSet<_>>();
    for index in &attached_indices {
        let (event, event_json, _) = &deletions[*index];
        transaction.execute(
            "INSERT INTO saved_region_event_objects(
               event_id, event_json, kind, author_pubkey, stored_at
             ) VALUES (?1, ?2, 5, ?3, ?4)
             ON CONFLICT(event_id) DO UPDATE SET
               event_json = excluded.event_json,
               kind = excluded.kind,
               author_pubkey = excluded.author_pubkey",
            params![event.id.to_hex(), event_json, event.pubkey.to_hex(), now],
        )?;
    }

    let mut region_attachments = 0usize;
    for (region_id, indices) in &pending {
        let mut next_ordinal = transaction.query_row(
            "SELECT COALESCE(MAX(ordinal) + 1, 0) FROM saved_region_events WHERE region_id = ?1",
            params![region_id],
            |row| row.get::<_, u32>(0),
        )?;
        for index in indices {
            let event = &deletions[*index].0;
            transaction.execute(
                "INSERT INTO saved_region_events(
                   region_id, event_id, kind, author_pubkey, ordinal
                 ) VALUES (?1, ?2, 5, ?3, ?4)",
                params![
                    region_id,
                    event.id.to_hex(),
                    event.pubkey.to_hex(),
                    next_ordinal
                ],
            )?;
            next_ordinal = next_ordinal.saturating_add(1);
            region_attachments = region_attachments.saturating_add(1);
        }
        normalize_region_event_order(&transaction, region_id)?;
        transaction.execute(
            "UPDATE saved_regions SET updated_at = ?2 WHERE id = ?1",
            params![region_id, now],
        )?;
    }

    let mut protected_new_ids = BTreeSet::new();
    for (index, (event, event_json, pointers)) in deletions.iter().enumerate() {
        if matched_keys[index] == pointers.keys(event) {
            transaction.execute(
                "DELETE FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![event.id.to_hex()],
            )?;
        } else {
            let inserted = transaction.execute(
                "INSERT OR IGNORE INTO saved_region_deletion_journal(
                   event_id, event_json, author_pubkey, created_at, stored_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    event.id.to_hex(),
                    event_json,
                    event.pubkey.to_hex(),
                    event.created_at.as_secs(),
                    now,
                ],
            )?;
            if inserted > 0 {
                protected_new_ids.insert(event.id.to_hex());
            }
        }
    }
    compact_deletion_journal(&transaction, now, &protected_new_ids)?;
    let mut retained_events = 0usize;
    for (index, (event, _, _)) in deletions.iter().enumerate() {
        if attached_indices.contains(&index) {
            retained_events = retained_events.saturating_add(1);
            continue;
        }
        if preexisting_journal_indices.contains(&index) {
            continue;
        }
        let retained_in_journal = transaction
            .query_row(
                "SELECT 1 FROM saved_region_deletion_journal WHERE event_id = ?1",
                params![event.id.to_hex()],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if retained_in_journal {
            retained_events = retained_events.saturating_add(1);
        }
    }
    transaction.commit()?;
    Ok(SavedRegionDeletionRetention {
        retained_events,
        region_attachments,
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
    let bytes_total = blobs.iter().try_fold(0_u64, |total, blob| {
        blob.expected_size.map(|size| total.saturating_add(size))
    });
    let bytes_done = blobs
        .iter()
        .filter(|blob| blob.state == SavedRegionBlobState::Available)
        .filter_map(|blob| blob.actual_size.or(blob.expected_size))
        .fold(0_u64, u64::saturating_add);
    let blobs_done = blobs
        .iter()
        .filter(|blob| blob.state == SavedRegionBlobState::Available)
        .count();
    let events_count = connection.query_row(
        "SELECT COUNT(*) FROM saved_region_events WHERE region_id = ?1",
        params![id],
        |row| row.get::<_, usize>(0),
    )?;
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
        events_count,
        created_at,
        updated_at,
        last_error,
        blobs,
    }))
}

fn load_region_event_hydration(
    connection: &Connection,
    id: &str,
    cursor: usize,
) -> Result<SavedRegionEventHydration, SavedRegionCommandError> {
    if connection
        .query_row(
            "SELECT 1 FROM saved_regions WHERE id = ?1",
            params![id],
            |_| Ok(()),
        )
        .optional()?
        .is_none()
    {
        return Err(SavedRegionCommandError::new(
            "region-not-found",
            "The saved region does not exist",
        ));
    }
    let expected_events = connection.query_row(
        "SELECT COUNT(*) FROM saved_region_events WHERE region_id = ?1",
        params![id],
        |row| row.get::<_, usize>(0),
    )?;
    if cursor > expected_events {
        return Err(SavedRegionCommandError::new(
            "invalid-region-event-cursor",
            "The saved-region event cursor exceeds its manifest",
        ));
    }
    let mut statement = connection.prepare(
        "SELECT manifest.event_id, objects.event_json
         FROM saved_region_events manifest
         LEFT JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
         WHERE manifest.region_id = ?1
         ORDER BY CASE WHEN manifest.kind = 5 THEN 0 ELSE 1 END,
                  manifest.ordinal, manifest.event_id
         LIMIT ?2 OFFSET ?3",
    )?;
    let rows = statement
        .query_map(params![id, MAX_REGION_EVENT_PAGE, cursor], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let consumed = rows.len();
    let mut events = Vec::with_capacity(consumed);
    let mut missing_event_ids = Vec::new();
    for (event_id, event_json) in rows {
        let event = event_json
            .as_deref()
            .and_then(|value| serde_json::from_str::<Event>(value).ok())
            .filter(|event| event.id.to_hex() == event_id && event.verify().is_ok());
        if let Some(event) = event {
            events.push(event);
        } else {
            missing_event_ids.push(event_id);
        }
    }
    Ok(SavedRegionEventHydration {
        region_id: id.to_owned(),
        expected_events,
        cursor,
        next_cursor: (cursor + consumed < expected_events).then_some(cursor + consumed),
        events,
        missing_event_ids,
    })
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
    if blob.role == SavedRegionBlobRole::Content && descriptor.size > MAX_REGION_CONTENT_BLOB_BYTES
    {
        let message = format!(
            "External GeoJSON file is {}, above the 50 MiB offline limit",
            format_storage_size(descriptor.size)
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
            "region-content-too-large",
            message,
        ));
    }
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
        transaction.execute(
            "DELETE FROM saved_region_event_objects
             WHERE NOT EXISTS (
               SELECT 1 FROM saved_region_events manifest
               WHERE manifest.event_id = saved_region_event_objects.event_id
             )",
            [],
        )?;
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
        PublicBlobDownloadError::ContentTooLarge { .. } => {
            SavedRegionCommandError::new("region-content-too-large", message)
        }
        PublicBlobDownloadError::Storage(_) => SavedRegionCommandError::new(
            "region-storage-write-failed",
            "Earthly could not finish writing the offline map. Free device storage or clean unused files, then choose Resume; verified files are kept.",
        ),
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
    let mut estimates = BTreeMap::<String, u64>::new();
    for blob in &region.blobs {
        let estimate = blob_download_space_estimate(blob);
        estimates
            .entry(blob.sha256.clone())
            .and_modify(|current| *current = (*current).max(estimate))
            .or_insert(estimate);
    }
    let mut required_bytes = 0_u64;
    for (sha256, estimate) in estimates {
        match node.local_blob_descriptor(&sha256).await {
            Ok(Some(_)) => continue,
            Ok(None) => {
                required_bytes = required_bytes.saturating_add(estimate);
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
    let reserve = download_space_reserve(storage.total_bytes);
    if !download_space_available(required_bytes, storage.available_bytes, reserve) {
        return Err(SavedRegionCommandError::new(
            "region-insufficient-storage",
            format!(
                "This offline map needs about {} more, while Earthly keeps {} free for Android. Clean unused files, free storage, or choose a smaller area.",
                format_storage_size(required_bytes),
                format_storage_size(reserve),
            ),
        ));
    }
    Ok(())
}

fn blob_download_space_estimate(blob: &SavedRegionBlobView) -> u64 {
    blob.expected_size.unwrap_or_else(|| {
        if blob.role == SavedRegionBlobRole::Content {
            MAX_REGION_CONTENT_BLOB_BYTES
        } else {
            0
        }
    })
}

async fn ensure_blob_download_space(
    node: &earthly_local_node::LocalNode,
    blob: &SavedRegionBlobView,
) -> Result<(), SavedRegionCommandError> {
    let required_bytes = blob_download_space_estimate(blob);
    let storage = node.blob_storage_status().map_err(|error| {
        SavedRegionCommandError::new("region-storage-failed", error.to_string())
    })?;
    let reserve = download_space_reserve(storage.total_bytes);
    if download_space_available(required_bytes, storage.available_bytes, reserve) {
        return Ok(());
    }
    Err(SavedRegionCommandError::new(
        "region-insufficient-storage",
        format!(
            "This offline file may need {}, while Earthly keeps {} free for Android. Free storage or choose a smaller area.",
            format_storage_size(required_bytes),
            format_storage_size(reserve),
        ),
    ))
}

fn download_space_reserve(total_bytes: u64) -> u64 {
    (total_bytes / 50).clamp(MIN_FREE_SPACE_RESERVE_BYTES, MAX_FREE_SPACE_RESERVE_BYTES)
}

fn download_space_available(required_bytes: u64, available_bytes: u64, reserve_bytes: u64) -> bool {
    required_bytes <= available_bytes.saturating_sub(reserve_bytes)
}

fn format_storage_size(bytes: u64) -> String {
    const MIB: u64 = 1024 * 1024;
    const GIB: u64 = 1024 * MIB;
    if bytes >= GIB {
        format!("{:.1} GiB", bytes as f64 / GIB as f64)
    } else {
        format!("{:.0} MiB", bytes as f64 / MIB as f64)
    }
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
    create_region(&mut connection, input, &state.trusted_mapnolia_pubkeys)
}

#[tauri::command]
pub fn saved_region_list_v1(
    state: State<'_, SavedRegionState>,
) -> Result<Vec<SavedRegionView>, SavedRegionCommandError> {
    let connection = state.connection()?;
    list_regions(&connection)
}

#[tauri::command]
pub fn saved_region_events_v1(
    state: State<'_, SavedRegionState>,
    id: String,
    cursor: Option<usize>,
) -> Result<SavedRegionEventHydration, SavedRegionCommandError> {
    let connection = state.connection()?;
    load_region_event_hydration(&connection, &id, cursor.unwrap_or(0))
}

#[tauri::command]
pub async fn saved_region_retain_deletions_v1(
    state: State<'_, SavedRegionState>,
    input: SavedRegionDeletionRetentionInput,
) -> Result<SavedRegionDeletionRetention, SavedRegionCommandError> {
    let _maintenance = state.maintenance.read().await;
    let mut connection = state.connection()?;
    retain_region_deletions(&mut connection, input)
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
            let existing = match node.verify_local_blob(&blob.sha256).await {
                Ok(LocalBlobIntegrity::Verified(descriptor)) => Some(descriptor),
                Ok(LocalBlobIntegrity::Missing) => None,
                Ok(LocalBlobIntegrity::Corrupt { actual_sha256 }) => {
                    node.remove_local_blob(&blob.sha256)
                        .await
                        .map_err(|error| {
                            SavedRegionCommandError::new(
                                "region-storage-failed",
                                error.to_string(),
                            )
                        })?;
                    let mut connection = state.connection()?;
                    mark_hash_missing(
                        &mut connection,
                        &blob.sha256,
                        &format!(
                            "An offline file failed verification ({actual_sha256}) and is being restored."
                        ),
                    )?;
                    update_region_status(
                        &connection,
                        &id,
                        SavedRegionStatus::Downloading,
                        None,
                    )?;
                    None
                }
                Err(error) => {
                    return Err(SavedRegionCommandError::new(
                        "region-storage-failed",
                        error.to_string(),
                    ))
                }
            };
            let (descriptor, managed) = match existing {
                Some(descriptor) => (descriptor, false),
                None => {
                    ensure_blob_download_space(&node, &blob).await?;
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
                    let downloaded = match blob.role {
                        SavedRegionBlobRole::Content => {
                            node.download_public_content_blob(
                                &blob.sha256,
                                blob.mirror_urls.clone(),
                                blob.expected_size,
                                &cancellation,
                                Some(&report_progress),
                            )
                            .await
                        }
                        _ => {
                            node.download_public_blob(
                                &blob.sha256,
                                blob.mirror_urls.clone(),
                                blob.expected_size,
                                &cancellation,
                                Some(&report_progress),
                            )
                            .await
                        }
                    }
                    .map_err(download_error)?;
                    (downloaded.descriptor, downloaded.created)
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
    use nostr::{EventBuilder, Keys, Kind};
    use tempfile::TempDir;

    use super::*;

    fn state() -> (TempDir, SavedRegionState) {
        let directory = TempDir::new().unwrap();
        let state = SavedRegionState::open(directory.path().join("earthly.sqlite3")).unwrap();
        (directory, state)
    }

    fn input(id: &str, hash: &str) -> SavedRegionCreateInput {
        input_with_announcement(id, hash, PROTOCOL_VERSION, 8)
    }

    fn input_with_announcement_version(
        id: &str,
        hash: &str,
        version: u8,
    ) -> SavedRegionCreateInput {
        input_with_announcement(id, hash, version, 8)
    }

    fn input_with_announcement(
        id: &str,
        hash: &str,
        version: u8,
        max_zoom: u8,
    ) -> SavedRegionCreateInput {
        input_with_announcement_details(id, hash, version, max_zoom, 42)
    }

    fn input_with_announcement_details(
        id: &str,
        hash: &str,
        version: u8,
        max_zoom: u8,
        size: u64,
    ) -> SavedRegionCreateInput {
        let keys = Keys::generate();
        let announcement_content = serde_json::json!({
            "version": version,
            "layers": [{
                "id": "world",
                "title": "World",
                "kind": "chunked-vector",
                "blossomServers": ["https://maps.example"],
                "announcement": {
                    "u": {
                        "bbox": [0.0, 40.0, 30.0, 60.0],
                        "file": format!("{hash}.pmtiles"),
                        "maxZoom": max_zoom,
                        "size": size
                    }
                }
            }]
        })
        .to_string();
        let announcement = EventBuilder::new(Kind::Custom(34_444), announcement_content)
            .sign_with_keys(&keys)
            .unwrap();
        SavedRegionCreateInput {
            version: 1,
            id: id.to_owned(),
            name: "Wachau hike".to_owned(),
            bbox: [15.0, 48.2, 15.6, 48.5],
            layer_id: "world".to_owned(),
            source_pubkey: announcement.pubkey.to_hex(),
            announcement_id: announcement.id.to_hex(),
            blobs: vec![SavedRegionBlobInput {
                sha256: hash.to_owned(),
                role: SavedRegionBlobRole::Basemap,
                required: true,
                ordinal: 0,
                expected_size: Some(size),
                mirror_urls: vec![format!("https://maps.example/{hash}.pmtiles")],
            }],
            events: vec![announcement],
        }
    }

    #[test]
    fn native_boundary_rejects_an_unsupported_signed_map_layer_version() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let region_input = input_with_announcement_version(
            "unsupported-map-version",
            &"0".repeat(64),
            PROTOCOL_VERSION + 1,
        );

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );
    }

    #[test]
    fn region_event_byte_accounting_uses_serialized_utf8_size() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let note = EventBuilder::new(
            Kind::Custom(37_515),
            serde_json::json!({ "label": "é".repeat(64) }).to_string(),
        )
        .tags([nostr::Tag::parse(["d", "utf8-region-event"]).unwrap()])
        .sign_with_keys(&Keys::generate())
        .unwrap();
        let mut region_input = input("utf8-region-accounting", &"a".repeat(64));
        region_input.events.push(note);
        let serialized = region_input
            .events
            .iter()
            .map(|event| serde_json::to_string(event).unwrap())
            .collect::<Vec<_>>();
        let expected_bytes = serialized.iter().map(String::len).sum::<usize>();
        let expected_characters = serialized
            .iter()
            .map(|event_json| event_json.chars().count())
            .sum::<usize>();
        create_region(&mut connection, region_input).unwrap();

        let transaction = connection.transaction().unwrap();
        assert_eq!(
            region_event_bytes(&transaction, "utf8-region-accounting").unwrap(),
            expected_bytes
        );
        let sqlite_characters = transaction
            .query_row(
                "SELECT COALESCE(SUM(LENGTH(objects.event_json)), 0)
                 FROM saved_region_events manifest
                 JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
                 WHERE manifest.region_id = 'utf8-region-accounting'",
                [],
                |row| row.get::<_, usize>(0),
            )
            .unwrap();
        assert_eq!(sqlite_characters, expected_characters);
        assert!(sqlite_characters < expected_bytes);
    }

    #[test]
    fn native_boundary_rejects_an_unsupported_chunk_zoom_even_outside_the_saved_area() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let mut region_input = input_with_announcement(
            "unsupported-map-zoom",
            &"1".repeat(64),
            PROTOCOL_VERSION,
            25,
        );
        region_input.bbox = [-120.0, -40.0, -110.0, -30.0];

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );
    }

    #[test]
    fn native_boundary_rejects_a_signed_basemap_above_the_per_file_limit() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let region_input = input_with_announcement_details(
            "oversized-map-chunk",
            &"2".repeat(64),
            PROTOCOL_VERSION,
            8,
            MAX_REGION_BASEMAP_BLOB_BYTES + 1,
        );

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "region-basemap-too-large"
        );
    }

    #[test]
    fn native_boundary_requires_basemap_mirrors_from_the_signed_layer() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let mut region_input = input("unsigned-map-mirror", &"3".repeat(64));
        region_input.blobs[0].mirror_urls = vec![format!(
            "https://unsigned.example/{}.pmtiles",
            "3".repeat(64)
        )];

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );
    }

    fn create_region(
        connection: &mut Connection,
        input: SavedRegionCreateInput,
    ) -> Result<SavedRegionView, SavedRegionCommandError> {
        let trusted = BTreeSet::from([input.source_pubkey.clone()]);
        super::create_region(connection, input, &trusted)
    }

    #[test]
    fn native_mapnolia_allowlist_is_strict_and_canonical() {
        let first = Keys::generate().public_key().to_hex();
        let second = Keys::generate().public_key().to_hex();
        let parsed =
            parse_trusted_mapnolia_pubkeys(&format!(" {first}, {second}, {first} ")).unwrap();
        assert_eq!(parsed, BTreeSet::from([first.clone(), second]));

        for invalid in ["", "not-a-pubkey", &first.to_uppercase()] {
            assert_eq!(
                parse_trusted_mapnolia_pubkeys(invalid).unwrap_err().code,
                "invalid-mapnolia-trust-config"
            );
        }
    }

    #[test]
    fn native_boundary_rejects_an_untrusted_mapnolia_publisher() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let region_input = input("untrusted-map", &"0".repeat(64));
        let different_publisher = Keys::generate().public_key().to_hex();

        let error = super::create_region(
            &mut connection,
            region_input,
            &BTreeSet::from([different_publisher]),
        )
        .unwrap_err();

        assert_eq!(error.code, "untrusted-region-source");
        assert!(list_regions(&connection).unwrap().is_empty());
    }

    #[test]
    fn native_boundary_bounds_and_secures_saved_region_mirror_urls() {
        let mut region_input = input("mirror-bounds", &"0".repeat(64));
        region_input.blobs[0].mirror_urls = vec![format!(
            "https://maps.example/{}",
            "a".repeat(MAX_REGION_MIRROR_URL_BYTES)
        )];
        assert_eq!(
            validate_region_mirror_urls(&region_input.blobs, false)
                .unwrap_err()
                .code,
            "invalid-region-mirrors"
        );

        region_input.blobs[0].mirror_urls = vec!["http://maps.example/map.pmtiles".to_owned()];
        assert_eq!(
            validate_region_mirror_urls(&region_input.blobs, false)
                .unwrap_err()
                .code,
            "invalid-region-mirrors"
        );

        region_input.blobs[0].mirror_urls = vec!["http://127.0.0.1/map.pmtiles".to_owned()];
        assert!(validate_region_mirror_urls(&region_input.blobs, true).is_ok());
        assert!(validate_region_mirror_urls(&region_input.blobs, false).is_err());

        let prefix = "https://maps.example/";
        let maximum_url = format!(
            "{prefix}{}",
            "a".repeat(MAX_REGION_MIRROR_URL_BYTES - prefix.len())
        );
        let mut aggregate = Vec::new();
        for ordinal in 0..257 {
            aggregate.push(SavedRegionBlobInput {
                sha256: format!("{ordinal:064x}"),
                role: SavedRegionBlobRole::Basemap,
                required: true,
                ordinal,
                expected_size: Some(1),
                mirror_urls: vec![maximum_url.clone(); MAX_REGION_MIRRORS_PER_BLOB],
            });
        }
        assert_eq!(
            validate_region_mirror_urls(&aggregate, false)
                .unwrap_err()
                .code,
            "invalid-region-mirrors"
        );
    }

    #[test]
    fn native_boundary_caps_saved_region_count_transactionally() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        for index in 0..MAX_SAVED_REGIONS {
            create_region(
                &mut connection,
                input(&format!("bounded-{index}"), &format!("{index:064x}")),
            )
            .unwrap();
        }

        assert_eq!(
            create_region(
                &mut connection,
                input("bounded-0", &format!("{:064x}", MAX_SAVED_REGIONS + 1)),
            )
            .unwrap_err()
            .code,
            "region-already-exists"
        );
        assert_eq!(
            create_region(
                &mut connection,
                input("bounded-overflow", &format!("{:064x}", MAX_SAVED_REGIONS)),
            )
            .unwrap_err()
            .code,
            "saved-region-limit-reached"
        );

        assert!(
            remove_region_manifest(&mut connection, "bounded-0")
                .unwrap()
                .0
        );
        create_region(
            &mut connection,
            input(
                "bounded-replacement",
                &format!("{:064x}", MAX_SAVED_REGIONS),
            ),
        )
        .unwrap();
        assert_eq!(list_regions(&connection).unwrap().len(), MAX_SAVED_REGIONS);
    }

    #[test]
    fn native_boundary_requires_content_mirrors_from_signed_dataset_tags() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let content_hash = "4".repeat(64);
        let mut region_input = input("unsigned-content-mirror", &"5".repeat(64));
        region_input.blobs.push(SavedRegionBlobInput {
            sha256: content_hash.clone(),
            role: SavedRegionBlobRole::Content,
            required: true,
            ordinal: 1,
            expected_size: Some(10),
            mirror_urls: vec!["https://unsigned.example/dataset.geojson".to_owned()],
        });
        region_input.events.push(
            EventBuilder::new(
                Kind::Custom(37_515),
                "{\"type\":\"FeatureCollection\",\"features\":[]}",
            )
            .tags([
                nostr::Tag::parse(["d", "signed-content-mirror"]).unwrap(),
                nostr::Tag::parse([
                    "blob".to_owned(),
                    "collection".to_owned(),
                    "https://signed.example/dataset.geojson".to_owned(),
                    format!("sha256={content_hash}"),
                    "size=10".to_owned(),
                ])
                .unwrap(),
            ])
            .sign_with_keys(&Keys::generate())
            .unwrap(),
        );

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );
    }

    #[test]
    fn region_catalog_round_trips_and_removes_manifests() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let mut region_input = input("wachau", &"a".repeat(64));
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .sign_with_keys(&Keys::generate())
        .unwrap();
        let expected_event_ids = vec![region_input.events[0].id, dataset.id];
        region_input.events.push(dataset);
        let created = create_region(&mut connection, region_input).unwrap();
        assert_eq!(created.status, SavedRegionStatus::Planned);
        assert_eq!(created.bytes_total, Some(42));
        assert_eq!(created.blobs.len(), 1);
        assert_eq!(created.events_count, 2);
        assert_eq!(
            load_region_event_hydration(&connection, "wachau", 0)
                .unwrap()
                .events
                .iter()
                .map(|event| event.id)
                .collect::<Vec<_>>(),
            expected_event_ids,
        );
        assert_eq!(list_regions(&connection).unwrap().len(), 1);
        assert!(remove_region_manifest(&mut connection, "wachau").unwrap().0);
        assert!(list_regions(&connection).unwrap().is_empty());
        assert_eq!(
            connection
                .query_row("SELECT COUNT(*) FROM saved_region_events", [], |row| {
                    row.get::<_, usize>(0)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_event_objects",
                    [],
                    |row| { row.get::<_, usize>(0) }
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn immutable_region_events_survive_newer_replaceable_versions() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let first = EventBuilder::new(Kind::Custom(37_515), "{\"version\":1}")
            .tags([nostr::Tag::parse(["d", "trail"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_000))
            .sign_with_keys(&author)
            .unwrap();
        let second = EventBuilder::new(Kind::Custom(37_515), "{\"version\":2}")
            .tags([nostr::Tag::parse(["d", "trail"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();

        let mut first_region = input("first-version", &"3".repeat(64));
        first_region.events.push(first.clone());
        create_region(&mut connection, first_region).unwrap();
        let mut second_region = input("second-version", &"4".repeat(64));
        second_region.events.push(second.clone());
        create_region(&mut connection, second_region).unwrap();

        let first_hydration = load_region_event_hydration(&connection, "first-version", 0).unwrap();
        assert!(first_hydration.events.contains(&first));
        assert!(!first_hydration.events.contains(&second));
        assert!(first_hydration.missing_event_ids.is_empty());
    }

    #[test]
    fn retained_deletions_are_authorized_and_persisted_before_their_targets() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .tags([nostr::Tag::parse(["d", "deleted-trail"]).unwrap()])
        .sign_with_keys(&author)
        .unwrap();
        let deletion = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .sign_with_keys(&author)
            .unwrap();
        let mut region_input = input("with-deletion", &"7".repeat(64));
        region_input
            .events
            .extend([dataset.clone(), deletion.clone()]);
        create_region(&mut connection, region_input).unwrap();

        let hydration = load_region_event_hydration(&connection, "with-deletion", 0).unwrap();
        assert_eq!(hydration.events[0].id, deletion.id);
        assert!(hydration.events.contains(&dataset));

        let attacker = Keys::generate();
        let forged_deletion = EventBuilder::new(Kind::Custom(5), "not authorized")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .sign_with_keys(&attacker)
            .unwrap();
        let mut invalid = input("unbound-deletion", &"8".repeat(64));
        invalid.events.extend([dataset, forged_deletion]);
        assert_eq!(
            create_region(&mut connection, invalid).unwrap_err().code,
            "unbound-region-deletion"
        );
    }

    #[test]
    fn retained_deletions_reject_more_than_the_hydration_pointer_budget() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .tags([nostr::Tag::parse(["d", "bounded-deletion"]).unwrap()])
        .sign_with_keys(&author)
        .unwrap();
        let mut tags = vec![nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()];
        for index in 0..MAX_DELETION_TARGET_POINTERS {
            tags.push(nostr::Tag::parse(["e".to_owned(), format!("{index:064x}")]).unwrap());
        }
        let deletion = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags(tags)
            .sign_with_keys(&author)
            .unwrap();
        let mut region_input = input("bounded-deletion", &"9".repeat(64));
        region_input.events.extend([dataset, deletion]);

        assert_eq!(
            create_region(&mut connection, region_input)
                .unwrap_err()
                .code,
            "region-deletion-too-large"
        );
    }

    #[test]
    fn retained_deletions_reject_zero_recognized_target_pointers() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let deletion = EventBuilder::new(Kind::Custom(5), "no target")
            .sign_with_keys(&Keys::generate())
            .unwrap();

        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![deletion],
                },
            )
            .unwrap_err()
            .code,
            "invalid-region-deletion-targets"
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn later_live_deletions_attach_to_every_matching_region_and_hydrate_first() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .tags([nostr::Tag::parse(["d", "later-deleted-trail"]).unwrap()])
        .custom_created_at(nostr::Timestamp::from(1_900_000_000))
        .sign_with_keys(&author)
        .unwrap();
        for (region_id, hash) in [
            ("later-deletion-first", "b".repeat(64)),
            ("later-deletion-second", "c".repeat(64)),
        ] {
            let mut region_input = input(region_id, &hash);
            region_input.events.push(dataset.clone());
            create_region(&mut connection, region_input).unwrap();
        }
        let newer = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_002))
            .sign_with_keys(&author)
            .unwrap();
        let older = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();

        for deletion in [&newer, &older] {
            assert_eq!(
                retain_region_deletions(
                    &mut connection,
                    SavedRegionDeletionRetentionInput {
                        version: PROTOCOL_VERSION,
                        events: vec![deletion.clone()],
                    },
                )
                .unwrap(),
                SavedRegionDeletionRetention {
                    retained_events: 1,
                    region_attachments: 2,
                }
            );
        }
        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![newer.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 0,
                region_attachments: 0,
            }
        );

        for region_id in ["later-deletion-first", "later-deletion-second"] {
            let region = load_region(&connection, region_id).unwrap().unwrap();
            assert_eq!(region.events_count, 4);
            let hydration = load_region_event_hydration(&connection, region_id, 0).unwrap();
            assert_eq!(
                hydration
                    .events
                    .iter()
                    .take(2)
                    .map(|event| event.id)
                    .collect::<Vec<_>>(),
                vec![older.id, newer.id]
            );
        }
        assert!(
            remove_region_manifest(&mut connection, "later-deletion-first")
                .unwrap()
                .0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_event_objects WHERE event_id = ?1",
                    params![older.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );
        assert!(
            remove_region_manifest(&mut connection, "later-deletion-second")
                .unwrap()
                .0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_event_objects WHERE event_id = ?1",
                    params![older.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn journaled_deletion_is_attached_then_removed_from_the_race_buffer() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .tags([nostr::Tag::parse(["d", "journal-race-target"]).unwrap()])
        .custom_created_at(nostr::Timestamp::from(1_900_000_000))
        .sign_with_keys(&author)
        .unwrap();
        let deletion = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();

        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![deletion.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 1,
                region_attachments: 0,
            }
        );

        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![deletion.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );

        let mut region_input = input("journal-race-first", &"e".repeat(64));
        region_input.events.push(dataset);
        let region = create_region(&mut connection, region_input).unwrap();
        assert_eq!(region.events_count, 3);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![deletion.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
        let hydration = load_region_event_hydration(&connection, "journal-race-first", 0).unwrap();
        assert_eq!(
            hydration.events.first().map(|event| event.id),
            Some(deletion.id)
        );
    }

    #[test]
    fn create_input_tombstone_already_attached_is_removed_from_the_race_buffer() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(Kind::Custom(37_515), "{\"included\":true}")
            .tags([nostr::Tag::parse(["d", "included-journal-target"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_000))
            .sign_with_keys(&author)
            .unwrap();
        let deletion = EventBuilder::new(Kind::Custom(5), "included deletion")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();
        retain_region_deletions(
            &mut connection,
            SavedRegionDeletionRetentionInput {
                version: PROTOCOL_VERSION,
                events: vec![deletion.clone()],
            },
        )
        .unwrap();

        let mut region_input = input("included-journal-deletion", &"f".repeat(64));
        region_input.events.extend([dataset, deletion.clone()]);
        let region = create_region(&mut connection, region_input).unwrap();
        assert_eq!(region.events_count, 3);
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![deletion.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            load_region_event_hydration(&connection, "included-journal-deletion", 0)
                .unwrap()
                .events
                .first()
                .map(|event| event.id),
            Some(deletion.id)
        );
    }

    #[test]
    fn partially_matched_journal_entry_survives_until_every_pointer_is_attached() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let first = EventBuilder::new(Kind::Custom(37_515), "{\"first\":true}")
            .tags([nostr::Tag::parse(["d", "first-journal-target"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_000))
            .sign_with_keys(&author)
            .unwrap();
        let second = EventBuilder::new(Kind::Custom(37_515), "{\"second\":true}")
            .tags([nostr::Tag::parse(["d", "second-journal-target"]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();
        let deletion = EventBuilder::new(Kind::Custom(5), "delete both")
            .tags([
                nostr::Tag::parse(["e".to_owned(), first.id.to_hex()]).unwrap(),
                nostr::Tag::parse(["e".to_owned(), second.id.to_hex()]).unwrap(),
            ])
            .custom_created_at(nostr::Timestamp::from(1_900_000_002))
            .sign_with_keys(&author)
            .unwrap();

        let mut first_region = input("partial-journal-first", &"a".repeat(64));
        first_region.events.push(first);
        create_region(&mut connection, first_region).unwrap();
        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![deletion.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 1,
                region_attachments: 1,
            }
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![deletion.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );

        let mut second_region = input("partial-journal-second", &"b".repeat(64));
        second_region.events.push(second);
        create_region(&mut connection, second_region).unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![deletion.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
        for region_id in ["partial-journal-first", "partial-journal-second"] {
            assert_eq!(
                load_region_event_hydration(&connection, region_id, 0)
                    .unwrap()
                    .events
                    .first()
                    .map(|event| event.id),
                Some(deletion.id)
            );
        }
    }

    #[test]
    fn deletion_journal_compaction_prunes_expired_and_dominated_rows() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let keys = Keys::generate();
        let target = "f".repeat(64);
        let older = EventBuilder::new(Kind::Custom(5), "older")
            .tags([nostr::Tag::parse(["e".to_owned(), target.clone()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_000))
            .sign_with_keys(&keys)
            .unwrap();
        let newer = EventBuilder::new(Kind::Custom(5), "newer")
            .tags([nostr::Tag::parse(["e".to_owned(), target]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&keys)
            .unwrap();
        let expired = EventBuilder::new(Kind::Custom(5), "expired")
            .tags([nostr::Tag::parse(["e".to_owned(), "e".repeat(64)]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_002))
            .sign_with_keys(&keys)
            .unwrap();
        let now = now_seconds();
        let transaction = connection.transaction().unwrap();
        for (event, stored_at) in [
            (&older, now),
            (&newer, now),
            (
                &expired,
                now.saturating_sub(DELETION_JOURNAL_TTL_SECONDS + 1),
            ),
        ] {
            transaction
                .execute(
                    "INSERT INTO saved_region_deletion_journal(
                       event_id, event_json, author_pubkey, created_at, stored_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        event.id.to_hex(),
                        serde_json::to_string(event).unwrap(),
                        event.pubkey.to_hex(),
                        event.created_at.as_secs(),
                        stored_at,
                    ],
                )
                .unwrap();
        }
        compact_deletion_journal(&transaction, now, &BTreeSet::new()).unwrap();
        transaction.commit().unwrap();

        let retained = connection
            .prepare(
                "SELECT event_id FROM saved_region_deletion_journal ORDER BY created_at, event_id",
            )
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(retained, vec![newer.id.to_hex()]);
    }

    #[test]
    fn deletion_journal_multibyte_accounting_evicts_by_utf8_bytes() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let keys = Keys::generate();
        let now = now_seconds();
        let multibyte_content = "é".repeat(1_000_000);
        let transaction = connection.transaction().unwrap();
        for index in 0..9 {
            let deletion =
                EventBuilder::new(Kind::Custom(5), format!("{index}:{multibyte_content}"))
                    .tags([
                        nostr::Tag::parse(["e".to_owned(), format!("{:064x}", index + 20_000)])
                            .unwrap(),
                    ])
                    .custom_created_at(nostr::Timestamp::from(1_900_000_000 + index))
                    .sign_with_keys(&keys)
                    .unwrap();
            transaction
                .execute(
                    "INSERT INTO saved_region_deletion_journal(
                       event_id, event_json, author_pubkey, created_at, stored_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        deletion.id.to_hex(),
                        serde_json::to_string(&deletion).unwrap(),
                        deletion.pubkey.to_hex(),
                        deletion.created_at.as_secs(),
                        now,
                    ],
                )
                .unwrap();
        }
        let text_characters = transaction
            .query_row(
                "SELECT SUM(LENGTH(event_json)) FROM saved_region_deletion_journal",
                [],
                |row| row.get::<_, usize>(0),
            )
            .unwrap();
        let utf8_bytes_before = transaction
            .query_row(
                "SELECT SUM(LENGTH(CAST(event_json AS BLOB)))
                 FROM saved_region_deletion_journal",
                [],
                |row| row.get::<_, usize>(0),
            )
            .unwrap();
        assert!(text_characters <= MAX_DELETION_JOURNAL_BYTES);
        assert!(utf8_bytes_before > MAX_DELETION_JOURNAL_BYTES);

        compact_deletion_journal(&transaction, now, &BTreeSet::new()).unwrap();
        let (count, utf8_bytes_after) = transaction
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(CAST(event_json AS BLOB))), 0)
                 FROM saved_region_deletion_journal",
                [],
                |row| Ok((row.get::<_, usize>(0)?, row.get::<_, usize>(1)?)),
            )
            .unwrap();
        assert!(count < 9);
        assert!(utf8_bytes_after <= MAX_DELETION_JOURNAL_BYTES);
    }

    #[test]
    fn deletion_journal_overflow_evicts_oldest_and_does_not_block_next_ipc_call() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let keys = Keys::generate();
        let now = now_seconds();
        let transaction = connection.transaction().unwrap();
        let mut oldest_id = None;
        let mut newest_id = None;
        for index in 0..=MAX_DELETION_JOURNAL_EVENTS {
            let deletion = EventBuilder::new(Kind::Custom(5), format!("deletion-{index}"))
                .tags([nostr::Tag::parse(["e".to_owned(), format!("{index:064x}")]).unwrap()])
                .custom_created_at(nostr::Timestamp::from(1_900_000_000 + index as u64))
                .sign_with_keys(&keys)
                .unwrap();
            oldest_id.get_or_insert(deletion.id);
            newest_id = Some(deletion.id);
            transaction
                .execute(
                    "INSERT INTO saved_region_deletion_journal(
                       event_id, event_json, author_pubkey, created_at, stored_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        deletion.id.to_hex(),
                        serde_json::to_string(&deletion).unwrap(),
                        deletion.pubkey.to_hex(),
                        deletion.created_at.as_secs(),
                        now,
                    ],
                )
                .unwrap();
        }
        compact_deletion_journal(&transaction, now, &BTreeSet::new()).unwrap();
        transaction.commit().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            MAX_DELETION_JOURNAL_EVENTS
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![oldest_id.unwrap().to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![newest_id.unwrap().to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );

        let next = EventBuilder::new(Kind::Custom(5), "next legitimate deletion")
            .tags([nostr::Tag::parse(["e".to_owned(), "f".repeat(64)]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_010_000))
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![next.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 1,
                region_attachments: 0,
            }
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![next.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );
    }

    #[test]
    fn deletion_journal_overflow_preserves_a_newly_inserted_older_event() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let keys = Keys::generate();
        let future_stored_at = now_seconds().saturating_add(60);
        let transaction = connection.transaction().unwrap();
        let mut first_existing_id = None;
        for index in 0..MAX_DELETION_JOURNAL_EVENTS {
            let deletion = EventBuilder::new(Kind::Custom(5), format!("existing-{index}"))
                .tags([nostr::Tag::parse(["e".to_owned(), format!("{index:064x}")]).unwrap()])
                .custom_created_at(nostr::Timestamp::from(1_900_000_000 + index as u64))
                .sign_with_keys(&keys)
                .unwrap();
            first_existing_id.get_or_insert(deletion.id);
            transaction
                .execute(
                    "INSERT INTO saved_region_deletion_journal(
                       event_id, event_json, author_pubkey, created_at, stored_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        deletion.id.to_hex(),
                        serde_json::to_string(&deletion).unwrap(),
                        deletion.pubkey.to_hex(),
                        deletion.created_at.as_secs(),
                        future_stored_at,
                    ],
                )
                .unwrap();
        }
        transaction.commit().unwrap();

        let current = EventBuilder::new(Kind::Custom(5), "current older deletion")
            .tags([nostr::Tag::parse(["e".to_owned(), "f".repeat(64)]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_800_000_000))
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![current.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 1,
                region_attachments: 0,
            }
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            MAX_DELETION_JOURNAL_EVENTS
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![current.id.to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            1
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_deletion_journal WHERE event_id = ?1",
                    params![first_existing_id.unwrap().to_hex()],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            0
        );
    }

    #[test]
    fn later_deletion_uses_reserved_capacity_after_the_initial_manifest_is_full() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let author = Keys::generate();
        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            "{\"type\":\"FeatureCollection\",\"features\":[]}",
        )
        .tags([nostr::Tag::parse(["d", "full-region-target"]).unwrap()])
        .custom_created_at(nostr::Timestamp::from(1_900_000_000))
        .sign_with_keys(&author)
        .unwrap();
        let mut region_input = input("full-before-deletion", &"d".repeat(64));
        region_input.events.push(dataset.clone());
        create_region(&mut connection, region_input).unwrap();

        let transaction = connection.transaction().unwrap();
        for ordinal in 2..MAX_REGION_EVENTS {
            let event_id = format!("{:064x}", ordinal + 10_000);
            transaction
                .execute(
                    "INSERT INTO saved_region_event_objects(
                       event_id, event_json, kind, author_pubkey, stored_at
                     ) VALUES (?1, ?2, 37515, ?3, ?4)",
                    params![event_id, "x".repeat(4_100), "f".repeat(64), now_seconds()],
                )
                .unwrap();
            transaction
                .execute(
                    "INSERT INTO saved_region_events(
                       region_id, event_id, kind, author_pubkey, ordinal
                     ) VALUES ('full-before-deletion', ?1, 37515, ?2, ?3)",
                    params![event_id, "f".repeat(64), ordinal],
                )
                .unwrap();
        }
        transaction.commit().unwrap();
        assert_eq!(
            connection
                .query_row(
                    "SELECT COUNT(*) FROM saved_region_events WHERE region_id = 'full-before-deletion'",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap(),
            MAX_REGION_EVENTS
        );
        assert!(
            connection
                .query_row(
                    "SELECT SUM(LENGTH(CAST(objects.event_json AS BLOB)))
                     FROM saved_region_events manifest
                     JOIN saved_region_event_objects objects ON objects.event_id = manifest.event_id
                     WHERE manifest.region_id = 'full-before-deletion'",
                    [],
                    |row| row.get::<_, usize>(0),
                )
                .unwrap()
                > MAX_REGION_EVENT_BYTES
        );

        let deletion = EventBuilder::new(Kind::Custom(5), "deleted")
            .tags([nostr::Tag::parse(["e".to_owned(), dataset.id.to_hex()]).unwrap()])
            .custom_created_at(nostr::Timestamp::from(1_900_000_001))
            .sign_with_keys(&author)
            .unwrap();
        assert_eq!(
            retain_region_deletions(
                &mut connection,
                SavedRegionDeletionRetentionInput {
                    version: PROTOCOL_VERSION,
                    events: vec![deletion.clone()],
                },
            )
            .unwrap(),
            SavedRegionDeletionRetention {
                retained_events: 1,
                region_attachments: 1,
            }
        );
        let region = load_region(&connection, "full-before-deletion")
            .unwrap()
            .unwrap();
        assert_eq!(region.events_count, MAX_REGION_EVENTS + 1);
        let hydration =
            load_region_event_hydration(&connection, "full-before-deletion", 0).unwrap();
        assert_eq!(hydration.expected_events, MAX_REGION_EVENTS + 1);
        assert_eq!(
            hydration.events.first().map(|event| event.id),
            Some(deletion.id)
        );
    }

    #[test]
    fn basemap_availability_retains_exact_signed_size_validation() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let region =
            create_region(&mut connection, input("size-mismatch", &"a".repeat(64))).unwrap();
        let blob = region.blobs.first().unwrap();
        let descriptor = BlobDescriptor {
            url: format!("http://127.0.0.1/{}", blob.sha256).parse().unwrap(),
            sha256: blob.sha256.clone(),
            size: blob.expected_size.unwrap() - 1,
            media_type: "application/vnd.pmtiles".to_owned(),
            uploaded: now_seconds(),
        };

        assert_eq!(
            mark_blob(&connection, &region.id, blob, &descriptor)
                .unwrap_err()
                .code,
            "region-size-mismatch"
        );
    }

    #[test]
    fn hydration_reports_a_missing_or_corrupt_snapshot_object() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let region = create_region(&mut connection, input("damaged", &"5".repeat(64))).unwrap();
        connection
            .execute(
                "UPDATE saved_region_event_objects SET event_json = 'not-json' WHERE event_id = ?1",
                params![region.announcement_id],
            )
            .unwrap();

        let hydration = load_region_event_hydration(&connection, "damaged", 0).unwrap();
        assert_eq!(hydration.expected_events, 1);
        assert!(hydration.events.is_empty());
        assert_eq!(hydration.missing_event_ids, vec![region.announcement_id]);
    }

    #[test]
    fn hydration_pages_large_manifests_without_repeating_events() {
        let (_directory, state) = state();
        let mut connection = state.connection().unwrap();
        let mut region_input = input("paged", &"6".repeat(64));
        for index in 0..MAX_REGION_EVENT_PAGE {
            region_input.events.push(
                EventBuilder::new(Kind::Metadata, format!("{{\"name\":\"Person {index}\"}}"))
                    .sign_with_keys(&Keys::generate())
                    .unwrap(),
            );
        }
        create_region(&mut connection, region_input).unwrap();

        let first = load_region_event_hydration(&connection, "paged", 0).unwrap();
        assert_eq!(first.expected_events, MAX_REGION_EVENT_PAGE + 1);
        assert_eq!(first.events.len(), MAX_REGION_EVENT_PAGE);
        assert_eq!(first.next_cursor, Some(MAX_REGION_EVENT_PAGE));
        let second =
            load_region_event_hydration(&connection, "paged", MAX_REGION_EVENT_PAGE).unwrap();
        assert_eq!(second.events.len(), 1);
        assert_eq!(second.next_cursor, None);
        assert_ne!(first.events.last().unwrap().id, second.events[0].id);
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

        let hash = "f".repeat(64);
        let mut unbounded_map = input("unbounded-map", &hash);
        let keys = Keys::generate();
        let announcement = EventBuilder::new(
            Kind::Custom(34_444),
            serde_json::json!({
                "version": 1,
                "layers": [{
                    "id": "world",
                    "title": "World",
                    "kind": "chunked-vector",
                    "blossomServers": ["https://maps.example"],
                    "announcement": {
                        "u": {
                            "bbox": [0.0, 40.0, 30.0, 60.0],
                            "file": format!("{hash}.pmtiles"),
                            "maxZoom": 8
                        }
                    }
                }]
            })
            .to_string(),
        )
        .sign_with_keys(&keys)
        .unwrap();
        unbounded_map.source_pubkey = announcement.pubkey.to_hex();
        unbounded_map.announcement_id = announcement.id.to_hex();
        unbounded_map.events = vec![announcement];
        unbounded_map.blobs[0].expected_size = None;
        assert_eq!(
            create_region(&mut connection, unbounded_map)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );

        let mut private = input("private", &"e".repeat(64));
        let keys = Keys::generate();
        private.events.push(
            EventBuilder::new(Kind::Custom(37_515), "{}")
                .tags([nostr::Tag::parse(["h", "nearby-session"]).unwrap()])
                .sign_with_keys(&keys)
                .unwrap(),
        );
        assert_eq!(
            create_region(&mut connection, private).unwrap_err().code,
            "private-region-event"
        );

        let mut missing_announcement = input("missing-announcement", &"f".repeat(64));
        let other_announcement = EventBuilder::new(Kind::Custom(34_444), "{}")
            .sign_with_keys(&Keys::generate())
            .unwrap();
        missing_announcement.announcement_id = other_announcement.id.to_hex();
        assert_eq!(
            create_region(&mut connection, missing_announcement)
                .unwrap_err()
                .code,
            "missing-region-announcement"
        );

        let mut unsupported_kind = input("unsupported-kind", &"1".repeat(64));
        unsupported_kind.events.push(
            EventBuilder::text_note("not retained by saved maps")
                .sign_with_keys(&Keys::generate())
                .unwrap(),
        );
        assert_eq!(
            create_region(&mut connection, unsupported_kind)
                .unwrap_err()
                .code,
            "invalid-region-event-kind"
        );

        let mut duplicate_event = input("duplicate-event", &"2".repeat(64));
        duplicate_event
            .events
            .push(duplicate_event.events[0].clone());
        assert_eq!(
            create_region(&mut connection, duplicate_event)
                .unwrap_err()
                .code,
            "invalid-region-event"
        );

        let mut unbound_map = input("unbound-map", &"3".repeat(64));
        unbound_map.blobs[0].sha256 = "4".repeat(64);
        assert_eq!(
            create_region(&mut connection, unbound_map)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );

        let mut conflicting_content = input("conflicting-content", &"5".repeat(64));
        let content_hash = "6".repeat(64);
        conflicting_content.blobs.push(SavedRegionBlobInput {
            sha256: content_hash.clone(),
            role: SavedRegionBlobRole::Content,
            required: true,
            ordinal: 1,
            expected_size: None,
            mirror_urls: vec!["https://content.example/dataset.geojson".to_owned()],
        });
        conflicting_content.events.push(
            EventBuilder::new(
                Kind::Custom(37_515),
                "{\"type\":\"FeatureCollection\",\"features\":[]}",
            )
            .tags([
                nostr::Tag::parse(["d", "conflicting-external"]).unwrap(),
                nostr::Tag::parse([
                    "blob".to_owned(),
                    "collection".to_owned(),
                    "https://content.example/dataset.geojson".to_owned(),
                    format!("sha256={content_hash}"),
                    "size=10".to_owned(),
                ])
                .unwrap(),
                nostr::Tag::parse([
                    "blob".to_owned(),
                    "collection".to_owned(),
                    "https://backup.example/dataset.geojson".to_owned(),
                    format!("sha256={content_hash}"),
                    "size=11".to_owned(),
                ])
                .unwrap(),
            ])
            .sign_with_keys(&Keys::generate())
            .unwrap(),
        );
        assert_eq!(
            create_region(&mut connection, conflicting_content)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );

        let mut omitted_content = input("omitted-content", &"5".repeat(64));
        let content_hash = "6".repeat(64);
        omitted_content.events.push(
            EventBuilder::new(
                Kind::Custom(37_515),
                "{\"type\":\"FeatureCollection\",\"features\":[]}",
            )
            .tags([
                nostr::Tag::parse(["d", "omitted-external"]).unwrap(),
                nostr::Tag::parse([
                    "blob".to_owned(),
                    "collection".to_owned(),
                    "https://content.example/omitted.geojson".to_owned(),
                    format!("sha256={content_hash}"),
                ])
                .unwrap(),
            ])
            .sign_with_keys(&Keys::generate())
            .unwrap(),
        );
        assert_eq!(
            create_region(&mut connection, omitted_content)
                .unwrap_err()
                .code,
            "invalid-region-manifest"
        );
    }

    #[test]
    fn download_space_guard_keeps_android_headroom() {
        let small_device = 1024 * 1024 * 1024_u64;
        let large_device = 256 * 1024 * 1024 * 1024_u64;
        assert_eq!(
            download_space_reserve(small_device),
            MIN_FREE_SPACE_RESERVE_BYTES
        );
        assert_eq!(
            download_space_reserve(large_device),
            MAX_FREE_SPACE_RESERVE_BYTES
        );

        let reserve = download_space_reserve(64 * 1024 * 1024 * 1024);
        assert!(download_space_available(
            512 * 1024 * 1024,
            1024 * 1024 * 1024,
            reserve
        ));
        assert!(!download_space_available(
            900 * 1024 * 1024,
            1024 * 1024 * 1024,
            reserve
        ));
        assert!(!download_space_available(1, reserve, reserve));
    }

    #[test]
    fn unknown_content_reserves_its_full_bounded_download_size() {
        let blob = SavedRegionBlobView {
            sha256: "a".repeat(64),
            role: SavedRegionBlobRole::Content,
            required: true,
            ordinal: 0,
            expected_size: None,
            actual_size: None,
            media_type: None,
            state: SavedRegionBlobState::Missing,
            mirror_urls: vec!["https://blossom.example/dataset.geojson".to_owned()],
            last_error: None,
        };

        assert_eq!(
            blob_download_space_estimate(&blob),
            MAX_REGION_CONTENT_BLOB_BYTES
        );
    }

    #[test]
    fn oversized_existing_content_cannot_be_marked_available() {
        let (_directory, state) = state();
        let basemap_hash = "9".repeat(64);
        let content_hash = "8".repeat(64);
        let mut connection = state.connection().unwrap();
        let mut region_input = input("oversized-content", &basemap_hash);
        region_input.blobs.push(SavedRegionBlobInput {
            sha256: content_hash.clone(),
            role: SavedRegionBlobRole::Content,
            required: true,
            ordinal: 1,
            expected_size: None,
            mirror_urls: vec!["https://content.example/dataset.geojson".to_owned()],
        });
        region_input.events.push(
            EventBuilder::new(
                Kind::Custom(37_515),
                "{\"type\":\"FeatureCollection\",\"features\":[]}",
            )
            .tags([
                nostr::Tag::parse(["d", "external-dataset"]).unwrap(),
                nostr::Tag::parse([
                    "blob".to_owned(),
                    "collection".to_owned(),
                    "https://content.example/dataset.geojson".to_owned(),
                    format!("sha256={content_hash}"),
                ])
                .unwrap(),
            ])
            .sign_with_keys(&Keys::generate())
            .unwrap(),
        );
        let region = create_region(&mut connection, region_input).unwrap();
        let content_blob = region
            .blobs
            .iter()
            .find(|blob| blob.role == SavedRegionBlobRole::Content)
            .unwrap();
        let descriptor = BlobDescriptor {
            url: format!("http://127.0.0.1/{content_hash}").parse().unwrap(),
            sha256: content_hash,
            size: MAX_REGION_CONTENT_BLOB_BYTES + 1,
            media_type: "application/geo+json".to_owned(),
            uploaded: now_seconds(),
        };

        let error = mark_blob(&connection, &region.id, content_blob, &descriptor).unwrap_err();
        assert_eq!(error.code, "region-content-too-large");
        assert_eq!(
            load_region(&connection, &region.id)
                .unwrap()
                .unwrap()
                .blobs
                .iter()
                .find(|blob| blob.role == SavedRegionBlobRole::Content)
                .unwrap()
                .state,
            SavedRegionBlobState::Failed
        );
    }

    #[test]
    fn storage_pressure_messages_use_readable_units() {
        assert_eq!(format_storage_size(42 * 1024 * 1024), "42 MiB");
        assert_eq!(format_storage_size(1536 * 1024 * 1024), "1.5 GiB");
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

    #[test]
    fn diagnostic_summary_exposes_only_saved_map_counts() {
        let (_directory, state) = state();
        let hash = "a".repeat(64);
        let mut connection = state.connection().unwrap();
        create_region(&mut connection, input("private-place-name", &hash)).unwrap();
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
        drop(connection);

        let summary = state.diagnostic_summary().unwrap();
        assert_eq!(summary.total, 1);
        assert_eq!(summary.planned, 1);
        assert_eq!(summary.managed_blobs, 1);
        assert_eq!(summary.managed_bytes, 42);
        let json = serde_json::to_string(&summary).unwrap();
        assert!(!json.contains("private-place-name"));
        assert!(!json.contains(&hash));
        assert!(!json.contains("127.0.0.1"));
    }
}
