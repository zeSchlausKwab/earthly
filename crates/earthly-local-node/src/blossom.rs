use std::io::ErrorKind;
use std::net::SocketAddr;
use std::path::{Path as FilePath, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::header::{
    ACCEPT_RANGES, AUTHORIZATION, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
    RANGE,
};
use axum::http::{HeaderMap, HeaderValue, Method, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use futures_util::StreamExt;
use nostr::{Event, EventId, PublicKey, Timestamp};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt, SeekFrom};
use tokio::task::JoinHandle;
use tokio_util::io::ReaderStream;
use tokio_util::sync::CancellationToken;
use tower_http::cors::{Any, CorsLayer};
use url::Url;
use uuid::Uuid;

use crate::{
    NodeConfig, NodeError, PairingCapability, PairingClaimRequest, PairingError, PairingManager,
    PairingStatus, PeerPolicy, PAIRING_CLAIMS_PATH,
};

const X_SHA_256: &str = "x-sha-256";
const X_REASON: &str = "x-reason";
const AUTHORIZATION_KIND: u16 = 24_242;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BlobDescriptor {
    pub url: Url,
    pub sha256: String,
    pub size: u64,
    #[serde(rename = "type")]
    pub media_type: String,
    pub uploaded: u64,
}

/// Running BUD-01/BUD-02/BUD-11 Blossom service.
#[derive(Debug)]
pub struct EmbeddedBlossom {
    url: Url,
    shutdown: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl EmbeddedBlossom {
    pub async fn start(
        config: &NodeConfig,
        peers: PeerPolicy,
        pairing: PairingManager,
    ) -> Result<Self, NodeError> {
        config.validate()?;
        let store = BlobStore::open(config.data_dir.join("blossom")).await?;
        let listener =
            tokio::net::TcpListener::bind(SocketAddr::new(config.bind.ip()?, config.blossom_port))
                .await?;
        let address = listener.local_addr()?;
        let url = Url::parse(&format!("http://{address}/"))
            .map_err(|error| NodeError::Blossom(error.to_string()))?;
        let state = BlossomState {
            store,
            peers,
            pairing,
            base_url: url.clone(),
            server_host: url.host_str().unwrap_or_default().to_owned(),
            max_blob_bytes: config.max_blob_bytes,
        };
        let shutdown = CancellationToken::new();
        let shutdown_signal = shutdown.clone();
        let app = Router::new()
            .route("/upload", put(upload_blob))
            .route("/{blob}", get(get_blob).head(head_blob))
            .route(
                PAIRING_CLAIMS_PATH,
                post(submit_pairing_claim).layer(DefaultBodyLimit::max(16 * 1024)),
            )
            .route(
                &format!("{PAIRING_CLAIMS_PATH}/{{claim_id}}"),
                get(get_pairing_status),
            )
            .layer(
                CorsLayer::new()
                    .allow_origin(Any)
                    .allow_methods([
                        Method::GET,
                        Method::HEAD,
                        Method::POST,
                        Method::PUT,
                        Method::DELETE,
                    ])
                    .allow_headers(Any)
                    .expose_headers(Any)
                    .max_age(Duration::from_secs(86_400)),
            )
            .with_state(state);

        let task = tokio::spawn(async move {
            if let Err(error) = axum::serve(listener, app)
                .with_graceful_shutdown(shutdown_signal.cancelled_owned())
                .await
            {
                tracing::error!(%error, "Blossom listener terminated");
            }
        });

        Ok(Self {
            url,
            shutdown,
            task: Some(task),
        })
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn shutdown(&self) {
        self.shutdown.cancel();
    }

    pub async fn close(mut self) {
        self.shutdown();
        if let Some(task) = self.task.take() {
            let _ = task.await;
        }
    }
}

impl Drop for EmbeddedBlossom {
    fn drop(&mut self) {
        self.shutdown();
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

#[derive(Clone, Debug)]
struct BlossomState {
    store: BlobStore,
    peers: PeerPolicy,
    pairing: PairingManager,
    base_url: Url,
    server_host: String,
    max_blob_bytes: u64,
}

async fn submit_pairing_claim(
    State(state): State<BlossomState>,
    Json(request): Json<PairingClaimRequest>,
) -> Result<impl IntoResponse, PairingHttpError> {
    let receipt = state.pairing.submit_claim(request.claim).await?;
    Ok((StatusCode::ACCEPTED, Json(receipt)))
}

async fn get_pairing_status(
    Path(claim_id): Path<String>,
    State(state): State<BlossomState>,
) -> Result<Json<PairingStatus>, PairingHttpError> {
    let claim_id =
        EventId::from_hex(&claim_id).map_err(|_| PairingHttpError(PairingError::NotFound))?;
    Ok(Json(state.pairing.status(claim_id).await?))
}

#[derive(Debug)]
struct PairingHttpError(PairingError);

impl From<PairingError> for PairingHttpError {
    fn from(error: PairingError) -> Self {
        Self(error)
    }
}

#[derive(Debug, Serialize)]
struct PairingErrorBody {
    error: String,
}

impl IntoResponse for PairingHttpError {
    fn into_response(self) -> Response<Body> {
        let status = match self.0 {
            PairingError::NotFound => StatusCode::NOT_FOUND,
            PairingError::Expired => StatusCode::GONE,
            PairingError::AlreadyUsed => StatusCode::CONFLICT,
            PairingError::TooManyClaims => StatusCode::TOO_MANY_REQUESTS,
            PairingError::Io(_) | PairingError::Policy(_) | PairingError::InconsistentState(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
            _ => StatusCode::BAD_REQUEST,
        };
        (
            status,
            Json(PairingErrorBody {
                error: self.0.to_string(),
            }),
        )
            .into_response()
    }
}

#[derive(Clone, Debug)]
struct BlobStore {
    blobs: PathBuf,
    staging: PathBuf,
}

impl BlobStore {
    async fn open(root: PathBuf) -> Result<Self, std::io::Error> {
        let blobs = root.join("sha256");
        let staging = root.join("staging");
        fs::create_dir_all(&blobs).await?;
        fs::create_dir_all(&staging).await?;
        cleanup_staging(&staging).await?;
        Ok(Self { blobs, staging })
    }

    fn blob_path(&self, hash: &str) -> PathBuf {
        self.blobs.join(&hash[..2]).join(hash)
    }

    fn staging_path(&self) -> PathBuf {
        self.staging.join(format!("{}.upload", Uuid::new_v4()))
    }
}

async fn cleanup_staging(staging: &FilePath) -> Result<(), std::io::Error> {
    let mut entries = fs::read_dir(staging).await?;
    while let Some(entry) = entries.next_entry().await? {
        let file_type = entry.file_type().await?;
        if file_type.is_file() {
            fs::remove_file(entry.path()).await?;
        }
    }
    Ok(())
}

async fn upload_blob(
    State(state): State<BlossomState>,
    headers: HeaderMap,
    body: Body,
) -> Result<impl IntoResponse, BlossomError> {
    let expected_hash = required_hash_header(&headers)?;
    authorize(&headers, &state, "upload", Some(&expected_hash), true).await?;

    let declared_size = headers
        .get(CONTENT_LENGTH)
        .ok_or_else(|| BlossomError::new(StatusCode::LENGTH_REQUIRED, "Content-Length required"))?
        .to_str()
        .map_err(|_| BlossomError::bad_request("invalid Content-Length"))?
        .parse::<u64>()
        .map_err(|_| BlossomError::bad_request("invalid Content-Length"))?;
    if declared_size > state.max_blob_bytes {
        return Err(BlossomError::new(
            StatusCode::PAYLOAD_TOO_LARGE,
            "blob exceeds configured limit",
        ));
    }

    let media_type = headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .unwrap_or("application/octet-stream")
        .to_owned();
    let staging_path = state.store.staging_path();
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging_path)
        .await
        .map_err(BlossomError::internal)?;
    let mut stream = body.into_data_stream();
    let mut hasher = Sha256::new();
    let mut actual_size = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(_) => {
                discard_staging(&staging_path).await;
                return Err(BlossomError::bad_request("invalid upload body"));
            }
        };
        actual_size = actual_size.saturating_add(chunk.len() as u64);
        if actual_size > state.max_blob_bytes || actual_size > declared_size {
            discard_staging(&staging_path).await;
            return Err(BlossomError::new(
                StatusCode::PAYLOAD_TOO_LARGE,
                "blob exceeds declared or configured size",
            ));
        }
        hasher.update(&chunk);
        if file.write_all(&chunk).await.is_err() {
            discard_staging(&staging_path).await;
            return Err(BlossomError::internal_reason("failed to persist upload"));
        }
    }

    if actual_size != declared_size {
        discard_staging(&staging_path).await;
        return Err(BlossomError::bad_request(
            "upload size does not match Content-Length",
        ));
    }
    if file.sync_all().await.is_err() {
        discard_staging(&staging_path).await;
        return Err(BlossomError::internal_reason("failed to sync upload"));
    }
    drop(file);

    let actual_hash = format!("{:x}", hasher.finalize());
    if actual_hash != expected_hash {
        discard_staging(&staging_path).await;
        return Err(BlossomError::new(
            StatusCode::CONFLICT,
            "X-SHA-256 does not match upload body",
        ));
    }

    let target_path = state.store.blob_path(&actual_hash);
    fs::create_dir_all(target_path.parent().expect("blob path has parent"))
        .await
        .map_err(BlossomError::internal)?;
    let created = adopt_staging(&staging_path, &target_path)
        .await
        .map_err(|_| BlossomError::internal_reason("failed to adopt upload"))?;

    let descriptor = descriptor(
        &state.base_url,
        &target_path,
        actual_hash,
        actual_size,
        media_type,
    )
    .await?;
    let status = if created {
        StatusCode::CREATED
    } else {
        StatusCode::OK
    };
    Ok((status, Json(descriptor)))
}

async fn get_blob(
    State(state): State<BlossomState>,
    Path(blob): Path<String>,
    headers: HeaderMap,
) -> Result<Response<Body>, BlossomError> {
    serve_blob(state, blob, headers, false).await
}

async fn head_blob(
    State(state): State<BlossomState>,
    Path(blob): Path<String>,
    headers: HeaderMap,
) -> Result<Response<Body>, BlossomError> {
    serve_blob(state, blob, headers, true).await
}

async fn serve_blob(
    state: BlossomState,
    blob: String,
    headers: HeaderMap,
    head_only: bool,
) -> Result<Response<Body>, BlossomError> {
    let hash = parse_blob_segment(&blob)?;
    authorize(&headers, &state, "get", Some(&hash), false).await?;
    let path = state.store.blob_path(&hash);
    let metadata = match fs::metadata(&path).await {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) | Err(_) => return Err(BlossomError::not_found()),
    };
    let size = metadata.len();
    let requested_range = headers.get(RANGE).and_then(|value| value.to_str().ok());
    let range = resolve_range(requested_range, size)?;
    let media_type = detect_media_type(&path).await;

    let mut builder = Response::builder()
        .status(range.status)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_LENGTH, range.length.to_string())
        .header(CONTENT_TYPE, media_type)
        .header(ETAG, format!("\"{hash}\""))
        .header(CACHE_CONTROL, "public, max-age=31536000, immutable");
    if let Some(content_range) = range.content_range {
        builder = builder.header(CONTENT_RANGE, content_range);
    }

    let body = if head_only || range.length == 0 {
        Body::empty()
    } else {
        let mut file = File::open(&path)
            .await
            .map_err(|_| BlossomError::not_found())?;
        file.seek(SeekFrom::Start(range.start))
            .await
            .map_err(BlossomError::internal)?;
        let stream = ReaderStream::new(file.take(range.length));
        Body::from_stream(stream)
    };
    builder
        .body(body)
        .map_err(|_| BlossomError::internal_reason("failed to build response"))
}

async fn authorize(
    headers: &HeaderMap,
    state: &BlossomState,
    action: &str,
    implied_hash: Option<&str>,
    require_hash: bool,
) -> Result<PublicKey, BlossomError> {
    let value = headers
        .get(AUTHORIZATION)
        .ok_or_else(BlossomError::unauthorized)?
        .to_str()
        .map_err(|_| BlossomError::unauthorized())?;
    let encoded = value
        .strip_prefix("Nostr ")
        .ok_or_else(BlossomError::unauthorized)?;
    let decoded = URL_SAFE_NO_PAD
        .decode(encoded)
        .or_else(|_| URL_SAFE.decode(encoded))
        .map_err(|_| BlossomError::unauthorized())?;
    let event: Event =
        serde_json::from_slice(&decoded).map_err(|_| BlossomError::unauthorized())?;
    event.verify().map_err(|_| BlossomError::unauthorized())?;

    let now = Timestamp::now();
    if event.kind.as_u16() != AUTHORIZATION_KIND
        || event.created_at > now
        || event.content.trim().is_empty()
    {
        return Err(BlossomError::unauthorized());
    }
    let expiration = event
        .tags
        .expiration()
        .ok_or_else(BlossomError::unauthorized)?;
    if expiration <= &now {
        return Err(BlossomError::unauthorized());
    }

    let mut action_matches = false;
    let mut server_tags = Vec::new();
    let mut hash_tags = Vec::new();
    for tag in event.tags.iter() {
        let values = tag.as_slice();
        match values.first().map(String::as_str) {
            Some("t") if values.get(1).map(String::as_str) == Some(action) => {
                action_matches = true;
            }
            Some("server") if values.len() == 2 => server_tags.push(values[1].as_str()),
            Some("x") if values.len() == 2 => hash_tags.push(values[1].as_str()),
            _ => {}
        }
    }
    if !action_matches
        || (!server_tags.is_empty() && !server_tags.contains(&state.server_host.as_str()))
    {
        return Err(BlossomError::unauthorized());
    }
    if require_hash && hash_tags.is_empty() {
        return Err(BlossomError::unauthorized());
    }
    if let Some(hash) = implied_hash {
        if !hash_tags.is_empty() && !hash_tags.contains(&hash) {
            return Err(BlossomError::unauthorized());
        }
    }
    let required_capability = match action {
        "get" => PairingCapability::BlobRead,
        "upload" => PairingCapability::BlobWrite,
        _ => return Err(BlossomError::unauthorized()),
    };
    if !state
        .peers
        .allows_capability(&event.pubkey, required_capability)
        .await
    {
        return Err(BlossomError::new(
            StatusCode::FORBIDDEN,
            "peer is not granted this capability",
        ));
    }
    Ok(event.pubkey)
}

fn required_hash_header(headers: &HeaderMap) -> Result<String, BlossomError> {
    let hash = headers
        .get(X_SHA_256)
        .ok_or_else(|| BlossomError::bad_request("X-SHA-256 required"))?
        .to_str()
        .map_err(|_| BlossomError::bad_request("invalid X-SHA-256"))?;
    validate_hash(hash)?;
    Ok(hash.to_owned())
}

fn parse_blob_segment(segment: &str) -> Result<String, BlossomError> {
    if segment.len() < 64 {
        return Err(BlossomError::bad_request("invalid blob path"));
    }
    let hash = &segment[..64];
    validate_hash(hash)?;
    let extension = &segment[64..];
    if !extension.is_empty()
        && (!extension.starts_with('.')
            || extension.len() == 1
            || extension.len() > 17
            || !extension[1..]
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric()))
    {
        return Err(BlossomError::bad_request("invalid blob extension"));
    }
    Ok(hash.to_owned())
}

