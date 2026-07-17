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

function candidate(pubkey: string, createdAt: number, body = content(), id?: string) {
	return {
		id: id ?? `${createdAt}`.padStart(64, '0'),
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

	test('rejects missing or unsupported signed payload versions', () => {
		const unsupported = JSON.parse(content()) as Record<string, unknown>
		unsupported.version = 2
		const missing = JSON.parse(content()) as Record<string, unknown>
		delete missing.version

		expect(parseMapLayerSetContent(JSON.stringify(unsupported))).toBeNull()
		expect(parseMapLayerSetContent(JSON.stringify(missing))).toBeNull()
	})

	test('uses the NIP-01 lowest-id tie break for equal timestamps', () => {
		const lower = candidate(trusted, 10, content(), '1'.repeat(64))
		const higher = candidate(trusted, 10, content(), 'f'.repeat(64))

		expect(selectLatestTrustedMapLayerSet([higher, lower], [trusted])?.id).toBe(lower.id)
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

	test('rejects oversized signed mirror lists and mirror URLs', () => {
		const mirrors = Array.from({ length: 9 }, (_, index) => `https://mirror-${index}.example`)
		expect(parseMapLayerSetContent(content({ blossomServers: mirrors }))).toBeNull()
		expect(
			parseMapLayerSetContent(
				content({ blossomServers: [`https://${'a'.repeat(2_048)}.example`] }),
			),
		).toBeNull()
	})

	test('rejects a signed basemap chunk above the native per-file limit', () => {
		expect(
			parseMapLayerSetContent(
				content({
					announcement: {
						u: {
							bbox: [-20, 35, 45, 72],
							file,
							maxZoom: 8,
							size: 2 * 1024 * 1024 * 1024 + 1,
						},
					},
				}),
			),
		).toBeNull()
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
