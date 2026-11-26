import type { Geometry } from 'geojson'
import {
	explodeMultipartWasm,
	mergeToMultipartWasm,
	type GeoJsonGeometryOrFeature,
} from '@/lib/wasm/earthlyWasm'
import type { EditorFeature, EditorOperationContext } from '../types'
import { generateId } from '../utils/geometry'
import {
	cloneFeature,
	extractGeometryParts,
	getBaseGeometryType,
	isMultiGeometry,
	normalizeFeature,
	toMultiGeometryType,
} from '../utils/featureHelpers'

function geometryHasOnly2d(geometry: Geometry): boolean {
	const checkCoords = (value: unknown): boolean => {
		if (!Array.isArray(value)) return true
		if (value.length > 0 && typeof value[0] === 'number') {
			return value.length === 2 && Number.isFinite(value[0]) && Number.isFinite(value[1])
		}
		return value.every(checkCoords)
	}
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.every(geometryHasOnly2d)
	}
	return checkCoords(geometry.coordinates)
}

export class CombineManager {
	constructor(private ctx: EditorOperationContext) {}

	canCombine(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length < 2) return false
		const baseType = getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		return selected.every((feature) => getBaseGeometryType(feature.geometry.type) === baseType)
	}

	canSplit(): boolean {
		return this.ctx.getSelectedFeatures().some((feature) => isMultiGeometry(feature.geometry.type))
	}

	combineSelectedFeatures(): boolean {
		const selected = this.ctx.getSelectedFeatures()
		if (selected.length < 2) return false

		const baseType = getBaseGeometryType(selected[0].geometry.type)
		if (!baseType) return false
		if (!selected.every((feature) => getBaseGeometryType(feature.geometry.type) === baseType))
			return false

		const multiType = toMultiGeometryType(baseType)
		if (!multiType) return false

		const all2d = selected.every((feature) => geometryHasOnly2d(feature.geometry))
		const wasmMerged = all2d
			? mergeToMultipartWasm(
					selected.map((feature) => feature.geometry as GeoJsonGeometryOrFeature),
				)
			: null

		let mergedGeometry: Geometry
		if (wasmMerged) {
			mergedGeometry = wasmMerged as Geometry
		} else {
			const parts = selected.flatMap((feature) => extractGeometryParts(feature.geometry, baseType))
			if (parts.length === 0) return false
			mergedGeometry = {
				type: multiType,
				coordinates: JSON.parse(JSON.stringify(parts)),
			} as Geometry
		}

		const template = cloneFeature(selected[0])
		const newFeature: EditorFeature = {
			...template,
			id: generateId(),
			geometry: mergedGeometry,
		}

		selected.forEach((feature) => this.ctx.features.delete(feature.id))
		const normalized = normalizeFeature(newFeature)
		this.ctx.features.set(normalized.id, normalized)
		this.ctx.selection.clearSelection()
		this.ctx.selection.select(normalized.id)
		this.ctx.history.recordUpdate([normalized], selected)
		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()
		this.ctx.emit('selection.change', {
			type: 'selection.change',
			features: this.ctx.getSelectedFeatures(),
		})
		this.ctx.emit('update', { type: 'update', features: [normalized] })
		return true
	}

	splitSelectedFeatures(): boolean {
		const selected = this.ctx
			.getSelectedFeatures()
			.filter((feature) => isMultiGeometry(feature.geometry.type))
		if (selected.length === 0) return false

		const newFeatures: EditorFeature[] = []

		selected.forEach((feature) => {
			const baseType = getBaseGeometryType(feature.geometry.type)
			if (!baseType) return
			const wasmParts = geometryHasOnly2d(feature.geometry)
				? explodeMultipartWasm(feature.geometry as GeoJsonGeometryOrFeature)
				: null
			if (wasmParts && wasmParts.length > 0) {
				wasmParts.forEach((partGeometry) => {
					const clone = cloneFeature(feature)
					clone.id = generateId()
					clone.geometry = partGeometry as Geometry
					newFeatures.push(normalizeFeature(clone))
				})
				return
			}
			const parts = extractGeometryParts(feature.geometry, baseType)
			parts.forEach((coords) => {
				const clone = cloneFeature(feature)
				clone.id = generateId()
				clone.geometry = {
					type: baseType,
					coordinates: JSON.parse(JSON.stringify(coords)),
				} as Geometry
				newFeatures.push(normalizeFeature(clone))
			})
		})

		if (newFeatures.length === 0) return false

		selected.forEach((feature) => this.ctx.features.delete(feature.id))
		newFeatures.forEach((feature) => this.ctx.features.set(feature.id, feature))
		this.ctx.selection.clearSelection()
		this.ctx.selection.select(newFeatures.map((feature) => feature.id))
		this.ctx.history.recordUpdate(newFeatures, selected)
		this.ctx.render()
		if (this.ctx.mode === 'edit') this.ctx.renderVertices()
		this.ctx.emit('selection.change', {
			type: 'selection.change',
			features: this.ctx.getSelectedFeatures(),
		})
		this.ctx.emit('update', { type: 'update', features: newFeatures })
		return true
	}
}
