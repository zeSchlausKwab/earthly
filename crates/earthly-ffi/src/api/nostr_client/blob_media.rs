//! Externalized Blossom GeoJSON blob resolution and SHA-256 verification.

use std::time::Duration;

use sha2::{Digest, Sha256};

const MAX_EXTERNAL_BLOB_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone, Debug)]
pub struct BlobRefDto {
    /// `"collection"` or `"feature:<id>"`
    pub scope: String,
    pub url: String,
    pub sha256: Option<String>,
    pub size: Option<u64>,
    pub mime: Option<String>,
}

/// Resolves externalized Blossom GeoJSON `blob` references (`SPEC.md` §1.5),
/// verifying optional `sha256` integrity and merging `collection` and
/// `feature:<id>` payloads into a single renderable GeoJSON FeatureCollection.
pub async fn resolve_map_blob_geojson(
    base_geojson: String,
    blob_refs: Vec<BlobRefDto>,
) -> Result<String, String> {
    if blob_refs.is_empty() {
        return Ok(base_geojson);
    }

    let mut base_fc: serde_json::Value = serde_json::from_str(&base_geojson).unwrap_or_else(|_| {
        serde_json::json!({ "type": "FeatureCollection", "features": [] })
    });
    let mut merged_features: Vec<serde_json::Value> = base_fc
        .get("features")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|f| f.get("geometry").is_some_and(|g| !g.is_null()))
        .collect();

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut fetched_any = false;
    for blob in &blob_refs {
        let cache_key = blob
            .sha256
            .as_deref()
            .map(|s| format!("sha256:{}", s.to_lowercase()))
            .unwrap_or_else(|| blob.url.clone());

        let raw_text =
            if let Some(cached) = crate::api::relay_pool::read_cached_blossom_blob(&cache_key) {
                cached
            } else {
                let mut fetched: Option<String> = None;
                // Try embedded local Blossom copy first when sha256 is known.
                if let Some(sha) = blob.sha256.as_deref().filter(|s| s.len() == 64) {
                    if let Some(node) = crate::api::spike::current_node() {
                        let local_url = format!("{}/{sha}", node.descriptor().blossom_url);
                        if let Ok(resp) = http.get(&local_url).send().await {
                            if resp.status().is_success() {
                                if let Ok(bytes) = resp.bytes().await {
                                    if (bytes.len() as u64) <= MAX_EXTERNAL_BLOB_BYTES {
                                        if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                            if verify_optional_sha256(&text, Some(sha)) {
                                                fetched = Some(text);
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                if fetched.is_none() {
                    if let Ok(resp) = http.get(blob.url.trim()).send().await {
                        if resp.status().is_success() {
                            if let Ok(bytes) = resp.bytes().await {
                                if (bytes.len() as u64) <= MAX_EXTERNAL_BLOB_BYTES {
                                    if let Ok(text) = String::from_utf8(bytes.to_vec()) {
                                        if verify_optional_sha256(&text, blob.sha256.as_deref()) {
                                            fetched = Some(text);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                let Some(text) = fetched else {
                    continue;
                };
                crate::api::relay_pool::write_cached_blossom_blob(&cache_key, &text);
                text
            };

        fetched_any = true;
        merge_blob_payload_into_features(&mut merged_features, &blob.scope, &raw_text);
    }

    if !fetched_any && merged_features.is_empty() {
        return Err("Unable to fetch external Blossom GeoJSON blob".to_owned());
    }

    if let Some(obj) = base_fc.as_object_mut() {
        obj.insert(
            "type".to_owned(),
            serde_json::Value::String("FeatureCollection".to_owned()),
        );
        obj.insert(
            "features".to_owned(),
            serde_json::Value::Array(merged_features),
        );
    }
    serde_json::to_string(&base_fc).map_err(|e| e.to_string())
}

fn verify_optional_sha256(text: &str, expected: Option<&str>) -> bool {
    let Some(exp) = expected.map(str::trim).filter(|s| s.len() == 64) else {
        return true;
    };
    let actual = format!("{:x}", Sha256::digest(text.as_bytes()));
    actual.eq_ignore_ascii_case(exp)
}

fn merge_blob_payload_into_features(
    target_features: &mut Vec<serde_json::Value>,
    scope: &str,
    payload_text: &str,
) {
    let Ok(parsed) = serde_json::from_str::<serde_json::Value>(payload_text) else {
        return;
    };
    let incoming: Vec<serde_json::Value> = match parsed.get("type").and_then(|v| v.as_str()) {
        Some("FeatureCollection") => parsed
            .get("features")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default(),
        Some("Feature") => vec![parsed],
        Some(
            "Point" | "MultiPoint" | "LineString" | "MultiLineString" | "Polygon" | "MultiPolygon"
            | "GeometryCollection",
        ) => vec![serde_json::json!({
            "type": "Feature",
            "geometry": parsed,
            "properties": {},
        })],
        _ => return,
    };
    let valid_incoming: Vec<serde_json::Value> = incoming
        .into_iter()
        .filter(|f| f.get("geometry").is_some_and(|g| !g.is_null()))
        .collect();
    if valid_incoming.is_empty() {
        return;
    }
    if let Some(feature_id) = scope.strip_prefix("feature:") {
        target_features.retain(|f| {
            let cur_id = f.get("id").and_then(|v| {
                v.as_str()
                    .map(str::to_owned)
                    .or_else(|| v.as_i64().map(|n| n.to_string()))
            });
            cur_id.as_deref() != Some(feature_id)
        });
    }
    target_features.extend(valid_incoming);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merges_collection_and_feature_scoped_blossom_blobs_and_verifies_sha256() {
        let mut features = vec![serde_json::json!({
            "type": "Feature",
            "id": "f1",
            "geometry": { "type": "Point", "coordinates": [16.0, 48.0] },
            "properties": { "name": "Old F1" }
        })];

        let collection_blob = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"f2","geometry":{"type":"Point","coordinates":[16.5,48.5]},"properties":{"name":"From Collection"}}]}"#;
        let expected_sha = format!("{:x}", Sha256::digest(collection_blob.as_bytes()));
        assert!(verify_optional_sha256(collection_blob, Some(&expected_sha)));
        assert!(!verify_optional_sha256(
            collection_blob,
            Some(&"0".repeat(64))
        ));

        merge_blob_payload_into_features(&mut features, "collection", collection_blob);
        assert_eq!(features.len(), 2);

        let replacement_blob = r#"{"type":"Feature","id":"f1","geometry":{"type":"Point","coordinates":[16.37,48.21]},"properties":{"name":"Replaced F1"}}"#;
        merge_blob_payload_into_features(&mut features, "feature:f1", replacement_blob);
        assert_eq!(features.len(), 2);
        let f1 = features
            .iter()
            .find(|f| f.get("id").and_then(|v| v.as_str()) == Some("f1"))
            .unwrap();
        assert_eq!(f1["properties"]["name"], "Replaced F1");
    }
}
