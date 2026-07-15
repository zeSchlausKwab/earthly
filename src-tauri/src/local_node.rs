use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_local_node::{
    LocalBlobReadError, LocalNode, NodeAvailability, NodeBind, NodeConfig, NodeDescriptor,
    PairingCapability, PairingError, PeerGrant, PendingPairingClaim, RemoteBlobMirrorError,
    RemoteBlobMirrorResult, RemoteNodeError, RemoteNodeRecord, RemoteSyncError, RemoteSyncResult,
};
use nostr::{EventId, PublicKey};
use serde::Serialize;
use tauri::http::header::{
    ACCEPT_RANGES, ACCESS_CONTROL_ALLOW_HEADERS, ACCESS_CONTROL_ALLOW_METHODS,
    ACCESS_CONTROL_ALLOW_ORIGIN, ACCESS_CONTROL_EXPOSE_HEADERS, ALLOW, CACHE_CONTROL,
    CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, RANGE,
};
use tauri::http::{Method, Request, Response, StatusCode};
use tauri::{
    AppHandle, Manager, Runtime as TauriRuntime, State, UriSchemeContext, UriSchemeResponder,
};
use tokio::sync::Mutex as AsyncMutex;

const MIN_LAN_DURATION_SECONDS: u64 = 60;
const MAX_LAN_DURATION_SECONDS: u64 = 60 * 60;
const NODE_RELEASE_ATTEMPTS: usize = 100;
const NODE_RELEASE_RETRY: Duration = Duration::from_millis(20);
const LOCAL_BLOB_PROTOCOL_RESPONSE_LIMIT: u64 = 64 * 1024 * 1024;

#[derive(Debug)]
pub struct LocalNodeState {
    runtime: RwLock<Runtime>,
    data_dir: RwLock<Option<PathBuf>>,
    reconfigure: AsyncMutex<()>,
    lan_generation: AtomicU64,
    lan_expires_at: AtomicU64,
}

impl LocalNodeState {
    pub fn starting() -> Self {
        Self {
            runtime: RwLock::new(Runtime::Starting),
            data_dir: RwLock::new(None),
            reconfigure: AsyncMutex::new(()),
            lan_generation: AtomicU64::new(0),
            lan_expires_at: AtomicU64::new(0),
        }
    }

    pub fn shutdown(&self) {
        self.lan_generation.fetch_add(1, Ordering::SeqCst);
        self.lan_expires_at.store(0, Ordering::SeqCst);
        if let Ok(runtime) = self.runtime.read() {
            if let Runtime::Running(node) = &*runtime {
                node.shutdown();
            }
        }
    }

    fn replace(&self, runtime: Runtime) {
        match self.runtime.write() {
            Ok(mut current) => *current = runtime,
            Err(poisoned) => *poisoned.into_inner() = runtime,
        }
    }

    fn set_data_dir(&self, data_dir: PathBuf) {
        match self.data_dir.write() {
            Ok(mut current) => *current = Some(data_dir),
            Err(poisoned) => *poisoned.into_inner() = Some(data_dir),
        }
    }

    fn data_dir(&self) -> Result<PathBuf, LocalNodeCommandError> {
        let data_dir = match self.data_dir.read() {
            Ok(data_dir) => data_dir,
            Err(poisoned) => poisoned.into_inner(),
        };
        data_dir.clone().ok_or_else(|| {
            LocalNodeCommandError::new("node-starting", "The local node is still starting")
        })
    }

    fn status(&self) -> LocalNodeStatus {
        let runtime = match self.runtime.read() {
            Ok(runtime) => runtime,
            Err(poisoned) => poisoned.into_inner(),
        };
        match &*runtime {
            Runtime::Starting => LocalNodeStatus::Starting,
            Runtime::Running(node) => LocalNodeStatus::Running {
                descriptor: node.descriptor().clone(),
                lan_expires_at: nonzero(self.lan_expires_at.load(Ordering::SeqCst)),
            },
            Runtime::Failed { message } => LocalNodeStatus::Failed {
                message: message.clone(),
            },
        }
    }

    fn node(&self) -> Result<Arc<LocalNode>, LocalNodeCommandError> {
        let runtime = match self.runtime.read() {
            Ok(runtime) => runtime,
            Err(poisoned) => poisoned.into_inner(),
        };
        match &*runtime {
            Runtime::Starting => Err(LocalNodeCommandError::new(
                "node-starting",
                "The local node is still starting",
            )),
            Runtime::Running(node) => Ok(Arc::clone(node)),
            Runtime::Failed { message } => {
                Err(LocalNodeCommandError::new("node-failed", message.clone()))
            }
        }
    }

