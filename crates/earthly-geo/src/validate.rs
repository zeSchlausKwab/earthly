//! RFC 7946 FeatureCollection validation, bounding box, and centroid summary.

use std::collections::BTreeSet;

use earthly_spatial::Bounds;
use geo::{BoundingRect, Geometry};
use geojson::FeatureCollection;
use serde::{Deserialize, Serialize};

use crate::GeoError;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    pub feature_count: usize,
    pub bounds: Option<Bounds>,
    pub centroid: Option<[f64; 2]>,
}

/// Validates a GeoJSON FeatureCollection for RFC 7946 structure, finite WGS84
/// coordinates, and unique explicit feature IDs.
pub fn validate_feature_collection(
    value: &serde_json::Value,
) -> Result<ValidationSummary, GeoError> {
    let fc: FeatureCollection = serde_json::from_value(value.clone())
        .map_err(|err| GeoError::InvalidGeoJson(err.to_string()))?;

    let mut seen_ids = BTreeSet::new();
    let mut min_x = f64::INFINITY;
    let mut min_y = f64::INFINITY;
    let mut max_x = f64::NEG_INFINITY;
    let mut max_y = f64::NEG_INFINITY;

    for feature in &fc.features {
        if let Some(id) = &feature.id {
            let key = match id {
                geojson::feature::Id::String(s) => s.clone(),
                geojson::feature::Id::Number(n) => n.to_string(),
            };
            if !seen_ids.insert(key.clone()) {
                return Err(GeoError::DuplicateFeatureId(key));
            }
        }
        let Some(geom) = &feature.geometry else {
            continue;
        };
        let geo_geom: Geometry<f64> = geom
            .try_into()
            .map_err(|err| GeoError::InvalidGeoJson(format!("{err:?}")))?;
        validate_geometry_coords(&geo_geom)?;
        if let Some(rect) = geo_geom.bounding_rect() {
            min_x = min_x.min(rect.min().x);
            min_y = min_y.min(rect.min().y);
            max_x = max_x.max(rect.max().x);
            max_y = max_y.max(rect.max().y);
        }
    }

    let bounds = if min_x.is_finite() {
        Some(
            Bounds::new(min_x, min_y, max_x, max_y)
                .map_err(|err| GeoError::InvalidGeoJson(err.to_string()))?,
        )
    } else {
        None
    };
    let centroid = bounds.map(|b| [(b.west + b.east) / 2.0, (b.south + b.north) / 2.0]);

    Ok(ValidationSummary {
        feature_count: fc.features.len(),
        bounds,
        centroid,
    })
}

fn validate_geometry_coords(geom: &Geometry<f64>) -> Result<(), GeoError> {
    use geo::CoordsIter;
    for coord in geom.coords_iter() {
        if !coord.x.is_finite()
            || !coord.y.is_finite()
            || !(-180.0..=180.0).contains(&coord.x)
            || !(-90.0..=90.0).contains(&coord.y)
        {
            return Err(GeoError::InvalidCoordinate(coord.x, coord.y));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_feature_collection_and_rejects_bad_coords_or_duplicate_ids() {
        let ok = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "id": "f1", "geometry": { "type": "Point", "coordinates": [16.37, 48.20] }, "properties": {} },
                { "type": "Feature", "id": "f2", "geometry": { "type": "Point", "coordinates": [16.47, 48.24] }, "properties": {} }
            ]
        });
        let summary = validate_feature_collection(&ok).unwrap();
        assert_eq!(summary.feature_count, 2);
        let bounds = summary.bounds.unwrap();
        assert!((bounds.west - 16.37).abs() < 1e-9);
        assert!((bounds.north - 48.24).abs() < 1e-9);

        let dup = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "id": "same", "geometry": { "type": "Point", "coordinates": [16.37, 48.20] }, "properties": {} },
                { "type": "Feature", "id": "same", "geometry": { "type": "Point", "coordinates": [16.38, 48.21] }, "properties": {} }
            ]
        });
        assert_eq!(
            validate_feature_collection(&dup),
            Err(GeoError::DuplicateFeatureId("same".to_owned()))
        );

        let out_of_range = serde_json::json!({
            "type": "FeatureCollection",
            "features": [
                { "type": "Feature", "id": "bad", "geometry": { "type": "Point", "coordinates": [181.0, 48.20] }, "properties": {} }
            ]
        });
        assert!(matches!(
            validate_feature_collection(&out_of_range),
            Err(GeoError::InvalidCoordinate(181.0, 48.2))
        ));
    }
}
