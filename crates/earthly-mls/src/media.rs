//! Encrypted media (`cordn-em-v1` + Earthly persistent map media `earthly-pm-v1`).
//!
//! Wire-compatible with Cordn `spec/applications/encrypted-media.md` and Earthly Web
//! (`src/lib/private-workspace/media.ts`):
//! - AEAD: `ChaCha20-Poly1305` (RFC 8439), 32-byte key, 12-byte fresh CSPRNG nonce.
//! - Nonce is detached: carried ONLY in NIP-92 `imeta` `n <24-char lowercase hex>`,
//!   NEVER prepended to the encrypted blob.
//! - AAD: `utf8(mime) || 0x00 || utf8(filename) || 0x00 || sha256(plaintext)`
//!   (where `sha256(plaintext)` is 32 raw bytes, NOT hex).
//! - `cordn-em-v1`: key derived via `MLS-Exporter("cordn", b"encrypted-media", 32)` for
//!   the posting epoch; key NEVER appears in `imeta`.
//! - `earthly-pm-v1`: Earthly persistent map media for late-joiner checkpoint replay;
//!   uses a fresh random 32-byte per-blob key carried in `imeta` `k <64-char lowercase hex>`
//!   strictly inside the MLS-encrypted envelope.

use chacha20poly1305::aead::rand_core::RngCore;
use chacha20poly1305::aead::{Aead, KeyInit, OsRng, Payload};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const CORDN_ENCRYPTED_MEDIA_VERSION: &str = "cordn-em-v1";
pub const EARTHLY_PERSISTENT_MEDIA_VERSION: &str = "earthly-pm-v1";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EncryptedMediaImeta {
    pub url: String,
    pub mime: String,
    pub filename: String,
    /// Lowercase 64-char hex SHA-256 of the plaintext bytes (`x`).
    pub sha256_hex: String,
    /// Lowercase 24-char hex 12-byte detached nonce (`n`).
    pub nonce_hex: String,
    /// Encryption version (`v`): `"cordn-em-v1"` or `"earthly-pm-v1"`.
    pub version: String,
    /// Lowercase 64-char hex 32-byte per-blob key (`k`), present ONLY for `"earthly-pm-v1"`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_hex: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dim: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blurhash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbhash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EncryptedMediaBlob {
    /// Detached ChaCha20-Poly1305 ciphertext + 16-byte tag (NO prepended nonce).
    pub ciphertext: Vec<u8>,
    /// Lowercase 64-char hex SHA-256 of the ciphertext blob (Blossom content address).
    pub ciphertext_sha256_hex: String,
    /// Lowercase 64-char hex SHA-256 of the plaintext (`imeta` `x`).
    pub plaintext_sha256_hex: String,
    /// Lowercase 24-char hex 12-byte nonce (`imeta` `n`).
    pub nonce_hex: String,
    /// Version (`"cordn-em-v1"` or `"earthly-pm-v1"`).
    pub version: String,
    /// Lowercase 64-char hex per-blob key (`imeta` `k`), `Some` ONLY for `"earthly-pm-v1"`.
    pub key_hex: Option<String>,
    pub mime: String,
    pub filename: String,
}

impl EncryptedMediaBlob {
    pub fn into_imeta(
        self,
        url: String,
        dim: Option<String>,
        blurhash: Option<String>,
        thumbhash: Option<String>,
        alt: Option<String>,
    ) -> EncryptedMediaImeta {
        EncryptedMediaImeta {
            url,
            mime: self.mime,
            filename: self.filename,
            sha256_hex: self.plaintext_sha256_hex,
            nonce_hex: self.nonce_hex,
            version: self.version,
            key_hex: self.key_hex,
            dim,
            blurhash,
            thumbhash,
            alt,
        }
    }
}

