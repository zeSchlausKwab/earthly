//! Pure-Rust Cashu Ecash Wallet (NUT-00/02/03/04/05/07/08/11),
//! NIP-60 Nostr Wallet Sync (kinds 17375, 7375, 7376), and
//! NIP-61 Nutzaps (kinds 10019, 9321).

use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine as _;
use earthly_storage::{
    CashuHistoryRecord, CashuProofRecord, CashuWalletStore, PendingCashuToken,
    PersistedCashuWallet,
};
use nostr::nips::nip44;
use nostr::nips::nip60::{SpendingHistory, TransactionDirection};
use nostr::{
    Alphabet, Event, EventBuilder, EventId, Filter, Keys, Kind, PublicKey as NostrPublicKey,
    SingleLetterTag, Tag,
};
use rand::RngCore;
use secp256k1::{Keypair, Message, PublicKey, Scalar, Secp256k1, SecretKey, XOnlyPublicKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const CASHU_HASH_DOMAIN: &[u8] = b"Secp256k1_HashToCurve_Cashu_";
const DEFAULT_RELAY: &str = "wss://relay.earthly.city";
const DISCOVERY_RELAYS: &[&str] = &[
    "wss://relay.damus.io",
    "wss://nos.lol",
    "wss://relay.primal.net",
    "wss://purplepag.es",
];
const HTTP_TIMEOUT_SECS: u64 = 20;
const RELAY_FETCH_TIMEOUT_SECS: u64 = 8;

// ---------------------------------------------------------------------------
// Public FRB FFI DTOs
// ---------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct CashuMintBalanceDto {
    pub mint_url: String,
    pub balance_sats: u64,
    pub proof_count: u64,
}

#[derive(Clone, Debug)]
pub struct CashuHistoryDto {
    pub id: String,
    pub direction: String,
    pub amount_sats: u64,
    pub mint_url: String,
    pub unit: String,
    pub memo: Option<String>,
    pub event_id: Option<String>,
    pub counterparty_pubkey: Option<String>,
    pub created_at: u64,
}

#[derive(Clone, Debug)]
pub struct PendingCashuTokenDto {
    pub id: String,
    pub mint_url: String,
    pub amount_sats: u64,
    pub token: String,
    pub memo: Option<String>,
    pub created_at: u64,
    pub state: String,
}

#[derive(Clone, Debug)]
pub struct CashuWalletStateDto {
    pub pubkey_hex: String,
    pub mints: Vec<String>,
    pub relays: Vec<String>,
    pub default_mint: Option<String>,
    pub p2pk_pubkey_hex: String,
    pub balance_sats: u64,
    pub mint_balances: Vec<CashuMintBalanceDto>,
    pub proof_count: u64,
    pub pending_tokens: Vec<PendingCashuTokenDto>,
    pub history: Vec<CashuHistoryDto>,
    pub nutzap_enabled: bool,
    pub updated_at: u64,
}

