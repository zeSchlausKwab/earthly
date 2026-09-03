import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import { applyAmbientSourcesToLayers, parseAmbientOn, resolveAmbientOn } from './ambient'
import type { MapPresentationLayerV1, MapPresentationSource } from './types'

const PK_A = 'a'.repeat(64)
const PK_B = 'b'.repeat(64)
const A = `37515:${PK_A}:shared` as MapPresentationSource
const B = `37515:${PK_B}:shared` as MapPresentationSource
const C = `37515:${PK_B}:unique` as MapPresentationSource

describe('ambient on= parsing and resolution', () => {
	test('preserves order, canonicalizes exact naddrs, and deduplicates', () => {
		const address = nip19.naddrEncode({ kind: 37515, pubkey: PK_A, identifier: 'shared' })
		const parsed = parseAmbientOn(`nostr:${address},${A},unique,unique`)
		expect(parsed.tokens.map((token) => token.kind)).toEqual(['exact', 'legacy'])
		const resolved = resolveAmbientOn(parsed, [A, C])
		expect(resolved.sources).toEqual([A, C])
	})

	test('never guesses when a legacy d-tag is ambiguous or missing', () => {
		const resolved = resolveAmbientOn(parseAmbientOn('shared,missing'), [A, B, C])
		expect(resolved.sources).toEqual([])
		expect(resolved.issues.map((issue) => issue.code)).toEqual([
			'ambiguous-legacy-source',
			'missing-legacy-source',
		])
	})

	test('bounds token count and rejects malformed exact-looking references', () => {
		const parsed = parseAmbientOn(
			['naddr1broken', ...Array.from({ length: 70 }, (_, index) => `map-${index}`)].join(','),
		)
		expect(parsed.tokens).toHaveLength(63)
		expect(parsed.issues.map((issue) => issue.code)).toContain('token-limit')
		expect(parsed.issues.map((issue) => issue.code)).toContain('invalid-reference')
	})
})

describe('ambient layer composition', () => {
	test('forces matching Story instances visible and appends author-style whole Maps', () => {
		const base: MapPresentationLayerV1[] = [
			{ id: 'story-a', source: A, visible: false, opacityMultiplier: 0.3 },
			{ id: 'ambient-1', source: B, visible: true, opacityMultiplier: 0.5 },
		]
		const composed = applyAmbientSourcesToLayers(base, [A, C])

		expect(composed.layers.map((layer) => layer.id)).toEqual(['story-a', 'ambient-1', 'ambient-2'])
		expect(composed.layers[0]).toMatchObject({ visible: true, opacityMultiplier: 0.3 })
		expect(composed.layers[2]).toEqual({
			id: 'ambient-2',
			source: C,
			visible: true,
			opacityMultiplier: 1,
		})
		expect(composed.forcedVisibleLayerIds).toEqual(['story-a'])
		expect(composed.ambientLayerIds).toEqual(['ambient-2'])
	})
})
