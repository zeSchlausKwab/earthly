use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

pub const ACCOUNT_SESSION_PROTOCOL_VERSION: u8 = 1;
pub const MAX_ACCOUNTS_JSON_BYTES: usize = 1024 * 1024;
pub const MAX_ACCOUNT_ID_BYTES: usize = 512;

#[derive(Debug)]
pub struct AccountSessionStore {
    connection: Mutex<Connection>,
}

impl AccountSessionStore {
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, AccountSessionError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                AccountSessionError::new("account-session-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(database_path)?;
        configure_and_migrate(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    fn connection(&self) -> Result<std::sync::MutexGuard<'_, Connection>, AccountSessionError> {
        self.connection.lock().map_err(|_| {
            AccountSessionError::new(
                "account-session-unavailable",
                "The account session store is unavailable",
            )
        })
    }

    pub fn load(&self) -> Result<Option<AccountSession>, AccountSessionError> {
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

    pub fn save(&self, input: AccountSessionInput) -> Result<AccountSession, AccountSessionError> {
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountSessionInput {
    pub version: u8,
    pub accounts_json: String,
    pub active_account_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSession {
    pub version: u8,
    pub accounts_json: String,
    pub active_account_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSessionError {
    pub code: String,
    pub message: String,
}

impl AccountSessionError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for AccountSessionError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("account-session-database-failed", error.to_string())
    }
}

impl std::fmt::Display for AccountSessionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AccountSessionError {}

fn configure_and_migrate(connection: &Connection) -> Result<(), AccountSessionError> {
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
) -> Result<(), AccountSessionError> {
    if version != ACCOUNT_SESSION_PROTOCOL_VERSION {
        return Err(AccountSessionError::new(
            "unsupported-account-session-version",
            format!("Unsupported account session version: {version}"),
        ));
    }
    if accounts_json.len() > MAX_ACCOUNTS_JSON_BYTES {
        return Err(AccountSessionError::new(
            "account-session-too-large",
            "The serialized account session is too large",
        ));
    }
    let accounts: serde_json::Value = serde_json::from_str(accounts_json)
        .map_err(|error| AccountSessionError::new("invalid-account-session", error.to_string()))?;
    if !accounts.is_array() {
        return Err(AccountSessionError::new(
            "invalid-account-session",
            "Serialized accounts must be a JSON array",
        ));
    }
    if let Some(active_account_id) = active_account_id {
        if active_account_id.is_empty() || active_account_id.len() > MAX_ACCOUNT_ID_BYTES {
            return Err(AccountSessionError::new(
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

#[cfg(test)]
mod tests {
    use super::*;

    fn input(accounts_json: &str, active_account_id: Option<&str>) -> AccountSessionInput {
        AccountSessionInput {
            version: ACCOUNT_SESSION_PROTOCOL_VERSION,
            accounts_json: accounts_json.to_owned(),
            active_account_id: active_account_id.map(str::to_owned),
        }
    }

    #[test]
    fn session_survives_store_reopen() {
        let directory = tempfile::tempdir().expect("temp dir");
        let database = directory.path().join("earthly.sqlite3");
        let store = AccountSessionStore::open(&database).expect("open account session");
        let expected = store
            .save(input(
                r#"[{"id":"private-key:abc","type":"private-key"}]"#,
                Some("private-key:abc"),
            ))
            .expect("save account session");
        drop(store);

        let reopened = AccountSessionStore::open(&database).expect("reopen account session");
        assert_eq!(
            reopened.load().expect("load account session"),
            Some(expected)
        );
    }

    #[test]
    fn rejects_non_array_and_oversized_account_payloads() {
        let directory = tempfile::tempdir().expect("temp dir");
        let store = AccountSessionStore::open(directory.path().join("earthly.sqlite3"))
            .expect("open account session");

        assert!(store.save(input("{}", None)).is_err());
        assert!(store
            .save(input(
                &format!("[\"{}\"]", "x".repeat(MAX_ACCOUNTS_JSON_BYTES)),
                None,
            ))
            .is_err());
    }
}
