//! Shared Nostr tag read/write seam (`SPEC.md` §7, §10 & `src/lib/nostr/tags.ts`).
//!
//! Enforces the three-way `L`/`l` · `t` · `c` disjointness rule, multi-precision
//! `g` geohashes, NIP-92 `imeta` attachment order, `blob` tag parsing, and
//! deterministic NIP-40 expiration filtering.

use std::collections::BTreeSet;

use earthly_spatial::Bounds;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::entities::{BlobReference, BlobScope, RawNostrEvent};

/// Flat Earthly label namespace (SPEC §7.1).
pub const EARTHLY_LABEL_NAMESPACE: &str = "earthly";

/// Starter controlled vocabulary for feature categories (SPEC §7.1).
pub const FEATURE_CATEGORY_VOCAB: &[&str] =
    &["natural", "infrastructure", "amenity", "route", "boundary"];

/// Maximum permitted external GeoJSON blob size (50 MiB, SPEC §1.5.1).
pub const MAX_EXTERNAL_BLOB_BYTES: u64 = 50 * 1024 * 1024;

const BASE32_GEOHASH: &[u8; 32] = b"0123456789bcdefghjkmnpqrstuvwxyz";

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum TagError {
    #[error("label \"{0}\" is already a freeform t hashtag — t/l disjointness violated (TAX-01)")]
    LabelHashtagConflict(String),
    #[error("every imeta media attachment requires a non-empty url")]
    MissingMediaUrl,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImetaAttachment {
    pub url: String,
    pub mime_type: Option<String>,
    pub sha256: Option<String>,
    pub dimensions: Option<String>,
    pub blurhash: Option<String>,
    pub alt: Option<String>,
}

pub fn get_tag_value<'a>(tags: &'a [Vec<String>], name: &str) -> Option<&'a str> {
    tags.iter()
        .find(|tag| tag.first().map(String::as_str) == Some(name))
        .and_then(|tag| tag.get(1))
        .map(String::as_str)
        .filter(|value| !value.is_empty())
}

/// Read the `bbox` tag as validated WGS84 `[west, south, east, north]`.
pub fn get_bbox(tags: &[Vec<String>]) -> Option<Bounds> {
    let raw = get_tag_value(tags, "bbox")?;
    let parts: Vec<f64> = raw
        .split(',')
        .map(|part| part.trim().parse::<f64>())
        .collect::<Result<Vec<_>, _>>()
        .ok()?;
    if parts.len() != 4 {
        return None;
    }
    Bounds::new(parts[0], parts[1], parts[2], parts[3]).ok()
}

/// Return the most precise `g` geohash tag.
pub fn get_geohash(tags: &[Vec<String>]) -> Option<&str> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("g"))
        .filter_map(|tag| tag.get(1).map(String::as_str))
        .filter(|value| !value.is_empty())
        .max_by_key(|value| value.len())
}

pub fn get_hashtags(tags: &[Vec<String>]) -> Vec<String> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("t"))
        .filter_map(|tag| tag.get(1).cloned())
        .collect()
}

pub fn get_context_refs(tags: &[Vec<String>]) -> Vec<String> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("c"))
        .filter_map(|tag| tag.get(1).filter(|v| !v.is_empty()).cloned())
        .collect()
}

pub fn get_referenced_addresses(tags: &[Vec<String>]) -> Vec<String> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("a"))
        .filter_map(|tag| tag.get(1).filter(|v| !v.is_empty()).cloned())
        .collect()
}

pub fn get_labels(tags: &[Vec<String>]) -> Vec<String> {
    tags.iter()
        .filter(|tag| {
            tag.first().map(String::as_str) == Some("l")
                && tag.get(2).map(String::as_str) == Some(EARTHLY_LABEL_NAMESPACE)
        })
        .filter_map(|tag| tag.get(1).filter(|v| !v.is_empty()).cloned())
        .collect()
}

