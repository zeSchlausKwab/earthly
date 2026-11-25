//! UI-agnostic SQLite persistence for Earthly native applications.
//!
//! Extracted from `src-tauri` so Flutter (`earthly-ffi`), CLIs, tests, and the
//! legacy Tauri shell share the exact same durable storage contracts.

pub mod account_session;
pub mod drafts;
pub mod outbox;
pub mod settings;

pub use account_session::{
    AccountSession, AccountSessionError, AccountSessionInput, AccountSessionStore,
    ACCOUNT_SESSION_PROTOCOL_VERSION, MAX_ACCOUNTS_JSON_BYTES, MAX_ACCOUNT_ID_BYTES,
};
pub use drafts::{DraftStore, DraftStoreError, PersistedDraft, SaveDraftInput, DRAFT_STORE_VERSION};
pub use outbox::{
    OutboxDiagnosticSummary, OutboxEnqueueInput, OutboxError, OutboxItemState,
    OutboxItemSummaryView, OutboxItemView, OutboxRelayResultInput, OutboxRelayState,
    OutboxRelayView, OutboxRouting, OutboxStore, OUTBOX_PROTOCOL_VERSION,
};
pub use settings::{
    AppSettingsStore, MountedAtlasWorkspaceRecord, PersistedAppSettings, SavedOfflinePackRecord,
    SettingsStoreError,
};
