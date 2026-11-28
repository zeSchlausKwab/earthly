//! Pure-Rust RFC 9420 MLS engine backed by `mls-rs` + `mls-rs-crypto-rustcrypto`.
//!
//! 100% wire-compatible with Earthly Web (`src/lib/private-workspace/mls.ts` using `ts-mls`)
//! and `cordn-rs` v0.4.0:
//! - Ciphersuite: `MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519` (`CipherSuite::CURVE25519_AES128`)
//! - Credential: `BasicCredential` with 64-byte lowercase hex Nostr pubkey
//! - Last-resort KeyPackage: App Data Dictionary extension `0x0006` containing component `0x0004`
//! - Application message AAD: `envelope.authorization.event.id` UTF-8 bytes
//! - Outer coordinator payload seal: `MLS-Exporter("cordn", b"group-payload", 32)` + ChaCha20-Poly1305

use std::collections::HashSet;
use std::convert::Infallible;
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use mls_rs::client_builder::{ClientBuilder, WithCryptoProvider, WithIdentityProvider};
use mls_rs::error::IntoAnyError;
use mls_rs::extension::ExtensionType;
use mls_rs::group::{CommitEffect, ReceivedMessage, Roster};
use mls_rs::identity::basic::BasicCredential;
use mls_rs::identity::{Credential, CredentialType, SigningIdentity};
use mls_rs::mls_rules::{
    CommitDirection, CommitOptions, CommitSource, DefaultMlsRules, EncryptionOptions,
    ProposalBundle,
};
use mls_rs::{
    CipherSuite, CipherSuiteProvider, Client, CryptoProvider, Extension, ExtensionList, Group,
    KeyPackage, MlsMessage, MlsRules, ProtocolVersion,
};
use mls_rs_codec::{MlsDecode, MlsEncode};
use mls_rs_core::crypto::{SignaturePublicKey, SignatureSecretKey};
use mls_rs_core::group::{EpochRecord, GroupContext, GroupState, GroupStateStorage};
use mls_rs_core::identity::{IdentityProvider, MemberValidationContext};
use mls_rs_core::key_package::{KeyPackageData, KeyPackageStorage};
use mls_rs_core::time::MlsTime;
use mls_rs_crypto_rustcrypto::RustCryptoProvider;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::envelope::{
    assert_private_envelope_authorization, authorization_event_id, decode_private_envelope,
    encode_private_envelope, PrivateWorkspaceEnvelope,
};
use crate::is_valid_hex_pubkey;

