//! Pure-Rust GPX 1.1 and KML 2.2 spatial format import & export (`native + wasm32`).
//!
//! Mirrors Earthly Web's `src/features/maplets/kml.ts` security & styling rules
//! (rejecting XML DOCTYPE/ENTITY declarations, capping coordinate/feature counts,
//! translating KML `aabbggrr` styles into Earthly `#rrggbb` + opacity properties)
//! and supports clean round-trip GPX/KML export from GeoJSON FeatureCollections.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::io::Read;

use flate2::read::DeflateDecoder;
use quick_xml::Reader;
use quick_xml::events::{BytesStart, Event};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::{GeoError, validate_feature_collection};

const MAX_XML_BYTES: usize = 10 * 1024 * 1024;
const MAX_FEATURES: usize = 5_000;
const MAX_POSITIONS: usize = 100_000;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpatialImportResult {
    pub format: String,
    pub title: String,
    pub geojson: Value,
    pub feature_count: usize,
    pub warnings: Vec<String>,
}

fn check_xml_safety(xml: &str) -> Result<(), GeoError> {
    if xml.len() > MAX_XML_BYTES {
        return Err(GeoError::InvalidParameter(
            "Spatial XML file exceeds 10 MiB limit".to_owned(),
        ));
    }
    let upper = xml.to_ascii_uppercase();
    if upper.contains("<!DOCTYPE") || upper.contains("<!ENTITY") {
        return Err(GeoError::InvalidParameter(
            "XML document types and entities are not supported".to_owned(),
        ));
    }
    Ok(())
}

fn local_name(raw: &[u8]) -> String {
    let s = std::str::from_utf8(raw).unwrap_or("");
    match s.rsplit_once(':') {
        Some((_, local)) => local.to_owned(),
        None => s.to_owned(),
    }
}

fn attr_str(start: &BytesStart<'_>, wanted: &str) -> Option<String> {
    for attr in start.attributes().flatten() {
        let key = local_name(attr.key.as_ref());
        if key == wanted {
            if let Ok(val) = attr.normalized_value(quick_xml::XmlVersion::Implicit1_0) {
                return Some(val.into_owned());
            }
        }
    }
    None
}

fn strip_html_plain(input: &str) -> String {
    let mut out = String::with_capacity(input.len().min(8000));
    let mut in_tag = false;
    let mut tag_buf = String::new();
    for ch in input.chars() {
        if out.len() >= 8000 {
            break;
        }
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
            continue;
        }
        if ch == '>' && in_tag {
            in_tag = false;
            let lower = tag_buf.trim().to_ascii_lowercase();
            if lower == "br" || lower == "br/" || lower == "br /" || lower == "/p" {
                out.push('\n');
            }
            continue;
        }
        if in_tag {
            tag_buf.push(ch);
        } else {
            out.push(ch);
        }
    }
    out.trim().to_owned()
}

fn xml_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for ch in input.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

fn parse_valid_lon_lat(lon: f64, lat: f64) -> Result<(f64, f64), GeoError> {
    if !lon.is_finite() || !lat.is_finite() || !(-180.0..=180.0).contains(&lon) || !(-90.0..=90.0).contains(&lat) {
        return Err(GeoError::InvalidCoordinate(lon, lat));
    }
    Ok((lon, lat))
}

/// Parses GPX 1.1 XML (`<wpt>`, `<trk>/<trkseg>/<trkpt>`, `<rte>/<rtept>`) into
/// a validated GeoJSON `FeatureCollection`.
pub fn parse_gpx_to_geojson(xml: &str) -> Result<SpatialImportResult, GeoError> {
    check_xml_safety(xml)?;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<String> = Vec::new();
    let mut seen_gpx_root = false;
    let mut doc_name: Option<String> = None;

    // Active waypoint state
    let mut cur_wpt: Option<(f64, f64, Option<f64>, Option<String>, Option<String>)> = None;
    // Active track state
    let mut cur_trk_name: Option<String> = None;
    let mut cur_trk_desc: Option<String> = None;
    let mut cur_trk_segs: Vec<Vec<Vec<f64>>> = Vec::new();
    let mut cur_seg_pts: Vec<Vec<f64>> = Vec::new();
    let mut cur_pt_coords: Option<(f64, f64, Option<f64>)> = None;
    // Active route state
    let mut cur_rte_name: Option<String> = None;
    let mut cur_rte_desc: Option<String> = None;
    let mut cur_rte_pts: Vec<Vec<f64>> = Vec::new();

    let mut features: Vec<Value> = Vec::new();
    let mut total_positions: usize = 0;
    let mut warnings: Vec<String> = Vec::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = local_name(e.name().as_ref());
                if stack.is_empty() && tag == "gpx" {
                    seen_gpx_root = true;
                }
                match tag.as_str() {
                    "wpt" => {
                        let lat = attr_str(&e, "lat").and_then(|s| s.parse::<f64>().ok());
                        let lon = attr_str(&e, "lon").and_then(|s| s.parse::<f64>().ok());
                        if let (Some(lon), Some(lat)) = (lon, lat) {
                            let (lon, lat) = parse_valid_lon_lat(lon, lat)?;
                            cur_wpt = Some((lon, lat, None, None, None));
                        }
                    }
                    "trk" => {
                        cur_trk_name = None;
                        cur_trk_desc = None;
                        cur_trk_segs.clear();
                    }
                    "trkseg" => {
                        cur_seg_pts.clear();
                    }
                    "trkpt" | "rtept" => {
                        let lat = attr_str(&e, "lat").and_then(|s| s.parse::<f64>().ok());
                        let lon = attr_str(&e, "lon").and_then(|s| s.parse::<f64>().ok());
                        if let (Some(lon), Some(lat)) = (lon, lat) {
                            let (lon, lat) = parse_valid_lon_lat(lon, lat)?;
                            cur_pt_coords = Some((lon, lat, None));
                        }
                    }
                    "rte" => {
                        cur_rte_name = None;
                        cur_rte_desc = None;
                        cur_rte_pts.clear();
                    }
                    _ => {}
                }
                stack.push(tag);
            }
            Ok(Event::Empty(e)) => {
                let tag = local_name(e.name().as_ref());
                if stack.is_empty() && tag == "gpx" {
                    seen_gpx_root = true;
                }
                match tag.as_str() {
                    "wpt" => {
                        let lat = attr_str(&e, "lat").and_then(|s| s.parse::<f64>().ok());
                        let lon = attr_str(&e, "lon").and_then(|s| s.parse::<f64>().ok());
                        if let (Some(lon), Some(lat)) = (lon, lat) {
                            let (lon, lat) = parse_valid_lon_lat(lon, lat)?;
                            total_positions += 1;
                            if total_positions > MAX_POSITIONS || features.len() >= MAX_FEATURES {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds maximum feature or coordinate limit".to_owned(),
                                ));
                            }
                            features.push(json!({
                                "type": "Feature",
                                "id": format!("gpx-wpt-{}", features.len() + 1),
                                "geometry": { "type": "Point", "coordinates": [lon, lat] },
                                "properties": { "name": format!("Waypoint {}", features.len() + 1), "sourceFormat": "gpx" }
                            }));
                        }
                    }
                    "trkpt" | "rtept" => {
                        let lat = attr_str(&e, "lat").and_then(|s| s.parse::<f64>().ok());
                        let lon = attr_str(&e, "lon").and_then(|s| s.parse::<f64>().ok());
                        if let (Some(lon), Some(lat)) = (lon, lat) {
                            let (lon, lat) = parse_valid_lon_lat(lon, lat)?;
                            total_positions += 1;
                            if total_positions > MAX_POSITIONS {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds 100,000 coordinate points".to_owned(),
                                ));
                            }
                            if tag == "trkpt" {
                                cur_seg_pts.push(vec![lon, lat]);
                            } else {
                                cur_rte_pts.push(vec![lon, lat]);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = e.decode().map(|s| s.into_owned()).unwrap_or_default();
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let current = stack.last().map(String::as_str).unwrap_or("");
                let parent = stack
                    .len()
                    .checked_sub(2)
                    .and_then(|i| stack.get(i))
                    .map(String::as_str)
                    .unwrap_or("");

                match (parent, current) {
                    ("metadata" | "gpx", "name") => {
                        if doc_name.is_none() {
                            doc_name = Some(trimmed.to_owned());
                        }
                    }
                    ("wpt", "name") => {
                        if let Some(ref mut w) = cur_wpt {
                            w.3 = Some(trimmed.to_owned());
                        }
                    }
                    ("wpt", "desc" | "cmt") => {
                        if let Some(ref mut w) = cur_wpt {
                            if w.4.is_none() {
                                w.4 = Some(strip_html_plain(trimmed));
                            }
                        }
                    }
                    ("wpt", "ele") => {
                        if let (Some(w), Ok(ele)) = (cur_wpt.as_mut(), trimmed.parse::<f64>()) {
                            if ele.is_finite() {
                                w.2 = Some(ele);
                            }
                        }
                    }
                    ("trk", "name") => cur_trk_name = Some(trimmed.to_owned()),
                    ("trk", "desc" | "cmt") => {
                        if cur_trk_desc.is_none() {
                            cur_trk_desc = Some(strip_html_plain(trimmed));
                        }
                    }
                    ("rte", "name") => cur_rte_name = Some(trimmed.to_owned()),
                    ("rte", "desc" | "cmt") => {
                        if cur_rte_desc.is_none() {
                            cur_rte_desc = Some(strip_html_plain(trimmed));
                        }
                    }
                    ("trkpt" | "rtept", "ele") => {
                        if let (Some(pt), Ok(ele)) = (cur_pt_coords.as_mut(), trimmed.parse::<f64>())
                        {
                            if ele.is_finite() {
                                pt.2 = Some(ele);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "wpt" => {
                        if let Some((lon, lat, ele, name, desc)) = cur_wpt.take() {
                            total_positions += 1;
                            if total_positions > MAX_POSITIONS || features.len() >= MAX_FEATURES {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds maximum feature or coordinate limit".to_owned(),
                                ));
                            }
                            let coords = match ele {
                                Some(z) => json!([lon, lat, z]),
                                None => json!([lon, lat]),
                            };
                            let mut props = Map::new();
                            props.insert(
                                "name".to_owned(),
                                Value::String(
                                    name.unwrap_or_else(|| format!("Waypoint {}", features.len() + 1)),
                                ),
                            );
                            if let Some(d) = desc.filter(|s| !s.is_empty()) {
                                props.insert("description".to_owned(), Value::String(d));
                            }
                            props.insert("sourceFormat".to_owned(), Value::String("gpx".to_owned()));
                            features.push(json!({
                                "type": "Feature",
                                "id": format!("gpx-wpt-{}", features.len() + 1),
                                "geometry": { "type": "Point", "coordinates": coords },
                                "properties": props
                            }));
                        }
                    }
                    "trkpt" => {
                        if let Some((lon, lat, ele)) = cur_pt_coords.take() {
                            total_positions += 1;
                            if total_positions > MAX_POSITIONS {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds 100,000 coordinate points".to_owned(),
                                ));
                            }
                            let pt = match ele {
                                Some(z) => vec![lon, lat, z],
                                None => vec![lon, lat],
                            };
                            cur_seg_pts.push(pt);
                        }
                    }
                    "rtept" => {
                        if let Some((lon, lat, ele)) = cur_pt_coords.take() {
                            total_positions += 1;
                            if total_positions > MAX_POSITIONS {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds 100,000 coordinate points".to_owned(),
                                ));
                            }
                            let pt = match ele {
                                Some(z) => vec![lon, lat, z],
                                None => vec![lon, lat],
                            };
                            cur_rte_pts.push(pt);
                        }
                    }
                    "trkseg" => {
                        if cur_seg_pts.len() >= 2 {
                            cur_trk_segs.push(std::mem::take(&mut cur_seg_pts));
                        } else {
                            if !cur_seg_pts.is_empty() {
                                warnings.push("Skipped single-point GPX track segment".to_owned());
                            }
                            cur_seg_pts.clear();
                        }
                    }
                    "trk" => {
                        let base_name = cur_trk_name
                            .take()
                            .unwrap_or_else(|| format!("Track {}", features.len() + 1));
                        let desc = cur_trk_desc.take();
                        let seg_count = cur_trk_segs.len();
                        for (idx, seg) in cur_trk_segs.drain(..).enumerate() {
                            if features.len() >= MAX_FEATURES {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds 5,000 features".to_owned(),
                                ));
                            }
                            let mut props = Map::new();
                            let seg_name = if seg_count > 1 {
                                format!("{base_name} (Segment {})", idx + 1)
                            } else {
                                base_name.clone()
                            };
                            props.insert("name".to_owned(), Value::String(seg_name));
                            if let Some(d) = desc.as_ref().filter(|s| !s.is_empty()) {
                                props.insert("description".to_owned(), Value::String(d.clone()));
                            }
                            props.insert("sourceFormat".to_owned(), Value::String("gpx".to_owned()));
                            features.push(json!({
                                "type": "Feature",
                                "id": format!("gpx-trk-{}", features.len() + 1),
                                "geometry": { "type": "LineString", "coordinates": seg },
                                "properties": props
                            }));
                        }
                    }
                    "rte" => {
                        if cur_rte_pts.len() >= 2 {
                            if features.len() >= MAX_FEATURES {
                                return Err(GeoError::InvalidParameter(
                                    "GPX exceeds 5,000 features".to_owned(),
                                ));
                            }
                            let mut props = Map::new();
                            props.insert(
                                "name".to_owned(),
                                Value::String(
                                    cur_rte_name
                                        .take()
                                        .unwrap_or_else(|| format!("Route {}", features.len() + 1)),
                                ),
                            );
                            if let Some(d) = cur_rte_desc.take().filter(|s| !s.is_empty()) {
                                props.insert("description".to_owned(), Value::String(d));
                            }
                            props.insert("sourceFormat".to_owned(), Value::String("gpx".to_owned()));
                            features.push(json!({
                                "type": "Feature",
                                "id": format!("gpx-rte-{}", features.len() + 1),
                                "geometry": { "type": "LineString", "coordinates": std::mem::take(&mut cur_rte_pts) },
                                "properties": props
                            }));
                        } else {
                            cur_rte_pts.clear();
                        }
                    }
                    _ => {}
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid GPX XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    if !seen_gpx_root {
        return Err(GeoError::InvalidParameter(
            "File is not a valid GPX document (<gpx> root missing)".to_owned(),
        ));
    }
    if features.is_empty() {
        return Err(GeoError::EmptyResult("GPX contains no waypoints, tracks, or routes"));
    }

    let title = doc_name.unwrap_or_else(|| "Imported GPX".to_owned());
    let feature_count = features.len();
    let fc = json!({
        "type": "FeatureCollection",
        "name": title,
        "features": features,
    });
    validate_feature_collection(&fc)?;

    Ok(SpatialImportResult {
        format: "gpx".to_owned(),
        title,
        geojson: fc,
        feature_count,
        warnings,
    })
}

