//! High-level Earthly Circle (`PrivateWorkspaceService`) orchestrating MLS,
//! Cordn ContextVM v0.4/v0.5 sync, read-only background sync, live push stream ingestion,
//! crash-recovery journals, fork/behind detection, auto-approve, encrypted media, and projection.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::future::Future;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use earthly_domain::kinds::{GEO_COMMENT_KIND, GEO_EVENT_KIND};
use nostr::{Event, JsonUtil};
use serde::{Deserialize, Serialize};

use crate::checkpoint::{
    create_workspace_checkpoint_manifest, current_map_checkpoint_envelopes,
    parse_workspace_checkpoint_manifest, PRIVATE_WORKSPACE_CHECKPOINT_KIND,
};
use crate::coordinator::{
    canonical_cordn_pool_key, is_transient_transport_error, reset_cordn_pool_connection,
    AvailableKeyPackage, ConsumedJoinRequest, ConsumedWelcome, CoordinatorMessage,
    CordnCoordinatorClient, GroupCursorQuery, PendingJoinRequest, PrivateWorkspaceCoordinator,
};
use crate::envelope::{
    assert_private_envelope_authorization, create_private_envelope, NostrEventSigner,
    PrivateWorkspaceEnvelope, ReadOnlyNostrSigner,
};
use crate::invitation::{
    assert_private_map_invitation_current, create_private_map_invitation,
    decode_private_map_invitation, format_circle_invite_url,
};
use crate::media::{parse_imeta_tag, parse_imeta_tags, EncryptedMediaImeta};
use crate::mls::{
    add_workspace_member, create_workspace_application_message, create_workspace_group,
    credential_pubkey_from_key_package_base64, derive_encrypted_media_key_with_epoch,
    epoch_from_state, generate_mls_key_package, inspect_group_summary, join_workspace_group,
    member_pubkeys_from_state, open_coordinator_payload, process_workspace_message_with_epoch,
    remove_workspace_member, seal_coordinator_payload, ProcessedMlsMessage,
};
use crate::policy::{
    create_administrator_policy_transition, reduce_administrator_policy,
    AdministratorPolicyState, PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
};
use crate::storage::{
    workspace_mutex, PendingWorkspaceApplication, PendingWorkspaceApproval,
    PendingWorkspaceApprovalMessage, PendingWorkspaceJoin, PendingWorkspaceMembershipCommit,
    PendingWorkspaceOutbound, SkippedCoordinatorMessage, SqlitePrivateWorkspaceStore,
    StoredKeyPackage, StoredWorkspace, WorkspaceMetadata, SYNC_HEALTH_BEHIND, SYNC_HEALTH_FORKED,
    SYNC_HEALTH_HEALTHY, SYNC_HEALTH_REMOVED,
};
use crate::{PRIVATE_WORKSPACE_CHAT_KIND, PRIVATE_WORKSPACE_METADATA_KIND};

const MAX_SKIPPED_COORDINATOR_MESSAGES: usize = 32;
const MAX_MEMBERSHIP_RECOVERY_PASSES: usize = 4;
const MAX_TRANSIENT_COORDINATOR_ATTEMPTS: usize = 3;
const BEHIND_DECRYPT_ERROR_THRESHOLD: u32 = 2;
const FORKED_DECRYPT_ERROR_THRESHOLD: u32 = 5;
pub const MAX_AUTO_APPROVE_BATCH: usize = 15;

