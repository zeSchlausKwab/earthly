use std::collections::BTreeSet;
use std::io::{ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use flate2::read::ZlibDecoder;
use flate2::write::ZlibEncoder;
use flate2::Compression;
use nostr::{Event, EventBuilder, EventId, Keys, Kind, Tag, Timestamp};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::{NodeDescriptor, NodeIdentity, PeerPolicy};

pub const PAIRING_PROTOCOL_VERSION: u8 = 1;
pub const PAIRING_INVITATION_KIND: u16 = 24_243;
pub const PAIRING_CLAIM_KIND: u16 = 24_244;
pub const PAIRING_CLAIMS_PATH: &str = "/.well-known/earthly-local-node/pairing/claims";
const INVITATION_PREFIX: &str = "earthly-pair-v1:";
const COMPRESSED_INVITATION_MARKER: &str = "z";
const MAX_INVITATION_TTL: Duration = Duration::from_secs(10 * 60);
const MAX_ENCODED_INVITATION_BYTES: usize = 16 * 1024;
const MAX_DECOMPRESSED_INVITATION_BYTES: u64 = 64 * 1024;
const MAX_CLOCK_SKEW: u64 = 5 * 60;
const MAX_PENDING_CLAIMS: usize = 64;
const MAX_PENDING_PER_INVITATION: usize = 8;
const MAX_PEER_NAME_BYTES: usize = 128;
const MAX_REJECTION_REASON_BYTES: usize = 256;

#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PairingCapability {
    RelayRead,
    RelayWrite,
    BlobRead,
    BlobListOwn,
    BlobWrite,
    BlobDeleteOwn,
    BlobMirror,
}

