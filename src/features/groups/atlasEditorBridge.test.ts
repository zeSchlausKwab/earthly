import { afterEach, expect, test } from 'bun:test'
import {
	clearAtlasEditorPresentation,
	getAtlasEditorPresentation,
	resetAtlasEditorOpenRequests,
	setAtlasEditorPresentation,
	subscribeAtlasEditorPresentation,
} from './atlasEditorBridge'

afterEach(resetAtlasEditorOpenRequests)

test('foreground Atlas presentation survives obsolete form cleanup and clears on its own unmount', () => {
	let changes = 0
	const unsubscribe = subscribeAtlasEditorPresentation(() => {
		changes += 1
	})
	setAtlasEditorPresentation({
		instanceId: 'old',
		draftKey: 'one',
		ownerPubkey: 'owner',
		acceptedReferences: [],
	})
	setAtlasEditorPresentation({
		instanceId: 'current',
		draftKey: 'two',
		ownerPubkey: 'owner',
		acceptedReferences: ['earthly-draft:map'],
		presentation: { version: 99 },
	})
	clearAtlasEditorPresentation('old')
	expect(getAtlasEditorPresentation()?.draftKey).toBe('two')
	expect(changes).toBe(2)
	clearAtlasEditorPresentation('current')
	expect(getAtlasEditorPresentation()).toBeNull()
	expect(changes).toBe(3)
	unsubscribe()
	setAtlasEditorPresentation({
		instanceId: 'later',
		draftKey: 'three',
		ownerPubkey: null,
		acceptedReferences: [],
	})
	expect(changes).toBe(3)
})
