use std::net::{IpAddr, Ipv6Addr, UdpSocket};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::Duration;

use earthly_local_node::{
    EndpointScope, FieldSessionConversationPolicy, FieldSessionInfo, FieldSessionInternetPolicy,
    LocalNode, NodeAvailability, NodeBind, NodeConfig, PairingCapability, PairingInvitation,
    PairingInvitationContent, PairingStatus, RemoteNodeRecord,
};
use earthly_spatial::{PmtilesHeader, TileFormat};
use earthly_storage::OutboxStore;
use nostr::{EventId, PublicKey};

static LOCAL_NODE: OnceLock<RwLock<Option<Arc<LocalNode>>>> = OnceLock::new();

fn node_slot() -> &'static RwLock<Option<Arc<LocalNode>>> {
    LOCAL_NODE.get_or_init(|| RwLock::new(None))
}

#[derive(Clone, Debug)]
pub struct LocalNodeSnapshot {
    pub running: bool,
    pub node_id: Option<String>,
    pub relay_url: Option<String>,
    pub blossom_url: Option<String>,
    pub scope: Option<String>,
    pub availability: Option<String>,
}

#[derive(Clone, Debug)]
pub struct PmtilesHeaderSnapshot {
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
    pub clustered: bool,
}

#[derive(Clone, Debug)]
pub struct IngestedPmtilesSnapshot {
    pub label: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub blob_url: String,
    pub authorization: String,
    pub header: PmtilesHeaderSnapshot,
}

#[derive(Clone, Debug)]
pub struct IngestedBlobSnapshot {
    pub sha256: String,
    pub size_bytes: u64,
    pub mime_type: String,
    pub blob_url: String,
    pub authorization: String,
}

#[derive(Clone, Debug)]
pub struct DecodedFieldSessionInviteDto {
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub description: Option<String>,
    pub node_id: String,
    pub relay_url: String,
    pub blossom_url: String,
    pub allow_peer_writes: bool,
    pub expires_at: u64,
}

