//! NIP-46 Nostr Remote Bunker Signer (`bunker://...`) powered by `nostr-connect`.
//!
//! Works identically on macOS Desktop and Android, allowing remote hardware /
//! nsecBunker / Amber-bunker signing for all Earthly events AND MLS Circles.

use std::time::Duration;

use earthly_mls::envelope::{parse_nostr_tags, NostrEventSigner};
use nostr::nips::nip19::ToBech32;
use nostr::nips::nip46::NostrConnectURI;
use nostr::signer::NostrSigner;
use nostr::{Event, JsonUtil, Keys, Kind, PublicKey, RelayUrl, SecretKey, Timestamp, UnsignedEvent};
use nostr_connect::client::NostrConnect;

const NIP46_TIMEOUT_SECS: u64 = 45;

#[derive(Clone, Debug)]
pub struct Nip46ClientOfferDto {
    pub connect_uri: String,
    pub client_nsec: String,
    pub relays: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct Nip46ConnectionDto {
    pub user_pubkey_hex: String,
    pub user_npub: String,
    pub bunker_uri: String,
    pub client_nsec: String,
    pub relays: Vec<String>,
}

/// Validates and parses a `bunker://...` URI and optional persisted client secret key.
pub(crate) fn build_nostr_connect(
    bunker_uri: &str,
    client_nsec: Option<&str>,
) -> Result<(NostrConnect, Keys, Vec<String>), String> {
    let trimmed = bunker_uri.trim();
    if !trimmed.starts_with("bunker://") {
        return Err("Remote signer URI must start with bunker://".to_owned());
    }
    let uri = NostrConnectURI::parse(trimmed)
        .map_err(|e| format!("Invalid NIP-46 bunker URI: {e}"))?;
    let relays: Vec<String> = uri.relays().iter().map(|r| r.to_string()).collect();
    if relays.is_empty() {
        return Err("NIP-46 bunker URI must include at least one ?relay=wss://... parameter".to_owned());
    }
    let client_keys = match client_nsec.map(str::trim).filter(|s| !s.is_empty()) {
        Some(secret) => {
            let sk = SecretKey::parse(secret)
                .map_err(|e| format!("Invalid NIP-46 client key: {e}"))?;
            Keys::new(sk)
        }
        None => Keys::generate(),
    };
    let connect = NostrConnect::new(
        uri,
        client_keys.clone(),
        Duration::from_secs(NIP46_TIMEOUT_SECS),
        None,
    )
    .map_err(|e| format!("Failed to initialize NIP-46 client: {e}"))?;
    Ok((connect, client_keys, relays))
}

/// Connects to a NIP-46 remote signer via `bunker://...`, resolves the remote
/// user's public key, and returns persisted client credentials for future signing.
pub async fn connect_nip46_bunker(
    bunker_uri: String,
    client_nsec: Option<String>,
) -> Result<Nip46ConnectionDto, String> {
    let (connect, client_keys, relays) =
        build_nostr_connect(&bunker_uri, client_nsec.as_deref())?;
    let user_pk = connect
        .get_public_key()
        .await
        .map_err(|e| format!("NIP-46 remote signer handshake failed: {e}"))?;
    let resolved_uri = connect
        .bunker_uri()
        .await
        .map(|u| u.to_string())
        .unwrap_or_else(|_| bunker_uri.trim().to_owned());
    connect.shutdown().await;

    let user_npub = user_pk
        .to_bech32()
        .unwrap_or_else(|_| user_pk.to_hex());
    let persisted_client_nsec = client_keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("Failed to encode NIP-46 client key: {e}"))?;

    Ok(Nip46ConnectionDto {
        user_pubkey_hex: user_pk.to_hex(),
        user_npub,
        bunker_uri: resolved_uri,
        client_nsec: persisted_client_nsec,
        relays,
    })
}

