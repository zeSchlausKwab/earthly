import type { FeatureCollection } from 'geojson'
import type { StateCreator } from 'zustand'
import {
	detectBlobScope,
	ensureFeatureCollection,
	fetchGeoJsonPayload,
	summarizeFeatureCollection,
} from '../utils'
import type { EditorBlobReference } from '../types'
import type { EditorState, PublishingSlice } from './types'

export const createPublishingSlice: StateCreator<EditorState, [], [], PublishingSlice> = (
	set,
	get,
) => {
	const syncActiveDraftBlobReferences = () => {
		const state = get()
		if (!state.activeGeoEditDraftId || !state.geoEditDrafts[state.activeGeoEditDraftId]) return
		state.saveGeoEditDraft(state.activeGeoEditDraftId, {
			blobReferences: state.blobReferences,
		})
	}

	return {
		isPublishing: false,
		publishMessage: null,
		publishError: null,

		blossomUploadDialogOpen: false,
		pendingPublishCollection: null,

		blobReferences: [],
		blobDraftUrl: '',
		blobDraftStatus: 'idle',
		blobDraftError: null,
		previewingBlobReferenceId: null,
		blobPreviewCollection: null,

		setIsPublishing: (isPublishing) => set({ isPublishing }),
		setPublishMessage: (publishMessage) => set({ publishMessage }),
		setPublishError: (publishError) => set({ publishError }),

		setBlossomUploadDialogOpen: (blossomUploadDialogOpen) => set({ blossomUploadDialogOpen }),
		setPendingPublishCollection: (pendingPublishCollection) => set({ pendingPublishCollection }),

		setBlobReferences: (blobReferences) => {
			const state = get()
			if (JSON.stringify(state.blobReferences) === JSON.stringify(blobReferences)) return
			set({
				blobReferences,
				...(state.activeGeoEditDraftId ? { isDirty: true } : {}),
			})
			syncActiveDraftBlobReferences()
		},
		setBlobDraftUrl: (blobDraftUrl) => set({ blobDraftUrl }),
		setBlobDraftStatus: (blobDraftStatus) => set({ blobDraftStatus }),
		setBlobDraftError: (blobDraftError) => set({ blobDraftError }),
		setPreviewingBlobReferenceId: (previewingBlobReferenceId) => set({ previewingBlobReferenceId }),
		setBlobPreviewCollection: (blobPreviewCollection) => set({ blobPreviewCollection }),

		fetchBlobReference: async () => {
			const { blobDraftUrl } = get()
			const url = blobDraftUrl.trim()
			if (!url) return

			set({ blobDraftStatus: 'loading', blobDraftError: null })

			try {
				const { payload, size, mimeType } = await fetchGeoJsonPayload(url)
				const normalized = ensureFeatureCollection(payload)
				const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
				const summary = summarizeFeatureCollection(collection)
				const scopeInfo = detectBlobScope(collection)
				const id = crypto.randomUUID()

				const reference: EditorBlobReference = {
					id,
					url,
					scope: scopeInfo.scope,
					featureId: scopeInfo.featureId,
					status: 'ready',
					featureCount: summary.featureCount,
					geometryTypes: summary.geometryTypes,
					previewCollection: collection,
					size,
					mimeType,
				}

				set((state) => ({
					blobReferences: [...state.blobReferences, reference],
					blobPreviewCollection: collection,
					previewingBlobReferenceId: id,
					blobDraftUrl: '',
					blobDraftStatus: 'idle',
					...(state.activeGeoEditDraftId ? { isDirty: true } : {}),
				}))
				syncActiveDraftBlobReferences()
			} catch (error) {
				console.error('Failed to fetch external GeoJSON', error)
				set({
					blobDraftStatus: 'error',
					blobDraftError:
						error instanceof Error ? error.message : 'Failed to fetch external GeoJSON.',
				})
			}
		},

		previewBlobReference: async (id: string) => {
			const { blobReferences } = get()
			const reference = blobReferences.find((ref) => ref.id === id)
			if (!reference) return

			if (reference.status === 'ready' && reference.previewCollection) {
				set({
					previewingBlobReferenceId: id,
					blobPreviewCollection: reference.previewCollection,
				})
				return
			}

			set((state) => ({
				blobReferences: state.blobReferences.map((ref) =>
					ref.id === id ? { ...ref, status: 'loading', error: undefined } : ref,
				),
			}))

			try {
				const { payload, size, mimeType } = await fetchGeoJsonPayload(reference.url)
				const normalized = ensureFeatureCollection(payload)
				const collection = JSON.parse(JSON.stringify(normalized)) as FeatureCollection
				const summary = summarizeFeatureCollection(collection)
				const scopeInfo = detectBlobScope(collection)

				set((state) => ({
					blobReferences: state.blobReferences.map((ref) =>
						ref.id === id
							? {
									...ref,
									...scopeInfo,
									status: 'ready',
									featureCount: summary.featureCount,
									geometryTypes: summary.geometryTypes,
									previewCollection: collection,
									size: size ?? ref.size,
									mimeType: mimeType ?? ref.mimeType,
								}
							: ref,
					),
					blobPreviewCollection: collection,
					previewingBlobReferenceId: id,
					...(state.activeGeoEditDraftId ? { isDirty: true } : {}),
				}))
				syncActiveDraftBlobReferences()
			} catch (error) {
				console.error('Failed to preview blob reference', error)
				set((state) => ({
					blobReferences: state.blobReferences.map((ref) =>
						ref.id === id
							? {
									...ref,
									status: 'error',
									error:
										error instanceof Error ? error.message : 'Failed to load external GeoJSON.',
								}
							: ref,
					),
				}))
				syncActiveDraftBlobReferences()
			}
		},

		removeBlobReference: (id: string) => {
			const { previewingBlobReferenceId, blobReferences } = get()
			if (!blobReferences.some((reference) => reference.id === id)) return
			set((state) => {
				const newState: Partial<EditorState> = {
					blobReferences: state.blobReferences.filter((reference) => reference.id !== id),
					...(state.activeGeoEditDraftId ? { isDirty: true } : {}),
				}
				if (previewingBlobReferenceId === id) {
					newState.previewingBlobReferenceId = null
					newState.blobPreviewCollection = null
				}
				return newState
			})
			syncActiveDraftBlobReferences()
		},
	}
}
