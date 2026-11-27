//! Cordn `cordn1...` portable group references (`spec/applications/group-ref.md`).
//!
//! Bech32 (BIP-173) TLV codec with HRP `"cordn"`:
//! - TLV type 0: `gid` (UTF-8 bytes, 1..=255 bytes, required)
//! - TLV type 1: relay URL (UTF-8 bytes, 1..=255 bytes, repeatable)
//! - TLV type 2: coordinator pubkey (32 raw bytes, optional)
//! Unknown TLV types are ignored cleanly on decode for forward compatibility.

use bech32::primitives::decode::CheckedHrpstring;
use bech32::{Bech32, Hrp};
use serde::{Deserialize, Serialize};

use crate::is_valid_hex_pubkey;

pub const CORDN_GROUP_REF_HRP: &str = "cordn";
pub const TLV_TYPE_GID: u8 = 0;
pub const TLV_TYPE_RELAY: u8 = 1;
pub const TLV_TYPE_COORDINATOR: u8 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CordnGroupRef {
    pub gid: String,
    #[serde(default)]
    pub relays: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub coordinator_pubkey: Option<String>,
}

fn push_tlv(buf: &mut Vec<u8>, tlv_type: u8, value: &[u8]) -> Result<(), String> {
    if value.len() > 255 {
        return Err(format!(
            "TLV type {tlv_type} payload exceeds 255-byte limit ({} bytes)",
            value.len()
        ));
    }
    buf.push(tlv_type);
    buf.push(value.len() as u8);
    buf.extend_from_slice(value);
    Ok(())
}

/// Encodes a `CordnGroupRef` into a lowercase `cordn1...` Bech32 TLV string.
pub fn encode_cordn_group_ref(group_ref: &CordnGroupRef) -> Result<String, String> {
    let gid = group_ref.gid.trim();
    if gid.is_empty() {
        return Err("Cordn group reference requires a non-empty gid".to_owned());
    }
    if gid.len() > 255 {
        return Err("Cordn group reference gid exceeds 255 bytes".to_owned());
    }

    let mut tlv = Vec::with_capacity(2 + gid.len() + group_ref.relays.len() * 32 + 34);
    push_tlv(&mut tlv, TLV_TYPE_GID, gid.as_bytes())?;

    for relay in &group_ref.relays {
        let r = relay.trim();
        if r.is_empty() || (!r.starts_with("wss://") && !r.starts_with("ws://")) {
            return Err(format!("Invalid relay URL in Cordn group reference: {relay}"));
        }
        push_tlv(&mut tlv, TLV_TYPE_RELAY, r.as_bytes())?;
    }

    if let Some(coord) = &group_ref.coordinator_pubkey {
        let coord = coord.trim();
        if !is_valid_hex_pubkey(coord) {
            return Err("Coordinator pubkey must be a 64-char lowercase hex string".to_owned());
        }
        let pk_bytes =
            hex::decode(coord).map_err(|_| "Invalid coordinator pubkey hex".to_owned())?;
        if pk_bytes.len() != 32 {
            return Err("Coordinator pubkey must be exactly 32 bytes".to_owned());
        }
        push_tlv(&mut tlv, TLV_TYPE_COORDINATOR, &pk_bytes)?;
    }

    let hrp = Hrp::parse(CORDN_GROUP_REF_HRP)
        .map_err(|e| format!("Invalid Bech32 HRP: {e}"))?;
    bech32::encode::<Bech32>(hrp, &tlv)
        .map_err(|e| format!("Failed to Bech32-encode cordn1 group reference: {e}"))
}

fn is_bech32_data_char(b: u8) -> bool {
    matches!(
        b,
        b'0' | b'2'..=b'9'
            | b'a'
            | b'c'..=b'h'
            | b'j'..=b'n'
            | b'p'..=b'z'
            | b'A'
            | b'C'..=b'H'
            | b'J'..=b'N'
            | b'P'..=b'Z'
    )
}

/// Extracts a `cordn1...` token from a bare string, `cordn:` URI, URL fragment (`#cordn1...`),
/// query parameter, or surrounding text.
pub fn extract_cordn_group_ref(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Direct bare token or `cordn:` prefix.
    let direct = trimmed
        .strip_prefix("cordn:")
        .or_else(|| trimmed.strip_prefix("CORDN:"))
        .unwrap_or(trimmed)
        .trim();
    if direct.len() > 6 && direct[..6].eq_ignore_ascii_case("cordn1") {
        let end = direct[6..]
            .bytes()
            .take_while(|&b| is_bech32_data_char(b))
            .count();
        if end >= 6 {
            return Some(direct[..6 + end].to_ascii_lowercase());
        }
    }

    // Prefer URL fragment `#cordn1...` when present.
    if let Some((_, frag)) = trimmed.split_once('#') {
        let frag = frag.trim();
        if frag.len() > 6 && frag[..6].eq_ignore_ascii_case("cordn1") {
            let end = frag[6..]
                .bytes()
                .take_while(|&b| is_bech32_data_char(b))
                .count();
            if end >= 6 {
                return Some(frag[..6 + end].to_ascii_lowercase());
            }
        }
    }

    // Fallback: scan for embedded `cordn1...` token anywhere in URL/text.
    let lower = trimmed.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(rel) = lower[search_from..].find("cordn1") {
        let idx = search_from + rel;
        let preceded_by_ident = idx > 0 && lower.as_bytes()[idx - 1].is_ascii_alphanumeric();
        if !preceded_by_ident {
            let rest = &lower[idx + 6..];
            let end = rest
                .bytes()
                .take_while(|&b| is_bech32_data_char(b))
                .count();
            if end >= 6 {
                return Some(lower[idx..idx + 6 + end].to_owned());
            }
        }
        search_from = idx + 6;
    }
    None
}

