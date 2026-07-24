import type { EditorMode, PrimitiveShape } from './core'
import { useEditorStore } from './store'

export type EditorCommandId =
	| 'set_mode'
	| 'undo'
	| 'redo'
	| 'toggle_snapping'
	| 'insert_primitive'
	| 'start_arrow_drawing'
	| 'delete_selected_features'
	| 'duplicate_selected_features'
	| 'merge_selected_features'
	| 'split_selected_features'
	| 'connect_selected_lines'
	| 'dissolve_selected_lines'
	| 'start_boolean_union'
	| 'start_boolean_difference'
	| 'cancel_boolean_operation'
	| 'finish_drawing'
	| 'simplify_selected_features'

export type EditorCommandArgs = Record<string, unknown>
type EditorStoreSnapshot = ReturnType<typeof useEditorStore.getState>

export interface EditorCommandExecutionResult {
	ok: boolean
	commandId: EditorCommandId
	message: string
	data?: Record<string, unknown>
}

type ToolParameter = {
	type: string
	description: string
	enum?: string[]
}

export interface EditorCommandToolParameters {
	type: 'object'
	properties: Record<string, ToolParameter>
	required?: string[]
}

export interface EditorAiToolDefinition {
	name: string
	description: string
	parameters: EditorCommandToolParameters
}

export interface EditorCommandDefinition {
	id: EditorCommandId
	label: string
	description: string
	canExecute?: (state: EditorStoreSnapshot) => boolean
	execute: (state: EditorStoreSnapshot, args: EditorCommandArgs) => EditorCommandExecutionResult
	ai?: {
		toolName: string
		description: string
		parameters?: EditorCommandToolParameters
	}
}

const EDITOR_MODE_VALUES: EditorMode[] = [
	'draw_point',
	'draw_linestring',
	'draw_polygon',
	'draw_annotation',
	'edit',
	'select',
	'box_select',
	'static',
]
const PRIMITIVE_SHAPES: PrimitiveShape[] = ['rectangle', 'square', 'circle', 'triangle', 'diamond']
const ARROW_PLACEMENTS = ['start', 'end', 'both'] as const

function isEditorMode(value: unknown): value is EditorMode {
	return typeof value === 'string' && EDITOR_MODE_VALUES.includes(value as EditorMode)
}

function syncHistoryState(state: EditorStoreSnapshot) {
	const editor = state.editor
	if (!editor) return
	state.setHistoryState(editor.history.canUndo(), editor.history.canRedo())
}

function success(
	commandId: EditorCommandId,
	message: string,
	data?: Record<string, unknown>,
): EditorCommandExecutionResult {
	return {
		ok: true,
		commandId,
		message,
		data,
	}
}

function failure(
	commandId: EditorCommandId,
	message: string,
	data?: Record<string, unknown>,
): EditorCommandExecutionResult {
	return {
		ok: false,
		commandId,
		message,
		data,
	}
}

function hasSingleSelectedPolygon(state: EditorStoreSnapshot): boolean {
	const selected = state.editor?.getSelectedFeatures() ?? []
	if (selected.length !== 1) return false
	const geometryType = selected[0]?.geometry.type
	return geometryType === 'Polygon' || geometryType === 'MultiPolygon'
}

function parseSimplifyTolerance(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0.0001
	}
	return Math.min(1, Math.max(1e-8, value))
}

function parseLineMergeTolerance(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return 0.00001
	}
	return Math.min(1, Math.max(1e-8, value))
}

