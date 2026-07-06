/**
 * Wave-0 Nyquist baseline — pins the in-content model-version discriminator (`modelVersion.ts`).
 *
 * SPEC-03: the new entity model carries a `modelVersion` field in JSON content.
 * `hasCurrentModelVersion(event)` is the render-set gate:
 *   - new-model event (content `modelVersion === MODEL_VERSION`) ⇒ true
 *   - legacy event (no `modelVersion`)                            ⇒ false, no throw
 *   - malformed-JSON content                                     ⇒ false, no throw
 * A `filter(hasCurrentModelVersion)` over a mixed array excludes legacy/malformed
 * entries, so they never enter the render set (defensive-parse, T-8-03).
 *
 * RED-BASELINE: `@/lib/nostr/modelVersion` does not exist yet (lands in Plan 03).
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { hasCurrentModelVersion, MODEL_VERSION } from '@/lib/nostr/modelVersion'

function makeEvent(content: string): NostrEvent {
	return {
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		created_at: 1_700_000_000,
		kind: 37520,
		tags: [['d', 'x']],
		content,
		sig: 'c'.repeat(128),
	}
}

const newModelEvent = makeEvent(JSON.stringify({ modelVersion: MODEL_VERSION, name: 'ok' }))
const legacyEvent = makeEvent(JSON.stringify({ name: 'legacy', governance: 'open' }))
const malformedEvent = makeEvent('{ this is : not valid json')

describe('modelVersion.ts — SPEC-03 guard truth table (no-throw)', () => {
	test('new-model event ⇒ true (no throw)', () => {
		let result: boolean | undefined
		expect(() => {
			result = hasCurrentModelVersion(newModelEvent)
		}).not.toThrow()
		expect(result).toBe(true)
	})

	test('legacy event (no modelVersion) ⇒ false (no throw)', () => {
		let result: boolean | undefined
		expect(() => {
			result = hasCurrentModelVersion(legacyEvent)
		}).not.toThrow()
		expect(result).toBe(false)
	})

	test('malformed-JSON content ⇒ false (no throw)', () => {
		let result: boolean | undefined
		expect(() => {
			result = hasCurrentModelVersion(malformedEvent)
		}).not.toThrow()
		expect(result).toBe(false)
	})
})

describe('modelVersion.ts — SPEC-03 render-set filter', () => {
	test('filter(hasCurrentModelVersion) excludes legacy + malformed entries', () => {
		const mixed = [newModelEvent, legacyEvent, malformedEvent]
		const rendered = mixed.filter(hasCurrentModelVersion)
		expect(rendered).toEqual([newModelEvent])
	})
})
