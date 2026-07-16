import { describe, expect, test } from 'bun:test'
import type { MapLayerState } from '@/features/geo-editor/store'
import { planSavedRegion } from './planSavedRegion'

const layer: MapLayerState = {
	id: 'world',
	title: 'World',
	kind: 'chunked-vector',
	enabled: true,
	opacity: 1,
	blossomServers: ['https://one.example', 'https://two.example/'],
	announcement: {
		u: { bbox: [0, 40, 30, 60], file: `${'a'.repeat(64)}.pmtiles`, maxZoom: 8, size: 10 },
		s: { bbox: [-30, 20, 0, 40], file: 'b'.repeat(64), maxZoom: 8 },
		z: { bbox: [100, 0, 120, 20], file: 'c'.repeat(64), maxZoom: 8, size: 30 },
	},
}

describe('planSavedRegion', () => {
	test('selects intersecting chunks and binds every mirror to its hash', () => {
		const plan = planSavedRegion({
			id: 'hike-1',
			name: 'Hike',
			bbox: [-5, 35, 10, 50],
			sourcePubkey: '1'.repeat(64),
			announcementId: '2'.repeat(64),
			layer,
		})

		expect(plan.chunkCount).toBe(2)
		expect(plan.bytesTotal).toBeNull()
		expect(plan.unknownSizeCount).toBe(1)
		expect(plan.request.blobs[0]?.sha256).toBe('b'.repeat(64))
		expect(plan.request.blobs[1]?.mirrorUrls).toEqual([
			`https://one.example/${'a'.repeat(64)}.pmtiles`,
			`https://two.example/${'a'.repeat(64)}.pmtiles`,
		])
	})

	test('rejects date-line wrapping instead of silently saving the wrong area', () => {
		expect(() =>
			planSavedRegion({
				id: 'wrap',
				name: 'Wrap',
				bbox: [170, -10, -170, 10],
				sourcePubkey: '1'.repeat(64),
				announcementId: '2'.repeat(64),
				layer,
			}),
		).toThrow('date line')
	})
})