/// Parse NIP-92 `imeta` tags in order (first attachment is primary, SPEC §7.3).
pub fn get_images(tags: &[Vec<String>]) -> Vec<ImetaAttachment> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("imeta"))
        .filter_map(|tag| {
            let mut url = None;
            let mut mime_type = None;
            let mut sha256 = None;
            let mut dimensions = None;
            let mut blurhash = None;
            let mut alt = None;
            for entry in tag.iter().skip(1) {
                let Some((key, value)) = entry.split_once(' ') else {
                    continue;
                };
                let value = value.trim();
                if value.is_empty() {
                    continue;
                }
                match key {
                    "url" => url = Some(value.to_owned()),
                    "m" => mime_type = Some(value.to_owned()),
                    "x" => sha256 = Some(value.to_owned()),
                    "dim" => dimensions = Some(value.to_owned()),
                    "blurhash" => blurhash = Some(value.to_owned()),
                    "alt" => alt = Some(value.to_owned()),
                    _ => {}
                }
            }
            Some(ImetaAttachment {
                url: url?,
                mime_type,
                sha256,
                dimensions,
                blurhash,
                alt,
            })
        })
        .collect()
}

/// Parse external `blob` geometry tags following SPEC §1.5 rules.
pub fn parse_blob_references(tags: &[Vec<String>]) -> Vec<BlobReference> {
    tags.iter()
        .filter(|tag| tag.first().map(String::as_str) == Some("blob"))
        .filter_map(|tag| {
            let scope_raw = tag.get(1)?.as_str();
            let url = tag.get(2)?.trim();
            if url.is_empty() {
                return None;
            }
            let scope = if scope_raw == "collection" {
                BlobScope::Collection
            } else if let Some(feature_id) = scope_raw.strip_prefix("feature:") {
                if !is_valid_blob_feature_id(feature_id) {
                    return None;
                }
                BlobScope::Feature(feature_id.to_owned())
            } else {
                return None;
            };

            let mut sha256 = None;
            let mut size = None;
            let mut mime = None;
            for param in tag.iter().skip(3) {
                let Some((key, value)) = param.split_once('=') else {
                    continue;
                };
                match key {
                    "sha256" if !value.is_empty() => sha256 = Some(value.to_owned()),
                    "size" => {
                        if let Ok(parsed) = value.parse::<u64>() {
                            if parsed <= MAX_EXTERNAL_BLOB_BYTES {
                                size = Some(parsed);
                            } else {
                                return None;
                            }
                        }
                    }
                    "mime" if !value.is_empty() => mime = Some(value.to_owned()),
                    _ => {}
                }
            }

            Some(BlobReference {
                scope,
                url: url.to_owned(),
                sha256,
                size,
                mime,
            })
        })
        .collect()
}

fn is_valid_blob_feature_id(id: &str) -> bool {
    !id.is_empty()
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

/// Read NIP-40 `expiration` timestamp (epoch seconds, UTC).
pub fn get_expiration(tags: &[Vec<String>]) -> Option<u64> {
    get_tag_value(tags, "expiration")?.parse::<u64>().ok()
}

/// Returns `true` when the event has a NIP-40 `expiration` strictly in the past
/// relative to `now_epoch_seconds` (SPEC §10).
pub fn is_expired(tags: &[Vec<String>], now_epoch_seconds: u64) -> bool {
    get_expiration(tags).is_some_and(|exp| exp < now_epoch_seconds)
}

/// Filter out expired events deterministically against an injected clock.
pub fn drop_expired(events: Vec<RawNostrEvent>, now_epoch_seconds: u64) -> Vec<RawNostrEvent> {
    events
        .into_iter()
        .filter(|event| !is_expired(&event.tags, now_epoch_seconds))
        .collect()
}

// =====================================================================
// Pure tag write transformers (`Vec<Vec<String>> -> Vec<Vec<String>>`)
// =====================================================================

pub fn set_bbox(tags: &[Vec<String>], bounds: Option<Bounds>) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("bbox"))
        .cloned()
        .collect();
    if let Some(bounds) = bounds {
        next.push(vec![
            "bbox".to_owned(),
            format!(
                "{},{},{},{}",
                bounds.west, bounds.south, bounds.east, bounds.north
            ),
        ]);
    }
    next
}

