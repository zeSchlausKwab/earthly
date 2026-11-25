//! System prompt, chat message models, provider configuration, and OpenAI-compatible
//! tool schema aligned with Earthly's geometry, callout, Story, and Atlas contracts.

use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AgentRole {
    System,
    User,
    Assistant,
    Tool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatMessage {
    pub role: AgentRole,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderConfig {
    /// Base URL for an OpenAI-compatible `/chat/completions` API, e.g.:
    /// - `http://127.0.0.1:11434/v1` (Local Ollama on Mac/LAN)
    /// - `https://openrouter.ai/api/v1`
    /// - `https://api.openai.com/v1`
    /// Leave empty to run purely in offline deterministic spatial-command mode.
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default = "default_max_steps")]
    pub max_tool_steps: u8,
}

fn default_max_steps() -> u8 {
    6
}

impl Default for AgentProviderConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            model: "offline-spatial".to_owned(),
            api_key: None,
            max_tool_steps: 6,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: serde_json::Value,
}

pub fn earthly_system_prompt() -> &'static str {
    "You are Earthly's sovereign cartography and field-mapping assistant. \
     You operate directly on the user's live working GeoJSON draft, authored map callouts \
     (Feature.properties[\"earthly:callouts\"]), Story views, and Atlas spatial workspaces. \
     Prefer calling tools to create, measure, buffer, extrude, style, or annotate real geometry \
     rather than dumping raw GeoJSON in chat prose. Always report real measurements and honest \
     coverage limits (complete vs partial) concisely."
}

pub fn earthly_tool_definitions() -> Vec<ToolDefinition> {
    vec![
        ToolDefinition {
            name: "inspect_workspace".to_owned(),
            description: "Inspect the current map camera, working draft features, and loaded Shelf maps.".to_owned(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "create_point".to_owned(),
            description: "Add a labeled Point feature to the user's working draft (optionally with color and map callout).".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["lon", "lat", "name"],
                "properties": {
                    "lon": { "type": "number" },
                    "lat": { "type": "number" },
                    "name": { "type": "string" },
                    "color": { "type": "string", "description": "Hex color e.g. #1F5F8B" },
                    "calloutTitle": { "type": "string" },
                    "calloutText": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "create_line".to_owned(),
            description: "Add a LineString feature to the working draft from [lon, lat] coordinate pairs.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["coordinates", "name"],
                "properties": {
                    "coordinates": {
                        "type": "array",
                        "items": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 }
                    },
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "create_polygon".to_owned(),
            description: "Add a Polygon feature to the working draft from exterior ring [lon, lat] pairs.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["coordinates", "name"],
                "properties": {
                    "coordinates": {
                        "type": "array",
                        "items": { "type": "array", "items": { "type": "number" }, "minItems": 2, "maxItems": 2 }
                    },
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "create_corridor".to_owned(),
            description: "Buffer the last (or specified) draft LineString into a corridor Polygon of totalWidthMeters using earthly-geo.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["totalWidthMeters"],
                "properties": {
                    "featureId": { "type": "string" },
                    "totalWidthMeters": { "type": "number" },
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "create_flow_arrow".to_owned(),
            description: "Extrude the last (or specified) draft LineString into a directional Flow Arrow Polygon using earthly-geo.".to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "featureId": { "type": "string" },
                    "startWidthMeters": { "type": "number" },
                    "endWidthMeters": { "type": "number" },
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "offset_geometry".to_owned(),
            description: "Create a parallel offset line or buffered polygon (+distanceMeters outward, negative inward) using earthly-geo.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["distanceMeters"],
                "properties": {
                    "featureId": { "type": "string" },
                    "distanceMeters": { "type": "number" },
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "union_polygons".to_owned(),
            description: "Boolean-union all working draft polygons into merged polygon(s) using earthly-geo.".to_owned(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "name": { "type": "string" },
                    "color": { "type": "string" }
                }
            }),
        },
        ToolDefinition {
            name: "measure_draft".to_owned(),
            description: "Measure exact geodesic lengths (meters/km) and areas (m2/hectares) of all features in the working draft.".to_owned(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "add_callout".to_owned(),
            description: "Attach an authored earthly:callouts card (rendered on the map with a leader line) to a working draft feature.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["text"],
                "properties": {
                    "featureId": { "type": "string", "description": "Omit to attach to the most recent draft feature." },
                    "title": { "type": "string" },
                    "text": { "type": "string" },
                    "side": { "type": "string", "enum": ["auto", "right", "top", "left", "bottom"] }
                }
            }),
        },
        ToolDefinition {
            name: "fly_to_location".to_owned(),
            description: "Smoothly animate the live MapLibre camera to a target coordinate and zoom level.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["lon", "lat"],
                "properties": {
                    "lon": { "type": "number" },
                    "lat": { "type": "number" },
                    "zoom": { "type": "number" }
                }
            }),
        },
        ToolDefinition {
            name: "atlas_workspace_status".to_owned(),
            description: "Inspect Atlas spatial workspace availability and honest coverage status (complete vs partial) for the current viewport.".to_owned(),
            parameters: json!({ "type": "object", "properties": {} }),
        },
        ToolDefinition {
            name: "fetch_webpage".to_owned(),
            description: "Fetch a public HTTP/HTTPS webpage, extract its title, clean readable text, geographic coordinates (lat/lon or geo: URIs), and OpenStreetMap/GeoJSON links so you can plot facts directly onto the user's draft.".to_owned(),
            parameters: json!({
                "type": "object",
                "required": ["url"],
                "properties": {
                    "url": { "type": "string", "description": "HTTP or HTTPS URL to fetch and analyze." }
                }
            }),
        },
    ]
}
