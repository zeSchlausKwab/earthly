/**
 * SPEC §1.5.1/§1.5.2 — blob tag parsing and writing rules.
 *
 * Feature ids must match [A-Za-z0-9_.-]+ (no colons, non-empty); malformed
 * references are dropped on read and refused on write. key=value params
 * without an `=` are silently ignored.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { blobReferenceToTag, getBlobReferences } from './helpers'

function makeEvent(tags: string[][]): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind: GEO_EVENT_KIND,
		tags,
		content: '{"type":"FeatureCollection","features":[]}',
		sig: 'c'.repeat(128),
	}
}

describe('getBlobReferences — SPEC §1.5 parsing', () => {
	test('parses collection and feature scopes with params', () => {
		const refs = getBlobReferences(
			makeEvent([
				[
					'blob',
					'collection',
					'https://x.example/a.json',
					'sha256=abc',
					'size=123',
					'mime=application/geo+json',
				],
				['blob', 'feature:road-1', 'https://x.example/b.json'],
			]),
		)
		expect(refs).toHaveLength(2)
		expect(refs[0]).toMatchObject({
			scope: 'collection',
			sha256: 'abc',
			size: 123,
			mimeType: 'application/geo+json',
		})
		expect(refs[1]).toMatchObject({ scope: 'feature', featureId: 'road-1' })
	})

	test('drops feature scopes with empty or colon-containing ids (SPEC §1.5.2)', () => {
		const refs = getBlobReferences(
			makeEvent([
				['blob', 'feature:', 'https://x.example/empty.json'],
				['blob', 'feature:foo:bar', 'https://x.example/colon.json'],
				['blob', 'feature:ok_id-1.x', 'https://x.example/ok.json'],
			]),
		)
		expect(refs).toHaveLength(1)
		expect(refs[0]?.featureId).toBe('ok_id-1.x')
	})

	test('silently ignores params without `=` (SPEC §1.5.1)', () => {
		const refs = getBlobReferences(
			makeEvent([['blob', 'collection', 'https://x.example/a.json', 'sha256', 'size=77']]),
		)
		expect(refs[0]?.sha256).toBeUndefined()
		expect(refs[0]?.size).toBe(77)
	})
})

describe('blobReferenceToTag — SPEC §1.5.2 write refusal', () => {
	test('writes valid feature references', () => {
		expect(
			blobReferenceToTag({ scope: 'feature', featureId: 'f-1', url: 'https://x.example/a.json' }),
		).toEqual(['blob', 'feature:f-1', 'https://x.example/a.json'])
	})

	test('refuses empty or malformed feature ids', () => {
		expect(blobReferenceToTag({ scope: 'feature', url: 'https://x.example/a.json' })).toBeNull()
		expect(
			blobReferenceToTag({ scope: 'feature', featureId: 'a:b', url: 'https://x.example/a.json' }),
		).toBeNull()
	})
})
