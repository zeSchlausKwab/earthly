import type { Position } from 'geojson';
import type { Map, MapMouseEvent } from 'maplibre-gl';
import type { DrawFeatureType, EditorFeature } from '../types';
import { generateId } from '../utils/geometry';

export abstract class DrawMode {
	protected map?: Map;
	protected currentFeature?: EditorFeature;
	protected coordinates: Position[] = [];

	abstract readonly type: DrawFeatureType;

	onAdd(map: Map): void {
		this.map = map;
	}

	onRemove(): void {
		this.reset();
	}

	abstract onClick(e: MapMouseEvent): EditorFeature | null;
	abstract onMove(e: MapMouseEvent): void;
	abstract onKeyDown(e: KeyboardEvent): EditorFeature | null;

	reset(): void {
		this.currentFeature = undefined;
		this.coordinates = [];
	}

	getCurrentFeature(): EditorFeature | undefined {
		return this.currentFeature;
	}

	getCoordinates(): Position[] {
		return [...this.coordinates];
	}
}

export class DrawPointMode extends DrawMode {
	readonly type: DrawFeatureType = 'Point';

	onClick(e: MapMouseEvent): EditorFeature | null {
		const lngLat = e.lngLat;
		const feature: EditorFeature = {
			type: 'Feature',
			id: generateId(),
			geometry: {
				type: 'Point',
				coordinates: [lngLat.lng, lngLat.lat]
			},
			properties: {
				meta: 'feature'
			}
		};

		this.reset();
		return feature;
	}

	onMove(e: MapMouseEvent): void {
		// Point mode doesn't need move handling
	}

	onKeyDown(e: KeyboardEvent): EditorFeature | null {
		if (e.key === 'Escape') {
			this.reset();
		}
		return null;
	}
}

export class DrawLineStringMode extends DrawMode {
	readonly type: DrawFeatureType = 'LineString';

	onClick(e: MapMouseEvent): EditorFeature | null {
		const lngLat = e.lngLat;
		const point: Position = [lngLat.lng, lngLat.lat];

		this.coordinates.push(point);

		if (this.coordinates.length >= 2) {
			this.currentFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: 'LineString',
					coordinates: [...this.coordinates]
				},
				properties: {
					meta: 'feature-temp'
				}
			};
		}

		return null; // Return null until finished
	}

	onMove(e: MapMouseEvent): void {
		if (this.coordinates.length > 0) {
			const lngLat = e.lngLat;
			const tempCoords = [...this.coordinates, [lngLat.lng, lngLat.lat]];

			this.currentFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: 'LineString',
					coordinates: tempCoords
				},
				properties: {
					meta: 'feature-temp'
				}
			};
		}
	}

	onKeyDown(e: KeyboardEvent): EditorFeature | null {
		if (e.key === 'Enter' && this.coordinates.length >= 2) {
			const feature: EditorFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: 'LineString',
					coordinates: [...this.coordinates]
				},
				properties: {
					meta: 'feature'
				}
			};
			this.reset();
			return feature;
		}

		if (e.key === 'Escape') {
			this.reset();
		}

		if (e.key === 'Backspace' && this.coordinates.length > 0) {
			this.coordinates.pop();
			if (this.coordinates.length >= 2) {
				this.currentFeature = {
					type: 'Feature',
					id: this.currentFeature?.id || generateId(),
					geometry: {
						type: 'LineString',
						coordinates: [...this.coordinates]
					},
					properties: {
						meta: 'feature-temp'
					}
				};
			} else {
				this.currentFeature = undefined;
			}
		}

		return null;
	}
}

export class DrawPolygonMode extends DrawMode {
	readonly type: DrawFeatureType = 'Polygon';

	onClick(e: MapMouseEvent): EditorFeature | null {
		const lngLat = e.lngLat;
		const point: Position = [lngLat.lng, lngLat.lat];

		// Check if clicking on first point to close polygon
		if (this.coordinates.length >= 3) {
			const firstPoint = this.coordinates[0];
			const clickedPoint = point;
			const distance = Math.sqrt((firstPoint[0] - clickedPoint[0]) ** 2 + (firstPoint[1] - clickedPoint[1]) ** 2);

			// If close to first point, finish polygon
			if (distance < 0.0001) {
				const closedCoords = [...this.coordinates, this.coordinates[0]];
				const feature: EditorFeature = {
					type: 'Feature',
					id: this.currentFeature?.id || generateId(),
					geometry: {
						type: 'Polygon',
						coordinates: [closedCoords]
					},
					properties: {
						meta: 'feature'
					}
				};
				this.reset();
				return feature;
			}
		}

		this.coordinates.push(point);

		if (this.coordinates.length >= 2) {
			this.currentFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: 'Polygon',
					coordinates: [[...this.coordinates, this.coordinates[0]]]
				},
				properties: {
					meta: 'feature-temp'
				}
			};
		}

		return null;
	}

	onMove(e: MapMouseEvent): void {
		if (this.coordinates.length >= 1) {
			const lngLat = e.lngLat;
			const tempCoords = [...this.coordinates, [lngLat.lng, lngLat.lat]];

			// Close the polygon for preview if we have at least 2 points
			if (this.coordinates.length >= 2) {
				tempCoords.push(this.coordinates[0]);
			}

			this.currentFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: this.coordinates.length >= 2 ? 'Polygon' : 'LineString',
					coordinates: this.coordinates.length >= 2 ? [tempCoords] : tempCoords
				} as any,
				properties: {
					meta: 'feature-temp'
				}
			};
		}
	}

	onKeyDown(e: KeyboardEvent): EditorFeature | null {
		if (e.key === 'Enter' && this.coordinates.length >= 3) {
			const closedCoords = [...this.coordinates, this.coordinates[0]];
			const feature: EditorFeature = {
				type: 'Feature',
				id: this.currentFeature?.id || generateId(),
				geometry: {
					type: 'Polygon',
					coordinates: [closedCoords]
				},
				properties: {
					meta: 'feature'
				}
			};
			this.reset();
			return feature;
		}

		if (e.key === 'Escape') {
			this.reset();
		}

		if (e.key === 'Backspace' && this.coordinates.length > 0) {
			this.coordinates.pop();
			if (this.coordinates.length >= 3) {
				this.currentFeature = {
					type: 'Feature',
					id: this.currentFeature?.id || generateId(),
					geometry: {
						type: 'Polygon',
						coordinates: [[...this.coordinates, this.coordinates[0]]]
					},
					properties: {
						meta: 'feature',
						active: true
					}
				};
			} else {
				this.currentFeature = undefined;
			}
		}

		return null;
	}
}