/// Decodes a `cordn1...` group reference (bare string or URL containing `#cordn1...`).
/// Ignores unknown TLV types cleanly per `spec/applications/group-ref.md`.
pub fn decode_cordn_group_ref(input: &str) -> Result<CordnGroupRef, String> {
    let token = extract_cordn_group_ref(input)
        .ok_or_else(|| "No cordn1... group reference found".to_owned())?;

    let checked = CheckedHrpstring::new::<Bech32>(&token)
        .map_err(|e| format!("Invalid cordn1 Bech32 encoding: {e}"))?;
    if checked.hrp().as_str() != CORDN_GROUP_REF_HRP {
        return Err(format!(
            "Expected Bech32 HRP `{CORDN_GROUP_REF_HRP}`, got `{}`",
            checked.hrp()
        ));
    }
    let data: Vec<u8> = checked.byte_iter().collect();

    let mut gid: Option<String> = None;
    let mut relays: Vec<String> = Vec::new();
    let mut coordinator_pubkey: Option<String> = None;

    let mut cursor = 0usize;
    while cursor < data.len() {
        if cursor + 2 > data.len() {
            return Err("Truncated TLV header in cordn1 group reference".to_owned());
        }
        let tlv_type = data[cursor];
        let tlv_len = data[cursor + 1] as usize;
        cursor += 2;
        if cursor + tlv_len > data.len() {
            return Err("Truncated TLV value in cordn1 group reference".to_owned());
        }
        let value = &data[cursor..cursor + tlv_len];
        cursor += tlv_len;

        match tlv_type {
            TLV_TYPE_GID => {
                let s = std::str::from_utf8(value)
                    .map_err(|_| "TLV type 0 (gid) is not valid UTF-8".to_owned())?;
                if s.is_empty() {
                    return Err("TLV type 0 (gid) cannot be empty".to_owned());
                }
                if gid.is_none() {
                    gid = Some(s.to_owned());
                }
            }
            TLV_TYPE_RELAY => {
                let s = std::str::from_utf8(value)
                    .map_err(|_| "TLV type 1 (relay) is not valid UTF-8".to_owned())?;
                let trimmed = s.trim();
                if !trimmed.is_empty() && !relays.iter().any(|r| r == trimmed) {
                    relays.push(trimmed.to_owned());
                }
            }
            TLV_TYPE_COORDINATOR => {
                if value.len() != 32 {
                    return Err("TLV type 2 (coordinator) must be exactly 32 bytes".to_owned());
                }
                if coordinator_pubkey.is_none() {
                    coordinator_pubkey = Some(hex::encode(value));
                }
            }
            // Forward-compatible: ignore unknown TLV types cleanly.
            _ => {}
        }
    }

    let gid = gid.ok_or_else(|| "cordn1 group reference is missing required TLV type 0 (gid)".to_owned())?;

    Ok(CordnGroupRef {
        gid,
        relays,
        coordinator_pubkey,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip_and_url_fragment_extraction() {
        let coord = "fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37".to_owned();
        let gref = CordnGroupRef {
            gid: "earthly:danube-survey-42".to_owned(),
            relays: vec![
                "wss://relay.earthly.city".to_owned(),
                "wss://nos.lol".to_owned(),
            ],
            coordinator_pubkey: Some(coord.clone()),
        };

        let encoded = encode_cordn_group_ref(&gref).unwrap();
        assert_eq!(
            encoded,
            "cordn1qqvx2ctjw35xc7f6v3skuatzv5khxatjwejhjtf5xgq3samnwvaz7tmjv4kxz7fwv4shyargd3ujucmfw3uszrthwden5te0dehhxtnvdakqyg8a2sc68updmgeajfu2msketcq8mdld7rx5xazs3gltr2fvp3j7xu22mhrl"
        );

        // Bare string decode
        assert_eq!(decode_cordn_group_ref(&encoded).unwrap(), gref);

        // Uppercase Bech32 decode
        assert_eq!(decode_cordn_group_ref(&encoded.to_ascii_uppercase()).unwrap(), gref);

        // URL fragment extraction (`#cordn1...`)
        let url = format!("https://earthly.city/circle/ws-1#{encoded}");
        assert_eq!(decode_cordn_group_ref(&url).unwrap(), gref);

        // cordn: URI prefix
        let uri = format!("cordn:{encoded}");
        assert_eq!(decode_cordn_group_ref(&uri).unwrap(), gref);
    }

    #[test]
    fn ignores_unknown_tlv_types_and_rejects_missing_gid() {
        let hrp = Hrp::parse("cordn").unwrap();

        // TLV 0 (gid) + unknown TLV 99 + TLV 2 (coordinator)
        let coord_bytes =
            hex::decode("fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37")
                .unwrap();
        let mut raw = Vec::new();
        push_tlv(&mut raw, 0, b"earthly:future-tlv").unwrap();
        push_tlv(&mut raw, 99, b"unknown-future-extension").unwrap();
        push_tlv(&mut raw, 2, &coord_bytes).unwrap();
        let encoded = bech32::encode::<Bech32>(hrp, &raw).unwrap();

        let decoded = decode_cordn_group_ref(&encoded).unwrap();
        assert_eq!(decoded.gid, "earthly:future-tlv");
        assert!(decoded.relays.is_empty());
        assert_eq!(
            decoded.coordinator_pubkey.as_deref(),
            Some("fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37")
        );

        // Missing TLV 0 must error
        let mut no_gid = Vec::new();
        push_tlv(&mut no_gid, 1, b"wss://relay.earthly.city").unwrap();
        let bad_encoded = bech32::encode::<Bech32>(hrp, &no_gid).unwrap();
        assert!(decode_cordn_group_ref(&bad_encoded).is_err());
    }
}
