//! Signed v2 (and legacy v1) Earthly Circle invitations (`src/lib/private-workspace/invitation.ts`).

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use nostr::{Event, JsonUtil, Kind};
use serde::{Deserialize, Serialize};

use crate::envelope::NostrEventSigner;
use crate::is_valid_hex_pubkey;

pub const PRIVATE_MAP_INVITATION_KIND: u16 = 27_524;
pub const PRIVATE_MAP_INVITATION_TTL_SECONDS: u64 = 24 * 60 * 60;
pub const PRIVATE_MAP_INVITATION_DOMAIN: &str = "earthly-private-map-invitation-v2";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateMapInvitation {
    pub version: u8,
    pub workspace_id: String,
    pub group_id: String,
    pub admin_pubkey: String,
    pub coordinator_pubkey: String,
    pub relays: Vec<String>,
    pub nonce: String,
    pub expires_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct SignedPrivateMapInvitation {
    version: u8,
    event: serde_json::Value,
}

fn invitation_tags(
    workspace_id: &str,
    group_id: &str,
    admin_pubkey: &str,
    coordinator_pubkey: &str,
    relays: &[String],
    nonce: &str,
    expires_at: u64,
) -> Vec<Vec<String>> {
    let mut tags = vec![
        vec!["t".to_owned(), PRIVATE_MAP_INVITATION_DOMAIN.to_owned()],
        vec!["workspace".to_owned(), workspace_id.to_owned()],
        vec!["group".to_owned(), group_id.to_owned()],
        vec!["admin".to_owned(), admin_pubkey.to_owned()],
        vec!["coordinator".to_owned(), coordinator_pubkey.to_owned()],
    ];
    for relay in relays {
        tags.push(vec!["relay".to_owned(), relay.clone()]);
    }
    tags.push(vec!["nonce".to_owned(), nonce.to_owned()]);
    tags.push(vec!["expiration".to_owned(), expires_at.to_string()]);
    tags
}

fn single_tag(tags: &[Vec<String>], name: &str) -> Result<String, String> {
    let matches: Vec<&Vec<String>> = tags.iter().filter(|t| t.first().map(String::as_str) == Some(name)).collect();
    if matches.len() != 1 || matches[0].len() != 2 || matches[0][1].is_empty() {
        return Err(format!("Invalid {name} in private map invitation"));
    }
    Ok(matches[0][1].clone())
}

fn validate_relays(relays: &[String]) -> Result<Vec<String>, String> {
    if relays.is_empty()
        || !relays
            .iter()
            .all(|r| r.starts_with("wss://") || r.starts_with("ws://"))
    {
        return Err("Invalid relays in private map invitation".to_owned());
    }
    Ok(relays.to_vec())
}

pub async fn create_private_map_invitation(
    signer: &dyn NostrEventSigner,
    workspace_id: &str,
    group_id: &str,
    admin_pubkey: &str,
    coordinator_pubkey: &str,
    relays: &[String],
    nonce: &str,
    issued_at_secs: u64,
    ttl_seconds: Option<u64>,
) -> Result<String, String> {
    if workspace_id.is_empty() || group_id.is_empty() || nonce.is_empty() {
        return Err("Invalid workspace, group, or nonce in private map invitation".to_owned());
    }
    if !is_valid_hex_pubkey(admin_pubkey) {
        return Err("Invalid administrator pubkey in private map invitation".to_owned());
    }
    if !is_valid_hex_pubkey(coordinator_pubkey) {
        return Err("Invalid coordinator pubkey in private map invitation".to_owned());
    }
    let relays = validate_relays(relays)?;
    let ttl = ttl_seconds.unwrap_or(PRIVATE_MAP_INVITATION_TTL_SECONDS);
    if ttl == 0 {
        return Err("Invalid lifetime in private map invitation".to_owned());
    }
    let expires_at = issued_at_secs
        .checked_add(ttl)
        .ok_or_else(|| "Invitation expiration overflow".to_owned())?;
    let tags = invitation_tags(
        workspace_id,
        group_id,
        admin_pubkey,
        coordinator_pubkey,
        &relays,
        nonce,
        expires_at,
    );
    let event = signer
        .sign_event_template(
            PRIVATE_MAP_INVITATION_KIND,
            issued_at_secs,
            tags,
            PRIVATE_MAP_INVITATION_DOMAIN.to_owned(),
        )
        .await?;
    let event_value: serde_json::Value = serde_json::from_str(&event.as_json())
        .map_err(|e| format!("Failed to encode invitation event: {e}"))?;
    let token = SignedPrivateMapInvitation {
        version: 2,
        event: event_value,
    };
    let json = serde_json::to_vec(&token)
        .map_err(|e| format!("Failed to serialize invitation: {e}"))?;
    let encoded = URL_SAFE_NO_PAD.encode(json);
    // Round-trip validate before returning.
    decode_private_map_invitation(&encoded)?;
    Ok(encoded)
}

pub fn format_circle_invite_url(workspace_id: &str, token: &str) -> String {
    format!("https://earthly.city/circle/{workspace_id}?private-invite={token}")
}

/// Accepts a full Earthly invitation URL (`https://earthly.city/circle/<id>?private-invite=<tok>`,
/// `/privategroup/`, `/private-group/`, `earthly://circle/...`) OR a raw base64url token.
pub fn extract_invitation_token(raw: &str) -> Result<(Option<String>, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Enter or scan an Earthly Circle invitation link".to_owned());
    }
    if trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("earthly://")
    {
        let (path_part, query_part) = trimmed
            .split_once('?')
            .ok_or_else(|| "The Circle invitation token is missing from the link".to_owned())?;
        let mut token: Option<String> = None;
        for pair in query_part.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                if k == "private-invite" && !v.is_empty() {
                    if token.is_some() {
                        return Err("Multiple private-invite tokens found in link".to_owned());
                    }
                    token = Some(percent_decode(v));
                }
            }
        }
        let token = token
            .ok_or_else(|| "The private-group invitation token is missing".to_owned())?;

        // Extract optional workspace id from `/circle/<id>`, `/privategroup/<id>`, `/private-group/<id>`.
        let after_scheme = path_part
            .split_once("://")
            .map(|(_, rest)| rest)
            .unwrap_or(path_part);
        let segments: Vec<&str> = after_scheme
            .split('/')
            .filter(|s| !s.is_empty())
            .collect();
        let workspace_id = segments
            .windows(2)
            .find(|w| matches!(w[0], "circle" | "privategroup" | "private-group"))
            .map(|w| percent_decode(w[1]));

        return Ok((workspace_id, token));
    }

    Ok((None, trimmed.to_owned()))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or_else(|_| input.to_owned())
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn decode_private_map_invitation(raw: &str) -> Result<PrivateMapInvitation, String> {
    let (route_workspace_id, token) = extract_invitation_token(raw)?;
    let decoded_bytes = URL_SAFE_NO_PAD
        .decode(token.as_bytes())
        .or_else(|_| URL_SAFE.decode(token.as_bytes()))
        .map_err(|_| "Invalid private map invitation encoding".to_owned())?;
    let parsed: serde_json::Value = serde_json::from_slice(&decoded_bytes)
        .map_err(|_| "Invalid private map invitation JSON".to_owned())?;
    let obj = parsed
        .as_object()
        .ok_or_else(|| "Invalid private map invitation".to_owned())?;
    let version = obj
        .get("version")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| "Invalid private map invitation version".to_owned())?;

    let invitation = if version == 2 {
        decode_signed_v2(obj)?
    } else if version == 1 {
        decode_legacy_v1(obj)?
    } else {
        return Err("Unsupported private map invitation version".to_owned());
    };

    if let Some(ws) = route_workspace_id {
        if ws != invitation.workspace_id {
            return Err("The invitation does not match this Circle".to_owned());
        }
    }
    Ok(invitation)
}

