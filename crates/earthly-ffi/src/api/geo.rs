//! Rust `earthly-geo` geometry workbench exposed directly to Flutter via FFI.

use std::f64::consts::PI;
use std::time::Duration;

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

#[derive(Clone, Debug)]
pub struct OsmImportResultDto {
    pub geojson: String,
    pub feature_count: u32,
    pub query_summary: String,
}

fn sanitize_osm_ident(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == ':' || *c == '-')
        .collect()
}

fn build_overpass_filter(preset: &str, custom_tag: Option<&str>) -> Result<String, String> {
    if let Some(custom) = custom_tag.map(str::trim).filter(|s| !s.is_empty()) {
        if let Some((raw_k, raw_v)) = custom.split_once('=') {
            let k = sanitize_osm_ident(raw_k);
            let v = raw_v.trim().replace('"', "");
            if k.is_empty() {
                return Err("Invalid OSM tag key".to_owned());
            }
            if v.is_empty() || v == "*" {
                return Ok(format!(r#"["{k}"]"#));
            }
            return Ok(format!(r#"["{k}"="{v}"]"#));
        }
        let k = sanitize_osm_ident(custom);
        if k.is_empty() {
            return Err("Invalid OSM tag key".to_owned());
        }
        return Ok(format!(r#"["{k}"]"#));
    }
    Ok(match preset.trim().to_ascii_lowercase().as_str() {
        "highway" | "railway" | "waterway" | "building" | "natural" | "landuse" | "amenity"
        | "leisure" => format!(r#"["{}"]"#, preset.trim().to_ascii_lowercase()),
        "peaks" => r#"["natural"="peak"]"#.to_owned(),
        "water" => r#"["amenity"="drinking_water"]"#.to_owned(),
        _ => r#"["name"]"#.to_owned(),
    })
}

pub(crate) fn overpass_json_to_feature_collection(
    raw: &serde_json::Value,
    limit: usize,
) -> Result<(String, usize), String> {
    let elements = raw
        .get("elements")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Overpass response contained no elements array".to_owned())?;

    let mut features = Vec::new();
    for el in elements {
        if features.len() >= limit {
            break;
        }
        let el_type = el.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let el_id = el.get("id").and_then(|v| v.as_i64()).unwrap_or(0);
        let tags = el
            .get("tags")
            .and_then(|v| v.as_object())
            .cloned()
            .unwrap_or_default();

        let mut props = serde_json::Map::new();
        for (k, v) in &tags {
            props.insert(k.clone(), v.clone());
        }
        props.insert(
            "@id".to_owned(),
            serde_json::Value::String(format!("{el_type}/{el_id}")),
        );
        props.insert(
            "@type".to_owned(),
            serde_json::Value::String(el_type.to_owned()),
        );
        if !props.contains_key("name") {
            if let Some(ref_val) = props.get("ref").cloned() {
                props.insert("name".to_owned(), ref_val);
            }
        }

        if el_type == "node" {
            let (Some(lat), Some(lon)) = (
                el.get("lat").and_then(|v| v.as_f64()),
                el.get("lon").and_then(|v| v.as_f64()),
            ) else {
                continue;
            };
            features.push(serde_json::json!({
                "type": "Feature",
                "id": format!("osm-node-{el_id}"),
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": props,
            }));
        } else if el_type == "way" {
            let Some(geom_arr) = el.get("geometry").and_then(|v| v.as_array()) else {
                continue;
            };
            let mut ring: Vec<Vec<f64>> = Vec::with_capacity(geom_arr.len());
            for pt in geom_arr {
                if let (Some(lat), Some(lon)) = (
                    pt.get("lat").and_then(|v| v.as_f64()),
                    pt.get("lon").and_then(|v| v.as_f64()),
                ) {
                    ring.push(vec![lon, lat]);
                }
            }
            if ring.len() < 2 {
                continue;
            }
            let closed = ring.len() >= 4 && ring.first() == ring.last();
            let area_hint = tags.contains_key("building")
                || tags.contains_key("landuse")
                || tags.contains_key("leisure")
                || tags.contains_key("natural")
                || tags.get("area").and_then(|v| v.as_str()) == Some("yes");
            let geometry = if closed && (area_hint || !tags.contains_key("highway")) {
                serde_json::json!({ "type": "Polygon", "coordinates": [ring] })
            } else {
                serde_json::json!({ "type": "LineString", "coordinates": ring })
            };
            features.push(serde_json::json!({
                "type": "Feature",
                "id": format!("osm-way-{el_id}"),
                "geometry": geometry,
                "properties": props,
            }));
        }
    }

    let count = features.len();
    let fc = serde_json::json!({
        "type": "FeatureCollection",
        "name": "OSM Overpass Import",
        "features": features,
    });
    let geojson = serde_json::to_string(&fc).map_err(|e| e.to_string())?;
    Ok((geojson, count))
}

/// Queries OpenStreetMap Overpass within a bounded viewport bbox and returns
/// normalized GeoJSON Features ready to import into the working draft.
pub async fn geo_query_overpass_bbox(
    west: f64,
    south: f64,
    east: f64,
    north: f64,
    preset: String,
    custom_tag: Option<String>,
    limit: Option<u32>,
) -> Result<OsmImportResultDto, String> {
    if ![west, south, east, north].into_iter().all(f64::is_finite) {
        return Err("Bounding box coordinates must be finite numbers".to_owned());
    }
    if east <= west || north <= south {
        return Err("Bounding box is empty".to_owned());
    }
    if (east - west) > 0.5 || (north - south) > 0.5 {
        return Err(
            "Area too large for Overpass query (max 0.5° × 0.5°). Zoom in closer first.".to_owned(),
        );
    }
    let filter = build_overpass_filter(&preset, custom_tag.as_deref())?;
    let cap = limit.unwrap_or(150).clamp(10, 400) as usize;
    let query = format!(
        "[out:json][timeout:18];(nwr{filter}({south:.6},{west:.6},{north:.6},{east:.6}););out geom {cap};"
    );

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut body_json: Option<serde_json::Value> = None;
    let mut last_err = String::new();
    for endpoint in [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ] {
        match client
            .post(endpoint)
            .form(&[("data", query.as_str())])
            .send()
            .await
        {
            Ok(resp) if resp.status().is_success() => match resp.json::<serde_json::Value>().await {
                Ok(v) => {
                    body_json = Some(v);
                    break;
                }
                Err(err) => last_err = format!("invalid Overpass JSON: {err}"),
            },
            Ok(resp) => last_err = format!("Overpass HTTP {}", resp.status()),
            Err(err) => last_err = format!("Overpass request failed: {err}"),
        }
    }

    let raw = body_json.ok_or_else(|| {
        if last_err.is_empty() {
            "Overpass query failed".to_owned()
        } else {
            last_err
        }
    })?;
    let (geojson, feature_count) = overpass_json_to_feature_collection(&raw, cap)?;
    Ok(OsmImportResultDto {
        geojson,
        feature_count: feature_count as u32,
        query_summary: format!("nwr{filter} -> {feature_count} features"),
    })
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

    #[test]
    fn overpass_json_converts_nodes_ways_and_polygons() {
        let raw = serde_json::json!({
            "elements": [
                {
                    "type": "node",
                    "id": 101,
                    "lat": 48.2082,
                    "lon": 16.3738,
                    "tags": { "name": "Stephansplatz", "amenity": "drinking_water" }
                },
                {
                    "type": "way",
                    "id": 202,
                    "tags": { "name": "Ring", "highway": "primary" },
                    "geometry": [
                        { "lat": 48.20, "lon": 16.36 },
                        { "lat": 48.21, "lon": 16.37 }
                    ]
                },
                {
                    "type": "way",
                    "id": 303,
                    "tags": { "name": "Town Hall", "building": "yes" },
                    "geometry": [
                        { "lat": 48.210, "lon": 16.356 },
                        { "lat": 48.211, "lon": 16.356 },
                        { "lat": 48.211, "lon": 16.358 },
                        { "lat": 48.210, "lon": 16.356 }
                    ]
                }
            ]
        });
        let (geojson, count) = overpass_json_to_feature_collection(&raw, 50).unwrap();
        assert_eq!(count, 3);
        let parsed: serde_json::Value = serde_json::from_str(&geojson).unwrap();
        let feats = parsed["features"].as_array().unwrap();
        assert_eq!(feats[0]["geometry"]["type"], "Point");
        assert_eq!(feats[1]["geometry"]["type"], "LineString");
        assert_eq!(feats[2]["geometry"]["type"], "Polygon");
        assert_eq!(feats[0]["properties"]["name"], "Stephansplatz");
    }
}
