use std::error::Error;
use std::io::{self, Write};
use std::path::PathBuf;
use std::time::Duration;

use earthly_local_node::{
    LocalNode, NodeAvailability, NodeBind, NodeConfig, PairingCapability, PairingStatus,
};
use nostr::EventId;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let mut args = std::env::args_os().skip(1);
    let data_dir = args.next().map(PathBuf::from).ok_or(
        "usage: cargo run -p earthly-local-node --example pairing_host -- DATA_DIR [INVITE_FILE] [BIND_IP]",
    )?;
    let invitation_file = args.next().map(PathBuf::from);
    let bind_ip = args
        .next()
        .map(|value| value.to_string_lossy().parse())
        .transpose()?;
    let mut config =
        NodeConfig::loopback(data_dir, NodeAvailability::Process).with_ephemeral_ports();
    if let Some(bind_ip) = bind_ip {
        config.bind = NodeBind::LocalNetwork(bind_ip);
    }
    let node = LocalNode::start(config).await?;
    let invitation = node
        .create_pairing_invitation(Duration::from_secs(120), PairingCapability::initial_set())
        .await?;

    let encoded_invitation = invitation.encode()?;
    if let Some(path) = invitation_file {
        write_invitation(path, &encoded_invitation)?;
    }
    println!("HOST_NODE={}", node.descriptor().node_id);
    println!("HOST_RELAY={}", node.descriptor().relay_url);
    println!("HOST_BLOSSOM={}", node.descriptor().blossom_url);
    println!("INVITATION={encoded_invitation}");
    println!("HOST_STATE=waiting-for-signed-claim");
    io::stdout().flush()?;

    loop {
        if let Some(claim) = node.pending_pairing_claims().await?.into_iter().next() {
            println!("CLAIM_PEER={}", claim.peer_pubkey);
            println!("CLAIM_CAPABILITIES={:?}", claim.requested_capabilities);
            let claim_id = EventId::from_hex(&claim.claim_id)?;
            let approved = node.approve_pairing_claim(claim_id).await?;
            if node.pairing_status(claim_id).await? != PairingStatus::Accepted {
                return Err("claim did not reach accepted state".into());
            }
            println!("HOST_STATE=approved:{}", approved.claim_id);
            println!("HOST_STATE=serving-paired-peer");
            io::stdout().flush()?;
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    std::future::pending::<()>().await;
    Ok(())
}

fn write_invitation(path: PathBuf, invitation: &str) -> Result<(), Box<dyn Error>> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(invitation.as_bytes())?;
    file.sync_all()?;
    Ok(())
}
