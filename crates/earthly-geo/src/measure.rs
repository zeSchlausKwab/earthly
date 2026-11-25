//! Geodesic measurements (distance, bearing, length, area) and magnetic vertex/edge snapping.

use geo::{ChamberlainDuquetteArea, Coord, Geometry, LineString, Polygon};
use serde::{Deserialize, Serialize};

use crate::projection::LocalProjection;

const EARTH_RADIUS_M: f64 = 6_371_008.8;

pub fn haversine_meters(a: Coord<f64>, b: Coord<f64>) -> f64 {
    let lat1 = a.y.to_radians();
    let lat2 = b.y.to_radians();
    let d_lat = lat2 - lat1;
    let d_lon = (b.x - a.x).to_radians();
    let h = (d_lat / 2.0).sin().powi(2) + lat1.cos() * lat2.cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * h.sqrt().min(1.0).asin()
}

pub fn bearing_degrees(from: Coord<f64>, to: Coord<f64>) -> f64 {
    let lat1 = from.y.to_radians();
    let lat2 = to.y.to_radians();
    let d_lon = (to.x - from.x).to_radians();
    let y = d_lon.sin() * lat2.cos();
    let x = lat1.cos() * lat2.sin() - lat1.sin() * lat2.cos() * d_lon.cos();
    (y.atan2(x).to_degrees() + 360.0) % 360.0
}

pub fn geodesic_length_m(line: &LineString<f64>) -> f64 {
    line.0
        .windows(2)
        .map(|seg| haversine_meters(seg[0], seg[1]))
        .sum()
}

pub fn geodesic_area_m2(polygon: &Polygon<f64>) -> f64 {
    polygon.chamberlain_duquette_unsigned_area()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SnapKind {
    Vertex,
    Edge,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapHit {
    pub lon: f64,
    pub lat: f64,
    pub distance_meters: f64,
    pub kind: SnapKind,
}

/// Magnetically snaps `target` to the nearest vertex (preferred) or segment edge
/// across `candidates` within `tolerance_meters`.
pub fn snap_point(
    target: Coord<f64>,
    candidates: &[Geometry<f64>],
    tolerance_meters: f64,
) -> Option<SnapHit> {
    if tolerance_meters <= 0.0 {
        return None;
    }
    let proj = LocalProjection::from_origin(target.x, target.y);
    let target_xy = proj.forward(target);

    let mut best_vertex: Option<SnapHit> = None;
    let mut best_edge: Option<SnapHit> = None;

    let mut consider_vertex = |coord: Coord<f64>| {
        let dist = haversine_meters(target, coord);
        if dist <= tolerance_meters
            && best_vertex
                .as_ref()
                .is_none_or(|current| dist < current.distance_meters)
        {
            best_vertex = Some(SnapHit {
                lon: coord.x,
                lat: coord.y,
                distance_meters: dist,
                kind: SnapKind::Vertex,
            });
        }
    };

    let mut consider_segment = |a: Coord<f64>, b: Coord<f64>| {
        let a_xy = proj.forward(a);
        let b_xy = proj.forward(b);
        let dx = b_xy.x - a_xy.x;
        let dy = b_xy.y - a_xy.y;
        let len_sq = dx * dx + dy * dy;
        if len_sq < 1e-12 {
            return;
        }
        let t = (((target_xy.x - a_xy.x) * dx + (target_xy.y - a_xy.y) * dy) / len_sq)
            .clamp(0.0, 1.0);
        let projected_xy = Coord {
            x: a_xy.x + t * dx,
            y: a_xy.y + t * dy,
        };
        let projected = proj.inverse(projected_xy);
        let dist = haversine_meters(target, projected);
        if dist <= tolerance_meters
            && best_edge
                .as_ref()
                .is_none_or(|current| dist < current.distance_meters)
        {
            best_edge = Some(SnapHit {
                lon: projected.x,
                lat: projected.y,
                distance_meters: dist,
                kind: SnapKind::Edge,
            });
        }
    };

    for geom in candidates {
        visit_geometry(geom, &mut consider_vertex, &mut consider_segment);
    }

    best_vertex.or(best_edge)
}

fn visit_geometry(
    geom: &Geometry<f64>,
    on_vertex: &mut impl FnMut(Coord<f64>),
    on_segment: &mut impl FnMut(Coord<f64>, Coord<f64>),
) {
    match geom {
        Geometry::Point(p) => on_vertex(p.0),
        Geometry::MultiPoint(mp) => {
            for p in &mp.0 {
                on_vertex(p.0);
            }
        }
        Geometry::LineString(line) => visit_ring(&line.0, on_vertex, on_segment),
        Geometry::MultiLineString(ml) => {
            for line in &ml.0 {
                visit_ring(&line.0, on_vertex, on_segment);
            }
        }
        Geometry::Polygon(poly) => {
            visit_ring(&poly.exterior().0, on_vertex, on_segment);
            for ring in poly.interiors() {
                visit_ring(&ring.0, on_vertex, on_segment);
            }
        }
        Geometry::MultiPolygon(mp) => {
            for poly in &mp.0 {
                visit_ring(&poly.exterior().0, on_vertex, on_segment);
                for ring in poly.interiors() {
                    visit_ring(&ring.0, on_vertex, on_segment);
                }
            }
        }
        Geometry::GeometryCollection(gc) => {
            for child in &gc.0 {
                visit_geometry(child, on_vertex, on_segment);
            }
        }
        _ => {}
    }
}

fn visit_ring(
    coords: &[Coord<f64>],
    on_vertex: &mut impl FnMut(Coord<f64>),
    on_segment: &mut impl FnMut(Coord<f64>, Coord<f64>),
) {
    for &c in coords {
        on_vertex(c);
    }
    for seg in coords.windows(2) {
        on_segment(seg[0], seg[1]);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_vienna_distance_bearing_and_snaps_vertex_before_edge() {
        let stephansdom = Coord { x: 16.3738, y: 48.2082 };
        let rathaus = Coord { x: 16.3574, y: 48.2108 };
        let dist = haversine_meters(stephansdom, rathaus);
        assert!((1150.0..1350.0).contains(&dist));

        let bearing = bearing_degrees(stephansdom, rathaus);
        assert!((275.0..295.0).contains(&bearing));

        let line = Geometry::LineString(LineString::new(vec![
            Coord { x: 16.3700, y: 48.2080 },
            Coord { x: 16.3740, y: 48.2080 },
        ]));

        // Near midpoint -> snaps to edge
        let edge_hit = snap_point(Coord { x: 16.3720, y: 48.2081 }, &[line.clone()], 25.0).unwrap();
        assert_eq!(edge_hit.kind, SnapKind::Edge);
        assert!((edge_hit.lat - 48.2080).abs() < 1e-5);

        // Near endpoint -> prefers vertex snap
        let vertex_hit = snap_point(Coord { x: 16.3739, y: 48.20805 }, &[line], 25.0).unwrap();
        assert_eq!(vertex_hit.kind, SnapKind::Vertex);
        assert!((vertex_hit.lon - 16.3740).abs() < 1e-9);
    }
}
