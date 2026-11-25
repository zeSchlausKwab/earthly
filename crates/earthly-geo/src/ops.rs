//! Core GeoEditor spatial operations (simplify, boolean ops, split, connect,
//! parallel offset, corridor, tapered band/arrow extrusion, polygon offset,
//! multipart merge/explode).

use std::f64::consts::PI;

use geo::{BooleanOps, Coord, Geometry, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon, Simplify};
use serde::{Deserialize, Serialize};

use crate::measure::haversine_meters;
use crate::projection::LocalProjection;
use crate::GeoError;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtrudeShape {
    Band,
    Arrow,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtrudeSide {
    Center,
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtrudeOptions {
    pub shape: ExtrudeShape,
    pub start_width_meters: f64,
    pub end_width_meters: Option<f64>,
    pub side: ExtrudeSide,
    pub arrow_head_length_meters: Option<f64>,
    pub arrow_head_width_meters: Option<f64>,
}

/// Douglas-Peucker simplification of a LineString in meters.
pub fn simplify_line(
    line: &LineString<f64>,
    tolerance_meters: f64,
) -> Result<LineString<f64>, GeoError> {
    if line.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates("LineString requires at least 2 points"));
    }
    if !tolerance_meters.is_finite() || tolerance_meters < 0.0 {
        return Err(GeoError::InvalidParameter("tolerance_meters must be >= 0".to_owned()));
    }
    let proj = LocalProjection::from_coords(line.0.iter());
    let metric = proj.forward_line(line);
    let simplified = metric.simplify(&tolerance_meters);
    Ok(proj.inverse_line(&simplified))
}

/// Douglas-Peucker simplification of a Polygon in meters (preserving valid rings).
pub fn simplify_polygon(
    polygon: &Polygon<f64>,
    tolerance_meters: f64,
) -> Result<Polygon<f64>, GeoError> {
    if polygon.exterior().0.len() < 4 {
        return Err(GeoError::InsufficientCoordinates("Polygon exterior ring requires >= 4 points"));
    }
    if !tolerance_meters.is_finite() || tolerance_meters < 0.0 {
        return Err(GeoError::InvalidParameter("tolerance_meters must be >= 0".to_owned()));
    }
    let proj = LocalProjection::from_coords(polygon.exterior().0.iter());
    let metric = proj.forward_polygon(polygon);
    let simplified = metric.simplify(&tolerance_meters);
    if simplified.exterior().0.len() < 4 {
        return Ok(polygon.clone());
    }
    Ok(proj.inverse_polygon(&simplified))
}

/// Boolean union of two or more polygons.
pub fn union_polygons(polygons: &[Polygon<f64>]) -> Result<MultiPolygon<f64>, GeoError> {
    if polygons.len() < 2 {
        return Err(GeoError::InvalidParameter("union requires at least 2 polygons".to_owned()));
    }
    let mut acc = MultiPolygon::new(vec![polygons[0].clone()]);
    for poly in &polygons[1..] {
        acc = acc.union(&MultiPolygon::new(vec![poly.clone()]));
    }
    if acc.0.is_empty() {
        return Err(GeoError::EmptyResult("polygon union"));
    }
    Ok(acc)
}

/// Boolean difference (`subject \ clip`).
pub fn difference_polygons(
    subject: &Polygon<f64>,
    clip: &Polygon<f64>,
) -> Result<MultiPolygon<f64>, GeoError> {
    let result = subject.difference(clip);
    if result.0.is_empty() {
        return Err(GeoError::EmptyResult("polygon difference"));
    }
    Ok(result)
}

