/**
 * CR-03 regression — editing a Group must NOT wipe its curated `a`-reference lane.
 *
 * Before the fix, GroupEditorPanel seeded `curatedReferences` to `[]` on load and called
 * `setAddressReferenceTags(referencedCoords)` on save with NO `preservedCoordinates`, so the
 * destructive `a`-tag reconcile in `computeAddressReferenceTags` dropped every existing `a`
 * tag on a routine name/description/governance edit (silent data loss).
 *
 * This test reproduces the panel's exact load→save reconcile pipeline using the real helpers
 * (it does not mount the React component) and asserts the curated `a` refs persist on the
 * re-signed event. It also pins the curated-seed round-trip (`a` coordinate →
 * `coordinateToNaddrReference` → `extractReferencedCoordinatesFromList` → same coordinate).
 */

import { describe, expect, test } from 'bun:test'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import {
	GroupFactory,
	type GroupContent,
	getGroupReferencedAddresses,
	isGroup,
} from '@/lib/nostr/group'
import {
	coordinateToNaddrReference,
	extractReferencedCoordinates,
	extractReferencedCoordinatesFromList,
	naddrToCoordinate,
	setAddressReferenceTags,
} from '@/lib/nostr/references'

/** Deterministic bare signer (EntityFactory contract) — stamps a fixed id/pubkey/sig. */
async function bareSign(e: {
	kind: number
	tags: string[][]
	content: string
	created_at?: number
}): Promise<NostrEvent> {
	return {
		...e,
		created_at: e.created_at ?? 1_700_000_000,
		id: 'a'.repeat(64),
		pubkey: 'b'.repeat(64),
		sig: 'c'.repeat(128),
	} as NostrEvent
}

const PUBKEY = 'b'.repeat(64)
/** Two real `kind:pubkey:identifier` coordinates the owner curated on the Group. */
const CURATED_A = `37515:${PUBKEY}:dataset-alpha`
const CURATED_B = `37515:${PUBKEY}:dataset-beta`

/**
 * Reproduce GroupEditorPanel's save-path reconcile: seed curated refs from the edited Group
 * (load), then apply the `a`-tag reconcile with the CR-03 preserve guard (save).
 */
async function reSignWithEdit(
	editedEvent: NostrEvent,
	nextContent: Partial<GroupContent>,
	description = '',
): Promise<NostrEvent> {
	const editedGroupEvent = isGroup(editedEvent) ? editedEvent : null
	if (!editedGroupEvent) throw new Error('fixture is not a Group')

	// LOAD: seed curated refs from existing `a` tags (the panel's readInitialCuratedReferences).
	const seededCuratedReferences = getGroupReferencedAddresses(editedGroupEvent)
		.map((coordinate) => coordinateToNaddrReference(coordinate))
		.filter((reference): reference is string => reference !== null)

	// SAVE: build referencedCoords from description + the seeded curated list.
	const referencedCoords = [
		...extractReferencedCoordinates(description),
		...extractReferencedCoordinatesFromList(seededCuratedReferences),
	]
	// Preserve only existing `a` coords that could NOT be reverse-encoded (defense-in-depth).
	const preservedCuratedCoords = getGroupReferencedAddresses(editedGroupEvent).filter(
		(coordinate) => coordinateToNaddrReference(coordinate) === null,
	)

	return GroupFactory.modify(editedGroupEvent)
		.group(nextContent)
		.modifyPublicTags(setAddressReferenceTags(referencedCoords, preservedCuratedCoords))
		.sign(bareSign)
}

describe('GroupEditorPanel — CR-03 curated `a` refs survive an edit', () => {
	test('coordinateToNaddrReference round-trips back to the same coordinate', () => {
		const reference = coordinateToNaddrReference(CURATED_A)
		expect(reference).not.toBeNull()
		const [coordinate] = extractReferencedCoordinatesFromList([reference])
		expect(coordinate).toBe(CURATED_A)
	})

	test('a name/governance edit preserves every existing curated `a` ref', async () => {
		const original = await GroupFactory.create({ name: 'Roman ruins', governance: 'open' })
			.referencedAddresses([CURATED_A, CURATED_B])
			.sign(bareSign)

		expect(getGroupReferencedAddresses(original).sort()).toEqual([CURATED_A, CURATED_B].sort())

		// Owner edits the name + flips governance to closed — must NOT lose the curated lane.
		const reSigned = await reSignWithEdit(original, {
			name: 'Roman ruins (Carinthia)',
			governance: 'closed',
		})

		expect(getGroupReferencedAddresses(reSigned).sort()).toEqual([CURATED_A, CURATED_B].sort())
	})

	test('an `a` coordinate that cannot be reverse-encoded is still preserved on save', async () => {
		// A malformed (non kind:pubkey:identifier) `a` tag never reaches the editable UI.
		const malformedCoord = 'not-a-valid-coordinate'
		expect(coordinateToNaddrReference(malformedCoord)).toBeNull()
		expect(naddrToCoordinate(malformedCoord)).toBeNull()

		const original = await GroupFactory.create({ name: 'Edge', governance: 'open' })
			.referencedAddresses([CURATED_A, malformedCoord])
			.sign(bareSign)

		const reSigned = await reSignWithEdit(original, { name: 'Edge (renamed)' })

		const after = getGroupReferencedAddresses(reSigned)
		expect(after).toContain(CURATED_A)
		expect(after).toContain(malformedCoord)
	})

	test('encodes through nip19.naddr exactly as the seed path expects', () => {
		const naddr = nip19.naddrEncode({ kind: 37515, pubkey: PUBKEY, identifier: 'dataset-alpha' })
		expect(coordinateToNaddrReference(CURATED_A)).toBe(`nostr:${naddr}`)
	})
})
