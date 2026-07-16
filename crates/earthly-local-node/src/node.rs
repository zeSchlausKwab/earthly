use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use nostr::{Event, EventBuilder, EventId, Kind, PublicKey, Tag, Timestamp};
use serde::Serialize;

use crate::{
    BlobDescriptor, EmbeddedBlossom, EmbeddedRelay, FieldSessionInfo, LocalBlobRead,
    LocalBlobReadError, NodeConfig, NodeDescriptor, NodeError, NodeIdentity, PairingCapability,
    PairingClaimReceipt, PairingError, PairingInvitation, PairingManager, PairingStatus, PeerGrant,
    PeerPolicy, PendingPairingClaim, PublicBlobDownloadError, RemoteBlobMirrorError,
    RemoteBlobMirrorResult, RemoteNodeError, RemoteNodeRecord, RemoteNodeStore, RemotePublishError,
    RemotePublishResult, RemoteSyncError, RemoteSyncResult,
};
use tokio_util::sync::CancellationToken;

/// Complete running local node. Dropping it closes both listeners and releases the data lock.
#[derive(Debug)]
pub struct LocalNode {
    descriptor: NodeDescriptor,
    identity: NodeIdentity,
    peers: PeerPolicy,
    pairing: PairingManager,
    remote_nodes: RemoteNodeStore,
    relay: EmbeddedRelay,
    blossom: EmbeddedBlossom,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalBlobAccess {
    pub url: String,
    pub authorization: String,
    pub expires_at: u64,
}

impl LocalNode {
    pub async fn start(config: NodeConfig) -> Result<Self, NodeError> {
        config.validate()?;
        let identity = NodeIdentity::load_or_create(&config.data_dir)?;
        let peers = PeerPolicy::load(config.data_dir.join("policy").join("peers")).await?;
        let pairing = PairingManager::open(config.data_dir.join("pairing")).await?;
        let remote_nodes = RemoteNodeStore::open(config.data_dir.join("remote-nodes")).await?;
        let relay = EmbeddedRelay::start(&config, peers.clone()).await?;
        let blossom = EmbeddedBlossom::start(
            &config,
            peers.clone(),
            pairing.clone(),
            identity.public_key(),
        )
        .await?;
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
            pairing,
            remote_nodes,
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

    pub async fn create_pairing_invitation(
        &self,
        ttl: Duration,
        capabilities: Vec<PairingCapability>,
    ) -> Result<PairingInvitation, PairingError> {
        self.pairing
            .create_invitation(&self.identity, &self.descriptor, ttl, capabilities)
            .await
    }

    pub async fn create_field_session_invitation(
        &self,
        ttl: Duration,
        capabilities: Vec<PairingCapability>,
        field_session: FieldSessionInfo,
    ) -> Result<PairingInvitation, PairingError> {
        self.pairing
            .create_invitation_for_session(
                &self.identity,
                &self.descriptor,
                ttl,
                capabilities,
                Some(field_session),
            )
            .await
    }

    pub async fn submit_pairing_claim(
        &self,
        claim: Event,
    ) -> Result<PairingClaimReceipt, PairingError> {
        self.pairing.submit_claim(claim).await
    }

    pub async fn pending_pairing_claims(&self) -> Result<Vec<PendingPairingClaim>, PairingError> {
        self.pairing.pending_claims().await
    }

    pub async fn approve_pairing_claim(
        &self,
        claim_id: EventId,
    ) -> Result<PendingPairingClaim, PairingError> {
        self.pairing.approve_claim(claim_id, &self.peers).await
    }

    pub async fn reject_pairing_claim(
        &self,
        claim_id: EventId,
        reason: impl Into<String>,
    ) -> Result<(), PairingError> {
        self.pairing.reject_claim(claim_id, reason).await
    }

    pub async fn pairing_status(&self, claim_id: EventId) -> Result<PairingStatus, PairingError> {
        self.pairing.status(claim_id).await
    }

    pub async fn peer_is_granted(&self, public_key: &PublicKey) -> bool {
        self.peers.allows(public_key).await
    }

    pub async fn peer_grants(&self) -> Vec<PeerGrant> {
        self.peers.grants().await
    }

    pub async fn join_pairing_invitation(
        &self,
        encoded: &str,
        peer_name: Option<String>,
    ) -> Result<RemoteNodeRecord, RemoteNodeError> {
        let invitation = PairingInvitation::decode(encoded)?;
        let content = invitation.validate()?;
        let claim = invitation.create_claim_with_identity(
            &self.identity,
            content.capabilities,
            peer_name,
        )?;
        self.remote_nodes.submit_claim(&invitation, claim).await
    }

    pub async fn remote_nodes(&self) -> Result<Vec<RemoteNodeRecord>, RemoteNodeError> {
        self.remote_nodes.list().await
    }

    pub fn remote_node_store(&self) -> RemoteNodeStore {
        self.remote_nodes.clone()
    }

    pub async fn refresh_remote_node(
        &self,
        node_id: &str,
    ) -> Result<RemoteNodeRecord, RemoteNodeError> {
        self.remote_nodes.refresh(node_id).await
    }

    pub async fn forget_remote_node(&self, node_id: &str) -> Result<bool, RemoteNodeError> {
        self.remote_nodes.forget(node_id).await
    }

    pub async fn sync_remote_node(
        &self,
        node_id: &str,
    ) -> Result<RemoteSyncResult, RemoteSyncError> {
        crate::remote_sync::sync_remote_node(
            self.identity.keys(),
            self.relay.database(),
            &self.remote_nodes,
            node_id,
        )
        .await
    }

    pub async fn publish_remote_event(
        &self,
        node_id: &str,
        event: Event,
    ) -> Result<RemotePublishResult, RemotePublishError> {
        let result = crate::remote_publish::publish_remote_event(
            self.identity.keys(),
            &self.remote_nodes,
            node_id,
            event.clone(),
        )
        .await?;
        // Keep the author's own installation converged immediately. This also
        // means the field-session UI survives a restart before its next pull.
        self.ingest_verified_event(&event)
            .await
            .map_err(|error| RemotePublishError::Relay(error.to_string()))?;
        Ok(result)
    }

    pub async fn field_session_events(&self, session_id: &str) -> Result<Vec<Event>, NodeError> {
        self.relay.field_session_events(session_id).await
    }

    pub async fn mirror_remote_blobs(
        &self,
        node_id: &str,
        hashes: Vec<String>,
    ) -> Result<RemoteBlobMirrorResult, RemoteBlobMirrorError> {
        crate::remote_blob::mirror_remote_blobs(
            self.identity.keys(),
            &self.blossom,
            &self.remote_nodes,
            node_id,
            hashes,
        )
        .await
    }

    pub async fn read_local_blob(
        &self,
        hash: &str,
        range_header: Option<&str>,
        include_body: bool,
        max_response_bytes: u64,
    ) -> Result<LocalBlobRead, LocalBlobReadError> {
        self.blossom
            .read_local_blob(hash, range_header, include_body, max_response_bytes)
            .await
    }

    pub fn local_blob_access(&self, hash: &str) -> Result<LocalBlobAccess, NodeError> {
        if hash.len() != 64
            || !hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(NodeError::Blossom("invalid local blob SHA-256".to_owned()));
        }
        let now = Timestamp::now();
        let expires_at = now.as_secs() + 5 * 60;
        let event = self.identity.sign(
            EventBuilder::new(
                Kind::Custom(24_242),
                "Read an immutable blob from this Earthly installation",
            )
            .tags([
                Tag::parse(["t", "get"]).map_err(|error| NodeError::Blossom(error.to_string()))?,
                Tag::expiration(Timestamp::from(expires_at)),
                Tag::parse(["x", hash]).map_err(|error| NodeError::Blossom(error.to_string()))?,
            ])
            .custom_created_at(now - 60),
        )?;
        let encoded = URL_SAFE_NO_PAD.encode(
            serde_json::to_vec(&event).map_err(|error| NodeError::Blossom(error.to_string()))?,
        );
        Ok(LocalBlobAccess {
            url: self
                .descriptor
                .blossom_url
                .join(hash)
                .map_err(|error| NodeError::Blossom(error.to_string()))?
                .to_string(),
            authorization: format!("Nostr {encoded}"),
            expires_at,
        })
    }