/// Merge homogeneous single/multi geometries into one Multi* geometry.
pub fn merge_to_multipart(geometries: &[Geometry<f64>]) -> Result<Geometry<f64>, GeoError> {
    if geometries.len() < 2 {
        return Err(GeoError::InvalidParameter("merge requires at least 2 geometries".to_owned()));
    }
    if geometries
        .iter()
        .all(|g| matches!(g, Geometry::Point(_) | Geometry::MultiPoint(_)))
    {
        let mut pts = Vec::new();
        for g in geometries {
            match g {
                Geometry::Point(p) => pts.push(*p),
                Geometry::MultiPoint(mp) => pts.extend(mp.0.iter().copied()),
                _ => {}
            }
        }
        return Ok(Geometry::MultiPoint(MultiPoint::new(pts)));
    }
    if geometries
        .iter()
        .all(|g| matches!(g, Geometry::LineString(_) | Geometry::MultiLineString(_)))
    {
        let mut lines = Vec::new();
        for g in geometries {
            match g {
                Geometry::LineString(l) => lines.push(l.clone()),
                Geometry::MultiLineString(ml) => lines.extend(ml.0.iter().cloned()),
                _ => {}
            }
        }
        return Ok(Geometry::MultiLineString(MultiLineString::new(lines)));
    }
    if geometries
        .iter()
        .all(|g| matches!(g, Geometry::Polygon(_) | Geometry::MultiPolygon(_)))
    {
        let mut polys = Vec::new();
        for g in geometries {
            match g {
                Geometry::Polygon(p) => polys.push(p.clone()),
                Geometry::MultiPolygon(mp) => polys.extend(mp.0.iter().cloned()),
                _ => {}
            }
        }
        return Ok(Geometry::MultiPolygon(MultiPolygon::new(polys)));
    }
    Err(GeoError::InvalidParameter(
        "merge_to_multipart requires homogeneous geometry types".to_owned(),
    ))
}

/// Explode a Multi* geometry into single-part geometries.
pub fn explode_multipart(geometry: &Geometry<f64>) -> Result<Vec<Geometry<f64>>, GeoError> {
    match geometry {
        Geometry::MultiPoint(mp) => Ok(mp.0.iter().copied().map(Geometry::Point).collect()),
        Geometry::MultiLineString(ml) => {
            Ok(ml.0.iter().cloned().map(Geometry::LineString).collect())
        }
        Geometry::MultiPolygon(mp) => Ok(mp.0.iter().cloned().map(Geometry::Polygon).collect()),
        Geometry::GeometryCollection(gc) => Ok(gc.0.clone()),
        _ => Err(GeoError::InvalidParameter(
            "geometry is already single-part".to_owned(),
        )),
    }
}

/// Connects LineStrings whose endpoints lie within `tolerance_meters`.
pub fn connect_lines(
    lines: &[LineString<f64>],
    tolerance_meters: f64,
) -> Result<Vec<LineString<f64>>, GeoError> {
    if lines.is_empty() {
        return Err(GeoError::InsufficientCoordinates("no lines provided"));
    }
    let mut remaining: Vec<Vec<Coord<f64>>> = lines
        .iter()
        .filter(|l| l.0.len() >= 2)
        .map(|l| l.0.clone())
        .collect();
    if remaining.is_empty() {
        return Err(GeoError::InsufficientCoordinates("lines require >= 2 points"));
    }

    let mut result: Vec<Vec<Coord<f64>>> = Vec::new();
    while !remaining.is_empty() {
        let mut chain = remaining.remove(0);
        let mut merged = true;
        while merged {
            merged = false;
            let chain_start = *chain.first().unwrap();
            let chain_end = *chain.last().unwrap();

            for i in 0..remaining.len() {
                let cand_start = *remaining[i].first().unwrap();
                let cand_end = *remaining[i].last().unwrap();

                if haversine_meters(chain_end, cand_start) <= tolerance_meters {
                    let cand = remaining.remove(i);
                    chain.extend_from_slice(&cand[1..]);
                    merged = true;
                    break;
                } else if haversine_meters(chain_end, cand_end) <= tolerance_meters {
                    let mut cand = remaining.remove(i);
                    cand.reverse();
                    chain.extend_from_slice(&cand[1..]);
                    merged = true;
                    break;
                } else if haversine_meters(chain_start, cand_end) <= tolerance_meters {
                    let mut cand = remaining.remove(i);
                    cand.extend_from_slice(&chain[1..]);
                    chain = cand;
                    merged = true;
                    break;
                } else if haversine_meters(chain_start, cand_start) <= tolerance_meters {
                    let mut cand = remaining.remove(i);
                    cand.reverse();
                    cand.extend_from_slice(&chain[1..]);
                    chain = cand;
                    merged = true;
                    break;
                }
            }
        }
        result.push(chain);
    }

    Ok(result.into_iter().map(LineString::new).collect())
}

