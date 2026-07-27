import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { generateOGImagePNG } from './renderImage'

describe('generateOGImagePNG', () => {
	test('rasterizes a map with labels, an icon, dashes, and an arrowhead', async () => {
		const featureCollection: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						name: 'Port',
						displayIcon: 'lucide:anchor',
						color: '#1677aa',
					},
					geometry: { type: 'Point', coordinates: [56.2, 25.3] },
				},
				{
					type: 'Feature',
					properties: {
						name: 'Shipping lane',
						lineDash: [8, 4],
						arrowEnd: true,
					},
					geometry: {
						type: 'LineString',
						coordinates: [
							[56.2, 25.3],
							[60, 23],
						],
					},
				},
			],
		}

		const png = await generateOGImagePNG({
			title: 'Persian Gulf shipping',
			description: 'Ports and global lanes',
			featureCollection,
		})

		expect(png).not.toBeNull()
		expect(Array.from(png?.slice(0, 8) ?? [])).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
		expect(png?.byteLength ?? 0).toBeGreaterThan(10_000)
	})
})
