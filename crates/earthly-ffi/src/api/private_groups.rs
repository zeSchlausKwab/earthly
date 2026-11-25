//! Flutter Rust Bridge facade for Earthly Circles (RFC 9420 MLS + Cordn ContextVM).

use std::sync::Arc;

use earthly_mls::coordinator::PendingJoinRequest;
use earthly_mls::envelope::{LocalKeysSigner, NostrEventSigner};
use earthly_mls::invitation::decode_private_map_invitation;
use earthly_mls::service::PrivateWorkspaceService;
use earthly_mls::storage::{SqlitePrivateWorkspaceStore, StoredWorkspace, WorkspaceMetadata};
use earthly_mls::DEFAULT_CORDN_SERVER_PUBKEY;

use crate::api::nip46::Nip46CircleSigner;

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
    Err(
        "Circles require a local keypair or NIP-46 remote bunker session (open Account to sign in)"
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
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    let workspaces = store
        .list_workspaces(&owner_pubkey_hex)?
        .iter()
        .map(workspace_to_dto)
        .collect();
    let pending_joins = store
        .list_pending_joins(&owner_pubkey_hex)?
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
    let store = SqlitePrivateWorkspaceStore::open(database_path)?;
    store.delete_workspace(&owner_pubkey_hex, &workspace_id)
}