/// Dissolves a line network by deduplicating overlapping identical segments,
/// snapping & chaining touching endpoints within `tolerance_meters`, and
/// collapsing near-duplicate vertices.
pub fn dissolve_lines(
    lines: &[LineString<f64>],
    tolerance_meters: f64,
) -> Result<Vec<LineString<f64>>, GeoError> {
    if lines.is_empty() {
        return Err(GeoError::InsufficientCoordinates("no lines provided"));
    }
    if !tolerance_meters.is_finite() || tolerance_meters < 0.0 {
        return Err(GeoError::InvalidParameter(
            "tolerance_meters must be >= 0".to_owned(),
        ));
    }
    let snap_tol = tolerance_meters.max(0.5);
    let mut seen_segments: std::collections::HashSet<(i64, i64, i64, i64)> =
        std::collections::HashSet::new();
    let mut cleaned_lines: Vec<LineString<f64>> = Vec::new();

    for line in lines {
        if line.0.len() < 2 {
            continue;
        }
        let mut pts: Vec<Coord<f64>> = Vec::with_capacity(line.0.len());
        for &c in &line.0 {
            if let Some(&prev) = pts.last() {
                if haversine_meters(prev, c) <= 0.25 {
                    continue;
                }
            }
            pts.push(c);
        }
        if pts.len() < 2 {
            continue;
        }
        if pts.len() == 2 {
            let q = |v: f64| (v * 1e6).round() as i64;
            let a = (q(pts[0].x), q(pts[0].y));
            let b = (q(pts[1].x), q(pts[1].y));
            let canonical = if a <= b {
                (a.0, a.1, b.0, b.1)
            } else {
                (b.0, b.1, a.0, a.1)
            };
            if !seen_segments.insert(canonical) {
                continue;
            }
        }
        cleaned_lines.push(LineString::new(pts));
    }

    if cleaned_lines.is_empty() {
        return Err(GeoError::InsufficientCoordinates(
            "lines require >= 2 distinct points",
        ));
    }

    let chained = connect_lines(&cleaned_lines, snap_tol)?;
    if tolerance_meters > 0.0 {
        let mut out = Vec::with_capacity(chained.len());
        let simp_tol = (tolerance_meters * 0.15).min(5.0);
        for l in chained {
            let s = simplify_line(&l, simp_tol).unwrap_or(l);
            if s.0.len() >= 2 {
                out.push(s);
            }
        }
        Ok(out)
    } else {
        Ok(chained)
    }
}

/// Splits `line` at the closest projection of `point` onto the line.
pub fn split_line_at_point(
    line: &LineString<f64>,
    point: Point<f64>,
) -> Result<(LineString<f64>, LineString<f64>), GeoError> {
    if line.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates("LineString requires >= 2 points"));
    }
    let proj = LocalProjection::from_coords(line.0.iter());
    let metric = proj.forward_line(line);
    let p = proj.forward(point.0);

    let mut best_seg = 0usize;
    let mut best_t = 0.0_f64;
    let mut best_dist_sq = f64::INFINITY;
    let mut best_xy = metric.0[0];

    for (idx, seg) in metric.0.windows(2).enumerate() {
        let dx = seg[1].x - seg[0].x;
        let dy = seg[1].y - seg[0].y;
        let len_sq = dx * dx + dy * dy;
        let t = if len_sq < 1e-12 {
            0.0
        } else {
            (((p.x - seg[0].x) * dx + (p.y - seg[0].y) * dy) / len_sq).clamp(0.0, 1.0)
        };
        let proj_xy = Coord {
            x: seg[0].x + t * dx,
            y: seg[0].y + t * dy,
        };
        let dist_sq = (p.x - proj_xy.x).powi(2) + (p.y - proj_xy.y).powi(2);
        if dist_sq < best_dist_sq {
            best_dist_sq = dist_sq;
            best_seg = idx;
            best_t = t;
            best_xy = proj_xy;
        }
    }

    let split_wgs = proj.inverse(best_xy);
    let mut first = line.0[..=best_seg].to_vec();
    if best_t > 1e-6 {
        first.push(split_wgs);
    }
    let mut second = Vec::new();
    if best_t < 1.0 - 1e-6 {
        second.push(split_wgs);
    }
    second.extend_from_slice(&line.0[best_seg + 1..]);

    if first.len() < 2 || second.len() < 2 {
        return Err(GeoError::EmptyResult("split point lies at an endpoint"));
    }
    Ok((LineString::new(first), LineString::new(second)))
}

