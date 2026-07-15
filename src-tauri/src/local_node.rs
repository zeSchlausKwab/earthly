use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use earthly_local_node::{
    LocalNode, NodeAvailability, NodeConfig, NodeDescriptor, PairingCapability, PairingError,
    PeerGrant, PendingPairingClaim,
};
use nostr::{EventId, PublicKey};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug)]
pub struct LocalNodeState {
    runtime: RwLock<Runtime>,
}

impl LocalNodeState {
    pub fn starting() -> Self {
        Self {
            runtime: RwLock::new(Runtime::Starting),
        }
    }

    pub fn shutdown(&self) {
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

    fn status(&self) -> LocalNodeStatus {
        let runtime = match self.runtime.read() {
            Ok(runtime) => runtime,
            Err(poisoned) => poisoned.into_inner(),
        };
        match &*runtime {
            Runtime::Starting => LocalNodeStatus::Starting,
            Runtime::Running(node) => LocalNodeStatus::Running {
                descriptor: node.descriptor().clone(),
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
    Running { descriptor: NodeDescriptor },
    Failed { message: String },
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

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInvitationView {
    version: u8,
    encoded: String,
    expires_at: u64,
    capabilities: Vec<PairingCapability>,
    descriptor: NodeDescriptor,
}

pub fn start(app: AppHandle, data_dir: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let config = NodeConfig::loopback(data_dir, NodeAvailability::Process);
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
