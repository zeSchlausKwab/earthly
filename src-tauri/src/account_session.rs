use earthly_storage::{AccountSession, AccountSessionError, AccountSessionInput};
pub use earthly_storage::AccountSessionStore as AccountSessionState;
use tauri::State;

#[tauri::command]
pub fn account_session_load_v1(
    state: State<'_, AccountSessionState>,
) -> Result<Option<AccountSession>, AccountSessionError> {
    state.load()
}

#[tauri::command]
pub fn account_session_save_v1(
    state: State<'_, AccountSessionState>,
    input: AccountSessionInput,
) -> Result<AccountSession, AccountSessionError> {
    state.save(input)
}
