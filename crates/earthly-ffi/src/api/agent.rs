//! Flutter Rust Bridge facade for `crates/earthly-agent` (offline deterministic
//! spatial tools + OpenAI/OpenRouter/local Ollama multi-turn tool-calling loop
//! + CORS-free native webpage/GIS Research Source fetcher + `safeEditing` diffs).

use std::collections::BTreeSet;
use std::time::Duration;

use earthly_agent::runtime::{
    AgentTurnRunResult, RoutstrPaymentOptions, is_routstr_provider, run_agent_turn_with_payment,
};
use earthly_agent::{
    AgentChatMessage, AgentProviderConfig, AgentRole, AgentStreamEvent, AgentTurnInput,
    AgentWorkspaceContext, detect_model_vision_support, fetch_research_webpage,
};
use earthly_domain::diff_feature_collections;
use earthly_geo::import_spatial_text_to_geojson;

use crate::api::wallet::{
    decode_cashu_v3_token, load_cashu_wallet_state, receive_cashu_token, send_cashu_token,
};

const ROUTSTR_DEFAULT_BASE_URL: &str = "https://api.routstr.com/v1";
const ROUTSTR_DEFAULT_PREPAY_SATS: u64 = 25;

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
    pub cashu_spent_sats: Option<u64>,
    pub cashu_refunded_sats: Option<u64>,
    pub cashu_refund_token: Option<String>,
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

fn token_total_sats(token: &str) -> Result<u64, String> {
    let decoded = decode_cashu_v3_token(token)?;
    Ok(decoded
        .entries
        .iter()
        .flat_map(|(_, proofs)| proofs.iter())
        .fold(0u64, |acc, p| acc.saturating_add(p.amount)))
}

async fn prepare_routstr_payment(
    provider_type: Option<String>,
    effective_base_url: &str,
    explicit_cashu_token: Option<String>,
    auto_pay_cashu: Option<bool>,
    cashu_max_sats: Option<u64>,
    wallet_db_path: Option<&str>,
    wallet_pubkey_hex: Option<&str>,
    wallet_master_key_b64: Option<&str>,
) -> Result<Option<RoutstrPaymentOptions>, String> {
    let is_routstr = is_routstr_provider(provider_type.as_deref(), effective_base_url);

    if let Some(tok) = explicit_cashu_token
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let sats = token_total_sats(tok)?;
        return Ok(Some(RoutstrPaymentOptions {
            provider_type: provider_type.or_else(|| is_routstr.then(|| "routstr".to_owned())),
            cashu_token: Some(tok.to_owned()),
            cashu_token_sats: Some(sats),
        }));
    }

    let should_auto_pay = auto_pay_cashu.unwrap_or(false) && is_routstr;
    if !should_auto_pay {
        return Ok(is_routstr.then(|| RoutstrPaymentOptions {
            provider_type: provider_type.or_else(|| Some("routstr".to_owned())),
            cashu_token: None,
            cashu_token_sats: None,
        }));
    }

    let (Some(db_path), Some(pubkey)) = (
        wallet_db_path.map(str::trim).filter(|s| !s.is_empty()),
        wallet_pubkey_hex.map(str::trim).filter(|s| !s.is_empty()),
    ) else {
        return Err(
            "Routstr auto-pay requires an initialized Cashu wallet (sign in to Account first)"
                .to_owned(),
        );
    };

    let prepay_sats = match cashu_max_sats.filter(|&s| s > 0) {
        Some(explicit) => explicit,
        None => {
            let state = load_cashu_wallet_state(
                db_path.to_owned(),
                pubkey.to_owned(),
                wallet_master_key_b64.map(str::to_owned),
            )?;
            if state.balance_sats == 0 {
                return Err(
                    "Cashu wallet balance is 0 sats; mint or receive ecash before calling Routstr"
                        .to_owned(),
                );
            }
            state.balance_sats.min(ROUTSTR_DEFAULT_PREPAY_SATS)
        }
    };

    let sent = send_cashu_token(
        db_path.to_owned(),
        pubkey.to_owned(),
        None,
        prepay_sats,
        Some("Routstr AI".to_owned()),
        wallet_master_key_b64.map(str::to_owned),
    )
    .await?;

    Ok(Some(RoutstrPaymentOptions {
        provider_type: provider_type.or_else(|| Some("routstr".to_owned())),
        cashu_token: Some(sent.token),
        cashu_token_sats: Some(sent.amount_sats),
    }))
}