#[derive(Clone, Debug)]
pub struct CashuMintQuoteDto {
    pub mint_url: String,
    pub quote_id: String,
    pub request: String,
    pub amount_sats: u64,
    pub state: String,
    pub paid: bool,
    pub expiry: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct CashuSendTokenDto {
    pub token: String,
    pub mint_url: String,
    pub amount_sats: u64,
    pub memo: Option<String>,
    pub wallet_state: CashuWalletStateDto,
}

#[derive(Clone, Debug)]
pub struct CashuMeltResultDto {
    pub mint_url: String,
    pub quote_id: String,
    pub amount_sats: u64,
    pub fee_paid_sats: u64,
    pub paid: bool,
    pub preimage: Option<String>,
    pub wallet_state: CashuWalletStateDto,
}

#[derive(Clone, Debug)]
pub struct NutzapInfoDto {
    pub event_id: String,
    pub pubkey_hex: String,
    pub p2pk_pubkey_hex: String,
    pub mints: Vec<String>,
    pub relays: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct NutzapSendResultDto {
    pub event_id: String,
    pub recipient_pubkey_hex: String,
    pub mint_url: String,
    pub amount_sats: u64,
    pub wallet_state: CashuWalletStateDto,
}

#[derive(Clone, Debug)]
pub struct NutzapClaimResultDto {
    pub claimed_count: u64,
    pub claimed_sats: u64,
    pub failed_count: u64,
    pub wallet_state: CashuWalletStateDto,
}

#[derive(Clone, Debug)]
pub struct Nip60RawEventDto {
    pub event_id: String,
    pub kind: u16,
    pub created_at: u64,
    pub content: String,
}

#[derive(Clone, Debug)]
pub struct Nip60WalletDiscoveryDto {
    pub discovered_relays: Vec<String>,
    pub wallet_event: Option<Nip60RawEventDto>,
    pub nutzap_relays: Vec<String>,
    pub nutzap_mints: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Nip60DataFetchDto {
    pub token_events: Vec<Nip60RawEventDto>,
    pub history_events: Vec<Nip60RawEventDto>,
    pub deleted_event_ids: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct DecryptedNip60EventDto {
    pub event_id: String,
    pub created_at: u64,
    pub decrypted_json: String,
}

// ---------------------------------------------------------------------------
// Internal Wire & Crypto Types
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CashuProofWire {
    pub id: String,
    pub amount: u64,
    pub secret: String,
    #[serde(rename = "C", alias = "c")]
    pub c: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub witness: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CashuV3Entry {
    pub mint: String,
    pub proofs: Vec<CashuProofWire>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct CashuV3Payload {
    pub token: Vec<CashuV3Entry>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DecodedCashuToken {
    pub entries: Vec<(String, Vec<CashuProofRecord>)>,
    pub unit: String,
    pub memo: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BlindedMessageWire {
    pub amount: u64,
    pub id: String,
    #[serde(rename = "B_")]
    pub b_bar: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct BlindSignatureWire {
    pub amount: u64,
    pub id: String,
    #[serde(rename = "C_")]
    pub c_bar: String,
}

#[derive(Clone, Debug, Deserialize)]
struct KeysetsResponse {
    pub keysets: Vec<KeysetSummary>,
}

#[derive(Clone, Debug, Deserialize)]
struct KeysetSummary {
    pub id: String,
    pub unit: String,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub input_fee_ppk: u64,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Deserialize)]
struct KeysResponse {
    pub keysets: Vec<KeysetKeysWire>,
}

#[flutter_rust_bridge::frb(ignore)]
#[derive(Clone, Debug, Deserialize)]
struct KeysetKeysWire {
    id: String,
    unit: String,
    keys: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Deserialize)]
struct MintQuoteResponse {
    pub quote: String,
    pub request: String,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub paid: Option<bool>,
    #[serde(default)]
    pub expiry: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct MintTokensResponse {
    pub signatures: Vec<BlindSignatureWire>,
}

#[derive(Clone, Debug, Deserialize)]
struct MeltQuoteResponse {
    pub quote: String,
    pub amount: u64,
    pub fee_reserve: u64,
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub paid: Option<bool>,
    #[serde(default)]
    pub payment_preimage: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
struct MeltTokensResponse {
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub paid: Option<bool>,
    #[serde(default)]
    pub payment_preimage: Option<String>,
    #[serde(default)]
    pub change: Option<Vec<BlindSignatureWire>>,
}

#[derive(Clone, Debug, Deserialize)]
struct SwapResponse {
    pub signatures: Vec<BlindSignatureWire>,
}

#[derive(Clone, Debug, Deserialize)]
struct CheckStateResponse {
    pub states: Vec<ProofStateEntry>,
}

#[derive(Clone, Debug, Deserialize)]
struct ProofStateEntry {
    #[serde(rename = "Y")]
    pub y: String,
    pub state: String,
}

#[derive(Clone, Debug)]
struct ActiveMintKeyset {
    id: String,
    input_fee_ppk: u64,
    keys: BTreeMap<u64, PublicKey>,
}

#[derive(Clone, Debug)]
struct PendingBlinding {
    amount: u64,
    secret: String,
    blinding_factor: SecretKey,
}

#[derive(Clone, Debug)]
struct ProofSelection {
    selected: Vec<CashuProofRecord>,
    total_amount: u64,
    fee_sats: u64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ParsedNutzapInfo {
    pub pubkey_hex: String,
    pub p2pk_pubkey_hex: String,
    pub mints: Vec<String>,
    pub relays: Vec<String>,
}

// ---------------------------------------------------------------------------
// NUT-00 / NUT-02 Pure-Rust Cashu BDHKE Secp256k1 Primitives
// ---------------------------------------------------------------------------

/// Maps arbitrary message bytes onto a valid secp256k1 point using Cashu NUT-00 `hash_to_curve`.
pub(crate) fn hash_to_curve(message: &[u8]) -> Result<PublicKey, String> {
    let mut hasher = Sha256::new();
    hasher.update(CASHU_HASH_DOMAIN);
    hasher.update(message);
    let msg_hash: [u8; 32] = hasher.finalize().into();

    let mut compressed = [0u8; 33];
    compressed[0] = 0x02;

    for counter in 0u32..=u32::MAX {
        let mut round_hasher = Sha256::new();
        round_hasher.update(msg_hash);
        round_hasher.update(counter.to_le_bytes());
        let candidate: [u8; 32] = round_hasher.finalize().into();
        compressed[1..33].copy_from_slice(&candidate);
        if let Ok(point) = PublicKey::from_slice(&compressed) {
            return Ok(point);
        }
    }
    Err("hash_to_curve exhausted u32 counter space".to_owned())
}

/// Blinds `secret` into `(B_, r)` where `B_ = hash_to_curve(secret) + r*G`.
pub(crate) fn blind_message(
    secret: &[u8],
    blinding_factor: Option<SecretKey>,
) -> Result<(PublicKey, SecretKey), String> {
    let secp = Secp256k1::new();
    let y = hash_to_curve(secret)?;
    let r = blinding_factor.unwrap_or_else(|| SecretKey::new(&mut rand::thread_rng()));
    let r_g = PublicKey::from_secret_key(&secp, &r);
    let b_bar = y
        .combine(&r_g)
        .map_err(|e| format!("Failed to blind message point: {e}"))?;
    Ok((b_bar, r))
}

/// Unblinds mint blind signature `C_` using `r` and mint key `K`: `C = C_ - r*K`.
pub(crate) fn unblind_signature(
    c_bar: &PublicKey,
    r: &SecretKey,
    mint_pubkey: &PublicKey,
) -> Result<PublicKey, String> {
    let secp = Secp256k1::new();
    let r_k = mint_pubkey
        .mul_tweak(&secp, &Scalar::from(*r))
        .map_err(|e| format!("Failed to compute r*K during unblinding: {e}"))?;
    let neg_r_k = r_k.negate(&secp);
    c_bar
        .combine(&neg_r_k)
        .map_err(|e| format!("Failed to unblind signature point: {e}"))
}

/// Derives a Cashu NUT-02 v1 keyset ID (`"00" + hex(sha256(concat_pubkeys)[..7])`).
pub(crate) fn derive_keyset_id(keys: &BTreeMap<u64, PublicKey>) -> String {
    let mut hasher = Sha256::new();
    for pk in keys.values() {
        hasher.update(pk.serialize());
    }
    let digest: [u8; 32] = hasher.finalize().into();
    format!("00{}", bytes_to_hex(&digest[..7]))
}

fn bytes_to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{b:02x}");
    }
    out
}

fn hex_to_bytes(hex: &str) -> Result<Vec<u8>, String> {
    let trimmed = hex.trim();
    if trimmed.len() % 2 != 0 {
        return Err("Hex string must have even length".to_owned());
    }
    let mut out = Vec::with_capacity(trimmed.len() / 2);
    for chunk in trimmed.as_bytes().chunks_exact(2) {
        let s = std::str::from_utf8(chunk).map_err(|_| "Invalid UTF-8 in hex".to_owned())?;
        let byte = u8::from_str_radix(s, 16)
            .map_err(|_| format!("Invalid hex byte '{s}'"))?;
        out.push(byte);
    }
    Ok(out)
}

fn parse_compressed_pubkey(hex: &str) -> Result<PublicKey, String> {
    let bytes = hex_to_bytes(hex)?;
    PublicKey::from_slice(&bytes).map_err(|e| format!("Invalid secp256k1 pubkey: {e}"))
}

fn generate_random_secret_hex() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    bytes_to_hex(&buf)
}

/// Normalizes a 32-byte x-only or 33-byte compressed secp256k1 public key into 33-byte compressed hex.
fn normalize_p2pk_compressed_hex(raw_hex: &str) -> Result<String, String> {
    let clean = raw_hex.trim().to_ascii_lowercase();
    let bytes = hex_to_bytes(&clean)?;
    match bytes.len() {
        33 => {
            let pk = PublicKey::from_slice(&bytes)
                .map_err(|e| format!("Invalid compressed P2PK pubkey: {e}"))?;
            Ok(bytes_to_hex(&pk.serialize()))
        }
        32 => {
            let mut prefixed = [0u8; 33];
            prefixed[0] = 0x02;
            prefixed[1..].copy_from_slice(&bytes);
            let pk = PublicKey::from_slice(&prefixed)
                .map_err(|e| format!("Invalid x-only P2PK pubkey: {e}"))?;
            Ok(bytes_to_hex(&pk.serialize()))
        }
        other => Err(format!(
            "P2PK pubkey must be 32 or 33 bytes hex, got {other} bytes"
        )),
    }
}

/// Formats a Cashu NUT-11 P2PK secret locking ecash to `recipient_p2pk_compressed_hex`.
pub(crate) fn build_nut11_p2pk_secret(recipient_p2pk_hex: &str) -> Result<String, String> {
    let normalized = normalize_p2pk_compressed_hex(recipient_p2pk_hex)?;
    let nonce = generate_random_secret_hex();
    let secret = serde_json::json!(["P2PK", { "nonce": nonce, "data": normalized }]);
    Ok(secret.to_string())
}

/// Checks if a proof secret is a NUT-11 P2PK secret and attaches a BIP-340 Schnorr witness if needed.
fn sign_p2pk_proof_if_needed(
    proof: &mut CashuProofWire,
    p2pk_privkey_hex: &str,
) -> Result<(), String> {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&proof.secret) else {
        return Ok(());
    };
    let Some(arr) = parsed.as_array() else {
        return Ok(());
    };
    if arr.first().and_then(|v| v.as_str()) != Some("P2PK") {
        return Ok(());
    }
    let Some(data_hex) = arr
        .get(1)
        .and_then(|v| v.get("data"))
        .and_then(|v| v.as_str())
    else {
        return Err("Malformed NUT-11 P2PK secret missing target pubkey".to_owned());
    };

    let target_compressed = normalize_p2pk_compressed_hex(data_hex)?;
    let sk_bytes = hex_to_bytes(p2pk_privkey_hex)?;
    let sk = SecretKey::from_slice(&sk_bytes)
        .map_err(|e| format!("Invalid wallet P2PK private key: {e}"))?;
    let secp = Secp256k1::new();
    let keypair = Keypair::from_secret_key(&secp, &sk);
    let our_compressed = bytes_to_hex(&PublicKey::from_keypair(&keypair).serialize());
    let (our_xonly, _) = XOnlyPublicKey::from_keypair(&keypair);
    let target_xonly = &target_compressed[2..];

    if target_compressed != our_compressed && target_xonly != bytes_to_hex(&our_xonly.serialize()) {
        return Err("Incoming P2PK proof is locked to a different receiving key".to_owned());
    }

    let digest: [u8; 32] = Sha256::digest(proof.secret.as_bytes()).into();
    let msg = Message::from_digest(digest);
    let sig = secp.sign_schnorr(&msg, &keypair);
    let witness_json = serde_json::json!({ "signatures": [bytes_to_hex(&sig.serialize())] });
    proof.witness = Some(witness_json.to_string());
    Ok(())
}

// ---------------------------------------------------------------------------
// Token V3 (`cashuA`), Splitting, and Coin Selection
// ---------------------------------------------------------------------------

/// Encodes proofs for a single mint into a Cashu `cashuA` V3 token string.
pub(crate) fn encode_cashu_v3_token(
    mint_url: &str,
    proofs: &[CashuProofRecord],
    memo: Option<&str>,
    unit: Option<&str>,
) -> Result<String, String> {
    let clean_mint = normalize_mint_url(mint_url)?;
    if proofs.is_empty() {
        return Err("Cannot encode empty Cashu token".to_owned());
    }
    let wire_proofs: Vec<CashuProofWire> = proofs
        .iter()
        .map(|p| CashuProofWire {
            id: p.id.clone(),
            amount: p.amount,
            secret: p.secret.clone(),
            c: p.c.clone(),
            witness: None,
        })
        .collect();
    let payload = CashuV3Payload {
        token: vec![CashuV3Entry {
            mint: clean_mint,
            proofs: wire_proofs,
        }],
        unit: Some(unit.unwrap_or("sat").to_owned()),
        memo: memo.map(str::trim).filter(|m| !m.is_empty()).map(str::to_owned),
    };
    let json = serde_json::to_string(&payload)
        .map_err(|e| format!("Failed to serialize cashuA token payload: {e}"))?;
    Ok(format!("cashuA{}", URL_SAFE_NO_PAD.encode(json.as_bytes())))
}

/// Decodes a Cashu `cashuA` V3 token string into mint-grouped proof records.
pub(crate) fn decode_cashu_v3_token(token: &str) -> Result<DecodedCashuToken, String> {
    let trimmed = token.trim();
    let encoded = trimmed.strip_prefix("cashuA").ok_or_else(|| {
        if trimmed.starts_with("cashuB") {
            "Cashu V4 (cashuB) tokens are not supported yet; provide a cashuA V3 token".to_owned()
        } else {
            "Invalid Cashu token: must start with 'cashuA'".to_owned()
        }
    })?;
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .or_else(|_| URL_SAFE.decode(encoded))
        .map_err(|e| format!("Invalid cashuA base64url encoding: {e}"))?;
    let payload: CashuV3Payload = serde_json::from_slice(&bytes)
        .map_err(|e| format!("Invalid cashuA JSON payload: {e}"))?;

    if payload.token.is_empty() {
        return Err("Cashu token contains no mint entries".to_owned());
    }
    let unit = payload.unit.unwrap_or_else(|| "sat".to_owned());
    if unit != "sat" {
        return Err(format!("Unsupported Cashu token unit '{unit}' (expected 'sat')"));
    }

    let mut entries = Vec::with_capacity(payload.token.len());
    for entry in payload.token {
        let mint_url = normalize_mint_url(&entry.mint)?;
        if entry.proofs.is_empty() {
            return Err(format!("Cashu token entry for {mint_url} has no proofs"));
        }
        let records = entry
            .proofs
            .into_iter()
            .map(|p| CashuProofRecord {
                id: p.id,
                amount: p.amount,
                secret: p.secret,
                c: p.c,
                mint_url: mint_url.clone(),
                token_event_id: None,
            })
            .collect();
        entries.push((mint_url, records));
    }

    Ok(DecodedCashuToken {
        entries,
        unit,
        memo: payload.memo,
    })
}

/// Decomposes `amount` into ascending powers of two (e.g., `13 -> [1, 4, 8]`).
pub(crate) fn split_amount_powers_of_two(amount: u64) -> Vec<u64> {
    let mut parts = Vec::new();
    for bit in 0..64 {
        let denom = 1u64 << bit;
        if (amount & denom) != 0 {
            parts.push(denom);
        }
    }
    parts
}

/// Splits `amount` using denominations supported by the active mint keyset.
pub(crate) fn split_amount_for_keyset(
    amount: u64,
    available_amounts: &[u64],
) -> Result<Vec<u64>, String> {
    if amount == 0 {
        return Ok(Vec::new());
    }
    let mut denoms: Vec<u64> = available_amounts.iter().copied().filter(|&a| a > 0).collect();
    denoms.sort_unstable();
    denoms.dedup();
    if denoms.is_empty() {
        return Err("Mint keyset contains no valid denominations".to_owned());
    }

    // Fast path when all binary powers needed by `amount` exist in `denoms`.
    let pow2 = split_amount_powers_of_two(amount);
    if pow2.iter().all(|d| denoms.binary_search(d).is_ok()) {
        return Ok(pow2);
    }

    // Fallback greedy decomposition descending over available denominations.
    let mut remaining = amount;
    let mut out = Vec::new();
    for &denom in denoms.iter().rev() {
        while remaining >= denom {
            out.push(denom);
            remaining -= denom;
        }
    }
    if remaining != 0 {
        return Err(format!(
            "Mint keyset cannot represent amount {amount} sats cleanly"
        ));
    }
    out.sort_unstable();
    Ok(out)
}

fn compute_input_fee_sats(proof_count: usize, input_fee_ppk: u64) -> u64 {
    if input_fee_ppk == 0 || proof_count == 0 {
        return 0;
    }
    let total_ppk = (proof_count as u64).saturating_mul(input_fee_ppk);
    (total_ppk.saturating_add(999)) / 1000
}

/// Greedily selects proofs from `mint_proofs` to cover `target_amount` plus any `input_fee_ppk`.
fn select_proofs_for_amount(
    mint_proofs: &[CashuProofRecord],
    target_amount: u64,
    input_fee_ppk: u64,
) -> Result<ProofSelection, String> {
    if target_amount == 0 {
        return Err("Target Cashu amount must be greater than zero".to_owned());
    }
    let total_available: u64 = mint_proofs
        .iter()
        .fold(0u64, |acc, p| acc.saturating_add(p.amount));
    if total_available < target_amount {
        return Err(format!(
            "Insufficient Cashu balance: need {target_amount} sats, have {total_available} sats"
        ));
    }

    // Check for an exact single-proof match when zero fee or single proof covers fee.
    if let Some(exact) = mint_proofs.iter().find(|p| {
        let fee = compute_input_fee_sats(1, input_fee_ppk);
        p.amount == target_amount.saturating_add(fee)
    }) {
        let fee = compute_input_fee_sats(1, input_fee_ppk);
        return Ok(ProofSelection {
            selected: vec![exact.clone()],
            total_amount: exact.amount,
            fee_sats: fee,
        });
    }

    let mut ascending = mint_proofs.to_vec();
    ascending.sort_by_key(|p| p.amount);

    // Check smallest single proof >= target + fee(1) as an overshoot-minimizing upper bound.
    let single_candidate = ascending.iter().find(|p| {
        let fee = compute_input_fee_sats(1, input_fee_ppk);
        p.amount >= target_amount.saturating_add(fee)
    });

    // Greedy descending for <= remaining, then smallest ascending for any remainder.
    let mut remaining_pool = ascending.clone();
    let mut chosen = Vec::new();
    let mut chosen_sum = 0u64;

    loop {
        let fee = compute_input_fee_sats(chosen.len(), input_fee_ppk);
        let needed = target_amount.saturating_add(fee);
        if chosen_sum >= needed && !chosen.is_empty() {
            break;
        }
        let deficit = needed.saturating_sub(chosen_sum);
        if remaining_pool.is_empty() {
            return Err(format!(
                "Insufficient Cashu balance after fees: need {needed} sats, have {chosen_sum} sats"
            ));
        }
        // Pick largest proof <= deficit if available, else smallest proof >= deficit (or largest overall).
        let pick_idx = if let Some(idx) = remaining_pool
            .iter()
            .rposition(|p| p.amount <= deficit)
        {
            idx
        } else if let Some(idx) = remaining_pool
            .iter()
            .position(|p| p.amount >= deficit)
        {
            idx
        } else {
            remaining_pool.len() - 1
        };
        let picked = remaining_pool.remove(pick_idx);
        chosen_sum = chosen_sum.saturating_add(picked.amount);
        chosen.push(picked);
    }

    let greedy_fee = compute_input_fee_sats(chosen.len(), input_fee_ppk);
    if let Some(single) = single_candidate {
        let single_fee = compute_input_fee_sats(1, input_fee_ppk);
        let single_overshoot = single.amount.saturating_sub(target_amount + single_fee);
        let greedy_overshoot = chosen_sum.saturating_sub(target_amount + greedy_fee);
        if single_overshoot < greedy_overshoot
            || (single_overshoot == greedy_overshoot && chosen.len() > 1)
        {
            return Ok(ProofSelection {
                selected: vec![single.clone()],
                total_amount: single.amount,
                fee_sats: single_fee,
            });
        }
    }

    Ok(ProofSelection {
        selected: chosen,
        total_amount: chosen_sum,
        fee_sats: greedy_fee,
    })
}

// ---------------------------------------------------------------------------
// Mint HTTP Client Helpers (`reqwest`)
// ---------------------------------------------------------------------------

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed to construct HTTP client: {e}"))
}

fn normalize_mint_url(raw: &str) -> Result<String, String> {
    let clean = raw.trim().trim_end_matches('/').to_owned();
    if clean.starts_with("https://") || clean.starts_with("http://") {
        Ok(clean)
    } else {
        Err(format!("Invalid Cashu mint URL '{raw}': must use https:// or http://"))
    }
}

async fn fetch_keysets(
    http: &reqwest::Client,
    mint_url: &str,
) -> Result<Vec<KeysetSummary>, String> {
    let url = format!("{mint_url}/v1/keysets");
    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to query mint keysets {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Mint {url} returned HTTP {}", resp.status()));
    }
    let parsed: KeysetsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid keysets JSON from {url}: {e}"))?;
    Ok(parsed.keysets)
}

async fn fetch_keys_for_id(
    http: &reqwest::Client,
    mint_url: &str,
    keyset_id: &str,
) -> Result<BTreeMap<u64, PublicKey>, String> {
    let url = format!("{mint_url}/v1/keys/{keyset_id}");
    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to query mint keys {url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Mint {url} returned HTTP {}", resp.status()));
    }
    let parsed: KeysResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid keys JSON from {url}: {e}"))?;
    let entry = parsed
        .keysets
        .into_iter()
        .find(|k| k.id == keyset_id)
        .ok_or_else(|| format!("Mint {url} did not return keyset '{keyset_id}'"))?;
    if entry.unit != "sat" {
        return Err(format!(
            "Mint keyset '{keyset_id}' has unsupported unit '{}'",
            entry.unit
        ));
    }

    let mut keys = BTreeMap::new();
    for (amt_str, pk_hex) in entry.keys {
        let amt = amt_str
            .parse::<u64>()
            .map_err(|_| format!("Invalid keyset amount '{amt_str}'"))?;
        let pk = parse_compressed_pubkey(&pk_hex)?;
        keys.insert(amt, pk);
    }
    if keyset_id.starts_with("00") && keyset_id.len() == 16 {
        let derived = derive_keyset_id(&keys);
        if derived != keyset_id {
            return Err(format!(
                "Mint keyset ID mismatch for {keyset_id}: derived {derived}"
            ));
        }
    }
    Ok(keys)
}

async fn fetch_active_sat_keyset(
    http: &reqwest::Client,
    mint_url: &str,
) -> Result<ActiveMintKeyset, String> {
    let keysets = fetch_keysets(http, mint_url).await?;
    let chosen = keysets
        .into_iter()
        .find(|k| k.active && k.unit == "sat")
        .ok_or_else(|| format!("Mint {mint_url} has no active 'sat' keyset"))?;
    let keys = fetch_keys_for_id(http, mint_url, &chosen.id).await?;
    Ok(ActiveMintKeyset {
        id: chosen.id,
        input_fee_ppk: chosen.input_fee_ppk,
        keys,
    })
}

async fn post_mint_quote_bolt11(
    http: &reqwest::Client,
    mint_url: &str,
    amount_sats: u64,
) -> Result<MintQuoteResponse, String> {
    let url = format!("{mint_url}/v1/mint/quote/bolt11");
    let body = serde_json::json!({ "amount": amount_sats, "unit": "sat" });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to request mint quote from {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Mint quote error at {url}: {err_text}"));
    }
    resp.json::<MintQuoteResponse>()
        .await
        .map_err(|e| format!("Invalid mint quote JSON from {url}: {e}"))
}

async fn get_mint_quote_bolt11(
    http: &reqwest::Client,
    mint_url: &str,
    quote_id: &str,
) -> Result<MintQuoteResponse, String> {
    let url = format!("{mint_url}/v1/mint/quote/bolt11/{quote_id}");
    let resp = http
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to check mint quote at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Mint quote status error at {url}: {err_text}"));
    }
    resp.json::<MintQuoteResponse>()
        .await
        .map_err(|e| format!("Invalid mint quote status JSON from {url}: {e}"))
}

fn is_quote_paid(state: Option<&str>, paid: Option<bool>) -> bool {
    if paid == Some(true) {
        return true;
    }
    matches!(
        state.map(|s| s.to_ascii_uppercase()).as_deref(),
        Some("PAID") | Some("ISSUED")
    )
}

fn prepare_blinded_outputs(
    amounts: &[u64],
    keyset_id: &str,
    p2pk_target_pubkey: Option<&str>,
) -> Result<(Vec<BlindedMessageWire>, Vec<PendingBlinding>), String> {
    let mut outputs = Vec::with_capacity(amounts.len());
    let mut blindings = Vec::with_capacity(amounts.len());

    for &amount in amounts {
        let secret = match p2pk_target_pubkey {
            Some(pk) => build_nut11_p2pk_secret(pk)?,
            None => generate_random_secret_hex(),
        };
        let (b_bar, r) = blind_message(secret.as_bytes(), None)?;
        outputs.push(BlindedMessageWire {
            amount,
            id: keyset_id.to_owned(),
            b_bar: bytes_to_hex(&b_bar.serialize()),
        });
        blindings.push(PendingBlinding {
            amount,
            secret,
            blinding_factor: r,
        });
    }
    Ok((outputs, blindings))
}

fn unblind_signatures_to_proofs(
    signatures: &[BlindSignatureWire],
    blindings: &[PendingBlinding],
    keys: &BTreeMap<u64, PublicKey>,
    mint_url: &str,
) -> Result<Vec<CashuProofRecord>, String> {
    if signatures.len() != blindings.len() {
        return Err(format!(
            "Mint returned {} signatures for {} blinded outputs",
            signatures.len(),
            blindings.len()
        ));
    }
    let mut proofs = Vec::with_capacity(signatures.len());
    for (sig, blinding) in signatures.iter().zip(blindings.iter()) {
        let amt = if sig.amount > 0 { sig.amount } else { blinding.amount };
        let mint_pk = keys
            .get(&amt)
            .ok_or_else(|| format!("Missing mint public key for amount {amt}"))?;
        let c_bar = parse_compressed_pubkey(&sig.c_bar)?;
        let c_point = unblind_signature(&c_bar, &blinding.blinding_factor, mint_pk)?;
        proofs.push(CashuProofRecord {
            id: sig.id.clone(),
            amount: amt,
            secret: blinding.secret.clone(),
            c: bytes_to_hex(&c_point.serialize()),
            mint_url: mint_url.to_owned(),
            token_event_id: None,
        });
    }
    Ok(proofs)
}

async fn post_mint_bolt11(
    http: &reqwest::Client,
    mint_url: &str,
    quote_id: &str,
    outputs: &[BlindedMessageWire],
) -> Result<Vec<BlindSignatureWire>, String> {
    let url = format!("{mint_url}/v1/mint/bolt11");
    let body = serde_json::json!({ "quote": quote_id, "outputs": outputs });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to mint tokens at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Minting failed at {url}: {err_text}"));
    }
    let parsed: MintTokensResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid mint response JSON from {url}: {e}"))?;
    Ok(parsed.signatures)
}

async fn post_melt_quote_bolt11(
    http: &reqwest::Client,
    mint_url: &str,
    bolt11: &str,
) -> Result<MeltQuoteResponse, String> {
    let url = format!("{mint_url}/v1/melt/quote/bolt11");
    let body = serde_json::json!({ "request": bolt11.trim(), "unit": "sat" });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to request melt quote at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Melt quote failed at {url}: {err_text}"));
    }
    resp.json::<MeltQuoteResponse>()
        .await
        .map_err(|e| format!("Invalid melt quote JSON from {url}: {e}"))
}

async fn post_melt_bolt11(
    http: &reqwest::Client,
    mint_url: &str,
    quote_id: &str,
    inputs: &[CashuProofWire],
    outputs: &[BlindedMessageWire],
) -> Result<MeltTokensResponse, String> {
    let url = format!("{mint_url}/v1/melt/bolt11");
    let body = serde_json::json!({
        "quote": quote_id,
        "inputs": inputs,
        "outputs": outputs,
    });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to melt tokens at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Melt failed at {url}: {err_text}"));
    }
    resp.json::<MeltTokensResponse>()
        .await
        .map_err(|e| format!("Invalid melt response JSON from {url}: {e}"))
}

async fn post_swap(
    http: &reqwest::Client,
    mint_url: &str,
    inputs: &[CashuProofWire],
    outputs: &[BlindedMessageWire],
) -> Result<Vec<BlindSignatureWire>, String> {
    let url = format!("{mint_url}/v1/swap");
    let body = serde_json::json!({ "inputs": inputs, "outputs": outputs });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to swap proofs at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Swap failed at {url}: {err_text}"));
    }
    let parsed: SwapResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid swap response JSON from {url}: {e}"))?;
    Ok(parsed.signatures)
}

