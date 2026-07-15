mod local_node;

use local_node::{
    local_node_approve_claim_v1, local_node_create_invitation_v1, local_node_disable_lan_v1,
    local_node_enable_lan_v1, local_node_forget_remote_node_v1, local_node_join_invitation_v1,
    local_node_mirror_remote_blobs_v1, local_node_network_addresses_v1, local_node_peer_grants_v1,
    local_node_pending_claims_v1, local_node_refresh_remote_node_v1, local_node_reject_claim_v1,
    local_node_remote_nodes_v1, local_node_revoke_peer_v1, local_node_status, local_node_status_v1,
    local_node_sync_remote_node_v1, LocalNodeState,
};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .manage(LocalNodeState::starting())
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
            local_node_join_invitation_v1,
            local_node_remote_nodes_v1,
            local_node_refresh_remote_node_v1,
            local_node_forget_remote_node_v1,
            local_node_sync_remote_node_v1,
            local_node_mirror_remote_blobs_v1,
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?.join("local-node");
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
