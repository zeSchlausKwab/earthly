use std::path::PathBuf;
use std::sync::RwLock;

use earthly_local_node::{LocalNode, NodeAvailability, NodeConfig, NodeDescriptor};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

#[derive(Debug)]
pub struct LocalNodeState {
    runtime: RwLock<Runtime>,
}

impl LocalNodeState {
    pub fn starting() -> Self {
        Self {
            runtime: RwLock::new(Runtime::Starting),
        }
    }

    pub fn shutdown(&self) {
        if let Ok(runtime) = self.runtime.read() {
            if let Runtime::Running(node) = &*runtime {
                node.shutdown();
            }
        }
    }

    fn replace(&self, runtime: Runtime) {
        match self.runtime.write() {
            Ok(mut current) => *current = runtime,
            Err(poisoned) => *poisoned.into_inner() = runtime,
        }
    }

    fn status(&self) -> LocalNodeStatus {
        let runtime = match self.runtime.read() {
            Ok(runtime) => runtime,
            Err(poisoned) => poisoned.into_inner(),
        };
        match &*runtime {
            Runtime::Starting => LocalNodeStatus::Starting,
            Runtime::Running(node) => LocalNodeStatus::Running {
                descriptor: node.descriptor().clone(),
            },
            Runtime::Failed { message } => LocalNodeStatus::Failed {
                message: message.clone(),
            },
        }
    }
}

#[derive(Debug)]
enum Runtime {
    Starting,
    Running(Box<LocalNode>),
    Failed { message: String },
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum LocalNodeStatus {
    Starting,
    Running { descriptor: NodeDescriptor },
    Failed { message: String },
}

pub fn start(app: AppHandle, data_dir: PathBuf) {
    tauri::async_runtime::spawn(async move {
        let config = NodeConfig::loopback(data_dir, NodeAvailability::Process);
        let runtime = match LocalNode::start(config).await {
            Ok(node) => Runtime::Running(Box::new(node)),
            Err(error) => Runtime::Failed {
                message: error.to_string(),
            },
        };
        app.state::<LocalNodeState>().replace(runtime);
    });
}

#[tauri::command]
pub fn local_node_status(state: State<'_, LocalNodeState>) -> LocalNodeStatus {
    state.status()
}
