use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::local_node::{LocalNodeDiagnosticSummary, LocalNodeState};
use crate::outbox::{OutboxDiagnosticSummary, OutboxState};
use crate::saved_regions::{SavedRegionDiagnosticSummary, SavedRegionState};

const REPORT_VERSION: u8 = 1;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportDiagnosticReport {
    schema_version: u8,
    generated_at: u64,
    app: AppDiagnosticSummary,
    privacy: PrivacySummary,
    local_node: LocalNodeDiagnosticSummary,
    saved_regions: SavedRegionDiagnosticSummary,
    publish_outbox: OutboxDiagnosticSummary,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppDiagnosticSummary {
    version: String,
    target_os: &'static str,
    target_arch: &'static str,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PrivacySummary {
    redacted: bool,
    excludes: [&'static str; 7],
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SupportDiagnosticError {
    code: &'static str,
    message: &'static str,
}

impl SupportDiagnosticError {
    fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message }
    }
}

#[tauri::command]
pub async fn support_diagnostics_v1(
    app: AppHandle,
    local_node: State<'_, LocalNodeState>,
    saved_regions: State<'_, SavedRegionState>,
    outbox: State<'_, OutboxState>,
) -> Result<SupportDiagnosticReport, SupportDiagnosticError> {
    let saved_regions = saved_regions.diagnostic_summary().map_err(|_| {
        SupportDiagnosticError::new(
            "diagnostics-saved-regions-unavailable",
            "Could not inspect saved map status",
        )
    })?;
    let publish_outbox = outbox.diagnostic_summary().map_err(|_| {
        SupportDiagnosticError::new(
            "diagnostics-outbox-unavailable",
            "Could not inspect delivery status",
        )
    })?;
    Ok(SupportDiagnosticReport {
        schema_version: REPORT_VERSION,
        generated_at: now_seconds(),
        app: AppDiagnosticSummary {
            version: app.package_info().version.to_string(),
            target_os: std::env::consts::OS,
            target_arch: std::env::consts::ARCH,
        },
        privacy: PrivacySummary {
            redacted: true,
            excludes: [
                "account and installation public keys",
                "node ids and network addresses",
                "relay and Blossom URLs",
                "invites, authentication events, and tokens",
                "event ids, hashes, messages, and event bodies",
                "Field-session names, ids, and descriptions",
                "map bounds, coordinates, and geometry",
            ],
        },
        local_node: local_node.diagnostic_summary().await,
        saved_regions,
        publish_outbox,
    })
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
