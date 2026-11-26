//! Loopback-only (`127.0.0.1`) Streamable HTTP JSON-RPC 2.0 MCP Desktop Bridge
//! exposing Earthly's spatial tools and live workspace state to desktop AI clients
//! (e.g., Claude Desktop, Cursor) over Bearer-authenticated HTTP.

use std::collections::VecDeque;
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::header::AUTHORIZATION;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use earthly_agent::executor::MutableDraftState;
use earthly_agent::{
    AgentWorkspaceContext, earthly_tool_definitions, execute_tool_call, fetch_research_webpage,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use uuid::Uuid;

const MCP_PROTOCOL_VERSION: &str = "2025-03-26";
const MCP_SERVER_NAME: &str = "earthly-native-mcp";
const MCP_SERVER_VERSION: &str = "1.0.0";
const RECENT_CALL_CAP: usize = 50;

/// Live Earthly map and catalog snapshot exposed to the MCP bridge.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWorkspaceState {
    pub center_lon: f64,
    pub center_lat: f64,
    pub zoom: f64,
    pub draft_title: String,
    pub draft_geojson: String,
    #[serde(default)]
    pub shelf_map_titles: Vec<String>,
    #[serde(default)]
    pub atlas_workspaces: Vec<String>,
    #[serde(default)]
    pub working_set_titles: Vec<String>,
    #[serde(default)]
    pub catalog_items: Vec<String>,
}

impl McpWorkspaceState {
    fn to_agent_context(&self) -> Result<AgentWorkspaceContext, String> {
        // Deserialize via JSON so optional #[serde(default)] fields added to
        // AgentWorkspaceContext remain compatible without coupling struct literals.
        serde_json::from_value(json!({
            "centerLon": self.center_lon,
            "centerLat": self.center_lat,
            "zoom": self.zoom,
            "draftTitle": self.draft_title,
            "draftGeojson": self.draft_geojson,
            "shelfMapTitles": self.shelf_map_titles,
            "atlasWorkspaces": self.atlas_workspaces,
            "workingSetTitles": self.working_set_titles,
            "catalogItems": self.catalog_items,
        }))
        .map_err(|err| format!("failed to build agent workspace context: {err}"))
    }
}

/// Queued workspace mutation produced by an MCP `tools/call` invocation for Flutter to apply.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct McpPendingMutation {
    pub updated_draft_geojson: Option<String>,
    pub camera_action: Option<(f64, f64, f64)>,
    pub tool_name: String,
    pub summary: String,
}

/// Single recent MCP tool invocation log record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpToolCallLogEntry {
    pub timestamp_ms: u64,
    pub tool_name: String,
    pub ok: bool,
    pub summary: String,
}

/// Snapshot of the running (or stopped) Local MCP Desktop Bridge.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpBridgeStatus {
    pub running: bool,
    pub endpoint_url: String,
    pub auth_token: String,
    pub port: u16,
    pub tool_count: usize,
    pub total_calls: u64,
    pub recent_calls: Vec<McpToolCallLogEntry>,
}

struct BridgeInner {
    workspace: McpWorkspaceState,
    pending_mutations: Vec<McpPendingMutation>,
    total_calls: u64,
    recent_calls: VecDeque<McpToolCallLogEntry>,
    running: bool,
}

#[derive(Clone)]
struct AppState {
    auth_token: String,
    inner: Arc<Mutex<BridgeInner>>,
}

/// Running loopback-only Streamable HTTP MCP bridge server.
pub struct McpBridgeServer {
    endpoint_url: String,
    auth_token: String,
    port: u16,
    inner: Arc<Mutex<BridgeInner>>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl McpBridgeServer {
    /// Starts the MCP bridge bound strictly to `127.0.0.1:{port}` (`0` chooses an ephemeral port).
    pub async fn start(port: u16, initial_workspace: McpWorkspaceState) -> Result<Self, String> {
        let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port));
        let listener = TcpListener::bind(addr)
            .await
            .map_err(|err| format!("failed to bind MCP bridge on {addr}: {err}"))?;
        let bound_port = listener
            .local_addr()
            .map_err(|err| format!("failed to inspect MCP bridge address: {err}"))?
            .port();

