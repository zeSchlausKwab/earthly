import type { StateCreator } from 'zustand'
import type { EditorFeature } from '../core'
import type { CollectionMeta, EditorBlobReference } from '../types'
import { createDefaultCollectionMeta } from '../utils'
import { writePersistedGeoCollectionDraftState } from './editorCoreSlice'
import { readScopedStorage } from './persistence'
import type { DraftSlice, EditorState, GeoCollectionEditDraft, PublishChannel } from './types'

export interface PersistedGeoCollectionDraftState {
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

export const normalizePublishChannel = (
	value: unknown,
	fallback: PublishChannel = { kind: 'public' },
): PublishChannel => {
	if (!value || typeof value !== 'object') return fallback
	const asRecord = value as Record<string, unknown>
	if (asRecord.kind === 'public') return { kind: 'public' }
	if (
		asRecord.kind === 'unresolved' &&
		(asRecord.reason === 'legacy' || asRecord.reason === 'invalid')
	) {
		return { kind: 'unresolved', reason: asRecord.reason }
	}
	if (
		(asRecord.kind === 'private-group' || asRecord.kind === 'field-session') &&
		typeof asRecord.id === 'string' &&
		asRecord.id.trim()
	) {
		return { kind: asRecord.kind, id: asRecord.id.trim() }
	}
	return fallback
}

export const normalizeDraftContextRefs = (value: unknown): string[] => {
	if (!Array.isArray(value)) return []
	return [
		...new Set(
			value
				.filter((reference): reference is string => typeof reference === 'string')
				.map((reference) => reference.trim())
				.filter(Boolean),
		),
	]
}

const readOptionalString = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	return trimmed || undefined
}

const readOptionalNonNegativeNumber = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/**
 * Keep only the durable part of an editor blob reference. In particular,
 * `previewCollection` can contain an entire second copy of the GeoJSON and is
 * intentionally never written into localStorage.
 */
export const normalizeDraftBlobReferences = (value: unknown): EditorBlobReference[] => {
	if (!Array.isArray(value)) return []
	const seenIds = new Set<string>()
	const normalized: EditorBlobReference[] = []

	for (const [index, rawReference] of value.entries()) {
		if (!rawReference || typeof rawReference !== 'object') continue
		const asRecord = rawReference as Record<string, unknown>
		if (asRecord.scope !== 'collection' && asRecord.scope !== 'feature') continue
		const url = readOptionalString(asRecord.url)
		if (!url) continue

		const featureId = readOptionalString(asRecord.featureId)
		const providedId = readOptionalString(asRecord.id)
		let id =
			providedId ??
			`draft-blob:${asRecord.scope}:${featureId ?? 'collection'}:${readOptionalString(asRecord.sha256) ?? url}`
		if (seenIds.has(id)) id = `${id}:${index}`
		seenIds.add(id)

		// Loading is a process state, not a recoverable state. A durable URL can
		// always be fetched again after reload, so only a useful error survives;
		// everything else resumes as ready.
		const status = asRecord.status === 'error' ? 'error' : 'ready'
		const reference: EditorBlobReference = {
			id,
			scope: asRecord.scope,
			url,
			status,
		}
		if (featureId) reference.featureId = featureId
		const sha256 = readOptionalString(asRecord.sha256)
		if (sha256) reference.sha256 = sha256
		const size = readOptionalNonNegativeNumber(asRecord.size)
		if (size !== undefined) reference.size = size
		const mimeType = readOptionalString(asRecord.mimeType)
		if (mimeType) reference.mimeType = mimeType
		const error = readOptionalString(asRecord.error)
		if (error) reference.error = error
		const featureCount = readOptionalNonNegativeNumber(asRecord.featureCount)
		if (featureCount !== undefined) reference.featureCount = featureCount
		if (Array.isArray(asRecord.geometryTypes)) {
			reference.geometryTypes = [
				...new Set(
					asRecord.geometryTypes.filter(
						(geometryType): geometryType is string => typeof geometryType === 'string',
					),
				),
			]
		}
		normalized.push(reference)
	}

	return normalized
}

export const normalizePersistedGeoCollectionDraftState = (
	parsed: unknown,
): PersistedGeoCollectionDraftState => {
	if (!parsed || typeof parsed !== 'object') return { drafts: {}, activeDraftId: null }
	const persisted = parsed as Partial<PersistedGeoCollectionDraftState>
	const rawDrafts =
		persisted.drafts && typeof persisted.drafts === 'object' && !Array.isArray(persisted.drafts)
			? (persisted.drafts as Record<string, unknown>)
			: {}
	const drafts: Record<string, GeoCollectionEditDraft> = {}
	for (const [draftId, rawDraft] of Object.entries(rawDrafts)) {
		if (!rawDraft || typeof rawDraft !== 'object') continue
		const asRecord = rawDraft as Record<string, unknown>
		const createdAt = typeof asRecord.createdAt === 'number' ? asRecord.createdAt : Date.now()
		const hasVersionTwoFields =
			(typeof asRecord.persistenceVersion === 'number' && asRecord.persistenceVersion >= 2) ||
			Object.hasOwn(asRecord, 'publishChannel') ||
			Object.hasOwn(asRecord, 'contextRefs') ||
			Object.hasOwn(asRecord, 'blobReferences')
		const normalized: GeoCollectionEditDraft = {
			persistenceVersion: hasVersionTwoFields ? 2 : 1,
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
			publishChannel: hasVersionTwoFields
				? normalizePublishChannel(asRecord.publishChannel, {
						kind: 'unresolved',
						reason: 'invalid',
					})
				: { kind: 'unresolved', reason: 'legacy' },
			contextRefs: normalizeDraftContextRefs(asRecord.contextRefs),
			blobReferences: normalizeDraftBlobReferences(asRecord.blobReferences),
			createdAt,
			updatedAt: typeof asRecord.updatedAt === 'number' ? asRecord.updatedAt : createdAt,
		}
		drafts[normalized.id] = normalized
	}
	const requestedActiveDraftId =
		typeof persisted.activeDraftId === 'string' ? persisted.activeDraftId : null
	const activeDraftId =
		requestedActiveDraftId && drafts[requestedActiveDraftId] ? requestedActiveDraftId : null
	return { drafts, activeDraftId }
}