async fn post_checkstate(
    http: &reqwest::Client,
    mint_url: &str,
    secrets: &[String],
) -> Result<Vec<ProofStateEntry>, String> {
    let mut ys = Vec::with_capacity(secrets.len());
    for secret in secrets {
        let y = hash_to_curve(secret.as_bytes())?;
        ys.push(bytes_to_hex(&y.serialize()));
    }
    let url = format!("{mint_url}/v1/checkstate");
    let body = serde_json::json!({ "Ys": ys });
    let resp = http
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to check proof states at {url}: {e}"))?;
    if !resp.status().is_success() {
        let err_text = resp.text().await.unwrap_or_default();
        return Err(format!("Checkstate failed at {url}: {err_text}"));
    }
    let parsed: CheckStateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid checkstate JSON from {url}: {e}"))?;
    Ok(parsed.states)
}

// ---------------------------------------------------------------------------
// NIP-60 & NIP-61 Event Builders / Parsers
// ---------------------------------------------------------------------------

#[flutter_rust_bridge::frb(ignore)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Nip60ProofSerde {
    pub id: String,
    pub amount: u64,
    pub secret: String,
    #[serde(rename = "C", alias = "c")]
    pub c: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub witness: Option<String>,
}

#[flutter_rust_bridge::frb(ignore)]
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Nip60TokenContent {
    pub mint: String,
    pub proofs: Vec<Nip60ProofSerde>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub del: Vec<String>,
}

#[flutter_rust_bridge::frb(ignore)]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct ParsedNip60WalletContent {
    pub privkey: Option<String>,
    pub mints: Vec<String>,
    pub relays: Vec<String>,
}

#[flutter_rust_bridge::frb(ignore)]
#[derive(Clone, Debug, PartialEq, Eq)]
struct ParsedNip60HistoryContent {
    pub direction: Option<String>,
    pub amount_sats: Option<u64>,
    pub unit: String,
    pub created: Vec<String>,
    pub destroyed: Vec<String>,
    pub redeemed: Vec<String>,
}

