//! Atlas JSON Schema canonicalization, hashing, and GeoJSON validation.

use sha2::{Digest, Sha256};

#[derive(Clone, Debug)]
pub struct AtlasSchemaValidationDto {
    pub valid: bool,
    pub hash_verified: bool,
    pub errors: Vec<String>,
}

fn canonicalize_json_value(v: &serde_json::Value) -> serde_json::Value {
    match v {
        serde_json::Value::Array(arr) => {
            serde_json::Value::Array(arr.iter().map(canonicalize_json_value).collect())
        }
        serde_json::Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut sorted = serde_json::Map::new();
            for k in keys {
                sorted.insert(k.clone(), canonicalize_json_value(&map[k]));
            }
            serde_json::Value::Object(sorted)
        }
        other => other.clone(),
    }
}

pub(super) fn compute_canonical_schema_hash(schema: &serde_json::Value) -> String {
    let canonical = serde_json::to_string(&canonicalize_json_value(schema)).unwrap_or_default();
    let digest = Sha256::digest(canonical.as_bytes());
    format!(
        "sha256:{}",
        digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    )
}

/// Validates a GeoJSON FeatureCollection against an Atlas draft-2020-12 JSON Schema
/// and verifies an optional published `schema-hash` tag (`sha256:...`).
pub fn validate_map_against_atlas_schema(
    geojson: String,
    schema_json: String,
    published_schema_hash: Option<String>,
) -> Result<AtlasSchemaValidationDto, String> {
    let schema: serde_json::Value = serde_json::from_str(&schema_json)
        .map_err(|e| format!("invalid Atlas schema JSON: {e}"))?;
    if !schema.is_object() {
        return Err("Atlas schema must be a JSON object".to_owned());
    }

    if let Some(expected) = published_schema_hash
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let actual = compute_canonical_schema_hash(&schema);
        if actual != expected {
            return Ok(AtlasSchemaValidationDto {
                valid: false,
                hash_verified: false,
                errors: vec!["Schema could not be verified (schema-hash mismatch)".to_owned()],
            });
        }
    }

    let fc: serde_json::Value = serde_json::from_str(&geojson)
        .map_err(|e| format!("invalid GeoJSON payload: {e}"))?;
    let features = fc
        .get("features")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "GeoJSON missing features array".to_owned())?;

    let props_schema = schema.get("properties").and_then(|v| v.as_object());
    let required_keys: Vec<String> = schema
        .get("required")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let allowed_geom_types: Vec<String> = props_schema
        .and_then(|m| m.get("geometry"))
        .and_then(|g| g.get("properties"))
        .and_then(|p| p.get("type"))
        .and_then(|t| t.get("enum"))
        .and_then(|e| e.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();

    let mut errors = Vec::new();
    for (idx, feat) in features.iter().enumerate() {
        if !allowed_geom_types.is_empty() {
            if let Some(gtype) = feat
                .get("geometry")
                .and_then(|g| g.get("type"))
                .and_then(|t| t.as_str())
            {
                if !allowed_geom_types.iter().any(|allowed| allowed == gtype) {
                    errors.push(format!(
                        "Feature #{}: geometry type `{gtype}` not allowed",
                        idx + 1
                    ));
                }
            }
        }
        let fprops = feat
            .get("properties")
            .and_then(|p| p.as_object())
            .cloned()
            .unwrap_or_default();
        for req_key in &required_keys {
            let present = match fprops.get(req_key) {
                Some(serde_json::Value::Null) | None => false,
                Some(serde_json::Value::String(s)) => !s.trim().is_empty(),
                Some(_) => true,
            };
            if !present {
                errors.push(format!(
                    "Feature #{}: missing required `{req_key}`",
                    idx + 1
                ));
            }
        }
        if let Some(schema_map) = props_schema {
            for (field, def) in schema_map {
                if field == "geometry" {
                    continue;
                }
                let Some(val) = fprops.get(field) else {
                    continue;
                };
                if val.is_null() {
                    continue;
                }
                if let Some(allowed) = def.get("enum").and_then(|e| e.as_array()) {
                    let s_val = match val {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    let ok = allowed.iter().any(|item| match item {
                        serde_json::Value::String(s) => s == &s_val,
                        other => other == val,
                    });
                    if !ok {
                        errors.push(format!(
                            "Feature #{}: `{field}` value `{s_val}` not in allowed enum",
                            idx + 1
                        ));
                    }
                    continue;
                }
                match def.get("type").and_then(|t| t.as_str()) {
                    Some("string") if !val.is_string() => {
                        errors.push(format!("Feature #{}: `{field}` must be text", idx + 1));
                    }
                    Some("number") if !val.is_number() => {
                        errors.push(format!("Feature #{}: `{field}` must be a number", idx + 1));
                    }
                    Some("integer") if val.as_i64().is_none() && val.as_u64().is_none() => {
                        errors.push(format!("Feature #{}: `{field}` must be an integer", idx + 1));
                    }
                    Some("boolean") if !val.is_boolean() => {
                        errors.push(format!("Feature #{}: `{field}` must be boolean", idx + 1));
                    }
                    _ => {}
                }
            }
        }
        if errors.len() >= 12 {
            break;
        }
    }

    Ok(AtlasSchemaValidationDto {
        valid: errors.is_empty(),
        hash_verified: true,
        errors,
    })
}
