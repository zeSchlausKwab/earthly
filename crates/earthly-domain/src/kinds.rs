//! Canonical Earthly Nostr event kind constants (`SPEC.md` & `src/lib/nostr/kinds.ts`).

/// GeoJSON Data Event (Map) — parameterized replaceable FeatureCollection.
pub const GEO_EVENT_KIND: u16 = 37_515;

/// GeoJSON Comment Event — NIP-22 threaded comments with optional GeoJSON.
pub const GEO_COMMENT_KIND: u16 = 37_517;

/// Atlas / Group Event — v2 slimmed curated topic with `modelVersion = "earthly/2"`.
pub const MAP_CONTEXT_KIND: u16 = 37_518;

/// Geo Edit Proposal — parameterized replaceable full replacement FeatureCollection.
pub const GEO_EDIT_PROPOSAL_KIND: u16 = 37_519;

/// Story / Article Event — NIP-23-style long-form geo narrative (`earthly/2`).
pub const ARTICLE_KIND: u16 = 37_520;

/// Live Beacon Event — replaceable presence/position with NIP-40 expiration (`earthly/2`).
pub const LIVE_BEACON_KIND: u16 = 37_521;

/// Temporal Sighting Event — NIP-52 time-bounded observation with NIP-40 expiry (`earthly/2`).
pub const TEMPORAL_SIGHTING_KIND: u16 = 37_522;

/// Experimental Maplet source recommendation (links/metadata only, no geometry).
pub const MAPLET_SOURCE_KIND: u16 = 37_526;

/// Legacy Map Layer Set Announcement (Mapnolia — being sunset in favour of `atlas`).
pub const MAP_LAYER_SET_KIND: u16 = 34_444;

/// NIP-34 status event kinds reused for proposal lifecycle tracking.
pub const PROPOSAL_STATUS_OPEN_KIND: u16 = 1_630;
pub const PROPOSAL_STATUS_APPLIED_KIND: u16 = 1_631;
pub const PROPOSAL_STATUS_CLOSED_KIND: u16 = 1_632;
pub const PROPOSAL_STATUS_DRAFT_KIND: u16 = 1_633;

/// Clean-break content discriminator required on v2 entities (37518, 37520, 37521, 37522).
pub const MODEL_VERSION: &str = "earthly/2";

/// Returns whether `kind` is one of the v2 `modelVersion`-gated entity kinds.
pub const fn requires_model_version(kind: u16) -> bool {
    matches!(
        kind,
        MAP_CONTEXT_KIND | ARTICLE_KIND | LIVE_BEACON_KIND | TEMPORAL_SIGHTING_KIND
    )
}