        let auth_token = Uuid::new_v4().to_string();
        let endpoint_url = format!("http://127.0.0.1:{bound_port}/mcp");
        let inner = Arc::new(Mutex::new(BridgeInner {
            workspace: initial_workspace,
            pending_mutations: Vec::new(),
            total_calls: 0,
            recent_calls: VecDeque::with_capacity(RECENT_CALL_CAP),
            running: true,
        }));

        let app_state = AppState {
            auth_token: auth_token.clone(),
            inner: Arc::clone(&inner),
        };

        let app = Router::new()
            .route("/health", get(health_handler))
            .route("/mcp", post(mcp_post_handler).delete(mcp_delete_handler))
            .with_state(app_state);

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let inner_for_task = Arc::clone(&inner);
        let task = tokio::spawn(async move {
            let server = axum::serve(listener, app).with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            });
            if let Err(err) = server.await {
                tracing::error!(%err, "MCP bridge listener terminated with error");
            }
            if let Ok(mut guard) = inner_for_task.lock() {
                guard.running = false;
            }
        });

        Ok(Self {
            endpoint_url,
            auth_token,
            port: bound_port,
            inner,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            task: Mutex::new(Some(task)),
        })
    }

    /// Replaces the live workspace snapshot seen by MCP tool calls.
    pub fn update_workspace(&self, workspace: McpWorkspaceState) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.workspace = workspace;
        }
    }

    /// Drains all queued mutations produced by MCP tool calls since the last drain.
    pub fn drain_pending_mutations(&self) -> Vec<McpPendingMutation> {
        match self.inner.lock() {
            Ok(mut guard) => std::mem::take(&mut guard.pending_mutations),
            Err(_) => Vec::new(),
        }
    }

    /// Returns the current server status, endpoint, Bearer token, and recent call log.
    pub fn status(&self) -> McpBridgeStatus {
        let (running, total_calls, recent_calls) = match self.inner.lock() {
            Ok(guard) => (
                guard.running,
                guard.total_calls,
                guard.recent_calls.iter().cloned().collect(),
            ),
            Err(_) => (false, 0, Vec::new()),
        };

        McpBridgeStatus {
            running,
            endpoint_url: self.endpoint_url.clone(),
            auth_token: self.auth_token.clone(),
            port: self.port,
            tool_count: mcp_tool_definitions().len(),
            total_calls,
            recent_calls,
        }
    }

    /// Signals the server to shut down gracefully via its `oneshot` channel.
    pub fn stop(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.running = false;
        }
        if let Ok(mut tx_guard) = self.shutdown_tx.lock() {
            if let Some(tx) = tx_guard.take() {
                let _ = tx.send(());
            }
        }
    }

    /// Signals graceful shutdown and awaits listener task completion.
    pub async fn stop_and_wait(&self) {
        self.stop();
        let handle = self
            .task
            .lock()
            .ok()
            .and_then(|mut guard| guard.take());
        if let Some(handle) = handle {
            let _ = handle.await;
        }
    }
}

impl Drop for McpBridgeServer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[derive(Debug, Deserialize)]
struct JsonRpcRequest {
    #[serde(default)]
    jsonrpc: Option<String>,
    #[serde(default)]
    id: Option<Value>,
    method: String,
    #[serde(default)]
    params: Option<Value>,
}

async fn health_handler() -> Json<Value> {
    Json(json!({
        "ok": true,
        "server": MCP_SERVER_NAME
    }))
}

async fn mcp_delete_handler(headers: HeaderMap, State(state): State<AppState>) -> Response {
    if !is_authorized(&headers, &state.auth_token) {
        return unauthorized_response();
    }
    StatusCode::NO_CONTENT.into_response()
}

