import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { FeatureCollection } from 'geojson'
import { parseHTML } from 'linkedom'
import { LIVE_MAPPER_HTML, LIVE_MAPPER_SOURCE_URL, mapLiveuamapPayload } from './liveMapper'
import sample from './live-mapper/liveuamap-yemen.sample.json'
import { MAPLET_FEED_SOURCE_URL } from '../../../contextvm/tools/maplet-feed'

describe('Live Mapper adapter', () => {
	test('keeps the sandbox source URL identical to the reviewed backend endpoint', () => {
		expect(LIVE_MAPPER_SOURCE_URL).toBe(MAPLET_FEED_SOURCE_URL)
	})
	test('maps the supplied capture into four polygonal features and six diagnosed lines', () => {
		const before = JSON.stringify(sample)
		const { featureCollection, warnings } = mapLiveuamapPayload(sample, { source: 'sample' })
		expect(
			featureCollection.features.filter((feature) => feature.geometry.type === 'LineString'),
		).toHaveLength(6)
		expect(
			featureCollection.features.filter(
				(feature) =>
					feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon',
			),
		).toHaveLength(4)
		expect(new Set(featureCollection.features.map((feature) => feature.id)).size).toBe(10)
		expect(warnings.join(' ')).toContain('capture time is unavailable')
		expect(warnings.join(' ')).toContain('holes are not inferred')
		expect(JSON.stringify(sample)).toBe(before)
		const first = featureCollection.features.find(
			(feature) => feature.id === 'liveuamap-yemen:21703081:line:0',
		)
		expect(first?.geometry).toEqual({
			type: 'LineString',
			coordinates: [
				[45.07038, 12.83423],
				[45.07055, 12.84461],
			],
		})
		expect(first?.properties).toMatchObject({
			source: 'Liveuamap',
			sourceMode: 'sample',
			sourceCapturedAt: null,
			strokeWidth: 2,
			strokeOpacity: 0,
			fillColor: '#00FF00',
		})
	})

	test('line configuration changes geometry inclusion without changing polygon IDs', () => {
		const withLines = mapLiveuamapPayload(sample, { source: 'sample', includeLines: true })
		const withoutLines = mapLiveuamapPayload(sample, { source: 'sample', includeLines: false })
		expect(withoutLines.featureCollection.features).toHaveLength(4)
		expect(withoutLines.featureCollection.features.map((feature) => feature.id)).toEqual(
			withLines.featureCollection.features
				.filter((feature) => feature.geometry.type !== 'LineString')
				.map((feature) => feature.id),
		)
		expect(withoutLines.warnings.join(' ')).toContain('two-point path omitted')
	})

	test('maps mixed type-6 areas and type-14 object-coordinate lines without closing or reordering lines', () => {
		const payload = {
			area: { id: 'area', type_id: 6, points: [[33, 35, 34, 35, 33, 36]] },
			line: {
				id: 'line',
				type_id: 14,
				name: 'Boundary',
				description: 'An imported line',
				strokeweight: '4.00',
				strokeopacity: '0.80',
				strokecolor: '#FFFF00',
				symbolpath: 'FORWARD_CLOSED_ARROW',
				points: [
					{ id: 9, lat: 33.17, lng: 35.19 },
					{ lat: 33.18, lng: 35.2 },
					{ id: 0, lat: 33.16, lng: 35.21 },
				],
			},
		}
		const before = JSON.stringify(payload)
		const mapped = mapLiveuamapPayload(payload, {
			source: 'live',
			sourceUrl: 'https://example.test/capture',
		})
		expect(mapped.featureCollection.features.map((feature) => feature.geometry.type)).toEqual([
			'Polygon',
			'LineString',
		])
		const line = mapped.featureCollection.features[1]
		expect(line?.geometry).toEqual({
			type: 'LineString',
			coordinates: [
				[35.19, 33.17],
				[35.2, 33.18],
				[35.21, 33.16],
			],
		})
		expect(line?.properties).toMatchObject({
			name: 'Boundary',
			description: 'An imported line',
			strokeColor: '#FFFF00',
			strokeWidth: 4,
			strokeOpacity: 0.8,
			sourceTypeId: 14,
			sourceId: 'line',
			sourceUrl: 'https://example.test/capture',
			sourceSymbolPath: 'FORWARD_CLOSED_ARROW',
		})
		expect(line?.properties?.ringInterpretation).toBeUndefined()
		expect(JSON.stringify(payload)).toBe(before)
		const withoutLines = mapLiveuamapPayload(payload, { source: 'sample', includeLines: false })
		expect(withoutLines.featureCollection.features).toHaveLength(1)
		expect(withoutLines.featureCollection.features[0]?.id).toBe('liveuamap-yemen:area:polygon')
		expect(withoutLines.warnings.join(' ')).toContain('type-14 line omitted')
	})

	test('preserves explicit zero line styling and a closed line while removing adjacent duplicates', () => {
		const payload = {
			line: {
				id: 'closed',
				type_id: 14,
				strokeopacity: '0.00',
				strokeweight: '0.00',
				points: [
					{ lat: 33, lng: 35 },
					{ lat: 33, lng: 35 },
					{ lat: 34, lng: 36 },
					{ lat: 35, lng: 35 },
					{ lat: 33, lng: 35 },
				],
			},
		}
		const mapped = mapLiveuamapPayload(payload, { source: 'sample' })
		expect(mapped.featureCollection.features[0]?.geometry).toEqual({
			type: 'LineString',
			coordinates: [
				[35, 33],
				[36, 34],
				[35, 35],
				[35, 33],
			],
		})
		expect(mapped.featureCollection.features[0]?.properties).toMatchObject({
			strokeWidth: 0,
			strokeOpacity: 0,
		})
		expect(
			mapLiveuamapPayload(payload, { source: 'sample', includeLines: false }).featureCollection
				.features,
		).toEqual([])
	})

	test('rejects invalid type-14 paths as complete lines without joining across bad points', () => {
		const invalidPaths = [
			[
				{ lat: 33, lng: 35 },
				{ lat: 91, lng: 36 },
				{ lat: 34, lng: 37 },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: 34, lng: 181 },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: '34', lng: 36 },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: 34, lng: Number.NaN },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: 34, lng: Number.POSITIVE_INFINITY },
			],
			[
				{ lat: 33, lng: 35 },
				{ lat: 34, lon: 36 },
			],
			[[33, 35, 34, 36]],
			[
				{ lat: 33, lng: 35 },
				{ lat: 33, lng: 35 },
			],
		]
		for (const points of invalidPaths) {
			const mapped = mapLiveuamapPayload(
				{
					bad: { id: 'bad', type_id: 14, points },
					good: { id: 'good', type_id: 6, points: [[0, 0, 1, 0, 0, 1]] },
				},
				{ source: 'sample' },
			)
			expect(mapped.featureCollection.features).toHaveLength(1)
			expect(mapped.featureCollection.features[0]?.properties?.sourceId).toBe('good')
			expect(mapped.warnings.join(' ')).toContain('type-14 line')
		}
	})

	test('does not reinterpret explicitly unsupported source types as polygons', () => {
		const mapped = mapLiveuamapPayload(
			{
				unknown: { id: 'unknown', type_id: 99, points: [[33, 35, 34, 35, 33, 36]] },
				good: { id: 'good', type_id: 6, points: [[33, 35, 34, 35, 33, 36]] },
			},
			{ source: 'sample' },
		)
		expect(mapped.featureCollection.features).toHaveLength(1)
		expect(mapped.featureCollection.features[0]?.properties?.sourceId).toBe('good')
		expect(mapped.warnings.join(' ')).toContain('unsupported source type 99')
	})

	test('closes and orients polygons, retains source provenance, and bounds source styles', () => {
		const mapped = mapLiveuamapPayload(
			{
				a: {
					id: 'a',
					name: 'Area',
					points: [[0, 0, 1, 0, 0, 1]],
					fillopacity: '9',
					strokeweight: '-1',
					strokecolor: 'url(evil)',
				},
			},
			{ source: 'live', fetchedAt: '2026-09-13T12:00:00.000Z' },
		)
		const feature = mapped.featureCollection.features[0]
		if (!feature) throw new Error('Expected mapped feature')
		expect(feature.geometry.type).toBe('Polygon')
		if (feature.geometry.type !== 'Polygon') throw new Error('Expected polygon')
		expect(feature.geometry.coordinates[0]).toEqual([
			[0, 0],
			[1, 0],
			[0, 1],
			[0, 0],
		])
		expect(feature.properties).toMatchObject({
			fillOpacity: 1,
			strokeWidth: 0,
			strokeColor: '#64748b',
			sourceFetchedAt: '2026-09-13T12:00:00.000Z',
			sourceTimeVerified: false,
		})
		expect(mapped.warnings.join(' ')).toContain(
			'Retrieval time does not establish dataset freshness',
		)
	})

	test('diagnoses malformed paths without dropping valid records', () => {
		const mapped = mapLiveuamapPayload(
			{
				bad: {
					id: 'bad',
					points: [
						[91, 0, 0, 0],
						[1, 2, 3],
					],
				},
				good: { id: 'good', points: [[0, 0, 1, 1]] },
			},
			{ source: 'sample' },
		)
		expect(mapped.featureCollection.features).toHaveLength(1)
		expect(mapped.warnings.join(' ')).toContain('outside WGS84')
		expect(mapped.warnings.join(' ')).toContain('invalid flat')
	})

	test('fails clearly on format changes and duplicate source identities', () => {
		expect(() => mapLiveuamapPayload({ error: 'challenge' }, { source: 'live' })).toThrow(
			'no records with points',
		)
		expect(() =>
			mapLiveuamapPayload(
				{ a: { id: 1, points: [] }, b: { id: 1, points: [] } },
				{ source: 'live' },
			),
		).toThrow('duplicate source id')
		expect(() => mapLiveuamapPayload([], { source: 'sample' })).toThrow('keyed Liveuamap')
		expect(() =>
			mapLiveuamapPayload({ a: { points: [] } }, { source: 'live', includeLines: false }),
		).toThrow('valid source geometry')
	})
})

