mod android_lifecycle;
mod diagnostics;
mod local_node;
mod outbox;
mod saved_regions;

use diagnostics::support_diagnostics_v1;
use local_node::{
    local_node_approve_claim_v1, local_node_blob_access_v1, local_node_create_invitation_v1,
    local_node_disable_lan_v1, local_node_enable_lan_v1, local_node_field_session_events_v1,
    local_node_forget_remote_node_v1, local_node_ingest_event_v1, local_node_join_invitation_v1,
    local_node_mirror_remote_blobs_v1, local_node_network_addresses_v1, local_node_peer_grants_v1,
    local_node_pending_claims_v1, local_node_publish_remote_event_v1,
    local_node_refresh_remote_node_v1, local_node_reject_claim_v1, local_node_remote_nodes_v1,
    local_node_revoke_peer_field_session_v1, local_node_revoke_peer_v1, local_node_status,
    local_node_status_v1, local_node_sync_remote_node_v1, LocalNodeState,
};
use outbox::{
    outbox_discard_v1, outbox_enqueue_v1, outbox_flush_v1, outbox_list_summaries_v1,
    outbox_list_v1, outbox_record_results_v1, outbox_retry_v1, OutboxState,
};
use saved_regions::{
    saved_region_cancel_v1, saved_region_collect_garbage_v1, saved_region_create_v1,
    saved_region_download_v1, saved_region_list_v1, saved_region_remove_v1, saved_region_repair_v1,
    SavedRegionState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Windows and Linux launch a second process for a custom URI. Register this
    // first so its deep-link integration forwards that URL into the running app.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }));

    let app = builder
        .plugin(android_lifecycle::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(LocalNodeState::starting())
        .register_asynchronous_uri_scheme_protocol("earthly-blob", local_node::local_blob_protocol)
        .invoke_handler(tauri::generate_handler![
            local_node_status,
            local_node_status_v1,
            local_node_network_addresses_v1,
            local_node_enable_lan_v1,
            local_node_disable_lan_v1,
            local_node_create_invitation_v1,
            local_node_pending_claims_v1,
            local_node_approve_claim_v1,
            local_node_reject_claim_v1,
            local_node_peer_grants_v1,
            local_node_revoke_peer_v1,
            local_node_revoke_peer_field_session_v1,
            local_node_join_invitation_v1,
            local_node_remote_nodes_v1,
            local_node_refresh_remote_node_v1,
            local_node_forget_remote_node_v1,
            local_node_sync_remote_node_v1,
            local_node_publish_remote_event_v1,
            local_node_ingest_event_v1,
            local_node_field_session_events_v1,
            local_node_mirror_remote_blobs_v1,
            local_node_blob_access_v1,
            outbox_enqueue_v1,
            outbox_list_v1,
            outbox_list_summaries_v1,
            outbox_flush_v1,
            outbox_record_results_v1,
            outbox_retry_v1,
            outbox_discard_v1,
            saved_region_create_v1,
            saved_region_list_v1,
            saved_region_download_v1,
            saved_region_cancel_v1,
            saved_region_remove_v1,
            saved_region_repair_v1,
            saved_region_collect_garbage_v1,
            support_diagnostics_v1,
        ])
        .setup(|app| {
            let app_data_dir = app.path().app_data_dir()?;
            app.manage(OutboxState::open(app_data_dir.join("earthly.sqlite3"))?);
            app.manage(SavedRegionState::open(
                app_data_dir.join("earthly.sqlite3"),
            )?);
            let data_dir = app_data_dir.join("local-node");
            local_node::start(app.handle().clone(), data_dir);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Earthly");

    app.run(|handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            handle.state::<LocalNodeState>().shutdown();
        }
    });
}
