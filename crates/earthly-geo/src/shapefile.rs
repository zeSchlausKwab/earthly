//! Pure-Rust ESRI Shapefile (`.shp` / `.dbf` / `.prj` & PKZIP `.zip`) importer
//! converting WGS-84 vector geometries + dBASE attributes into validated
//! GeoJSON `FeatureCollection` payloads.

use std::collections::HashMap;
use std::io::Read;

use flate2::read::DeflateDecoder;
use serde_json::{Map, Value, json};

use crate::{GeoError, SpatialImportResult, validate_feature_collection};

const MAX_ARCHIVE_BYTES: usize = 25 * 1024 * 1024;
const MAX_ENTRY_BYTES: usize = 25 * 1024 * 1024;
const MAX_FEATURES: usize = 5_000;
const MAX_POSITIONS: usize = 100_000;

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

fn read_i32_le(bytes: &[u8], off: usize) -> Option<i32> {
    bytes
        .get(off..off + 4)
        .map(|s| i32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

fn read_u32_be(bytes: &[u8], off: usize) -> Option<u32> {
    bytes
        .get(off..off + 4)
        .map(|s| u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}

fn read_f64_le(bytes: &[u8], off: usize) -> Option<f64> {
    bytes.get(off..off + 8).map(|s| {
        f64::from_le_bytes([s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7]])
    })
}

fn clean_title_stem(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or(raw).trim();
    let stem = base
        .strip_suffix(".zip")
        .or_else(|| base.strip_suffix(".ZIP"))
        .or_else(|| base.strip_suffix(".shp"))
        .or_else(|| base.strip_suffix(".SHP"))
        .unwrap_or(base)
        .trim();
    if stem.is_empty() {
        "Imported Shapefile".to_owned()
    } else {
        stem.to_owned()
    }
}

/// Minimal pure-Rust ZIP reader supporting stored (0) and DEFLATE (8) entries
/// via `flate2` without adding an external zip crate.
fn extract_zip_entries(archive: &[u8]) -> Result<Vec<(String, Vec<u8>)>, GeoError> {
    if archive.len() > MAX_ARCHIVE_BYTES {
        return Err(GeoError::InvalidParameter(
            "Shapefile archive exceeds 25 MiB limit".to_owned(),
        ));
    }

    // Scan backwards for End of Central Directory (PK\x05\x06).
    let min_eocd_off = archive.len().saturating_sub(22 + 65_535);
    let mut eocd_off = None;
    let mut pos = archive.len().saturating_sub(22);
    loop {
        if pos < archive.len().saturating_sub(3)
            && &archive[pos..pos + 4] == b"PK\x05\x06"
        {
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
            "Corrupt ZIP archive (missing central directory)".to_owned(),
        ));
    };

    let entry_count = read_u16_le(archive, eocd + 10).unwrap_or(0) as usize;
    let cd_offset = read_u32_le(archive, eocd + 16).unwrap_or(0) as usize;
    let mut cursor = cd_offset;
    let mut out = Vec::new();

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
        let name = String::from_utf8_lossy(&archive[name_start..name_end]).into_owned();
        cursor = name_end + extra_len + comment_len;

        if name.ends_with('/') || name.contains("__MACOSX/") {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".shp") || lower.ends_with(".dbf") || lower.ends_with(".prj")) {
            continue;
        }
        if uncompressed_size > MAX_ENTRY_BYTES || compressed_size > MAX_ENTRY_BYTES {
            return Err(GeoError::InvalidParameter(format!(
                "Archive entry {name} exceeds 25 MiB limit"
            )));
        }
        if local_header_off + 30 > archive.len()
            || &archive[local_header_off..local_header_off + 4] != b"PK\x03\x04"
        {
            return Err(GeoError::InvalidParameter(format!(
                "Invalid ZIP local header for {name}"
            )));
        }
        let lh_name_len = read_u16_le(archive, local_header_off + 26).unwrap_or(0) as usize;
        let lh_extra_len = read_u16_le(archive, local_header_off + 28).unwrap_or(0) as usize;
        let data_start = local_header_off + 30 + lh_name_len + lh_extra_len;
        let data_end = data_start + compressed_size;
        if data_end > archive.len() {
            return Err(GeoError::InvalidParameter(format!(
                "Truncated ZIP payload for {name}"
            )));
        }
        let payload = &archive[data_start..data_end];
        let decompressed = match method {
            0 => payload.to_vec(),
            8 => {
                let decoder = DeflateDecoder::new(payload);
                let mut buf = Vec::with_capacity(uncompressed_size.min(1024 * 1024));
                decoder
                    .take((MAX_ENTRY_BYTES + 1) as u64)
                    .read_to_end(&mut buf)
                    .map_err(|e| {
                        GeoError::InvalidParameter(format!(
                            "Failed to inflate {name}: {e}"
                        ))
                    })?;
                if buf.len() > MAX_ENTRY_BYTES {
                    return Err(GeoError::InvalidParameter(format!(
                        "Archive entry {name} exceeds 25 MiB limit"
                    )));
                }
                buf
            }
            other => {
                return Err(GeoError::InvalidParameter(format!(
                    "Unsupported ZIP compression method ({other}) for {name}"
                )));
            }
        };
        out.push((name, decompressed));
    }

    Ok(out)
}

#[derive(Clone, Debug)]
struct DbfField {
    name: String,
    kind: u8,
    len: usize,
}

