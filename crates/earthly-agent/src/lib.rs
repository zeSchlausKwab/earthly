//! Pure-Rust + WASM AI agent runtime for Earthly.
//!
//! Owns the Earthly spatial system prompt, OpenAI-compatible tool definitions,
//! deterministic `earthly-geo` / `earthly-spatial` tool executor, offline local
//! command fallback, and (with the `native-http` feature) an async multi-turn
//! tool-calling loop compatible with OpenAI, OpenRouter, Ollama, and any
//! OpenAI-compatible local or remote LLM server.

pub mod executor;
pub mod schema;
pub mod vision;
#[cfg(feature = "native-http")]
pub mod runtime;

pub use executor::{
    AgentCameraAction, AgentTurnInput, AgentTurnOutput, AgentWorkspaceContext,
    ExecutedToolRecord, execute_local_offline_turn, execute_tool_call,
};
pub use schema::{
    AgentChatMessage, AgentProviderConfig, AgentRole, ToolDefinition, earthly_system_prompt,
    earthly_tool_definitions,
};
pub use vision::{VisionSupport, detect_vision_name_heuristic};
#[cfg(feature = "native-http")]
pub use vision::detect_model_vision_support;
#[cfg(feature = "native-http")]
pub use runtime::{
    AgentStreamEvent, ResearchPageExtract, fetch_research_webpage, run_agent_turn,
    run_agent_turn_streaming,
};