pub const APP_DATA_DICTIONARY_EXTENSION_TYPE: u16 = 0x0006;
pub const LAST_RESORT_KEY_PACKAGE_COMPONENT_ID: u16 = 0x0004;
pub const MAX_RETAINED_MLS_EPOCHS: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEpochRecord {
    pub id: u64,
    pub data_b64: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedMlsState {
    pub group_id: String,
    pub owner_pubkey: String,
    pub signer_sk_b64: String,
    pub signer_pk_b64: String,
    pub state_b64: String,
    #[serde(default)]
    pub epochs: Vec<PersistedEpochRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedKeyPackage {
    pub owner_pubkey: String,
    pub kp_ref: String,
    pub kp_64: String,
    pub kp_id_b64: String,
    pub kp_data_b64: String,
    pub signer_sk_b64: String,
    pub signer_pk_b64: String,
    #[serde(default)]
    pub last_resort: bool,
}

#[derive(Clone, Debug)]
pub struct AddMemberResult {
    pub new_state: PersistedMlsState,
    pub commit_64: String,
    pub welcome_64: String,
}

#[derive(Clone, Debug)]
pub struct RemoveMemberResult {
    pub new_state: PersistedMlsState,
    pub commit_64: String,
}

#[derive(Clone, Debug)]
pub struct ApplicationMessageResult {
    pub new_state: PersistedMlsState,
    pub message_64: String,
}

#[derive(Clone, Debug)]
pub enum ProcessedMlsMessage {
    ApplicationMessage {
        new_state: PersistedMlsState,
        envelope: PrivateWorkspaceEnvelope,
    },
    NewState(PersistedMlsState),
    Removed(PersistedMlsState),
    Rejected(PersistedMlsState),
}

// ---------------------------------------------------------------------------
// IdentityProvider: validates Nostr 64-hex BasicCredential
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct NostrIdentityProvider;

#[derive(Debug)]
pub struct NostrIdentityError(String);

impl std::fmt::Display for NostrIdentityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for NostrIdentityError {}

impl IntoAnyError for NostrIdentityError {
    fn into_dyn_error(self) -> Result<Box<dyn std::error::Error + Send + Sync>, Self> {
        Ok(Box::new(self))
    }
}

fn pubkey_from_credential(credential: &Credential) -> Result<String, NostrIdentityError> {
    let basic = credential
        .as_basic()
        .ok_or_else(|| NostrIdentityError("Only BasicCredential is supported".to_owned()))?;
    let pubkey = std::str::from_utf8(&basic.identifier)
        .map_err(|_| NostrIdentityError("MLS identity is not valid UTF-8".to_owned()))?;
    if !is_valid_hex_pubkey(pubkey) {
        return Err(NostrIdentityError(
            "MLS identity must be a 64-char lowercase hex Nostr pubkey".to_owned(),
        ));
    }
    Ok(pubkey.to_owned())
}

impl IdentityProvider for NostrIdentityProvider {
    type Error = NostrIdentityError;

    fn validate_member(
        &self,
        signing_identity: &SigningIdentity,
        _timestamp: Option<MlsTime>,
        _context: MemberValidationContext<'_>,
    ) -> Result<(), Self::Error> {
        let _ = pubkey_from_credential(&signing_identity.credential)?;
        Ok(())
    }

    fn validate_external_sender(
        &self,
        signing_identity: &SigningIdentity,
        _timestamp: Option<MlsTime>,
        _extensions: Option<&ExtensionList>,
    ) -> Result<(), Self::Error> {
        let _ = pubkey_from_credential(&signing_identity.credential)?;
        Ok(())
    }

    fn identity(
        &self,
        signing_identity: &SigningIdentity,
        _extensions: &ExtensionList,
    ) -> Result<Vec<u8>, Self::Error> {
        let pk = pubkey_from_credential(&signing_identity.credential)?;
        Ok(pk.into_bytes())
    }

    fn valid_successor(
        &self,
        predecessor: &SigningIdentity,
        successor: &SigningIdentity,
        _extensions: &ExtensionList,
    ) -> Result<bool, Self::Error> {
        Ok(pubkey_from_credential(&predecessor.credential)?
            == pubkey_from_credential(&successor.credential)?)
    }

    fn supported_types(&self) -> Vec<CredentialType> {
        vec![CredentialType::BASIC]
    }
}

// ---------------------------------------------------------------------------
// MlsRules: enforces administrator-only membership changes
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
struct EarthlyMlsRules {
    administrators: HashSet<String>,
}

#[derive(Debug)]
struct EarthlyRulesError(String);

impl std::fmt::Display for EarthlyRulesError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for EarthlyRulesError {}

impl IntoAnyError for EarthlyRulesError {
    fn into_dyn_error(self) -> Result<Box<dyn std::error::Error + Send + Sync>, Self> {
        Ok(Box::new(self))
    }
}

impl EarthlyMlsRules {
    fn new(admins: &[String]) -> Self {
        Self {
            administrators: admins.iter().cloned().collect(),
        }
    }
}

impl MlsRules for EarthlyMlsRules {
    type Error = EarthlyRulesError;

    fn filter_proposals(
        &self,
        direction: CommitDirection,
        source: CommitSource,
        current_roster: &Roster,
        _current_context: &GroupContext,
        proposals: ProposalBundle,
    ) -> Result<ProposalBundle, Self::Error> {
        if direction == CommitDirection::Send {
            return Ok(proposals);
        }

        let has_admin_proposal = !proposals.add_proposals().is_empty()
            || !proposals.remove_proposals().is_empty()
            || !proposals.group_context_ext_proposals().is_empty()
            || !proposals.reinit_proposals().is_empty()
            || !proposals.psk_proposals().is_empty()
            || !proposals.custom_proposals().is_empty();

        if !has_admin_proposal {
            return Ok(proposals);
        }

        let sender_pubkey = match source {
            CommitSource::ExistingMember(member) => {
                pubkey_from_credential(&member.signing_identity.credential)
                    .map_err(|e| EarthlyRulesError(e.0))?
            }
            CommitSource::NewMember(_) => {
                return Err(EarthlyRulesError(
                    "External commits are not authorized in Earthly Circles".to_owned(),
                ));
            }
        };

        if !self.administrators.contains(&sender_pubkey) {
            return Err(EarthlyRulesError(
                "Unauthorized non-administrator membership commit".to_owned(),
            ));
        }

        for remove_prop in proposals.remove_proposals() {
            let removed_index = remove_prop.proposal.to_remove();
            if let Ok(member) = current_roster.member_with_index(removed_index) {
                if let Ok(pk) = pubkey_from_credential(&member.signing_identity.credential) {
                    if self.administrators.contains(&pk) {
                        return Err(EarthlyRulesError(
                            "Cannot remove an administrator without demoting first".to_owned(),
                        ));
                    }
                }
            }
        }

        Ok(proposals)
    }

    fn commit_options(
        &self,
        _new_roster: &Roster,
        _new_context: &GroupContext,
        _proposals: &ProposalBundle,
    ) -> Result<CommitOptions, Self::Error> {
        Ok(CommitOptions::new()
            .with_ratchet_tree_extension(true)
            .with_single_welcome_message(true))
    }

    fn encryption_options(
        &self,
        _current_roster: &Roster,
        _current_context: &GroupContext,
    ) -> Result<EncryptionOptions, Self::Error> {
        // Match ts-mls default (PublicMessage for commits or PrivateMessage — both are accepted by ts-mls;
        // outer ChaCha20-Poly1305 already encrypts the full MLS message for the coordinator).
        Ok(EncryptionOptions::default())
    }
}

// ---------------------------------------------------------------------------
// Single-group snapshot storage adapters for mls-rs
// ---------------------------------------------------------------------------

#[derive(Clone, Default)]
struct SnapshotGroupStorage {
    inner: Arc<Mutex<Option<StoredGroupSnapshot>>>,
}

#[derive(Clone)]
struct StoredGroupSnapshot {
    id: Vec<u8>,
    state: Zeroizing<Vec<u8>>,
    epochs: Vec<EpochRecord>,
}

impl SnapshotGroupStorage {
    fn from_persisted(p: &PersistedMlsState) -> Result<Self, String> {
        let state = BASE64
            .decode(&p.state_b64)
            .map_err(|_| "Invalid MLS state base64".to_owned())?;
        let mut epochs = Vec::with_capacity(p.epochs.len());
        for ep in &p.epochs {
            let data = BASE64
                .decode(&ep.data_b64)
                .map_err(|_| "Invalid MLS epoch base64".to_owned())?;
            epochs.push(EpochRecord::new(ep.id, Zeroizing::new(data)));
        }
        Ok(Self {
            inner: Arc::new(Mutex::new(Some(StoredGroupSnapshot {
                id: p.group_id.as_bytes().to_vec(),
                state: Zeroizing::new(state),
                epochs,
            }))),
        })
    }

    fn export(
        &self,
        owner_pubkey: &str,
        signer_sk_b64: &str,
        signer_pk_b64: &str,
    ) -> Result<PersistedMlsState, String> {
        let guard = self.inner.lock().map_err(|_| "MLS storage lock poisoned")?;
        let snap = guard
            .as_ref()
            .ok_or_else(|| "MLS group state was not written".to_owned())?;
        let group_id = String::from_utf8(snap.id.clone())
            .map_err(|_| "MLS group id is not valid UTF-8".to_owned())?;
        let epochs = snap
            .epochs
            .iter()
            .map(|e| PersistedEpochRecord {
                id: e.id,
                data_b64: BASE64.encode(e.data.as_slice()),
            })
            .collect();
        Ok(PersistedMlsState {
            group_id,
            owner_pubkey: owner_pubkey.to_owned(),
            signer_sk_b64: signer_sk_b64.to_owned(),
            signer_pk_b64: signer_pk_b64.to_owned(),
            state_b64: BASE64.encode(snap.state.as_slice()),
            epochs,
        })
    }
}

impl GroupStateStorage for SnapshotGroupStorage {
    type Error = Infallible;

    fn state(&self, group_id: &[u8]) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        let guard = self.inner.lock().unwrap();
        Ok(guard
            .as_ref()
            .filter(|s| s.id.as_slice() == group_id)
            .map(|s| s.state.clone()))
    }

    fn epoch(
        &self,
        group_id: &[u8],
        epoch_id: u64,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, Self::Error> {
        let guard = self.inner.lock().unwrap();
        Ok(guard
            .as_ref()
            .filter(|s| s.id.as_slice() == group_id)
            .and_then(|s| s.epochs.iter().find(|e| e.id == epoch_id))
            .map(|e| e.data.clone()))
    }

    fn write(
        &mut self,
        state: GroupState,
        epoch_inserts: Vec<EpochRecord>,
        epoch_updates: Vec<EpochRecord>,
    ) -> Result<(), Self::Error> {
        let mut guard = self.inner.lock().unwrap();
        let entry = guard.get_or_insert_with(|| StoredGroupSnapshot {
            id: state.id.clone(),
            state: state.data.clone(),
            epochs: Vec::new(),
        });
        entry.id = state.id;
        entry.state = state.data;
        for ins in epoch_inserts {
            if let Some(existing) = entry.epochs.iter_mut().find(|e| e.id == ins.id) {
                *existing = ins;
            } else {
                entry.epochs.push(ins);
            }
        }
        for upd in epoch_updates {
            if let Some(existing) = entry.epochs.iter_mut().find(|e| e.id == upd.id) {
                *existing = upd;
            }
        }
        // Keep last 32 epochs for out-of-order / delayed delivery.
        entry.epochs.sort_by_key(|e| e.id);
        while entry.epochs.len() > MAX_RETAINED_MLS_EPOCHS {
            entry.epochs.remove(0);
        }
        Ok(())
    }

    fn max_epoch_id(&self, group_id: &[u8]) -> Result<Option<u64>, Self::Error> {
        let guard = self.inner.lock().unwrap();
        Ok(guard
            .as_ref()
            .filter(|s| s.id.as_slice() == group_id)
            .and_then(|s| s.epochs.iter().map(|e| e.id).max()))
    }
}

#[derive(Clone, Default)]
struct SingleKeyPackageStorage {
    inner: Arc<Mutex<Option<(Vec<u8>, KeyPackageData)>>>,
}

impl SingleKeyPackageStorage {
    fn with_entry(id: Vec<u8>, data: KeyPackageData) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Some((id, data)))),
        }
    }

    fn take_entry(&self) -> Option<(Vec<u8>, KeyPackageData)> {
        self.inner.lock().unwrap().clone()
    }
}

