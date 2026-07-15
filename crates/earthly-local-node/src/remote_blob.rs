use std::collections::BTreeSet;
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{
    EmbeddedBlossom, PairingCapability, PairingStatus, RemoteNodeError, RemoteNodeRecord,
    RemoteNodeStore,
};

const BLOSSOM_AUTHORIZATION_KIND: u16 = 24_242;
const MAX_MIRROR_BATCH: usize = 64;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RemoteBlobMirrorState {
    Mirrored,
    AlreadyPresent,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBlobMirrorItem {
    pub sha256: String,
    pub state: RemoteBlobMirrorState,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteBlobMirrorResult {
    pub node_id: String,
    pub items: Vec<RemoteBlobMirrorItem>,
    pub remote_node: RemoteNodeRecord,
}

#[derive(Debug, Error)]
pub enum RemoteBlobMirrorError {
    #[error(transparent)]
    RemoteNode(#[from] RemoteNodeError),
    #[error("the host has not approved this installation")]
    NotAccepted,
    #[error("the approved grant does not include blob-read access; request a new invitation")]
    MissingBlobRead,
    #[error("select between 1 and {MAX_MIRROR_BATCH} referenced blobs")]
    InvalidBatch,
    #[error("blob {0} was not referenced by a synchronized Earthly record")]
    UndiscoveredHash(String),
    #[error("failed to create Blossom download authorization: {0}")]
    Authorization(String),
    #[error("invalid paired Blossom URL: {0}")]
    Url(#[from] url::ParseError),
    #[error("paired Blossom request failed: {0}")]
    Transport(#[from] reqwest::Error),
    #[error("paired Blossom returned HTTP {0}")]
    Response(StatusCode),
    #[error("local Blossom could not adopt the verified blob: {0}")]
    Storage(String),
}

pub(crate) async fn mirror_remote_blobs(
    keys: Keys,
    blossom: &EmbeddedBlossom,
    remote_nodes: &RemoteNodeStore,
    node_id: &str,
    hashes: Vec<String>,
) -> Result<RemoteBlobMirrorResult, RemoteBlobMirrorError> {
    let record = remote_nodes.get(node_id).await?;
    if record.status != PairingStatus::Accepted {
        return Err(RemoteBlobMirrorError::NotAccepted);
    }
    if !record.capabilities.contains(&PairingCapability::BlobRead) {
        return Err(RemoteBlobMirrorError::MissingBlobRead);
    }

    let hashes = hashes.into_iter().collect::<BTreeSet<_>>();
    if hashes.is_empty() || hashes.len() > MAX_MIRROR_BATCH {
        return Err(RemoteBlobMirrorError::InvalidBatch);
    }
    if let Some(hash) = hashes
        .iter()
        .find(|hash| !record.discovered_blob_hashes.contains(hash))
    {
        return Err(RemoteBlobMirrorError::UndiscoveredHash(hash.clone()));
    }

    let client = Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .read_timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut items = Vec::with_capacity(hashes.len());
    for hash in &hashes {
        if blossom
            .has_blob(hash)
            .await
            .map_err(|error| RemoteBlobMirrorError::Storage(error.to_string()))?
        {
            items.push(RemoteBlobMirrorItem {
                sha256: hash.clone(),
                state: RemoteBlobMirrorState::AlreadyPresent,
            });
            continue;
        }

        let response = client
            .get(record.descriptor.blossom_url.join(hash)?)
            .header("authorization", download_authorization(&keys, hash)?)
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(RemoteBlobMirrorError::Response(response.status()));
        }
        let (_, created) = blossom
            .adopt_remote_response(hash, response)
            .await
            .map_err(|error| RemoteBlobMirrorError::Storage(error.to_string()))?;
        items.push(RemoteBlobMirrorItem {
            sha256: hash.clone(),
            state: if created {
                RemoteBlobMirrorState::Mirrored
            } else {
                RemoteBlobMirrorState::AlreadyPresent
            },
        });
    }

    let mirrored_hashes = hashes.into_iter().collect::<Vec<_>>();
    let remote_node = remote_nodes
        .record_mirrored_blobs(node_id, &mirrored_hashes)
        .await?;
    Ok(RemoteBlobMirrorResult {
        node_id: node_id.to_owned(),
        items,
        remote_node,
    })
}

fn download_authorization(keys: &Keys, hash: &str) -> Result<String, RemoteBlobMirrorError> {
    let now = Timestamp::now();
    let event = EventBuilder::new(
        Kind::Custom(BLOSSOM_AUTHORIZATION_KIND),
        "Download paired Earthly blob",
    )
    .tags([
        Tag::parse(["t", "get"])
            .map_err(|error| RemoteBlobMirrorError::Authorization(error.to_string()))?,
        Tag::expiration(now + 300),
        Tag::parse(["x", hash])
            .map_err(|error| RemoteBlobMirrorError::Authorization(error.to_string()))?,
    ])
    .custom_created_at(now - 60)
    .sign_with_keys(keys)
    .map_err(|error| RemoteBlobMirrorError::Authorization(error.to_string()))?;
    let encoded = URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&event)
            .map_err(|error| RemoteBlobMirrorError::Authorization(error.to_string()))?,
    );
    Ok(format!("Nostr {encoded}"))
}
