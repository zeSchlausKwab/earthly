import { describe, expect, test } from 'bun:test'
import { naddrEncode } from 'applesauce-core/helpers'
import { resolveEntityReference } from './entityReference'
import { ARTICLE_KIND, GEO_EVENT_KIND, MAP_CONTEXT_KIND } from './kinds'

describe('Entity reference boundary', () => {
	const pubkey = 'a'.repeat(64)
	for (const [kind, path] of [[GEO_EVENT_KIND, 'map'], [ARTICLE_KIND, 'story'], [MAP_CONTEXT_KIND, 'atlas']] as const) {
		test(`normalizes raw and encoded ${path} references, including colons in identifiers`, () => {
			const identifier = 'places:west'
			const coordinate = `${kind}:${pubkey}:${identifier}`
			const naddr = naddrEncode({ kind, pubkey, identifier })
			for (const input of [coordinate, naddr, `nostr:${naddr}`]) {
				expect(resolveEntityReference(input)).toMatchObject({ coordinate, path: `/${path}/${naddr}`, identifier })
			}
		})
	}
	test('invalid foreign references cannot crash inspection', () => {
		for (const input of ['', 'naddr1bad', `37515:no:map`, `37515:${pubkey}:`, `1:${pubkey}:note`, 'javascript:alert(1)']) {
			expect(resolveEntityReference(input)).toBeNull()
		}
	})
})
