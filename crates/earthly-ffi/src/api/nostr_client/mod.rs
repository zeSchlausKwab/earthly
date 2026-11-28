//! Native Nostr relay client fetching real Earthly v2 entities (Maps 37515,
//! Atlases 37518, Stories 37520, Live Beacons 37521, Sightings 37522) and
//! parsing them through `earthly-domain`.

pub mod blob_media;
pub mod catalog;
pub mod entities;
pub mod profiles_relays;
pub mod search_geo;

pub const DEFAULT_EARTHLY_RELAY: &str = "wss://relay.earthly.city";
pub const EARTHLY_CITY_DEVELOPER_NPUB: &str =
    "npub182jczunncwe0jn6frpqwq3e0qjws7yqqnc3auccqv9nte2dnd63scjm4rf";

pub use blob_media::{BlobRefDto, resolve_map_blob_geojson};
pub use catalog::{
    EarthlyCatalogSnapshot, LiveRelayEventDto, fetch_earthly_catalog, fetch_local_node_catalog,
    subscribe_earthly_relay_stream,
};
pub use entities::{
    AtlasSummaryDto, AuthorPortfolioDto, DecodedNaddrDto, EntityDiscussionSnapshot,
    EntitySocialCountsDto, GeoCommentDto, GeoProposalDto, InboxItemDto, LiveBeaconDto,
    MapSummaryDto, SightingSummaryDto, StorySummaryDto, decode_naddr_coordinate,
    encode_naddr_coordinate, fetch_author_portfolio, fetch_entity_by_address,
    fetch_entity_discussion, fetch_entity_social_counts, fetch_inbox_items,
    fetch_maps_by_addresses,
};
pub use profiles_relays::{
    ManagedRelayStatusDto, Nip66RelayCandidateDto, ProfileMetadataDto, RelayHealthDto,
    RelayListEntryDto, RelayManagerSnapshotDto, RelayNip11InfoDto, RelayQualityReportDto,
    ShoutboxPostDto, ZapInvoiceDto, decode_npub_to_hex, discover_public_relays_nip66,
    encode_hex_to_npub, fetch_lnurl_zap_invoice, fetch_profiles, fetch_shoutbox_posts,
    fetch_user_relay_list, get_relay_manager_snapshot, mark_nip66_relay_added,
    probe_relays_health, probe_relays_quality, pubkey_to_npub, sync_user_nip65_relays,
};
pub use search_geo::{
    PlaceSearchResultDto, ReverseGeocodeDto, reverse_geocode_location, search_places,
    search_relay_catalog_nip50,
};
