import type { ChatMessage, ToolCall } from './routstr'

export type ToolOperationPhase = 'research' | 'build' | 'refine' | 'inspect' | 'other'

export interface ToolOperationGroup {
	type: 'tool-operation-group'
	key: string
	messages: ChatMessage[]
	toolCalls: ToolCall[]
	phaseCounts: Record<ToolOperationPhase, number>
	errorCount: number
}

export interface ChatTimelineMessage {
	type: 'message'
	key: string
	message: ChatMessage
}

export type ChatTimelineItem = ChatTimelineMessage | ToolOperationGroup

const RESEARCH_TOOLS = new Set([
	'web_search',
	'fetch_url',
	'wikipedia_lookup',
	'wikipedia_extract',
	'search_location',
	'reverse_lookup',
])
const BUILD_TOOLS = new Set([
	'run_code',
	'place_dataset_features',
	'place_ingest_features',
	'batch_geocode',
	'import_osm_features',
	'get_country_boundary',
	'get_osm_relation_geometry',
	'valhalla_route',
	'valhalla_isochrone',
])
const REFINE_TOOLS = new Set([
	'batch_edit_features',
	'dedup_features',
	'style_by_attribute',
	'editor_delete_selected',
	'editor_update_feature',
	'add_feature_callout',
	'update_feature_callout',
	'remove_feature_callout',
])
const INSPECT_TOOLS = new Set([
	'get_editor_state',
	'find_features',
	'select_features',
	'validate_geometry',
	'capture_map_snapshot',
])

export const TOOL_OPERATION_PHASE_LABELS: Record<ToolOperationPhase, string> = {
	research: 'Researching sources',
	build: 'Building the map',
	refine: 'Refining data',
	inspect: 'Inspecting results',
	other: 'Other actions',
}

export function classifyToolOperation(name: string): ToolOperationPhase {
	if (RESEARCH_TOOLS.has(name)) return 'research'
	if (BUILD_TOOLS.has(name) || name.startsWith('query_osm_')) return 'build'
	if (REFINE_TOOLS.has(name) || name.startsWith('editor_')) return 'refine'
	if (INSPECT_TOOLS.has(name)) return 'inspect'
	return 'other'
}

function isToolActivity(message: ChatMessage): boolean {
	return (
		message.role === 'tool' || (message.role === 'assistant' && Boolean(message.tool_calls?.length))
	)
}

function isSerializedToolError(message: ChatMessage): boolean {
	if (message.role !== 'tool' || typeof message.content !== 'string') return false
	try {
		const value = JSON.parse(message.content) as Record<string, unknown>
		return (
			value.ok === false && typeof value.kind === 'string' && typeof value.toolName === 'string'
		)
	} catch {
		return false
	}
}

export function buildChatTimeline(messages: ChatMessage[]): ChatTimelineItem[] {
	const timeline: ChatTimelineItem[] = []
	let index = 0
	while (index < messages.length) {
		const message = messages[index]
		if (!message) break
		if (!isToolActivity(message)) {
			timeline.push({ type: 'message', key: `message-${index}`, message })
			index += 1
			continue
		}

		const start = index
		const activity: ChatMessage[] = []
		const toolCalls: ToolCall[] = []
		let errorCount = 0
		while (index < messages.length) {
			const current = messages[index]
			if (!current || !isToolActivity(current)) break
			activity.push(current)
			if (current.role === 'assistant' && current.tool_calls) toolCalls.push(...current.tool_calls)
			if (isSerializedToolError(current)) errorCount += 1
			index += 1
		}

		if (toolCalls.length <= 1) {
			activity.forEach((current, offset) => {
				timeline.push({ type: 'message', key: `message-${start + offset}`, message: current })
			})
			continue
		}

		const phaseCounts: Record<ToolOperationPhase, number> = {
			research: 0,
			build: 0,
			refine: 0,
			inspect: 0,
			other: 0,
		}
		for (const call of toolCalls) phaseCounts[classifyToolOperation(call.function.name)] += 1
		timeline.push({
			type: 'tool-operation-group',
			// Keep the disclosure mounted while more calls are appended to the same
			// operation. Including the changing end index here caused React to replace
			// the <details> element on every new tool call, losing the user's open state.
			key: `tools-${start}`,
			messages: activity,
			toolCalls,
			phaseCounts,
			errorCount,
		})
	}
	return timeline
}
