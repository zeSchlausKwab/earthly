//! Flutter Rust Bridge facade for `crates/earthly-agent` (offline deterministic
//! spatial tools + OpenAI/OpenRouter/local Ollama multi-turn tool-calling loop
//! + CORS-free native webpage/GIS Research Source fetcher + `safeEditing` diffs).

use std::collections::BTreeSet;
use std::time::Duration;

use earthly_agent::{
    AgentChatMessage, AgentProviderConfig, AgentRole, AgentStreamEvent, AgentTurnInput,
    AgentWorkspaceContext, detect_model_vision_support, fetch_research_webpage, run_agent_turn,
    run_agent_turn_streaming,
};
use earthly_domain::diff_feature_collections;
use earthly_geo::import_spatial_text_to_geojson;

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
    pub diff_added: u32,
    pub diff_modified: u32,
    pub diff_removed: u32,
    pub camera_action: Option<AgentCameraActionDto>,
    pub tool_calls: Vec<AgentToolRecordDto>,
    pub used_offline_mode: bool,
    pub prompt_tokens: Option<u32>,
    pub completion_tokens: Option<u32>,
    pub total_tokens: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct AgentStreamEventDto {
    /// `"status" | "delta" | "tool_started" | "tool_finished" | "completed" | "error"`
    pub event_type: String,
    pub text: Option<String>,
    pub tool_name: Option<String>,
    pub tool_ok: Option<bool>,
    pub tool_summary: Option<String>,
    pub step: Option<u32>,
    pub result: Option<AgentTurnResultDto>,
}

#[derive(Clone, Debug)]
pub struct ResearchCoordDto {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Clone, Debug)]
pub struct ResearchSourceDto {
    pub url: String,
    pub title: String,
    pub excerpt: String,
    pub coordinates: Vec<ResearchCoordDto>,
    pub osm_links: Vec<String>,
    pub spatial_links: Vec<String>,
    pub direct_geojson: Option<String>,
    pub direct_format: Option<String>,
    pub direct_feature_count: u32,
}

fn compute_diff_counts(base_geojson: &str, proposed_geojson: &str) -> (u32, u32, u32) {
    let base: serde_json::Value = serde_json::from_str(base_geojson)
        .unwrap_or_else(|_| serde_json::json!({ "type": "FeatureCollection", "features": [] }));
    let proposed: serde_json::Value = serde_json::from_str(proposed_geojson)
        .unwrap_or_else(|_| serde_json::json!({ "type": "FeatureCollection", "features": [] }));
    let diff = diff_feature_collections(&base, &proposed);
    (
        diff.added.len() as u32,
        diff.modified.len() as u32,
        diff.removed.len() as u32,
    )
}

/// Runs one Earthly AI Agent turn in Rust (`earthly-agent` + `earthly-geo`),
/// returning exact `safeEditing` diff counts (`diff_added`, `diff_modified`,
/// `diff_removed`) whenever the agent proposes draft geometry edits.
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
    atlas_workspaces: Vec<String>,
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

    let base_geojson_for_diff = draft_geojson.clone();
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
            atlas_workspaces,
            working_set_titles: vec![],
            catalog_items: vec![],
            map_snapshot_base64: None,
            allow_vision: false,
        },
    };

    let out = run_agent_turn(&provider, &input).await?;
    Ok(turn_output_to_dto(&base_geojson_for_diff, out))
}

/// Probes whether the configured provider/model supports multimodal image input.
/// Fail-safe: returns `"vision"`, `"uncertain"`, or `"no-vision"`.
pub async fn detect_agent_vision_support(
    base_url: String,
    model: String,
    api_key: Option<String>,
) -> String {
    detect_model_vision_support(&base_url, &model, api_key.as_deref())
        .await
        .as_str()
        .to_owned()
}

fn turn_output_to_dto(
    base_geojson_for_diff: &str,
    out: earthly_agent::AgentTurnOutput,
) -> AgentTurnResultDto {
    let (diff_added, diff_modified, diff_removed) = out
        .updated_draft_geojson
        .as_deref()
        .map(|proposed| compute_diff_counts(base_geojson_for_diff, proposed))
        .unwrap_or((0, 0, 0));

    AgentTurnResultDto {
        reply: out.reply,
        updated_draft_geojson: out.updated_draft_geojson,
        diff_added,
        diff_modified,
        diff_removed,
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
        prompt_tokens: out.prompt_tokens,
        completion_tokens: out.completion_tokens,
        total_tokens: out.total_tokens,
    }
}

