import type { StateCreator } from 'zustand'
import type { CollectionMeta } from '../types'
import { createDefaultCollectionMeta } from '../utils'
import { writePersistedGeoCollectionDraftState } from './editorCoreSlice'
import type { DraftSlice, EditorState, GeoCollectionEditDraft } from './types'
import type { EditorFeature } from '../core'

interface PersistedGeoCollectionDraftState {
	drafts: Record<string, GeoCollectionEditDraft>
	activeDraftId: string | null
}

const GEO_COLLECTION_DRAFTS_STORAGE_KEY = 'earthly:geo-editor:collection-drafts:v1'

const normalizeDraftCollectionMeta = (value: unknown): CollectionMeta => {
	const defaults = createDefaultCollectionMeta()
	if (!value || typeof value !== 'object') {
		return defaults
	}
	const asRecord = value as Record<string, unknown>
	return {
		name: typeof asRecord.name === 'string' ? asRecord.name : defaults.name,
		description:
			typeof asRecord.description === 'string' ? asRecord.description : defaults.description,
		color: typeof asRecord.color === 'string' ? asRecord.color : defaults.color,
		customProperties:
			asRecord.customProperties &&
			typeof asRecord.customProperties === 'object' &&
			!Array.isArray(asRecord.customProperties)
				? (asRecord.customProperties as CollectionMeta['customProperties'])
				: defaults.customProperties,
	}
}

export const readPersistedGeoCollectionDraftState = (): PersistedGeoCollectionDraftState => {
	if (typeof window === 'undefined') {
		return { drafts: {}, activeDraftId: null }
	}

	try {
		const raw = window.localStorage.getItem(GEO_COLLECTION_DRAFTS_STORAGE_KEY)
		if (!raw) return { drafts: {}, activeDraftId: null }
		const parsed = JSON.parse(raw) as Partial<PersistedGeoCollectionDraftState>
		if (!parsed || typeof parsed !== 'object') {
			return { drafts: {}, activeDraftId: null }
		}
		const rawDrafts =
			parsed.drafts && typeof parsed.drafts === 'object' && !Array.isArray(parsed.drafts)
				? (parsed.drafts as Record<string, unknown>)
				: {}
		const drafts: Record<string, GeoCollectionEditDraft> = {}
		for (const [draftId, rawDraft] of Object.entries(rawDrafts)) {
			if (!rawDraft || typeof rawDraft !== 'object') continue
			const asRecord = rawDraft as Record<string, unknown>
			const createdAt = typeof asRecord.createdAt === 'number' ? asRecord.createdAt : Date.now()
			const normalized: GeoCollectionEditDraft = {
				id: typeof asRecord.id === 'string' ? asRecord.id : draftId,
				sourceId:
					typeof asRecord.sourceId === 'string' && asRecord.sourceId.trim()
						? asRecord.sourceId
						: '__unknown__',
				name: typeof asRecord.name === 'string' ? asRecord.name : '',
				description: typeof asRecord.description === 'string' ? asRecord.description : '',
				collectionMeta: normalizeDraftCollectionMeta(asRecord.collectionMeta),
				features: Array.isArray(asRecord.features) ? (asRecord.features as EditorFeature[]) : [],
				selectedFeatureIds: Array.isArray(asRecord.selectedFeatureIds)
					? asRecord.selectedFeatureIds.filter((id): id is string => typeof id === 'string')
					: [],
				createdAt,
				updatedAt: typeof asRecord.updatedAt === 'number' ? asRecord.updatedAt : createdAt,
			}
			drafts[normalized.id] = normalized
		}
		const activeDraftId = typeof parsed.activeDraftId === 'string' ? parsed.activeDraftId : null
		return { drafts, activeDraftId }
	} catch (error) {
		console.warn('Failed to read geo collection drafts from localStorage', error)
		return { drafts: {}, activeDraftId: null }
	}
}

