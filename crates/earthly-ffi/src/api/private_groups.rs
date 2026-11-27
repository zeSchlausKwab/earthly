//! Flutter Rust Bridge facade for Earthly Circles (RFC 9420 MLS + Cordn ContextVM).

use std::sync::{Arc, OnceLock, RwLock};

use earthly_mls::coordinator::PendingJoinRequest;
use earthly_mls::envelope::{compute_nostr_event_id, LocalKeysSigner, NostrEventSigner};
use earthly_mls::invitation::decode_private_map_invitation;
use earthly_mls::service::PrivateWorkspaceService;
use earthly_mls::storage::{SqlitePrivateWorkspaceStore, StoredWorkspace, WorkspaceMetadata};
use earthly_mls::DEFAULT_CORDN_SERVER_PUBKEY;
use flutter_rust_bridge::DartFnFuture;
use nostr::{Event, JsonUtil, PublicKey};
use serde::Deserialize;

use crate::api::nip46::Nip46CircleSigner;

type ExternalSignCallback = Arc<dyn Fn(String) -> DartFnFuture<String> + Send + Sync>;

#[derive(Clone)]
struct RegisteredExternalSigner {
    pubkey_hex: String,
    sign_fn: ExternalSignCallback,
}

static EXTERNAL_CIRCLE_SIGNER: OnceLock<RwLock<Option<RegisteredExternalSigner>>> = OnceLock::new();

fn external_signer_lock() -> &'static RwLock<Option<RegisteredExternalSigner>> {
    EXTERNAL_CIRCLE_SIGNER.get_or_init(|| RwLock::new(None))
}

fn normalize_pubkey_hex(raw: &str) -> Result<String, String> {
    PublicKey::parse(raw.trim())
        .map(|pk| pk.to_hex())
        .map_err(|e| format!("Invalid Nostr public key: {e}"))
}

#[derive(Deserialize)]
struct ExternalSignEnvelope {
    ok: Option<ExternalSignPayload>,
    err: Option<String>,
}

#[derive(Deserialize)]
struct ExternalSignPayload {
    event: Option<String>,
    signature: Option<String>,
}

fn parse_external_signed_event(
    expected_id: &str,
    pubkey_hex: &str,
    created_at: u64,
    kind: u16,
    tags: &[Vec<String>],
    content: &str,
    response_json: &str,
) -> Result<Event, String> {
    let envelope: ExternalSignEnvelope = serde_json::from_str(response_json)
        .map_err(|e| format!("Invalid external signer response: {e}"))?;
    if let Some(err) = envelope.err.filter(|s| !s.trim().is_empty()) {
        return Err(err);
    }
    let payload = envelope
        .ok
        .ok_or_else(|| "External signer returned an empty signing response".to_owned())?;

    let event = if let Some(raw_event) = payload
        .event
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Event::from_json(raw_event)
            .map_err(|e| format!("External signer returned invalid signed event JSON: {e}"))?
    } else if let Some(sig) = payload
        .signature
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let assembled = serde_json::json!({
            "id": expected_id,
            "pubkey": pubkey_hex,
            "created_at": created_at,
            "kind": kind,
            "tags": tags,
            "content": content,
            "sig": sig,
        });
        Event::from_json(assembled.to_string()).map_err(|e| {
            format!("External signer returned invalid signature for event: {e}")
        })?
    } else {
        return Err("External signer did not return a signed event or signature".to_owned());
    };

    event
        .verify()
        .map_err(|e| format!("External signer produced invalid Nostr signature: {e}"))?;
    Ok(event)
}

#[derive(Clone)]
struct ExternalDartCircleSigner {
    pubkey_hex: String,
    sign_fn: ExternalSignCallback,
}

impl NostrEventSigner for ExternalDartCircleSigner {
    fn pubkey_hex(&self) -> String {
        self.pubkey_hex.clone()
    }

