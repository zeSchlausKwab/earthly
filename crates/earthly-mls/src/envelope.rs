//! Detached-authorization private workspace envelopes (`src/lib/private-workspace/envelope.ts`).
//!
//! Private records inside MLS are unsigned Nostr-shaped envelopes paired with a
//! detached kind-27523 signature over `(envelope.id, groupId)` so decrypted map
//! payloads are never directly publishable as signed public Nostr events.

use nostr::{Event, EventBuilder, EventId, JsonUtil, Keys, Kind, PublicKey, Tag, Tags, Timestamp};
use serde::{Deserialize, Serialize};

use crate::is_valid_hex_pubkey;

/// Experimental NIP-01 ephemeral-range kind; never intentionally relayed.
pub const PRIVATE_WORKSPACE_AUTHORIZATION_KIND: u16 = 27_523;
pub const PRIVATE_WORKSPACE_AUTHORIZATION_VERSION: u8 = 1;
pub const PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN: &str =
    "earthly-private-workspace-authorization-v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivateWorkspaceAuthorization {
    pub version: u8,
    pub event: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrivateWorkspaceEnvelope {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub authorization: PrivateWorkspaceAuthorization,
}

/// Async Nostr event signer abstraction (implemented for local `Keys`, NIP-46 Bunker, etc.).
pub trait NostrEventSigner: Send + Sync {
    fn pubkey_hex(&self) -> String;
    fn sign_event_template(
        &self,
        kind: u16,
        created_at: u64,
        tags: Vec<Vec<String>>,
        content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>;
}

/// Local secp256k1 `nostr::Keys` signer.
#[derive(Clone)]
pub struct LocalKeysSigner {
    keys: Keys,
}

impl LocalKeysSigner {
    pub fn new(keys: Keys) -> Self {
        Self { keys }
    }

    pub fn from_nsec_or_hex(secret: &str) -> Result<Self, String> {
        let sk = nostr::SecretKey::parse(secret.trim())
            .map_err(|e| format!("Invalid Nostr secret key: {e}"))?;
        Ok(Self {
            keys: Keys::new(sk),
        })
    }

    pub fn keys(&self) -> &Keys {
        &self.keys
    }
}

impl NostrEventSigner for LocalKeysSigner {
    fn pubkey_hex(&self) -> String {
        self.keys.public_key().to_hex()
    }

    fn sign_event_template(
        &self,
        kind: u16,
        created_at: u64,
        tags: Vec<Vec<String>>,
        content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>
    {
        let keys = self.keys.clone();
        Box::pin(async move {
            let parsed_tags = parse_nostr_tags(&tags)?;
            EventBuilder::new(Kind::Custom(kind), content)
                .tags(parsed_tags)
                .custom_created_at(Timestamp::from(created_at))
                .sign_with_keys(&keys)
                .map_err(|e| format!("Failed to sign Nostr event: {e}"))
        })
    }
}

/// Read-only pubkey identity for delivery-only coordinator sync (ZERO user signing prompts).
#[derive(Clone, Debug)]
pub struct ReadOnlyNostrSigner {
    pubkey_hex: String,
}

impl ReadOnlyNostrSigner {
    pub fn new(pubkey_hex: String) -> Result<Self, String> {
        if !is_valid_hex_pubkey(&pubkey_hex) {
            return Err("Invalid read-only Nostr pubkey".to_owned());
        }
        Ok(Self { pubkey_hex })
    }
}

impl NostrEventSigner for ReadOnlyNostrSigner {
    fn pubkey_hex(&self) -> String {
        self.pubkey_hex.clone()
    }