/// Parses decrypted NIP-60 `kind 17375` JSON (`Vec<Vec<String>>`), tolerating optional/extra tags.
fn parse_nip60_wallet_content(decrypted_json: &str) -> Result<ParsedNip60WalletContent, String> {
    let tags: Vec<Vec<String>> = serde_json::from_str(decrypted_json)
        .map_err(|e| format!("Invalid NIP-60 wallet content JSON: {e}"))?;
    let mut out = ParsedNip60WalletContent::default();
    for item in tags {
        if item.len() < 2 {
            continue;
        }
        match item[0].as_str() {
            "privkey" => {
                let trimmed = item[1].trim();
                if !trimmed.is_empty() && out.privkey.is_none() {
                    out.privkey = Some(trimmed.to_owned());
                }
            }
            "mint" => {
                if let Ok(clean) = normalize_mint_url(&item[1]) {
                    if !out.mints.contains(&clean) {
                        out.mints.push(clean);
                    }
                }
            }
            "relay" => {
                let clean = item[1].trim().to_owned();
                if (clean.starts_with("wss://") || clean.starts_with("ws://"))
                    && !out.relays.contains(&clean)
                {
                    out.relays.push(clean);
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

/// Parses decrypted NIP-60 `kind 7376` spending history JSON (`Vec<Vec<String>>`).
fn parse_nip60_history_content(decrypted_json: &str) -> Result<ParsedNip60HistoryContent, String> {
    let tags: Vec<Vec<String>> = serde_json::from_str(decrypted_json)
        .map_err(|e| format!("Invalid NIP-60 history content JSON: {e}"))?;
    let mut out = ParsedNip60HistoryContent {
        direction: None,
        amount_sats: None,
        unit: "sat".to_owned(),
        created: Vec::new(),
        destroyed: Vec::new(),
        redeemed: Vec::new(),
    };
    for item in tags {
        if item.len() < 2 {
            continue;
        }
        match item[0].as_str() {
            "direction" => {
                let dir = item[1].trim().to_ascii_lowercase();
                if dir == "in" || dir == "out" {
                    out.direction = Some(dir);
                }
            }
            "amount" => {
                if let Ok(amt) = item[1].trim().parse::<u64>() {
                    out.amount_sats = Some(amt);
                }
            }
            "unit" => {
                let u = item[1].trim();
                if !u.is_empty() {
                    out.unit = u.to_owned();
                }
            }
            "e" => {
                let ev_id = item[1].trim().to_ascii_lowercase();
                if ev_id.is_empty() {
                    continue;
                }
                let marker = item
                    .get(3)
                    .map(String::as_str)
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .or_else(|| {
                        item.get(2)
                            .map(String::as_str)
                            .map(str::trim)
                            .filter(|s| matches!(*s, "created" | "destroyed" | "redeemed"))
                    });
                match marker {
                    Some("created") => out.created.push(ev_id),
                    Some("destroyed") => out.destroyed.push(ev_id),
                    Some("redeemed") => out.redeemed.push(ev_id),
                    _ => {}
                }
            }
            _ => {}
        }
    }
    Ok(out)
}

/// Builds a NIP-60 `kind 17375` Wallet metadata EventBuilder (NIP-44 v2 encrypted to self).
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn build_nip60_wallet_event(
    keys: &Keys,
    p2pk_privkey_hex: &str,
    mints: &[String],
    relays: &[String],
) -> Result<EventBuilder, String> {
    let mut wallet_data: Vec<Vec<String>> = Vec::new();
    let clean_privkey = p2pk_privkey_hex.trim();
    if !clean_privkey.is_empty() {
        wallet_data.push(vec!["privkey".to_owned(), clean_privkey.to_owned()]);
    }
    let mut seen_mints = BTreeSet::new();
    for m in mints {
        if let Ok(clean) = normalize_mint_url(m) {
            if seen_mints.insert(clean.clone()) {
                wallet_data.push(vec!["mint".to_owned(), clean]);
            }
        }
    }
    if seen_mints.is_empty() {
        return Err("At least one valid mint URL is required for NIP-60 wallet event".to_owned());
    }
    let mut seen_relays = BTreeSet::new();
    for r in relays {
        let clean = r.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://"))
            && seen_relays.insert(clean.clone())
        {
            wallet_data.push(vec!["relay".to_owned(), clean]);
        }
    }
    let json = serde_json::to_string(&wallet_data)
        .map_err(|e| format!("Failed to serialize NIP-60 wallet event: {e}"))?;
    let content = nip44::encrypt(
        keys.secret_key(),
        &keys.public_key(),
        json,
        nip44::Version::V2,
    )
    .map_err(|e| format!("Failed to encrypt NIP-60 wallet event: {e}"))?;
    Ok(EventBuilder::new(Kind::CashuWallet, content))
}

/// Builds a NIP-60 `kind 7375` unspent proof TokenEvent EventBuilder (NIP-44 v2 encrypted to self).
pub(crate) fn build_nip60_token_event(
    keys: &Keys,
    mint_url: &str,
    proofs: &[CashuProofRecord],
    destroyed_event_ids: &[String],
) -> Result<EventBuilder, String> {
    let clean_mint = normalize_mint_url(mint_url)?;
    let nip60_proofs: Vec<Nip60ProofSerde> = proofs
        .iter()
        .map(|p| Nip60ProofSerde {
            id: p.id.clone(),
            amount: p.amount,
            secret: p.secret.clone(),
            c: p.c.clone(),
            witness: None,
        })
        .collect();
    let token_content = Nip60TokenContent {
        mint: clean_mint,
        proofs: nip60_proofs,
        unit: Some("sat".to_owned()),
        del: destroyed_event_ids.to_vec(),
    };
    let json = serde_json::to_string(&token_content)
        .map_err(|e| format!("Failed to serialize NIP-60 token event: {e}"))?;
    let content = nip44::encrypt(
        keys.secret_key(),
        &keys.public_key(),
        json,
        nip44::Version::V2,
    )
    .map_err(|e| format!("Failed to encrypt NIP-60 token event: {e}"))?;
    Ok(EventBuilder::new(Kind::CashuWalletUnspentProof, content))
}

/// Builds a NIP-60 `kind 7376` spending history EventBuilder (NIP-44 encrypted to self).
pub(crate) fn build_nip60_history_event(
    keys: &Keys,
    direction: TransactionDirection,
    amount_sats: u64,
    created_ids: &[EventId],
    destroyed_ids: &[EventId],
    redeemed_ids: &[EventId],
) -> Result<EventBuilder, String> {
    let mut hist = SpendingHistory::new(direction, amount_sats);
    for id in created_ids {
        hist = hist.add_created(*id);
    }
    for id in destroyed_ids {
        hist = hist.add_destroyed(*id);
    }
    for id in redeemed_ids {
        hist = hist.add_redeemed(*id);
    }
    hist.to_event_builder(keys.secret_key(), &keys.public_key())
        .map_err(|e| format!("Failed to encrypt NIP-60 history event: {e}"))
}

/// Builds a NIP-61 `kind 10019` Nutzap Info EventBuilder.
pub(crate) fn build_nip61_nutzap_info_event(
    p2pk_pubkey_hex: &str,
    mints: &[String],
    relays: &[String],
) -> Result<EventBuilder, String> {
    let clean_pk = normalize_p2pk_compressed_hex(p2pk_pubkey_hex)?;
    if mints.is_empty() {
        return Err("At least one mint URL is required for NIP-61 Nutzap info".to_owned());
    }
    let mut tags = Vec::new();
    for relay in relays {
        let clean_relay = relay.trim();
        if clean_relay.starts_with("wss://") || clean_relay.starts_with("ws://") {
            tags.push(Tag::custom(
                nostr::TagKind::Custom("relay".into()),
                [clean_relay.to_owned()],
            ));
        }
    }
    for mint in mints {
        let clean_mint = normalize_mint_url(mint)?;
        tags.push(Tag::custom(
            nostr::TagKind::Custom("mint".into()),
            [clean_mint, "sat".to_owned()],
        ));
    }
    tags.push(Tag::custom(
        nostr::TagKind::Custom("pubkey".into()),
        [clean_pk],
    ));

    Ok(EventBuilder::new(Kind::CashuNutZapInfo, "").tags(tags))
}

/// Parses a NIP-61 `kind 10019` Nutzap Info event.
pub(crate) fn parse_nip61_nutzap_info_event(event: &Event) -> Result<ParsedNutzapInfo, String> {
    if event.kind != Kind::CashuNutZapInfo {
        return Err(format!("Expected kind 10019, got {}", event.kind.as_u16()));
    }
    let mut p2pk_pubkey_hex: Option<String> = None;
    let mut mints = Vec::new();
    let mut relays = Vec::new();

    for tag in event.tags.iter() {
        let s = tag.as_slice();
        match s.first().map(String::as_str) {
            Some("pubkey") => {
                if let Some(pk) = s.get(1) {
                    p2pk_pubkey_hex = Some(normalize_p2pk_compressed_hex(pk)?);
                }
            }
            Some("mint") => {
                if let Some(mint) = s.get(1) {
                    if let Ok(clean) = normalize_mint_url(mint) {
                        if !mints.contains(&clean) {
                            mints.push(clean);
                        }
                    }
                }
            }
            Some("relay") => {
                if let Some(relay) = s.get(1) {
                    let clean = relay.trim().to_owned();
                    if (clean.starts_with("wss://") || clean.starts_with("ws://"))
                        && !relays.contains(&clean)
                    {
                        relays.push(clean);
                    }
                }
            }
            _ => {}
        }
    }

    let p2pk_pubkey_hex = p2pk_pubkey_hex
        .ok_or_else(|| "NIP-61 Nutzap info event is missing 'pubkey' tag".to_owned())?;
    Ok(ParsedNutzapInfo {
        pubkey_hex: event.pubkey.to_hex(),
        p2pk_pubkey_hex,
        mints,
        relays,
    })
}

/// Builds a NIP-61 `kind 9321` Nutzap EventBuilder.
pub(crate) fn build_nip61_nutzap_event(
    recipient_pubkey_hex: &str,
    mint_url: &str,
    proofs: &[CashuProofRecord],
    comment: Option<&str>,
    target_event_id: Option<&str>,
) -> Result<EventBuilder, String> {
    let recipient_pk = NostrPublicKey::from_hex(recipient_pubkey_hex.trim())
        .map_err(|e| format!("Invalid recipient pubkey: {e}"))?;
    let clean_mint = normalize_mint_url(mint_url)?;
    if proofs.is_empty() {
        return Err("Cannot send empty Nutzap without proofs".to_owned());
    }

    let mut tags = Vec::new();
    for proof in proofs {
        let wire = CashuProofWire {
            id: proof.id.clone(),
            amount: proof.amount,
            secret: proof.secret.clone(),
            c: proof.c.clone(),
            witness: None,
        };
        let proof_json = serde_json::to_string(&wire)
            .map_err(|e| format!("Failed to serialize Nutzap proof: {e}"))?;
        tags.push(Tag::custom(
            nostr::TagKind::Custom("proof".into()),
            [proof_json],
        ));
    }
    tags.push(Tag::custom(
        nostr::TagKind::Custom("u".into()),
        [clean_mint],
    ));
    tags.push(Tag::custom(
        nostr::TagKind::Custom("unit".into()),
        ["sat".to_owned()],
    ));
    tags.push(Tag::public_key(recipient_pk));

    if let Some(ev_id_hex) = target_event_id.map(str::trim).filter(|s| !s.is_empty()) {
        let ev_id =
            EventId::from_hex(ev_id_hex).map_err(|e| format!("Invalid target event id: {e}"))?;
        tags.push(Tag::event(ev_id));
    }

    Ok(EventBuilder::new(Kind::CashuNutZap, comment.unwrap_or("").trim()).tags(tags))
}

fn parse_nip61_nutzap_event(event: &Event) -> Result<(String, Vec<CashuProofRecord>), String> {
    if event.kind != Kind::CashuNutZap {
        return Err(format!("Expected kind 9321, got {}", event.kind.as_u16()));
    }
    let mut mint_url: Option<String> = None;
    let mut proofs = Vec::new();

    for tag in event.tags.iter() {
        let s = tag.as_slice();
        match s.first().map(String::as_str) {
            Some("u") => {
                if let Some(u) = s.get(1) {
                    mint_url = Some(normalize_mint_url(u)?);
                }
            }
            Some("proof") => {
                if let Some(raw_json) = s.get(1) {
                    let wire: CashuProofWire = serde_json::from_str(raw_json)
                        .map_err(|e| format!("Invalid Nutzap proof JSON: {e}"))?;
                    proofs.push(wire);
                }
            }
            _ => {}
        }
    }

    let mint_url = mint_url.ok_or_else(|| "Nutzap event missing 'u' mint tag".to_owned())?;
    if proofs.is_empty() {
        return Err("Nutzap event contains no 'proof' tags".to_owned());
    }
    let records = proofs
        .into_iter()
        .map(|p| CashuProofRecord {
            id: p.id,
            amount: p.amount,
            secret: p.secret,
            c: p.c,
            mint_url: mint_url.clone(),
            token_event_id: None,
        })
        .collect();
    Ok((mint_url, records))
}

// ---------------------------------------------------------------------------
// Store & DTO Helpers
// ---------------------------------------------------------------------------

fn generate_p2pk_keypair_hex() -> (String, String) {
    let secp = Secp256k1::new();
    let sk = SecretKey::new(&mut rand::thread_rng());
    let pk = PublicKey::from_secret_key(&secp, &sk);
    (
        bytes_to_hex(&sk.secret_bytes()),
        bytes_to_hex(&pk.serialize()),
    )
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn make_record_id(prefix: &str) -> String {
    let mut rand_bytes = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut rand_bytes);
    format!("{prefix}-{}-{}", current_unix_secs(), bytes_to_hex(&rand_bytes))
}

fn default_wallet_for(pubkey_hex: &str, mints: Vec<String>, relays: Vec<String>) -> PersistedCashuWallet {
    let (p2pk_privkey_hex, p2pk_pubkey_hex) = generate_p2pk_keypair_hex();
    let clean_mints: Vec<String> = mints
        .into_iter()
        .filter_map(|m| normalize_mint_url(&m).ok())
        .collect();
    let clean_relays = normalize_relays_with_fallback(&relays);
    let default_mint = clean_mints.first().cloned();
    PersistedCashuWallet {
        pubkey_hex: pubkey_hex.trim().to_ascii_lowercase(),
        mints: clean_mints,
        relays: clean_relays,
        default_mint,
        p2pk_privkey_hex,
        p2pk_pubkey_hex,
        proofs: Vec::new(),
        pending_tokens: Vec::new(),
        history: Vec::new(),
        nutzap_enabled: false,
        updated_at: current_unix_secs(),
    }
}

fn normalize_relays_with_fallback(relays: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for r in relays {
        let clean = r.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://")) && seen.insert(clean.clone())
        {
            out.push(clean);
        }
    }
    if out.is_empty() {
        out.push(DEFAULT_RELAY.to_owned());
    }
    out
}

fn load_existing_wallet(
    database_path: &str,
    pubkey_hex: &str,
    master_key_b64: Option<&str>,
) -> Result<(CashuWalletStore, PersistedCashuWallet), String> {
    let store = CashuWalletStore::open(database_path).map_err(|e| e.to_string())?;
    let wallet = store
        .load_wallet_with_master_key(pubkey_hex, master_key_b64)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Cashu wallet is not initialized for this pubkey".to_owned())?;
    Ok((store, wallet))
}

fn save_updated_wallet(
    store: &CashuWalletStore,
    wallet: &mut PersistedCashuWallet,
    master_key_b64: Option<&str>,
) -> Result<CashuWalletStateDto, String> {
    wallet.updated_at = current_unix_secs();
    let saved = store
        .save_wallet_with_master_key(wallet, master_key_b64)
        .map_err(|e| e.to_string())?;
    Ok(wallet_to_dto(&saved))
}

fn wallet_to_dto(w: &PersistedCashuWallet) -> CashuWalletStateDto {
    let mut by_mint: BTreeMap<String, (u64, u64)> = BTreeMap::new();
    for m in &w.mints {
        by_mint.entry(m.clone()).or_insert((0, 0));
    }
    for p in &w.proofs {
        let entry = by_mint.entry(p.mint_url.clone()).or_insert((0, 0));
        entry.0 = entry.0.saturating_add(p.amount);
        entry.1 = entry.1.saturating_add(1);
    }

    let mint_balances = by_mint
        .into_iter()
        .map(|(mint_url, (balance_sats, proof_count))| CashuMintBalanceDto {
            mint_url,
            balance_sats,
            proof_count,
        })
        .collect();

    let pending_tokens = w
        .pending_tokens
        .iter()
        .map(|t| PendingCashuTokenDto {
            id: t.id.clone(),
            mint_url: t.mint_url.clone(),
            amount_sats: t.amount_sats,
            token: t.token.clone(),
            memo: t.memo.clone(),
            created_at: t.created_at,
            state: t.state.clone(),
        })
        .collect();

    let history = w
        .history
        .iter()
        .rev()
        .map(|h| CashuHistoryDto {
            id: h.id.clone(),
            direction: h.direction.clone(),
            amount_sats: h.amount_sats,
            mint_url: h.mint_url.clone(),
            unit: h.unit.clone(),
            memo: h.memo.clone(),
            event_id: h.event_id.clone(),
            counterparty_pubkey: h.counterparty_pubkey.clone(),
            created_at: h.created_at,
        })
        .collect();

    CashuWalletStateDto {
        pubkey_hex: w.pubkey_hex.clone(),
        mints: w.mints.clone(),
        relays: w.relays.clone(),
        default_mint: w.default_mint.clone(),
        p2pk_pubkey_hex: w.p2pk_pubkey_hex.clone(),
        balance_sats: w.total_balance_sats(),
        mint_balances,
        proof_count: w.proofs.len() as u64,
        pending_tokens,
        history,
        nutzap_enabled: w.nutzap_enabled,
        updated_at: w.updated_at,
    }
}

fn resolve_target_mint(
    wallet: &PersistedCashuWallet,
    mint_url: Option<String>,
) -> Result<String, String> {
    if let Some(raw) = mint_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        return normalize_mint_url(raw);
    }
    wallet
        .default_mint
        .clone()
        .or_else(|| wallet.mints.first().cloned())
        .ok_or_else(|| "No Cashu mint configured in wallet".to_owned())
}

fn remove_spent_proofs(wallet: &mut PersistedCashuWallet, spent: &[CashuProofRecord]) {
    let spent_secrets: HashSet<(&str, &str)> = spent
        .iter()
        .map(|p| (p.mint_url.as_str(), p.secret.as_str()))
        .collect();
    let owned: Vec<CashuProofRecord> = std::mem::take(&mut wallet.proofs);
    wallet.proofs = owned
        .into_iter()
        .filter(|p| !spent_secrets.contains(&(p.mint_url.as_str(), p.secret.as_str())))
        .collect();
}

fn merge_unique_proofs(wallet: &mut PersistedCashuWallet, new_proofs: Vec<CashuProofRecord>) -> usize {
    let mut existing: HashSet<(String, String)> = wallet
        .proofs
        .iter()
        .map(|p| (p.mint_url.clone(), p.secret.clone()))
        .collect();
    let mut added = 0usize;
    for proof in new_proofs {
        if existing.insert((proof.mint_url.clone(), proof.secret.clone())) {
            wallet.proofs.push(proof);
            added += 1;
        }
    }
    added
}

fn proofs_to_wire(
    proofs: &[CashuProofRecord],
    p2pk_privkey_hex: Option<&str>,
) -> Result<Vec<CashuProofWire>, String> {
    let mut out = Vec::with_capacity(proofs.len());
    for p in proofs {
        let mut wire = CashuProofWire {
            id: p.id.clone(),
            amount: p.amount,
            secret: p.secret.clone(),
            c: p.c.clone(),
            witness: None,
        };
        if let Some(privkey) = p2pk_privkey_hex {
            sign_p2pk_proof_if_needed(&mut wire, privkey)?;
        }
        out.push(wire);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Public FRB FFI Functions
// ---------------------------------------------------------------------------

/// Loads the persisted Cashu wallet state (or initializes an empty in-memory view if not created yet).
pub fn load_cashu_wallet_state(
    database_path: String,
    pubkey_hex: String,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let store = CashuWalletStore::open(database_path).map_err(|e| e.to_string())?;
    let loaded = store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?;
    match loaded {
        Some(w) => Ok(wallet_to_dto(&w)),
        None => {
            let clean_pk = pubkey_hex.trim().to_ascii_lowercase();
            Ok(CashuWalletStateDto {
                pubkey_hex: clean_pk,
                mints: Vec::new(),
                relays: vec![DEFAULT_RELAY.to_owned()],
                default_mint: None,
                p2pk_pubkey_hex: String::new(),
                balance_sats: 0,
                mint_balances: Vec::new(),
                proof_count: 0,
                pending_tokens: Vec::new(),
                history: Vec::new(),
                nutzap_enabled: false,
                updated_at: 0,
            })
        }
    }
}

/// Initializes a Cashu wallet for `pubkey_hex` with a fresh P2PK keypair (or updates mints/relays if present).
pub fn init_cashu_wallet(
    database_path: String,
    pubkey_hex: String,
    mints: Vec<String>,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let store = CashuWalletStore::open(database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(mut existing) => {
            for raw in mints {
                if let Ok(clean) = normalize_mint_url(&raw) {
                    if !existing.mints.contains(&clean) {
                        existing.mints.push(clean);
                    }
                }
            }
            if !relays.is_empty() {
                existing.relays = normalize_relays_with_fallback(&relays);
            }
            if existing.default_mint.is_none() {
                existing.default_mint = existing.mints.first().cloned();
            }
            if existing.p2pk_privkey_hex.is_empty() || existing.p2pk_pubkey_hex.is_empty() {
                let (sk, pk) = generate_p2pk_keypair_hex();
                existing.p2pk_privkey_hex = sk;
                existing.p2pk_pubkey_hex = pk;
            }
            existing
        }
        None => default_wallet_for(&pubkey_hex, mints, relays),
    };

    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Adds a Cashu mint URL to the wallet and sets it as default if none is configured.
pub fn add_cashu_mint(
    database_path: String,
    pubkey_hex: String,
    mint_url: String,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let clean_mint = normalize_mint_url(&mint_url)?;
    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&pubkey_hex, Vec::new(), Vec::new()),
    };

    if !wallet.mints.contains(&clean_mint) {
        wallet.mints.push(clean_mint.clone());
    }
    if wallet.default_mint.is_none() {
        wallet.default_mint = Some(clean_mint);
    }
    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Removes a Cashu mint URL from the wallet (refusing if unspent proofs remain on that mint).
pub fn remove_cashu_mint(
    database_path: String,
    pubkey_hex: String,
    mint_url: String,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let clean_mint = normalize_mint_url(&mint_url)?;
    let (store, mut wallet) =
        load_existing_wallet(&database_path, &pubkey_hex, master_key_b64.as_deref())?;

    let remaining_balance = wallet.balance_for_mint_sats(&clean_mint);
    if remaining_balance > 0 {
        return Err(format!(
            "Cannot remove mint {clean_mint} while {remaining_balance} sats of proofs remain"
        ));
    }

    wallet.mints.retain(|m| m != &clean_mint);
    if wallet.default_mint.as_deref() == Some(clean_mint.as_str()) {
        wallet.default_mint = wallet.mints.first().cloned();
    }
    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Requests a BOLT-11 mint quote (`POST /v1/mint/quote/bolt11`) for `amount_sats`.
pub async fn request_cashu_mint_quote(
    database_path: String,
    pubkey_hex: String,
    mint_url: Option<String>,
    amount_sats: u64,
    master_key_b64: Option<String>,
) -> Result<CashuMintQuoteDto, String> {
    if amount_sats == 0 {
        return Err("Mint quote amount must be greater than zero".to_owned());
    }
    let (_, wallet) =
        load_existing_wallet(&database_path, &pubkey_hex, master_key_b64.as_deref())?;
    let target_mint = resolve_target_mint(&wallet, mint_url)?;
    let http = build_http_client()?;
    let quote = post_mint_quote_bolt11(&http, &target_mint, amount_sats).await?;
    let paid = is_quote_paid(quote.state.as_deref(), quote.paid);
    let state = quote
        .state
        .unwrap_or_else(|| if paid { "PAID" } else { "UNPAID" }.to_owned());

    Ok(CashuMintQuoteDto {
        mint_url: target_mint,
        quote_id: quote.quote,
        request: quote.request,
        amount_sats,
        state,
        paid,
        expiry: quote.expiry,
    })
}

/// Claims a paid BOLT-11 mint quote by generating blinded outputs, minting, and unblinding proofs.
pub async fn claim_cashu_mint_quote(
    database_path: String,
    pubkey_hex: String,
    mint_url: String,
    quote_id: String,
    amount_sats: u64,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    if amount_sats == 0 {
        return Err("Mint amount must be greater than zero".to_owned());
    }
    let clean_mint = normalize_mint_url(&mint_url)?;
    let (store, mut wallet) =
        load_existing_wallet(&database_path, &pubkey_hex, master_key_b64.as_deref())?;
    let http = build_http_client()?;

    let status = get_mint_quote_bolt11(&http, &clean_mint, quote_id.trim()).await?;
    if !is_quote_paid(status.state.as_deref(), status.paid) {
        return Err(format!(
            "Mint quote '{}' is not paid yet (state: {})",
            quote_id,
            status.state.unwrap_or_else(|| "UNPAID".to_owned())
        ));
    }

    let keyset = fetch_active_sat_keyset(&http, &clean_mint).await?;
    let available: Vec<u64> = keyset.keys.keys().copied().collect();
    let split = split_amount_for_keyset(amount_sats, &available)?;
    let (outputs, blindings) = prepare_blinded_outputs(&split, &keyset.id, None)?;
    let signatures = post_mint_bolt11(&http, &clean_mint, quote_id.trim(), &outputs).await?;
    let new_proofs = unblind_signatures_to_proofs(&signatures, &blindings, &keyset.keys, &clean_mint)?;

    if !wallet.mints.contains(&clean_mint) {
        wallet.mints.push(clean_mint.clone());
    }
    if wallet.default_mint.is_none() {
        wallet.default_mint = Some(clean_mint.clone());
    }
    merge_unique_proofs(&mut wallet, new_proofs);
    wallet.history.push(CashuHistoryRecord {
        id: make_record_id("mint"),
        direction: "in".to_owned(),
        amount_sats,
        mint_url: clean_mint,
        unit: "sat".to_owned(),
        memo: Some("Lightning mint".to_owned()),
        event_id: Some(quote_id),
        counterparty_pubkey: None,
        created_at: current_unix_secs(),
    });

    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Receives a `cashuA` V3 token by swapping its proofs at the mint for fresh unblinded proofs.
pub async fn receive_cashu_token(
    database_path: String,
    pubkey_hex: String,
    token: String,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let decoded = decode_cashu_v3_token(&token)?;
    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&pubkey_hex, Vec::new(), Vec::new()),
    };

    let http = build_http_client()?;
    let mut total_received = 0u64;

    for (mint_url, incoming_proofs) in decoded.entries {
        let total_in: u64 = incoming_proofs
            .iter()
            .fold(0u64, |acc, p| acc.saturating_add(p.amount));
        let keyset = fetch_active_sat_keyset(&http, &mint_url).await?;
        let fee = compute_input_fee_sats(incoming_proofs.len(), keyset.input_fee_ppk);
        let claimable = total_in
            .checked_sub(fee)
            .filter(|&v| v > 0)
            .ok_or_else(|| format!("Token value {total_in} sats does not cover mint fee {fee}"))?;

        let available: Vec<u64> = keyset.keys.keys().copied().collect();
        let split = split_amount_for_keyset(claimable, &available)?;
        let (outputs, blindings) = prepare_blinded_outputs(&split, &keyset.id, None)?;
        let inputs = proofs_to_wire(&incoming_proofs, Some(&wallet.p2pk_privkey_hex))?;
        let signatures = post_swap(&http, &mint_url, &inputs, &outputs).await?;
        let fresh_proofs =
            unblind_signatures_to_proofs(&signatures, &blindings, &keyset.keys, &mint_url)?;

        if !wallet.mints.contains(&mint_url) {
            wallet.mints.push(mint_url.clone());
        }
        if wallet.default_mint.is_none() {
            wallet.default_mint = Some(mint_url.clone());
        }
        merge_unique_proofs(&mut wallet, fresh_proofs);
        total_received = total_received.saturating_add(claimable);
        wallet.history.push(CashuHistoryRecord {
            id: make_record_id("recv"),
            direction: "in".to_owned(),
            amount_sats: claimable,
            mint_url,
            unit: decoded.unit.clone(),
            memo: decoded.memo.clone(),
            event_id: None,
            counterparty_pubkey: None,
            created_at: current_unix_secs(),
        });
    }

    if total_received == 0 {
        return Err("Token yielded 0 sats".to_owned());
    }

    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Sends `amount_sats` from the wallet as a `cashuA` V3 token, swapping for change at the mint if needed.
pub async fn send_cashu_token(
    database_path: String,
    pubkey_hex: String,
    mint_url: Option<String>,
    amount_sats: u64,
    memo: Option<String>,
    master_key_b64: Option<String>,
) -> Result<CashuSendTokenDto, String> {
    if amount_sats == 0 {
        return Err("Send amount must be greater than zero".to_owned());
    }
    let (store, mut wallet) =
        load_existing_wallet(&database_path, &pubkey_hex, master_key_b64.as_deref())?;
    let target_mint = resolve_target_mint(&wallet, mint_url)?;
    let mint_proofs: Vec<CashuProofRecord> = wallet
        .proofs
        .iter()
        .filter(|p| p.mint_url == target_mint)
        .cloned()
        .collect();

    let http = build_http_client()?;
    let keyset = fetch_active_sat_keyset(&http, &target_mint).await?;
    let selection = select_proofs_for_amount(&mint_proofs, amount_sats, keyset.input_fee_ppk)?;

    let (send_proofs, change_proofs) =
        if selection.total_amount == amount_sats && selection.fee_sats == 0 {
            (selection.selected.clone(), Vec::new())
        } else {
            let change_amount = selection
                .total_amount
                .saturating_sub(amount_sats)
                .saturating_sub(selection.fee_sats);
            let available: Vec<u64> = keyset.keys.keys().copied().collect();
            let send_split = split_amount_for_keyset(amount_sats, &available)?;
            let change_split = split_amount_for_keyset(change_amount, &available)?;
            let send_count = send_split.len();

            let mut all_amounts = send_split;
            all_amounts.extend(change_split);

            let (outputs, blindings) = prepare_blinded_outputs(&all_amounts, &keyset.id, None)?;
            let inputs = proofs_to_wire(&selection.selected, Some(&wallet.p2pk_privkey_hex))?;
            let signatures = post_swap(&http, &target_mint, &inputs, &outputs).await?;
            let unblinded =
                unblind_signatures_to_proofs(&signatures, &blindings, &keyset.keys, &target_mint)?;
            let (send_slice, change_slice) = unblinded.split_at(send_count);
            (send_slice.to_vec(), change_slice.to_vec())
        };

    let token = encode_cashu_v3_token(&target_mint, &send_proofs, memo.as_deref(), Some("sat"))?;
    let now = current_unix_secs();

    remove_spent_proofs(&mut wallet, &selection.selected);
    merge_unique_proofs(&mut wallet, change_proofs);
    wallet.pending_tokens.push(PendingCashuToken {
        id: make_record_id("tok"),
        mint_url: target_mint.clone(),
        amount_sats,
        token: token.clone(),
        memo: memo.clone(),
        created_at: now,
        quote_id: None,
        state: "pending".to_owned(),
    });
    wallet.history.push(CashuHistoryRecord {
        id: make_record_id("send"),
        direction: "out".to_owned(),
        amount_sats,
        mint_url: target_mint.clone(),
        unit: "sat".to_owned(),
        memo: memo.clone(),
        event_id: None,
        counterparty_pubkey: None,
        created_at: now,
    });

    let wallet_state = save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())?;
    Ok(CashuSendTokenDto {
        token,
        mint_url: target_mint,
        amount_sats,
        memo,
        wallet_state,
    })
}

/// Pays a Lightning BOLT-11 invoice by melting Cashu proofs at the mint (`POST /v1/melt/bolt11`).
pub async fn pay_bolt11_via_cashu(
    database_path: String,
    pubkey_hex: String,
    mint_url: Option<String>,
    bolt11: String,
    master_key_b64: Option<String>,
) -> Result<CashuMeltResultDto, String> {
    let invoice = bolt11.trim();
    if invoice.is_empty() {
        return Err("BOLT-11 invoice cannot be empty".to_owned());
    }
    let (store, mut wallet) =
        load_existing_wallet(&database_path, &pubkey_hex, master_key_b64.as_deref())?;
    let target_mint = resolve_target_mint(&wallet, mint_url)?;
    let http = build_http_client()?;

    let quote = post_melt_quote_bolt11(&http, &target_mint, invoice).await?;
    if is_quote_paid(quote.state.as_deref(), quote.paid) {
        return Err(format!("Melt quote '{}' is already paid", quote.quote));
    }
    let keyset = fetch_active_sat_keyset(&http, &target_mint).await?;
    let mint_proofs: Vec<CashuProofRecord> = wallet
        .proofs
        .iter()
        .filter(|p| p.mint_url == target_mint)
        .cloned()
        .collect();

    let required = quote.amount.saturating_add(quote.fee_reserve);
    let selection = select_proofs_for_amount(&mint_proofs, required, keyset.input_fee_ppk)?;

    // NUT-08 blank outputs so the mint can return unused fee_reserve / overshoot change.
    let blank_count = if quote.fee_reserve > 0 || selection.total_amount > required {
        4usize
    } else {
        0usize
    };
    let blank_amounts = vec![1u64; blank_count];
    let (blank_outputs, blank_blindings) =
        prepare_blinded_outputs(&blank_amounts, &keyset.id, None)?;
    let inputs = proofs_to_wire(&selection.selected, Some(&wallet.p2pk_privkey_hex))?;
    let melt_resp = post_melt_bolt11(&http, &target_mint, &quote.quote, &inputs, &blank_outputs).await?;
    let paid = is_quote_paid(melt_resp.state.as_deref(), melt_resp.paid);
    if !paid {
        return Err(format!(
            "Mint did not mark BOLT-11 melt quote '{}' as PAID (state: {:?})",
            quote.quote, melt_resp.state
        ));
    }

    let mut change_sats = 0u64;
    if let Some(change_sigs) = melt_resp.change {
        if !change_sigs.is_empty() && change_sigs.len() <= blank_blindings.len() {
            let change_proofs = unblind_signatures_to_proofs(
                &change_sigs,
                &blank_blindings[..change_sigs.len()],
                &keyset.keys,
                &target_mint,
            )?;
            change_sats = change_proofs
                .iter()
                .fold(0u64, |acc, p| acc.saturating_add(p.amount));
            merge_unique_proofs(&mut wallet, change_proofs);
        }
    }

    remove_spent_proofs(&mut wallet, &selection.selected);
    let fee_paid_sats = selection
        .total_amount
        .saturating_sub(quote.amount)
        .saturating_sub(change_sats);

    wallet.history.push(CashuHistoryRecord {
        id: make_record_id("melt"),
        direction: "out".to_owned(),
        amount_sats: quote.amount,
        mint_url: target_mint.clone(),
        unit: "sat".to_owned(),
        memo: Some("Lightning payment".to_owned()),
        event_id: Some(quote.quote.clone()),
        counterparty_pubkey: None,
        created_at: current_unix_secs(),
    });

    let preimage = melt_resp.payment_preimage.or(quote.payment_preimage);
    let wallet_state = save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())?;
    Ok(CashuMeltResultDto {
        mint_url: target_mint,
        quote_id: quote.quote,
        amount_sats: quote.amount,
        fee_paid_sats,
        paid,
        preimage,
        wallet_state,
    })
}

fn merge_relay_urls(target: &mut Vec<String>, extra: &[String]) -> Vec<String> {
    let mut seen: BTreeSet<String> = target.iter().cloned().collect();
    let mut added = Vec::new();
    for raw in extra {
        let clean = raw.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://")) && seen.insert(clean.clone())
        {
            target.push(clean.clone());
            added.push(clean);
        }
    }
    added
}

fn extract_nip65_relays(event: &Event) -> Vec<String> {
    let mut relays = Vec::new();
    for tag in event.tags.iter() {
        let s = tag.as_slice();
        if s.first().map(String::as_str) == Some("r") {
            if let Some(raw) = s.get(1) {
                let clean = raw.trim().to_owned();
                if (clean.starts_with("wss://") || clean.starts_with("ws://"))
                    && !relays.contains(&clean)
                {
                    relays.push(clean);
                }
            }
        }
    }
    relays
}

fn extract_deleted_event_ids_from_kind5(events: &[Event]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut ids = Vec::new();
    for ev in events {
        if ev.kind != Kind::EventDeletion {
            continue;
        }
        for tag in ev.tags.iter() {
            let s = tag.as_slice();
            if s.first().map(String::as_str) == Some("e") {
                if let Some(id_str) = s.get(1) {
                    let clean = id_str.trim().to_ascii_lowercase();
                    if !clean.is_empty() && seen.insert(clean.clone()) {
                        ids.push(clean);
                    }
                }
            }
        }
    }
    ids
}

fn event_to_raw_dto(ev: &Event) -> Nip60RawEventDto {
    Nip60RawEventDto {
        event_id: ev.id.to_hex(),
        kind: ev.kind.as_u16(),
        created_at: ev.created_at.as_secs(),
        content: ev.content.clone(),
    }
}

async fn discover_nip60_wallet_events(
    author_pk: NostrPublicKey,
    seed_relays: &[String],
) -> Result<(Nip60WalletDiscoveryDto, Option<Event>), String> {
    let user_relays = normalize_relays_with_fallback(seed_relays);
    let mut phase1_relays = user_relays.clone();
    let discovery_strings: Vec<String> = DISCOVERY_RELAYS.iter().map(|s| (*s).to_owned()).collect();
    merge_relay_urls(&mut phase1_relays, &discovery_strings);

    let client = super::relay_pool::shared_client(&phase1_relays).await?;

    let discovery_filter = Filter::new()
        .author(author_pk)
        .kinds([Kind::RelayList, Kind::CashuNutZapInfo, Kind::CashuWallet])
        .limit(30);

    let initial_events = client
        .fetch_events_from(
            &phase1_relays,
            discovery_filter,
            Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
        )
        .await
        .map_err(|e| format!("Failed to fetch NIP-60 wallet discovery events: {e}"))?;

    let mut latest_10002: Option<Event> = None;
    let mut latest_10019: Option<Event> = None;
    let mut latest_17375: Option<Event> = None;

    for ev in initial_events.into_iter() {
        match ev.kind {
            Kind::RelayList => {
                if latest_10002
                    .as_ref()
                    .is_none_or(|cur| ev.created_at > cur.created_at)
                {
                    latest_10002 = Some(ev);
                }
            }
            Kind::CashuNutZapInfo => {
                if latest_10019
                    .as_ref()
                    .is_none_or(|cur| ev.created_at > cur.created_at)
                {
                    latest_10019 = Some(ev);
                }
            }
            Kind::CashuWallet => {
                if latest_17375
                    .as_ref()
                    .is_none_or(|cur| ev.created_at > cur.created_at)
                {
                    latest_17375 = Some(ev);
                }
            }
            _ => {}
        }
    }

    let mut discovered_relays = user_relays;
    if let Some(ev) = latest_10002.as_ref() {
        let nip65 = extract_nip65_relays(ev);
        merge_relay_urls(&mut discovered_relays, &nip65);
    }

    let mut nutzap_relays = Vec::new();
    let mut nutzap_mints = Vec::new();
    if let Some(ev) = latest_10019.as_ref() {
        if let Ok(info) = parse_nip61_nutzap_info_event(ev) {
            nutzap_relays = info.relays;
            nutzap_mints = info.mints;
            merge_relay_urls(&mut discovered_relays, &nutzap_relays);
        }
    }

    let extra_relays: Vec<String> = discovered_relays
        .iter()
        .filter(|r| !phase1_relays.contains(r))
        .cloned()
        .collect();

    if !extra_relays.is_empty() {
        if let Ok(expanded_client) = super::relay_pool::shared_client(&discovered_relays).await {
            let follow_up = Filter::new()
                .author(author_pk)
                .kinds([Kind::CashuNutZapInfo, Kind::CashuWallet])
                .limit(20);
            if let Ok(more_events) = expanded_client
                .fetch_events_from(
                    &extra_relays,
                    follow_up,
                    Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
                )
                .await
            {
                for ev in more_events.into_iter() {
                    match ev.kind {
                        Kind::CashuNutZapInfo => {
                            if latest_10019
                                .as_ref()
                                .is_none_or(|cur| ev.created_at > cur.created_at)
                            {
                                latest_10019 = Some(ev);
                            }
                        }
                        Kind::CashuWallet => {
                            if latest_17375
                                .as_ref()
                                .is_none_or(|cur| ev.created_at > cur.created_at)
                            {
                                latest_17375 = Some(ev);
                            }
                        }
                        _ => {}
                    }
                }
                if let Some(ev) = latest_10019.as_ref() {
                    if let Ok(info) = parse_nip61_nutzap_info_event(ev) {
                        nutzap_relays = info.relays;
                        nutzap_mints = info.mints;
                        merge_relay_urls(&mut discovered_relays, &nutzap_relays);
                    }
                }
            }
        }
    }

    let dto = Nip60WalletDiscoveryDto {
        discovered_relays,
        wallet_event: latest_17375.as_ref().map(event_to_raw_dto),
        nutzap_relays,
        nutzap_mints,
    };
    Ok((dto, latest_17375))
}

async fn fetch_nip60_data_events_internal(
    author_pk: NostrPublicKey,
    relays: &[String],
) -> Result<(Vec<Event>, Vec<Event>, Vec<String>), String> {
    let effective_relays = normalize_relays_with_fallback(relays);
    let client = super::relay_pool::shared_client(&effective_relays).await?;

    let data_filter = Filter::new()
        .author(author_pk)
        .kinds([Kind::CashuWalletUnspentProof, Kind::CashuWalletSpendingHistory])
        .limit(200);

    let data_events = client
        .fetch_events_from(
            &effective_relays,
            data_filter,
            Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
        )
        .await
        .map_err(|e| format!("Failed to fetch NIP-60 wallet events: {e}"))?;

    let deletion_filter = Filter::new()
        .author(author_pk)
        .kind(Kind::EventDeletion)
        .custom_tag(SingleLetterTag::lowercase(Alphabet::K), "7375")
        .limit(200);

    let deletion_events: Vec<Event> = client
        .fetch_events_from(
            &effective_relays,
            deletion_filter,
            Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
        )
        .await
        .map(|evs| evs.into_iter().collect())
        .unwrap_or_default();

    let deleted_event_ids = extract_deleted_event_ids_from_kind5(&deletion_events);

    let mut token_events = Vec::new();
    let mut history_events = Vec::new();
    for ev in data_events.into_iter() {
        match ev.kind {
            Kind::CashuWalletUnspentProof => token_events.push(ev),
            Kind::CashuWalletSpendingHistory => history_events.push(ev),
            _ => {}
        }
    }

    Ok((token_events, history_events, deleted_event_ids))
}

fn apply_decrypted_nip60_to_wallet(
    wallet: &mut PersistedCashuWallet,
    relays: &[String],
    decrypted_wallet_json: Option<&str>,
    decrypted_token_events: &[DecryptedNip60EventDto],
    decrypted_history_events: &[DecryptedNip60EventDto],
    deleted_event_ids: &[String],
) {
    if !relays.is_empty() {
        wallet.relays = normalize_relays_with_fallback(relays);
    }

    if let Some(raw_wallet_json) = decrypted_wallet_json
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if let Ok(parsed_wallet) = parse_nip60_wallet_content(raw_wallet_json) {
            if let Some(ref privkey_str) = parsed_wallet.privkey {
                let parsed_sk = nostr::SecretKey::parse(privkey_str)
                    .ok()
                    .and_then(|nsk| SecretKey::from_slice(&nsk.secret_bytes()).ok())
                    .or_else(|| {
                        hex_to_bytes(privkey_str)
                            .ok()
                            .and_then(|b| SecretKey::from_slice(&b).ok())
                    });
                if let Some(sk) = parsed_sk {
                    let secp = Secp256k1::new();
                    let pk = PublicKey::from_secret_key(&secp, &sk);
                    wallet.p2pk_privkey_hex = bytes_to_hex(&sk.secret_bytes());
                    wallet.p2pk_pubkey_hex = bytes_to_hex(&pk.serialize());
                }
            }
            for clean_mint in parsed_wallet.mints {
                if !wallet.mints.contains(&clean_mint) {
                    wallet.mints.push(clean_mint);
                }
            }
            merge_relay_urls(&mut wallet.relays, &parsed_wallet.relays);
        }
    }

    let mut destroyed_ids: HashSet<String> = deleted_event_ids
        .iter()
        .map(|id| id.trim().to_ascii_lowercase())
        .filter(|id| !id.is_empty())
        .collect();

    let mut parsed_tokens: Vec<(String, Nip60TokenContent)> = Vec::new();
    for ev in decrypted_token_events {
        if let Ok(tok) = serde_json::from_str::<Nip60TokenContent>(&ev.decrypted_json) {
            for del_id in &tok.del {
                let clean = del_id.trim().to_ascii_lowercase();
                if !clean.is_empty() {
                    destroyed_ids.insert(clean);
                }
            }
            let ev_hex = ev.event_id.trim().to_ascii_lowercase();
            if !ev_hex.is_empty() {
                parsed_tokens.push((ev_hex, tok));
            }
        }
    }

    // Remove local stale proofs whose originating 7375 event was destroyed/deleted.
    wallet.proofs.retain(|p| {
        !p.token_event_id
            .as_deref()
            .is_some_and(|id| destroyed_ids.contains(&id.to_ascii_lowercase()))
    });

    let mut remote_proofs = Vec::new();
    for (ev_hex, tok) in parsed_tokens {
        if destroyed_ids.contains(&ev_hex) {
            continue;
        }
        if !tok.unit.as_deref().unwrap_or("sat").eq_ignore_ascii_case("sat") {
            continue;
        }
        if let Ok(clean_mint) = normalize_mint_url(&tok.mint) {
            if !wallet.mints.contains(&clean_mint) {
                wallet.mints.push(clean_mint.clone());
            }
            for p in tok.proofs {
                remote_proofs.push(CashuProofRecord {
                    id: p.id,
                    amount: p.amount,
                    secret: p.secret,
                    c: p.c,
                    mint_url: clean_mint.clone(),
                    token_event_id: Some(ev_hex.clone()),
                });
            }
        }
    }

    // Link existing unsynced local proofs if a matching remote proof was fetched.
    for remote in &remote_proofs {
        if let Some(existing) = wallet
            .proofs
            .iter_mut()
            .find(|p| p.token_event_id.is_none() && p.mint_url == remote.mint_url && p.secret == remote.secret)
        {
            existing.token_event_id = remote.token_event_id.clone();
        }
    }
    merge_unique_proofs(wallet, remote_proofs);

    if wallet.default_mint.is_none() {
        wallet.default_mint = wallet.mints.first().cloned();
    }

    let mut known_history_events: HashSet<String> = wallet
        .history
        .iter()
        .filter_map(|h| h.event_id.as_ref().map(|s| s.to_ascii_lowercase()))
        .collect();
    for ev in decrypted_history_events {
        let ev_hex = ev.event_id.trim().to_ascii_lowercase();
        if ev_hex.is_empty() || known_history_events.contains(&ev_hex) {
            continue;
        }
        if let Ok(hist) = parse_nip60_history_content(&ev.decrypted_json) {
            if let (Some(direction), Some(amount_sats)) = (hist.direction, hist.amount_sats) {
                wallet.history.push(CashuHistoryRecord {
                    id: format!("nip60-{ev_hex}"),
                    direction,
                    amount_sats,
                    mint_url: wallet.default_mint.clone().unwrap_or_default(),
                    unit: hist.unit,
                    memo: Some("NIP-60 synced".to_owned()),
                    event_id: Some(ev_hex.clone()),
                    counterparty_pubkey: None,
                    created_at: ev.created_at,
                });
                known_history_events.insert(ev_hex);
            }
        }
    }
}

async fn check_proofs_liveness_non_fatal(wallet: &mut PersistedCashuWallet) {
    if wallet.proofs.is_empty() {
        return;
    }
    let Ok(http) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(4))
        .timeout(Duration::from_secs(5))
        .build()
    else {
        return;
    };

    let mut by_mint: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for p in &wallet.proofs {
        by_mint
            .entry(p.mint_url.clone())
            .or_default()
            .push(p.secret.clone());
    }

    let mut tasks = tokio::task::JoinSet::new();
    for (mint, secrets) in by_mint {
        let http = http.clone();
        tasks.spawn(async move {
            let states = post_checkstate(&http, &mint, &secrets).await.ok()?;
            Some((mint, secrets, states))
        });
    }

    let mut spent_secrets = HashSet::new();
    while let Some(res) = tasks.join_next().await {
        if let Ok(Some((mint, secrets, states))) = res {
            let state_by_y: BTreeMap<String, String> = states
                .into_iter()
                .map(|s| (s.y.to_ascii_lowercase(), s.state))
                .collect();
            for secret in secrets {
                if let Ok(y) = hash_to_curve(secret.as_bytes()) {
                    let y_hex = bytes_to_hex(&y.serialize());
                    if state_by_y
                        .get(&y_hex)
                        .is_some_and(|st| st.eq_ignore_ascii_case("SPENT"))
                    {
                        spent_secrets.insert((mint.clone(), secret));
                    }
                }
            }
        }
    }

    if !spent_secrets.is_empty() {
        wallet
            .proofs
            .retain(|p| !spent_secrets.contains(&(p.mint_url.clone(), p.secret.clone())));
    }
}

/// Discovers NIP-60 relays (`10002` + `10019`) and fetches the latest `kind 17375` wallet metadata
/// event for signer-agnostic decryption (Amber NIP-55 / NIP-46 Bunker / local nsec).
pub async fn fetch_nip60_wallet_discovery(
    pubkey_hex: String,
    relays: Vec<String>,
) -> Result<Nip60WalletDiscoveryDto, String> {
    let author_pk = NostrPublicKey::parse(pubkey_hex.trim())
        .map_err(|e| format!("Invalid Nostr pubkey for NIP-60 wallet discovery: {e}"))?;
    let (dto, _) = discover_nip60_wallet_events(author_pk, &relays).await?;
    Ok(dto)
}

/// Fetches encrypted NIP-60 `kind 7375` token events, `kind 7376` history events, and NIP-09
/// `kind 5` (`#k: ["7375"]`) deletion IDs across the provided relays.
pub async fn fetch_nip60_data_events(
    pubkey_hex: String,
    relays: Vec<String>,
) -> Result<Nip60DataFetchDto, String> {
    let author_pk = NostrPublicKey::parse(pubkey_hex.trim())
        .map_err(|e| format!("Invalid Nostr pubkey for NIP-60 data fetch: {e}"))?;
    let (token_events, history_events, deleted_event_ids) =
        fetch_nip60_data_events_internal(author_pk, &relays).await?;
    let deleted_set: HashSet<String> = deleted_event_ids
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();

    Ok(Nip60DataFetchDto {
        token_events: token_events
            .iter()
            .filter(|ev| !deleted_set.contains(&ev.id.to_hex()))
            .map(event_to_raw_dto)
            .collect(),
        history_events: history_events.iter().map(event_to_raw_dto).collect(),
        deleted_event_ids,
    })
}

/// Extracts valid `ws://` / `wss://` relay URLs from decrypted `kind 17375` JSON.
pub fn parse_nip60_wallet_relays_from_json(decrypted_wallet_json: String) -> Vec<String> {
    parse_nip60_wallet_content(&decrypted_wallet_json)
        .map(|parsed| parsed.relays)
        .unwrap_or_default()
}

/// Applies caller-decrypted NIP-60 wallet/token/history events to local SQLite state, pruning
/// deleted/destroyed proofs and checking NUT-07 proof liveness where mints are reachable.
#[allow(clippy::too_many_arguments)]
pub async fn apply_decrypted_nip60_sync(
    database_path: String,
    pubkey_hex: String,
    relays: Vec<String>,
    decrypted_wallet_json: Option<String>,
    decrypted_token_events: Vec<DecryptedNip60EventDto>,
    decrypted_history_events: Vec<DecryptedNip60EventDto>,
    deleted_event_ids: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let author_pk = NostrPublicKey::parse(pubkey_hex.trim())
        .map_err(|e| format!("Invalid Nostr pubkey for NIP-60 apply sync: {e}"))?;
    let clean_pk = author_pk.to_hex();

    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&clean_pk, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&clean_pk, Vec::new(), relays.clone()),
    };

    apply_decrypted_nip60_to_wallet(
        &mut wallet,
        &relays,
        decrypted_wallet_json.as_deref(),
        &decrypted_token_events,
        &decrypted_history_events,
        &deleted_event_ids,
    );

    check_proofs_liveness_non_fatal(&mut wallet).await;
    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Syncs NIP-60 wallet state (`17375`, `7375`, `7376`, `5`) over the shared persistent Nostr relay pool.
pub async fn sync_nip60_wallet(
    database_path: String,
    nsec_or_hex: String,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|e| format!("Invalid Nostr key for NIP-60 wallet sync: {e}"))?;
    let author_pk = keys.public_key();
    let pubkey_hex = author_pk.to_hex();

    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&pubkey_hex, Vec::new(), relays.clone()),
    };

    let mut seed_relays = normalize_relays_with_fallback(&wallet.relays);
    merge_relay_urls(&mut seed_relays, &relays);

    let (discovery, latest_17375) = discover_nip60_wallet_events(author_pk, &seed_relays).await?;
    let mut effective_relays = discovery.discovered_relays;

    let decrypted_wallet_json = latest_17375.and_then(|ev| {
        if ev.pubkey != author_pk {
            return None;
        }
        nip44::decrypt(keys.secret_key(), &author_pk, &ev.content).ok()
    });

    if let Some(ref wallet_json) = decrypted_wallet_json {
        let extra = parse_nip60_wallet_relays_from_json(wallet_json.clone());
        merge_relay_urls(&mut effective_relays, &extra);
    }

    let (token_events, history_events, deleted_event_ids) =
        fetch_nip60_data_events_internal(author_pk, &effective_relays).await?;
    let deleted_set: HashSet<String> = deleted_event_ids
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();

    let decrypted_token_events: Vec<DecryptedNip60EventDto> = token_events
        .into_iter()
        .filter(|ev| ev.pubkey == author_pk && !deleted_set.contains(&ev.id.to_hex()))
        .filter_map(|ev| {
            let decrypted_json = nip44::decrypt(keys.secret_key(), &author_pk, &ev.content).ok()?;
            Some(DecryptedNip60EventDto {
                event_id: ev.id.to_hex(),
                created_at: ev.created_at.as_secs(),
                decrypted_json,
            })
        })
        .collect();

    let decrypted_history_events: Vec<DecryptedNip60EventDto> = history_events
        .into_iter()
        .filter(|ev| ev.pubkey == author_pk)
        .filter_map(|ev| {
            let decrypted_json = nip44::decrypt(keys.secret_key(), &author_pk, &ev.content).ok()?;
            Some(DecryptedNip60EventDto {
                event_id: ev.id.to_hex(),
                created_at: ev.created_at.as_secs(),
                decrypted_json,
            })
        })
        .collect();

    apply_decrypted_nip60_to_wallet(
        &mut wallet,
        &effective_relays,
        decrypted_wallet_json.as_deref(),
        &decrypted_token_events,
        &decrypted_history_events,
        &deleted_event_ids,
    );

    check_proofs_liveness_non_fatal(&mut wallet).await;

    // Publish kind 7375 token events only for local unspent proofs that lack a Nostr event ID.
    let mut unsynced_by_mint: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (idx, p) in wallet.proofs.iter().enumerate() {
        if p.token_event_id.is_none() {
            unsynced_by_mint.entry(p.mint_url.clone()).or_default().push(idx);
        }
    }
    if !unsynced_by_mint.is_empty() {
        if let Ok(client) = super::relay_pool::shared_client(&effective_relays).await {
            for (mint_url, indices) in unsynced_by_mint {
                let group: Vec<CashuProofRecord> =
                    indices.iter().map(|&i| wallet.proofs[i].clone()).collect();
                if let Ok(builder) = build_nip60_token_event(&keys, &mint_url, &group, &[]) {
                    if let Ok(signed) = builder.sign_with_keys(&keys) {
                        if client.send_event(&signed).await.is_ok() {
                            let ev_hex = signed.id.to_hex();
                            for idx in indices {
                                wallet.proofs[idx].token_event_id = Some(ev_hex.clone());
                            }
                        }
                    }
                }
            }
        }
    }

    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Syncs NIP-60 wallet state (`17375`, `7375`, `7376`, `5`) using a NIP-46 remote Bunker signer.
