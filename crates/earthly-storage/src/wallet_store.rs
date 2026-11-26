use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::secret_box::{is_encrypted_secret, SecretBox};

/// Individual Cashu proof persisted locally for a wallet.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashuProofRecord {
    pub id: String,
    pub amount: u64,
    pub secret: String,
    pub c: String,
    pub mint_url: String,
    #[serde(default)]
    pub token_event_id: Option<String>,
}

/// Outbound or pending Cashu token record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCashuToken {
    pub id: String,
    pub mint_url: String,
    pub amount_sats: u64,
    pub token: String,
    #[serde(default)]
    pub memo: Option<String>,
    pub created_at: u64,
    #[serde(default)]
    pub quote_id: Option<String>,
    #[serde(default = "default_pending_state")]
    pub state: String,
}

fn default_pending_state() -> String {
    "pending".to_owned()
}

/// Historical wallet transaction record (mint, melt, send, receive, nutzap).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashuHistoryRecord {
    pub id: String,
    /// `"in"` or `"out"`
    pub direction: String,
    pub amount_sats: u64,
    pub mint_url: String,
    #[serde(default = "default_unit")]
    pub unit: String,
    #[serde(default)]
    pub memo: Option<String>,
    #[serde(default)]
    pub event_id: Option<String>,
    #[serde(default)]
    pub counterparty_pubkey: Option<String>,
    pub created_at: u64,
}

fn default_unit() -> String {
    "sat".to_owned()
}

/// Complete persisted Cashu wallet state keyed by the owner's Nostr `pubkey_hex`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedCashuWallet {
    pub pubkey_hex: String,
    #[serde(default)]
    pub mints: Vec<String>,
    #[serde(default)]
    pub relays: Vec<String>,
    #[serde(default)]
    pub default_mint: Option<String>,
    pub p2pk_privkey_hex: String,
    pub p2pk_pubkey_hex: String,
    #[serde(default)]
    pub proofs: Vec<CashuProofRecord>,
    #[serde(default)]
    pub pending_tokens: Vec<PendingCashuToken>,
    #[serde(default)]
    pub history: Vec<CashuHistoryRecord>,
    #[serde(default)]
    pub nutzap_enabled: bool,
    #[serde(default)]
    pub updated_at: u64,
}

impl PersistedCashuWallet {
    /// Returns the total spendable balance in sats across all stored proofs.
    pub fn total_balance_sats(&self) -> u64 {
        self.proofs
            .iter()
            .fold(0u64, |acc, p| acc.saturating_add(p.amount))
    }

    /// Returns the spendable balance in sats for a specific normalized mint URL.
    pub fn balance_for_mint_sats(&self, mint_url: &str) -> u64 {
        let target = normalize_mint_url(mint_url);
        self.proofs
            .iter()
            .filter(|p| normalize_mint_url(&p.mint_url) == target)
            .fold(0u64, |acc, p| acc.saturating_add(p.amount))
    }
}

/// Error returned by [`CashuWalletStore`].
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WalletStoreError {
    pub code: String,
    pub message: String,
}

impl WalletStoreError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

impl From<rusqlite::Error> for WalletStoreError {
    fn from(error: rusqlite::Error) -> Self {
        Self::new("wallet-database-failed", error.to_string())
    }
}

impl std::fmt::Display for WalletStoreError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for WalletStoreError {}

/// SQLite-backed persistence for NIP-60/61 Cashu wallets encrypted at rest with [`SecretBox`].
#[derive(Debug)]
pub struct CashuWalletStore {
    connection: Mutex<Connection>,
}