    fn sign_event_template(
        &self,
        kind: u16,
        created_at: u64,
        tags: Vec<Vec<String>>,
        content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>
    {
        let pubkey_hex = self.pubkey_hex.clone();
        let sign_fn = Arc::clone(&self.sign_fn);
        Box::pin(async move {
            let expected_id =
                compute_nostr_event_id(&pubkey_hex, created_at, kind, &tags, &content)?;
            let unsigned_json = serde_json::json!({
                "id": expected_id,
                "pubkey": pubkey_hex,
                "created_at": created_at,
                "kind": kind,
                "tags": tags,
                "content": content,
            })
            .to_string();
            let response_json = (sign_fn)(unsigned_json).await;
            parse_external_signed_event(
                &expected_id,
                &pubkey_hex,
                created_at,
                kind,
                &tags,
                &content,
                &response_json,
            )
        })
    }
}

/// Registers an external Dart-backed Nostr event signer (such as Android Amber
/// NIP-55) so MLS Circles and Cordn ContextVM operations work seamlessly
/// without a local `nsec` or NIP-46 bunker.
pub fn register_external_circle_signer(
    pubkey_or_npub: String,
    sign_event: impl Fn(String) -> DartFnFuture<String> + Send + Sync + 'static,
) -> Result<String, String> {
    let pubkey_hex = normalize_pubkey_hex(&pubkey_or_npub)?;
    let mut guard = external_signer_lock()
        .write()
        .map_err(|_| "External circle signer lock poisoned".to_owned())?;
    *guard = Some(RegisteredExternalSigner {
        pubkey_hex: pubkey_hex.clone(),
        sign_fn: Arc::new(sign_event),
    });
    Ok(pubkey_hex)
}

/// Clears any registered external Dart-backed Circle signer.
pub fn clear_external_circle_signer() -> Result<(), String> {
    let mut guard = external_signer_lock()
        .write()
        .map_err(|_| "External circle signer lock poisoned".to_owned())?;
    *guard = None;
    Ok(())
}

#[derive(Clone, Debug)]
pub struct CircleDatasetDto {
    pub workspace_id: String,
    pub envelope_id: String,
    pub dataset_id: String,
    pub title: String,
    pub pubkey: String,
    pub created_at: u64,
    pub geojson_json: String,
    pub feature_count: u32,
}

#[derive(Clone, Debug)]
pub struct CircleMessageDto {
    pub envelope_id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16,
    pub text: String,
    pub geojson_json: Option<String>,
    pub geometry_feature_count: u32,
}

#[derive(Clone, Debug)]
pub struct CircleWorkspaceDto {
    pub workspace_id: String,
    pub group_id: String,
    pub name: String,
    pub description: Option<String>,
    pub recommended_basemap: Option<String>,
    pub role: String,
    pub status: String,
    pub cursor: u64,
    pub epoch: u64,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub members: Vec<String>,
    pub administrators: Vec<String>,
    pub datasets: Vec<CircleDatasetDto>,
    pub messages: Vec<CircleMessageDto>,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct CirclePendingJoinDto {
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub key_package_ref: String,
    pub created_at_ms: u64,
}

#[derive(Clone, Debug)]
pub struct CircleJoinRequestDto {
    pub workspace_id: String,
    pub pk: String,
    pub kp_ref: String,
    pub at: u64,
}

#[derive(Clone, Debug)]
pub struct CircleSnapshotDto {
    pub workspaces: Vec<CircleWorkspaceDto>,
    pub pending_joins: Vec<CirclePendingJoinDto>,
    pub default_cordn_pubkey: String,
}

#[derive(Clone, Debug)]
pub struct DecodedCircleInviteDto {
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub expires_at: Option<u64>,
}

pub fn default_cordn_coordinator_pubkey() -> String {
    DEFAULT_CORDN_SERVER_PUBKEY.to_owned()
}

pub fn decode_circle_invite_link(raw_link: String) -> Result<DecodedCircleInviteDto, String> {
    let inv = decode_private_map_invitation(&raw_link)?;
    Ok(DecodedCircleInviteDto {
        workspace_id: inv.workspace_id,
        group_id: inv.group_id,
        admin_pubkey: inv.admin_pubkey,
        coordinator_pubkey: inv.coordinator_pubkey,
        relays: inv.relays,
        expires_at: inv.expires_at,
    })
}

async fn resolve_signer(
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
) -> Result<Arc<dyn NostrEventSigner>, String> {
    if let Some(nsec) = signer_nsec.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return Ok(Arc::new(LocalKeysSigner::from_nsec_or_hex(nsec)?));
    }
    if let (Some(uri), Some(client)) = (
        bunker_uri.as_deref().map(str::trim).filter(|s| !s.is_empty()),
        bunker_client_nsec
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty()),
    ) {
        let signer = Nip46CircleSigner::connect(uri.to_owned(), client.to_owned()).await?;
        return Ok(Arc::new(signer));
    }
    if let Ok(guard) = external_signer_lock().read() {
        if let Some(entry) = guard.as_ref() {
            return Ok(Arc::new(ExternalDartCircleSigner {
                pubkey_hex: entry.pubkey_hex.clone(),
                sign_fn: Arc::clone(&entry.sign_fn),
            }));
        }
    }
    Err(
        "MLS Groups require a signing account (Amber NIP-55, NIP-46 remote bunker, or local keypair — open Account to sign in)"
            .to_owned(),
    )
}