fn is_lowercase_hex(value: &str, expected_len: usize) -> bool {
    value.len() == expected_len
        && value
            .bytes()
            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn validate_aad_field(name: &str, value: &str) -> Result<(), String> {
    if value.is_empty() {
        return Err(format!("Encrypted media {name} cannot be empty"));
    }
    if value.as_bytes().contains(&0) {
        return Err(format!("Encrypted media {name} cannot contain NUL bytes"));
    }
    Ok(())
}

/// Builds exact Cordn `cordn-em-v1` / `earthly-pm-v1` AAD:
/// `utf8(mime) || 0x00 || utf8(filename) || 0x00 || sha256(plaintext)` (32 raw bytes).
pub fn build_encrypted_media_aad(
    mime: &str,
    filename: &str,
    plaintext_sha256: &[u8; 32],
) -> Result<Vec<u8>, String> {
    validate_aad_field("MIME type", mime)?;
    validate_aad_field("filename", filename)?;
    let mut aad = Vec::with_capacity(mime.len() + 1 + filename.len() + 1 + 32);
    aad.extend_from_slice(mime.as_bytes());
    aad.push(0x00);
    aad.extend_from_slice(filename.as_bytes());
    aad.push(0x00);
    aad.extend_from_slice(plaintext_sha256);
    Ok(aad)
}

/// Deterministic ChaCha20-Poly1305 encryption with an explicit 12-byte nonce
/// (used internally and for cross-implementation byte-for-byte test vectors).
pub fn encrypt_media_with_nonce(
    plaintext: &[u8],
    key: &[u8; 32],
    nonce: &[u8; 12],
    mime: &str,
    filename: &str,
    version: &str,
    include_key_hex: bool,
) -> Result<EncryptedMediaBlob, String> {
    if version != CORDN_ENCRYPTED_MEDIA_VERSION && version != EARTHLY_PERSISTENT_MEDIA_VERSION {
        return Err(format!("Unsupported encrypted media version: {version}"));
    }
    let pt_hash_arr: [u8; 32] = Sha256::digest(plaintext).into();
    let aad = build_encrypted_media_aad(mime, filename, &pt_hash_arr)?;
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("ChaCha20-Poly1305 media key init failed: {e}"))?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad: &aad,
            },
        )
        .map_err(|e| format!("Encrypted media AEAD encryption failed: {e}"))?;
    let ct_hash: [u8; 32] = Sha256::digest(&ciphertext).into();
    Ok(EncryptedMediaBlob {
        ciphertext,
        ciphertext_sha256_hex: hex::encode(ct_hash),
        plaintext_sha256_hex: hex::encode(pt_hash_arr),
        nonce_hex: hex::encode(nonce),
        version: version.to_owned(),
        key_hex: if include_key_hex {
            Some(hex::encode(key))
        } else {
            None
        },
        mime: mime.to_owned(),
        filename: filename.to_owned(),
    })
}

/// Encrypts media per Cordn `spec/applications/encrypted-media.md` (`cordn-em-v1`).
/// Uses a fresh 12-byte OS CSPRNG nonce (`OsRng`) that is detached into `nonce_hex`.
pub fn encrypt_cordn_media(
    plaintext: &[u8],
    epoch_media_key: &[u8; 32],
    mime: &str,
    filename: &str,
) -> Result<EncryptedMediaBlob, String> {
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut nonce);
    encrypt_media_with_nonce(
        plaintext,
        epoch_media_key,
        &nonce,
        mime,
        filename,
        CORDN_ENCRYPTED_MEDIA_VERSION,
        false,
    )
}

/// Encrypts persistent map media (`earthly-pm-v1`) using a fresh 32-byte per-blob
/// CSPRNG key carried inside `imeta` `k` (strictly inside MLS envelopes so late-joiner
/// checkpoints remain decryptable without re-uploading blobs to Blossom).
pub fn encrypt_persistent_map_media(
    plaintext: &[u8],
    mime: &str,
    filename: &str,
) -> Result<EncryptedMediaBlob, String> {
    let mut key = [0u8; 32];
    let mut nonce = [0u8; 12];
    OsRng.fill_bytes(&mut key);
    OsRng.fill_bytes(&mut nonce);
    encrypt_media_with_nonce(
        plaintext,
        &key,
        &nonce,
        mime,
        filename,
        EARTHLY_PERSISTENT_MEDIA_VERSION,
        true,
    )
}