impl CashuWalletStore {
    /// Opens (or creates) the SQLite database and initializes `earthly_cashu_wallets`.
    pub fn open(database_path: impl Into<PathBuf>) -> Result<Self, WalletStoreError> {
        let database_path = database_path.into();
        if let Some(parent) = database_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                WalletStoreError::new("wallet-open-failed", error.to_string())
            })?;
        }
        let connection = Connection::open(database_path)?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = FULL;
             PRAGMA busy_timeout = 5000;
             CREATE TABLE IF NOT EXISTS earthly_cashu_wallets (
               pubkey_hex TEXT PRIMARY KEY,
               mints_json TEXT NOT NULL,
               relays_json TEXT NOT NULL,
               default_mint TEXT,
               p2pk_privkey_enc TEXT NOT NULL,
               p2pk_pubkey_hex TEXT NOT NULL,
               proofs_enc TEXT NOT NULL,
               pending_tokens_enc TEXT NOT NULL,
               history_json TEXT NOT NULL,
               nutzap_enabled INTEGER NOT NULL DEFAULT 0,
               updated_at INTEGER NOT NULL
             );",
        )?;
        Ok(Self {
            connection: Mutex::new(connection),
        })
    }

    /// Loads a wallet without a master key (fails closed if encrypted fields are present).
    pub fn load_wallet(
        &self,
        pubkey_hex: &str,
    ) -> Result<Option<PersistedCashuWallet>, WalletStoreError> {
        self.load_wallet_with_master_key(pubkey_hex, None)
    }

    /// Loads a wallet for `pubkey_hex`, decrypting sensitive columns with `master_key_b64`.
    /// Fails closed if encrypted columns exist and decryption fails or no key is provided.
    pub fn load_wallet_with_master_key(
        &self,
        pubkey_hex: &str,
        master_key_b64: Option<&str>,
    ) -> Result<Option<PersistedCashuWallet>, WalletStoreError> {
        let key = normalize_pubkey_hex(pubkey_hex)?;
        let secret_box = parse_secret_box(master_key_b64)?;

        let connection = self.connection.lock().map_err(|_| {
            WalletStoreError::new("wallet-lock-failed", "Wallet store unavailable")
        })?;

        let row: Option<RawWalletRow> = connection
            .query_row(
                "SELECT pubkey_hex, mints_json, relays_json, default_mint,
                        p2pk_privkey_enc, p2pk_pubkey_hex, proofs_enc,
                        pending_tokens_enc, history_json, nutzap_enabled, updated_at
                 FROM earthly_cashu_wallets
                 WHERE pubkey_hex = ?1",
                params![key],
                |r| {
                    Ok(RawWalletRow {
                        pubkey_hex: r.get(0)?,
                        mints_json: r.get(1)?,
                        relays_json: r.get(2)?,
                        default_mint: r.get(3)?,
                        p2pk_privkey_enc: r.get(4)?,
                        p2pk_pubkey_hex: r.get(5)?,
                        proofs_enc: r.get(6)?,
                        pending_tokens_enc: r.get(7)?,
                        history_json: r.get(8)?,
                        nutzap_enabled: r.get::<_, i64>(9)? != 0,
                        updated_at: r.get::<_, i64>(10)?.max(0) as u64,
                    })
                },
            )
            .optional()?;

        let Some(raw) = row else {
            return Ok(None);
        };

        let has_encrypted = is_encrypted_secret(&raw.p2pk_privkey_enc)
            || is_encrypted_secret(&raw.proofs_enc)
            || is_encrypted_secret(&raw.pending_tokens_enc);

        let (p2pk_privkey_hex, proofs_json, pending_json) = match secret_box {
            None => {
                if has_encrypted {
                    return Err(WalletStoreError::new(
                        "wallet-decrypt-failed",
                        "Encrypted Cashu wallet present but no master key was provided",
                    ));
                }
                (
                    raw.p2pk_privkey_enc,
                    raw.proofs_enc,
                    raw.pending_tokens_enc,
                )
            }
            Some(ref cipher) => {
                let map_err = |e: String| WalletStoreError::new("wallet-decrypt-failed", e);
                let privkey = cipher
                    .decrypt_str(&raw.p2pk_privkey_enc)
                    .map_err(map_err)?;
                let proofs = cipher.decrypt_str(&raw.proofs_enc).map_err(map_err)?;
                let pending = cipher
                    .decrypt_str(&raw.pending_tokens_enc)
                    .map_err(map_err)?;
                (privkey, proofs, pending)
            }
        };

        let mints: Vec<String> = serde_json::from_str(&raw.mints_json)
            .map_err(|e| WalletStoreError::new("wallet-deserialize-failed", e.to_string()))?;
        let relays: Vec<String> = serde_json::from_str(&raw.relays_json)
            .map_err(|e| WalletStoreError::new("wallet-deserialize-failed", e.to_string()))?;
        let proofs: Vec<CashuProofRecord> = if proofs_json.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&proofs_json)
                .map_err(|e| WalletStoreError::new("wallet-deserialize-failed", e.to_string()))?
        };
        let pending_tokens: Vec<PendingCashuToken> = if pending_json.trim().is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(&pending_json)
                .map_err(|e| WalletStoreError::new("wallet-deserialize-failed", e.to_string()))?
        };
        let history: Vec<CashuHistoryRecord> = serde_json::from_str(&raw.history_json)
            .map_err(|e| WalletStoreError::new("wallet-deserialize-failed", e.to_string()))?;

        Ok(Some(PersistedCashuWallet {
            pubkey_hex: raw.pubkey_hex,
            mints,
            relays,
            default_mint: raw.default_mint,
            p2pk_privkey_hex,
            p2pk_pubkey_hex: raw.p2pk_pubkey_hex,
            proofs,
            pending_tokens,
            history,
            nutzap_enabled: raw.nutzap_enabled,
            updated_at: raw.updated_at,
        }))
    }

    /// Saves a wallet without encryption (only for callers without a master key).
    pub fn save_wallet(
        &self,
        wallet: &PersistedCashuWallet,
    ) -> Result<PersistedCashuWallet, WalletStoreError> {
        self.save_wallet_with_master_key(wallet, None)
    }

    /// Saves a wallet, encrypting `p2pk_privkey_hex`, serialized `proofs`, and `pending_tokens`
    /// with `SecretBox` when `master_key_b64` is provided.
    pub fn save_wallet_with_master_key(
        &self,
        wallet: &PersistedCashuWallet,
        master_key_b64: Option<&str>,
    ) -> Result<PersistedCashuWallet, WalletStoreError> {
        let secret_box = parse_secret_box(master_key_b64)?;
        let mut normalized = wallet.clone();
        normalized.pubkey_hex = normalize_pubkey_hex(&normalized.pubkey_hex)?;
        normalized.mints = normalize_mints(&normalized.mints);
        normalized.relays = normalize_relays(&normalized.relays);
        normalized.default_mint = normalized
            .default_mint
            .as_deref()
            .map(normalize_mint_url)
            .filter(|m| !m.is_empty())
            .or_else(|| normalized.mints.first().cloned());
        if normalized.updated_at == 0 {
            normalized.updated_at = current_unix_secs();
        }

        let mints_json = serde_json::to_string(&normalized.mints)
            .map_err(|e| WalletStoreError::new("wallet-serialize-failed", e.to_string()))?;
        let relays_json = serde_json::to_string(&normalized.relays)
            .map_err(|e| WalletStoreError::new("wallet-serialize-failed", e.to_string()))?;
        let proofs_json = serde_json::to_string(&normalized.proofs)
            .map_err(|e| WalletStoreError::new("wallet-serialize-failed", e.to_string()))?;
        let pending_json = serde_json::to_string(&normalized.pending_tokens)
            .map_err(|e| WalletStoreError::new("wallet-serialize-failed", e.to_string()))?;
        let history_json = serde_json::to_string(&normalized.history)
            .map_err(|e| WalletStoreError::new("wallet-serialize-failed", e.to_string()))?;

        let (p2pk_privkey_enc, proofs_enc, pending_tokens_enc) = match secret_box {
            None => (
                normalized.p2pk_privkey_hex.clone(),
                proofs_json,
                pending_json,
            ),
            Some(ref cipher) => {
                let map_err = |e: String| WalletStoreError::new("wallet-encrypt-failed", e);
                (
                    cipher
                        .encrypt_str(&normalized.p2pk_privkey_hex)
                        .map_err(map_err)?,
                    cipher.encrypt_str(&proofs_json).map_err(map_err)?,
                    cipher.encrypt_str(&pending_json).map_err(map_err)?,
                )
            }
        };

        let connection = self.connection.lock().map_err(|_| {
            WalletStoreError::new("wallet-lock-failed", "Wallet store unavailable")
        })?;
        connection.execute(
            "INSERT INTO earthly_cashu_wallets (
               pubkey_hex, mints_json, relays_json, default_mint,
               p2pk_privkey_enc, p2pk_pubkey_hex, proofs_enc,
               pending_tokens_enc, history_json, nutzap_enabled, updated_at
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT(pubkey_hex) DO UPDATE SET
               mints_json = excluded.mints_json,
               relays_json = excluded.relays_json,
               default_mint = excluded.default_mint,
               p2pk_privkey_enc = excluded.p2pk_privkey_enc,
               p2pk_pubkey_hex = excluded.p2pk_pubkey_hex,
               proofs_enc = excluded.proofs_enc,
               pending_tokens_enc = excluded.pending_tokens_enc,
               history_json = excluded.history_json,
               nutzap_enabled = excluded.nutzap_enabled,
               updated_at = excluded.updated_at",
            params![
                normalized.pubkey_hex,
                mints_json,
                relays_json,
                normalized.default_mint,
                p2pk_privkey_enc,
                normalized.p2pk_pubkey_hex,
                proofs_enc,
                pending_tokens_enc,
                history_json,
                if normalized.nutzap_enabled { 1i64 } else { 0i64 },
                normalized.updated_at as i64,
            ],
        )?;

        Ok(normalized)
    }

    /// Deletes a persisted wallet record by `pubkey_hex`.
    pub fn delete_wallet(&self, pubkey_hex: &str) -> Result<bool, WalletStoreError> {
        let key = normalize_pubkey_hex(pubkey_hex)?;
        let connection = self.connection.lock().map_err(|_| {
            WalletStoreError::new("wallet-lock-failed", "Wallet store unavailable")
        })?;
        let deleted = connection.execute(
            "DELETE FROM earthly_cashu_wallets WHERE pubkey_hex = ?1",
            params![key],
        )?;
        Ok(deleted > 0)
    }
}

