//! Strongly typed Earthly Nostr v2 entity parsers and models (`SPEC.md`).

use earthly_spatial::Bounds;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::kinds::*;
use crate::tags::{
    ImetaAttachment, get_bbox, get_context_refs, get_expiration, get_geohash, get_hashtags,
    get_images, get_labels, get_referenced_addresses, get_tag_value, parse_blob_references,
};

/// Transport-neutral Nostr event representation (usable on native & WASM without
/// tying `earthly-domain` to any specific relay or signer crate).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct RawNostrEvent {
    pub id: String,
    pub pubkey: String,
    pub created_at: u64,
    pub kind: u16,
    pub tags: Vec<Vec<String>>,
    pub content: String,
}

impl RawNostrEvent {
    pub fn d_tag(&self) -> Option<&str> {
        get_tag_value(&self.tags, "d")
    }

    pub fn address_coordinate(&self) -> Option<String> {
        let d = self.d_tag()?;
        Some(format!("{}:{}:{d}", self.kind, self.pubkey))
    }

    /// Clean-break v2 discriminator check (SPEC §8). Never panics; returns false
    /// on invalid JSON or mismatched/absent `modelVersion`.
    pub fn has_current_model_version(&self) -> bool {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&self.content) else {
            return false;
        };
        value.get("modelVersion").and_then(|v| v.as_str()) == Some(MODEL_VERSION)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum DomainError {
    #[error("unexpected event kind {actual}, expected {expected}")]
    UnexpectedKind { expected: u16, actual: u16 },
    #[error("event is missing mandatory d tag")]
    MissingDTag,
    #[error("event failed earthly/2 modelVersion gate (legacy or malformed)")]
    UnsupportedModelVersion,
    #[error("invalid JSON content: {0}")]
    InvalidContent(String),
    #[error("missing required field: {0}")]
    MissingField(&'static str),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlobScope {
    Collection,
    Feature(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlobReference {
    pub scope: BlobScope,
    pub url: String,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    pub mime: Option<String>,
}

/// Authored contextual card attached to a Feature (`Feature.properties["earthly:callouts"]`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapCallout {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    pub text: String,
    #[serde(default)]
    pub placement: Option<serde_json::Value>,
    #[serde(default)]
    pub media: Vec<serde_json::Value>,
}

/// Kind 37515 — GeoJSON Dataset (Map).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapDataset {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub name: Option<String>,
    pub description: Option<String>,
    pub feature_collection: serde_json::Value,
    pub bbox: Option<Bounds>,
    pub geohash: Option<String>,
    pub hashtags: Vec<String>,
    pub labels: Vec<String>,
    pub context_refs: Vec<String>,
    pub blobs: Vec<BlobReference>,
    pub checksum: Option<String>,
    pub version: Option<String>,
}

impl MapDataset {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != GEO_EVENT_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: GEO_EVENT_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        let fc: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        if fc.get("type").and_then(|v| v.as_str()) != Some("FeatureCollection") {
            return Err(DomainError::InvalidContent(
                "content must be a GeoJSON FeatureCollection".to_owned(),
            ));
        }
        let name = fc
            .get("name")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        let description = fc
            .get("description")
            .and_then(|v| v.as_str())
            .map(str::to_owned);

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            name,
            description,
            feature_collection: fc,
            bbox: get_bbox(&event.tags),
            geohash: get_geohash(&event.tags).map(str::to_owned),
            hashtags: get_hashtags(&event.tags),
            labels: get_labels(&event.tags),
            context_refs: get_context_refs(&event.tags),
            blobs: parse_blob_references(&event.tags),
            checksum: get_tag_value(&event.tags, "checksum").map(str::to_owned),
            version: get_tag_value(&event.tags, "v").map(str::to_owned),
        })
    }
}

/// Kind 37517 — NIP-22 threaded Geo Comment.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoComment {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub text: String,
    pub geojson: Option<serde_json::Value>,
    pub root_address: Option<String>,
    pub root_kind: Option<u16>,
    pub parent_address: Option<String>,
    pub parent_kind: Option<u16>,
    pub bbox: Option<Bounds>,
}

impl GeoComment {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != GEO_COMMENT_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: GEO_COMMENT_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        let body: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        let text = body
            .get("text")
            .and_then(|v| v.as_str())
            .ok_or(DomainError::MissingField("text"))?
            .to_owned();

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            text,
            geojson: body.get("geojson").cloned(),
            root_address: get_tag_value(&event.tags, "A").map(str::to_owned),
            root_kind: get_tag_value(&event.tags, "K").and_then(|v| v.parse().ok()),
            parent_address: get_tag_value(&event.tags, "a").map(str::to_owned),
            parent_kind: get_tag_value(&event.tags, "k").and_then(|v| v.parse().ok()),
            bbox: get_bbox(&event.tags),
        })
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum GovernanceMode {
    #[default]
    Open,
    Schema,
    Closed,
}