impl KeyPackageStorage for SingleKeyPackageStorage {
    type Error = Infallible;

    fn delete(&mut self, id: &[u8]) -> Result<(), Self::Error> {
        let mut guard = self.inner.lock().unwrap();
        if let Some((existing_id, _)) = guard.as_ref() {
            if existing_id.as_slice() == id {
                *guard = None;
            }
        }
        Ok(())
    }

    fn insert(&mut self, id: Vec<u8>, pkg: KeyPackageData) -> Result<(), Self::Error> {
        *self.inner.lock().unwrap() = Some((id, pkg));
        Ok(())
    }

    fn get(&self, id: &[u8]) -> Result<Option<KeyPackageData>, Self::Error> {
        let guard = self.inner.lock().unwrap();
        Ok(guard
            .as_ref()
            .filter(|(k, _)| k.as_slice() == id)
            .map(|(_, v)| v.clone()))
    }
}

// ---------------------------------------------------------------------------
// Cordn Last-Resort KeyPackage Extension (0x0006 App Data Dictionary, 0x0004)
// ---------------------------------------------------------------------------

/// Encodes the exact Cordn App Data Dictionary extension (`0x0006`) containing
/// `LAST_RESORT_KEY_PACKAGE_COMPONENT_ID` (`0x0004`) with an empty value.
/// Byte-identical to `src/lib/private-workspace/last-resort-key-package.ts`.
pub fn create_last_resort_extension() -> Extension {
    // dictionary = uint16(0x0004) || varbytes([]) = [0x00, 0x04, 0x00]
    // extension_data = varbytes(dictionary) = [0x03, 0x00, 0x04, 0x00]
    Extension::new(
        ExtensionType::from(APP_DATA_DICTIONARY_EXTENSION_TYPE),
        vec![0x03, 0x00, 0x04, 0x00],
    )
}

pub fn is_cordn_last_resort_key_package(kp: &KeyPackage) -> bool {
    let target_type = ExtensionType::from(APP_DATA_DICTIONARY_EXTENSION_TYPE);
    for ext in kp.extensions.iter() {
        if ext.extension_type != target_type {
            continue;
        }
        if parse_last_resort_app_data_dict(&ext.extension_data) {
            return true;
        }
    }
    false
}

