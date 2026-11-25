use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RoutingProfile {
    Walk,
    Bike,
    Drive,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RoutePoint {
    pub lon: f64,
    pub lat: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteRequest {
    pub profile: RoutingProfile,
    pub waypoints: Vec<RoutePoint>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RouteResult {
    pub profile: RoutingProfile,
    pub distance_meters: f64,
    pub duration_seconds: f64,
    /// GeoJSON LineString geometry serialized as a JSON value so callers remain
    /// decoupled from any single GeoJSON crate.
    pub geometry: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsochroneRequest {
    pub profile: RoutingProfile,
    pub origin: RoutePoint,
    pub contours_seconds: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IsochroneResult {
    pub profile: RoutingProfile,
    pub feature_collection: serde_json::Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum RoutingError {
    #[error("routing requires at least two waypoints")]
    InsufficientWaypoints,
    #[error("no route found between requested waypoints")]
    NoRoute,
    #[error("routing backend unavailable: {0}")]
    Unavailable(String),
}

/// Pluggable routing engine: backed by remote ContextVM/Valhalla today and
/// local `.atlas` routing graphs on native/WASM in the future.
pub trait RoutingProvider: Send + Sync {
    fn route(&self, request: RouteRequest) -> Result<RouteResult, RoutingError>;
    fn isochrone(&self, request: IsochroneRequest) -> Result<IsochroneResult, RoutingError>;
}
