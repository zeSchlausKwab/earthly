//! Native async OpenAI-compatible multi-turn tool-calling loop (`native-http`),
//! plus lightweight native webpage research (`fetch_webpage`) that extracts
//! readable prose, coordinates, and OSM/GeoJSON references without any WebView.
//! Works with local Ollama (`http://127.0.0.1:11434/v1`), OpenRouter, OpenAI,
//! LM Studio, llama.cpp server, or offline deterministic mode.

use std::collections::BTreeMap;
use std::time::Duration;

use serde_json::{Value, json};

use crate::executor::{
    AgentTurnInput, AgentTurnOutput, AgentWorkspaceContext, ExecutedToolRecord, MutableDraftState,
    execute_local_offline_turn, execute_tool_call,
};
use crate::schema::{
    AgentProviderConfig, AgentRole, earthly_system_prompt, earthly_tool_definitions,
};

const MAX_WEBPAGE_BYTES: usize = 512 * 1024;

#[derive(Clone, Debug)]
pub struct ResearchPageExtract {
    pub url: String,
    pub title: String,
    pub excerpt: String,
    pub coordinates: Vec<(f64, f64)>,
    pub osm_links: Vec<String>,
    pub spatial_links: Vec<String>,
    pub raw_body: String,
}

pub async fn fetch_research_webpage(raw_url: &str) -> Result<ResearchPageExtract, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(14))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;
    let url = raw_url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL must start with http:// or https://".to_owned());
    }
    let mut resp = client
        .get(url)
        .timeout(Duration::from_secs(14))
        .header(
            reqwest::header::ACCEPT,
            "text/html,application/geo+json,application/json,application/gpx+xml,application/vnd.google-earth.kml+xml,text/plain;q=0.9",
        )
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("failed reading response body: {e}"))?
    {
        let remaining = MAX_WEBPAGE_BYTES.saturating_sub(buf.len());
        if remaining == 0 {
            break;
        }
        let take = chunk.len().min(remaining);
        buf.extend_from_slice(&chunk[..take]);
        if buf.len() >= MAX_WEBPAGE_BYTES {
            break;
        }
    }
    let body = String::from_utf8_lossy(&buf).into_owned();
    let title = extract_html_title(&body).unwrap_or_else(|| url.to_owned());
    let plain_text = strip_html_to_text(&body);
    let excerpt: String = plain_text.chars().take(4000).collect();
    let coordinates = extract_coordinates(&body, &plain_text);
    let osm_links = extract_matching_urls(&body, "openstreetmap.org/");
    let mut spatial_links = extract_matching_urls(&body, ".geojson");
    for extra in extract_matching_urls(&body, ".gpx")
        .into_iter()
        .chain(extract_matching_urls(&body, ".kml"))
    {
        if !spatial_links.contains(&extra) {
            spatial_links.push(extra);
        }
    }
    Ok(ResearchPageExtract {
        url: url.to_owned(),
        title,
        excerpt,
        coordinates,
        osm_links,
        spatial_links,
        raw_body: body,
    })
}

#[derive(Clone, Debug)]
pub enum AgentStreamEvent {
    Status { message: String },
    TextDelta { text: String },
    ToolStarted { name: String, step: u8 },
    ToolFinished { record: ExecutedToolRecord, step: u8 },
    Completed { output: AgentTurnOutput },
}

#[derive(Clone, Debug, Default)]
struct AccumulatedToolCall {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Clone, Debug, Default)]
struct SseTurnAccumulator {
    reply_buf: String,
    tool_calls: BTreeMap<usize, AccumulatedToolCall>,
    prompt_tokens: u32,
    completion_tokens: u32,
    total_tokens: u32,
    done: bool,
}

fn process_sse_data_line(
    raw_line: &str,
    acc: &mut SseTurnAccumulator,
    on_delta: &mut impl FnMut(String),
) {
    let trimmed = raw_line.trim();
    let Some(data) = trimmed.strip_prefix("data:") else {
        return;
    };
    let payload = data.trim();
    if payload.is_empty() {
        return;
    }
    if payload == "[DONE]" {
        acc.done = true;
        return;
    }
    let Ok(chunk) = serde_json::from_str::<Value>(payload) else {
        return;
    };
    if let Some(usage) = chunk.get("usage") {
        let pt = usage.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0) as u32;
        let ct = usage.get("completion_tokens").and_then(Value::as_u64).unwrap_or(0) as u32;
        let tt = usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .unwrap_or((pt + ct) as u64) as u32;
        if pt > 0 {
            acc.prompt_tokens = pt;
        }
        if ct > 0 {
            acc.completion_tokens = ct;
        }
        if tt > 0 {
            acc.total_tokens = tt;
        }
    }
    let Some(choices) = chunk.get("choices").and_then(Value::as_array) else {
        return;
    };
    for choice in choices {
        let Some(delta) = choice.get("delta") else {
            continue;
        };
        if let Some(text) = delta.get("content").and_then(Value::as_str) {
            if !text.is_empty() {
                acc.reply_buf.push_str(text);
                on_delta(text.to_owned());
            }
        }
        if let Some(tc_deltas) = delta.get("tool_calls").and_then(Value::as_array) {
            for tc in tc_deltas {
                let idx = tc.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
                let entry = acc.tool_calls.entry(idx).or_default();
                if let Some(id) = tc.get("id").and_then(Value::as_str) {
                    if !id.is_empty() {
                        entry.id = id.to_owned();
                    }
                }
                if let Some(fn_obj) = tc.get("function") {
                    if let Some(name) = fn_obj.get("name").and_then(Value::as_str) {
                        if entry.name.is_empty() {
                            entry.name = name.to_owned();
                        } else if !name.is_empty() && entry.name != name {
                            entry.name.push_str(name);
                        }
                    }
                    if let Some(args) = fn_obj.get("arguments").and_then(Value::as_str) {
                        entry.arguments.push_str(args);
                    }
                }
            }
        }
    }
}

fn format_snapshot_data_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("data:image/") {
        Some(trimmed.to_owned())
    } else {
        Some(format!("data:image/png;base64,{trimmed}"))
    }
}

pub(crate) fn advertised_tools_json(allow_vision: bool) -> Vec<Value> {
    earthly_tool_definitions()
        .into_iter()
        .filter(|t| allow_vision || t.name != "capture_map_snapshot")
        .map(|t| {
            json!({
                "type": "function",
                "function": {
                    "name": t.name,
                    "description": t.description,
                    "parameters": t.parameters
                }
            })
        })
        .collect()
}

/// Builds the OpenAI-compatible user message, attaching the visible map canvas
/// snapshot PNG ONLY when `workspace.allow_vision` is true and
/// `workspace.map_snapshot_base64` is non-empty.
pub(crate) fn build_user_message(prompt: &str, workspace: &AgentWorkspaceContext) -> Value {
    if workspace.allow_vision {
        if let Some(url) = workspace
            .map_snapshot_base64
            .as_deref()
            .and_then(format_snapshot_data_url)
        {
            return json!({
                "role": "user",
                "content": [
                    { "type": "text", "text": prompt },
                    { "type": "image_url", "image_url": { "url": url } }
                ]
            });
        }
    }
    json!({ "role": "user", "content": prompt })
}

