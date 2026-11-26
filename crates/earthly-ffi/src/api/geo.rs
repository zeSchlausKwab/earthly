//! Rust `earthly-geo` geometry workbench exposed directly to Flutter via FFI.

use std::f64::consts::PI;
use std::time::Duration;

use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, LocalProjection, connect_lines,
    create_line_corridor, difference_polygons, dissolve_lines, explode_multipart,
    export_geojson_to_shapefile_zip, extrude_line, geodesic_area_m2, geodesic_length_m,
    geojson_to_gpx, geojson_to_kml, import_spatial_text_to_geojson, merge_to_multipart,
    offset_line, offset_polygon, simplify_line, simplify_polygon, split_line_at_point,
    split_line_by_line, split_polygon_by_line, union_polygons, validate_feature_collection,
    parse_shapefile_bytes,
};
use geo::{Coord, Geometry, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon};

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

/// Splits a polyline into ordered polylines at every interior intersection with `splitter`.
pub fn geo_split_line_by_line(
    points: Vec<LonLatPoint>,
    splitter: Vec<LonLatPoint>,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let parts =
        split_line_by_line(&to_line(&points), &to_line(&splitter)).map_err(|e| e.to_string())?;
    Ok(parts.into_iter().map(|l| from_coords(&l.0)).collect())
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

#[derive(Clone, Debug)]
pub struct ValhallaRouteResultDto {
    pub geojson: String,
    pub distance_meters: f64,
    pub duration_seconds: f64,
    pub profile: String,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub struct ValhallaIsochroneResultDto {
    pub geojson: String,
    pub feature_count: u32,
    pub profile: String,
    pub summary: String,
}

fn normalize_valhalla_profile(profile: &str) -> &'static str {
    match profile.trim().to_ascii_lowercase().as_str() {
        "bike" | "bicycle" | "cycling" => "bicycle",
        "drive" | "auto" | "car" => "auto",
        "bus" => "bus",
        "truck" => "truck",
        _ => "pedestrian",
    }
}

/// Decodes Valhalla 6-digit precision encoded polyline into WGS-84 `[lon, lat]` pairs.
pub(crate) fn decode_polyline6(encoded: &str) -> Vec<[f64; 2]> {
    let bytes = encoded.as_bytes();
    let mut index = 0usize;
    let mut lat: i64 = 0;
    let mut lon: i64 = 0;
    let mut out = Vec::new();

    while index < bytes.len() {
        let mut shift = 0u32;
        let mut result: i64 = 0;
        loop {
            if index >= bytes.len() {
                return out;
            }
            let b = (bytes[index] as i64) - 63;
            index += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        let dlat = if (result & 1) != 0 {
            !(result >> 1)
        } else {
            result >> 1
        };
        lat += dlat;

        shift = 0;
        result = 0;
        loop {
            if index >= bytes.len() {
                return out;
            }
            let b = (bytes[index] as i64) - 63;
            index += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        let dlon = if (result & 1) != 0 {
            !(result >> 1)
        } else {
            result >> 1
        };
        lon += dlon;
        out.push([(lon as f64) / 1e6, (lat as f64) / 1e6]);
    }
    out
}

pub(crate) fn parse_valhalla_route_response(
    raw: &serde_json::Value,
    profile: &str,
) -> Result<ValhallaRouteResultDto, String> {
    let trip = raw
        .get("trip")
        .ok_or_else(|| "Valhalla response missing `trip` object".to_owned())?;
    let legs = trip
        .get("legs")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Valhalla trip missing `legs` array".to_owned())?;

    let mut coords: Vec<[f64; 2]> = Vec::new();
    for leg in legs {
        let Some(shape) = leg.get("shape").and_then(|v| v.as_str()) else {
            continue;
        };
        let pts = decode_polyline6(shape);
        if pts.is_empty() {
            continue;
        }
        if let (Some(&prev), Some(&first)) = (coords.last(), pts.first()) {
            if (prev[0] - first[0]).abs() < 1e-6 && (prev[1] - first[1]).abs() < 1e-6 {
                coords.extend_from_slice(&pts[1..]);
                continue;
            }
        }
        coords.extend_from_slice(&pts);
    }
    if coords.len() < 2 {
        return Err("Valhalla returned no valid route geometry".to_owned());
    }

    let length_km = trip
        .get("summary")
        .and_then(|s| s.get("length"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let duration_sec = trip
        .get("summary")
        .and_then(|s| s.get("time"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let norm = normalize_valhalla_profile(profile);
    let summary = format!(
        "{:.2} km · {:.0} min ({norm})",
        length_km,
        (duration_sec / 60.0).max(1.0)
    );

    let fc = serde_json::json!({
        "type": "FeatureCollection",
        "name": format!("Valhalla Route ({norm})"),
        "features": [{
            "type": "Feature",
            "id": format!("valhalla-route-{norm}"),
            "geometry": { "type": "LineString", "coordinates": coords },
            "properties": {
                "name": format!("Route · {:.2} km · {:.0} min", length_km, (duration_sec / 60.0).max(1.0)),
                "source": "valhalla",
                "profile": norm,
                "lengthKm": length_km,
                "durationMin": duration_sec / 60.0,
                "color": "#0284C7",
                "strokeColor": "#0284C7",
                "strokeWidth": 4
            }
        }]
    });

    Ok(ValhallaRouteResultDto {
        geojson: serde_json::to_string(&fc).map_err(|e| e.to_string())?,
        distance_meters: length_km * 1000.0,
        duration_seconds: duration_sec,
        profile: norm.to_owned(),
        summary,
    })
}

pub(crate) fn parse_valhalla_isochrone_response(
    raw: &serde_json::Value,
    profile: &str,
) -> Result<ValhallaIsochroneResultDto, String> {
    let raw_features = raw
        .get("features")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Valhalla isochrone response missing `features` array".to_owned())?;
    let norm = normalize_valhalla_profile(profile);
    let palette = ["#16A34A", "#0284C7", "#D97706", "#DC2626", "#7C3AED"];

    let mut out_features = Vec::new();
    for (idx, feat) in raw_features.iter().enumerate() {
        let Some(geom) = feat.get("geometry").and_then(|g| g.as_object()) else {
            continue;
        };
        let gtype = geom.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if gtype != "Polygon" && gtype != "MultiPolygon" {
            continue;
        }
        let polygon_coords = if gtype == "MultiPolygon" {
            let Some(first_poly) = geom
                .get("coordinates")
                .and_then(|c| c.as_array())
                .and_then(|a| a.first())
                .cloned()
            else {
                continue;
            };
            serde_json::json!({ "type": "Polygon", "coordinates": first_poly })
        } else {
            serde_json::Value::Object(geom.clone())
        };
        let mut props = feat
            .get("properties")
            .and_then(|p| p.as_object())
            .cloned()
            .unwrap_or_default();
        let contour = props
            .get("contour")
            .and_then(|v| v.as_u64())
            .unwrap_or(((idx + 1) * 10) as u64);
        let hex = palette[idx % palette.len()];
        props.insert(
            "name".to_owned(),
            serde_json::json!(format!("{contour} min {norm}")),
        );
        props.insert("source".to_owned(), serde_json::json!("valhalla-isochrone"));
        props.insert("profile".to_owned(), serde_json::json!(norm));
        props.insert("fillColor".to_owned(), serde_json::json!(hex));
        props.insert("strokeColor".to_owned(), serde_json::json!(hex));
        props.insert("fillOpacity".to_owned(), serde_json::json!(0.22));
        out_features.push(serde_json::json!({
            "type": "Feature",
            "id": format!("valhalla-iso-{contour}m"),
            "geometry": polygon_coords,
            "properties": props,
        }));
    }

    if out_features.is_empty() {
        return Err("Valhalla returned no isochrone polygons".to_owned());
    }
    let count = out_features.len() as u32;
    let fc = serde_json::json!({
        "type": "FeatureCollection",
        "name": format!("Valhalla Isochrone ({norm})"),
        "features": out_features,
    });
    Ok(ValhallaIsochroneResultDto {
        geojson: serde_json::to_string(&fc).map_err(|e| e.to_string())?,
        feature_count: count,
        profile: norm.to_owned(),
        summary: format!("{count} isochrone band(s) · {norm}"),
    })
}

/// Computes a routed path through ordered waypoints using a Valhalla server
/// (defaulting to FOSSGIS `https://valhalla1.openstreetmap.de`).
pub async fn geo_valhalla_route(
    waypoints: Vec<LonLatPoint>,
    profile: String,
    base_url: Option<String>,
) -> Result<ValhallaRouteResultDto, String> {
    if waypoints.len() < 2 || waypoints.len() > 50 {
        return Err("Routing requires between 2 and 50 waypoints".to_owned());
    }
    for wp in &waypoints {
        if !wp.lon.is_finite() || !wp.lat.is_finite() {
            return Err("Waypoint coordinates must be finite".to_owned());
        }
    }
    let norm = normalize_valhalla_profile(&profile);
    let base = base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://valhalla1.openstreetmap.de")
        .trim_end_matches('/');
    let endpoint = format!("{base}/route");
    let locations: Vec<serde_json::Value> = waypoints
        .iter()
        .map(|wp| serde_json::json!({ "lat": wp.lat, "lon": wp.lon }))
        .collect();
    let payload = serde_json::json!({
        "locations": locations,
        "costing": norm,
        "units": "kilometers",
        "directions_type": "none",
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let resp = client
        .post(&endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Valhalla route request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Valhalla HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid Valhalla JSON: {e}"))?;
    parse_valhalla_route_response(&body, norm)
}

/// Computes travel-time isochrone polygons around `origin` using Valhalla
/// (defaulting to FOSSGIS `https://valhalla1.openstreetmap.de`).
pub async fn geo_valhalla_isochrone(
    origin: LonLatPoint,
    profile: String,
    contours_minutes: Vec<u32>,
    base_url: Option<String>,
) -> Result<ValhallaIsochroneResultDto, String> {
    if !origin.lon.is_finite() || !origin.lat.is_finite() {
        return Err("Origin coordinates must be finite".to_owned());
    }
    let norm = normalize_valhalla_profile(&profile);
    let mut mins: Vec<u32> = contours_minutes
        .into_iter()
        .map(|m| m.clamp(1, 60))
        .take(5)
        .collect();
    if mins.is_empty() {
        mins = vec![5, 10, 15];
    }
    mins.sort_unstable();
    mins.dedup();
    let contours: Vec<serde_json::Value> = mins
        .into_iter()
        .map(|m| serde_json::json!({ "time": m }))
        .collect();

    let base = base_url
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("https://valhalla1.openstreetmap.de")
        .trim_end_matches('/');
    let endpoint = format!("{base}/isochrone");
    let payload = serde_json::json!({
        "locations": [{ "lat": origin.lat, "lon": origin.lon }],
        "costing": norm,
        "contours": contours,
        "polygons": true,
    });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let resp = client
        .post(&endpoint)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Valhalla isochrone request failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Valhalla HTTP {}", resp.status()));
    }
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("invalid Valhalla isochrone JSON: {e}"))?;
    parse_valhalla_isochrone_response(&body, norm)
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

    #[test]
    fn valhalla_polyline6_and_isochrone_parsing_work() {
        // Known Valhalla sample: two legs + summary + polyline6 shape
        let route_raw = serde_json::json!({
            "trip": {
                "summary": { "length": 1.45, "time": 920.0 },
                "legs": [{ "shape": "_p~iF~ps|U_ulLnnqC" }]
            }
        });
        let route = parse_valhalla_route_response(&route_raw, "walk").unwrap();
        assert_eq!(route.profile, "pedestrian");
        assert!((route.distance_meters - 1450.0).abs() < 0.01);
        let route_fc: serde_json::Value = serde_json::from_str(&route.geojson).unwrap();
        assert_eq!(route_fc["features"][0]["geometry"]["type"], "LineString");
        assert_eq!(
            route_fc["features"][0]["geometry"]["coordinates"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        let iso_raw = serde_json::json!({
            "type": "FeatureCollection",
            "features": [{
                "type": "Feature",
                "properties": { "contour": 10 },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[16.36, 48.20], [16.38, 48.20], [16.38, 48.22], [16.36, 48.20]]]
                }
            }]
        });
        let iso = parse_valhalla_isochrone_response(&iso_raw, "bicycle").unwrap();
        assert_eq!(iso.profile, "bicycle");
        assert_eq!(iso.feature_count, 1);
        let iso_fc: serde_json::Value = serde_json::from_str(&iso.geojson).unwrap();
        assert_eq!(iso_fc["features"][0]["properties"]["name"], "10 min bicycle");
    }

    #[test]
    fn dissolves_lines_and_rejects_empty_shapefile() {
        let a = vec![
            LonLatPoint { lon: 16.36, lat: 48.20 },
            LonLatPoint { lon: 16.37, lat: 48.20 },
        ];
        let b = vec![
            LonLatPoint { lon: 16.37, lat: 48.20 },
            LonLatPoint { lon: 16.38, lat: 48.21 },
        ];
        let dissolved = geo_dissolve_lines(vec![a.clone(), a, b], 5.0).unwrap();
        assert_eq!(dissolved.len(), 1);
        assert_eq!(dissolved[0].len(), 3);

        assert!(geo_import_shapefile_bytes(Some("empty.zip".to_owned()), Vec::new()).is_err());

        let sample_fc = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.3738,48.2082]},"properties":{"name":"Vienna"}}]}"#;
        let shp_zip = geo_export_shapefile_zip(sample_fc.to_owned(), Some("Vienna Test".to_owned())).unwrap();
        assert!(shp_zip.starts_with(b"PK\x03\x04"));
        let reimported = geo_import_shapefile_bytes(Some("vienna_test.zip".to_owned()), shp_zip).unwrap();
        assert_eq!(reimported.feature_count, 1);

        let csv_res = geo_import_spatial_file(
            "waypoints.csv".to_owned(),
            "name,lat,lon\nHub,48.21,16.37\n".to_owned(),
        )
        .unwrap();
        assert_eq!(csv_res.format, "csv");
        assert_eq!(csv_res.feature_count, 1);

        let merged_pts = geo_merge_to_multipart(vec![
            r#"{"type":"Point","coordinates":[16.37,48.20]}"#.to_owned(),
            r#"{"type":"Point","coordinates":[16.38,48.21]}"#.to_owned(),
        ])
        .unwrap();
        let merged_val: serde_json::Value = serde_json::from_str(&merged_pts).unwrap();
        assert_eq!(merged_val["type"], "MultiPoint");
        let exploded_pts = geo_explode_multipart(merged_pts).unwrap();
        assert_eq!(exploded_pts.len(), 2);

        let merged_lines = geo_merge_to_multipart(vec![
            r#"{"type":"LineString","coordinates":[[16.36,48.20],[16.37,48.20]]}"#.to_owned(),
            r#"{"type":"LineString","coordinates":[[16.38,48.21],[16.39,48.21]]}"#.to_owned(),
        ])
        .unwrap();
        assert!(merged_lines.contains("MultiLineString"));
        assert_eq!(geo_explode_multipart(merged_lines).unwrap().len(), 2);

        assert!(
            geo_merge_to_multipart(vec![
                r#"{"type":"Point","coordinates":[16.37,48.20]}"#.to_owned(),
                r#"{"type":"LineString","coordinates":[[16.36,48.20],[16.37,48.20]]}"#.to_owned(),
            ])
            .is_err()
        );
    }

    #[test]
    fn splits_line_by_line_via_ffi() {
        let line = vec![
            LonLatPoint { lon: 16.35, lat: 48.20 },
            LonLatPoint { lon: 16.39, lat: 48.20 },
        ];
        let splitter = vec![
            LonLatPoint { lon: 16.36, lat: 48.195 },
            LonLatPoint { lon: 16.36, lat: 48.205 },
            LonLatPoint { lon: 16.38, lat: 48.205 },
            LonLatPoint { lon: 16.38, lat: 48.195 },
        ];
        let parts = geo_split_line_by_line(line.clone(), splitter).unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0].len(), 2);
        assert!((parts[0][1].lon - 16.36).abs() < 1e-6);
        assert!((parts[1][1].lon - 16.38).abs() < 1e-6);

        let non_intersecting = vec![
            LonLatPoint { lon: 16.35, lat: 48.22 },
            LonLatPoint { lon: 16.39, lat: 48.22 },
        ];
        assert!(geo_split_line_by_line(line, non_intersecting).is_err());
    }
}

