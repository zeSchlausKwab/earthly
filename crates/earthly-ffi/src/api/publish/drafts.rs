//! Local SQLite working draft persistence (`earthly-storage::DraftStore`).

use earthly_domain::GEO_EVENT_KIND;
use earthly_storage::{DraftStore, SaveDraftInput};

#[derive(Clone, Debug)]
pub struct LocalDraftDto {
    pub draft_id: String,
    pub d_tag: String,
    pub entity_kind: u16,
    pub title: String,
    pub description: Option<String>,
    pub audience_channel: String,
    pub audience_id: Option<String>,
    pub geojson: String,
    pub updated_at: u64,
}

/// Save or update a local working draft in SQLite (`earthly-storage`).
pub fn save_local_draft(
    database_path: String,
    draft_id: String,
    d_tag: String,
    title: String,
    description: Option<String>,
    audience_channel: String,
    audience_id: Option<String>,
    geojson: String,
) -> Result<LocalDraftDto, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let saved = store
        .save(SaveDraftInput {
            draft_id,
            d_tag,
            entity_kind: GEO_EVENT_KIND,
            title,
            description,
            audience_channel,
            audience_id,
            geojson,
        })
        .map_err(|e| e.to_string())?;
    Ok(LocalDraftDto {
        draft_id: saved.draft_id,
        d_tag: saved.d_tag,
        entity_kind: saved.entity_kind,
        title: saved.title,
        description: saved.description,
        audience_channel: saved.audience_channel,
        audience_id: saved.audience_id,
        geojson: saved.geojson,
        updated_at: saved.updated_at,
    })
}

/// Load a saved local working draft from SQLite.
pub fn load_local_draft(
    database_path: String,
    draft_id: String,
) -> Result<Option<LocalDraftDto>, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let found = store.load(&draft_id).map_err(|e| e.to_string())?;
    Ok(found.map(|d| LocalDraftDto {
        draft_id: d.draft_id,
        d_tag: d.d_tag,
        entity_kind: d.entity_kind,
        title: d.title,
        description: d.description,
        audience_channel: d.audience_channel,
        audience_id: d.audience_id,
        geojson: d.geojson,
        updated_at: d.updated_at,
    }))
}

pub fn delete_local_draft(database_path: String, draft_id: String) -> Result<bool, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    store.delete(&draft_id).map_err(|e| e.to_string())
}

/// Lists all locally persisted SQLite working drafts ordered by most recently updated.
pub fn list_local_drafts(database_path: String) -> Result<Vec<LocalDraftDto>, String> {
    let store = DraftStore::open(database_path).map_err(|e| e.to_string())?;
    let drafts = store.list().map_err(|e| e.to_string())?;
    Ok(drafts
        .into_iter()
        .map(|d| LocalDraftDto {
            draft_id: d.draft_id,
            d_tag: d.d_tag,
            entity_kind: d.entity_kind,
            title: d.title,
            description: d.description,
            audience_channel: d.audience_channel,
            audience_id: d.audience_id,
            geojson: d.geojson,
            updated_at: d.updated_at,
        })
        .collect())
}
