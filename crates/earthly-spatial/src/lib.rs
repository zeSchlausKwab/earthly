//! Source-agnostic spatial data traits for Earthly (native + `wasm32-unknown-unknown`).
//!
//! Replaces Mapnolia-specific discovery while retaining direct PMTiles v3
//! support today and aligning cleanly with [`atlas`](https://github.com/zeSchlausKwab/atlas)
//! capabilities (vector rendering, local AI task workspaces, routing/isochrones,
//! and Hashtree/FIPS area acquisition) as it matures.

pub mod acquisition;
pub mod bounds;
pub mod routing;
pub mod tiles;
pub mod workspace;

pub use acquisition::{
    AcquisitionCapability, AcquisitionPlan, AcquisitionPlanRequest, AcquisitionProgress,
    AcquisitionState, AreaAcquisitionProvider,
};
pub use bounds::{Bounds, BoundsError};
pub use routing::{
    IsochroneRequest, IsochroneResult, RoutePoint, RouteRequest, RouteResult, RoutingError,
    RoutingProfile, RoutingProvider,
};
pub use tiles::{
    PmtilesCompression, PmtilesHeader, PmtilesHeaderError, PmtilesTileType, TileCoord, TileFormat,
    TileMetadata, TilePayload, TileSource, TileSourceError, PMTILES_V3_HEADER_LEN,
};
pub use workspace::{
    CoverageStatus, DataFamily, SpatialWorkspaceError, SpatialWorkspaceProvider, WorkspaceCatalog,
    WorkspaceFilter, WorkspaceFilterOp, WorkspaceHandle, WorkspacePage, WorkspacePageRequest,
    WorkspacePrepareRequest, WorkspaceQueryRequest, WorkspaceQueryResult,
};
