use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

const PROTOCOL_VERSION: u8 = 1;
const MAX_ACCOUNTS_JSON_BYTES: usize = 1024 * 1024;
const MAX_ACCOUNT_ID_BYTES: usize = 512;

#[derive(Debug)]
pub struct AccountSessionState {
    connection: Mutex<Connection>,
}

impl AccountSessionState {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, AccountSessionCommandError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AccountSessionCommandError::new("account-session-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(database_path)?;
        configure_and_migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(
        &self,
    ) -> Result<std::sync::MutexGuard<'_, Connection>, AccountSessionCommandError> {
        self.connection.lock().map_err(|_| {
            AccountSessionCommandError::new(
                "account-session-unavailable",
                "The account session store is unavailable",
            )
        })
    }

    fn load(&self) -> Result<Option<AccountSession>, AccountSessionCommandError> {
        let connection = self.connection()?;
        let session = connection
            .query_row(
                "SELECT version, accounts_json, active_account_id
                 FROM account_session
                 WHERE singleton = 1",
                [],
                |row| {
                    Ok(AccountSession {
                        version: row.get(0)?,
                        accounts_json: row.get(1)?,
                        active_account_id: row.get(2)?,
                    })
                },
            )
            .optional()?;
        if let Some(session) = &session {
            validate_session(
                session.version,
                &session.accounts_json,
                session.active_account_id.as_deref(),
            )?;
        }
        Ok(session)
    }

    fn save(
        &self,
        input: AccountSessionInput,
    ) -> Result<AccountSession, AccountSessionCommandError> {
        validate_session(
            input.version,
            &input.accounts_json,
            input.active_account_id.as_deref(),
        )?;
        let connection = self.connection()?;
        connection.execute(
            "INSERT INTO account_session (
               singleton, version, accounts_json, active_account_id, updated_at
             ) VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(singleton) DO UPDATE SET
               version = excluded.version,
               accounts_json = excluded.accounts_json,
               active_account_id = excluded.active_account_id,
               updated_at = excluded.updated_at",
            params![
                input.version,
                input.accounts_json,
                input.active_account_id,
                now_seconds(),
            ],
        )?;
        Ok(AccountSession {
            version: input.version,
            accounts_json: input.accounts_json,
            active_account_id: input.active_account_id,
        })
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSessionInput {
    version: u8,
    accounts_json: String,
    active_account_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSession {
    version: u8,
    accounts_json: String,
    active_account_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionCommandError {
    code: String,
    message: String,
}

impl AccountSessionCommandError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for AccountSessionCommandError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("account-session-database-failed", error.to_string())
    }
}

impl std::fmt::Display for AccountSessionCommandError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AccountSessionCommandError {}

fn configure_and_migrate(connection: &Connection) -> Result<(), AccountSessionCommandError> {
    connection.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA synchronous = FULL;
         PRAGMA busy_timeout = 5000;
         CREATE TABLE IF NOT EXISTS account_session (
           singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
           version INTEGER NOT NULL,
           accounts_json TEXT NOT NULL,
           active_account_id TEXT,
           updated_at INTEGER NOT NULL
         );",
    )?;
    Ok(())
}

fn validate_session(
    version: u8,
    accounts_json: &str,
    active_account_id: Option<&str>,
) -> Result<(), AccountSessionCommandError> {
    if version != PROTOCOL_VERSION {
        return Err(AccountSessionCommandError::new(
            "unsupported-account-session-version",
            format!("Unsupported account session version: {version}"),
        ));
    }
    if accounts_json.len() > MAX_ACCOUNTS_JSON_BYTES {
        return Err(AccountSessionCommandError::new(
            "account-session-too-large",
            "The serialized account session is too large",
        ));
    }
    let accounts: serde_json::Value = serde_json::from_str(accounts_json).map_err(|error| {
        AccountSessionCommandError::new("invalid-account-session", error.to_string())
    })?;
    if !accounts.is_array() {
        return Err(AccountSessionCommandError::new(
            "invalid-account-session",
            "Serialized accounts must be a JSON array",
        ));
    }
    if let Some(active_account_id) = active_account_id {
        if active_account_id.is_empty() || active_account_id.len() > MAX_ACCOUNT_ID_BYTES {
            return Err(AccountSessionCommandError::new(
                "invalid-account-session",
                "The active account id is invalid",
            ));
        }
    }
    Ok(())
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[tauri::command]
pub fn account_session_load_v1(
    state: State<'_, AccountSessionState>,
) -> Result<Option<AccountSession>, AccountSessionCommandError> {
    state.load()
}

#[tauri::command]
pub fn account_session_save_v1(
    state: State<'_, AccountSessionState>,
    input: AccountSessionInput,
) -> Result<AccountSession, AccountSessionCommandError> {
    state.save(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(accounts_json: &str, active_account_id: Option<&str>) -> AccountSessionInput {
        AccountSessionInput {
            version: PROTOCOL_VERSION,
            accounts_json: accounts_json.to_owned(),
            active_account_id: active_account_id.map(str::to_owned),
        }
    }

    #[test]
    fn session_survives_store_reopen() {
        let directory = tempfile::tempdir().expect("temp dir");
        let database = directory.path().join("earthly.sqlite3");
        let state = AccountSessionState::open(&database).expect("open account session");
        let expected = state
            .save(input(
                r#"[{"id":"private-key:abc","type":"private-key"}]"#,
                Some("private-key:abc"),
            ))
            .expect("save account session");
        drop(state);

        let reopened = AccountSessionState::open(&database).expect("reopen account session");
        assert_eq!(
            reopened.load().expect("load account session"),
            Some(expected)
        );
    }

    #[test]
    fn rejects_non_array_and_oversized_account_payloads() {
        let directory = tempfile::tempdir().expect("temp dir");
        let state = AccountSessionState::open(directory.path().join("earthly.sqlite3"))
            .expect("open account session");

        assert!(state.save(input("{}", None)).is_err());
        assert!(state
            .save(input(
                &format!("[\"{}\"]", "x".repeat(MAX_ACCOUNTS_JSON_BYTES)),
                None,
            ))
            .is_err());
    }
}