async fn mcp_post_handler(
    headers: HeaderMap,
    State(state): State<AppState>,
    body: Bytes,
) -> Response {
    if !is_authorized(&headers, &state.auth_token) {
        return unauthorized_response();
    }

    let req: JsonRpcRequest = match serde_json::from_slice(&body) {
        Ok(parsed) => parsed,
        Err(err) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json_rpc_error(Value::Null, -32700, &format!("Parse error: {err}"))),
            )
                .into_response();
        }
    };

    if req.jsonrpc.as_deref() != Some("2.0") {
        let id = req.id.unwrap_or(Value::Null);
        return (
            StatusCode::BAD_REQUEST,
            Json(json_rpc_error(id, -32600, "Invalid Request: jsonrpc must be \"2.0\"")),
        )
            .into_response();
    }

    if req.method == "notifications/initialized"
        || (req.id.is_none() && req.method.starts_with("notifications/"))
    {
        return StatusCode::ACCEPTED.into_response();
    }

    let id = req.id.unwrap_or(Value::Null);
    let params = req.params.unwrap_or_else(|| json!({}));

    match req.method.as_str() {
        "initialize" => Json(json_rpc_result(
            id,
            json!({
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {
                    "tools": {
                        "listChanged": false
                    }
                },
                "serverInfo": {
                    "name": MCP_SERVER_NAME,
                    "version": MCP_SERVER_VERSION
                }
            }),
        ))
        .into_response(),
        "ping" => Json(json_rpc_result(id, json!({}))).into_response(),
        "tools/list" => {
            let tools = mcp_tool_definitions();
            Json(json_rpc_result(id, json!({ "tools": tools }))).into_response()
        }
        "tools/call" => handle_tools_call(id, &params, &state).await.into_response(),
        other => Json(json_rpc_error(
            id,
            -32601,
            &format!("Method not found: {other}"),
        ))
        .into_response(),
    }
}

async fn handle_tools_call(id: Value, params: &Value, state: &AppState) -> Json<Value> {
    let Some(tool_name) = params
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty())
    else {
        return Json(json_rpc_error(
            id,
            -32602,
            "Invalid params: \"name\" is required for tools/call",
        ));
    };

    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    if tool_name == "get_map_state" {
        let snapshot = match state.inner.lock() {
            Ok(guard) => guard.workspace.clone(),
            Err(_) => {
                return Json(json_rpc_error(
                    id,
                    -32603,
                    "Internal error: workspace lock poisoned",
                ));
            }
        };
        let draft_fc = MutableDraftState::from_geojson(
            &snapshot.draft_geojson,
            &snapshot.draft_title,
        )
        .fc;
        let feature_count = draft_fc
            .get("features")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        let summary = format!(
            "Read live map state ({feature_count} draft feature(s), z{:.1})",
            snapshot.zoom
        );
        let payload = json!({
            "center": [snapshot.center_lon, snapshot.center_lat],
            "centerLon": snapshot.center_lon,
            "centerLat": snapshot.center_lat,
            "zoom": snapshot.zoom,
            "draftTitle": snapshot.draft_title,
            "draftFeatureCount": feature_count,
            "draftGeojson": draft_fc,
            "shelfMapTitles": snapshot.shelf_map_titles,
            "atlasWorkspaces": snapshot.atlas_workspaces,
            "workingSetTitles": snapshot.working_set_titles,
            "catalogItems": snapshot.catalog_items,
        });
        record_tool_call(&state.inner, "get_map_state", true, summary);
        return Json(json_rpc_result(id, mcp_tool_result(&payload, false)));
    }

    if tool_name == "fetch_webpage" {
        let url = args
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        let (ok, summary, payload) = match fetch_research_webpage(url).await {
            Ok(extract) => {
                let coords: Vec<Value> = extract
                    .coordinates
                    .into_iter()
                    .map(|(lat, lon)| json!({ "lat": lat, "lon": lon }))
                    .collect();
                let summary = format!(
                    "Fetched \"{}\" ({} coord(s))",
                    extract.title,
                    coords.len()
                );
                let val = json!({
                    "url": extract.url,
                    "title": extract.title,
                    "excerpt": extract.excerpt,
                    "coordinates": coords,
                    "osmLinks": extract.osm_links,
                    "spatialLinks": extract.spatial_links,
                });
                (true, summary, val)
            }
            Err(err) => (false, err.clone(), json!({ "error": err })),
        };
        record_tool_call(&state.inner, "fetch_webpage", ok, summary);
        return Json(json_rpc_result(id, mcp_tool_result(&payload, !ok)));
    }

    let workspace_snapshot = match state.inner.lock() {
        Ok(guard) => guard.workspace.clone(),
        Err(_) => {
            return Json(json_rpc_error(
                id,
                -32603,
                "Internal error: workspace lock poisoned",
            ));
        }
    };

    let agent_ctx = match workspace_snapshot.to_agent_context() {
        Ok(ctx) => ctx,
        Err(err) => {
            return Json(json_rpc_error(id, -32603, &err));
        }
    };

    let mut draft_state = MutableDraftState::from_geojson(
        &workspace_snapshot.draft_geojson,
        &workspace_snapshot.draft_title,
    );
    let (rec, value) = execute_tool_call(tool_name, &args, &agent_ctx, &mut draft_state);

    let updated_draft_geojson = if draft_state.modified {
        Some(serde_json::to_string(&draft_state.fc).unwrap_or_default())
    } else {
        None
    };
    let camera_action = draft_state
        .camera_action
        .map(|cam| (cam.lon, cam.lat, cam.zoom));

    if let Ok(mut guard) = state.inner.lock() {
        if let Some(ref geojson) = updated_draft_geojson {
            guard.workspace.draft_geojson = geojson.clone();
        }
        if let Some((lon, lat, zoom)) = camera_action {
            guard.workspace.center_lon = lon;
            guard.workspace.center_lat = lat;
            guard.workspace.zoom = zoom;
        }
        if updated_draft_geojson.is_some() || camera_action.is_some() {
            guard.pending_mutations.push(McpPendingMutation {
                updated_draft_geojson,
                camera_action,
                tool_name: rec.name.clone(),
                summary: rec.summary.clone(),
            });
        }
        push_call_log(&mut guard, rec.name.clone(), rec.ok, rec.summary.clone());
    }

    Json(json_rpc_result(id, mcp_tool_result(&value, !rec.ok)))
}