/// Builds a multimodal user observation after `capture_map_snapshot` succeeds.
/// Returns `None` whenever `workspace.allow_vision` is false or no snapshot exists.
pub(crate) fn build_snapshot_observation_message(
    workspace: &AgentWorkspaceContext,
    feature_count: usize,
) -> Option<Value> {
    if !workspace.allow_vision {
        return None;
    }
    let url = workspace
        .map_snapshot_base64
        .as_deref()
        .and_then(format_snapshot_data_url)?;
    let caption = format!(
        "Map canvas snapshot attached (center=({:.5}, {:.5}), zoom={:.1}, draftFeatureCount={}).",
        workspace.center_lat, workspace.center_lon, workspace.zoom, feature_count
    );
    Some(json!({
        "role": "user",
        "content": [
            { "type": "text", "text": caption },
            { "type": "image_url", "image_url": { "url": url } }
        ]
    }))
}

pub async fn run_agent_turn(
    provider: &AgentProviderConfig,
    input: &AgentTurnInput,
) -> Result<AgentTurnOutput, String> {
    run_agent_turn_streaming(provider, input, |_| {}).await
}

/// Optional Routstr Cashu RIP-01 (`X-Cashu`) payment configuration for an agent turn.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RoutstrPaymentOptions {
    pub provider_type: Option<String>,
    pub cashu_token: Option<String>,
    pub cashu_token_sats: Option<u64>,
}

/// Result of an agent turn including any Routstr Cashu RIP-01 settlement details.
#[derive(Clone, Debug)]
pub struct AgentTurnRunResult {
    pub output: AgentTurnOutput,
    pub cashu_sent_sats: Option<u64>,
    pub cashu_refund_tokens: Vec<String>,
    pub routstr_cost_msats: Option<u64>,
}

/// Error returned by [`run_agent_turn_with_payment`], preserving any `X-Cashu`
/// refund tokens emitted by the provider on an error response.
#[derive(Clone, Debug)]
pub struct AgentTurnRunError {
    pub message: String,
    pub cashu_refund_tokens: Vec<String>,
}

pub fn is_routstr_provider(provider_type: Option<&str>, base_url: &str) -> bool {
    if provider_type.is_some_and(|t| t.trim().eq_ignore_ascii_case("routstr")) {
        return true;
    }
    base_url.trim().to_ascii_lowercase().contains("routstr.com")
}

pub(crate) fn extract_xcashu_header(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get("X-Cashu")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

pub(crate) fn extract_routstr_cost_msats(headers: &reqwest::header::HeaderMap) -> Option<u64> {
    headers
        .get("X-Routstr-Cost-Msats")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<f64>().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| v.round() as u64)
}