const editorCommands: EditorCommandDefinition[] = [
	{
		id: 'set_mode',
		label: 'Set mode',
		description: 'Switch editor mode.',
		canExecute: (state) => Boolean(state.editor),
		ai: {
			toolName: 'editor_set_mode',
			description:
				'Switch the map editor mode (select, edit, draw point/line/polygon/annotation, etc).',
			parameters: {
				type: 'object',
				properties: {
					mode: {
						type: 'string',
						description: 'Target editor mode.',
						enum: EDITOR_MODE_VALUES,
					},
				},
				required: ['mode'],
			},
		},
		execute: (state, args) => {
			if (!state.editor) {
				return failure('set_mode', 'Map editor is not ready.')
			}
			if (!isEditorMode(args.mode)) {
				return failure('set_mode', `mode must be one of: ${EDITOR_MODE_VALUES.join(', ')}`)
			}
			state.setMode(args.mode)
			return success('set_mode', `Editor mode set to '${args.mode}'.`, {
				mode: args.mode,
			})
		},
	},
	{
		id: 'undo',
		label: 'Undo',
		description: 'Undo the last edit operation.',
		canExecute: (state) => Boolean(state.editor?.history.canUndo()),
		ai: {
			toolName: 'editor_undo',
			description: 'Undo the last map editing operation.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('undo', 'Map editor is not ready.')
			if (!editor.history.canUndo()) return failure('undo', 'Nothing to undo.')
			editor.undo()
			syncHistoryState(state)
			return success('undo', 'Undid the last operation.', {
				canUndo: editor.history.canUndo(),
				canRedo: editor.history.canRedo(),
			})
		},
	},
	{
		id: 'redo',
		label: 'Redo',
		description: 'Redo the last undone operation.',
		canExecute: (state) => Boolean(state.editor?.history.canRedo()),
		ai: {
			toolName: 'editor_redo',
			description: 'Redo the last undone map editing operation.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('redo', 'Map editor is not ready.')
			if (!editor.history.canRedo()) return failure('redo', 'Nothing to redo.')
			editor.redo()
			syncHistoryState(state)
			return success('redo', 'Redid the last operation.', {
				canUndo: editor.history.canUndo(),
				canRedo: editor.history.canRedo(),
			})
		},
	},
	{
		id: 'toggle_snapping',
		label: 'Toggle snapping',
		description: 'Enable or disable vertex snapping.',
		canExecute: (state) => Boolean(state.editor),
		ai: {
			toolName: 'editor_toggle_snapping',
			description: 'Toggle snapping on/off for drawing and editing.',
		},
		execute: (state) => {
			if (!state.editor) return failure('toggle_snapping', 'Map editor is not ready.')
			const next = !state.snappingEnabled
			state.setSnappingEnabled(next)
			return success('toggle_snapping', `Snapping ${next ? 'enabled' : 'disabled'}.`, {
				snappingEnabled: next,
			})
		},
	},
	{
		id: 'insert_primitive',
		label: 'Insert shape',
		description: 'Insert a basic shape at the center of the current map.',
		canExecute: (state) => Boolean(state.editor),
		ai: {
			toolName: 'editor_insert_primitive',
			description:
				'Insert a rectangle, square, circle, triangle, or diamond at the map center and select it for scaling.',
			parameters: {
				type: 'object',
				properties: {
					shape: {
						type: 'string',
						description: 'Primitive shape to insert.',
						enum: PRIMITIVE_SHAPES,
					},
				},
				required: ['shape'],
			},
		},
		execute: (state, args) => {
			const editor = state.editor
			if (!editor) return failure('insert_primitive', 'Map editor is not ready.')
			if (
				typeof args.shape !== 'string' ||
				!PRIMITIVE_SHAPES.includes(args.shape as PrimitiveShape)
			) {
				return failure('insert_primitive', `shape must be one of: ${PRIMITIVE_SHAPES.join(', ')}`)
			}
			const feature = editor.insertPrimitive(args.shape as PrimitiveShape)
			syncHistoryState(state)
			return success('insert_primitive', `Inserted a ${args.shape}.`, {
				featureId: feature.id,
				shape: args.shape,
			})
		},
	},
	{
		id: 'start_arrow_drawing',
		label: 'Draw arrow',
		description: 'Start drawing a line with arrowheads enabled by default.',
		canExecute: (state) => Boolean(state.editor),
		ai: {
			toolName: 'editor_start_arrow_drawing',
			description: 'Start line drawing with an arrowhead at the end, start, or both endpoints.',
			parameters: {
				type: 'object',
				properties: {
					placement: {
						type: 'string',
						description: 'Where arrowheads should be rendered. Defaults to end.',
						enum: [...ARROW_PLACEMENTS],
					},
				},
			},
		},
		execute: (state, args) => {
			const editor = state.editor
			if (!editor) return failure('start_arrow_drawing', 'Map editor is not ready.')
			const placement =
				typeof args.placement === 'string' &&
				ARROW_PLACEMENTS.includes(args.placement as (typeof ARROW_PLACEMENTS)[number])
					? (args.placement as (typeof ARROW_PLACEMENTS)[number])
					: 'end'
			editor.startArrowDrawing(placement)
			return success('start_arrow_drawing', `Arrow drawing started (${placement}).`, {
				mode: 'draw_linestring',
				placement,
			})
		},
	},
	{
		id: 'delete_selected_features',
		label: 'Delete selected',
		description: 'Delete currently selected features.',
		canExecute: (state) => (state.editor?.getSelectedFeatures().length ?? 0) > 0,
		ai: {
			toolName: 'editor_delete_selected',
			description: 'Delete the currently selected features from the editor.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('delete_selected_features', 'Map editor is not ready.')
			const selected = editor.getSelectedFeatures()
			if (selected.length === 0) {
				return failure('delete_selected_features', 'No features are selected.')
			}

			editor.deleteFeatures(selected.map((feature) => feature.id))
			syncHistoryState(state)
			return success(
				'delete_selected_features',
				`Deleted ${selected.length} selected feature(s).`,
				{
					deletedCount: selected.length,
				},
			)
		},
	},
	{
		id: 'duplicate_selected_features',
		label: 'Duplicate selected',
		description: 'Duplicate selected features.',
		canExecute: (state) => (state.editor?.getSelectedFeatures().length ?? 0) > 0,
		ai: {
			toolName: 'editor_duplicate_selected',
			description: 'Duplicate the currently selected features.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('duplicate_selected_features', 'Map editor is not ready.')
			const before = editor.getAllFeatures().length
			const selectedCount = editor.getSelectedFeatures().length
			if (selectedCount === 0) {
				return failure('duplicate_selected_features', 'No features are selected.')
			}
			editor.duplicateSelectedFeatures()
			const after = editor.getAllFeatures().length
			syncHistoryState(state)
			return success(
				'duplicate_selected_features',
				`Duplicated ${selectedCount} selected feature(s).`,
				{
					duplicatedCount: Math.max(0, after - before),
					totalFeaturesInEditor: after,
				},
			)
		},
	},
	{
		id: 'merge_selected_features',
		label: 'Merge selected',
		description: 'Merge selected compatible geometries into a multi-geometry feature.',
		canExecute: (state) => Boolean(state.editor?.canCombineSelection()),
		ai: {
			toolName: 'editor_merge_selected',
			description:
				'Merge selected compatible features into one MultiPoint/MultiLineString/MultiPolygon feature.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('merge_selected_features', 'Map editor is not ready.')
			const merged = editor.combineSelectedFeatures()
			if (!merged) {
				return failure(
					'merge_selected_features',
					'Merge failed. Select at least two compatible geometries first.',
				)
			}
			syncHistoryState(state)
			return success('merge_selected_features', 'Merged selected features.')
		},
	},
	{
		id: 'split_selected_features',
		label: 'Split selected',
		description: 'Split selected multi-geometries into single geometries.',
		canExecute: (state) => Boolean(state.editor?.canSplitSelection()),
		ai: {
			toolName: 'editor_split_selected',
			description: 'Split selected multi-geometries into individual features.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('split_selected_features', 'Map editor is not ready.')
			const split = editor.splitSelectedFeatures()
			if (!split) {
				return failure(
					'split_selected_features',
					'Split failed. Select at least one multi-geometry feature first.',
				)
			}
			syncHistoryState(state)
			return success('split_selected_features', 'Split selected multi-geometry feature(s).')
		},
	},
	{
		id: 'connect_selected_lines',
		label: 'Connect selected lines',
		description: 'Connect two selected linestring features at matching endpoints.',
		canExecute: (state) => Boolean(state.editor?.canConnectSelectedLines()),
		ai: {
			toolName: 'editor_connect_selected_lines',
			description: 'Connect exactly two selected LineString features at touching endpoints.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('connect_selected_lines', 'Map editor is not ready.')
			const connected = editor.connectSelectedLines()
			if (!connected) {
				return failure(
					'connect_selected_lines',
					'Connect failed. Select exactly two connected LineString features.',
				)
			}
			syncHistoryState(state)
			return success('connect_selected_lines', 'Connected selected lines.')
		},
	},
	{
		id: 'dissolve_selected_lines',
		label: 'Dissolve selected lines',
		description: 'Merge selected LineString/MultiLineString features into longer connected lines.',
		canExecute: (state) => Boolean(state.editor?.canDissolveSelectedLines()),
		ai: {
			toolName: 'editor_dissolve_selected_lines',
			description:
				'Dissolve selected line features by snapping nearby endpoints and merging connected segments.',
			parameters: {
				type: 'object',
				properties: {
					tolerance: {
						type: 'number',
						description:
							'Endpoint snap tolerance in lon/lat degrees. Default 0.00001 (~1m at equator).',
					},
				},
			},
		},
		execute: (state, args) => {
			const editor = state.editor
			if (!editor) {
				return failure('dissolve_selected_lines', 'Map editor is not ready.')
			}

			const tolerance = parseLineMergeTolerance(args.tolerance)
			const result = editor.dissolveSelectedLines(tolerance)
			if (result.createdCount === 0) {
				return failure('dissolve_selected_lines', 'No selected line features could be dissolved.')
			}

			syncHistoryState(state)
			return success(
				'dissolve_selected_lines',
				`Dissolved ${result.sourceFeatureCount} source feature(s) into ${result.createdCount} merged line(s).`,
				{
					sourceFeatureCount: result.sourceFeatureCount,
					createdCount: result.createdCount,
					skippedPartCount: result.skippedPartCount,
					tolerance,
				},
			)
		},
	},
	{
		id: 'start_boolean_union',
		label: 'Boolean union',
		description: 'Start polygon boolean union workflow.',
		canExecute: hasSingleSelectedPolygon,
		ai: {
			toolName: 'editor_start_boolean_union',
			description:
				'Start polygon union mode. First select one polygon, call this tool, then select/click the second polygon in the map.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('start_boolean_union', 'Map editor is not ready.')
			const started = editor.startBooleanUnion()
			if (!started) {
				return failure(
					'start_boolean_union',
					'Boolean union requires exactly one selected polygon or multipolygon.',
				)
			}
			return success('start_boolean_union', 'Boolean union started. Select the second polygon.')
		},
	},
	{
		id: 'start_boolean_difference',
		label: 'Boolean difference',
		description: 'Start polygon boolean difference workflow.',
		canExecute: hasSingleSelectedPolygon,
		ai: {
			toolName: 'editor_start_boolean_difference',
			description:
				'Start polygon difference mode. First select one polygon, call this tool, then select/click the second polygon in the map.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('start_boolean_difference', 'Map editor is not ready.')
			const started = editor.startBooleanDifference()
			if (!started) {
				return failure(
					'start_boolean_difference',
					'Boolean difference requires exactly one selected polygon or multipolygon.',
				)
			}
			return success(
				'start_boolean_difference',
				'Boolean difference started. Select the second polygon.',
			)
		},
	},
	{
		id: 'cancel_boolean_operation',
		label: 'Cancel boolean op',
		description: 'Cancel currently active boolean operation.',
		canExecute: (state) => Boolean(state.editor?.getBooleanOperation()),
		ai: {
			toolName: 'editor_cancel_boolean_operation',
			description: 'Cancel an active boolean union/difference operation.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('cancel_boolean_operation', 'Map editor is not ready.')
			if (!editor.getBooleanOperation()) {
				return failure('cancel_boolean_operation', 'No boolean operation is currently active.')
			}
			editor.cancelBooleanOperation()
			return success('cancel_boolean_operation', 'Cancelled active boolean operation.')
		},
	},
	{
		id: 'finish_drawing',
		label: 'Finish drawing',
		description: 'Finish the active line or polygon drawing and create the feature.',
		canExecute: (state) => Boolean(state.editor?.canFinishDrawing()),
		ai: {
			toolName: 'editor_finish_drawing',
			description: 'Finish the currently active line/polygon drawing when enough vertices exist.',
		},
		execute: (state) => {
			const editor = state.editor
			if (!editor) return failure('finish_drawing', 'Map editor is not ready.')
			const feature = editor.finishDrawing()
			if (!feature) {
				return failure('finish_drawing', 'No active line/polygon drawing can be finished yet.')
			}
			syncHistoryState(state)
			return success('finish_drawing', 'Finished drawing and created a feature.', {
				featureId: feature.id,
				geometryType: feature.geometry.type,
			})
		},
	},
	{
		id: 'simplify_selected_features',
		label: 'Simplify selected',
		description: 'Simplify selected line/polygon geometries.',
		canExecute: (state) => Boolean(state.editor?.canSimplifySelectedFeatures()),
		ai: {
			toolName: 'editor_simplify_selected',
			description:
				'Simplify selected LineString/Polygon features to reduce vertex count while preserving general shape.',
			parameters: {
				type: 'object',
				properties: {
					tolerance: {
						type: 'number',
						description:
							'Simplification tolerance in lon/lat degrees. Smaller keeps more detail. Default 0.0001.',
					},
				},
			},
		},
		execute: (state, args) => {
			const editor = state.editor
			if (!editor) {
				return failure('simplify_selected_features', 'Map editor is not ready.')
			}

			const tolerance = parseSimplifyTolerance(args.tolerance)
			const result = editor.simplifySelectedFeatures(tolerance)
			if (result.updatedCount === 0) {
				return failure(
					'simplify_selected_features',
					'No selected line/polygon features could be simplified.',
				)
			}

			syncHistoryState(state)
			return success(
				'simplify_selected_features',
				`Simplified ${result.updatedCount} feature(s).`,
				{
					updatedCount: result.updatedCount,
					skippedCount: result.skippedCount,
					tolerance,
				},
			)
		},
	},
]