/// Decrypts raw `cordn-em-v1` / `earthly-pm-v1` ciphertext, verifying both the
/// ChaCha20-Poly1305 AEAD tag over the exact AAD AND `sha256(plaintext) == expected_sha256_hex`.
pub fn decrypt_encrypted_media(
    ciphertext: &[u8],
    key: &[u8; 32],
    nonce_hex: &str,
    mime: &str,
    filename: &str,
    expected_sha256_hex: &str,
    version: &str,
) -> Result<Vec<u8>, String> {
    if version != CORDN_ENCRYPTED_MEDIA_VERSION && version != EARTHLY_PERSISTENT_MEDIA_VERSION {
        return Err(format!("Unsupported encrypted media version: {version}"));
    }
    if !is_lowercase_hex(nonce_hex, 24) {
        return Err("Encrypted media nonce `n` must be 24 lowercase hex chars".to_owned());
    }
    if !is_lowercase_hex(expected_sha256_hex, 64) {
        return Err("Encrypted media digest `x` must be 64 lowercase hex chars".to_owned());
    }
    if ciphertext.len() < 16 {
        return Err("Encrypted media ciphertext is too short".to_owned());
    }
    let nonce_vec = hex::decode(nonce_hex).map_err(|_| "Invalid nonce hex".to_owned())?;
    let expected_hash_vec =
        hex::decode(expected_sha256_hex).map_err(|_| "Invalid sha256 hex".to_owned())?;
    let mut expected_hash = [0u8; 32];
    expected_hash.copy_from_slice(&expected_hash_vec);

    let aad = build_encrypted_media_aad(mime, filename, &expected_hash)?;
    let cipher = ChaCha20Poly1305::new_from_slice(key)
        .map_err(|e| format!("ChaCha20-Poly1305 media key init failed: {e}"))?;
    let plaintext = cipher
        .decrypt(
            Nonce::from_slice(&nonce_vec),
            Payload {
                msg: ciphertext,
                aad: &aad,
            },
        )
        .map_err(|_| "Encrypted media decryption failed (invalid key, nonce, or AAD)".to_owned())?;

    let actual_hash: [u8; 32] = Sha256::digest(&plaintext).into();
    if actual_hash != expected_hash {
        return Err("Encrypted media plaintext SHA-256 does not match `x`".to_owned());
    }
    Ok(plaintext)
}

/// High-level decrypt dispatching on `imeta.version`:
/// - `cordn-em-v1`: requires `epoch_media_key: Some(...)`
/// - `earthly-pm-v1`: uses embedded `imeta.key_hex` (`k`)
pub fn decrypt_media_attachment(
    ciphertext: &[u8],
    imeta: &EncryptedMediaImeta,
    epoch_media_key: Option<&[u8; 32]>,
) -> Result<Vec<u8>, String> {
    match imeta.version.as_str() {
        CORDN_ENCRYPTED_MEDIA_VERSION => {
            let key = epoch_media_key.ok_or_else(|| {
                "Missing MLS epoch encrypted-media key for cordn-em-v1 attachment".to_owned()
            })?;
            decrypt_encrypted_media(
                ciphertext,
                key,
                &imeta.nonce_hex,
                &imeta.mime,
                &imeta.filename,
                &imeta.sha256_hex,
                &imeta.version,
            )
        }
        EARTHLY_PERSISTENT_MEDIA_VERSION => {
            let key_hex = imeta.key_hex.as_deref().ok_or_else(|| {
                "Missing per-blob key `k` on earthly-pm-v1 attachment".to_owned()
            })?;
            if !is_lowercase_hex(key_hex, 64) {
                return Err("Invalid `k` key hex on earthly-pm-v1 attachment".to_owned());
            }
            let key_bytes = hex::decode(key_hex).map_err(|_| "Invalid `k` hex".to_owned())?;
            let mut key = [0u8; 32];
            key.copy_from_slice(&key_bytes);
            decrypt_encrypted_media(
                ciphertext,
                &key,
                &imeta.nonce_hex,
                &imeta.mime,
                &imeta.filename,
                &imeta.sha256_hex,
                &imeta.version,
            )
        }
        other => Err(format!("Unsupported encrypted media version: {other}")),
    }
}

