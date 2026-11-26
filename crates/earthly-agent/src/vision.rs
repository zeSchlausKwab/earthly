//! Fail-safe Vision Support Detector for Earthly's AI agent runtime.
//!
//! Mirrors `src/features/chat/vision/detectVisionSupport.ts` as a layered,
//! fail-safe ladder so image payloads are never silently sent to a blind model:
//! 1. Ollama native `POST {root}/api/show` -> `capabilities` containing `"vision"`
//! 2. OpenAI-compatible `GET {base}/models` -> model entry's `input_modalities`,
//!    `architecture.input_modalities`, or `capabilities`
//! 3. Narrowly scoped official Moonshot vision manifest (`api.moonshot.ai` /
//!    `api.moonshot.cn` over HTTPS)
//! 4. Token-boundary name heuristic -> `VisionSupport::Uncertain`
//! 5. Fail-safe -> `VisionSupport::NoVision` (never throws/errors)

use serde::{Deserialize, Serialize};
#[cfg(any(feature = "native-http", test))]
use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum VisionSupport {
    Vision,
    Uncertain,
    NoVision,
}

impl VisionSupport {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Vision => "vision",
            Self::Uncertain => "uncertain",
            Self::NoVision => "no-vision",
        }
    }
}

const VISION_NAME_HINTS: &[&str] = &[
    "vision",
    "-vl",
    "vl-",
    "llava",
    "qwen2.5-vl",
    "gemma-vision",
    "pixtral",
    "gpt-4o",
    "claude-3",
    "claude-sonnet",
    "claude-opus",
    "gemini-",
    "kimi-k3",
    "kimi-k2.6",
    "kimi-k2.7-code",
];

#[cfg(any(feature = "native-http", test))]
const MOONSHOT_VISION_MODELS: &[&str] = &[
    "kimi-k3",
    "kimi-k2.6",
    "kimi-k2.7-code",
    "kimi-k2.7-code-highspeed",
];

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '.'
}

fn hint_matches_token_boundary(id_lower: &str, hint: &str) -> bool {
    for (idx, _) in id_lower.match_indices(hint) {
        let before = id_lower[..idx].chars().next_back();
        let after = id_lower[idx + hint.len()..].chars().next();
        let left_ok = hint.starts_with('-') || before.is_none_or(|c| !is_token_char(c));
        let right_ok = hint.ends_with('-') || after.is_none_or(|c| !is_token_char(c));
        if left_ok && right_ok {
            return true;
        }
    }
    false
}

/// Token-boundary model-name heuristic.
///
/// Matches known vision model families on delimiter boundaries (rejecting
/// false substrings such as `marvel`, `vllm`, `nouvelle`, or `supervision`),
/// returning [`VisionSupport::Uncertain`] when a hint matches and
/// [`VisionSupport::NoVision`] otherwise.
pub fn detect_vision_name_heuristic(model: &str) -> VisionSupport {
    let lower = model.trim().to_ascii_lowercase();
    if lower.is_empty() {
        return VisionSupport::NoVision;
    }
    if VISION_NAME_HINTS
        .iter()
        .any(|hint| hint_matches_token_boundary(&lower, hint))
    {
        VisionSupport::Uncertain
    } else {
        VisionSupport::NoVision
    }
}

/// Extracts the lowercase host from an `https://` URL only when it uses the
/// default HTTPS port (no explicit non-443 port) and contains no userinfo.
#[cfg(any(feature = "native-http", test))]
fn official_https_host(base_url: &str) -> Option<String> {
    let trimmed = base_url.trim();
    let rest = trimmed.strip_prefix("https://").or_else(|| {
        trimmed
            .get(..8)
            .filter(|p| p.eq_ignore_ascii_case("https://"))
            .map(|_| &trimmed[8..])
    })?;
    let authority = rest.split(['/', '?', '#']).next()?;
    if authority.is_empty() || authority.contains('@') {
        return None;
    }
    let host = if let Some((h, port)) = authority.split_once(':') {
        if port != "443" {
            return None;
        }
        h
    } else {
        authority
    };
    Some(host.to_ascii_lowercase())
}