/// Creates a parallel copy of `line` offset by `distance_meters`
/// (positive = left of travel direction, negative = right).
pub fn offset_line(
    line: &LineString<f64>,
    distance_meters: f64,
) -> Result<LineString<f64>, GeoError> {
    if line.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates("LineString requires >= 2 points"));
    }
    if !distance_meters.is_finite() {
        return Err(GeoError::InvalidParameter("distance_meters must be finite".to_owned()));
    }
    let proj = LocalProjection::from_coords(line.0.iter());
    let metric = proj.forward_line(line);
    let offset_pts = offset_polyline_metric(&metric.0, |_| distance_meters)?;
    Ok(proj.inverse_line(&LineString::new(offset_pts)))
}

/// Creates a symmetric round-ended corridor polygon around `line`.
pub fn create_line_corridor(
    line: &LineString<f64>,
    total_width_meters: f64,
) -> Result<Polygon<f64>, GeoError> {
    if line.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates("LineString requires >= 2 points"));
    }
    if !total_width_meters.is_finite() || total_width_meters <= 0.0 {
        return Err(GeoError::InvalidParameter(
            "total_width_meters must be > 0".to_owned(),
        ));
    }
    let half = total_width_meters / 2.0;
    let proj = LocalProjection::from_coords(line.0.iter());
    let metric = proj.forward_line(line);

    let left = offset_polyline_metric(&metric.0, |_| half)?;
    let mut right = offset_polyline_metric(&metric.0, |_| -half)?;

    let start = metric.0[0];
    let end = *metric.0.last().unwrap();
    let start_dir = unit_dir(metric.0[0], metric.0[1])?;
    let end_dir = unit_dir(metric.0[metric.0.len() - 2], end)?;

    let mut ring = Vec::new();
    ring.extend(left);
    // End semicircular cap
    ring.extend(arc_points(end, half, end_dir.y.atan2(end_dir.x) + PI / 2.0, -PI, 8));
    right.reverse();
    ring.extend(right);
    // Start semicircular cap
    ring.extend(arc_points(
        start,
        half,
        start_dir.y.atan2(start_dir.x) - PI / 2.0,
        -PI,
        8,
    ));
    if let Some(&first) = ring.first() {
        ring.push(first);
    }

    Ok(proj.inverse_polygon(&Polygon::new(LineString::new(ring), vec![])))
}