/// Parses a dBASE III/IV `.dbf` sidecar table into attribute maps per record.
fn parse_dbf_records(dbf: &[u8]) -> Vec<Map<String, Value>> {
    if dbf.len() < 32 {
        return Vec::new();
    }
    let num_records = read_u32_le(dbf, 4).unwrap_or(0) as usize;
    let header_len = read_u16_le(dbf, 8).unwrap_or(0) as usize;
    let record_len = read_u16_le(dbf, 10).unwrap_or(0) as usize;
    if header_len < 33 || record_len < 2 || header_len > dbf.len() {
        return Vec::new();
    }

    let mut fields = Vec::new();
    let mut off = 32usize;
    while off + 32 <= header_len {
        if dbf[off] == 0x0D {
            break;
        }
        let raw_name = &dbf[off..off + 11];
        let end = raw_name.iter().position(|&b| b == 0).unwrap_or(11);
        let name = String::from_utf8_lossy(&raw_name[..end]).trim().to_owned();
        let kind = dbf[off + 11];
        let len = dbf[off + 16] as usize;
        if !name.is_empty() && len > 0 {
            fields.push(DbfField { name, kind, len });
        }
        off += 32;
    }

    let mut records = Vec::with_capacity(num_records.min(MAX_FEATURES));
    let mut rec_off = header_len;
    for _ in 0..num_records.min(MAX_FEATURES) {
        if rec_off + record_len > dbf.len() {
            break;
        }
        let deleted = dbf[rec_off] == b'*';
        let mut cursor = rec_off + 1;
        let mut map = Map::new();
        for f in &fields {
            if cursor + f.len > rec_off + record_len {
                break;
            }
            let raw = String::from_utf8_lossy(&dbf[cursor..cursor + f.len])
                .trim()
                .to_owned();
            cursor += f.len;
            if deleted || raw.is_empty() {
                continue;
            }
            let val = match f.kind {
                b'N' | b'F' => {
                    if let Ok(i) = raw.parse::<i64>() {
                        Value::from(i)
                    } else if let Ok(fl) = raw.parse::<f64>() {
                        if fl.is_finite() {
                            json!(fl)
                        } else {
                            Value::String(raw)
                        }
                    } else {
                        Value::String(raw)
                    }
                }
                b'L' => match raw.as_str() {
                    "T" | "t" | "Y" | "y" => Value::Bool(true),
                    "F" | "f" | "N" | "n" => Value::Bool(false),
                    _ => Value::String(raw),
                },
                _ => Value::String(raw),
            };
            map.insert(f.name.clone(), val);
        }
        records.push(map);
        rec_off += record_len;
    }

    records
}

fn validate_lon_lat(x: f64, y: f64) -> Result<[f64; 2], GeoError> {
    if !x.is_finite()
        || !y.is_finite()
        || !(-180.0..=180.0).contains(&x)
        || !(-90.0..=90.0).contains(&y)
    {
        return Err(GeoError::InvalidParameter(format!(
            "Shapefile coordinate ({x:.4}, {y:.4}) is outside WGS-84 lon/lat bounds (ensure EPSG:4326)"
        )));
    }
    Ok([x, y])
}