fn workspace_to_dto(ws: &StoredWorkspace) -> CircleWorkspaceDto {
    let datasets = PrivateWorkspaceService::project_datasets(ws)
        .into_iter()
        .map(|d| CircleDatasetDto {
            workspace_id: d.workspace_id,
            envelope_id: d.envelope_id,
            dataset_id: d.dataset_id,
            title: d.title,
            pubkey: d.pubkey,
            created_at: d.created_at,
            geojson_json: d.geojson_json,
            feature_count: d.feature_count as u32,
        })
        .collect();
    let messages = PrivateWorkspaceService::project_messages(ws)
        .into_iter()
        .map(|m| CircleMessageDto {
            envelope_id: m.envelope_id,
            pubkey: m.pubkey,
            created_at: m.created_at,
            kind: m.kind,
            text: m.text,
            geojson_json: m.geojson_json,
            geometry_feature_count: m.geometry_feature_count as u32,
        })
        .collect();

    CircleWorkspaceDto {
        workspace_id: ws.workspace_id.clone(),
        group_id: ws.group_id.clone(),
        name: ws
            .metadata
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| "Decrypting Circle…".to_owned()),
        description: ws.metadata.as_ref().and_then(|m| m.description.clone()),
        recommended_basemap: ws
            .metadata
            .as_ref()
            .and_then(|m| m.recommended_basemap.clone()),
        role: ws.role.clone(),
        status: ws.status.clone(),
        cursor: ws.cursor,
        epoch: PrivateWorkspaceService::epoch(ws),
        coordinator_pubkey: ws.coordinator_pubkey.clone(),
        relays: ws.relays.clone(),
        members: PrivateWorkspaceService::members(ws),
        administrators: PrivateWorkspaceService::administrators(ws),
        datasets,
        messages,
        created_at_ms: ws.created_at_ms,
    }
}