/// Builds a validated NIP-92 `imeta` tag:
/// `["imeta", "url <url>", "m <mime>", "filename <name>", "x <sha256_hex>", "n <nonce_24hex>", "v <ver>", ...]`
pub fn build_imeta_tag(imeta: &EncryptedMediaImeta) -> Result<Vec<String>, String> {
    if imeta.url.trim().is_empty() {
        return Err("imeta `url` cannot be empty".to_owned());
    }
    validate_aad_field("MIME type", &imeta.mime)?;
    validate_aad_field("filename", &imeta.filename)?;
    if !is_lowercase_hex(&imeta.sha256_hex, 64) {
        return Err("imeta `x` must be 64 lowercase hex chars".to_owned());
    }
    if !is_lowercase_hex(&imeta.nonce_hex, 24) {
        return Err("imeta `n` must be 24 lowercase hex chars".to_owned());
    }
    match imeta.version.as_str() {
        CORDN_ENCRYPTED_MEDIA_VERSION => {
            if imeta.key_hex.is_some() {
                return Err("cordn-em-v1 imeta tags must not embed key `k`".to_owned());
            }
        }
        EARTHLY_PERSISTENT_MEDIA_VERSION => {
            let k = imeta
                .key_hex
                .as_deref()
                .ok_or_else(|| "earthly-pm-v1 imeta tag requires `k`".to_owned())?;
            if !is_lowercase_hex(k, 64) {
                return Err("earthly-pm-v1 imeta `k` must be 64 lowercase hex chars".to_owned());
            }
        }
        other => {
            return Err(format!("Unsupported encrypted media version: {other}"));
        }
    }

    let mut tag = vec![
        "imeta".to_owned(),
        format!("url {}", imeta.url.trim()),
        format!("m {}", imeta.mime),
        format!("filename {}", imeta.filename),
        format!("x {}", imeta.sha256_hex),
        format!("n {}", imeta.nonce_hex),
        format!("v {}", imeta.version),
    ];
    if let Some(k) = &imeta.key_hex {
        tag.push(format!("k {k}"));
    }
    if let Some(dim) = imeta.dim.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        tag.push(format!("dim {dim}"));
    }
    if let Some(bh) = imeta
        .blurhash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tag.push(format!("blurhash {bh}"));
    }
    if let Some(th) = imeta
        .thumbhash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        tag.push(format!("thumbhash {th}"));
    }
    if let Some(alt) = imeta.alt.as_deref().filter(|s| !s.is_empty()) {
        tag.push(format!("alt {alt}"));
    }
    Ok(tag)
}

/// Parses and validates a NIP-92 `imeta` tag for `cordn-em-v1` or `earthly-pm-v1`.
/// Rejects missing or unknown `v`, malformed hex fields, or missing required keys.
pub fn parse_imeta_tag(tag: &[String]) -> Result<EncryptedMediaImeta, String> {
    if tag.first().map(String::as_str) != Some("imeta") {
        return Err("Tag is not an `imeta` tag".to_owned());
    }
    let mut url: Option<String> = None;
    let mut mime: Option<String> = None;
    let mut filename: Option<String> = None;
    let mut sha256_hex: Option<String> = None;
    let mut nonce_hex: Option<String> = None;
    let mut version: Option<String> = None;
    let mut key_hex: Option<String> = None;
    let mut dim: Option<String> = None;
    let mut blurhash: Option<String> = None;
    let mut thumbhash: Option<String> = None;
    let mut alt: Option<String> = None;

    for entry in &tag[1..] {
        let Some((k, v)) = entry.split_once(' ') else {
            continue;
        };
        if v.is_empty() {
            continue;
        }
        match k {
            "url" => url = Some(v.to_owned()),
            "m" => mime = Some(v.to_owned()),
            "filename" => filename = Some(v.to_owned()),
            "x" => sha256_hex = Some(v.to_owned()),
            "n" => nonce_hex = Some(v.to_owned()),
            "v" => version = Some(v.to_owned()),
            "k" => key_hex = Some(v.to_owned()),
            "dim" => dim = Some(v.to_owned()),
            "blurhash" => blurhash = Some(v.to_owned()),
            "thumbhash" => thumbhash = Some(v.to_owned()),
            "alt" => alt = Some(v.to_owned()),
            _ => {}
        }
    }

    let version = version.ok_or_else(|| "Missing `v` version in imeta tag".to_owned())?;
    match version.as_str() {
        CORDN_ENCRYPTED_MEDIA_VERSION => {
            if key_hex.is_some() {
                return Err("cordn-em-v1 imeta tag must not contain `k`".to_owned());
            }
        }
        EARTHLY_PERSISTENT_MEDIA_VERSION => {
            let k = key_hex
                .as_deref()
                .ok_or_else(|| "Missing `k` per-blob key in earthly-pm-v1 imeta tag".to_owned())?;
            if !is_lowercase_hex(k, 64) {
                return Err("Invalid `k` key in earthly-pm-v1 imeta tag".to_owned());
            }
        }
        other => return Err(format!("Unknown encrypted media version in imeta: {other}")),
    }

    let url = url
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| "Missing `url` in imeta tag".to_owned())?;
    let mime = mime.ok_or_else(|| "Missing `m` MIME type in imeta tag".to_owned())?;
    let filename = filename.ok_or_else(|| "Missing `filename` in imeta tag".to_owned())?;
    validate_aad_field("MIME type", &mime)?;
    validate_aad_field("filename", &filename)?;

    let sha256_hex = sha256_hex.ok_or_else(|| "Missing `x` sha256 in imeta tag".to_owned())?;
    if !is_lowercase_hex(&sha256_hex, 64) {
        return Err("Invalid `x` sha256 in imeta tag".to_owned());
    }
    let nonce_hex = nonce_hex.ok_or_else(|| "Missing `n` nonce in imeta tag".to_owned())?;
    if !is_lowercase_hex(&nonce_hex, 24) {
        return Err("Invalid `n` nonce in imeta tag".to_owned());
    }

    Ok(EncryptedMediaImeta {
        url,
        mime,
        filename,
        sha256_hex,
        nonce_hex,
        version,
        key_hex,
        dim,
        blurhash,
        thumbhash,
        alt,
    })
}