pub async fn sync_nip60_wallet_with_bunker(
    database_path: String,
    bunker_uri: String,
    client_nsec: String,
    pubkey_hex: String,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<CashuWalletStateDto, String> {
    use nostr::signer::NostrSigner as _;

    let (connect, _, _) = super::nip46::build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
    let author_pk = if pubkey_hex.trim().is_empty() {
        match connect.get_public_key().await {
            Ok(pk) => pk,
            Err(e) => {
                connect.shutdown().await;
                return Err(format!("NIP-46 get_public_key failed: {e}"));
            }
        }
    } else {
        match NostrPublicKey::parse(pubkey_hex.trim()) {
            Ok(pk) => pk,
            Err(e) => {
                connect.shutdown().await;
                return Err(format!("Invalid Nostr pubkey for NIP-60 bunker sync: {e}"));
            }
        }
    };
    let clean_pk = author_pk.to_hex();

    let store = match CashuWalletStore::open(&database_path) {
        Ok(s) => s,
        Err(e) => {
            connect.shutdown().await;
            return Err(e.to_string());
        }
    };
    let mut wallet = match store.load_wallet_with_master_key(&clean_pk, master_key_b64.as_deref()) {
        Ok(Some(existing)) => existing,
        Ok(None) => default_wallet_for(&clean_pk, Vec::new(), relays.clone()),
        Err(e) => {
            connect.shutdown().await;
            return Err(e.to_string());
        }
    };

    let mut seed_relays = normalize_relays_with_fallback(&wallet.relays);
    merge_relay_urls(&mut seed_relays, &relays);

    let (discovery, latest_17375) = match discover_nip60_wallet_events(author_pk, &seed_relays).await {
        Ok(res) => res,
        Err(e) => {
            connect.shutdown().await;
            return Err(e);
        }
    };
    let mut effective_relays = discovery.discovered_relays;

    let decrypted_wallet_json = if let Some(ev) = latest_17375.filter(|e| e.pubkey == author_pk) {
        match connect.nip44_decrypt(&author_pk, &ev.content).await {
            Ok(plain) => Some(plain),
            Err(e) => {
                connect.shutdown().await;
                return Err(format!("NIP-46 failed to decrypt wallet event: {e}"));
            }
        }
    } else {
        None
    };

    if let Some(ref wallet_json) = decrypted_wallet_json {
        let extra = parse_nip60_wallet_relays_from_json(wallet_json.clone());
        merge_relay_urls(&mut effective_relays, &extra);
    }

    let (token_events, history_events, deleted_event_ids) =
        match fetch_nip60_data_events_internal(author_pk, &effective_relays).await {
            Ok(res) => res,
            Err(e) => {
                connect.shutdown().await;
                return Err(e);
            }
        };

    let deleted_set: HashSet<String> = deleted_event_ids
        .iter()
        .map(|s| s.to_ascii_lowercase())
        .collect();

    let mut decrypted_token_events = Vec::new();
    for ev in token_events {
        if ev.pubkey != author_pk || deleted_set.contains(&ev.id.to_hex()) {
            continue;
        }
        if let Ok(decrypted_json) = connect.nip44_decrypt(&author_pk, &ev.content).await {
            decrypted_token_events.push(DecryptedNip60EventDto {
                event_id: ev.id.to_hex(),
                created_at: ev.created_at.as_secs(),
                decrypted_json,
            });
        }
    }

    let mut decrypted_history_events = Vec::new();
    for ev in history_events {
        if ev.pubkey != author_pk {
            continue;
        }
        if let Ok(decrypted_json) = connect.nip44_decrypt(&author_pk, &ev.content).await {
            decrypted_history_events.push(DecryptedNip60EventDto {
                event_id: ev.id.to_hex(),
                created_at: ev.created_at.as_secs(),
                decrypted_json,
            });
        }
    }

    connect.shutdown().await;

    apply_decrypted_nip60_to_wallet(
        &mut wallet,
        &effective_relays,
        decrypted_wallet_json.as_deref(),
        &decrypted_token_events,
        &decrypted_history_events,
        &deleted_event_ids,
    );

    check_proofs_liveness_non_fatal(&mut wallet).await;
    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())
}