    fn take_node(&self) -> Result<Arc<LocalNode>, LocalNodeCommandError> {
        let mut runtime = match self.runtime.write() {
            Ok(runtime) => runtime,
            Err(poisoned) => poisoned.into_inner(),
        };
        match std::mem::replace(&mut *runtime, Runtime::Starting) {
            Runtime::Running(node) => Ok(node),
            Runtime::Starting => Err(LocalNodeCommandError::new(
                "node-starting",
                "The local node is still starting",
            )),
            Runtime::Failed { message } => {
                *runtime = Runtime::Failed {
                    message: message.clone(),
                };
                Err(LocalNodeCommandError::new("node-failed", message))
            }
        }
    }

    async fn reconfigure(&self, bind: NodeBind) -> Result<NodeDescriptor, LocalNodeCommandError> {
        let _guard = self.reconfigure.lock().await;
        if let Ok(node) = self.node() {
            if node_matches_bind(&node, bind) {
                return Ok(node.descriptor().clone());
            }
        }

        let data_dir = self.data_dir()?;
        let node = self.take_node()?;
        if let Err((error, node)) = release_node(node).await {
            self.replace(Runtime::Running(node));
            return Err(error);
        }

        let desired = node_config(data_dir.clone(), bind);
        match LocalNode::start(desired).await {
            Ok(node) => {
                let descriptor = node.descriptor().clone();
                self.replace(Runtime::Running(Arc::new(node)));
                Ok(descriptor)
            }
            Err(error) => {
                let fallback = LocalNode::start(node_config(data_dir, NodeBind::Loopback)).await;
                match fallback {
                    Ok(node) => self.replace(Runtime::Running(Arc::new(node))),
                    Err(fallback_error) => self.replace(Runtime::Failed {
                        message: format!(
                            "LAN start failed ({error}); loopback recovery failed ({fallback_error})"
                        ),
                    }),
                }
                Err(LocalNodeCommandError::new(
                    "lan-start-failed",
                    format!("Could not serve the local node on {bind:?}: {error}"),
                ))
            }
        }
    }

    fn begin_lan_session(&self, duration_seconds: u64) -> (u64, u64) {
        let expires_at = now_seconds().saturating_add(duration_seconds);
        let generation = self.lan_generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.lan_expires_at.store(expires_at, Ordering::SeqCst);
        (generation, expires_at)
    }

    fn invalidate_lan_session(&self) {
        self.lan_generation.fetch_add(1, Ordering::SeqCst);
        self.lan_expires_at.store(0, Ordering::SeqCst);
    }

    fn lan_session_is_current(&self, generation: u64, expires_at: u64) -> bool {
        self.lan_generation.load(Ordering::SeqCst) == generation
            && self.lan_expires_at.load(Ordering::SeqCst) == expires_at
    }
}