pub fn load_circles_snapshot(
    database_path: String,
    owner_pubkey_hex: String,
) -> Result<CircleSnapshotDto, String> {
    let normalized_owner =
        normalize_pubkey_hex(&owner_pubkey_hex).unwrap_or_else(|_| owner_pubkey_hex.trim().to_owned());
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let workspaces = store
        .list_workspaces(&normalized_owner)?
        .iter()
        .map(workspace_to_dto)
        .collect();
    let pending_joins = store
        .list_pending_joins(&normalized_owner)?
        .into_iter()
        .map(|p| CirclePendingJoinDto {
            workspace_id: p.workspace_id,
            group_id: p.group_id,
            admin_pubkey: p.admin_pubkey,
            coordinator_pubkey: p.coordinator_pubkey,
            relays: p.relays,
            key_package_ref: p.key_package_ref,
            created_at_ms: p.created_at_ms,
        })
        .collect();
    Ok(CircleSnapshotDto {
        workspaces,
        pending_joins,
        default_cordn_pubkey: DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn create_circle_workspace(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    coordinator_pubkey: String,
    relays: Vec<String>,
    name: String,
    description: Option<String>,
    recommended_basemap: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let coord_pk = if coordinator_pubkey.trim().is_empty() {
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned()
    } else {
        coordinator_pubkey.trim().to_owned()
    };
    let relays = if relays.is_empty() {
        vec!["wss://relay.earthly.city".to_owned()]
    } else {
        relays
    };
    let svc = PrivateWorkspaceService::new(signer, store, coord_pk, relays);
    let ws = svc.create_workspace(WorkspaceMetadata {
        name,
        description,
        recommended_basemap,
    })?;
    Ok(workspace_to_dto(&ws))
}

pub async fn create_circle_invite_url(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<String, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    svc.create_invitation_url(&workspace_id).await
}

pub async fn request_join_circle(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    raw_invitation: String,
) -> Result<CirclePendingJoinDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let p = svc.request_to_join(&raw_invitation).await?;
    Ok(CirclePendingJoinDto {
        workspace_id: p.workspace_id,
        group_id: p.group_id,
        admin_pubkey: p.admin_pubkey,
        coordinator_pubkey: p.coordinator_pubkey,
        relays: p.relays,
        key_package_ref: p.key_package_ref,
        created_at_ms: p.created_at_ms,
    })
}

pub async fn accept_circle_welcomes(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
) -> Result<Vec<CircleWorkspaceDto>, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let joined = svc.accept_pending_welcomes().await?;
    Ok(joined.iter().map(workspace_to_dto).collect())
}

pub async fn fetch_circle_join_requests(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<Vec<CircleJoinRequestDto>, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let list = svc.fetch_join_requests(&workspace_id).await?;
    Ok(list
        .into_iter()
        .map(|r| CircleJoinRequestDto {
            workspace_id: workspace_id.clone(),
            pk: r.pk,
            kp_ref: r.kp_ref,
            at: r.at,
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
pub async fn approve_circle_join_request(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    pk: String,
    kp_ref: String,
    at: u64,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let ws = svc
        .approve_join_request(&workspace_id, &PendingJoinRequest { pk, kp_ref, at })
        .await?;
    Ok(workspace_to_dto(&ws))
}

pub async fn sync_circle_workspace(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let ws = svc.sync_workspace(&workspace_id).await?;
    Ok(workspace_to_dto(&ws))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_comment(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    text: String,
    geojson_json: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    svc.send_comment(&workspace_id, &text, geojson_json.as_deref())
        .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after send".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

#[allow(clippy::too_many_arguments)]
pub async fn send_circle_dataset(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    geojson_json: String,
    dataset_id: Option<String>,
    name: Option<String>,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer.clone(),
        Arc::clone(&store),
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    svc.send_dataset(
        &workspace_id,
        &geojson_json,
        dataset_id.as_deref(),
        name.as_deref(),
    )
    .await?;
    let updated = store
        .get_workspace(&signer.pubkey_hex(), &workspace_id)?
        .ok_or_else(|| "Circle missing after dataset send".to_owned())?;
    Ok(workspace_to_dto(&updated))
}

pub async fn remove_circle_member(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    member_pubkey: String,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let ws = svc.remove_member(&workspace_id, &member_pubkey).await?;
    Ok(workspace_to_dto(&ws))
}

pub async fn set_circle_administrator(
    database_path: String,
    signer_nsec: Option<String>,
    bunker_uri: Option<String>,
    bunker_client_nsec: Option<String>,
    workspace_id: String,
    member_pubkey: String,
    administrator: bool,
) -> Result<CircleWorkspaceDto, String> {
    let signer = resolve_signer(signer_nsec, bunker_uri, bunker_client_nsec).await?;
    let store = Arc::new(SqlitePrivateWorkspaceStore::open(database_path)?);
    let svc = PrivateWorkspaceService::new(
        signer,
        store,
        DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
        vec!["wss://relay.earthly.city".to_owned()],
    );
    let ws = svc
        .set_administrator(&workspace_id, &member_pubkey, administrator)
        .await?;
    Ok(workspace_to_dto(&ws))
}

pub fn delete_circle_workspace(
    database_path: String,
    owner_pubkey_hex: String,
    workspace_id: String,
) -> Result<(), String> {
    let normalized_owner =
        normalize_pubkey_hex(&owner_pubkey_hex).unwrap_or_else(|_| owner_pubkey_hex.trim().to_owned());
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    store.delete_workspace(&normalized_owner, &workspace_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::nips::nip19::ToBech32;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};

    #[tokio::test]
    async fn external_circle_signer_signs_full_event_and_signature_only_responses() {
        let keys = Keys::generate();
        let npub = keys.public_key().to_bech32().expect("npub");
        let hex_pk = keys.public_key().to_hex();

        // 1. Full signed event response (Amber `returnType: "event"`)
        let keys_full = keys.clone();
        let registered = register_external_circle_signer(npub.clone(), move |unsigned_json| {
            let k = keys_full.clone();
            Box::pin(async move {
                let v: serde_json::Value = serde_json::from_str(&unsigned_json).unwrap();
                let kind = v["kind"].as_u64().unwrap() as u16;
                let created_at = v["created_at"].as_u64().unwrap();
                let content = v["content"].as_str().unwrap().to_owned();
                let tags: Vec<Tag> = v["tags"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|arr| {
                        let items: Vec<String> = arr
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|s| s.as_str().unwrap().to_owned())
                            .collect();
                        Tag::parse(items).unwrap()
                    })
                    .collect();
                let signed = EventBuilder::new(Kind::Custom(kind), content)
                    .tags(tags)
                    .custom_created_at(Timestamp::from(created_at))
                    .sign_with_keys(&k)
                    .unwrap();
                serde_json::json!({ "ok": { "event": signed.as_json() } }).to_string()
            })
        })
        .expect("register external signer");
        assert_eq!(registered, hex_pk);

        let signer = resolve_signer(None, None, None)
            .await
            .expect("resolve external signer");
        assert_eq!(signer.pubkey_hex(), hex_pk);
        let ev = signer
            .sign_event_template(
                27_523,
                1_760_000_000,
                vec![vec!["t".to_owned(), "earthly-private-workspace-authorization-v1".to_owned()]],
                "digest-hex".to_owned(),
            )
            .await
            .expect("sign via full event response");
        ev.verify().expect("valid signature");
        assert_eq!(ev.pubkey.to_hex(), hex_pk);

        // 2. Signature-only response (some NIP-55 ContentProviders return only `signature`)
        let keys_sig = keys.clone();
        register_external_circle_signer(hex_pk.clone(), move |unsigned_json| {
            let k = keys_sig.clone();
            Box::pin(async move {
                let v: serde_json::Value = serde_json::from_str(&unsigned_json).unwrap();
                let kind = v["kind"].as_u64().unwrap() as u16;
                let created_at = v["created_at"].as_u64().unwrap();
                let content = v["content"].as_str().unwrap().to_owned();
                let signed = EventBuilder::new(Kind::Custom(kind), content)
                    .custom_created_at(Timestamp::from(created_at))
                    .sign_with_keys(&k)
                    .unwrap();
                serde_json::json!({ "ok": { "signature": signed.sig.to_string() } }).to_string()
            })
        })
        .expect("register sig-only signer");

        let signer2 = resolve_signer(None, None, None).await.unwrap();
        let ev2 = signer2
            .sign_event_template(25_910, 1_760_000_005, vec![], "hello".to_owned())
            .await
            .expect("sign via signature-only response");
        ev2.verify().expect("valid sig-only event");

        // 3. Creating & loading workspace via npub normalization
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("mls.sqlite3").to_string_lossy().to_string();
        let created = create_circle_workspace(
            db.clone(),
            None,
            None,
            None,
            DEFAULT_CORDN_SERVER_PUBKEY.to_owned(),
            vec!["wss://relay.earthly.city".to_owned()],
            "Amber Field Crew".to_owned(),
            None,
            None,
        )
        .await
        .expect("create workspace with external signer");
        assert_eq!(created.name, "Amber Field Crew");
        let snap = load_circles_snapshot(db, npub).expect("load snapshot by npub");
        assert_eq!(snap.workspaces.len(), 1);
        assert_eq!(snap.workspaces[0].workspace_id, created.workspace_id);

        clear_external_circle_signer().expect("clear external signer");
    }
}