fn parse_coord_pair(val: &serde_json::Value) -> Result<Coord<f64>, String> {
    let arr = val
        .as_array()
        .ok_or_else(|| "coordinate must be [lon, lat]".to_owned())?;
    if arr.len() < 2 {
        return Err("coordinate must have [lon, lat]".to_owned());
    }
    let lon = arr[0]
        .as_f64()
        .ok_or_else(|| "coordinate lon must be numeric".to_owned())?;
    let lat = arr[1]
        .as_f64()
        .ok_or_else(|| "coordinate lat must be numeric".to_owned())?;
    Ok(Coord { x: lon, y: lat })
}

fn parse_ring_coords(val: &serde_json::Value) -> Result<LineString<f64>, String> {
    let arr = val
        .as_array()
        .ok_or_else(|| "coordinate list must be an array".to_owned())?;
    let mut coords = Vec::with_capacity(arr.len());
    for item in arr {
        coords.push(parse_coord_pair(item)?);
    }
    Ok(LineString::new(coords))
}

fn parse_polygon_rings(val: &serde_json::Value) -> Result<Polygon<f64>, String> {
    let rings = val
        .as_array()
        .ok_or_else(|| "polygon coordinates must be array of rings".to_owned())?;
    let first = rings
        .first()
        .ok_or_else(|| "polygon must have an exterior ring".to_owned())?;
    let exterior = parse_ring_coords(first)?;
    let mut interiors = Vec::new();
    for ring in rings.iter().skip(1) {
        interiors.push(parse_ring_coords(ring)?);
    }
    Ok(Polygon::new(exterior, interiors))
}

