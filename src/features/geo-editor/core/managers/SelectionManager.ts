import type { Position } from 'geojson'
import type { Map as MaplibreMap } from 'maplibre-gl'
import type { EditorFeature, IManager, SelectionBounds } from '../types'
import { isFinitePosition } from '../utils/coordinates'

export class SelectionManager implements IManager {
	private selectedFeatures: Set<string> = new Set()
	private groups: Map<string, Set<string>> = new Map()

	onAdd(_map: MaplibreMap): void {}

	onRemove(): void {
		this.clear()
	}

	select(featureId: string | string[]): void {
		const ids = Array.isArray(featureId) ? featureId : [featureId]
		for (const id of ids) this.selectedFeatures.add(id)
	}

	deselect(featureId: string | string[]): void {
		const ids = Array.isArray(featureId) ? featureId : [featureId]
		for (const id of ids) this.selectedFeatures.delete(id)
	}

	toggleSelect(featureId: string): void {
		if (this.selectedFeatures.has(featureId)) {
			this.selectedFeatures.delete(featureId)
		} else {
			this.selectedFeatures.add(featureId)
		}
	}

	clearSelection(): void {
		this.selectedFeatures.clear()
	}

	isSelected(featureId: string): boolean {
		return this.selectedFeatures.has(featureId)
	}

	getSelected(): string[] {
		return Array.from(this.selectedFeatures)
	}

	selectInBounds(features: EditorFeature[], bounds: SelectionBounds): string[] {
		const selected: string[] = []

		features.forEach((feature) => {
			if (this.isFeatureInBounds(feature, bounds)) {
				this.selectedFeatures.add(feature.id)
				selected.push(feature.id)
			}
		})

		return selected
	}

	private isFeatureInBounds(feature: EditorFeature, bounds: SelectionBounds): boolean {
		const { north, south, east, west } = bounds
		const inBounds = (position: Position): boolean =>
			isFinitePosition(position) &&
			position[0] >= west &&
			position[0] <= east &&
			position[1] >= south &&
			position[1] <= north

		const { geometry } = feature
		switch (geometry.type) {
			case 'Point':
				return inBounds(geometry.coordinates)
			case 'MultiPoint':
			case 'LineString':
				return geometry.coordinates.some(inBounds)
			case 'MultiLineString':
				return geometry.coordinates.some((line) => line.some(inBounds))
			case 'Polygon':
				return geometry.coordinates[0]?.some(inBounds) ?? false
			case 'MultiPolygon':
				return geometry.coordinates.some((polygon) => polygon[0]?.some(inBounds) ?? false)
			default:
				return false
		}
	}

	// Group management
	createGroup(groupId: string, featureIds: string[]): void {
		this.groups.set(groupId, new Set(featureIds))
	}

	addToGroup(groupId: string, featureId: string | string[]): void {
		let group = this.groups.get(groupId)
		if (!group) {
			group = new Set()
			this.groups.set(groupId, group)
		}
		const ids = Array.isArray(featureId) ? featureId : [featureId]
		for (const id of ids) group.add(id)
	}

	removeFromGroup(groupId: string, featureId: string | string[]): void {
		const group = this.groups.get(groupId)
		if (!group) return

		const ids = Array.isArray(featureId) ? featureId : [featureId]
		for (const id of ids) group.delete(id)

		if (group.size === 0) {
			this.groups.delete(groupId)
		}
	}

	deleteGroup(groupId: string): void {
		this.groups.delete(groupId)
	}

	getGroup(groupId: string): string[] {
		const group = this.groups.get(groupId)
		return group ? Array.from(group) : []
	}

	getGroupForFeature(featureId: string): string | null {
		for (const [groupId, features] of this.groups.entries()) {
			if (features.has(featureId)) {
				return groupId
			}
		}
		return null
	}

	selectGroup(groupId: string): void {
		const group = this.groups.get(groupId)
		if (group) {
			for (const id of group) this.selectedFeatures.add(id)
		}
	}

	getAllGroups(): Map<string, string[]> {
		const result = new Map<string, string[]>()
		this.groups.forEach((features, groupId) => {
			result.set(groupId, Array.from(features))
		})
		return result
	}

	clear(): void {
		this.selectedFeatures.clear()
		this.groups.clear()
	}
}
