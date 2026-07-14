use nostr::PublicKey;

use crate::{
    EmbeddedBlossom, EmbeddedRelay, NodeConfig, NodeDescriptor, NodeError, NodeIdentity, PeerPolicy,
};

/// Complete running local node. Dropping it closes both listeners and releases the data lock.
#[derive(Debug)]
pub struct LocalNode {
    descriptor: NodeDescriptor,
    identity: NodeIdentity,
    peers: PeerPolicy,
    relay: EmbeddedRelay,
    blossom: EmbeddedBlossom,
}

impl LocalNode {
    pub async fn start(config: NodeConfig) -> Result<Self, NodeError> {
        config.validate()?;
        let identity = NodeIdentity::load_or_create(&config.data_dir)?;
        let peers = PeerPolicy::load(config.data_dir.join("policy").join("peers")).await?;
        let relay = EmbeddedRelay::start(&config, peers.clone()).await?;
        let blossom = EmbeddedBlossom::start(&config, peers.clone()).await?;
        let descriptor = NodeDescriptor::new(
            identity.public_key_hex(),
            relay.url().clone(),
            blossom.url().clone(),
            config.bind.scope(),
            config.availability,
        )?;

        Ok(Self {
            descriptor,
            identity,
            peers,
            relay,
            blossom,
        })
    }

    pub fn descriptor(&self) -> &NodeDescriptor {
        &self.descriptor
    }

    pub fn identity_public_key(&self) -> PublicKey {
        self.identity.public_key()
    }

    pub async fn grant_peer(&self, public_key: PublicKey) -> Result<bool, NodeError> {
        self.peers.grant(public_key).await
    }

    pub async fn revoke_peer(&self, public_key: &PublicKey) -> Result<bool, NodeError> {
        self.peers.revoke(public_key).await
    }

    pub fn shutdown(&self) {
        self.blossom.shutdown();
        self.relay.shutdown();
    }
}

impl Drop for LocalNode {
    fn drop(&mut self) {
        self.shutdown();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::NodeAvailability;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
    use sha2::{Digest, Sha256};
    use std::time::Duration;

    #[tokio::test]
    async fn starts_both_services_with_one_descriptor() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let node = LocalNode::start(config).await.unwrap();

        assert_eq!(
            node.descriptor().node_id,
            node.identity_public_key().to_hex()
        );
        assert_eq!(node.descriptor().relay_url.scheme(), "ws");
        assert_eq!(node.descriptor().blossom_url.scheme(), "http");
        node.shutdown();
    }

    #[tokio::test]
    async fn paired_http_client_uploads_ranges_and_reloads_blob_offline() {
        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let peer = Keys::generate();
        let bytes = b"earthly-offline-blob".to_vec();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let client = reqwest::Client::new();

        let first_node = LocalNode::start(config.clone()).await.unwrap();
        let rejected = client
            .put(first_node.descriptor().blossom_url.join("upload").unwrap())
            .header("content-type", "application/octet-stream")
            .header("x-sha-256", &hash)
            .header("authorization", authorization(&peer, "upload", &hash))
            .body(bytes.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(rejected.status(), reqwest::StatusCode::FORBIDDEN);

        first_node.grant_peer(peer.public_key()).await.unwrap();
        let upload = client
            .put(first_node.descriptor().blossom_url.join("upload").unwrap())
            .header("content-type", "application/octet-stream")
            .header("x-sha-256", &hash)
            .header("authorization", authorization(&peer, "upload", &hash))
            .body(bytes.clone())
            .send()
            .await
            .unwrap();
        assert_eq!(upload.status(), reqwest::StatusCode::CREATED);

        let blob_url = first_node.descriptor().blossom_url.join(&hash).unwrap();
        let partial = client
            .get(blob_url.clone())
            .header("authorization", authorization(&peer, "get", &hash))
            .header("range", "bytes=8-14")
            .send()
            .await
            .unwrap();
        assert_eq!(partial.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(partial.bytes().await.unwrap().as_ref(), b"offline");
        let node_id = first_node.descriptor().node_id.clone();
        drop(first_node);

        let second_node = LocalNode::start(config).await.unwrap();
        assert_eq!(second_node.descriptor().node_id, node_id);
        let restored = client
            .get(second_node.descriptor().blossom_url.join(&hash).unwrap())
            .header("authorization", authorization(&peer, "get", &hash))
            .send()
            .await
            .unwrap();
        assert_eq!(restored.status(), reqwest::StatusCode::OK);
        assert_eq!(restored.bytes().await.unwrap().as_ref(), bytes);
    }

    #[tokio::test]
    async fn paired_nostr_client_publishes_queries_and_reloads_event_offline() {
        use nostr_sdk::{Client, Filter};

        let dir = tempfile::tempdir().unwrap();
        let config =
            NodeConfig::loopback(dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let peer = Keys::generate();

        let first_node = LocalNode::start(config.clone()).await.unwrap();
        first_node.grant_peer(peer.public_key()).await.unwrap();
        let client = Client::new(peer.clone());
        client
            .add_relay(first_node.descriptor().relay_url.as_str())
            .await
            .unwrap();
        client.connect().await;
        let output = client
            .send_event_builder(EventBuilder::text_note("earthly offline relay proof"))
            .await
            .unwrap();
        let event_id = *output.id();
        let events = client
            .fetch_events(Filter::new().id(event_id), Duration::from_secs(2))
            .await
            .unwrap();
        assert!(events.iter().any(|event| event.id == event_id));
        client.disconnect().await;
        drop(first_node);

        let second_node = LocalNode::start(config).await.unwrap();
        let restored_client = Client::new(peer);
        restored_client
            .add_relay(second_node.descriptor().relay_url.as_str())
            .await
            .unwrap();
        restored_client.connect().await;
        let restored = restored_client
            .fetch_events(Filter::new().id(event_id), Duration::from_secs(2))
            .await
            .unwrap();
        assert!(restored.iter().any(|event| event.id == event_id));
        restored_client.disconnect().await;
    }

    fn authorization(keys: &Keys, action: &str, hash: &str) -> String {
        let event = EventBuilder::new(Kind::Custom(24_242), format!("{action} local blob"))
            .tags([
                Tag::parse(["t", action]).unwrap(),
                Tag::expiration(Timestamp::now() + 300),
                Tag::parse(["x", hash]).unwrap(),
            ])
            .sign_with_keys(keys)
            .unwrap();
        let encoded = URL_SAFE_NO_PAD.encode(serde_json::to_vec(&event).unwrap());
        format!("Nostr {encoded}")
    }
}