fn json_to_geo_geometry(val: &serde_json::Value) -> Result<Geometry<f64>, String> {
    let geom_obj = if val.get("type").and_then(|v| v.as_str()) == Some("Feature") {
        val.get("geometry")
            .ok_or_else(|| "Feature missing geometry".to_owned())?
    } else {
        val
    };
    let gtype = geom_obj
        .get("type")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "geometry missing type".to_owned())?;
    let coords = geom_obj
        .get("coordinates")
        .ok_or_else(|| "geometry missing coordinates".to_owned())?;
    match gtype {
        "Point" => Ok(Geometry::Point(Point::from(parse_coord_pair(coords)?))),
        "MultiPoint" => {
            let arr = coords
                .as_array()
                .ok_or_else(|| "MultiPoint coordinates must be array".to_owned())?;
            let mut pts = Vec::with_capacity(arr.len());
            for item in arr {
                pts.push(Point::from(parse_coord_pair(item)?));
            }
            Ok(Geometry::MultiPoint(MultiPoint::new(pts)))
        }
        "LineString" => Ok(Geometry::LineString(parse_ring_coords(coords)?)),
        "MultiLineString" => {
            let arr = coords
                .as_array()
                .ok_or_else(|| "MultiLineString coordinates must be array".to_owned())?;
            let mut lines = Vec::with_capacity(arr.len());
            for item in arr {
                lines.push(parse_ring_coords(item)?);
            }
            Ok(Geometry::MultiLineString(MultiLineString::new(lines)))
        }
        "Polygon" => Ok(Geometry::Polygon(parse_polygon_rings(coords)?)),
        "MultiPolygon" => {
            let arr = coords
                .as_array()
                .ok_or_else(|| "MultiPolygon coordinates must be array".to_owned())?;
            let mut polys = Vec::with_capacity(arr.len());
            for item in arr {
                polys.push(parse_polygon_rings(item)?);
            }
            Ok(Geometry::MultiPolygon(MultiPolygon::new(polys)))
        }
        other => Err(format!("unsupported geometry type \"{other}\"")),
    }
}