    fn sign_event_template(
        &self,
        _kind: u16,
        _created_at: u64,
        _tags: Vec<Vec<String>>,
        _content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>
    {
        Box::pin(async {
            Err("Read-only workspace identity cannot sign Nostr events".to_owned())
        })
    }
}

pub fn parse_nostr_tags(raw: &[Vec<String>]) -> Result<Vec<Tag>, String> {
    raw.iter()
        .map(|items| {
            Tag::parse(items.iter().map(|s| s.as_str()).collect::<Vec<_>>())
                .map_err(|e| format!("Invalid Nostr tag {items:?}: {e}"))
        })
        .collect()
}

pub fn compute_nostr_event_id(
    pubkey_hex: &str,
    created_at: u64,
    kind: u16,
    tags: &[Vec<String>],
    content: &str,
) -> Result<String, String> {
    let pubkey = PublicKey::from_hex(pubkey_hex)
        .map_err(|e| format!("Invalid pubkey hex for event id: {e}"))?;
    let parsed_tags = Tags::from_list(parse_nostr_tags(tags)?);
    let id = EventId::new(
        &pubkey,
        &Timestamp::from(created_at),
        &Kind::Custom(kind),
        &parsed_tags,
        content,
    );
    Ok(id.to_hex())
}

pub fn private_envelope_authorization_digest(
    envelope_id: &str,
    pubkey_hex: &str,
    created_at: u64,
    group_id: &str,
) -> Result<String, String> {
    if group_id.is_empty() {
        return Err("Private workspace authorization requires an MLS group id".to_owned());
    }
    compute_nostr_event_id(
        pubkey_hex,
        created_at,
        PRIVATE_WORKSPACE_AUTHORIZATION_KIND,
        &[
            vec!["e".to_owned(), envelope_id.to_owned()],
            vec!["group".to_owned(), group_id.to_owned()],
        ],
        PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN,
    )
}

pub fn authorization_event_id(envelope: &PrivateWorkspaceEnvelope) -> Result<String, String> {
    envelope
        .authorization
        .event
        .get("id")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| "Private workspace authorization event is missing id".to_owned())
}

pub fn assert_private_envelope_authorization(
    envelope: &PrivateWorkspaceEnvelope,
    expected_group_id: &str,
) -> Result<(), String> {
    if !is_valid_hex_pubkey(&envelope.pubkey) {
        return Err("Invalid private workspace envelope pubkey".to_owned());
    }
    let expected_id = compute_nostr_event_id(
        &envelope.pubkey,
        envelope.created_at,
        envelope.kind,
        &envelope.tags,
        &envelope.content,
    )?;
    if expected_id != envelope.id {
        return Err("Private workspace envelope id mismatch".to_owned());
    }
    if envelope.authorization.version != PRIVATE_WORKSPACE_AUTHORIZATION_VERSION {
        return Err("Private workspace envelope authorization version is unsupported".to_owned());
    }
    let event_json = serde_json::to_string(&envelope.authorization.event)
        .map_err(|e| format!("Invalid authorization event JSON: {e}"))?;
    let auth_event = Event::from_json(&event_json)
        .map_err(|e| format!("Invalid private workspace authorization event: {e}"))?;
    auth_event
        .verify()
        .map_err(|_| "Invalid private workspace authorization signature".to_owned())?;

    if auth_event.pubkey.to_hex() != envelope.pubkey {
        return Err("Private workspace authorization author mismatch".to_owned());
    }
    let expected_tags = vec![vec![
        "t".to_owned(),
        PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN.to_owned(),
    ]];
    let actual_tags: Vec<Vec<String>> = auth_event
        .tags
        .iter()
        .map(|t| t.as_slice().to_vec())
        .collect();
    if auth_event.kind != Kind::Custom(PRIVATE_WORKSPACE_AUTHORIZATION_KIND)
        || auth_event.created_at.as_secs() != envelope.created_at
        || actual_tags != expected_tags
    {
        return Err("Invalid private workspace authorization context".to_owned());
    }
    let expected_digest = private_envelope_authorization_digest(
        &envelope.id,
        &envelope.pubkey,
        envelope.created_at,
        expected_group_id,
    )?;
    if auth_event.content != expected_digest {
        return Err(
            "Private workspace authorization is for another envelope or MLS group".to_owned(),
        );
    }
    Ok(())
}

pub async fn create_private_envelope(
    signer: &dyn NostrEventSigner,
    group_id: &str,
    kind: u16,
    content: String,
    tags: Vec<Vec<String>>,
    created_at: Option<u64>,
) -> Result<PrivateWorkspaceEnvelope, String> {
    let pubkey = signer.pubkey_hex();
    let created_at = created_at.unwrap_or_else(|| Timestamp::now().as_secs());
    let id = compute_nostr_event_id(&pubkey, created_at, kind, &tags, &content)?;
    let digest = private_envelope_authorization_digest(&id, &pubkey, created_at, group_id)?;
    let auth_event = signer
        .sign_event_template(
            PRIVATE_WORKSPACE_AUTHORIZATION_KIND,
            created_at,
            vec![vec![
                "t".to_owned(),
                PRIVATE_WORKSPACE_AUTHORIZATION_DOMAIN.to_owned(),
            ]],
            digest,
        )
        .await?;
    let auth_value: serde_json::Value = serde_json::from_str(&auth_event.as_json())
        .map_err(|e| format!("Failed to serialize authorization event: {e}"))?;

    let envelope = PrivateWorkspaceEnvelope {
        id,
        pubkey,
        created_at,
        kind,
        tags,
        content,
        authorization: PrivateWorkspaceAuthorization {
            version: PRIVATE_WORKSPACE_AUTHORIZATION_VERSION,
            event: auth_value,
        },
    };
    assert_private_envelope_authorization(&envelope, group_id)?;
    Ok(envelope)
}

pub fn encode_private_envelope(envelope: &PrivateWorkspaceEnvelope) -> Result<Vec<u8>, String> {
    serde_json::to_vec(envelope).map_err(|e| format!("Failed to encode private envelope: {e}"))
}

pub fn decode_private_envelope(
    bytes: &[u8],
    expected_group_id: &str,
) -> Result<PrivateWorkspaceEnvelope, String> {
    let raw: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|_| "Invalid private workspace envelope JSON".to_owned())?;
    let obj = raw
        .as_object()
        .ok_or_else(|| "Invalid private workspace envelope".to_owned())?;
    if obj.contains_key("sig") {
        return Err("Private workspace envelopes must not contain a signature".to_owned());
    }
    let envelope: PrivateWorkspaceEnvelope = serde_json::from_value(raw)
        .map_err(|e| format!("Invalid private workspace envelope fields: {e}"))?;
    assert_private_envelope_authorization(&envelope, expected_group_id)?;
    Ok(envelope)
}
