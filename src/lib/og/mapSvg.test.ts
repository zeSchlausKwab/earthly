import { describe, expect, test } from 'bun:test'
import type { FeatureCollection } from 'geojson'
import { renderOGMapSvg } from './mapSvg'

const featureCollection: FeatureCollection = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			properties: {
				name: 'Port & terminal',
				color: '#1677aa',
				displayIcon: 'lucide:anchor',
			},
			geometry: { type: 'Point', coordinates: [56.2, 25.3] },
		},
		{
			type: 'Feature',
			properties: {
				label: 'Shipping lane',
				color: '#d85a35',
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

describe('renderOGMapSvg', () => {
	test('renders authored GeoJSON styles, icons, labels, and arrow properties', async () => {
		const svg = await renderOGMapSvg({ featureCollection })

		expect(svg).toContain('data-og-map="true"')
		expect(svg).toContain('data-og-feature="point"')
		expect(svg).toContain('data-og-feature="line"')
		expect(svg).toContain('stroke-dasharray="8 4"')
		expect(svg).toContain('data-og-arrow="end"')
		expect(svg).toContain('Port &amp; terminal')
		expect(svg).toContain('M12 6v16')
	})

	test('renders a meaningful extent when only bbox metadata is available', async () => {
		const svg = await renderOGMapSvg({ bbox: [-9.6, 36.8, -6.0, 42.2] })
		expect(svg).toContain('data-og-feature="extent"')
		expect(svg).toContain('data-og-world="land"')
		// Resvg drops the Natural Earth paths when this group-level clip is
		// combined with country paths extending outside the viewport. The root SVG
		// already clips to 1200x630, so the extra clip must stay absent.
		expect(svg).not.toContain('clip-path="url(#map-frame)"')
	})

	test('does not interpolate hostile style values into SVG attributes', async () => {
		const hostile: FeatureCollection = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {
						color: 'red" onload="alert(1)',
						label: '<script>alert(1)</script>',
					},
					geometry: { type: 'Point', coordinates: [0, 0] },
				},
			],
		}
		const svg = await renderOGMapSvg({ featureCollection: hostile })
		expect(svg).not.toContain('onload=')
		expect(svg).not.toContain('<script>')
		expect(svg).toContain('&lt;script&gt;')
	})
})