export const readPersistedGeoCollectionDraftState = (
	pubkey?: string | null,
): PersistedGeoCollectionDraftState => {
	try {
		const parsed = readScopedStorage<unknown>(GEO_COLLECTION_DRAFTS_STORAGE_KEY, null, pubkey)
		return normalizePersistedGeoCollectionDraftState(parsed)
	} catch (error) {
		console.warn('Failed to read geo collection drafts from scoped storage', error)
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

		createGeoEditDraft: (sourceId, seed, options) => {
			const id = createGeoDraftId()
			const now = Date.now()
			const state = get()
			const activate = options?.activate !== false
			const draft: GeoCollectionEditDraft = {
				persistenceVersion: 2,
				id,
				sourceId,
				name: seed?.name ?? '',
				description: seed?.description ?? '',
				collectionMeta: seed?.collectionMeta ?? state.collectionMeta,
				features: seed?.features ?? state.features,
				selectedFeatureIds: seed?.selectedFeatureIds ?? state.selectedFeatureIds,
				publishChannel: normalizePublishChannel(seed?.publishChannel),
				contextRefs: normalizeDraftContextRefs(seed?.contextRefs ?? state.activeDatasetContextRefs),
				blobReferences: normalizeDraftBlobReferences(seed?.blobReferences ?? state.blobReferences),
				createdAt: now,
				updatedAt: now,
			}
			const nextDrafts = {
				...state.geoEditDrafts,
				[id]: draft,
			}
			set({
				geoEditDrafts: nextDrafts,
				...(activate ? { activeGeoEditDraftId: id } : {}),
			})
			writePersistedGeoCollectionDraftState(nextDrafts, activate ? id : state.activeGeoEditDraftId)
			if (!activate) return id
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
					persistenceVersion: 2,
					sourceId: updates.sourceId ?? existing.sourceId,
					name: updates.name ?? existing.name,
					description: updates.description ?? existing.description,
					collectionMeta: updates.collectionMeta ?? existing.collectionMeta,
					features: updates.features ?? existing.features,
					selectedFeatureIds: updates.selectedFeatureIds ?? existing.selectedFeatureIds,
					publishChannel: normalizePublishChannel(
						updates.publishChannel ?? existing.publishChannel,
					),
					contextRefs:
						updates.contextRefs === undefined
							? existing.contextRefs
							: normalizeDraftContextRefs(updates.contextRefs),
					blobReferences:
						updates.blobReferences === undefined
							? existing.blobReferences
							: normalizeDraftBlobReferences(updates.blobReferences),
					updatedAt: Date.now(),
				}
				const nextDrafts = {
					...state.geoEditDrafts,
					[id]: updatedDraft,
				}
				// Updating metadata on a listed (inactive) draft must not activate it.
				// Activation is a separate operation that also restores the editor,
				// workspace, attachments, and source identity atomically.
				const nextActiveId = state.activeGeoEditDraftId
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
				activeDatasetContextRefs: [...updatedDraft.contextRefs],
				blobReferences: normalizeDraftBlobReferences(updatedDraft.blobReferences),
				previewingBlobReferenceId: null,
				blobPreviewCollection: null,
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
						get().updateWorkspace(activeWorkspace.id, { activeDraftId: null })
					})
				}
				return {
					geoEditDrafts: nextDrafts,
					activeGeoEditDraftId: nextActiveId,
				}
			}),

		deleteGeoEditDraftsBySourceId: (sourceId) =>
			set((state) => {
				const removedIds = new Set(
					Object.values(state.geoEditDrafts)
						.filter((draft) => draft.sourceId === sourceId)
						.map((draft) => draft.id),
				)
				if (removedIds.size === 0) return {}

				const nextDrafts = Object.fromEntries(
					Object.entries(state.geoEditDrafts).filter(([draftId]) => !removedIds.has(draftId)),
				)
				let nextActiveId = state.activeGeoEditDraftId
				if (nextActiveId && removedIds.has(nextActiveId)) {
					const nextMostRecent = Object.values(nextDrafts).sort(
						(a, b) => b.updatedAt - a.updatedAt,
					)[0]
					nextActiveId = nextMostRecent?.id ?? null
				}

				writePersistedGeoCollectionDraftState(nextDrafts, nextActiveId)
				const affectedWorkspaceIds = Object.values(state.workspaces)
					.filter(
						(workspace) =>
							workspace.activeDraftId !== null && removedIds.has(workspace.activeDraftId),
					)
					.map((workspace) => workspace.id)
				if (affectedWorkspaceIds.length > 0) {
					queueMicrotask(() => {
						for (const workspaceId of affectedWorkspaceIds) {
							get().updateWorkspace(workspaceId, { activeDraftId: null })
						}
					})
				}

				return {
					geoEditDrafts: nextDrafts,
					activeGeoEditDraftId: nextActiveId,
				}
			}),
	}
}