fn decode_varbytes(bytes: &[u8], offset: usize) -> Option<(&[u8], usize)> {
    let first = *bytes.get(offset)?;
    let len_size = 1usize << ((first & 0xc0) >> 6);
    if offset + len_size > bytes.len() {
        return None;
    }
    let mut len = (first & 0x3f) as usize;
    for i in 1..len_size {
        len = (len << 8) | (*bytes.get(offset + i)? as usize);
    }
    let start = offset + len_size;
    let end = start.checked_add(len)?;
    if end > bytes.len() {
        return None;
    }
    Some((&bytes[start..end], end))
}

fn parse_last_resort_app_data_dict(data: &[u8]) -> bool {
    let Some((dict, end)) = decode_varbytes(data, 0) else {
        return false;
    };
    if end != data.len() {
        return false;
    }
    let mut offset = 0usize;
    while offset < dict.len() {
        if offset + 2 > dict.len() {
            return false;
        }
        let component_id = u16::from_be_bytes([dict[offset], dict[offset + 1]]);
        let Some((val, next)) = decode_varbytes(dict, offset + 2) else {
            return false;
        };
        if component_id == LAST_RESORT_KEY_PACKAGE_COMPONENT_ID && val.is_empty() {
            return true;
        }
        offset = next;
    }
    false
}

// ---------------------------------------------------------------------------
// Helpers to construct mls-rs Client with CURVE25519_AES128
// ---------------------------------------------------------------------------

fn crypto_provider() -> RustCryptoProvider {
    RustCryptoProvider::with_enabled_cipher_suites(vec![CipherSuite::CURVE25519_AES128])
}

fn generate_ed25519_keypair() -> Result<(SignatureSecretKey, SignaturePublicKey), String> {
    let cp = crypto_provider();
    let cs = cp
        .cipher_suite_provider(CipherSuite::CURVE25519_AES128)
        .ok_or_else(|| "CURVE25519_AES128 ciphersuite unavailable".to_owned())?;
    cs.signature_key_generate()
        .map_err(|e| format!("Failed to generate MLS Ed25519 keypair: {e}"))
}

fn build_client_with_rules(
    owner_pubkey: &str,
    signer_sk: SignatureSecretKey,
    signer_pk: SignaturePublicKey,
    group_storage: SnapshotGroupStorage,
    kp_storage: SingleKeyPackageStorage,
    admins: &[String],
) -> Client<
    mls_rs::client_builder::WithMlsRules<
        EarthlyMlsRules,
        mls_rs::client_builder::WithGroupStateStorage<
            SnapshotGroupStorage,
            mls_rs::client_builder::WithKeyPackageRepo<
                SingleKeyPackageStorage,
                WithIdentityProvider<
                    NostrIdentityProvider,
                    WithCryptoProvider<RustCryptoProvider, mls_rs::client_builder::BaseConfig>,
                >,
            >,
        >,
    >,
> {
    let signing_identity = SigningIdentity::new(
        Credential::Basic(BasicCredential::new(owner_pubkey.as_bytes().to_vec())),
        signer_pk,
    );
    ClientBuilder::new()
        .crypto_provider(crypto_provider())
        .identity_provider(NostrIdentityProvider)
        .key_package_repo(kp_storage)
        .group_state_storage(group_storage)
        .mls_rules(EarthlyMlsRules::new(admins))
        .used_protocol_version(ProtocolVersion::MLS_10)
        .extension_type(ExtensionType::from(APP_DATA_DICTIONARY_EXTENSION_TYPE))
        .signing_identity(signing_identity, signer_sk, CipherSuite::CURVE25519_AES128)
        .build()
}

fn decode_signer_keys(
    sk_b64: &str,
    pk_b64: &str,
) -> Result<(SignatureSecretKey, SignaturePublicKey), String> {
    let sk = BASE64
        .decode(sk_b64)
        .map_err(|_| "Invalid MLS signer secret key base64".to_owned())?;
    let pk = BASE64
        .decode(pk_b64)
        .map_err(|_| "Invalid MLS signer public key base64".to_owned())?;
    Ok((SignatureSecretKey::from(sk), SignaturePublicKey::from(pk)))
}

/// Decodes raw TLS-encoded `KeyPackage` (base64, as transmitted in Cordn `kp_64`)
/// into an `MlsMessage` suitable for `mls-rs`'s `commit_builder().add_member(...)`.
pub fn decode_raw_key_package_as_message(kp_64: &str) -> Result<(KeyPackage, MlsMessage), String> {
    let raw = BASE64
        .decode(kp_64.trim())
        .map_err(|_| "Invalid MLS KeyPackage base64".to_owned())?;
    // First try decoding as raw KeyPackage (Earthly Web / Cordn standard).
    if let Ok(kp) = KeyPackage::mls_decode_exhaustive(&raw) {
        let mut framed = Vec::with_capacity(4 + raw.len());
        framed.extend_from_slice(&[0x00, 0x01, 0x00, 0x05]); // MLS 1.0, WireFormat::KeyPackage
        framed.extend_from_slice(&raw);
        let msg = MlsMessage::from_bytes(&framed)
            .map_err(|e| format!("Failed to frame MLS KeyPackage message: {e}"))?;
        return Ok((kp, msg));
    }
    // Fallback: if caller passed a framed MLSMessage(KeyPackage), accept it too.
    let msg = MlsMessage::from_bytes(&raw)
        .map_err(|e| format!("Invalid MLS KeyPackage encoding: {e}"))?;
    let kp = msg
        .as_key_package()
        .cloned()
        .ok_or_else(|| "MLS message is not a KeyPackage".to_owned())?;
    Ok((kp, msg))
}

pub fn credential_pubkey_from_key_package_base64(kp_64: &str) -> Result<String, String> {
    let (kp, _) = decode_raw_key_package_as_message(kp_64)?;
    pubkey_from_credential(&kp.signing_identity().credential).map_err(|e| e.0)
}