#[derive(Debug)]
enum Runtime {
    Starting,
    Running(Arc<LocalNode>),
    Failed { message: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum LocalNodeStatus {
    Starting,
    Running {
        descriptor: NodeDescriptor,
        lan_expires_at: Option<u64>,
    },
    Failed {
        message: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkAddressView {
    address: String,
    interface_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalNodeCommandError {
    code: String,
    message: String,
}

impl LocalNodeCommandError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn invalid_identifier(kind: &str) -> Self {
        Self::new(
            "invalid-identifier",
            format!("The supplied {kind} is not a valid Nostr identifier"),
        )
    }
}

impl From<PairingError> for LocalNodeCommandError {
    fn from(error: PairingError) -> Self {
        Self::new("pairing-failed", error.to_string())
    }
}

impl From<RemoteNodeError> for LocalNodeCommandError {
    fn from(error: RemoteNodeError) -> Self {
        Self::new("remote-pairing-failed", error.to_string())
    }
}

impl From<RemoteSyncError> for LocalNodeCommandError {
    fn from(error: RemoteSyncError) -> Self {
        Self::new("remote-sync-failed", error.to_string())
    }
}

impl From<RemoteBlobMirrorError> for LocalNodeCommandError {
    fn from(error: RemoteBlobMirrorError) -> Self {
        Self::new("remote-blob-mirror-failed", error.to_string())
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInvitationView {
    version: u8,
    encoded: String,
    expires_at: u64,
    capabilities: Vec<PairingCapability>,
    descriptor: NodeDescriptor,
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn nonzero(value: u64) -> Option<u64> {
    (value > 0).then_some(value)
}

fn node_config(data_dir: PathBuf, bind: NodeBind) -> NodeConfig {
    let availability = node_availability(bind, cfg!(target_os = "android"));
    let mut config = NodeConfig::loopback(data_dir, availability);
    config.bind = bind;
    config
}

fn node_availability(bind: NodeBind, android_foreground_service: bool) -> NodeAvailability {
    if android_foreground_service && matches!(bind, NodeBind::LocalNetwork(_)) {
        NodeAvailability::ForegroundService
    } else {
        NodeAvailability::Process
    }
}

fn node_matches_bind(node: &LocalNode, bind: NodeBind) -> bool {
    let Ok(ip) = bind.ip() else {
        return false;
    };
    node.descriptor().scope == bind.scope()
        && node.descriptor().relay_url.host_str() == Some(ip.to_string().as_str())
}

async fn release_node(
    mut node: Arc<LocalNode>,
) -> Result<(), (LocalNodeCommandError, Arc<LocalNode>)> {
    for _ in 0..NODE_RELEASE_ATTEMPTS {
        match Arc::try_unwrap(node) {
            Ok(node) => {
                drop(node);
                return Ok(());
            }
            Err(returned) => {
                node = returned;
                tokio::time::sleep(NODE_RELEASE_RETRY).await;
            }
        }
    }
    Err((
        LocalNodeCommandError::new(
            "node-busy",
            "The local node is busy; wait for the current operation and try again",
        ),
        node,
    ))
}

fn network_addresses() -> Result<Vec<NetworkAddressView>, LocalNodeCommandError> {
    let mut addresses: Vec<_> = if_addrs::get_if_addrs()
        .map_err(|error| LocalNodeCommandError::new("network-scan-failed", error.to_string()))?
        .into_iter()
        .filter_map(|interface| match interface.ip() {
            IpAddr::V4(address)
                if !address.is_loopback() && (address.is_private() || address.is_link_local()) =>
            {
                Some(NetworkAddressView {
                    address: address.to_string(),
                    interface_name: interface.name,
                })
            }
            _ => None,
        })
        .collect();
    addresses.sort_by(|left, right| {
        interface_priority(&left.interface_name)
            .cmp(&interface_priority(&right.interface_name))
            .then_with(|| left.address.cmp(&right.address))
            .then_with(|| left.interface_name.cmp(&right.interface_name))
    });
    addresses.dedup_by(|left, right| left.address == right.address);
    Ok(addresses)
}

fn interface_priority(name: &str) -> u8 {
    let name = name.to_ascii_lowercase();
    if name == "en0" || name.starts_with("wlan") || name.starts_with("wlp") {
        0
    } else if name.starts_with("en") || name.starts_with("eth") {
        1
    } else if name.starts_with("ap") || name.starts_with("bridge") {
        2
    } else if ["utun", "tun", "tap", "wg", "vpn", "tailscale"]
        .iter()
        .any(|prefix| name.starts_with(prefix))
    {
        4
    } else {
        3
    }
}

pub fn start(app: AppHandle, data_dir: PathBuf) {
    app.state::<LocalNodeState>().set_data_dir(data_dir.clone());
    tauri::async_runtime::spawn(async move {
        let config = node_config(data_dir, NodeBind::Loopback);
        let runtime = match LocalNode::start(config).await {
            Ok(node) => Runtime::Running(Arc::new(node)),
            Err(error) => Runtime::Failed {
                message: error.to_string(),
            },
        };
        app.state::<LocalNodeState>().replace(runtime);
    });
}

#[tauri::command]
pub fn local_node_status(state: State<'_, LocalNodeState>) -> LocalNodeStatus {
    state.status()
}

#[tauri::command]
pub fn local_node_status_v1(state: State<'_, LocalNodeState>) -> LocalNodeStatus {
    state.status()
}

#[tauri::command]
pub fn local_node_network_addresses_v1() -> Result<Vec<NetworkAddressView>, LocalNodeCommandError> {
    network_addresses()
}

#[tauri::command]
pub async fn local_node_enable_lan_v1(
    app: AppHandle,
    state: State<'_, LocalNodeState>,
    address: String,
    duration_seconds: u64,
) -> Result<LocalNodeStatus, LocalNodeCommandError> {
    if !(MIN_LAN_DURATION_SECONDS..=MAX_LAN_DURATION_SECONDS).contains(&duration_seconds) {
        return Err(LocalNodeCommandError::new(
            "invalid-lan-duration",
            "LAN serving must last between one minute and one hour",
        ));
    }
    let address: Ipv4Addr = address.parse().map_err(|_| {
        LocalNodeCommandError::new(
            "invalid-lan-address",
            "Choose an available private IPv4 address",
        )
    })?;
    let address_text = address.to_string();
    if !network_addresses()?
        .iter()
        .any(|candidate| candidate.address == address_text)
    {
        return Err(LocalNodeCommandError::new(
            "lan-address-unavailable",
            "That local-network address is no longer available on this device",
        ));
    }

    crate::android_lifecycle::prepare(&app)
        .await
        .map_err(|error| LocalNodeCommandError::new("notification-permission-required", error))?;

    state
        .reconfigure(NodeBind::LocalNetwork(IpAddr::V4(address)))
        .await?;
    let (generation, expires_at) = state.begin_lan_session(duration_seconds);
    if let Err(error) = crate::android_lifecycle::start(&app, &address_text, expires_at).await {
        state.invalidate_lan_session();
        let recovery = state.reconfigure(NodeBind::Loopback).await;
        let message = match recovery {
            Ok(_) => error,
            Err(recovery_error) => format!("{error}; loopback recovery failed: {recovery_error:?}"),
        };
        return Err(LocalNodeCommandError::new(
            "foreground-service-failed",
            message,
        ));
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(duration_seconds)).await;
        let state = app.state::<LocalNodeState>();
        if state.lan_session_is_current(generation, expires_at) {
            state.invalidate_lan_session();
            let _ = state.reconfigure(NodeBind::Loopback).await;
            let _ = crate::android_lifecycle::stop(&app).await;
        }
    });
    Ok(state.status())
}

#[tauri::command]
pub async fn local_node_disable_lan_v1(
    app: AppHandle,
    state: State<'_, LocalNodeState>,
) -> Result<LocalNodeStatus, LocalNodeCommandError> {
    state.invalidate_lan_session();
    state.reconfigure(NodeBind::Loopback).await?;
    if let Err(error) = crate::android_lifecycle::stop(&app).await {
        eprintln!("failed to stop Android sharing notification: {error}");
    }
    Ok(state.status())
}

#[tauri::command]
pub async fn local_node_create_invitation_v1(
    state: State<'_, LocalNodeState>,
) -> Result<PairingInvitationView, LocalNodeCommandError> {
    let node = state.node()?;
    let invitation = node
        .create_pairing_invitation(
            Duration::from_secs(10 * 60),
            PairingCapability::initial_set(),
        )
        .await?;
    let content = invitation.content()?;
    Ok(PairingInvitationView {
        version: content.version,
        encoded: invitation.encode()?,
        expires_at: content.expires_at,
        capabilities: content.capabilities,
        descriptor: content.descriptor,
    })
}

#[tauri::command]
pub async fn local_node_pending_claims_v1(
    state: State<'_, LocalNodeState>,
) -> Result<Vec<PendingPairingClaim>, LocalNodeCommandError> {
    Ok(state.node()?.pending_pairing_claims().await?)
}

#[tauri::command]
pub async fn local_node_approve_claim_v1(
    state: State<'_, LocalNodeState>,
    claim_id: String,
) -> Result<PendingPairingClaim, LocalNodeCommandError> {
    let claim_id = EventId::from_hex(&claim_id)
        .map_err(|_| LocalNodeCommandError::invalid_identifier("claim id"))?;
    Ok(state.node()?.approve_pairing_claim(claim_id).await?)
}

#[tauri::command]
pub async fn local_node_reject_claim_v1(
    state: State<'_, LocalNodeState>,
    claim_id: String,
    reason: String,
) -> Result<(), LocalNodeCommandError> {
    let claim_id = EventId::from_hex(&claim_id)
        .map_err(|_| LocalNodeCommandError::invalid_identifier("claim id"))?;
    state.node()?.reject_pairing_claim(claim_id, reason).await?;
    Ok(())
}

#[tauri::command]
pub async fn local_node_peer_grants_v1(
    state: State<'_, LocalNodeState>,
) -> Result<Vec<PeerGrant>, LocalNodeCommandError> {
    Ok(state.node()?.peer_grants().await)
}

#[tauri::command]
pub async fn local_node_revoke_peer_v1(
    state: State<'_, LocalNodeState>,
    peer_pubkey: String,
) -> Result<bool, LocalNodeCommandError> {
    let peer = PublicKey::from_hex(&peer_pubkey)
        .map_err(|_| LocalNodeCommandError::invalid_identifier("peer public key"))?;
    state
        .node()?
        .revoke_peer(&peer)
        .await
        .map_err(|error| LocalNodeCommandError::new("revoke-failed", error.to_string()))
}

#[tauri::command]
pub async fn local_node_join_invitation_v1(
    state: State<'_, LocalNodeState>,
    invitation: String,
    peer_name: Option<String>,
) -> Result<RemoteNodeRecord, LocalNodeCommandError> {
    Ok(state
        .node()?
        .join_pairing_invitation(invitation.trim(), peer_name)
        .await?)
}

#[tauri::command]
pub async fn local_node_remote_nodes_v1(
    state: State<'_, LocalNodeState>,
) -> Result<Vec<RemoteNodeRecord>, LocalNodeCommandError> {
    let remote_nodes = state.node()?.remote_node_store();
    Ok(remote_nodes.list().await?)
}

#[tauri::command]
pub async fn local_node_refresh_remote_node_v1(
    state: State<'_, LocalNodeState>,
    node_id: String,
) -> Result<RemoteNodeRecord, LocalNodeCommandError> {
    let remote_nodes = state.node()?.remote_node_store();
    Ok(remote_nodes.refresh(&node_id).await?)
}

#[tauri::command]
pub async fn local_node_forget_remote_node_v1(
    state: State<'_, LocalNodeState>,
    node_id: String,
) -> Result<bool, LocalNodeCommandError> {
    let remote_nodes = state.node()?.remote_node_store();
    Ok(remote_nodes.forget(&node_id).await?)
}

#[tauri::command]
pub async fn local_node_sync_remote_node_v1(
    state: State<'_, LocalNodeState>,
    node_id: String,
) -> Result<RemoteSyncResult, LocalNodeCommandError> {
    Ok(state.node()?.sync_remote_node(&node_id).await?)
}

#[tauri::command]
pub async fn local_node_mirror_remote_blobs_v1(
    state: State<'_, LocalNodeState>,
    node_id: String,
    hashes: Vec<String>,
) -> Result<RemoteBlobMirrorResult, LocalNodeCommandError> {
    Ok(state.node()?.mirror_remote_blobs(&node_id, hashes).await?)
}

pub fn local_blob_protocol<R: TauriRuntime>(
    context: UriSchemeContext<'_, R>,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if context.webview_label() != "main" {
        responder.respond(local_blob_error_response(
            StatusCode::FORBIDDEN,
            "local blobs are available only to Earthly's main webview",
            None,
        ));
        return;
    }
    if request.method() == Method::OPTIONS {
        responder.respond(
            local_blob_response_builder(StatusCode::NO_CONTENT)
                .header(CONTENT_LENGTH, "0")
                .body(Vec::new())
                .expect("static local blob response is valid"),
        );
        return;
    }
    if request.method() != Method::GET && request.method() != Method::HEAD {
        let mut response = local_blob_error_response(
            StatusCode::METHOD_NOT_ALLOWED,
            "local blobs support only GET and HEAD",
            None,
        );
        response.headers_mut().insert(
            ALLOW,
            "GET, HEAD, OPTIONS".parse().expect("valid Allow header"),
        );
        responder.respond(response);
        return;
    }

    let Some(hash) = request.uri().path().strip_prefix('/').filter(|path| {
        path.len() == 64
            && path
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }) else {
        responder.respond(local_blob_error_response(
            StatusCode::BAD_REQUEST,
            "local blob path must be a lowercase SHA-256 hash",
            None,
        ));
        return;
    };
    let range = match request.headers().get(RANGE) {
        Some(value) => match value.to_str() {
            Ok(value) => Some(value.to_owned()),
            Err(_) => {
                responder.respond(local_blob_error_response(
                    StatusCode::RANGE_NOT_SATISFIABLE,
                    "invalid local blob Range header",
                    None,
                ));
                return;
            }
        },
        None => None,
    };
    let include_body = request.method() == Method::GET;
    let hash = hash.to_owned();
    let node = match context.app_handle().state::<LocalNodeState>().node() {
        Ok(node) => node,
        Err(error) => {
            responder.respond(local_blob_error_response(
                StatusCode::SERVICE_UNAVAILABLE,
                &error.message,
                None,
            ));
            return;
        }
    };

    tauri::async_runtime::spawn(async move {
        let response = match node
            .read_local_blob(
                &hash,
                range.as_deref(),
                include_body,
                LOCAL_BLOB_PROTOCOL_RESPONSE_LIMIT,
            )
            .await
        {
            Ok(blob) => {
                let status = if blob.partial {
                    StatusCode::PARTIAL_CONTENT
                } else {
                    StatusCode::OK
                };
                let mut builder = local_blob_response_builder(status)
                    .header(ACCEPT_RANGES, "bytes")
                    .header(CONTENT_LENGTH, blob.length.to_string())
                    .header(CONTENT_TYPE, blob.media_type)
                    .header(ETAG, format!("\"{hash}\""))
                    .header(CACHE_CONTROL, "public, max-age=31536000, immutable")
                    .header("x-content-type-options", "nosniff");
                if blob.partial {
                    let end = blob.start + blob.length - 1;
                    builder = builder.header(
                        CONTENT_RANGE,
                        format!("bytes {}-{end}/{}", blob.start, blob.total_size),
                    );
                }
                builder
                    .body(blob.bytes)
                    .expect("validated local blob response is valid")
            }
            Err(LocalBlobReadError::InvalidHash) => local_blob_error_response(
                StatusCode::BAD_REQUEST,
                "invalid local blob SHA-256",
                None,
            ),
            Err(LocalBlobReadError::NotFound) => {
                local_blob_error_response(StatusCode::NOT_FOUND, "local blob was not found", None)
            }
            Err(LocalBlobReadError::InvalidRange { size }) => local_blob_error_response(
                StatusCode::RANGE_NOT_SATISFIABLE,
                "invalid local blob range",
                Some(format!("bytes */{size}")),
            ),
            Err(LocalBlobReadError::ResponseTooLarge { .. }) => local_blob_error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "local blob is too large for one response; request a byte range",
                None,
            ),
            Err(LocalBlobReadError::Io(_)) => local_blob_error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "local blob could not be read",
                None,
            ),
        };
        responder.respond(response);
    });
}

fn local_blob_response_builder(status: StatusCode) -> tauri::http::response::Builder {
    Response::builder()
        .status(status)
        .header(ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(ACCESS_CONTROL_ALLOW_METHODS, "GET, HEAD, OPTIONS")
        .header(ACCESS_CONTROL_ALLOW_HEADERS, "Range")
        .header(
            ACCESS_CONTROL_EXPOSE_HEADERS,
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag",
        )
}

fn local_blob_error_response(
    status: StatusCode,
    message: &str,
    content_range: Option<String>,
) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    let mut builder = local_blob_response_builder(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CONTENT_LENGTH, body.len().to_string())
        .header(CACHE_CONTROL, "no-store");
    if let Some(content_range) = content_range {
        builder = builder.header(CONTENT_RANGE, content_range);
    }
    builder
        .body(body)
        .expect("static local blob error response is valid")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prioritizes_physical_wifi_over_tunnel_interfaces() {
        assert!(interface_priority("wlan0") < interface_priority("tun0"));
        assert!(interface_priority("en0") < interface_priority("utun4"));
        assert!(interface_priority("eth0") < interface_priority("tailscale0"));
    }

    #[test]
    fn local_blob_responses_expose_range_metadata_to_the_webview() {
        let response = local_blob_response_builder(StatusCode::OK)
            .body(Vec::<u8>::new())
            .unwrap();
        assert_eq!(
            response
                .headers()
                .get(ACCESS_CONTROL_EXPOSE_HEADERS)
                .unwrap(),
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, ETag"
        );
    }

    #[test]
    fn advertises_foreground_service_only_for_android_lan_sessions() {
        assert_eq!(
            node_availability(
                NodeBind::LocalNetwork(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 4))),
                true,
            ),
            NodeAvailability::ForegroundService
        );
        assert_eq!(
            node_availability(NodeBind::Loopback, true),
            NodeAvailability::Process
        );
        assert_eq!(
            node_availability(
                NodeBind::LocalNetwork(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 4))),
                false,
            ),
            NodeAvailability::Process
        );
    }
}
