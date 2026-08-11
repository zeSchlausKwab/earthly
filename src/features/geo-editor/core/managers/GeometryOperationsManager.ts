import type { Feature } from 'geojson'
import {
	performGeometryOperation,
	type GeometryOperationRequest,
} from '../../api/geometryOperations'
import type { EditorFeature, EditorOperationContext } from '../types'
import { normalizeFeature } from '../utils/featureHelpers'

export type GeometryOperationResultMode = 'replace' | 'copy'

export interface AppliedGeometryOperation {
	sourceFeatureId: string
	resultFeatureIds: string[]
	createdCount: number
	deletedCount: number
	features: EditorFeature[]
}

/**
 * Applies output from the pure geometry-operation kernel to editor state.
 * Interaction controllers and numeric commands share this single commit path,
 * so every manual operation is rendered, selected, and recorded as one undo step.
 */
export class GeometryOperationsManager {
	constructor(private ctx: EditorOperationContext) {}

	apply(
		targetFeatureId: string,
		request: GeometryOperationRequest,
		resultMode: GeometryOperationResultMode,
		options: { recordHistory?: boolean } = {},
	): AppliedGeometryOperation {
		const source = this.ctx.features.get(targetFeatureId)
		if (!source) throw new Error(`Feature '${targetFeatureId}' was not found.`)

		const result = performGeometryOperation(source as Feature, request)
		const derived = result.features.map((feature) =>
			normalizeFeature(feature as EditorFeature),
		)
		const recordHistory = options.recordHistory !== false

		if (resultMode === 'replace') {
			this.ctx.features.delete(source.id)
		}
		for (const feature of derived) this.ctx.features.set(feature.id, feature)

		if (recordHistory) {
			if (resultMode === 'replace') {
				this.ctx.history.recordUpdate(derived, [source])
			} else {
				this.ctx.history.recordCreate(derived)
			}
		}

		this.ctx.selection.clearSelection()
		this.ctx.selection.select(derived.map((feature) => feature.id))
		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()
		this.ctx.emit('features.replace', {
			type: 'features.replace',
			features: [...this.ctx.features.values()],
		})
		this.ctx.emit('selection.change', {
			type: 'selection.change',
			features: derived,
		})

		return {
			sourceFeatureId: source.id,
			resultFeatureIds: derived.map((feature) => feature.id),
			createdCount: derived.length,
			deletedCount: resultMode === 'replace' ? 1 : 0,
			features: derived,
		}
	}
}
