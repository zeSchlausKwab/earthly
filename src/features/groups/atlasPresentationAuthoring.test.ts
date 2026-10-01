import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { GeoFeatureItem } from '@/components/editor'
import {
	atlasPresentationSourceOptions,
	normalizeAtlasPresentationForDraft,
} from './atlasPresentationAuthoring'
import { normalizeAtlasPresentationForPublish } from './editorDraft'

const PUBKEY = 'a'.repeat(64)
const SOURCE = `37515:${PUBKEY}:western-front` as const
const OTHER_SOURCE = `37515:${PUBKEY}:eastern-front` as const
const ADDRESS = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'western-front' })

describe('Atlas presentation source options', () => {
	test('deduplicates local objects by workspace and shows their retained Map title', () => {
		const source = { kind: 'local-map' as const, workspaceId: 'local' }
		expect(
			atlasPresentationSourceOptions(
				[source, { ...source }],
				[],
				new Map([['earthly-draft:local', 'Kurdish regions']]),
			),
		).toEqual([{ source, label: 'Kurdish regions' }])
	})
	test('local accepted Maps render in draft views while public normalization still rejects them', () => {
		const presentation = {
			version: 1,
			initialView: { center: [44, 36], zoom: 5 },
			layers: [{ id: 'regions', source: { kind: 'local-map', workspaceId: 'local' } }],
		}
		expect(normalizeAtlasPresentationForDraft(presentation, ['earthly-draft:local'])).toMatchObject(
			presentation,
		)
		expect(() => normalizeAtlasPresentationForDraft(presentation, ['earthly-draft:other'])).toThrow(
			'accepted by this Atlas',
		)
		expect(() =>
			normalizeAtlasPresentationForPublish(presentation, ['earthly-draft:local']),
		).toThrow()
		const future = { version: 99, data: 'opaque' }
		expect(normalizeAtlasPresentationForDraft(future, [])).toBe(future)
	})
	test('offers each accepted source once, in owner order, and falls back to its identifier', () => {
		const available: GeoFeatureItem[] = [
			{
				id: 'map',
				name: 'Western Front',
				address: ADDRESS,
				entityType: 'dataset',
				datasetName: 'Western Front',
			},
		]
		expect(atlasPresentationSourceOptions([OTHER_SOURCE, SOURCE, SOURCE], available)).toEqual([
			{ source: OTHER_SOURCE, label: 'eastern-front' },
			{ source: SOURCE, label: 'Western Front' },
		])
		expect(atlasPresentationSourceOptions([], available)).toEqual([])
	})

	test('prefers Map labels over feature labels and accepts prefixed addresses with selectors', () => {
		const available: GeoFeatureItem[] = [
			{
				id: 'feature',
				name: 'Battle',
				address: `nostr:${ADDRESS}#battle-a`,
				datasetName: 'Feature label',
				entityType: 'feature',
			},
			{ id: 'map', name: 'Western Front', address: ADDRESS, entityType: 'dataset' },
		]
		expect(atlasPresentationSourceOptions([SOURCE], available)).toEqual([
			{ source: SOURCE, label: 'Western Front' },
		])
	})
})