const createGeoDraftId = () => {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

export const createDraftSlice: StateCreator<EditorState, [], [], DraftSlice> = (set, get) => {
	const persisted = readPersistedGeoCollectionDraftState()
	return {
		geoEditDrafts: persisted.drafts,
		activeGeoEditDraftId: persisted.activeDraftId,

		createGeoEditDraft: (sourceId, seed) => {
			const id = createGeoDraftId()
			const now = Date.now()
			const state = get()
			const draft: GeoCollectionEditDraft = {
				id,
				sourceId,
				name: seed?.name ?? '',
				description: seed?.description ?? '',
				collectionMeta: seed?.collectionMeta ?? state.collectionMeta,
				features: seed?.features ?? state.features,
				selectedFeatureIds: seed?.selectedFeatureIds ?? state.selectedFeatureIds,
				createdAt: now,
				updatedAt: now,
			}
			const nextDrafts = {
				...state.geoEditDrafts,
				[id]: draft,
			}
			set({
				geoEditDrafts: nextDrafts,
				activeGeoEditDraftId: id,
			})
			writePersistedGeoCollectionDraftState(nextDrafts, id)
			const workspaceState = get()
			const activeWorkspace = workspaceState.activeWorkspaceId
				? workspaceState.workspaces[workspaceState.activeWorkspaceId]
				: null
			if (activeWorkspace?.sourceId === sourceId) {
				get().touchActiveWorkspace({
					activeDraftId: id,
				})
			}
			return id
		},

		setActiveGeoEditDraftId: (id) =>
			set((state) => {
				const nextId = id && state.geoEditDrafts[id] ? id : null
				writePersistedGeoCollectionDraftState(state.geoEditDrafts, nextId)
				return { activeGeoEditDraftId: nextId }
			}),

		saveGeoEditDraft: (id, updates) =>
			set((state) => {
				const existing = state.geoEditDrafts[id]
				if (!existing) return {}
				const updatedDraft: GeoCollectionEditDraft = {
					...existing,
					sourceId: updates.sourceId ?? existing.sourceId,
					name: updates.name ?? existing.name,
					description: updates.description ?? existing.description,
					collectionMeta: updates.collectionMeta ?? existing.collectionMeta,
					features: updates.features ?? existing.features,
					selectedFeatureIds: updates.selectedFeatureIds ?? existing.selectedFeatureIds,
					updatedAt: Date.now(),
				}
				const nextDrafts = {
					...state.geoEditDrafts,
					[id]: updatedDraft,
				}
				const nextActiveId = state.activeGeoEditDraftId ?? id
				writePersistedGeoCollectionDraftState(nextDrafts, nextActiveId)
				return {
					geoEditDrafts: nextDrafts,
					activeGeoEditDraftId: nextActiveId,
				}
			}),

		loadGeoEditDraft: (id) => {
			const draft = get().geoEditDrafts[id]
			if (!draft) return
			const updatedDraft: GeoCollectionEditDraft = {
				...draft,
				updatedAt: Date.now(),
			}
			const nextDrafts = {
				...get().geoEditDrafts,
				[id]: updatedDraft,
			}
			set({
				activeGeoEditDraftId: id,
				collectionMeta: updatedDraft.collectionMeta,
				features: updatedDraft.features,
				selectedFeatureIds: updatedDraft.selectedFeatureIds,
				geoEditDrafts: nextDrafts,
			})
			writePersistedGeoCollectionDraftState(nextDrafts, id)
			const workspaceState = get()
			const activeWorkspace = workspaceState.activeWorkspaceId
				? workspaceState.workspaces[workspaceState.activeWorkspaceId]
				: null
			if (activeWorkspace?.sourceId === updatedDraft.sourceId) {
				get().touchActiveWorkspace({
					activeDraftId: id,
				})
			}
			get().updateStats()
		},

		deleteGeoEditDraft: (id) =>
			set((state) => {
				if (!state.geoEditDrafts[id]) return {}
				const nextDrafts = { ...state.geoEditDrafts }
				delete nextDrafts[id]

				let nextActiveId = state.activeGeoEditDraftId
				if (state.activeGeoEditDraftId === id) {
					const nextMostRecent = Object.values(nextDrafts).sort(
						(a, b) => b.updatedAt - a.updatedAt,
					)[0]
					nextActiveId = nextMostRecent?.id ?? null
				}

				writePersistedGeoCollectionDraftState(nextDrafts, nextActiveId)
				const activeWorkspace = state.activeWorkspaceId
					? state.workspaces[state.activeWorkspaceId]
					: null
				if (activeWorkspace?.activeDraftId === id) {
					queueMicrotask(() => {
						get().touchActiveWorkspace({ activeDraftId: null })
					})
				}
				return {
					geoEditDrafts: nextDrafts,
					activeGeoEditDraftId: nextActiveId,
				}
			}),
	}
}