#[derive(Clone, Debug)]
pub struct PendingClaimDto {
    pub claim_id: String,
    pub peer_pubkey: String,
    pub peer_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ApprovedPeerDto {
    pub peer_pubkey: String,
    pub capabilities: Vec<String>,
    pub session_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct RemotePeerDto {
    pub node_id: String,
    pub peer_name: Option<String>,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub relay_url: String,
    pub blossom_url: String,
    pub status: String,
    pub rejection_reason: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NearbyPeersSnapshot {
    pub pending_claims: Vec<PendingClaimDto>,
    pub approved_peers: Vec<ApprovedPeerDto>,
    pub remote_peers: Vec<RemotePeerDto>,
}

#[derive(Clone, Debug)]
pub struct OutboxSummarySnapshot {
    pub total: u64,
    pub queued: u64,
    pub delivered: u64,
    pub partial: u64,
    pub retry_wait: u64,
    pub rejected: u64,
}

#[flutter_rust_bridge::frb(init)]
pub fn init_app() {
    flutter_rust_bridge::setup_default_user_utils();
}

/// Start (or reuse) Earthly's embedded Nostr relay + Blossom node on loopback.
pub async fn start_local_node(data_dir: String) -> Result<LocalNodeSnapshot, String> {
    if let Some(existing) = current_node() {
        return Ok(snapshot_from_node(&existing));
    }

    let config = NodeConfig::loopback(data_dir, NodeAvailability::Process).with_ephemeral_ports();
    let node = LocalNode::start(config)
        .await
        .map_err(|error| format!("failed to start local node: {error}"))?;
    let node = Arc::new(node);
    let snapshot = snapshot_from_node(&node);

    let mut guard = node_slot()
        .write()
        .map_err(|_| "local node lock poisoned".to_owned())?;
    if let Some(already) = guard.as_ref() {
        return Ok(snapshot_from_node(already));
    }
    *guard = Some(node);
    Ok(snapshot)
}

/// Start (or restart) Earthly's embedded relay + Blossom node bound to this
/// device's private Wi-Fi/LAN IPv4 address so nearby peers can sync directly.
pub async fn start_local_node_lan(data_dir: String) -> Result<LocalNodeSnapshot, String> {
    let lan_ip = detect_private_lan_ip().ok_or_else(|| {
        "No private Wi-Fi/LAN IPv4 address detected (connect to local Wi-Fi or hotspot first)"
            .to_owned()
    })?;

    // If a loopback-only node is running, shut it down before binding LAN.
    if let Some(existing) = current_node() {
        if existing.descriptor().scope == EndpointScope::LocalNetwork {
            return Ok(snapshot_from_node(&existing));
        }
        shutdown_local_node();
    }

    let mut config =
        NodeConfig::loopback(data_dir, NodeAvailability::Foreground).with_ephemeral_ports();
    config.bind = NodeBind::LocalNetwork(lan_ip);

    let node = LocalNode::start(config)
        .await
        .map_err(|error| format!("failed to start LAN local node on {lan_ip}: {error}"))?;
    let node = Arc::new(node);
    let snapshot = snapshot_from_node(&node);

    let mut guard = node_slot()
        .write()
        .map_err(|_| "local node lock poisoned".to_owned())?;
    *guard = Some(node);
    Ok(snapshot)
}

/// Start (or restart) Earthly's embedded relay + Blossom node bound to a FIPS
/// mesh IPv6 ULA (`fd00::/8`) interface so peers across a FIPS overlay network
/// can pair and sync directly.
pub async fn start_local_node_fips(
    data_dir: String,
    fips_ipv6: Option<String>,
) -> Result<LocalNodeSnapshot, String> {
    let v6: Ipv6Addr = match fips_ipv6.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => raw
            .parse::<Ipv6Addr>()
            .map_err(|err| format!("invalid FIPS IPv6 address \"{raw}\": {err}"))?,
        None => detect_fips_ula_v6().ok_or_else(|| {
            "No FIPS fd00::/8 IPv6 interface detected. Start your FIPS daemon or enter your fd00:: address manually."
                .to_owned()
        })?,
    };
    if v6.octets()[0] != 0xfd {
        return Err(format!(
            "Address {v6} is not in the FIPS ULA range (fd00::/8)"
        ));
    }

    if let Some(existing) = current_node() {
        if existing.descriptor().scope == EndpointScope::FipsMesh {
            return Ok(snapshot_from_node(&existing));
        }
        shutdown_local_node();
    }

    let mut config =
        NodeConfig::loopback(data_dir, NodeAvailability::Foreground).with_ephemeral_ports();
    config.bind = NodeBind::FipsMesh(v6);

    let node = LocalNode::start(config)
        .await
        .map_err(|error| format!("failed to start FIPS mesh node on [{v6}]: {error}"))?;
    let node = Arc::new(node);
    let snapshot = snapshot_from_node(&node);

    let mut guard = node_slot()
        .write()
        .map_err(|_| "local node lock poisoned".to_owned())?;
    *guard = Some(node);
    Ok(snapshot)
}

/// Resolves the live local Blossom URL (`http://.../<sha256>`) for an already
/// ingested `.pmtiles` archive persisted on disk inside the LocalNode data dir.
pub fn resolve_local_blob_url(sha256: String) -> Option<String> {
    let node = current_node()?;
    let trimmed = sha256.trim();
    if trimmed.is_empty() {
        return None;
    }
    let base = node.descriptor().blossom_url.to_string();
    Some(format!("{}/{trimmed}", base.trim_end_matches('/')))
}

/// Decodes and cryptographically verifies an Earthly Field Session pairing link
/// (`earthly://pair?invitation=earthly-pair-v1:...` or bare `earthly-pair-v1:...`).
pub fn decode_field_session_invite(
    raw_link: String,
) -> Result<DecodedFieldSessionInviteDto, String> {
    let trimmed = raw_link.trim();
    let token = if let Some((_, rest)) = trimmed.split_once("invitation=") {
        rest.split('&').next().unwrap_or(rest)
    } else {
        trimmed
    };
    let invitation = PairingInvitation::decode(token)
        .map_err(|err| format!("invalid pairing invitation: {err}"))?;
    invitation
        .event
        .verify()
        .map_err(|err| format!("pairing invitation signature invalid: {err}"))?;
    let content: PairingInvitationContent = serde_json::from_str(&invitation.event.content)
        .map_err(|err| format!("malformed invitation payload: {err}"))?;
    let fs = content.field_session;
    Ok(DecodedFieldSessionInviteDto {
        session_id: fs.as_ref().map(|s| s.id.clone()),
        session_name: fs.as_ref().map(|s| s.name.clone()),
        description: fs.as_ref().and_then(|s| s.description.clone()),
        node_id: content.descriptor.node_id,
        relay_url: content.descriptor.relay_url.to_string(),
        blossom_url: content.descriptor.blossom_url.to_string(),
        allow_peer_writes: fs.as_ref().map(|s| s.allow_peer_writes).unwrap_or(false),
        expires_at: content.expires_at,
    })
}

fn detect_private_lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind("0.0.0.0:0").ok()?;
    socket.connect("192.0.2.1:80").ok()?;
    let addr = socket.local_addr().ok()?.ip();
    match addr {
        IpAddr::V4(v4) if v4.is_private() || v4.is_link_local() => Some(IpAddr::V4(v4)),
        _ => None,
    }
}

fn detect_fips_ula_v6() -> Option<Ipv6Addr> {
    let socket = UdpSocket::bind("[::]:0").ok()?;
    socket.connect("[fd00::1]:80").ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V6(v6) if v6.octets()[0] == 0xfd => Some(v6),
        _ => None,
    }
}

