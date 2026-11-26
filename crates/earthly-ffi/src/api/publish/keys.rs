//! Local Nostr keypair generation, nsec import, and event signing.

use nostr::nips::nip19::ToBech32;
use nostr::{JsonUtil, Keys, UnsignedEvent};

#[derive(Clone, Debug)]
pub struct LocalKeypairDto {
    pub pubkey_hex: String,
    pub npub: String,
    pub nsec: String,
}

/// Generates a fresh Nostr keypair for Desktop (macOS/Linux/Windows) or offline
/// Field Session testing where Android NIP-55 Amber is not available.
pub fn generate_local_nostr_keypair() -> Result<LocalKeypairDto, String> {
    let keys = Keys::generate();
    let pubkey_hex = keys.public_key().to_hex();
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode npub: {e}"))?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode nsec: {e}"))?;
    Ok(LocalKeypairDto {
        pubkey_hex,
        npub,
        nsec,
    })
}

/// Validates and imports an existing `nsec1...` (or 64-char hex secret key),
/// returning its canonical `pubkey_hex`, `npub`, and `nsec` for persistent storage.
pub fn import_local_nostr_nsec(nsec_or_hex: String) -> Result<LocalKeypairDto, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|err| format!("invalid Nostr secret key: {err}"))?;
    let pubkey_hex = keys.public_key().to_hex();
    let npub = keys
        .public_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode npub: {e}"))?;
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("failed to encode nsec: {e}"))?;
    Ok(LocalKeypairDto {
        pubkey_hex,
        npub,
        nsec,
    })
}

/// Parses an `nsec1...` or 64-char hex secret key and signs an unsigned Nostr
/// event JSON cleanly in Rust.
pub async fn sign_event_with_nsec(
    nsec_or_hex: String,
    unsigned_event_json: String,
) -> Result<String, String> {
    let keys = Keys::parse(nsec_or_hex.trim())
        .map_err(|err| format!("invalid Nostr secret key: {err}"))?;
    let mut unsigned = UnsignedEvent::from_json(&unsigned_event_json)
        .map_err(|err| format!("invalid unsigned event JSON: {err}"))?;
    unsigned.pubkey = keys.public_key();
    unsigned.ensure_id();
    let signed = unsigned
        .sign(&keys)
        .await
        .map_err(|err| format!("failed to sign event: {err}"))?;
    Ok(signed.as_json())
}