fn decode_signed_v2(
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Result<PrivateMapInvitation, String> {
    let event_val = obj
        .get("event")
        .ok_or_else(|| "Invalid private map invitation signature".to_owned())?;
    let event_json = serde_json::to_string(event_val)
        .map_err(|_| "Invalid private map invitation signature".to_owned())?;
    let event = Event::from_json(&event_json)
        .map_err(|_| "Invalid private map invitation signature".to_owned())?;
    event
        .verify()
        .map_err(|_| "Invalid private map invitation signature".to_owned())?;

    if event.kind != Kind::Custom(PRIVATE_MAP_INVITATION_KIND)
        || event.content != PRIVATE_MAP_INVITATION_DOMAIN
    {
        return Err("Invalid private map invitation authorization".to_owned());
    }
    let tags: Vec<Vec<String>> = event.tags.iter().map(|t| t.as_slice().to_vec()).collect();
    let workspace_id = single_tag(&tags, "workspace")?;
    let group_id = single_tag(&tags, "group")?;
    let admin_pubkey = single_tag(&tags, "admin")?;
    let coordinator_pubkey = single_tag(&tags, "coordinator")?;
    let nonce = single_tag(&tags, "nonce")?;
    let expires_at: u64 = single_tag(&tags, "expiration")?
        .parse()
        .map_err(|_| "Invalid expiration in private map invitation".to_owned())?;
    if !is_valid_hex_pubkey(&admin_pubkey) || !is_valid_hex_pubkey(&coordinator_pubkey) {
        return Err("Invalid pubkey in private map invitation".to_owned());
    }
    if expires_at <= event.created_at.as_secs() {
        return Err("Invalid expiration in private map invitation".to_owned());
    }
    let relays: Vec<String> = tags
        .iter()
        .filter(|t| t.len() == 2 && t[0] == "relay")
        .map(|t| t[1].clone())
        .collect();
    let relays = validate_relays(&relays)?;
    let expected = invitation_tags(
        &workspace_id,
        &group_id,
        &admin_pubkey,
        &coordinator_pubkey,
        &relays,
        &nonce,
        expires_at,
    );
    if tags != expected {
        return Err("Invalid private map invitation authorization".to_owned());
    }

    Ok(PrivateMapInvitation {
        version: 2,
        workspace_id,
        group_id,
        admin_pubkey,
        coordinator_pubkey,
        relays,
        nonce,
        expires_at: Some(expires_at),
    })
}

fn decode_legacy_v1(
    obj: &serde_json::Map<String, serde_json::Value>,
) -> Result<PrivateMapInvitation, String> {
    let inv: PrivateMapInvitation = serde_json::from_value(serde_json::Value::Object(obj.clone()))
        .map_err(|_| "Invalid private map invitation".to_owned())?;
    if inv.workspace_id.is_empty()
        || inv.group_id.is_empty()
        || inv.nonce.is_empty()
        || !is_valid_hex_pubkey(&inv.admin_pubkey)
        || !is_valid_hex_pubkey(&inv.coordinator_pubkey)
    {
        return Err("Invalid private map invitation".to_owned());
    }
    let relays = validate_relays(&inv.relays)?;
    Ok(PrivateMapInvitation { relays, ..inv })
}

pub fn assert_private_map_invitation_current(
    invitation: &PrivateMapInvitation,
    now_secs: u64,
) -> Result<(), String> {
    if invitation.version == 2 {
        if let Some(expires_at) = invitation.expires_at {
            if now_secs >= expires_at {
                return Err("This private-group invitation has expired".to_owned());
            }
        }
    }
    Ok(())
}
