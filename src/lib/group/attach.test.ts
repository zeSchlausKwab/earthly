/**
 * Wave-0 Nyquist RED baseline — pins the attach-discovery filter + governance lane gate
 * (GROUP-02). Datasets self-attach to a Group via a `c` tag; the Group's foreign
 * (contribution) lane is discovered with `{ kinds:[37515], '#c':[groupCoord] }`.
 *
 * RED-BASELINE: `@/lib/group/attach` does not exist yet (rewrite of `context/scope.ts`).
 *
 *   - buildAttachDiscoveryFilter(coord) === { '#c': [coord], kinds: [GEO_EVENT_KIND] }.
 *   - resolveForeignLaneFilter is SUPPRESSED for governance:'closed' (no `#c` subscription)
 *     and PRESENT for governance:'open' and governance:'schema'
 *     (the `allowForeignAttachments` branch becomes `governance !== 'closed'`).
 */

import { describe, expect, test } from 'bun:test'
import { buildAttachDiscoveryFilter, resolveForeignLaneFilter } from '@/lib/group/attach'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

const COORD = '37518:abc:my-group'

describe('attach — GROUP-02 discovery filter shape', () => {
	test('the attach-discovery filter is { "#c":[coord], kinds:[37515] }', () => {
		expect(buildAttachDiscoveryFilter(COORD)).toEqual({ '#c': [COORD], kinds: [GEO_EVENT_KIND] })
	})
})

describe('attach — GROUP-02 governance lane gate (governance !== closed)', () => {
	test('governance:closed suppresses the foreign lane (no #c subscription)', () => {
		expect(resolveForeignLaneFilter(COORD, 'closed')).toBeNull()
	})

	test('governance:open produces the foreign-lane filter', () => {
		expect(resolveForeignLaneFilter(COORD, 'open')).toEqual({
			'#c': [COORD],
			kinds: [GEO_EVENT_KIND],
		})
	})

	test('governance:schema produces the foreign-lane filter', () => {
		expect(resolveForeignLaneFilter(COORD, 'schema')).toEqual({
			'#c': [COORD],
			kinds: [GEO_EVENT_KIND],
		})
	})
})
