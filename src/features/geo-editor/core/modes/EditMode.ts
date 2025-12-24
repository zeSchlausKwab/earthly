import type { Position } from 'geojson';
import type { Map, MapMouseEvent } from 'maplibre-gl';
import type { EditorFeature } from '../types';
import { distance } from '../utils/geometry';

export interface EditState {
	feature?: EditorFeature;
	draggingVertex?: {
		featureId: string;
		coordinatePath: number[];
		startPosition: Position;
	};
	draggingFeature?: {
		featureId: string;
		startLngLat: Position;
		startGeometry: any;
	};
	hoveredVertex?: {
		featureId: string;
		coordinatePath: number[];
	};
}

export class EditMode {
	private map?: Map;
	private state: EditState = {};
	private vertexRadius: number = 6;

	onAdd(map: Map): void {
		this.map = map;
	}

	onRemove(): void {
		this.reset();
	}

	reset(): void {
		this.state = {};
	}

	getState(): EditState {
		return this.state;
	}

	setDraggingVertex(featureId: string, coordinatePath: number[], position: Position): void {
		this.state.draggingVertex = {
			featureId,
			coordinatePath,
			startPosition: position
		};
	}

	setDraggingFeature(featureId: string, startLngLat: Position, startGeometry: any): void {
		this.state.draggingFeature = {
			featureId,
			startLngLat,
			startGeometry
		};
	}

	setHoveredVertex(featureId: string, coordinatePath: number[]): void {
		this.state.hoveredVertex = {
			featureId,
			coordinatePath
		};
	}

	clearDragging(): void {
		this.state.draggingVertex = undefined;
		this.state.draggingFeature = undefined;
	}

	clearHovered(): void {
		this.state.hoveredVertex = undefined;
	}

	isDragging(): boolean {
		return !!(this.state.draggingVertex || this.state.draggingFeature);
	}

	// Extract vertices with their coordinate paths
	extractVerticesWithPaths(feature: EditorFeature): Array<{ position: Position; path: number[] }> {
		const vertices: Array<{ position: Position; path: number[] }> = [];

		if (feature.geometry.type === 'Point') {
			vertices.push({
				position: feature.geometry.coordinates as Position,
				path: []
			});
		} else if (feature.geometry.type === 'MultiPoint') {
			const coords = feature.geometry.coordinates as Position[];
			coords.forEach((coord, i) => {
				vertices.push({ position: coord, path: [i] });
			});
		} else if (feature.geometry.type === 'LineString') {
			const coords = feature.geometry.coordinates as Position[];
			coords.forEach((coord, i) => {
				vertices.push({ position: coord, path: [i] });
			});
		} else if (feature.geometry.type === 'MultiLineString') {
			const lines = feature.geometry.coordinates as Position[][];
			lines.forEach((line, lineIdx) => {
				line.forEach((coord, coordIdx) => {
					vertices.push({ position: coord, path: [lineIdx, coordIdx] });
				});
			});
		} else if (feature.geometry.type === 'Polygon') {
			const rings = feature.geometry.coordinates as Position[][];
			rings.forEach((ring, ringIdx) => {
				ring.forEach((coord, coordIdx) => {
					// Don't duplicate the last vertex (which is same as first in closed polygon)
					if (coordIdx < ring.length - 1) {
						vertices.push({ position: coord, path: [ringIdx, coordIdx] });
					}
				});
			});
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = feature.geometry.coordinates as Position[][][];
			polygons.forEach((polygon, polyIdx) => {
				polygon.forEach((ring, ringIdx) => {
					ring.forEach((coord, coordIdx) => {
						if (coordIdx < ring.length - 1) {
							vertices.push({
								position: coord,
								path: [polyIdx, ringIdx, coordIdx]
							});
						}
					});
				});
			});
		}

		return vertices;
	}

	// Extract midpoints between vertices
	extractMidpoints(feature: EditorFeature): Array<{ position: Position; path: number[] }> {
		const midpoints: Array<{ position: Position; path: number[] }> = [];

		if (feature.geometry.type === 'LineString') {
			const coords = feature.geometry.coordinates as Position[];
			for (let i = 0; i < coords.length - 1; i++) {
				const mid: Position = [(coords[i][0] + coords[i + 1][0]) / 2, (coords[i][1] + coords[i + 1][1]) / 2];
				midpoints.push({ position: mid, path: [i, i + 1] });
			}
		} else if (feature.geometry.type === 'MultiLineString') {
			const lines = feature.geometry.coordinates as Position[][];
			lines.forEach((line, lineIdx) => {
				for (let i = 0; i < line.length - 1; i++) {
					const mid: Position = [(line[i][0] + line[i + 1][0]) / 2, (line[i][1] + line[i + 1][1]) / 2];
					midpoints.push({ position: mid, path: [lineIdx, i, i + 1] });
				}
			});
		} else if (feature.geometry.type === 'Polygon') {
			const rings = feature.geometry.coordinates as Position[][];
			rings.forEach((ring, ringIdx) => {
				for (let i = 0; i < ring.length - 1; i++) {
					const mid: Position = [(ring[i][0] + ring[i + 1][0]) / 2, (ring[i][1] + ring[i + 1][1]) / 2];
					midpoints.push({ position: mid, path: [ringIdx, i, i + 1] });
				}
			});
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = feature.geometry.coordinates as Position[][][];
			polygons.forEach((polygon, polyIdx) => {
				polygon.forEach((ring, ringIdx) => {
					for (let i = 0; i < ring.length - 1; i++) {
						const mid: Position = [(ring[i][0] + ring[i + 1][0]) / 2, (ring[i][1] + ring[i + 1][1]) / 2];
						midpoints.push({
							position: mid,
							path: [polyIdx, ringIdx, i, i + 1]
						});
					}
				});
			});
		}

		return midpoints;
	}