pub(crate) fn read_routstr_error_body(body_text: &str) -> (Option<String>, Option<String>) {
    let Ok(parsed) = serde_json::from_str::<Value>(body_text) else {
        return (None, None);
    };
    let nested = parsed.get("error");
    let message = nested
        .and_then(|e| e.get("message"))
        .and_then(Value::as_str)
        .or_else(|| parsed.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let refund_token = nested
        .and_then(|e| e.get("refund_token"))
        .and_then(Value::as_str)
        .or_else(|| parsed.get("refund_token").and_then(Value::as_str))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    (message, refund_token)
}

pub async fn run_agent_turn_streaming<F>(
    provider: &AgentProviderConfig,
    input: &AgentTurnInput,
    mut on_event: F,
) -> Result<AgentTurnOutput, String>
where
    F: FnMut(AgentStreamEvent) + Send,
{
    let res = run_agent_turn_with_payment(provider, input, None, |ev| {
        on_event(ev);
    })
    .await
    .map_err(|e| e.message)?;
    Ok(res.output)
}

pub async fn run_agent_turn_with_payment<F>(
    provider: &AgentProviderConfig,
    input: &AgentTurnInput,
    payment: Option<&RoutstrPaymentOptions>,
    mut on_event: F,
) -> Result<AgentTurnRunResult, AgentTurnRunError>
where
    F: FnMut(AgentStreamEvent) + Send,
{
    let base = provider.base_url.trim().trim_end_matches('/');
    if base.is_empty() || provider.model.trim() == "offline-spatial" {
        on_event(AgentStreamEvent::Status {
            message: "Running offline Rust spatial agent…".to_owned(),
        });
        let output = if let Some(url) = extract_first_http_url(&input.prompt) {
            run_offline_url_research(&url, input)
                .await
                .map_err(|message| AgentTurnRunError {
                    message,
                    cashu_refund_tokens: Vec::new(),
                })?
        } else {
            execute_local_offline_turn(input)
        };
        for (idx, rec) in output.tool_calls.iter().enumerate() {
            on_event(AgentStreamEvent::ToolFinished {
                record: rec.clone(),
                step: (idx + 1) as u8,
            });
        }
        if !output.reply.is_empty() {
            on_event(AgentStreamEvent::TextDelta {
                text: output.reply.clone(),
            });
        }
        on_event(AgentStreamEvent::Completed {
            output: output.clone(),
        });
        return Ok(AgentTurnRunResult {
            output,
            cashu_sent_sats: None,
            cashu_refund_tokens: Vec::new(),
            routstr_cost_msats: None,
        });
    }

    let endpoint = format!("{base}/chat/completions");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| AgentTurnRunError {
            message: format!("failed to build HTTP client: {e}"),
            cashu_refund_tokens: Vec::new(),
        })?;

    let tools_json = advertised_tools_json(input.workspace.allow_vision);

    let mut state = MutableDraftState::from_geojson(
        &input.workspace.draft_geojson,
        &input.workspace.draft_title,
    );

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": format!(
            "{}\n\nCurrent map viewport: center=({:.5}, {:.5}), zoom={:.1}, draft=\"{}\" ({} features), shelf maps={:?}, working_set={:?}, catalog_items={}.",
            earthly_system_prompt(),
            input.workspace.center_lat,
            input.workspace.center_lon,
            input.workspace.zoom,
            input.workspace.draft_title,
            state.fc["features"].as_array().map(Vec::len).unwrap_or(0),
            input.workspace.shelf_map_titles,
            input.workspace.working_set_titles,
            input.workspace.catalog_items.len(),
        )
    })];

    for msg in input.history.iter().rev().take(10).rev() {
        let role = match msg.role {
            AgentRole::System => "system",
            AgentRole::User => "user",
            AgentRole::Assistant => "assistant",
            AgentRole::Tool => continue,
        };
        messages.push(json!({ "role": role, "content": msg.content }));
    }
    messages.push(build_user_message(&input.prompt, &input.workspace));

    let mut executed: Vec<ExecutedToolRecord> = Vec::new();
    let mut sum_prompt_tokens: u32 = 0;
    let mut sum_completion_tokens: u32 = 0;
    let mut sum_total_tokens: u32 = 0;
    let max_steps = provider.max_tool_steps.clamp(1, 10);

    let mut pending_cashu_token = payment
        .and_then(|p| p.cashu_token.as_deref())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned);
    let initial_cashu_sats = payment.and_then(|p| p.cashu_token_sats).filter(|&s| s > 0);
    let mut sent_cashu_token = false;
    let mut unspent_refund_token: Option<String> = None;
    let mut total_cost_msats: u64 = 0;
    let mut saw_cost_msats = false;

    for step in 0..max_steps {
        on_event(AgentStreamEvent::Status {
            message: format!("Step {}/{} · Thinking…", step + 1, max_steps),
        });
        let mut req = client.post(&endpoint).json(&json!({
            "model": provider.model.trim(),
            "messages": messages,
            "tools": tools_json,
            "tool_choice": "auto",
            "temperature": 0.2,
            "stream": true,
            "stream_options": { "include_usage": true }
        }));
        if let Some(key) = provider
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
        {
            req = req.bearer_auth(key);
        }
        if let Some(tok) = pending_cashu_token.take() {
            req = req.header("X-Cashu", tok);
            sent_cashu_token = true;
            // Previous step's refund token has now been forwarded to this step.
            unspent_refund_token = None;
        }

        let mut resp = req.send().await.map_err(|e| AgentTurnRunError {
            message: format!("LLM request to {endpoint} failed: {e}"),
            cashu_refund_tokens: unspent_refund_token.take().into_iter().collect(),
        })?;
        let status = resp.status();
        let header_refund = extract_xcashu_header(resp.headers());
        if let Some(msats) = extract_routstr_cost_msats(resp.headers()) {
            total_cost_msats = total_cost_msats.saturating_add(msats);
            saw_cost_msats = true;
        }
        let is_sse = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(|ct| ct.to_ascii_lowercase().contains("text/event-stream"))
            .unwrap_or(false);

        if !status.is_success() {
            let body_text = resp.text().await.unwrap_or_default();
            let (parsed_msg, body_refund) = read_routstr_error_body(&body_text);
            let err_msg = parsed_msg.unwrap_or_else(|| {
                if body_text.trim().is_empty() {
                    "provider returned an error".to_owned()
                } else {
                    body_text
                }
            });
            let refund = header_refund.or(body_refund).or(unspent_refund_token.take());
            return Err(AgentTurnRunError {
                message: format!("LLM error ({status}): {err_msg}"),
                cashu_refund_tokens: refund.into_iter().collect(),
            });
        }

        if let Some(refund) = header_refund {
            pending_cashu_token = Some(refund.clone());
            unspent_refund_token = Some(refund);
        }

        let (reply_text, parsed_tcs, step_assistant_msg) = if is_sse {
            let mut acc = SseTurnAccumulator::default();
            let mut line_buf = String::new();
            while let Some(chunk) = resp.chunk().await.map_err(|e| AgentTurnRunError {
                message: format!("failed reading SSE stream: {e}"),
                cashu_refund_tokens: unspent_refund_token.take().into_iter().collect(),
            })? {
                let piece = String::from_utf8_lossy(&chunk);
                line_buf.push_str(&piece);
                while let Some(pos) = line_buf.find('\n') {
                    let line = line_buf[..pos].trim_end_matches('\r').to_owned();
                    line_buf.drain(..=pos);
                    process_sse_data_line(&line, &mut acc, &mut |delta| {
                        on_event(AgentStreamEvent::TextDelta { text: delta });
                    });
                    if acc.done {
                        break;
                    }
                }
                if acc.done {
                    break;
                }
            }
            if !line_buf.trim().is_empty() && !acc.done {
                process_sse_data_line(line_buf.trim_end_matches('\r'), &mut acc, &mut |delta| {
                    on_event(AgentStreamEvent::TextDelta { text: delta });
                });
            }
            sum_prompt_tokens = sum_prompt_tokens.saturating_add(acc.prompt_tokens);
            sum_completion_tokens = sum_completion_tokens.saturating_add(acc.completion_tokens);
            sum_total_tokens = sum_total_tokens.saturating_add(acc.total_tokens);

            let tcs: Vec<(String, String, Value)> = acc
                .tool_calls
                .into_values()
                .enumerate()
                .map(|(i, tc)| {
                    let id = if tc.id.is_empty() {
                        format!("call_{step}_{i}")
                    } else {
                        tc.id
                    };
                    let args: Value =
                        serde_json::from_str(&tc.arguments).unwrap_or_else(|_| json!({}));
                    (id, tc.name, args)
                })
                .collect();

            let mut msg = json!({
                "role": "assistant",
                "content": if acc.reply_buf.is_empty() { Value::Null } else { json!(acc.reply_buf) }
            });
            if !tcs.is_empty() {
                msg["tool_calls"] = json!(
                    tcs.iter()
                        .map(|(id, name, args)| json!({
                            "id": id,
                            "type": "function",
                            "function": {
                                "name": name,
                                "arguments": serde_json::to_string(args).unwrap_or_else(|_| "{}".to_owned()),
                            }
                        }))
                        .collect::<Vec<_>>()
                );
            }
            (acc.reply_buf, tcs, msg)
        } else {
            let body: Value = resp.json().await.map_err(|e| AgentTurnRunError {
                message: format!("invalid JSON from LLM ({status}): {e}"),
                cashu_refund_tokens: unspent_refund_token.take().into_iter().collect(),
            })?;
            if let Some(usage) = body.get("usage") {
                let pt = usage.get("prompt_tokens").and_then(Value::as_u64).unwrap_or(0) as u32;
                let ct = usage
                    .get("completion_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                let tt = usage
                    .get("total_tokens")
                    .and_then(Value::as_u64)
                    .unwrap_or((pt + ct) as u64) as u32;
                sum_prompt_tokens = sum_prompt_tokens.saturating_add(pt);
                sum_completion_tokens = sum_completion_tokens.saturating_add(ct);
                sum_total_tokens = sum_total_tokens.saturating_add(tt);
            }

            let choice_msg = body
                .get("choices")
                .and_then(Value::as_array)
                .and_then(|c| c.first())
                .and_then(|c| c.get("message"))
                .ok_or_else(|| AgentTurnRunError {
                    message: "LLM response missing choices[0].message".to_owned(),
                    cashu_refund_tokens: unspent_refund_token.take().into_iter().collect(),
                })?;

            let raw_tcs = choice_msg
                .get("tool_calls")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let tcs: Vec<(String, String, Value)> = raw_tcs
                .iter()
                .enumerate()
                .map(|(i, tc)| {
                    let call_id = tc
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("call_0")
                        .to_owned();
                    let fn_obj = tc.get("function");
                    let fn_name = fn_obj
                        .and_then(|f| f.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_owned();
                    let raw_args = fn_obj
                        .and_then(|f| f.get("arguments"))
                        .and_then(Value::as_str)
                        .unwrap_or("{}");
                    let parsed_args: Value =
                        serde_json::from_str(raw_args).unwrap_or_else(|_| json!({}));
                    let _ = i;
                    (call_id, fn_name, parsed_args)
                })
                .collect();
            let content = choice_msg
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_owned();
            if tcs.is_empty() && !content.is_empty() {
                on_event(AgentStreamEvent::TextDelta {
                    text: content.clone(),
                });
            }
            (content, tcs, choice_msg.clone())
        };

        if parsed_tcs.is_empty() {
            let reply = if reply_text.trim().is_empty() {
                "Done.".to_owned()
            } else {
                reply_text.trim().to_owned()
            };
            let updated_draft_geojson = state
                .modified
                .then(|| serde_json::to_string(&state.fc).unwrap_or_default());
            let output = AgentTurnOutput {
                reply,
                updated_draft_geojson,
                camera_action: state.camera_action,
                tool_calls: executed,
                used_offline_mode: false,
                prompt_tokens: (sum_total_tokens > 0).then_some(sum_prompt_tokens),
                completion_tokens: (sum_total_tokens > 0).then_some(sum_completion_tokens),
                total_tokens: (sum_total_tokens > 0).then_some(sum_total_tokens),
            };
            on_event(AgentStreamEvent::Completed {
                output: output.clone(),
            });
            return Ok(AgentTurnRunResult {
                output,
                cashu_sent_sats: sent_cashu_token.then_some(initial_cashu_sats).flatten(),
                cashu_refund_tokens: unspent_refund_token.into_iter().collect(),
                routstr_cost_msats: saw_cost_msats.then_some(total_cost_msats),
            });
        }

        messages.push(step_assistant_msg);
        for (call_id, fn_name, parsed_args) in parsed_tcs {
            on_event(AgentStreamEvent::ToolStarted {
                name: fn_name.clone(),
                step: step + 1,
            });
            let (record, tool_result) = match fn_name.as_str() {
                "fetch_webpage" => {
                    let target_url = parsed_args
                        .get("url")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    match fetch_and_extract_webpage(&client, target_url).await {
                        Ok(extracted) => {
                            let title = extracted["title"].as_str().unwrap_or(target_url);
                            let coords_len = extracted["coordinates"]
                                .as_array()
                                .map(Vec::len)
                                .unwrap_or(0);
                            let rec = ExecutedToolRecord {
                                name: "fetch_webpage".to_owned(),
                                ok: true,
                                summary: format!("Fetched \"{title}\" ({coords_len} coord(s))"),
                            };
                            (rec, extracted)
                        }
                        Err(err) => (
                            ExecutedToolRecord {
                                name: "fetch_webpage".to_owned(),
                                ok: false,
                                summary: err.clone(),
                            },
                            json!({ "error": err }),
                        ),
                    }
                }
                "geocode_place" => {
                    run_agent_geocode(&client, &parsed_args, &input.workspace, &mut state).await
                }
                "query_osm_bbox" => {
                    run_agent_osm_query(&client, &parsed_args, &input.workspace, &mut state).await
                }
                "valhalla_route" => {
                    run_agent_valhalla_route(&client, &parsed_args, &mut state).await
                }
                "valhalla_isochrone" => {
                    run_agent_valhalla_isochrone(&client, &parsed_args, &mut state).await
                }
                "lookup_admin_boundary" => {
                    run_agent_admin_boundary(&client, &parsed_args, &mut state).await
                }
                _ => execute_tool_call(&fn_name, &parsed_args, &input.workspace, &mut state),
            };
            let tool_ok = record.ok;
            on_event(AgentStreamEvent::ToolFinished {
                record: record.clone(),
                step: step + 1,
            });
            executed.push(record);

            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": serde_json::to_string(&tool_result).unwrap_or_default()
            }));
            if fn_name == "capture_map_snapshot" && tool_ok && input.workspace.allow_vision {
                let feature_count = state.fc["features"].as_array().map(Vec::len).unwrap_or(0);
                if let Some(obs) =
                    build_snapshot_observation_message(&input.workspace, feature_count)
                {
                    messages.push(obs);
                }
            }
        }
    }

    let updated_draft_geojson = state
        .modified
        .then(|| serde_json::to_string(&state.fc).unwrap_or_default());
    let output = AgentTurnOutput {
        reply: format!("Executed {} spatial tool step(s).", executed.len()),
        updated_draft_geojson,
        camera_action: state.camera_action,
        tool_calls: executed,
        used_offline_mode: false,
        prompt_tokens: (sum_total_tokens > 0).then_some(sum_prompt_tokens),
        completion_tokens: (sum_total_tokens > 0).then_some(sum_completion_tokens),
        total_tokens: (sum_total_tokens > 0).then_some(sum_total_tokens),
    };
    on_event(AgentStreamEvent::Completed {
        output: output.clone(),
    });
    Ok(AgentTurnRunResult {
        output,
        cashu_sent_sats: sent_cashu_token.then_some(initial_cashu_sats).flatten(),
        cashu_refund_tokens: unspent_refund_token.into_iter().collect(),
        routstr_cost_msats: saw_cost_msats.then_some(total_cost_msats),
    })
}