async fn redeem_routstr_refunds(
    refund_tokens: &[String],
    wallet_db_path: Option<&str>,
    wallet_pubkey_hex: Option<&str>,
    wallet_master_key_b64: Option<&str>,
) -> (u64, Option<String>, bool) {
    if refund_tokens.is_empty() {
        return (0, None, false);
    }
    let mut total_refunded_sats = 0u64;
    let mut last_token = None;
    let mut redeemed_any_to_wallet = false;

    let wallet_target = match (
        wallet_db_path.map(str::trim).filter(|s| !s.is_empty()),
        wallet_pubkey_hex.map(str::trim).filter(|s| !s.is_empty()),
    ) {
        (Some(db), Some(pk)) => Some((db, pk)),
        _ => None,
    };

    for tok in refund_tokens {
        let trimmed = tok.trim();
        if trimmed.is_empty() {
            continue;
        }
        last_token = Some(trimmed.to_owned());
        if let Ok(sats) = token_total_sats(trimmed) {
            total_refunded_sats = total_refunded_sats.saturating_add(sats);
        }
        if let Some((db, pk)) = wallet_target {
            if receive_cashu_token(
                db.to_owned(),
                pk.to_owned(),
                trimmed.to_owned(),
                wallet_master_key_b64.map(str::to_owned),
            )
            .await
            .is_ok()
            {
                redeemed_any_to_wallet = true;
            }
        }
    }

    (total_refunded_sats, last_token, redeemed_any_to_wallet)
}

fn turn_run_result_to_dto(
    base_geojson_for_diff: &str,
    run_res: AgentTurnRunResult,
    refunded_sats: u64,
    refund_token: Option<String>,
) -> AgentTurnResultDto {
    let cashu_refunded_sats = (!run_res.cashu_refund_tokens.is_empty()).then_some(refunded_sats);
    let cashu_spent_sats = match run_res.cashu_sent_sats {
        Some(sent) => Some(sent.saturating_sub(refunded_sats)),
        None => run_res
            .routstr_cost_msats
            .filter(|&m| m > 0)
            .map(|m| m.div_ceil(1000)),
    };
    let mut dto = turn_output_to_dto(base_geojson_for_diff, run_res.output);
    dto.cashu_spent_sats = cashu_spent_sats;
    dto.cashu_refunded_sats = cashu_refunded_sats;
    dto.cashu_refund_token = refund_token;
    dto
}