fn geo_geometry_to_json(geom: &Geometry<f64>) -> Result<serde_json::Value, String> {
    let ring_json = |ls: &LineString<f64>| -> Vec<serde_json::Value> {
        ls.0.iter().map(|c| serde_json::json!([c.x, c.y])).collect()
    };
    let poly_json = |p: &Polygon<f64>| -> Vec<Vec<serde_json::Value>> {
        let mut rings = vec![ring_json(p.exterior())];
        for inner in p.interiors() {
            rings.push(ring_json(inner));
        }
        rings
    };
    match geom {
        Geometry::Point(p) => Ok(serde_json::json!({ "type": "Point", "coordinates": [p.x(), p.y()] })),
        Geometry::MultiPoint(mp) => Ok(serde_json::json!({
            "type": "MultiPoint",
            "coordinates": mp.0.iter().map(|p| serde_json::json!([p.x(), p.y()])).collect::<Vec<_>>()
        })),
        Geometry::LineString(l) => Ok(serde_json::json!({
            "type": "LineString",
            "coordinates": ring_json(l)
        })),
        Geometry::MultiLineString(ml) => Ok(serde_json::json!({
            "type": "MultiLineString",
            "coordinates": ml.0.iter().map(&ring_json).collect::<Vec<_>>()
        })),
        Geometry::Polygon(p) => Ok(serde_json::json!({
            "type": "Polygon",
            "coordinates": poly_json(p)
        })),
        Geometry::MultiPolygon(mp) => Ok(serde_json::json!({
            "type": "MultiPolygon",
            "coordinates": mp.0.iter().map(&poly_json).collect::<Vec<_>>()
        })),
        _ => Err("unsupported output geometry for JSON conversion".to_owned()),
    }
}