fn validate_hash(hash: &str) -> Result<(), BlossomError> {
    if hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(BlossomError::bad_request("invalid sha256"))
    }
}

#[derive(Debug)]
struct ResolvedRange {
    status: StatusCode,
    start: u64,
    length: u64,
    content_range: Option<String>,
}

fn resolve_range(header: Option<&str>, size: u64) -> Result<ResolvedRange, BlossomError> {
    let Some(header) = header else {
        return Ok(ResolvedRange {
            status: StatusCode::OK,
            start: 0,
            length: size,
            content_range: None,
        });
    };
    let value = header
        .strip_prefix("bytes=")
        .ok_or_else(|| BlossomError::range_not_satisfiable(size))?;
    if value.contains(',') || size == 0 {
        return Err(BlossomError::range_not_satisfiable(size));
    }
    let (start, end) = value
        .split_once('-')
        .ok_or_else(|| BlossomError::range_not_satisfiable(size))?;
    let (start, end) = if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| BlossomError::range_not_satisfiable(size))?;
        if suffix == 0 {
            return Err(BlossomError::range_not_satisfiable(size));
        }
        (size.saturating_sub(suffix.min(size)), size - 1)
    } else {
        let start = start
            .parse::<u64>()
            .map_err(|_| BlossomError::range_not_satisfiable(size))?;
        if start >= size {
            return Err(BlossomError::range_not_satisfiable(size));
        }
        let end = if end.is_empty() {
            size - 1
        } else {
            end.parse::<u64>()
                .map_err(|_| BlossomError::range_not_satisfiable(size))?
                .min(size - 1)
        };
        if end < start {
            return Err(BlossomError::range_not_satisfiable(size));
        }
        (start, end)
    };
    Ok(ResolvedRange {
        status: StatusCode::PARTIAL_CONTENT,
        start,
        length: end - start + 1,
        content_range: Some(format!("bytes {start}-{end}/{size}")),
    })
}

