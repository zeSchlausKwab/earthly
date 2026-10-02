import { bbox } from '@turf/turf'
import { buildPostWriteValidation } from '@/features/chat/safeEditing/autoValidate'
import { gateBulkApply } from '@/features/chat/safeEditing/gateBulkEdit'
import { getSafetyLevel } from '@/features/chat/safeEditing/safetyAccess'
import {
	performPolygonBoolean,
	POLYGON_BOOLEAN_MAX_MASKS,
	type PolygonBooleanOperation,
} from '@/features/geo-editor/api/polygonBoolean'
import type { EditorFeature } from '@/features/geo-editor/core'
import { createExecutionAuthoring, getExecutionEditor } from './executionTarget'
import type { ToolEntry } from './registry'
import type { Tool } from './types'

const polygonBooleanSchema: Tool = {
	type: 'function',
	function: {
		name: 'polygon_boolean',
		description:
			'Clip, subtract, or union existing Polygon/MultiPolygon features by exact IDs in the active Map. Masks are combined by union: intersection keeps source area inside any mask; difference removes all mask areas; union combines source and masks. Explicitly choose append (new feature, source retained) or replace-source (same source ID and properties). Masks and unrelated features are always retained. Preserves source styles, callouts and provenance. Empty results return emptyResult:true and leave the Map unchanged; use an explicit deletion tool if deletion is intended. Finite 2D WGS84 polygons only; split date-line crossings first. Limited to 50 masks, 10,000 total positions and 1 MiB of geometry; simplify oversized inputs first. One shared edit review and Undo; does not publish.',
		parameters: {
			type: 'object',
			properties: {
				sourceFeatureId: { type: 'string', minLength: 1 },
				maskFeatureIds: {
					type: 'array',
					items: { type: 'string', minLength: 1 },
					minItems: 1,
					maxItems: POLYGON_BOOLEAN_MAX_MASKS,
					uniqueItems: true,
					description: 'Existing mask polygon IDs. Must be distinct and exclude the source ID.',
				},
				operation: { type: 'string', enum: ['intersection', 'difference', 'union'] },
				resultMode: {
					type: 'string',
					enum: ['append', 'replace-source'],
					description:
						'Required: append keeps the source; replace-source changes only its geometry.',
				},
			},
			required: ['sourceFeatureId', 'maskFeatureIds', 'operation', 'resultMode'],
		},
	},
}

function exactId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim())
		throw new Error(`${label} must be a non-empty ID.`)
	return value.trim()
}

export function registerPolygonBooleanTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'polygon_boolean',
		kind: 'authoring-primitive',
		schema: polygonBooleanSchema,
		handler: async (args) => {
			const sourceFeatureId = exactId(args.sourceFeatureId, 'sourceFeatureId')
			if (!Array.isArray(args.maskFeatureIds))
				throw new Error('maskFeatureIds must be an array of IDs.')
			if (
				args.maskFeatureIds.length === 0 ||
				args.maskFeatureIds.length > POLYGON_BOOLEAN_MAX_MASKS
			)
				throw new Error(`Provide between 1 and ${POLYGON_BOOLEAN_MAX_MASKS} mask IDs.`)
			const maskFeatureIds = args.maskFeatureIds.map((id) => exactId(id, 'maskFeatureIds entry'))
			if (
				new Set(maskFeatureIds).size !== maskFeatureIds.length ||
				maskFeatureIds.includes(sourceFeatureId)
			) {
				throw new Error('Mask IDs must be distinct and must exclude the source ID.')
			}
			if (!['intersection', 'difference', 'union'].includes(String(args.operation))) {
				throw new Error('operation must be intersection, difference, or union.')
			}
			if (args.resultMode !== 'append' && args.resultMode !== 'replace-source') {
				throw new Error('Explicitly choose resultMode append or replace-source.')
			}
			const editor = getExecutionEditor()
			if (!editor) throw new Error('Map editor is not ready. Open the map editor first.')
			const read = (id: string): EditorFeature => {
				const feature = editor.getFeature(id)
				if (!feature) throw new Error(`Feature '${id}' was not found in the active Map.`)
				return feature
			}
			const source = structuredClone(read(sourceFeatureId))
			const masks = maskFeatureIds.map((id) => structuredClone(read(id)))
			const operation = args.operation as PolygonBooleanOperation
			const computed = performPolygonBoolean(source, masks, operation)
			const base = {
				operation,
				resultMode: args.resultMode,
				sourceFeatureId,
				maskFeatureIds,
				...computed,
			}
			// Avoid returning a large geometry to the model: exact result IDs can be read.
			const { geometry, ...report } = base
			if (!geometry) {
				return {
					...report,
					cancelled: false,
					resultFeatureIds: [],
					counts: { created: 0, updated: 0 },
					unchanged: true,
				}
			}
			const inputSnapshots = [source, ...masks].map((feature) => ({
				id: feature.id,
				key: JSON.stringify(feature),
			}))
			let resultFeatureIds: string[] = []
			const outcome = await gateBulkApply(
				editor,
				{ getSafetyLevel, label: `Polygon ${operation}` },
				args.resultMode === 'append' ? 'add' : 'modify',
				() => {
					if (
						getExecutionEditor() !== editor ||
						inputSnapshots.some(({ id, key }) => JSON.stringify(editor.getFeature(id)) !== key)
					) {
						throw new Error(
							'Polygon inputs changed before apply. Read the Map and retry with current features.',
						)
					}
					const authoring = createExecutionAuthoring(editor)
					if (args.resultMode === 'replace-source') {
						const result = authoring.modifyFeatureGeometry(sourceFeatureId, geometry)
						if (!result.ok) throw new Error('The source disappeared before the polygon edit.')
						resultFeatureIds = result.featureIds
					} else {
						const id = crypto.randomUUID()
						const feature = {
							...structuredClone(source),
							id,
							geometry,
							properties: {
								...structuredClone(source.properties),
								featureId: id,
								'earthly:polygonBoolean': { operation, sourceFeatureId, maskFeatureIds },
							},
						}
						if (feature.bbox) feature.bbox = bbox(feature, { recompute: true })
						const result = createExecutionAuthoring(editor).addFeature(
							feature,
							String(source.properties.importSource ?? 'chat_tool'),
						)
						if (!result.ok) throw new Error('The polygon result could not be added.')
						resultFeatureIds = result.featureIds
					}
				},
			)
			const applied = outcome.status === 'applied'
			const results = applied ? resultFeatureIds.map(read) : []
			return {
				...report,
				cancelled: !applied,
				resultFeatureIds: applied ? resultFeatureIds : [],
				counts: {
					created: applied ? outcome.diff.added.length : 0,
					updated: applied ? outcome.diff.modified.length : 0,
				},
				...(results.length > 0 ? { validation: await buildPostWriteValidation(results) } : {}),
			}
		},
	})
}