describe('Live Mapper standalone Napplet program', () => {
	async function mount(html = LIVE_MAPPER_HTML) {
		const { window, document } = parseHTML(html)
		const replacements: FeatureCollection[] = []
		const resources: string[] = []
		const actions: string[] = []
		const heights: number[] = []
		const state = {
			pubkey: null,
			collections: [],
			selectedCollectionId: null,
			subscriptions: [],
			visibility: {},
			renderCollection: { type: 'FeatureCollection', features: [] },
			warnings: [],
		}
		Object.assign(window, {
			napplet: {
				identity: { getPublicKey: async () => '', onChanged: () => ({ close() {} }) },
				resource: {
					bytes: async (url: string) => {
						resources.push(url)
						throw new Error(
							'The source returned a Cloudflare challenge. Import a JSON file or paste its response.',
						)
					},
				},
				map: {
					replace: async (collection: FeatureCollection) => {
						replacements.push(JSON.parse(JSON.stringify(collection)) as FeatureCollection)
					},
					workspace: async (action: string) => {
						actions.push(action)
						return state
					},
					onWorkspaceChanged: () => ({ close() {} }),
					resize: (height: number) => heights.push(height),
				},
			},
		})
		const waitFor = (condition: () => boolean) =>
			new Promise<void>((resolve, reject) => {
				const observer = new window.MutationObserver(() => check())
				const timer = setTimeout(() => {
					observer.disconnect()
					reject(
						new Error(
							`Workbench did not reach expected state: ${document.getElementById('workbench')?.textContent?.slice(0, 1200)}`,
						),
					)
				}, 2000)
				const check = () => {
					if (condition()) {
						clearTimeout(timer)
						observer.disconnect()
						resolve()
					}
				}
				observer.observe(document.documentElement, {
					childList: true,
					subtree: true,
					attributes: true,
				})
				check()
			})
		const click = (action: string) => {
			const control = document.querySelector<HTMLButtonElement>(`button[data-action="${action}"]`)
			if (!control || control.disabled) throw new Error(`Unavailable workbench action: ${action}`)
			control.click()
		}
		runInNewContext(
			document.querySelector('script')?.textContent ?? 'throw new Error("Missing script")',
			{
				window,
				document,
				URL,
				TextEncoder,
				TextDecoder,
				crypto: globalThis.crypto,
				structuredClone,
				queueMicrotask,
				setTimeout,
				clearTimeout,
				ResizeObserver: class {
					observe() {}
					disconnect() {}
					unobserve() {}
				},
				requestAnimationFrame: (callback: () => void) => {
					queueMicrotask(callback)
					return 0
				},
			},
		)
		await waitFor(() => replacements.length > 0)
		return { window, document, replacements, resources, actions, heights, waitFor, click }
	}
	async function samplePreview(html = LIVE_MAPPER_HTML) {
		const app = await mount(html)
		app.click('open-import')
		app.click('sample')
		await app.waitFor(
			() =>
				!!app.document.querySelector<HTMLButtonElement>('[data-action="preview"]') &&
				!app.document.querySelector<HTMLButtonElement>('[data-action="preview"]')?.disabled,
		)
		app.click('preview')
		await app.waitFor(
			() =>
				app.replacements.at(-1)?.features.length === 10 &&
				!app.document.querySelector<HTMLButtonElement>('[data-action="connector"]')?.disabled,
		)
		return app
	}
	test('uses its embedded importer for samples and pasted GeoJSON without host conversion', async () => {
		const app = await samplePreview()
		expect(
			app.replacements
				.at(-1)
				?.features.every((feature) => feature.properties?.sourceMode === 'imported'),
		).toBe(true)
		expect(app.resources).toEqual([])
		expect(app.actions).toEqual(['state'])
		const input = app.document.querySelector<HTMLTextAreaElement>('#json-paste')
		if (!input) throw new Error('Missing native paste input')
		input.value = JSON.stringify({
			type: 'Feature',
			id: 'pasted-point',
			properties: { name: 'User supplied point' },
			geometry: { type: 'Point', coordinates: [16, 48] },
		})
		input.dispatchEvent(new app.window.Event('input', { bubbles: true }))
		app.click('analyze-paste')
		await app.waitFor(
			() =>
				app.document.body.textContent?.includes('Pasted response.json') === true &&
				!app.document.querySelector<HTMLButtonElement>('[data-action="preview"]')?.disabled,
		)
		app.click('preview')
		await app.waitFor(() => app.replacements.at(-1)?.features[0]?.id === 'pasted-point')
		expect(app.replacements.at(-1)?.features[0]?.geometry).toEqual({
			type: 'Point',
			coordinates: [16, 48],
		})
		expect(app.actions).toEqual(['state'])
		expect(app.resources).toEqual([])
		expect(app.heights.length).toBeGreaterThan(0)
	})
	test('keeps the previous preview when the approved source fails and shows an import fallback', async () => {
		const app = await samplePreview()
		const preview = app.replacements.at(-1)
		const replacementCount = app.replacements.length
		app.click('connector')
		await app.waitFor(
			() =>
				app.document
					.querySelector('[role="alert"]')
					?.textContent?.includes('Cloudflare challenge') === true,
		)
		expect(app.resources).toEqual([LIVE_MAPPER_SOURCE_URL])
		expect(app.replacements).toHaveLength(replacementCount)
		expect(app.replacements.at(-1)).toEqual(preview)
		expect(app.document.querySelector('[role="alert"]')?.textContent).toContain(
			'Import a JSON file or paste',
		)
	})
	test('production-minified HTML keeps the workbench and importer self-contained', async () => {
		const build = await Bun.build({
			entrypoints: [`${import.meta.dir}/liveMapper.ts`],
			target: 'browser',
			format: 'esm',
			minify: true,
		})
		expect(build.success).toBe(true)
		const temporary = await mkdtemp(join(tmpdir(), 'earthly-live-mapper-'))
		try {
			const path = join(temporary, 'liveMapper.mjs')
			const output = build.outputs[0]
			if (!output) throw new Error('Production build did not emit the workbench module')
			await writeFile(path, await output.text())
			const built = (await import(path)) as { LIVE_MAPPER_HTML: string }
			const app = await samplePreview(built.LIVE_MAPPER_HTML)
			expect(app.replacements.at(-1)?.features).toHaveLength(10)
			expect(app.resources).toEqual([])
		} finally {
			await rm(temporary, { recursive: true, force: true })
		}
	})
})
