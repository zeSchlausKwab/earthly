/**
 * Earthly Nostr Event Kind Constants
 *
 * These are custom event kinds used by the Earthly application
 * for GeoJSON data storage and collaboration on Nostr.
 */

/** GeoJSON Data Event - stores FeatureCollection with spatial metadata */
export const GEO_EVENT_KIND = 37515

/** GeoJSON Comment Event - NIP-22 threaded comments on datasets */
export const GEO_COMMENT_KIND = 37517

/** Map Context Event - taxonomy/validation context for datasets */
export const MAP_CONTEXT_KIND = 37518

/** Geo Edit Proposal - proposed changes to another user's dataset (parameterized replaceable) */
export const GEO_EDIT_PROPOSAL_KIND = 37519

/** Map Layer Set Announcement - server-signed layer configuration (parameterized replaceable) */
export const MAP_LAYER_SET_KIND = 34444

/** Story / Article Event - NIP-23-style long-form geo narrative (parameterized replaceable) */
export const ARTICLE_KIND = 37520

/** Live Beacon Event - replaceable presence/position with NIP-40 expiration */
export const LIVE_BEACON_KIND = 37521

/** Temporal Sighting Event - NIP-52 time-bounded observation with NIP-40 expiry */
export const TEMPORAL_SIGHTING_KIND = 37522

/** NIP-34 Status Event Kinds - reused for proposal status tracking */
export const PROPOSAL_STATUS_OPEN_KIND = 1630
export const PROPOSAL_STATUS_APPLIED_KIND = 1631
export const PROPOSAL_STATUS_CLOSED_KIND = 1632
export const PROPOSAL_STATUS_DRAFT_KIND = 1633