struct RawWalletRow {
    pubkey_hex: String,
    mints_json: String,
    relays_json: String,
    default_mint: Option<String>,
    p2pk_privkey_enc: String,
    p2pk_pubkey_hex: String,
    proofs_enc: String,
    pending_tokens_enc: String,
    history_json: String,
    nutzap_enabled: bool,
    updated_at: u64,
}

fn parse_secret_box(master_key_b64: Option<&str>) -> Result<Option<SecretBox>, WalletStoreError> {
    master_key_b64
        .map(str::trim)
        .filter(|k| !k.is_empty())
        .map(|key| {
            SecretBox::from_base64_key(key)
                .map_err(|e| WalletStoreError::new("wallet-invalid-master-key", e))
        })
        .transpose()
}

fn normalize_pubkey_hex(pubkey_hex: &str) -> Result<String, WalletStoreError> {
    let trimmed = pubkey_hex.trim().to_ascii_lowercase();
    if trimmed.len() != 64 || !trimmed.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(WalletStoreError::new(
            "wallet-invalid-pubkey",
            "Wallet pubkey_hex must be a 64-character hex string",
        ));
    }
    Ok(trimmed)
}

fn normalize_mint_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_owned()
}

fn normalize_mints(mints: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for raw in mints {
        let clean = normalize_mint_url(raw);
        if (clean.starts_with("https://") || clean.starts_with("http://")) && seen.insert(clean.clone())
        {
            out.push(clean);
        }
    }
    out
}