/// Merges 2+ homogeneous GeoJSON geometries into a single multipart GeoJSON geometry.
pub fn geo_merge_to_multipart(geojson_geometries: Vec<String>) -> Result<String, String> {
    let mut parsed = Vec::with_capacity(geojson_geometries.len());
    for raw in &geojson_geometries {
        let val: serde_json::Value =
            serde_json::from_str(raw).map_err(|e| format!("invalid GeoJSON geometry: {e}"))?;
        parsed.push(json_to_geo_geometry(&val)?);
    }
    let merged = merge_to_multipart(&parsed).map_err(|e| e.to_string())?;
    let out_json = geo_geometry_to_json(&merged)?;
    serde_json::to_string(&out_json).map_err(|e| e.to_string())
}

/// Explodes a multipart GeoJSON geometry into individual single-part GeoJSON geometry strings.
pub fn geo_explode_multipart(geojson_geometry: String) -> Result<Vec<String>, String> {
    let val: serde_json::Value =
        serde_json::from_str(&geojson_geometry).map_err(|e| format!("invalid GeoJSON geometry: {e}"))?;
    let parsed = json_to_geo_geometry(&val)?;
    let parts = explode_multipart(&parsed).map_err(|e| e.to_string())?;
    parts
        .iter()
        .map(|g| geo_geometry_to_json(g).and_then(|v| serde_json::to_string(&v).map_err(|e| e.to_string())))
        .collect()
}

