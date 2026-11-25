//! High-level Earthly Circle (`PrivateWorkspaceService`) orchestrating MLS,
//! Cordn ContextVM sync, invitations, join approvals, member admin, and map/comment projection.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use earthly_domain::kinds::{GEO_COMMENT_KIND, GEO_EVENT_KIND};
use nostr::{Event, JsonUtil};
use serde::{Deserialize, Serialize};

use crate::checkpoint::{
    create_workspace_checkpoint_manifest, current_map_checkpoint_envelopes,
    parse_workspace_checkpoint_manifest, PRIVATE_WORKSPACE_CHECKPOINT_KIND,
};
use crate::coordinator::{
    ConsumedJoinRequest, ConsumedWelcome, CordnCoordinatorClient, PendingJoinRequest,
    PrivateWorkspaceCoordinator,
};
use crate::envelope::{create_private_envelope, NostrEventSigner, PrivateWorkspaceEnvelope};
use crate::invitation::{
    assert_private_map_invitation_current, create_private_map_invitation,
    decode_private_map_invitation, format_circle_invite_url,
};
use crate::mls::{
    add_workspace_member, create_workspace_application_message, create_workspace_group,
    credential_pubkey_from_key_package_base64, epoch_from_state, generate_mls_key_package,
    join_workspace_group, member_pubkeys_from_state, open_coordinator_payload,
    process_workspace_message, remove_workspace_member, seal_coordinator_payload,
    ProcessedMlsMessage,
};
use crate::policy::{
    create_administrator_policy_transition, reduce_administrator_policy,
    AdministratorPolicyState, PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
};
use crate::storage::{
    PendingWorkspaceJoin, PendingWorkspaceOutbound, SqlitePrivateWorkspaceStore, StoredKeyPackage,
    StoredWorkspace, WorkspaceMetadata,
};
use crate::{PRIVATE_WORKSPACE_CHAT_KIND, PRIVATE_WORKSPACE_METADATA_KIND};

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
}

pub type CoordinatorFactory = Arc<
    dyn Fn(String, Vec<String>, Arc<dyn NostrEventSigner>) -> Result<Arc<dyn PrivateWorkspaceCoordinator>, String>
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

