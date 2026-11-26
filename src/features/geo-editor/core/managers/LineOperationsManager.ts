import type { Geometry, Position } from 'geojson'
import { dissolveLinesWasm, type Position2D } from '@/lib/wasm/earthlyWasm'
import type { EditorFeature, EditorOperationContext } from '../types'
import { generateId } from '../utils/geometry'
import {
	cloneFeature,
	extractLinePartsFromGeometry,
	isLineGeometryType,
	mergeLinePartsBySharedEndpoints,
	normalizeFeature,
	normalizeLineCoordinates,
} from '../utils/featureHelpers'

export class LineOperationsManager {
	constructor(private ctx: EditorOperationContext) {}

	canConnect(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length !== 2) return false
		return selected.every((f) => f.geometry.type === 'LineString')
	}

	canDissolve(): boolean {
		const selected = this.ctx
			.getSelectedFeatures()
			.filter((feature) => isLineGeometryType(feature.geometry.type))
		if (selected.length === 0) return false

		const partCount = selected.reduce(
			(total, feature) => total + extractLinePartsFromGeometry(feature.geometry).length,
			0,
		)
		return partCount >= 2
	}

	connectSelectedLines(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length !== 2) return false

		const line1 = selected[0]
		const line2 = selected[1]
		if (!line1 || !line2) return false
		if (line1.geometry.type !== 'LineString' || line2.geometry.type !== 'LineString') {
			return false
		}

		const coords1 = (line1.geometry as GeoJSON.LineString).coordinates
		const coords2 = (line2.geometry as GeoJSON.LineString).coordinates

		if (coords1.length < 2 || coords2.length < 2) return false

		const TOLERANCE = 1e-6
		const pointsMatch = (a: Position, b: Position): boolean =>
			Math.abs(a[0] - b[0]) < TOLERANCE && Math.abs(a[1] - b[1]) < TOLERANCE

		const start1 = coords1[0]
		const end1 = coords1[coords1.length - 1]
		const start2 = coords2[0]
		const end2 = coords2[coords2.length - 1]

		if (!start1 || !end1 || !start2 || !end2) return false

		let newCoords: Position[] | null = null

		if (pointsMatch(end1, start2)) {
			newCoords = [...coords1, ...coords2.slice(1)]
		} else if (pointsMatch(start1, end2)) {
			newCoords = [...coords2, ...coords1.slice(1)]
		} else if (pointsMatch(end1, end2)) {
			newCoords = [...coords1, ...coords2.slice(0, -1).reverse()]
		} else if (pointsMatch(start1, start2)) {
			newCoords = [...[...coords1].reverse(), ...coords2.slice(1)]
		}

		if (!newCoords || newCoords.length < 2) return false

		// Remove consecutive duplicate points
		const firstCoord = newCoords[0]
		if (!firstCoord) return false
		const deduped: Position[] = [firstCoord]
		for (let i = 1; i < newCoords.length; i++) {
			const prev = deduped[deduped.length - 1]
			const curr = newCoords[i]
			if (prev && curr && !pointsMatch(prev, curr)) {
				deduped.push(curr)
			}
		}
		newCoords = deduped

		const template = cloneFeature(line1)
		const newFeature: EditorFeature = {
			...template,
			id: generateId(),
			geometry: {
				type: 'LineString',
				coordinates: newCoords,
			} as Geometry,
		}

		this.ctx.features.delete(line1.id)
		this.ctx.features.delete(line2.id)

		const normalizedFeature = normalizeFeature(newFeature)
		this.ctx.features.set(normalizedFeature.id, normalizedFeature)

		this.ctx.selection.clearSelection()
		this.ctx.selection.select(normalizedFeature.id)
		this.ctx.history.recordUpdate([normalizedFeature], selected)

		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()

		this.ctx.emit('selection.change', {
			type: 'selection.change',
			features: this.ctx.getSelectedFeatures(),
		})
		this.ctx.emit('update', { type: 'update', features: [normalizedFeature] })

		return true
	}

	dissolveSelectedLines(tolerance: number = 0.00001): {
		sourceFeatureCount: number
		createdCount: number
		skippedPartCount: number
	} {
		const selected = this.ctx
			.getSelectedFeatures()
			.filter((feature) => isLineGeometryType(feature.geometry.type))
		if (selected.length === 0) {
			return { sourceFeatureCount: 0, createdCount: 0, skippedPartCount: 0 }
		}

		const safeTolerance = Number.isFinite(tolerance)
			? Math.min(1, Math.max(1e-8, tolerance))
			: 0.00001

		const lineParts = selected.flatMap((feature) =>
			extractLinePartsFromGeometry(feature.geometry).map((coords) => ({ feature, coords })),
		)

		const snappedParts: Position[][] = []
		let skippedPartCount = 0
		for (const part of lineParts) {
			const snapped = normalizeLineCoordinates(part.coords, safeTolerance)
			if (snapped.length < 2) {
				skippedPartCount += 1
				continue
			}
			snappedParts.push(snapped)
		}

		if (snappedParts.length === 0) {
			return {
				sourceFeatureCount: selected.length,
				createdCount: 0,
				skippedPartCount,
			}
		}

		const all2d = snappedParts.every((line) => line.every((coord) => coord.length === 2))
		const wasmMerged = all2d
			? dissolveLinesWasm(snappedParts as Position2D[][], safeTolerance * 111_320)
			: null
		const mergedLines =
			wasmMerged && wasmMerged.length > 0
				? wasmMerged
				: mergeLinePartsBySharedEndpoints(snappedParts, safeTolerance)
		if (mergedLines.length === 0) {
			return {
				sourceFeatureCount: selected.length,
				createdCount: 0,
				skippedPartCount,
			}
		}

		const template = cloneFeature(selected[0])
		const mergedFeatures: EditorFeature[] = mergedLines.map((coordinates) =>
			normalizeFeature({
				...template,
				id: generateId(),
				geometry: {
					type: 'LineString',
					coordinates,
				} as Geometry,
			}),
		)

		selected.forEach((feature) => {
			this.ctx.features.delete(feature.id)
		})
		mergedFeatures.forEach((feature) => {
			this.ctx.features.set(feature.id, feature)
		})

		this.ctx.selection.clearSelection()
		this.ctx.selection.select(mergedFeatures.map((feature) => feature.id))
		this.ctx.history.recordUpdate(mergedFeatures, selected)
		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()
		this.ctx.emit('selection.change', {
			type: 'selection.change',
			features: this.ctx.getSelectedFeatures(),
		})
		this.ctx.emit('update', { type: 'update', features: mergedFeatures })

		return {
			sourceFeatureCount: selected.length,
			createdCount: mergedFeatures.length,
			skippedPartCount,
		}
	}
}