#[cfg(any(feature = "native-http", test))]
pub(crate) fn documented_provider_vision(base_url: &str, model: &str) -> Option<VisionSupport> {
    let host = official_https_host(base_url)?;
    if host != "api.moonshot.ai" && host != "api.moonshot.cn" {
        return None;
    }
    let lower = model.trim().to_ascii_lowercase();
    MOONSHOT_VISION_MODELS
        .iter()
        .any(|&m| m == lower)
        .then_some(VisionSupport::Vision)
}

/// Parses Ollama `POST /api/show` JSON (`{ "capabilities": [...] }`).
#[cfg(any(feature = "native-http", test))]
pub(crate) fn parse_ollama_show_vision(body: &Value) -> Option<VisionSupport> {
    let caps = body.get("capabilities")?.as_array()?;
    let has_vision = caps
        .iter()
        .filter_map(Value::as_str)
        .any(|c| c.eq_ignore_ascii_case("vision"));
    Some(if has_vision {
        VisionSupport::Vision
    } else {
        VisionSupport::NoVision
    })
}

#[cfg(any(feature = "native-http", test))]
fn contains_image_or_vision(s: &str) -> bool {
    let lower = s.to_ascii_lowercase();
    lower.contains("image") || lower.contains("vision")
}

/// Parses OpenAI-compatible `GET /models` JSON (`{ "data": [...] }`) for `model`.
#[cfg(any(feature = "native-http", test))]
pub(crate) fn parse_openai_models_vision(body: &Value, model: &str) -> Option<VisionSupport> {
    let entries = body.get("data")?.as_array()?;
    let target = model.trim();
    let entry = entries.iter().find(|e| {
        e.get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id == model || id == target)
    })?;

    let declared_modalities = [
        entry.get("input_modalities"),
        entry
            .get("architecture")
            .and_then(|arch| arch.get("input_modalities")),
    ];
    for candidate in declared_modalities.into_iter().flatten() {
        if let Some(arr) = candidate.as_array() {
            let has_image = arr
                .iter()
                .filter_map(Value::as_str)
                .any(contains_image_or_vision);
            return Some(if has_image {
                VisionSupport::Vision
            } else {
                VisionSupport::NoVision
            });
        }
    }

    let caps = entry.get("capabilities")?.as_array()?;
    if caps
        .iter()
        .filter_map(Value::as_str)
        .any(contains_image_or_vision)
    {
        return Some(VisionSupport::Vision);
    }
    if caps
        .iter()
        .filter_map(Value::as_str)
        .any(|c| c.eq_ignore_ascii_case("text-only"))
    {
        return Some(VisionSupport::NoVision);
    }
    None
}

#[cfg(feature = "native-http")]
fn ollama_show_endpoint(base_url: &str) -> String {
    let trimmed = base_url.trim().trim_end_matches('/');
    let root = trimmed
        .strip_suffix("/v1")
        .unwrap_or(trimmed)
        .trim_end_matches('/');
    format!("{root}/api/show")
}

#[cfg(feature = "native-http")]
fn should_probe_ollama_show(base_url: &str) -> bool {
    let lower = base_url.trim().to_ascii_lowercase();
    lower.starts_with("http://")
        || lower.contains("127.0.0.1")
        || lower.contains("localhost")
        || lower.contains("[::1]")
        || lower.contains(":11434")
        || lower.contains("ollama")
}

#[cfg(feature = "native-http")]
async fn probe_ollama_show(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
) -> Option<VisionSupport> {
    let endpoint = ollama_show_endpoint(base_url);
    let resp = client
        .post(&endpoint)
        .json(&serde_json::json!({ "model": model }))
        .send()
        .await
        .ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<Value>().await.ok()?;
    parse_ollama_show_vision(&body)
}