/// Serializes a GeoJSON `FeatureCollection` into a standards-compliant GPX 1.1 document.
pub fn geojson_to_gpx(fc: &Value, title: Option<&str>) -> Result<String, GeoError> {
    let features = fc
        .get("features")
        .and_then(|v| v.as_array())
        .ok_or_else(|| GeoError::InvalidGeoJson("FeatureCollection missing features array".to_owned()))?;

    let doc_name = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| fc.get("name").and_then(|v| v.as_str()))
        .unwrap_or("Earthly Map");

    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <gpx version=\"1.1\" creator=\"Earthly Native\" xmlns=\"http://www.topografix.com/GPX/1/1\">\n",
    );
    let _ = writeln!(
        out,
        "  <metadata><name>{}</name></metadata>",
        xml_escape(doc_name)
    );

    for (idx, feature) in features.iter().enumerate() {
        let Some(geom) = feature.get("geometry") else {
            continue;
        };
        let props = feature.get("properties").and_then(|v| v.as_object());
        let name = props
            .and_then(|p| p.get("name").or_else(|| p.get("title")).or_else(|| p.get("label")))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Feature {}", idx + 1));
        let desc = props
            .and_then(|p| p.get("description"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());

        match geom.get("type").and_then(|v| v.as_str()).unwrap_or("") {
            "Point" => {
                if let Some(coords) = geom.get("coordinates").and_then(|v| v.as_array()) {
                    write_gpx_wpt(&mut out, coords, &name, desc);
                }
            }
            "MultiPoint" => {
                if let Some(pts) = geom.get("coordinates").and_then(|v| v.as_array()) {
                    for (p_idx, pt) in pts.iter().enumerate() {
                        if let Some(coords) = pt.as_array() {
                            write_gpx_wpt(&mut out, coords, &format!("{name} #{}", p_idx + 1), desc);
                        }
                    }
                }
            }
            "LineString" => {
                if let Some(coords) = geom.get("coordinates").and_then(|v| v.as_array()) {
                    write_gpx_track(&mut out, &[coords.as_slice()], &name, desc);
                }
            }
            "MultiLineString" => {
                if let Some(lines) = geom.get("coordinates").and_then(|v| v.as_array()) {
                    let slices: Vec<&[Value]> = lines
                        .iter()
                        .filter_map(|l| l.as_array().map(|a| a.as_slice()))
                        .collect();
                    write_gpx_track(&mut out, &slices, &name, desc);
                }
            }
            "Polygon" => {
                if let Some(outer) = geom
                    .get("coordinates")
                    .and_then(|v| v.as_array())
                    .and_then(|rings| rings.first())
                    .and_then(|r| r.as_array())
                {
                    write_gpx_track(&mut out, &[outer.as_slice()], &name, desc);
                }
            }
            "MultiPolygon" => {
                if let Some(polys) = geom.get("coordinates").and_then(|v| v.as_array()) {
                    let slices: Vec<&[Value]> = polys
                        .iter()
                        .filter_map(|p| {
                            p.as_array()
                                .and_then(|rings| rings.first())
                                .and_then(|r| r.as_array())
                                .map(|a| a.as_slice())
                        })
                        .collect();
                    write_gpx_track(&mut out, &slices, &name, desc);
                }
            }
            _ => {}
        }
    }

    out.push_str("</gpx>\n");
    Ok(out)
}

fn write_gpx_wpt(out: &mut String, coords: &[Value], name: &str, desc: Option<&str>) {
    let (Some(lon), Some(lat)) = (
        coords.first().and_then(|v| v.as_f64()),
        coords.get(1).and_then(|v| v.as_f64()),
    ) else {
        return;
    };
    let _ = writeln!(out, "  <wpt lat=\"{lat:.7}\" lon=\"{lon:.7}\">");
    if let Some(ele) = coords.get(2).and_then(|v| v.as_f64()) {
        let _ = writeln!(out, "    <ele>{ele:.2}</ele>");
    }
    let _ = writeln!(out, "    <name>{}</name>", xml_escape(name));
    if let Some(d) = desc {
        let _ = writeln!(out, "    <desc>{}</desc>", xml_escape(d));
    }
    out.push_str("  </wpt>\n");
}

fn write_gpx_track(out: &mut String, segments: &[&[Value]], name: &str, desc: Option<&str>) {
    if segments.is_empty() {
        return;
    }
    out.push_str("  <trk>\n");
    let _ = writeln!(out, "    <name>{}</name>", xml_escape(name));
    if let Some(d) = desc {
        let _ = writeln!(out, "    <desc>{}</desc>", xml_escape(d));
    }
    for seg in segments {
        out.push_str("    <trkseg>\n");
        for pt in *seg {
            let Some(arr) = pt.as_array() else {
                continue;
            };
            let (Some(lon), Some(lat)) = (
                arr.first().and_then(|v| v.as_f64()),
                arr.get(1).and_then(|v| v.as_f64()),
            ) else {
                continue;
            };
            if let Some(ele) = arr.get(2).and_then(|v| v.as_f64()) {
                let _ = writeln!(
                    out,
                    "      <trkpt lat=\"{lat:.7}\" lon=\"{lon:.7}\"><ele>{ele:.2}</ele></trkpt>"
                );
            } else {
                let _ = writeln!(
                    out,
                    "      <trkpt lat=\"{lat:.7}\" lon=\"{lon:.7}\" />"
                );
            }
        }
        out.push_str("    </trkseg>\n");
    }
    out.push_str("  </trk>\n");
}

#[derive(Clone, Debug, Default)]
struct KmlStyleProps {
    fill_color: Option<String>,
    fill_opacity: Option<f64>,
    stroke_color: Option<String>,
    stroke_opacity: Option<f64>,
    stroke_width: Option<f64>,
}

impl KmlStyleProps {
    fn merge_from(&mut self, other: &KmlStyleProps) {
        if other.fill_color.is_some() {
            self.fill_color = other.fill_color.clone();
        }
        if other.fill_opacity.is_some() {
            self.fill_opacity = other.fill_opacity;
        }
        if other.stroke_color.is_some() {
            self.stroke_color = other.stroke_color.clone();
        }
        if other.stroke_opacity.is_some() {
            self.stroke_opacity = other.stroke_opacity;
        }
        if other.stroke_width.is_some() {
            self.stroke_width = other.stroke_width;
        }
    }

    fn apply_to_properties(&self, props: &mut Map<String, Value>) {
        if let Some(ref c) = self.fill_color {
            props.insert("fillColor".to_owned(), Value::String(c.clone()));
            props
                .entry("color".to_owned())
                .or_insert_with(|| Value::String(c.clone()));
        }
        if let Some(op) = self.fill_opacity {
            props.insert("fillOpacity".to_owned(), json!(op));
        }
        if let Some(ref c) = self.stroke_color {
            props.insert("strokeColor".to_owned(), Value::String(c.clone()));
            props
                .entry("color".to_owned())
                .or_insert_with(|| Value::String(c.clone()));
        }
        if let Some(op) = self.stroke_opacity {
            props.insert("strokeOpacity".to_owned(), json!(op));
        }
        if let Some(w) = self.stroke_width {
            props.insert("strokeWidth".to_owned(), json!(w));
        }
    }
}

