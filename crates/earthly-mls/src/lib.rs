//! RFC 9420 MLS + Cordn ContextVM private collaboration engine for Earthly.
//!
//! Wire-compatible with Earthly Web (`src/lib/private-workspace/`, `ts-mls`)
//! and the official `cordn-rs` v0.4.0 ContextVM coordinator over Nostr.

pub mod checkpoint;
pub mod coordinator;
pub mod envelope;
pub mod invitation;
pub mod mls;
pub mod policy;
pub mod service;
pub mod storage;

/// Default public key of Earthly's production Cordn coordinator on `wss://relay.earthly.city`.
pub const DEFAULT_CORDN_SERVER_PUBKEY: &str =
    "fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37";

/// Local development Cordn coordinator pubkey (secp256k1 scalar 1, loopback only).
pub const LOCAL_DEV_CORDN_SERVER_PUBKEY: &str =
    "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

pub const PRIVATE_WORKSPACE_METADATA_KIND: u16 = 37_523;
pub const PRIVATE_WORKSPACE_CHAT_KIND: u16 = 9;

pub fn is_valid_hex_pubkey(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}