#[cfg(feature = "native-http")]
async fn probe_openai_models(
    client: &reqwest::Client,
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
) -> Option<VisionSupport> {
    let base = base_url.trim().trim_end_matches('/');
    let endpoint = format!("{base}/models");
    let mut req = client.get(&endpoint);
    if let Some(key) = api_key.map(str::trim).filter(|k| !k.is_empty()) {
        req = req.bearer_auth(key);
    }
    let resp = req.send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let body = resp.json::<Value>().await.ok()?;
    parse_openai_models_vision(&body, model)
}

/// Fail-safe vision capability detector for an LLM endpoint + model.
///
/// Checks in order:
/// 1. Ollama native `POST {root}/api/show` (`capabilities` containing `"vision"`)
/// 2. OpenAI-compatible `GET {base}/models` (`input_modalities`,
///    `architecture.input_modalities`, or `capabilities`)
/// 3. Official Moonshot manifest (`api.moonshot.ai` / `api.moonshot.cn` over HTTPS)
/// 4. Token-boundary model-name heuristic -> [`VisionSupport::Uncertain`]
/// 5. Fail-safe -> [`VisionSupport::NoVision`]
///
/// Never panics or returns an error on network/JSON failures.
#[cfg(feature = "native-http")]
pub async fn detect_model_vision_support(
    base_url: &str,
    model: &str,
    api_key: Option<&str>,
) -> VisionSupport {
    let trimmed_model = model.trim();
    if trimmed_model.is_empty() {
        return VisionSupport::NoVision;
    }
    let trimmed_base = base_url.trim();
    if trimmed_base.is_empty() {
        return detect_vision_name_heuristic(trimmed_model);
    }

    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
    {
        if should_probe_ollama_show(trimmed_base) {
            if let Some(verdict) = probe_ollama_show(&client, trimmed_base, trimmed_model).await {
                return verdict;
            }
        }
        if let Some(verdict) =
            probe_openai_models(&client, trimmed_base, trimmed_model, api_key).await
        {
            return verdict;
        }
    }

    if let Some(verdict) = documented_provider_vision(trimmed_base, trimmed_model) {
        return verdict;
    }

    detect_vision_name_heuristic(trimmed_model)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn vision_support_serializes_kebab_case_and_as_str() {
        assert_eq!(VisionSupport::Vision.as_str(), "vision");
        assert_eq!(VisionSupport::Uncertain.as_str(), "uncertain");
        assert_eq!(VisionSupport::NoVision.as_str(), "no-vision");

        assert_eq!(
            serde_json::to_string(&VisionSupport::Vision).unwrap(),
            "\"vision\""
        );
        assert_eq!(
            serde_json::to_string(&VisionSupport::Uncertain).unwrap(),
            "\"uncertain\""
        );
        assert_eq!(
            serde_json::to_string(&VisionSupport::NoVision).unwrap(),
            "\"no-vision\""
        );
        assert_eq!(
            serde_json::from_str::<VisionSupport>("\"no-vision\"").unwrap(),
            VisionSupport::NoVision
        );
    }

    #[test]
    fn token_boundary_heuristic_accepts_vision_families_and_rejects_false_substrings() {
        for rejected in [
            "marvel",
            "marvel-7b",
            "vllm",
            "some-vllm-host",
            "my-vlm",
            "nouvelle-7b",
            "mistral-small",
            "supervision-7b",
            "plain-text-model",
            "",
        ] {
            assert_eq!(
                detect_vision_name_heuristic(rejected),
                VisionSupport::NoVision,
                "expected no-vision for {rejected:?}"
            );
        }

        for matched in [
            "llama-3.2-11b-vision-instruct",
            "qwen2.5-vl",
            "qwen3-vl-8b",
            "vl-7b-instruct",
            "llava-1.6",
            "gemma-vision",
            "pixtral-12b",
            "gpt-4o",
            "gpt-4o-mini",
            "claude-3-opus",
            "claude-sonnet-4-20250514",
            "anthropic/claude-opus-4",
            "gemini-2.5-flash",
            "kimi-k3",
            "kimi-k2.6",
            "kimi-k2.7-code",
            "kimi-k2.7-code-highspeed",
        ] {
            assert_eq!(
                detect_vision_name_heuristic(matched),
                VisionSupport::Uncertain,
                "expected uncertain for {matched:?}"
            );
        }
    }

    #[test]
    fn parses_ollama_api_show_capabilities() {
        assert_eq!(
            parse_ollama_show_vision(&json!({ "capabilities": ["completion", "vision"] })),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            parse_ollama_show_vision(&json!({ "capabilities": ["completion", "tools"] })),
            Some(VisionSupport::NoVision)
        );
        assert_eq!(
            parse_ollama_show_vision(&json!({ "modelfile": "FROM llava" })),
            None
        );
    }

    #[test]
    fn parses_openai_models_modalities_and_capabilities() {
        assert_eq!(
            parse_openai_models_vision(
                &json!({ "data": [{ "id": "gpt-4o", "capabilities": ["text", "image"] }] }),
                "gpt-4o"
            ),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            parse_openai_models_vision(
                &json!({ "data": [{ "id": "pixtral", "input_modalities": ["text", "image"] }] }),
                "pixtral"
            ),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            parse_openai_models_vision(
                &json!({
                    "data": [{
                        "id": "some-vlm",
                        "architecture": { "input_modalities": ["text", "image"] }
                    }]
                }),
                "some-vlm"
            ),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            parse_openai_models_vision(
                &json!({ "data": [{ "id": "llama-3", "input_modalities": ["text"] }] }),
                "llama-3"
            ),
            Some(VisionSupport::NoVision)
        );
        assert_eq!(
            parse_openai_models_vision(
                &json!({ "data": [{ "id": "legacy", "capabilities": ["text-only"] }] }),
                "legacy"
            ),
            Some(VisionSupport::NoVision)
        );
        // Generic capabilities without modality data fall through to None.
        assert_eq!(
            parse_openai_models_vision(
                &json!({ "data": [{ "id": "kimi-k3", "capabilities": ["text", "completion", "tools"] }] }),
                "kimi-k3"
            ),
            None
        );
    }

    #[test]
    fn moonshot_official_manifest_is_origin_scoped() {
        assert_eq!(
            documented_provider_vision("https://api.moonshot.ai/v1/", "kimi-k3"),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            documented_provider_vision("https://api.moonshot.cn/v1", "kimi-k2.7-code-highspeed"),
            Some(VisionSupport::Vision)
        );
        assert_eq!(
            documented_provider_vision("http://api.moonshot.ai/v1", "kimi-k3"),
            None
        );
        assert_eq!(
            documented_provider_vision("https://api.moonshot.ai:444/v1", "kimi-k3"),
            None
        );
        assert_eq!(
            documented_provider_vision("https://api.moonshot.ai.attacker.example/v1", "kimi-k3"),
            None
        );
        assert_eq!(
            documented_provider_vision("https://api.moonshot.ai/v1", "other-model"),
            None
        );
    }

    #[cfg(feature = "native-http")]
    #[test]
    fn ollama_endpoint_strips_v1_suffix_cleanly() {
        assert_eq!(
            ollama_show_endpoint("http://127.0.0.1:11434/v1"),
            "http://127.0.0.1:11434/api/show"
        );
        assert_eq!(
            ollama_show_endpoint("http://localhost:11434/v1/"),
            "http://localhost:11434/api/show"
        );
        assert_eq!(
            ollama_show_endpoint("http://localhost:11434"),
            "http://localhost:11434/api/show"
        );
    }
}