/// Encode WGS84 `(lon, lat)` into a standard base32 geohash string.
pub fn encode_geohash(lon: f64, lat: f64, precision: usize) -> Option<String> {
    if !lon.is_finite()
        || !lat.is_finite()
        || !(-180.0..=180.0).contains(&lon)
        || !(-90.0..=90.0).contains(&lat)
        || precision == 0
    {
        return None;
    }
    let mut lon_range = (-180.0_f64, 180.0_f64);
    let mut lat_range = (-90.0_f64, 90.0_f64);
    let mut is_lon = true;
    let mut bit = 0u8;
    let mut ch = 0usize;
    let mut out = String::with_capacity(precision);

    while out.len() < precision {
        if is_lon {
            let mid = (lon_range.0 + lon_range.1) / 2.0;
            if lon >= mid {
                ch = (ch << 1) | 1;
                lon_range.0 = mid;
            } else {
                ch <<= 1;
                lon_range.1 = mid;
            }
        } else {
            let mid = (lat_range.0 + lat_range.1) / 2.0;
            if lat >= mid {
                ch = (ch << 1) | 1;
                lat_range.0 = mid;
            } else {
                ch <<= 1;
                lat_range.1 = mid;
            }
        }
        is_lon = !is_lon;
        bit += 1;
        if bit == 5 {
            out.push(BASE32_GEOHASH[ch] as char);
            bit = 0;
            ch = 0;
        }
    }
    Some(out)
}

/// Return all prefixes of a geohash, most precise first (SPEC §1.2).
pub fn geohash_prefixes(hash: &str) -> Vec<String> {
    (1..=hash.len())
        .rev()
        .map(|len| hash[..len].to_owned())
        .collect()
}

/// Replace multi-precision `g` geohash tags derived from `[lon, lat]` centroid.
pub fn set_geohash(
    tags: &[Vec<String>],
    centroid: Option<(f64, f64)>,
    precision: usize,
) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("g"))
        .cloned()
        .collect();
    if let Some((lon, lat)) = centroid {
        let clamped = precision.clamp(5, 7);
        if let Some(full) = encode_geohash(lon, lat, clamped) {
            for prefix in geohash_prefixes(&full) {
                next.push(vec!["g".to_owned(), prefix]);
            }
        }
    }
    next
}

/// Replace freeform `t` hashtags, stripping any value already governed by an
/// `earthly`-namespaced NIP-32 `l` label (TAX-01 disjointness).
pub fn set_hashtags(tags: &[Vec<String>], values: &[String]) -> Vec<Vec<String>> {
    let governed: BTreeSet<String> = get_labels(tags).into_iter().collect();
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("t"))
        .cloned()
        .collect();
    for value in values {
        if !value.is_empty() && !governed.contains(value) {
            next.push(vec!["t".to_owned(), value.clone()]);
        }
    }
    next
}

/// Replace NIP-32 `L`/`l` labels under the `earthly` namespace, failing closed
/// if any requested value already exists in the freeform `t` lane (TAX-01).
pub fn set_labels(tags: &[Vec<String>], values: &[String]) -> Result<Vec<Vec<String>>, TagError> {
    let existing_hashtags: BTreeSet<String> = get_hashtags(tags).into_iter().collect();
    for value in values {
        if existing_hashtags.contains(value) {
            return Err(TagError::LabelHashtagConflict(value.clone()));
        }
    }
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| !matches!(tag.first().map(String::as_str), Some("L" | "l")))
        .cloned()
        .collect();
    if !values.is_empty() {
        next.push(vec!["L".to_owned(), EARTHLY_LABEL_NAMESPACE.to_owned()]);
        for value in values {
            next.push(vec![
                "l".to_owned(),
                value.clone(),
                EARTHLY_LABEL_NAMESPACE.to_owned(),
            ]);
        }
    }
    Ok(next)
}

pub fn set_context_refs(tags: &[Vec<String>], values: &[String]) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("c"))
        .cloned()
        .collect();
    for value in values.iter().filter(|v| !v.is_empty()) {
        next.push(vec!["c".to_owned(), value.clone()]);
    }
    next
}

pub fn set_referenced_addresses(tags: &[Vec<String>], values: &[String]) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("a"))
        .cloned()
        .collect();
    for value in values.iter().filter(|v| !v.is_empty()) {
        next.push(vec!["a".to_owned(), value.clone()]);
    }
    next
}

pub fn set_schema_hash(tags: &[Vec<String>], value: Option<&str>) -> Vec<Vec<String>> {
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("schema-hash"))
        .cloned()
        .collect();
    if let Some(hash) = value.filter(|v| !v.is_empty()) {
        next.push(vec!["schema-hash".to_owned(), hash.to_owned()]);
    }
    next
}

