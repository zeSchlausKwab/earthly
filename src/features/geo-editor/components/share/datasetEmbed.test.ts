import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { finalizeEvent, nip19 } from 'nostr-tools'
import { DEMO_MAP } from '@/map-plugin/fixtures'
import { canEmbedDataset, checkDatasetEmbed, datasetEmbedProblem } from './datasetEmbed'
import { createMapEmbed } from '@/features/public-map/references'
import { parseViewOptions } from '@/features/public-map/model'

const event = finalizeEvent(
	{ kind: 37515, created_at: 1, tags: [['d', 'embed-test']], content: JSON.stringify(DEMO_MAP) },
	new Uint8Array(32).fill(1),
)
const reference = nip19.naddrEncode({
	kind: event.kind,
	pubkey: event.pubkey,
	identifier: 'embed-test',
})
const fetchSpy = spyOn(globalThis, 'fetch')
afterEach(() => fetchSpy.mockReset())
afterAll(() => fetchSpy.mockRestore())

describe('dataset embed eligibility', () => {
	test('only permits the signed, public dataset matching the selected address', () => {
		expect(canEmbedDataset(reference, event, false)).toBe(true)
		expect(canEmbedDataset(reference, event, true)).toBe(false)
		expect(canEmbedDataset(reference, { ...event, sig: '0'.repeat(128) }, false)).toBe(false)
		expect(
			canEmbedDataset(
				reference,
				{ ...event, tags: [...event.tags, ['h', 'private-session']] },
				false,
			),
		).toBe(false)
		expect(canEmbedDataset(reference, undefined, false)).toBe(false)
		expect(canEmbedDataset(null, event, false)).toBe(false)
		expect(canEmbedDataset('not-an-address', event, false)).toBe(false)
		const other = nip19.naddrEncode({
			kind: event.kind,
			pubkey: event.pubkey,
			identifier: 'another',
		})
		expect(canEmbedDataset(other, event, false)).toBe(false)
		expect(fetchSpy).not.toHaveBeenCalled()
	})

	test('rejects blob-backed, oversized and unsupported geometry before contacting the service', () => {
		expect(datasetEmbedProblem(event)).toBeNull()
		expect(datasetEmbedProblem({ ...event, tags: [...event.tags, ['blob', 'file']] })).toContain(
			'external files',
		)
		for (const data of [
			{
				type: 'FeatureCollection',
				features: Array.from({ length: 301 }, (_, id) => ({ ...DEMO_MAP.features[0], id })),
			},
			{ ...DEMO_MAP, description: 'x'.repeat(48 * 1024) },
			{
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: {},
						geometry: { type: 'GeometryCollection', geometries: [] },
					},
				],
			},
		]) {
			expect(datasetEmbedProblem({ ...event, content: JSON.stringify(data) })).toContain(
				'not supported',
			)
		}
		expect(datasetEmbedProblem({ ...event, content: 'invalid json' })).toContain('not supported')
		expect(fetchSpy).not.toHaveBeenCalled()
	})
})

describe('viewer compatibility check', () => {
	test('checks the real reader without sending dataset content or credentials', async () => {
		fetchSpy.mockResolvedValue(
			Response.json({
				reference,
				title: 'Demo',
				description: '',
				eventId: event.id,
				data: DEMO_MAP,
			}),
		)
		const signal = new AbortController().signal
		await checkDatasetEmbed('https://maps.earthly.city', reference, signal)
		const call = fetchSpy.mock.calls[0]
		if (!call) throw new Error('Missing compatibility request')
		const [url, options] = call
		expect(String(url)).toBe(`https://maps.earthly.city/api/maps/${reference}`)
		expect(options).toEqual({ signal, credentials: 'omit', cache: 'no-store' })
	})

	test('fails closed on relay errors, invalid responses, and incompatible latest versions', async () => {
		for (const response of [
			Response.json({ error: 'Map not found' }, { status: 400 }),
			Response.json({
				reference: 'another',
				title: 'Demo',
				description: '',
				eventId: event.id,
				data: DEMO_MAP,
			}),
			Response.json({
				reference,
				title: 'Demo',
				description: '',
				eventId: event.id,
				data: { type: 'FeatureCollection', features: [] },
			}),
		]) {
			fetchSpy.mockResolvedValueOnce(response)
			await expect(
				checkDatasetEmbed('https://maps.earthly.city', reference, new AbortController().signal),
			).rejects.toThrow()
		}
	})

	test('generated HTML round-trips all display settings and carries no geometry', () => {
		const view = {
			theme: 'dark' as const,
			title: false,
			legend: false,
			controls: false,
			scrollZoom: true,
			center: [16.4, 48.2] as [number, number],
			zoom: 10,
		}
		const embed = createMapEmbed('https://maps.earthly.city', reference, view, 640)
		expect(parseViewOptions(new URL(embed.embedUrl).searchParams)).toEqual(view)
		expect(embed.html).toContain('height="640"')
		expect(embed.html).toContain('&amp;')
		expect(embed.html).not.toContain('FeatureCollection')
		expect(createMapEmbed('https://maps.earthly.city', reference).view.scrollZoom).toBe(false)
	})
})