// ---------------------------------------------------------------------------
// Public MLS Operations
// ---------------------------------------------------------------------------

pub fn generate_mls_key_package(
    owner_pubkey: &str,
    last_resort: bool,
) -> Result<GeneratedKeyPackage, String> {
    if !is_valid_hex_pubkey(owner_pubkey) {
        return Err("MLS identity must be a lowercase 64-hex Nostr pubkey".to_owned());
    }
    let (sk, pk) = generate_ed25519_keypair()?;
    let sk_b64 = BASE64.encode(sk.as_bytes());
    let pk_b64 = BASE64.encode(pk.as_bytes());
    let kp_storage = SingleKeyPackageStorage::default();
    let group_storage = SnapshotGroupStorage::default();
    let client = build_client_with_rules(
        owner_pubkey,
        sk,
        pk,
        group_storage,
        kp_storage.clone(),
        &[],
    );

    let mut kp_exts = ExtensionList::new();
    if last_resort {
        kp_exts.set(create_last_resort_extension());
    }
    let msg = client
        .generate_key_package_message(kp_exts, ExtensionList::new(), None)
        .map_err(|e| format!("Failed to generate MLS KeyPackage: {e}"))?;
    let kp = msg
        .as_key_package()
        .ok_or_else(|| "Generated MLS message was not a KeyPackage".to_owned())?;
    let cp = crypto_provider();
    let cs = cp
        .cipher_suite_provider(CipherSuite::CURVE25519_AES128)
        .ok_or_else(|| "CURVE25519_AES128 unavailable".to_owned())?;
    let kp_ref = hex::encode(
        kp.to_reference(&cs)
            .map_err(|e| format!("Failed to compute KeyPackageRef: {e}"))?
            .as_ref(),
    );
    let raw_kp_bytes = kp
        .mls_encode_to_vec()
        .map_err(|e| format!("Failed to encode raw KeyPackage: {e}"))?;
    let (kp_id, kp_data) = kp_storage
        .take_entry()
        .ok_or_else(|| "KeyPackage private material was not stored".to_owned())?;
    let kp_data_bytes = kp_data
        .mls_encode_to_vec()
        .map_err(|e| format!("Failed to encode KeyPackageData: {e}"))?;

    Ok(GeneratedKeyPackage {
        owner_pubkey: owner_pubkey.to_owned(),
        kp_ref,
        kp_64: BASE64.encode(&raw_kp_bytes),
        kp_id_b64: BASE64.encode(&kp_id),
        kp_data_b64: BASE64.encode(&kp_data_bytes),
        signer_sk_b64: sk_b64,
        signer_pk_b64: pk_b64,
        last_resort: is_cordn_last_resort_key_package(kp),
    })
}

pub fn create_workspace_group(
    group_id: &str,
    owner_pubkey: &str,
) -> Result<PersistedMlsState, String> {
    if !is_valid_hex_pubkey(owner_pubkey) {
        return Err("MLS identity must be a lowercase 64-hex Nostr pubkey".to_owned());
    }
    if group_id.is_empty() {
        return Err("MLS group id cannot be empty".to_owned());
    }
    let (sk, pk) = generate_ed25519_keypair()?;
    let sk_b64 = BASE64.encode(sk.as_bytes());
    let pk_b64 = BASE64.encode(pk.as_bytes());
    let group_storage = SnapshotGroupStorage::default();
    let kp_storage = SingleKeyPackageStorage::default();
    let client = build_client_with_rules(
        owner_pubkey,
        sk,
        pk,
        group_storage.clone(),
        kp_storage,
        &[owner_pubkey.to_owned()],
    );
    let mut group = client
        .create_group_with_id(
            group_id.as_bytes().to_vec(),
            ExtensionList::new(),
            ExtensionList::new(),
            None,
        )
        .map_err(|e| format!("Failed to create MLS group: {e}"))?;
    group
        .write_to_storage()
        .map_err(|e| format!("Failed to persist new MLS group: {e}"))?;
    group_storage.export(owner_pubkey, &sk_b64, &pk_b64)
}

fn load_group_from_state(
    state: &PersistedMlsState,
    admins: &[String],
) -> Result<
    (
        Group<
            mls_rs::client_builder::WithMlsRules<
                EarthlyMlsRules,
                mls_rs::client_builder::WithGroupStateStorage<
                    SnapshotGroupStorage,
                    mls_rs::client_builder::WithKeyPackageRepo<
                        SingleKeyPackageStorage,
                        WithIdentityProvider<
                            NostrIdentityProvider,
                            WithCryptoProvider<
                                RustCryptoProvider,
                                mls_rs::client_builder::BaseConfig,
                            >,
                        >,
                    >,
                >,
            >,
        >,
        SnapshotGroupStorage,
    ),
    String,
> {
    let (sk, pk) = decode_signer_keys(&state.signer_sk_b64, &state.signer_pk_b64)?;
    let group_storage = SnapshotGroupStorage::from_persisted(state)?;
    let client = build_client_with_rules(
        &state.owner_pubkey,
        sk,
        pk,
        group_storage.clone(),
        SingleKeyPackageStorage::default(),
        admins,
    );
    let group = client
        .load_group(state.group_id.as_bytes())
        .map_err(|e| format!("Failed to load MLS group state: {e}"))?;
    Ok((group, group_storage))
}

/// Loads the MLS group state once and returns `(current_epoch, member_pubkeys)`.
pub fn inspect_group_summary(state: &PersistedMlsState) -> Result<(u64, Vec<String>), String> {
    let (group, _) = load_group_from_state(state, &[])?;
    let epoch = group.current_epoch();
    let mut members = Vec::new();
    for member in group.roster().members_iter() {
        if let Ok(pk) = pubkey_from_credential(&member.signing_identity.credential) {
            members.push(pk);
        }
    }
    Ok((epoch, members))
}