/// Extracts all valid `cordn-em-v1` / `earthly-pm-v1` `imeta` tags from an envelope's tag list.
pub fn parse_imeta_tags(tags: &[Vec<String>]) -> Vec<EncryptedMediaImeta> {
    tags.iter()
        .filter(|t| t.first().map(String::as_str) == Some("imeta"))
        .filter_map(|t| parse_imeta_tag(t).ok())
        .collect()
}

/// Generates a randomized, privacy-preserving attachment filename (`<24-hex>.<ext>`)
/// with a safe extension derived from `mime`.
pub fn randomize_attachment_filename(mime: &str) -> String {
    let base_mime = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    let ext = match base_mime.as_str() {
        "image/jpeg" | "image/jpg" => "jpg",
        "image/png" => "png",
        "image/webp" => "webp",
        "image/gif" => "gif",
        "image/avif" => "avif",
        "image/heic" | "image/heif" => "heic",
        "image/svg+xml" => "svg",
        "application/pdf" => "pdf",
        "application/geo+json" | "application/vnd.geo+json" => "geojson",
        "application/json" => "json",
        "application/gpx+xml" => "gpx",
        "application/vnd.google-earth.kml+xml" => "kml",
        "text/plain" => "txt",
        "text/csv" => "csv",
        "audio/mpeg" => "mp3",
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/aac" => "m4a",
        "audio/wav" | "audio/x-wav" => "wav",
        "video/mp4" => "mp4",
        "video/webm" => "webm",
        "video/quicktime" => "mov",
        _ => "bin",
    };
    let mut rnd = [0u8; 12];
    OsRng.fill_bytes(&mut rnd);
    format!("{}.{ext}", hex::encode(rnd))
}

/// Strips privacy-sensitive metadata (EXIF/GPS/XMP/comments/text chunks) from JPEG and PNG
/// images cleanly while preserving image display data (`SOF`/`DHT`/`DQT`/`SOS`/`APP0` for JPEG;
/// critical chunks + display ancillary chunks for PNG).
/// Returns original bytes unchanged on unsupported MIME types or malformed input.
pub fn strip_image_metadata(bytes: &[u8], mime: &str) -> Vec<u8> {
    let base_mime = mime
        .split(';')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    if matches!(base_mime.as_str(), "image/jpeg" | "image/jpg")
        || (bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xD8)
    {
        return strip_jpeg_metadata(bytes).unwrap_or_else(|| bytes.to_vec());
    }
    if base_mime == "image/png"
        || bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    {
        return strip_png_metadata(bytes).unwrap_or_else(|| bytes.to_vec());
    }
    bytes.to_vec()
}

fn strip_jpeg_metadata(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 4 || bytes[0] != 0xFF || bytes[1] != 0xD8 {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&[0xFF, 0xD8]); // SOI
    let mut pos = 2usize;

    while pos < bytes.len() {
        if bytes[pos] != 0xFF {
            return None;
        }
        // Skip any fill 0xFF bytes.
        while pos < bytes.len() && bytes[pos] == 0xFF {
            pos += 1;
        }
        if pos >= bytes.len() {
            break;
        }
        let marker = bytes[pos];
        pos += 1;

        // EOI
        if marker == 0xD9 {
            out.extend_from_slice(&[0xFF, 0xD9]);
            return Some(out);
        }
        // SOS: copy header + entropy-coded scan data through the end of the image verbatim.
        if marker == 0xDA {
            out.extend_from_slice(&[0xFF, 0xDA]);
            out.extend_from_slice(&bytes[pos..]);
            return Some(out);
        }
        // Standalone markers without length payload (RST0..RST7, TEM, SOI).
        if (0xD0..=0xD8).contains(&marker) || marker == 0x01 {
            out.extend_from_slice(&[0xFF, marker]);
            continue;
        }

        if pos + 2 > bytes.len() {
            return None;
        }
        let seg_len = u16::from_be_bytes([bytes[pos], bytes[pos + 1]]) as usize;
        if seg_len < 2 || pos + seg_len > bytes.len() {
            return None;
        }

        // Strip APP1..APP15 (0xE1..=0xEF: EXIF/GPS, XMP, ICC, IPTC, Adobe) and COM (0xFE).
        // Preserve APP0 (0xE0 JFIF), DQT (0xDB), DHT (0xC4), DRI (0xDD), SOF* (0xC0..0xCF), etc.
        let should_strip = (0xE1..=0xEF).contains(&marker) || marker == 0xFE;
        if !should_strip {
            out.extend_from_slice(&[0xFF, marker]);
            out.extend_from_slice(&bytes[pos..pos + seg_len]);
        }
        pos += seg_len;
    }

    Some(out)
}

