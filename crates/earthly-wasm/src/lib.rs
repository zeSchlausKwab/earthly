//! Thin `wasm-bindgen` facade so Earthly's Web app (`earthly.city`) can share
//! the exact same Rust validation, domain parsing, PMTiles header parsing, and
//! geometry kernel (`earthly-geo`) as the native Flutter app.

use earthly_agent::{
    AgentTurnInput, earthly_system_prompt, earthly_tool_definitions, execute_local_offline_turn,
};
use earthly_domain::{
    AtlasGroup, LiveBeacon, MapDataset, RawNostrEvent, StoryArticle, TemporalSighting,
    diff_feature_collections, encode_geohash,
};
use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, create_line_corridor, extrude_line,
    geodesic_area_m2, geodesic_length_m, geojson_to_gpx, geojson_to_kml,
    import_spatial_text_to_geojson, simplify_line, validate_feature_collection,
};
use earthly_spatial::PmtilesHeader;
use geo::{Coord, LineString, Polygon};
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