fn ring_signed_area_lonlat(ring: &[[f64; 2]]) -> f64 {
    if ring.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..ring.len() {
        let a = ring[i];
        let b = ring[(i + 1) % ring.len()];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    sum * 0.5
}

fn read_parts_and_points(
    rec: &[u8],
    total_positions: &mut usize,
) -> Result<(Vec<usize>, Vec<[f64; 2]>), GeoError> {
    if rec.len() < 44 {
        return Err(GeoError::InvalidParameter(
            "Truncated multi-point/poly shapefile record".to_owned(),
        ));
    }
    // 4 bytes shapeType + 32 bytes bbox = 36
    let num_parts = read_i32_le(rec, 36).unwrap_or(0).max(0) as usize;
    let num_points = read_i32_le(rec, 40).unwrap_or(0).max(0) as usize;
    if num_parts == 0 || num_points == 0 {
        return Ok((Vec::new(), Vec::new()));
    }
    *total_positions += num_points;
    if *total_positions > MAX_POSITIONS {
        return Err(GeoError::InvalidParameter(format!(
            "Shapefile exceeds {MAX_POSITIONS} vertices"
        )));
    }
    let parts_off = 44;
    let pts_off = parts_off + num_parts * 4;
    let needed = pts_off + num_points * 16;
    if rec.len() < needed {
        return Err(GeoError::InvalidParameter(
            "Truncated shapefile vertex buffer".to_owned(),
        ));
    }
    let mut parts = Vec::with_capacity(num_parts);
    for i in 0..num_parts {
        let p = read_i32_le(rec, parts_off + i * 4).unwrap_or(0).max(0) as usize;
        parts.push(p.min(num_points));
    }
    let mut pts = Vec::with_capacity(num_points);
    for i in 0..num_points {
        let off = pts_off + i * 16;
        let x = read_f64_le(rec, off).unwrap_or(f64::NAN);
        let y = read_f64_le(rec, off + 8).unwrap_or(f64::NAN);
        pts.push(validate_lon_lat(x, y)?);
    }
    Ok((parts, pts))
}

fn parse_shp_geometry(rec: &[u8], total_positions: &mut usize) -> Result<Option<Value>, GeoError> {
    if rec.len() < 4 {
        return Ok(None);
    }
    let shape_type = read_i32_le(rec, 0).unwrap_or(0);
    match shape_type {
        // Null shape
        0 => Ok(None),
        // Point / PointZ / PointM
        1 | 11 | 21 => {
            if rec.len() < 20 {
                return Err(GeoError::InvalidParameter(
                    "Truncated Point shapefile record".to_owned(),
                ));
            }
            let x = read_f64_le(rec, 4).unwrap_or(f64::NAN);
            let y = read_f64_le(rec, 12).unwrap_or(f64::NAN);
            *total_positions += 1;
            let [lon, lat] = validate_lon_lat(x, y)?;
            Ok(Some(json!({
                "type": "Point",
                "coordinates": [lon, lat],
            })))
        }
        // MultiPoint / MultiPointZ / MultiPointM
        8 | 18 | 28 => {
            if rec.len() < 40 {
                return Err(GeoError::InvalidParameter(
                    "Truncated MultiPoint shapefile record".to_owned(),
                ));
            }
            let num_points = read_i32_le(rec, 36).unwrap_or(0).max(0) as usize;
            if num_points == 0 {
                return Ok(None);
            }
            *total_positions += num_points;
            if *total_positions > MAX_POSITIONS {
                return Err(GeoError::InvalidParameter(format!(
                    "Shapefile exceeds {MAX_POSITIONS} vertices"
                )));
            }
            if rec.len() < 40 + num_points * 16 {
                return Err(GeoError::InvalidParameter(
                    "Truncated MultiPoint vertex buffer".to_owned(),
                ));
            }
            let mut coords = Vec::with_capacity(num_points);
            for i in 0..num_points {
                let off = 40 + i * 16;
                let x = read_f64_le(rec, off).unwrap_or(f64::NAN);
                let y = read_f64_le(rec, off + 8).unwrap_or(f64::NAN);
                coords.push(validate_lon_lat(x, y)?);
            }
            if coords.len() == 1 {
                Ok(Some(json!({ "type": "Point", "coordinates": coords[0] })))
            } else {
                Ok(Some(json!({ "type": "MultiPoint", "coordinates": coords })))
            }
        }
        // PolyLine / PolyLineZ / PolyLineM
        3 | 13 | 23 => {
            let (parts, pts) = read_parts_and_points(rec, total_positions)?;
            if parts.is_empty() || pts.is_empty() {
                return Ok(None);
            }
            let mut lines: Vec<Vec<[f64; 2]>> = Vec::with_capacity(parts.len());
            for i in 0..parts.len() {
                let start = parts[i];
                let end = if i + 1 < parts.len() { parts[i + 1] } else { pts.len() };
                if end > start + 1 && end <= pts.len() {
                    lines.push(pts[start..end].to_vec());
                }
            }
            if lines.is_empty() {
                Ok(None)
            } else if lines.len() == 1 {
                Ok(Some(json!({
                    "type": "LineString",
                    "coordinates": lines.into_iter().next().unwrap(),
                })))
            } else {
                Ok(Some(json!({
                    "type": "MultiLineString",
                    "coordinates": lines,
                })))
            }
        }
        // Polygon / PolygonZ / PolygonM
        5 | 15 | 25 => {
            let (parts, pts) = read_parts_and_points(rec, total_positions)?;
            if parts.is_empty() || pts.is_empty() {
                return Ok(None);
            }
            let mut raw_rings: Vec<Vec<[f64; 2]>> = Vec::with_capacity(parts.len());
            for i in 0..parts.len() {
                let start = parts[i];
                let end = if i + 1 < parts.len() { parts[i + 1] } else { pts.len() };
                if end <= start + 2 || end > pts.len() {
                    continue;
                }
                let mut ring = pts[start..end].to_vec();
                if ring.first() != ring.last() {
                    ring.push(ring[0]);
                }
                if ring.len() >= 4 {
                    raw_rings.push(ring);
                }
            }
            if raw_rings.is_empty() {
                return Ok(None);
            }
            // In ESRI Shapefiles, outer rings are clockwise (negative shoelace area in lon/lat)
            // and holes are counter-clockwise (positive area).
            let any_cw = raw_rings.iter().any(|r| ring_signed_area_lonlat(r) < 0.0);
            let mut polygons: Vec<Vec<Vec<[f64; 2]>>> = Vec::new();
            if any_cw {
                for ring in raw_rings {
                    if ring_signed_area_lonlat(&ring) <= 0.0 || polygons.is_empty() {
                        polygons.push(vec![ring]);
                    } else if let Some(last_poly) = polygons.last_mut() {
                        last_poly.push(ring);
                    }
                }
            } else {
                for ring in raw_rings {
                    polygons.push(vec![ring]);
                }
            }
            if polygons.len() == 1 {
                Ok(Some(json!({
                    "type": "Polygon",
                    "coordinates": polygons.into_iter().next().unwrap(),
                })))
            } else {
                Ok(Some(json!({
                    "type": "MultiPolygon",
                    "coordinates": polygons,
                })))
            }
        }
        other => Err(GeoError::InvalidParameter(format!(
            "Unsupported Shapefile geometry type ({other})"
        ))),
    }
}

/// Parses a binary `.zip` Shapefile bundle (`.shp` + `.dbf` + `.prj`) or a raw
/// `.shp` buffer into a validated Earthly GeoJSON `FeatureCollection`.
pub fn parse_shapefile_bytes(
    filename: Option<&str>,
    bytes: &[u8],
) -> Result<SpatialImportResult, GeoError> {
    if bytes.is_empty() {
        return Err(GeoError::InvalidParameter("Shapefile input is empty".to_owned()));
    }
    if bytes.len() > MAX_ARCHIVE_BYTES {
        return Err(GeoError::InvalidParameter(
            "Shapefile exceeds 25 MiB limit".to_owned(),
        ));
    }

    let (shp_name, shp_bytes, dbf_bytes, prj_bytes): (
        String,
        Vec<u8>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
    ) = if bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") {
        let entries = extract_zip_entries(bytes)?;
        let shp_entry = entries
            .iter()
            .find(|(name, _)| name.to_ascii_lowercase().ends_with(".shp"))
            .ok_or_else(|| {
                GeoError::InvalidParameter("ZIP archive contains no .shp file".to_owned())
            })?;
        let stem_lower = shp_entry
            .0
            .strip_suffix(".shp")
            .or_else(|| shp_entry.0.strip_suffix(".SHP"))
            .unwrap_or(&shp_entry.0)
            .to_ascii_lowercase();
        let by_lower: HashMap<String, Vec<u8>> = entries
            .iter()
            .map(|(n, data)| (n.to_ascii_lowercase(), data.clone()))
            .collect();
        let dbf = by_lower.get(&format!("{stem_lower}.dbf")).cloned().or_else(|| {
            entries
                .iter()
                .find(|(n, _)| n.to_ascii_lowercase().ends_with(".dbf"))
                .map(|(_, d)| d.clone())
        });
        let prj = by_lower.get(&format!("{stem_lower}.prj")).cloned().or_else(|| {
            entries
                .iter()
                .find(|(n, _)| n.to_ascii_lowercase().ends_with(".prj"))
                .map(|(_, d)| d.clone())
        });
        (shp_entry.0.clone(), shp_entry.1.clone(), dbf, prj)
    } else if bytes.len() >= 100 && read_u32_be(bytes, 0) == Some(9994) {
        (
            filename.unwrap_or("layer.shp").to_owned(),
            bytes.to_vec(),
            None,
            None,
        )
    } else {
        return Err(GeoError::InvalidParameter(
            "File is neither a ZIP Shapefile bundle nor an ESRI .shp binary".to_owned(),
        ));
    };

    if shp_bytes.len() < 100 || read_u32_be(&shp_bytes, 0) != Some(9994) {
        return Err(GeoError::InvalidParameter(
            "Invalid ESRI .shp file header".to_owned(),
        ));
    }

    let mut warnings = Vec::new();
    if let Some(prj) = prj_bytes {
        let prj_text = String::from_utf8_lossy(&prj).to_ascii_uppercase();
        if !(prj_text.contains("WGS_1984")
            || prj_text.contains("WGS 84")
            || prj_text.contains("4326")
            || prj_text.contains("4269")
            || prj_text.contains("GEOGCS"))
        {
            warnings.push(
                "Shapefile .prj is not clearly WGS-84 geographic; reprojection may be required if import fails bounds check."
                    .to_owned(),
            );
        }
    }

    let dbf_records = dbf_bytes
        .as_deref()
        .map(parse_dbf_records)
        .unwrap_or_default();

    let mut features = Vec::new();
    let mut total_positions = 0usize;
    let mut rec_idx = 0usize;
    let mut offset = 100usize;

    while offset + 8 <= shp_bytes.len() {
        let _rec_num = read_u32_be(&shp_bytes, offset).unwrap_or(0);
        let content_words = read_u32_be(&shp_bytes, offset + 4).unwrap_or(0) as usize;
        offset += 8;
        let content_bytes = content_words.saturating_mul(2);
        if content_bytes == 0 || offset + content_bytes > shp_bytes.len() {
            break;
        }
        let rec_slice = &shp_bytes[offset..offset + content_bytes];
        offset += content_bytes;

        if let Some(geometry) = parse_shp_geometry(rec_slice, &mut total_positions)? {
            if features.len() >= MAX_FEATURES {
                warnings.push(format!("Truncated Shapefile at {MAX_FEATURES} features."));
                break;
            }
            let mut props = dbf_records.get(rec_idx).cloned().unwrap_or_default();
            if !props.contains_key("name") {
                if let Some((_, val)) = props.iter().find(|(k, v)| {
                    matches!(k.to_ascii_lowercase().as_str(), "name" | "title" | "label")
                        && v.as_str().is_some_and(|s| !s.trim().is_empty())
                }) {
                    props.insert("name".to_owned(), val.clone());
                }
            }
            features.push(json!({
                "type": "Feature",
                "id": format!("shp-{}", features.len() + 1),
                "geometry": geometry,
                "properties": Value::Object(props),
            }));
        }
        rec_idx += 1;
    }

    if features.is_empty() {
        return Err(GeoError::InvalidParameter(
            "Shapefile contained no valid Point, PolyLine, or Polygon features".to_owned(),
        ));
    }

    let title = clean_title_stem(&shp_name);
    let fc = json!({
        "type": "FeatureCollection",
        "name": title,
        "features": features,
    });
    let summary = validate_feature_collection(&fc)?;
    Ok(SpatialImportResult {
        format: "shp".to_owned(),
        title,
        geojson: fc,
        feature_count: summary.feature_count,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::{Compression, write::DeflateEncoder};
    use std::io::Write;

    fn build_sample_shp() -> Vec<u8> {
        let mut records = Vec::new();

        // Record 1: Point (16.3738, 48.2082) -> 20 bytes (10 words)
        records.extend_from_slice(&1u32.to_be_bytes());
        records.extend_from_slice(&10u32.to_be_bytes());
        records.extend_from_slice(&1i32.to_le_bytes());
        records.extend_from_slice(&16.3738f64.to_le_bytes());
        records.extend_from_slice(&48.2082f64.to_le_bytes());

        // Record 2: PolyLine (2 points) -> 4 + 32 + 4 + 4 + 4 + 32 = 80 bytes (40 words)
        records.extend_from_slice(&2u32.to_be_bytes());
        records.extend_from_slice(&40u32.to_be_bytes());
        records.extend_from_slice(&3i32.to_le_bytes());
        records.extend_from_slice(&[0u8; 32]);
        records.extend_from_slice(&1i32.to_le_bytes()); // numParts
        records.extend_from_slice(&2i32.to_le_bytes()); // numPoints
        records.extend_from_slice(&0i32.to_le_bytes()); // part 0
        for (x, y) in [(16.36_f64, 48.20_f64), (16.38_f64, 48.21_f64)] {
            records.extend_from_slice(&x.to_le_bytes());
            records.extend_from_slice(&y.to_le_bytes());
        }

        // Record 3: Polygon (4 points, CW outer ring) -> 48 + 64 = 112 bytes (56 words)
        records.extend_from_slice(&3u32.to_be_bytes());
        records.extend_from_slice(&56u32.to_be_bytes());
        records.extend_from_slice(&5i32.to_le_bytes());
        records.extend_from_slice(&[0u8; 32]);
        records.extend_from_slice(&1i32.to_le_bytes());
        records.extend_from_slice(&4i32.to_le_bytes());
        records.extend_from_slice(&0i32.to_le_bytes());
        for (x, y) in [
            (16.30_f64, 48.20_f64),
            (16.30_f64, 48.22_f64),
            (16.32_f64, 48.22_f64),
            (16.30_f64, 48.20_f64),
        ] {
            records.extend_from_slice(&x.to_le_bytes());
            records.extend_from_slice(&y.to_le_bytes());
        }

        let mut shp = vec![0u8; 100];
        shp[0..4].copy_from_slice(&9994u32.to_be_bytes());
        let file_len_words = ((100 + records.len()) / 2) as u32;
        shp[24..28].copy_from_slice(&file_len_words.to_be_bytes());
        shp[28..32].copy_from_slice(&1000i32.to_le_bytes());
        shp[32..36].copy_from_slice(&1i32.to_le_bytes());
        shp.extend_from_slice(&records);
        shp
    }

    fn build_sample_dbf() -> Vec<u8> {
        let mut out = vec![0u8; 32 + 32 + 1];
        out[0] = 3;
        out[4..8].copy_from_slice(&3u32.to_le_bytes()); // 3 records
        out[8..10].copy_from_slice(&65u16.to_le_bytes()); // header_len
        out[10..12].copy_from_slice(&17u16.to_le_bytes()); // record_len (1 + 16)
        // Field 0: "NAME" (C, len 16)
        out[32..36].copy_from_slice(b"NAME");
        out[32 + 11] = b'C';
        out[32 + 16] = 16;
        out[64] = 0x0D;
        for label in ["Stephansplatz   ", "Ringstrasse     ", "Stadtpark       "] {
            out.push(b' ');
            out.extend_from_slice(label.as_bytes());
        }
        out
    }

    fn build_zip(entries: &[(&str, &[u8])], deflate: bool) -> Vec<u8> {
        let mut zip = Vec::new();
        let mut cd = Vec::new();
        for &(name, raw) in entries {
            let compressed = if deflate {
                let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
                enc.write_all(raw).unwrap();
                enc.finish().unwrap()
            } else {
                raw.to_vec()
            };
            let method: u16 = if deflate { 8 } else { 0 };
            let local_off = zip.len() as u32;
            // Local file header
            zip.extend_from_slice(b"PK\x03\x04");
            zip.extend_from_slice(&20u16.to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(&method.to_le_bytes());
            zip.extend_from_slice(&0u32.to_le_bytes());
            zip.extend_from_slice(&0u32.to_le_bytes());
            zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(raw.len() as u32).to_le_bytes());
            zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
            zip.extend_from_slice(&0u16.to_le_bytes());
            zip.extend_from_slice(name.as_bytes());
            zip.extend_from_slice(&compressed);

            // Central directory entry
            cd.extend_from_slice(b"PK\x01\x02");
            cd.extend_from_slice(&20u16.to_le_bytes());
            cd.extend_from_slice(&20u16.to_le_bytes());
            cd.extend_from_slice(&0u16.to_le_bytes());
            cd.extend_from_slice(&method.to_le_bytes());
            cd.extend_from_slice(&0u32.to_le_bytes());
            cd.extend_from_slice(&0u32.to_le_bytes());
            cd.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
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
        // EOCD
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
    fn parses_stored_and_deflated_shapefile_zip_bundles_and_raw_shp() {
        let shp = build_sample_shp();
        let dbf = build_sample_dbf();
        let prj = br#"GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984"]]"#;

        for deflate in [false, true] {
            let zip = build_zip(
                &[
                    ("vienna_layers.shp", &shp),
                    ("vienna_layers.dbf", &dbf),
                    ("vienna_layers.prj", prj),
                ],
                deflate,
            );
            let res = parse_shapefile_bytes(Some("vienna_layers.zip"), &zip).unwrap();
            assert_eq!(res.format, "shp");
            assert_eq!(res.title, "vienna_layers");
            assert_eq!(res.feature_count, 3);
            assert!(res.warnings.is_empty());
            let feats = res.geojson["features"].as_array().unwrap();
            assert_eq!(feats[0]["geometry"]["type"], "Point");
            assert_eq!(feats[0]["properties"]["name"], "Stephansplatz");
            assert_eq!(feats[1]["geometry"]["type"], "LineString");
            assert_eq!(feats[1]["properties"]["name"], "Ringstrasse");
            assert_eq!(feats[2]["geometry"]["type"], "Polygon");
            assert_eq!(feats[2]["properties"]["name"], "Stadtpark");
        }

        // Raw .shp also works standalone
        let raw_res = parse_shapefile_bytes(Some("raw_field.shp"), &shp).unwrap();
        assert_eq!(raw_res.feature_count, 3);
        assert_eq!(raw_res.title, "raw_field");

        // Invalid binary rejected cleanly
        assert!(parse_shapefile_bytes(Some("bad.zip"), b"not-a-shapefile").is_err());
    }

    #[test]
    fn exports_and_reimports_mixed_geojson_shapefile_zip() {
        let fc = json!({
            "type": "FeatureCollection",
            "name": "Danube Survey",
            "features": [
                {
                    "type": "Feature",
                    "id": "pt-1",
                    "geometry": { "type": "Point", "coordinates": [16.3738, 48.2082] },
                    "properties": { "name": "Stephansplatz", "description": "Center" }
                },
                {
                    "type": "Feature",
                    "id": "line-1",
                    "geometry": { "type": "LineString", "coordinates": [[16.36, 48.20], [16.38, 48.21]] },
                    "properties": { "name": "Ring Walk" }
                },
                {
                    "type": "Feature",
                    "id": "poly-1",
                    "geometry": { "type": "Polygon", "coordinates": [[[16.30, 48.20], [16.32, 48.20], [16.32, 48.22], [16.30, 48.20]]] },
                    "properties": { "name": "Park Zone" }
                }
            ]
        });

        let zip_bytes = export_geojson_to_shapefile_zip(&fc, Some("Danube Survey")).unwrap();
        let entries = extract_zip_entries(&zip_bytes).unwrap();
        assert!(entries.iter().any(|(n, _)| n.ends_with("_points.shp")));
        assert!(entries.iter().any(|(n, _)| n.ends_with("_lines.shp")));
        assert!(entries.iter().any(|(n, _)| n.ends_with("_polygons.shp")));

        // Verify polygon layer round-trips through parse_shapefile_bytes cleanly.
        let poly_shp = entries
            .iter()
            .find(|(n, _)| n.ends_with("_polygons.shp"))
            .unwrap()
            .1
            .clone();
        let poly_dbf = entries
            .iter()
            .find(|(n, _)| n.ends_with("_polygons.dbf"))
            .unwrap()
            .1
            .clone();
        let poly_zip = build_zip(
            &[("poly.shp", &poly_shp), ("poly.dbf", &poly_dbf)],
            true,
        );
        let reimported = parse_shapefile_bytes(Some("poly.zip"), &poly_zip).unwrap();
        assert_eq!(reimported.feature_count, 1);
        assert_eq!(reimported.geojson["features"][0]["geometry"]["type"], "Polygon");
        assert_eq!(reimported.geojson["features"][0]["properties"]["name"], "Park Zone");
    }
}

const WGS84_PRJ_WKT: &str = r#"GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]"#;

fn sanitize_shp_stem(raw: &str) -> String {
    let cleaned: String = raw
        .trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches('_');
    if trimmed.is_empty() {
        "earthly_export".to_owned()
    } else {
        trimmed.chars().take(48).collect()
    }
}

fn sanitize_dbf_field_name(raw: &str, idx: usize) -> String {
    let mut up: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .map(|c| c.to_ascii_uppercase())
        .take(10)
        .collect();
    if up.is_empty() {
        up = format!("FIELD{idx}");
    }
    up
}

fn write_shp_header(shape_type: i32, file_words: u32, bbox: [f64; 4]) -> Vec<u8> {
    let mut hdr = vec![0u8; 100];
    hdr[0..4].copy_from_slice(&9994u32.to_be_bytes());
    hdr[24..28].copy_from_slice(&file_words.to_be_bytes());
    hdr[28..32].copy_from_slice(&1000i32.to_le_bytes());
    hdr[32..36].copy_from_slice(&shape_type.to_le_bytes());
    hdr[36..44].copy_from_slice(&bbox[0].to_le_bytes());
    hdr[44..52].copy_from_slice(&bbox[1].to_le_bytes());
    hdr[52..60].copy_from_slice(&bbox[2].to_le_bytes());
    hdr[60..68].copy_from_slice(&bbox[3].to_le_bytes());
    hdr
}

fn encode_dbf_bytes(rows: &[Vec<String>], field_names: &[String]) -> Vec<u8> {
    let field_len: usize = 80;
    let num_fields = field_names.len();
    let header_len = 32 + num_fields * 32 + 1;
    let record_len = 1 + num_fields * field_len;
    let mut out = vec![0u8; header_len];
    out[0] = 3; // dBASE III
    out[1] = 126; // year offset
    out[2] = 1;
    out[3] = 1;
    out[4..8].copy_from_slice(&(rows.len() as u32).to_le_bytes());
    out[8..10].copy_from_slice(&(header_len as u16).to_le_bytes());
    out[10..12].copy_from_slice(&(record_len as u16).to_le_bytes());

    for (i, name) in field_names.iter().enumerate() {
        let base = 32 + i * 32;
        let nb = name.as_bytes();
        let copy_len = nb.len().min(10);
        out[base..base + copy_len].copy_from_slice(&nb[..copy_len]);
        out[base + 11] = b'C';
        out[base + 16] = field_len as u8;
    }
    out[header_len - 1] = 0x0D;

    for row in rows {
        out.push(b' '); // active record
        for cell in row {
            let mut buf = vec![b' '; field_len];
            let raw = cell.as_bytes();
            let take = raw.len().min(field_len);
            buf[..take].copy_from_slice(&raw[..take]);
            out.extend_from_slice(&buf);
        }
    }
    out
}

fn build_layer_shapefile_files(
    stem: &str,
    layer_suffix: &str,
    shape_type: i32,
    records: &[(Vec<u8>, Vec<String>, [f64; 4])],
    field_names: &[String],
) -> Vec<(String, Vec<u8>)> {
    let mut shp_records = Vec::new();
    let mut shx_entries = Vec::new();
    let mut rows = Vec::with_capacity(records.len());
    let mut global_bbox = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];

    let mut cur_word_offset = 50u32; // 100-byte header = 50 words
    for (idx, (payload, row, b)) in records.iter().enumerate() {
        let content_words = (payload.len() / 2) as u32;
        shp_records.extend_from_slice(&((idx + 1) as u32).to_be_bytes());
        shp_records.extend_from_slice(&content_words.to_be_bytes());
        shp_records.extend_from_slice(payload);

        shx_entries.extend_from_slice(&cur_word_offset.to_be_bytes());
        shx_entries.extend_from_slice(&content_words.to_be_bytes());
        cur_word_offset += 4 + content_words;

        global_bbox[0] = global_bbox[0].min(b[0]);
        global_bbox[1] = global_bbox[1].min(b[1]);
        global_bbox[2] = global_bbox[2].max(b[2]);
        global_bbox[3] = global_bbox[3].max(b[3]);
        rows.push(row.clone());
    }
    if !global_bbox[0].is_finite() {
        global_bbox = [0.0, 0.0, 0.0, 0.0];
    }

    let shp_file_words = ((100 + shp_records.len()) / 2) as u32;
    let mut shp = write_shp_header(shape_type, shp_file_words, global_bbox);
    shp.extend_from_slice(&shp_records);

    let shx_file_words = ((100 + shx_entries.len()) / 2) as u32;
    let mut shx = write_shp_header(shape_type, shx_file_words, global_bbox);
    shx.extend_from_slice(&shx_entries);

    let dbf = encode_dbf_bytes(&rows, field_names);
    let prefix = format!("{stem}_{layer_suffix}");
    vec![
        (format!("{prefix}.shp"), shp),
        (format!("{prefix}.shx"), shx),
        (format!("{prefix}.dbf"), dbf),
        (format!("{prefix}.prj"), WGS84_PRJ_WKT.as_bytes().to_vec()),
    ]
}

fn pack_pkzip_deflate(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    use flate2::{Compression, Crc, write::DeflateEncoder};
    use std::io::Write;

    let mut zip = Vec::new();
    let mut cd = Vec::new();

    for (name, raw) in files {
        let mut crc_hasher = Crc::new();
        crc_hasher.update(raw);
        let crc = crc_hasher.sum();

        let mut enc = DeflateEncoder::new(Vec::new(), Compression::default());
        enc.write_all(raw).unwrap_or_default();
        let compressed = enc.finish().unwrap_or_else(|_| raw.clone());
        let local_off = zip.len() as u32;

        zip.extend_from_slice(b"PK\x03\x04");
        zip.extend_from_slice(&20u16.to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(&8u16.to_le_bytes());
        zip.extend_from_slice(&0u32.to_le_bytes());
        zip.extend_from_slice(&crc.to_le_bytes());
        zip.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(raw.len() as u32).to_le_bytes());
        zip.extend_from_slice(&(name.len() as u16).to_le_bytes());
        zip.extend_from_slice(&0u16.to_le_bytes());
        zip.extend_from_slice(name.as_bytes());
        zip.extend_from_slice(&compressed);

        cd.extend_from_slice(b"PK\x01\x02");
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&20u16.to_le_bytes());
        cd.extend_from_slice(&0u16.to_le_bytes());
        cd.extend_from_slice(&8u16.to_le_bytes());
        cd.extend_from_slice(&0u32.to_le_bytes());
        cd.extend_from_slice(&crc.to_le_bytes());
        cd.extend_from_slice(&(compressed.len() as u32).to_le_bytes());
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
    zip.extend_from_slice(&(files.len() as u16).to_le_bytes());
    zip.extend_from_slice(&(files.len() as u16).to_le_bytes());
    zip.extend_from_slice(&cd_size.to_le_bytes());
    zip.extend_from_slice(&cd_off.to_le_bytes());
    zip.extend_from_slice(&0u16.to_le_bytes());
    zip
}

fn coords_bbox(pts: &[[f64; 2]]) -> [f64; 4] {
    let mut b = [f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY];
    for &[x, y] in pts {
        b[0] = b[0].min(x);
        b[1] = b[1].min(y);
        b[2] = b[2].max(x);
        b[3] = b[3].max(y);
    }
    b
}

fn encode_parts_payload(shape_type: i32, parts: &[Vec<[f64; 2]>]) -> (Vec<u8>, [f64; 4]) {
    let all_pts: Vec<[f64; 2]> = parts.iter().flat_map(|p| p.iter().copied()).collect();
    let b = coords_bbox(&all_pts);
    let mut payload = Vec::new();
    payload.extend_from_slice(&shape_type.to_le_bytes());
    for v in b {
        payload.extend_from_slice(&v.to_le_bytes());
    }
    payload.extend_from_slice(&(parts.len() as i32).to_le_bytes());
    payload.extend_from_slice(&(all_pts.len() as i32).to_le_bytes());
    let mut running = 0i32;
    for part in parts {
        payload.extend_from_slice(&running.to_le_bytes());
        running += part.len() as i32;
    }
    for [x, y] in all_pts {
        payload.extend_from_slice(&x.to_le_bytes());
        payload.extend_from_slice(&y.to_le_bytes());
    }
    (payload, b)
}

fn parse_coord_list(val: &Value) -> Vec<[f64; 2]> {
    val.as_array()
        .into_iter()
        .flatten()
        .filter_map(|p| {
            let a = p.as_array()?;
            Some([a.first()?.as_f64()?, a.get(1)?.as_f64()?])
        })
        .collect()
}

/// Exports a GeoJSON `FeatureCollection` into a multi-layer ESRI Shapefile
/// `.zip` bundle containing `.shp`, `.shx`, `.dbf`, `.prj`, and `earthly-metadata.json`.
pub fn export_geojson_to_shapefile_zip(
    fc: &Value,
    title: Option<&str>,
) -> Result<Vec<u8>, GeoError> {
    let summary = validate_feature_collection(fc)?;
    if summary.feature_count == 0 {
        return Err(GeoError::InvalidParameter(
            "Cannot export empty FeatureCollection to Shapefile".to_owned(),
        ));
    }
    let features = fc
        .get("features")
        .and_then(Value::as_array)
        .ok_or_else(|| GeoError::InvalidGeoJson("Missing features array".to_owned()))?;

    let mut prop_keys: Vec<String> = vec!["name".to_owned(), "description".to_owned(), "color".to_owned()];
    for f in features {
        if let Some(obj) = f.get("properties").and_then(Value::as_object) {
            for (k, v) in obj {
                if prop_keys.len() >= 12 {
                    break;
                }
                if (v.is_string() || v.is_number() || v.is_boolean()) && !prop_keys.contains(k) {
                    prop_keys.push(k.clone());
                }
            }
        }
    }
    let dbf_field_names: Vec<String> = prop_keys
        .iter()
        .enumerate()
        .map(|(i, k)| sanitize_dbf_field_name(k, i))
        .collect();

    let extract_row = |f: &Value| -> Vec<String> {
        let props = f.get("properties").and_then(Value::as_object);
        prop_keys
            .iter()
            .map(|k| {
                props
                    .and_then(|p| p.get(k))
                    .map(|v| match v {
                        Value::String(s) => s.clone(),
                        Value::Number(n) => n.to_string(),
                        Value::Bool(b) => b.to_string(),
                        _ => String::new(),
                    })
                    .unwrap_or_default()
            })
            .collect()
    };

    let mut point_recs = Vec::new();
    let mut line_recs = Vec::new();
    let mut poly_recs = Vec::new();

    for f in features {
        let Some(geom) = f.get("geometry") else { continue };
        let gtype = geom.get("type").and_then(Value::as_str).unwrap_or("");
        let coords = &geom["coordinates"];
        let row = extract_row(f);

        match gtype {
            "Point" => {
                if let (Some(x), Some(y)) = (
                    coords.get(0).and_then(Value::as_f64),
                    coords.get(1).and_then(Value::as_f64),
                ) {
                    let mut p = Vec::with_capacity(20);
                    p.extend_from_slice(&1i32.to_le_bytes());
                    p.extend_from_slice(&x.to_le_bytes());
                    p.extend_from_slice(&y.to_le_bytes());
                    point_recs.push((p, row, [x, y, x, y]));
                }
            }
            "LineString" => {
                let pts = parse_coord_list(coords);
                if pts.len() >= 2 {
                    let (p, b) = encode_parts_payload(3, &[pts]);
                    line_recs.push((p, row, b));
                }
            }
            "MultiLineString" => {
                let parts: Vec<Vec<[f64; 2]>> = coords
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(parse_coord_list)
                    .filter(|l| l.len() >= 2)
                    .collect();
                if !parts.is_empty() {
                    let (p, b) = encode_parts_payload(3, &parts);
                    line_recs.push((p, row, b));
                }
            }
            "Polygon" | "MultiPolygon" => {
                let mut rings: Vec<Vec<[f64; 2]>> = Vec::new();
                if gtype == "Polygon" {
                    for (ri, raw_r) in coords.as_array().into_iter().flatten().enumerate() {
                        let mut ring = parse_coord_list(raw_r);
                        if ring.len() >= 3 {
                            if ring.first() != ring.last() {
                                ring.push(ring[0]);
                            }
                            let area = ring_signed_area_lonlat(&ring);
                            if (ri == 0 && area > 0.0) || (ri > 0 && area < 0.0) {
                                ring.reverse();
                            }
                            rings.push(ring);
                        }
                    }
                } else {
                    for poly in coords.as_array().into_iter().flatten() {
                        for (ri, raw_r) in poly.as_array().into_iter().flatten().enumerate() {
                            let mut ring = parse_coord_list(raw_r);
                            if ring.len() >= 3 {
                                if ring.first() != ring.last() {
                                    ring.push(ring[0]);
                                }
                                let area = ring_signed_area_lonlat(&ring);
                                if (ri == 0 && area > 0.0) || (ri > 0 && area < 0.0) {
                                    ring.reverse();
                                }
                                rings.push(ring);
                            }
                        }
                    }
                }
                if !rings.is_empty() {
                    let (p, b) = encode_parts_payload(5, &rings);
                    poly_recs.push((p, row, b));
                }
            }
            _ => {}
        }
    }

    let clean_name = title
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .or_else(|| fc.get("name").and_then(Value::as_str))
        .unwrap_or("earthly_map");
    let stem = sanitize_shp_stem(clean_name);

    let mut archive_files = Vec::new();
    if !point_recs.is_empty() {
        archive_files.extend(build_layer_shapefile_files(
            &stem,
            "points",
            1,
            &point_recs,
            &dbf_field_names,
        ));
    }
    if !line_recs.is_empty() {
        archive_files.extend(build_layer_shapefile_files(
            &stem,
            "lines",
            3,
            &line_recs,
            &dbf_field_names,
        ));
    }
    if !poly_recs.is_empty() {
        archive_files.extend(build_layer_shapefile_files(
            &stem,
            "polygons",
            5,
            &poly_recs,
            &dbf_field_names,
        ));
    }
    if archive_files.is_empty() {
        return Err(GeoError::InvalidParameter(
            "No exportable Point, LineString, or Polygon geometries found".to_owned(),
        ));
    }

    let meta = json!({
        "schemaVersion": 1,
        "collection": { "name": clean_name },
        "featureCount": summary.feature_count,
    });
    archive_files.push((
        "earthly-metadata.json".to_owned(),
        serde_json::to_vec_pretty(&meta).unwrap_or_default(),
    ));

    Ok(pack_pkzip_deflate(&archive_files))
}