/// Generates an ephemeral `nostrconnect://` client URI + secret keypair so a
/// remote signer app (Amber, nsecBunker, Coracle) can scan the QR code and
/// initiate the NIP-46 session.
pub fn create_nostrconnect_offer(
    relays: Vec<String>,
    app_name: Option<String>,
) -> Result<Nip46ClientOfferDto, String> {
    let mut relay_strings: Vec<String> = relays
        .into_iter()
        .map(|r| r.trim().to_owned())
        .filter(|r| r.starts_with("wss://") || r.starts_with("ws://"))
        .collect();
    if relay_strings.is_empty() {
        relay_strings.push("wss://relay.earthly.city".to_owned());
    }
    let mut parsed_relays = Vec::with_capacity(relay_strings.len());
    for raw in &relay_strings {
        let parsed = RelayUrl::parse(raw)
            .map_err(|e| format!("Invalid NIP-46 relay URL `{raw}`: {e}"))?;
        parsed_relays.push(parsed);
    }

    let client_keys = Keys::generate();
    let app = app_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Earthly")
        .to_owned();
    let uri = NostrConnectURI::client(client_keys.public_key(), parsed_relays, app);
    let client_nsec = client_keys
        .secret_key()
        .to_bech32()
        .map_err(|e| format!("Failed to encode NIP-46 client key: {e}"))?;

    Ok(Nip46ClientOfferDto {
        connect_uri: uri.to_string(),
        client_nsec,
        relays: relay_strings,
    })
}

/// Awaits remote signer approval for a client-initiated `nostrconnect://` QR
/// offer, resolves the remote signer `bunker://` URI & user pubkey, and returns
/// a persisted `Nip46ConnectionDto`.
pub async fn await_nostrconnect_session(
    connect_uri: String,
    client_nsec: String,
    timeout_secs: Option<u64>,
) -> Result<Nip46ConnectionDto, String> {
    let trimmed = connect_uri.trim();
    if !trimmed.starts_with("nostrconnect://") {
        return Err("Client offer URI must start with nostrconnect://".to_owned());
    }
    let uri = NostrConnectURI::parse(trimmed)
        .map_err(|e| format!("Invalid nostrconnect URI: {e}"))?;
    let relays: Vec<String> = uri.relays().iter().map(|r| r.to_string()).collect();
    if relays.is_empty() {
        return Err("nostrconnect URI must include at least one relay".to_owned());
    }
    let sk = SecretKey::parse(client_nsec.trim())
        .map_err(|e| format!("Invalid NIP-46 client key: {e}"))?;
    let client_keys = Keys::new(sk);
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(90).clamp(15, 180));
    let connect = NostrConnect::new(uri, client_keys.clone(), timeout, None)
        .map_err(|e| format!("Failed to initialize nostrconnect session: {e}"))?;

    let user_pk = connect
        .get_public_key()
        .await
        .map_err(|e| format!("Remote signer did not approve in time: {e}"))?;
    let bunker_uri = connect
        .bunker_uri()
        .await
        .map(|u| u.to_string())
        .map_err(|e| format!("Failed to resolve bunker URI: {e}"))?;
    connect.shutdown().await;

    let user_npub = user_pk
        .to_bech32()
        .unwrap_or_else(|_| user_pk.to_hex());

    Ok(Nip46ConnectionDto {
        user_pubkey_hex: user_pk.to_hex(),
        user_npub,
        bunker_uri,
        client_nsec,
        relays,
    })
}

/// Signs an unsigned Earthly Nostr event JSON via the connected NIP-46 Bunker
/// and returns the canonical signed Nostr event JSON string.
pub async fn sign_event_with_nip46_bunker(
    bunker_uri: String,
    client_nsec: String,
    unsigned_event_json: String,
) -> Result<String, String> {
    let unsigned = UnsignedEvent::from_json(&unsigned_event_json)
        .map_err(|e| format!("Invalid unsigned Nostr event JSON: {e}"))?;
    let (connect, _, _) = build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
    let signed = connect
        .sign_event(unsigned)
        .await
        .map_err(|e| format!("NIP-46 remote signing failed: {e}"))?;
    connect.shutdown().await;
    Ok(signed.as_json())
}

/// Decrypts a NIP-44 ciphertext via the connected NIP-46 Bunker (`nip44_decrypt`).
pub async fn nip46_nip44_decrypt(
    bunker_uri: String,
    client_nsec: String,
    third_party_pubkey_hex: String,
    ciphertext: String,
) -> Result<String, String> {
    let pk = PublicKey::parse(third_party_pubkey_hex.trim())
        .map_err(|e| format!("Invalid NIP-46 third-party pubkey: {e}"))?;
    let (connect, _, _) = build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
    let res = connect
        .nip44_decrypt(&pk, &ciphertext)
        .await
        .map_err(|e| format!("NIP-46 nip44_decrypt failed: {e}"));
    connect.shutdown().await;
    res
}