pub type ProjectedMediaAttachment = EncryptedMediaImeta;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedPrivateDataset {
    pub workspace_id: String,
    pub envelope_id: String,
    pub dataset_id: String,
    pub title: String,
    pub pubkey: String,
    pub created_at: u64,
    pub geojson_json: String,
    pub feature_count: usize,
    #[serde(default)]
    pub media_attachments: Vec<ProjectedMediaAttachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectedPrivateMessage {
    pub envelope_id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16,
    pub text: String,
    pub geojson_json: Option<String>,
    pub geometry_feature_count: usize,
    #[serde(default)]
    pub media_attachments: Vec<ProjectedMediaAttachment>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub epoch: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct AutoApproveResult {
    pub workspace: StoredWorkspace,
    pub approved_pubkeys: Vec<String>,
    pub skipped_errors: Vec<(String, String)>,
}

pub type CoordinatorFactory = Arc<
    dyn Fn(
            String,
            Vec<String>,
            Arc<dyn NostrEventSigner>,
        ) -> Result<Arc<dyn PrivateWorkspaceCoordinator>, String>
        + Send
        + Sync,
>;

pub struct PrivateWorkspaceService {
    signer: Arc<dyn NostrEventSigner>,
    store: Arc<SqlitePrivateWorkspaceStore>,
    default_coordinator_pubkey: String,
    default_relays: Vec<String>,
    coordinator_factory: CoordinatorFactory,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn now_secs() -> u64 {
    now_ms() / 1000
}

fn random_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

fn default_coordinator_factory() -> CoordinatorFactory {
    Arc::new(|server_pk, relays, signer| {
        Ok(Arc::new(CordnCoordinatorClient::new(
            server_pk, relays, signer,
        )?))
    })
}

async fn retry_transient_coordinator_call<T, F, Fut>(
    server_pubkey: &str,
    relays: &[String],
    mut operation: F,
) -> Result<T, String>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, String>>,
{
    let mut last_err = String::new();
    for attempt in 1..=MAX_TRANSIENT_COORDINATOR_ATTEMPTS {
        match operation().await {
            Ok(val) => return Ok(val),
            Err(err) => {
                let transient = is_transient_transport_error(&err);
                last_err = err;
                if !transient || attempt == MAX_TRANSIENT_COORDINATOR_ATTEMPTS {
                    return Err(last_err);
                }
                reset_cordn_pool_connection(server_pubkey, relays).await;
                tokio::time::sleep(Duration::from_millis((attempt as u64) * 300)).await;
            }
        }
    }
    Err(last_err)
}

fn read_metadata(envelope: &PrivateWorkspaceEnvelope) -> Option<WorkspaceMetadata> {
    if envelope.kind != PRIVATE_WORKSPACE_METADATA_KIND {
        return None;
    }
    let val: serde_json::Value = serde_json::from_str(&envelope.content).ok()?;
    let name = val.get("name")?.as_str()?.trim();
    if name.is_empty() {
        return None;
    }
    Some(WorkspaceMetadata {
        name: name.to_owned(),
        description: val
            .get("description")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
        recommended_basemap: val
            .get("recommendedBasemap")
            .and_then(|v| v.as_str())
            .map(ToOwned::to_owned),
    })
}

fn publication_key_package_base64(event: &Event) -> Result<String, String> {
    let val: serde_json::Value = serde_json::from_str(&event.content)
        .map_err(|_| "KeyPackage publication event content is not JSON".to_owned())?;
    let kp = val
        .pointer("/params/arguments/kp_64")
        .or_else(|| val.pointer("/params/arguments/keyPackageBase64"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| "KeyPackage publication event does not contain kp_64".to_owned())?;
    Ok(kp.to_owned())
}

fn record_current_epoch_media_key(ws: &mut StoredWorkspace) -> Option<u64> {
    if let Ok((epoch, key)) = derive_encrypted_media_key_with_epoch(&ws.mls_state) {
        ws.epoch_media_keys
            .entry(epoch)
            .or_insert_with(|| hex::encode(key));
        Some(epoch)
    } else {
        None
    }
}

fn record_skipped_coordinator_message(ws: &mut StoredWorkspace, cursor: u64, reason: &str) {
    ws.skipped_coordinator_messages
        .retain(|item| item.cursor != cursor);
    ws.skipped_coordinator_messages
        .push(SkippedCoordinatorMessage {
            cursor,
            reason: reason.to_owned(),
            recorded_at_ms: now_ms(),
        });
    if ws.skipped_coordinator_messages.len() > MAX_SKIPPED_COORDINATOR_MESSAGES {
        let excess = ws.skipped_coordinator_messages.len() - MAX_SKIPPED_COORDINATOR_MESSAGES;
        ws.skipped_coordinator_messages.drain(0..excess);
    }
}

fn update_health_after_decrypt_failure(ws: &mut StoredWorkspace) {
    if ws.status == "removed" {
        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
        return;
    }
    ws.consecutive_decrypt_errors = ws.consecutive_decrypt_errors.saturating_add(1);
    if ws.consecutive_decrypt_errors >= FORKED_DECRYPT_ERROR_THRESHOLD {
        ws.sync_health = SYNC_HEALTH_FORKED.to_owned();
    } else if ws.consecutive_decrypt_errors >= BEHIND_DECRYPT_ERROR_THRESHOLD {
        ws.sync_health = SYNC_HEALTH_BEHIND.to_owned();
    }
}

fn reset_health_on_clean_decrypt(ws: &mut StoredWorkspace) {
    ws.consecutive_decrypt_errors = 0;
    if ws.status == "removed" {
        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
    } else {
        ws.sync_health = SYNC_HEALTH_HEALTHY.to_owned();
    }
}

fn reduce_workspace_policy(
    workspace: &mut StoredWorkspace,
) -> Result<AdministratorPolicyState, String> {
    let policy = reduce_administrator_policy(&workspace.admin_pubkey, &workspace.envelopes)?;
    workspace.role = if policy
        .administrators
        .iter()
        .any(|p| p == &workspace.owner_pubkey)
    {
        "administrator".to_owned()
    } else {
        "member".to_owned()
    };
    if workspace.status == "removed" {
        workspace.sync_health = SYNC_HEALTH_REMOVED.to_owned();
    }
    Ok(policy)
}

fn apply_envelope_to_workspace(
    workspace: &mut StoredWorkspace,
    envelope: PrivateWorkspaceEnvelope,
    epoch: Option<u64>,
) -> Result<(), String> {
    if let Some(ep) = epoch {
        workspace
            .envelope_epochs
            .entry(envelope.id.clone())
            .or_insert(ep);
    }
    if workspace.envelopes.iter().any(|e| e.id == envelope.id) {
        return Ok(());
    }
    let policy_before = reduce_workspace_policy(workspace)?;
    let author_is_admin = policy_before
        .administrators
        .iter()
        .any(|p| p == &envelope.pubkey);
    if envelope.kind == PRIVATE_WORKSPACE_CHECKPOINT_KIND && author_is_admin {
        let manifest = parse_workspace_checkpoint_manifest(&envelope.content)?;
        let received: HashSet<&str> = workspace
            .envelopes
            .iter()
            .map(|e| e.id.as_str())
            .collect();
        let missing = manifest
            .envelope_ids
            .iter()
            .filter(|id| !received.contains(id.as_str()))
            .count();
        if missing > 0 {
            return Err(format!(
                "Private workspace checkpoint is incomplete ({missing} records missing)"
            ));
        }
    }
    if author_is_admin {
        if let Some(meta) = read_metadata(&envelope) {
            workspace.metadata = Some(meta);
        }
    }
    workspace.envelopes.push(envelope);
    reduce_workspace_policy(workspace)?;
    Ok(())
}

fn reconcile_acknowledged_outbounds(ws: &mut StoredWorkspace, through_cursor: u64) -> bool {
    if ws.pending_outbound.is_empty() {
        return false;
    }
    let mut acknowledged: Vec<PendingWorkspaceOutbound> = ws
        .pending_outbound
        .iter()
        .filter(|item| item.cursor <= through_cursor)
        .cloned()
        .collect();
    if acknowledged.is_empty() {
        return false;
    }
    acknowledged.sort_by_key(|item| item.cursor);
    let acknowledged_cursors: HashSet<u64> = acknowledged.iter().map(|i| i.cursor).collect();
    for item in acknowledged {
        let ep = ws.envelope_epochs.get(&item.envelope.id).copied();
        let _ = apply_envelope_to_workspace(ws, item.envelope, ep);
    }
    ws.pending_outbound
        .retain(|item| !acknowledged_cursors.contains(&item.cursor));
    true
}

/// Core single-message ingestion used identically by fetched batches and live `msg_sub_many`
/// push frames (caller MUST hold `workspace_mutex`).
fn ingest_single_coordinator_message(
    ws: &mut StoredWorkspace,
    msg: &CoordinatorMessage,
) -> Result<bool, String> {
    if ws.status == "removed" || msg.cursor <= ws.cursor {
        return Ok(false);
    }

    if let Some(pos) = ws
        .pending_outbound
        .iter()
        .position(|p| p.cursor == msg.cursor)
    {
        let item = ws.pending_outbound.remove(pos);
        let ep = ws.envelope_epochs.get(&item.envelope.id).copied();
        let _ = apply_envelope_to_workspace(ws, item.envelope, ep);
        reset_health_on_clean_decrypt(ws);
        ws.cursor = msg.cursor;
        return Ok(true);
    }

    let admins = reduce_workspace_policy(ws)?.administrators;
    let opened = if msg.encrypted {
        open_coordinator_payload(&ws.mls_state, &msg.msg_64)
    } else {
        Ok(msg.msg_64.clone())
    };
    match opened
        .and_then(|mls_b64| process_workspace_message_with_epoch(&ws.mls_state, &mls_b64, &admins))
    {
        Ok((
            ProcessedMlsMessage::ApplicationMessage {
                new_state,
                envelope,
            },
            msg_epoch,
        )) => {
            ws.mls_state = new_state;
            record_current_epoch_media_key(ws);
            reset_health_on_clean_decrypt(ws);
            let _ = apply_envelope_to_workspace(ws, envelope, Some(msg_epoch));
        }
        Ok((ProcessedMlsMessage::NewState(new_state), _epoch)) => {
            ws.mls_state = new_state;
            record_current_epoch_media_key(ws);
            if let Ok((_, members)) = inspect_group_summary(&ws.mls_state) {
                if !members.iter().any(|p| p == &ws.owner_pubkey) {
                    ws.status = "removed".to_owned();
                    ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                } else {
                    reset_health_on_clean_decrypt(ws);
                }
            } else {
                reset_health_on_clean_decrypt(ws);
            }
        }
        Ok((ProcessedMlsMessage::Removed(new_state), _epoch)) => {
            ws.mls_state = new_state;
            ws.status = "removed".to_owned();
            ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
        }
        Ok((ProcessedMlsMessage::Rejected(_), _epoch)) => {
            record_skipped_coordinator_message(ws, msg.cursor, "rejected");
        }
        Err(err) => {
            if ws.role == "member"
                && (err.contains("removed")
                    || err.contains("ancestor")
                    || err.contains("overlap"))
            {
                ws.status = "removed".to_owned();
                ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
            } else {
                record_skipped_coordinator_message(ws, msg.cursor, "stale-or-invalid");
                update_health_after_decrypt_failure(ws);
            }
        }
    }
    ws.cursor = msg.cursor;
    Ok(true)
}

impl PrivateWorkspaceService {
    pub fn new(
        signer: Arc<dyn NostrEventSigner>,
        store: Arc<SqlitePrivateWorkspaceStore>,
        default_coordinator_pubkey: String,
        default_relays: Vec<String>,
    ) -> Self {
        Self::with_factory(
            signer,
            store,
            default_coordinator_pubkey,
            default_relays,
            default_coordinator_factory(),
        )
    }

    pub fn with_factory(
        signer: Arc<dyn NostrEventSigner>,
        store: Arc<SqlitePrivateWorkspaceStore>,
        default_coordinator_pubkey: String,
        default_relays: Vec<String>,
        coordinator_factory: CoordinatorFactory,
    ) -> Self {
        Self {
            signer,
            store,
            default_coordinator_pubkey,
            default_relays,
            coordinator_factory,
        }
    }

    fn owner_pubkey(&self) -> String {
        self.signer.pubkey_hex()
    }

    fn coordinator(
        &self,
        server_pubkey: &str,
        relays: &[String],
    ) -> Result<Arc<dyn PrivateWorkspaceCoordinator>, String> {
        (self.coordinator_factory)(
            server_pubkey.to_owned(),
            relays.to_vec(),
            Arc::clone(&self.signer),
        )
    }

    fn administrator_policy(
        &self,
        workspace: &mut StoredWorkspace,
    ) -> Result<AdministratorPolicyState, String> {
        reduce_workspace_policy(workspace)
    }

    fn require_administrator(
        &self,
        workspace: &mut StoredWorkspace,
        action: &str,
    ) -> Result<AdministratorPolicyState, String> {
        let policy = self.administrator_policy(workspace)?;
        if !policy
            .administrators
            .iter()
            .any(|p| p == &workspace.owner_pubkey)
        {
            return Err(format!("Only administrators can {action}"));
        }
        Ok(policy)
    }

    fn require_workspace(&self, workspace_id: &str) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let mut ws = self
            .store
            .get_workspace(&owner, workspace_id)?
            .ok_or_else(|| "Circle was not found in this device profile".to_owned())?;
        self.administrator_policy(&mut ws)?;
        Ok(ws)
    }

    pub fn list_workspaces(&self) -> Result<Vec<StoredWorkspace>, String> {
        let owner = self.owner_pubkey();
        let mut list = self.store.list_workspaces(&owner)?;
        for ws in &mut list {
            let _ = self.administrator_policy(ws);
        }
        Ok(list)
    }

    pub fn list_pending_joins(&self) -> Result<Vec<PendingWorkspaceJoin>, String> {
        self.store.list_pending_joins(&self.owner_pubkey())
    }

    pub fn delete_workspace(&self, workspace_id: &str) -> Result<(), String> {
        let owner = self.owner_pubkey();
        self.store.delete_workspace(&owner, workspace_id)
    }

    pub fn create_workspace(&self, metadata: WorkspaceMetadata) -> Result<StoredWorkspace, String> {
        let name = metadata.name.trim().to_owned();
        if name.is_empty() {
            return Err("Circle name is required".to_owned());
        }
        let owner = self.owner_pubkey();
        let workspace_id = uuid::Uuid::new_v4().to_string();
        let group_id = format!("earthly:{}", random_token());
        let mls_state = create_workspace_group(&group_id, &owner)?;
        let mut ws = StoredWorkspace {
            workspace_id,
            group_id,
            owner_pubkey: owner.clone(),
            admin_pubkey: owner,
            coordinator_pubkey: self.default_coordinator_pubkey.clone(),
            relays: self.default_relays.clone(),
            role: "administrator".to_owned(),
            status: "active".to_owned(),
            mls_state,
            cursor: 0,
            metadata: Some(WorkspaceMetadata {
                name,
                description: metadata.description.filter(|s| !s.trim().is_empty()),
                recommended_basemap: metadata
                    .recommended_basemap
                    .filter(|s| !s.trim().is_empty()),
            }),
            envelopes: Vec::new(),
            pending_outbound: Vec::new(),
            pending_application: None,
            pending_approval: None,
            pending_membership_commit: None,
            skipped_coordinator_messages: Vec::new(),
            consecutive_decrypt_errors: 0,
            sync_health: SYNC_HEALTH_HEALTHY.to_owned(),
            auto_approve_joins: false,
            envelope_epochs: BTreeMap::new(),
            epoch_media_keys: BTreeMap::new(),
            created_at_ms: now_ms(),
        };
        record_current_epoch_media_key(&mut ws);
        self.store.put_workspace(&ws)?;
        Ok(ws)
    }

    pub async fn create_invitation_url(&self, workspace_id: &str) -> Result<String, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        self.require_administrator(&mut ws, "invite members")?;
        let token = create_private_map_invitation(
            self.signer.as_ref(),
            &ws.workspace_id,
            &ws.group_id,
            &ws.admin_pubkey,
            &ws.coordinator_pubkey,
            &ws.relays,
            &random_token(),
            now_secs(),
            None,
        )
        .await?;
        Ok(format_circle_invite_url(&ws.workspace_id, &token))
    }

    async fn publish_join_key_package(
        &self,
        coord: &dyn PrivateWorkspaceCoordinator,
        server_pubkey: &str,
        relays: &[String],
        owner_pubkey: &str,
        kp_ref: &str,
        kp_64: &str,
    ) -> Result<AvailableKeyPackage, String> {
        let mut uncertain_publish = false;
        let mut last_err = String::new();

        for attempt in 1..=MAX_TRANSIENT_COORDINATOR_ATTEMPTS {
            match coord
                .publish_key_package(kp_ref.to_owned(), kp_64.to_owned())
                .await
            {
                Ok(res) => {
                    return Ok(AvailableKeyPackage {
                        pk: owner_pubkey.to_owned(),
                        kp_ref: res.kp_ref,
                        last_resort: res.last_resort,
                        at: res.at,
                    });
                }
                Err(err) => {
                    let transient = is_transient_transport_error(&err);
                    last_err = err;
                    if !transient && !uncertain_publish {
                        return Err(last_err);
                    }
                    uncertain_publish = uncertain_publish || transient;
                    if transient {
                        reset_cordn_pool_connection(server_pubkey, relays).await;
                    }

                    match coord.list_key_packages().await {
                        Ok(available) => {
                            if let Some(found) = available
                                .key_packages
                                .into_iter()
                                .find(|item| item.pk == owner_pubkey && item.kp_ref == kp_ref)
                            {
                                return Ok(found);
                            }
                        }
                        Err(list_err) => {
                            if !is_transient_transport_error(&list_err) {
                                return Err(list_err);
                            }
                            last_err = list_err;
                        }
                    }

                    if !transient || attempt == MAX_TRANSIENT_COORDINATOR_ATTEMPTS {
                        return Err(last_err);
                    }
                    tokio::time::sleep(Duration::from_millis((attempt as u64) * 300)).await;
                }
            }
        }
        Err(last_err)
    }

    pub async fn request_to_join(&self, raw_invitation: &str) -> Result<PendingWorkspaceJoin, String> {
        let inv = decode_private_map_invitation(raw_invitation)?;
        assert_private_map_invitation_current(&inv, now_secs())?;
        let owner = self.owner_pubkey();
        if owner == inv.admin_pubkey {
            return Err("You already administer this Circle".to_owned());
        }
        let bundle = generate_mls_key_package(&owner, true)?;
        let mut stored_kp = StoredKeyPackage {
            owner_pubkey: owner.clone(),
            kp_ref: bundle.kp_ref.clone(),
            bundle: bundle.clone(),
            published: false,
            created_at_ms: now_ms(),
        };
        self.store.put_key_package(&stored_kp)?;

        let coord = self.coordinator(&inv.coordinator_pubkey, &inv.relays)?;
        let published = self
            .publish_join_key_package(
                coord.as_ref(),
                &inv.coordinator_pubkey,
                &inv.relays,
                &owner,
                &bundle.kp_ref,
                &bundle.kp_64,
            )
            .await?;
        if !bundle.last_resort || !published.last_resort {
            let _ = coord
                .remove_key_packages(vec![bundle.kp_ref.clone()])
                .await;
            return Err(
                "The coordinator did not recognize the retryable join KeyPackage profile"
                    .to_owned(),
            );
        }
        stored_kp.published = true;
        self.store.put_key_package(&stored_kp)?;

        let gid_clone = inv.group_id.clone();
        let kp_ref_clone = bundle.kp_ref.clone();
        retry_transient_coordinator_call(&inv.coordinator_pubkey, &inv.relays, || {
            let coord = Arc::clone(&coord);
            let gid = gid_clone.clone();
            let kp_ref = kp_ref_clone.clone();
            async move { coord.store_join_request(gid, kp_ref).await }
        })
        .await?;

        let pending = PendingWorkspaceJoin {
            owner_pubkey: owner,
            workspace_id: inv.workspace_id,
            group_id: inv.group_id,
            admin_pubkey: inv.admin_pubkey,
            coordinator_pubkey: inv.coordinator_pubkey,
            relays: inv.relays,
            key_package_ref: bundle.kp_ref,
            created_at_ms: now_ms(),
        };
        self.store.put_pending_join(&pending)?;
        Ok(pending)
    }

    pub async fn fetch_join_requests(
        &self,
        workspace_id: &str,
    ) -> Result<Vec<PendingJoinRequest>, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        let policy = self.administrator_policy(&mut ws)?;
        if ws.status != "active"
            || !policy
                .administrators
                .iter()
                .any(|p| p == &ws.owner_pubkey)
        {
            return Ok(Vec::new());
        }
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        let gid = ws.group_id.clone();
        let res = retry_transient_coordinator_call(&ws.coordinator_pubkey, &ws.relays, || {
            let coord = Arc::clone(&coord);
            let gid = gid.clone();
            async move { coord.take_join_requests(gid, None).await }
        })
        .await?;
        Ok(res.requests)
    }

    pub async fn set_auto_approve_joins(
        &self,
        workspace_id: &str,
        enabled: bool,
    ) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;
        let mut ws = self.require_workspace(workspace_id)?;
        self.require_administrator(&mut ws, "configure automatic join approvals")?;
        ws.auto_approve_joins = enabled;
        self.store.put_workspace(&ws)?;
        Ok(ws)
    }

    /// Polls pending join requests and automatically approves up to `max_batch` (capped at 15)
    /// when `auto_approve_joins` is enabled and the local identity is an administrator.
    pub async fn poll_and_auto_approve_join_requests(
        &self,
        workspace_id: &str,
        max_batch: usize,
    ) -> Result<AutoApproveResult, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        let policy = self.administrator_policy(&mut ws)?;
        let is_admin = policy
            .administrators
            .iter()
            .any(|p| p == &ws.owner_pubkey);
        if !ws.auto_approve_joins || ws.status != "active" || !is_admin || max_batch == 0 {
            return Ok(AutoApproveResult {
                workspace: ws,
                approved_pubkeys: Vec::new(),
                skipped_errors: Vec::new(),
            });
        }

        let limit = max_batch.min(MAX_AUTO_APPROVE_BATCH);
        let requests = self.fetch_join_requests(workspace_id).await?;
        let mut approved_pubkeys = Vec::new();
        let mut skipped_errors = Vec::new();
        let mut seen_pks = HashSet::new();

        for req in requests {
            if approved_pubkeys.len() >= limit {
                break;
            }
            if !seen_pks.insert(req.pk.clone()) {
                continue;
            }
            match self.approve_join_request(workspace_id, &req).await {
                Ok(updated) => {
                    ws = updated;
                    approved_pubkeys.push(req.pk);
                }
                Err(err) => {
                    skipped_errors.push((req.pk, err));
                }
            }
        }

        Ok(AutoApproveResult {
            workspace: ws,
            approved_pubkeys,
            skipped_errors,
        })
    }

    pub async fn approve_join_request(
        &self,
        workspace_id: &str,
        request: &PendingJoinRequest,
    ) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;
        self.approve_join_request_locked(workspace_id, request)
            .await
    }

    async fn approve_join_request_locked(
        &self,
        workspace_id: &str,
        request: &PendingJoinRequest,
    ) -> Result<StoredWorkspace, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        if let Some(pending) = &ws.pending_approval {
            if pending.target_pubkey != request.pk || pending.key_package_ref != request.kp_ref {
                return Err(
                    "Finish the pending member approval before approving another member".to_owned(),
                );
            }
            let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
            return self
                .resume_pending_approval_locked(&mut ws, coord.as_ref())
                .await
                .map(|_| ws);
        }

        ws = self.sync_workspace_locked(workspace_id, false).await?;
        self.require_administrator(&mut ws, "add members")?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;

        if member_pubkeys_from_state(&ws.mls_state)?
            .iter()
            .any(|p| p == &request.pk)
        {
            let _ = coord
                .take_join_requests(
                    ws.group_id.clone(),
                    Some(vec![ConsumedJoinRequest {
                        pk: request.pk.clone(),
                        at: request.at,
                    }]),
                )
                .await;
            return Ok(ws);
        }

        let kp_64 = self
            .take_and_verify_approval_key_package(
                request,
                coord.as_ref(),
                &ws.coordinator_pubkey,
                &ws.relays,
            )
            .await?;
        let approval = self.create_pending_approval(&mut ws, request, kp_64, 1).await?;
        ws.pending_approval = Some(approval);
        self.store.put_workspace(&ws)?;
        self.resume_pending_approval_locked(&mut ws, coord.as_ref())
            .await?;
        Ok(ws)
    }

    async fn take_and_verify_approval_key_package(
        &self,
        request: &PendingJoinRequest,
        coord: &dyn PrivateWorkspaceCoordinator,
        server_pubkey: &str,
        relays: &[String],
    ) -> Result<String, String> {
        let kp_ref = request.kp_ref.clone();
        let taken = retry_transient_coordinator_call(server_pubkey, relays, || {
            let id = kp_ref.clone();
            async move { coord.take_key_package(id).await }
        })
        .await?;
        let published = taken
            .key_package
            .ok_or_else(|| "The requested MLS KeyPackage is no longer available".to_owned())?;
        let pub_event_json = serde_json::to_string(&published.event)
            .map_err(|_| "Invalid KeyPackage publication event".to_owned())?;
        let pub_event = Event::from_json(&pub_event_json)
            .map_err(|_| "Invalid KeyPackage publication event JSON".to_owned())?;
        pub_event
            .verify()
            .map_err(|_| "Invalid KeyPackage publication signature".to_owned())?;
        if published.kp_ref != request.kp_ref {
            return Err("Coordinator returned a different KeyPackage than requested".to_owned());
        }
        if published.pk != request.pk || pub_event.pubkey.to_hex() != request.pk {
            return Err(
                "Join request identity does not match its KeyPackage publication".to_owned(),
            );
        }
        let kp_64 = publication_key_package_base64(&pub_event)?;
        if credential_pubkey_from_key_package_base64(&kp_64)? != request.pk {
            return Err(
                "KeyPackage credential is not bound to the requesting Nostr account".to_owned(),
            );
        }
        Ok(kp_64)
    }

    async fn create_pending_approval(
        &self,
        ws: &mut StoredWorkspace,
        request: &PendingJoinRequest,
        kp_64: String,
        attempt: u32,
    ) -> Result<PendingWorkspaceApproval, String> {
        let policy = self.require_administrator(ws, "add members")?;
        if credential_pubkey_from_key_package_base64(&kp_64)? != request.pk {
            return Err(
                "KeyPackage credential is not bound to the requesting Nostr account".to_owned(),
            );
        }

        let basis_cursor = ws
            .pending_outbound
            .iter()
            .map(|p| p.cursor)
            .fold(ws.cursor, u64::max);

        let checkpoint_envelopes =
            current_map_checkpoint_envelopes(&ws.admin_pubkey, &ws.envelopes)?;
        let metadata_envelope = if let Some(meta) = &ws.metadata {
            Some(
                create_private_envelope(
                    self.signer.as_ref(),
                    &ws.group_id,
                    PRIVATE_WORKSPACE_METADATA_KIND,
                    serde_json::to_string(meta).map_err(|e| e.to_string())?,
                    vec![vec!["d".to_owned(), "workspace-metadata".to_owned()]],
                    None,
                )
                .await?,
            )
        } else {
            None
        };
        let mut checkpoint_ids: Vec<String> =
            checkpoint_envelopes.iter().map(|e| e.id.clone()).collect();
        if let Some(meta_env) = &metadata_envelope {
            checkpoint_ids.push(meta_env.id.clone());
        }
        let manifest = create_workspace_checkpoint_manifest(basis_cursor, checkpoint_ids)?;
        let checkpoint_envelope = create_private_envelope(
            self.signer.as_ref(),
            &ws.group_id,
            PRIVATE_WORKSPACE_CHECKPOINT_KIND,
            serde_json::to_string(&manifest).map_err(|e| e.to_string())?,
            vec![vec!["d".to_owned(), "current-map-checkpoint".to_owned()]],
            None,
        )
        .await?;

        let old_state = ws.mls_state.clone();
        let added = add_workspace_member(&old_state, &kp_64, &policy.administrators)?;
        let sealed_commit = seal_coordinator_payload(&old_state, &added.commit_64)?;

        let mut planned_state = added.new_state;
        let mut messages = vec![PendingWorkspaceApprovalMessage {
            msg_type: "commit".to_owned(),
            msg_base64: sealed_commit,
            envelope: None,
            cursor: None,
        }];

        let mut append_app = |env: PrivateWorkspaceEnvelope, forwarded: bool| -> Result<(), String> {
            let state_before = planned_state.clone();
            let out = create_workspace_application_message(
                &state_before,
                &env,
                forwarded,
                &policy.administrators,
            )?;
            let sealed = seal_coordinator_payload(&state_before, &out.message_64)?;
            planned_state = out.new_state;
            messages.push(PendingWorkspaceApprovalMessage {
                msg_type: "application".to_owned(),
                msg_base64: sealed,
                envelope: Some(env),
                cursor: None,
            });
            Ok(())
        };

        for env in checkpoint_envelopes {
            append_app(env, true)?;
        }
        if let Some(meta_env) = metadata_envelope {
            append_app(meta_env, false)?;
        }
        append_app(checkpoint_envelope, false)?;

        Ok(PendingWorkspaceApproval {
            version: 1,
            target_pubkey: request.pk.clone(),
            key_package_ref: request.kp_ref.clone(),
            key_package_base64: Some(kp_64),
            request_at: request.at,
            basis_cursor,
            basis_mls_state: Some(old_state),
            welcome_base64: added.welcome_64,
            final_mls_state: planned_state,
            messages,
            attempt,
            welcome_stored_at: None,
            local_finalized: false,
        })
    }

    async fn resume_pending_approval_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<(), String> {
        for _pass in 0..MAX_MEMBERSHIP_RECOVERY_PASSES {
            let Some(approval) = ws.pending_approval.clone() else {
                return Ok(());
            };
            if approval.version != 1 {
                return Err("Unsupported private-map approval recovery journal".to_owned());
            }
            if approval.messages.is_empty() || approval.messages[0].msg_type != "commit" {
                return Err("Invalid private-map approval recovery journal".to_owned());
            }
            if approval.local_finalized {
                return self
                    .complete_pending_approval_publication_locked(ws, coord)
                    .await;
            }
            self.require_administrator(ws, "recover member approval")?;

            let basis_after = if approval.basis_cursor > 0 {
                Some(approval.basis_cursor)
            } else {
                None
            };
            let first_fetch = retry_transient_coordinator_call(
                &ws.coordinator_pubkey,
                &ws.relays,
                || {
                    let gid = ws.group_id.clone();
                    async move { coord.fetch_messages(gid, basis_after).await }
                },
            )
            .await?;

            // Post every unacknowledged planned message idempotently.
            let mut updated_approval = approval;
            for idx in 0..updated_approval.messages.len() {
                if updated_approval.messages[idx].cursor.is_some() {
                    continue;
                }
                let msg_64 = updated_approval.messages[idx].msg_base64.clone();
                if let Some(existing) = first_fetch.messages.iter().find(|m| m.msg_64 == msg_64) {
                    updated_approval.messages[idx].cursor = Some(existing.cursor);
                } else {
                    let posted = retry_transient_coordinator_call(
                        &ws.coordinator_pubkey,
                        &ws.relays,
                        || {
                            let gid = ws.group_id.clone();
                            let payload = msg_64.clone();
                            async move { coord.post_message(gid, payload).await }
                        },
                    )
                    .await?;
                    updated_approval.messages[idx].cursor = Some(posted.cursor);
                }
                ws.pending_approval = Some(updated_approval.clone());
                self.store.put_workspace(ws)?;
            }

            let delivered = retry_transient_coordinator_call(
                &ws.coordinator_pubkey,
                &ws.relays,
                || {
                    let gid = ws.group_id.clone();
                    async move { coord.fetch_messages(gid, basis_after).await }
                },
            )
            .await?;

            let delivered_ciphertexts: HashSet<&str> = delivered
                .messages
                .iter()
                .map(|m| m.msg_64.as_str())
                .collect();
            let plan_is_contiguous = updated_approval
                .messages
                .iter()
                .enumerate()
                .all(|(idx, m)| m.cursor == Some(updated_approval.basis_cursor + (idx as u64) + 1));
            let coordinator_omitted = updated_approval
                .messages
                .iter()
                .any(|m| !delivered_ciphertexts.contains(m.msg_base64.as_str()));
            if coordinator_omitted && !plan_is_contiguous {
                return Err(
                    "Coordinator did not return the posted private-group approval records"
                        .to_owned(),
                );
            }
            let final_planned_cursor = updated_approval
                .messages
                .iter()
                .filter_map(|m| m.cursor)
                .fold(updated_approval.basis_cursor, u64::max);

            let mut replay_messages: Vec<CoordinatorMessage> = if coordinator_omitted {
                let mut combined: Vec<CoordinatorMessage> = updated_approval
                    .messages
                    .iter()
                    .map(|m| CoordinatorMessage {
                        cursor: m.cursor.unwrap_or(0),
                        gid: ws.group_id.clone(),
                        msg_64: m.msg_base64.clone(),
                        at: 0,
                        encrypted: true,
                    })
                    .collect();
                combined.extend(
                    delivered
                        .messages
                        .into_iter()
                        .filter(|m| m.cursor > final_planned_cursor),
                );
                combined
            } else {
                delivered.messages
            };
            replay_messages.sort_by_key(|m| m.cursor);

            reconcile_acknowledged_outbounds(ws, updated_approval.basis_cursor);
            let mut state = updated_approval
                .basis_mls_state
                .clone()
                .unwrap_or_else(|| ws.mls_state.clone());
            let mut replay_cursor = updated_approval.basis_cursor;
            let mut epoch_changed_before_own_commit = false;
            let mut own_commit_accepted = false;

            let planned_by_ct: HashMap<&str, &PendingWorkspaceApprovalMessage> = updated_approval
                .messages
                .iter()
                .map(|m| (m.msg_base64.as_str(), m))
                .collect();

            for message in &replay_messages {
                if message.cursor <= replay_cursor {
                    continue;
                }
                if let Some(own_planned) = planned_by_ct.get(message.msg_64.as_str()) {
                    if own_planned.msg_type == "commit" {
                        let policy = self.administrator_policy(ws)?;
                        let members_now = member_pubkeys_from_state(&state).unwrap_or_default();
                        if !epoch_changed_before_own_commit
                            && policy.administrators.iter().any(|p| p == &ws.owner_pubkey)
                            && !members_now
                                .iter()
                                .any(|p| p == &updated_approval.target_pubkey)
                        {
                            state = updated_approval.final_mls_state.clone();
                            let new_epoch = epoch_from_state(&state).ok();
                            for planned in &updated_approval.messages {
                                if planned.msg_type == "application" {
                                    if let Some(env) = &planned.envelope {
                                        let _ = apply_envelope_to_workspace(
                                            ws,
                                            env.clone(),
                                            new_epoch,
                                        );
                                    }
                                }
                            }
                            own_commit_accepted = true;
                        } else {
                            record_skipped_coordinator_message(
                                ws,
                                message.cursor,
                                "stale-or-invalid",
                            );
                        }
                    } else if !own_commit_accepted {
                        record_skipped_coordinator_message(ws, message.cursor, "stale-or-invalid");
                    }
                    replay_cursor = message.cursor;
                    continue;
                }

                let epoch_before = epoch_from_state(&state).unwrap_or(0);
                let admins = self.administrator_policy(ws)?.administrators;
                let opened = if message.encrypted {
                    open_coordinator_payload(&state, &message.msg_64)
                } else {
                    Ok(message.msg_64.clone())
                };
                match opened.and_then(|mls_b64| {
                    process_workspace_message_with_epoch(&state, &mls_b64, &admins)
                }) {
                    Ok((
                        ProcessedMlsMessage::ApplicationMessage {
                            new_state,
                            envelope,
                        },
                        msg_ep,
                    )) => {
                        state = new_state;
                        let _ = apply_envelope_to_workspace(ws, envelope, Some(msg_ep));
                    }
                    Ok((ProcessedMlsMessage::NewState(new_state), _)) => {
                        state = new_state;
                    }
                    Ok((ProcessedMlsMessage::Removed(new_state), _)) => {
                        state = new_state;
                        ws.status = "removed".to_owned();
                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                    }
                    Ok((ProcessedMlsMessage::Rejected(_), _)) => {
                        record_skipped_coordinator_message(ws, message.cursor, "rejected");
                    }
                    Err(err) => {
                        if ws.role == "member"
                            && (err.contains("removed")
                                || err.contains("ancestor")
                                || err.contains("overlap"))
                        {
                            ws.status = "removed".to_owned();
                            ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                        } else {
                            record_skipped_coordinator_message(
                                ws,
                                message.cursor,
                                "stale-or-invalid",
                            );
                        }
                    }
                }
                if let Ok((epoch_after, members_after)) = inspect_group_summary(&state) {
                    if !own_commit_accepted && epoch_after != epoch_before {
                        epoch_changed_before_own_commit = true;
                    }
                    if !members_after.iter().any(|p| p == &ws.owner_pubkey) {
                        ws.status = "removed".to_owned();
                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                    }
                }
                replay_cursor = message.cursor;
                if ws.status == "removed" {
                    break;
                }
            }

            ws.mls_state = state;
            ws.cursor = replay_cursor;
            record_current_epoch_media_key(ws);
            let policy = self.administrator_policy(ws)?;
            let current_members = member_pubkeys_from_state(&ws.mls_state).unwrap_or_default();

            if ws.status == "removed" {
                ws.pending_approval = None;
                self.store.put_workspace(ws)?;
                return Ok(());
            }
            if own_commit_accepted
                && current_members
                    .iter()
                    .any(|p| p == &updated_approval.target_pubkey)
            {
                updated_approval.local_finalized = true;
                ws.pending_approval = Some(updated_approval);
                reset_health_on_clean_decrypt(ws);
                self.store.put_workspace(ws)?;
                return self
                    .complete_pending_approval_publication_locked(ws, coord)
                    .await;
            }
            if current_members
                .iter()
                .any(|p| p == &updated_approval.target_pubkey)
            {
                let _ = coord
                    .take_join_requests(
                        ws.group_id.clone(),
                        Some(vec![ConsumedJoinRequest {
                            pk: updated_approval.target_pubkey.clone(),
                            at: updated_approval.request_at,
                        }]),
                    )
                    .await;
                ws.pending_approval = None;
                self.store.put_workspace(ws)?;
                return Ok(());
            }
            if !policy.administrators.iter().any(|p| p == &ws.owner_pubkey) {
                ws.pending_approval = None;
                self.store.put_workspace(ws)?;
                return Err(
                    "Administrator role changed concurrently; member approval was not applied"
                        .to_owned(),
                );
            }

            // Concurrent epoch advance won before our Add commit: rebuild in new epoch!
            let req = PendingJoinRequest {
                pk: updated_approval.target_pubkey.clone(),
                kp_ref: updated_approval.key_package_ref.clone(),
                at: updated_approval.request_at,
            };
            let kp_64 = match updated_approval.key_package_base64 {
                Some(kp) => kp,
                None => {
                    self.take_and_verify_approval_key_package(
                        &req,
                        coord,
                        &ws.coordinator_pubkey,
                        &ws.relays,
                    )
                    .await?
                }
            };
            let rebuilt = self
                .create_pending_approval(ws, &req, kp_64, updated_approval.attempt + 1)
                .await?;
            ws.pending_approval = Some(rebuilt);
            self.store.put_workspace(ws)?;
        }

        Err("Private-map membership kept changing; approval will resume on the next sync".to_owned())
    }

    async fn complete_pending_approval_publication_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<(), String> {
        let Some(mut approval) = ws.pending_approval.clone() else {
            return Ok(());
        };
        if approval.version != 1 || !approval.local_finalized {
            return Err("Private-map approval is not ready to publish its Welcome".to_owned());
        }
        let commit_cursor = approval
            .messages
            .first()
            .and_then(|m| m.cursor)
            .ok_or_else(|| "Private-map approval commit was not acknowledged".to_owned())?;

        if approval.welcome_stored_at.is_none() {
            let target_pk = approval.target_pubkey.clone();
            let kp_ref = approval.key_package_ref.clone();
            let welcome_64 = approval.welcome_base64.clone();
            let stored = retry_transient_coordinator_call(
                &ws.coordinator_pubkey,
                &ws.relays,
                || {
                    let target_pk = target_pk.clone();
                    let kp_ref = kp_ref.clone();
                    let welcome_64 = welcome_64.clone();
                    async move {
                        coord
                            .store_welcome(target_pk, kp_ref, welcome_64, Some(commit_cursor))
                            .await
                    }
                },
            )
            .await?;
            approval.welcome_stored_at = Some(stored.at);
            ws.pending_approval = Some(approval.clone());
            self.store.put_workspace(ws)?;
        }

        let _ = retry_transient_coordinator_call(&ws.coordinator_pubkey, &ws.relays, || {
            let gid = ws.group_id.clone();
            let consumed = vec![ConsumedJoinRequest {
                pk: approval.target_pubkey.clone(),
                at: approval.request_at,
            }];
            async move { coord.take_join_requests(gid, Some(consumed)).await }
        })
        .await;

        ws.pending_approval = None;
        self.store.put_workspace(ws)?;
        Ok(())
    }

    pub async fn accept_pending_welcomes(&self) -> Result<Vec<StoredWorkspace>, String> {
        let owner = self.owner_pubkey();
        let joins = self.store.list_pending_joins(&owner)?;
        let mut accepted = Vec::new();

        for pending in joins {
            let coord = self.coordinator(&pending.coordinator_pubkey, &pending.relays)?;
            let res = retry_transient_coordinator_call(
                &pending.coordinator_pubkey,
                &pending.relays,
                || {
                    let coord = Arc::clone(&coord);
                    async move { coord.take_welcomes(None).await }
                },
            )
            .await?;
            let Some(welcome) = res
                .welcomes
                .iter()
                .find(|w| w.kp_ref == pending.key_package_ref)
                .cloned()
            else {
                continue;
            };
            let stored_kp = self
                .store
                .get_key_package(&owner, &pending.key_package_ref)?
                .ok_or_else(|| "The MLS private KeyPackage for this Welcome is missing".to_owned())?;
            let mls_state = join_workspace_group(&welcome.welcome_64, &stored_kp.bundle)?;
            if mls_state.group_id != pending.group_id {
                return Err("Welcome is for another group".to_owned());
            }

            let lock = workspace_mutex(&owner, &pending.workspace_id);
            let _guard = lock.lock().await;

            let mut ws = StoredWorkspace {
                workspace_id: pending.workspace_id.clone(),
                group_id: pending.group_id.clone(),
                owner_pubkey: owner.clone(),
                admin_pubkey: pending.admin_pubkey.clone(),
                coordinator_pubkey: pending.coordinator_pubkey.clone(),
                relays: pending.relays.clone(),
                role: "member".to_owned(),
                status: "active".to_owned(),
                mls_state,
                cursor: welcome.after.unwrap_or(0),
                metadata: None,
                envelopes: Vec::new(),
                pending_outbound: Vec::new(),
                pending_application: None,
                pending_approval: None,
                pending_membership_commit: None,
                skipped_coordinator_messages: Vec::new(),
                consecutive_decrypt_errors: 0,
                sync_health: SYNC_HEALTH_HEALTHY.to_owned(),
                auto_approve_joins: false,
                envelope_epochs: BTreeMap::new(),
                epoch_media_keys: BTreeMap::new(),
                created_at_ms: now_ms(),
            };
            record_current_epoch_media_key(&mut ws);
            self.store.put_workspace(&ws)?;

            if stored_kp.bundle.last_resort {
                let _ = coord
                    .remove_key_packages(vec![pending.key_package_ref.clone()])
                    .await;
            }
            self.store
                .delete_pending_join(&owner, &pending.key_package_ref)?;
            let consumed: Vec<ConsumedWelcome> = res
                .welcomes
                .iter()
                .filter(|w| w.kp_ref == welcome.kp_ref)
                .map(|w| ConsumedWelcome {
                    kp_ref: w.kp_ref.clone(),
                    at: w.at,
                })
                .collect();
            let _ = coord.take_welcomes(Some(consumed)).await;

            self.sync_with_coordinator_locked(&mut ws, coord.as_ref())
                .await?;
            accepted.push(ws);
        }

        Ok(accepted)
    }

    pub async fn sync_workspace(&self, workspace_id: &str) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;
        self.sync_workspace_locked(workspace_id, false).await
    }

    /// Read-only background sync for a single workspace using ZERO user signing calls
    /// (ephemeral delivery key only — never triggers Amber NIP-55 or NIP-46 prompts).
    pub async fn sync_workspace_readonly(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
        workspace_id: &str,
    ) -> Result<StoredWorkspace, String> {
        Self::sync_workspace_readonly_with_factory(
            store,
            owner_pubkey,
            workspace_id,
            default_coordinator_factory(),
        )
        .await
    }

    pub async fn sync_workspace_readonly_with_factory(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
        workspace_id: &str,
        coordinator_factory: CoordinatorFactory,
    ) -> Result<StoredWorkspace, String> {
        let readonly_signer: Arc<dyn NostrEventSigner> =
            Arc::new(ReadOnlyNostrSigner::new(owner_pubkey.to_owned())?);
        let svc = Self::with_factory(
            readonly_signer,
            store,
            String::new(),
            Vec::new(),
            coordinator_factory,
        );
        let lock = workspace_mutex(owner_pubkey, workspace_id);
        let _guard = lock.lock().await;
        svc.sync_workspace_locked(workspace_id, true).await
    }

    /// Read-only batched sync across ALL active workspaces for `owner_pubkey` using Cordn v0.5
    /// `msg_fetch_many` (with automatic v0.4 `msg_fetch` fallback) and ZERO user signing calls.
    pub async fn sync_all_workspaces_readonly(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
    ) -> Result<Vec<StoredWorkspace>, String> {
        Self::sync_all_workspaces_readonly_with_factory(
            store,
            owner_pubkey,
            default_coordinator_factory(),
        )
        .await
    }

    pub async fn sync_all_workspaces_readonly_with_factory(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
        coordinator_factory: CoordinatorFactory,
    ) -> Result<Vec<StoredWorkspace>, String> {
        let readonly_signer: Arc<dyn NostrEventSigner> =
            Arc::new(ReadOnlyNostrSigner::new(owner_pubkey.to_owned())?);
        let workspaces = store.list_workspaces(owner_pubkey)?;
        if workspaces.is_empty() {
            return Ok(Vec::new());
        }

        // First resume any workspaces with delivery-recoverable pending journals individually.
        let svc = Self::with_factory(
            Arc::clone(&readonly_signer),
            Arc::clone(&store),
            String::new(),
            Vec::new(),
            Arc::clone(&coordinator_factory),
        );
        let mut journal_synced_ids = HashSet::new();
        let mut results_by_id: HashMap<String, StoredWorkspace> = HashMap::new();

        for ws in &workspaces {
            if ws.status == "removed" {
                results_by_id.insert(ws.workspace_id.clone(), ws.clone());
                continue;
            }
            if ws.pending_application.is_some()
                || ws.pending_membership_commit.is_some()
                || ws
                    .pending_approval
                    .as_ref()
                    .map(|a| a.local_finalized)
                    .unwrap_or(false)
            {
                let lock = workspace_mutex(owner_pubkey, &ws.workspace_id);
                let _guard = lock.lock().await;
                if let Ok(updated) = svc.sync_workspace_locked(&ws.workspace_id, true).await {
                    journal_synced_ids.insert(ws.workspace_id.clone());
                    results_by_id.insert(ws.workspace_id.clone(), updated);
                }
            }
        }

        // Group remaining active workspaces by canonical `(coordinator_pubkey, sorted_relays)` for batched `msg_fetch_many`.
        let mut by_endpoint: HashMap<(String, Vec<String>), Vec<StoredWorkspace>> = HashMap::new();
        for ws in workspaces {
            if ws.status == "removed"
                || journal_synced_ids.contains(&ws.workspace_id)
                || ws.pending_approval.is_some()
            {
                results_by_id.entry(ws.workspace_id.clone()).or_insert(ws);
                continue;
            }
            let key = canonical_cordn_pool_key(&ws.coordinator_pubkey, &ws.relays);
            by_endpoint.entry(key).or_default().push(ws);
        }

        for ((server_pk, relays), group_workspaces) in by_endpoint {
            let coord = (coordinator_factory)(
                server_pk.clone(),
                relays.clone(),
                Arc::clone(&readonly_signer),
            )?;
            let queries: Vec<GroupCursorQuery> = group_workspaces
                .iter()
                .map(|ws| GroupCursorQuery {
                    gid: ws.group_id.clone(),
                    after: if ws.cursor > 0 { Some(ws.cursor) } else { None },
                })
                .collect();

            let fetched = retry_transient_coordinator_call(&server_pk, &relays, || {
                let coord = Arc::clone(&coord);
                let q = queries.clone();
                async move { coord.fetch_many_messages(q).await }
            })
            .await?;

            let mut msgs_by_gid: HashMap<String, Vec<CoordinatorMessage>> = HashMap::new();
            for msg in fetched.messages {
                msgs_by_gid.entry(msg.gid.clone()).or_default().push(msg);
            }

            for ws_snapshot in group_workspaces {
                let lock = workspace_mutex(owner_pubkey, &ws_snapshot.workspace_id);
                let _guard = lock.lock().await;
                let Some(mut ws) = store.get_workspace(owner_pubkey, &ws_snapshot.workspace_id)?
                else {
                    continue;
                };
                if let Some(mut msgs) = msgs_by_gid.remove(&ws.group_id) {
                    msgs.sort_by_key(|m| m.cursor);
                    let mut changed = false;
                    for msg in &msgs {
                        if ingest_single_coordinator_message(&mut ws, msg)? {
                            changed = true;
                        }
                        if ws.status == "removed" {
                            break;
                        }
                    }
                    let cur = ws.cursor;
                    let reconciled = reconcile_acknowledged_outbounds(&mut ws, cur);
                    if changed || reconciled {
                        let _ = reduce_workspace_policy(&mut ws);
                        record_current_epoch_media_key(&mut ws);
                        store.put_workspace(&ws)?;
                    }
                } else {
                    let cur = ws.cursor;
                    if reconcile_acknowledged_outbounds(&mut ws, cur) {
                        let _ = reduce_workspace_policy(&mut ws);
                        store.put_workspace(&ws)?;
                    }
                }
                results_by_id.insert(ws.workspace_id.clone(), ws);
            }
        }

        let mut out: Vec<StoredWorkspace> = results_by_id.into_values().collect();
        out.sort_by(|a, b| b.created_at_ms.cmp(&a.created_at_ms));
        Ok(out)
    }

    /// Feeds a single live `msg_sub_many` streamed `CoordinatorMessage` through the exact same
    /// per-workspace locked ingestion pipeline as fetched messages (ZERO user signing).
    pub async fn ingest_streamed_message(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
        workspace_id: &str,
        msg: CoordinatorMessage,
    ) -> Result<Option<StoredWorkspace>, String> {
        let lock = workspace_mutex(owner_pubkey, workspace_id);
        let _guard = lock.lock().await;

        let Some(mut ws) = store.get_workspace(owner_pubkey, workspace_id)? else {
            return Ok(None);
        };
        if ws.group_id != msg.gid || ws.status == "removed" || msg.cursor <= ws.cursor {
            return Ok(None);
        }
        // Do not interleave stream frames while an approval or membership journal is mid-flight.
        if ws.pending_application.is_some()
            || ws.pending_approval.is_some()
            || ws.pending_membership_commit.is_some()
        {
            return Ok(None);
        }

        let changed = ingest_single_coordinator_message(&mut ws, &msg)?;
        if !changed {
            return Ok(None);
        }
        let cur = ws.cursor;
        reconcile_acknowledged_outbounds(&mut ws, cur);
        let _ = reduce_workspace_policy(&mut ws);
        record_current_epoch_media_key(&mut ws);
        store.put_workspace(&ws)?;
        Ok(Some(ws))
    }

    async fn sync_workspace_locked(
        &self,
        workspace_id: &str,
        readonly: bool,
    ) -> Result<StoredWorkspace, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        if ws.pending_application.is_some() {
            self.resume_pending_application_locked(&mut ws, coord.as_ref())
                .await?;
            return Ok(ws);
        }
        if let Some(approval) = &ws.pending_approval {
            if !readonly || approval.local_finalized {
                self.resume_pending_approval_locked(&mut ws, coord.as_ref())
                    .await?;
                return Ok(ws);
            }
            // In read-only mode with an unfinalized approval journal that might require
            // user signing if rebuilt, avoid disrupting the journal.
            return Ok(ws);
        }
        if ws.pending_membership_commit.is_some() {
            self.resume_pending_membership_commit_locked(&mut ws, coord.as_ref())
                .await?;
            return Ok(ws);
        }
        self.sync_with_coordinator_locked(&mut ws, coord.as_ref())
            .await?;
        Ok(ws)
    }

    async fn sync_with_coordinator_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<bool, String> {
        if ws.status == "removed" {
            return Ok(false);
        }
        let after = if ws.cursor > 0 { Some(ws.cursor) } else { None };
        let fetched = retry_transient_coordinator_call(&ws.coordinator_pubkey, &ws.relays, || {
            let gid = ws.group_id.clone();
            async move { coord.fetch_messages(gid, after).await }
        })
        .await?;
        if fetched.messages.is_empty() {
            let reconciled = reconcile_acknowledged_outbounds(ws, ws.cursor);
            if reconciled {
                self.administrator_policy(ws)?;
                self.store.put_workspace(ws)?;
            }
            return Ok(reconciled);
        }
        let mut messages = fetched.messages;
        messages.sort_by_key(|m| m.cursor);

        let mut changed = false;
        for msg in &messages {
            if ingest_single_coordinator_message(ws, msg)? {
                changed = true;
            }
            if ws.status == "removed" {
                break;
            }
        }
        let reconciled = reconcile_acknowledged_outbounds(ws, ws.cursor);
        self.administrator_policy(ws)?;
        record_current_epoch_media_key(ws);
        self.store.put_workspace(ws)?;
        Ok(changed || reconciled)
    }

    /// Resets transient error/fork counters, clears skipped records and unfinalized stuck
    /// journals, ensures the current epoch media key is cached, and runs a fresh sync.
    pub async fn repair_workspace_sync_state(
        &self,
        workspace_id: &str,
    ) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;
        let mut ws = self.require_workspace(workspace_id)?;
        Self::apply_local_repair(&mut ws);
        self.store.put_workspace(&ws)?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        self.sync_with_coordinator_locked(&mut ws, coord.as_ref())
            .await?;
        Ok(ws)
    }

    /// Local-only repair helper (no network call, no user signer required).
    pub async fn repair_workspace_sync_state_local(
        store: Arc<SqlitePrivateWorkspaceStore>,
        owner_pubkey: &str,
        workspace_id: &str,
    ) -> Result<StoredWorkspace, String> {
        let lock = workspace_mutex(owner_pubkey, workspace_id);
        let _guard = lock.lock().await;
        let mut ws = store
            .get_workspace(owner_pubkey, workspace_id)?
            .ok_or_else(|| "Circle was not found in this device profile".to_owned())?;
        Self::apply_local_repair(&mut ws);
        let _ = reduce_workspace_policy(&mut ws);
        store.put_workspace(&ws)?;
        Ok(ws)
    }

    fn apply_local_repair(ws: &mut StoredWorkspace) {
        ws.consecutive_decrypt_errors = 0;
        ws.skipped_coordinator_messages.clear();
        ws.pending_application = None;
        ws.pending_membership_commit = None;
        if ws
            .pending_approval
            .as_ref()
            .map(|a| !a.local_finalized)
            .unwrap_or(false)
        {
            ws.pending_approval = None;
        }
        reconcile_acknowledged_outbounds(ws, ws.cursor);
        if ws.status == "removed" {
            ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
        } else {
            ws.sync_health = SYNC_HEALTH_HEALTHY.to_owned();
        }
        record_current_epoch_media_key(ws);
    }

    pub async fn send_chat(
        &self,
        workspace_id: &str,
        content: &str,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        let trimmed = content.trim();
        if trimmed.is_empty() {
            return Err("Message cannot be empty".to_owned());
        }
        self.send_envelope(
            workspace_id,
            PRIVATE_WORKSPACE_CHAT_KIND,
            trimmed.to_owned(),
            Vec::new(),
        )
        .await
    }

    pub async fn send_comment(
        &self,
        workspace_id: &str,
        text: &str,
        geojson_json: Option<&str>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        self.send_comment_with_media(workspace_id, text, geojson_json, Vec::new())
            .await
    }

    pub async fn send_comment_with_media(
        &self,
        workspace_id: &str,
        text: &str,
        geojson_json: Option<&str>,
        media_imeta_tags: Vec<Vec<String>>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        for tag in &media_imeta_tags {
            parse_imeta_tag(tag)?;
        }
        let trimmed = text.trim();
        let parsed_geo = match geojson_json.map(str::trim).filter(|s| !s.is_empty()) {
            Some(raw) => {
                let val: serde_json::Value = serde_json::from_str(raw)
                    .map_err(|e| format!("Invalid comment attachment GeoJSON: {e}"))?;
                if val.get("type").and_then(|t| t.as_str()) != Some("FeatureCollection") {
                    return Err("A comment attachment must be a GeoJSON FeatureCollection".to_owned());
                }
                Some(val)
            }
            None => None,
        };
        let has_geo = parsed_geo
            .as_ref()
            .and_then(|v| v.get("features"))
            .and_then(|f| f.as_array())
            .map(|a| !a.is_empty())
            .unwrap_or(false);
        if trimmed.is_empty() && !has_geo && media_imeta_tags.is_empty() {
            return Err("A Circle comment needs text, geometry, or media".to_owned());
        }
        let body = if let Some(geo) = parsed_geo.filter(|_| has_geo) {
            serde_json::json!({ "text": trimmed, "geojson": geo })
        } else {
            serde_json::json!({ "text": trimmed })
        };
        let mut tags = vec![vec!["d".to_owned(), uuid::Uuid::new_v4().to_string()]];
        tags.extend(media_imeta_tags);
        self.send_envelope(workspace_id, GEO_COMMENT_KIND, body.to_string(), tags)
            .await
    }

    pub async fn send_dataset(
        &self,
        workspace_id: &str,
        geojson_json: &str,
        dataset_id: Option<&str>,
        name: Option<&str>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        self.send_dataset_with_media(workspace_id, geojson_json, dataset_id, name, Vec::new())
            .await
    }

    pub async fn send_dataset_with_media(
        &self,
        workspace_id: &str,
        geojson_json: &str,
        dataset_id: Option<&str>,
        name: Option<&str>,
        media_imeta_tags: Vec<Vec<String>>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        for tag in &media_imeta_tags {
            parse_imeta_tag(tag)?;
        }
        let val: serde_json::Value = serde_json::from_str(geojson_json)
            .map_err(|e| format!("Invalid GeoJSON dataset: {e}"))?;
        if val.get("type").and_then(|t| t.as_str()) != Some("FeatureCollection") {
            return Err("A Circle Map dataset must be a GeoJSON FeatureCollection".to_owned());
        }
        let title = name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .or_else(|| val.get("name").and_then(|n| n.as_str()))
            .unwrap_or("Private Map")
            .to_owned();
        let d_id = dataset_id
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

        let mut tags = vec![
            vec!["d".to_owned(), d_id],
            vec!["name".to_owned(), title],
        ];
        tags.extend(media_imeta_tags);

        self.send_envelope(workspace_id, GEO_EVENT_KIND, geojson_json.to_owned(), tags)
            .await
    }

    pub async fn remove_member(
        &self,
        workspace_id: &str,
        member_pubkey: &str,
    ) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;

        let mut ws = self.sync_workspace_locked(workspace_id, false).await?;
        if !member_pubkeys_from_state(&ws.mls_state)?
            .iter()
            .any(|p| p == member_pubkey)
        {
            return Ok(ws);
        }
        let policy = self.require_administrator(&mut ws, "remove members")?;
        if policy.administrators.iter().any(|p| p == member_pubkey) {
            return Err("Demote this administrator before removing them".to_owned());
        }
        if !ws.pending_outbound.is_empty() {
            return Err(
                "Wait for pending private-map records to be confirmed before removing a member"
                    .to_owned(),
            );
        }
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        ws.pending_membership_commit =
            Some(self.create_pending_removal(&ws, member_pubkey, &policy.administrators, 1)?);
        self.store.put_workspace(&ws)?;
        self.resume_pending_membership_commit_locked(&mut ws, coord.as_ref())
            .await?;
        Ok(ws)
    }

    fn create_pending_removal(
        &self,
        ws: &StoredWorkspace,
        target_pubkey: &str,
        admins: &[String],
        attempt: u32,
    ) -> Result<PendingWorkspaceMembershipCommit, String> {
        let old_state = ws.mls_state.clone();
        let removed = remove_workspace_member(&old_state, target_pubkey, admins)?;
        let sealed = seal_coordinator_payload(&old_state, &removed.commit_64)?;
        Ok(PendingWorkspaceMembershipCommit {
            version: 1,
            operation: "remove".to_owned(),
            target_pubkey: target_pubkey.to_owned(),
            basis_cursor: ws.cursor,
            basis_mls_state: old_state,
            msg_base64: sealed,
            final_mls_state: removed.new_state,
            attempt,
            cursor: None,
        })
    }

    async fn resume_pending_membership_commit_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<(), String> {
        for _pass in 0..MAX_MEMBERSHIP_RECOVERY_PASSES {
            let Some(mut pending) = ws.pending_membership_commit.clone() else {
                return Ok(());
            };
            if pending.version != 1 || pending.operation != "remove" {
                return Err("Unsupported private-map membership recovery journal".to_owned());
            }
            if ws.pending_approval.is_some() {
                return Err(
                    "Finish the pending member approval before changing membership".to_owned(),
                );
            }

            let basis_after = if pending.basis_cursor > 0 {
                Some(pending.basis_cursor)
            } else {
                None
            };
            if pending.cursor.is_none() {
                let first_fetch = retry_transient_coordinator_call(
                    &ws.coordinator_pubkey,
                    &ws.relays,
                    || {
                        let gid = ws.group_id.clone();
                        async move { coord.fetch_messages(gid, basis_after).await }
                    },
                )
                .await?;
                if let Some(existing) = first_fetch
                    .messages
                    .iter()
                    .find(|m| m.msg_64 == pending.msg_base64)
                {
                    pending.cursor = Some(existing.cursor);
                } else {
                    let msg_64 = pending.msg_base64.clone();
                    let posted = retry_transient_coordinator_call(
                        &ws.coordinator_pubkey,
                        &ws.relays,
                        || {
                            let gid = ws.group_id.clone();
                            let payload = msg_64.clone();
                            async move { coord.post_message(gid, payload).await }
                        },
                    )
                    .await?;
                    pending.cursor = Some(posted.cursor);
                }
                ws.pending_membership_commit = Some(pending.clone());
                self.store.put_workspace(ws)?;
            }

            let delivered = retry_transient_coordinator_call(
                &ws.coordinator_pubkey,
                &ws.relays,
                || {
                    let gid = ws.group_id.clone();
                    async move { coord.fetch_messages(gid, basis_after).await }
                },
            )
            .await?;

            let mut state = pending.basis_mls_state.clone();
            let mut replay_cursor = pending.basis_cursor;
            let mut epoch_changed_before_own_commit = false;
            let mut own_commit_accepted = false;
            let mut own_commit_observed = false;

            let mut ordered = delivered.messages;
            ordered.sort_by_key(|m| m.cursor);
            for message in &ordered {
                if message.cursor <= replay_cursor {
                    continue;
                }
                if message.msg_64 == pending.msg_base64 {
                    own_commit_observed = true;
                    let policy = self.administrator_policy(ws)?;
                    let current_members = member_pubkeys_from_state(&state).unwrap_or_default();
                    if !epoch_changed_before_own_commit
                        && policy.administrators.iter().any(|p| p == &ws.owner_pubkey)
                        && !policy
                            .administrators
                            .iter()
                            .any(|p| p == &pending.target_pubkey)
                        && current_members
                            .iter()
                            .any(|p| p == &pending.target_pubkey)
                    {
                        state = pending.final_mls_state.clone();
                        own_commit_accepted = true;
                    } else {
                        record_skipped_coordinator_message(ws, message.cursor, "stale-or-invalid");
                    }
                    replay_cursor = message.cursor;
                    continue;
                }

                let epoch_before = epoch_from_state(&state).unwrap_or(0);
                let admins = self.administrator_policy(ws)?.administrators;
                let opened = if message.encrypted {
                    open_coordinator_payload(&state, &message.msg_64)
                } else {
                    Ok(message.msg_64.clone())
                };
                match opened.and_then(|mls_b64| {
                    process_workspace_message_with_epoch(&state, &mls_b64, &admins)
                }) {
                    Ok((
                        ProcessedMlsMessage::ApplicationMessage {
                            new_state,
                            envelope,
                        },
                        msg_ep,
                    )) => {
                        state = new_state;
                        let _ = apply_envelope_to_workspace(ws, envelope, Some(msg_ep));
                    }
                    Ok((ProcessedMlsMessage::NewState(new_state), _)) => {
                        state = new_state;
                    }
                    Ok((ProcessedMlsMessage::Removed(new_state), _)) => {
                        state = new_state;
                        ws.status = "removed".to_owned();
                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                    }
                    Ok((ProcessedMlsMessage::Rejected(_), _)) => {
                        record_skipped_coordinator_message(ws, message.cursor, "rejected");
                    }
                    Err(err) => {
                        if ws.role == "member"
                            && (err.contains("removed")
                                || err.contains("ancestor")
                                || err.contains("overlap"))
                        {
                            ws.status = "removed".to_owned();
                            ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                        } else {
                            record_skipped_coordinator_message(
                                ws,
                                message.cursor,
                                "stale-or-invalid",
                            );
                        }
                    }
                }
                if let Ok((epoch_after, members_after)) = inspect_group_summary(&state) {
                    if !own_commit_accepted && epoch_after != epoch_before {
                        epoch_changed_before_own_commit = true;
                    }
                    if !members_after.iter().any(|p| p == &ws.owner_pubkey) {
                        ws.status = "removed".to_owned();
                        ws.sync_health = SYNC_HEALTH_REMOVED.to_owned();
                    }
                }
                replay_cursor = message.cursor;
                if ws.status == "removed" {
                    break;
                }
            }

            if !own_commit_observed {
                return Err(
                    "Coordinator did not return the posted private-group membership record"
                        .to_owned(),
                );
            }

            ws.mls_state = state;
            ws.cursor = replay_cursor;
            reconcile_acknowledged_outbounds(ws, replay_cursor);
            record_current_epoch_media_key(ws);
            let policy = self.administrator_policy(ws)?;
            let current_members = member_pubkeys_from_state(&ws.mls_state).unwrap_or_default();

            if ws.status == "removed"
                || own_commit_accepted
                || !current_members
                    .iter()
                    .any(|p| p == &pending.target_pubkey)
            {
                ws.pending_membership_commit = None;
                reset_health_on_clean_decrypt(ws);
                self.store.put_workspace(ws)?;
                return Ok(());
            }
            if !policy.administrators.iter().any(|p| p == &ws.owner_pubkey) {
                ws.pending_membership_commit = None;
                self.store.put_workspace(ws)?;
                return Err(
                    "Administrator role changed concurrently; member removal was not applied"
                        .to_owned(),
                );
            }
            if policy
                .administrators
                .iter()
                .any(|p| p == &pending.target_pubkey)
            {
                ws.pending_membership_commit = None;
                self.store.put_workspace(ws)?;
                return Err(
                    "The member became an administrator concurrently and was not removed".to_owned(),
                );
            }

            ws.pending_membership_commit = Some(self.create_pending_removal(
                ws,
                &pending.target_pubkey,
                &policy.administrators,
                pending.attempt + 1,
            )?);
            self.store.put_workspace(ws)?;
        }

        Err("Private-map membership kept changing; removal will resume on the next sync".to_owned())
    }

    pub async fn set_administrator(
        &self,
        workspace_id: &str,
        member_pubkey: &str,
        administrator: bool,
    ) -> Result<StoredWorkspace, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;

        let mut ws = self.sync_workspace_locked(workspace_id, false).await?;
        let policy = self.require_administrator(&mut ws, "manage administrators")?;
        if !member_pubkeys_from_state(&ws.mls_state)?
            .iter()
            .any(|p| p == member_pubkey)
        {
            return Err("Only current Circle members can be administrators".to_owned());
        }
        let transition =
            create_administrator_policy_transition(&policy, member_pubkey, administrator)?;
        let envelope = self
            .send_envelope_locked(
                workspace_id,
                PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
                serde_json::to_string(&transition).map_err(|e| e.to_string())?,
                vec![vec!["d".to_owned(), "administrator-policy".to_owned()]],
            )
            .await?;
        let mut updated = self.require_workspace(workspace_id)?;
        let transition_is_pending = updated
            .pending_outbound
            .iter()
            .any(|item| item.envelope.id == envelope.id);
        if self.administrator_policy(&mut updated)?.head.as_deref() != Some(envelope.id.as_str())
            && !transition_is_pending
        {
            return Err(
                "Administrator policy changed concurrently; review the current roles and retry"
                    .to_owned(),
            );
        }
        self.store.put_workspace(&updated)?;
        Ok(updated)
    }

    async fn send_envelope(
        &self,
        workspace_id: &str,
        kind: u16,
        content: String,
        tags: Vec<Vec<String>>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        let owner = self.owner_pubkey();
        let lock = workspace_mutex(&owner, workspace_id);
        let _guard = lock.lock().await;
        self.send_envelope_locked(workspace_id, kind, content, tags)
            .await
    }

    async fn send_envelope_locked(
        &self,
        workspace_id: &str,
        kind: u16,
        content: String,
        tags: Vec<Vec<String>>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        let mut ws = self.sync_workspace_locked(workspace_id, false).await?;
        if ws.status != "active" {
            return Err("This account was removed from the Circle".to_owned());
        }
        let envelope = create_private_envelope(
            self.signer.as_ref(),
            &ws.group_id,
            kind,
            content,
            tags,
            None,
        )
        .await?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        self.post_application_envelope_locked(&mut ws, coord.as_ref(), envelope.clone(), false)
            .await?;
        Ok(envelope)
    }

    async fn post_application_envelope_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
        envelope: PrivateWorkspaceEnvelope,
        forwarded: bool,
    ) -> Result<(), String> {
        if ws.pending_application.is_some() {
            return Err(
                "Finish the pending private-map record before sending another".to_owned(),
            );
        }
        let policy = self.administrator_policy(ws)?;
        let old_state = ws.mls_state.clone();
        let outbound = create_workspace_application_message(
            &old_state,
            &envelope,
            forwarded,
            &policy.administrators,
        )?;
        let msg_base64 = seal_coordinator_payload(&old_state, &outbound.message_64)?;
        ws.pending_application = Some(PendingWorkspaceApplication {
            version: 1,
            envelope,
            forwarded,
            basis_cursor: ws.cursor,
            basis_mls_state: old_state,
            msg_base64,
            final_mls_state: outbound.new_state,
            attempt: 1,
            cursor: None,
        });
        self.store.put_workspace(ws)?;
        self.resume_pending_application_locked(ws, coord).await
    }

    async fn resume_pending_application_locked(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<(), String> {
        for _pass in 0..MAX_MEMBERSHIP_RECOVERY_PASSES {
            let Some(mut pending) = ws.pending_application.clone() else {
                return Ok(());
            };
            if pending.version != 1 {
                return Err("Unsupported private-map application recovery journal".to_owned());
            }
            assert_private_envelope_authorization(&pending.envelope, &ws.group_id)?;

            let basis_after = if pending.basis_cursor > 0 {
                Some(pending.basis_cursor)
            } else {
                None
            };

            if pending.cursor.is_none() {
                let fetched = retry_transient_coordinator_call(
                    &ws.coordinator_pubkey,
                    &ws.relays,
                    || {
                        let gid = ws.group_id.clone();
                        async move { coord.fetch_messages(gid, basis_after).await }
                    },
                )
                .await?;
                if let Some(existing) = fetched
                    .messages
                    .iter()
                    .find(|m| m.msg_64 == pending.msg_base64)
                {
                    pending.cursor = Some(existing.cursor);
                } else {
                    let msg_64 = pending.msg_base64.clone();
                    let posted = retry_transient_coordinator_call(
                        &ws.coordinator_pubkey,
                        &ws.relays,
                        || {
                            let gid = ws.group_id.clone();
                            let payload = msg_64.clone();
                            async move { coord.post_message(gid, payload).await }
                        },
                    )
                    .await?;
                    pending.cursor = Some(posted.cursor);
                }
                ws.pending_application = Some(pending.clone());
                self.store.put_workspace(ws)?;
            }

            let posted_cursor = pending.cursor.unwrap_or(0);
            let preceding = retry_transient_coordinator_call(
                &ws.coordinator_pubkey,
                &ws.relays,
                || {
                    let gid = ws.group_id.clone();
                    async move { coord.fetch_messages(gid, basis_after).await }
                },
            )
            .await?;

            let mut ordered_preceding: Vec<CoordinatorMessage> = preceding
                .messages
                .into_iter()
                .filter(|m| m.cursor < posted_cursor)
                .collect();
            ordered_preceding.sort_by_key(|m| m.cursor);

            if self.application_epoch_advanced(ws, &pending, &ordered_preceding) {
                self.catch_up_before_stale_application(ws, &pending, &ordered_preceding)?;
                if ws.status == "removed" {
                    ws.pending_application = None;
                    self.store.put_workspace(ws)?;
                    return Err(
                        "This account was removed before the pending private-map record could be delivered"
                            .to_owned(),
                    );
                }
                let rebuilt = self.rebuild_pending_application(ws, &pending)?;
                ws.pending_application = Some(rebuilt);
                self.store.put_workspace(ws)?;
                continue;
            }

            let sent_epoch = epoch_from_state(&pending.basis_mls_state).ok();
            ws.mls_state = pending.final_mls_state;
            record_current_epoch_media_key(ws);
            if !ws.pending_outbound.iter().any(|item| item.cursor == posted_cursor) {
                ws.pending_outbound.push(PendingWorkspaceOutbound {
                    cursor: posted_cursor,
                    envelope: pending.envelope.clone(),
                });
            }
            let _ = apply_envelope_to_workspace(ws, pending.envelope, sent_epoch);
            ws.pending_application = None;
            self.store.put_workspace(ws)?;
            let _ = self.sync_with_coordinator_locked(ws, coord).await;
            return Ok(());
        }

        Err("Private-map membership kept changing; the pending record will resume later".to_owned())
    }

    fn application_epoch_advanced(
        &self,
        ws: &StoredWorkspace,
        pending: &PendingWorkspaceApplication,
        messages: &[CoordinatorMessage],
    ) -> bool {
        if messages.is_empty() {
            return false;
        }
        let mut state = pending.basis_mls_state.clone();
        let basis_epoch = epoch_from_state(&state).unwrap_or(0);
        let mut probe = ws.clone();
        probe.mls_state = pending.basis_mls_state.clone();
        probe.cursor = pending.basis_cursor;

        for msg in messages {
            if let Some(prior) = probe
                .pending_outbound
                .iter()
                .find(|item| item.cursor == msg.cursor)
                .cloned()
            {
                let _ = apply_envelope_to_workspace(&mut probe, prior.envelope, None);
                continue;
            }
            let admins = reduce_workspace_policy(&mut probe)
                .map(|p| p.administrators)
                .unwrap_or_else(|_| vec![probe.admin_pubkey.clone()]);
            let opened = if msg.encrypted {
                open_coordinator_payload(&state, &msg.msg_64)
            } else {
                Ok(msg.msg_64.clone())
            };
            if let Ok((processed, ep)) = opened
                .and_then(|mls_b64| process_workspace_message_with_epoch(&state, &mls_b64, &admins))
            {
                match processed {
                    ProcessedMlsMessage::ApplicationMessage {
                        new_state,
                        envelope,
                    } => {
                        state = new_state;
                        let _ = apply_envelope_to_workspace(&mut probe, envelope, Some(ep));
                    }
                    ProcessedMlsMessage::NewState(new_state)
                    | ProcessedMlsMessage::Removed(new_state) => {
                        state = new_state;
                    }
                    ProcessedMlsMessage::Rejected(_) => {}
                }
            }
            if epoch_from_state(&state).unwrap_or(basis_epoch) != basis_epoch {
                return true;
            }
        }
        false
    }

    fn catch_up_before_stale_application(
        &self,
        ws: &mut StoredWorkspace,
        pending: &PendingWorkspaceApplication,
        messages: &[CoordinatorMessage],
    ) -> Result<(), String> {
        ws.mls_state = pending.basis_mls_state.clone();
        ws.cursor = pending.basis_cursor;
        for msg in messages {
            let _ = ingest_single_coordinator_message(ws, msg)?;
            if ws.status == "removed" {
                break;
            }
        }
        reconcile_acknowledged_outbounds(ws, ws.cursor);
        self.administrator_policy(ws)?;
        record_current_epoch_media_key(ws);
        Ok(())
    }

    fn rebuild_pending_application(
        &self,
        ws: &mut StoredWorkspace,
        pending: &PendingWorkspaceApplication,
    ) -> Result<PendingWorkspaceApplication, String> {
        let policy = self.administrator_policy(ws)?;
        let old_state = ws.mls_state.clone();
        let outbound = create_workspace_application_message(
            &old_state,
            &pending.envelope,
            pending.forwarded,
            &policy.administrators,
        )?;
        let msg_base64 = seal_coordinator_payload(&old_state, &outbound.message_64)?;
        Ok(PendingWorkspaceApplication {
            version: 1,
            envelope: pending.envelope.clone(),
            forwarded: pending.forwarded,
            basis_cursor: ws.cursor,
            basis_mls_state: old_state,
            msg_base64,
            final_mls_state: outbound.new_state,
            attempt: pending.attempt + 1,
            cursor: None,
        })
    }

    /// Loads MLS state once and returns `(epoch, members)`.
    pub fn inspect_summary(ws: &StoredWorkspace) -> Result<(u64, Vec<String>), String> {
        inspect_group_summary(&ws.mls_state)
    }

    pub fn members(ws: &StoredWorkspace) -> Vec<String> {
        member_pubkeys_from_state(&ws.mls_state).unwrap_or_default()
    }

    pub fn administrators(ws: &StoredWorkspace) -> Vec<String> {
        reduce_administrator_policy(&ws.admin_pubkey, &ws.envelopes)
            .map(|p| p.administrators)
            .unwrap_or_else(|_| vec![ws.admin_pubkey.clone()])
    }

    pub fn epoch(ws: &StoredWorkspace) -> u64 {
        epoch_from_state(&ws.mls_state).unwrap_or(0)
    }

    /// Returns the locally cached 32-byte `cordn-em-v1` media key for `epoch`, falling back
    /// to live derivation if `epoch` matches the workspace's current MLS epoch.
    pub fn media_key_for_epoch(ws: &StoredWorkspace, epoch: u64) -> Option<[u8; 32]> {
        if let Some(hex_key) = ws.epoch_media_keys.get(&epoch) {
            if let Ok(bytes) = hex::decode(hex_key) {
                if bytes.len() == 32 {
                    let mut arr = [0u8; 32];
                    arr.copy_from_slice(&bytes);
                    return Some(arr);
                }
            }
        }
        if let Ok((cur_epoch, key)) = derive_encrypted_media_key_with_epoch(&ws.mls_state) {
            if cur_epoch == epoch {
                return Some(key);
            }
        }
        None
    }

    /// Resolves the 32-byte `cordn-em-v1` media key for the epoch in which `envelope_id` was sent.
    pub fn media_key_for_envelope(ws: &StoredWorkspace, envelope_id: &str) -> Option<[u8; 32]> {
        let epoch = ws.envelope_epochs.get(envelope_id).copied()?;
        Self::media_key_for_epoch(ws, epoch)
    }

    /// Derives `(current_epoch, media_key)` for authoring a new `cordn-em-v1` media attachment.
    pub fn current_media_key(ws: &StoredWorkspace) -> Result<(u64, [u8; 32]), String> {
        derive_encrypted_media_key_with_epoch(&ws.mls_state)
    }

    pub fn project_datasets(ws: &StoredWorkspace) -> Vec<ProjectedPrivateDataset> {
        let mut latest: HashMap<String, &PrivateWorkspaceEnvelope> = HashMap::new();
        for env in &ws.envelopes {
            if env.kind != GEO_EVENT_KIND {
                continue;
            }
            if let Some(d) = env
                .tags
                .iter()
                .find(|t| t.first().map(String::as_str) == Some("d"))
                .and_then(|t| t.get(1))
            {
                latest.insert(format!("{}:{d}", env.pubkey), env);
            }
        }
        let mut out = Vec::new();
        for env in latest.values() {
            let Ok(val) = serde_json::from_str::<serde_json::Value>(&env.content) else {
                continue;
            };
            let feature_count = val
                .get("features")
                .and_then(|f| f.as_array())
                .map(|a| a.len())
                .unwrap_or(0);
            let dataset_id = env
                .tags
                .iter()
                .find(|t| t.first().map(String::as_str) == Some("d"))
                .and_then(|t| t.get(1))
                .cloned()
                .unwrap_or_else(|| env.id.clone());
            let title = env
                .tags
                .iter()
                .find(|t| {
                    matches!(
                        t.first().map(String::as_str),
                        Some("name") | Some("title")
                    )
                })
                .and_then(|t| t.get(1))
                .cloned()
                .or_else(|| {
                    val.get("name")
                        .and_then(|n| n.as_str())
                        .map(ToOwned::to_owned)
                })
                .unwrap_or_else(|| "Circle Map".to_owned());

            out.push(ProjectedPrivateDataset {
                workspace_id: ws.workspace_id.clone(),
                envelope_id: env.id.clone(),
                dataset_id,
                title,
                pubkey: env.pubkey.clone(),
                created_at: env.created_at,
                geojson_json: env.content.clone(),
                feature_count,
                media_attachments: parse_imeta_tags(&env.tags),
                epoch: ws.envelope_epochs.get(&env.id).copied(),
            });
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        out
    }

    pub fn project_messages(ws: &StoredWorkspace) -> Vec<ProjectedPrivateMessage> {
        let mut out = Vec::new();
        for env in &ws.envelopes {
            if env.kind == GEO_COMMENT_KIND {
                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&env.content) {
                    let text = val
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or_default()
                        .to_owned();
                    let geojson = val.get("geojson").filter(|g| g.is_object());
                    let geo_count = geojson
                        .and_then(|g| g.get("features"))
                        .and_then(|f| f.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0);
                    out.push(ProjectedPrivateMessage {
                        envelope_id: env.id.clone(),
                        pubkey: env.pubkey.clone(),
                        created_at: env.created_at,
                        kind: env.kind,
                        text,
                        geojson_json: geojson.map(|g| g.to_string()),
                        geometry_feature_count: geo_count,
                        media_attachments: parse_imeta_tags(&env.tags),
                        epoch: ws.envelope_epochs.get(&env.id).copied(),
                    });
                }
            } else if env.kind == PRIVATE_WORKSPACE_CHAT_KIND {
                out.push(ProjectedPrivateMessage {
                    envelope_id: env.id.clone(),
                    pubkey: env.pubkey.clone(),
                    created_at: env.created_at,
                    kind: env.kind,
                    text: env.content.clone(),
                    geojson_json: None,
                    geometry_feature_count: 0,
                    media_attachments: parse_imeta_tags(&env.tags),
                    epoch: ws.envelope_epochs.get(&env.id).copied(),
                });
            }
        }
        out.sort_by_key(|m| m.created_at);
        out
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;

    use nostr::Keys;

    use super::*;
    use crate::coordinator::{
        AvailableKeyPackage, BoxFuture, CoordinatorMessage, FetchMessagesResult,
        ListKeyPackagesResult, PendingWelcome, PostMessageResult, PublishKeyPackageResult,
        PublishedKeyPackage, RemoveKeyPackagesResult, StoreJoinRequestResult, StoreWelcomeResult,
        TakeJoinRequestsResult, TakeKeyPackageResult, TakeWelcomesResult,
    };
    use crate::envelope::LocalKeysSigner;
    use crate::media::{
        build_imeta_tag, decrypt_media_attachment, encrypt_cordn_media,
        encrypt_persistent_map_media,
    };
    use crate::mls::{derive_encrypted_media_key, process_workspace_message};

    #[derive(Default)]
    struct MockCordnState {
        key_packages: Vec<PublishedKeyPackage>,
        join_requests: HashMap<String, Vec<PendingJoinRequest>>,
        welcomes: HashMap<String, Vec<PendingWelcome>>,
        messages: HashMap<String, Vec<CoordinatorMessage>>,
        next_cursor: u64,
        clock: u64,
        fetch_many_calls: usize,
        fail_next_fetches: usize,
        fail_store_welcome_once: bool,
    }

    struct MockCordnCoordinator {
        state: Arc<Mutex<MockCordnState>>,
        caller_signer: Arc<dyn NostrEventSigner>,
    }

    impl PrivateWorkspaceCoordinator for MockCordnCoordinator {
        fn publish_key_package(
            &self,
            kp_ref: String,
            kp_64: String,
        ) -> BoxFuture<'_, PublishKeyPackageResult> {
            let state = Arc::clone(&self.state);
            let signer = Arc::clone(&self.caller_signer);
            Box::pin(async move {
                let rpc = serde_json::json!({
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {
                        "name": "kp_publish",
                        "arguments": { "kp_ref": kp_ref, "kp_64": kp_64 }
                    }
                });
                let ev = signer
                    .sign_event_template(25_910, now_secs(), vec![], rpc.to_string())
                    .await?;
                let ev_val: serde_json::Value =
                    serde_json::from_str(&ev.as_json()).map_err(|e| e.to_string())?;
                let (kp, _) = crate::mls::decode_raw_key_package_as_message(&kp_64)?;
                let last_resort = crate::mls::is_cordn_last_resort_key_package(&kp);
                let mut g = state.lock().unwrap();
                g.clock += 1;
                let at = g.clock;
                g.key_packages.push(PublishedKeyPackage {
                    pk: signer.pubkey_hex(),
                    kp_ref: kp_ref.clone(),
                    last_resort,
                    at,
                    event: ev_val,
                });
                Ok(PublishKeyPackageResult {
                    kp_ref,
                    last_resort,
                    at,
                })
            })
        }

        fn list_key_packages(&self) -> BoxFuture<'_, ListKeyPackagesResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let g = state.lock().unwrap();
                Ok(ListKeyPackagesResult {
                    key_packages: g
                        .key_packages
                        .iter()
                        .map(|k| AvailableKeyPackage {
                            pk: k.pk.clone(),
                            kp_ref: k.kp_ref.clone(),
                            last_resort: k.last_resort,
                            at: k.at,
                        })
                        .collect(),
                })
            })
        }

        fn take_key_package(&self, id: String) -> BoxFuture<'_, TakeKeyPackageResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                if let Some(idx) = g.key_packages.iter().position(|k| k.kp_ref == id) {
                    let kp = g.key_packages[idx].clone();
                    if !kp.last_resort {
                        g.key_packages.remove(idx);
                    }
                    Ok(TakeKeyPackageResult {
                        key_package: Some(kp),
                    })
                } else {
                    Ok(TakeKeyPackageResult { key_package: None })
                }
            })
        }

        fn remove_key_packages(
            &self,
            kp_refs: Vec<String>,
        ) -> BoxFuture<'_, RemoveKeyPackagesResult> {
            let state = Arc::clone(&self.state);
            let pk = self.caller_signer.pubkey_hex();
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                g.key_packages
                    .retain(|k| !(k.pk == pk && kp_refs.contains(&k.kp_ref)));
                Ok(RemoveKeyPackagesResult { kp_refs })
            })
        }

        fn take_welcomes(
            &self,
            consumed: Option<Vec<ConsumedWelcome>>,
        ) -> BoxFuture<'_, TakeWelcomesResult> {
            let state = Arc::clone(&self.state);
            let pk = self.caller_signer.pubkey_hex();
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                let entry = g.welcomes.entry(pk).or_default();
                if let Some(done) = consumed {
                    entry.retain(|w| !done.iter().any(|c| c.kp_ref == w.kp_ref && c.at == w.at));
                }
                Ok(TakeWelcomesResult {
                    welcomes: entry.clone(),
                })
            })
        }

        fn store_welcome(
            &self,
            target_pk: String,
            kp_ref: String,
            welcome_64: String,
            after: Option<u64>,
        ) -> BoxFuture<'_, StoreWelcomeResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                if g.fail_store_welcome_once {
                    g.fail_store_welcome_once = false;
                    return Err("Simulated non-transient store_welcome failure".to_owned());
                }
                g.clock += 1;
                let at = g.clock;
                g.welcomes.entry(target_pk).or_default().push(PendingWelcome {
                    kp_ref,
                    welcome_64,
                    at,
                    after,
                });
                Ok(StoreWelcomeResult { at })
            })
        }

        fn store_join_request(
            &self,
            gid: String,
            kp_ref: String,
        ) -> BoxFuture<'_, StoreJoinRequestResult> {
            let state = Arc::clone(&self.state);
            let pk = self.caller_signer.pubkey_hex();
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                g.clock += 1;
                let at = g.clock;
                g.join_requests
                    .entry(gid)
                    .or_default()
                    .push(PendingJoinRequest { pk, kp_ref, at });
                Ok(StoreJoinRequestResult { at })
            })
        }

        fn take_join_requests(
            &self,
            gid: String,
            consumed: Option<Vec<ConsumedJoinRequest>>,
        ) -> BoxFuture<'_, TakeJoinRequestsResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                let entry = g.join_requests.entry(gid).or_default();
                if let Some(done) = consumed {
                    entry.retain(|r| !done.iter().any(|c| c.pk == r.pk && c.at == r.at));
                }
                Ok(TakeJoinRequestsResult {
                    requests: entry.clone(),
                })
            })
        }

        fn post_message(&self, gid: String, msg_64: String) -> BoxFuture<'_, PostMessageResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                g.next_cursor += 1;
                g.clock += 1;
                let cursor = g.next_cursor;
                let at = g.clock;
                g.messages.entry(gid.clone()).or_default().push(CoordinatorMessage {
                    cursor,
                    gid: gid.clone(),
                    msg_64,
                    at,
                    encrypted: true,
                });
                Ok(PostMessageResult { cursor, gid, at })
            })
        }

        fn fetch_messages(
            &self,
            gid: String,
            after: Option<u64>,
        ) -> BoxFuture<'_, FetchMessagesResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                if g.fail_next_fetches > 0 {
                    g.fail_next_fetches -= 1;
                    return Err("Cordn msg_fetch timed out after 25s".to_owned());
                }
                let msgs = g
                    .messages
                    .get(&gid)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .filter(|m| after.map(|c| m.cursor > c).unwrap_or(true))
                    .collect();
                Ok(FetchMessagesResult { messages: msgs })
            })
        }

        fn fetch_many_messages(
            &self,
            groups: Vec<GroupCursorQuery>,
        ) -> BoxFuture<'_, FetchMessagesResult> {
            let state = Arc::clone(&self.state);
            Box::pin(async move {
                let mut g = state.lock().unwrap();
                g.fetch_many_calls += 1;
                let mut all = Vec::new();
                for q in groups {
                    if let Some(list) = g.messages.get(&q.gid) {
                        for m in list {
                            if q.after.map(|c| m.cursor > c).unwrap_or(true) {
                                all.push(m.clone());
                            }
                        }
                    }
                }
                Ok(FetchMessagesResult { messages: all })
            })
        }
    }

    fn make_mock_factory(shared: Arc<Mutex<MockCordnState>>) -> CoordinatorFactory {
        Arc::new(move |_pk, _relays, signer| {
            Ok(Arc::new(MockCordnCoordinator {
                state: Arc::clone(&shared),
                caller_signer: signer,
            }))
        })
    }

    #[tokio::test]
    async fn full_two_member_circle_lifecycle_and_removal_forward_secrecy() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let alice_pk = alice_keys.public_key().to_hex();
        let bob_pk = bob_keys.public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            alice_store,
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(bob_keys)),
            bob_store,
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Danube Field Crew".to_owned(),
                description: Some("Encrypted river survey".to_owned()),
                recommended_basemap: Some("OpenFreeMap Liberty".to_owned()),
            })
            .unwrap();
        let map_json = serde_json::json!({
            "type": "FeatureCollection",
            "name": "Survey Waypoints",
            "features": [{
                "type": "Feature",
                "geometry": { "type": "Point", "coordinates": [16.3725, 48.2089] },
                "properties": { "name": "Vienna Gauge" }
            }]
        })
        .to_string();
        alice
            .send_dataset(
                &ws.workspace_id,
                &map_json,
                Some("gauge-1"),
                Some("Survey Waypoints"),
            )
            .await
            .unwrap();

        let invite_url = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        assert!(invite_url.starts_with("https://earthly.city/circle/"));
        let pending = bob.request_to_join(&invite_url).await.unwrap();
        assert_eq!(pending.workspace_id, ws.workspace_id);

        let requests = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].pk, bob_pk);
        let ws_after_approve = alice
            .approve_join_request(&ws.workspace_id, &requests[0])
            .await
            .unwrap();
        assert_eq!(PrivateWorkspaceService::members(&ws_after_approve).len(), 2);

        let joined = bob.accept_pending_welcomes().await.unwrap();
        assert_eq!(joined.len(), 1);
        let bob_ws = &joined[0];
        assert_eq!(
            bob_ws.metadata.as_ref().map(|m| m.name.as_str()),
            Some("Danube Field Crew")
        );
        let bob_datasets = PrivateWorkspaceService::project_datasets(bob_ws);
        assert_eq!(bob_datasets.len(), 1);
        assert_eq!(bob_datasets[0].title, "Survey Waypoints");
        assert_eq!(bob_datasets[0].feature_count, 1);

        bob.send_comment(
            &ws.workspace_id,
            "Water level is +0.4m near bridge",
            Some(&map_json),
        )
        .await
        .unwrap();
        let alice_synced = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        let alice_msgs = PrivateWorkspaceService::project_messages(&alice_synced);
        assert_eq!(alice_msgs.len(), 1);
        assert_eq!(alice_msgs[0].text, "Water level is +0.4m near bridge");
        assert_eq!(alice_msgs[0].geometry_feature_count, 1);
        assert_eq!(alice_msgs[0].pubkey, bob_pk);

        let alice_after_remove = alice.remove_member(&ws.workspace_id, &bob_pk).await.unwrap();
        assert_eq!(
            PrivateWorkspaceService::members(&alice_after_remove),
            vec![alice_pk.clone()]
        );
        alice
            .send_chat(&ws.workspace_id, "Post-removal secret message")
            .await
            .unwrap();

        let bob_after_remove = bob.sync_workspace(&ws.workspace_id).await.unwrap();
        assert_eq!(bob_after_remove.status, "removed");
        assert_eq!(bob_after_remove.sync_health, SYNC_HEALTH_REMOVED);
        let bob_msgs = PrivateWorkspaceService::project_messages(&bob_after_remove);
        assert!(!bob_msgs
            .iter()
            .any(|m| m.text.contains("Post-removal secret")));
    }

    #[tokio::test]
    async fn rejects_non_admin_removal_and_supports_admin_promotion() {
        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let alice_pk = alice_keys.public_key().to_hex();
        let bob_pk = bob_keys.public_key().to_hex();

        let group_id = "earthly:policy-test";
        let alice_init = create_workspace_group(group_id, &alice_pk).unwrap();
        let bob_kp = generate_mls_key_package(&bob_pk, true).unwrap();
        assert!(bob_kp.last_resort);

        let added = add_workspace_member(&alice_init, &bob_kp.kp_64, &[alice_pk.clone()]).unwrap();
        let alice_state = added.new_state;
        let bob_state = join_workspace_group(&added.welcome_64, &bob_kp).unwrap();

        // Both members derive the EXACT same `cordn-em-v1` epoch media key!
        assert_eq!(
            derive_encrypted_media_key(&alice_state).unwrap(),
            derive_encrypted_media_key(&bob_state).unwrap()
        );

        let bad_removal =
            remove_workspace_member(&bob_state, &alice_pk, &[alice_pk.clone()]).unwrap();
        let sealed_bad = seal_coordinator_payload(&bob_state, &bad_removal.commit_64).unwrap();
        let opened_bad = open_coordinator_payload(&alice_state, &sealed_bad).unwrap();
        let res = process_workspace_message(&alice_state, &opened_bad, &[alice_pk.clone()]).unwrap();
        assert!(matches!(res, ProcessedMlsMessage::Rejected(_)));
        assert_eq!(inspect_group_summary(&alice_state).unwrap().1.len(), 2);
    }

    #[tokio::test]
    async fn readonly_sync_and_batched_fetch_many_and_stream_ingestion_zero_signing() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let bob_pk = bob_keys.public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            Arc::clone(&alice_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(bob_keys)),
            Arc::clone(&bob_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        // Create TWO circles and onboard Bob into both.
        let ws1 = alice
            .create_workspace(WorkspaceMetadata {
                name: "Circle One".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();
        let ws2 = alice
            .create_workspace(WorkspaceMetadata {
                name: "Circle Two".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();
        for ws_id in [&ws1.workspace_id, &ws2.workspace_id] {
            let inv = alice.create_invitation_url(ws_id).await.unwrap();
            bob.request_to_join(&inv).await.unwrap();
            let reqs = alice.fetch_join_requests(ws_id).await.unwrap();
            alice.approve_join_request(ws_id, &reqs[0]).await.unwrap();
        }
        let joined = bob.accept_pending_welcomes().await.unwrap();
        assert_eq!(joined.len(), 2);

        // Alice sends messages into both circles.
        alice.send_chat(&ws1.workspace_id, "Hello Circle 1").await.unwrap();
        alice.send_chat(&ws2.workspace_id, "Hello Circle 2").await.unwrap();

        // Bob syncs BOTH circles using read-only batched sync (ZERO user signing!).
        let synced_all = PrivateWorkspaceService::sync_all_workspaces_readonly_with_factory(
            Arc::clone(&bob_store),
            &bob_pk,
            make_mock_factory(Arc::clone(&coord_state)),
        )
        .await
        .unwrap();
        assert_eq!(synced_all.len(), 2);
        assert_eq!(coord_state.lock().unwrap().fetch_many_calls, 1);
        for ws in &synced_all {
            let msgs = PrivateWorkspaceService::project_messages(ws);
            assert_eq!(msgs.len(), 1);
            assert_eq!(ws.sync_health, SYNC_HEALTH_HEALTHY);
        }

        // Alice posts a new message to Circle 1; feed it directly via `ingest_streamed_message`!
        alice.send_chat(&ws1.workspace_id, "Live streamed push").await.unwrap();
        let latest_msg = coord_state
            .lock()
            .unwrap()
            .messages
            .get(&ws1.group_id)
            .unwrap()
            .last()
            .cloned()
            .unwrap();
        let updated = PrivateWorkspaceService::ingest_streamed_message(
            Arc::clone(&bob_store),
            &bob_pk,
            &ws1.workspace_id,
            latest_msg.clone(),
        )
        .await
        .unwrap()
        .expect("streamed message ingested");
        let msgs = PrivateWorkspaceService::project_messages(&updated);
        assert_eq!(msgs.len(), 2);
        assert_eq!(msgs[1].text, "Live streamed push");

        // Re-delivering the same cursor via stream is a clean no-op.
        let dup = PrivateWorkspaceService::ingest_streamed_message(
            Arc::clone(&bob_store),
            &bob_pk,
            &ws1.workspace_id,
            latest_msg,
        )
        .await
        .unwrap();
        assert!(dup.is_none());
    }

    #[tokio::test]
    async fn stale_epoch_pending_application_reencrypts_without_resigning() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let carol_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("carol.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let carol_keys = Keys::generate();
        let bob_pk = bob_keys.public_key().to_hex();

        // Wrap Bob's signer with a call counter to verify re-encryption does NOT re-sign!
        let sign_calls = Arc::new(AtomicUsize::new(0));
        struct CountingSigner {
            inner: LocalKeysSigner,
            count: Arc<AtomicUsize>,
        }
        impl NostrEventSigner for CountingSigner {
            fn pubkey_hex(&self) -> String {
                self.inner.pubkey_hex()
            }
            fn sign_event_template(
                &self,
                kind: u16,
                created_at: u64,
                tags: Vec<Vec<String>>,
                content: String,
            ) -> std::pin::Pin<
                Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>,
            > {
                self.count.fetch_add(1, Ordering::SeqCst);
                self.inner
                    .sign_event_template(kind, created_at, tags, content)
            }
        }

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            Arc::clone(&alice_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(CountingSigner {
                inner: LocalKeysSigner::new(bob_keys),
                count: Arc::clone(&sign_calls),
            }),
            Arc::clone(&bob_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let carol = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(carol_keys)),
            Arc::clone(&carol_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Race Test".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();
        let inv1 = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        bob.request_to_join(&inv1).await.unwrap();
        let req_bob = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
        alice
            .approve_join_request(&ws.workspace_id, &req_bob[0])
            .await
            .unwrap();
        bob.accept_pending_welcomes().await.unwrap();

        // Simulate Bob writing a pending_application journal at epoch 1 BEFORE Alice adds Carol (advancing to epoch 2).
        let bob_ws_before = bob_store.get_workspace(&bob_pk, &ws.workspace_id).unwrap().unwrap();
        let sign_before = sign_calls.load(Ordering::SeqCst);
        let env = create_private_envelope(
            bob.signer.as_ref(),
            &ws.group_id,
            PRIVATE_WORKSPACE_CHAT_KIND,
            "Stale-epoch message that must self-heal".to_owned(),
            vec![],
            None,
        )
        .await
        .unwrap();
        assert_eq!(sign_calls.load(Ordering::SeqCst), sign_before + 1);
        let out = create_workspace_application_message(
            &bob_ws_before.mls_state,
            &env,
            false,
            &PrivateWorkspaceService::administrators(&bob_ws_before),
        )
        .unwrap();
        let stale_sealed = seal_coordinator_payload(&bob_ws_before.mls_state, &out.message_64).unwrap();
        let mut bob_journaled = bob_ws_before.clone();
        bob_journaled.pending_application = Some(PendingWorkspaceApplication {
            version: 1,
            envelope: env.clone(),
            forwarded: false,
            basis_cursor: bob_ws_before.cursor,
            basis_mls_state: bob_ws_before.mls_state.clone(),
            msg_base64: stale_sealed,
            final_mls_state: out.new_state,
            attempt: 1,
            cursor: None,
        });
        bob_store.put_workspace(&bob_journaled).unwrap();

        // Now Alice concurrently adds Carol -> advances epoch to 2 BEFORE Bob posts!
        let inv2 = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        carol.request_to_join(&inv2).await.unwrap();
        let req_carol = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
        alice
            .approve_join_request(&ws.workspace_id, &req_carol[0])
            .await
            .unwrap();

        // Bob syncs -> detects epoch advanced before his posted message, catches up to epoch 2,
        // and re-encrypts the EXACT SAME envelope without calling the user signer again!
        let bob_after = bob.sync_workspace(&ws.workspace_id).await.unwrap();
        assert!(bob_after.pending_application.is_none());
        assert_eq!(sign_calls.load(Ordering::SeqCst), sign_before + 1);

        // Alice syncs and decrypts Bob's recovered message cleanly in epoch 2!
        let alice_after = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        let alice_msgs = PrivateWorkspaceService::project_messages(&alice_after);
        assert!(alice_msgs
            .iter()
            .any(|m| m.text == "Stale-epoch message that must self-heal"));
    }

    #[tokio::test]
    async fn crash_resumable_approval_and_auto_approve_and_transient_retry() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let carol_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("carol.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&alice_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&bob_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let carol = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&carol_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Resumable Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();
        let inv = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        bob.request_to_join(&inv).await.unwrap();
        let reqs = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();

        // Simulate crash during `store_welcome` after commit + checkpoint are finalized locally.
        coord_state.lock().unwrap().fail_store_welcome_once = true;
        let err = alice.approve_join_request(&ws.workspace_id, &reqs[0]).await;
        assert!(err.is_err());

        // Pending approval journal is persisted as `local_finalized = true`; resuming via sync delivers Welcome!
        let mid = alice.require_workspace(&ws.workspace_id).unwrap();
        assert!(mid.pending_approval.as_ref().unwrap().local_finalized);
        let resumed = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        assert!(resumed.pending_approval.is_none());

        let bob_joined = bob.accept_pending_welcomes().await.unwrap();
        assert_eq!(bob_joined.len(), 1);

        // Test transient coordinator retry (2 timeouts then success on attempt 3)
        coord_state.lock().unwrap().fail_next_fetches = 2;
        alice.sync_workspace(&ws.workspace_id).await.unwrap();

        // Test auto-approve joins
        let updated = alice
            .set_auto_approve_joins(&ws.workspace_id, true)
            .await
            .unwrap();
        assert!(updated.auto_approve_joins);
        carol.request_to_join(&inv).await.unwrap();
        let auto_res = alice
            .poll_and_auto_approve_join_requests(&ws.workspace_id, 15)
            .await
            .unwrap();
        assert_eq!(auto_res.approved_pubkeys.len(), 1);
        assert!(auto_res.skipped_errors.is_empty());
        assert_eq!(carol.accept_pending_welcomes().await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn fork_behind_detection_repair_and_legacy_sqlite_deserialization() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();
        let alice_keys = Keys::generate();
        let alice_pk = alice_keys.public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            Arc::clone(&alice_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Health Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();

        // Inject 2 corrupt coordinator messages -> sync_health transitions to "behind".
        for i in 1..=2u64 {
            coord_state
                .lock()
                .unwrap()
                .messages
                .entry(ws.group_id.clone())
                .or_default()
                .push(CoordinatorMessage {
                    cursor: i,
                    gid: ws.group_id.clone(),
                    msg_64: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_owned(),
                    at: 100 + i,
                    encrypted: true,
                });
        }
        coord_state.lock().unwrap().next_cursor = 2;

        let after_2 = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        assert_eq!(after_2.consecutive_decrypt_errors, 2);
        assert_eq!(after_2.sync_health, SYNC_HEALTH_BEHIND);
        assert_eq!(after_2.skipped_coordinator_messages.len(), 2);

        // Inject 3 more corrupt messages (total 5) -> sync_health transitions to "forked".
        for i in 3..=5u64 {
            coord_state
                .lock()
                .unwrap()
                .messages
                .entry(ws.group_id.clone())
                .or_default()
                .push(CoordinatorMessage {
                    cursor: i,
                    gid: ws.group_id.clone(),
                    msg_64: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB".to_owned(),
                    at: 100 + i,
                    encrypted: true,
                });
        }
        coord_state.lock().unwrap().next_cursor = 5;
        let after_5 = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        assert_eq!(after_5.consecutive_decrypt_errors, 5);
        assert_eq!(after_5.sync_health, SYNC_HEALTH_FORKED);

        // Repair resets health back to "healthy" and clears skipped errors.
        let repaired = alice
            .repair_workspace_sync_state(&ws.workspace_id)
            .await
            .unwrap();
        assert_eq!(repaired.consecutive_decrypt_errors, 0);
        assert_eq!(repaired.sync_health, SYNC_HEALTH_HEALTHY);
        assert!(repaired.skipped_coordinator_messages.is_empty());

        // Verify backwards compatibility: legacy StoredWorkspace JSON missing all new fields deserializes cleanly!
        let mut legacy_val = serde_json::to_value(&repaired).unwrap();
        let obj = legacy_val.as_object_mut().unwrap();
        for key in [
            "pendingApplication",
            "pendingApproval",
            "pendingMembershipCommit",
            "skippedCoordinatorMessages",
            "consecutiveDecryptErrors",
            "syncHealth",
            "autoApproveJoins",
            "envelopeEpochs",
            "epochMediaKeys",
        ] {
            obj.remove(key);
        }
        let parsed_legacy: StoredWorkspace = serde_json::from_value(legacy_val).unwrap();
        assert_eq!(parsed_legacy.owner_pubkey, alice_pk);
        assert_eq!(parsed_legacy.sync_health, SYNC_HEALTH_HEALTHY);
        assert!(!parsed_legacy.auto_approve_joins);
        assert_eq!(parsed_legacy.consecutive_decrypt_errors, 0);
    }

    #[tokio::test]
    async fn encrypted_media_comment_and_persistent_map_media_late_joiner_checkpoint() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&alice_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&bob_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Media Map Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();

        // 1. Alice attaches an `earthly-pm-v1` persistent map photo to a dataset BEFORE Bob joins.
        let map_photo_bytes = b"Persistent geological survey site photo";
        let pm_blob =
            encrypt_persistent_map_media(map_photo_bytes, "image/jpeg", "site-01.jpg").unwrap();
        let pm_imeta = pm_blob.clone().into_imeta(
            "https://blossom.earthly.city/pm1".to_owned(),
            Some("800x600".to_owned()),
            None,
            None,
            Some("Outcrop sample".to_owned()),
        );
        let pm_tag = build_imeta_tag(&pm_imeta).unwrap();
        let geo = r#"{"type":"FeatureCollection","name":"Geology","features":[]}"#;
        alice
            .send_dataset_with_media(&ws.workspace_id, geo, Some("geo-1"), Some("Geology"), vec![pm_tag])
            .await
            .unwrap();

        // 2. Bob joins later (epoch 1) -> receives checkpoint dataset with `earthly-pm-v1` imeta
        //    and decrypts the historical map photo cleanly WITHOUT having epoch 0's MLS key!
        let inv = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        bob.request_to_join(&inv).await.unwrap();
        let reqs = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
        alice
            .approve_join_request(&ws.workspace_id, &reqs[0])
            .await
            .unwrap();
        let bob_ws = bob.accept_pending_welcomes().await.unwrap().pop().unwrap();
        let bob_datasets = PrivateWorkspaceService::project_datasets(&bob_ws);
        assert_eq!(bob_datasets.len(), 1);
        assert_eq!(bob_datasets[0].media_attachments.len(), 1);
        let decrypted_pm = decrypt_media_attachment(
            &pm_blob.ciphertext,
            &bob_datasets[0].media_attachments[0],
            None,
        )
        .unwrap();
        assert_eq!(decrypted_pm, map_photo_bytes);

        // 3. In epoch 1, Alice sends a `cordn-em-v1` chat photo comment; Bob receives it and
        //    decrypts it via `media_key_for_envelope` (using locally cached `epoch_media_keys[1]`).
        let alice_ws_e1 = alice.require_workspace(&ws.workspace_id).unwrap();
        let (ep1, media_key_e1) = PrivateWorkspaceService::current_media_key(&alice_ws_e1).unwrap();
        assert_eq!(ep1, 1);
        let chat_photo_bytes = b"Live bridge photo in epoch 1";
        let em_blob =
            encrypt_cordn_media(chat_photo_bytes, &media_key_e1, "image/png", "bridge.png")
                .unwrap();
        let em_imeta = em_blob.clone().into_imeta(
            "https://blossom.earthly.city/em1".to_owned(),
            None,
            None,
            None,
            None,
        );
        let em_tag = build_imeta_tag(&em_imeta).unwrap();
        alice
            .send_comment_with_media(&ws.workspace_id, "Bridge photo", None, vec![em_tag])
            .await
            .unwrap();

        let bob_synced = bob.sync_workspace(&ws.workspace_id).await.unwrap();
        let bob_msgs = PrivateWorkspaceService::project_messages(&bob_synced);
        assert_eq!(bob_msgs.len(), 1);
        assert_eq!(bob_msgs[0].epoch, Some(1));
        assert_eq!(bob_msgs[0].media_attachments.len(), 1);
        let bob_key =
            PrivateWorkspaceService::media_key_for_envelope(&bob_synced, &bob_msgs[0].envelope_id)
                .expect("epoch 1 media key cached locally");
        let decrypted_em = decrypt_media_attachment(
            &em_blob.ciphertext,
            &bob_msgs[0].media_attachments[0],
            Some(&bob_key),
        )
        .unwrap();
        assert_eq!(decrypted_em, chat_photo_bytes);
    }

    #[tokio::test]
    async fn concurrent_workspace_operations_are_serialized_by_mutex() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice = Arc::new(PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(Keys::generate())),
            Arc::clone(&alice_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        ));
        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Concurrent Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();

        let mut handles = Vec::new();
        for i in 0..5 {
            let svc = Arc::clone(&alice);
            let ws_id = ws.workspace_id.clone();
            handles.push(tokio::spawn(async move {
                svc.send_chat(&ws_id, &format!("msg-{i}")).await
            }));
        }
        for h in handles {
            h.await.unwrap().unwrap();
        }
        let final_ws = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        let msgs = PrivateWorkspaceService::project_messages(&final_ws);
        assert_eq!(msgs.len(), 5);
    }

    #[tokio::test]
    async fn concurrent_removal_recovery_rebuilds_when_epoch_advances_first() {
        let dir = tempfile::tempdir().unwrap();
        let alice_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("alice.sqlite3")).unwrap());
        let bob_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("bob.sqlite3")).unwrap());
        let carol_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("carol.sqlite3")).unwrap());
        let dave_store =
            Arc::new(SqlitePrivateWorkspaceStore::open(dir.path().join("dave.sqlite3")).unwrap());
        let coord_state = Arc::new(Mutex::new(MockCordnState::default()));
        let coord_pk = Keys::generate().public_key().to_hex();

        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let carol_keys = Keys::generate();
        let dave_keys = Keys::generate();
        let alice_pk = alice_keys.public_key().to_hex();
        let bob_pk = bob_keys.public_key().to_hex();
        let carol_pk = carol_keys.public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            Arc::clone(&alice_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(bob_keys)),
            Arc::clone(&bob_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let carol = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(carol_keys)),
            Arc::clone(&carol_store),
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );
        let dave = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(dave_keys)),
            Arc::clone(&dave_store),
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_mock_factory(Arc::clone(&coord_state)),
        );

        let ws = alice
            .create_workspace(WorkspaceMetadata {
                name: "Multi-Admin Circle".to_owned(),
                description: None,
                recommended_basemap: None,
            })
            .unwrap();
        let inv = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        for joiner in [&bob, &carol] {
            joiner.request_to_join(&inv).await.unwrap();
            let reqs = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
            alice
                .approve_join_request(&ws.workspace_id, &reqs[0])
                .await
                .unwrap();
            joiner.accept_pending_welcomes().await.unwrap();
        }
        // Promote Bob to co-administrator and sync Bob.
        alice
            .set_administrator(&ws.workspace_id, &bob_pk, true)
            .await
            .unwrap();
        bob.sync_workspace(&ws.workspace_id).await.unwrap();

        // Alice prepares a pending_membership_commit to remove Carol at the current epoch (before posting).
        let alice_ws_before = alice_store
            .get_workspace(&alice_pk, &ws.workspace_id)
            .unwrap()
            .unwrap();
        let admins = PrivateWorkspaceService::administrators(&alice_ws_before);
        let pending_rm = alice
            .create_pending_removal(&alice_ws_before, &carol_pk, &admins, 1)
            .unwrap();
        let mut alice_journaled = alice_ws_before.clone();
        alice_journaled.pending_membership_commit = Some(pending_rm);
        alice_store.put_workspace(&alice_journaled).unwrap();

        // Before Alice posts her removal, Bob concurrently adds Dave -> advances epoch!
        let inv_bob = bob.create_invitation_url(&ws.workspace_id).await.unwrap();
        dave.request_to_join(&inv_bob).await.unwrap();
        let dave_reqs = bob.fetch_join_requests(&ws.workspace_id).await.unwrap();
        bob.approve_join_request(&ws.workspace_id, &dave_reqs[0])
            .await
            .unwrap();

        // Alice syncs -> detects Bob's Add commit won the epoch, rebuilds Carol's removal in the new epoch, and succeeds!
        let alice_after = alice.sync_workspace(&ws.workspace_id).await.unwrap();
        assert!(alice_after.pending_membership_commit.is_none());
        let final_members = PrivateWorkspaceService::members(&alice_after);
        assert!(!final_members.contains(&carol_pk));
        assert!(final_members.contains(&bob_pk));
        assert!(final_members.contains(&alice_pk));
    }
}