async fn run_offline_url_research(
    url: &str,
    input: &AgentTurnInput,
) -> Result<AgentTurnOutput, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("EarthlyNative/1.0 (+https://earthly.city)")
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let mut state = MutableDraftState::from_geojson(
        &input.workspace.draft_geojson,
        &input.workspace.draft_title,
    );
    let mut tool_calls = Vec::new();

    match fetch_and_extract_webpage(&client, url).await {
        Ok(extracted) => {
            let title = extracted["title"].as_str().unwrap_or(url).to_owned();
            let excerpt = extracted["excerpt"].as_str().unwrap_or("").to_owned();
            let coords = extracted["coordinates"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let osm_links = extracted["osmLinks"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let geojson_links = extracted["geojsonLinks"]
                .as_array()
                .cloned()
                .unwrap_or_default();

            tool_calls.push(ExecutedToolRecord {
                name: "fetch_webpage".to_owned(),
                ok: true,
                summary: format!("Fetched \"{title}\" ({} coord(s))", coords.len()),
            });

            // Automatically plot up to 5 extracted coordinates as labeled points with callouts.
            let mut plotted = 0usize;
            for (idx, item) in coords.iter().take(5).enumerate() {
                if let (Some(lat), Some(lon)) = (item["lat"].as_f64(), item["lon"].as_f64()) {
                    let pin_name = if coords.len() == 1 {
                        title.clone()
                    } else {
                        format!("{title} #{}", idx + 1)
                    };
                    let (rec, _) = execute_tool_call(
                        "create_point",
                        &json!({
                            "lon": lon,
                            "lat": lat,
                            "name": pin_name,
                            "color": "#1F5F8B",
                            "calloutTitle": title,
                            "calloutText": format!("Source: {url}")
                        }),
                        &input.workspace,
                        &mut state,
                    );
                    if rec.ok {
                        plotted += 1;
                    }
                    tool_calls.push(rec);
                }
            }

            let mut lines = vec![format!("Researched **{title}** ({url})")];
            if plotted > 0 {
                lines.push(format!(
                    "• Plotted {plotted} extracted coordinate(s) onto your working draft with callouts."
                ));
            } else {
                lines.push("• No explicit coordinates found on this page.".to_owned());
            }
            if !osm_links.is_empty() {
                let sample: Vec<&str> = osm_links
                    .iter()
                    .filter_map(Value::as_str)
                    .take(3)
                    .collect();
                lines.push(format!("• OSM references: {}", sample.join(", ")));
            }
            if !geojson_links.is_empty() {
                let sample: Vec<&str> = geojson_links
                    .iter()
                    .filter_map(Value::as_str)
                    .take(3)
                    .collect();
                lines.push(format!("• GeoJSON links: {}", sample.join(", ")));
            }
            if !excerpt.is_empty() {
                let preview: String = excerpt.chars().take(360).collect();
                lines.push(format!("\nExcerpt:\n{preview}"));
            }

            let updated_draft_geojson = state
                .modified
                .then(|| serde_json::to_string(&state.fc).unwrap_or_default());
            Ok(AgentTurnOutput {
                reply: lines.join("\n"),
                updated_draft_geojson,
                camera_action: state.camera_action,
                tool_calls,
                used_offline_mode: true,
                prompt_tokens: None,
                completion_tokens: None,
                total_tokens: None,
            })
        }
        Err(err) => {
            tool_calls.push(ExecutedToolRecord {
                name: "fetch_webpage".to_owned(),
                ok: false,
                summary: err.clone(),
            });
            Ok(AgentTurnOutput {
                reply: format!("Could not fetch {url}: {err}"),
                updated_draft_geojson: None,
                camera_action: None,
                tool_calls,
                used_offline_mode: true,
                prompt_tokens: None,
                completion_tokens: None,
                total_tokens: None,
            })
        }
    }
}

async fn run_agent_admin_boundary(
    client: &reqwest::Client,
    args: &Value,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    let query = args.get("query").and_then(Value::as_str).unwrap_or("").trim();
    if query.is_empty() {
        return agent_err("lookup_admin_boundary", "query is required");
    }
    let tolerance = args
        .get("toleranceMeters")
        .and_then(Value::as_f64)
        .unwrap_or(50.0)
        .max(5.0);
    let Ok(url) = reqwest::Url::parse_with_params(
        "https://nominatim.openstreetmap.org/search",
        &[
            ("format", "geojson"),
            ("polygon_geojson", "1"),
            ("limit", "1"),
            ("q", query),
        ],
    ) else {
        return agent_err("lookup_admin_boundary", "Invalid Nominatim URL");
    };
    let Ok(resp) = client.get(url).send().await else {
        return agent_err("lookup_admin_boundary", "Nominatim boundary request failed");
    };
    if !resp.status().is_success() {
        return agent_err("lookup_admin_boundary", &format!("Nominatim HTTP {}", resp.status()));
    }
    let Ok(body) = resp.json::<Value>().await else {
        return agent_err("lookup_admin_boundary", "Invalid Nominatim GeoJSON");
    };
    let Some(feat) = body.get("features").and_then(Value::as_array).and_then(|a| a.first()) else {
        return agent_err("lookup_admin_boundary", "No matching boundary found");
    };
    let title = feat
        .get("properties")
        .and_then(|p| p.get("display_name"))
        .and_then(Value::as_str)
        .unwrap_or(query);
    let geom = &feat["geometry"];
    let gtype = geom.get("type").and_then(Value::as_str).unwrap_or("");
    let outer_coords = if gtype == "Polygon" {
        geom.get("coordinates").and_then(Value::as_array).and_then(|a| a.first())
    } else if gtype == "MultiPolygon" {
        geom.get("coordinates")
            .and_then(Value::as_array)
            .and_then(|a| a.first())
            .and_then(Value::as_array)
            .and_then(|a| a.first())
    } else {
        None
    };
    let Some(ring_vals) = outer_coords.and_then(Value::as_array) else {
        return agent_err("lookup_admin_boundary", "Nominatim result has no boundary polygon");
    };
    let pts: Vec<geo::Coord<f64>> = ring_vals
        .iter()
        .filter_map(|p| {
            let a = p.as_array()?;
            Some(geo::Coord { x: a.first()?.as_f64()?, y: a.get(1)?.as_f64()? })
        })
        .collect();
    if pts.len() < 4 {
        return agent_err("lookup_admin_boundary", "Boundary ring has too few points");
    }
    let poly = geo::Polygon::new(geo::LineString::new(pts), vec![]);
    let simplified = earthly_geo::simplify_polygon(&poly, tolerance).unwrap_or(poly);
    let ring: Vec<[f64; 2]> = simplified.exterior().0.iter().map(|c| [c.x, c.y]).collect();
    let cx = ring.iter().map(|p| p[0]).sum::<f64>() / (ring.len() as f64);
    let cy = ring.iter().map(|p| p[1]).sum::<f64>() / (ring.len() as f64);
    state.append_geojson_features(&json!({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": { "type": "Polygon", "coordinates": [ring] },
            "properties": { "name": title, "source": "osm-nominatim", "strokeColor": "#0F766E", "fillColor": "#14B8A6", "fillOpacity": 0.16 }
        }]
    }));
    state.camera_action = Some(crate::executor::AgentCameraAction { lon: cx, lat: cy, zoom: 11.5 });
    (
        ExecutedToolRecord {
            name: "lookup_admin_boundary".to_owned(),
            ok: true,
            summary: format!("Imported boundary for \"{title}\" ({} vertices)", simplified.exterior().0.len()),
        },
        json!({ "name": title, "vertices": simplified.exterior().0.len() }),
    )
}

