/**
 * Chat tools barrel - re-exports public API from sub-modules.
 */

// Types
export type {
	Tool,
	ToolCall,
	ToolResult,
	ToolExecutionContext,
	GeometryBakeAnalysis,
	GeometryBakeResult,
	CachedMapSnapshot,
} from './types'

// Constants
export { TO_EDITOR_COMPATIBLE_TOOLS } from './types'

// Tool definitions
export { geoTools, getGeoTools } from './definitions'

// MCP hot-reload (D-05): poll-based live tool discovery
export {
	syncMcpTools,
	startMcpToolPolling,
	stopMcpToolPolling,
	isMcpSyncActive,
	getSyncedMcpToolNames,
} from './mcp-sync'

// Executor
export { executeToolCall } from './execute'

// Context / snapshot
export {
	buildSessionPublishContextMessage,
	createMapContextSystemMessage,
	consumeMapSnapshot,
	getMapContextSnapshot,
} from './context'
export type { PromptProfile } from './context'

// Geometry baking (used by ChatPanel)
export {
	analyzeToolResultGeometryContent,
	bakeToolResultContentToEditor,
	compactToolMessageContentForPrompt,
} from './helpers'