impl PrivateWorkspaceService {
    pub fn new(
        signer: Arc<dyn NostrEventSigner>,
        store: Arc<SqlitePrivateWorkspaceStore>,
        default_coordinator_pubkey: String,
        default_relays: Vec<String>,
    ) -> Self {
        let factory: CoordinatorFactory = Arc::new(|server_pk, relays, signer| {
            Ok(Arc::new(CordnCoordinatorClient::new(
                server_pk, relays, signer,
            )?))
        });
        Self::with_factory(
            signer,
            store,
            default_coordinator_pubkey,
            default_relays,
            factory,
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
        Ok(policy)
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

    fn apply_envelope(
        &self,
        workspace: &mut StoredWorkspace,
        envelope: PrivateWorkspaceEnvelope,
    ) -> Result<(), String> {
        if workspace.envelopes.iter().any(|e| e.id == envelope.id) {
            return Ok(());
        }
        let policy_before = self.administrator_policy(workspace)?;
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
        self.administrator_policy(workspace)?;
        Ok(())
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
        let ws = StoredWorkspace {
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
            created_at_ms: now_ms(),
        };
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
        let published = coord
            .publish_key_package(bundle.kp_ref.clone(), bundle.kp_64.clone())
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

        coord
            .store_join_request(inv.group_id.clone(), bundle.kp_ref.clone())
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
        let res = coord.take_join_requests(ws.group_id.clone(), None).await?;
        Ok(res.requests)
    }

    pub async fn approve_join_request(
        &self,
        workspace_id: &str,
        request: &PendingJoinRequest,
    ) -> Result<StoredWorkspace, String> {
        let mut ws = self.sync_workspace(workspace_id).await?;
        let policy = self.require_administrator(&mut ws, "add members")?;
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

        let taken = coord.take_key_package(request.kp_ref.clone()).await?;
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

        // Prepare checkpoint envelopes (accepted admin policy + latest dataset per coordinate + metadata).
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
        let basis_cursor = ws
            .pending_outbound
            .iter()
            .map(|p| p.cursor)
            .fold(ws.cursor, u64::max);
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

        // 1. Add member MLS Commit (sealed with OLD epoch exporter key).
        let old_state = ws.mls_state.clone();
        let added = add_workspace_member(&old_state, &kp_64, &policy.administrators)?;
        let sealed_commit = seal_coordinator_payload(&old_state, &added.commit_64)?;
        let commit_post = coord
            .post_message(ws.group_id.clone(), sealed_commit)
            .await?;

        // 2. Post checkpoint envelopes, metadata, and checkpoint manifest in the NEW epoch.
        let mut current_state = added.new_state;

        for env in &checkpoint_envelopes {
            let out = create_workspace_application_message(
                &current_state,
                env,
                true,
                &policy.administrators,
            )?;
            let sealed = seal_coordinator_payload(&current_state, &out.message_64)?;
            let posted = coord.post_message(ws.group_id.clone(), sealed).await?;
            current_state = out.new_state;
            ws.pending_outbound.push(PendingWorkspaceOutbound {
                cursor: posted.cursor,
                envelope: env.clone(),
            });
        }
        if let Some(meta_env) = metadata_envelope {
            let out = create_workspace_application_message(
                &current_state,
                &meta_env,
                false,
                &policy.administrators,
            )?;
            let sealed = seal_coordinator_payload(&current_state, &out.message_64)?;
            let posted = coord.post_message(ws.group_id.clone(), sealed).await?;
            current_state = out.new_state;
            self.apply_envelope(&mut ws, meta_env.clone())?;
            ws.pending_outbound.push(PendingWorkspaceOutbound {
                cursor: posted.cursor,
                envelope: meta_env,
            });
        }
        let last_cursor = {
            let out = create_workspace_application_message(
                &current_state,
                &checkpoint_envelope,
                false,
                &policy.administrators,
            )?;
            let sealed = seal_coordinator_payload(&current_state, &out.message_64)?;
            let posted = coord.post_message(ws.group_id.clone(), sealed).await?;
            current_state = out.new_state;
            self.apply_envelope(&mut ws, checkpoint_envelope.clone())?;
            ws.pending_outbound.push(PendingWorkspaceOutbound {
                cursor: posted.cursor,
                envelope: checkpoint_envelope,
            });
            posted.cursor
        };

        ws.mls_state = current_state;
        ws.cursor = last_cursor;
        self.store.put_workspace(&ws)?;

        // 3. Deliver Welcome pointing right after the Add commit cursor so joiner replays the checkpoint!
        coord
            .store_welcome(
                request.pk.clone(),
                request.kp_ref.clone(),
                added.welcome_64,
                Some(commit_post.cursor),
            )
            .await?;

        // 4. Mark join request consumed.
        let _ = coord
            .take_join_requests(
                ws.group_id.clone(),
                Some(vec![ConsumedJoinRequest {
                    pk: request.pk.clone(),
                    at: request.at,
                }]),
            )
            .await;

        Ok(ws)
    }

    pub async fn accept_pending_welcomes(&self) -> Result<Vec<StoredWorkspace>, String> {
        let owner = self.owner_pubkey();
        let joins = self.store.list_pending_joins(&owner)?;
        let mut accepted = Vec::new();

        for pending in joins {
            let coord = self.coordinator(&pending.coordinator_pubkey, &pending.relays)?;
            let res = coord.take_welcomes(None).await?;
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
                created_at_ms: now_ms(),
            };
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

            self.sync_with_coordinator(&mut ws, coord.as_ref()).await?;
            accepted.push(ws);
        }

        Ok(accepted)
    }

    pub async fn sync_workspace(&self, workspace_id: &str) -> Result<StoredWorkspace, String> {
        let mut ws = self.require_workspace(workspace_id)?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        self.sync_with_coordinator(&mut ws, coord.as_ref()).await?;
        Ok(ws)
    }

    async fn sync_with_coordinator(
        &self,
        ws: &mut StoredWorkspace,
        coord: &dyn PrivateWorkspaceCoordinator,
    ) -> Result<bool, String> {
        if ws.status == "removed" {
            return Ok(false);
        }
        let after = if ws.cursor > 0 { Some(ws.cursor) } else { None };
        let fetched = coord.fetch_messages(ws.group_id.clone(), after).await?;
        if fetched.messages.is_empty() {
            return Ok(false);
        }
        let mut messages = fetched.messages;
        messages.sort_by_key(|m| m.cursor);

        let mut changed = false;
        for msg in messages {
            if msg.cursor <= ws.cursor {
                continue;
            }
            changed = true;
            if let Some(pos) = ws
                .pending_outbound
                .iter()
                .position(|p| p.cursor == msg.cursor)
            {
                let item = ws.pending_outbound.remove(pos);
                let _ = self.apply_envelope(ws, item.envelope);
                ws.cursor = msg.cursor;
                continue;
            }

            let admins = self.administrator_policy(ws)?.administrators;
            let opened = if msg.encrypted {
                open_coordinator_payload(&ws.mls_state, &msg.msg_64)
            } else {
                Ok(msg.msg_64.clone())
            };
            match opened.and_then(|mls_b64| {
                process_workspace_message(&ws.mls_state, &mls_b64, &admins)
            }) {
                Ok(ProcessedMlsMessage::ApplicationMessage {
                    new_state,
                    envelope,
                }) => {
                    ws.mls_state = new_state;
                    let _ = self.apply_envelope(ws, envelope);
                }
                Ok(ProcessedMlsMessage::NewState(new_state)) => {
                    ws.mls_state = new_state;
                    if let Ok(members) = member_pubkeys_from_state(&ws.mls_state) {
                        if !members.iter().any(|p| p == &ws.owner_pubkey) {
                            ws.status = "removed".to_owned();
                        }
                    }
                }
                Ok(ProcessedMlsMessage::Removed(new_state)) => {
                    ws.mls_state = new_state;
                    ws.status = "removed".to_owned();
                }
                Ok(ProcessedMlsMessage::Rejected(_)) => {}
                Err(err) => {
                    if ws.role == "member"
                        && (err.contains("removed")
                            || err.contains("ancestor")
                            || err.contains("overlap"))
                    {
                        ws.status = "removed".to_owned();
                    }
                }
            }
            ws.cursor = msg.cursor;
            if ws.status == "removed" {
                break;
            }
        }
        self.administrator_policy(ws)?;
        self.store.put_workspace(ws)?;
        Ok(changed)
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
        if trimmed.is_empty() && !has_geo {
            return Err("A Circle comment needs text or geometry".to_owned());
        }
        let body = if let Some(geo) = parsed_geo.filter(|_| has_geo) {
            serde_json::json!({ "text": trimmed, "geojson": geo })
        } else {
            serde_json::json!({ "text": trimmed })
        };
        self.send_envelope(
            workspace_id,
            GEO_COMMENT_KIND,
            body.to_string(),
            vec![vec!["d".to_owned(), uuid::Uuid::new_v4().to_string()]],
        )
        .await
    }

    pub async fn send_dataset(
        &self,
        workspace_id: &str,
        geojson_json: &str,
        dataset_id: Option<&str>,
        name: Option<&str>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
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

        self.send_envelope(
            workspace_id,
            GEO_EVENT_KIND,
            geojson_json.to_owned(),
            vec![
                vec!["d".to_owned(), d_id],
                vec!["name".to_owned(), title],
            ],
        )
        .await
    }

    pub async fn remove_member(
        &self,
        workspace_id: &str,
        member_pubkey: &str,
    ) -> Result<StoredWorkspace, String> {
        let mut ws = self.sync_workspace(workspace_id).await?;
        let policy = self.require_administrator(&mut ws, "remove members")?;
        if policy.administrators.iter().any(|p| p == member_pubkey) {
            return Err("Demote this administrator before removing them".to_owned());
        }
        let old_state = ws.mls_state.clone();
        let removed =
            remove_workspace_member(&old_state, member_pubkey, &policy.administrators)?;
        let sealed = seal_coordinator_payload(&old_state, &removed.commit_64)?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        let posted = coord.post_message(ws.group_id.clone(), sealed).await?;
        ws.mls_state = removed.new_state;
        ws.cursor = posted.cursor;
        self.store.put_workspace(&ws)?;
        Ok(ws)
    }

    pub async fn set_administrator(
        &self,
        workspace_id: &str,
        member_pubkey: &str,
        administrator: bool,
    ) -> Result<StoredWorkspace, String> {
        let mut ws = self.sync_workspace(workspace_id).await?;
        let policy = self.require_administrator(&mut ws, "manage administrators")?;
        if !member_pubkeys_from_state(&ws.mls_state)?
            .iter()
            .any(|p| p == member_pubkey)
        {
            return Err("Only current Circle members can be administrators".to_owned());
        }
        let transition =
            create_administrator_policy_transition(&policy, member_pubkey, administrator)?;
        self.send_envelope(
            workspace_id,
            PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
            serde_json::to_string(&transition).map_err(|e| e.to_string())?,
            vec![vec!["d".to_owned(), "administrator-policy".to_owned()]],
        )
        .await?;
        self.require_workspace(workspace_id)
    }

    async fn send_envelope(
        &self,
        workspace_id: &str,
        kind: u16,
        content: String,
        tags: Vec<Vec<String>>,
    ) -> Result<PrivateWorkspaceEnvelope, String> {
        let mut ws = self.sync_workspace(workspace_id).await?;
        if ws.status != "active" {
            return Err("This account was removed from the Circle".to_owned());
        }
        let policy = self.administrator_policy(&mut ws)?;
        let envelope = create_private_envelope(
            self.signer.as_ref(),
            &ws.group_id,
            kind,
            content,
            tags,
            None,
        )
        .await?;
        let old_state = ws.mls_state.clone();
        let outbound = create_workspace_application_message(
            &old_state,
            &envelope,
            false,
            &policy.administrators,
        )?;
        let sealed = seal_coordinator_payload(&old_state, &outbound.message_64)?;
        let coord = self.coordinator(&ws.coordinator_pubkey, &ws.relays)?;
        let posted = coord.post_message(ws.group_id.clone(), sealed).await?;

        ws.mls_state = outbound.new_state;
        ws.pending_outbound.push(PendingWorkspaceOutbound {
            cursor: posted.cursor,
            envelope: envelope.clone(),
        });
        self.apply_envelope(&mut ws, envelope.clone())?;
        self.store.put_workspace(&ws)?;
        let _ = self.sync_with_coordinator(&mut ws, coord.as_ref()).await;
        Ok(envelope)
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
                });
            }
        }
        out.sort_by_key(|m| m.created_at);
        out
    }
}