async fn fetch_and_extract_webpage(client: &reqwest::Client, raw_url: &str) -> Result<Value, String> {
    let url = raw_url.trim();
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err("URL must start with http:// or https://".to_owned());
    }

    let mut resp = client
        .get(url)
        .timeout(Duration::from_secs(12))
        .header(reqwest::header::ACCEPT, "text/html,application/json,text/plain;q=0.9")
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    let mut buf = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("failed reading response body: {e}"))?
    {
        let remaining = MAX_WEBPAGE_BYTES.saturating_sub(buf.len());
        if remaining == 0 {
            break;
        }
        let take = chunk.len().min(remaining);
        buf.extend_from_slice(&chunk[..take]);
        if buf.len() >= MAX_WEBPAGE_BYTES {
            break;
        }
    }

    let body = String::from_utf8_lossy(&buf).into_owned();
    let title = extract_html_title(&body).unwrap_or_else(|| url.to_owned());
    let plain_text = strip_html_to_text(&body);
    let excerpt: String = plain_text.chars().take(3500).collect();
    let coordinates = extract_coordinates(&body, &plain_text);
    let osm_links = extract_matching_urls(&body, "openstreetmap.org/");
    let geojson_links = extract_matching_urls(&body, ".geojson");

    Ok(json!({
        "url": url,
        "title": title,
        "excerpt": excerpt,
        "coordinates": coordinates
            .into_iter()
            .map(|(lat, lon)| json!({ "lat": lat, "lon": lon }))
            .collect::<Vec<_>>(),
        "osmLinks": osm_links,
        "geojsonLinks": geojson_links,
    }))
}

fn extract_first_http_url(text: &str) -> Option<String> {
    for token in text.split_whitespace() {
        let cleaned = token.trim_matches(|c: char| {
            matches!(c, '(' | ')' | '[' | ']' | '<' | '>' | '"' | '\'' | ',' | ';')
        });
        if cleaned.starts_with("https://") || cleaned.starts_with("http://") {
            return Some(cleaned.to_owned());
        }
    }
    None
}

fn extract_html_title(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let open_end = lower[start..].find('>')? + start + 1;
    let close = lower[open_end..].find("</title>")? + open_end;
    let raw = html.get(open_end..close)?.trim();
    let decoded = decode_basic_entities(raw);
    let collapsed = collapse_whitespace(&decoded);
    (!collapsed.is_empty()).then_some(collapsed)
}

