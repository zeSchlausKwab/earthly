//! Working-copy / local draft invariants and proposal diff summaries
//! (`CONTEXT.md` & `docs/MAP-WITH-A-MARGIN-SPEC.md` §7–§8).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Per-working-copy audience. Never global, never silently converted to Public
/// on navigation (`CONTEXT.md`).
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(tag = "channel", rename_all = "kebab-case")]
pub enum PublishAudience {
    Public,
    Circle { group_id: String, name: String },
    Nearby { session_id: String, name: String },
    /// Quarantined legacy draft whose destination must be chosen explicitly.
    DestinationNeeded,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AuthoringIntent {
    Create,
    Edit,
    Fork,
    Propose,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDraftRecord {
    pub draft_id: String,
    pub entity_kind: u16,
    pub intent: AuthoringIntent,
    pub audience: PublishAudience,
    pub source_address: Option<String>,
    pub title: String,
    pub payload: serde_json::Value,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalDiffSummary {
    pub added: Vec<String>,
    pub modified: Vec<String>,
    pub removed: Vec<String>,
}

/// Compute a deterministic feature-ID diff (`+a ~m -r`) between a base
/// FeatureCollection and a proposed/working replacement FeatureCollection.
pub fn diff_feature_collections(
    base: &serde_json::Value,
    proposed: &serde_json::Value,
) -> ProposalDiffSummary {
    let base_map = index_features(base);
    let proposed_map = index_features(proposed);

    let mut summary = ProposalDiffSummary::default();
    for (id, proposed_feature) in &proposed_map {
        match base_map.get(id) {
            None => summary.added.push(id.clone()),
            Some(base_feature) if *base_feature != *proposed_feature => {
                summary.modified.push(id.clone());
            }
            Some(_) => {}
        }
    }
    for id in base_map.keys() {
        if !proposed_map.contains_key(id) {
            summary.removed.push(id.clone());
        }
    }
    summary
}

fn index_features(fc: &serde_json::Value) -> BTreeMap<String, &serde_json::Value> {
    let mut map = BTreeMap::new();
    let Some(features) = fc.get("features").and_then(|v| v.as_array()) else {
        return map;
    };
    for (idx, feature) in features.iter().enumerate() {
        let id = match feature.get("id") {
            Some(serde_json::Value::String(s)) if !s.is_empty() => s.clone(),
            Some(serde_json::Value::Number(n)) => n.to_string(),
            _ => format!("__index_{idx}"),
        };
        map.insert(id, feature);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_feature_id_proposal_diff() {
        let base = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "id": "a", "geometry": { "type": "Point", "coordinates": [16.3, 48.2] }, "properties": { "name": "Old" } },
                { "type": "Feature", "id": "b", "geometry": { "type": "Point", "coordinates": [16.4, 48.2] }, "properties": {} }
            ]
        });
        let proposed = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "id": "a", "geometry": { "type": "Point", "coordinates": [16.3, 48.2] }, "properties": { "name": "New" } },
                { "type": "Feature", "id": "c", "geometry": { "type": "Point", "coordinates": [16.5, 48.2] }, "properties": {} }
            ]
        });

        let diff = diff_feature_collections(&base, &proposed);
        assert_eq!(diff.added, vec!["c"]);
        assert_eq!(diff.modified, vec!["a"]);
        assert_eq!(diff.removed, vec!["b"]);
    }
}