/// Converts KML `aabbggrr` hex string into `(#rrggbb, opacity 0..1)`.
fn parse_kml_aabbggrr(raw: &str) -> Option<(String, f64)> {
    let hex = raw.trim();
    if hex.len() != 8 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let aa = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let bb = &hex[2..4];
    let gg = &hex[4..6];
    let rr = &hex[6..8];
    let color = format!("#{rr}{gg}{bb}").to_ascii_lowercase();
    let opacity = (aa as f64) / 255.0;
    Some((color, opacity))
}

fn hex_to_kml_aabbggrr(hex: &str, opacity: f64) -> String {
    let clean = hex.trim().trim_start_matches('#');
    let (rr, gg, bb) = if clean.len() == 6 && clean.bytes().all(|b| b.is_ascii_hexdigit()) {
        (&clean[0..2], &clean[2..4], &clean[4..6])
    } else {
        ("d9", "77", "06")
    };
    let alpha = (opacity.clamp(0.0, 1.0) * 255.0).round() as u8;
    format!("{alpha:02x}{bb}{gg}{rr}").to_ascii_lowercase()
}

fn parse_kml_coordinate_tuples(raw: &str, total_positions: &mut usize) -> Result<Vec<Vec<f64>>, GeoError> {
    let mut pts = Vec::new();
    for token in raw.split_whitespace() {
        *total_positions += 1;
        if *total_positions > MAX_POSITIONS {
            return Err(GeoError::InvalidParameter(
                "KML exceeds 100,000 coordinate tuples".to_owned(),
            ));
        }
        let parts: Vec<&str> = token.split(',').collect();
        if parts.len() < 2 || parts.len() > 3 {
            return Err(GeoError::InvalidParameter(format!(
                "Invalid KML coordinate tuple: {token}"
            )));
        }
        let lon = parts[0]
            .trim()
            .parse::<f64>()
            .map_err(|_| GeoError::InvalidParameter(format!("Invalid KML longitude: {token}")))?;
        let lat = parts[1]
            .trim()
            .parse::<f64>()
            .map_err(|_| GeoError::InvalidParameter(format!("Invalid KML latitude: {token}")))?;
        parse_valid_lon_lat(lon, lat)?;
        if parts.len() == 3 && !parts[2].trim().is_empty() {
            let alt = parts[2]
                .trim()
                .parse::<f64>()
                .map_err(|_| GeoError::InvalidParameter(format!("Invalid KML altitude: {token}")))?;
            if alt.is_finite() && alt != 0.0 {
                pts.push(vec![lon, lat, alt]);
            } else {
                pts.push(vec![lon, lat]);
            }
        } else {
            pts.push(vec![lon, lat]);
        }
    }
    Ok(pts)
}

#[derive(Default)]
struct PlacemarkBuilder {
    id: Option<String>,
    name: Option<String>,
    description: Option<String>,
    style_url: Option<String>,
    inline_style: KmlStyleProps,
    geometries: Vec<Value>,
    cur_poly_outer: Option<Vec<Vec<f64>>>,
    cur_poly_inners: Vec<Vec<Vec<f64>>>,
    extended_data: Map<String, Value>,
}

