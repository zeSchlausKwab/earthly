import type { Position } from 'geojson';
import type { Map as MaplibreMap } from 'maplibre-gl';
import type { EditorFeature, IManager, SelectionBounds } from '../types';
import { isPointInPolygon } from '../utils/geometry';

export class SelectionManager implements IManager {
	private map?: MaplibreMap;
	private selectedFeatures: Set<string> = new Set();
	private groups: Map<string, Set<string>> = new Map();

	onAdd(map: MaplibreMap): void {
		this.map = map;
	}

	onRemove(): void {
		this.clear();
	}

	select(featureId: string | string[]): void {
		const ids = Array.isArray(featureId) ? featureId : [featureId];
		ids.forEach((id) => this.selectedFeatures.add(id));
	}

	deselect(featureId: string | string[]): void {
		const ids = Array.isArray(featureId) ? featureId : [featureId];
		ids.forEach((id) => this.selectedFeatures.delete(id));
	}

	toggleSelect(featureId: string): void {
		if (this.selectedFeatures.has(featureId)) {
			this.selectedFeatures.delete(featureId);
		} else {
			this.selectedFeatures.add(featureId);
		}
	}

	clearSelection(): void {
		this.selectedFeatures.clear();
	}

	isSelected(featureId: string): boolean {
		return this.selectedFeatures.has(featureId);
	}

	getSelected(): string[] {
		return Array.from(this.selectedFeatures);
	}

	selectInBounds(features: EditorFeature[], bounds: SelectionBounds): string[] {
		const selected: string[] = [];

		features.forEach((feature) => {
			if (this.isFeatureInBounds(feature, bounds)) {
				this.selectedFeatures.add(feature.id);
				selected.push(feature.id);
			}
		});

		return selected;
	}

	private isFeatureInBounds(feature: EditorFeature, bounds: SelectionBounds): boolean {
		const { north, south, east, west } = bounds;

		if (feature.geometry.type === 'Point') {
			const [lng, lat] = feature.geometry.coordinates as Position;
			return lng >= west && lng <= east && lat >= south && lat <= north;
		} else if (feature.geometry.type === 'MultiPoint') {
			const coords = feature.geometry.coordinates as Position[];
			return coords.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);
		} else if (feature.geometry.type === 'LineString') {
			const coords = feature.geometry.coordinates as Position[];
			return coords.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);
		} else if (feature.geometry.type === 'MultiLineString') {
			const lines = feature.geometry.coordinates as Position[][];
			return lines.some((line) =>
				line.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north)
			);
		} else if (feature.geometry.type === 'Polygon') {
			const coords = feature.geometry.coordinates as Position[][];
			return coords[0].some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north);
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = feature.geometry.coordinates as Position[][][];
			return polygons.some((polygon) =>
				polygon[0]?.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north)
			);
		}

		return false;
	}

	// Group management
	createGroup(groupId: string, featureIds: string[]): void {
		this.groups.set(groupId, new Set(featureIds));
	}

	addToGroup(groupId: string, featureId: string | string[]): void {
		if (!this.groups.has(groupId)) {
			this.groups.set(groupId, new Set());
		}

		const group = this.groups.get(groupId)!;
		const ids = Array.isArray(featureId) ? featureId : [featureId];
		ids.forEach((id) => group.add(id));
	}

	removeFromGroup(groupId: string, featureId: string | string[]): void {
		const group = this.groups.get(groupId);
		if (!group) return;

		const ids = Array.isArray(featureId) ? featureId : [featureId];
		ids.forEach((id) => group.delete(id));

		if (group.size === 0) {
			this.groups.delete(groupId);
		}
	}

	deleteGroup(groupId: string): void {
		this.groups.delete(groupId);
	}

	getGroup(groupId: string): string[] {
		const group = this.groups.get(groupId);
		return group ? Array.from(group) : [];
	}

	getGroupForFeature(featureId: string): string | null {
		for (const [groupId, features] of this.groups.entries()) {
			if (features.has(featureId)) {
				return groupId;
			}
		}
		return null;
	}

	selectGroup(groupId: string): void {
		const group = this.groups.get(groupId);
		if (group) {
			group.forEach((id) => this.selectedFeatures.add(id));
		}
	}

	getAllGroups(): Map<string, string[]> {
		const result = new Map<string, string[]>();
		this.groups.forEach((features, groupId) => {
			result.set(groupId, Array.from(features));
		});
		return result;
	}

	clear(): void {
		this.selectedFeatures.clear();
		this.groups.clear();
	}
}
