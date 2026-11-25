pub use earthly_storage::{
    OutboxDiagnosticSummary, OutboxEnqueueInput, OutboxError as OutboxCommandError,
    OutboxItemSummaryView, OutboxItemView, OutboxRelayResultInput, OutboxStore as OutboxState,
};
use tauri::State;

#[tauri::command]
pub fn outbox_enqueue_v1(
    state: State<'_, OutboxState>,
    input: OutboxEnqueueInput,
) -> Result<OutboxItemView, OutboxCommandError> {
    state.enqueue(input)
}

#[tauri::command]
pub fn outbox_list_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    state.list()
}

#[tauri::command]
pub fn outbox_list_summaries_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemSummaryView>, OutboxCommandError> {
    state.list_summaries()
}

#[tauri::command]
pub fn outbox_flush_v1(
    state: State<'_, OutboxState>,
) -> Result<Vec<OutboxItemView>, OutboxCommandError> {
    state.flush()
}

#[tauri::command]
pub fn outbox_record_results_v1(
    state: State<'_, OutboxState>,
    id: String,
    results: Vec<OutboxRelayResultInput>,
) -> Result<OutboxItemView, OutboxCommandError> {
    state.record_results(&id, results)
}

#[tauri::command]
pub fn outbox_retry_v1(
    state: State<'_, OutboxState>,
    id: String,
) -> Result<OutboxItemView, OutboxCommandError> {
    state.retry(&id)
}

#[tauri::command]
pub fn outbox_discard_v1(
    state: State<'_, OutboxState>,
    id: String,
) -> Result<OutboxItemView, OutboxCommandError> {
    state.discard(&id)
}
