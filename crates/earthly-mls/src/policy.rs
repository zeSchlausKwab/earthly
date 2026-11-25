//! Monotonic administrator policy reducer (`src/lib/private-workspace/policy.ts`).

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

use crate::envelope::PrivateWorkspaceEnvelope;
use crate::is_valid_hex_pubkey;

pub const PRIVATE_WORKSPACE_ADMIN_POLICY_KIND: u16 = 37_524;
pub const PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdministratorPolicyTransition {
    pub version: u8,
    pub revision: u64,
    pub previous: Option<String>,
    pub administrators: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdministratorPolicyState {
    pub version: u8,
    pub root_admin_pubkey: String,
    pub revision: u64,
    pub head: Option<String>,
    pub administrators: Vec<String>,
    pub accepted_envelope_ids: Vec<String>,
}

fn canonical_administrators(values: Vec<String>) -> Vec<String> {
    let mut set: Vec<String> = values
        .into_iter()
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    set.sort();
    set
}

fn changed_administrators(before: &[String], after: &[String]) -> usize {
    let before_set: HashSet<&str> = before.iter().map(String::as_str).collect();
    let after_set: HashSet<&str> = after.iter().map(String::as_str).collect();
    let removed = before.iter().filter(|p| !after_set.contains(p.as_str())).count();
    let added = after.iter().filter(|p| !before_set.contains(p.as_str())).count();
    removed + added
}

pub fn initial_administrator_policy(
    root_admin_pubkey: &str,
) -> Result<AdministratorPolicyState, String> {
    if !is_valid_hex_pubkey(root_admin_pubkey) {
        return Err("Administrator policy root must be a lowercase Nostr pubkey".to_owned());
    }
    Ok(AdministratorPolicyState {
        version: PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION,
        root_admin_pubkey: root_admin_pubkey.to_owned(),
        revision: 0,
        head: None,
        administrators: vec![root_admin_pubkey.to_owned()],
        accepted_envelope_ids: Vec::new(),
    })
}

pub fn parse_administrator_policy_transition(
    envelope: &PrivateWorkspaceEnvelope,
) -> Result<AdministratorPolicyTransition, String> {
    if envelope.kind != PRIVATE_WORKSPACE_ADMIN_POLICY_KIND {
        return Err("Envelope is not an administrator-policy transition".to_owned());
    }
    let transition: AdministratorPolicyTransition = serde_json::from_str(&envelope.content)
        .map_err(|_| "Invalid administrator-policy transition".to_owned())?;
    if transition.version != PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION
        || transition.revision < 1
        || transition.administrators.is_empty()
        || !transition
            .administrators
            .iter()
            .all(|pk| is_valid_hex_pubkey(pk))
    {
        return Err("Invalid administrator-policy transition".to_owned());
    }
    if transition.administrators != canonical_administrators(transition.administrators.clone()) {
        return Err(
            "Administrator-policy pubkeys must be unique and canonically sorted".to_owned(),
        );
    }
    Ok(transition)
}

pub fn reduce_administrator_policy(
    root_admin_pubkey: &str,
    envelopes: &[PrivateWorkspaceEnvelope],
) -> Result<AdministratorPolicyState, String> {
    let mut state = initial_administrator_policy(root_admin_pubkey)?;
    let mut seen = HashSet::new();

    for envelope in envelopes {
        if envelope.kind != PRIVATE_WORKSPACE_ADMIN_POLICY_KIND
            || !seen.insert(envelope.id.as_str())
        {
            continue;
        }
        let Ok(transition) = parse_administrator_policy_transition(envelope) else {
            continue;
        };
        if !state.administrators.iter().any(|p| p == &envelope.pubkey) {
            continue;
        }
        if transition.revision != state.revision + 1 {
            continue;
        }
        if transition.previous != state.head {
            continue;
        }
        if changed_administrators(&state.administrators, &transition.administrators) != 1 {
            continue;
        }

        state.revision = transition.revision;
        state.head = Some(envelope.id.clone());
        state.administrators = transition.administrators;
        state.accepted_envelope_ids.push(envelope.id.clone());
    }

    Ok(state)
}

pub fn create_administrator_policy_transition(
    state: &AdministratorPolicyState,
    pubkey: &str,
    administrator: bool,
) -> Result<AdministratorPolicyTransition, String> {
    if !is_valid_hex_pubkey(pubkey) {
        return Err("Invalid administrator pubkey".to_owned());
    }
    let currently_admin = state.administrators.iter().any(|p| p == pubkey);
    if currently_admin == administrator {
        return Err(if administrator {
            "This member is already an administrator".to_owned()
        } else {
            "This member is not an administrator".to_owned()
        });
    }
    if !administrator && state.administrators.len() == 1 {
        return Err("A private group must retain at least one administrator".to_owned());
    }
    let mut next = state.administrators.clone();
    if administrator {
        next.push(pubkey.to_owned());
    } else {
        next.retain(|p| p != pubkey);
    }
    Ok(AdministratorPolicyTransition {
        version: PRIVATE_WORKSPACE_ADMIN_POLICY_VERSION,
        revision: state.revision + 1,
        previous: state.head.clone(),
        administrators: canonical_administrators(next),
    })
}

pub fn accepted_administrator_policy_envelopes(
    state: &AdministratorPolicyState,
    envelopes: &[PrivateWorkspaceEnvelope],
) -> Vec<PrivateWorkspaceEnvelope> {
    let accepted: HashSet<&str> = state
        .accepted_envelope_ids
        .iter()
        .map(String::as_str)
        .collect();
    envelopes
        .iter()
        .filter(|e| accepted.contains(e.id.as_str()))
        .cloned()
        .collect()
}
