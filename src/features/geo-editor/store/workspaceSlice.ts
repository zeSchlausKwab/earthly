import type { StateCreator } from 'zustand'
import { readPersistedGeoCollectionDraftState } from './draftSlice'
import { readScopedStorage, writeScopedStorage } from './persistence'
import type { EditorState, GeoEditorWorkspace, WorkspaceSlice } from './types'

interface PersistedWorkspaceState {
	workspaces: Record<string, GeoEditorWorkspace>
	activeWorkspaceId: string | null
}

const GEO_EDITOR_WORKSPACES_STORAGE_KEY = 'earthly:geo-editor:workspaces:v1'

function createWorkspaceId() {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `workspace-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeWorkspaceLabel(
	label: string | null | undefined,
	kind: GeoEditorWorkspace['kind'],
) {
	const trimmed = label?.trim()
	if (trimmed) return trimmed
	return kind === 'dataset' ? 'Dataset workspace' : 'Untitled'
}

function inferDatasetKeyFromSourceId(sourceId: string): string | null {
	if (!sourceId.startsWith('dataset:')) return null
	const datasetKey = sourceId.slice('dataset:'.length).trim()
	return datasetKey || null
}

function buildWorkspaceMigrationState(pubkey?: string | null): PersistedWorkspaceState {
	const persistedDrafts = readPersistedGeoCollectionDraftState(pubkey)
	const draftsBySource = new Map<string, import('./types').GeoCollectionEditDraft[]>()

	Object.values(persistedDrafts.drafts).forEach((draft) => {
		const existing = draftsBySource.get(draft.sourceId) ?? []
		existing.push(draft)
		draftsBySource.set(draft.sourceId, existing)
	})

	const workspaces: Record<string, GeoEditorWorkspace> = {}
	let activeWorkspaceId: string | null = null

	for (const [sourceId, drafts] of draftsBySource.entries()) {
		const sortedDrafts = [...drafts].sort((a, b) => b.updatedAt - a.updatedAt)
		const latestDraft = sortedDrafts[0]
		if (!latestDraft) continue

		const kind: GeoEditorWorkspace['kind'] = sourceId.startsWith('dataset:') ? 'dataset' : 'scratch'
		const workspaceId = createWorkspaceId()
		const workspace: GeoEditorWorkspace = {
			id: workspaceId,
			sourceId,
			label: normalizeWorkspaceLabel(latestDraft.collectionMeta.name || latestDraft.name, kind),
			kind,
			datasetKey: inferDatasetKeyFromSourceId(sourceId),
			activeDraftId: latestDraft.id,
			chatSessionId: null,
			createdAt: latestDraft.createdAt,
			updatedAt: latestDraft.updatedAt,
		}
		workspaces[workspaceId] = workspace

		if (persistedDrafts.activeDraftId && latestDraft.id === persistedDrafts.activeDraftId) {
			activeWorkspaceId = workspaceId
		}
	}

	if (!activeWorkspaceId) {
		activeWorkspaceId =
			Object.values(workspaces).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
	}

	return { workspaces, activeWorkspaceId }
}

function dedupeWorkspacesBySourceId(
	workspaces: Record<string, GeoEditorWorkspace>,
	activeWorkspaceId: string | null,
): PersistedWorkspaceState {
	const groupedBySourceId = new Map<string, GeoEditorWorkspace[]>()

	Object.values(workspaces).forEach((workspace) => {
		const existing = groupedBySourceId.get(workspace.sourceId) ?? []
		existing.push(workspace)
		groupedBySourceId.set(workspace.sourceId, existing)
	})

	const deduped: Record<string, GeoEditorWorkspace> = {}
	let nextActiveWorkspaceId: string | null = null

	groupedBySourceId.forEach((group) => {
		const sorted = [...group].sort((a, b) => b.updatedAt - a.updatedAt)
		const preferred = sorted.find((workspace) => workspace.id === activeWorkspaceId) ?? sorted[0]
		if (!preferred) return

		const mergedWorkspace: GeoEditorWorkspace = {
			...preferred,
			label: normalizeWorkspaceLabel(preferred.label, preferred.kind),
			datasetKey:
				preferred.datasetKey ??
				sorted.find((workspace) => workspace.datasetKey)?.datasetKey ??
				inferDatasetKeyFromSourceId(preferred.sourceId),
			activeDraftId:
				preferred.activeDraftId ??
				sorted.find((workspace) => workspace.activeDraftId)?.activeDraftId ??
				null,
			chatSessionId:
				preferred.chatSessionId ??
				sorted.find((workspace) => workspace.chatSessionId)?.chatSessionId ??
				null,
			createdAt: Math.min(...sorted.map((workspace) => workspace.createdAt)),
			updatedAt: Math.max(...sorted.map((workspace) => workspace.updatedAt)),
		}

		deduped[mergedWorkspace.id] = mergedWorkspace

		if (
			preferred.id === activeWorkspaceId ||
			sorted.some((workspace) => workspace.id === activeWorkspaceId)
		) {
			nextActiveWorkspaceId = mergedWorkspace.id
		}
	})

	if (!nextActiveWorkspaceId) {
		nextActiveWorkspaceId =
			Object.values(deduped).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
	}

	return {
		workspaces: deduped,
		activeWorkspaceId: nextActiveWorkspaceId,
	}
}

export function readPersistedWorkspaceState(pubkey?: string | null): PersistedWorkspaceState {
	try {
		const parsed = readScopedStorage<Partial<PersistedWorkspaceState> | null>(
			GEO_EDITOR_WORKSPACES_STORAGE_KEY,
			null,
			pubkey,
		)
		if (!parsed || typeof parsed !== 'object') return buildWorkspaceMigrationState(pubkey)

		const rawWorkspaces =
			parsed.workspaces &&
			typeof parsed.workspaces === 'object' &&
			!Array.isArray(parsed.workspaces)
				? (parsed.workspaces as Record<string, unknown>)
				: {}
		const workspaces: Record<string, GeoEditorWorkspace> = {}

		for (const [workspaceId, rawWorkspace] of Object.entries(rawWorkspaces)) {
			if (!rawWorkspace || typeof rawWorkspace !== 'object') continue
			const record = rawWorkspace as Record<string, unknown>
			const kind = record.kind === 'dataset' ? 'dataset' : 'scratch'
			const createdAt = typeof record.createdAt === 'number' ? record.createdAt : Date.now()
			workspaces[workspaceId] = {
				id: typeof record.id === 'string' ? record.id : workspaceId,
				sourceId: typeof record.sourceId === 'string' ? record.sourceId : '__unknown__',
				label: normalizeWorkspaceLabel(typeof record.label === 'string' ? record.label : '', kind),
				kind,
				datasetKey: typeof record.datasetKey === 'string' ? record.datasetKey : null,
				activeDraftId: typeof record.activeDraftId === 'string' ? record.activeDraftId : null,
				chatSessionId: typeof record.chatSessionId === 'string' ? record.chatSessionId : null,
				createdAt,
				updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : createdAt,
			}
		}

		const activeWorkspaceId =
			typeof parsed.activeWorkspaceId === 'string' && workspaces[parsed.activeWorkspaceId]
				? parsed.activeWorkspaceId
				: (Object.values(workspaces).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null)

		return dedupeWorkspacesBySourceId(workspaces, activeWorkspaceId)
	} catch (error) {
		console.warn('Failed to read geo editor workspaces from scoped storage', error)
		return buildWorkspaceMigrationState(pubkey)
	}
}

function writePersistedWorkspaceState(
	workspaces: Record<string, GeoEditorWorkspace>,
	activeWorkspaceId: string | null,
) {
	writeScopedStorage(GEO_EDITOR_WORKSPACES_STORAGE_KEY, { workspaces, activeWorkspaceId })
}

export const createWorkspaceSlice: StateCreator<EditorState, [], [], WorkspaceSlice> = (
	set,
	get,
) => {
	const persisted = readPersistedWorkspaceState()

	return {
		workspaces: persisted.workspaces,
		activeWorkspaceId: persisted.activeWorkspaceId,

		createWorkspace: (input) => {
			const existingWorkspace = Object.values(get().workspaces).find(
				(workspace) => workspace.sourceId === input.sourceId,
			)
			const workspaceId = createWorkspaceId()
			const now = Date.now()
			if (existingWorkspace) {
				const nextWorkspace: GeoEditorWorkspace = {
					...existingWorkspace,
					label: normalizeWorkspaceLabel(input.label || existingWorkspace.label, input.kind),
					kind: input.kind,
					datasetKey:
						input.datasetKey ??
						existingWorkspace.datasetKey ??
						inferDatasetKeyFromSourceId(input.sourceId),
					activeDraftId: input.activeDraftId ?? existingWorkspace.activeDraftId,
					chatSessionId: input.chatSessionId ?? existingWorkspace.chatSessionId,
					updatedAt: now,
				}
				const nextWorkspaces = {
					...get().workspaces,
					[existingWorkspace.id]: nextWorkspace,
				}
				set({
					workspaces: nextWorkspaces,
					activeWorkspaceId: existingWorkspace.id,
				})
				writePersistedWorkspaceState(nextWorkspaces, existingWorkspace.id)
				return existingWorkspace.id
			}
			const workspace: GeoEditorWorkspace = {
				id: workspaceId,
				sourceId: input.sourceId,
				label: normalizeWorkspaceLabel(input.label, input.kind),
				kind: input.kind,
				datasetKey: input.datasetKey ?? inferDatasetKeyFromSourceId(input.sourceId),
				activeDraftId: input.activeDraftId ?? null,
				chatSessionId: input.chatSessionId ?? null,
				createdAt: now,
				updatedAt: now,
			}
			const nextWorkspaces = {
				...get().workspaces,
				[workspaceId]: workspace,
			}
			set({
				workspaces: nextWorkspaces,
				activeWorkspaceId: workspaceId,
			})
			writePersistedWorkspaceState(nextWorkspaces, workspaceId)
			return workspaceId
		},

		updateWorkspace: (id, updates) =>
			set((state) => {
				const existing = state.workspaces[id]
				if (!existing) return {}
				const nextWorkspace: GeoEditorWorkspace = {
					...existing,
					...updates,
					label: normalizeWorkspaceLabel(updates.label ?? existing.label, existing.kind),
					updatedAt: Date.now(),
				}
				const nextWorkspaces = {
					...state.workspaces,
					[id]: nextWorkspace,
				}
				writePersistedWorkspaceState(nextWorkspaces, state.activeWorkspaceId)
				return { workspaces: nextWorkspaces }
			}),

		deleteWorkspace: (id) =>
			set((state) => {
				if (!state.workspaces[id]) return {}
				const nextWorkspaces = { ...state.workspaces }
				delete nextWorkspaces[id]
				const nextActiveWorkspaceId =
					state.activeWorkspaceId === id
						? (Object.values(nextWorkspaces).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ??
							null)
						: state.activeWorkspaceId
				writePersistedWorkspaceState(nextWorkspaces, nextActiveWorkspaceId)
				return {
					workspaces: nextWorkspaces,
					activeWorkspaceId: nextActiveWorkspaceId,
				}
			}),

		setActiveWorkspaceId: (id) =>
			set((state) => {
				const nextActiveId = id && state.workspaces[id] ? id : null
				writePersistedWorkspaceState(state.workspaces, nextActiveId)
				return { activeWorkspaceId: nextActiveId }
			}),

		touchActiveWorkspace: (updates) =>
			set((state) => {
				if (!state.activeWorkspaceId) return {}
				const existing = state.workspaces[state.activeWorkspaceId]
				if (!existing) return {}
				const nextWorkspace: GeoEditorWorkspace = {
					...existing,
					...(updates ?? {}),
					label: normalizeWorkspaceLabel(updates?.label ?? existing.label, existing.kind),
					updatedAt: Date.now(),
				}
				const nextWorkspaces = {
					...state.workspaces,
					[state.activeWorkspaceId]: nextWorkspace,
				}
				writePersistedWorkspaceState(nextWorkspaces, state.activeWorkspaceId)
				return { workspaces: nextWorkspaces }
			}),
	}
}
