use nostr::Event;
use nostr_sdk::prelude::ClientBuilder;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{PairingCapability, PairingStatus, RemoteNodeError, RemoteNodeStore};

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePublishResult {
    pub node_id: String,
    pub event_id: String,
}

#[derive(Debug, Error)]
pub enum RemotePublishError {
    #[error(transparent)]
    RemoteNode(#[from] RemoteNodeError),
    #[error("the host has not approved this installation")]
    NotAccepted,
    #[error("the approved grant does not include relay-write access")]
    MissingRelayWrite,
    #[error("the submitted event signature is invalid: {0}")]
    InvalidEvent(String),
    #[error("remote relay publication failed: {0}")]
    Relay(String),
}

pub(crate) async fn publish_remote_event(
    keys: nostr::Keys,
    remote_nodes: &RemoteNodeStore,
    node_id: &str,
    event: Event,
) -> Result<RemotePublishResult, RemotePublishError> {
    event
        .verify()
        .map_err(|error| RemotePublishError::InvalidEvent(error.to_string()))?;
    let record = remote_nodes.get(node_id).await?;
    if record.status != PairingStatus::Accepted {
        return Err(RemotePublishError::NotAccepted);
    }
    if !record.capabilities.contains(&PairingCapability::RelayWrite) {
        return Err(RemotePublishError::MissingRelayWrite);
    }

    let relay_url = record.descriptor.relay_url.to_string();
    let client = ClientBuilder::new().signer(keys).build();
    client
        .add_relay(&relay_url)
        .await
        .map_err(|error| RemotePublishError::Relay(error.to_string()))?;
    client.connect().await;

    // A private relay can challenge the first EVENT on a fresh socket. The SDK
    // authenticates with the paired installation key; replay the immutable,
    // user-signed event once on the now-authenticated connection when needed.
    let mut last_error = None;
    for _ in 0..2 {
        match client.send_event(&event).await {
            Ok(output) if !output.success.is_empty() => {
                client.disconnect().await;
                return Ok(RemotePublishResult {
                    node_id: node_id.to_owned(),
                    event_id: event.id.to_hex(),
                });
            }
            Ok(output) => {
                last_error = Some(
                    output
                        .failed
                        .values()
                        .next()
                        .cloned()
                        .unwrap_or_else(|| "the host did not acknowledge the event".to_owned()),
                );
            }
            Err(error) => last_error = Some(error.to_string()),
        }
    }
    client.disconnect().await;
    Err(RemotePublishError::Relay(last_error.unwrap_or_else(|| {
        "the host did not acknowledge the event".to_owned()
    })))
}