pub fn local_node_status() -> LocalNodeSnapshot {
    match current_node() {
        Some(node) => snapshot_from_node(&node),
        None => LocalNodeSnapshot {
            running: false,
            node_id: None,
            relay_url: None,
            blossom_url: None,
            scope: None,
            availability: None,
        },
    }
}

pub fn shutdown_local_node() -> bool {
    let Ok(mut guard) = node_slot().write() else {
        return false;
    };
    if let Some(node) = guard.take() {
        node.shutdown();
        true
    } else {
        false
    }
}

/// Parse and validate a 127-byte PMTiles v3 header purely in Rust (`earthly-spatial`).
pub fn inspect_pmtiles_header(bytes: Vec<u8>) -> Result<PmtilesHeaderSnapshot, String> {
    let header = PmtilesHeader::parse(&bytes).map_err(|error| error.to_string())?;
    Ok(header_to_snapshot(&header))
}

/// Validate a PMTiles v3 archive, persist it in the running local Blossom server,
/// and return an authenticated loopback URL for MapLibre Native byte-range reads.
pub async fn ingest_local_pmtiles(
    bytes: Vec<u8>,
    label: String,
) -> Result<IngestedPmtilesSnapshot, String> {
    let header = PmtilesHeader::parse(&bytes).map_err(|error| error.to_string())?;
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let descriptor = node
        .store_local_bytes(&bytes, "application/vnd.pmtiles")
        .await
        .map_err(|error| format!("failed to store PMTiles blob: {error}"))?;
    let access = node
        .local_blob_access(&descriptor.sha256)
        .map_err(|error| format!("failed to create local blob access token: {error}"))?;

    Ok(IngestedPmtilesSnapshot {
        label,
        sha256: descriptor.sha256,
        size_bytes: descriptor.size,
        blob_url: access.url,
        authorization: access.authorization,
        header: header_to_snapshot(&header),
    })
}

/// Store arbitrary media bytes (e.g. a field Sighting JPEG photo) in the local
/// embedded Blossom server and return its SHA-256 and loopback access URL.
pub async fn ingest_local_blob(
    bytes: Vec<u8>,
    mime_type: String,
) -> Result<IngestedBlobSnapshot, String> {
    if bytes.is_empty() {
        return Err("blob bytes must not be empty".to_owned());
    }
    let mime = if mime_type.trim().is_empty() {
        "application/octet-stream".to_owned()
    } else {
        mime_type.trim().to_owned()
    };
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let descriptor = node
        .store_local_bytes(&bytes, &mime)
        .await
        .map_err(|error| format!("failed to store local blob: {error}"))?;
    let access = node
        .local_blob_access(&descriptor.sha256)
        .map_err(|error| format!("failed to create local blob access token: {error}"))?;
    Ok(IngestedBlobSnapshot {
        sha256: descriptor.sha256,
        size_bytes: descriptor.size,
        mime_type: mime,
        blob_url: access.url,
        authorization: access.authorization,
    })
}

/// Open the SQLite durable outbox (`earthly-storage`) and return redacted counts.
pub fn outbox_summary(database_path: String) -> Result<OutboxSummarySnapshot, String> {
    let store = OutboxStore::open(database_path).map_err(|error| error.to_string())?;
    let summary = store
        .diagnostic_summary()
        .map_err(|error| error.to_string())?;
    Ok(OutboxSummarySnapshot {
        total: summary.total,
        queued: summary.queued,
        delivered: summary.delivered,
        partial: summary.partial,
        retry_wait: summary.retry_wait,
        rejected: summary.rejected,
    })
}