pub fn member_pubkeys_from_state(state: &PersistedMlsState) -> Result<Vec<String>, String> {
    Ok(inspect_group_summary(state)?.1)
}

pub fn epoch_from_state(state: &PersistedMlsState) -> Result<u64, String> {
    let (group, _) = load_group_from_state(state, &[])?;
    Ok(group.current_epoch())
}

/// Derives the 32-byte Cordn `cordn-em-v1` encrypted-media key for the state's current epoch
/// using `MLS-Exporter("cordn", b"encrypted-media", 32)` (spec/applications/encrypted-media.md §3.1).
pub fn derive_encrypted_media_key(state: &PersistedMlsState) -> Result<[u8; 32], String> {
    Ok(derive_encrypted_media_key_with_epoch(state)?.1)
}

/// Loads MLS state once and returns `(current_epoch, encrypted_media_key)`.
pub fn derive_encrypted_media_key_with_epoch(
    state: &PersistedMlsState,
) -> Result<(u64, [u8; 32]), String> {
    let (group, _) = load_group_from_state(state, &[])?;
    let epoch = group.current_epoch();
    let secret = group
        .export_secret(b"cordn", b"encrypted-media", 32)
        .map_err(|e| format!("Failed to derive Cordn MLS encrypted-media key: {e}"))?;
    let mut key = [0u8; 32];
    if secret.len() != 32 {
        return Err("MLS exporter returned unexpected media key length".to_owned());
    }
    key.copy_from_slice(&secret);
    Ok((epoch, key))
}

pub fn add_workspace_member(
    state: &PersistedMlsState,
    raw_kp_64: &str,
    admins: &[String],
) -> Result<AddMemberResult, String> {
    let (_, kp_msg) = decode_raw_key_package_as_message(raw_kp_64)?;
    let (mut group, storage) = load_group_from_state(state, admins)?;
    let commit_out = group
        .commit_builder()
        .add_member(kp_msg)
        .map_err(|e| format!("Failed to stage MLS add proposal: {e}"))?
        .build()
        .map_err(|e| format!("Failed to build MLS add commit: {e}"))?;
    let commit_bytes = commit_out
        .commit_message()
        .to_bytes()
        .map_err(|e| format!("Failed to encode MLS commit: {e}"))?;
    let welcome_msg = commit_out
        .welcome_messages()
        .first()
        .ok_or_else(|| "MLS add commit did not produce a Welcome".to_owned())?;
    let welcome_bytes = welcome_msg
        .to_bytes()
        .map_err(|e| format!("Failed to encode MLS Welcome: {e}"))?;
    group
        .apply_pending_commit()
        .map_err(|e| format!("Failed to apply MLS add commit: {e}"))?;
    group
        .write_to_storage()
        .map_err(|e| format!("Failed to persist MLS state after add: {e}"))?;
    let new_state = storage.export(&state.owner_pubkey, &state.signer_sk_b64, &state.signer_pk_b64)?;
    Ok(AddMemberResult {
        new_state,
        commit_64: BASE64.encode(&commit_bytes),
        welcome_64: BASE64.encode(&welcome_bytes),
    })
}

pub fn remove_workspace_member(
    state: &PersistedMlsState,
    target_pubkey: &str,
    admins: &[String],
) -> Result<RemoveMemberResult, String> {
    let (mut group, storage) = load_group_from_state(state, admins)?;
    let target_index = group
        .roster()
        .members_iter()
        .find_map(|m| {
            pubkey_from_credential(&m.signing_identity.credential)
                .ok()
                .filter(|pk| pk == target_pubkey)
                .map(|_| m.index)
        })
        .ok_or_else(|| "The requested member is not in this Circle".to_owned())?;

    let commit_out = group
        .commit_builder()
        .remove_member(target_index)
        .map_err(|e| format!("Failed to stage MLS remove proposal: {e}"))?
        .build()
        .map_err(|e| format!("Failed to build MLS remove commit: {e}"))?;
    let commit_bytes = commit_out
        .commit_message()
        .to_bytes()
        .map_err(|e| format!("Failed to encode MLS remove commit: {e}"))?;
    group
        .apply_pending_commit()
        .map_err(|e| format!("Failed to apply MLS remove commit: {e}"))?;
    group
        .write_to_storage()
        .map_err(|e| format!("Failed to persist MLS state after remove: {e}"))?;
    let new_state = storage.export(&state.owner_pubkey, &state.signer_sk_b64, &state.signer_pk_b64)?;
    Ok(RemoveMemberResult {
        new_state,
        commit_64: BASE64.encode(&commit_bytes),
    })
}

pub fn join_workspace_group(
    welcome_64: &str,
    key_package: &GeneratedKeyPackage,
) -> Result<PersistedMlsState, String> {
    let welcome_bytes = BASE64
        .decode(welcome_64.trim())
        .map_err(|_| "Invalid MLS Welcome base64".to_owned())?;
    let welcome_msg = MlsMessage::from_bytes(&welcome_bytes)
        .map_err(|e| format!("Invalid MLS Welcome message: {e}"))?;
    let kp_id = BASE64
        .decode(&key_package.kp_id_b64)
        .map_err(|_| "Invalid stored KeyPackage ID".to_owned())?;
    let kp_data_bytes = BASE64
        .decode(&key_package.kp_data_b64)
        .map_err(|_| "Invalid stored KeyPackageData".to_owned())?;
    let kp_data = KeyPackageData::mls_decode_exhaustive(&kp_data_bytes)
        .map_err(|e| format!("Failed to decode stored KeyPackageData: {e}"))?;

    let (sk, pk) = decode_signer_keys(&key_package.signer_sk_b64, &key_package.signer_pk_b64)?;
    let group_storage = SnapshotGroupStorage::default();
    let kp_storage = SingleKeyPackageStorage::with_entry(kp_id, kp_data);
    let client = build_client_with_rules(
        &key_package.owner_pubkey,
        sk,
        pk,
        group_storage.clone(),
        kp_storage,
        &[],
    );
    let (mut group, _info) = client
        .join_group(None, &welcome_msg, None)
        .map_err(|e| format!("Failed to join MLS group from Welcome: {e}"))?;
    group
        .write_to_storage()
        .map_err(|e| format!("Failed to persist joined MLS group: {e}"))?;
    group_storage.export(
        &key_package.owner_pubkey,
        &key_package.signer_sk_b64,
        &key_package.signer_pk_b64,
    )
}