fn normalize_relays(relays: &[String]) -> Vec<String> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for raw in relays {
        let clean = raw.trim().to_owned();
        if (clean.starts_with("wss://") || clean.starts_with("ws://")) && seen.insert(clean.clone())
        {
            out.push(clean);
        }
    }
    out
}

fn current_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine as _;

    fn test_master_key(byte: u8) -> String {
        BASE64_STANDARD.encode([byte; 32])
    }

    fn sample_wallet(pubkey_hex: &str) -> PersistedCashuWallet {
        PersistedCashuWallet {
            pubkey_hex: pubkey_hex.to_owned(),
            mints: vec!["https://mint.earthly.city".to_owned()],
            relays: vec!["wss://relay.earthly.city".to_owned()],
            default_mint: Some("https://mint.earthly.city".to_owned()),
            p2pk_privkey_hex: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
                .to_owned(),
            p2pk_pubkey_hex:
                "02aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".to_owned(),
            proofs: vec![
                CashuProofRecord {
                    id: "009a1f293253e41e".to_owned(),
                    amount: 8,
                    secret: "super-secret-proof-preimage-001".to_owned(),
                    c: "02bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
                        .to_owned(),
                    mint_url: "https://mint.earthly.city".to_owned(),
                    token_event_id: Some("event123".to_owned()),
                },
                CashuProofRecord {
                    id: "009a1f293253e41e".to_owned(),
                    amount: 4,
                    secret: "super-secret-proof-preimage-002".to_owned(),
                    c: "03cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
                        .to_owned(),
                    mint_url: "https://mint.earthly.city".to_owned(),
                    token_event_id: None,
                },
            ],
            pending_tokens: vec![PendingCashuToken {
                id: "tok-1".to_owned(),
                mint_url: "https://mint.earthly.city".to_owned(),
                amount_sats: 16,
                token: "cashuAeyJ0b2tlbiI6W10sInVuaXQiOiJzYXQifQ_secret_token_body".to_owned(),
                memo: Some("map tip".to_owned()),
                created_at: 1_700_000_000,
                quote_id: None,
                state: "pending".to_owned(),
            }],
            history: vec![CashuHistoryRecord {
                id: "hist-1".to_owned(),
                direction: "in".to_owned(),
                amount_sats: 12,
                mint_url: "https://mint.earthly.city".to_owned(),
                unit: "sat".to_owned(),
                memo: Some("minted".to_owned()),
                event_id: None,
                counterparty_pubkey: None,
                created_at: 1_700_000_001,
            }],
            nutzap_enabled: true,
            updated_at: 1_700_000_005,
        }
    }

    #[test]
    fn encrypts_p2pk_privkey_proofs_and_pending_tokens_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("wallet.sqlite3");
        let key_a = test_master_key(0x5a);
        let pubkey = "1".repeat(64);
        let wallet = sample_wallet(&pubkey);

        let store = CashuWalletStore::open(&db).unwrap();
        let saved = store
            .save_wallet_with_master_key(&wallet, Some(&key_a))
            .unwrap();
        assert_eq!(saved.total_balance_sats(), 12);
        assert_eq!(saved.p2pk_privkey_hex, wallet.p2pk_privkey_hex);
        assert_eq!(saved.proofs, wallet.proofs);
        assert_eq!(saved.pending_tokens, wallet.pending_tokens);
        drop(store);

        // Inspect actual SQLite database bytes (plus any WAL/SHM remnants) on disk.
        let mut disk_bytes = std::fs::read(&db).unwrap();
        let wal_path = dir.path().join("wallet.sqlite3-wal");
        if wal_path.exists() {
            disk_bytes.extend_from_slice(&std::fs::read(&wal_path).unwrap());
        }
        let disk_text = String::from_utf8_lossy(&disk_bytes);
        assert!(!disk_text.contains(&wallet.p2pk_privkey_hex));
        assert!(!disk_text.contains("super-secret-proof-preimage-001"));
        assert!(!disk_text.contains("super-secret-proof-preimage-002"));
        assert!(!disk_text.contains(&wallet.proofs[0].c));
        assert!(!disk_text.contains(&wallet.pending_tokens[0].token));
        assert!(disk_text.contains("enc:v1:"));

        // Reopen and verify round-trip decryption.
        let reopened = CashuWalletStore::open(&db).unwrap();
        let loaded = reopened
            .load_wallet_with_master_key(&pubkey, Some(&key_a))
            .unwrap()
            .expect("wallet should exist");
        assert_eq!(loaded, wallet);
    }

    #[test]
    fn wrong_or_missing_master_key_fails_closed() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("wallet_fail_closed.sqlite3");
        let key_a = test_master_key(0x11);
        let key_b = test_master_key(0x22);
        let pubkey = "a".repeat(64);
        let wallet = sample_wallet(&pubkey);

        let store = CashuWalletStore::open(&db).unwrap();
        store
            .save_wallet_with_master_key(&wallet, Some(&key_a))
            .unwrap();

        let wrong_err = store
            .load_wallet_with_master_key(&pubkey, Some(&key_b))
            .unwrap_err();
        assert_eq!(wrong_err.code, "wallet-decrypt-failed");

        let missing_err = store
            .load_wallet_with_master_key(&pubkey, None)
            .unwrap_err();
        assert_eq!(missing_err.code, "wallet-decrypt-failed");

        let plain_err = store.load_wallet(&pubkey).unwrap_err();
        assert_eq!(plain_err.code, "wallet-decrypt-failed");

        let invalid_err = store
            .load_wallet_with_master_key(&pubkey, Some("not-base64!"))
            .unwrap_err();
        assert_eq!(invalid_err.code, "wallet-invalid-master-key");
    }

    #[test]
    fn handles_missing_wallet_and_delete() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("wallet_missing.sqlite3");
        let pubkey = "b".repeat(64);

        let store = CashuWalletStore::open(&db).unwrap();
        assert_eq!(store.load_wallet(&pubkey).unwrap(), None);

        let wallet = sample_wallet(&pubkey);
        store.save_wallet(&wallet).unwrap();
        assert!(store.load_wallet(&pubkey).unwrap().is_some());
        assert!(store.delete_wallet(&pubkey).unwrap());
        assert_eq!(store.load_wallet(&pubkey).unwrap(), None);
        assert!(!store.delete_wallet(&pubkey).unwrap());
    }
}
