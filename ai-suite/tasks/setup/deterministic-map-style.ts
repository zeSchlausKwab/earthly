import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const installDeterministicMapStyleTask: AiTaskMetadata = {
	id: 'setup.deterministic-map-style',
	summary:
		'Replace the live basemap with a local attributed fixture for deterministic map UI tests.',
	preconditions: ['Earthly is open', 'The development map handle is available'],
	sideEffects: ['Replaces the current page map style with an in-memory fixture'],
	viewports: 'both',
}

export async function installDeterministicMapStyle(earthly: EarthlySession): Promise<void> {
	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyUiMap?: unknown }).__earthlyUiMap),
			),
		)
		.toBe(true)
	await earthly.page.evaluate(() => {
		const map = (
			window as unknown as {
				__earthlyUiMap: { setStyle: (style: unknown) => void }
			}
		).__earthlyUiMap
		map.setStyle({
			version: 8,
			sources: {
				fixture: {
					type: 'geojson',
					data: {
						type: 'FeatureCollection',
						features: [
							{
								type: 'Feature',
								properties: {},
								geometry: { type: 'Point', coordinates: [0, 0] },
							},
						],
					},
					attribution: 'OpenFreeMap · OpenStreetMap',
				},
			},
			layers: [
				{ id: 'background', type: 'background', paint: { 'background-color': '#dcebf1' } },
				{ id: 'fixture', type: 'circle', source: 'fixture' },
			],
		})
	})
	await expect(earthly.page.locator('.maplibregl-ctrl-attrib').first()).toBeVisible()
}
