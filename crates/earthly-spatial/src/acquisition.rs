use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::Bounds;

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AcquisitionCapability {
    Tiles,
    RoutingWalk,
    RoutingBike,
    RoutingDrive,
    Search,
    AnalysisSource,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AcquisitionState {
    Planned,
    Downloading,
    Paused,
    Ready,
    Failed,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionPlanRequest {
    pub bounds: Bounds,
    pub capabilities: Vec<AcquisitionCapability>,
    #[serde(default)]
    pub preferred_providers: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionPlan {
    pub plan_id: String,
    pub bounds: Bounds,
    pub capabilities: Vec<AcquisitionCapability>,
    pub estimated_bytes: u64,
    pub complete_coverage: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcquisitionProgress {
    pub plan_id: String,
    pub state: AcquisitionState,
    pub bytes_completed: u64,
    pub bytes_total: u64,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum AcquisitionError {
    #[error("acquisition plan not found: {0}")]
    NotFound(String),
    #[error("acquisition backend failed: {0}")]
    Backend(String),
}

/// Source-agnostic offline area acquisition contract: handles local PMTiles
/// archive imports today and multi-publisher Hashtree/FIPS `.atlas` acquisition
/// tomorrow.
pub trait AreaAcquisitionProvider: Send + Sync {
    fn plan(&self, request: AcquisitionPlanRequest) -> Result<AcquisitionPlan, AcquisitionError>;
    fn save(&mut self, plan_id: &str) -> Result<AcquisitionProgress, AcquisitionError>;
    fn status(&self, plan_id: &str) -> Result<AcquisitionProgress, AcquisitionError>;
}