	// Update vertex position in feature
	updateVertexPosition(feature: EditorFeature, path: number[], newPosition: Position): EditorFeature {
		const updatedFeature = JSON.parse(JSON.stringify(feature)) as EditorFeature;

		if (feature.geometry.type === 'Point') {
			updatedFeature.geometry.coordinates = newPosition;
		} else if (feature.geometry.type === 'MultiPoint') {
			const coords = updatedFeature.geometry.coordinates as Position[];
			coords[path[0]] = newPosition;
		} else if (feature.geometry.type === 'LineString') {
			const coords = updatedFeature.geometry.coordinates as Position[];
			coords[path[0]] = newPosition;
		} else if (feature.geometry.type === 'MultiLineString') {
			const lines = updatedFeature.geometry.coordinates as Position[][];
			lines[path[0]][path[1]] = newPosition;
		} else if (feature.geometry.type === 'Polygon') {
			const rings = updatedFeature.geometry.coordinates as Position[][];
			rings[path[0]][path[1]] = newPosition;

			// Update the closing vertex if we're editing the first vertex
			if (path[1] === 0) {
				rings[path[0]][rings[path[0]].length - 1] = newPosition;
			}
			// Update the first vertex if we're editing what would be the closing vertex
			if (path[1] === rings[path[0]].length - 2) {
				rings[path[0]][rings[path[0]].length - 1] = newPosition;
			}
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = updatedFeature.geometry.coordinates as Position[][][];
			const ring = polygons[path[0]][path[1]];
			ring[path[2]] = newPosition;
			if (path[2] === 0) {
				ring[ring.length - 1] = newPosition;
			}
			if (path[2] === ring.length - 2) {
				ring[ring.length - 1] = newPosition;
			}
		}

		return updatedFeature;
	}

	// Insert new vertex at midpoint
	insertVertex(feature: EditorFeature, path: number[], position: Position): EditorFeature {
		const updatedFeature = JSON.parse(JSON.stringify(feature)) as EditorFeature;

		if (feature.geometry.type === 'LineString') {
			// path is [beforeIndex, afterIndex]
			const coords = updatedFeature.geometry.coordinates as Position[];
			coords.splice(path[1], 0, position);
		} else if (feature.geometry.type === 'MultiLineString') {
			// path is [lineIdx, beforeIndex, afterIndex]
			const lines = updatedFeature.geometry.coordinates as Position[][];
			lines[path[0]].splice(path[2], 0, position);
		} else if (feature.geometry.type === 'Polygon') {
			// path is [ringIdx, beforeIndex, afterIndex]
			const rings = updatedFeature.geometry.coordinates as Position[][];
			rings[path[0]].splice(path[2], 0, position);
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = updatedFeature.geometry.coordinates as Position[][][];
			const ring = polygons[path[0]][path[1]];
			ring.splice(path[3], 0, position);
		}

		return updatedFeature;
	}

	// Remove vertex
	removeVertex(feature: EditorFeature, path: number[]): EditorFeature | null {
		const updatedFeature = JSON.parse(JSON.stringify(feature)) as EditorFeature;

		if (feature.geometry.type === 'Point') {
			return null; // Can't remove the only point
		} else if (feature.geometry.type === 'MultiPoint') {
			const coords = updatedFeature.geometry.coordinates as Position[];
			if (coords.length <= 1) return null;
			coords.splice(path[0], 1);
		} else if (feature.geometry.type === 'LineString') {
			const coords = updatedFeature.geometry.coordinates as Position[];
			if (coords.length <= 2) return null; // Need at least 2 points
			coords.splice(path[0], 1);
		} else if (feature.geometry.type === 'MultiLineString') {
			const lines = updatedFeature.geometry.coordinates as Position[][];
			if (lines[path[0]].length <= 2) return null;
			lines[path[0]].splice(path[1], 1);
		} else if (feature.geometry.type === 'Polygon') {
			const rings = updatedFeature.geometry.coordinates as Position[][];
			if (rings[path[0]].length <= 4) return null; // Need at least 3 unique points (4 including closing)
			rings[path[0]].splice(path[1], 1);

			// Update closing vertex
			rings[path[0]][rings[path[0]].length - 1] = rings[path[0]][0];
		} else if (feature.geometry.type === 'MultiPolygon') {
			const polygons = updatedFeature.geometry.coordinates as Position[][][];
			const ring = polygons[path[0]][path[1]];
			if (ring.length <= 4) return null;
			ring.splice(path[2], 1);
			ring[ring.length - 1] = ring[0];
		}

		return updatedFeature;
	}

	// Translate entire feature
	translateFeature(feature: EditorFeature, fromLngLat: Position, toLngLat: Position): EditorFeature {
		const deltaLng = toLngLat[0] - fromLngLat[0];
		const deltaLat = toLngLat[1] - fromLngLat[1];

		const updatedFeature = JSON.parse(JSON.stringify(feature)) as EditorFeature;

		const translatePosition = (pos: Position): Position => {
			return [pos[0] + deltaLng, pos[1] + deltaLat];
		};

		if (feature.geometry.type === 'Point') {
			updatedFeature.geometry.coordinates = translatePosition(feature.geometry.coordinates as Position);
		} else if (feature.geometry.type === 'LineString') {
			updatedFeature.geometry.coordinates = (feature.geometry.coordinates as Position[]).map(translatePosition);
		} else if (feature.geometry.type === 'Polygon') {
			updatedFeature.geometry.coordinates = (feature.geometry.coordinates as Position[][]).map((ring) =>
				ring.map(translatePosition)
			);
		}

		return updatedFeature;
	}
}
