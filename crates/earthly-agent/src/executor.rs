//! Pure-Rust deterministic spatial tool executor over `earthly-geo` and
//! `earthly-spatial` (compiles cleanly to both native targets and `wasm32`).

use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, create_line_corridor, extrude_line,
    geodesic_area_m2, geodesic_length_m, offset_line, offset_polygon, union_polygons,
    validate_feature_collection,
};
use earthly_spatial::CoverageStatus;
use geo::{Coord, LineString, Polygon};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::schema::AgentChatMessage;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentCameraAction {
    pub lon: f64,
    pub lat: f64,
    pub zoom: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutedToolRecord {
    pub name: String,
    pub ok: bool,
    pub summary: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceContext {
    pub center_lon: f64,
    pub center_lat: f64,
    pub zoom: f64,
    pub draft_title: String,
    /// RFC 7946 FeatureCollection JSON representing the user's current working draft.
    pub draft_geojson: String,
    pub shelf_map_titles: Vec<String>,
    #[serde(default)]
    pub atlas_workspaces: Vec<String>,
    #[serde(default)]
    pub working_set_titles: Vec<String>,
    #[serde(default)]
    pub catalog_items: Vec<String>,
    #[serde(default)]
    pub map_snapshot_base64: Option<String>,
    #[serde(default)]
    pub allow_vision: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnInput {
    pub prompt: String,
    #[serde(default)]
    pub history: Vec<AgentChatMessage>,
    pub workspace: AgentWorkspaceContext,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentTurnOutput {
    pub reply: String,
    pub updated_draft_geojson: Option<String>,
    pub camera_action: Option<AgentCameraAction>,
    pub tool_calls: Vec<ExecutedToolRecord>,
    pub used_offline_mode: bool,
    #[serde(default)]
    pub prompt_tokens: Option<u32>,
    #[serde(default)]
    pub completion_tokens: Option<u32>,
    #[serde(default)]
    pub total_tokens: Option<u32>,
}

pub struct MutableDraftState {
    pub fc: Value,
    pub modified: bool,
    pub camera_action: Option<AgentCameraAction>,
    pub counter: usize,
}

impl MutableDraftState {
    pub fn from_geojson(raw: &str, title: &str) -> Self {
        let mut fc: Value = serde_json::from_str(raw).unwrap_or_else(|_| {
            json!({
                "type": "FeatureCollection",
                "name": title,
                "features": []
            })
        });
        if fc.get("features").and_then(Value::as_array).is_none() {
            fc = json!({
                "type": "FeatureCollection",
                "name": title,
                "features": []
            });
        }
        let count = fc
            .get("features")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        Self {
            fc,
            modified: false,
            camera_action: None,
            counter: count,
        }
    }

    fn next_id(&mut self, prefix: &str) -> String {
        self.counter += 1;
        format!("{prefix}-{}", self.counter)
    }

    fn features(&self) -> &[Value] {
        self.fc
            .get("features")
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }

    fn features_mut(&mut self) -> &mut Vec<Value> {
        self.fc
            .as_object_mut()
            .expect("FeatureCollection is an object")
            .entry("features")
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .expect("features is an array")
    }

    pub fn append_geojson_features(&mut self, fc: &Value) -> usize {
        let Some(arr) = fc.get("features").and_then(Value::as_array) else {
            return 0;
        };
        let mut added = 0usize;
        for f in arr {
            let mut feat = f.clone();
            if feat.get("id").is_none() {
                let id = self.next_id("ai-feat");
                if let Some(obj) = feat.as_object_mut() {
                    obj.insert("id".to_owned(), json!(id));
                }
            }
            self.features_mut().push(feat);
            added += 1;
        }
        if added > 0 {
            self.modified = true;
        }
        added
    }
}

/// Executes a single named Earthly agent tool against the mutable draft state.
pub fn execute_tool_call(
    name: &str,
    args: &Value,
    workspace: &AgentWorkspaceContext,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    match name {
        "inspect_workspace" => {
            let summary = validate_feature_collection(&state.fc).ok();
            let result = json!({
                "center": [workspace.center_lon, workspace.center_lat],
                "zoom": workspace.zoom,
                "draftTitle": workspace.draft_title,
                "draftFeatureCount": state.features().len(),
                "bounds": summary.and_then(|s| s.bounds),
                "shelfMaps": workspace.shelf_map_titles,
                "features": state.features().iter().map(|f| json!({
                    "id": f.get("id"),
                    "geometryType": f.get("geometry").and_then(|g| g.get("type")),
                    "name": f.get("properties").and_then(|p| p.get("name")),
                })).collect::<Vec<_>>()
            });
            let rec = ExecutedToolRecord {
                name: name.to_owned(),
                ok: true,
                summary: format!(
                    "{} draft features, {} shelf maps",
                    state.features().len(),
                    workspace.shelf_map_titles.len()
                ),
            };
            (rec, result)
        }

        "create_point" => {
            let lon = args.get("lon").and_then(Value::as_f64);
            let lat = args.get("lat").and_then(Value::as_f64);
            let label = args
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Agent Point");
            let (Some(lon), Some(lat)) = (lon, lat) else {
                return err_tool(name, "lon and lat are required numbers");
            };
            let id = state.next_id("ai-pt");
            let mut props = serde_json::Map::new();
            props.insert("name".to_owned(), json!(label));
            if let Some(color) = args.get("color").and_then(Value::as_str) {
                props.insert("color".to_owned(), json!(color));
            }
            if let Some(callout_text) = args.get("calloutText").and_then(Value::as_str) {
                let mut callout = serde_json::Map::new();
                callout.insert("id".to_owned(), json!(format!("c-{id}")));
                if let Some(ct) = args.get("calloutTitle").and_then(Value::as_str) {
                    callout.insert("title".to_owned(), json!(ct));
                }
                callout.insert("text".to_owned(), json!(callout_text));
                callout.insert(
                    "placement".to_owned(),
                    json!({"side": "right", "leader": "line"}),
                );
                props.insert("earthly:callouts".to_owned(), json!([callout]));
            }
            state.features_mut().push(json!({
                "type": "Feature",
                "id": id,
                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                "properties": props
            }));
            state.modified = true;
            state.camera_action = Some(AgentCameraAction {
                lon,
                lat,
                zoom: workspace.zoom.max(14.5),
            });
            ok_tool(
                name,
                format!("Created point \"{label}\" ({lat:.5}, {lon:.5})"),
                json!({ "id": id, "name": label, "lon": lon, "lat": lat }),
            )
        }

        "create_line" => {
            let coords = parse_coords_array(args.get("coordinates"));
            if coords.len() < 2 {
                return err_tool(name, "create_line requires at least 2 [lon, lat] coordinates");
            }
            let label = args
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Agent Line");
            let id = state.next_id("ai-line");
            let mut props = serde_json::Map::new();
            props.insert("name".to_owned(), json!(label));
            if let Some(color) = args.get("color").and_then(Value::as_str) {
                props.insert("color".to_owned(), json!(color));
            }
            let len_m = geodesic_length_m(&to_line(&coords));
            state.features_mut().push(json!({
                "type": "Feature",
                "id": id,
                "geometry": { "type": "LineString", "coordinates": coords },
                "properties": props
            }));
            state.modified = true;
            ok_tool(
                name,
                format!("Created line \"{label}\" ({len_m:.0} m)"),
                json!({ "id": id, "lengthMeters": len_m }),
            )
        }

        "create_polygon" => {
            let mut coords = parse_coords_array(args.get("coordinates"));
            if coords.len() < 3 {
                return err_tool(name, "create_polygon requires at least 3 [lon, lat] coordinates");
            }
            if coords.first() != coords.last() {
                coords.push(coords[0]);
            }
            let label = args
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("Agent Area");
            let id = state.next_id("ai-poly");
            let mut props = serde_json::Map::new();
            props.insert("name".to_owned(), json!(label));
            if let Some(color) = args.get("color").and_then(Value::as_str) {
                props.insert("color".to_owned(), json!(color));
            }
            let area = geodesic_area_m2(&to_poly(&coords));
            state.features_mut().push(json!({
                "type": "Feature",
                "id": id,
                "geometry": { "type": "Polygon", "coordinates": [coords] },
                "properties": props
            }));
            state.modified = true;
            ok_tool(
                name,
                format!("Created polygon \"{label}\" ({:.2} ha)", area / 10_000.0),
                json!({ "id": id, "areaSquareMeters": area }),
            )
        }

        "create_corridor" => {
            let width = args
                .get("totalWidthMeters")
                .and_then(Value::as_f64)
                .unwrap_or(120.0);
            let target_id = args.get("featureId").and_then(Value::as_str);
            let Some(line) = find_line_coords(state.features(), target_id) else {
                return err_tool(name, "No LineString found in the working draft");
            };
            match create_line_corridor(&to_line(&line), width) {
                Ok(poly) => {
                    let ring = poly_to_ring(&poly);
                    let id = state.next_id("ai-corridor");
                    let label = args
                        .get("name")
                        .and_then(Value::as_str)
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("Corridor ({width:.0}m)"));
                    let mut props = serde_json::Map::new();
                    props.insert("name".to_owned(), json!(label));
                    if let Some(color) = args.get("color").and_then(Value::as_str) {
                        props.insert("color".to_owned(), json!(color));
                    }
                    let area = geodesic_area_m2(&poly);
                    state.features_mut().push(json!({
                        "type": "Feature",
                        "id": id,
                        "geometry": { "type": "Polygon", "coordinates": [ring] },
                        "properties": props
                    }));
                    state.modified = true;
                    ok_tool(
                        name,
                        format!("Built {width:.0}m corridor ({:.2} ha)", area / 10_000.0),
                        json!({ "id": id, "areaSquareMeters": area }),
                    )
                }
                Err(err) => err_tool(name, &err.to_string()),
            }
        }

        "create_flow_arrow" => {
            let start_w = args
                .get("startWidthMeters")
                .and_then(Value::as_f64)
                .unwrap_or(60.0);
            let end_w = args
                .get("endWidthMeters")
                .and_then(Value::as_f64)
                .unwrap_or(120.0);
            let target_id = args.get("featureId").and_then(Value::as_str);
            let Some(line) = find_line_coords(state.features(), target_id) else {
                return err_tool(name, "No LineString found in the working draft");
            };
            let opts = ExtrudeOptions {
                shape: ExtrudeShape::Arrow,
                start_width_meters: start_w,
                end_width_meters: Some(end_w),
                side: ExtrudeSide::Center,
                arrow_head_length_meters: None,
                arrow_head_width_meters: None,
            };
            match extrude_line(&to_line(&line), opts) {
                Ok(poly) => {
                    let ring = poly_to_ring(&poly);
                    let id = state.next_id("ai-arrow");
                    let label = args
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Flow Arrow");
                    let mut props = serde_json::Map::new();
                    props.insert("name".to_owned(), json!(label));
                    if let Some(color) = args.get("color").and_then(Value::as_str) {
                        props.insert("color".to_owned(), json!(color));
                    }
                    state.features_mut().push(json!({
                        "type": "Feature",
                        "id": id,
                        "geometry": { "type": "Polygon", "coordinates": [ring] },
                        "properties": props
                    }));
                    state.modified = true;
                    ok_tool(
                        name,
                        format!("Extruded flow arrow ({start_w:.0}m -> {end_w:.0}m)"),
                        json!({ "id": id }),
                    )
                }
                Err(err) => err_tool(name, &err.to_string()),
            }
        }

        "offset_geometry" => {
            let dist = args
                .get("distanceMeters")
                .and_then(Value::as_f64)
                .unwrap_or(80.0);
            let target_id = args.get("featureId").and_then(Value::as_str);
            if let Some(ring) = find_polygon_coords(state.features(), target_id) {
                match offset_polygon(&to_poly(&ring), dist) {
                    Ok(poly) => {
                        let out = poly_to_ring(&poly);
                        let id = state.next_id("ai-offset-poly");
                        let label = args
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                            .unwrap_or_else(|| format!("Offset ({dist:+.0}m)"));
                        state.features_mut().push(json!({
                            "type": "Feature",
                            "id": id,
                            "geometry": { "type": "Polygon", "coordinates": [out] },
                            "properties": { "name": label }
                        }));
                        state.modified = true;
                        return ok_tool(name, format!("Offset polygon by {dist:+.0}m"), json!({ "id": id }));
                    }
                    Err(err) => return err_tool(name, &err.to_string()),
                }
            }
            if let Some(line) = find_line_coords(state.features(), target_id) {
                match offset_line(&to_line(&line), dist) {
                    Ok(out_line) => {
                        let out = line_to_pairs(&out_line);
                        let id = state.next_id("ai-offset-line");
                        let label = args
                            .get("name")
                            .and_then(Value::as_str)
                            .map(str::to_owned)
                            .unwrap_or_else(|| format!("Parallel ({dist:+.0}m)"));
                        state.features_mut().push(json!({
                            "type": "Feature",
                            "id": id,
                            "geometry": { "type": "LineString", "coordinates": out },
                            "properties": { "name": label }
                        }));
                        state.modified = true;
                        return ok_tool(name, format!("Offset line by {dist:+.0}m"), json!({ "id": id }));
                    }
                    Err(err) => return err_tool(name, &err.to_string()),
                }
            }
            err_tool(name, "No line or polygon found in the working draft to offset")
        }

        "union_polygons" => {
            let polys: Vec<Polygon<f64>> = state
                .features()
                .iter()
                .filter_map(|f| {
                    let g = f.get("geometry")?;
                    if g.get("type")?.as_str()? != "Polygon" {
                        return None;
                    }
                    let first_ring = g.get("coordinates")?.as_array()?.first()?;
                    let pts = parse_coords_array(Some(first_ring));
                    (pts.len() >= 3).then(|| to_poly(&pts))
                })
                .collect();
            if polys.len() < 2 {
                return err_tool(name, "Need at least 2 polygons in the working draft to union");
            }
            match union_polygons(&polys) {
                Ok(merged) => {
                    let label = args
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Merged Area");
                    state.features_mut().retain(|f| {
                        f.get("geometry")
                            .and_then(|g| g.get("type"))
                            .and_then(Value::as_str)
                            != Some("Polygon")
                    });
                    for poly in &merged.0 {
                        let ring = poly_to_ring(poly);
                        let id = state.next_id("ai-union");
                        state.features_mut().push(json!({
                            "type": "Feature",
                            "id": id,
                            "geometry": { "type": "Polygon", "coordinates": [ring] },
                            "properties": { "name": label }
                        }));
                    }
                    state.modified = true;
                    ok_tool(
                        name,
                        format!("Merged {} polygons into {}", polys.len(), merged.0.len()),
                        json!({ "mergedCount": merged.0.len() }),
                    )
                }
                Err(err) => err_tool(name, &err.to_string()),
            }
        }

        "measure_draft" => {
            let mut total_line_m = 0.0_f64;
            let mut total_area_m2 = 0.0_f64;
            let mut items = Vec::new();
            for f in state.features() {
                let id = f.get("id").and_then(Value::as_str).unwrap_or("?");
                let label = f
                    .get("properties")
                    .and_then(|p| p.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or(id);
                let g = f.get("geometry");
                let gtype = g.and_then(|v| v.get("type")).and_then(Value::as_str);
                match gtype {
                    Some("LineString") => {
                        let pts = parse_coords_array(g.and_then(|v| v.get("coordinates")));
                        let m = geodesic_length_m(&to_line(&pts));
                        total_line_m += m;
                        items.push(json!({ "id": id, "name": label, "type": "LineString", "lengthMeters": m }));
                    }
                    Some("Polygon") => {
                        let ring = g
                            .and_then(|v| v.get("coordinates"))
                            .and_then(Value::as_array)
                            .and_then(|a| a.first());
                        let pts = parse_coords_array(ring);
                        let a = geodesic_area_m2(&to_poly(&pts));
                        total_area_m2 += a;
                        items.push(json!({ "id": id, "name": label, "type": "Polygon", "areaSquareMeters": a, "hectares": a / 10_000.0 }));
                    }
                    _ => {}
                }
            }
            ok_tool(
                name,
                format!(
                    "Lines: {:.0} m · Areas: {:.2} ha ({} measured)",
                    total_line_m,
                    total_area_m2 / 10_000.0,
                    items.len()
                ),
                json!({
                    "totalLineMeters": total_line_m,
                    "totalAreaSquareMeters": total_area_m2,
                    "totalAreaHectares": total_area_m2 / 10_000.0,
                    "features": items
                }),
            )
        }

        "add_callout" => {
            let Some(text) = args
                .get("text")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                return err_tool(name, "text is required for add_callout");
            };
            let title = args.get("title").and_then(Value::as_str).map(str::trim);
            let side = args.get("side").and_then(Value::as_str).unwrap_or("right");
            let target_id = args.get("featureId").and_then(Value::as_str);
            let callout_id = state.next_id("ai-callout");

            let target = if let Some(fid) = target_id {
                state
                    .features_mut()
                    .iter_mut()
                    .find(|f| f.get("id").and_then(Value::as_str) == Some(fid))
            } else {
                state.features_mut().last_mut()
            };
            let Some(feature) = target else {
                return err_tool(name, "No draft feature available to attach a callout");
            };

            let props = feature
                .as_object_mut()
                .unwrap()
                .entry("properties")
                .or_insert_with(|| json!({}))
                .as_object_mut()
                .unwrap();
            let list = props
                .entry("earthly:callouts")
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .unwrap();
            let mut card = serde_json::Map::new();
            card.insert("id".to_owned(), json!(callout_id));
            if let Some(t) = title.filter(|s| !s.is_empty()) {
                card.insert("title".to_owned(), json!(t));
            }
            card.insert("text".to_owned(), json!(text));
            card.insert("placement".to_owned(), json!({"side": side, "leader": "line"}));
            list.push(Value::Object(card));
            state.modified = true;
            ok_tool(
                name,
                format!("Attached callout \"{}\"", title.unwrap_or(text)),
                json!({ "calloutId": callout_id }),
            )
        }

        "fly_to_location" => {
            let lon = args.get("lon").and_then(Value::as_f64);
            let lat = args.get("lat").and_then(Value::as_f64);
            let zoom = args
                .get("zoom")
                .and_then(Value::as_f64)
                .unwrap_or(14.5)
                .clamp(1.0, 20.0);
            let (Some(lon), Some(lat)) = (lon, lat) else {
                return err_tool(name, "lon and lat are required");
            };
            state.camera_action = Some(AgentCameraAction { lon, lat, zoom });
            ok_tool(
                name,
                format!("Flew camera to {lat:.4}, {lon:.4} (z{zoom:.1})"),
                json!({ "lon": lon, "lat": lat, "zoom": zoom }),
            )
        }

        "atlas_workspace_status" => {
            let coverage = if workspace.atlas_workspaces.is_empty() {
                CoverageStatus::Partial
            } else {
                CoverageStatus::Complete
            };
            ok_tool(
                name,
                format!(
                    "{} Atlas workspace(s) mounted ({coverage:?})",
                    workspace.atlas_workspaces.len()
                ),
                json!({
                    "workspaces": workspace.atlas_workspaces,
                    "coverage": coverage,
                    "note": "Ready to mount local .atlas archives via earthly-spatial"
                }),
            )
        }

        "deduplicate_draft" => {
            let mut seen = std::collections::HashSet::<String>::new();
            let before = state.features().len();
            let mut unique = Vec::with_capacity(before);
            for f in state.features() {
                let g_sig = f
                    .get("geometry")
                    .map(|g| g.to_string())
                    .unwrap_or_default();
                let name_sig = f
                    .get("properties")
                    .and_then(|p| p.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .trim()
                    .to_ascii_lowercase();
                let key = format!("{name_sig}|{g_sig}");
                if seen.insert(key) {
                    unique.push(f.clone());
                }
            }
            let removed = before.saturating_sub(unique.len());
            if removed > 0 {
                *state.features_mut() = unique;
                state.modified = true;
            }
            ok_tool(
                name,
                format!("Removed {removed} duplicate feature(s) ({} kept)", state.features().len()),
                json!({ "removed": removed, "remaining": state.features().len() }),
            )
        }

        "draft_story_outline" => {
            let headline = args
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&workspace.draft_title);
            let feats = state.features();
            let mut md = format!("# {headline}\n\nSummary of {} mapped feature(s):\n\n", feats.len());
            for (idx, f) in feats.iter().take(5).enumerate() {
                let title = f
                    .get("properties")
                    .and_then(|p| p.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or("Field Stop");
                let center = first_feature_coord(f).unwrap_or([workspace.center_lon, workspace.center_lat]);
                let view_json = serde_json::to_string_pretty(&json!({
                    "id": format!("view-{}", idx + 1),
                    "title": title,
                    "display": "both",
                    "center": center,
                    "zoom": workspace.zoom
                }))
                .unwrap_or_default();
                md.push_str(&format!("## {title}\n\n```earthly-view\n{view_json}\n```\n\n"));
            }
            ok_tool(
                name,
                format!("Generated Story outline ({} view block(s))", feats.len().min(5)),
                json!({ "markdown": md, "viewCount": feats.len().min(5) }),
            )
        }

        "query_catalog" => {
            let query = args
                .get("query")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_default();
            let kind_filter = args
                .get("kind")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_else(|| "all".to_owned());
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(15)
                .clamp(1, 40) as usize;

            let matches: Vec<String> = workspace
                .catalog_items
                .iter()
                .filter(|line| {
                    let lower = line.to_lowercase();
                    let kind_ok = match kind_filter.as_str() {
                        "map" => lower.starts_with("[map]"),
                        "story" => lower.starts_with("[story]"),
                        "atlas" => lower.starts_with("[atlas]"),
                        _ => true,
                    };
                    let query_ok = query.is_empty() || lower.contains(&query);
                    kind_ok && query_ok
                })
                .take(limit)
                .cloned()
                .collect();
            ok_tool(
                name,
                format!(
                    "Found {} catalog item(s) (of {})",
                    matches.len(),
                    workspace.catalog_items.len()
                ),
                json!({
                    "matches": matches,
                    "total": matches.len(),
                    "catalogSize": workspace.catalog_items.len(),
                }),
            )
        }

        "draft_atlas_manifest" => {
            let title = args
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(&workspace.draft_title);
            let governance = match args
                .get("governance")
                .and_then(Value::as_str)
                .unwrap_or("moderated")
            {
                "open" => "open",
                "closed" => "closed",
                _ => "moderated",
            };
            let summary = args
                .get("summary")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("Curated field collection authored with Earthly Agent.");
            let filter_q = args
                .get("filterQuery")
                .and_then(Value::as_str)
                .map(|s| s.trim().to_lowercase())
                .unwrap_or_default();

            let mut entries: Vec<String> = workspace.working_set_titles.clone();
            for item in &workspace.catalog_items {
                if !filter_q.is_empty() && !item.to_lowercase().contains(&filter_q) {
                    continue;
                }
                if entries.len() >= 12 {
                    break;
                }
                if !entries.iter().any(|existing| existing == item) {
                    entries.push(item.clone());
                }
            }

            let mut md = format!(
                "# {title}\n\n**Governance:** `{governance}`\n\n{summary}\n\n## Included Sources ({})\n\n",
                entries.len()
            );
            for entry in &entries {
                md.push_str(&format!("- {entry}\n"));
            }
            if entries.is_empty() {
                md.push_str("- _(Pin Shelf maps to your Working Set or publish draft Maps to populate references.)_\n");
            }

            ok_tool(
                name,
                format!("Drafted Atlas manifest \"{title}\" ({} entries, {governance})", entries.len()),
                json!({
                    "title": title,
                    "governance": governance,
                    "markdown": md,
                    "entries": entries,
                }),
            )
        }

        "capture_map_snapshot" => {
            if !workspace.allow_vision {
                let reason = "Vision is disabled or unsupported for the active model.";
                return (
                    ExecutedToolRecord {
                        name: name.to_owned(),
                        ok: false,
                        summary: reason.to_owned(),
                    },
                    json!({
                        "visionAvailable": false,
                        "reason": reason,
                    }),
                );
            }
            let Some(b64) = workspace
                .map_snapshot_base64
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            else {
                let reason = "No map canvas snapshot is available.";
                return (
                    ExecutedToolRecord {
                        name: name.to_owned(),
                        ok: false,
                        summary: reason.to_owned(),
                    },
                    json!({
                        "visionAvailable": false,
                        "reason": reason,
                    }),
                );
            };
            let raw_b64 = b64
                .split_once(";base64,")
                .map(|(_, rhs)| rhs)
                .unwrap_or(b64);
            let padding = raw_b64
                .bytes()
                .rev()
                .take_while(|&b| b == b'=')
                .count()
                .min(2);
            let bytes_approx = ((raw_b64.len() * 3) / 4).saturating_sub(padding);
            let feature_count = state.features().len();
            ok_tool(
                name,
                format!(
                    "Captured map snapshot (~{} B) at zoom {:.1}",
                    bytes_approx, workspace.zoom
                ),
                json!({
                    "visionAvailable": true,
                    "bytesApprox": bytes_approx,
                    "center": [workspace.center_lon, workspace.center_lat],
                    "zoom": workspace.zoom,
                    "draftFeatureCount": feature_count,
                }),
            )
        }

        other => err_tool(other, &format!("Unknown tool \"{other}\"")),
    }
}

/// Offline deterministic spatial assistant: parses common cartographic commands
/// directly in Rust with zero external LLM API key needed!
pub fn execute_local_offline_turn(input: &AgentTurnInput) -> AgentTurnOutput {
    let mut state = MutableDraftState::from_geojson(
        &input.workspace.draft_geojson,
        &input.workspace.draft_title,
    );
    let lower = input.prompt.to_lowercase();
    let mut tool_calls = Vec::new();
    let reply;

    if lower.contains("measure") || lower.contains("area") || lower.contains("length") {
        let (rec, val) = execute_tool_call("measure_draft", &json!({}), &input.workspace, &mut state);
        reply = format!(
            "Measured your working draft via `earthly-geo`:\n- Total line length: {:.1} m ({:.2} km)\n- Total polygon area: {:.2} ha ({:.0} m²)",
            val["totalLineMeters"].as_f64().unwrap_or(0.0),
            val["totalLineMeters"].as_f64().unwrap_or(0.0) / 1000.0,
            val["totalAreaHectares"].as_f64().unwrap_or(0.0),
            val["totalAreaSquareMeters"].as_f64().unwrap_or(0.0),
        );
        tool_calls.push(rec);
    } else if lower.contains("corridor") || lower.contains("buffer") {
        let width = extract_first_number(&lower).unwrap_or(120.0);
        let (rec, _) = execute_tool_call(
            "create_corridor",
            &json!({ "totalWidthMeters": width, "color": "#1F5F8B" }),
            &input.workspace,
            &mut state,
        );
        reply = if rec.ok {
            format!("Created a {width:.0} m corridor polygon from your last line using `earthly-geo`.")
        } else {
            format!("Could not create corridor: {}", rec.summary)
        };
        tool_calls.push(rec);
    } else if lower.contains("arrow") {
        let width = extract_first_number(&lower).unwrap_or(120.0);
        let (rec, _) = execute_tool_call(
            "create_flow_arrow",
            &json!({ "startWidthMeters": width * 0.5, "endWidthMeters": width, "color": "#D97706" }),
            &input.workspace,
            &mut state,
        );
        reply = if rec.ok {
            format!("Extruded a flow arrow ({:.0} m head) along your last line.", width)
        } else {
            format!("Could not create flow arrow: {}", rec.summary)
        };
        tool_calls.push(rec);
    } else if lower.contains("offset") || lower.contains("parallel") {
        let dist = extract_first_number(&lower).unwrap_or(80.0);
        let (rec, _) = execute_tool_call(
            "offset_geometry",
            &json!({ "distanceMeters": dist }),
            &input.workspace,
            &mut state,
        );
        reply = if rec.ok {
            format!("Created an offset geometry ({dist:+.0} m) via `earthly-geo`.")
        } else {
            format!("Could not offset geometry: {}", rec.summary)
        };
        tool_calls.push(rec);
    } else if lower.contains("union") || lower.contains("merge") {
        let (rec, _) = execute_tool_call("union_polygons", &json!({}), &input.workspace, &mut state);
        reply = if rec.ok {
            rec.summary.clone()
        } else {
            format!("Could not union polygons: {}", rec.summary)
        };
        tool_calls.push(rec);
    } else if lower.contains("callout") || lower.contains("note") {
        let text = input
            .prompt
            .split_once(':')
            .map(|(_, rhs)| rhs.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or(input.prompt.trim());
        let (rec, _) = execute_tool_call(
            "add_callout",
            &json!({ "title": "Field Note", "text": text, "side": "right" }),
            &input.workspace,
            &mut state,
        );
        reply = if rec.ok {
            format!("Attached a live map callout card (\"{}\") to your latest draft feature.", text)
        } else {
            format!("Could not attach callout: {}", rec.summary)
        };
        tool_calls.push(rec);
    } else if lower.contains("point") || lower.contains("pin") || lower.contains("drop") {
        let (rec, _) = execute_tool_call(
            "create_point",
            &json!({
                "lon": input.workspace.center_lon,
                "lat": input.workspace.center_lat,
                "name": "Pinned Waypoint",
                "color": "#15803D",
                "calloutTitle": "Waypoint",
                "calloutText": input.prompt.trim()
            }),
            &input.workspace,
            &mut state,
        );
        reply = format!("Dropped a labeled point + callout at the current map center ({:.5}, {:.5}).", input.workspace.center_lat, input.workspace.center_lon);
        tool_calls.push(rec);
    } else if lower.contains("dedup") || lower.contains("duplicate") {
        let (rec, _) = execute_tool_call("deduplicate_draft", &json!({}), &input.workspace, &mut state);
        reply = rec.summary.clone();
        tool_calls.push(rec);
    } else if lower.contains("story") && lower.contains("outline") {
        let (rec, val) = execute_tool_call("draft_story_outline", &json!({}), &input.workspace, &mut state);
        reply = val["markdown"].as_str().unwrap_or(&rec.summary).to_owned();
        tool_calls.push(rec);
    } else if lower.contains("atlas manifest") || (lower.contains("draft") && lower.contains("atlas")) {
        let (rec, val) = execute_tool_call("draft_atlas_manifest", &json!({}), &input.workspace, &mut state);
        reply = val["markdown"].as_str().unwrap_or(&rec.summary).to_owned();
        tool_calls.push(rec);
    } else if lower.contains("search catalog") || lower.contains("find map") {
        let q = input
            .prompt
            .split_once(':')
            .map(|(_, rhs)| rhs.trim())
            .unwrap_or("");
        let (rec, val) = execute_tool_call(
            "query_catalog",
            &json!({ "query": q }),
            &input.workspace,
            &mut state,
        );
        let matches = val["matches"]
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter_map(Value::as_str)
                    .map(|s| format!("• {s}"))
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        reply = if matches.is_empty() {
            rec.summary.clone()
        } else {
            format!("{}\n{}", rec.summary, matches)
        };
        tool_calls.push(rec);
    } else if lower.contains("atlas") {
        let (rec, _) = execute_tool_call("atlas_workspace_status", &json!({}), &input.workspace, &mut state);
        reply = format!("Atlas status: {}. Ready to mount local `.atlas` archives via `earthly-spatial`.", rec.summary);
        tool_calls.push(rec);
    } else {
        let (rec, _) = execute_tool_call("inspect_workspace", &json!({}), &input.workspace, &mut state);
        reply = format!(
            "Offline Rust spatial mode active ({}).\nTry commands like:\n• \"Measure my draft\"\n• \"Create a 150m corridor\"\n• \"Extrude a flow arrow\"\n• \"Offset +100m\"\n• \"Union polygons\"\n• \"Add callout: North trailhead open\"\n• \"Drop pin here\"\n• \"Draft story outline\"\nOr configure an OpenAI / OpenRouter / local Ollama endpoint above for full LLM reasoning!",
            rec.summary
        );
        tool_calls.push(rec);
    }

    let updated_draft_geojson = state
        .modified
        .then(|| serde_json::to_string(&state.fc).unwrap_or_default());

    AgentTurnOutput {
        reply,
        updated_draft_geojson,
        camera_action: state.camera_action,
        tool_calls,
        used_offline_mode: true,
        prompt_tokens: None,
        completion_tokens: None,
        total_tokens: None,
    }
}

fn first_feature_coord(feature: &Value) -> Option<[f64; 2]> {
    let geom = feature.get("geometry")?;
    let gtype = geom.get("type")?.as_str()?;
    let coords = geom.get("coordinates")?;
    match gtype {
        "Point" => Some([coords.get(0)?.as_f64()?, coords.get(1)?.as_f64()?]),
        "LineString" => {
            let p = coords.as_array()?.first()?;
            Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])
        }
        "Polygon" => {
            let p = coords.as_array()?.first()?.as_array()?.first()?;
            Some([p.get(0)?.as_f64()?, p.get(1)?.as_f64()?])
        }
        _ => None,
    }
}

fn to_line(pts: &[[f64; 2]]) -> LineString<f64> {
    LineString::new(pts.iter().map(|p| Coord { x: p[0], y: p[1] }).collect())
}

fn to_poly(pts: &[[f64; 2]]) -> Polygon<f64> {
    let mut coords: Vec<Coord<f64>> = pts.iter().map(|p| Coord { x: p[0], y: p[1] }).collect();
    if let (Some(&first), Some(&last)) = (coords.first(), coords.last()) {
        if first != last {
            coords.push(first);
        }
    }
    Polygon::new(LineString::new(coords), vec![])
}

fn line_to_pairs(line: &LineString<f64>) -> Vec<[f64; 2]> {
    line.0.iter().map(|c| [c.x, c.y]).collect()
}

fn poly_to_ring(poly: &Polygon<f64>) -> Vec<[f64; 2]> {
    poly.exterior().0.iter().map(|c| [c.x, c.y]).collect()
}

fn ok_tool(name: &str, summary: String, value: Value) -> (ExecutedToolRecord, Value) {
    (
        ExecutedToolRecord {
            name: name.to_owned(),
            ok: true,
            summary,
        },
        value,
    )
}

fn err_tool(name: &str, message: &str) -> (ExecutedToolRecord, Value) {
    (
        ExecutedToolRecord {
            name: name.to_owned(),
            ok: false,
            summary: message.to_owned(),
        },
        json!({ "error": message }),
    )
}

fn parse_coords_array(raw: Option<&Value>) -> Vec<[f64; 2]> {
    let Some(arr) = raw.and_then(Value::as_array) else {
        return Vec::new();
    };
    arr.iter()
        .filter_map(|item| {
            let pair = item.as_array()?;
            if pair.len() < 2 {
                return None;
            }
            let lon = pair[0].as_f64()?;
            let lat = pair[1].as_f64()?;
            (lon.is_finite() && lat.is_finite()).then_some([lon, lat])
        })
        .collect()
}

fn find_line_coords(features: &[Value], target_id: Option<&str>) -> Option<Vec<[f64; 2]>> {
    let matching = features.iter().rev().find(|f| {
        let is_line = f
            .get("geometry")
            .and_then(|g| g.get("type"))
            .and_then(Value::as_str)
            == Some("LineString");
        if !is_line {
            return false;
        }
        target_id.is_none() || f.get("id").and_then(Value::as_str) == target_id
    })?;
    let pts = parse_coords_array(matching.get("geometry").and_then(|g| g.get("coordinates")));
    (pts.len() >= 2).then_some(pts)
}

fn find_polygon_coords(features: &[Value], target_id: Option<&str>) -> Option<Vec<[f64; 2]>> {
    let matching = features.iter().rev().find(|f| {
        let is_poly = f
            .get("geometry")
            .and_then(|g| g.get("type"))
            .and_then(Value::as_str)
            == Some("Polygon");
        if !is_poly {
            return false;
        }
        target_id.is_none() || f.get("id").and_then(Value::as_str) == target_id
    })?;
    let ring = matching
        .get("geometry")
        .and_then(|g| g.get("coordinates"))
        .and_then(Value::as_array)
        .and_then(|a| a.first());
    let pts = parse_coords_array(ring);
    (pts.len() >= 3).then_some(pts)
}

fn extract_first_number(text: &str) -> Option<f64> {
    let mut buf = String::new();
    for ch in text.chars() {
        if ch.is_ascii_digit() || (ch == '.' && !buf.is_empty()) || (ch == '-' && buf.is_empty()) {
            buf.push(ch);
        } else if !buf.is_empty() && buf != "-" {
            if let Ok(v) = buf.parse::<f64>() {
                return Some(v);
            }
            buf.clear();
        } else {
            buf.clear();
        }
    }
    if !buf.is_empty() && buf != "-" {
        buf.parse::<f64>().ok()
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offline_corridor_and_measure_mutate_draft_cleanly() {
        let fc = json!({
            "type": "FeatureCollection",
            "name": "Trail",
            "features": [{
                "type": "Feature",
                "id": "line-1",
                "geometry": { "type": "LineString", "coordinates": [[16.370, 48.208], [16.380, 48.208]] },
                "properties": { "name": "Danube Walk" }
            }]
        })
        .to_string();

        let out = execute_local_offline_turn(&AgentTurnInput {
            prompt: "Create a 100m corridor".to_owned(),
            history: vec![],
            workspace: AgentWorkspaceContext {
                center_lon: 16.375,
                center_lat: 48.208,
                zoom: 14.0,
                draft_title: "Trail".to_owned(),
                draft_geojson: fc,
                shelf_map_titles: vec![],
                atlas_workspaces: vec![],
                working_set_titles: vec![],
                catalog_items: vec![],
                map_snapshot_base64: None,
                allow_vision: false,
            },
        });

        assert!(out.used_offline_mode);
        assert_eq!(out.tool_calls.len(), 1);
        assert!(out.tool_calls[0].ok);
        let updated: Value =
            serde_json::from_str(out.updated_draft_geojson.as_deref().unwrap()).unwrap();
        assert_eq!(updated["features"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn deduplicate_draft_removes_identical_features_and_keeps_distinct() {
        let fc = json!({
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "id": "a",
                    "geometry": { "type": "Point", "coordinates": [16.37, 48.20] },
                    "properties": { "name": "Well" }
                },
                {
                    "type": "Feature",
                    "id": "b",
                    "geometry": { "type": "Point", "coordinates": [16.37, 48.20] },
                    "properties": { "name": "Well" }
                },
                {
                    "type": "Feature",
                    "id": "c",
                    "geometry": { "type": "Point", "coordinates": [16.38, 48.21] },
                    "properties": { "name": "Gate" }
                }
            ]
        })
        .to_string();

        let out = execute_local_offline_turn(&AgentTurnInput {
            prompt: "Deduplicate my draft features".to_owned(),
            history: vec![],
            workspace: AgentWorkspaceContext {
                center_lon: 16.375,
                center_lat: 48.208,
                zoom: 14.0,
                draft_title: "Test".to_owned(),
                draft_geojson: fc,
                shelf_map_titles: vec![],
                atlas_workspaces: vec![],
                working_set_titles: vec![],
                catalog_items: vec![],
                map_snapshot_base64: None,
                allow_vision: false,
            },
        });
        assert_eq!(out.tool_calls[0].name, "deduplicate_draft");
        assert!(out.tool_calls[0].ok);
        let updated: Value =
            serde_json::from_str(out.updated_draft_geojson.as_deref().unwrap()).unwrap();
        assert_eq!(updated["features"].as_array().unwrap().len(), 2);
        let names: Vec<String> = crate::schema::earthly_tool_definitions()
            .into_iter()
            .map(|t| t.name)
            .collect();
        assert_eq!(names.len(), 23);
        for expected in [
            "deduplicate_draft",
            "geocode_place",
            "query_osm_bbox",
            "valhalla_route",
            "valhalla_isochrone",
            "lookup_admin_boundary",
            "draft_story_outline",
            "capture_map_snapshot",
        ] {
            assert!(names.iter().any(|n| n == expected), "missing tool {expected}");
        }

        let story_out = execute_local_offline_turn(&AgentTurnInput {
            prompt: "Draft story outline".to_owned(),
            history: vec![],
            workspace: AgentWorkspaceContext {
                center_lon: 16.375,
                center_lat: 48.208,
                zoom: 14.0,
                draft_title: "Danube Field Log".to_owned(),
                draft_geojson: json!({
                    "type": "FeatureCollection",
                    "features": [{
                        "type": "Feature",
                        "id": "p1",
                        "geometry": { "type": "Point", "coordinates": [16.375, 48.208] },
                        "properties": { "name": "Danube Overlook" }
                    }]
                })
                .to_string(),
                shelf_map_titles: vec![],
                atlas_workspaces: vec![],
                working_set_titles: vec![],
                catalog_items: vec![],
                map_snapshot_base64: None,
                allow_vision: false,
            },
        });
        assert_eq!(story_out.tool_calls[0].name, "draft_story_outline");
        assert!(story_out.reply.contains("```earthly-view"));
        assert!(story_out.reply.contains("Danube Overlook"));

        let catalog_out = execute_local_offline_turn(&AgentTurnInput {
            prompt: "search catalog: Danube".to_owned(),
            history: vec![],
            workspace: AgentWorkspaceContext {
                center_lon: 16.375,
                center_lat: 48.208,
                zoom: 14.0,
                draft_title: "Vienna".to_owned(),
                draft_geojson: json!({ "type": "FeatureCollection", "features": [] }).to_string(),
                shelf_map_titles: vec![],
                atlas_workspaces: vec![],
                working_set_titles: vec!["Danube Island Loop".to_owned()],
                catalog_items: vec![
                    "[Map] Danube Trails | 37515:alice:danube | #cycling | 8 features".to_owned(),
                    "[Story] Alps Ridge | 37520:bob:alps | #hiking".to_owned(),
                ],
                map_snapshot_base64: None,
                allow_vision: false,
            },
        });
        assert_eq!(catalog_out.tool_calls[0].name, "query_catalog");
        assert!(catalog_out.reply.contains("Danube Trails"));
        assert!(!catalog_out.reply.contains("Alps Ridge"));

        let atlas_out = execute_local_offline_turn(&AgentTurnInput {
            prompt: "draft atlas manifest".to_owned(),
            history: vec![],
            workspace: AgentWorkspaceContext {
                center_lon: 16.375,
                center_lat: 48.208,
                zoom: 14.0,
                draft_title: "Vienna Trails Atlas".to_owned(),
                draft_geojson: json!({ "type": "FeatureCollection", "features": [] }).to_string(),
                shelf_map_titles: vec![],
                atlas_workspaces: vec![],
                working_set_titles: vec!["Danube Island Loop".to_owned()],
                catalog_items: vec![
                    "[Map] Danube Trails | 37515:alice:danube | #cycling | 8 features".to_owned(),
                ],
                map_snapshot_base64: None,
                allow_vision: false,
            },
        });
        assert_eq!(atlas_out.tool_calls[0].name, "draft_atlas_manifest");
        assert!(atlas_out.reply.contains("# Vienna Trails Atlas"));
        assert!(atlas_out.reply.contains("Danube Island Loop"));
    }

    #[test]
    fn capture_map_snapshot_is_gated_when_allow_vision_is_false() {
        let workspace = AgentWorkspaceContext {
            center_lon: 16.375,
            center_lat: 48.208,
            zoom: 14.5,
            draft_title: "Test".to_owned(),
            draft_geojson: json!({ "type": "FeatureCollection", "features": [] }).to_string(),
            shelf_map_titles: vec![],
            atlas_workspaces: vec![],
            working_set_titles: vec![],
            catalog_items: vec![],
            map_snapshot_base64: Some("iVBORw0KGgo=".to_owned()),
            allow_vision: false,
        };
        let mut state = MutableDraftState::from_geojson(&workspace.draft_geojson, &workspace.draft_title);

        let (rec, val) = execute_tool_call("capture_map_snapshot", &json!({}), &workspace, &mut state);
        assert!(!rec.ok);
        assert_eq!(val["visionAvailable"], json!(false));
        assert_eq!(
            val["reason"],
            json!("Vision is disabled or unsupported for the active model.")
        );
    }

    #[test]
    fn capture_map_snapshot_returns_metadata_when_vision_enabled() {
        let workspace = AgentWorkspaceContext {
            center_lon: 16.375,
            center_lat: 48.208,
            zoom: 15.0,
            draft_title: "Test".to_owned(),
            draft_geojson: json!({
                "type": "FeatureCollection",
                "features": [{
                    "type": "Feature",
                    "id": "p1",
                    "geometry": { "type": "Point", "coordinates": [16.375, 48.208] },
                    "properties": { "name": "Peak" }
                }]
            })
            .to_string(),
            shelf_map_titles: vec![],
            atlas_workspaces: vec![],
            working_set_titles: vec![],
            catalog_items: vec![],
            map_snapshot_base64: Some("iVBORw0KGgo=".to_owned()),
            allow_vision: true,
        };
        let mut state = MutableDraftState::from_geojson(&workspace.draft_geojson, &workspace.draft_title);

        let (rec, val) = execute_tool_call("capture_map_snapshot", &json!({}), &workspace, &mut state);
        assert!(rec.ok);
        assert_eq!(val["visionAvailable"], json!(true));
        assert_eq!(val["bytesApprox"], json!(8));
        assert_eq!(val["center"], json!([16.375, 48.208]));
        assert_eq!(val["zoom"], json!(15.0));
        assert_eq!(val["draftFeatureCount"], json!(1));
    }

    #[test]
    fn workspace_context_serde_defaults_vision_fields_safely() {
        let raw = json!({
            "centerLon": 16.37,
            "centerLat": 48.20,
            "zoom": 13.0,
            "draftTitle": "Draft",
            "draftGeojson": "{\"type\":\"FeatureCollection\",\"features\":[]}",
            "shelfMapTitles": []
        });
        let parsed: AgentWorkspaceContext = serde_json::from_value(raw).unwrap();
        assert!(!parsed.allow_vision);
        assert_eq!(parsed.map_snapshot_base64, None);
    }
}