/// Dissolves overlapping/touching line segments into connected polylines.
pub fn geo_dissolve_lines(
    lines: Vec<Vec<LonLatPoint>>,
    tolerance_meters: f64,
) -> Result<Vec<Vec<LonLatPoint>>, String> {
    let parsed: Vec<LineString<f64>> = lines.iter().map(|l| to_line(l)).collect();
    let dissolved = dissolve_lines(&parsed, tolerance_meters).map_err(|e| e.to_string())?;
    Ok(dissolved.into_iter().map(|l| from_coords(&l.0)).collect())
}

/// Parses a binary `.zip` ESRI Shapefile bundle or raw `.shp` file into validated GeoJSON.
pub fn geo_import_shapefile_bytes(
    filename: Option<String>,
    bytes: Vec<u8>,
) -> Result<SpatialImportDto, String> {
    let imported = parse_shapefile_bytes(filename.as_deref(), &bytes).map_err(|e| e.to_string())?;
    let geojson = serde_json::to_string(&imported.geojson).map_err(|e| e.to_string())?;
    Ok(SpatialImportDto {
        format: imported.format,
        title: imported.title,
        geojson,
        feature_count: imported.feature_count as u32,
        warnings: imported.warnings,
    })
}

/// Exports an Earthly GeoJSON FeatureCollection into a downloadable `.zip` ESRI Shapefile bundle.
pub fn geo_export_shapefile_zip(
    geojson: String,
    title: Option<String>,
) -> Result<Vec<u8>, String> {
    let fc: serde_json::Value =
        serde_json::from_str(&geojson).map_err(|e| format!("invalid GeoJSON: {e}"))?;
    export_geojson_to_shapefile_zip(&fc, title.as_deref()).map_err(|e| e.to_string())
}
