/**
 * Wave-0 Nyquist RED baseline — pins the Group (kind 37518, slimmed) contract (GROUP-01).
 *
 * SPEC-02/SPEC-03: per-kind guard + factory + cast, governance content shape, and the
 * `modelVersion` clean-break gate. This file imports symbols that do NOT yet exist — it
 * is EXPECTED to fail RED until Plan 02 lands `@/lib/nostr/group`.
 *
 *   - GroupFactory.create({ governance:'schema' }) serializes governance + name and
 *     RE-ASSERTS modelVersion === MODEL_VERSION (caller cannot override it).
 *   - create() generates a `d` tag when absent; modify() preserves the SAME `d`
 *     (parameterized-replaceable lineage — Pitfall 4, no lineage fork).
 *   - isGroup() accepts a fresh signed Group, REJECTS a legacy kind-37518 event that
 *     carries `contextUse`/`validationMode` content and NO modelVersion (clean-break
 *     silent drop, SPEC-03), and rejects a wrong-kind event.
 *
 * Symbol names per RESEARCH "artifacts_this_phase_produces":
 *   GroupFactory / Group / isGroup / getGroupContent / getGroupCoordinate /
 *   DEFAULT_GROUP_CONTENT, all from `@/lib/nostr/group`.
 */

import { describe, expect, test } from 'bun:test'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import {
	DEFAULT_GROUP_CONTENT,
	Group,
	GroupFactory,
	getGroupContent,
	getGroupCoordinate,
	isGroup,
} from '@/lib/nostr/group'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'

/** Bare sign-function (EntityFactory contract) — stamps a deterministic id/pubkey/sig. */
async function bareSign(e: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}) {
	return {
		...e,
		created_at: e.created_at ?? 1_700_000_000,
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	} as NostrEvent
}

/** A LEGACY kind-37518 "map context" event: has a `d` tag, content carries the old
 *  contextUse/validationMode triad, and NO modelVersion → must be dropped by isGroup. */
function makeLegacyMapContextEvent(): NostrEvent {
	return {
		id: 'd'.repeat(64),
		pubkey: 'e'.repeat(64),
		created_at: 1_600_000_000,
		kind: MAP_CONTEXT_KIND,
		tags: [['d', 'legacy-ctx']],
		content: JSON.stringify({
			name: 'Legacy',
			contextUse: 'taxonomy',
			validationMode: 'none',
			allowForeignAttachments: false,
		}),
		sig: 'f'.repeat(128),
	}
}

function makeWrongKindEvent(): NostrEvent {
	return {
		...makeLegacyMapContextEvent(),
		kind: 1,
		content: JSON.stringify({ modelVersion: MODEL_VERSION }),
	}
}

describe('group — GROUP-01 governance serialization', () => {
	test('create() serializes governance + name and re-asserts modelVersion', async () => {
		const event = await GroupFactory.create({ name: 'X', governance: 'schema' }).sign(bareSign)
		const content = JSON.parse(event.content) as Record<string, unknown>
		expect(content.governance).toBe('schema')
		expect(content.name).toBe('X')
		expect(content.modelVersion).toBe(MODEL_VERSION)
	})

	test('create() ignores a caller-supplied modelVersion (authoritative re-assert)', async () => {
		const event = await GroupFactory.create({
			name: 'Y',
			governance: 'open',
			// caller tries to spoof the discriminator — must be stripped
			modelVersion: 'earthly/0',
		} as never).sign(bareSign)
		const content = JSON.parse(event.content) as Record<string, unknown>
		expect(content.modelVersion).toBe(MODEL_VERSION)
	})

	test('DEFAULT_GROUP_CONTENT defaults governance to open', () => {
		expect(DEFAULT_GROUP_CONTENT.governance).toBe('open')
	})
})

describe('group — GROUP-01 d-tag lineage (Pitfall 4)', () => {
	test('create() generates a d tag when absent', async () => {
		const event = await GroupFactory.create({ name: 'Z', governance: 'open' }).sign(bareSign)
		expect(event.tags.some((t) => t[0] === 'd' && !!t[1])).toBe(true)
	})

	test('modify() preserves the same d (no lineage fork)', async () => {
		const created = await GroupFactory.create({ name: 'Z', governance: 'open' }).sign(bareSign)
		const dBefore = created.tags.find((t) => t[0] === 'd')?.[1]
		const modified = await GroupFactory.modify(created).group({ name: 'Z2' }).sign(bareSign)
		const dAfter = modified.tags.find((t) => t[0] === 'd')?.[1]
		expect(dAfter).toBe(dBefore)
		expect(dAfter).toBeTruthy()
	})
})

describe('group — GROUP-01 isGroup modelVersion gate (SPEC-03 clean-break)', () => {
	test('accepts a freshly created + signed Group event', async () => {
		const event = await GroupFactory.create({ name: 'X', governance: 'open' }).sign(bareSign)
		expect(isGroup(event)).toBe(true)
	})

	test('REJECTS a legacy 37518 event with no modelVersion (silent drop)', () => {
		const legacy = makeLegacyMapContextEvent()
		// legacy event has kind 37518 AND a d tag — only the modelVersion gate drops it
		expect(legacy.kind).toBe(MAP_CONTEXT_KIND)
		expect(legacy.tags.some((t) => t[0] === 'd')).toBe(true)
		expect(isGroup(legacy)).toBe(false)
	})

	test('rejects a wrong-kind event', () => {
		expect(isGroup(makeWrongKindEvent())).toBe(false)
	})
})

describe('group — GROUP-01 content + coordinate views', () => {
	test('getGroupContent merges over defaults and never throws on malformed content', () => {
		const malformed: NostrEvent = { ...makeLegacyMapContextEvent(), content: '{not json' }
		const content = getGroupContent(malformed)
		expect(content.governance).toBe(DEFAULT_GROUP_CONTENT.governance)
	})

	test('getGroupCoordinate builds kind:pubkey:d', async () => {
		const event = await GroupFactory.create({ name: 'X', governance: 'open' }).sign(bareSign)
		const d = event.tags.find((t) => t[0] === 'd')?.[1]
		expect(getGroupCoordinate(event)).toBe(`${MAP_CONTEXT_KIND}:${event.pubkey}:${d}`)
	})

	test('Group cast exposes governance via the maintainer-mandated EventCast view', async () => {
		const event = await GroupFactory.create({ name: 'X', governance: 'schema' }).sign(bareSign)
		const group = new Group(event, undefined as never)
		expect(group.group.governance).toBe('schema')
	})
})