pub fn set_images(
    tags: &[Vec<String>],
    attachments: &[ImetaAttachment],
) -> Result<Vec<Vec<String>>, TagError> {
    for attachment in attachments {
        if attachment.url.trim().is_empty() {
            return Err(TagError::MissingMediaUrl);
        }
    }
    let mut next: Vec<Vec<String>> = tags
        .iter()
        .filter(|tag| tag.first().map(String::as_str) != Some("imeta"))
        .cloned()
        .collect();
    for attachment in attachments {
        let mut tag = vec!["imeta".to_owned(), format!("url {}", attachment.url.trim())];
        if let Some(mime) = &attachment.mime_type {
            tag.push(format!("m {mime}"));
        }
        if let Some(sha) = &attachment.sha256 {
            tag.push(format!("x {sha}"));
        }
        if let Some(dim) = &attachment.dimensions {
            tag.push(format!("dim {dim}"));
        }
        if let Some(blurhash) = &attachment.blurhash {
            tag.push(format!("blurhash {blurhash}"));
        }
        if let Some(alt) = &attachment.alt {
            tag.push(format!("alt {alt}"));
        }
        next.push(tag);
    }
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enforces_label_and_hashtag_disjointness() {
        let tags = set_labels(&[], &["natural".to_owned(), "route".to_owned()]).unwrap();
        assert_eq!(get_labels(&tags), vec!["natural", "route"]);

        // set_hashtags strips values governed by `l`.
        let tags = set_hashtags(&tags, &["natural".to_owned(), "alps".to_owned()]);
        assert_eq!(get_hashtags(&tags), vec!["alps"]);

        // set_labels rejects promoting a value already present in `t`.
        let conflict = set_labels(&tags, &["alps".to_owned()]).unwrap_err();
        assert_eq!(conflict, TagError::LabelHashtagConflict("alps".to_owned()));
    }

    #[test]
    fn encodes_vienna_geohash_and_multi_precision_tags() {
        // Stephansdom, Vienna (16.3738, 48.2082) -> "u2edk..."
        let hash = encode_geohash(16.3738, 48.2082, 6).unwrap();
        assert!(hash.starts_with("u2ed"), "unexpected Vienna geohash: {hash}");
        let tags = set_geohash(&[], Some((16.3738, 48.2082)), 6);
        assert_eq!(tags.len(), 6);
        assert_eq!(get_geohash(&tags), Some(hash.as_str()));
    }

    #[test]
    fn parses_blob_tags_and_rejects_colon_feature_ids() {
        let tags = vec![
            vec![
                "blob".to_owned(),
                "collection".to_owned(),
                "https://blossom.example/all.geojson".to_owned(),
                "sha256=abcd".to_owned(),
                "size=1024".to_owned(),
                "mime=application/geo+json".to_owned(),
            ],
            vec![
                "blob".to_owned(),
                "feature:bad:id".to_owned(),
                "https://blossom.example/bad.geojson".to_owned(),
            ],
            vec![
                "blob".to_owned(),
                "feature:good_id-1.2".to_owned(),
                "https://blossom.example/good.geojson".to_owned(),
            ],
        ];
        let blobs = parse_blob_references(&tags);
        assert_eq!(blobs.len(), 2);
        assert_eq!(blobs[0].scope, BlobScope::Collection);
        assert_eq!(blobs[0].size, Some(1024));
        assert_eq!(blobs[1].scope, BlobScope::Feature("good_id-1.2".to_owned()));
    }

    #[test]
    fn filters_nip40_expired_events_deterministically() {
        let expired = RawNostrEvent {
            id: "1".to_owned(),
            pubkey: "a".repeat(64),
            created_at: 100,
            kind: 37_521,
            tags: vec![vec!["expiration".to_owned(), "200".to_owned()]],
            content: "{}".to_owned(),
        };
        let active = RawNostrEvent {
            id: "2".to_owned(),
            pubkey: "a".repeat(64),
            created_at: 100,
            kind: 37_521,
            tags: vec![vec!["expiration".to_owned(), "300".to_owned()]],
            content: "{}".to_owned(),
        };
        let kept = drop_expired(vec![expired, active], 250);
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].id, "2");
    }
}
