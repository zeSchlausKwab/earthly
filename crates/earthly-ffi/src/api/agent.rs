//! Flutter Rust Bridge facade for `crates/earthly-agent` (offline deterministic
//! spatial tools + OpenAI/OpenRouter/local Ollama multi-turn tool-calling loop).

use earthly_agent::{
    AgentChatMessage, AgentProviderConfig, AgentRole, AgentTurnInput, AgentWorkspaceContext,
    run_agent_turn,
};

#[derive(Clone, Debug)]
pub struct AgentMessageDto {
    pub role: String,
    pub content: String,
}

#[derive(Clone, Debug)]
pub struct AgentToolRecordDto {
    pub name: String,
    pub ok: bool,
    pub summary: String,
}

#[derive(Clone, Debug)]
pub struct AgentCameraActionDto {
    pub lon: f64,
    pub lat: f64,
    pub zoom: f64,
}

#[derive(Clone, Debug)]
pub struct AgentTurnResultDto {
    pub reply: String,
    pub updated_draft_geojson: Option<String>,
    pub camera_action: Option<AgentCameraActionDto>,
    pub tool_calls: Vec<AgentToolRecordDto>,
    pub used_offline_mode: bool,
}

/// Runs one Earthly AI Agent turn in Rust (`earthly-agent` + `earthly-geo`).
///
/// Leave `provider_base_url` empty (or model = `"offline-spatial"`) to execute
/// deterministic spatial tools offline with zero API key. Otherwise connects to
/// any OpenAI-compatible endpoint (e.g. `http://127.0.0.1:11434/v1` for local
/// Ollama, `https://openrouter.ai/api/v1`, or `https://api.openai.com/v1`).
#[allow(clippy::too_many_arguments)]
pub async fn run_earthly_agent_turn(
    prompt: String,
    history: Vec<AgentMessageDto>,
    provider_base_url: String,
    model: String,
    api_key: Option<String>,
    center_lon: f64,
    center_lat: f64,
    zoom: f64,
    draft_title: String,
    draft_geojson: String,
    shelf_map_titles: Vec<String>,
) -> Result<AgentTurnResultDto, String> {
    let provider = AgentProviderConfig {
        base_url: provider_base_url,
        model,
        api_key,
        max_tool_steps: 6,
    };

    let parsed_history = history
        .into_iter()
        .map(|m| AgentChatMessage {
            role: match m.role.as_str() {
                "assistant" => AgentRole::Assistant,
                "system" => AgentRole::System,
                _ => AgentRole::User,
            },
            content: m.content,
            tool_call_id: None,
            tool_name: None,
        })
        .collect();

    let input = AgentTurnInput {
        prompt,
        history: parsed_history,
        workspace: AgentWorkspaceContext {
            center_lon,
            center_lat,
            zoom,
            draft_title,
            draft_geojson,
            shelf_map_titles,
            atlas_workspaces: Vec::new(),
        },
    };

    let out = run_agent_turn(&provider, &input).await?;
    Ok(AgentTurnResultDto {
        reply: out.reply,
        updated_draft_geojson: out.updated_draft_geojson,
        camera_action: out.camera_action.map(|c| AgentCameraActionDto {
            lon: c.lon,
            lat: c.lat,
            zoom: c.zoom,
        }),
        tool_calls: out
            .tool_calls
            .into_iter()
            .map(|t| AgentToolRecordDto {
                name: t.name,
                ok: t.ok,
                summary: t.summary,
            })
            .collect(),
        used_offline_mode: out.used_offline_mode,
    })
}
