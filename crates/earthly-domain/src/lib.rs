//! Canonical Earthly Nostr v2 domain models, tag seams, drafts, and presentation types.
//!
//! Compiles to both native targets and `wasm32-unknown-unknown` so Flutter,
//! desktop, CLIs, and the Web app share one authoritative specification
//! (`SPEC.md` + `docs/MAP-WITH-A-MARGIN-SPEC.md`).

pub mod draft;
pub mod entities;
pub mod kinds;
pub mod presentation;
pub mod tags;

pub use draft::{
    AuthoringIntent, LocalDraftRecord, ProposalDiffSummary, PublishAudience, diff_feature_collections,
};
pub use entities::{
    AtlasGroup, BlobReference, BlobScope, DomainError, GeoComment, GeoEditProposal,
    GovernanceMode, LiveBeacon, MapCallout, MapDataset, ProposalStatus, RawNostrEvent,
    StoryArticle, TemporalSighting,
};
pub use kinds::*;
pub use presentation::{FeatureStyleProperties, MapPresentationV1};
pub use tags::{
    EARTHLY_LABEL_NAMESPACE, FEATURE_CATEGORY_VOCAB, ImetaAttachment, TagError, drop_expired,
    encode_geohash, geohash_prefixes, get_bbox, get_context_refs, get_expiration, get_geohash,
    get_hashtags, get_images, get_labels, get_referenced_addresses, get_tag_value, is_expired,
    parse_blob_references, set_bbox, set_context_refs, set_geohash, set_hashtags, set_images,
    set_labels, set_referenced_addresses, set_schema_hash,
};
