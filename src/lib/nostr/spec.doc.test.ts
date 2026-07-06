/**
 * SPEC-01 doc-assertion (Phase 8, Wave 0 → GREEN after the v2 rewrite).
 *
 * The risk this test mitigates is documentation drift (T-08-01-DOC): a canonical
 * `SPEC.md` whose contract diverges from the shipped code. It reads `SPEC.md` from
 * disk via `Bun.file('SPEC.md').text()` and asserts the load-bearing tokens of the
 * v2 split-entity model are present — pinned by stable substrings (kind numbers,
 * `modelVersion`, namespace + vocab literals, dialect + NIP-40 tokens) rather than
 * exact prose, so the spec can be reworded freely without breaking the contract.
 *
 * It is intentionally RED against the v1 spec (which lacks 37520/37521/37522 + the
 * `modelVersion` clause) and turns GREEN once SPEC.md is rewritten to v2.
 *
 * Grounded in the shipped seams:
 *   - kind constants            src/lib/nostr/kinds.ts:9,11,15,24,27,30
 *   - modelVersion discriminator src/lib/nostr/modelVersion.ts:19,25
 *   - L/l · t · c taxonomy       src/lib/nostr/tags.ts:137,140
 *   - schema governance dialect  src/lib/validation/schema.worker.ts:67,103
 *   - NIP-40 expiry contract     src/lib/nostr/expiry.ts:22,28
 */

import { describe, expect, it } from 'bun:test'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { EARTHLY_LABEL_NAMESPACE, FEATURE_CATEGORY_VOCAB } from '@/lib/nostr/tags'

const SPEC = await Bun.file('SPEC.md').text()

/** Case-insensitive substring presence in SPEC.md. */
function specHas(token: string): boolean {
	return SPEC.toLowerCase().includes(token.toLowerCase())
}

describe('SPEC.md v2 doc-assertion (SPEC-01)', () => {
	it('reads SPEC.md from disk and it is non-empty', () => {
		expect(SPEC.length).toBeGreaterThan(0)
	})

	it('documents a section for every shipped kind number', () => {
		// Dataset 37515 / Comment 37517 / slimmed Group 37518 + the new split block.
		for (const kind of ['37515', '37517', '37518', '37520', '37521', '37522']) {
			expect(specHas(kind)).toBe(true)
		}
	})

	it('names each split entity by role', () => {
		// The overloaded-"context" framing must be replaced by role-specific entities.
		expect(specHas('Story')).toBe(true)
		expect(specHas('Article')).toBe(true)
		expect(specHas('Live Beacon')).toBe(true)
		expect(specHas('Temporal Sighting')).toBe(true)
		expect(specHas('Group')).toBe(true)
	})

	it('documents the modelVersion discriminator + clean-break clause', () => {
		expect(specHas('modelVersion')).toBe(true)
		expect(specHas(MODEL_VERSION)).toBe(true) // the chosen literal, e.g. earthly/2
		// Clean-break wording: absence/mismatch ⇒ legacy/inert/skipped.
		expect(specHas('legacy')).toBe(true)
		expect(specHas('clean break') || specHas('clean-break')).toBe(true)
	})

	it('documents the three-way L/l · t · c taxonomy split', () => {
		// Each axis named as a disjoint lane.
		expect(specHas('L/l') || (specHas('`L`') && specHas('`l`'))).toBe(true)
		expect(specHas('disjoint') || specHas('three-way')).toBe(true)
		// Flat earthly namespace literal (D-06) + the deliberate tradeoff note vs reverse-DNS.
		expect(specHas(EARTHLY_LABEL_NAMESPACE)).toBe(true)
		expect(specHas('reverse-DNS') || specHas('reverse dns')).toBe(true)
	})

	it('documents the FEATURE_CATEGORY_VOCAB starter members (D-07)', () => {
		for (const value of FEATURE_CATEGORY_VOCAB) {
			expect(specHas(value)).toBe(true)
		}
	})

	it('documents the schema governance dialect (draft-2020-12, no $data, no external $ref)', () => {
		expect(specHas('draft-2020-12') || specHas('2020-12')).toBe(true)
		expect(specHas('$data')).toBe(true)
		expect(specHas('$ref')).toBe(true)
		// Off-thread + size/depth caps governance.
		expect(specHas('depth')).toBe(true)
	})

	it('documents the NIP-40 expiry advisory + client-always-filters contract', () => {
		expect(specHas('NIP-40')).toBe(true)
		expect(specHas('advisory')).toBe(true)
		expect(specHas('expir')).toBe(true) // expiration / expiry
	})
})
