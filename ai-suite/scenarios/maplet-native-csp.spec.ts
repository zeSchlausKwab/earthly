import type { FeatureCollection } from 'geojson'
import { createLiveMapperWorkbenchHtml } from '../../src/features/maplets/workbench'
import { prepareBundledMaplet } from '../../src/lib/maplets/artifact'
import { createMapletSrcdoc } from '../../src/lib/maplets/runtime'
import { test, expect } from '../fixtures/earthly'

/** Browser contract for packaged CSP inheritance; this is not an Android WebView smoke. */
test('bundled Live Mapper imports under native CSP while its iframe stays isolated @regression', async ({
	page,
	baseURL,
}) => {
	const html = createLiveMapperWorkbenchHtml(
		{ type: 'FeatureCollection', features: [] },
		'https://example.invalid/feed',
		() => {
			throw new Error('This CSP fixture exercises the native GeoJSON importer only')
		},
	)
	const artifact = await prepareBundledMaplet({ id: 'live-mapper', html })
	const baseline = createMapletSrcdoc(artifact, ['map', 'config', 'identity', 'resource'])
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
	let srcdoc: string
	try {
		Object.defineProperty(globalThis, 'window', {
			configurable: true,
			value: { __TAURI_INTERNALS__: {} },
		})
		const host = {
			querySelector: (selector: string) => ({
				getAttribute: () => (selector.includes('script') ? '1234567' : '7654321'),
			}),
		} as unknown as Document
		srcdoc = createMapletSrcdoc(artifact, ['map', 'config', 'identity', 'resource'], host)
	} finally {
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
		else Reflect.deleteProperty(globalThis, 'window')
	}
	const ambientRequests: string[] = []
	await page.route('**/*', async (route) => {
		if (route.request().url().includes('/ambient-data')) {
			ambientRequests.push(route.request().url())
			await route.abort()
			return
		}
		await route.fulfill({
			status: 200,
			contentType: 'text/html',
			headers: {
				'Content-Security-Policy':
					"default-src 'none'; script-src 'self' 'nonce-1234567'; style-src 'self' 'nonce-7654321'; frame-src 'self'; connect-src http: https:;",
			},
			body: '<!doctype html><html><body></body></html>',
		})
	})
	await page.goto(`${baseURL}/maplet-native-csp-fixture`)
	await page.evaluate(
		(html) =>
			new Promise<void>((resolve) => {
				const frame = document.createElement('iframe')
				frame.title = 'Unadapted CSP fixture'
				frame.setAttribute('sandbox', 'allow-scripts')
				frame.addEventListener('load', () => resolve(), { once: true })
				frame.srcdoc = html
				document.body.append(frame)
			}),
		baseline,
	)
	await expect(
		page.frameLocator('iframe').getByRole('heading', { name: 'Live Mapper' }),
	).toHaveCount(0)
	await page.evaluate(
		(html) =>
			new Promise<void>((resolve) => {
				document.body.replaceChildren()
				const frame = document.createElement('iframe')
				frame.title = 'Native CSP Live Mapper'
				frame.setAttribute('sandbox', 'allow-scripts')
				frame.style.width = '100%'
				frame.style.height = '760px'
				frame.addEventListener('load', () => resolve(), { once: true })
				const state = {
					pubkey: null,
					collections: [],
					selectedCollectionId: null,
					subscriptions: [],
					visibility: {},
					renderCollection: { type: 'FeatureCollection', features: [] },
					warnings: [],
				}
				const recorded = {
					identityReads: 0,
					workspaceReads: 0,
					collection: null as FeatureCollection | null,
				}
				Object.assign(window, { __mapletCspFixture: recorded })
				window.addEventListener('message', (event) => {
					if (event.source !== frame.contentWindow) return
					const { type, id, action, collection } = event.data
					const respond = (data: object) => frame.contentWindow?.postMessage({ id, ...data }, '*')
					if (type === 'identity.getPublicKey') {
						recorded.identityReads++
						respond({ type: 'identity.getPublicKey.result', pubkey: '' })
					} else if (type === 'map.workspace' && action === 'state') {
						recorded.workspaceReads++
						respond({ type: 'map.workspace.result', value: state })
					} else if (type === 'map.replace') {
						recorded.collection = collection
						respond({ type: 'map.replace.result', ok: true })
					}
				})
				frame.srcdoc = html
				document.body.append(frame)
			}),
		srcdoc,
	)
	const frame = page.frameLocator('iframe[title="Native CSP Live Mapper"]')
	await expect(frame.getByRole('heading', { name: 'Live Mapper', exact: true })).toBeVisible()
	await expect(frame.getByRole('heading', { name: 'Live Mapper', exact: true })).toHaveCSS(
		'font-size',
		'25px',
	)
	await frame.getByRole('button', { name: 'Explore a JSON file', exact: true }).click()
	await frame.getByLabel('Choose JSON file', { exact: true }).setInputFiles({
		name: 'native-csp.geojson',
		mimeType: 'application/geo+json',
		buffer: Buffer.from(
			JSON.stringify({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						id: 'native-point',
						geometry: { type: 'Point', coordinates: [16, 48] },
						properties: { name: 'Native CSP import' },
					},
				],
			}),
		),
	})
	await frame.getByRole('button', { name: 'Preview geometry', exact: true }).click()
	await expect(frame.getByText('Native CSP import', { exact: true })).toBeVisible()
	const recorded = await page.evaluate(
		() =>
			(
				window as unknown as {
					__mapletCspFixture: {
						identityReads: number
						workspaceReads: number
						collection: FeatureCollection
					}
				}
			).__mapletCspFixture,
	)
	expect(recorded.identityReads).toBe(1)
	expect(recorded.workspaceReads).toBe(1)
	expect(recorded.collection.features).toHaveLength(1)
	expect(recorded.collection.features[0]?.geometry).toEqual({
		type: 'Point',
		coordinates: [16, 48],
	})
	const child = page.frames().find((candidate) => candidate.parentFrame())
	if (!child) throw new Error('The native CSP fixture iframe did not load')
	const boundary = await child.evaluate(async (url) => {
		let hostStorage = 'accessible'
		try {
			parent.localStorage.getItem('fixture')
		} catch (error) {
			hostStorage = (error as Error).name
		}
		let ambientFetch = 'allowed'
		try {
			await fetch(url)
		} catch (error) {
			ambientFetch = (error as Error).name
		}
		return { hostStorage, ambientFetch }
	}, `${baseURL}/ambient-data`)
	expect(boundary).toEqual({ hostStorage: 'SecurityError', ambientFetch: 'TypeError' })
	expect(ambientRequests).toEqual([])
})