/// Publishes a NIP-61 `kind 10019` Nutzap Info event enabling Nutzap receipt.
pub async fn publish_nip61_nutzap_info(
    database_path: String,
    nsec_or_hex: String,
    mints: Vec<String>,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<NutzapInfoDto, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|e| format!("Invalid Nostr key for NIP-61 Nutzap info: {e}"))?;
    let pubkey_hex = keys.public_key().to_hex();

    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&pubkey_hex, mints.clone(), relays.clone()),
    };

    for m in mints {
        if let Ok(clean) = normalize_mint_url(&m) {
            if !wallet.mints.contains(&clean) {
                wallet.mints.push(clean);
            }
        }
    }
    if !relays.is_empty() {
        wallet.relays = normalize_relays_with_fallback(&relays);
    }
    if wallet.mints.is_empty() {
        return Err("Configure at least one mint before publishing NIP-61 Nutzap info".to_owned());
    }
    if wallet.default_mint.is_none() {
        wallet.default_mint = wallet.mints.first().cloned();
    }

    let effective_relays = normalize_relays_with_fallback(&wallet.relays);
    let builder =
        build_nip61_nutzap_info_event(&wallet.p2pk_pubkey_hex, &wallet.mints, &effective_relays)?;
    let event = builder
        .sign_with_keys(&keys)
        .map_err(|e| format!("Failed to sign NIP-61 Nutzap info event: {e}"))?;

    let client = super::relay_pool::shared_client(&effective_relays).await?;
    client
        .send_event(&event)
        .await
        .map_err(|e| format!("Failed to publish NIP-61 Nutzap info event: {e}"))?;

    wallet.nutzap_enabled = true;
    save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())?;

    Ok(NutzapInfoDto {
        event_id: event.id.to_hex(),
        pubkey_hex,
        p2pk_pubkey_hex: wallet.p2pk_pubkey_hex,
        mints: wallet.mints,
        relays: effective_relays,
    })
}

