//! Native async OpenAI-compatible multi-turn tool-calling loop (`native-http`),
//! plus lightweight native webpage research (`fetch_webpage`) that extracts
//! readable prose, coordinates, and OSM/GeoJSON references without any WebView.
//! Works with local Ollama (`http://127.0.0.1:11434/v1`), OpenRouter, OpenAI,
//! LM Studio, llama.cpp server, or offline deterministic mode.

use std::time::Duration;

use serde_json::{Value, json};

use crate::executor::{
    AgentTurnInput, AgentTurnOutput, ExecutedToolRecord, MutableDraftState,
    execute_local_offline_turn, execute_tool_call,
};
use crate::schema::{
    AgentProviderConfig, AgentRole, earthly_system_prompt, earthly_tool_definitions,
};

const MAX_WEBPAGE_BYTES: usize = 256 * 1024;

pub async fn run_agent_turn(
    provider: &AgentProviderConfig,
    input: &AgentTurnInput,
) -> Result<AgentTurnOutput, String> {
    let base = provider.base_url.trim().trim_end_matches('/');
    if base.is_empty() || provider.model.trim() == "offline-spatial" {
        if let Some(url) = extract_first_http_url(&input.prompt) {
            return run_offline_url_research(&url, input).await;
        }
        return Ok(execute_local_offline_turn(input));
    }

    let endpoint = format!("{base}/chat/completions");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| format!("failed to build HTTP client: {e}"))?;

    let tools_json: Vec<Value> = earthly_tool_definitions()
        .into_iter()
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
        .collect();

    let mut state = MutableDraftState::from_geojson(
        &input.workspace.draft_geojson,
        &input.workspace.draft_title,
    );

    let mut messages: Vec<Value> = vec![json!({
        "role": "system",
        "content": format!(
            "{}\n\nCurrent map viewport: center=({:.5}, {:.5}), zoom={:.1}, draft=\"{}\" ({} features), shelf maps={:?}.",
            earthly_system_prompt(),
            input.workspace.center_lat,
            input.workspace.center_lon,
            input.workspace.zoom,
            input.workspace.draft_title,
            state.fc["features"].as_array().map(Vec::len).unwrap_or(0),
            input.workspace.shelf_map_titles,
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
    messages.push(json!({ "role": "user", "content": input.prompt }));

    let mut executed: Vec<ExecutedToolRecord> = Vec::new();
    let max_steps = provider.max_tool_steps.clamp(1, 10);

    for _step in 0..max_steps {
        let mut req = client.post(&endpoint).json(&json!({
            "model": provider.model.trim(),
            "messages": messages,
            "tools": tools_json,
            "tool_choice": "auto",
            "temperature": 0.2
        }));
        if let Some(key) = provider
            .api_key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
        {
            req = req.bearer_auth(key);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("LLM request to {endpoint} failed: {e}"))?;
        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| format!("invalid JSON from LLM ({status}): {e}"))?;

        if !status.is_success() {
            let err_msg = body
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(Value::as_str)
                .unwrap_or("provider returned an error");
            return Err(format!("LLM error ({status}): {err_msg}"));
        }

        let choice_msg = body
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|c| c.first())
            .and_then(|c| c.get("message"))
            .ok_or_else(|| "LLM response missing choices[0].message".to_owned())?;

        let tool_calls = choice_msg
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();

        if tool_calls.is_empty() {
            let reply = choice_msg
                .get("content")
                .and_then(Value::as_str)
                .unwrap_or("Done.")
                .trim()
                .to_owned();
            let updated_draft_geojson = state
                .modified
                .then(|| serde_json::to_string(&state.fc).unwrap_or_default());
            return Ok(AgentTurnOutput {
                reply,
                updated_draft_geojson,
                camera_action: state.camera_action,
                tool_calls: executed,
                used_offline_mode: false,
            });
        }

        messages.push(choice_msg.clone());
        for tc in tool_calls {
            let call_id = tc
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("call_0")
                .to_owned();
            let fn_obj = tc.get("function");
            let fn_name = fn_obj
                .and_then(|f| f.get("name"))
                .and_then(Value::as_str)
                .unwrap_or("");
            let raw_args = fn_obj
                .and_then(|f| f.get("arguments"))
                .and_then(Value::as_str)
                .unwrap_or("{}");
            let parsed_args: Value = serde_json::from_str(raw_args).unwrap_or_else(|_| json!({}));

            let (record, tool_result) = if fn_name == "fetch_webpage" {
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
            } else {
                execute_tool_call(fn_name, &parsed_args, &input.workspace, &mut state)
            };
            executed.push(record);

            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": serde_json::to_string(&tool_result).unwrap_or_default()
            }));
        }
    }

    let updated_draft_geojson = state
        .modified
        .then(|| serde_json::to_string(&state.fc).unwrap_or_default());
    Ok(AgentTurnOutput {
        reply: format!("Executed {} spatial tool step(s).", executed.len()),
        updated_draft_geojson,
        camera_action: state.camera_action,
        tool_calls: executed,
        used_offline_mode: false,
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
            })
        }
    }
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
}