async fn descriptor(
    base_url: &Url,
    path: &FilePath,
    hash: String,
    size: u64,
    media_type: String,
) -> Result<BlobDescriptor, BlossomError> {
    let extension = mime_guess::get_mime_extensions_str(&media_type)
        .and_then(|extensions| extensions.first().copied())
        .unwrap_or("bin");
    let url = base_url
        .join(&format!("{hash}.{extension}"))
        .map_err(|_| BlossomError::internal_reason("failed to build blob URL"))?;
    let uploaded = fs::metadata(path)
        .await
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_else(unix_now);
    Ok(BlobDescriptor {
        url,
        sha256: hash,
        size,
        media_type,
        uploaded,
    })
}

async fn detect_media_type(path: &FilePath) -> String {
    let Ok(mut file) = File::open(path).await else {
        return "application/octet-stream".to_owned();
    };
    let mut bytes = vec![0_u8; 512];
    let Ok(read) = file.read(&mut bytes).await else {
        return "application/octet-stream".to_owned();
    };
    infer::get(&bytes[..read])
        .map(|kind| kind.mime_type().to_owned())
        .unwrap_or_else(|| "application/octet-stream".to_owned())
}

async fn discard_staging(path: &FilePath) {
    let _ = fs::remove_file(path).await;
}

