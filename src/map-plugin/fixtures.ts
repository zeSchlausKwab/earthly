import type { FeatureCollection } from 'geojson'

/** Public, fictional demonstration geometry. Never published by startup. */
export const DEMO_MAP: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'vienna',
			geometry: { type: 'Point', coordinates: [16.3738, 48.2082] },
			properties: {
				name: 'Vienna',
				color: '#b55d32',
				radius: 8,
				description: 'A starting point for an example journey.',
				source: 'https://www.openstreetmap.org',
			},
		},
		{
			type: 'Feature',
			id: 'journey',
			geometry: {
				type: 'LineString',
				coordinates: [
					[16.3738, 48.2082],
					[16.6, 48.12],
					[17.1077, 48.1486],
				],
			},
			properties: {
				name: 'Illustrative journey',
				strokeColor: '#55724d',
				strokeWidth: 4,
				description: 'Illustrative geometry, not navigation directions.',
			},
		},
		{
			type: 'Feature',
			id: 'area',
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[16.6, 48.03],
						[16.88, 48.03],
						[16.88, 48.16],
						[16.6, 48.16],
						[16.6, 48.03],
					],
				],
			},
			properties: {
				name: 'Example area',
				fillColor: '#d6aa3c',
				fillOpacity: 0.35,
				strokeColor: '#ad821f',
				'earthly:callouts': [
					{
						id: 'area-note',
						title: 'An area to explore',
						text: 'A fictional area illustrating polygon support.',
					},
				],
			},
		},
	],
}
