//! Native async OpenAI-compatible multi-turn tool-calling loop (`native-http`).
//! Works with local Ollama (`http://127.0.0.1:11434/v1`), OpenRouter, OpenAI,
//! LM Studio, llama.cpp server, or any OpenAI-compatible chat/completions API.

use std::time::Duration;

use serde_json::{Value, json};

use crate::executor::{
    AgentTurnInput, AgentTurnOutput, ExecutedToolRecord, MutableDraftState,
    execute_local_offline_turn, execute_tool_call,
};
use crate::schema::{
    AgentProviderConfig, AgentRole, earthly_system_prompt, earthly_tool_definitions,
};

pub async fn run_agent_turn(
    provider: &AgentProviderConfig,
    input: &AgentTurnInput,
) -> Result<AgentTurnOutput, String> {
    let base = provider.base_url.trim().trim_end_matches('/');
    if base.is_empty() || provider.model.trim() == "offline-spatial" {
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

            let (record, tool_result) =
                execute_tool_call(fn_name, &parsed_args, &input.workspace, &mut state);
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
