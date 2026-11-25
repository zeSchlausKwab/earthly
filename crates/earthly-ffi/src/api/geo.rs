//! Rust `earthly-geo` geometry workbench exposed directly to Flutter via FFI.

use std::f64::consts::PI;

use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, LocalProjection, connect_lines,
    create_line_corridor, difference_polygons, extrude_line, geodesic_area_m2, geodesic_length_m,
    geojson_to_gpx, geojson_to_kml, import_spatial_text_to_geojson, offset_line, offset_polygon,
    simplify_line, simplify_polygon, split_line_at_point, split_polygon_by_line, union_polygons,
    validate_feature_collection,
};
use geo::{Coord, LineString, Point, Polygon};

#[derive(Clone, Debug)]
pub struct LonLatPoint {
    pub lon: f64,
    pub lat: f64,
}

fn to_line(points: &[LonLatPoint]) -> LineString<f64> {
    LineString::new(
        points
            .iter()
            .map(|p| Coord { x: p.lon, y: p.lat })
            .collect(),
    )
}

fn from_coords(coords: &[Coord<f64>]) -> Vec<LonLatPoint> {
    coords
        .iter()
        .map(|c| LonLatPoint { lon: c.x, lat: c.y })
        .collect()
}

fn to_closed_polygon(points: &[LonLatPoint]) -> Polygon<f64> {
    let mut coords: Vec<Coord<f64>> = points
        .iter()
        .map(|p| Coord { x: p.lon, y: p.lat })
        .collect();
    if let (Some(&first), Some(&last)) = (coords.first(), coords.last()) {
        if first != last {
            coords.push(first);
        }
    }
    Polygon::new(LineString::new(coords), vec![])
}

/// Douglas-Peucker simplification of a polyline in meters.
pub fn geo_simplify_line(
    points: Vec<LonLatPoint>,
    tolerance_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let out = simplify_line(&to_line(&points), tolerance_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&out.0))
}

/// Douglas-Peucker simplification of a polygon exterior ring in meters.
pub fn geo_simplify_polygon(
    ring: Vec<LonLatPoint>,
    tolerance_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let out =
        simplify_polygon(&to_closed_polygon(&ring), tolerance_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&out.exterior().0))
}

/// Parallel offset copy of a polyline in meters (positive = left, negative = right).
pub fn geo_offset_line(
    points: Vec<LonLatPoint>,
    distance_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let out = offset_line(&to_line(&points), distance_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&out.0))
}

/// Connects polylines whose endpoints lie within `tolerance_meters`.
pub fn geo_connect_lines(
    lines: Vec<Vec<LonLatPoint>>,
    tolerance_meters: f64,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let parsed: Vec<LineString<f64>> = lines.iter().map(|l| to_line(l)).collect();
    let merged = connect_lines(&parsed, tolerance_meters).map_err(|e| e.to_string())?;
    Ok(merged.into_iter().map(|l| from_coords(&l.0)).collect())
}

/// Symmetric round-ended corridor polygon around a polyline.
pub fn geo_line_corridor(
    points: Vec<LonLatPoint>,
    total_width_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let poly =
        create_line_corridor(&to_line(&points), total_width_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&poly.exterior().0))
}

