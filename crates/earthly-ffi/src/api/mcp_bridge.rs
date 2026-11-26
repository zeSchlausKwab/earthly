//! Flutter Rust Bridge facade for `earthly_local_node::McpBridgeServer`
//! (loopback-only Streamable HTTP MCP Desktop Bridge).

use std::sync::OnceLock;

use earthly_agent::earthly_tool_definitions;
use earthly_local_node::{
    McpBridgeServer, McpBridgeStatus, McpPendingMutation, McpWorkspaceState,
};
use tokio::sync::RwLock;

static MCP_BRIDGE: OnceLock<RwLock<Option<McpBridgeServer>>> = OnceLock::new();

fn mcp_bridge_lock() -> &'static RwLock<Option<McpBridgeServer>> {
    MCP_BRIDGE.get_or_init(|| RwLock::new(None))
}

#[derive(Clone, Debug)]
pub struct McpWorkspaceDto {
    pub center_lon: f64,
    pub center_lat: f64,
    pub zoom: f64,
    pub draft_title: String,
    pub draft_geojson: String,
    pub shelf_map_titles: Vec<String>,
    pub atlas_workspaces: Vec<String>,
    pub working_set_titles: Vec<String>,
    pub catalog_items: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct McpToolCallLogDto {
    pub timestamp_ms: u64,
    pub tool_name: String,
    pub ok: bool,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub struct McpBridgeStatusDto {
    pub running: bool,
    pub endpoint_url: String,
    pub auth_token: String,
    pub port: u16,
    pub tool_count: u32,
    pub total_calls: u64,
    pub recent_calls: Vec<McpToolCallLogDto>,
}

#[derive(Clone, Debug)]
pub struct McpCameraActionDto {
    pub lon: f64,
    pub lat: f64,
    pub zoom: f64,
}

#[derive(Clone, Debug)]
pub struct McpMutationDto {
    pub updated_draft_geojson: Option<String>,
    pub camera_action: Option<McpCameraActionDto>,
    pub tool_name: String,
    pub summary: String,
}

impl From<McpWorkspaceDto> for McpWorkspaceState {
    fn from(dto: McpWorkspaceDto) -> Self {
        Self {
            center_lon: dto.center_lon,
            center_lat: dto.center_lat,
            zoom: dto.zoom,
            draft_title: dto.draft_title,
            draft_geojson: dto.draft_geojson,
            shelf_map_titles: dto.shelf_map_titles,
            atlas_workspaces: dto.atlas_workspaces,
            working_set_titles: dto.working_set_titles,
            catalog_items: dto.catalog_items,
        }
    }
}

fn status_to_dto(status: McpBridgeStatus) -> McpBridgeStatusDto {
    McpBridgeStatusDto {
        running: status.running,
        endpoint_url: status.endpoint_url,
        auth_token: status.auth_token,
        port: status.port,
        tool_count: status.tool_count as u32,
        total_calls: status.total_calls,
        recent_calls: status
            .recent_calls
            .into_iter()
            .map(|entry| McpToolCallLogDto {
                timestamp_ms: entry.timestamp_ms,
                tool_name: entry.tool_name,
                ok: entry.ok,
                summary: entry.summary,
            })
            .collect(),
    }
}

fn stopped_status_dto() -> McpBridgeStatusDto {
    let tool_count = earthly_tool_definitions()
        .iter()
        .filter(|t| t.name != "capture_map_snapshot")
        .count() as u32;
    McpBridgeStatusDto {
        running: false,
        endpoint_url: String::new(),
        auth_token: String::new(),
        port: 0,
        tool_count,
        total_calls: 0,
        recent_calls: Vec::new(),
    }
}

fn mutation_to_dto(m: McpPendingMutation) -> McpMutationDto {
    McpMutationDto {
        updated_draft_geojson: m.updated_draft_geojson,
        camera_action: m.camera_action.map(|(lon, lat, zoom)| McpCameraActionDto {
            lon,
            lat,
            zoom,
        }),
        tool_name: m.tool_name,
        summary: m.summary,
    }
}

/// Starts (or restarts) the loopback-only Streamable HTTP MCP Desktop Bridge.
pub async fn start_mcp_bridge(
    port: u16,
    workspace: McpWorkspaceDto,
) -> Result<McpBridgeStatusDto, String> {
    let mut guard = mcp_bridge_lock().write().await;
    if let Some(prev) = guard.take() {
        prev.stop_and_wait().await;
    }
    let server = McpBridgeServer::start(port, workspace.into()).await?;
    let dto = status_to_dto(server.status());
    *guard = Some(server);
    Ok(dto)
}

/// Stops the running MCP Desktop Bridge (if any) and returns the stopped status.
pub async fn stop_mcp_bridge() -> Result<McpBridgeStatusDto, String> {
    let mut guard = mcp_bridge_lock().write().await;
    if let Some(prev) = guard.take() {
        let mut final_status = prev.status();
        prev.stop_and_wait().await;
        final_status.running = false;
        return Ok(status_to_dto(final_status));
    }
    Ok(stopped_status_dto())
}

/// Returns the current status of the MCP Desktop Bridge.
pub async fn get_mcp_bridge_status() -> Result<McpBridgeStatusDto, String> {
    let guard = mcp_bridge_lock().read().await;
    match guard.as_ref() {
        Some(server) => Ok(status_to_dto(server.status())),
        None => Ok(stopped_status_dto()),
    }
}

/// Pushes the latest Flutter map/draft/catalog snapshot to the running MCP bridge.
pub async fn sync_mcp_workspace(workspace: McpWorkspaceDto) -> Result<(), String> {
    let guard = mcp_bridge_lock().read().await;
    if let Some(server) = guard.as_ref() {
        server.update_workspace(workspace.into());
    }
    Ok(())
}

/// Drains pending geometry/camera mutations queued by external MCP clients.
pub async fn drain_mcp_mutations() -> Result<Vec<McpMutationDto>, String> {
    let guard = mcp_bridge_lock().read().await;
    match guard.as_ref() {
        Some(server) => Ok(server
            .drain_pending_mutations()
            .into_iter()
            .map(mutation_to_dto)
            .collect()),
        None => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_workspace() -> McpWorkspaceDto {
        McpWorkspaceDto {
            center_lon: 16.3738,
            center_lat: 48.2082,
            zoom: 13.5,
            draft_title: "Vienna Field".to_owned(),
            draft_geojson: r#"{"type":"FeatureCollection","features":[]}"#.to_owned(),
            shelf_map_titles: vec!["Danube Parks".to_owned()],
            atlas_workspaces: vec![],
            working_set_titles: vec![],
            catalog_items: vec![],
        }
    }

    #[tokio::test]
    async fn mcp_bridge_facade_lifecycle_works() {
        let _ = stop_mcp_bridge().await;

        let initial = get_mcp_bridge_status().await.unwrap();
        assert!(!initial.running);
        assert!(initial.tool_count > 0);

        let started = start_mcp_bridge(0, sample_workspace()).await.unwrap();
        assert!(started.running);
        assert!(started.port > 0);
        assert!(started.endpoint_url.starts_with("http://127.0.0.1:"));
        assert!(!started.auth_token.is_empty());

        sync_mcp_workspace(sample_workspace()).await.unwrap();
        let drained = drain_mcp_mutations().await.unwrap();
        assert!(drained.is_empty());

        let status = get_mcp_bridge_status().await.unwrap();
        assert!(status.running);
        assert_eq!(status.port, started.port);

        let stopped = stop_mcp_bridge().await.unwrap();
        assert!(!stopped.running);
    }
}
