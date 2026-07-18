use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
mod imp {
    use std::collections::HashMap;

    use serde::{Deserialize, Serialize};
    use tauri::{plugin::PluginHandle, AppHandle, Manager, Runtime};

    const PLUGIN_IDENTIFIER: &str = "city.earthly";

    pub struct AndroidLifecycle<R: Runtime> {
        plugin: PluginHandle<R>,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PermissionRequest {
        permissions: Vec<&'static str>,
    }

    #[derive(Deserialize)]
    struct PermissionResponse {
        notifications: String,
    }

    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct StartSharingRequest<'a> {
        address: &'a str,
        expires_at: u64,
    }

    pub fn register<R: Runtime>(
        app: &AppHandle<R>,
        api: tauri::plugin::PluginApi<R, ()>,
    ) -> Result<(), Box<dyn std::error::Error>> {
        let plugin = api.register_android_plugin(PLUGIN_IDENTIFIER, "EarthlyLifecyclePlugin")?;
        app.manage(AndroidLifecycle { plugin });
        Ok(())
    }

    pub async fn prepare<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        let response = app
            .state::<AndroidLifecycle<R>>()
            .plugin
            .run_mobile_plugin_async::<PermissionResponse>(
                "requestPermissions",
                PermissionRequest {
                    permissions: vec!["notifications"],
                },
            )
            .await
            .map_err(|error| error.to_string())?;
        if response.notifications == "granted" {
            Ok(())
        } else {
            Err("Notification permission is required while nearby sharing is active".to_string())
        }
    }

    pub async fn start<R: Runtime>(
        app: &AppHandle<R>,
        address: &str,
        expires_at: u64,
    ) -> Result<(), String> {
        app.state::<AndroidLifecycle<R>>()
            .plugin
            .run_mobile_plugin_async::<()>(
                "startSharing",
                StartSharingRequest {
                    address,
                    expires_at,
                },
            )
            .await
            .map_err(|error| error.to_string())
    }

    pub async fn stop<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
        app.state::<AndroidLifecycle<R>>()
            .plugin
            .run_mobile_plugin_async::<()>("stopSharing", HashMap::<String, String>::new())
            .await
            .map_err(|error| error.to_string())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::<R>::new("earthly-lifecycle")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            imp::register(app, api)?;
            #[cfg(not(target_os = "android"))]
            let _ = (app, api);
            Ok(())
        })
        .build()
}

pub async fn prepare<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return imp::prepare(app).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

pub async fn start<R: Runtime>(
    app: &AppHandle<R>,
    address: &str,
    expires_at: u64,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return imp::start(app, address, expires_at).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, address, expires_at);
        Ok(())
    }
}

pub async fn stop<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    return imp::stop(app).await;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}