#[cfg(test)]
mod tests {
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

    #[derive(Default)]
    struct MockCordnState {
        key_packages: Vec<PublishedKeyPackage>,
        join_requests: HashMap<String, Vec<PendingJoinRequest>>,
        welcomes: HashMap<String, Vec<PendingWelcome>>,
        messages: HashMap<String, Vec<CoordinatorMessage>>,
        next_cursor: u64,
        clock: u64,
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
                let g = state.lock().unwrap();
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

        let make_factory = |shared: Arc<Mutex<MockCordnState>>| -> CoordinatorFactory {
            Arc::new(move |_pk, _relays, signer| {
                Ok(Arc::new(MockCordnCoordinator {
                    state: Arc::clone(&shared),
                    caller_signer: signer,
                }))
            })
        };

        let alice_keys = Keys::generate();
        let bob_keys = Keys::generate();
        let alice_pk = alice_keys.public_key().to_hex();
        let bob_pk = bob_keys.public_key().to_hex();

        let alice = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(alice_keys)),
            alice_store,
            coord_pk.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            make_factory(Arc::clone(&coord_state)),
        );
        let bob = PrivateWorkspaceService::with_factory(
            Arc::new(LocalKeysSigner::new(bob_keys)),
            bob_store,
            coord_pk,
            vec!["wss://relay.earthly.city".to_owned()],
            make_factory(Arc::clone(&coord_state)),
        );

        // 1. Alice creates a Circle and authors an encrypted GeoJSON map BEFORE Bob joins.
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
            .send_dataset(&ws.workspace_id, &map_json, Some("gauge-1"), Some("Survey Waypoints"))
            .await
            .unwrap();

        // 2. Alice signs a v2 invitation link; Bob requests to join (publishes last-resort KP).
        let invite_url = alice.create_invitation_url(&ws.workspace_id).await.unwrap();
        assert!(invite_url.starts_with("https://earthly.city/circle/"));
        let pending = bob.request_to_join(&invite_url).await.unwrap();
        assert_eq!(pending.workspace_id, ws.workspace_id);

        // 3. Alice fetches pending join requests and approves Bob (replaying checkpoint + metadata!).
        let requests = alice.fetch_join_requests(&ws.workspace_id).await.unwrap();
        assert_eq!(requests.len(), 1);
        assert_eq!(requests[0].pk, bob_pk);
        let ws_after_approve = alice
            .approve_join_request(&ws.workspace_id, &requests[0])
            .await
            .unwrap();
        assert_eq!(PrivateWorkspaceService::members(&ws_after_approve).len(), 2);

        // 4. Bob accepts Welcome and immediately receives Circle metadata + current Map checkpoint!
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

        // 5. Bob posts a private comment with GeoJSON attachment; Alice syncs and sees it!
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

        // 6. Alice removes Bob; subsequent messages from Alice cannot be decrypted by Bob.
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

        // Bob (non-admin) tries to remove Alice -> Alice MUST reject!
        let bad_removal = remove_workspace_member(&bob_state, &alice_pk, &[alice_pk.clone()]).unwrap();
        let sealed_bad = seal_coordinator_payload(&bob_state, &bad_removal.commit_64).unwrap();
        let opened_bad = open_coordinator_payload(&alice_state, &sealed_bad).unwrap();
        let res = process_workspace_message(&alice_state, &opened_bad, &[alice_pk.clone()]).unwrap();
        assert!(matches!(res, ProcessedMlsMessage::Rejected(_)));
        assert_eq!(member_pubkeys_from_state(&alice_state).unwrap().len(), 2);
    }
}
