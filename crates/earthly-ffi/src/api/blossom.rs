//! BUD-02 Blossom upload helpers matching Earthly Web's `uploadCompat.ts`
//! (`https://blossom.earthly.city`, `kind 24242` Nostr auth with `blossy v0.2.2`
//! zero-hash compat tag, `PUT /upload`, `X-SHA-256`, `Authorization: Nostr <b64>`).

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use nostr::PublicKey;
use sha2::{Digest, Sha256};

pub const DEFAULT_BLOSSOM_SERVER_URL: &str = "https://blossom.earthly.city";
const BLOSSY_V02_EMPTY_HASH: &str =
    "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Clone, Debug)]
pub struct BlossomUploadDto {
    pub url: String,
    pub sha256: String,
    pub size_bytes: u64,
    pub mime_type: String,
}

pub fn default_blossom_server_url() -> String {
    DEFAULT_BLOSSOM_SERVER_URL.to_owned()
}

pub fn compute_sha256_hex(bytes: Vec<u8>) -> String {
    format!("{:x}", Sha256::digest(&bytes))
}

/// Builds an unsigned BUD-02 Blossom authorization event (`kind 24242`) ready to
/// be signed by any active Earthly signer (Amber NIP-55, NIP-46 Bunker, or local key).
pub fn prepare_unsigned_blossom_upload_auth(
    pubkey_or_npub: String,
    sha256_hex: String,
    message: Option<String>,
) -> Result<String, String> {
    let pk = PublicKey::parse(pubkey_or_npub.trim())
        .map_err(|err| format!("invalid Nostr public key: {err}"))?;
    let sha = sha256_hex.trim().to_ascii_lowercase();
    if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("sha256_hex must be a 64-char hex digest".to_owned());
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let expiration = now.saturating_add(300);
    let content = message
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Upload Blob")
        .to_owned();

    let unsigned = serde_json::json!({
        "kind": 24242,
        "pubkey": pk.to_hex(),
        "created_at": now,
        "tags": [
            ["t", "upload"],
            ["expiration", expiration.to_string()],
            ["x", sha],
            ["x", BLOSSY_V02_EMPTY_HASH],
        ],
        "content": content,
    });
    serde_json::to_string(&unsigned).map_err(|e| e.to_string())
}

/// Uploads raw bytes (photo, avatar, or large GeoJSON) to a Blossom server via
/// `PUT /upload` with a signed `kind 24242` `Authorization: Nostr <base64>` header.
pub async fn upload_blob_to_blossom(
    server_url: String,
    bytes: Vec<u8>,
    mime_type: String,
    signed_auth_event_json: String,
) -> Result<BlossomUploadDto, String> {
    if bytes.is_empty() {
        return Err("Cannot upload empty payload to Blossom".to_owned());
    }
    let base = server_url.trim().trim_end_matches('/');
    if base.is_empty() || (!base.starts_with("https://") && !base.starts_with("http://")) {
        return Err("Invalid Blossom server URL".to_owned());
    }
    let upload_url = format!("{base}/upload");
    let sha256 = format!("{:x}", Sha256::digest(&bytes));
    let size_bytes = bytes.len() as u64;
    let content_type = if mime_type.trim().is_empty() {
        "application/octet-stream".to_owned()
    } else {
        mime_type.trim().to_owned()
    };

    let auth_b64 = BASE64_STANDARD.encode(signed_auth_event_json.as_bytes());
    let auth_header = format!("Nostr {auth_b64}");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|err| format!("failed to initialize HTTP client: {err}"))?;

    let response = client
        .put(&upload_url)
        .header("Authorization", auth_header)
        .header("Content-Type", &content_type)
        .header("X-SHA-256", &sha256)
        .body(bytes)
        .send()
        .await
        .map_err(|err| format!("Blossom upload request failed: {err}"))?;

    let status = response.status();
    let x_reason = response
        .headers()
        .get("X-Reason")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let body_text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        let mut details = Vec::new();
        if let Some(reason) = x_reason {
            details.push(reason);
        }
        let trimmed_body = body_text.trim();
        if !trimmed_body.is_empty() && !details.iter().any(|d| d == trimmed_body) {
            details.push(trimmed_body.to_owned());
        }
        return Err(if details.is_empty() {
            format!("Blossom upload failed ({status})")
        } else {
            format!("Blossom upload failed ({status}): {}", details.join(" — "))
        });
    }

    let parsed: serde_json::Value = serde_json::from_str(&body_text).unwrap_or_default();
    let url = parsed
        .get("url")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("{base}/{sha256}"));
    let returned_sha = parsed
        .get("sha256")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| s.len() == 64)
        .map(str::to_owned)
        .unwrap_or(sha256);
    let returned_size = parsed
        .get("size")
        .and_then(|v| v.as_u64())
        .unwrap_or(size_bytes);
    let returned_mime = parsed
        .get("type")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or(content_type);

    Ok(BlossomUploadDto {
        url,
        sha256: returned_sha,
        size_bytes: returned_size,
        mime_type: returned_mime,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::Keys;

    #[test]
    fn prepares_bud02_auth_event_with_blossy_compat_hash() {
        let keys = Keys::generate();
        let sha = compute_sha256_hex(b"earthly-photo".to_vec());
        let raw = prepare_unsigned_blossom_upload_auth(
            keys.public_key().to_hex(),
            sha.clone(),
            Some("Upload Story photo".to_owned()),
        )
        .unwrap();
        let val: serde_json::Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(val["kind"], 24242);
        assert_eq!(val["content"], "Upload Story photo");
        let tags = val["tags"].as_array().unwrap();
        assert!(tags.iter().any(|t| t[0] == "t" && t[1] == "upload"));
        assert!(tags.iter().any(|t| t[0] == "x" && t[1] == sha));
        assert!(tags.iter().any(|t| t[0] == "x" && t[1] == BLOSSY_V02_EMPTY_HASH));
    }
}
