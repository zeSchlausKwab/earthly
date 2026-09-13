import { describe, expect, test } from 'bun:test'
import { parseHTML } from 'linkedom'
import { renderToStaticMarkup } from 'react-dom/server'
import { MapletsPanel, type MapletInstanceView, type MapletsPanelProps } from './MapletsPanel'

const instance: MapletInstanceView = {
	id: 'live-mapper:one',
	definitionId: 'live-mapper',
	title: 'Live Mapper',
	status: 'ready',
	warnings: [],
	visible: true,
	config: { source: 'sample', refreshSeconds: 120, includeLines: false },
	collection: {
		type: 'FeatureCollection',
		features: [
			{
				id: 'area:1',
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [44, 15] },
				properties: { name: 'Source area' },
			},
		],
	},
}

function render(overrides: Partial<MapletsPanelProps> = {}) {
	return parseHTML(
		renderToStaticMarkup(
			<MapletsPanel
				catalog={[
					{
						id: 'live-mapper',
						title: 'Live Mapper',
						description: 'Yemen area overlays from Liveuamap.',
						source: 'bundled',
					},
				]}
				instances={[instance]}
				onAdd={() => {}}
				onRemove={() => {}}
				onToggleVisibility={() => {}}
				onRefresh={() => {}}
				onConfigure={() => {}}
				onCopy={() => {}}
				onFit={() => {}}
				onDiscover={() => {}}
				{...overrides}
			/>,
		),
	).document
}

describe('Maplets panel source and copy affordances', () => {
	test('clearly identifies captured data and requires geometry selection before copying', () => {
		const document = render()
		expect(document.querySelector('[role="status"]')?.textContent).toContain('Captured sample')
		expect(document.querySelector('[role="status"]')?.textContent).not.toContain('Live source')
		expect(document.querySelector('input[aria-label="Select Source area"]')).not.toBeNull()
		const copy = Array.from(document.querySelectorAll('button')).find((button) =>
			button.textContent?.includes('Copy selected to editor'),
		)
		expect(copy?.hasAttribute('disabled')).toBe(true)
		expect(
			document
				.querySelector('button[aria-label="Add Live Mapper to map"]')
				?.hasAttribute('disabled'),
		).toBe(true)
	})

	test('keeps the previous geometry available when a live source is challenged', () => {
		const document = render({
			instances: [
				{
					...instance,
					config: { source: 'live' },
					status: 'stale',
					error: 'Liveuamap requires a browser verification.',
				},
			],
		})
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'Liveuamap requires a browser verification.',
		)
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'Your last result is still on the map.',
		)
		expect(document.querySelector('[role="status"]')?.textContent).toContain('Last saved result')
		expect(document.querySelector('input[aria-label="Select Source area"]')).not.toBeNull()
	})

	test('renders foreign metadata as text and does not claim every ready layer is live', () => {
		const document = render({
			instances: [{ ...instance, config: {}, error: '<img src=x onerror=alert(1)>' }],
		})
		expect(document.querySelector('[role="status"]')?.textContent).toContain('Layer ready')
		expect(document.querySelector('[role="alert"] img')).toBeNull()
		expect(document.querySelector('[role="alert"]')?.textContent).toContain(
			'<img src=x onerror=alert(1)>',
		)
	})

	test('keeps sample provenance when a requested live refresh fails', () => {
		const document = render({
			instances: [
				{ ...instance, config: { source: 'live' }, outputSource: 'sample', status: 'stale' },
			],
		})
		expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain(
			'This is the captured sample. A live result has not arrived yet.',
		)
		expect(document.querySelector('[role="status"]')?.textContent).not.toContain('Live source')
	})

	test('separates published data discovery from Maplet apps and explains the relay scope', () => {
		const document = render({
			instances: [],
			onFollowCollection: async () => {},
			collectionDiscoveryEnabled: false,
		})
		const text = document.querySelector('[role="tabpanel"]')?.textContent ?? ''
		expect(text.indexOf('Published collections')).toBeLessThan(text.indexOf('Maplet apps'))
		expect(text).toContain('configured relays')
		expect(text).toContain('Earthly app')
		expect(text).not.toContain('Earthly collection')
		expect(document.querySelector('input[type="search"]')).not.toBeNull()
	})

	test('native mode keeps bundled Maplets and collection discovery available while disabling third-party apps', () => {
		const previous = Object.getOwnPropertyDescriptor(globalThis, 'isTauri')
		Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true })
		try {
			const document = render({
				instances: [],
				catalog: [
					{
						id: 'live-mapper',
						title: 'Live Mapper',
						description: 'Collection workspace.',
						source: 'bundled',
					},
					{ id: 'foreign', title: 'Foreign app', description: 'A published app.', source: 'nostr' },
				],
				onFollowCollection: async () => {},
				collectionDiscoveryEnabled: false,
			})
			expect(
				document
					.querySelector('button[aria-label="Add Live Mapper to map"]')
					?.hasAttribute('disabled'),
			).toBe(false)
			expect(
				document
					.querySelector('button[aria-label="Add Foreign app to map"]')
					?.hasAttribute('disabled'),
			).toBe(true)
			expect(document.querySelector('section[aria-label="Published collections"]')).not.toBeNull()
			expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain(
				'Third-party Maplet apps are currently available in the web app.',
			)
		} finally {
			if (previous) Object.defineProperty(globalThis, 'isTauri', previous)
			else Reflect.deleteProperty(globalThis, 'isTauri')
		}
	})
})