/// Create a signed 10-minute pairing invitation for a Nearby Field Session.
pub async fn create_field_session_invite(
    session_id: String,
    session_name: String,
    description: Option<String>,
    allow_peer_writes: bool,
) -> Result<String, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let info = FieldSessionInfo {
        id: session_id,
        name: session_name,
        description,
        internet_policy: FieldSessionInternetPolicy::Ask,
        conversation_policy: FieldSessionConversationPolicy::NearbyOnly,
        allow_peer_writes,
        context_coordinates: Vec::new(),
    };
    let capabilities = if allow_peer_writes {
        vec![
            PairingCapability::RelayRead,
            PairingCapability::RelayWrite,
            PairingCapability::BlobRead,
            PairingCapability::BlobWrite,
        ]
    } else {
        vec![PairingCapability::RelayRead, PairingCapability::BlobRead]
    };
    let invitation = node
        .create_field_session_invitation(Duration::from_secs(10 * 60), capabilities, info)
        .await
        .map_err(|err| format!("failed to create field session invitation: {err}"))?;
    invitation
        .encode()
        .map_err(|err| format!("failed to encode invitation: {err}"))
}

/// Sends a signed cryptographic pairing claim over LAN HTTP to the host node's
/// `/.well-known/earthly-local-node/pairing/claims` endpoint so the host sees
/// this device in Pending Pairing Requests and can approve NIP-42 access.
pub async fn join_nearby_session(
    data_dir: String,
    raw_link: String,
    peer_name: Option<String>,
) -> Result<RemotePeerDto, String> {
    if current_node().is_none() {
        let _ = start_local_node(data_dir).await?;
    }
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let trimmed = raw_link.trim();
    let token = if let Some((_, rest)) = trimmed.split_once("invitation=") {
        rest.split('&').next().unwrap_or(rest)
    } else {
        trimmed
    };
    let record = node
        .join_pairing_invitation(token, peer_name)
        .await
        .map_err(|err| format!("failed to submit pairing claim: {err}"))?;
    Ok(remote_record_to_dto(record))
}

/// Returns live pending incoming pairing claims, approved peers on this host,
/// and remote peer sessions joined by this device.
pub async fn nearby_peers_status() -> Result<NearbyPeersSnapshot, String> {
    let Some(node) = current_node() else {
        return Ok(NearbyPeersSnapshot {
            pending_claims: Vec::new(),
            approved_peers: Vec::new(),
            remote_peers: Vec::new(),
        });
    };

    let claims = node
        .pending_pairing_claims()
        .await
        .map_err(|err| format!("failed to list pending claims: {err}"))?;
    let grants = node.peer_grants().await;
    let remotes = node
        .remote_nodes()
        .await
        .map_err(|err| format!("failed to list remote peers: {err}"))?;

    let pending_claims = claims
        .into_iter()
        .map(|c| PendingClaimDto {
            claim_id: c.claim_id,
            peer_pubkey: c.peer_pubkey,
            peer_name: c.peer_name,
            session_id: c.field_session.as_ref().map(|s| s.id.clone()),
            session_name: c.field_session.as_ref().map(|s| s.name.clone()),
        })
        .collect();

    let approved_peers = grants
        .into_iter()
        .map(|g| ApprovedPeerDto {
            peer_pubkey: g.peer_pubkey,
            capabilities: g
                .capabilities
                .into_iter()
                .map(|c| format!("{c:?}"))
                .collect(),
            session_ids: g
                .field_sessions
                .into_iter()
                .map(|fs| fs.session_id)
                .collect(),
        })
        .collect();

    let remote_peers = remotes.into_iter().map(remote_record_to_dto).collect();

    Ok(NearbyPeersSnapshot {
        pending_claims,
        approved_peers,
        remote_peers,
    })
}

/// Approves a pending peer pairing claim on the host node, immediately granting
/// NIP-42 relay read/write & Blossom access to that peer.
pub async fn approve_nearby_claim(claim_id: String) -> Result<bool, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let event_id =
        EventId::from_hex(claim_id.trim()).map_err(|err| format!("invalid claim id: {err}"))?;
    node.approve_pairing_claim(event_id)
        .await
        .map_err(|err| format!("failed to approve claim: {err}"))?;
    Ok(true)
}

