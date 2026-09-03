import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { buildSavedViewAtlasSeed } from './creationSeed'
import { parseMapPresentationSource, type MapPresentationV1 } from '@/lib/map-presentation'

describe('buildSavedViewAtlasSeed', () => {
	test('authorizes each captured source once and preserves the captured camera and layers', () => {
		const source = parseMapPresentationSource(`37515:${'a'.repeat(64)}:western-front`)
		if (!source) throw new Error('fixture source did not parse')
		const presentation: MapPresentationV1 = {
			version: 1,
			initialView: { center: [7.5, 50.2], zoom: 5, bearing: 0, pitch: 0 },
			layers: [
				{ id: 'one', source: source.coordinate, visible: true, opacityMultiplier: 1 },
				{ id: 'two', source: source.coordinate, visible: true, opacityMultiplier: 0.5 },
			],
		}

		const seed = buildSavedViewAtlasSeed(presentation)
		expect(seed.governance).toBe('closed')
		expect(seed.presentation).toBe(presentation)
		expect(seed.curatedReferences).toHaveLength(1)
		const encoded = seed.curatedReferences?.[0]?.replace(/^nostr:/, '') ?? ''
		const decoded = nip19.decode(encoded)
		expect(decoded.type).toBe('naddr')
		if (decoded.type === 'naddr') {
			expect(decoded.data).toMatchObject({
				kind: 37515,
				pubkey: 'a'.repeat(64),
				identifier: 'western-front',
			})
		}
	})
})