/// Parses KML 2.2 XML (`<Document>`, `<Folder>`, `<Placemark>`, `<Style>`,
/// `<StyleMap>`, `<Point>`, `<LineString>`, `<Polygon>`, `<MultiGeometry>`)
/// into a validated GeoJSON `FeatureCollection` matching Web's `kml.ts` rules.
pub fn parse_kml_to_geojson(xml: &str) -> Result<SpatialImportResult, GeoError> {
    check_xml_safety(xml)?;

    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut stack: Vec<String> = Vec::new();
    let mut seen_kml_root = false;
    let mut doc_name: Option<String> = None;
    let mut folder_stack: Vec<String> = Vec::new();

    let mut styles: HashMap<String, KmlStyleProps> = HashMap::new();
    let mut style_maps: HashMap<String, String> = HashMap::new();
    let mut cur_style_id: Option<String> = None;
    let mut cur_style_props = KmlStyleProps::default();
    let mut cur_stylemap_id: Option<String> = None;
    let mut cur_pair_key: Option<String> = None;
    let mut cur_pair_url: Option<String> = None;

    let mut cur_pm: Option<PlacemarkBuilder> = None;
    let mut cur_data_key: Option<String> = None;
    let mut coord_buffer = String::new();
    let mut in_coordinates = false;
    let mut in_outer_boundary = false;
    let mut in_inner_boundary = false;

    let mut raw_placemarks: Vec<(PlacemarkBuilder, Vec<String>)> = Vec::new();
    let mut total_positions: usize = 0;
    let mut warnings: Vec<String> = Vec::new();
    let mut skipped_unsupported: HashMap<String, usize> = HashMap::new();

    let mut buf = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = local_name(e.name().as_ref());
                if stack.is_empty() && tag == "kml" {
                    seen_kml_root = true;
                }
                match tag.as_str() {
                    "NetworkLink" | "GroundOverlay" | "PhotoOverlay" | "ScreenOverlay" | "Model"
                    | "Track" | "MultiTrack" => {
                        *skipped_unsupported.entry(tag.clone()).or_insert(0) += 1;
                    }
                    "Folder" => {
                        folder_stack.push("Untitled layer".to_owned());
                    }
                    "Style" => {
                        if cur_pm.is_none() {
                            cur_style_id = attr_str(&e, "id");
                            cur_style_props = KmlStyleProps::default();
                        }
                    }
                    "StyleMap" => {
                        cur_stylemap_id = attr_str(&e, "id");
                    }
                    "Pair" => {
                        cur_pair_key = None;
                        cur_pair_url = None;
                    }
                    "Placemark" => {
                        cur_pm = Some(PlacemarkBuilder {
                            id: attr_str(&e, "id"),
                            ..Default::default()
                        });
                    }
                    "Polygon" => {
                        if let Some(ref mut pm) = cur_pm {
                            pm.cur_poly_outer = None;
                            pm.cur_poly_inners.clear();
                        }
                    }
                    "outerBoundaryIs" => in_outer_boundary = true,
                    "innerBoundaryIs" => in_inner_boundary = true,
                    "coordinates" => {
                        in_coordinates = true;
                        coord_buffer.clear();
                    }
                    "Data" | "SimpleData" => {
                        cur_data_key = attr_str(&e, "name");
                    }
                    _ => {}
                }
                stack.push(tag);
            }
            Ok(Event::Text(e)) => {
                let text = e.decode().map(|s| s.into_owned()).unwrap_or_default();
                if in_coordinates {
                    if !coord_buffer.is_empty() {
                        coord_buffer.push(' ');
                    }
                    coord_buffer.push_str(&text);
                    continue;
                }
                let trimmed = text.trim();
                if trimmed.is_empty() {
                    continue;
                }
                handle_kml_text(
                    &stack,
                    trimmed,
                    &mut doc_name,
                    &mut folder_stack,
                    &mut cur_style_props,
                    &mut cur_pair_key,
                    &mut cur_pair_url,
                    &mut cur_pm,
                    &cur_data_key,
                );
            }
            Ok(Event::CData(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                if in_coordinates {
                    coord_buffer.push_str(&text);
                    continue;
                }
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    handle_kml_text(
                        &stack,
                        trimmed,
                        &mut doc_name,
                        &mut folder_stack,
                        &mut cur_style_props,
                        &mut cur_pair_key,
                        &mut cur_pair_url,
                        &mut cur_pm,
                        &cur_data_key,
                    );
                }
            }
            Ok(Event::End(e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "coordinates" => {
                        in_coordinates = false;
                        if let Some(ref mut pm) = cur_pm {
                            let pts = parse_kml_coordinate_tuples(&coord_buffer, &mut total_positions)?;
                            let geom_parent = stack
                                .len()
                                .checked_sub(2)
                                .and_then(|i| stack.get(i))
                                .map(String::as_str)
                                .unwrap_or("");
                            match geom_parent {
                                "Point" => {
                                    if let Some(first) = pts.first() {
                                        pm.geometries.push(json!({
                                            "type": "Point",
                                            "coordinates": first
                                        }));
                                    }
                                }
                                "LineString" => {
                                    if pts.len() >= 2 {
                                        pm.geometries.push(json!({
                                            "type": "LineString",
                                            "coordinates": pts
                                        }));
                                    }
                                }
                                "LinearRing" => {
                                    if pts.len() >= 3 {
                                        let mut ring = pts;
                                        if ring.first() != ring.last() {
                                            ring.push(ring[0].clone());
                                        }
                                        if ring.len() >= 4 {
                                            if in_outer_boundary {
                                                pm.cur_poly_outer = Some(ring);
                                            } else if in_inner_boundary {
                                                pm.cur_poly_inners.push(ring);
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        coord_buffer.clear();
                    }
                    "outerBoundaryIs" => in_outer_boundary = false,
                    "innerBoundaryIs" => in_inner_boundary = false,
                    "Polygon" => {
                        if let Some(ref mut pm) = cur_pm {
                            if let Some(outer) = pm.cur_poly_outer.take() {
                                let mut rings = Vec::with_capacity(1 + pm.cur_poly_inners.len());
                                rings.push(outer);
                                rings.extend(pm.cur_poly_inners.drain(..));
                                pm.geometries.push(json!({
                                    "type": "Polygon",
                                    "coordinates": rings
                                }));
                            }
                        }
                    }
                    "Style" => {
                        if cur_pm.is_none() {
                            if let Some(id) = cur_style_id.take() {
                                styles.insert(id, std::mem::take(&mut cur_style_props));
                            }
                        }
                    }
                    "Pair" => {
                        if cur_pair_key.as_deref() == Some("normal") {
                            if let (Some(map_id), Some(url)) =
                                (cur_stylemap_id.as_ref(), cur_pair_url.take())
                            {
                                style_maps.insert(map_id.clone(), url);
                            }
                        }
                        cur_pair_key = None;
                        cur_pair_url = None;
                    }
                    "StyleMap" => {
                        cur_stylemap_id = None;
                    }
                    "Data" | "SimpleData" => {
                        cur_data_key = None;
                    }
                    "Placemark" => {
                        if let Some(pm) = cur_pm.take() {
                            if raw_placemarks.len() >= MAX_FEATURES {
                                return Err(GeoError::InvalidParameter(
                                    "KML exceeds 5,000 placemarks".to_owned(),
                                ));
                            }
                            raw_placemarks.push((pm, folder_stack.clone()));
                        }
                    }
                    "Folder" => {
                        folder_stack.pop();
                    }
                    _ => {}
                }
                stack.pop();
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid KML XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    if !seen_kml_root {
        return Err(GeoError::InvalidParameter(
            "File is not valid KML (<kml> root missing). Export KML rather than compressed KMZ."
                .to_owned(),
        ));
    }

    for (tag, count) in skipped_unsupported {
        warnings.push(format!("{count} {tag} element(s) were skipped."));
    }

    let doc_title = doc_name.unwrap_or_else(|| "Imported KML".to_owned());
    let mut features: Vec<Value> = Vec::new();
    let mut seen_ids: HashMap<String, usize> = HashMap::new();

    for (idx, (pm, folders)) in raw_placemarks.into_iter().enumerate() {
        if pm.geometries.is_empty() {
            warnings.push(format!(
                "Skipped placemark without supported geometry: {}",
                pm.name.as_deref().unwrap_or("unnamed")
            ));
            continue;
        }
        let mut resolved_style = KmlStyleProps::default();
        if let Some(ref url) = pm.style_url {
            if let Some(ref_id) = url.strip_prefix('#') {
                if let Some(mapped) = style_maps.get(ref_id) {
                    if let Some(target_id) = mapped.strip_prefix('#') {
                        if let Some(st) = styles.get(target_id) {
                            resolved_style.merge_from(st);
                        }
                    }
                } else if let Some(st) = styles.get(ref_id) {
                    resolved_style.merge_from(st);
                }
            }
        }
        resolved_style.merge_from(&pm.inline_style);

        let layer = if folders.is_empty() {
            "Ungrouped".to_owned()
        } else {
            folders.join(" / ")
        };

        for (g_idx, geom) in pm.geometries.into_iter().enumerate() {
            if features.len() >= MAX_FEATURES {
                break;
            }
            let mut props = Map::new();
            resolved_style.apply_to_properties(&mut props);
            props.insert(
                "name".to_owned(),
                Value::String(
                    pm.name
                        .clone()
                        .unwrap_or_else(|| format!("Placemark {}", idx + 1)),
                ),
            );
            if let Some(ref d) = pm.description {
                if !d.is_empty() {
                    props.insert("description".to_owned(), Value::String(d.clone()));
                }
            }
            props.insert("sourceFormat".to_owned(), Value::String("kml".to_owned()));
            props.insert("sourceMap".to_owned(), Value::String(doc_title.clone()));
            props.insert("sourceLayer".to_owned(), Value::String(layer.clone()));
            if !pm.extended_data.is_empty() {
                props.insert(
                    "kmlData".to_owned(),
                    Value::Object(pm.extended_data.clone()),
                );
            }

            let base_id = pm
                .id
                .clone()
                .map(|id| {
                    if g_idx == 0 {
                        format!("kml-{id}")
                    } else {
                        format!("kml-{id}-{g_idx}")
                    }
                })
                .unwrap_or_else(|| format!("kml-{}-{}", idx + 1, g_idx + 1));
            let count = seen_ids.entry(base_id.clone()).or_insert(0);
            *count += 1;
            let unique_id = if *count == 1 {
                base_id
            } else {
                format!("{base_id}-{}", *count)
            };

            features.push(json!({
                "type": "Feature",
                "id": unique_id,
                "geometry": geom,
                "properties": props,
            }));
        }
    }

    if features.is_empty() {
        return Err(GeoError::EmptyResult(
            "KML contains no supported Point, LineString, or Polygon geometry",
        ));
    }

    let feature_count = features.len();
    let fc = json!({
        "type": "FeatureCollection",
        "name": doc_title,
        "features": features,
    });
    validate_feature_collection(&fc)?;

    Ok(SpatialImportResult {
        format: "kml".to_owned(),
        title: doc_title,
        geojson: fc,
        feature_count,
        warnings,
    })
}

#[allow(clippy::too_many_arguments)]
fn handle_kml_text(
    stack: &[String],
    trimmed: &str,
    doc_name: &mut Option<String>,
    folder_stack: &mut [String],
    cur_style_props: &mut KmlStyleProps,
    cur_pair_key: &mut Option<String>,
    cur_pair_url: &mut Option<String>,
    cur_pm: &mut Option<PlacemarkBuilder>,
    cur_data_key: &Option<String>,
) {
    let current = stack.last().map(String::as_str).unwrap_or("");
    let parent = stack
        .len()
        .checked_sub(2)
        .and_then(|i| stack.get(i))
        .map(String::as_str)
        .unwrap_or("");

    // Style properties apply either to top-level <Style> or inline <Placemark><Style>
    if matches!(parent, "PolyStyle" | "LineStyle" | "IconStyle") {
        let target_style = match cur_pm.as_mut() {
            Some(pm) => &mut pm.inline_style,
            None => cur_style_props,
        };
        match (parent, current) {
            ("PolyStyle", "color") => {
                if let Some((hex, op)) = parse_kml_aabbggrr(trimmed) {
                    target_style.fill_color = Some(hex);
                    target_style.fill_opacity = Some(op);
                }
            }
            ("PolyStyle", "fill") if trimmed == "0" => target_style.fill_opacity = Some(0.0),
            ("PolyStyle", "outline") if trimmed == "0" => target_style.stroke_opacity = Some(0.0),
            ("LineStyle", "color") => {
                if let Some((hex, op)) = parse_kml_aabbggrr(trimmed) {
                    target_style.stroke_color = Some(hex);
                    target_style.stroke_opacity = Some(op);
                }
            }
            ("LineStyle", "width") => {
                if let Ok(w) = trimmed.parse::<f64>() {
                    if w.is_finite() {
                        target_style.stroke_width = Some(w.clamp(0.0, 20.0));
                    }
                }
            }
            ("IconStyle", "color") => {
                if let Some((hex, op)) = parse_kml_aabbggrr(trimmed) {
                    target_style.fill_color = Some(hex);
                    target_style.fill_opacity = Some(op);
                }
            }
            _ => {}
        }
        return;
    }

    match (parent, current) {
        ("Document", "name") if cur_pm.is_none() && folder_stack.is_empty() => {
            if doc_name.is_none() {
                *doc_name = Some(trimmed.to_owned());
            }
        }
        ("Folder", "name") if cur_pm.is_none() => {
            if let Some(last) = folder_stack.last_mut() {
                *last = trimmed.to_owned();
            }
        }
        ("Pair", "key") => *cur_pair_key = Some(trimmed.to_owned()),
        ("Pair", "styleUrl") => *cur_pair_url = Some(trimmed.to_owned()),
        ("Placemark", "name") => {
            if let Some(pm) = cur_pm.as_mut() {
                pm.name = Some(trimmed.to_owned());
            }
        }
        ("Placemark", "description") => {
            if let Some(pm) = cur_pm.as_mut() {
                pm.description = Some(strip_html_plain(trimmed));
            }
        }
        ("Placemark", "styleUrl") => {
            if let Some(pm) = cur_pm.as_mut() {
                pm.style_url = Some(trimmed.to_owned());
            }
        }
        ("Data", "value") => {
            if let (Some(pm), Some(key)) = (cur_pm.as_mut(), cur_data_key.as_ref()) {
                if !matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                    pm.extended_data
                        .insert(key.clone(), Value::String(strip_html_plain(trimmed)));
                }
            }
        }
        ("SchemaData" | "ExtendedData", "SimpleData") => {
            if let (Some(pm), Some(key)) = (cur_pm.as_mut(), cur_data_key.as_ref()) {
                if !matches!(key.as_str(), "__proto__" | "constructor" | "prototype") {
                    pm.extended_data
                        .insert(key.clone(), Value::String(strip_html_plain(trimmed)));
                }
            }
        }
        _ => {}
    }
}

/// Serializes a GeoJSON `FeatureCollection` into a standards-compliant KML 2.2 document.
pub fn geojson_to_kml(fc: &Value, title: Option<&str>) -> Result<String, GeoError> {
    let features = fc
        .get("features")
        .and_then(|v| v.as_array())
        .ok_or_else(|| GeoError::InvalidGeoJson("FeatureCollection missing features array".to_owned()))?;

    let doc_name = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| fc.get("name").and_then(|v| v.as_str()))
        .unwrap_or("Earthly Map");

    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <kml xmlns=\"http://www.opengis.net/kml/2.2\">\n\
         <Document>\n",
    );
    let _ = writeln!(out, "  <name>{}</name>", xml_escape(doc_name));

    for (idx, feature) in features.iter().enumerate() {
        let Some(geom) = feature.get("geometry") else {
            continue;
        };
        let props = feature.get("properties").and_then(|v| v.as_object());
        let name = props
            .and_then(|p| p.get("name").or_else(|| p.get("title")).or_else(|| p.get("label")))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| format!("Feature {}", idx + 1));
        let desc = props
            .and_then(|p| p.get("description"))
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty());

        let stroke_hex = props
            .and_then(|p| p.get("strokeColor").or_else(|| p.get("color")))
            .and_then(|v| v.as_str())
            .unwrap_or("#d97706");
        let fill_hex = props
            .and_then(|p| p.get("fillColor").or_else(|| p.get("color")))
            .and_then(|v| v.as_str())
            .unwrap_or(stroke_hex);
        let fill_opacity = props
            .and_then(|p| p.get("fillOpacity"))
            .and_then(|v| v.as_f64())
            .unwrap_or(0.35);
        let stroke_width = props
            .and_then(|p| p.get("strokeWidth"))
            .and_then(|v| v.as_f64())
            .unwrap_or(3.0);

        out.push_str("  <Placemark>\n");
        let _ = writeln!(out, "    <name>{}</name>", xml_escape(&name));
        if let Some(d) = desc {
            let _ = writeln!(out, "    <description>{}</description>", xml_escape(d));
        }
        let _ = writeln!(
            out,
            "    <Style><LineStyle><color>{}</color><width>{:.1}</width></LineStyle><PolyStyle><color>{}</color></PolyStyle></Style>",
            hex_to_kml_aabbggrr(stroke_hex, 1.0),
            stroke_width,
            hex_to_kml_aabbggrr(fill_hex, fill_opacity),
        );
        write_kml_geometry(&mut out, geom);
        out.push_str("  </Placemark>\n");
    }

    out.push_str("</Document>\n</kml>\n");
    Ok(out)
}

fn format_kml_coord(pt: &[Value]) -> Option<String> {
    let lon = pt.first()?.as_f64()?;
    let lat = pt.get(1)?.as_f64()?;
    if let Some(alt) = pt.get(2).and_then(|v| v.as_f64()) {
        Some(format!("{lon:.7},{lat:.7},{alt:.2}"))
    } else {
        Some(format!("{lon:.7},{lat:.7},0"))
    }
}

fn format_kml_coord_list(coords: &[Value]) -> String {
    coords
        .iter()
        .filter_map(|p| p.as_array().and_then(|a| format_kml_coord(a)))
        .collect::<Vec<_>>()
        .join(" ")
}

fn write_kml_geometry(out: &mut String, geom: &Value) {
    match geom.get("type").and_then(|v| v.as_str()).unwrap_or("") {
        "Point" => {
            if let Some(c) = geom
                .get("coordinates")
                .and_then(|v| v.as_array())
                .and_then(|a| format_kml_coord(a))
            {
                let _ = writeln!(out, "    <Point><coordinates>{c}</coordinates></Point>");
            }
        }
        "LineString" => {
            if let Some(coords) = geom.get("coordinates").and_then(|v| v.as_array()) {
                let _ = writeln!(
                    out,
                    "    <LineString><coordinates>{}</coordinates></LineString>",
                    format_kml_coord_list(coords)
                );
            }
        }
        "Polygon" => {
            if let Some(rings) = geom.get("coordinates").and_then(|v| v.as_array()) {
                if let Some(outer) = rings.first().and_then(|v| v.as_array()) {
                    out.push_str("    <Polygon>\n");
                    let _ = writeln!(
                        out,
                        "      <outerBoundaryIs><LinearRing><coordinates>{}</coordinates></LinearRing></outerBoundaryIs>",
                        format_kml_coord_list(outer)
                    );
                    for inner in rings.iter().skip(1) {
                        if let Some(arr) = inner.as_array() {
                            let _ = writeln!(
                                out,
                                "      <innerBoundaryIs><LinearRing><coordinates>{}</coordinates></LinearRing></innerBoundaryIs>",
                                format_kml_coord_list(arr)
                            );
                        }
                    }
                    out.push_str("    </Polygon>\n");
                }
            }
        }
        "MultiPoint" => {
            if let Some(pts) = geom.get("coordinates").and_then(|v| v.as_array()) {
                out.push_str("    <MultiGeometry>\n");
                for pt in pts {
                    if let Some(c) = pt.as_array().and_then(|a| format_kml_coord(a)) {
                        let _ = writeln!(out, "      <Point><coordinates>{c}</coordinates></Point>");
                    }
                }
                out.push_str("    </MultiGeometry>\n");
            }
        }
        "MultiLineString" => {
            if let Some(lines) = geom.get("coordinates").and_then(|v| v.as_array()) {
                out.push_str("    <MultiGeometry>\n");
                for line in lines {
                    if let Some(arr) = line.as_array() {
                        let _ = writeln!(
                            out,
                            "      <LineString><coordinates>{}</coordinates></LineString>",
                            format_kml_coord_list(arr)
                        );
                    }
                }
                out.push_str("    </MultiGeometry>\n");
            }
        }
        "MultiPolygon" => {
            if let Some(polys) = geom.get("coordinates").and_then(|v| v.as_array()) {
                out.push_str("    <MultiGeometry>\n");
                for poly in polys {
                    write_kml_geometry(out, &json!({ "type": "Polygon", "coordinates": poly }));
                }
                out.push_str("    </MultiGeometry>\n");
            }
        }
        _ => {}
    }
}

/// Auto-detects GeoJSON, GPX, or KML from filename extension or XML/JSON content
/// and converts it into a validated Earthly GeoJSON FeatureCollection.
pub fn import_spatial_text_to_geojson(
    filename: Option<&str>,
    content: &str,
) -> Result<SpatialImportResult, GeoError> {
    let trimmed = content.trim_start_matches('\u{feff}').trim();
    if trimmed.is_empty() {
        return Err(GeoError::InvalidParameter("Spatial file is empty".to_owned()));
    }
    let ext = filename
        .and_then(|f| f.rsplit_once('.'))
        .map(|(_, e)| e.to_ascii_lowercase());

    let detected = match ext.as_deref() {
        Some("gpx") => "gpx",
        Some("kml") => "kml",
        Some("csv" | "tsv") => "csv",
        Some("geojson" | "json") => "geojson",
        _ => {
            let head = &trimmed[..trimmed.len().min(256)].to_ascii_lowercase();
            if head.contains("<gpx") {
                "gpx"
            } else if head.contains("<kml") {
                "kml"
            } else if !(trimmed.starts_with('{') || trimmed.starts_with('['))
                && (head.contains("lat") && (head.contains("lon") || head.contains("lng")))
            {
                "csv"
            } else {
                "geojson"
            }
        }
    };

    match detected {
        "gpx" => parse_gpx_to_geojson(trimmed),
        "kml" => parse_kml_to_geojson(trimmed),
        "csv" => parse_csv_to_geojson(filename, trimmed),
        _ => {
            let parsed: Value = serde_json::from_str(trimmed)
                .map_err(|err| GeoError::InvalidGeoJson(err.to_string()))?;
            let fc = match parsed.get("type").and_then(|v| v.as_str()) {
                Some("FeatureCollection") => parsed,
                Some("Feature") => json!({
                    "type": "FeatureCollection",
                    "features": [parsed],
                }),
                _ => {
                    return Err(GeoError::InvalidGeoJson(
                        "Expected GeoJSON FeatureCollection or Feature".to_owned(),
                    ));
                }
            };
            let summary = validate_feature_collection(&fc)?;
            let fallback_title = filename
                .map(|f| {
                    f.rsplit_once('.')
                        .map(|(stem, _)| stem)
                        .unwrap_or(f)
                        .to_owned()
                })
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Imported Map".to_owned());
            let title = fc
                .get("name")
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or(fallback_title);
            Ok(SpatialImportResult {
                format: "geojson".to_owned(),
                title,
                geojson: fc,
                feature_count: summary.feature_count,
                warnings: Vec::new(),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpx_round_trip_preserves_waypoints_tracks_and_routes() {
        let gpx = r#"<?xml version="1.0" encoding="UTF-8"?>
        <gpx version="1.1" creator="test">
          <metadata><name>Vienna Trail</name></metadata>
          <wpt lat="48.2082" lon="16.3738"><ele>171</ele><name>Stephansplatz</name><desc>Start point</desc></wpt>
          <trk>
            <name>Danube Run</name>
            <trkseg>
              <trkpt lat="48.2100" lon="16.3700"><ele>165</ele></trkpt>
              <trkpt lat="48.2200" lon="16.3800"><ele>162</ele></trkpt>
            </trkseg>
          </trk>
          <rte>
            <name>Return Leg</name>
            <rtept lat="48.2200" lon="16.3800" />
            <rtept lat="48.2082" lon="16.3738" />
          </rte>
        </gpx>"#;

        let imported = import_spatial_text_to_geojson(Some("vienna.gpx"), gpx).unwrap();
        assert_eq!(imported.format, "gpx");
        assert_eq!(imported.title, "Vienna Trail");
        assert_eq!(imported.feature_count, 3);

        let exported = geojson_to_gpx(&imported.geojson, Some("Vienna Trail")).unwrap();
        assert!(exported.contains("<wpt lat=\"48.2082000\" lon=\"16.3738000\">"));
        assert!(exported.contains("<name>Danube Run</name>"));

        let reimported = parse_gpx_to_geojson(&exported).unwrap();
        assert_eq!(reimported.feature_count, 3);
    }

    #[test]
    fn kml_round_trip_translates_aabbggrr_styles_and_polygons() {
        let kml = r#"<?xml version="1.0" encoding="UTF-8"?>
        <kml xmlns="http://www.opengis.net/kml/2.2">
          <Document>
            <name>Alpine Zones</name>
            <Style id="zoneStyle">
              <LineStyle><color>ff0066cc</color><width>3</width></LineStyle>
              <PolyStyle><color>803399ff</color></PolyStyle>
            </Style>
            <Folder>
              <name>Camps</name>
              <Placemark id="pm1">
                <name>Base Camp</name>
                <description><![CDATA[<b>High</b><br/>Camp]]></description>
                <styleUrl>#zoneStyle</styleUrl>
                <Point><coordinates>16.3738,48.2082,0</coordinates></Point>
              </Placemark>
              <Placemark id="pm2">
                <name>Protected Meadow</name>
                <styleUrl>#zoneStyle</styleUrl>
                <Polygon>
                  <outerBoundaryIs><LinearRing><coordinates>16.30,48.20,0 16.35,48.20,0 16.35,48.25,0 16.30,48.20,0</coordinates></LinearRing></outerBoundaryIs>
                </Polygon>
              </Placemark>
            </Folder>
          </Document>
        </kml>"#;

        let imported = import_spatial_text_to_geojson(Some("alpine.kml"), kml).unwrap();
        assert_eq!(imported.format, "kml");
        assert_eq!(imported.title, "Alpine Zones");
        assert_eq!(imported.feature_count, 2);

        let feats = imported.geojson["features"].as_array().unwrap();
        assert_eq!(feats[0]["properties"]["strokeColor"], "#cc6600");
        assert_eq!(feats[0]["properties"]["fillColor"], "#ff9933");
        assert_eq!(feats[0]["properties"]["sourceLayer"], "Camps");
        assert_eq!(feats[0]["properties"]["description"], "High\nCamp");

        let exported = geojson_to_kml(&imported.geojson, Some("Alpine Zones")).unwrap();
        assert!(exported.contains("<name>Base Camp</name>"));
        assert!(exported.contains("<Polygon>"));

        let reimported = parse_kml_to_geojson(&exported).unwrap();
        assert_eq!(reimported.feature_count, 2);
    }

    #[test]
    fn rejects_xml_doctype_entities() {
        let bad = "<!DOCTYPE kml [<!ENTITY xxe SYSTEM \"file:///etc/passwd\">]><kml/>";
        assert!(parse_kml_to_geojson(bad).is_err());
        assert!(parse_gpx_to_geojson(bad).is_err());
    }

    #[test]
    fn csv_table_imports_points_and_attributes() {
        let csv = "name,latitude,longitude,elevation\n\"Base Camp, North\",48.2082,16.3738,171\nBadRow,999,16.3,10\nDanube Pier,48.2160,16.3959,162\n";
        let res = import_spatial_text_to_geojson(Some("camps.csv"), csv).unwrap();
        assert_eq!(res.format, "csv");
        assert_eq!(res.title, "camps");
        assert_eq!(res.feature_count, 2);
        assert_eq!(res.warnings.len(), 1);
        let feats = res.geojson["features"].as_array().unwrap();
        assert_eq!(feats[0]["properties"]["name"], "Base Camp, North");
        assert_eq!(feats[0]["geometry"]["coordinates"], json!([16.3738, 48.2082]));
    }
}

fn split_delimited_line(line: &str, delim: char) -> Vec<String> {
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '"' {
            if in_quotes && chars.peek() == Some(&'"') {
                cur.push('"');
                chars.next();
            } else {
                in_quotes = !in_quotes;
            }
        } else if ch == delim && !in_quotes {
            cells.push(cur.trim().to_owned());
            cur.clear();
        } else {
            cur.push(ch);
        }
    }
    cells.push(cur.trim().to_owned());
    cells
}

/// Parses CSV or TSV tabular points with WGS-84 latitude/longitude columns
/// into a validated Earthly GeoJSON `FeatureCollection`.
pub fn parse_csv_to_geojson(
    filename: Option<&str>,
    text: &str,
) -> Result<SpatialImportResult, GeoError> {
    let trimmed = text.trim_start_matches('\u{feff}').trim();
    if trimmed.len() > MAX_XML_BYTES {
        return Err(GeoError::InvalidParameter(
            "CSV file exceeds 10 MiB limit".to_owned(),
        ));
    }
    let mut lines = trimmed.lines().filter(|l| !l.trim().is_empty());
    let Some(header_line) = lines.next() else {
        return Err(GeoError::InvalidParameter("CSV file is empty".to_owned()));
    };

    let delim = if header_line.matches('\t').count() > header_line.matches(',').count() {
        '\t'
    } else if header_line.matches(';').count() > header_line.matches(',').count() {
        ';'
    } else {
        ','
    };

    let headers = split_delimited_line(header_line, delim);
    if headers.len() < 2 {
        return Err(GeoError::InvalidParameter(
            "CSV header must contain at least latitude and longitude columns".to_owned(),
        ));
    }

    let lat_col = headers.iter().position(|h| is_lat_header(h));
    let lon_col = headers.iter().position(|h| is_lon_header(h));
    let (Some(lat_idx), Some(lon_idx)) = (lat_col, lon_col) else {
        return Err(GeoError::InvalidParameter(
            "CSV missing lat/latitude and lon/lng/longitude columns".to_owned(),
        ));
    };

    let mut features = Vec::new();
    let mut skipped_rows = 0usize;
    for line in lines {
        if features.len() >= MAX_FEATURES {
            break;
        }
        let cells = split_delimited_line(line, delim);
        let id = format!("csv-{}", features.len() + 1);
        match build_point_feature_from_row(&headers, &cells, lat_idx, lon_idx, &id, "csv", None) {
            Some(feat) => features.push(feat),
            None => skipped_rows += 1,
        }
    }

    if features.is_empty() {
        return Err(GeoError::InvalidParameter(
            "No valid WGS-84 coordinate rows found in CSV".to_owned(),
        ));
    }

    let mut warnings = Vec::new();
    if skipped_rows > 0 {
        warnings.push(format!(
            "Skipped {skipped_rows} CSV row(s) with missing or out-of-range coordinates."
        ));
    }
    let title = filename
        .map(|f| f.rsplit_once('.').map(|(s, _)| s).unwrap_or(f).to_owned())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "Imported CSV".to_owned());

    let fc = json!({
        "type": "FeatureCollection",
        "name": title,
        "features": features,
    });
    let summary = validate_feature_collection(&fc)?;
    Ok(SpatialImportResult {
        format: "csv".to_owned(),
        title,
        geojson: fc,
        feature_count: summary.feature_count,
        warnings,
    })
}

fn is_lat_header(h: &str) -> bool {
    matches!(
        h.trim().to_ascii_lowercase().as_str(),
        "lat" | "latitude" | "y" | "lat_deg" | "wgs84_lat"
    )
}

fn is_lon_header(h: &str) -> bool {
    matches!(
        h.trim().to_ascii_lowercase().as_str(),
        "lon" | "lng" | "long" | "longitude" | "x" | "lon_deg" | "wgs84_lon"
    )
}

fn is_name_header(h: &str) -> bool {
    matches!(
        h.trim().to_ascii_lowercase().as_str(),
        "name" | "title" | "label"
    )
}

fn build_point_feature_from_row(
    headers: &[String],
    cells: &[String],
    lat_idx: usize,
    lon_idx: usize,
    id: &str,
    source_format: &str,
    source_sheet: Option<&str>,
) -> Option<Value> {
    let lat = cells.get(lat_idx).and_then(|s| s.trim().parse::<f64>().ok())?;
    let lon = cells.get(lon_idx).and_then(|s| s.trim().parse::<f64>().ok())?;
    if parse_valid_lon_lat(lon, lat).is_err() {
        return None;
    }

    let mut props = Map::new();
    for (i, hdr) in headers.iter().enumerate() {
        if i == lat_idx || i == lon_idx {
            continue;
        }
        let Some(val) = cells.get(i).map(|s| s.trim()).filter(|s| !s.is_empty()) else {
            continue;
        };
        let key = if hdr.trim().is_empty() {
            format!("col_{}", i + 1)
        } else {
            hdr.clone()
        };
        props.insert(key, Value::String(val.to_owned()));
        if !props.contains_key("name") && is_name_header(hdr) {
            props.insert("name".to_owned(), Value::String(val.to_owned()));
        }
    }
    if source_format != "csv" {
        props.insert(
            "sourceFormat".to_owned(),
            Value::String(source_format.to_owned()),
        );
    }
    if let Some(sheet) = source_sheet.filter(|s| !s.is_empty()) {
        props.insert("sourceSheet".to_owned(), Value::String(sheet.to_owned()));
    }

    Some(json!({
        "type": "Feature",
        "id": id,
        "geometry": { "type": "Point", "coordinates": [lon, lat] },
        "properties": Value::Object(props),
    }))
}

const MAX_XLSX_ARCHIVE_BYTES: usize = 25 * 1024 * 1024;
const MAX_XLSX_ENTRY_BYTES: usize = 10 * 1024 * 1024;
const MAX_XLSX_TABLE_ROWS: usize = 200;
const MAX_XLSX_SHEETS: usize = 16;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxSheetSummary {
    pub name: String,
    pub row_count: usize,
    pub column_count: usize,
    pub headers: Vec<String>,
    pub markdown_table: String,
    pub csv_text: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XlsxParseResult {
    pub title: String,
    pub sheets: Vec<XlsxSheetSummary>,
    pub markdown_table: String,
    pub csv_text: String,
    pub geojson: Option<Value>,
    pub feature_count: usize,
    pub warnings: Vec<String>,
}

fn read_u16_le(bytes: &[u8], off: usize) -> Option<u16> {
    bytes
        .get(off..off + 2)
        .map(|s| u16::from_le_bytes([s[0], s[1]]))
}

fn read_u32_le(bytes: &[u8], off: usize) -> Option<u32> {
    bytes
        .get(off..off + 4)
        .map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn extract_xlsx_xml_entries(archive: &[u8]) -> Result<HashMap<String, String>, GeoError> {
    if archive.is_empty() {
        return Err(GeoError::InvalidParameter("XLSX file is empty".to_owned()));
    }
    if archive.len() > MAX_XLSX_ARCHIVE_BYTES {
        return Err(GeoError::InvalidParameter(
            "XLSX archive exceeds 25 MiB limit".to_owned(),
        ));
    }

    let min_eocd_off = archive.len().saturating_sub(22 + 65_535);
    let mut eocd_off = None;
    let mut pos = archive.len().saturating_sub(22);
    loop {
        if pos + 4 <= archive.len() && &archive[pos..pos + 4] == b"PK\x05\x06" {
            eocd_off = Some(pos);
            break;
        }
        if pos <= min_eocd_off {
            break;
        }
        pos -= 1;
    }
    let Some(eocd) = eocd_off else {
        return Err(GeoError::InvalidParameter(
            "Invalid XLSX archive (missing ZIP central directory)".to_owned(),
        ));
    };

    let entry_count = read_u16_le(archive, eocd + 10).unwrap_or(0) as usize;
    let cd_offset = read_u32_le(archive, eocd + 16).unwrap_or(0) as usize;
    let mut cursor = cd_offset;
    let mut out = HashMap::new();

    for _ in 0..entry_count {
        if cursor + 46 > archive.len() || &archive[cursor..cursor + 4] != b"PK\x01\x02" {
            break;
        }
        let method = read_u16_le(archive, cursor + 10).unwrap_or(0);
        let compressed_size = read_u32_le(archive, cursor + 20).unwrap_or(0) as usize;
        let uncompressed_size = read_u32_le(archive, cursor + 24).unwrap_or(0) as usize;
        let name_len = read_u16_le(archive, cursor + 28).unwrap_or(0) as usize;
        let extra_len = read_u16_le(archive, cursor + 30).unwrap_or(0) as usize;
        let comment_len = read_u16_le(archive, cursor + 32).unwrap_or(0) as usize;
        let local_header_off = read_u32_le(archive, cursor + 42).unwrap_or(0) as usize;

        let name_start = cursor + 46;
        let name_end = name_start + name_len;
        if name_end > archive.len() {
            break;
        }
        let raw_name = String::from_utf8_lossy(&archive[name_start..name_end]).into_owned();
        cursor = name_end + extra_len + comment_len;

        let normalized = raw_name
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_owned();
        if normalized.ends_with('/')
            || normalized.contains("__MACOSX/")
            || normalized.split('/').any(|seg| seg == "..")
        {
            continue;
        }
        let lower = normalized.to_ascii_lowercase();
        let wanted = lower == "xl/workbook.xml"
            || lower == "xl/_rels/workbook.xml.rels"
            || lower == "xl/sharedstrings.xml"
            || (lower.starts_with("xl/worksheets/") && lower.ends_with(".xml"));
        if !wanted {
            continue;
        }
        if uncompressed_size > MAX_XLSX_ENTRY_BYTES || compressed_size > MAX_XLSX_ENTRY_BYTES {
            return Err(GeoError::InvalidParameter(format!(
                "XLSX entry {normalized} exceeds 10 MiB limit"
            )));
        }
        if local_header_off + 30 > archive.len()
            || &archive[local_header_off..local_header_off + 4] != b"PK\x03\x04"
        {
            return Err(GeoError::InvalidParameter(format!(
                "Invalid ZIP local header for {normalized}"
            )));
        }
        let lh_name_len = read_u16_le(archive, local_header_off + 26).unwrap_or(0) as usize;
        let lh_extra_len = read_u16_le(archive, local_header_off + 28).unwrap_or(0) as usize;
        let data_start = local_header_off + 30 + lh_name_len + lh_extra_len;
        let data_end = data_start + compressed_size;
        if data_end > archive.len() {
            return Err(GeoError::InvalidParameter(format!(
                "Truncated ZIP payload for {normalized}"
            )));
        }

        let payload = &archive[data_start..data_end];
        let raw_bytes = match method {
            0 => payload.to_vec(),
            8 => {
                let decoder = DeflateDecoder::new(payload);
                let mut buf = Vec::with_capacity(uncompressed_size.min(512 * 1024));
                decoder
                    .take((MAX_XLSX_ENTRY_BYTES + 1) as u64)
                    .read_to_end(&mut buf)
                    .map_err(|e| {
                        GeoError::InvalidParameter(format!(
                            "Failed to inflate XLSX entry {normalized}: {e}"
                        ))
                    })?;
                if buf.len() > MAX_XLSX_ENTRY_BYTES {
                    return Err(GeoError::InvalidParameter(format!(
                        "XLSX entry {normalized} exceeds 10 MiB limit"
                    )));
                }
                buf
            }
            other => {
                return Err(GeoError::InvalidParameter(format!(
                    "Unsupported ZIP compression method ({other}) for {normalized}"
                )));
            }
        };

        let xml = String::from_utf8_lossy(&raw_bytes).into_owned();
        check_xml_safety(&xml)?;
        out.insert(lower, xml);
    }

    Ok(out)
}

fn parse_xlsx_shared_strings(xml: &str) -> Result<Vec<String>, GeoError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut strings = Vec::new();
    let mut in_si = false;
    let mut in_t = false;
    let mut current = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = local_name(e.name().as_ref());
                if tag == "si" {
                    in_si = true;
                    current.clear();
                } else if in_si && tag == "t" {
                    in_t = true;
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = local_name(e.name().as_ref());
                if tag == "si" {
                    strings.push(String::new());
                }
            }
            Ok(Event::Text(e)) => {
                if in_si && in_t {
                    if let Ok(t) = e.decode() {
                        current.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_si && in_t {
                    current.push_str(&String::from_utf8_lossy(e.as_ref()));
                }
            }
            Ok(Event::End(e)) => {
                let tag = local_name(e.name().as_ref());
                if tag == "t" {
                    in_t = false;
                } else if tag == "si" && in_si {
                    strings.push(std::mem::take(&mut current));
                    in_si = false;
                    in_t = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid XLSX sharedStrings XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(strings)
}

fn parse_xlsx_workbook_rels(xml: &str) -> Result<HashMap<String, String>, GeoError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut map = HashMap::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name(e.name().as_ref()) == "Relationship" {
                    if let (Some(id), Some(target)) = (attr_str(&e, "Id"), attr_str(&e, "Target")) {
                        let clean = target.replace('\\', "/");
                        let full = if clean.starts_with('/') {
                            clean.trim_start_matches('/').to_ascii_lowercase()
                        } else if clean.to_ascii_lowercase().starts_with("xl/") {
                            clean.to_ascii_lowercase()
                        } else {
                            format!("xl/{}", clean.trim_start_matches("./")).to_ascii_lowercase()
                        };
                        map.insert(id, full);
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid XLSX workbook rels XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(map)
}

fn parse_xlsx_workbook_sheets(
    xml: &str,
    rels: &HashMap<String, String>,
) -> Result<Vec<(String, String)>, GeoError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    let mut sheets = Vec::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) | Ok(Event::Empty(e)) => {
                if local_name(e.name().as_ref()) == "sheet" {
                    let name = attr_str(&e, "name")
                        .filter(|s| !s.trim().is_empty())
                        .unwrap_or_else(|| format!("Sheet{}", sheets.len() + 1));
                    let path = attr_str(&e, "id")
                        .and_then(|rid| rels.get(&rid).cloned())
                        .unwrap_or_else(|| {
                            format!("xl/worksheets/sheet{}.xml", sheets.len() + 1)
                        });
                    sheets.push((name, path));
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid XLSX workbook XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }
    Ok(sheets)
}

fn parse_xlsx_col_index(cell_ref: &str) -> Option<usize> {
    let mut col: usize = 0;
    let mut saw_letter = false;
    for b in cell_ref.trim().bytes() {
        if b.is_ascii_alphabetic() {
            saw_letter = true;
            let idx = (b.to_ascii_uppercase() - b'A') as usize + 1;
            col = col.checked_mul(26)?.checked_add(idx)?;
        } else {
            break;
        }
    }
    if saw_letter && col > 0 {
        Some(col - 1)
    } else {
        None
    }
}

fn parse_xlsx_sheet_rows(xml: &str, shared_strings: &[String]) -> Result<Vec<Vec<String>>, GeoError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(false);
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut cur_row: Vec<String> = Vec::new();
    let mut in_row = false;
    let mut in_cell = false;
    let mut cell_type = String::new();
    let mut cell_col_idx: Option<usize> = None;
    let mut in_v = false;
    let mut in_is = false;
    let mut in_t = false;
    let mut val_buf = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "row" => {
                        in_row = true;
                        cur_row.clear();
                    }
                    "c" if in_row => {
                        in_cell = true;
                        cell_type = attr_str(&e, "t").unwrap_or_default();
                        cell_col_idx = attr_str(&e, "r").and_then(|r| parse_xlsx_col_index(&r));
                        val_buf.clear();
                        in_v = false;
                        in_is = false;
                        in_t = false;
                    }
                    "v" if in_cell => {
                        in_v = true;
                    }
                    "is" if in_cell => {
                        in_is = true;
                    }
                    "t" if in_cell && in_is => {
                        in_t = true;
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(e)) => {
                let tag = local_name(e.name().as_ref());
                if tag == "c" && in_row {
                    let idx = attr_str(&e, "r")
                        .and_then(|r| parse_xlsx_col_index(&r))
                        .unwrap_or(cur_row.len());
                    if idx >= cur_row.len() && idx < 512 {
                        cur_row.resize(idx + 1, String::new());
                    }
                }
            }
            Ok(Event::Text(e)) => {
                if in_cell && (in_v || (in_is && in_t)) {
                    if let Ok(t) = e.decode() {
                        val_buf.push_str(&t);
                    }
                }
            }
            Ok(Event::CData(e)) => {
                if in_cell && (in_v || (in_is && in_t)) {
                    val_buf.push_str(&String::from_utf8_lossy(e.as_ref()));
                }
            }
            Ok(Event::End(e)) => {
                let tag = local_name(e.name().as_ref());
                match tag.as_str() {
                    "v" => in_v = false,
                    "t" => in_t = false,
                    "is" => in_is = false,
                    "c" if in_cell => {
                        let resolved = match cell_type.as_str() {
                            "s" => val_buf
                                .trim()
                                .parse::<usize>()
                                .ok()
                                .and_then(|i| shared_strings.get(i))
                                .cloned()
                                .unwrap_or_default(),
                            "b" => match val_buf.trim() {
                                "1" => "true".to_owned(),
                                "0" => "false".to_owned(),
                                other => other.to_owned(),
                            },
                            _ => val_buf.clone(),
                        };
                        let idx = cell_col_idx.unwrap_or(cur_row.len());
                        if idx < 512 {
                            if idx >= cur_row.len() {
                                cur_row.resize(idx + 1, String::new());
                            }
                            cur_row[idx] = resolved;
                        }
                        in_cell = false;
                        val_buf.clear();
                    }
                    "row" if in_row => {
                        while cur_row.last().is_some_and(|c| c.trim().is_empty()) {
                            cur_row.pop();
                        }
                        if !cur_row.is_empty() {
                            rows.push(std::mem::take(&mut cur_row));
                        }
                        in_row = false;
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                return Err(GeoError::InvalidParameter(format!(
                    "Invalid XLSX worksheet XML: {err}"
                )));
            }
            _ => {}
        }
        buf.clear();
    }

    Ok(rows)
}

fn escape_markdown_cell(raw: &str) -> String {
    raw.trim()
        .replace('\r', " ")
        .replace('\n', " ")
        .replace('|', "\\|")
}

fn escape_csv_cell(raw: &str) -> String {
    let clean = raw.replace('\r', "");
    if clean.contains([',', '"', '\n']) {
        format!("\"{}\"", clean.replace('"', "\"\""))
    } else {
        clean
    }
}

fn format_sheet_tables(
    headers: &[String],
    data_rows: &[&Vec<String>],
    truncated: bool,
) -> (String, String) {
    let col_count = headers.len().max(1);
    let norm_headers: Vec<String> = (0..col_count)
        .map(|i| {
            headers
                .get(i)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("col_{}", i + 1))
        })
        .collect();

    let mut md = String::new();
    let _ = writeln!(
        md,
        "| {} |",
        norm_headers
            .iter()
            .map(|h| escape_markdown_cell(h))
            .collect::<Vec<_>>()
            .join(" | ")
    );
    let _ = writeln!(
        md,
        "| {} |",
        vec!["---"; col_count].join(" | ")
    );

    let mut csv = String::new();
    let _ = writeln!(
        csv,
        "{}",
        norm_headers
            .iter()
            .map(|h| escape_csv_cell(h))
            .collect::<Vec<_>>()
            .join(",")
    );

    for row in data_rows {
        let md_cells: Vec<String> = (0..col_count)
            .map(|i| escape_markdown_cell(row.get(i).map(String::as_str).unwrap_or("")))
            .collect();
        let _ = writeln!(md, "| {} |", md_cells.join(" | "));

        let csv_cells: Vec<String> = (0..col_count)
            .map(|i| escape_csv_cell(row.get(i).map(String::as_str).unwrap_or("")))
            .collect();
        let _ = writeln!(csv, "{}", csv_cells.join(","));
    }

    if truncated {
        let _ = writeln!(md, "\n_(Truncated to first {MAX_XLSX_TABLE_ROWS} rows)_");
    }

    (md.trim_end().to_owned(), csv.trim_end().to_owned())
}

/// Parses an `.xlsx` OpenXML spreadsheet ZIP archive into capped Markdown/CSV
/// table text and (when `lat`/`lon` columns are detected) a validated GeoJSON
/// `FeatureCollection`.
pub fn parse_xlsx_bytes(
    filename: Option<&str>,
    bytes: &[u8],
) -> Result<XlsxParseResult, GeoError> {
    let entries = extract_xlsx_xml_entries(bytes)?;
    let shared_strings = match entries.get("xl/sharedstrings.xml") {
        Some(xml) => parse_xlsx_shared_strings(xml)?,
        None => Vec::new(),
    };

    let rels = match entries.get("xl/_rels/workbook.xml.rels") {
        Some(xml) => parse_xlsx_workbook_rels(xml)?,
        None => HashMap::new(),
    };

    let mut ordered_sheets: Vec<(String, String)> = match entries.get("xl/workbook.xml") {
        Some(xml) => parse_xlsx_workbook_sheets(xml, &rels)?,
        None => Vec::new(),
    };
    ordered_sheets.retain(|(_, path)| entries.contains_key(path));

    if ordered_sheets.is_empty() {
        let mut fallback_paths: Vec<String> = entries
            .keys()
            .filter(|k| k.starts_with("xl/worksheets/") && k.ends_with(".xml"))
            .cloned()
            .collect();
        fallback_paths.sort();
        for (idx, path) in fallback_paths.into_iter().enumerate() {
            ordered_sheets.push((format!("Sheet{}", idx + 1), path));
        }
    }

    if ordered_sheets.is_empty() {
        return Err(GeoError::InvalidParameter(
            "XLSX archive contains no worksheets".to_owned(),
        ));
    }

    let title = filename
        .map(|f| {
            let base = f.rsplit(['/', '\\']).next().unwrap_or(f);
            base.rsplit_once('.')
                .map(|(stem, _)| stem)
                .unwrap_or(base)
                .trim()
                .to_owned()
        })
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Imported Spreadsheet".to_owned());

    let mut sheets = Vec::new();
    let mut md_sections = Vec::new();
    let mut csv_sections = Vec::new();
    let mut features = Vec::new();
    let mut warnings = Vec::new();
    let mut skipped_geo_rows = 0usize;

    for (sheet_name, sheet_path) in ordered_sheets.into_iter().take(MAX_XLSX_SHEETS) {
        let Some(xml) = entries.get(&sheet_path) else {
            continue;
        };
        let rows = parse_xlsx_sheet_rows(xml, &shared_strings)?;
        if rows.is_empty() {
            continue;
        }
        let header_row = &rows[0];
        let col_count = rows.iter().map(Vec::len).max().unwrap_or(header_row.len());
        let headers: Vec<String> = (0..col_count)
            .map(|i| {
                header_row
                    .get(i)
                    .map(|s| s.trim().to_owned())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| format!("col_{}", i + 1))
            })
            .collect();

        let data_rows_all = &rows[1..];
        let truncated = data_rows_all.len() > MAX_XLSX_TABLE_ROWS;
        if truncated {
            warnings.push(format!(
                "Sheet \"{sheet_name}\" table preview truncated to first {MAX_XLSX_TABLE_ROWS} of {} rows.",
                data_rows_all.len()
            ));
        }
        let capped_rows: Vec<&Vec<String>> =
            data_rows_all.iter().take(MAX_XLSX_TABLE_ROWS).collect();
        let (sheet_md, sheet_csv) = format_sheet_tables(&headers, &capped_rows, truncated);

        if let (Some(lat_idx), Some(lon_idx)) = (
            headers.iter().position(|h| is_lat_header(h)),
            headers.iter().position(|h| is_lon_header(h)),
        ) {
            for row in data_rows_all {
                if features.len() >= MAX_FEATURES {
                    break;
                }
                let id = format!("xlsx-{}", features.len() + 1);
                match build_point_feature_from_row(
                    &headers,
                    row,
                    lat_idx,
                    lon_idx,
                    &id,
                    "xlsx",
                    Some(&sheet_name),
                ) {
                    Some(feat) => features.push(feat),
                    None => skipped_geo_rows += 1,
                }
            }
        }

        md_sections.push(format!("### {sheet_name}\n{sheet_md}"));
        csv_sections.push(format!("# {sheet_name}\n{sheet_csv}"));
        sheets.push(XlsxSheetSummary {
            name: sheet_name,
            row_count: data_rows_all.len(),
            column_count: col_count,
            headers,
            markdown_table: sheet_md,
            csv_text: sheet_csv,
        });
    }

    if sheets.is_empty() {
        return Err(GeoError::InvalidParameter(
            "XLSX worksheets contain no readable rows".to_owned(),
        ));
    }

    if skipped_geo_rows > 0 {
        warnings.push(format!(
            "Skipped {skipped_geo_rows} XLSX row(s) with missing or out-of-range coordinates."
        ));
    }

    let (geojson, feature_count) = if !features.is_empty() {
        let fc = json!({
            "type": "FeatureCollection",
            "name": title,
            "features": features,
        });
        let summary = validate_feature_collection(&fc)?;
        (Some(fc), summary.feature_count)
    } else {
        (None, 0)
    };

    let markdown_table = if sheets.len() == 1 {
        sheets[0].markdown_table.clone()
    } else {
        md_sections.join("\n\n")
    };
    let csv_text = if sheets.len() == 1 {
        sheets[0].csv_text.clone()
    } else {
        csv_sections.join("\n\n")
    };

    Ok(XlsxParseResult {
        title,
        sheets,
        markdown_table,
        csv_text,
        geojson,
        feature_count,
        warnings,
    })
}

/// Parses an `.xlsx` spreadsheet into a GeoJSON `SpatialImportResult` when lat/lon
/// columns are present.
pub fn parse_xlsx_to_geojson(
    filename: Option<&str>,
    bytes: &[u8],
) -> Result<SpatialImportResult, GeoError> {
    let parsed = parse_xlsx_bytes(filename, bytes)?;
    let geojson = parsed.geojson.ok_or_else(|| {
        GeoError::InvalidParameter(
            "XLSX spreadsheet has no valid WGS-84 lat/lon coordinate rows".to_owned(),
        )
    })?;
    Ok(SpatialImportResult {
        format: "xlsx".to_owned(),
        title: parsed.title,
        geojson,
        feature_count: parsed.feature_count,
        warnings: parsed.warnings,
    })
}

#[cfg(test)]
mod xlsx_tests {
    use super::*;
    use flate2::{Compression, Crc, write::DeflateEncoder};
    use std::io::Write as _;

    fn build_test_zip(entries: &[(&str, &[u8], bool)]) -> Vec<u8> {
        let mut zip = Vec::new();
        let mut cd = Vec::new();
        for &(name, raw, deflate) in entries {
            let mut crc_hasher = Crc::new();
            crc_hasher.update(raw);
            let crc = crc_hasher.sum();

            let (method, payload): (u16, Vec<u8>) = if deflate {
                let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
                enc.write_all(raw).unwrap();
                (8, enc.finish().unwrap())
            } else {
                (0, raw.to_vec())
            };

            let local_off = zip.len() as u32;
            zip.extend_from_slice(b"PK\x03\x04");
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&method.to_le_bytes());
            zip.extend_from_slice(&0u32.to_le_bytes());
            zip.extend_from_slice(&crc.to_le_bytes());
            zip.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(raw.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(&payload);

            cd.extend_from_slice(b"PK\x01\x02");
            cd.extend_from_slice(&20u16.to_le_bytes());
            cd.extend_from_slice(&20u16.to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&method.to_le_bytes());
            cd.extend_from_slice(&0u32.to_le_bytes());
            cd.extend_from_slice(&crc.to_le_bytes());
            cd.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            cd.extend_from_slice(&(raw.len() as u32).to_le_bytes());
            cd.extend_from_slice(&(name.len() as u16).to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&0u32.to_le_bytes());
            cd.extend_from_slice(&local_off.to_le_bytes());
            cd.extend_from_slice(name.as_bytes());
        }

        let cd_off = zip.len() as u32;
        let cd_size = cd.len() as u32;
        zip.extend_from_slice(&cd);
        zip.extend_from_slice(b"PK\x05\x06");
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        zip.extend_from_slice(&cd_size.to_le_bytes());
        zip.extend_from_slice(&cd_off.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip
    }

    #[test]
    fn parses_stored_and_deflated_xlsx_into_markdown_csv_and_geojson() {
        let workbook = br#"<?xml version="1.0" encoding="UTF-8"?>
        <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
                  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
          <sheets>
            <sheet name="Trail Camps" sheetId="1" r:id="rId1"/>
            <sheet name="Metadata" sheetId="2" r:id="rId2"/>
          </sheets>
        </workbook>"#;
        let rels = br#"<?xml version="1.0" encoding="UTF-8"?>
        <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
          <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
        </Relationships>"#;
        let shared = br#"<?xml version="1.0" encoding="UTF-8"?>
        <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
          <si><t>name</t></si>
          <si><t>latitude</t></si>
          <si><t>longitude</t></si>
          <si><r><t>Base </t></r><r><t>Camp</t></r></si>
        </sst>"#;
        let sheet1 = br#"<?xml version="1.0" encoding="UTF-8"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1">
              <c r="A1" t="s"><v>0</v></c>
              <c r="B1" t="s"><v>1</v></c>
              <c r="C1" t="s"><v>2</v></c>
              <c r="D1" t="inlineStr"><is><t>open</t></is></c>
            </row>
            <row r="2">
              <c r="A2" t="s"><v>3</v></c>
              <c r="B2"><v>48.2082</v></c>
              <c r="C2"><v>16.3738</v></c>
              <c r="D2" t="b"><v>1</v></c>
            </row>
            <row r="3">
              <c r="A3" t="str"><v>Invalid Peak</v></c>
              <c r="B3"><v>999</v></c>
              <c r="C3"><v>16.40</v></c>
              <c r="D3" t="b"><v>0</v></c>
            </row>
          </sheetData>
        </worksheet>"#;
        let sheet2 = br#"<?xml version="1.0" encoding="UTF-8"?>
        <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
          <sheetData>
            <row r="1"><c r="A1" t="inlineStr"><is><t>region</t></is></c><c r="B1" t="inlineStr"><is><t>notes</t></is></c></row>
            <row r="2"><c r="A2" t="inlineStr"><is><t>Vienna</t></is></c><c r="B2" t="inlineStr"><is><t>Pipe | test</t></is></c></row>
          </sheetData>
        </worksheet>"#;

        let xlsx = build_test_zip(&[
            ("xl/workbook.xml", workbook, true),
            ("xl/_rels/workbook.xml.rels", rels, false),
            ("xl/sharedStrings.xml", shared, true),
            ("xl/worksheets/sheet1.xml", sheet1, true),
            ("xl/worksheets/sheet2.xml", sheet2, false),
        ]);

        let parsed = parse_xlsx_bytes(Some("alpine_sites.xlsx"), &xlsx).unwrap();
        assert_eq!(parsed.title, "alpine_sites");
        assert_eq!(parsed.sheets.len(), 2);
        assert_eq!(parsed.sheets[0].name, "Trail Camps");
        assert_eq!(parsed.sheets[1].name, "Metadata");
        assert!(parsed.markdown_table.contains("| Base Camp | 48.2082 | 16.3738 | true |"));
        assert!(parsed.markdown_table.contains("Pipe \\| test"));
        assert!(parsed.csv_text.contains("Base Camp,48.2082,16.3738,true"));
        assert_eq!(parsed.feature_count, 1);
        assert_eq!(parsed.warnings.len(), 1);

        let fc = parsed.geojson.as_ref().unwrap();
        let feat = &fc["features"][0];
        assert_eq!(feat["geometry"]["coordinates"], json!([16.3738, 48.2082]));
        assert_eq!(feat["properties"]["name"], "Base Camp");
        assert_eq!(feat["properties"]["open"], "true");
        assert_eq!(feat["properties"]["sourceFormat"], "xlsx");
        assert_eq!(feat["properties"]["sourceSheet"], "Trail Camps");

        let spatial = parse_xlsx_to_geojson(Some("alpine_sites.xlsx"), &xlsx).unwrap();
        assert_eq!(spatial.format, "xlsx");
        assert_eq!(spatial.feature_count, 1);
    }

    #[test]
    fn xlsx_caps_table_at_200_rows_and_handles_non_spatial_tables() {
        let mut sheet_xml = String::from(
            r#"<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>"#,
        );
        sheet_xml.push_str(r#"<row r="1"><c r="A1" t="inlineStr"><is><t>item</t></is></c><c r="B1" t="inlineStr"><is><t>count</t></is></c></row>"#);
        for i in 1..=225 {
            let _ = write!(
                sheet_xml,
                r#"<row r="{}"><c r="A{}" t="inlineStr"><is><t>row-{i}</t></is></c><c r="B{}"><v>{i}</v></c></row>"#,
                i + 1,
                i + 1,
                i + 1
            );
        }
        sheet_xml.push_str("</sheetData></worksheet>");

        let xlsx = build_test_zip(&[("xl/worksheets/sheet1.xml", sheet_xml.as_bytes(), true)]);
        let parsed = parse_xlsx_bytes(Some("inventory.xlsx"), &xlsx).unwrap();
        assert_eq!(parsed.feature_count, 0);
        assert!(parsed.geojson.is_none());
        assert!(parsed.markdown_table.contains("row-200"));
        assert!(!parsed.markdown_table.contains("row-201"));
        assert!(parsed.warnings.iter().any(|w| w.contains("200")));
        assert!(parse_xlsx_to_geojson(Some("inventory.xlsx"), &xlsx).is_err());
    }

    #[test]
    fn xlsx_rejects_doctype_xxe_and_corrupt_zip() {
        let evil = br#"<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet/>"#;
        let zip = build_test_zip(&[("xl/worksheets/sheet1.xml", evil, true)]);
        assert!(parse_xlsx_bytes(Some("evil.xlsx"), &zip).is_err());
        assert!(parse_xlsx_bytes(Some("bad.xlsx"), b"not-a-zip").is_err());
    }
}