pub async fn reject_nearby_claim(claim_id: String, reason: String) -> Result<bool, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let event_id =
        EventId::from_hex(claim_id.trim()).map_err(|err| format!("invalid claim id: {err}"))?;
    node.reject_pairing_claim(event_id, reason)
        .await
        .map_err(|err| format!("failed to reject claim: {err}"))?;
    Ok(true)
}

pub async fn revoke_nearby_peer(peer_pubkey: String) -> Result<bool, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let pk = PublicKey::from_hex(peer_pubkey.trim())
        .map_err(|err| format!("invalid peer pubkey: {err}"))?;
    node.revoke_peer(&pk)
        .await
        .map_err(|err| format!("failed to revoke peer: {err}"))
}

/// Refreshes approval status (`pending` -> `accepted` / `rejected`) for a joined remote peer.
pub async fn refresh_nearby_peer(node_id: String) -> Result<RemotePeerDto, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let record = node
        .refresh_remote_node(node_id.trim())
        .await
        .map_err(|err| format!("failed to refresh remote peer: {err}"))?;
    Ok(remote_record_to_dto(record))
}

/// Pulls all field-session events from an approved remote peer relay via NIP-42 auth
/// into this device's local LMDB relay database.
pub async fn sync_nearby_peer(node_id: String) -> Result<u32, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    let res = node
        .sync_remote_node(node_id.trim())
        .await
        .map_err(|err| format!("failed to sync remote peer: {err}"))?;
    Ok(res.received_events as u32)
}

pub async fn forget_nearby_peer(node_id: String) -> Result<bool, String> {
    let node = current_node().ok_or_else(|| "local node is not running".to_owned())?;
    node.forget_remote_node(node_id.trim())
        .await
        .map_err(|err| format!("failed to forget remote peer: {err}"))
}

fn remote_record_to_dto(record: RemoteNodeRecord) -> RemotePeerDto {
    let (status, rejection_reason) = match record.status {
        PairingStatus::Pending => ("pending".to_owned(), None),
        PairingStatus::Accepted => ("accepted".to_owned(), None),
        PairingStatus::Rejected { reason } => ("rejected".to_owned(), Some(reason)),
    };
    RemotePeerDto {
        node_id: record.node_id,
        peer_name: record.peer_name,
        session_id: record.field_session.as_ref().map(|s| s.id.clone()),
        session_name: record.field_session.as_ref().map(|s| s.name.clone()),
        relay_url: record.descriptor.relay_url.to_string(),
        blossom_url: record.descriptor.blossom_url.to_string(),
        status,
        rejection_reason,
    }
}

pub(crate) fn current_node() -> Option<Arc<LocalNode>> {
    node_slot().read().ok().and_then(|guard| guard.clone())
}

fn snapshot_from_node(node: &LocalNode) -> LocalNodeSnapshot {
    let descriptor = node.descriptor();
    let scope = match descriptor.scope {
        EndpointScope::Loopback => "loopback",
        EndpointScope::LocalNetwork => "local-network",
        EndpointScope::FipsMesh => "fips-mesh",
    };
    let availability = match descriptor.availability {
        NodeAvailability::Process => "process",
        NodeAvailability::Foreground => "foreground",
        NodeAvailability::ForegroundService => "foreground-service",
    };
    LocalNodeSnapshot {
        running: true,
        node_id: Some(descriptor.node_id.clone()),
        relay_url: Some(descriptor.relay_url.to_string()),
        blossom_url: Some(descriptor.blossom_url.to_string()),
        scope: Some(scope.to_owned()),
        availability: Some(availability.to_owned()),
    }
}

#[derive(Clone, Debug)]
pub struct AtlasBundleInspectionDto {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub families: Vec<String>,
    pub coverage_summary: String,
    pub embedded_pmtiles_path: Option<String>,
}