    pub async fn local_blob_descriptor(
        &self,
        hash: &str,
    ) -> Result<Option<BlobDescriptor>, NodeError> {
        self.blossom.local_blob_descriptor(hash).await
    }

    pub async fn download_public_blob(
        &self,
        hash: &str,
        mirror_urls: Vec<String>,
        cancellation: &CancellationToken,
        progress: Option<&(dyn Fn(u64) + Send + Sync)>,
    ) -> Result<BlobDescriptor, PublicBlobDownloadError> {
        crate::public_blob::download_public_blob(
            &self.blossom,
            hash,
            mirror_urls,
            cancellation,
            progress,
        )
        .await
    }

    pub async fn ingest_verified_event(&self, event: &Event) -> Result<bool, NodeError> {
        self.relay.ingest_verified_event(event).await
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
    async fn peer_submits_polls_and_persists_a_remote_pairing() {
        let host_dir = tempfile::tempdir().unwrap();
        let peer_dir = tempfile::tempdir().unwrap();
        let host = LocalNode::start(
            NodeConfig::loopback(host_dir.path(), NodeAvailability::Process).with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let peer_config =
            NodeConfig::loopback(peer_dir.path(), NodeAvailability::Process).with_ephemeral_ports();
        let peer = LocalNode::start(peer_config.clone()).await.unwrap();
        let invitation = host
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();

        let pending = peer
            .join_pairing_invitation(
                &invitation.encode().unwrap(),
                Some("Trail phone".to_owned()),
            )
            .await
            .unwrap();
        assert_eq!(pending.status, PairingStatus::Pending);
        assert_eq!(pending.peer_pubkey, peer.identity_public_key().to_hex());

        let claim_id = EventId::from_hex(&pending.claim_id).unwrap();
        host.approve_pairing_claim(claim_id).await.unwrap();
        let accepted = peer.refresh_remote_node(&pending.node_id).await.unwrap();
        assert_eq!(accepted.status, PairingStatus::Accepted);
        assert!(host.peer_is_granted(&peer.identity_public_key()).await);

        drop(peer);
        let restored = LocalNode::start(peer_config).await.unwrap();
        assert_eq!(restored.remote_nodes().await.unwrap(), vec![accepted]);
    }

    #[tokio::test]
    async fn accepted_peer_reconciles_user_signed_earthly_events_into_its_local_database() {
        let host_dir = tempfile::tempdir().unwrap();
        let peer_dir = tempfile::tempdir().unwrap();
        let host = LocalNode::start(
            NodeConfig::loopback(host_dir.path(), NodeAvailability::Process).with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let peer = LocalNode::start(
            NodeConfig::loopback(peer_dir.path(), NodeAvailability::Process).with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let invitation = host
            .create_pairing_invitation(Duration::from_secs(60), PairingCapability::initial_set())
            .await
            .unwrap();
        let pending = peer
            .join_pairing_invitation(&invitation.encode().unwrap(), Some("Map tablet".to_owned()))
            .await
            .unwrap();
        host.approve_pairing_claim(EventId::from_hex(&pending.claim_id).unwrap())
            .await
            .unwrap();
        peer.refresh_remote_node(&pending.node_id).await.unwrap();

        let blob_bytes = b"paired immutable map attachment".to_vec();
        let blob_hash = format!("{:x}", Sha256::digest(&blob_bytes));
        let upload = reqwest::Client::new()
            .put(host.descriptor().blossom_url.join("upload").unwrap())
            .header("content-type", "application/octet-stream")
            .header("x-sha-256", &blob_hash)
            .header(
                "authorization",
                authorization(&peer.identity.keys(), "upload", &blob_hash),
            )
            .body(blob_bytes)
            .send()
            .await
            .unwrap();
        assert_eq!(upload.status(), reqwest::StatusCode::CREATED);

        let author = Keys::generate();
        let blob_checksum = format!("sha256={blob_hash}");
        let dataset = EventBuilder::new(Kind::Custom(37_515), r#"{"type":"FeatureCollection"}"#)
            .tags([
                Tag::parse(["d", "shared-trail"]).unwrap(),
                Tag::parse([
                    "blob",
                    "collection",
                    "https://origin.invalid/map-object",
                    &blob_checksum,
                ])
                .unwrap(),
            ])
            .sign_with_keys(&author)
            .unwrap();
        assert!(host.ingest_verified_event(&dataset).await.unwrap());

        let first_sync = peer.sync_remote_node(&pending.node_id).await.unwrap();
        assert_eq!(first_sync.received_events, 1);
        assert_eq!(first_sync.events, vec![dataset]);
        assert_eq!(first_sync.discovered_blob_hashes, vec![blob_hash.clone()]);
        assert_eq!(
            first_sync.remote_node.discovered_blob_hashes,
            vec![blob_hash.clone()]
        );
        assert_eq!(first_sync.remote_node.last_sync.unwrap().received_events, 1);

        let mirrored = peer
            .mirror_remote_blobs(&pending.node_id, vec![blob_hash.clone()])
            .await
            .unwrap();
        assert_eq!(
            mirrored.items,
            vec![crate::RemoteBlobMirrorItem {
                sha256: blob_hash.clone(),
                state: crate::RemoteBlobMirrorState::Mirrored,
            }]
        );
        assert_eq!(
            mirrored.remote_node.mirrored_blob_hashes,
            vec![blob_hash.clone()]
        );
        assert!(peer.blossom.has_blob(&blob_hash).await.unwrap());

        let repeated = peer
            .mirror_remote_blobs(&pending.node_id, vec![blob_hash.clone()])
            .await
            .unwrap();
        assert_eq!(
            repeated.items[0].state,
            crate::RemoteBlobMirrorState::AlreadyPresent
        );

        let second_sync = peer.sync_remote_node(&pending.node_id).await.unwrap();
        assert_eq!(second_sync.received_events, 0);
        assert!(second_sync.events.is_empty());
        assert_eq!(
            second_sync.remote_node.discovered_blob_hashes,
            vec![blob_hash]
        );
    }

    #[tokio::test]
    async fn accepted_field_device_publishes_as_the_active_user_and_every_peer_can_reconcile() {
        let host_dir = tempfile::tempdir().unwrap();
        let peer_dir = tempfile::tempdir().unwrap();
        let observer_dir = tempfile::tempdir().unwrap();
        let host = LocalNode::start(
            NodeConfig::loopback(host_dir.path(), NodeAvailability::Process).with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let peer = LocalNode::start(
            NodeConfig::loopback(peer_dir.path(), NodeAvailability::Process).with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let observer = LocalNode::start(
            NodeConfig::loopback(observer_dir.path(), NodeAvailability::Process)
                .with_ephemeral_ports(),
        )
        .await
        .unwrap();
        let field_session = FieldSessionInfo {
            id: "water-survey".to_owned(),
            name: "Water survey".to_owned(),
            description: Some("Nearby collaboration proof".to_owned()),
            internet_policy: crate::FieldSessionInternetPolicy::Never,
            conversation_policy: crate::FieldSessionConversationPolicy::NearbyOnly,
            allow_peer_writes: true,
            context_coordinates: Vec::new(),
        };
        let invitation = host
            .create_field_session_invitation(
                Duration::from_secs(60),
                PairingCapability::initial_set(),
                field_session.clone(),
            )
            .await
            .unwrap();
        let pending = peer
            .join_pairing_invitation(
                &invitation.encode().unwrap(),
                Some("Survey phone".to_owned()),
            )
            .await
            .unwrap();
        assert_eq!(pending.field_session, Some(field_session.clone()));
        host.approve_pairing_claim(EventId::from_hex(&pending.claim_id).unwrap())
            .await
            .unwrap();
        peer.refresh_remote_node(&pending.node_id).await.unwrap();

        let observer_invitation = host
            .create_field_session_invitation(
                Duration::from_secs(60),
                PairingCapability::initial_set(),
                field_session,
            )
            .await
            .unwrap();
        let observer_pending = observer
            .join_pairing_invitation(
                &observer_invitation.encode().unwrap(),
                Some("Observer phone".to_owned()),
            )
            .await
            .unwrap();
        host.approve_pairing_claim(EventId::from_hex(&observer_pending.claim_id).unwrap())
            .await
            .unwrap();
        observer
            .refresh_remote_node(&observer_pending.node_id)
            .await
            .unwrap();

        // The installation key authenticates the relay connection, but the
        // immutable record retains the active Earthly user's Nostr authorship.
        let active_user = Keys::generate();
        let message = EventBuilder::new(
            Kind::Custom(37_523),
            r#"{"version":1,"type":"message","text":"found the spring"}"#,
        )
        .tags([
            Tag::parse(["d", "field-message-1"]).unwrap(),
            Tag::parse(["h", "water-survey"]).unwrap(),
            Tag::parse(["type", "message"]).unwrap(),
        ])
        .sign_with_keys(&active_user)
        .unwrap();
        let published = peer
            .publish_remote_event(&pending.node_id, message.clone())
            .await
            .unwrap();
        assert_eq!(published.event_id, message.id.to_hex());
        assert_ne!(message.pubkey, peer.identity_public_key());

        let dataset = EventBuilder::new(
            Kind::Custom(37_515),
            r#"{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[16.37,48.21]},"properties":{"name":"Spring"}}]}"#,
        )
        .tags([
            Tag::parse(["d", "spring-dataset"]).unwrap(),
            Tag::parse(["h", "water-survey"]).unwrap(),
            Tag::parse(["t", "field-session"]).unwrap(),
            Tag::parse(["bbox", "16.37,48.21,16.37,48.21"]).unwrap(),
        ])
        .sign_with_keys(&active_user)
        .unwrap();
        peer.publish_remote_event(&pending.node_id, dataset.clone())
            .await
            .unwrap();
        observer
            .sync_remote_node(&observer_pending.node_id)
            .await
            .unwrap();

        let host_events = host.field_session_events("water-survey").await.unwrap();
        assert_eq!(host_events.len(), 2);
        assert!(host_events.contains(&message));
        assert!(host_events.contains(&dataset));
        let peer_events = peer.field_session_events("water-survey").await.unwrap();
        assert_eq!(peer_events.len(), 2);
        assert!(peer_events.contains(&message));
        assert!(peer_events.contains(&dataset));
        let observer_events = observer.field_session_events("water-survey").await.unwrap();
        assert_eq!(observer_events.len(), 2);
        assert!(observer_events.contains(&message));
        assert!(observer_events.contains(&dataset));
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
        let local_access = first_node.local_blob_access(&hash).unwrap();
        let owner_partial = client
            .get(&local_access.url)
            .header("authorization", local_access.authorization)
            .header("range", "bytes=0-6")
            .send()
            .await
            .unwrap();
        assert_eq!(owner_partial.status(), reqwest::StatusCode::PARTIAL_CONTENT);
        assert_eq!(owner_partial.bytes().await.unwrap().as_ref(), b"earthly");

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
