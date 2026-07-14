use std::error::Error;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use earthly_local_node::{
    PairingCapability, PairingClaimReceipt, PairingClaimRequest, PairingInvitation, PairingStatus,
    PAIRING_CLAIMS_PATH,
};
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use nostr_sdk::Client as NostrClient;
use sha2::{Digest, Sha256};

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let invitation_arg = std::env::args().nth(1).ok_or(
        "usage: cargo run -p earthly-local-node --example pairing_client -- INVITATION|@FILE",
    )?;
    let encoded = if let Some(path) = invitation_arg.strip_prefix('@') {
        std::fs::read_to_string(path)?
    } else {
        invitation_arg
    };
    let invitation = PairingInvitation::decode(&encoded)?;
    let invitation_content = invitation.content()?;
    let peer = Keys::generate();
    let capabilities = vec![
        PairingCapability::RelayWrite,
        PairingCapability::BlobRead,
        PairingCapability::BlobWrite,
    ];
    let claim = invitation.create_claim(
        &peer,
        capabilities,
        Some("Earthly pairing reference client".to_owned()),
    )?;
    let http = reqwest::Client::new();
    let claims_url = invitation_content
        .descriptor
        .blossom_url
        .join(PAIRING_CLAIMS_PATH.trim_start_matches('/'))?;
    let receipt: PairingClaimReceipt = http
        .post(claims_url.clone())
        .json(&PairingClaimRequest { claim })
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    println!("CLIENT_PUBKEY={}", peer.public_key());
    println!("CLAIM_ID={}", receipt.claim_id);
    println!("CLIENT_STATE=claim-submitted");

    let status_url = invitation_content.descriptor.blossom_url.join(&format!(
        "{}/{}",
        PAIRING_CLAIMS_PATH.trim_start_matches('/'),
        receipt.claim_id
    ))?;
    let mut accepted = false;
    for _ in 0..100 {
        let status: PairingStatus = http
            .get(status_url.clone())
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        match status {
            PairingStatus::Accepted => {
                accepted = true;
                break;
            }
            PairingStatus::Rejected { reason } => {
                return Err(format!("host rejected pairing claim: {reason}").into());
            }
            PairingStatus::Pending => tokio::time::sleep(Duration::from_millis(50)).await,
        }
    }
    if !accepted {
        return Err("host did not approve the pairing claim in time".into());
    }
    println!("CLIENT_STATE=claim-accepted");

    let nostr = NostrClient::new(peer.clone());
    nostr
        .add_relay(invitation_content.descriptor.relay_url.as_str())
        .await?;
    nostr.connect().await;
    let event = nostr
        .send_event_builder(EventBuilder::text_note(
            "Earthly signed local-node handshake proof",
        ))
        .await?;
    println!("RELAY_EVENT={}", event.id());
    nostr.disconnect().await;

    let bytes = b"earthly-offline-handshake-proof".to_vec();
    let hash = format!("{:x}", Sha256::digest(&bytes));
    let upload_url = invitation_content.descriptor.blossom_url.join("upload")?;
    http.put(upload_url)
        .header("content-type", "application/octet-stream")
        .header("x-sha-256", &hash)
        .header(
            "authorization",
            blossom_authorization(&peer, "upload", &hash)?,
        )
        .body(bytes)
        .send()
        .await?
        .error_for_status()?;
    let range = http
        .get(invitation_content.descriptor.blossom_url.join(&hash)?)
        .header("range", "bytes=8-14")
        .header("authorization", blossom_authorization(&peer, "get", &hash)?)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?;
    if range.as_ref() != b"offline" {
        return Err("Blossom range proof returned unexpected bytes".into());
    }
    println!("BLOSSOM_HASH={hash}");
    println!("BLOSSOM_RANGE=offline");
    println!("CLIENT_STATE=protocol-proof-complete");
    Ok(())
}

fn blossom_authorization(keys: &Keys, action: &str, hash: &str) -> Result<String, Box<dyn Error>> {
    let event = EventBuilder::new(Kind::Custom(24_242), format!("{action} local blob"))
        .tags([
            Tag::parse(["t", action])?,
            Tag::expiration(Timestamp::now() + 300),
            Tag::parse(["x", hash])?,
        ])
        .sign_with_keys(keys)?;
    let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&event)?);
    Ok(format!("Nostr {encoded}"))
}