/// Extrudes a LineString into a tapered filled band (`Band`) or directional
/// arrow (`Arrow`), matching Earthly's `extrude_line` tool specification.
pub fn extrude_line(
    line: &LineString<f64>,
    options: ExtrudeOptions,
) -> Result<Polygon<f64>, GeoError> {
    if line.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates("LineString requires >= 2 points"));
    }
    if !options.start_width_meters.is_finite() || options.start_width_meters <= 0.0 {
        return Err(GeoError::InvalidParameter(
            "start_width_meters must be > 0".to_owned(),
        ));
    }
    let end_width = options.end_width_meters.unwrap_or(options.start_width_meters);
    if !end_width.is_finite() || end_width <= 0.0 {
        return Err(GeoError::InvalidParameter(
            "end_width_meters must be > 0".to_owned(),
        ));
    }

    let proj = LocalProjection::from_coords(line.0.iter());
    let metric = proj.forward_line(line);
    let total_len: f64 = metric
        .0
        .windows(2)
        .map(|s| ((s[1].x - s[0].x).powi(2) + (s[1].y - s[0].y).powi(2)).sqrt())
        .sum();
    if total_len < 1e-6 {
        return Err(GeoError::EmptyResult("zero-length line"));
    }

    let (shaft_pts, tip_opt) = match options.shape {
        ExtrudeShape::Band => (metric.0.clone(), None),
        ExtrudeShape::Arrow => {
            let head_len = options
                .arrow_head_length_meters
                .unwrap_or((end_width * 1.8).min(total_len * 0.45))
                .clamp(1e-3, total_len * 0.85);
            let head_width = options.arrow_head_width_meters.unwrap_or(end_width * 2.2);
            let (shaft, tip, dir) = trim_line_end_metric(&metric.0, head_len)?;
            (shaft, Some((tip, dir, head_width)))
        }
    };

    let (left_frac, right_frac) = match options.side {
        ExtrudeSide::Center => (0.5, -0.5),
        ExtrudeSide::Left => (1.0, 0.0),
        ExtrudeSide::Right => (0.0, -1.0),
    };

    let left = offset_polyline_metric(&shaft_pts, |t| {
        let w = options.start_width_meters + (end_width - options.start_width_meters) * t;
        w * left_frac
    })?;
    let mut right = offset_polyline_metric(&shaft_pts, |t| {
        let w = options.start_width_meters + (end_width - options.start_width_meters) * t;
        w * right_frac
    })?;

    let mut ring = left;
    if let Some((tip, dir, head_width)) = tip_opt {
        let base = *shaft_pts.last().unwrap();
        let left_normal = Coord { x: -dir.y, y: dir.x };
        let wing_left = Coord {
            x: base.x + left_normal.x * (head_width * left_frac),
            y: base.y + left_normal.y * (head_width * left_frac),
        };
        let wing_right = Coord {
            x: base.x + left_normal.x * (head_width * right_frac),
            y: base.y + left_normal.y * (head_width * right_frac),
        };
        ring.push(wing_left);
        ring.push(tip);
        ring.push(wing_right);
    }
    right.reverse();
    ring.extend(right);
    if let Some(&first) = ring.first() {
        ring.push(first);
    }

    Ok(proj.inverse_polygon(&Polygon::new(LineString::new(ring), vec![])))
}

/// Expands (positive `distance_meters`) or insets (negative) a polygon.
pub fn offset_polygon(
    polygon: &Polygon<f64>,
    distance_meters: f64,
) -> Result<Polygon<f64>, GeoError> {
    if polygon.exterior().0.len() < 4 {
        return Err(GeoError::InsufficientCoordinates("Polygon requires >= 4 ring points"));
    }
    if !distance_meters.is_finite() {
        return Err(GeoError::InvalidParameter("distance_meters must be finite".to_owned()));
    }
    let proj = LocalProjection::from_coords(polygon.exterior().0.iter());
    let metric = proj.forward_polygon(polygon);
    let open: Vec<Coord<f64>> = metric.exterior().0[..metric.exterior().0.len() - 1].to_vec();
    let signed_area = ring_signed_area(&open);
    // Outward normal sign depends on winding order (CCW > 0 -> right normal is outward).
    let outward_sign = if signed_area >= 0.0 { -1.0 } else { 1.0 };
    let d = distance_meters * outward_sign;

    let n = open.len();
    let mut next_ring = Vec::with_capacity(n + 1);
    for i in 0..n {
        let prev = open[(i + n - 1) % n];
        let curr = open[i];
        let next = open[(i + 1) % n];
        let d1 = unit_dir(prev, curr)?;
        let d2 = unit_dir(curr, next)?;
        let n1 = Coord { x: -d1.y, y: d1.x };
        let n2 = Coord { x: -d2.y, y: d2.x };
        let bisector = Coord {
            x: n1.x + n2.x,
            y: n1.y + n2.y,
        };
        let b_len = (bisector.x * bisector.x + bisector.y * bisector.y).sqrt();
        let offset = if b_len < 1e-6 {
            Coord { x: n1.x * d, y: n1.y * d }
        } else {
            let unit_b = Coord {
                x: bisector.x / b_len,
                y: bisector.y / b_len,
            };
            let denom = (unit_b.x * n1.x + unit_b.y * n1.y).abs().max(0.25);
            let scale = (d / denom).clamp(-d.abs() * 4.0, d.abs() * 4.0);
            Coord {
                x: unit_b.x * scale,
                y: unit_b.y * scale,
            }
        };
        next_ring.push(Coord {
            x: curr.x + offset.x,
            y: curr.y + offset.y,
        });
    }
    if let Some(&first) = next_ring.first() {
        next_ring.push(first);
    }
    Ok(proj.inverse_polygon(&Polygon::new(LineString::new(next_ring), vec![])))
}

