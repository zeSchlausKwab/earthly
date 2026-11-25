//! Pure-Rust geospatial kernel for Earthly (native + `wasm32-unknown-unknown`).
//!
//! Replaces Turf.js and QuickJS WASM sandbox operations across both Flutter
//! native apps and the Web app via `earthly-ffi` and `earthly-wasm`.

pub mod measure;
pub mod ops;
pub mod projection;
pub mod validate;

use thiserror::Error;

pub use measure::{
    SnapHit, SnapKind, bearing_degrees, geodesic_area_m2, geodesic_length_m, haversine_meters,
    snap_point,
};
pub use ops::{
    ExtrudeOptions, ExtrudeShape, ExtrudeSide, connect_lines, create_line_corridor,
    difference_polygons, explode_multipart, extrude_line, merge_to_multipart, offset_line,
    offset_polygon, simplify_line, simplify_polygon, split_line_at_point, split_polygon_by_line,
    union_polygons,
};
pub use projection::LocalProjection;
pub use validate::{ValidationSummary, validate_feature_collection};

#[derive(Clone, Debug, PartialEq, Error)]
pub enum GeoError {
    #[error("invalid GeoJSON: {0}")]
    InvalidGeoJson(String),
    #[error("geometry has too few coordinates: {0}")]
    InsufficientCoordinates(&'static str),
    #[error("coordinate out of WGS84 range or non-finite: ({0}, {1})")]
    InvalidCoordinate(f64, f64),
    #[error("duplicate feature id: {0}")]
    DuplicateFeatureId(String),
    #[error("operation parameter invalid: {0}")]
    InvalidParameter(String),
    #[error("geometry operation produced no valid output: {0}")]
    EmptyResult(&'static str),
}
