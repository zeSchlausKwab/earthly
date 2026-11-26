//! Thin `wasm-bindgen` facade so Earthly's Web app (`earthly.city`) can share
//! the exact same Rust validation, domain parsing, PMTiles header parsing, and
//! geometry kernel (`earthly-geo`) as the native Flutter app.

use earthly_agent::{
    AgentTurnInput, detect_vision_name_heuristic, earthly_system_prompt,
    earthly_tool_definitions, execute_local_offline_turn,
};
use earthly_domain::{
    AtlasGroup, LiveBeacon, MapDataset, RawNostrEvent, StoryArticle, TemporalSighting,
    diff_feature_collections, encode_geohash,
};
use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, create_line_corridor, dissolve_lines,
    explode_multipart, export_geojson_to_shapefile_zip, extrude_line, geodesic_area_m2,
    geodesic_length_m, geojson_to_gpx, geojson_to_kml, import_spatial_text_to_geojson,
    merge_to_multipart, parse_csv_to_geojson, parse_shapefile_bytes, simplify_line,
    validate_feature_collection,
};
use earthly_spatial::PmtilesHeader;
use geo::{
    Coord, Geometry, GeometryCollection, LineString, MultiLineString, MultiPoint, MultiPolygon,
    Point, Polygon,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn validate_geojson_json(feature_collection_json: &str) -> Result<String, JsValue> {
    let value: serde_json::Value = serde_json::from_str(feature_collection_json)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let summary =
        validate_feature_collection(&value).map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&summary).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn parse_pmtiles_header_json(bytes: &[u8]) -> Result<String, JsValue> {
    let header = PmtilesHeader::parse(bytes).map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&header).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn parse_earthly_entity_json(raw_event_json: &str) -> Result<String, JsValue> {
    let event: RawNostrEvent = serde_json::from_str(raw_event_json)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let parsed: serde_json::Value = match event.kind {
        earthly_domain::GEO_EVENT_KIND => serde_json::to_value(
            MapDataset::parse(&event).map_err(|err| JsValue::from_str(&err.to_string()))?,
        ),
        earthly_domain::MAP_CONTEXT_KIND => serde_json::to_value(
            AtlasGroup::parse(&event).map_err(|err| JsValue::from_str(&err.to_string()))?,
        ),
        earthly_domain::ARTICLE_KIND => serde_json::to_value(
            StoryArticle::parse(&event).map_err(|err| JsValue::from_str(&err.to_string()))?,
        ),
        earthly_domain::LIVE_BEACON_KIND => serde_json::to_value(
            LiveBeacon::parse(&event).map_err(|err| JsValue::from_str(&err.to_string()))?,
        ),
        earthly_domain::TEMPORAL_SIGHTING_KIND => serde_json::to_value(
            TemporalSighting::parse(&event).map_err(|err| JsValue::from_str(&err.to_string()))?,
        ),
        other => return Err(JsValue::from_str(&format!("unsupported kind {other}"))),
    }
    .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&parsed).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn diff_feature_collections_json(base_json: &str, proposed_json: &str) -> Result<String, JsValue> {
    let base: serde_json::Value =
        serde_json::from_str(base_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let proposed: serde_json::Value =
        serde_json::from_str(proposed_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let summary = diff_feature_collections(&base, &proposed);
    serde_json::to_string(&summary).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn encode_geohash_str(lon: f64, lat: f64, precision: usize) -> Option<String> {
    encode_geohash(lon, lat, precision)
}

#[wasm_bindgen]
pub fn simplify_line_json(coords_json: &str, tolerance_meters: f64) -> Result<String, JsValue> {
    let coords: Vec<[f64; 2]> =
        serde_json::from_str(coords_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let line = LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect());
    let out = simplify_line(&line, tolerance_meters)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let out_coords: Vec<[f64; 2]> = out.0.into_iter().map(|c| [c.x, c.y]).collect();
    serde_json::to_string(&out_coords).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn create_corridor_ring_json(
    coords_json: &str,
    total_width_meters: f64,
) -> Result<String, JsValue> {
    let coords: Vec<[f64; 2]> =
        serde_json::from_str(coords_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let line = LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect());
    let poly = create_line_corridor(&line, total_width_meters)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ring: Vec<[f64; 2]> = poly.exterior().0.iter().map(|c| [c.x, c.y]).collect();
    serde_json::to_string(&ring).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn extrude_arrow_ring_json(
    coords_json: &str,
    start_width_meters: f64,
    end_width_meters: f64,
) -> Result<String, JsValue> {
    let coords: Vec<[f64; 2]> =
        serde_json::from_str(coords_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let line = LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect());
    let poly = extrude_line(
        &line,
        ExtrudeOptions {
            shape: ExtrudeShape::Arrow,
            start_width_meters,
            end_width_meters: Some(end_width_meters),
            side: ExtrudeSide::Center,
            arrow_head_length_meters: None,
            arrow_head_width_meters: None,
        },
    )
    .map_err(|err| JsValue::from_str(&err.to_string()))?;
    let ring: Vec<[f64; 2]> = poly.exterior().0.iter().map(|c| [c.x, c.y]).collect();
    serde_json::to_string(&ring).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn measure_line_meters(coords_json: &str) -> Result<f64, JsValue> {
    let coords: Vec<[f64; 2]> =
        serde_json::from_str(coords_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let line = LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect());
    Ok(geodesic_length_m(&line))
}

#[wasm_bindgen]
pub fn measure_polygon_area_square_meters(ring_json: &str) -> Result<f64, JsValue> {
    let coords: Vec<[f64; 2]> =
        serde_json::from_str(ring_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let poly = Polygon::new(
        LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect()),
        vec![],
    );
    Ok(geodesic_area_m2(&poly))
}

#[wasm_bindgen]
pub fn earthly_agent_system_prompt() -> String {
    earthly_system_prompt().to_owned()
}

#[wasm_bindgen]
pub fn earthly_agent_tools_json() -> Result<String, JsValue> {
    serde_json::to_string(&earthly_tool_definitions())
        .map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn earthly_agent_offline_turn_json(input_json: &str) -> Result<String, JsValue> {
    let input: AgentTurnInput =
        serde_json::from_str(input_json).map_err(|err| JsValue::from_str(&err.to_string()))?;
    let output = execute_local_offline_turn(&input);
    serde_json::to_string(&output).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn import_spatial_text_json(filename: Option<String>, content: &str) -> Result<String, JsValue> {
    let imported = import_spatial_text_to_geojson(filename.as_deref(), content)
        .map_err(|err| JsValue::from_str(&err.to_string()))?;
    serde_json::to_string(&imported).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn export_gpx_from_geojson(geojson: &str, title: Option<String>) -> Result<String, JsValue> {
    let fc: serde_json::Value =
        serde_json::from_str(geojson).map_err(|err| JsValue::from_str(&err.to_string()))?;
    geojson_to_gpx(&fc, title.as_deref()).map_err(|err| JsValue::from_str(&err.to_string()))
}

#[wasm_bindgen]
pub fn export_kml_from_geojson(geojson: &str, title: Option<String>) -> Result<String, JsValue> {
    let fc: serde_json::Value =
        serde_json::from_str(geojson).map_err(|err| JsValue::from_str(&err.to_string()))?;
    geojson_to_kml(&fc, title.as_deref()).map_err(|err| JsValue::from_str(&err.to_string()))
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
    if !lon.is_finite() || !lat.is_finite() {
        return Err("coordinate values must be finite".to_owned());
    }
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
    let mut interiors = Vec::with_capacity(rings.len().saturating_sub(1));
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
    if gtype == "GeometryCollection" {
        let arr = geom_obj
            .get("geometries")
            .and_then(|v| v.as_array())
            .ok_or_else(|| "GeometryCollection missing geometries array".to_owned())?;
        let mut items = Vec::with_capacity(arr.len());
        for item in arr {
            items.push(json_to_geo_geometry(item)?);
        }
        return Ok(Geometry::GeometryCollection(GeometryCollection::new_from(
            items,
        )));
    }
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
        Geometry::Point(p) => {
            Ok(serde_json::json!({ "type": "Point", "coordinates": [p.x(), p.y()] }))
        }
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
            "coordinates": ml.0.iter().map(ring_json).collect::<Vec<_>>()
        })),
        Geometry::Polygon(p) => Ok(serde_json::json!({
            "type": "Polygon",
            "coordinates": poly_json(p)
        })),
        Geometry::MultiPolygon(mp) => Ok(serde_json::json!({
            "type": "MultiPolygon",
            "coordinates": mp.0.iter().map(poly_json).collect::<Vec<_>>()
        })),
        Geometry::GeometryCollection(gc) => {
            let items = gc
                .0
                .iter()
                .map(geo_geometry_to_json)
                .collect::<Result<Vec<_>, _>>()?;
            Ok(serde_json::json!({
                "type": "GeometryCollection",
                "geometries": items
            }))
        }
        _ => Err("unsupported output geometry for JSON conversion".to_owned()),
    }
}

pub(crate) fn dissolve_lines_json_inner(
    lines_json: &str,
    tolerance_meters: f64,
) -> Result<String, String> {
    let raw_lines: Vec<Vec<[f64; 2]>> =
        serde_json::from_str(lines_json).map_err(|err| err.to_string())?;
    let lines: Vec<LineString<f64>> = raw_lines
        .into_iter()
        .map(|coords| LineString::new(coords.into_iter().map(|[x, y]| Coord { x, y }).collect()))
        .collect();
    let dissolved = dissolve_lines(&lines, tolerance_meters).map_err(|err| err.to_string())?;
    let out: Vec<Vec<[f64; 2]>> = dissolved
        .into_iter()
        .map(|line| line.0.into_iter().map(|c| [c.x, c.y]).collect())
        .collect();
    serde_json::to_string(&out).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn dissolve_lines_json(lines_json: &str, tolerance_meters: f64) -> Result<String, JsValue> {
    dissolve_lines_json_inner(lines_json, tolerance_meters).map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn merge_to_multipart_json_inner(geometries_json: &str) -> Result<String, String> {
    let root: serde_json::Value =
        serde_json::from_str(geometries_json).map_err(|err| err.to_string())?;
    let raw_items: Vec<serde_json::Value> = if let Some(arr) = root.as_array() {
        arr.clone()
    } else if root.get("type").and_then(|v| v.as_str()) == Some("FeatureCollection") {
        root.get("features")
            .and_then(|v| v.as_array())
            .cloned()
            .ok_or_else(|| "FeatureCollection missing features array".to_owned())?
    } else if root.get("type").and_then(|v| v.as_str()) == Some("GeometryCollection") {
        root.get("geometries")
            .and_then(|v| v.as_array())
            .cloned()
            .ok_or_else(|| "GeometryCollection missing geometries array".to_owned())?
    } else {
        return Err("expected a JSON array of GeoJSON geometries or features".to_owned());
    };
    let parsed: Vec<Geometry<f64>> = raw_items
        .iter()
        .map(json_to_geo_geometry)
        .collect::<Result<Vec<_>, _>>()?;
    let merged = merge_to_multipart(&parsed).map_err(|err| err.to_string())?;
    let out_json = geo_geometry_to_json(&merged)?;
    serde_json::to_string(&out_json).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn merge_to_multipart_json(geometries_json: &str) -> Result<String, JsValue> {
    merge_to_multipart_json_inner(geometries_json).map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn explode_multipart_json_inner(geometry_json: &str) -> Result<String, String> {
    let val: serde_json::Value =
        serde_json::from_str(geometry_json).map_err(|err| err.to_string())?;
    let parsed = json_to_geo_geometry(&val)?;
    let parts = explode_multipart(&parsed).map_err(|err| err.to_string())?;
    let out: Vec<serde_json::Value> = parts
        .iter()
        .map(geo_geometry_to_json)
        .collect::<Result<Vec<_>, _>>()?;
    serde_json::to_string(&out).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn explode_multipart_json(geometry_json: &str) -> Result<String, JsValue> {
    explode_multipart_json_inner(geometry_json).map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn parse_csv_to_geojson_json_inner(
    filename: Option<&str>,
    content: &str,
) -> Result<String, String> {
    let imported = parse_csv_to_geojson(filename, content).map_err(|err| err.to_string())?;
    serde_json::to_string(&imported).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn parse_csv_to_geojson_json(
    filename: Option<String>,
    content: &str,
) -> Result<String, JsValue> {
    parse_csv_to_geojson_json_inner(filename.as_deref(), content)
        .map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn export_shapefile_zip_bytes_inner(
    geojson: &str,
    title: Option<&str>,
) -> Result<Vec<u8>, String> {
    let fc: serde_json::Value = serde_json::from_str(geojson).map_err(|err| err.to_string())?;
    export_geojson_to_shapefile_zip(&fc, title).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn export_shapefile_zip_bytes(
    geojson: &str,
    title: Option<String>,
) -> Result<Vec<u8>, JsValue> {
    export_shapefile_zip_bytes_inner(geojson, title.as_deref())
        .map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn parse_shapefile_zip_bytes_inner(
    filename: Option<&str>,
    bytes: &[u8],
) -> Result<String, String> {
    let imported = parse_shapefile_bytes(filename, bytes).map_err(|err| err.to_string())?;
    serde_json::to_string(&imported).map_err(|err| err.to_string())
}

#[wasm_bindgen]
pub fn parse_shapefile_zip_bytes(
    filename: Option<String>,
    bytes: &[u8],
) -> Result<String, JsValue> {
    parse_shapefile_zip_bytes_inner(filename.as_deref(), bytes)
        .map_err(|err| JsValue::from_str(&err))
}

pub(crate) fn detect_vision_support_heuristic_inner(model: &str) -> String {
    detect_vision_name_heuristic(model).as_str().to_owned()
}

#[wasm_bindgen]
pub fn detect_vision_support_heuristic(model: &str) -> String {
    detect_vision_support_heuristic_inner(model)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dissolves_lines_and_merges_explodes_multipart() {
        let lines = serde_json::json!([
            [[16.36, 48.20], [16.37, 48.20]],
            [[16.36, 48.20], [16.37, 48.20]],
            [[16.37, 48.20], [16.38, 48.21]]
        ]);
        let dissolved_json = dissolve_lines_json_inner(&lines.to_string(), 5.0).unwrap();
        let dissolved: Vec<Vec<[f64; 2]>> = serde_json::from_str(&dissolved_json).unwrap();
        assert_eq!(dissolved.len(), 1);
        assert_eq!(dissolved[0].len(), 3);

        let points = serde_json::json!([
            {"type": "Point", "coordinates": [16.37, 48.20]},
            {"type": "Point", "coordinates": [16.38, 48.21]}
        ]);
        let merged_json = merge_to_multipart_json_inner(&points.to_string()).unwrap();
        let merged: serde_json::Value = serde_json::from_str(&merged_json).unwrap();
        assert_eq!(merged["type"], "MultiPoint");

        let exploded_json = explode_multipart_json_inner(&merged_json).unwrap();
        let exploded: Vec<serde_json::Value> = serde_json::from_str(&exploded_json).unwrap();
        assert_eq!(exploded.len(), 2);
        assert_eq!(exploded[0]["type"], "Point");

        let mixed = serde_json::json!([
            {"type": "Point", "coordinates": [16.37, 48.20]},
            {"type": "LineString", "coordinates": [[16.36, 48.20], [16.37, 48.20]]}
        ]);
        assert!(merge_to_multipart_json_inner(&mixed.to_string()).is_err());
        assert!(explode_multipart_json_inner(&points[0].to_string()).is_err());
    }

    #[test]
    fn parses_csv_and_roundtrips_shapefile_zip() {
        let csv = "name,lat,lon,note\nStephansdom,48.2082,16.3738,Cathedral\nPrater,48.2166,16.3958,Park\n";
        let imported_json = parse_csv_to_geojson_json_inner(Some("vienna.csv"), csv).unwrap();
        let imported: serde_json::Value = serde_json::from_str(&imported_json).unwrap();
        assert_eq!(imported["format"], "csv");
        assert_eq!(imported["featureCount"], 2);

        let fc = imported["geojson"].to_string();
        let zip_bytes = export_shapefile_zip_bytes_inner(&fc, Some("Vienna CSV")).unwrap();
        assert!(zip_bytes.starts_with(b"PK\x03\x04"));

        let reimported_json =
            parse_shapefile_zip_bytes_inner(Some("vienna_csv.zip"), &zip_bytes).unwrap();
        let reimported: serde_json::Value = serde_json::from_str(&reimported_json).unwrap();
        assert_eq!(reimported["format"], "shp");
        assert_eq!(reimported["featureCount"], 2);

        assert!(parse_shapefile_zip_bytes_inner(Some("empty.zip"), b"").is_err());
        assert!(parse_csv_to_geojson_json_inner(Some("bad.csv"), "only_one_col\n1\n").is_err());
    }

    #[test]
    fn detects_vision_support_with_token_boundaries() {
        assert_eq!(detect_vision_support_heuristic_inner("gpt-4o"), "uncertain");
        assert_eq!(
            detect_vision_support_heuristic_inner("qwen2.5-vl-7b"),
            "uncertain"
        );
        assert_eq!(detect_vision_support_heuristic_inner("marvel-7b"), "no-vision");
        assert_eq!(detect_vision_support_heuristic_inner("vllm-llama3"), "no-vision");
        assert_eq!(detect_vision_support_heuristic_inner(""), "no-vision");
    }
}