/// Encrypts a plaintext payload via NIP-44 using the connected NIP-46 Bunker (`nip44_encrypt`).
pub async fn nip46_nip44_encrypt(
    bunker_uri: String,
    client_nsec: String,
    third_party_pubkey_hex: String,
    plaintext: String,
) -> Result<String, String> {
    let pk = PublicKey::parse(third_party_pubkey_hex.trim())
        .map_err(|e| format!("Invalid NIP-46 third-party pubkey: {e}"))?;
    let (connect, _, _) = build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
    let res = connect
        .nip44_encrypt(&pk, &plaintext)
        .await
        .map_err(|e| format!("NIP-46 nip44_encrypt failed: {e}"));
    connect.shutdown().await;
    res
}

/// Adapter letting NIP-46 Bunker accounts sign MLS Circle envelopes, invitations,
/// and Cordn ContextVM RPCs seamlessly.
pub(crate) struct Nip46CircleSigner {
    bunker_uri: String,
    client_nsec: String,
    user_pubkey_hex: String,
}

impl Nip46CircleSigner {
    pub(crate) async fn connect(bunker_uri: String, client_nsec: String) -> Result<Self, String> {
        let (connect, _, _) = build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
        let pk = connect
            .get_public_key()
            .await
            .map_err(|e| format!("NIP-46 signer unavailable: {e}"))?;
        connect.shutdown().await;
        Ok(Self {
            bunker_uri,
            client_nsec,
            user_pubkey_hex: pk.to_hex(),
        })
    }
}

impl NostrEventSigner for Nip46CircleSigner {
    fn pubkey_hex(&self) -> String {
        self.user_pubkey_hex.clone()
    }

    fn sign_event_template(
        &self,
        kind: u16,
        created_at: u64,
        tags: Vec<Vec<String>>,
        content: String,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Event, String>> + Send + '_>>
    {
        let bunker_uri = self.bunker_uri.clone();
        let client_nsec = self.client_nsec.clone();
        let user_pk_hex = self.user_pubkey_hex.clone();
        Box::pin(async move {
            let pk = PublicKey::from_hex(&user_pk_hex)
                .map_err(|e| format!("Invalid NIP-46 pubkey: {e}"))?;
            let parsed_tags = parse_nostr_tags(&tags)?;
            let unsigned = UnsignedEvent::new(
                pk,
                Timestamp::from(created_at),
                Kind::Custom(kind),
                parsed_tags,
                content,
            );
            let (connect, _, _) = build_nostr_connect(&bunker_uri, Some(&client_nsec))?;
            let signed = connect
                .sign_event(unsigned)
                .await
                .map_err(|e| format!("NIP-46 signing failed: {e}"))?;
            connect.shutdown().await;
            Ok(signed)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_bunker_uris_and_missing_relays() {
        assert!(build_nostr_connect("nostrconnect://abc", None).is_err());
        assert!(build_nostr_connect(
            "bunker://79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
            None
        )
        .is_err());
        let ok = build_nostr_connect(
            "bunker://79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798?relay=wss://relay.earthly.city",
            None,
        );
        assert!(ok.is_ok());
        assert_eq!(ok.unwrap().2, vec!["wss://relay.earthly.city".to_owned()]);
    }

    #[test]
    fn generates_parseable_nostrconnect_offer_matching_client_nsec() {
        let offer = create_nostrconnect_offer(vec![], Some("Earthly Native".to_owned())).unwrap();
        assert!(offer.connect_uri.starts_with("nostrconnect://"));
        assert_eq!(offer.relays, vec!["wss://relay.earthly.city".to_owned()]);
        let parsed = NostrConnectURI::parse(&offer.connect_uri).unwrap();
        let sk = SecretKey::parse(&offer.client_nsec).unwrap();
        let keys = Keys::new(sk);
        match parsed {
            NostrConnectURI::Client { public_key, .. } => {
                assert_eq!(public_key, keys.public_key());
            }
            _ => panic!("expected NostrConnectURI::Client variant"),
        }
    }
}
