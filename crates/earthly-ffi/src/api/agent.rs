//! Flutter Rust Bridge facade for `crates/earthly-agent` (offline deterministic
//! spatial tools + OpenAI/OpenRouter/local Ollama multi-turn tool-calling loop
//! + CORS-free native webpage/GIS Research Source fetcher + `safeEditing` diffs).

use earthly_agent::{
    AgentChatMessage, AgentProviderConfig, AgentRole, AgentTurnInput, AgentWorkspaceContext,
    fetch_research_webpage, run_agent_turn,
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
        },
    };

    let out = run_agent_turn(&provider, &input).await?;
    let (diff_added, diff_modified, diff_removed) = out
        .updated_draft_geojson
        .as_deref()
        .map(|proposed| compute_diff_counts(&base_geojson_for_diff, proposed))
        .unwrap_or((0, 0, 0));

    Ok(AgentTurnResultDto {
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
    })
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
}
