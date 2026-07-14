mod local_node;

use local_node::{local_node_status, LocalNodeState};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(LocalNodeState::starting())
        .invoke_handler(tauri::generate_handler![local_node_status])
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
