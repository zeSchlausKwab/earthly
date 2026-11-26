use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{ChaCha20Poly1305, Nonce};
use rand::rngs::OsRng;
use rand::RngCore;

pub const SECRET_BOX_PREFIX: &str = "enc:v1:";
pub const MASTER_KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
const POLY1305_TAG_LEN: usize = 16;

/// Decodes and validates a Base64-encoded 32-byte ChaCha20-Poly1305 master key.
pub fn decode_master_key(master_key_b64: &str) -> Result<[u8; MASTER_KEY_LEN], String> {
    let decoded = BASE64_STANDARD
        .decode(master_key_b64.trim())
        .map_err(|_| "Invalid master key base64".to_owned())?;
    let key: [u8; MASTER_KEY_LEN] = decoded.try_into().map_err(|v: Vec<u8>| {
        format!(
            "Master key must decode to {MASTER_KEY_LEN} bytes, got {}",
            v.len()
        )
    })?;
    Ok(key)
}

/// Returns `true` if `value` carries the `"enc:v1:"` ciphertext envelope prefix.
pub fn is_encrypted_secret(value: &str) -> bool {
    value.starts_with(SECRET_BOX_PREFIX)
}

/// Authenticated symmetric cipher for encrypting sensitive settings fields at rest.
pub struct SecretBox {
    cipher: ChaCha20Poly1305,
}

impl SecretBox {
    /// Builds a `SecretBox` from a Base64-encoded 32-byte master key.
    pub fn from_base64_key(master_key_b64: &str) -> Result<Self, String> {
        let key = decode_master_key(master_key_b64)?;
        Ok(Self::from_bytes(&key))
    }

    /// Builds a `SecretBox` from raw 32-byte key material.
    pub fn from_bytes(key: &[u8; MASTER_KEY_LEN]) -> Self {
        Self {
            cipher: ChaCha20Poly1305::new(key.into()),
        }
    }

    /// Encrypts a non-empty string into `"enc:v1:<base64(12-byte-nonce || ciphertext)>"`.
    /// Empty strings are returned unchanged without encryption.
    pub fn encrypt_str(&self, plaintext: &str) -> Result<String, String> {
        if plaintext.is_empty() {
            return Ok(String::new());
        }
        let mut nonce_bytes = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = self
            .cipher
            .encrypt(nonce, plaintext.as_bytes())
            .map_err(|_| "Failed to encrypt secret with ChaCha20-Poly1305".to_owned())?;

        let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        combined.extend_from_slice(&nonce_bytes);
        combined.extend_from_slice(&ciphertext);
        Ok(format!(
            "{SECRET_BOX_PREFIX}{}",
            BASE64_STANDARD.encode(&combined)
        ))
    }

    /// Decrypts `"enc:v1:<base64(12-byte-nonce || ciphertext)>"` payloads.
    /// Legacy strings without the `"enc:v1:"` prefix pass through unchanged.
    /// Malformed or unauthentic `"enc:v1:..."` payloads fail closed with an error.
    pub fn decrypt_str(&self, stored: &str) -> Result<String, String> {
        let Some(encoded) = stored.strip_prefix(SECRET_BOX_PREFIX) else {
            return Ok(stored.to_owned());
        };
        let payload = BASE64_STANDARD
            .decode(encoded.trim())
            .map_err(|_| "Failed to decode encrypted secret: invalid base64".to_owned())?;
        if payload.len() < NONCE_LEN + POLY1305_TAG_LEN {
            return Err("Failed to decrypt secret: payload too short".to_owned());
        }
        let (nonce_bytes, ciphertext) = payload.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = self
            .cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| "Failed to decrypt secret: authentication failed".to_owned())?;
        String::from_utf8(plaintext)
            .map_err(|_| "Failed to decrypt secret: plaintext is not valid UTF-8".to_owned())
    }

    pub fn encrypt_option(&self, value: Option<&str>) -> Result<Option<String>, String> {
        match value {
            None => Ok(None),
            Some("") => Ok(Some(String::new())),
            Some(s) => self.encrypt_str(s).map(Some),
        }
    }

    pub fn decrypt_option(&self, value: Option<&str>) -> Result<Option<String>, String> {
        match value {
            None => Ok(None),
            Some(s) => self.decrypt_str(s).map(Some),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_key_b64(fill: u8) -> String {
        BASE64_STANDARD.encode([fill; MASTER_KEY_LEN])
    }

    #[test]
    fn round_trips_non_empty_secret_with_fresh_nonce() {
        let box1 = SecretBox::from_base64_key(&test_key_b64(0x11)).unwrap();
        let secret = "nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq";
        let enc_a = box1.encrypt_str(secret).unwrap();
        let enc_b = box1.encrypt_str(secret).unwrap();
        assert!(enc_a.starts_with(SECRET_BOX_PREFIX));
        assert!(enc_b.starts_with(SECRET_BOX_PREFIX));
        assert_ne!(enc_a, enc_b);
        assert!(!enc_a.contains("nsec1"));
        assert_eq!(box1.decrypt_str(&enc_a).unwrap(), secret);
        assert_eq!(box1.decrypt_str(&enc_b).unwrap(), secret);
    }

    #[test]
    fn empty_string_and_legacy_plaintext_pass_through() {
        let secret_box = SecretBox::from_base64_key(&test_key_b64(0x22)).unwrap();
        assert_eq!(secret_box.encrypt_str("").unwrap(), "");
        assert_eq!(secret_box.decrypt_str("").unwrap(), "");
        assert_eq!(
            secret_box.decrypt_str("nsec1legacyplaintext").unwrap(),
            "nsec1legacyplaintext"
        );
        assert_eq!(
            secret_box.encrypt_option(Some("")).unwrap(),
            Some(String::new())
        );
        assert_eq!(secret_box.encrypt_option(None).unwrap(), None);
    }

    #[test]
    fn wrong_key_and_corrupt_ciphertext_fail_closed() {
        let box_a = SecretBox::from_base64_key(&test_key_b64(0x33)).unwrap();
        let box_b = SecretBox::from_base64_key(&test_key_b64(0x44)).unwrap();

        let enc = box_a.encrypt_str("sk-secret-api-key").unwrap();
        assert!(box_b.decrypt_str(&enc).is_err());
        assert!(box_a.decrypt_str("enc:v1:not-valid-base64!!!").is_err());
        assert!(box_a
            .decrypt_str(&format!("enc:v1:{}", BASE64_STANDARD.encode([0u8; 10])))
            .is_err());
    }

    #[test]
    fn validates_master_key_decoding_and_length() {
        assert!(decode_master_key(&test_key_b64(0x55)).is_ok());
        assert!(decode_master_key("not-base64!").is_err());
        assert!(decode_master_key(&BASE64_STANDARD.encode([0u8; 16])).is_err());
        assert!(decode_master_key(&BASE64_STANDARD.encode([0u8; 33])).is_err());
    }
}
