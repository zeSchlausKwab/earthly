/**
 * Chat tools barrel - re-exports public API from sub-modules.
 */

// Types
export type {
	Tool,
	ToolCall,
	ToolResult,
	GeometryBakeAnalysis,
	GeometryBakeResult,
	CachedMapSnapshot,
} from './types'

// Constants
export { TO_EDITOR_COMPATIBLE_TOOLS } from './types'

// Tool definitions
export { geoTools } from './definitions'

// Executor
export { executeToolCall } from './execute'

// Context / snapshot
export {
	createMapContextSystemMessage,
	consumeMapSnapshot,
	getMapContextSnapshot,
} from './context'

// Geometry baking (used by ChatPanel)
export {
	analyzeToolResultGeometryContent,
	bakeToolResultContentToEditor,
	compactToolMessageContentForPrompt,
} from './helpers'