fn dir_size_and_scan(
    root: &std::path::Path,
    depth: usize,
    total_bytes: &mut u64,
    families: &mut Vec<String>,
    embedded_pmtiles: &mut Option<String>,
) {
    if depth > 4 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            dir_size_and_scan(&path, depth + 1, total_bytes, families, embedded_pmtiles);
        } else if meta.is_file() {
            *total_bytes = total_bytes.saturating_add(meta.len());
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            let file_name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if ext == "pmtiles" {
                if !families.iter().any(|f| f == "vector_tiles") {
                    families.push("vector_tiles".to_owned());
                }
                if embedded_pmtiles.is_none() {
                    *embedded_pmtiles = Some(path.to_string_lossy().into_owned());
                }
            } else if ext == "sqlite" || ext == "sqlite3" || ext == "db" || ext == "mbtiles" {
                if !families.iter().any(|f| f == "spatial_index") {
                    families.push("spatial_index".to_owned());
                }
            } else if ext == "geojson" || ext == "json" {
                if file_name.contains("route") || file_name.contains("valhalla") {
                    if !families.iter().any(|f| f == "routing") {
                        families.push("routing".to_owned());
                    }
                } else if file_name != "manifest.json" && file_name != "atlas.json" {
                    if !families.iter().any(|f| f == "features") {
                        families.push("features".to_owned());
                    }
                }
            } else if ext == "dem" || ext == "tif" || ext == "hgt" {
                if !families.iter().any(|f| f == "elevation") {
                    families.push("elevation".to_owned());
                }
            }
        }
    }
}

/// Inspects a local `.atlas` workspace directory or archive file on disk,
/// reading optional `manifest.json`/`atlas.json` metadata and discovering
/// embedded `.pmtiles`, spatial index, routing, or elevation data families.
pub fn inspect_atlas_workspace_path(path: String) -> Result<AtlasBundleInspectionDto, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Atlas bundle path cannot be empty".to_owned());
    }
    let p = std::path::Path::new(trimmed);
    if !p.exists() {
        return Err(format!("Atlas bundle path does not exist: {trimmed}"));
    }
    let mut name = p
        .file_stem()
        .or_else(|| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("Offline Atlas")
        .to_owned();
    let mut families: Vec<String> = Vec::new();
    let mut embedded_pmtiles: Option<String> = None;
    let mut size_bytes: u64 = 0;

    if p.is_dir() {
        for manifest_name in ["manifest.json", "atlas.json"] {
            let mpath = p.join(manifest_name);
            if let Ok(raw) = std::fs::read_to_string(&mpath) {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&raw) {
                    if let Some(title) = val
                        .get("name")
                        .or_else(|| val.get("title"))
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        name = title.to_owned();
                    }
                    if let Some(arr) = val.get("families").and_then(|v| v.as_array()) {
                        for f in arr {
                            if let Some(s) = f.as_str() {
                                if !families.iter().any(|x| x == s) {
                                    families.push(s.to_owned());
                                }
                            }
                        }
                    }
                }
            }
        }
        dir_size_and_scan(p, 0, &mut size_bytes, &mut families, &mut embedded_pmtiles);
    } else if let Ok(meta) = std::fs::metadata(p) {
        size_bytes = meta.len();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        if ext == "pmtiles" {
            families.push("vector_tiles".to_owned());
            embedded_pmtiles = Some(trimmed.to_owned());
        } else {
            families.push("atlas_archive".to_owned());
        }
    }

    if families.is_empty() {
        families.push("atlas_workspace".to_owned());
    }
    let coverage_summary = format!(
        "{} ({} KB · {})",
        name,
        (size_bytes / 1024).max(1),
        families.join(", ")
    );

    Ok(AtlasBundleInspectionDto {
        name,
        path: trimmed.to_owned(),
        size_bytes,
        families,
        coverage_summary,
        embedded_pmtiles_path: embedded_pmtiles,
    })
}