impl PairingCapability {
    pub fn initial_set() -> Vec<Self> {
        vec![Self::RelayWrite, Self::BlobRead, Self::BlobWrite]
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInvitationContent {
    pub version: u8,
    pub descriptor: NodeDescriptor,
    pub nonce: String,
    pub expires_at: u64,
    pub capabilities: Vec<PairingCapability>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingInvitation {
    pub event: Event,
}

impl PairingInvitation {
    pub fn encode(&self) -> Result<String, PairingError> {
        self.validate()?;
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&serde_json::to_vec(self)?)?;
        let compressed = encoder.finish()?;
        Ok(format!(
            "{INVITATION_PREFIX}{COMPRESSED_INVITATION_MARKER}{}",
            URL_SAFE_NO_PAD.encode(compressed)
        ))
    }

    pub fn decode(value: &str) -> Result<Self, PairingError> {
        if value.len() > MAX_ENCODED_INVITATION_BYTES {
            return Err(PairingError::InvalidEncoding);
        }
        let encoded = value
            .strip_prefix(INVITATION_PREFIX)
            .ok_or(PairingError::InvalidEncoding)?;
        let (compressed, encoded) = match encoded.strip_prefix(COMPRESSED_INVITATION_MARKER) {
            Some(encoded) => (true, encoded),
            None => (false, encoded),
        };
        let decoded = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| PairingError::InvalidEncoding)?;
        let decoded = if compressed {
            let mut decoded_invitation = Vec::new();
            ZlibDecoder::new(decoded.as_slice())
                .take(MAX_DECOMPRESSED_INVITATION_BYTES + 1)
                .read_to_end(&mut decoded_invitation)
                .map_err(|_| PairingError::InvalidEncoding)?;
            if decoded_invitation.len() as u64 > MAX_DECOMPRESSED_INVITATION_BYTES {
                return Err(PairingError::InvalidEncoding);
            }
            decoded_invitation
        } else {
            decoded
        };
        let invitation: Self = serde_json::from_slice(&decoded)?;
        invitation.validate()?;
        Ok(invitation)
    }

    pub fn content(&self) -> Result<PairingInvitationContent, PairingError> {
        serde_json::from_str(&self.event.content).map_err(PairingError::from)
    }

    pub fn validate(&self) -> Result<PairingInvitationContent, PairingError> {
        self.validate_with_expiry(true)
    }

    fn validate_with_expiry(
        &self,
        require_unexpired: bool,
    ) -> Result<PairingInvitationContent, PairingError> {
        self.event
            .verify()
            .map_err(|_| PairingError::InvalidInvitation("invalid event signature".to_owned()))?;
        if self.event.kind.as_u16() != PAIRING_INVITATION_KIND {
            return Err(PairingError::InvalidInvitation(
                "unexpected event kind".to_owned(),
            ));
        }

        let content = self.content()?;
        if content.version != PAIRING_PROTOCOL_VERSION {
            return Err(PairingError::UnsupportedVersion(content.version));
        }
        if content.descriptor.node_id != self.event.pubkey.to_hex() {
            return Err(PairingError::InvalidInvitation(
                "descriptor is not owned by the invitation signer".to_owned(),
            ));
        }
        content
            .descriptor
            .validate()
            .map_err(|error| PairingError::InvalidInvitation(error.to_string()))?;
        validate_nonce(&content.nonce)?;
        validate_capabilities(&content.capabilities, false)?;

        let expiration =
            self.event.tags.expiration().ok_or_else(|| {
                PairingError::InvalidInvitation("missing expiration tag".to_owned())
            })?;
        if expiration.as_secs() != content.expires_at {
            return Err(PairingError::InvalidInvitation(
                "expiration tag does not match content".to_owned(),
            ));
        }
        let now = Timestamp::now().as_secs();
        if self.event.created_at.as_secs() > now + MAX_CLOCK_SKEW {
            return Err(PairingError::ClockSkew);
        }
        if require_unexpired && content.expires_at <= now {
            return Err(PairingError::Expired);
        }
        if content.expires_at > now + MAX_INVITATION_TTL.as_secs() {
            return Err(PairingError::InvalidInvitation(
                "invitation expiration is too far in the future".to_owned(),
            ));
        }
        let maximum_expiration = self.event.created_at.as_secs() + MAX_INVITATION_TTL.as_secs();
        if content.expires_at > maximum_expiration {
            return Err(PairingError::InvalidInvitation(
                "invitation lifetime exceeds the protocol maximum".to_owned(),
            ));
        }

        Ok(content)
    }

    pub fn create_claim(
        &self,
        peer: &Keys,
        requested_capabilities: Vec<PairingCapability>,
        peer_name: Option<String>,
    ) -> Result<Event, PairingError> {
        self.claim_builder(requested_capabilities, peer_name)?
            .sign_with_keys(peer)
            .map_err(|error| PairingError::Signing(error.to_string()))
    }

    pub(crate) fn create_claim_with_identity(
        &self,
        identity: &NodeIdentity,
        requested_capabilities: Vec<PairingCapability>,
        peer_name: Option<String>,
    ) -> Result<Event, PairingError> {
        identity.sign(self.claim_builder(requested_capabilities, peer_name)?)
    }

    fn claim_builder(
        &self,
        requested_capabilities: Vec<PairingCapability>,
        peer_name: Option<String>,
    ) -> Result<EventBuilder, PairingError> {
        let invitation = self.validate()?;
        validate_capabilities(&requested_capabilities, false)?;
        ensure_subset(&requested_capabilities, &invitation.capabilities)?;
        let content = PairingClaimContent {
            version: PAIRING_PROTOCOL_VERSION,
            invitation_id: self.event.id.to_hex(),
            node_id: self.event.pubkey.to_hex(),
            nonce: invitation.nonce,
            requested_capabilities,
            peer_name: normalize_peer_name(peer_name)?,
        };
        Ok(
            EventBuilder::new(PAIRING_CLAIM_KIND.into(), serde_json::to_string(&content)?).tags([
                Tag::event(self.event.id),
                Tag::public_key(self.event.pubkey),
                Tag::expiration(Timestamp::from(content_expiration(&self.event))),
            ]),
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaimContent {
    pub version: u8,
    pub invitation_id: String,
    pub node_id: String,
    pub nonce: String,
    pub requested_capabilities: Vec<PairingCapability>,
    pub peer_name: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaimRequest {
    pub claim: Event,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PairingClaimReceipt {
    pub claim_id: String,
    pub status: PairingStatus,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingPairingClaim {
    pub claim_id: String,
    pub peer_pubkey: String,
    pub peer_name: Option<String>,
    pub requested_capabilities: Vec<PairingCapability>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum PairingStatus {
    Pending,
    Accepted,
    Rejected { reason: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredClaim {
    invitation: PairingInvitation,
    claim: Event,
}

#[derive(Clone, Debug)]
pub struct PairingManager {
    root: Arc<PathBuf>,
    mutation: Arc<Mutex<()>>,
}

impl PairingManager {
    pub async fn open(root: impl Into<PathBuf>) -> Result<Self, PairingError> {
        let root = root.into();
        tokio::fs::create_dir_all(&root).await?;
        secure_directory(&root).await?;
        for child in [
            "invitations",
            "consumed",
            "claims",
            "decisions",
            "approvals",
        ] {
            let directory = root.join(child);
            tokio::fs::create_dir_all(&directory).await?;
            secure_directory(&directory).await?;
        }
        Ok(Self {
            root: Arc::new(root),
            mutation: Arc::new(Mutex::new(())),
        })
    }

    pub async fn create_invitation(
        &self,
        identity: &NodeIdentity,
        descriptor: &NodeDescriptor,
        ttl: Duration,
        capabilities: Vec<PairingCapability>,
    ) -> Result<PairingInvitation, PairingError> {
        if ttl.is_zero() || ttl > MAX_INVITATION_TTL {
            return Err(PairingError::InvalidInvitation(
                "invitation lifetime must be between one second and ten minutes".to_owned(),
            ));
        }
        validate_capabilities(&capabilities, false)?;
        let now = Timestamp::now();
        let expires_at = now.as_secs() + ttl.as_secs();
        let nonce = Keys::generate().secret_key().to_secret_hex();
        let content = PairingInvitationContent {
            version: PAIRING_PROTOCOL_VERSION,
            descriptor: descriptor.clone(),
            nonce,
            expires_at,
            capabilities,
        };
        let event = identity.sign(
            EventBuilder::new(
                Kind::Custom(PAIRING_INVITATION_KIND),
                serde_json::to_string(&content)?,
            )
            .custom_created_at(now)
            .tags([
                Tag::expiration(Timestamp::from(expires_at)),
                Tag::parse(["alt", "Earthly local-node pairing invitation"])
                    .map_err(|error| PairingError::Signing(error.to_string()))?,
            ]),
        )?;
        let invitation = PairingInvitation { event };
        invitation.validate()?;
        write_json_new(&self.invitation_path(invitation.event.id), &invitation).await?;
        Ok(invitation)
    }

    pub async fn submit_claim(&self, claim: Event) -> Result<PairingClaimReceipt, PairingError> {
        let _guard = self.mutation.lock().await;
        claim
            .verify()
            .map_err(|_| PairingError::InvalidClaim("invalid event signature".to_owned()))?;
        if claim.kind.as_u16() != PAIRING_CLAIM_KIND {
            return Err(PairingError::InvalidClaim(
                "unexpected event kind".to_owned(),
            ));
        }
        let content: PairingClaimContent = serde_json::from_str(&claim.content)?;
        if content.version != PAIRING_PROTOCOL_VERSION {
            return Err(PairingError::UnsupportedVersion(content.version));
        }
        let invitation_id = EventId::from_hex(&content.invitation_id)
            .map_err(|_| PairingError::InvalidClaim("invalid invitation id".to_owned()))?;
        if self.consumed_path(invitation_id).exists() || self.approval_path(invitation_id).exists()
        {
            return Err(PairingError::AlreadyUsed);
        }
        self.cleanup_expired_claims().await?;
        let claim_path = self.claim_path(claim.id);
        if claim_path.exists() {
            let existing: StoredClaim = read_json(&claim_path).await?;
            return if existing.claim == claim {
                Ok(PairingClaimReceipt {
                    claim_id: claim.id.to_hex(),
                    status: PairingStatus::Pending,
                })
            } else {
                Err(PairingError::InvalidClaim(
                    "claim id collides with different stored content".to_owned(),
                ))
            };
        }
        let invitation: PairingInvitation = read_json(&self.invitation_path(invitation_id)).await?;
        validate_claim(&invitation, &claim, &content)?;
        let (total, for_invitation) = self.pending_claim_counts(invitation_id).await?;
        if total >= MAX_PENDING_CLAIMS || for_invitation >= MAX_PENDING_PER_INVITATION {
            return Err(PairingError::TooManyClaims);
        }
        let stored = StoredClaim { invitation, claim };
        match write_json_new(&claim_path, &stored).await {
            Ok(()) => {}
            Err(PairingError::Io(error)) if error.kind() == ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
        Ok(PairingClaimReceipt {
            claim_id: stored.claim.id.to_hex(),
            status: PairingStatus::Pending,
        })
    }

    pub async fn pending_claims(&self) -> Result<Vec<PendingPairingClaim>, PairingError> {
        let _guard = self.mutation.lock().await;
        self.cleanup_expired_claims().await?;
        let mut result = Vec::new();
        let mut entries = tokio::fs::read_dir(self.root.join("claims")).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                continue;
            }
            let stored: StoredClaim = read_json(&entry.path()).await?;
            let content: PairingClaimContent = serde_json::from_str(&stored.claim.content)?;
            result.push(PendingPairingClaim {
                claim_id: stored.claim.id.to_hex(),
                peer_pubkey: stored.claim.pubkey.to_hex(),
                peer_name: content.peer_name,
                requested_capabilities: content.requested_capabilities,
            });
        }
        result.sort_by(|left, right| left.claim_id.cmp(&right.claim_id));
        Ok(result)
    }

    pub async fn approve_claim(
        &self,
        claim_id: EventId,
        peers: &PeerPolicy,
    ) -> Result<PendingPairingClaim, PairingError> {
        let _guard = self.mutation.lock().await;
        let claim_path = self.claim_path(claim_id);
        let stored: StoredClaim = read_json(&claim_path).await?;
        let content: PairingClaimContent = serde_json::from_str(&stored.claim.content)?;
        let approval_path = self.approval_path(stored.invitation.event.id);
        let approval_reserved = if approval_path.exists() {
            let winner: String = read_json(&approval_path).await?;
            if winner != claim_id.to_hex() {
                return Err(PairingError::AlreadyUsed);
            }
            true
        } else {
            false
        };
        validate_claim_with_expiry(
            &stored.invitation,
            &stored.claim,
            &content,
            !approval_reserved,
        )?;
        if !approval_reserved {
            if self.decision_path(claim_id).exists() {
                return Err(PairingError::AlreadyUsed);
            }
            reserve_approval(&approval_path, claim_id).await?;
        }

        let invitation_path = self.invitation_path(stored.invitation.event.id);
        let consumed_path = self.consumed_path(stored.invitation.event.id);
        if invitation_path.exists() {
            if consumed_path.exists() {
                return Err(PairingError::InconsistentState(
                    "invitation is both active and consumed".to_owned(),
                ));
            }
            tokio::fs::rename(&invitation_path, &consumed_path).await?;
            sync_directory(invitation_path.parent().expect("invitation has a parent")).await?;
            sync_directory(
                consumed_path
                    .parent()
                    .expect("consumed invitation has a parent"),
            )
            .await?;
        } else if !consumed_path.exists() {
            return Err(PairingError::InconsistentState(
                "approved invitation is neither active nor consumed".to_owned(),
            ));
        }
        peers
            .grant_with_capabilities(stored.claim.pubkey, content.requested_capabilities.clone())
            .await
            .map_err(|error| PairingError::Policy(error.to_string()))?;

        let summary = PendingPairingClaim {
            claim_id: stored.claim.id.to_hex(),
            peer_pubkey: stored.claim.pubkey.to_hex(),
            peer_name: content.peer_name,
            requested_capabilities: content.requested_capabilities,
        };
        write_status_idempotent(&self.decision_path(claim_id), &PairingStatus::Accepted).await?;
        self.reject_competing_claims(stored.invitation.event.id, claim_id)
            .await?;
        remove_file_if_present(&claim_path).await?;
        Ok(summary)
    }

    pub async fn reject_claim(
        &self,
        claim_id: EventId,
        reason: impl Into<String>,
    ) -> Result<(), PairingError> {
        let _guard = self.mutation.lock().await;
        let claim_path = self.claim_path(claim_id);
        let stored: StoredClaim = read_json(&claim_path).await?;
        if self.approval_path(stored.invitation.event.id).exists()
            || self.consumed_path(stored.invitation.event.id).exists()
        {
            return Err(PairingError::AlreadyUsed);
        }
        let reason = normalize_rejection_reason(reason.into())?;
        let status = PairingStatus::Rejected { reason };
        write_status_idempotent(&self.decision_path(claim_id), &status).await?;
        remove_file_if_present(&claim_path).await?;
        Ok(())
    }

    pub async fn status(&self, claim_id: EventId) -> Result<PairingStatus, PairingError> {
        let _guard = self.mutation.lock().await;
        self.cleanup_expired_claims().await?;
        let decision_path = self.decision_path(claim_id);
        if decision_path.exists() {
            return read_json(&decision_path).await;
        }
        if self.claim_path(claim_id).exists() {
            return Ok(PairingStatus::Pending);
        }
        Err(PairingError::NotFound)
    }

    fn invitation_path(&self, id: EventId) -> PathBuf {
        self.root.join("invitations").join(format!("{id}.json"))
    }

    fn consumed_path(&self, id: EventId) -> PathBuf {
        self.root.join("consumed").join(format!("{id}.json"))
    }

    fn claim_path(&self, id: EventId) -> PathBuf {
        self.root.join("claims").join(format!("{id}.json"))
    }

    fn decision_path(&self, id: EventId) -> PathBuf {
        self.root.join("decisions").join(format!("{id}.json"))
    }

    fn approval_path(&self, invitation_id: EventId) -> PathBuf {
        self.root
            .join("approvals")
            .join(format!("{invitation_id}.json"))
    }

    async fn pending_claim_counts(
        &self,
        invitation_id: EventId,
    ) -> Result<(usize, usize), PairingError> {
        let mut total = 0;
        let mut for_invitation = 0;
        let mut entries = tokio::fs::read_dir(self.root.join("claims")).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                continue;
            }
            total += 1;
            let stored: StoredClaim = read_json(&entry.path()).await?;
            if stored.invitation.event.id == invitation_id {
                for_invitation += 1;
            }
        }
        Ok((total, for_invitation))
    }

    async fn reject_competing_claims(
        &self,
        invitation_id: EventId,
        accepted_claim_id: EventId,
    ) -> Result<(), PairingError> {
        let mut entries = tokio::fs::read_dir(self.root.join("claims")).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                continue;
            }
            let stored: StoredClaim = read_json(&entry.path()).await?;
            if stored.invitation.event.id != invitation_id || stored.claim.id == accepted_claim_id {
                continue;
            }
            let status = PairingStatus::Rejected {
                reason: "invitation was approved for another peer".to_owned(),
            };
            write_status_idempotent(&self.decision_path(stored.claim.id), &status).await?;
            remove_file_if_present(&entry.path()).await?;
        }
        Ok(())
    }

    async fn cleanup_expired_claims(&self) -> Result<(), PairingError> {
        let now = Timestamp::now().as_secs();
        let mut entries = tokio::fs::read_dir(self.root.join("claims")).await?;
        while let Some(entry) = entries.next_entry().await? {
            if !entry.file_type().await?.is_file() {
                continue;
            }
            let stored: StoredClaim = read_json(&entry.path()).await?;
            let decision_path = self.decision_path(stored.claim.id);
            if decision_path.exists() {
                remove_file_if_present(&entry.path()).await?;
                continue;
            }
            if stored.invitation.content()?.expires_at > now {
                continue;
            }
            let status = PairingStatus::Rejected {
                reason: "pairing invitation expired".to_owned(),
            };
            write_status_idempotent(&decision_path, &status).await?;
            remove_file_if_present(&entry.path()).await?;
        }
        Ok(())
    }
}

fn validate_claim(
    invitation: &PairingInvitation,
    claim: &Event,
    content: &PairingClaimContent,
) -> Result<(), PairingError> {
    validate_claim_with_expiry(invitation, claim, content, true)
}

fn validate_claim_with_expiry(
    invitation: &PairingInvitation,
    claim: &Event,
    content: &PairingClaimContent,
    require_unexpired: bool,
) -> Result<(), PairingError> {
    claim
        .verify()
        .map_err(|_| PairingError::InvalidClaim("invalid event signature".to_owned()))?;
    if claim.kind.as_u16() != PAIRING_CLAIM_KIND {
        return Err(PairingError::InvalidClaim(
            "unexpected event kind".to_owned(),
        ));
    }
    if content.version != PAIRING_PROTOCOL_VERSION {
        return Err(PairingError::UnsupportedVersion(content.version));
    }
    validate_peer_name(content.peer_name.as_deref())?;

    let invitation_content = invitation.validate_with_expiry(require_unexpired)?;
    if content.invitation_id != invitation.event.id.to_hex()
        || content.node_id != invitation.event.pubkey.to_hex()
        || content.nonce != invitation_content.nonce
    {
        return Err(PairingError::InvalidClaim(
            "claim is not bound to this invitation".to_owned(),
        ));
    }
    validate_capabilities(&content.requested_capabilities, false)?;
    ensure_subset(
        &content.requested_capabilities,
        &invitation_content.capabilities,
    )?;
    let now = Timestamp::now().as_secs();
    if claim.created_at.as_secs() > now + MAX_CLOCK_SKEW
        || claim.created_at.as_secs().saturating_add(MAX_CLOCK_SKEW)
            < invitation.event.created_at.as_secs()
        || claim.created_at.as_secs() >= invitation_content.expires_at
    {
        return Err(PairingError::ClockSkew);
    }
    if !has_tag(claim, "e", &invitation.event.id.to_hex())
        || !has_tag(claim, "p", &invitation.event.pubkey.to_hex())
    {
        return Err(PairingError::InvalidClaim(
            "claim is missing invitation bindings".to_owned(),
        ));
    }
    let expiration = claim
        .tags
        .expiration()
        .ok_or_else(|| PairingError::InvalidClaim("missing expiration tag".to_owned()))?;
    if expiration.as_secs() != invitation_content.expires_at {
        return Err(PairingError::InvalidClaim(
            "claim expiration does not match invitation".to_owned(),
        ));
    }
    if require_unexpired && expiration.as_secs() <= now {
        return Err(PairingError::Expired);
    }
    Ok(())
}

fn content_expiration(invitation: &Event) -> u64 {
    invitation
        .tags
        .expiration()
        .map(Timestamp::as_secs)
        .unwrap_or_else(|| Timestamp::now().as_secs())
}

fn has_tag(event: &Event, name: &str, expected: &str) -> bool {
    event.tags.iter().any(|tag| {
        let values = tag.as_slice();
        values.first().map(String::as_str) == Some(name)
            && values.get(1).map(String::as_str) == Some(expected)
    })
}

fn validate_nonce(nonce: &str) -> Result<(), PairingError> {
    if nonce.len() == 64
        && nonce
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(PairingError::InvalidInvitation(
            "nonce must be 32-byte hexadecimal data".to_owned(),
        ))
    }
}

fn normalize_peer_name(peer_name: Option<String>) -> Result<Option<String>, PairingError> {
    match peer_name {
        Some(name) => {
            let trimmed = name.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            validate_peer_name(Some(trimmed))?;
            Ok(Some(trimmed.to_owned()))
        }
        None => Ok(None),
    }
}

fn validate_peer_name(peer_name: Option<&str>) -> Result<(), PairingError> {
    if let Some(name) = peer_name {
        if name.is_empty() || name.len() > MAX_PEER_NAME_BYTES || name.trim() != name {
            return Err(PairingError::InvalidClaim(
                "peer name must be trimmed and contain 1 to 128 UTF-8 bytes".to_owned(),
            ));
        }
    }
    Ok(())
}

fn normalize_rejection_reason(reason: String) -> Result<String, PairingError> {
    let reason = reason.trim();
    if reason.is_empty() || reason.len() > MAX_REJECTION_REASON_BYTES {
        return Err(PairingError::InvalidRejectionReason);
    }
    Ok(reason.to_owned())
}

fn validate_capabilities(
    capabilities: &[PairingCapability],
    allow_empty: bool,
) -> Result<(), PairingError> {
    let unique: BTreeSet<_> = capabilities.iter().copied().collect();
    if (!allow_empty && unique.is_empty()) || unique.len() != capabilities.len() {
        return Err(PairingError::InvalidCapabilities);
    }
    Ok(())
}

fn ensure_subset(
    requested: &[PairingCapability],
    offered: &[PairingCapability],
) -> Result<(), PairingError> {
    let offered: BTreeSet<_> = offered.iter().copied().collect();
    if requested
        .iter()
        .all(|capability| offered.contains(capability))
    {
        Ok(())
    } else {
        Err(PairingError::CapabilityEscalation)
    }
}

async fn write_json_new(path: &Path, value: &impl Serialize) -> Result<(), PairingError> {
    let bytes = serde_json::to_vec(value)?;
    let mut options = tokio::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    options.mode(0o600);
    let mut file = options.open(path).await?;
    file.write_all(&bytes).await?;
    file.sync_all().await?;
    if let Some(parent) = path.parent() {
        sync_directory(parent).await?;
    }
    Ok(())
}

async fn reserve_approval(path: &Path, claim_id: EventId) -> Result<(), PairingError> {
    let winner = claim_id.to_hex();
    match write_json_new(path, &winner).await {
        Ok(()) => Ok(()),
        Err(PairingError::Io(error)) if error.kind() == ErrorKind::AlreadyExists => {
            let existing: String = read_json(path).await?;
            if existing == winner {
                Ok(())
            } else {
                Err(PairingError::AlreadyUsed)
            }
        }
        Err(error) => Err(error),
    }
}

async fn write_status_idempotent(path: &Path, status: &PairingStatus) -> Result<(), PairingError> {
    match write_json_new(path, status).await {
        Ok(()) => Ok(()),
        Err(PairingError::Io(error)) if error.kind() == ErrorKind::AlreadyExists => {
            let existing: PairingStatus = read_json(path).await?;
            if existing == *status {
                Ok(())
            } else {
                Err(PairingError::AlreadyUsed)
            }
        }
        Err(error) => Err(error),
    }
}

async fn remove_file_if_present(path: &Path) -> Result<(), PairingError> {
    match tokio::fs::remove_file(path).await {
        Ok(()) => {
            if let Some(parent) = path.parent() {
                sync_directory(parent).await?;
            }
            Ok(())
        }
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(PairingError::Io(error)),
    }
}

#[cfg(unix)]
async fn secure_directory(path: &Path) -> Result<(), PairingError> {
    use std::os::unix::fs::PermissionsExt;

    tokio::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).await?;
    Ok(())
}

#[cfg(not(unix))]
async fn secure_directory(_path: &Path) -> Result<(), PairingError> {
    Ok(())
}

#[cfg(unix)]
async fn sync_directory(path: &Path) -> Result<(), PairingError> {
    let directory = tokio::fs::File::open(path).await?;
    directory.sync_all().await?;
    Ok(())
}

#[cfg(not(unix))]
async fn sync_directory(_path: &Path) -> Result<(), PairingError> {
    Ok(())
}

async fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T, PairingError> {
    match tokio::fs::read(path).await {
        Ok(bytes) => serde_json::from_slice(&bytes).map_err(PairingError::from),
        Err(error) if error.kind() == ErrorKind::NotFound => Err(PairingError::NotFound),
        Err(error) => Err(PairingError::Io(error)),
    }
}

#[derive(Debug, Error)]
pub enum PairingError {
    #[error("invalid pairing invitation encoding")]
    InvalidEncoding,
    #[error("unsupported pairing protocol version {0}")]
    UnsupportedVersion(u8),
    #[error("invalid pairing invitation: {0}")]
    InvalidInvitation(String),
    #[error("invalid pairing claim: {0}")]
    InvalidClaim(String),
    #[error("pairing invitation has expired")]
    Expired,
    #[error("pairing invitation was already consumed")]
    AlreadyUsed,
    #[error("pairing claim was not found")]
    NotFound,
    #[error("too many pending pairing claims")]
    TooManyClaims,
    #[error("pairing capabilities must be unique and non-empty")]
    InvalidCapabilities,
    #[error("pairing claim requests a capability not offered by the host")]
    CapabilityEscalation,
    #[error("pairing claim clock is outside the accepted skew")]
    ClockSkew,
    #[error("pairing rejection reason must contain 1 to 256 UTF-8 bytes")]
    InvalidRejectionReason,
    #[error("pairing store is inconsistent: {0}")]
    InconsistentState(String),
    #[error("pairing event signing failed: {0}")]
    Signing(String),
    #[error("pairing policy update failed: {0}")]
    Policy(String),
    #[error(transparent)]
    Serialization(#[from] serde_json::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{LocalNode, NodeAvailability, NodeConfig};

    #[tokio::test]
    async fn signed_invitation_round_trips_and_grants_once() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();
        let encoded = invitation.encode().unwrap();
        assert!(encoded.starts_with("earthly-pair-v1:z"));
        assert!(
            encoded.len() < 900,
            "encoded invitation is too dense for QR"
        );
        let decoded = PairingInvitation::decode(&encoded).unwrap();
        assert_eq!(decoded, invitation);
        let legacy = format!(
            "{INVITATION_PREFIX}{}",
            URL_SAFE_NO_PAD.encode(serde_json::to_vec(&invitation).unwrap())
        );
        assert_eq!(PairingInvitation::decode(&legacy).unwrap(), invitation);

        let peer = Keys::generate();
        let claim = decoded
            .create_claim(
                &peer,
                vec![PairingCapability::RelayWrite, PairingCapability::BlobWrite],
                Some("peer app".to_owned()),
            )
            .unwrap();
        let receipt = node.submit_pairing_claim(claim).await.unwrap();
        assert_eq!(receipt.status, PairingStatus::Pending);
        let claim_id = EventId::from_hex(&receipt.claim_id).unwrap();
        let approved = node.approve_pairing_claim(claim_id).await.unwrap();
        assert_eq!(approved.peer_pubkey, peer.public_key().to_hex());
        assert!(node.peer_is_granted(&peer.public_key()).await);
        assert_eq!(
            node.pairing_status(claim_id).await.unwrap(),
            PairingStatus::Accepted
        );

        let replay = decoded
            .create_claim(&Keys::generate(), vec![PairingCapability::RelayWrite], None)
            .unwrap();
        assert!(matches!(
            node.submit_pairing_claim(replay).await,
            Err(PairingError::AlreadyUsed)
        ));
    }

    #[tokio::test]
    async fn rejects_claim_capability_escalation_before_signing() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), vec![PairingCapability::RelayRead])
            .await
            .unwrap();

        assert!(matches!(
            invitation.create_claim(&Keys::generate(), vec![PairingCapability::RelayWrite], None,),
            Err(PairingError::CapabilityEscalation)
        ));
    }

