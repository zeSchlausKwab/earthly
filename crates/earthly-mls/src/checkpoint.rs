//! Current-map join checkpoint manifests (`src/lib/private-workspace/checkpoint.ts`).

use std::collections::{HashMap, HashSet};

use earthly_domain::kinds::GEO_EVENT_KIND;
use serde::{Deserialize, Serialize};

use crate::envelope::PrivateWorkspaceEnvelope;
use crate::policy::{accepted_administrator_policy_envelopes, reduce_administrator_policy};
use crate::is_valid_hex_pubkey;

pub const PRIVATE_WORKSPACE_CHECKPOINT_KIND: u16 = 37_525;
pub const PRIVATE_WORKSPACE_CHECKPOINT_VERSION: u8 = 1;
pub const PRIVATE_WORKSPACE_CHECKPOINT_HISTORY: &str = "none";
const MAX_CHECKPOINT_ENVELOPES: usize = 4_096;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCheckpointManifest {
    pub version: u8,
    pub basis_cursor: u64,
    pub history: String,
    pub envelope_ids: Vec<String>,
}

fn d_tag(envelope: &PrivateWorkspaceEnvelope) -> Option<&str> {
    envelope
        .tags
        .iter()
        .find(|t| t.first().map(String::as_str) == Some("d"))
        .and_then(|t| t.get(1))
        .map(String::as_str)
}

/// Select the authenticated records defining the current private map for a newly added member.
pub fn current_map_checkpoint_envelopes(
    admin_pubkey: &str,
    envelopes: &[PrivateWorkspaceEnvelope],
) -> Result<Vec<PrivateWorkspaceEnvelope>, String> {
    let policy = reduce_administrator_policy(admin_pubkey, envelopes)?;
    let accepted_policy_ids: HashSet<String> =
        accepted_administrator_policy_envelopes(&policy, envelopes)
            .into_iter()
            .map(|e| e.id)
            .collect();

    let mut latest_by_coord: HashMap<String, String> = HashMap::new();
    for envelope in envelopes {
        if envelope.kind != GEO_EVENT_KIND {
            continue;
        }
        if let Some(d) = d_tag(envelope) {
            latest_by_coord.insert(format!("{}:{d}", envelope.pubkey), envelope.id.clone());
        }
    }
    let latest_dataset_ids: HashSet<String> = latest_by_coord.into_values().collect();

    Ok(envelopes
        .iter()
        .filter(|e| accepted_policy_ids.contains(&e.id) || latest_dataset_ids.contains(&e.id))
        .cloned()
        .collect())
}

pub fn create_workspace_checkpoint_manifest(
    basis_cursor: u64,
    envelope_ids: Vec<String>,
) -> Result<WorkspaceCheckpointManifest, String> {
    let manifest = WorkspaceCheckpointManifest {
        version: PRIVATE_WORKSPACE_CHECKPOINT_VERSION,
        basis_cursor,
        history: PRIVATE_WORKSPACE_CHECKPOINT_HISTORY.to_owned(),
        envelope_ids,
    };
    validate_manifest(&manifest)?;
    Ok(manifest)
}

pub fn parse_workspace_checkpoint_manifest(
    content: &str,
) -> Result<WorkspaceCheckpointManifest, String> {
    let manifest: WorkspaceCheckpointManifest = serde_json::from_str(content)
        .map_err(|_| "Invalid private workspace checkpoint manifest".to_owned())?;
    validate_manifest(&manifest)?;
    Ok(manifest)
}

fn validate_manifest(manifest: &WorkspaceCheckpointManifest) -> Result<(), String> {
    if manifest.version != PRIVATE_WORKSPACE_CHECKPOINT_VERSION
        || manifest.history != PRIVATE_WORKSPACE_CHECKPOINT_HISTORY
        || manifest.envelope_ids.len() > MAX_CHECKPOINT_ENVELOPES
        || !manifest.envelope_ids.iter().all(|id| is_valid_hex_pubkey(id))
    {
        return Err("Invalid private workspace checkpoint manifest".to_owned());
    }
    let unique: HashSet<&str> = manifest.envelope_ids.iter().map(String::as_str).collect();
    if unique.len() != manifest.envelope_ids.len() {
        return Err("Private workspace checkpoint envelope ids must be unique".to_owned());
    }
    Ok(())
}