fn strip_png_metadata(bytes: &[u8]) -> Option<Vec<u8>> {
    const PNG_SIG: [u8; 8] = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 8 || !bytes.starts_with(&PNG_SIG) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&PNG_SIG);
    let mut pos = 8usize;
    let mut saw_iend = false;

    while pos < bytes.len() {
        if pos + 12 > bytes.len() {
            return None;
        }
        let length = u32::from_be_bytes([
            bytes[pos],
            bytes[pos + 1],
            bytes[pos + 2],
            bytes[pos + 3],
        ]) as usize;
        let chunk_type = &bytes[pos + 4..pos + 8];
        let total_chunk = 12usize.checked_add(length)?;
        if pos + total_chunk > bytes.len() {
            return None;
        }

        // Critical chunks have bit 5 of first byte cleared (uppercase ASCII: IHDR, PLTE, IDAT, IEND).
        let is_critical = (chunk_type[0] & 0x20) == 0;
        let is_stripped_metadata = matches!(
            chunk_type,
            b"tEXt" | b"zTXt" | b"iTXt" | b"eXIf" | b"tIME" | b"dSIG" | b"oFFs" | b"pCAL" | b"sCAL"
        );
        // Keep all critical chunks plus safe display ancillary chunks (tRNS, gAMA, cHRM, sRGB,
        // pHYs, bKGD, acTL, fcTL, fdAT, cICP, mDCV, cLLI); strip text/EXIF/time and other
        // non-critical metadata chunks.
        let is_safe_ancillary = matches!(
            chunk_type,
            b"tRNS"
                | b"gAMA"
                | b"cHRM"
                | b"sRGB"
                | b"pHYs"
                | b"bKGD"
                | b"acTL"
                | b"fcTL"
                | b"fdAT"
                | b"cICP"
                | b"mDCV"
                | b"cLLI"
        );

        if is_critical || (!is_stripped_metadata && is_safe_ancillary) {
            out.extend_from_slice(&bytes[pos..pos + total_chunk]);
        }
        pos += total_chunk;
        if chunk_type == b"IEND" {
            saw_iend = true;
            break;
        }
    }

    if saw_iend {
        Some(out)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cordn_em_v1_deterministic_vector_and_tamper_checks() {
        // Deterministic cross-stack test vector (Rust <-> Earthly Web parity check).
        let key: [u8; 32] = [
            0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d,
            0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b,
            0x1c, 0x1d, 0x1e, 0x1f,
        ];
        let nonce: [u8; 12] = [
            0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab,
        ];
        let plaintext = b"Earthly encrypted photo payload";
        let mime = "image/jpeg";
        let filename = "field-photo.jpg";

        let blob = encrypt_media_with_nonce(
            plaintext,
            &key,
            &nonce,
            mime,
            filename,
            CORDN_ENCRYPTED_MEDIA_VERSION,
            false,
        )
        .unwrap();

        // Ciphertext must NOT contain prepended nonce: exact length = plaintext + 16-byte tag.
        assert_eq!(blob.ciphertext.len(), plaintext.len() + 16);
        assert_eq!(blob.nonce_hex, "a0a1a2a3a4a5a6a7a8a9aaab");
        assert!(blob.key_hex.is_none());
        assert_eq!(
            blob.plaintext_sha256_hex,
            "0da9e891b44998a85eaba28923148381990229493d0b42f1bd8e78770e28c919"
        );
        assert_eq!(
            hex::encode(&blob.ciphertext),
            "49ca0a2b258abb8dc5619066858a899ef97ea3d72c1e0f83c4b9a2dd1e03a7f7f34ccf8d6cebacbd116d478371a5f9"
        );

        let imeta = blob.clone().into_imeta(
            format!("https://blossom.earthly.city/{}", blob.ciphertext_sha256_hex),
            Some("1600x1200".to_owned()),
            Some("LEHV6nWB2yk8pyo0adR*.7kCMdnj".to_owned()),
            None,
            Some("Danube bridge gauge".to_owned()),
        );
        let tag = build_imeta_tag(&imeta).unwrap();
        assert_eq!(tag[0], "imeta");
        assert!(tag.contains(&"v cordn-em-v1".to_owned()));
        assert!(tag.contains(&"n a0a1a2a3a4a5a6a7a8a9aaab".to_owned()));

        let parsed = parse_imeta_tag(&tag).unwrap();
        assert_eq!(parsed, imeta);

        // Decrypt succeeds with exact key + imeta.
        let decrypted = decrypt_media_attachment(&blob.ciphertext, &parsed, Some(&key)).unwrap();
        assert_eq!(decrypted, plaintext);

        // Tampering with MIME or filename fails AAD check!
        let mut wrong_mime = parsed.clone();
        wrong_mime.mime = "image/png".to_owned();
        assert!(decrypt_media_attachment(&blob.ciphertext, &wrong_mime, Some(&key)).is_err());

        let mut wrong_name = parsed.clone();
        wrong_name.filename = "other.jpg".to_owned();
        assert!(decrypt_media_attachment(&blob.ciphertext, &wrong_name, Some(&key)).is_err());

        // Unknown or missing version must be rejected.
        let mut bad_tag = tag.clone();
        bad_tag.retain(|entry| !entry.starts_with("v "));
        assert!(parse_imeta_tag(&bad_tag).is_err());

        bad_tag.push("v cordn-em-v99".to_owned());
        assert!(parse_imeta_tag(&bad_tag).is_err());
    }

    #[test]
    fn matches_earthly_web_cordn_em_v1_wire_vector_byte_for_byte() {
        let key_bytes =
            hex::decode("0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20")
                .unwrap();
        let nonce_bytes = hex::decode("a1a2a3a4a5a6a7a8a9aaabac").unwrap();
        let mut key = [0u8; 32];
        let mut nonce = [0u8; 12];
        key.copy_from_slice(&key_bytes);
        nonce.copy_from_slice(&nonce_bytes);
        let plaintext = b"Hello Earthly MLS encrypted media!";
        let mime = "image/jpeg";
        let filename = "a1b2c3d4.jpg";

        let pt_hash: [u8; 32] = Sha256::digest(plaintext).into();
        let aad = build_encrypted_media_aad(mime, filename, &pt_hash).unwrap();
        assert_eq!(
            hex::encode(&aad),
            "696d6167652f6a7065670061316232633364342e6a706700b7f02ee5453cfa7647b9d85da786a29eb6f52d469a6e1bdeee1435d2de969dfc"
        );

        let blob = encrypt_media_with_nonce(
            plaintext,
            &key,
            &nonce,
            mime,
            filename,
            CORDN_ENCRYPTED_MEDIA_VERSION,
            false,
        )
        .unwrap();
        assert_eq!(
            blob.plaintext_sha256_hex,
            "b7f02ee5453cfa7647b9d85da786a29eb6f52d469a6e1bdeee1435d2de969dfc"
        );
        assert_eq!(
            hex::encode(&blob.ciphertext),
            "9d481a09c8d08d284463446d7a820b764379166871a6e7855f8fcedad76202e945f872e5e03dd538cecdee6c9c7fffdb6ede"
        );

        let web_imeta_tag: Vec<String> = vec![
            "imeta",
            "url https://blossom.earthly.city/deadbeef",
            "m image/jpeg",
            "filename a1b2c3d4.jpg",
            "x b7f02ee5453cfa7647b9d85da786a29eb6f52d469a6e1bdeee1435d2de969dfc",
            "n a1a2a3a4a5a6a7a8a9aaabac",
            "v cordn-em-v1",
        ]
        .into_iter()
        .map(ToOwned::to_owned)
        .collect();
        let parsed = parse_imeta_tag(&web_imeta_tag).unwrap();
        assert_eq!(build_imeta_tag(&parsed).unwrap(), web_imeta_tag);
        let decrypted = decrypt_media_attachment(&blob.ciphertext, &parsed, Some(&key)).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn earthly_pm_v1_persistent_map_media_roundtrip_without_epoch_key() {
        let plaintext = b"Historical survey site photo for late joiners";
        let blob = encrypt_persistent_map_media(plaintext, "image/webp", "site.webp").unwrap();
        assert_eq!(blob.version, EARTHLY_PERSISTENT_MEDIA_VERSION);
        assert_eq!(blob.key_hex.as_ref().map(String::len), Some(64));
        assert_eq!(blob.ciphertext.len(), plaintext.len() + 16);

        let imeta = blob.clone().into_imeta(
            "https://blossom.earthly.city/abc".to_owned(),
            None,
            None,
            None,
            None,
        );
        let tag = build_imeta_tag(&imeta).unwrap();
        let parsed = parse_imeta_tag(&tag).unwrap();
        // Decrypt works with epoch_media_key = None because key is carried inside MLS-protected `k`.
        let decrypted = decrypt_media_attachment(&blob.ciphertext, &parsed, None).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn privacy_helpers_randomize_filename_and_strip_jpeg_and_png_metadata() {
        let f1 = randomize_attachment_filename("image/jpeg; charset=binary");
        let f2 = randomize_attachment_filename("image/jpeg");
        assert!(f1.ends_with(".jpg"));
        assert_eq!(f1.len(), 24 + 4);
        assert_ne!(f1, f2);
        assert!(randomize_attachment_filename("application/pdf").ends_with(".pdf"));
        assert!(randomize_attachment_filename("application/octet-stream").ends_with(".bin"));

        // Minimal synthetic JPEG: SOI + APP0 (keep) + APP1 EXIF/GPS (strip) + COM (strip) + DQT (keep) + SOS + scan + EOI.
        let mut jpeg = Vec::new();
        jpeg.extend_from_slice(&[0xFF, 0xD8]); // SOI
        jpeg.extend_from_slice(&[0xFF, 0xE0, 0x00, 0x06, b'J', b'F', b'I', b'F']); // APP0
        jpeg.extend_from_slice(&[0xFF, 0xE1, 0x00, 0x0A, b'E', b'x', b'i', b'f', b'G', b'P', b'S', 0]); // APP1
        jpeg.extend_from_slice(&[0xFF, 0xFE, 0x00, 0x06, b's', b'e', b'c', b'r']); // COM
        jpeg.extend_from_slice(&[0xFF, 0xDB, 0x00, 0x04, 0x01, 0x02]); // DQT
        jpeg.extend_from_slice(&[0xFF, 0xDA, 0x00, 0x03, 0x99, 0x11, 0x22, 0xFF, 0xD9]); // SOS + data + EOI

        let stripped_jpeg = strip_image_metadata(&jpeg, "image/jpeg");
        assert!(stripped_jpeg.windows(4).any(|w| w == b"JFIF"));
        assert!(!stripped_jpeg.windows(4).any(|w| w == b"Exif"));
        assert!(!stripped_jpeg.windows(4).any(|w| w == b"secr"));
        assert!(stripped_jpeg.windows(2).any(|w| w == [0xFF, 0xDB]));
        assert!(stripped_jpeg.ends_with(&[0xFF, 0xD9]));

        // Minimal synthetic PNG: sig + IHDR + tEXt (strip) + eXIf (strip) + IDAT + IEND.
        let make_chunk = |ctype: &[u8; 4], data: &[u8]| -> Vec<u8> {
            let mut c = Vec::new();
            c.extend_from_slice(&(data.len() as u32).to_be_bytes());
            c.extend_from_slice(ctype);
            c.extend_from_slice(data);
            c.extend_from_slice(&[0, 0, 0, 0]); // dummy CRC
            c
        };
        let mut png = vec![0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
        png.extend(make_chunk(b"IHDR", &[0; 13]));
        png.extend(make_chunk(b"tEXt", b"Author\0SecretGPS"));
        png.extend(make_chunk(b"eXIf", b"GPSCoords123"));
        png.extend(make_chunk(b"IDAT", &[1, 2, 3, 4]));
        png.extend(make_chunk(b"IEND", &[]));

        let stripped_png = strip_image_metadata(&png, "image/png");
        assert!(stripped_png.windows(4).any(|w| w == b"IHDR"));
        assert!(stripped_png.windows(4).any(|w| w == b"IDAT"));
        assert!(stripped_png.windows(4).any(|w| w == b"IEND"));
        assert!(!stripped_png.windows(4).any(|w| w == b"tEXt"));
        assert!(!stripped_png.windows(4).any(|w| w == b"eXIf"));
    }
}