/// Streams real-time SSE text deltas, live tool execution status, and final
/// `safeEditing` draft diffs back to Flutter via FRB `StreamSink`.
#[allow(clippy::too_many_arguments)]
pub async fn stream_earthly_agent_turn(
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
    atlas_workspaces: Vec<String>,
    working_set_titles: Vec<String>,
    catalog_items: Vec<String>,
    map_snapshot_base64: Option<String>,
    allow_vision: bool,
    sink: crate::frb_generated::StreamSink<AgentStreamEventDto>,
) -> Result<(), String> {
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

    let base_geojson_for_diff = draft_geojson.clone();
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
            atlas_workspaces,
            working_set_titles,
            catalog_items,
            map_snapshot_base64,
            allow_vision,
        },
    };

    match run_agent_turn_streaming(&provider, &input, |ev| {
        let dto = match ev {
            AgentStreamEvent::Status { message } => AgentStreamEventDto {
                event_type: "status".to_owned(),
                text: Some(message),
                tool_name: None,
                tool_ok: None,
                tool_summary: None,
                step: None,
                result: None,
            },
            AgentStreamEvent::TextDelta { text } => AgentStreamEventDto {
                event_type: "delta".to_owned(),
                text: Some(text),
                tool_name: None,
                tool_ok: None,
                tool_summary: None,
                step: None,
                result: None,
            },
            AgentStreamEvent::ToolStarted { name, step } => AgentStreamEventDto {
                event_type: "tool_started".to_owned(),
                text: None,
                tool_name: Some(name),
                tool_ok: None,
                tool_summary: None,
                step: Some(step as u32),
                result: None,
            },
            AgentStreamEvent::ToolFinished { record, step } => AgentStreamEventDto {
                event_type: "tool_finished".to_owned(),
                text: None,
                tool_name: Some(record.name),
                tool_ok: Some(record.ok),
                tool_summary: Some(record.summary),
                step: Some(step as u32),
                result: None,
            },
            AgentStreamEvent::Completed { output } => AgentStreamEventDto {
                event_type: "completed".to_owned(),
                text: None,
                tool_name: None,
                tool_ok: None,
                tool_summary: None,
                step: None,
                result: Some(turn_output_to_dto(&base_geojson_for_diff, output)),
            },
        };
        let _ = sink.add(dto);
    })
    .await
    {
        Ok(_) => Ok(()),
        Err(err) => {
            let _ = sink.add(AgentStreamEventDto {
                event_type: "error".to_owned(),
                text: Some(err.clone()),
                tool_name: None,
                tool_ok: None,
                tool_summary: None,
                step: None,
                result: None,
            });
            Err(err)
        }
    }
}

/// Fetches any webpage or remote GeoJSON/GPX/KML URL CORS-free in Rust for the
/// native Research / Source Pane, extracting readable text, coordinates,
/// OSM/spatial links, and (when pointing at a spatial document) validated GeoJSON.
pub async fn fetch_research_source(url: String) -> Result<ResearchSourceDto, String> {
    let extracted = fetch_research_webpage(&url).await?;
    let trimmed_body = extracted.raw_body.trim_start_matches('\u{feff}').trim();
    let lower_url = extracted.url.to_ascii_lowercase();
    let looks_spatial = lower_url.ends_with(".geojson")
        || lower_url.ends_with(".json")
        || lower_url.ends_with(".gpx")
        || lower_url.ends_with(".kml")
        || trimmed_body.starts_with('{')
        || trimmed_body.starts_with("<gpx")
        || trimmed_body.starts_with("<kml")
        || trimmed_body.contains("<gpx ")
        || trimmed_body.contains("<kml ");

    let (direct_geojson, direct_format, direct_feature_count, title) = if looks_spatial {
        let fname = extracted.url.rsplit('/').next().unwrap_or("");
        match import_spatial_text_to_geojson(Some(fname), trimmed_body) {
            Ok(imported) => (
                serde_json::to_string(&imported.geojson).ok(),
                Some(imported.format),
                imported.feature_count as u32,
                if imported.title.is_empty() {
                    extracted.title
                } else {
                    imported.title
                },
            ),
            Err(_) => (None, None, 0, extracted.title),
        }
    } else {
        (None, None, 0, extracted.title)
    };

    Ok(ResearchSourceDto {
        url: extracted.url,
        title,
        excerpt: extracted.excerpt,
        coordinates: extracted
            .coordinates
            .into_iter()
            .map(|(lat, lon)| ResearchCoordDto { lat, lon })
            .collect(),
        osm_links: extracted.osm_links,
        spatial_links: extracted.spatial_links,
        direct_geojson,
        direct_format,
        direct_feature_count,
    })
}