/// Tapered filled band polygon extruded from a polyline.
pub fn geo_extrude_band(
    points: Vec<LonLatPoint>,
    start_width_meters: f64,
    end_width_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let poly = extrude_line(
        &to_line(&points),
        ExtrudeOptions {
            shape: ExtrudeShape::Band,
            start_width_meters,
            end_width_meters: Some(end_width_meters),
            side: ExtrudeSide::Center,
            arrow_head_length_meters: None,
            arrow_head_width_meters: None,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(from_coords(&poly.exterior().0))
}

/// Directional flow-map arrow polygon extruded from a polyline.
pub fn geo_extrude_arrow(
    points: Vec<LonLatPoint>,
    start_width_meters: f64,
    end_width_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let poly = extrude_line(
        &to_line(&points),
        ExtrudeOptions {
            shape: ExtrudeShape::Arrow,
            start_width_meters,
            end_width_meters: Some(end_width_meters),
            side: ExtrudeSide::Center,
            arrow_head_length_meters: None,
            arrow_head_width_meters: None,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(from_coords(&poly.exterior().0))
}

/// Expand (positive) or inset (negative) a polygon ring in meters.
pub fn geo_offset_polygon(
    ring: Vec<LonLatPoint>,
    distance_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let out =
        offset_polygon(&to_closed_polygon(&ring), distance_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&out.exterior().0))
}

/// Boolean union of two or more polygon rings.
pub fn geo_union_polygons(rings: Vec<Vec<LonLatPoint>>) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let polys: Vec<Polygon<f64>> = rings.iter().map(|r| to_closed_polygon(r)).collect();
    let merged = union_polygons(&polys).map_err(|e| e.to_string())?;
    Ok(merged
        .0
        .into_iter()
        .map(|p| from_coords(&p.exterior().0))
        .collect())
}

/// Boolean difference (`subject - clip`) of two polygon rings.
pub fn geo_difference_polygons(
    subject_ring: Vec<LonLatPoint>,
    clip_ring: Vec<LonLatPoint>,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let diff = difference_polygons(
        &to_closed_polygon(&subject_ring),
        &to_closed_polygon(&clip_ring),
    )
    .map_err(|e| e.to_string())?;
    Ok(diff
        .0
        .into_iter()
        .map(|p| from_coords(&p.exterior().0))
        .collect())
}

/// Splits a polygon ring cleanly along a cutting polyline via `earthly-geo`.
pub fn geo_split_polygon_by_line(
    ring: Vec<LonLatPoint>,
    splitter: Vec<LonLatPoint>,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let pieces = split_polygon_by_line(&to_closed_polygon(&ring), &to_line(&splitter))
        .map_err(|e| e.to_string())?;
    Ok(pieces
        .into_iter()
        .map(|p| from_coords(&p.exterior().0))
        .collect())
}

/// Splits a polyline into two polylines at the closest point to `split_point`.
pub fn geo_split_line_at_point(
    points: Vec<LonLatPoint>,
    split_point: LonLatPoint,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let (a, b) = split_line_at_point(
        &to_line(&points),
        Point::new(split_point.lon, split_point.lat),
    )
    .map_err(|e| e.to_string())?;
    Ok(vec![from_coords(&a.0), from_coords(&b.0)])
}

/// Translates, rotates (clockwise degrees around centroid), and scales a set of
/// coordinates accurately in local metric tangent space (`LocalProjection`).
pub fn geo_transform_points(
    points: Vec<LonLatPoint>,
    translate_east_m: f64,
    translate_north_m: f64,
    rotate_deg: f64,
    scale: f64,
) -> Result<Vec<LonLatPoint>, String> {
    if points.is_empty() {
        return Err("no coordinates to transform".to_owned());
    }
    if !translate_east_m.is_finite()
        || !translate_north_m.is_finite()
        || !rotate_deg.is_finite()
        || !scale.is_finite()
        || scale <= 0.0
    {
        return Err("invalid transform parameters".to_owned());
    }
    let coords: Vec<Coord<f64>> = points
        .iter()
        .map(|p| Coord { x: p.lon, y: p.lat })
        .collect();
    let proj = LocalProjection::from_coords(coords.iter());
    let metric: Vec<Coord<f64>> = coords.iter().map(|&c| proj.forward(c)).collect();
    let n = metric.len() as f64;
    let cx = metric.iter().map(|c| c.x).sum::<f64>() / n;
    let cy = metric.iter().map(|c| c.y).sum::<f64>() / n;
    // Clockwise positive degrees matches compass bearing convention.
    let rad = -rotate_deg.to_radians();
    let cos_a = rad.cos();
    let sin_a = rad.sin();

    let transformed: Vec<Coord<f64>> = metric
        .into_iter()
        .map(|c| {
            let dx = (c.x - cx) * scale;
            let dy = (c.y - cy) * scale;
            let rx = dx * cos_a - dy * sin_a;
            let ry = dx * sin_a + dy * cos_a;
            proj.inverse(Coord {
                x: cx + rx + translate_east_m,
                y: cy + ry + translate_north_m,
            })
        })
        .collect();
    Ok(from_coords(&transformed))
}

/// Generates a geodesic-accurate primitive polygon ring (`circle`, `square`,
/// `rectangle`, `triangle`, `diamond`, `hexagon`) centered at `center` in meters.
pub fn geo_create_primitive_shape(
    center: LonLatPoint,
    shape: String,
    radius_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    if !center.lon.is_finite()
        || !center.lat.is_finite()
        || !radius_meters.is_finite()
        || radius_meters <= 0.0
    {
        return Err("invalid primitive shape parameters".to_owned());
    }
    let origin = Coord {
        x: center.lon,
        y: center.lat,
    };
    let proj = LocalProjection::from_coords([origin].iter());
    let r = radius_meters.clamp(1.0, 500_000.0);

    let local_ring: Vec<Coord<f64>> = match shape.trim().to_lowercase().as_str() {
        "square" => vec![
            Coord { x: -r, y: -r },
            Coord { x: r, y: -r },
            Coord { x: r, y: r },
            Coord { x: -r, y: r },
        ],
        "rectangle" => {
            let rx = r * 1.45;
            let ry = r * 0.85;
            vec![
                Coord { x: -rx, y: -ry },
                Coord { x: rx, y: -ry },
                Coord { x: rx, y: ry },
                Coord { x: -rx, y: ry },
            ]
        }
        "triangle" => (0..3)
            .map(|i| {
                let a = PI / 2.0 + (i as f64) * 2.0 * PI / 3.0;
                Coord {
                    x: r * a.cos(),
                    y: r * a.sin(),
                }
            })
            .collect(),
        "diamond" => vec![
            Coord { x: 0.0, y: r },
            Coord { x: r * 0.85, y: 0.0 },
            Coord { x: 0.0, y: -r },
            Coord { x: -r * 0.85, y: 0.0 },
        ],
        "hexagon" => (0..6)
            .map(|i| {
                let a = (i as f64) * PI / 3.0;
                Coord {
                    x: r * a.cos(),
                    y: r * a.sin(),
                }
            })
            .collect(),
        _ => {
            // Default: smooth 36-vertex circle
            const STEPS: usize = 36;
            (0..STEPS)
                .map(|i| {
                    let a = (i as f64) * 2.0 * PI / (STEPS as f64);
                    Coord {
                        x: r * a.cos(),
                        y: r * a.sin(),
                    }
                })
                .collect()
        }
    };

    let wgs: Vec<Coord<f64>> = local_ring.into_iter().map(|c| proj.inverse(c)).collect();
    Ok(from_coords(&wgs))
}

#[derive(Clone, Debug)]
pub struct DraftValidationDto {
    pub valid: bool,
    pub feature_count: u32,
    pub message: String,
}

/// Validates a GeoJSON FeatureCollection via `earthly-geo::validate_feature_collection`.
pub fn geo_validate_draft_geojson(geojson: String) -> DraftValidationDto {
    let parsed: serde_json::Value = match serde_json::from_str(&geojson) {
        Ok(v) => v,
        Err(err) => {
            return DraftValidationDto {
                valid: false,
                feature_count: 0,
                message: format!("Invalid JSON: {err}"),
            };
        }
    };
    match validate_feature_collection(&parsed) {
        Ok(summary) => DraftValidationDto {
            valid: true,
            feature_count: summary.feature_count as u32,
            message: format!(
                "Valid RFC 7946 FeatureCollection ({} feature{})",
                summary.feature_count,
                if summary.feature_count == 1 { "" } else { "s" }
            ),
        },
        Err(err) => DraftValidationDto {
            valid: false,
            feature_count: 0,
            message: err.to_string(),
        },
    }
}

pub fn geo_measure_line_meters(points: Vec<LonLatPoint>) -> f64 {
    geodesic_length_m(&to_line(&points))
}

pub fn geo_measure_polygon_area_m2(ring: Vec<LonLatPoint>) -> f64 {
    geodesic_area_m2(&to_closed_polygon(&ring))
}

#[derive(Clone, Debug)]
pub struct SpatialImportDto {
    pub format: String,
    pub title: String,
    pub geojson: String,
    pub feature_count: u32,
    pub warnings: Vec<String>,
}

/// Auto-detects GeoJSON, GPX, or KML from filename/content and returns a
/// validated Earthly GeoJSON FeatureCollection.
pub fn geo_import_spatial_file(
    filename: String,
    content: String,
) -> Result<SpatialImportDto, String> {
    let fname = if filename.trim().is_empty() {
        None
    } else {
        Some(filename.as_str())
    };
    let imported = import_spatial_text_to_geojson(fname, &content).map_err(|e| e.to_string())?;
    let geojson = serde_json::to_string(&imported.geojson).map_err(|e| e.to_string())?;
    Ok(SpatialImportDto {
        format: imported.format,
        title: imported.title,
        geojson,
        feature_count: imported.feature_count as u32,
        warnings: imported.warnings,
    })
}

/// Exports an Earthly GeoJSON FeatureCollection string into GPX 1.1 XML.
pub fn geo_export_gpx(geojson: String, title: Option<String>) -> Result<String, String> {
    let fc: serde_json::Value =
        serde_json::from_str(&geojson).map_err(|e| format!("invalid GeoJSON: {e}"))?;
    geojson_to_gpx(&fc, title.as_deref()).map_err(|e| e.to_string())
}

/// Exports an Earthly GeoJSON FeatureCollection string into KML 2.2 XML.
pub fn geo_export_kml(geojson: String, title: Option<String>) -> Result<String, String> {
    let fc: serde_json::Value =
        serde_json::from_str(&geojson).map_err(|e| format!("invalid GeoJSON: {e}"))?;
    geojson_to_kml(&fc, title.as_deref()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_primitives_transforms_connects_and_validates() {
        let center = LonLatPoint {
            lon: 16.3738,
            lat: 48.2082,
        };
        let circle = geo_create_primitive_shape(center.clone(), "circle".to_owned(), 200.0).unwrap();
        assert_eq!(circle.len(), 36);
        let circle_area = geo_measure_polygon_area_m2(circle.clone());
        // pi * 200^2 ≈ 125,664 m^2
        assert!(circle_area > 120_000.0 && circle_area < 130_000.0);

        let rect = geo_create_primitive_shape(center.clone(), "rectangle".to_owned(), 100.0).unwrap();
        assert_eq!(rect.len(), 4);

        // Scale by 2x -> area ~4x
        let scaled = geo_transform_points(rect.clone(), 0.0, 0.0, 45.0, 2.0).unwrap();
        let ratio = geo_measure_polygon_area_m2(scaled) / geo_measure_polygon_area_m2(rect.clone());
        assert!((ratio - 4.0).abs() < 0.05);

        // Simplify polygon
        let simp = geo_simplify_polygon(circle, 20.0).unwrap();
        assert!(simp.len() < 36 && simp.len() >= 4);

        // Connect two touching lines
        let l1 = vec![
            LonLatPoint { lon: 16.36, lat: 48.20 },
            LonLatPoint { lon: 16.37, lat: 48.20 },
        ];
        let l2 = vec![
            LonLatPoint { lon: 16.37, lat: 48.20 },
            LonLatPoint { lon: 16.38, lat: 48.21 },
        ];
        let connected = geo_connect_lines(vec![l1.clone(), l2], 15.0).unwrap();
        assert_eq!(connected.len(), 1);
        assert_eq!(connected[0].len(), 3);

        // Tapered band extrusion
        let band = geo_extrude_band(l1, 30.0, 80.0).unwrap();
        assert!(geo_measure_polygon_area_m2(band) > 10_000.0);

        // Validation
        let valid = geo_validate_draft_geojson(
            r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{}}]}"#
                .to_owned(),
        );
        assert!(valid.valid);
        assert_eq!(valid.feature_count, 1);
    }
}