/// Sends a NIP-61 `kind 9321` Nutzap locked to the recipient's `kind 10019` P2PK key.
#[allow(clippy::too_many_arguments)]
pub async fn send_nip61_nutzap(
    database_path: String,
    nsec_or_hex: String,
    recipient_pubkey_hex: String,
    amount_sats: u64,
    mint_url: Option<String>,
    comment: Option<String>,
    target_event_id: Option<String>,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<NutzapSendResultDto, String> {
    if amount_sats == 0 {
        return Err("Nutzap amount must be greater than zero".to_owned());
    }
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|e| format!("Invalid sender Nostr key: {e}"))?;
    let sender_pubkey_hex = keys.public_key().to_hex();
    let recipient_pk = NostrPublicKey::from_hex(recipient_pubkey_hex.trim())
        .map_err(|e| format!("Invalid recipient Nostr pubkey: {e}"))?;

    let (store, mut wallet) =
        load_existing_wallet(&database_path, &sender_pubkey_hex, master_key_b64.as_deref())?;

    let mut fetch_relays = normalize_relays_with_fallback(&wallet.relays);
    for r in relays {
        let clean = r.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://"))
            && !fetch_relays.contains(&clean)
        {
            fetch_relays.push(clean);
        }
    }

    let client = super::relay_pool::shared_client(&fetch_relays).await?;
    let info_filter = Filter::new()
        .author(recipient_pk)
        .kind(Kind::CashuNutZapInfo)
        .limit(5);
    let info_events = client
        .fetch_events_from(
            &fetch_relays,
            info_filter,
            Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
        )
        .await
        .map_err(|e| format!("Failed to fetch recipient NIP-61 Nutzap info: {e}"))?;

    let latest_info_event = info_events
        .into_iter()
        .max_by_key(|ev| ev.created_at)
        .ok_or_else(|| {
            "Recipient has not published NIP-61 Nutzap info (kind 10019)".to_owned()
        })?;
    let recipient_info = parse_nip61_nutzap_info_event(&latest_info_event)?;

    let target_mint = match mint_url.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(m) => normalize_mint_url(m)?,
        None => wallet
            .mints
            .iter()
            .find(|m| recipient_info.mints.contains(m) && wallet.balance_for_mint_sats(m) >= amount_sats)
            .cloned()
            .or_else(|| {
                wallet
                    .default_mint
                    .clone()
                    .filter(|m| recipient_info.mints.is_empty() || recipient_info.mints.contains(m))
            })
            .or_else(|| wallet.mints.first().cloned())
            .ok_or_else(|| "No compatible Cashu mint found for recipient Nutzap".to_owned())?,
    };

    let mint_proofs: Vec<CashuProofRecord> = wallet
        .proofs
        .iter()
        .filter(|p| p.mint_url == target_mint)
        .cloned()
        .collect();
    let http = build_http_client()?;
    let keyset = fetch_active_sat_keyset(&http, &target_mint).await?;
    let selection = select_proofs_for_amount(&mint_proofs, amount_sats, keyset.input_fee_ppk)?;

    let change_amount = selection
        .total_amount
        .saturating_sub(amount_sats)
        .saturating_sub(selection.fee_sats);
    let available: Vec<u64> = keyset.keys.keys().copied().collect();
    let send_split = split_amount_for_keyset(amount_sats, &available)?;
    let change_split = split_amount_for_keyset(change_amount, &available)?;

    let (mut outputs, mut blindings) = prepare_blinded_outputs(
        &send_split,
        &keyset.id,
        Some(&recipient_info.p2pk_pubkey_hex),
    )?;
    let (change_outputs, change_blindings) =
        prepare_blinded_outputs(&change_split, &keyset.id, None)?;
    outputs.extend(change_outputs);
    blindings.extend(change_blindings);

    let inputs = proofs_to_wire(&selection.selected, Some(&wallet.p2pk_privkey_hex))?;
    let signatures = post_swap(&http, &target_mint, &inputs, &outputs).await?;
    let unblinded =
        unblind_signatures_to_proofs(&signatures, &blindings, &keyset.keys, &target_mint)?;
    let (nutzap_proofs, change_proofs) = unblinded.split_at(send_split.len());

    let mut publish_relays = fetch_relays;
    for r in recipient_info.relays {
        if !publish_relays.contains(&r) {
            publish_relays.push(r);
        }
    }
    let publish_client = super::relay_pool::shared_client(&publish_relays).await?;
    let nutzap_builder = build_nip61_nutzap_event(
        &recipient_info.pubkey_hex,
        &target_mint,
        nutzap_proofs,
        comment.as_deref(),
        target_event_id.as_deref(),
    )?;
    let nutzap_event = nutzap_builder
        .sign_with_keys(&keys)
        .map_err(|e| format!("Failed to sign NIP-61 Nutzap event: {e}"))?;
    publish_client
        .send_event(&nutzap_event)
        .await
        .map_err(|e| format!("Failed to publish NIP-61 Nutzap event: {e}"))?;

    let event_id_hex = nutzap_event.id.to_hex();
    remove_spent_proofs(&mut wallet, &selection.selected);
    merge_unique_proofs(&mut wallet, change_proofs.to_vec());
    wallet.history.push(CashuHistoryRecord {
        id: make_record_id("nz-out"),
        direction: "out".to_owned(),
        amount_sats,
        mint_url: target_mint.clone(),
        unit: "sat".to_owned(),
        memo: comment,
        event_id: Some(event_id_hex.clone()),
        counterparty_pubkey: Some(recipient_info.pubkey_hex.clone()),
        created_at: current_unix_secs(),
    });

    let wallet_state = save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())?;
    Ok(NutzapSendResultDto {
        event_id: event_id_hex,
        recipient_pubkey_hex: recipient_info.pubkey_hex,
        mint_url: target_mint,
        amount_sats,
        wallet_state,
    })
}

/// Fetches incoming NIP-61 `kind 9321` Nutzaps addressed to the wallet owner and claims unspent proofs.
pub async fn claim_incoming_nutzaps(
    database_path: String,
    nsec_or_hex: String,
    relays: Vec<String>,
    master_key_b64: Option<String>,
) -> Result<NutzapClaimResultDto, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|e| format!("Invalid Nostr key for claiming Nutzaps: {e}"))?;
    let pubkey_hex = keys.public_key().to_hex();

    let store = CashuWalletStore::open(&database_path).map_err(|e| e.to_string())?;
    let mut wallet = match store
        .load_wallet_with_master_key(&pubkey_hex, master_key_b64.as_deref())
        .map_err(|e| e.to_string())?
    {
        Some(existing) => existing,
        None => default_wallet_for(&pubkey_hex, Vec::new(), relays.clone()),
    };

    let mut effective_relays = normalize_relays_with_fallback(&wallet.relays);
    for r in relays {
        let clean = r.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://"))
            && !effective_relays.contains(&clean)
        {
            effective_relays.push(clean);
        }
    }

    let client = super::relay_pool::shared_client(&effective_relays).await?;
    let filter = Filter::new()
        .kind(Kind::CashuNutZap)
        .pubkey(keys.public_key())
        .limit(100);
    let events = client
        .fetch_events_from(
            &effective_relays,
            filter,
            Duration::from_secs(RELAY_FETCH_TIMEOUT_SECS),
        )
        .await
        .map_err(|e| format!("Failed to fetch incoming NIP-61 Nutzaps: {e}"))?;

    let already_claimed: HashSet<String> = wallet
        .history
        .iter()
        .filter_map(|h| h.event_id.clone())
        .collect();

    let http = build_http_client()?;
    let mut claimed_count = 0u64;
    let mut claimed_sats = 0u64;
    let mut failed_count = 0u64;

    for ev in events.into_iter() {
        let ev_hex = ev.id.to_hex();
        if already_claimed.contains(&ev_hex) {
            continue;
        }
        let Ok((mint_url, incoming_proofs)) = parse_nip61_nutzap_event(&ev) else {
            failed_count += 1;
            continue;
        };

        let Ok(keyset) = fetch_active_sat_keyset(&http, &mint_url).await else {
            failed_count += 1;
            continue;
        };
        let secrets: Vec<String> = incoming_proofs.iter().map(|p| p.secret.clone()).collect();
        if let Ok(states) = post_checkstate(&http, &mint_url, &secrets).await {
            if states
                .iter()
                .all(|s| s.state.eq_ignore_ascii_case("SPENT"))
            {
                continue;
            }
        }

        let total_in: u64 = incoming_proofs
            .iter()
            .fold(0u64, |acc, p| acc.saturating_add(p.amount));
        let fee = compute_input_fee_sats(incoming_proofs.len(), keyset.input_fee_ppk);
        let Some(claimable) = total_in.checked_sub(fee).filter(|&v| v > 0) else {
            failed_count += 1;
            continue;
        };

        let available: Vec<u64> = keyset.keys.keys().copied().collect();
        let Ok(split) = split_amount_for_keyset(claimable, &available) else {
            failed_count += 1;
            continue;
        };
        let Ok((outputs, blindings)) = prepare_blinded_outputs(&split, &keyset.id, None) else {
            failed_count += 1;
            continue;
        };
        let Ok(inputs) = proofs_to_wire(&incoming_proofs, Some(&wallet.p2pk_privkey_hex)) else {
            failed_count += 1;
            continue;
        };
        let Ok(signatures) = post_swap(&http, &mint_url, &inputs, &outputs).await else {
            failed_count += 1;
            continue;
        };
        let Ok(fresh_proofs) =
            unblind_signatures_to_proofs(&signatures, &blindings, &keyset.keys, &mint_url)
        else {
            failed_count += 1;
            continue;
        };

        if !wallet.mints.contains(&mint_url) {
            wallet.mints.push(mint_url.clone());
        }
        if wallet.default_mint.is_none() {
            wallet.default_mint = Some(mint_url.clone());
        }
        merge_unique_proofs(&mut wallet, fresh_proofs);
        wallet.history.push(CashuHistoryRecord {
            id: make_record_id("nz-in"),
            direction: "in".to_owned(),
            amount_sats: claimable,
            mint_url,
            unit: "sat".to_owned(),
            memo: if ev.content.trim().is_empty() {
                None
            } else {
                Some(ev.content.clone())
            },
            event_id: Some(ev_hex),
            counterparty_pubkey: Some(ev.pubkey.to_hex()),
            created_at: ev.created_at.as_secs(),
        });

        // Best-effort NIP-60 redeemed history publish.
        if let Ok(hist_builder) = build_nip60_history_event(
            &keys,
            TransactionDirection::In,
            claimable,
            &[],
            &[],
            &[ev.id],
        ) {
            if let Ok(signed) = hist_builder.sign_with_keys(&keys) {
                let _ = client.send_event(&signed).await;
            }
        }

        claimed_count += 1;
        claimed_sats = claimed_sats.saturating_add(claimable);
    }

    let wallet_state = save_updated_wallet(&store, &mut wallet, master_key_b64.as_deref())?;
    Ok(NutzapClaimResultDto {
        claimed_count,
        claimed_sats,
        failed_count,
        wallet_state,
    })
}