fn parse_models_response_json(body: &str) -> Vec<String> {
    let Ok(val) = serde_json::from_str::<serde_json::Value>(body) else {
        return Vec::new();
    };
    let mut models = BTreeSet::new();
    if let Some(arr) = val.get("data").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()).map(str::trim) {
                if !id.is_empty() {
                    models.insert(id.to_owned());
                }
            }
        }
    }
    if let Some(arr) = val.get("models").and_then(|v| v.as_array()) {
        for item in arr {
            let candidate = item
                .get("name")
                .or_else(|| item.get("id"))
                .and_then(|v| v.as_str())
                .map(str::trim);
            if let Some(id) = candidate.filter(|s| !s.is_empty()) {
                models.insert(id.to_owned());
            }
        }
    }
    models.into_iter().take(100).collect()
}

/// Discovers available models from an OpenAI-compatible (`/models`) or local
/// Ollama (`/v1/models` or `/api/tags`) endpoint.
pub async fn fetch_agent_provider_models(
    base_url: String,
    api_key: Option<String>,
) -> Result<Vec<String>, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter a provider Base URL before discovering models.".to_owned());
    }

    let mut candidate_urls = Vec::new();
    if trimmed.ends_with("/v1") {
        candidate_urls.push(format!("{trimmed}/models"));
        if trimmed.contains("11434") {
            let root = trimmed.trim_end_matches("/v1");
            candidate_urls.push(format!("{root}/api/tags"));
        }
    } else if trimmed.contains("11434") {
        candidate_urls.push(format!("{trimmed}/v1/models"));
        candidate_urls.push(format!("{trimmed}/api/tags"));
    } else {
        candidate_urls.push(format!("{trimmed}/models"));
        candidate_urls.push(format!("{trimmed}/v1/models"));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let auth = api_key
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| format!("Bearer {s}"));

    let mut last_err = String::new();
    for url in candidate_urls {
        let mut req = client.get(&url);
        if let Some(ref bearer) = auth {
            req = req.header("Authorization", bearer);
        }
        match req.send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.text().await.unwrap_or_default();
                let parsed = parse_models_response_json(&body);
                if !parsed.is_empty() {
                    return Ok(parsed);
                }
                last_err = format!("{url} returned no models");
            }
            Ok(resp) => {
                last_err = format!("{url} returned HTTP {}", resp.status());
            }
            Err(err) => {
                last_err = format!("{url}: {err}");
            }
        }
    }

    Err(if last_err.is_empty() {
        "No models returned by provider endpoint".to_owned()
    } else {
        last_err
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_safe_editing_diff_counts() {
        let base = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Old"}}]}"#;
        let proposed = r#"{"type":"FeatureCollection","features":[{"type":"Feature","id":"p1","geometry":{"type":"Point","coordinates":[16.37,48.20]},"properties":{"name":"Renamed"}},{"type":"Feature","id":"p2","geometry":{"type":"Point","coordinates":[16.38,48.21]},"properties":{"name":"New"}}]}"#;
        let (added, modified, removed) = compute_diff_counts(base, proposed);
        assert_eq!((added, modified, removed), (1, 1, 0));
    }

    #[test]
    fn parses_openai_and_ollama_models_payloads() {
        let openai = r#"{"data":[{"id":"qwen/qwen3-32b"},{"id":"anthropic/claude-3.7-sonnet"},{"id":"  "},{"id":"qwen/qwen3-32b"}]}"#;
        let parsed_openai = parse_models_response_json(openai);
        assert_eq!(
            parsed_openai,
            vec!["anthropic/claude-3.7-sonnet", "qwen/qwen3-32b"]
        );

        let ollama = r#"{"models":[{"name":"llama3.2:latest"},{"name":"qwen2.5:14b"}]}"#;
        let parsed_ollama = parse_models_response_json(ollama);
        assert_eq!(parsed_ollama, vec!["llama3.2:latest", "qwen2.5:14b"]);
    }

    #[tokio::test]
    async fn detects_vision_support_fail_safely() {
        let offline = detect_agent_vision_support(
            String::new(),
            "offline-spatial".to_owned(),
            None,
        )
        .await;
        assert_eq!(offline, "no-vision");

        let heuristic = detect_agent_vision_support(
            String::new(),
            "gpt-4o".to_owned(),
            None,
        )
        .await;
        assert_eq!(heuristic, "uncertain");
    }
}
