import { describe, expect, test } from 'bun:test'
import {
	normalizeMapLayerMirrors,
	parseMapLayerSetContent,
	selectLatestTrustedMapLayerSet,
} from './trust'

const trusted = 'a'.repeat(64)
const untrusted = 'b'.repeat(64)
const file = `${'c'.repeat(64)}.pmtiles`

function content(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		version: 1,
		layers: [
			{
				id: 'world',
				title: 'World',
				kind: 'chunked-vector',
				blossomServers: ['https://one.example', 'https://two.example/'],
				announcement: {
					u: { bbox: [-20, 35, 45, 72], file, maxZoom: 8, size: 1234 },
				},
				...overrides,
			},
		],
	})
}

function candidate(pubkey: string, createdAt: number, body = content()) {
	return {
		id: `${createdAt}`.padStart(64, '0'),
		pubkey,
		created_at: createdAt,
		content: body,
		tags: [],
	}
}

describe('trusted Mapnolia announcements', () => {
	test('ignores a newer announcement from an untrusted author', () => {
		const selected = selectLatestTrustedMapLayerSet(
			[candidate(trusted, 10), candidate(untrusted, 20)],
			[trusted],
		)
		expect(selected?.pubkey).toBe(trusted)
		expect(selected?.created_at).toBe(10)
	})

	test('rejects malformed trusted content before selection', () => {
		const selected = selectLatestTrustedMapLayerSet(
			[candidate(trusted, 10), candidate(trusted, 20, '{"layers":"invalid"}')],
			[trusted],
		)
		expect(selected?.created_at).toBe(10)
	})

	test('validates chunk metadata and normalizes ordered mirrors', () => {
		const parsed = parseMapLayerSetContent(content())
		const layer = parsed?.layers[0]
		expect(layer?.kind).toBe('chunked-vector')
		expect(layer?.blossomServers).toEqual(['https://one.example', 'https://two.example'])
		expect(normalizeMapLayerMirrors(layer ?? {}, 'https://fallback.example')).toEqual([
			'https://one.example',
			'https://two.example',
			'https://fallback.example',
		])
	})

	test('keeps the legacy singular mirror but rejects unsafe URLs and file names', () => {
		const legacy = parseMapLayerSetContent(
			content({ blossomServers: undefined, blossomServer: 'https://legacy.example/' }),
		)
		expect(legacy?.layers[0]?.blossomServers).toEqual(['https://legacy.example'])
		expect(
			parseMapLayerSetContent(content({ blossomServers: ['http://public.example'] })),
		).toBeNull()
		expect(
			parseMapLayerSetContent(
				content({ announcement: { u: { bbox: [-20, 35, 45, 72], file: '../map', maxZoom: 8 } } }),
			),
		).toBeNull()
	})
})
