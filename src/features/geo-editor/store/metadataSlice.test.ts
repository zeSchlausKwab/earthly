import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { setCurrentPubkey } from '@/lib/wallet/currentUser'
import type { CollectionMeta } from '../types'
import { flushPersistedGeoCollectionDraftState } from './editorCoreSlice'
import { createMetadataSlice } from './metadataSlice'
import type { EditorState, GeoCollectionEditDraft } from './types'

const globalWithWindow = globalThis as unknown as { window?: Window }
const originalWindow = globalWithWindow.window
let storageWrites = 0

function createMetadataHarness(collectionMeta: CollectionMeta) {
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: 'draft-1',
		sourceId: 'session:metadata-test',
		name: collectionMeta.name,
		description: collectionMeta.description,
		collectionMeta,
		features: [],
		selectedFeatureIds: [],
		publishChannel: { kind: 'public' },
		contextRefs: [],
		blobReferences: [],
		createdAt: 1,
		updatedAt: 17,
	}
	let notifications = 0
	let state = {} as EditorState
	const set = (update: Partial<EditorState> | ((current: EditorState) => Partial<EditorState>)) => {
		const partial = typeof update === 'function' ? update(state) : update
		if (Object.is(partial, state)) return
		state = { ...state, ...partial }
		notifications += 1
	}
	const get = () => state
	state = {
		...createMetadataSlice(set as never, get as never, {} as never),
		collectionMeta,
		activeGeoEditDraftId: draft.id,
		geoEditDrafts: { [draft.id]: draft },
		isDirty: false,
	} as EditorState

	return {
		getState: () => state,
		getNotifications: () => notifications,
	}
}

beforeEach(() => {
	globalWithWindow.window = {
		localStorage: {
			length: 0,
			clear: () => {},
			getItem: () => null,
			key: () => null,
			removeItem: () => {},
			setItem: () => {
				storageWrites += 1
			},
		} as Storage,
	} as Window
	setCurrentPubkey(null)
	flushPersistedGeoCollectionDraftState()
	storageWrites = 0
})

afterEach(() => {
	flushPersistedGeoCollectionDraftState()
	setCurrentPubkey(null)
	globalWithWindow.window = originalWindow
})

describe('setCollectionMeta', () => {
	test('is a complete no-op for semantically equal metadata', () => {
		const collectionMeta: CollectionMeta = {
			name: 'The Ocean Has a Memory',
			description: 'North Pacific conditions',
			color: '#f97316',
			customProperties: { source: 'NOAA', year: 2026 },
		}
		const harness = createMetadataHarness(collectionMeta)
		const before = harness.getState()
		const beforeDraft = before.geoEditDrafts['draft-1']

		harness.getState().setCollectionMeta({
			name: collectionMeta.name,
			description: collectionMeta.description,
			color: collectionMeta.color,
			customProperties: { year: 2026, source: 'NOAA' },
		})
		flushPersistedGeoCollectionDraftState()

		const after = harness.getState()
		expect(after).toBe(before)
		expect(after.collectionMeta).toBe(collectionMeta)
		expect(after.geoEditDrafts['draft-1']).toBe(beforeDraft)
		expect(after.geoEditDrafts['draft-1']?.updatedAt).toBe(17)
		expect(after.isDirty).toBe(false)
		expect(harness.getNotifications()).toBe(0)
		expect(storageWrites).toBe(0)
	})

	test('still persists and marks a real metadata change dirty', () => {
		const collectionMeta: CollectionMeta = {
			name: 'Before',
			description: 'Description',
			color: '#1d4ed8',
			customProperties: { source: 'NOAA' },
		}
		const harness = createMetadataHarness(collectionMeta)

		harness.getState().setCollectionMeta({ ...collectionMeta, name: 'After' })
		flushPersistedGeoCollectionDraftState()

		const after = harness.getState()
		expect(after.collectionMeta.name).toBe('After')
		expect(after.geoEditDrafts['draft-1']?.name).toBe('After')
		expect(after.geoEditDrafts['draft-1']?.updatedAt).toBeGreaterThan(17)
		expect(after.isDirty).toBe(true)
		expect(harness.getNotifications()).toBe(1)
		expect(storageWrites).toBe(1)
	})
})
