import * as turf from '@turf/turf';
import type { Position } from 'geojson';
import type { Map } from 'maplibre-gl';
import type { EditorFeature, IManager, TransformOptions } from '../types';
import { rotateGeometry, splitLineAtPoint } from '../utils/geometry';

export class TransformManager implements IManager {
	private map?: Map;

	onAdd(map: Map): void {
		this.map = map;
	}

	onRemove(): void {
		this.map = undefined;
	}

	rotate(feature: EditorFeature, options: TransformOptions): EditorFeature {
		if (!options.angle) return feature;

		const rotated = rotateGeometry(feature, options.center, options.angle);

		return {
			...feature,
			geometry: rotated.geometry
		};
	}

	rotateMultiple(features: EditorFeature[], options: TransformOptions): EditorFeature[] {
		return features.map((feature) => this.rotate(feature, options));
	}

	scale(feature: EditorFeature, options: TransformOptions): EditorFeature {
		if (!options.scale || options.scale === 1) return feature;

		const scaled = turf.transformScale(feature, options.scale, {
			origin: options.center
		});

		return {
			...feature,
			geometry: scaled.geometry
		};
	}

	scaleMultiple(features: EditorFeature[], options: TransformOptions): EditorFeature[] {
		return features.map((feature) => this.scale(feature, options));
	}

	translate(feature: EditorFeature, distance: number, direction: number): EditorFeature {
		const translated = turf.transformTranslate(feature, distance, direction, {
			units: 'meters'
		});

		return {
			...feature,
			geometry: translated.geometry
		};
	}

	move(feature: EditorFeature, fromPoint: Position, toPoint: Position): EditorFeature {
		const from = turf.point(fromPoint);
		const to = turf.point(toPoint);
		const distance = turf.distance(from, to, { units: 'meters' });
		const bearing = turf.bearing(from, to);

		return this.translate(feature, distance, bearing);
	}

	splitLine(feature: EditorFeature, splitPoint: Position): [EditorFeature, EditorFeature] | null {
		if (feature.geometry.type !== 'LineString') {
			return null;
		}

		const coords = feature.geometry.coordinates as Position[];
		const [firstHalf, secondHalf] = splitLineAtPoint(coords, splitPoint);

		const feature1: EditorFeature = {
			...feature,
			id: `${feature.id}_split_1`,
			geometry: {
				type: 'LineString',
				coordinates: firstHalf
			}
		};

		const feature2: EditorFeature = {
			...feature,
			id: `${feature.id}_split_2`,
			geometry: {
				type: 'LineString',
				coordinates: secondHalf
			}
		};

		return [feature1, feature2];
	}

	union(features: EditorFeature[]): EditorFeature | null {
		if (features.length < 2) return null;

		try {
			let result = features[0];

			for (let i = 1; i < features.length; i++) {
				const unioned = turf.union(turf.featureCollection([result, features[i]]));
				if (unioned) {
					result = {
						...result,
						geometry: unioned.geometry
					};
				}
			}

			return result;
		} catch (error) {
			console.error('Union failed:', error);
			return null;
		}
	}

	difference(feature1: EditorFeature, feature2: EditorFeature): EditorFeature | null {
		try {
			const diff = turf.difference(turf.featureCollection([feature1, feature2]));
			if (!diff) return null;

			return {
				...feature1,
				geometry: diff.geometry
			};
		} catch (error) {
			console.error('Difference failed:', error);
			return null;
		}
	}

	buffer(feature: EditorFeature, radius: number, units: 'meters' | 'kilometers' = 'meters'): EditorFeature {
		const buffered = turf.buffer(feature, radius, { units });

		return {
			...feature,
			geometry: buffered!.geometry
		};
	}

	simplify(feature: EditorFeature, tolerance: number = 0.01): EditorFeature {
		const simplified = turf.simplify(feature, { tolerance, highQuality: true });

		return {
			...feature,
			geometry: simplified.geometry
		};
	}
}