/// Splits `polygon` using a straight or multi-segment blade `LineString`.
pub fn split_polygon_by_line(
    polygon: &Polygon<f64>,
    blade: &LineString<f64>,
) -> Result<Vec<Polygon<f64>>, GeoError> {
    if polygon.exterior().0.len() < 4 || blade.0.len() < 2 {
        return Err(GeoError::InsufficientCoordinates(
            "split_polygon_by_line requires a valid polygon and >= 2 blade points",
        ));
    }
    let proj = LocalProjection::from_coords(polygon.exterior().0.iter());
    let poly_m = proj.forward_polygon(polygon);
    let blade_m = proj.forward_line(blade);

    // Compute a generous bounding extent so the half-plane clip polygons fully
    // cover the subject polygon on each side of the blade.
    let mut extent = 100.0_f64;
    for c in &poly_m.exterior().0 {
        extent = extent.max(c.x.abs()).max(c.y.abs());
    }
    for c in &blade_m.0 {
        extent = extent.max(c.x.abs()).max(c.y.abs());
    }
    let pad = extent * 4.0 + 1000.0;

    let start = blade_m.0[0];
    let end = *blade_m.0.last().unwrap();
    let start_dir = unit_dir(blade_m.0[0], blade_m.0[1])?;
    let end_dir = unit_dir(blade_m.0[blade_m.0.len() - 2], end)?;

    let ext_start = Coord {
        x: start.x - start_dir.x * pad,
        y: start.y - start_dir.y * pad,
    };
    let ext_end = Coord {
        x: end.x + end_dir.x * pad,
        y: end.y + end_dir.y * pad,
    };

    let build_half = |side: f64| -> Polygon<f64> {
        let mut ring = Vec::with_capacity(blade_m.0.len() + 5);
        ring.push(ext_start);
        ring.extend_from_slice(&blade_m.0);
        ring.push(ext_end);
        let n_end = Coord {
            x: -end_dir.y * side,
            y: end_dir.x * side,
        };
        let n_start = Coord {
            x: -start_dir.y * side,
            y: start_dir.x * side,
        };
        ring.push(Coord {
            x: ext_end.x + n_end.x * pad,
            y: ext_end.y + n_end.y * pad,
        });
        ring.push(Coord {
            x: ext_start.x + n_start.x * pad,
            y: ext_start.y + n_start.y * pad,
        });
        ring.push(ext_start);
        Polygon::new(LineString::new(ring), vec![])
    };

    let left_half = poly_m.intersection(&build_half(1.0));
    let right_half = poly_m.intersection(&build_half(-1.0));

    let mut pieces = Vec::new();
    for p in left_half.0.into_iter().chain(right_half.0.into_iter()) {
        if ring_signed_area(&p.exterior().0[..p.exterior().0.len().saturating_sub(1)]).abs() > 1e-3
        {
            pieces.push(proj.inverse_polygon(&p));
        }
    }
    if pieces.len() < 2 {
        return Err(GeoError::EmptyResult("blade did not split polygon"));
    }
    Ok(pieces)
}

fn unit_dir(a: Coord<f64>, b: Coord<f64>) -> Result<Coord<f64>, GeoError> {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = (dx * dx + dy * dy).sqrt();
    if len < 1e-9 {
        return Err(GeoError::EmptyResult("degenerate zero-length segment"));
    }
    Ok(Coord {
        x: dx / len,
        y: dy / len,
    })
}