fn mcp_tool_definitions() -> Vec<Value> {
    let mut tools = vec![json!({
        "name": "get_map_state",
        "description": "Return the live Earthly map camera viewport, working draft GeoJSON FeatureCollection, Shelf maps, Working Set, Atlas workspaces, and catalog items.",
        "inputSchema": {
            "type": "object",
            "properties": {}
        }
    })];
    for tool in earthly_tool_definitions() {
        tools.push(json!({
            "name": tool.name,
            "description": tool.description,
            "inputSchema": tool.parameters,
        }));
    }
    tools
}

fn mcp_tool_result(payload: &Value, is_error: bool) -> Value {
    let text = serde_json::to_string(payload).unwrap_or_else(|_| "{}".to_owned());
    json!({
        "content": [{
            "type": "text",
            "text": text
        }],
        "isError": is_error
    })
}

fn json_rpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    })
}

fn json_rpc_error(id: Value, code: i64, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    })
}

fn record_tool_call(
    inner: &Arc<Mutex<BridgeInner>>,
    tool_name: &str,
    ok: bool,
    summary: String,
) {
    if let Ok(mut guard) = inner.lock() {
        push_call_log(&mut guard, tool_name.to_owned(), ok, summary);
    }
}

fn push_call_log(guard: &mut BridgeInner, tool_name: String, ok: bool, summary: String) {
    guard.total_calls = guard.total_calls.saturating_add(1);
    if guard.recent_calls.len() >= RECENT_CALL_CAP {
        guard.recent_calls.pop_front();
    }
    guard.recent_calls.push_back(McpToolCallLogEntry {
        timestamp_ms: now_epoch_ms(),
        tool_name,
        ok,
        summary,
    });
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_authorized(headers: &HeaderMap, expected_token: &str) -> bool {
    let Some(raw) = headers.get(AUTHORIZATION).and_then(|v| v.to_str().ok()) else {
        return false;
    };
    let Some(token) = raw.strip_prefix("Bearer ") else {
        return false;
    };
    constant_time_eq(token.trim().as_bytes(), expected_token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

fn unauthorized_response() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({ "error": "Unauthorized" })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_workspace() -> McpWorkspaceState {
        McpWorkspaceState {
            center_lon: -122.4194,
            center_lat: 37.7749,
            zoom: 12.5,
            draft_title: "SF Field Survey".to_owned(),
            draft_geojson: json!({
                "type": "FeatureCollection",
                "name": "SF Field Survey",
                "features": []
            })
            .to_string(),
            shelf_map_titles: vec!["Bay Watershed".to_owned()],
            atlas_workspaces: vec!["bay.atlas".to_owned()],
            working_set_titles: vec!["Coastal Trail".to_owned()],
            catalog_items: vec!["[map] Twin Peaks".to_owned()],
        }
    }

    #[tokio::test]
    async fn mcp_bridge_auth_initialize_tools_and_shutdown() {
        let server = McpBridgeServer::start(0, sample_workspace())
            .await
            .expect("start MCP bridge");
        let status = server.status();
        assert!(status.running);
        assert_ne!(status.port, 0);
        assert!(status.endpoint_url.starts_with("http://127.0.0.1:"));
        assert!(!status.auth_token.is_empty());

        let client = reqwest::Client::new();
        let health_url = format!("http://127.0.0.1:{}/health", status.port);
        let health_resp = client.get(&health_url).send().await.expect("health req");
        assert_eq!(health_resp.status(), StatusCode::OK);
        let health_json: Value = health_resp.json().await.expect("health json");
        assert_eq!(health_json["ok"], true);
        assert_eq!(health_json["server"], "earthly-native-mcp");

        // Missing Authorization header -> 401 Unauthorized
        let unauth_resp = client
            .post(&status.endpoint_url)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize"
            }))
            .send()
            .await
            .expect("unauth req");
        assert_eq!(unauth_resp.status(), StatusCode::UNAUTHORIZED);

        // Wrong Bearer token -> 401 Unauthorized
        let wrong_resp = client
            .post(&status.endpoint_url)
            .bearer_auth("wrong-token")
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize"
            }))
            .send()
            .await
            .expect("wrong auth req");
        assert_eq!(wrong_resp.status(), StatusCode::UNAUTHORIZED);

        // initialize -> valid protocolVersion and capabilities
        let init_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "clientInfo": { "name": "test-client", "version": "0.1" }
                }
            }))
            .send()
            .await
            .expect("initialize req");
        assert_eq!(init_resp.status(), StatusCode::OK);
        let init_json: Value = init_resp.json().await.expect("init json");
        assert_eq!(init_json["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(
            init_json["result"]["capabilities"]["tools"]["listChanged"],
            false
        );
        assert_eq!(
            init_json["result"]["serverInfo"]["name"],
            "earthly-native-mcp"
        );

        // notifications/initialized -> 202 Accepted
        let notif_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "method": "notifications/initialized"
            }))
            .send()
            .await
            .expect("notif req");
        assert_eq!(notif_resp.status(), StatusCode::ACCEPTED);

        // ping -> {}
        let ping_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "ping"
            }))
            .send()
            .await
            .expect("ping req");
        assert_eq!(ping_resp.status(), StatusCode::OK);
        let ping_json: Value = ping_resp.json().await.expect("ping json");
        assert_eq!(ping_json["result"], json!({}));

        // tools/list -> Earthly tools + get_map_state
        let list_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/list"
            }))
            .send()
            .await
            .expect("tools/list req");
        assert_eq!(list_resp.status(), StatusCode::OK);
        let list_json: Value = list_resp.json().await.expect("list json");
        let tools = list_json["result"]["tools"]
            .as_array()
            .expect("tools array");
        assert_eq!(tools.len(), earthly_tool_definitions().len() + 1);
        assert!(tools.iter().any(|t| t["name"] == "get_map_state"));
        assert!(tools.iter().any(|t| t["name"] == "create_point"));
        assert!(tools.iter().any(|t| t["name"] == "measure_draft"));
        assert!(tools[0].get("inputSchema").is_some());

        // tools/call -> get_map_state
        let state_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": { "name": "get_map_state", "arguments": {} }
            }))
            .send()
            .await
            .expect("get_map_state req");
        let state_json: Value = state_resp.json().await.expect("state json");
        assert_eq!(state_json["result"]["isError"], false);
        let state_text = state_json["result"]["content"][0]["text"]
            .as_str()
            .expect("state text");
        let state_payload: Value = serde_json::from_str(state_text).expect("state payload");
        assert_eq!(state_payload["draftTitle"], "SF Field Survey");
        assert_eq!(state_payload["draftFeatureCount"], 0);

        // tools/call -> create_point
        let pt_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 5,
                "method": "tools/call",
                "params": {
                    "name": "create_point",
                    "arguments": {
                        "lon": -122.4477,
                        "lat": 37.7544,
                        "name": "Twin Peaks",
                        "color": "#1F5F8B"
                    }
                }
            }))
            .send()
            .await
            .expect("create_point req");
        let pt_json: Value = pt_resp.json().await.expect("pt json");
        assert_eq!(pt_json["result"]["isError"], false);

        // tools/call -> create_line + measure_draft to verify GeoJSON persistence & measurement
        let line_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 6,
                "method": "tools/call",
                "params": {
                    "name": "create_line",
                    "arguments": {
                        "name": "Ridge Walk",
                        "coordinates": [[-122.4477, 37.7544], [-122.4420, 37.7600]]
                    }
                }
            }))
            .send()
            .await
            .expect("create_line req");
        let line_json: Value = line_resp.json().await.expect("line json");
        assert_eq!(line_json["result"]["isError"], false);

        let measure_resp = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 7,
                "method": "tools/call",
                "params": { "name": "measure_draft", "arguments": {} }
            }))
            .send()
            .await
            .expect("measure_draft req");
        let measure_json: Value = measure_resp.json().await.expect("measure json");
        assert_eq!(measure_json["result"]["isError"], false);
        let measure_text = measure_json["result"]["content"][0]["text"]
            .as_str()
            .expect("measure text");
        let measure_payload: Value = serde_json::from_str(measure_text).expect("measure payload");
        assert!(
            measure_payload["totalLineMeters"]
                .as_f64()
                .unwrap_or(0.0)
                > 500.0
        );

        // Pending mutations queued for Flutter
        let mutations = server.drain_pending_mutations();
        assert_eq!(mutations.len(), 2);
        assert_eq!(mutations[0].tool_name, "create_point");
        assert!(mutations[0].camera_action.is_some());
        let updated_raw = mutations[1]
            .updated_draft_geojson
            .as_deref()
            .expect("updated geojson");
        let updated_fc: Value = serde_json::from_str(updated_raw).expect("valid geojson");
        assert_eq!(
            updated_fc["features"].as_array().map(Vec::len),
            Some(2)
        );
        assert!(server.drain_pending_mutations().is_empty());

        // Recent calls & status tracking
        let after_status = server.status();
        assert_eq!(after_status.total_calls, 4);
        assert_eq!(after_status.recent_calls.len(), 4);
        assert_eq!(after_status.tool_count, earthly_tool_definitions().len() + 1);

        // update_workspace works cleanly
        let mut new_ws = sample_workspace();
        new_ws.draft_title = "Updated Survey".to_owned();
        server.update_workspace(new_ws);

        let state_resp_2 = client
            .post(&status.endpoint_url)
            .bearer_auth(&status.auth_token)
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 8,
                "method": "tools/call",
                "params": { "name": "get_map_state", "arguments": {} }
            }))
            .send()
            .await
            .expect("get_map_state 2 req");
        let state_json_2: Value = state_resp_2.json().await.expect("state 2 json");
        let state_text_2 = state_json_2["result"]["content"][0]["text"]
            .as_str()
            .expect("state 2 text");
        let state_payload_2: Value =
            serde_json::from_str(state_text_2).expect("state 2 payload");
        assert_eq!(state_payload_2["draftTitle"], "Updated Survey");

        // Graceful shutdown
        server.stop_and_wait().await;
        assert!(!server.status().running);
        assert!(client.get(&health_url).send().await.is_err());
    }

    #[tokio::test]
    async fn mcp_bridge_caps_recent_calls_and_reports_tool_errors() {
        let server = McpBridgeServer::start(0, sample_workspace())
            .await
            .expect("start MCP bridge");
        let status = server.status();
        let client = reqwest::Client::new();

        for i in 0..55 {
            let resp = client
                .post(&status.endpoint_url)
                .bearer_auth(&status.auth_token)
                .json(&json!({
                    "jsonrpc": "2.0",
                    "id": i,
                    "method": "tools/call",
                    "params": {
                        "name": if i == 0 { "nonexistent_tool" } else { "measure_draft" },
                        "arguments": {}
                    }
                }))
                .send()
                .await
                .expect("tool call");
            assert_eq!(resp.status(), StatusCode::OK);
            let body: Value = resp.json().await.expect("json");
            assert_eq!(body["result"]["isError"], i == 0);
        }

        let after = server.status();
        assert_eq!(after.total_calls, 55);
        assert_eq!(after.recent_calls.len(), RECENT_CALL_CAP);
        assert!(after.recent_calls.iter().all(|c| c.tool_name == "measure_draft"));

        server.stop();
    }
}