pub fn create_workspace_application_message(
    state: &PersistedMlsState,
    envelope: &PrivateWorkspaceEnvelope,
    allow_forwarded_author: bool,
    admins: &[String],
) -> Result<ApplicationMessageResult, String> {
    assert_private_envelope_authorization(envelope, &state.group_id)?;
    if !allow_forwarded_author && state.owner_pubkey != envelope.pubkey {
        return Err("Private envelope author does not match the local MLS credential".to_owned());
    }
    let auth_id = authorization_event_id(envelope)?;
    let plaintext = encode_private_envelope(envelope)?;
    let (mut group, storage) = load_group_from_state(state, admins)?;
    let msg = group
        .encrypt_application_message(&plaintext, auth_id.into_bytes())
        .map_err(|e| format!("Failed to encrypt MLS application message: {e}"))?;
    let bytes = msg
        .to_bytes()
        .map_err(|e| format!("Failed to serialize MLS application message: {e}"))?;
    group
        .write_to_storage()
        .map_err(|e| format!("Failed to persist MLS state after encrypt: {e}"))?;
    let new_state = storage.export(&state.owner_pubkey, &state.signer_sk_b64, &state.signer_pk_b64)?;
    Ok(ApplicationMessageResult {
        new_state,
        message_64: BASE64.encode(&bytes),
    })
}

pub fn process_workspace_message(
    state: &PersistedMlsState,
    message_64: &str,
    admins: &[String],
) -> Result<ProcessedMlsMessage, String> {
    Ok(process_workspace_message_with_epoch(state, message_64, admins)?.0)
}

/// Processes an MLS message and returns `(ProcessedMlsMessage, message_or_new_epoch)`.
/// For application messages, returns the exact epoch carried in the MLS wire frame (important
/// for resolving historical `cordn-em-v1` epoch media keys on delayed messages).
pub fn process_workspace_message_with_epoch(
    state: &PersistedMlsState,
    message_64: &str,
    admins: &[String],
) -> Result<(ProcessedMlsMessage, u64), String> {
    let bytes = BASE64
        .decode(message_64.trim())
        .map_err(|_| "Invalid MLS message base64".to_owned())?;
    let msg = MlsMessage::from_bytes(&bytes)
        .map_err(|e| format!("Invalid MLS framed message: {e}"))?;
    let frame_epoch = msg.epoch();
    let (mut group, storage) = load_group_from_state(state, admins)?;
    match group.process_incoming_message(msg) {
        Ok(ReceivedMessage::ApplicationMessage(app)) => {
            let aad_str = std::str::from_utf8(&app.authenticated_data)
                .map_err(|_| "MLS authenticated data is not UTF-8".to_owned())?;
            let envelope = decode_private_envelope(app.data(), &state.group_id)?;
            let expected_auth_id = authorization_event_id(&envelope)?;
            if aad_str != expected_auth_id {
                return Err(
                    "MLS authenticated data does not match the envelope authorization".to_owned(),
                );
            }
            let effective_epoch = frame_epoch.unwrap_or_else(|| group.current_epoch());
            group
                .write_to_storage()
                .map_err(|e| format!("Failed to persist MLS state: {e}"))?;
            let new_state = storage.export(
                &state.owner_pubkey,
                &state.signer_sk_b64,
                &state.signer_pk_b64,
            )?;
            Ok((
                ProcessedMlsMessage::ApplicationMessage {
                    new_state,
                    envelope,
                },
                effective_epoch,
            ))
        }
        Ok(ReceivedMessage::Commit(desc)) => {
            let new_epoch = group.current_epoch();
            group
                .write_to_storage()
                .map_err(|e| format!("Failed to persist MLS commit state: {e}"))?;
            let new_state = storage.export(
                &state.owner_pubkey,
                &state.signer_sk_b64,
                &state.signer_pk_b64,
            )?;
            if matches!(desc.effect, CommitEffect::Removed { .. }) {
                Ok((ProcessedMlsMessage::Removed(new_state), new_epoch))
            } else {
                Ok((ProcessedMlsMessage::NewState(new_state), new_epoch))
            }
        }
        Ok(ReceivedMessage::Proposal(_)) => {
            let cur_epoch = group.current_epoch();
            group
                .write_to_storage()
                .map_err(|e| format!("Failed to persist MLS proposal state: {e}"))?;
            let new_state = storage.export(
                &state.owner_pubkey,
                &state.signer_sk_b64,
                &state.signer_pk_b64,
            )?;
            Ok((ProcessedMlsMessage::NewState(new_state), cur_epoch))
        }
        Ok(_) => Ok((
            ProcessedMlsMessage::NewState(state.clone()),
            group.current_epoch(),
        )),
        Err(err) => {
            let msg_str = err.to_string();
            if msg_str.contains("Unauthorized non-administrator")
                || msg_str.contains("Cannot remove an administrator")
                || msg_str.contains("External commits are not authorized")
            {
                return Ok((
                    ProcessedMlsMessage::Rejected(state.clone()),
                    group.current_epoch(),
                ));
            }
            Err(format!("Failed to process MLS message: {msg_str}"))
        }
    }
}