fn offset_polyline_metric(
    pts: &[Coord<f64>],
    distance_at: impl Fn(f64) -> f64,
) -> Result<Vec<Coord<f64>>, GeoError> {
    let mut cumulative = vec![0.0_f64; pts.len()];
    for i in 1..pts.len() {
        let seg = ((pts[i].x - pts[i - 1].x).powi(2) + (pts[i].y - pts[i - 1].y).powi(2)).sqrt();
        cumulative[i] = cumulative[i - 1] + seg;
    }
    let total = *cumulative.last().unwrap_or(&0.0);

    let mut out = Vec::with_capacity(pts.len());
    for i in 0..pts.len() {
        let t = if total > 1e-9 { cumulative[i] / total } else { 0.0 };
        let d = distance_at(t);
        let normal = if i == 0 {
            let dir = unit_dir(pts[0], pts[1])?;
            Coord { x: -dir.y, y: dir.x }
        } else if i == pts.len() - 1 {
            let dir = unit_dir(pts[i - 1], pts[i])?;
            Coord { x: -dir.y, y: dir.x }
        } else {
            let d1 = unit_dir(pts[i - 1], pts[i])?;
            let d2 = unit_dir(pts[i], pts[i + 1])?;
            let n1 = Coord { x: -d1.y, y: d1.x };
            let n2 = Coord { x: -d2.y, y: d2.x };
            let bx = n1.x + n2.x;
            let by = n1.y + n2.y;
            let blen = (bx * bx + by * by).sqrt();
            if blen < 1e-6 {
                n1
            } else {
                let ux = bx / blen;
                let uy = by / blen;
                let miter = (ux * n1.x + uy * n1.y).abs().max(0.35);
                Coord {
                    x: ux / miter,
                    y: uy / miter,
                }
            }
        };
        out.push(Coord {
            x: pts[i].x + normal.x * d,
            y: pts[i].y + normal.y * d,
        });
    }
    Ok(out)
}

fn trim_line_end_metric(
    pts: &[Coord<f64>],
    trim_len: f64,
) -> Result<(Vec<Coord<f64>>, Coord<f64>, Coord<f64>), GeoError> {
    let tip = *pts.last().unwrap();
    let mut remaining = trim_len;
    let mut idx = pts.len() - 1;
    while idx > 0 {
        let a = pts[idx - 1];
        let b = pts[idx];
        let seg_len = ((b.x - a.x).powi(2) + (b.y - a.y).powi(2)).sqrt();
        if seg_len >= remaining && seg_len > 1e-9 {
            let frac = remaining / seg_len;
            let base = Coord {
                x: b.x - (b.x - a.x) * frac,
                y: b.y - (b.y - a.y) * frac,
            };
            let dir = unit_dir(base, tip)?;
            let mut shaft = pts[..idx].to_vec();
            shaft.push(base);
            return Ok((shaft, tip, dir));
        }
        remaining -= seg_len;
        idx -= 1;
    }
    Err(GeoError::EmptyResult("arrow head exceeds line length"))
}

fn arc_points(
    center: Coord<f64>,
    radius: f64,
    start_angle: f64,
    sweep: f64,
    steps: usize,
) -> Vec<Coord<f64>> {
    (1..steps)
        .map(|i| {
            let angle = start_angle + sweep * (i as f64 / steps as f64);
            Coord {
                x: center.x + radius * angle.cos(),
                y: center.y + radius * angle.sin(),
            }
        })
        .collect()
}

