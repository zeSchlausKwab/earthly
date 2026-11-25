//! Rust `earthly-geo` geometry workbench exposed directly to Flutter via FFI.

use earthly_geo::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, create_line_corridor, difference_polygons,
    extrude_line, geodesic_area_m2, geodesic_length_m, offset_line, offset_polygon, simplify_line,
    split_polygon_by_line, union_polygons,
};
use geo::{Coord, LineString, Polygon};

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

/// Parallel offset copy of a polyline in meters (positive = left, negative = right).
pub fn geo_offset_line(
    points: Vec<LonLatPoint>,
    distance_meters: f64,
) -> Result<Vec<LonLatPoint>, String> {
    let out = offset_line(&to_line(&points), distance_meters).map_err(|e| e.to_string())?;
    Ok(from_coords(&out.0))
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

pub fn geo_measure_line_meters(points: Vec<LonLatPoint>) -> f64 {
    geodesic_length_m(&to_line(&points))
}

pub fn geo_measure_polygon_area_m2(ring: Vec<LonLatPoint>) -> f64 {
    geodesic_area_m2(&to_closed_polygon(&ring))
}
