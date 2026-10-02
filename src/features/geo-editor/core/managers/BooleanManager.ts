import { performPolygonBoolean } from '../../api/polygonBoolean'
import type { EditorFeature, EditorOperationContext } from '../types'
import { normalizeFeature } from '../utils/featureHelpers'

export class BooleanManager {
	private booleanOperation?: {
		type: 'union' | 'difference'
		firstFeatureId: string
	}

	constructor(private ctx: EditorOperationContext) {}

	startUnion(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length !== 1) return false

		const feature = selected[0]
		if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
			return false
		}

		this.booleanOperation = {
			type: 'union',
			firstFeatureId: feature.id,
		}
		this.ctx.emit('mode.change', { type: 'mode.change', mode: this.ctx.mode })
		return true
	}

	startDifference(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length !== 1) return false

		const feature = selected[0]
		if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') {
			return false
		}

		this.booleanOperation = {
			type: 'difference',
			firstFeatureId: feature.id,
		}
		this.ctx.emit('mode.change', { type: 'mode.change', mode: this.ctx.mode })
		return true
	}

	cancel(): void {
		this.booleanOperation = undefined
		this.ctx.emit('mode.change', { type: 'mode.change', mode: this.ctx.mode })
	}

	getOperation(): { type: 'union' | 'difference'; firstFeatureId: string } | undefined {
		return this.booleanOperation
	}

	complete(secondFeatureId: string): boolean {
		if (!this.booleanOperation) return false

		const firstFeature = this.ctx.features.get(this.booleanOperation.firstFeatureId)
		const secondFeature = this.ctx.features.get(secondFeatureId)

		if (!firstFeature || !secondFeature) {
			this.cancel()
			return false
		}

		// Ensure both are polygons
		if (
			(firstFeature.geometry.type !== 'Polygon' && firstFeature.geometry.type !== 'MultiPolygon') ||
			(secondFeature.geometry.type !== 'Polygon' && secondFeature.geometry.type !== 'MultiPolygon')
		) {
			this.cancel()
			return false
		}

		try {
			const result = performPolygonBoolean(
				firstFeature,
				[secondFeature],
				this.booleanOperation.type,
			)
			if (!result.geometry) {
				this.cancel()
				return false
			}

			const id = crypto.randomUUID()
			const newFeature: EditorFeature = {
				...firstFeature,
				id,
				geometry: result.geometry,
				properties: {
					...firstFeature.properties,
					featureId: id,
				},
			}

			const normalized = normalizeFeature(newFeature)

			this.ctx.features.delete(firstFeature.id)
			this.ctx.features.delete(secondFeature.id)
			this.ctx.features.set(normalized.id, normalized)
			this.ctx.history.recordUpdate([normalized], [firstFeature, secondFeature])

			this.ctx.selection.clearSelection()
			this.ctx.selection.select([normalized.id])

			this.ctx.render()
			this.ctx.emit('update', { type: 'update', features: [normalized] })
			this.ctx.emit('selection.change', {
				type: 'selection.change',
				features: [normalized],
			})
		} catch (error) {
			console.error('Boolean operation failed:', error)
			this.cancel()
			return false
		}

		this.booleanOperation = undefined
		return true
	}
}