fn strip_html_to_text(html: &str) -> String {
    let mut cleaned = html.to_owned();
    for tag in ["script", "style", "noscript", "svg"] {
        cleaned = strip_tag_blocks(&cleaned, tag);
    }

    let mut out = String::with_capacity(cleaned.len().min(32_768));
    let mut in_tag = false;
    for ch in cleaned.chars() {
        match ch {
            '<' => {
                in_tag = true;
                out.push(' ');
            }
            '>' => {
                in_tag = false;
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    collapse_whitespace(&decode_basic_entities(&out))
}

fn strip_tag_blocks(input: &str, tag: &str) -> String {
    let open_pat = format!("<{tag}");
    let close_pat = format!("</{tag}>");
    let mut result = String::with_capacity(input.len());
    let mut cursor = 0usize;
    let lower = input.to_lowercase();

    while let Some(rel_start) = lower[cursor..].find(&open_pat) {
        let start = cursor + rel_start;
        result.push_str(&input[cursor..start]);
        if let Some(rel_end) = lower[start..].find(&close_pat) {
            cursor = start + rel_end + close_pat.len();
        } else {
            cursor = input.len();
            break;
        }
    }
    if cursor < input.len() {
        result.push_str(&input[cursor..]);
    }
    result
}

fn decode_basic_entities(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
}

fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn extract_matching_urls(raw: &str, needle: &str) -> Vec<String> {
    let mut out = Vec::new();
    for token in raw.split(|c: char| c.is_whitespace() || matches!(c, '"' | '\'' | '<' | '>' | '(' | ')')) {
        if (token.starts_with("http://") || token.starts_with("https://"))
            && token.contains(needle)
            && !out.iter().any(|existing: &String| existing == token)
        {
            out.push(token.to_owned());
            if out.len() >= 10 {
                break;
            }
        }
    }
    out
}

fn extract_coordinates(raw_html: &str, plain_text: &str) -> Vec<(f64, f64)> {
    let mut out: Vec<(f64, f64)> = Vec::new();
    let mut push_unique = |lat: f64, lon: f64| {
        if !lat.is_finite()
            || !lon.is_finite()
            || !(-85.0..=85.0).contains(&lat)
            || !(-180.0..=180.0).contains(&lon)
            || (lat.abs() < 0.001 && lon.abs() < 0.001)
        {
            return;
        }
        let dup = out
            .iter()
            .any(|(a, b)| (a - lat).abs() < 1e-4 && (b - lon).abs() < 1e-4);
        if !dup && out.len() < 12 {
            out.push((lat, lon));
        }
    };

    // 1. geo:lat,lon URIs
    for part in raw_html.split("geo:").skip(1) {
        if let Some((lat, lon)) = parse_two_floats_prefix(part, ',') {
            push_unique(lat, lon);
        }
    }
    // 2. OSM #map=zoom/lat/lon
    for part in raw_html.split("#map=").skip(1) {
        let segs: Vec<&str> = part
            .split(|c: char| !c.is_ascii_digit() && !matches!(c, '.' | '-' | '/'))
            .next()
            .unwrap_or("")
            .split('/')
            .collect();
        if segs.len() >= 3 {
            if let (Ok(lat), Ok(lon)) = (segs[1].parse::<f64>(), segs[2].parse::<f64>()) {
                push_unique(lat, lon);
            }
        }
    }
    // 3. Google Maps / Mapbox @lat,lon
    for part in raw_html.split('@').skip(1) {
        if let Some((lat, lon)) = parse_two_floats_prefix(part, ',') {
            if lat.abs() >= 1.0 && lon.abs() >= 1.0 {
                push_unique(lat, lon);
            }
        }
    }
    // 4. Plain decimal pairs with >= 3 decimal digits (e.g. "48.2082, 16.3738")
    let tokens: Vec<&str> = plain_text.split_whitespace().collect();
    for window in tokens.windows(2) {
        let a = window[0].trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | ',' | ';'));
        let b = window[1].trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | ',' | ';'));
        if has_geocoord_precision(a) && has_geocoord_precision(b) {
            if let (Ok(lat), Ok(lon)) = (a.parse::<f64>(), b.parse::<f64>()) {
                push_unique(lat, lon);
            }
        }
    }

    out
}

fn has_geocoord_precision(s: &str) -> bool {
    if let Some((_, frac)) = s.split_once('.') {
        frac.len() >= 3 && frac.chars().all(|c| c.is_ascii_digit())
    } else {
        false
    }
}

fn parse_two_floats_prefix(s: &str, sep: char) -> Option<(f64, f64)> {
    let prefix: String = s
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == '.' || *c == '-' || *c == '+' || *c == sep)
        .collect();
    let (a, b) = prefix.split_once(sep)?;
    let first = a.parse::<f64>().ok()?;
    let second = b.split(sep).next()?.parse::<f64>().ok()?;
    Some((first, second))
}

fn agent_err(name: &str, msg: &str) -> (ExecutedToolRecord, Value) {
    (
        ExecutedToolRecord {
            name: name.to_owned(),
            ok: false,
            summary: msg.to_owned(),
        },
        json!({ "error": msg }),
    )
}

async fn run_agent_geocode(
    client: &reqwest::Client,
    args: &Value,
    workspace: &crate::executor::AgentWorkspaceContext,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    let q = args
        .get("query")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if q.is_empty() {
        return agent_err("geocode_place", "query is required");
    }
    let resp = client
        .get("https://photon.komoot.io/api")
        .query(&[("q", q), ("limit", "5")])
        .send()
        .await;
    let Ok(r) = resp else {
        return agent_err("geocode_place", "Photon request failed");
    };
    let Ok(body) = r.json::<Value>().await else {
        return agent_err("geocode_place", "Invalid Photon JSON");
    };
    let hits = body
        .get("features")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if let Some(first) = hits.first() {
        if let Some(coords) = first
            .get("geometry")
            .and_then(|g| g.get("coordinates"))
            .and_then(Value::as_array)
        {
            if coords.len() >= 2 {
                if let (Some(lon), Some(lat)) = (coords[0].as_f64(), coords[1].as_f64()) {
                    state.camera_action = Some(crate::executor::AgentCameraAction {
                        lon,
                        lat,
                        zoom: workspace.zoom.max(14.0),
                    });
                }
            }
        }
    }
    let count = hits.len();
    (
        ExecutedToolRecord {
            name: "geocode_place".to_owned(),
            ok: true,
            summary: format!("Geocoded \"{q}\" ({count} candidate(s))"),
        },
        json!({ "query": q, "features": hits }),
    )
}