/// Kind 37518 — Atlas / Group (v2 slimmed, `modelVersion = "earthly/2"`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AtlasGroup {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub name: String,
    pub description: Option<String>,
    pub governance: GovernanceMode,
    pub pinned_addresses: Vec<String>,
    pub context_refs: Vec<String>,
    pub hashtags: Vec<String>,
    pub labels: Vec<String>,
    pub schema_hash: Option<String>,
    pub bbox: Option<Bounds>,
}

impl AtlasGroup {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != MAP_CONTEXT_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: MAP_CONTEXT_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        if !event.has_current_model_version() {
            return Err(DomainError::UnsupportedModelVersion);
        }
        let body: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        let name = body
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or(DomainError::MissingField("name"))?
            .to_owned();
        let governance = match body.get("governance").and_then(|v| v.as_str()) {
            Some("schema") => GovernanceMode::Schema,
            Some("closed") => GovernanceMode::Closed,
            _ => GovernanceMode::Open,
        };

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            name,
            description: body
                .get("description")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            governance,
            pinned_addresses: get_referenced_addresses(&event.tags),
            context_refs: get_context_refs(&event.tags),
            hashtags: get_hashtags(&event.tags),
            labels: get_labels(&event.tags),
            schema_hash: get_tag_value(&event.tags, "schema-hash").map(str::to_owned),
            bbox: get_bbox(&event.tags),
        })
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProposalStatus {
    #[default]
    Open,
    Applied,
    Closed,
    Draft,
}

impl ProposalStatus {
    pub fn from_status_kind(kind: u16) -> Option<Self> {
        match kind {
            PROPOSAL_STATUS_OPEN_KIND => Some(Self::Open),
            PROPOSAL_STATUS_APPLIED_KIND => Some(Self::Applied),
            PROPOSAL_STATUS_CLOSED_KIND => Some(Self::Closed),
            PROPOSAL_STATUS_DRAFT_KIND => Some(Self::Draft),
            _ => None,
        }
    }
}

/// Kind 37519 — Geo Edit Proposal (full replacement FeatureCollection).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeoEditProposal {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub target_address: String,
    pub target_owner: Option<String>,
    pub base_version: Option<String>,
    pub description: Option<String>,
    pub feature_collection: serde_json::Value,
    pub bbox: Option<Bounds>,
}

impl GeoEditProposal {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != GEO_EDIT_PROPOSAL_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: GEO_EDIT_PROPOSAL_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        let target_address = get_tag_value(&event.tags, "a")
            .ok_or(DomainError::MissingField("a"))?
            .to_owned();
        let fc: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        if fc.get("type").and_then(|v| v.as_str()) != Some("FeatureCollection") {
            return Err(DomainError::InvalidContent(
                "proposal content must be a GeoJSON FeatureCollection".to_owned(),
            ));
        }

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            target_address,
            target_owner: get_tag_value(&event.tags, "p").map(str::to_owned),
            base_version: get_tag_value(&event.tags, "base-version").map(str::to_owned),
            description: get_tag_value(&event.tags, "description").map(str::to_owned),
            feature_collection: fc,
            bbox: get_bbox(&event.tags),
        })
    }
}

/// Kind 37520 — Story / Article (`earthly/2`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoryArticle {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub title: String,
    pub summary: Option<String>,
    pub image: Option<String>,
    pub published_at: u64,
    pub content: String,
    pub presentation: Option<serde_json::Value>,
    pub referenced_addresses: Vec<String>,
    pub hashtags: Vec<String>,
    pub labels: Vec<String>,
    pub bbox: Option<Bounds>,
}

impl StoryArticle {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != ARTICLE_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: ARTICLE_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        if !event.has_current_model_version() {
            return Err(DomainError::UnsupportedModelVersion);
        }
        let body: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        let title = body
            .get("title")
            .and_then(|v| v.as_str())
            .ok_or(DomainError::MissingField("title"))?
            .to_owned();
        let content = body
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_owned();
        let published_at = body
            .get("publishedAt")
            .and_then(|v| v.as_u64())
            .unwrap_or(event.created_at);

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            title,
            summary: body
                .get("summary")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            image: body
                .get("image")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            published_at,
            content,
            presentation: body.get("presentation").cloned(),
            referenced_addresses: get_referenced_addresses(&event.tags),
            hashtags: get_hashtags(&event.tags),
            labels: get_labels(&event.tags),
            bbox: get_bbox(&event.tags),
        })
    }
}

/// Kind 37521 — Live Beacon (`earthly/2` + NIP-40 expiration).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveBeacon {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub lon: f64,
    pub lat: f64,
    pub status: Option<String>,
    pub expires_at: Option<u64>,
    pub images: Vec<ImetaAttachment>,
}