// ---------------------------------------------------------------------------
// Comprehensive Unit Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;

    #[test]
    fn nut00_hash_to_curve_is_deterministic_and_valid_point() {
        let p1 = hash_to_curve(b"earthly-cashu-secret-01").unwrap();
        let p2 = hash_to_curve(b"earthly-cashu-secret-01").unwrap();
        let p3 = hash_to_curve(b"earthly-cashu-secret-02").unwrap();
        assert_eq!(p1, p2);
        assert_ne!(p1, p3);
        assert_eq!(p1.serialize()[0], 0x02);
    }

    #[test]
    fn nut00_bdhke_round_trip_with_mock_mint_key() {
        let secp = Secp256k1::new();
        let mint_sk = SecretKey::from_slice(&[0x11u8; 32]).unwrap();
        let mint_pk = PublicKey::from_secret_key(&secp, &mint_sk);

        let secret = b"cashu-bdhke-deterministic-secret";
        let blinding = SecretKey::from_slice(&[0x22u8; 32]).unwrap();
        let (b_bar, r) = blind_message(secret, Some(blinding)).unwrap();

        // Mint signs blinded message: C_ = k * B_
        let c_bar = b_bar.mul_tweak(&secp, &Scalar::from(mint_sk)).unwrap();

        // Client unblinds: C = C_ - r * K
        let c = unblind_signature(&c_bar, &r, &mint_pk).unwrap();

        // Mint verifies: C == k * Y
        let y = hash_to_curve(secret).unwrap();
        let expected_c = y.mul_tweak(&secp, &Scalar::from(mint_sk)).unwrap();
        assert_eq!(c, expected_c);
    }

    #[test]
    fn nut02_derive_keyset_id_is_deterministic_and_ordered() {
        let secp = Secp256k1::new();
        let pk1 = PublicKey::from_secret_key(&secp, &SecretKey::from_slice(&[1u8; 32]).unwrap());
        let pk2 = PublicKey::from_secret_key(&secp, &SecretKey::from_slice(&[2u8; 32]).unwrap());
        let pk4 = PublicKey::from_secret_key(&secp, &SecretKey::from_slice(&[4u8; 32]).unwrap());

        let mut map_a = BTreeMap::new();
        map_a.insert(4, pk4);
        map_a.insert(1, pk1);
        map_a.insert(2, pk2);

        let mut map_b = BTreeMap::new();
        map_b.insert(1, pk1);
        map_b.insert(2, pk2);
        map_b.insert(4, pk4);

        let id_a = derive_keyset_id(&map_a);
        let id_b = derive_keyset_id(&map_b);
        assert_eq!(id_a, id_b);
        assert_eq!(id_a.len(), 16);
        assert!(id_a.starts_with("00"));
    }

    #[test]
    fn cashu_v3_token_encode_and_decode_round_trip() {
        let proofs = vec![
            CashuProofRecord {
                id: "009a1f293253e41e".to_owned(),
                amount: 8,
                secret: "sec-8".to_owned(),
                c: "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                token_event_id: None,
            },
            CashuProofRecord {
                id: "009a1f293253e41e".to_owned(),
                amount: 4,
                secret: "sec-4".to_owned(),
                c: "03bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                token_event_id: None,
            },
        ];

        let encoded =
            encode_cashu_v3_token("https://mint.earthly.city/", &proofs, Some("coffee"), Some("sat"))
                .unwrap();
        assert!(encoded.starts_with("cashuA"));

        let decoded = decode_cashu_v3_token(&encoded).unwrap();
        assert_eq!(decoded.unit, "sat");
        assert_eq!(decoded.memo.as_deref(), Some("coffee"));
        assert_eq!(decoded.entries.len(), 1);
        assert_eq!(decoded.entries[0].0, "https://mint.earthly.city");
        assert_eq!(decoded.entries[0].1, proofs);

        assert!(decode_cashu_v3_token("cashuBinvalid").is_err());
        assert!(decode_cashu_v3_token("notatoken").is_err());
    }

    #[test]
    fn power_of_two_split_and_greedy_coin_selection() {
        assert_eq!(split_amount_powers_of_two(0), Vec::<u64>::new());
        assert_eq!(split_amount_powers_of_two(13), vec![1, 4, 8]);
        assert_eq!(split_amount_powers_of_two(21), vec![1, 4, 16]);

        let available = [1, 2, 4, 8, 16, 32];
        assert_eq!(split_amount_for_keyset(21, &available).unwrap(), vec![1, 4, 16]);

        let proofs = vec![
            CashuProofRecord {
                id: "k1".to_owned(),
                amount: 2,
                secret: "s2".to_owned(),
                c: "c2".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                token_event_id: None,
            },
            CashuProofRecord {
                id: "k1".to_owned(),
                amount: 8,
                secret: "s8".to_owned(),
                c: "c8".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                token_event_id: None,
            },
            CashuProofRecord {
                id: "k1".to_owned(),
                amount: 4,
                secret: "s4".to_owned(),
                c: "c4".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                token_event_id: None,
            },
        ];

        // Exact single proof match
        let exact = select_proofs_for_amount(&proofs, 8, 0).unwrap();
        assert_eq!(exact.total_amount, 8);
        assert_eq!(exact.selected.len(), 1);

        // Exact multi-proof match (4 + 2 = 6)
        let multi = select_proofs_for_amount(&proofs, 6, 0).unwrap();
        assert_eq!(multi.total_amount, 6);

        // Overshoot minimization: [2, 8] for target 5 chooses [8] over [2, 8]
        let sparse = vec![proofs[0].clone(), proofs[1].clone()];
        let minimal = select_proofs_for_amount(&sparse, 5, 0).unwrap();
        assert_eq!(minimal.total_amount, 8);
        assert_eq!(minimal.selected.len(), 1);

        // Insufficient funds fails cleanly
        assert!(select_proofs_for_amount(&proofs, 50, 0).is_err());
    }

    #[test]
    fn nip60_nip44_self_encryption_round_trip() {
        let keys = Keys::generate();
        let p2pk_sk = "11".repeat(32);
        let mints = vec!["https://mint.earthly.city".to_owned()];
        let relays = vec!["wss://relay.earthly.city".to_owned()];

        let wallet_ev = build_nip60_wallet_event(&keys, &p2pk_sk, &mints, &relays)
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(wallet_ev.kind, Kind::CashuWallet);
        assert!(!wallet_ev.content.contains(&p2pk_sk));

        let wallet_plain =
            nip44::decrypt(keys.secret_key(), &keys.public_key(), &wallet_ev.content).unwrap();
        let parsed_wallet = parse_nip60_wallet_content(&wallet_plain).unwrap();
        assert_eq!(parsed_wallet.privkey.as_deref(), Some(p2pk_sk.as_str()));
        assert_eq!(parsed_wallet.mints, mints);
        assert_eq!(parsed_wallet.relays, relays);

        let proof = CashuProofRecord {
            id: "009a1f293253e41e".to_owned(),
            amount: 16,
            secret: "nip60-secret".to_owned(),
            c: "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            mint_url: "https://mint.earthly.city".to_owned(),
            token_event_id: None,
        };
        let token_ev = build_nip60_token_event(&keys, "https://mint.earthly.city", &[proof], &[])
            .unwrap()
            .sign_with_keys(&keys)
            .unwrap();
        assert_eq!(token_ev.kind, Kind::CashuWalletUnspentProof);
        assert!(!token_ev.content.contains("nip60-secret"));

        let token_plain =
            nip44::decrypt(keys.secret_key(), &keys.public_key(), &token_ev.content).unwrap();
        assert!(token_plain.contains(r#""C":"#));
        let parsed_token: Nip60TokenContent = serde_json::from_str(&token_plain).unwrap();
        assert_eq!(parsed_token.mint, "https://mint.earthly.city");
        assert_eq!(parsed_token.proofs.len(), 1);
        assert_eq!(parsed_token.proofs[0].amount, 16);
        assert_eq!(parsed_token.proofs[0].secret, "nip60-secret");
        assert!(parsed_token.del.is_empty());

        let hist_ev = build_nip60_history_event(
            &keys,
            TransactionDirection::In,
            16,
            &[token_ev.id],
            &[],
            &[],
        )
        .unwrap()
        .sign_with_keys(&keys)
        .unwrap();
        assert_eq!(hist_ev.kind, Kind::CashuWalletSpendingHistory);
        let parsed_hist = SpendingHistory::from_spending_history_event(
            keys.secret_key(),
            &keys.public_key(),
            &hist_ev,
        )
        .unwrap();
        assert_eq!(parsed_hist.direction, TransactionDirection::In);
        assert_eq!(parsed_hist.amount, 16);
        assert_eq!(parsed_hist.created, vec![token_ev.id]);
    }

    #[test]
    fn nip60_parses_standard_uppercase_c_omitted_del_and_17375_relays() {
        // Real-world NIP-60 kind 7375 JSON uses uppercase "C", omits "del", and may include "dleq".
        let raw_7375 = r#"{
            "mint": "https://mint.minibits.cash/Bitcoin/",
            "unit": "sat",
            "proofs": [
                {
                    "id": "00ad268c4d1f5826",
                    "amount": 64,
                    "secret": "secret-a",
                    "C": "021111111111111111111111111111111111111111111111111111111111111111",
                    "dleq": {"e": "aa", "s": "bb", "r": "cc"}
                },
                {
                    "id": "00ad268c4d1f5826",
                    "amount": 32,
                    "secret": "secret-b",
                    "C": "032222222222222222222222222222222222222222222222222222222222222222",
                    "witness": "{\"signatures\":[\"sig\"]}"
                }
            ]
        }"#;
        let parsed_tok: Nip60TokenContent = serde_json::from_str(raw_7375).unwrap();
        assert_eq!(parsed_tok.mint, "https://mint.minibits.cash/Bitcoin/");
        assert!(parsed_tok.del.is_empty());
        assert_eq!(parsed_tok.proofs.len(), 2);
        assert_eq!(parsed_tok.proofs[0].amount, 64);
        assert_eq!(
            parsed_tok.proofs[0].c,
            "021111111111111111111111111111111111111111111111111111111111111111"
        );
        assert_eq!(
            parsed_tok.proofs[1].witness.as_deref(),
            Some("{\"signatures\":[\"sig\"]}")
        );

        // Kind 17375 without privkey, with multiple relays and mints.
        let raw_17375 = r#"[
            ["mint", "https://mint.minibits.cash/Bitcoin/"],
            ["relay", "wss://relay.damus.io"],
            ["relay", "wss://nos.lol"],
            ["relay", "invalid-not-ws"]
        ]"#;
        let parsed_wallet = parse_nip60_wallet_content(raw_17375).unwrap();
        assert_eq!(parsed_wallet.privkey, None);
        assert_eq!(
            parsed_wallet.mints,
            vec!["https://mint.minibits.cash/Bitcoin"]
        );
        assert_eq!(
            parsed_wallet.relays,
            vec!["wss://relay.damus.io", "wss://nos.lol"]
        );
        assert_eq!(
            parse_nip60_wallet_relays_from_json(raw_17375.to_owned()),
            vec!["wss://relay.damus.io", "wss://nos.lol"]
        );
    }

    #[tokio::test]
    async fn apply_decrypted_nip60_sync_prunes_deleted_and_sums_multi_mint_sats() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("nip60_sync.sqlite3");
        let db_str = db.to_string_lossy().to_string();
        let keys = Keys::generate();
        let pubkey = keys.public_key().to_hex();
        let p2pk_sk = "22".repeat(32);

        let mint_a = "https://127.0.0.1:19991";
        let mint_b = "https://127.0.0.1:19992";

        let ev_old = "a".repeat(64);
        let ev_kind5_deleted = "b".repeat(64);
        let ev_live_a = "c".repeat(64);
        let ev_live_b = "d".repeat(64);
        let ev_hist = "e".repeat(64);

        // Pre-seed local stale proof referencing ev_kind5_deleted so we verify stale pruning.
        {
            let store = CashuWalletStore::open(&db_str).unwrap();
            let mut initial = default_wallet_for(&pubkey, vec![mint_a.to_owned()], vec![]);
            initial.proofs.push(CashuProofRecord {
                id: "k_old".to_owned(),
                amount: 999,
                secret: "stale-secret".to_owned(),
                c: "0200".to_owned(),
                mint_url: mint_a.to_owned(),
                token_event_id: Some(ev_kind5_deleted.clone()),
            });
            store.save_wallet(&initial).unwrap();
        }

        let wallet_json = serde_json::json!([
            ["privkey", p2pk_sk],
            ["mint", format!("{mint_a}/")],
            ["mint", mint_b],
            ["relay", "wss://relay.earthly.city"],
            ["relay", "wss://relay.damus.io"]
        ])
        .to_string();

        // ev_old is destroyed via `del` in ev_live_a; ev_kind5_deleted is deleted via kind 5.
        let tok_old_json = serde_json::json!({
            "mint": mint_a,
            "proofs": [{"id": "k1", "amount": 500, "secret": "old-sec", "C": "02aa"}]
        })
        .to_string();
        let tok_kind5_json = serde_json::json!({
            "mint": mint_a,
            "proofs": [{"id": "k1", "amount": 250, "secret": "k5-sec", "C": "02bb"}]
        })
        .to_string();
        let tok_live_a_json = serde_json::json!({
            "mint": format!("{mint_a}/"),
            "proofs": [
                {"id": "k1", "amount": 100, "secret": "live-a1", "C": "02cc"},
                {"id": "k1", "amount": 25, "secret": "live-a2", "C": "02dd"}
            ],
            "del": [ev_old]
        })
        .to_string();
        let tok_live_b_json = serde_json::json!({
            "mint": mint_b,
            "unit": "sat",
            "proofs": [
                {"id": "k2", "amount": 75, "secret": "live-b1", "C": "03ee"}
            ]
        })
        .to_string();
        let hist_json = serde_json::json!([
            ["direction", "in"],
            ["amount", "200"],
            ["unit", "sat"],
            ["e", ev_live_a, "", "created"]
        ])
        .to_string();

        let state = apply_decrypted_nip60_sync(
            db_str.clone(),
            pubkey.clone(),
            vec!["wss://relay.earthly.city".to_owned()],
            Some(wallet_json),
            vec![
                DecryptedNip60EventDto {
                    event_id: ev_old,
                    created_at: 100,
                    decrypted_json: tok_old_json,
                },
                DecryptedNip60EventDto {
                    event_id: ev_kind5_deleted.clone(),
                    created_at: 110,
                    decrypted_json: tok_kind5_json,
                },
                DecryptedNip60EventDto {
                    event_id: ev_live_a,
                    created_at: 120,
                    decrypted_json: tok_live_a_json,
                },
                DecryptedNip60EventDto {
                    event_id: ev_live_b,
                    created_at: 130,
                    decrypted_json: tok_live_b_json,
                },
            ],
            vec![DecryptedNip60EventDto {
                event_id: ev_hist,
                created_at: 135,
                decrypted_json: hist_json,
            }],
            vec![ev_kind5_deleted],
            None,
        )
        .await
        .unwrap();

        assert_eq!(state.balance_sats, 200);
        assert_eq!(state.proof_count, 3);
        assert_eq!(state.mints, vec![mint_a, mint_b]);
        assert_eq!(
            state.relays,
            vec!["wss://relay.earthly.city", "wss://relay.damus.io"]
        );
        assert_eq!(state.mint_balances.len(), 2);
        assert_eq!(state.mint_balances[0].mint_url, mint_a);
        assert_eq!(state.mint_balances[0].balance_sats, 125);
        assert_eq!(state.mint_balances[0].proof_count, 2);
        assert_eq!(state.mint_balances[1].mint_url, mint_b);
        assert_eq!(state.mint_balances[1].balance_sats, 75);
        assert_eq!(state.mint_balances[1].proof_count, 1);
        assert_eq!(state.history.len(), 1);
        assert_eq!(state.history[0].direction, "in");
        assert_eq!(state.history[0].amount_sats, 200);
    }

    #[test]
    fn nip61_nutzap_info_and_nutzap_event_building_and_p2pk_witness() {
        let sender = Keys::generate();
        let recipient = Keys::generate();
        let (p2pk_sk, p2pk_pk) = generate_p2pk_keypair_hex();

        let info_ev = build_nip61_nutzap_info_event(
            &p2pk_pk,
            &["https://mint.earthly.city".to_owned()],
            &["wss://relay.earthly.city".to_owned()],
        )
        .unwrap()
        .sign_with_keys(&recipient)
        .unwrap();
        assert_eq!(info_ev.kind, Kind::CashuNutZapInfo);

        let parsed_info = parse_nip61_nutzap_info_event(&info_ev).unwrap();
        assert_eq!(parsed_info.pubkey_hex, recipient.public_key().to_hex());
        assert_eq!(parsed_info.p2pk_pubkey_hex, p2pk_pk);
        assert_eq!(parsed_info.mints, vec!["https://mint.earthly.city"]);
        assert_eq!(parsed_info.relays, vec!["wss://relay.earthly.city"]);

        let locked_secret = build_nut11_p2pk_secret(&p2pk_pk).unwrap();
        let proof = CashuProofRecord {
            id: "009a1f293253e41e".to_owned(),
            amount: 21,
            secret: locked_secret.clone(),
            c: "02cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc".to_owned(),
            mint_url: "https://mint.earthly.city".to_owned(),
            token_event_id: None,
        };

        let target_id = EventId::all_zeros().to_hex();
        let nutzap_ev = build_nip61_nutzap_event(
            &recipient.public_key().to_hex(),
            "https://mint.earthly.city",
            &[proof],
            Some("great trail map!"),
            Some(&target_id),
        )
        .unwrap()
        .sign_with_keys(&sender)
        .unwrap();
        assert_eq!(nutzap_ev.kind, Kind::CashuNutZap);
        assert_eq!(nutzap_ev.content, "great trail map!");

        let (parsed_mint, parsed_proofs) = parse_nip61_nutzap_event(&nutzap_ev).unwrap();
        assert_eq!(parsed_mint, "https://mint.earthly.city");
        assert_eq!(parsed_proofs.len(), 1);
        assert_eq!(parsed_proofs[0].amount, 21);

        // Verify recipient can sign NUT-11 P2PK witness with Schnorr
        let mut wire = proofs_to_wire(&parsed_proofs, Some(&p2pk_sk)).unwrap();
        assert!(wire[0].witness.is_some());
        let witness_val: serde_json::Value =
            serde_json::from_str(wire[0].witness.as_deref().unwrap()).unwrap();
        let sig_hex = witness_val["signatures"][0].as_str().unwrap();
        assert_eq!(sig_hex.len(), 128);

        // Wrong P2PK key fails closed
        let wrong_sk = "99".repeat(32);
        assert!(sign_p2pk_proof_if_needed(&mut wire[0], &wrong_sk).is_err());
    }

    #[test]
    fn ffi_wallet_init_add_remove_and_encrypted_persistence() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("ffi_wallet.sqlite3");
        let db_str = db.to_string_lossy().to_string();
        let master_key = BASE64_STANDARD.encode([0x42u8; 32]);
        let pubkey = "d".repeat(64);

        let initial = load_cashu_wallet_state(
            db_str.clone(),
            pubkey.clone(),
            Some(master_key.clone()),
        )
        .unwrap();
        assert_eq!(initial.balance_sats, 0);
        assert!(initial.p2pk_pubkey_hex.is_empty());

        let created = init_cashu_wallet(
            db_str.clone(),
            pubkey.clone(),
            vec!["https://mint.earthly.city/".to_owned()],
            vec!["wss://relay.earthly.city".to_owned()],
            Some(master_key.clone()),
        )
        .unwrap();
        assert_eq!(created.mints, vec!["https://mint.earthly.city"]);
        assert_eq!(created.p2pk_pubkey_hex.len(), 66);

        let added = add_cashu_mint(
            db_str.clone(),
            pubkey.clone(),
            "https://mint2.example.com".to_owned(),
            Some(master_key.clone()),
        )
        .unwrap();
        assert_eq!(
            added.mints,
            vec![
                "https://mint.earthly.city",
                "https://mint2.example.com"
            ]
        );

        let removed = remove_cashu_mint(
            db_str.clone(),
            pubkey.clone(),
            "https://mint2.example.com".to_owned(),
            Some(master_key.clone()),
        )
        .unwrap();
        assert_eq!(removed.mints, vec!["https://mint.earthly.city"]);

        // Wrong key fails closed
        let wrong_key = BASE64_STANDARD.encode([0x99u8; 32]);
        assert!(load_cashu_wallet_state(db_str, pubkey, Some(wrong_key)).is_err());
    }
}