async fn run_agent_osm_query(
    client: &reqwest::Client,
    args: &Value,
    workspace: &crate::executor::AgentWorkspaceContext,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    let preset = args
        .get("preset")
        .and_then(Value::as_str)
        .unwrap_or("highway")
        .trim()
        .to_ascii_lowercase();
    let span = 0.015;
    let west = args.get("west").and_then(Value::as_f64).unwrap_or(workspace.center_lon - span);
    let south = args.get("south").and_then(Value::as_f64).unwrap_or(workspace.center_lat - span);
    let east = args.get("east").and_then(Value::as_f64).unwrap_or(workspace.center_lon + span);
    let north = args.get("north").and_then(Value::as_f64).unwrap_or(workspace.center_lat + span);
    if (east - west) > 0.5 || (north - south) > 0.5 || east <= west || north <= south {
        return agent_err("query_osm_bbox", "Invalid or oversized (>0.5°) bbox");
    }
    let filter = match args.get("customTag").and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty()) {
        Some(tag) => {
            if let Some((k, v)) = tag.split_once('=') {
                format!(r#"["{}"="{}"]"#, k.trim(), v.trim().replace('"', ""))
            } else {
                format!(r#"["{}"]"#, tag.replace('"', ""))
            }
        }
        None => match preset.as_str() {
            "peaks" => r#"["natural"="peak"]"#.to_owned(),
            "water" => r#"["amenity"="drinking_water"]"#.to_owned(),
            "highway" | "waterway" | "building" | "natural" | "amenity" | "leisure" | "railway" => {
                format!(r#"["{preset}"]"#)
            }
            _ => r#"["name"]"#.to_owned(),
        },
    };
    let q = format!(
        "[out:json][timeout:16];(nwr{filter}({south:.6},{west:.6},{north:.6},{east:.6}););out geom 80;"
    );
    let Ok(resp) = client
        .post("https://overpass-api.de/api/interpreter")
        .form(&[("data", q.as_str())])
        .send()
        .await
    else {
        return agent_err("query_osm_bbox", "Overpass request failed");
    };
    if !resp.status().is_success() {
        return agent_err("query_osm_bbox", &format!("Overpass HTTP {}", resp.status()));
    }
    let Ok(body) = resp.json::<Value>().await else {
        return agent_err("query_osm_bbox", "Invalid Overpass JSON");
    };
    let elements = body
        .get("elements")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut feats = Vec::new();
    for el in elements.into_iter().take(80) {
        let el_type = el.get("type").and_then(Value::as_str).unwrap_or("");
        let mut props = el.get("tags").and_then(Value::as_object).cloned().unwrap_or_default();
        if el_type == "node" {
            if let (Some(lat), Some(lon)) = (
                el.get("lat").and_then(Value::as_f64),
                el.get("lon").and_then(Value::as_f64),
            ) {
                feats.push(json!({
                    "type": "Feature",
                    "geometry": { "type": "Point", "coordinates": [lon, lat] },
                    "properties": props
                }));
            }
        } else if el_type == "way" {
            if let Some(arr) = el.get("geometry").and_then(Value::as_array) {
                let ring: Vec<[f64; 2]> = arr
                    .iter()
                    .filter_map(|p| Some([p.get("lon")?.as_f64()?, p.get("lat")?.as_f64()?]))
                    .collect();
                if ring.len() >= 2 {
                    let closed = ring.len() >= 4 && ring.first() == ring.last() && !props.contains_key("highway");
                    let geom = if closed {
                        json!({ "type": "Polygon", "coordinates": [ring] })
                    } else {
                        json!({ "type": "LineString", "coordinates": ring })
                    };
                    props.insert("source".to_owned(), json!("overpass"));
                    feats.push(json!({ "type": "Feature", "geometry": geom, "properties": props }));
                }
            }
        }
    }
    let fc = json!({ "type": "FeatureCollection", "features": feats });
    let added = state.append_geojson_features(&fc);
    (
        ExecutedToolRecord {
            name: "query_osm_bbox".to_owned(),
            ok: true,
            summary: format!("Imported {added} OSM feature(s) for {preset}"),
        },
        json!({ "addedCount": added, "preset": preset }),
    )
}

fn decode_agent_polyline6(encoded: &str) -> Vec<[f64; 2]> {
    let bytes = encoded.as_bytes();
    let (mut idx, mut lat, mut lon) = (0usize, 0i64, 0i64);
    let mut out = Vec::new();
    while idx < bytes.len() {
        let (mut shift, mut result) = (0u32, 0i64);
        loop {
            if idx >= bytes.len() {
                return out;
            }
            let b = (bytes[idx] as i64) - 63;
            idx += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        lat += if (result & 1) != 0 { !(result >> 1) } else { result >> 1 };
        shift = 0;
        result = 0;
        loop {
            if idx >= bytes.len() {
                return out;
            }
            let b = (bytes[idx] as i64) - 63;
            idx += 1;
            result |= (b & 0x1f) << shift;
            shift += 5;
            if b < 0x20 {
                break;
            }
        }
        lon += if (result & 1) != 0 { !(result >> 1) } else { result >> 1 };
        out.push([(lon as f64) / 1e6, (lat as f64) / 1e6]);
    }
    out
}

async fn run_agent_valhalla_route(
    client: &reqwest::Client,
    args: &Value,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    let waypoints = args
        .get("waypoints")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if waypoints.len() < 2 {
        return agent_err("valhalla_route", "At least 2 waypoints required");
    }
    let profile = match args.get("profile").and_then(Value::as_str).unwrap_or("pedestrian") {
        "bicycle" | "bike" => "bicycle",
        "auto" | "drive" => "auto",
        _ => "pedestrian",
    };
    let locs: Vec<Value> = waypoints
        .iter()
        .filter_map(|w| Some(json!({ "lon": w.get("lon")?.as_f64()?, "lat": w.get("lat")?.as_f64()? })))
        .collect();
    if locs.len() < 2 {
        return agent_err("valhalla_route", "Valid waypoint lon/lat required");
    }
    let Ok(resp) = client
        .post("https://valhalla1.openstreetmap.de/route")
        .json(&json!({ "locations": locs, "costing": profile, "units": "kilometers", "directions_type": "none" }))
        .send()
        .await
    else {
        return agent_err("valhalla_route", "Valhalla request failed");
    };
    if !resp.status().is_success() {
        return agent_err("valhalla_route", &format!("Valhalla HTTP {}", resp.status()));
    }
    let Ok(body) = resp.json::<Value>().await else {
        return agent_err("valhalla_route", "Invalid Valhalla JSON");
    };
    let mut coords = Vec::new();
    for leg in body
        .get("trip")
        .and_then(|t| t.get("legs"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(shape) = leg.get("shape").and_then(Value::as_str) {
            coords.extend(decode_agent_polyline6(shape));
        }
    }
    if coords.len() < 2 {
        return agent_err("valhalla_route", "Valhalla returned no route geometry");
    }
    let km = body["trip"]["summary"]["length"].as_f64().unwrap_or(0.0);
    let min = body["trip"]["summary"]["time"].as_f64().unwrap_or(0.0) / 60.0;
    let fc = json!({
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "geometry": { "type": "LineString", "coordinates": coords },
            "properties": { "name": format!("Route · {km:.2} km ({profile})"), "source": "valhalla", "strokeColor": "#0284C7", "strokeWidth": 4 }
        }]
    });
    state.append_geojson_features(&fc);
    (
        ExecutedToolRecord {
            name: "valhalla_route".to_owned(),
            ok: true,
            summary: format!("Routed {km:.2} km · {min:.0} min ({profile})"),
        },
        json!({ "lengthKm": km, "durationMin": min, "profile": profile }),
    )
}

async fn run_agent_valhalla_isochrone(
    client: &reqwest::Client,
    args: &Value,
    state: &mut MutableDraftState,
) -> (ExecutedToolRecord, Value) {
    let (Some(lon), Some(lat)) = (
        args.get("lon").and_then(Value::as_f64),
        args.get("lat").and_then(Value::as_f64),
    ) else {
        return agent_err("valhalla_isochrone", "lon and lat required");
    };
    let profile = match args.get("profile").and_then(Value::as_str).unwrap_or("bicycle") {
        "pedestrian" | "walk" => "pedestrian",
        "auto" | "drive" => "auto",
        _ => "bicycle",
    };
    let mins: Vec<Value> = args
        .get("contoursMinutes")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_u64().map(|m| json!({ "time": m.clamp(1, 60) })))
                .take(4)
                .collect()
        })
        .filter(|v: &Vec<Value>| !v.is_empty())
        .unwrap_or_else(|| vec![json!({ "time": 10 }), json!({ "time": 20 })]);

    let Ok(resp) = client
        .post("https://valhalla1.openstreetmap.de/isochrone")
        .json(&json!({ "locations": [{ "lat": lat, "lon": lon }], "costing": profile, "contours": mins, "polygons": true }))
        .send()
        .await
    else {
        return agent_err("valhalla_isochrone", "Valhalla isochrone request failed");
    };
    if !resp.status().is_success() {
        return agent_err("valhalla_isochrone", &format!("Valhalla HTTP {}", resp.status()));
    }
    let Ok(body) = resp.json::<Value>().await else {
        return agent_err("valhalla_isochrone", "Invalid Valhalla isochrone JSON");
    };
    let added = state.append_geojson_features(&body);
    (
        ExecutedToolRecord {
            name: "valhalla_isochrone".to_owned(),
            ok: added > 0,
            summary: format!("Added {added} isochrone band(s) ({profile})"),
        },
        json!({ "addedCount": added, "profile": profile }),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_title_text_and_coordinates_from_html() {
        let html = r#"
            <html><head><title>Danube Field Notes &amp; Map</title>
            <script>var x = 1;</script></head>
            <body>
              <h1>Vienna Survey</h1>
              <p>Point at 48.2082, 16.3738 and <a href="geo:48.2160,16.3959">Prater</a>.</p>
              <a href="https://www.openstreetmap.org/node/12345#map=16/48.2090/16.3700">OSM</a>
            </body></html>
        "#;
        assert_eq!(
            extract_html_title(html).as_deref(),
            Some("Danube Field Notes & Map")
        );
        let text = strip_html_to_text(html);
        assert!(text.contains("Vienna Survey"));
        assert!(!text.contains("var x = 1"));
        let coords = extract_coordinates(html, &text);
        assert!(coords.len() >= 3);
        let osm = extract_matching_urls(html, "openstreetmap.org/");
        assert_eq!(osm.len(), 1);
    }

    #[test]
    fn parses_sse_text_deltas_tool_call_chunks_and_usage() {
        let mut acc = SseTurnAccumulator::default();
        let mut deltas = Vec::new();
        let lines = [
            r#"data: {"choices":[{"delta":{"content":"Mapping "}}]}"#,
            r#"data: {"choices":[{"delta":{"content":"route..."}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"create_point","arguments":"{\"lon\":16.37,"}}]}}]}"#,
            r#"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"lat\":48.20,\"name\":\"Hub\"}"}}]}}]}"#,
            r#"data: {"choices":[],"usage":{"prompt_tokens":84,"completion_tokens":26,"total_tokens":110}}"#,
            r#"data: [DONE]"#,
        ];
        for line in lines {
            process_sse_data_line(line, &mut acc, &mut |d| deltas.push(d));
        }
        assert!(acc.done);
        assert_eq!(deltas, vec!["Mapping ", "route..."]);
        assert_eq!(acc.reply_buf, "Mapping route...");
        assert_eq!(acc.prompt_tokens, 84);
        assert_eq!(acc.completion_tokens, 26);
        assert_eq!(acc.total_tokens, 110);
        let tc = acc.tool_calls.get(&0).unwrap();
        assert_eq!(tc.id, "call_9");
        assert_eq!(tc.name, "create_point");
        let parsed: Value = serde_json::from_str(&tc.arguments).unwrap();
        assert_eq!(parsed["name"], "Hub");
        assert_eq!(parsed["lon"], 16.37);
    }

    #[test]
    fn multimodal_user_payload_never_sends_images_when_allow_vision_is_false() {
        let workspace_disabled = AgentWorkspaceContext {
            center_lon: 16.375,
            center_lat: 48.208,
            zoom: 14.0,
            draft_title: "Vienna".to_owned(),
            draft_geojson: json!({ "type": "FeatureCollection", "features": [] }).to_string(),
            shelf_map_titles: vec![],
            atlas_workspaces: vec![],
            working_set_titles: vec![],
            catalog_items: vec![],
            map_snapshot_base64: Some("iVBORw0KGgo=".to_owned()),
            allow_vision: false,
        };

        let msg = build_user_message("Describe the map", &workspace_disabled);
        assert_eq!(msg["role"], "user");
        assert_eq!(msg["content"], json!("Describe the map"));
        assert!(build_snapshot_observation_message(&workspace_disabled, 0).is_none());
        let tools_disabled = advertised_tools_json(false);
        assert!(!tools_disabled.iter().any(|t| t["function"]["name"] == "capture_map_snapshot"));
    }

    #[test]
    fn multimodal_user_payload_attaches_png_data_url_when_vision_enabled() {
        let workspace_enabled = AgentWorkspaceContext {
            center_lon: 16.375,
            center_lat: 48.208,
            zoom: 15.0,
            draft_title: "Vienna".to_owned(),
            draft_geojson: json!({ "type": "FeatureCollection", "features": [] }).to_string(),
            shelf_map_titles: vec![],
            atlas_workspaces: vec![],
            working_set_titles: vec![],
            catalog_items: vec![],
            map_snapshot_base64: Some("iVBORw0KGgo=".to_owned()),
            allow_vision: true,
        };

        let msg = build_user_message("What features do you see?", &workspace_enabled);
        assert_eq!(msg["role"], "user");
        let parts = msg["content"].as_array().unwrap();
        assert_eq!(parts.len(), 2);
        assert_eq!(parts[0], json!({ "type": "text", "text": "What features do you see?" }));
        assert_eq!(
            parts[1],
            json!({
                "type": "image_url",
                "image_url": { "url": "data:image/png;base64,iVBORw0KGgo=" }
            })
        );

        let obs = build_snapshot_observation_message(&workspace_enabled, 3).unwrap();
        let obs_parts = obs["content"].as_array().unwrap();
        assert_eq!(obs_parts.len(), 2);
        assert!(obs_parts[0]["text"].as_str().unwrap().contains("draftFeatureCount=3"));
        assert_eq!(
            obs_parts[1]["image_url"]["url"],
            json!("data:image/png;base64,iVBORw0KGgo=")
        );

        let tools_enabled = advertised_tools_json(true);
        assert!(tools_enabled.iter().any(|t| t["function"]["name"] == "capture_map_snapshot"));
    }

    #[test]
    fn routstr_provider_detection_and_xcashu_header_parsing() {
        assert!(is_routstr_provider(Some("routstr"), ""));
        assert!(is_routstr_provider(None, "https://api.routstr.com/v1"));
        assert!(!is_routstr_provider(Some("ollama"), "http://127.0.0.1:11434/v1"));

        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-cashu", "  cashuAeyJ0b2tlbiI6W119  ".parse().unwrap());
        headers.insert("x-routstr-cost-msats", "4250".parse().unwrap());
        assert_eq!(
            extract_xcashu_header(&headers).as_deref(),
            Some("cashuAeyJ0b2tlbiI6W119")
        );
        assert_eq!(extract_routstr_cost_msats(&headers), Some(4250));

        let (msg, refund) = read_routstr_error_body(
            r#"{"error":{"message":"Insufficient ecash","refund_token":"cashuArefund123"}}"#,
        );
        assert_eq!(msg.as_deref(), Some("Insufficient ecash"));
        assert_eq!(refund.as_deref(), Some("cashuArefund123"));
    }
}