const editorCommandById = new Map(editorCommands.map((command) => [command.id, command]))
const editorCommandByToolName = new Map(
	editorCommands
		.filter((command) => Boolean(command.ai?.toolName))
		.map((command) => [command.ai?.toolName as string, command]),
)

export function getEditorCommands(): ReadonlyArray<EditorCommandDefinition> {
	return editorCommands
}

export function canExecuteEditorCommand(commandId: EditorCommandId): boolean {
	const command = editorCommandById.get(commandId)
	if (!command) return false
	if (!command.canExecute) return true
	return command.canExecute(useEditorStore.getState())
}

export function executeEditorCommand(
	commandId: EditorCommandId,
	args: EditorCommandArgs = {},
): EditorCommandExecutionResult {
	const command = editorCommandById.get(commandId)
	if (!command) {
		return failure(commandId, `Unknown editor command '${commandId}'.`)
	}
	return command.execute(useEditorStore.getState(), args)
}

export function getEditorAiToolDefinitions(): EditorAiToolDefinition[] {
	return editorCommands
		.filter((command) => Boolean(command.ai))
		.map((command) => ({
			name: command.ai?.toolName as string,
			description: command.ai?.description || command.description,
			parameters: command.ai?.parameters || { type: 'object', properties: {} },
		}))
}

export function executeEditorAiTool(
	toolName: string,
	args: EditorCommandArgs = {},
): EditorCommandExecutionResult | null {
	const command = editorCommandByToolName.get(toolName)
	if (!command) return null
	return command.execute(useEditorStore.getState(), args)
}
