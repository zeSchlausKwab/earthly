use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::Bounds;

/// Queryable spatial data families aligned with `zeSchlausKwab/atlas` AI task
/// workspaces (`docs/AI-WORKSPACES.md`).
#[derive(Clone, Debug, Eq, PartialEq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DataFamily {
    Locations,
    Buildings,
    Objects,
    Roads,
    Boundaries,
    Custom(String),
}

/// Explicit provenance status reported on every prepared workspace, query
/// result, and result page—never silently upgrading partial coverage to
/// complete.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CoverageStatus {
    Complete,
    Partial,
    Missing,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceCatalog {
    pub source_ids: Vec<String>,
    pub available_families: Vec<DataFamily>,
    pub retained_fields: Vec<String>,
    pub bounds: Option<Bounds>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePrepareRequest {
    pub bounds: Bounds,
    pub families: Vec<DataFamily>,
    #[serde(default)]
    pub required_fields: Vec<String>,
    #[serde(default)]
    pub include_geometry: bool,
    #[serde(default)]
    pub allow_partial: bool,
    pub max_read_bytes: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceHandle {
    pub workspace_id: String,
    pub coverage: CoverageStatus,
    pub feature_count: u64,
    pub bytes_read: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WorkspaceFilterOp {
    Eq,
    Exists,
    Gte,
    Lte,
    Contains,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFilter {
    pub field: String,
    pub op: WorkspaceFilterOp,
    pub value: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceQueryRequest {
    pub workspace_id: String,
    pub from_result_id: Option<String>,
    #[serde(default)]
    pub ids: Vec<String>,
    pub text: Option<String>,
    #[serde(default)]
    pub filters: Vec<WorkspaceFilter>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceQueryResult {
    pub result_id: String,
    pub coverage: CoverageStatus,
    pub total_matches: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePageRequest {
    pub result_id: String,
    pub offset: u64,
    pub limit: u32,
    #[serde(default)]
    pub fields: Vec<String>,
    #[serde(default)]
    pub include_geometry: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePage {
    pub result_id: String,
    pub coverage: CoverageStatus,
    pub offset: u64,
    pub total_matches: u64,
    pub items: Vec<serde_json::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
pub enum SpatialWorkspaceError {
    #[error("requested area lacks complete coverage for requested families")]
    IncompleteCoverage,
    #[error("workspace or result reference not found: {0}")]
    NotFound(String),
    #[error("workspace read budget exceeded ({0} bytes)")]
    ReadBudgetExceeded(u64),
    #[error("spatial workspace error: {0}")]
    Backend(String),
}

/// Bounded task-local AI workspace contract mirroring Atlas's
/// `workspace_catalog` / `workspace_prepare` / `workspace_query` /
/// `workspace_result` / `workspace_release` flow.
pub trait SpatialWorkspaceProvider: Send + Sync {
    fn catalog(&self) -> Result<WorkspaceCatalog, SpatialWorkspaceError>;
    fn prepare(
        &mut self,
        request: WorkspacePrepareRequest,
    ) -> Result<WorkspaceHandle, SpatialWorkspaceError>;
    fn query(
        &mut self,
        request: WorkspaceQueryRequest,
    ) -> Result<WorkspaceQueryResult, SpatialWorkspaceError>;
    fn result_page(
        &self,
        request: WorkspacePageRequest,
    ) -> Result<WorkspacePage, SpatialWorkspaceError>;
    fn release(&mut self, workspace_id: &str) -> Result<bool, SpatialWorkspaceError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_requests_round_trip_as_camel_case_json() {
        let request = WorkspacePrepareRequest {
            bounds: Bounds::new(16.36, 48.20, 16.39, 48.23).unwrap(),
            families: vec![DataFamily::Locations, DataFamily::Buildings],
            required_fields: vec!["addresses".to_owned(), "poi-tags".to_owned()],
            include_geometry: false,
            allow_partial: false,
            max_read_bytes: Some(16 * 1024 * 1024),
        };
        let encoded = serde_json::to_string(&request).unwrap();
        assert!(encoded.contains("requiredFields"));
        assert!(encoded.contains("maxReadBytes"));
        let decoded: WorkspacePrepareRequest = serde_json::from_str(&encoded).unwrap();
        assert_eq!(decoded, request);
    }
}
