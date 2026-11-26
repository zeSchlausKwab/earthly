//! Local SQLite draft persistence + canonical Earthly event preparation
//! (for NIP-55 Amber signing / local nsec signing) + crash-safe SQLite outbox
//! relay delivery.

pub mod drafts;
pub mod events;
pub mod keys;
pub mod outbox;
pub mod validation;

pub use drafts::{
    LocalDraftDto, delete_local_draft, list_local_drafts, load_local_draft, save_local_draft,
};
pub use events::{
    ExternalGeoBlobDto, UnsignedCommentEventDto, UnsignedMapEventDto, UnsignedSightingEventDto,
    prepare_unsigned_atlas_event, prepare_unsigned_beacon_event, prepare_unsigned_comment_event,
    prepare_unsigned_deletion_event, prepare_unsigned_map_event, prepare_unsigned_profile_event,
    prepare_unsigned_proposal_event, prepare_unsigned_proposal_status_event,
    prepare_unsigned_reaction_event, prepare_unsigned_relay_list_event,
    prepare_unsigned_shoutbox_post, prepare_unsigned_sighting_event, prepare_unsigned_story_event,
    prepare_unsigned_story_proposal_event, prepare_unsigned_zap_request_event,
};
pub use keys::{
    LocalKeypairDto, generate_local_nostr_keypair, import_local_nostr_nsec, sign_event_with_nsec,
};
pub use outbox::{
    OutboxFlushReportDto, OutboxItemDto, OutboxRelayItemDto, PublishOutcomeDto,
    RelayDeliveryStatusDto, discard_outbox_item, flush_outbox_queue, list_outbox_items,
    publish_nearby_event_via_outbox, publish_signed_event_via_outbox, retry_outbox_item,
};
pub use validation::{AtlasSchemaValidationDto, validate_map_against_atlas_schema};