fn derive_outer_key(state: &PersistedMlsState) -> Result<[u8; 32], String> {
    let (group, _) = load_group_from_state(state, &[])?;
    let secret = group
        .export_secret(b"cordn", b"group-payload", 32)
        .map_err(|e| format!("Failed to derive Cordn MLS outer key: {e}"))?;
    let mut key = [0u8; 32];
    if secret.len() != 32 {
        return Err("MLS exporter returned unexpected key length".to_owned());
    }
    key.copy_from_slice(&secret);
    Ok(key)
}

/// Outer ChaCha20-Poly1305 encryption for Cordn delivery (matches `sealCoordinatorPayload`).
pub fn seal_coordinator_payload(
    state: &PersistedMlsState,
    message_64: &str,
) -> Result<String, String> {
    let plaintext = BASE64
        .decode(message_64.trim())
        .map_err(|_| "Invalid MLS message base64".to_owned())?;
    let key = derive_outer_key(state)?;
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| format!("ChaCha20-Poly1305 init failed: {e}"))?;
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher
        .encrypt(
            nonce,
            Payload {
                msg: &plaintext,
                aad: &[],
            },
        )
        .map_err(|e| format!("ChaCha20-Poly1305 seal failed: {e}"))?;
    let mut combined = Vec::with_capacity(12 + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(BASE64.encode(&combined))
}

/// Outer ChaCha20-Poly1305 decryption for Cordn delivery (matches `openCoordinatorPayload`).
pub fn open_coordinator_payload(
    state: &PersistedMlsState,
    encrypted_64: &str,
) -> Result<String, String> {
    let payload = BASE64
        .decode(encrypted_64.trim())
        .map_err(|_| "Invalid coordinator payload base64".to_owned())?;
    if payload.len() < 29 {
        return Err("Invalid coordinator payload length".to_owned());
    }
    let key = derive_outer_key(state)?;
    let cipher = ChaCha20Poly1305::new_from_slice(&key)
        .map_err(|e| format!("ChaCha20-Poly1305 init failed: {e}"))?;
    let nonce = Nonce::from_slice(&payload[..12]);
    let plaintext = cipher
        .decrypt(
            nonce,
            Payload {
                msg: &payload[12..],
                aad: &[],
            },
        )
        .map_err(|_| "Failed to decrypt Cordn outer payload (epoch key mismatch)".to_owned())?;
    Ok(BASE64.encode(&plaintext))
}

#[allow(dead_code)]
fn _default_rules_marker() -> DefaultMlsRules {
    DefaultMlsRules::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn seal_coordinator_payload_uses_csprng_nonces_not_uuidv4_bits() {
        let pk = Keys::generate().public_key().to_hex();
        let state = create_workspace_group("earthly:nonce-test", &pk).unwrap();
        let payload_b64 = BASE64.encode(b"sample mls payload bytes for nonce test");

        // Collect 64 nonces and confirm:
        // 1. All 64 nonces are unique.
        // 2. Byte 6 high nibble is NOT stuck at 0x4 (UUIDv4 version) and byte 8 high 2 bits
        //    are NOT stuck at 0b10 (UUIDv4 variant).
        let mut seen = HashSet::new();
        let mut any_non_uuid_v4_byte6 = false;
        let mut any_non_uuid_v4_byte8 = false;
        for _ in 0..64 {
            let sealed = seal_coordinator_payload(&state, &payload_b64).unwrap();
            let raw = BASE64.decode(&sealed).unwrap();
            let nonce = &raw[..12];
            assert!(seen.insert(nonce.to_vec()));
            if (nonce[6] & 0xF0) != 0x40 {
                any_non_uuid_v4_byte6 = true;
            }
            if (nonce[8] & 0xC0) != 0x80 {
                any_non_uuid_v4_byte8 = true;
            }
            assert_eq!(open_coordinator_payload(&state, &sealed).unwrap(), payload_b64);
        }
        assert!(any_non_uuid_v4_byte6, "nonce byte 6 looked like fixed UUIDv4 version");
        assert!(any_non_uuid_v4_byte8, "nonce byte 8 looked like fixed UUIDv4 variant");
    }

    #[test]
    fn snapshot_storage_retains_up_to_32_epochs_and_exports_distinct_media_keys() {
        let admin_pk = Keys::generate().public_key().to_hex();
        let mut state = create_workspace_group("earthly:epoch-retention", &admin_pk).unwrap();
        let mut media_keys = HashSet::new();
        let (ep0, key0) = derive_encrypted_media_key_with_epoch(&state).unwrap();
        assert_eq!(ep0, 0);
        media_keys.insert(key0);

        // Advance through 35 epochs by adding & removing transient members.
        for _ in 0..18 {
            let peer_pk = Keys::generate().public_key().to_hex();
            let kp = generate_mls_key_package(&peer_pk, true).unwrap();
            let added = add_workspace_member(&state, &kp.kp_64, &[admin_pk.clone()]).unwrap();
            state = added.new_state;
            media_keys.insert(derive_encrypted_media_key(&state).unwrap());
            let removed = remove_workspace_member(&state, &peer_pk, &[admin_pk.clone()]).unwrap();
            state = removed.new_state;
            media_keys.insert(derive_encrypted_media_key(&state).unwrap());
        }

        let (final_epoch, members) = inspect_group_summary(&state).unwrap();
        assert_eq!(final_epoch, 36);
        assert_eq!(members, vec![admin_pk]);
        assert_eq!(state.epochs.len(), MAX_RETAINED_MLS_EPOCHS);
        assert_eq!(state.epochs.len(), 32);
        // Every epoch produces a unique 32-byte `cordn-em-v1` exporter secret!
        assert_eq!(media_keys.len(), 37);
    }
}