/// Scans candidate local directories for `.atlas` bundles (and standalone `.pmtiles`
/// offline archives) so users can mount them with one tap in Basemap & Offline packs.
pub fn discover_local_atlas_bundles(search_dirs: Vec<String>) -> Vec<AtlasBundleInspectionDto> {
    let mut found = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in search_dirs {
        let Ok(entries) = std::fs::read_dir(dir.trim()) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if ext != "atlas" {
                continue;
            }
            let path_str = path.to_string_lossy().into_owned();
            if !seen.insert(path_str.clone()) {
                continue;
            }
            if let Ok(bundle) = inspect_atlas_workspace_path(path_str) {
                found.push(bundle);
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// Ingests a `.pmtiles` file directly from a local filesystem path into the
/// running LocalNode Blossom server (used when mounting `.atlas` bundles).
pub async fn ingest_local_pmtiles_from_path(
    path: String,
    label: Option<String>,
) -> Result<IngestedPmtilesSnapshot, String> {
    let bytes = std::fs::read(path.trim())
        .map_err(|e| format!("Failed to read local PMTiles file: {e}"))?;
    let resolved_label = label
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| {
            std::path::Path::new(path.trim())
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("offline.pmtiles")
                .to_owned()
        });
    ingest_local_pmtiles(bytes, resolved_label).await
}

fn header_to_snapshot(header: &PmtilesHeader) -> PmtilesHeaderSnapshot {
    let format = match header.tile_type.to_tile_format() {
        TileFormat::Mvt => "mvt",
        TileFormat::Png => "png",
        TileFormat::Jpeg => "jpeg",
        TileFormat::Webp => "webp",
        TileFormat::Avif => "avif",
        TileFormat::AtlasVector => "atlas-vector",
        TileFormat::Unknown => "unknown",
    };
    PmtilesHeaderSnapshot {
        format: format.to_owned(),
        min_zoom: header.min_zoom,
        max_zoom: header.max_zoom,
        west: header.bounds.west,
        south: header.bounds.south,
        east: header.bounds.east,
        north: header.bounds.north,
        center_lon: header.center_lon,
        center_lat: header.center_lat,
        center_zoom: header.center_zoom,
        clustered: header.clustered,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use earthly_spatial::PMTILES_V3_HEADER_LEN;

    fn sample_pmtiles_bytes() -> Vec<u8> {
        let mut bytes = vec![0u8; PMTILES_V3_HEADER_LEN + 32];
        bytes[0..7].copy_from_slice(b"PMTiles");
        bytes[7] = 3;
        bytes[96] = 1;
        bytes[97] = 2;
        bytes[98] = 2;
        bytes[99] = 1;
        bytes[100] = 0;
        bytes[101] = 14;
        bytes[102..106].copy_from_slice(&(161_800_000i32).to_le_bytes());
        bytes[106..110].copy_from_slice(&(481_100_000i32).to_le_bytes());
        bytes[110..114].copy_from_slice(&(165_800_000i32).to_le_bytes());
        bytes[114..118].copy_from_slice(&(483_200_000i32).to_le_bytes());
        bytes[118] = 12;
        bytes[119..123].copy_from_slice(&(163_738_000i32).to_le_bytes());
        bytes[123..127].copy_from_slice(&(482_082_000i32).to_le_bytes());
        bytes
    }

    #[tokio::test]
    async fn local_node_ingests_pmtiles_and_reports_outbox_summary() {
        let dir = tempfile::tempdir().unwrap();
        let node = start_local_node(dir.path().join("node").to_string_lossy().into_owned())
            .await
            .unwrap();
        assert!(node.running);
        assert_eq!(node.scope.as_deref(), Some("loopback"));

        let ingested = ingest_local_pmtiles(sample_pmtiles_bytes(), "vienna.pmtiles".to_owned())
            .await
            .unwrap();
        assert_eq!(ingested.header.format, "mvt");
        assert!(ingested.blob_url.starts_with("http://127.0.0.1:"));
        assert!(ingested.authorization.starts_with("Nostr "));

        let summary =
            outbox_summary(dir.path().join("earthly.sqlite3").to_string_lossy().into_owned())
                .unwrap();
        assert_eq!(summary.total, 0);

        assert!(shutdown_local_node());
    }

    #[test]
    fn discovers_and_inspects_local_atlas_bundle_directory() {
        let dir = tempfile::tempdir().unwrap();
        let bundle_dir = dir.path().join("danube.atlas");
        std::fs::create_dir_all(&bundle_dir).unwrap();
        std::fs::write(
            bundle_dir.join("manifest.json"),
            r#"{"name":"Danube Basin Offline Atlas","families":["vector_tiles","routing"]}"#,
        )
        .unwrap();
        std::fs::write(bundle_dir.join("tiles.pmtiles"), sample_pmtiles_bytes()).unwrap();

        let found = discover_local_atlas_bundles(vec![dir.path().to_string_lossy().into_owned()]);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "Danube Basin Offline Atlas");
        assert!(found[0].families.contains(&"vector_tiles".to_owned()));
        assert!(found[0].families.contains(&"routing".to_owned()));
        assert!(found[0].embedded_pmtiles_path.is_some());
    }
}