async fn adopt_staging(
    staging_path: &FilePath,
    target_path: &FilePath,
) -> Result<bool, std::io::Error> {
    match fs::metadata(target_path).await {
        Ok(metadata) if metadata.is_file() => {
            fs::remove_file(staging_path).await?;
            return Ok(false);
        }
        Ok(_) => return Err(std::io::Error::from(ErrorKind::AlreadyExists)),
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    match fs::rename(staging_path, target_path).await {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            fs::remove_file(staging_path).await?;
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[derive(Debug)]
struct BlossomError {
    status: StatusCode,
    reason: &'static str,
    content_range: Option<String>,
}

impl BlossomError {
    const fn new(status: StatusCode, reason: &'static str) -> Self {
        Self {
            status,
            reason,
            content_range: None,
        }
    }

    const fn bad_request(reason: &'static str) -> Self {
        Self::new(StatusCode::BAD_REQUEST, reason)
    }

    const fn unauthorized() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "valid Nostr authorization required",
        )
    }

    const fn not_found() -> Self {
        Self::new(StatusCode::NOT_FOUND, "blob not found")
    }

    fn range_not_satisfiable(size: u64) -> Self {
        Self {
            status: StatusCode::RANGE_NOT_SATISFIABLE,
            reason: "invalid byte range",
            content_range: Some(format!("bytes */{size}")),
        }
    }

    fn internal(_error: std::io::Error) -> Self {
        Self::internal_reason("storage operation failed")
    }

    const fn internal_reason(reason: &'static str) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, reason)
    }
}

impl IntoResponse for BlossomError {
    fn into_response(self) -> axum::response::Response {
        let mut response = (self.status, self.reason).into_response();
        response
            .headers_mut()
            .insert(X_REASON, HeaderValue::from_static(self.reason));
        if let Some(content_range) = self.content_range {
            if let Ok(value) = HeaderValue::from_str(&content_range) {
                response.headers_mut().insert(CONTENT_RANGE, value);
            }
        }
        response
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_byte_ranges() {
        let range = resolve_range(Some("bytes=2-5"), 10).unwrap();
        assert_eq!((range.start, range.length), (2, 4));
        assert_eq!(range.content_range.as_deref(), Some("bytes 2-5/10"));

        let range = resolve_range(Some("bytes=-3"), 10).unwrap();
        assert_eq!((range.start, range.length), (7, 3));

        let range = resolve_range(Some("bytes=8-"), 10).unwrap();
        assert_eq!((range.start, range.length), (8, 2));
    }

    #[test]
    fn rejects_multiple_or_out_of_bounds_ranges() {
        assert!(resolve_range(Some("bytes=0-1,3-4"), 10).is_err());
        assert!(resolve_range(Some("bytes=10-11"), 10).is_err());
        assert!(resolve_range(Some("items=0-1"), 10).is_err());
    }

    #[test]
    fn accepts_hash_with_safe_optional_extension() {
        let hash = "a".repeat(64);
        assert_eq!(parse_blob_segment(&hash).unwrap(), hash);
        assert_eq!(
            parse_blob_segment(&format!("{hash}.pmtiles")).unwrap(),
            hash
        );
        assert!(parse_blob_segment(&format!("{hash}../secret")).is_err());
    }

    #[tokio::test]
    async fn adopts_staging_with_atomic_rename_and_preserves_existing_blob() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("target");
        let first = directory.path().join("first.upload");
        fs::write(&first, b"first").await.unwrap();

        assert!(adopt_staging(&first, &target).await.unwrap());
        assert_eq!(fs::read(&target).await.unwrap(), b"first");

        let duplicate = directory.path().join("duplicate.upload");
        fs::write(&duplicate, b"duplicate").await.unwrap();
        assert!(!adopt_staging(&duplicate, &target).await.unwrap());
        assert_eq!(fs::read(&target).await.unwrap(), b"first");
        assert!(!duplicate.exists());
    }
}