fn ring_signed_area(pts: &[Coord<f64>]) -> f64 {
    if pts.len() < 3 {
        return 0.0;
    }
    let mut sum = 0.0;
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        sum += a.x * b.y - b.x * a.y;
    }
    sum * 0.5
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::measure::{geodesic_area_m2, geodesic_length_m};

    fn square(west: f64, south: f64, size: f64) -> Polygon<f64> {
        Polygon::new(
            LineString::new(vec![
                Coord { x: west, y: south },
                Coord { x: west + size, y: south },
                Coord { x: west + size, y: south + size },
                Coord { x: west, y: south + size },
                Coord { x: west, y: south },
            ]),
            vec![],
        )
    }

    #[test]
    fn boolean_union_difference_and_polygon_split_work() {
        let a = square(16.30, 48.20, 0.02);
        let b = square(16.31, 48.20, 0.02);

        let merged = union_polygons(&[a.clone(), b.clone()]).unwrap();
        assert_eq!(merged.0.len(), 1);
        assert!(geodesic_area_m2(&merged.0[0]) > geodesic_area_m2(&a));

        let diff = difference_polygons(&a, &b).unwrap();
        assert_eq!(diff.0.len(), 1);
        assert!(geodesic_area_m2(&diff.0[0]) < geodesic_area_m2(&a));

        let blade = LineString::new(vec![
            Coord { x: 16.31, y: 48.19 },
            Coord { x: 16.31, y: 48.23 },
        ]);
        let halves = split_polygon_by_line(&a, &blade).unwrap();
        assert_eq!(halves.len(), 2);
        let total_split_area: f64 = halves.iter().map(geodesic_area_m2).sum();
        assert!((total_split_area - geodesic_area_m2(&a)).abs() / geodesic_area_m2(&a) < 0.02);
    }

    #[test]
    fn line_corridor_extrude_arrow_offset_split_and_connect_work() {
        let line = LineString::new(vec![
            Coord { x: 16.360, y: 48.208 },
            Coord { x: 16.370, y: 48.208 },
            Coord { x: 16.380, y: 48.210 },
        ]);

        let corridor = create_line_corridor(&line, 100.0).unwrap();
        assert!(geodesic_area_m2(&corridor) > 100_000.0);

        let arrow = extrude_line(
            &line,
            ExtrudeOptions {
                shape: ExtrudeShape::Arrow,
                start_width_meters: 40.0,
                end_width_meters: Some(80.0),
                side: ExtrudeSide::Center,
                arrow_head_length_meters: Some(150.0),
                arrow_head_width_meters: Some(160.0),
            },
        )
        .unwrap();
        assert!(geodesic_area_m2(&arrow) > 50_000.0);

        let parallel = offset_line(&line, 50.0).unwrap();
        assert!((geodesic_length_m(&parallel) - geodesic_length_m(&line)).abs() < 25.0);

        let (part1, part2) =
            split_line_at_point(&line, Point::new(16.370, 48.208)).unwrap();
        let rejoined = connect_lines(&[part1, part2], 5.0).unwrap();
        assert_eq!(rejoined.len(), 1);
        assert!((geodesic_length_m(&rejoined[0]) - geodesic_length_m(&line)).abs() < 1.0);
    }

    #[test]
    fn polygon_offset_and_simplify_work() {
        let base = square(16.30, 48.20, 0.01);
        let expanded = offset_polygon(&base, 100.0).unwrap();
        assert!(geodesic_area_m2(&expanded) > geodesic_area_m2(&base));

        let jagged = LineString::new(vec![
            Coord { x: 16.300, y: 48.200 },
            Coord { x: 16.305, y: 48.20001 },
            Coord { x: 16.310, y: 48.200 },
        ]);
        let simple = simplify_line(&jagged, 20.0).unwrap();
        assert_eq!(simple.0.len(), 2);
    }

    #[test]
    fn dissolve_lines_merges_connected_segments_and_deduplicates() {
        let seg_a = LineString::new(vec![
            Coord { x: 16.36, y: 48.20 },
            Coord { x: 16.37, y: 48.20 },
        ]);
        let seg_a_dup = LineString::new(vec![
            Coord { x: 16.37, y: 48.20 },
            Coord { x: 16.36, y: 48.20 },
        ]);
        let seg_b = LineString::new(vec![
            Coord { x: 16.37, y: 48.20 },
            Coord { x: 16.38, y: 48.21 },
        ]);
        let dissolved = dissolve_lines(&[seg_a, seg_a_dup, seg_b], 5.0).unwrap();
        assert_eq!(dissolved.len(), 1);
        assert_eq!(dissolved[0].0.len(), 3);
    }
}