impl LiveBeacon {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != LIVE_BEACON_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: LIVE_BEACON_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        if !event.has_current_model_version() {
            return Err(DomainError::UnsupportedModelVersion);
        }
        let body: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        let lon = body
            .get("lon")
            .or_else(|| body.get("longitude"))
            .and_then(|v| v.as_f64())
            .ok_or(DomainError::MissingField("lon"))?;
        let lat = body
            .get("lat")
            .or_else(|| body.get("latitude"))
            .and_then(|v| v.as_f64())
            .ok_or(DomainError::MissingField("lat"))?;

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            lon,
            lat,
            status: body
                .get("status")
                .or_else(|| body.get("note"))
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            expires_at: get_expiration(&event.tags),
            images: get_images(&event.tags),
        })
    }
}

/// Kind 37522 — Temporal Sighting (`earthly/2` + NIP-52 start/end + NIP-40 expiry).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TemporalSighting {
    pub event_id: String,
    pub pubkey: String,
    pub d_tag: String,
    pub created_at: u64,
    pub title: Option<String>,
    pub note: String,
    pub lon: f64,
    pub lat: f64,
    pub start: u64,
    pub end: Option<u64>,
    pub expires_at: Option<u64>,
    pub images: Vec<ImetaAttachment>,
}

impl TemporalSighting {
    pub fn parse(event: &RawNostrEvent) -> Result<Self, DomainError> {
        if event.kind != TEMPORAL_SIGHTING_KIND {
            return Err(DomainError::UnexpectedKind {
                expected: TEMPORAL_SIGHTING_KIND,
                actual: event.kind,
            });
        }
        let d_tag = event.d_tag().ok_or(DomainError::MissingDTag)?.to_owned();
        if !event.has_current_model_version() {
            return Err(DomainError::UnsupportedModelVersion);
        }
        let body: serde_json::Value = serde_json::from_str(&event.content)
            .map_err(|err| DomainError::InvalidContent(err.to_string()))?;
        let lon = body
            .get("lon")
            .or_else(|| body.get("longitude"))
            .and_then(|v| v.as_f64())
            .ok_or(DomainError::MissingField("lon"))?;
        let lat = body
            .get("lat")
            .or_else(|| body.get("latitude"))
            .and_then(|v| v.as_f64())
            .ok_or(DomainError::MissingField("lat"))?;
        let start = body
            .get("start")
            .and_then(|v| v.as_u64())
            .unwrap_or(event.created_at);

        Ok(Self {
            event_id: event.id.clone(),
            pubkey: event.pubkey.clone(),
            d_tag,
            created_at: event.created_at,
            title: body
                .get("title")
                .and_then(|v| v.as_str())
                .map(str::to_owned),
            note: body
                .get("note")
                .or_else(|| body.get("description"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_owned(),
            lon,
            lat,
            start,
            end: body.get("end").and_then(|v| v.as_u64()),
            expires_at: get_expiration(&event.tags),
            images: get_images(&event.tags),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_break_drops_legacy_37518_without_model_version() {
        let legacy = RawNostrEvent {
            id: "legacy".to_owned(),
            pubkey: "a".repeat(64),
            created_at: 1000,
            kind: MAP_CONTEXT_KIND,
            tags: vec![vec!["d".to_owned(), "old-context".to_owned()]],
            content: r#"{"name":"Old Context","allowForeignAttachments":true}"#.to_owned(),
        };
        assert_eq!(
            AtlasGroup::parse(&legacy),
            Err(DomainError::UnsupportedModelVersion)
        );

        let v2 = RawNostrEvent {
            content: r#"{"modelVersion":"earthly/2","name":"Alpine Huts","governance":"schema"}"#
                .to_owned(),
            ..legacy
        };
        let group = AtlasGroup::parse(&v2).unwrap();
        assert_eq!(group.name, "Alpine Huts");
        assert_eq!(group.governance, GovernanceMode::Schema);
    }

    #[test]
    fn parses_story_and_falls_back_published_at_to_created_at() {
        let event = RawNostrEvent {
            id: "story1".to_owned(),
            pubkey: "b".repeat(64),
            created_at: 1_700_000_000,
            kind: ARTICLE_KIND,
            tags: vec![
                vec!["d".to_owned(), "danube-walk".to_owned()],
                vec!["a".to_owned(), format!("37515:{}:trail", "b".repeat(64))],
            ],
            content: r#"{"modelVersion":"earthly/2","title":"Danube Walk","content":"Hello"}"#
                .to_owned(),
        };
        let story = StoryArticle::parse(&event).unwrap();
        assert_eq!(story.published_at, 1_700_000_000);
        assert_eq!(story.referenced_addresses.len(), 1);
    }
}