    #[tokio::test]
    async fn http_claim_submission_waits_for_host_approval() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();
        let claim = invitation
            .create_claim(&Keys::generate(), vec![PairingCapability::RelayWrite], None)
            .unwrap();
        let claims_url = node
            .descriptor()
            .blossom_url
            .join(PAIRING_CLAIMS_PATH.trim_start_matches('/'))
            .unwrap();
        let response = reqwest::Client::new()
            .post(claims_url.clone())
            .json(&PairingClaimRequest { claim })
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
        let receipt: PairingClaimReceipt = response.json().await.unwrap();
        let claim_id = EventId::from_hex(&receipt.claim_id).unwrap();
        let status_url = node
            .descriptor()
            .blossom_url
            .join(&format!(
                "{}/{}",
                PAIRING_CLAIMS_PATH.trim_start_matches('/'),
                receipt.claim_id
            ))
            .unwrap();
        let pending: PairingStatus = reqwest::get(status_url.clone())
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(pending, PairingStatus::Pending);

        node.approve_pairing_claim(claim_id).await.unwrap();
        let accepted: PairingStatus = reqwest::get(status_url)
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(accepted, PairingStatus::Accepted);
    }

    #[tokio::test]
    async fn approval_recovers_after_reservation_and_invitation_consumption() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();
        let peer = Keys::generate();
        let claim = invitation
            .create_claim(&peer, vec![PairingCapability::RelayWrite], None)
            .unwrap();
        let receipt = node.submit_pairing_claim(claim).await.unwrap();
        let claim_id = EventId::from_hex(&receipt.claim_id).unwrap();
        let manager = PairingManager::open(dir.path().join("pairing"))
            .await
            .unwrap();

        reserve_approval(&manager.approval_path(invitation.event.id), claim_id)
            .await
            .unwrap();
        tokio::fs::rename(
            manager.invitation_path(invitation.event.id),
            manager.consumed_path(invitation.event.id),
        )
        .await
        .unwrap();

        let approved = node.approve_pairing_claim(claim_id).await.unwrap();
        assert_eq!(approved.peer_pubkey, peer.public_key().to_hex());
        assert_eq!(
            node.pairing_status(claim_id).await.unwrap(),
            PairingStatus::Accepted
        );
    }

    #[tokio::test]
    async fn approving_one_peer_rejects_competing_claims() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();
        let first = invitation
            .create_claim(
                &Keys::generate(),
                vec![PairingCapability::RelayWrite],
                Some("first".to_owned()),
            )
            .unwrap();
        let second = invitation
            .create_claim(
                &Keys::generate(),
                vec![PairingCapability::RelayWrite],
                Some("second".to_owned()),
            )
            .unwrap();
        let first_id =
            EventId::from_hex(&node.submit_pairing_claim(first).await.unwrap().claim_id).unwrap();
        let second_id =
            EventId::from_hex(&node.submit_pairing_claim(second).await.unwrap().claim_id).unwrap();

        node.approve_pairing_claim(first_id).await.unwrap();

        assert_eq!(
            node.pairing_status(second_id).await.unwrap(),
            PairingStatus::Rejected {
                reason: "invitation was approved for another peer".to_owned()
            }
        );
    }

    #[tokio::test]
    async fn bounds_pending_claims_per_invitation() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();
        let invitation = node
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();

        for _ in 0..MAX_PENDING_PER_INVITATION {
            let claim = invitation
                .create_claim(&Keys::generate(), vec![PairingCapability::RelayWrite], None)
                .unwrap();
            node.submit_pairing_claim(claim).await.unwrap();
        }
        let overflow = invitation
            .create_claim(&Keys::generate(), vec![PairingCapability::RelayWrite], None)
            .unwrap();
        assert!(matches!(
            node.submit_pairing_claim(overflow).await,
            Err(PairingError::TooManyClaims)
        ));
    }
}