#[allow(clippy::too_many_arguments)]
async fn execute_agent_turn_core<F>(
    prompt: String,
    history: Vec<AgentMessageDto>,
    provider_base_url: String,
    model: String,
    api_key: Option<String>,
    provider_type: Option<String>,
    cashu_token: Option<String>,
    auto_pay_cashu: Option<bool>,
    cashu_max_sats: Option<u64>,
    cashu_wallet_db_path: Option<String>,
    cashu_wallet_pubkey_hex: Option<String>,
    cashu_wallet_master_key_b64: Option<String>,
    workspace: AgentWorkspaceContext,
    mut on_event: F,
) -> Result<AgentTurnResultDto, String>
where
    F: FnMut(AgentStreamEvent) + Send,
{
    let effective_base_url = if provider_type
        .as_deref()
        .is_some_and(|t| t.trim().eq_ignore_ascii_case("routstr"))
        && provider_base_url.trim().is_empty()
    {
        ROUTSTR_DEFAULT_BASE_URL.to_owned()
    } else {
        provider_base_url
    };

    let payment_opts = prepare_routstr_payment(
        provider_type,
        &effective_base_url,
        cashu_token,
        auto_pay_cashu,
        cashu_max_sats,
        cashu_wallet_db_path.as_deref(),
        cashu_wallet_pubkey_hex.as_deref(),
        cashu_wallet_master_key_b64.as_deref(),
    )
    .await?;

    let provider = AgentProviderConfig {
        base_url: effective_base_url,
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

    let base_geojson_for_diff = workspace.draft_geojson.clone();
    let input = AgentTurnInput {
        prompt,
        history: parsed_history,
        workspace,
    };

    match run_agent_turn_with_payment(&provider, &input, payment_opts.as_ref(), |ev| {
        if !matches!(ev, AgentStreamEvent::Completed { .. }) {
            on_event(ev);
        }
    })
    .await
    {
        Ok(run_res) => {
            let (refunded_sats, refund_token, _) = redeem_routstr_refunds(
                &run_res.cashu_refund_tokens,
                cashu_wallet_db_path.as_deref(),
                cashu_wallet_pubkey_hex.as_deref(),
                cashu_wallet_master_key_b64.as_deref(),
            )
            .await;
            Ok(turn_run_result_to_dto(
                &base_geojson_for_diff,
                run_res,
                refunded_sats,
                refund_token,
            ))
        }
        Err(run_err) => {
            if run_err.cashu_refund_tokens.is_empty() {
                return Err(run_err.message);
            }
            let (refunded_sats, refund_token, redeemed) = redeem_routstr_refunds(
                &run_err.cashu_refund_tokens,
                cashu_wallet_db_path.as_deref(),
                cashu_wallet_pubkey_hex.as_deref(),
                cashu_wallet_master_key_b64.as_deref(),
            )
            .await;
            let suffix = if redeemed && refunded_sats > 0 {
                format!(" (refunded {refunded_sats} sats to Cashu wallet)")
            } else if let Some(tok) = refund_token {
                format!(" (refund token: {tok})")
            } else {
                String::new()
            };
            Err(format!("{}{suffix}", run_err.message))
        }
    }
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
    provider_type: Option<String>,
    cashu_token: Option<String>,
    auto_pay_cashu: Option<bool>,
    cashu_max_sats: Option<u64>,
    cashu_wallet_db_path: Option<String>,
    cashu_wallet_pubkey_hex: Option<String>,
    cashu_wallet_master_key_b64: Option<String>,
) -> Result<AgentTurnResultDto, String> {
    let workspace = AgentWorkspaceContext {
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
    };
    execute_agent_turn_core(
        prompt,
        history,
        provider_base_url,
        model,
        api_key,
        provider_type,
        cashu_token,
        auto_pay_cashu,
        cashu_max_sats,
        cashu_wallet_db_path,
        cashu_wallet_pubkey_hex,
        cashu_wallet_master_key_b64,
        workspace,
        |_| {},
    )
    .await
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
        cashu_spent_sats: None,
        cashu_refunded_sats: None,
        cashu_refund_token: None,
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
    provider_type: Option<String>,
    cashu_token: Option<String>,
    auto_pay_cashu: Option<bool>,
    cashu_max_sats: Option<u64>,
    cashu_wallet_db_path: Option<String>,
    cashu_wallet_pubkey_hex: Option<String>,
    cashu_wallet_master_key_b64: Option<String>,
    sink: crate::frb_generated::StreamSink<AgentStreamEventDto>,
) -> Result<(), String> {
    let workspace = AgentWorkspaceContext {
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
    };

    match execute_agent_turn_core(
        prompt,
        history,
        provider_base_url,
        model,
        api_key,
        provider_type,
        cashu_token,
        auto_pay_cashu,
        cashu_max_sats,
        cashu_wallet_db_path,
        cashu_wallet_pubkey_hex,
        cashu_wallet_master_key_b64,
        workspace,
        |ev| {
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
                AgentStreamEvent::Completed { .. } => return,
            };
            let _ = sink.add(dto);
        },
    )
    .await
    {
        Ok(result_dto) => {
            let _ = sink.add(AgentStreamEventDto {
                event_type: "completed".to_owned(),
                text: None,
                tool_name: None,
                tool_ok: None,
                tool_summary: None,
                step: None,
                result: Some(result_dto),
            });
            Ok(())
        }
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

    fn test_bytes_to_hex(bytes: &[u8]) -> String {
        use std::fmt::Write as _;
        let mut out = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            let _ = write!(&mut out, "{b:02x}");
        }
        out
    }

    fn test_hex_to_bytes(hex: &str) -> Vec<u8> {
        hex.as_bytes()
            .chunks_exact(2)
            .map(|c| u8::from_str_radix(std::str::from_utf8(c).unwrap(), 16).unwrap())
            .collect()
    }

    fn spawn_mock_mint_and_routstr_server(
        mint_keys: std::collections::BTreeMap<u64, secp256k1::SecretKey>,
        keyset_id: String,
        refund_amounts: Vec<u64>,
        fail_chat_with_refund: bool,
    ) -> (
        String,
        String,
        std::sync::mpsc::Receiver<Option<String>>,
        std::sync::Arc<std::sync::atomic::AtomicBool>,
    ) {
        use crate::api::wallet::{encode_cashu_v3_token, hash_to_curve};
        use earthly_storage::CashuProofRecord;
        use secp256k1::{PublicKey, Scalar, Secp256k1};
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::{Arc, mpsc};

        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let base_url = format!("http://{addr}");
        let (tx, rx) = mpsc::channel::<Option<String>>();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_flag = Arc::clone(&stop);

        let secp = Secp256k1::new();
        let mut pub_map = serde_json::Map::new();
        for (&amt, sk) in &mint_keys {
            let pk = PublicKey::from_secret_key(&secp, sk);
            pub_map.insert(amt.to_string(), serde_json::json!(test_bytes_to_hex(&pk.serialize())));
        }

        let refund_proofs: Vec<CashuProofRecord> = refund_amounts
            .iter()
            .enumerate()
            .map(|(i, &amt)| {
                let secret = format!("routstr-refund-{amt}-{i}-{}", addr.port());
                let y = hash_to_curve(secret.as_bytes()).unwrap();
                let c = y
                    .mul_tweak(&secp, &Scalar::from(*mint_keys.get(&amt).unwrap()))
                    .unwrap();
                CashuProofRecord {
                    id: keyset_id.clone(),
                    amount: amt,
                    secret,
                    c: test_bytes_to_hex(&c.serialize()),
                    mint_url: base_url.clone(),
                    token_event_id: None,
                }
            })
            .collect();
        let refund_token =
            encode_cashu_v3_token(&base_url, &refund_proofs, Some("refund"), Some("sat")).unwrap();
        let refund_for_thread = refund_token.clone();

        std::thread::spawn(move || {
            while !stop_flag.load(Ordering::Relaxed) {
                let Ok((mut stream, _)) = listener.accept() else {
                    std::thread::sleep(std::time::Duration::from_millis(5));
                    continue;
                };
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let mut buf = Vec::new();
                let mut tmp = [0u8; 4096];
                let mut header_end = None;
                let mut content_len = 0usize;
                loop {
                    let n = stream.read(&mut tmp).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if header_end.is_none() {
                        if let Some(pos) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                            header_end = Some(pos + 4);
                            let hdr_str = String::from_utf8_lossy(&buf[..pos]);
                            for line in hdr_str.lines() {
                                if let Some((k, v)) = line.split_once(':') {
                                    if k.trim().eq_ignore_ascii_case("content-length") {
                                        content_len = v.trim().parse().unwrap_or(0);
                                    }
                                }
                            }
                        }
                    }
                    if let Some(hend) = header_end {
                        if buf.len() >= hend + content_len {
                            break;
                        }
                    }
                }
                let Some(hend) = header_end else { continue };
                let hdr_str = String::from_utf8_lossy(&buf[..hend]);
                let first_line = hdr_str.lines().next().unwrap_or("");
                let mut parts = first_line.split_whitespace();
                let method = parts.next().unwrap_or("");
                let path = parts.next().unwrap_or("");
                let body_bytes = &buf[hend..hend + content_len];

                let mut x_cashu_req = None;
                for line in hdr_str.lines().skip(1) {
                    if let Some((k, v)) = line.split_once(':') {
                        if k.trim().eq_ignore_ascii_case("x-cashu") {
                            x_cashu_req = Some(v.trim().to_owned());
                        }
                    }
                }

                let (status_line, extra_headers, resp_body) = if method == "GET" && path == "/v1/keysets" {
                    let json_body = serde_json::json!({
                        "keysets": [{ "id": keyset_id, "unit": "sat", "active": true, "input_fee_ppk": 0 }]
                    })
                    .to_string();
                    ("HTTP/1.1 200 OK", Vec::new(), json_body)
                } else if method == "GET" && path.starts_with("/v1/keys/") {
                    let json_body = serde_json::json!({
                        "keysets": [{ "id": keyset_id, "unit": "sat", "keys": pub_map }]
                    })
                    .to_string();
                    ("HTTP/1.1 200 OK", Vec::new(), json_body)
                } else if method == "POST" && path == "/v1/swap" {
                    let req_json: serde_json::Value = serde_json::from_slice(body_bytes).unwrap();
                    let outputs = req_json["outputs"].as_array().unwrap();
                    let mut sigs = Vec::new();
                    for out in outputs {
                        let amt = out["amount"].as_u64().unwrap();
                        let b_bar_hex = out["B_"].as_str().unwrap();
                        let b_bar = PublicKey::from_slice(&test_hex_to_bytes(b_bar_hex)).unwrap();
                        let sk = mint_keys.get(&amt).unwrap();
                        let c_bar = b_bar.mul_tweak(&secp, &Scalar::from(*sk)).unwrap();
                        sigs.push(serde_json::json!({
                            "amount": amt,
                            "id": keyset_id,
                            "C_": test_bytes_to_hex(&c_bar.serialize()),
                        }));
                    }
                    (
                        "HTTP/1.1 200 OK",
                        Vec::new(),
                        serde_json::json!({ "signatures": sigs }).to_string(),
                    )
                } else if method == "POST" && path == "/v1/chat/completions" {
                    let _ = tx.send(x_cashu_req);
                    if fail_chat_with_refund {
                        (
                            "HTTP/1.1 402 Payment Required",
                            vec![format!("X-Cashu: {refund_for_thread}")],
                            serde_json::json!({
                                "error": { "message": "Model overloaded", "refund_token": refund_for_thread }
                            })
                            .to_string(),
                        )
                    } else {
                        (
                            "HTTP/1.1 200 OK",
                            vec![
                                format!("X-Cashu: {refund_for_thread}"),
                                "X-Routstr-Cost-Msats: 5000".to_owned(),
                            ],
                            serde_json::json!({
                                "id": "chatcmpl-routstr-1",
                                "choices": [{
                                    "index": 0,
                                    "message": { "role": "assistant", "content": "Routstr OK" },
                                    "finish_reason": "stop"
                                }],
                                "usage": { "prompt_tokens": 12, "completion_tokens": 4, "total_tokens": 16 }
                            })
                            .to_string(),
                        )
                    }
                } else {
                    ("HTTP/1.1 404 Not Found", Vec::new(), "{}".to_owned())
                };

                let mut raw_resp = format!(
                    "{status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n",
                    resp_body.len()
                );
                for h in extra_headers {
                    raw_resp.push_str(&h);
                    raw_resp.push_str("\r\n");
                }
                raw_resp.push_str("\r\n");
                raw_resp.push_str(&resp_body);
                let _ = stream.write_all(raw_resp.as_bytes());
                let _ = stream.flush();
            }
        });

        (base_url, refund_token, rx, stop)
    }

    #[tokio::test]
    async fn routstr_xcashu_autopay_sends_token_and_redeems_refund_into_wallet() {
        use crate::api::wallet::{derive_keyset_id, hash_to_curve, init_cashu_wallet};
        use earthly_storage::{CashuProofRecord, CashuWalletStore};
        use secp256k1::{PublicKey, Scalar, Secp256k1, SecretKey};
        use std::collections::BTreeMap;
        use std::sync::atomic::Ordering;

        let secp = Secp256k1::new();
        let mut mint_sks = BTreeMap::new();
        let mut mint_pks = BTreeMap::new();
        for (idx, amt) in [1u64, 2, 4, 8, 16].into_iter().enumerate() {
            let sk = SecretKey::from_slice(&[(idx as u8) + 0x21; 32]).unwrap();
            mint_pks.insert(amt, PublicKey::from_secret_key(&secp, &sk));
            mint_sks.insert(amt, sk);
        }
        let keyset_id = derive_keyset_id(&mint_pks);

        let (base_url, refund_token, rx, stop) = spawn_mock_mint_and_routstr_server(
            mint_sks.clone(),
            keyset_id.clone(),
            vec![1, 4],
            false,
        );

        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("routstr_wallet.sqlite3");
        let db_str = db_path.to_string_lossy().to_string();
        let pubkey = "a".repeat(64);
        init_cashu_wallet(
            db_str.clone(),
            pubkey.clone(),
            vec![base_url.clone()],
            vec![],
            None,
        )
        .unwrap();

        let store = CashuWalletStore::open(&db_str).unwrap();
        let mut wallet = store.load_wallet(&pubkey).unwrap().unwrap();
        let y = hash_to_curve(b"initial-16-sat-secret").unwrap();
        let c = y
            .mul_tweak(&secp, &Scalar::from(*mint_sks.get(&16).unwrap()))
            .unwrap();
        wallet.proofs.push(CashuProofRecord {
            id: keyset_id.clone(),
            amount: 16,
            secret: "initial-16-sat-secret".to_owned(),
            c: test_bytes_to_hex(&c.serialize()),
            mint_url: base_url.clone(),
            token_event_id: None,
        });
        store.save_wallet(&wallet).unwrap();

        let result = run_earthly_agent_turn(
            "Summarize Vienna".to_owned(),
            vec![],
            format!("{base_url}/v1"),
            "openai/gpt-4o-mini".to_owned(),
            None,
            16.37,
            48.20,
            13.0,
            "Vienna".to_owned(),
            r#"{"type":"FeatureCollection","features":[]}"#.to_owned(),
            vec![],
            vec![],
            Some("routstr".to_owned()),
            None,
            Some(true),
            Some(10),
            Some(db_str.clone()),
            Some(pubkey.clone()),
            None,
        )
        .await
        .unwrap();

        stop.store(true, Ordering::Relaxed);

        let sent_header = rx.recv().unwrap().expect("expected X-Cashu request header");
        assert_eq!(token_total_sats(&sent_header).unwrap(), 10);
        assert_eq!(result.reply, "Routstr OK");
        assert_eq!(result.cashu_spent_sats, Some(5));
        assert_eq!(result.cashu_refunded_sats, Some(5));
        assert_eq!(result.cashu_refund_token.as_deref(), Some(refund_token.as_str()));

        let final_state = load_cashu_wallet_state(db_str, pubkey, None).unwrap();
        // Started with 16 sats, sent 10 sats (6 change), refunded 5 sats -> 11 sats.
        assert_eq!(final_state.balance_sats, 11);
    }

    #[tokio::test]
    async fn routstr_error_response_still_redeems_xcashu_refund_into_wallet() {
        use crate::api::wallet::{derive_keyset_id, encode_cashu_v3_token, hash_to_curve, init_cashu_wallet};
        use earthly_storage::CashuProofRecord;
        use secp256k1::{PublicKey, Scalar, Secp256k1, SecretKey};
        use std::collections::BTreeMap;
        use std::sync::atomic::Ordering;

        let secp = Secp256k1::new();
        let mut mint_sks = BTreeMap::new();
        let mut mint_pks = BTreeMap::new();
        for (idx, amt) in [1u64, 2, 4, 8].into_iter().enumerate() {
            let sk = SecretKey::from_slice(&[(idx as u8) + 0x51; 32]).unwrap();
            mint_pks.insert(amt, PublicKey::from_secret_key(&secp, &sk));
            mint_sks.insert(amt, sk);
        }
        let keyset_id = derive_keyset_id(&mint_pks);

        let (base_url, _, rx, stop) = spawn_mock_mint_and_routstr_server(
            mint_sks.clone(),
            keyset_id.clone(),
            vec![8],
            true,
        );

        let dir = tempfile::tempdir().unwrap();
        let db_path = dir.path().join("routstr_err_wallet.sqlite3");
        let db_str = db_path.to_string_lossy().to_string();
        let pubkey = "b".repeat(64);
        init_cashu_wallet(
            db_str.clone(),
            pubkey.clone(),
            vec![base_url.clone()],
            vec![],
            None,
        )
        .unwrap();

        let y = hash_to_curve(b"explicit-token-8").unwrap();
        let c = y
            .mul_tweak(&secp, &Scalar::from(*mint_sks.get(&8).unwrap()))
            .unwrap();
        let explicit_tok = encode_cashu_v3_token(
            &base_url,
            &[CashuProofRecord {
                id: keyset_id,
                amount: 8,
                secret: "explicit-token-8".to_owned(),
                c: test_bytes_to_hex(&c.serialize()),
                mint_url: base_url.clone(),
                token_event_id: None,
            }],
            None,
            Some("sat"),
        )
        .unwrap();

        let err = run_earthly_agent_turn(
            "Hello".to_owned(),
            vec![],
            format!("{base_url}/v1"),
            "openai/gpt-4o-mini".to_owned(),
            None,
            16.37,
            48.20,
            13.0,
            "Vienna".to_owned(),
            r#"{"type":"FeatureCollection","features":[]}"#.to_owned(),
            vec![],
            vec![],
            Some("routstr".to_owned()),
            Some(explicit_tok.clone()),
            Some(false),
            None,
            Some(db_str.clone()),
            Some(pubkey.clone()),
            None,
        )
        .await
        .unwrap_err();

        stop.store(true, Ordering::Relaxed);
        assert_eq!(rx.recv().unwrap().as_deref(), Some(explicit_tok.as_str()));
        assert!(err.contains("Model overloaded"));
        assert!(err.contains("refunded 8 sats"));

        let final_state = load_cashu_wallet_state(db_str, pubkey, None).unwrap();
        assert_eq!(final_state.balance_sats, 8);
    }
}
