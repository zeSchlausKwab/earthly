import type { Map as MapLibreMap } from 'maplibre-gl'
import {
	buildPendingDatasetFeatureCommitInput,
	type PendingDatasetCommitInput,
} from '@/features/chat/safeEditing/pendingDiffCommit'
import { ensureDatasetDraftForMutation } from '@/features/geo-editor/authoringTaskBridge'
import { createAuthoring, type Authoring } from '@/features/geo-editor/api'
import { GeoEditor, type EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import type { CollectionMeta } from '@/features/geo-editor/types'
import type { ToolExecutionRunIdentity } from './types'

interface DatasetExecutionRuntime {
	runId: number
	chatId: string
	draftId: string
	workspaceId: string | null
	sourceId: string | null
	editor: GeoEditor
	collectionMeta: CollectionMeta
	lastCommittedFeatures: readonly EditorFeature[]
	lastCommittedFeaturesKey: string
	lastCommittedMetadata: CollectionMeta
	lastCommittedMetadataKey: string
	lastCommittedSelection: string[]
	lastCommittedSelectionKey: string
	lastPersistedFeatures: readonly EditorFeature[]
	lastPersistedFeaturesKey: string
	lastPersistedMetadataKey: string
	lastPersistedSelectionKey: string
}

let runtime: DatasetExecutionRuntime | null = null
let activeExecutionRun: ToolExecutionRunIdentity | null = null
const destroyedDetachedEditors = new WeakSet<GeoEditor>()

function destroyDetachedEditor(editor: GeoEditor): void {
	if (destroyedDetachedEditors.has(editor)) return
	destroyedDetachedEditors.add(editor)
	try {
		editor.destroy()
	} catch (error) {
		console.error('[Chat] Failed to destroy a detached Dataset editor', error)
	}
}

function destroyDetachedRuntime(): void {
	const currentRuntime = runtime
	// Clear ownership before invoking cleanup so a throwing or re-entrant destroy
	// can never destroy this editor twice.
	runtime = null
	if (currentRuntime) destroyDetachedEditor(currentRuntime.editor)
}

export class ToolExecutionTargetPersistenceError extends Error {
	readonly code: 'dataset_target_unavailable' | 'dataset_target_conflict'

	constructor(code: 'dataset_target_unavailable' | 'dataset_target_conflict', message: string) {
		super(message)
		this.name = 'ToolExecutionTargetPersistenceError'
		this.code = code
	}
}

function clone<T>(value: T): T {
	if (typeof structuredClone === 'function') return structuredClone(value)
	return JSON.parse(JSON.stringify(value)) as T
}

function serialize(value: unknown): string {
	return JSON.stringify(value)
}

/**
 * Project editor features onto the durable Dataset authoring surface.
 *
 * `GeoEditor.selectFeatures` materializes `properties.active` for rendering, so
 * that flag can change when selection is restored even though no Dataset
 * content changed. Keep every other GeoJSON property intact: only this known
 * presentation flag is outside the authoring/CAS boundary.
 */
function projectDurableFeatures(features: readonly EditorFeature[]): EditorFeature[] {
	return features.map((feature) => {
		if (!feature.properties || !Object.hasOwn(feature.properties, 'active')) return feature
		const properties = { ...feature.properties }
		delete properties.active
		return { ...feature, properties }
	})
}

function serializeFeatures(features: readonly EditorFeature[]): string {
	return serialize(projectDurableFeatures(features))
}

function serializeMetadata(metadata: CollectionMeta): string {
	return serialize({
		name: metadata.name,
		description: metadata.description,
		color: metadata.color,
		customProperties: Object.fromEntries(
			Object.entries(metadata.customProperties).sort(([left], [right]) =>
				left.localeCompare(right),
			),
		),
	})
}

function normalizeSelectedFeatureIds(
	selectedFeatureIds: readonly string[],
	features?: readonly EditorFeature[],
): string[] {
	const featureIds = features ? new Set(features.map((feature) => feature.id)) : null
	return [...new Set(selectedFeatureIds)]
		.filter((id) => !featureIds || featureIds.has(id))
		.sort((left, right) => left.localeCompare(right))
}

function serializeSelection(selectedFeatureIds: readonly string[]): string {
	return serialize(normalizeSelectedFeatureIds(selectedFeatureIds))
}

function draftContainsUpdates(
	draftId: string,
	updates: Parameters<ReturnType<typeof useEditorStore.getState>['saveGeoEditDraft']>[1],
): boolean {
	const draft = useEditorStore.getState().geoEditDrafts[draftId]
	if (!draft) return false
	return (
		(updates.features === undefined ||
			serializeFeatures(draft.features) === serializeFeatures(updates.features)) &&
		(updates.collectionMeta === undefined ||
			serializeMetadata(draft.collectionMeta) === serializeMetadata(updates.collectionMeta)) &&
		(updates.selectedFeatureIds === undefined ||
			serializeSelection(draft.selectedFeatureIds) ===
				serializeSelection(updates.selectedFeatureIds)) &&
		(updates.name === undefined || draft.name === updates.name) &&
		(updates.description === undefined || draft.description === updates.description)
	)
}

function getFeatureBounds(
	features: readonly EditorFeature[],
): [number, number, number, number] | null {
	let west = Number.POSITIVE_INFINITY
	let south = Number.POSITIVE_INFINITY
	let east = Number.NEGATIVE_INFINITY
	let north = Number.NEGATIVE_INFINITY
	const visit = (value: unknown): void => {
		if (Array.isArray(value)) {
			if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') {
				west = Math.min(west, value[0])
				south = Math.min(south, value[1])
				east = Math.max(east, value[0])
				north = Math.max(north, value[1])
				return
			}
			for (const item of value) visit(item)
			return
		}
		if (!value || typeof value !== 'object') return
		const geometry = value as { coordinates?: unknown; geometries?: unknown }
		visit(geometry.coordinates)
		visit(geometry.geometries)
	}
	for (const feature of features) visit(feature.geometry)
	return Number.isFinite(west) ? [west, south, east, north] : null
}

/** A renderless MapLibre surface used only for a run-bound local draft. */
function createDetachedMap(viewport: [number, number, number, number] | null): MapLibreMap {
	const dragPan = { enabled: true }
	const doubleClickZoom = { enabled: true }
	return {
		addSource: () => undefined,
		addLayer: () => undefined,
		removeLayer: () => undefined,
		removeSource: () => undefined,
		getSource: () => ({ setData: () => undefined }),
		getLayer: () => undefined,
		getStyle: () => undefined,
		getZoom: () => Number.NaN,
		getCenter: () =>
			viewport
				? { lat: (viewport[1] + viewport[3]) / 2, lng: (viewport[0] + viewport[2]) / 2 }
				: null,
		getBounds: () =>
			viewport
				? {
						getWest: () => viewport[0],
						getSouth: () => viewport[1],
						getEast: () => viewport[2],
						getNorth: () => viewport[3],
						toArray: () => [
							[viewport[0], viewport[1]],
							[viewport[2], viewport[3]],
						],
					}
				: null,
		getCanvas: () => ({
			style: { cursor: '' },
			clientWidth: 800,
			clientHeight: 600,
			width: 800,
			height: 600,
			getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
		}),
		project: (lngLat: [number, number]) => ({ x: lngLat[0], y: lngLat[1] }),
		unproject: (point: { x: number; y: number } | [number, number]) => ({
			lng: Array.isArray(point) ? point[0] : point.x,
			lat: Array.isArray(point) ? point[1] : point.y,
		}),
		queryRenderedFeatures: () => [],
		dragPan: {
			isEnabled: () => dragPan.enabled,
			enable: () => {
				dragPan.enabled = true
			},
			disable: () => {
				dragPan.enabled = false
			},
		},
		doubleClickZoom: {
			isEnabled: () => doubleClickZoom.enabled,
			enable: () => {
				doubleClickZoom.enabled = true
			},
			disable: () => {
				doubleClickZoom.enabled = false
			},
		},
		triggerRepaint: () => undefined,
		on: () => undefined,
		off: () => undefined,
		once: () => undefined,
	} as unknown as MapLibreMap
}

function ensureBrowserTimerSurface(): void {
	if (typeof window !== 'undefined') return
	;(globalThis as { window?: unknown }).window = {
		addEventListener: () => undefined,
		removeEventListener: () => undefined,
		setTimeout: globalThis.setTimeout.bind(globalThis),
		clearTimeout: globalThis.clearTimeout.bind(globalThis),
	}
}

/**
 * Snapshot the explicitly bound Dataset draft when Send is pressed. The detached
 * editor is deliberately not installed in Zustand, so changing the visible
 * workspace cannot retarget a later tool call or flash background geometry.
 */
export function prepareToolExecutionRun(run: ToolExecutionRunIdentity): void {
	if (activeExecutionRun?.runId === run.runId && activeExecutionRun.chatId === run.chatId) return
	destroyDetachedRuntime()
	activeExecutionRun = run
	const target = run.target
	if (target.entityType !== 'dataset' || !target.draftId) return
	const draft = useEditorStore.getState().geoEditDrafts[target.draftId]
	if (!draft || (target.sourceId !== null && draft.sourceId !== target.sourceId)) return

	let editor: GeoEditor | null = null
	try {
		ensureBrowserTimerSurface()
		editor = new GeoEditor(createDetachedMap(getFeatureBounds(draft.features)))
		// GeoEditor installs global keyboard listeners in its constructor. A
		// renderless background editor must become inert before any state is loaded
		// into it so shortcuts can only ever affect the visible editor.
		editor.setInteractionEnabled(false)
		const collectionMeta = clone(draft.collectionMeta)
		editor.setFeatures(clone(projectDurableFeatures(draft.features)))
		editor.selectFeatures([...draft.selectedFeatureIds])
		const committedFeatures = clone(projectDurableFeatures(editor.getAllFeatures()))
		const persistedFeatures = clone(projectDurableFeatures(draft.features))
		const committedSelection = normalizeSelectedFeatureIds(
			editor.getSelectedFeatures().map((feature) => feature.id),
			committedFeatures,
		)
		const nextRuntime: DatasetExecutionRuntime = {
			runId: run.runId,
			chatId: run.chatId,
			draftId: draft.id,
			workspaceId: target.workspaceId,
			sourceId: target.sourceId,
			editor,
			collectionMeta,
			lastCommittedFeatures: committedFeatures,
			lastCommittedFeaturesKey: serializeFeatures(committedFeatures),
			lastCommittedMetadata: collectionMeta,
			lastCommittedMetadataKey: serializeMetadata(collectionMeta),
			lastCommittedSelection: [...committedSelection],
			lastCommittedSelectionKey: serializeSelection(committedSelection),
			lastPersistedFeatures: persistedFeatures,
			lastPersistedFeaturesKey: serializeFeatures(persistedFeatures),
			lastPersistedMetadataKey: serializeMetadata(draft.collectionMeta),
			lastPersistedSelectionKey: serializeSelection(draft.selectedFeatureIds),
		}
		editor.setMetadataBridge(
			() => nextRuntime.collectionMeta,
			(meta) => {
				nextRuntime.collectionMeta = clone(meta)
			},
		)
		runtime = nextRuntime
	} catch (error) {
		console.error('[Chat] Failed to prepare the run-bound Dataset draft', error)
		if (editor) destroyDetachedEditor(editor)
		runtime = null
	}
}

export function getExecutionEditor(): GeoEditor | null {
	if (runtime) return runtime.editor
	return activeExecutionRun ? null : useEditorStore.getState().editor
}

export function getExecutionFeatures(): EditorFeature[] {
	if (runtime) return runtime.editor.getAllFeatures()
	return activeExecutionRun ? [] : useEditorStore.getState().features
}

export function getExecutionSelectedFeatureIds(): string[] {
	if (runtime) return runtime.editor.getSelectedFeatures().map((feature) => feature.id)
	return activeExecutionRun ? [] : useEditorStore.getState().selectedFeatureIds
}

export function createExecutionAuthoring(editor: GeoEditor): Authoring {
	if (!runtime || runtime.editor !== editor) return createAuthoring(editor)
	return createAuthoring(editor, {
		getCollectionMeta: () => runtime?.collectionMeta ?? useEditorStore.getState().collectionMeta,
		setCollectionMeta: (meta) => {
			if (runtime) runtime.collectionMeta = clone(meta)
		},
	})
}

function invalidateRuntimeAndThrow(error: unknown): never {
	destroyDetachedRuntime()
	throw error
}

/** Discard only the current tool's uncommitted detached mutations. */
export function rollbackToolExecutionRun(run: ToolExecutionRunIdentity | undefined): void {
	if (!run || !runtime || runtime.runId !== run.runId || runtime.chatId !== run.chatId) return
	const currentRuntime = runtime
	try {
		currentRuntime.editor.setFeatures(clone([...currentRuntime.lastCommittedFeatures]))
		currentRuntime.editor.selectFeatures([...currentRuntime.lastCommittedSelection])
		currentRuntime.collectionMeta = clone(currentRuntime.lastCommittedMetadata)
	} catch (error) {
		// A runtime that cannot be restored is unsafe to reuse. Keep the durable
		// draft intact and force later calls in this run to fail closed.
		console.error('[Chat] Failed to restore a detached Dataset after a tool error', error)
		destroyDetachedRuntime()
	}
}

function mirrorCommitToVisibleEditor(
	currentRuntime: DatasetExecutionRuntime,
	changed: { features: boolean; metadata: boolean; selection: boolean },
): void {
	const latest = useEditorStore.getState()
	const stillVisible =
		latest.activeGeoEditDraftId === currentRuntime.draftId &&
		(currentRuntime.workspaceId === null || latest.activeWorkspaceId === currentRuntime.workspaceId)
	if (!stillVisible) return

	// Draft persistence is the commit boundary. The live map is only a mirror of
	// that durable result, so a rendering/subscriber failure must never turn a
	// successful save into a retryable tool failure.
	if (changed.features) {
		try {
			latest.editor?.setFeatures(clone([...currentRuntime.lastCommittedFeatures]))
		} catch (error) {
			console.error('[Chat] Failed to mirror committed Dataset features to the map', error)
		}
	}
	if (changed.features || changed.selection) {
		try {
			// setFeatures deliberately receives the durable projection without
			// `active`; restore selection afterward so only the live editor
			// materializes that presentation flag.
			latest.editor?.selectFeatures([...currentRuntime.lastCommittedSelection])
		} catch (error) {
			console.error('[Chat] Failed to mirror committed Dataset selection to the map', error)
		}
	}

	try {
		useEditorStore.setState({
			...(changed.features ? { features: clone([...currentRuntime.lastCommittedFeatures]) } : {}),
			...(changed.selection
				? { selectedFeatureIds: [...currentRuntime.lastCommittedSelection] }
				: {}),
			...(changed.metadata ? { collectionMeta: clone(currentRuntime.lastCommittedMetadata) } : {}),
			isDirty: true,
		})
		if (changed.features) useEditorStore.getState().updateStats()
	} catch (error) {
		console.error('[Chat] Failed to reconcile the visible Dataset store after commit', error)
	}
}

/** Persist one completed tool call to its owning draft, never the visible draft. */
export function persistToolExecutionRun(
	run: ToolExecutionRunIdentity | undefined,
): PendingDatasetCommitInput | null {
	if (!run || !runtime || runtime.runId !== run.runId || runtime.chatId !== run.chatId) return null
	const currentRuntime = runtime
	const features = projectDurableFeatures(currentRuntime.editor.getAllFeatures())
	const selectedFeatureIds = normalizeSelectedFeatureIds(
		currentRuntime.editor.getSelectedFeatures().map((feature) => feature.id),
		features,
	)
	const featuresKey = serializeFeatures(features)
	const metadataKey = serializeMetadata(currentRuntime.collectionMeta)
	const selectionKey = serializeSelection(selectedFeatureIds)
	const featuresChanged = featuresKey !== currentRuntime.lastCommittedFeaturesKey
	const metadataChanged = metadataKey !== currentRuntime.lastCommittedMetadataKey
	const selectionChanged = selectionKey !== currentRuntime.lastCommittedSelectionKey
	if (!featuresChanged && !metadataChanged && !selectionChanged) return null

	const state = useEditorStore.getState()
	const draft = state.geoEditDrafts[currentRuntime.draftId]
	const workspace = currentRuntime.workspaceId ? state.workspaces[currentRuntime.workspaceId] : null
	if (
		run.target.entityType !== 'dataset' ||
		run.target.draftId !== currentRuntime.draftId ||
		run.target.workspaceId !== currentRuntime.workspaceId ||
		run.target.sourceId !== currentRuntime.sourceId ||
		!draft ||
		(currentRuntime.sourceId !== null && draft.sourceId !== currentRuntime.sourceId) ||
		(currentRuntime.workspaceId !== null &&
			(!workspace ||
				(currentRuntime.sourceId !== null && workspace.sourceId !== currentRuntime.sourceId)))
	) {
		return invalidateRuntimeAndThrow(
			new ToolExecutionTargetPersistenceError(
				'dataset_target_unavailable',
				'The bound Dataset draft or workspace was removed while this AI tool was working. Its result was not applied.',
			),
		)
	}

	// Selection is a dependent field of geometry in both directions. An AI
	// selection is normalized against the durable feature set; a geometry-only
	// tool preserves the user's current selection while dropping deleted ids.
	const finalPersistedFeatures = featuresChanged ? features : draft.features
	const selectionAfter = normalizeSelectedFeatureIds(
		selectionChanged ? selectedFeatureIds : draft.selectedFeatureIds,
		finalPersistedFeatures,
	)
	const selectionWriteNeeded =
		serializeSelection(selectionAfter) !== serializeSelection(draft.selectedFeatureIds)

	// Compare-and-swap only the fields this tool actually changed. Passive UI
	// mirrors and disjoint user edits may advance the draft timestamp without
	// invalidating this write; a concurrent change to the same field is a real
	// conflict and must never be overwritten by the detached snapshot.
	const hasFieldConflict =
		((featuresChanged || selectionChanged) &&
			serializeFeatures(draft.features) !== currentRuntime.lastPersistedFeaturesKey) ||
		(metadataChanged &&
			serializeMetadata(draft.collectionMeta) !== currentRuntime.lastPersistedMetadataKey) ||
		(selectionChanged &&
			serializeSelection(draft.selectedFeatureIds) !== currentRuntime.lastPersistedSelectionKey)
	if (hasFieldConflict) {
		return invalidateRuntimeAndThrow(
			new ToolExecutionTargetPersistenceError(
				'dataset_target_conflict',
				'The bound Dataset changed while this AI tool was working. Its result was not applied; retry against the latest draft.',
			),
		)
	}

	const updates: Parameters<typeof state.saveGeoEditDraft>[1] = {}
	if (featuresChanged) updates.features = clone(features)
	if (metadataChanged) {
		updates.collectionMeta = clone(currentRuntime.collectionMeta)
		// GeoCollectionEditDraft keeps these display fields denormalized for draft
		// navigation. A background target may not be the visible editor, so the
		// metadata surface cannot be relied on to mirror them after persistence.
		updates.name = currentRuntime.collectionMeta.name
		updates.description = currentRuntime.collectionMeta.description
	}
	if (selectionWriteNeeded) updates.selectedFeatureIds = [...selectionAfter]

	const featureCommit = featuresChanged
		? buildPendingDatasetFeatureCommitInput(currentRuntime.lastPersistedFeatures, features)
		: null
	const commit: PendingDatasetCommitInput = {
		target: clone(run.target),
		fields: {
			...(featureCommit ? { features: featureCommit } : {}),
			...(metadataChanged
				? {
						collectionMeta: {
							before: clone(draft.collectionMeta),
							after: clone(currentRuntime.collectionMeta),
						},
					}
				: {}),
			...(selectionWriteNeeded
				? {
						selectedFeatureIds: {
							before: [...draft.selectedFeatureIds],
							after: [...selectionAfter],
						},
					}
				: {}),
		},
	}

	try {
		state.saveGeoEditDraft(currentRuntime.draftId, updates)
	} catch (error) {
		if (!draftContainsUpdates(currentRuntime.draftId, updates)) {
			return invalidateRuntimeAndThrow(error)
		}
		// Zustand listeners run after state replacement. If a listener throws, the
		// draft may already contain the complete durable commit; keep that success
		// and treat the observer failure like any other best-effort mirror failure.
		console.error('[Chat] Dataset draft committed despite a save observer failure', error)
	}

	const savedDraft = useEditorStore.getState().geoEditDrafts[currentRuntime.draftId]
	if (featuresChanged) {
		currentRuntime.lastCommittedFeatures = clone(features)
		currentRuntime.lastCommittedFeaturesKey = featuresKey
		currentRuntime.lastPersistedFeatures = clone(
			projectDurableFeatures(savedDraft?.features ?? features),
		)
		currentRuntime.lastPersistedFeaturesKey = featuresKey
	}
	if (metadataChanged) {
		currentRuntime.lastCommittedMetadata = clone(currentRuntime.collectionMeta)
		currentRuntime.lastCommittedMetadataKey = metadataKey
		currentRuntime.lastPersistedMetadataKey = metadataKey
	}
	if (selectionWriteNeeded) {
		currentRuntime.lastCommittedSelection = [...selectionAfter]
		currentRuntime.lastCommittedSelectionKey = serializeSelection(selectionAfter)
		currentRuntime.lastPersistedSelectionKey = serializeSelection(selectionAfter)
		try {
			currentRuntime.editor.selectFeatures([...selectionAfter])
		} catch (error) {
			console.error('[Chat] Failed to reconcile detached selection after commit', error)
			destroyDetachedRuntime()
		}
	}

	mirrorCommitToVisibleEditor(currentRuntime, {
		features: featuresChanged,
		metadata: metadataChanged,
		selection: selectionWriteNeeded,
	})
	return commit
}

export function isToolExecutionTargetVisible(run: ToolExecutionRunIdentity | undefined): boolean {
	if (run?.target.entityType !== 'dataset') return true
	const state = useEditorStore.getState()
	const workspace = run.target.workspaceId ? state.workspaces[run.target.workspaceId] : null
	const draft = run.target.draftId ? state.geoEditDrafts[run.target.draftId] : null
	return (
		state.activeWorkspaceId === run.target.workspaceId &&
		state.activeGeoEditDraftId === run.target.draftId &&
		workspace?.activeDraftId === run.target.draftId &&
		draft?.sourceId === run.target.sourceId &&
		workspace.sourceId === run.target.sourceId
	)
}

export function releaseToolExecutionRun(runId?: number): void {
	if (runId !== undefined && activeExecutionRun?.runId !== runId) return
	destroyDetachedRuntime()
	activeExecutionRun = null
}

export function hasPreparedDatasetExecutionTarget(
	run: ToolExecutionRunIdentity | undefined,
): boolean {
	return Boolean(run && runtime?.runId === run.runId && runtime.chatId === run.chatId)
}

export async function ensureExecutionTargetForMutation(
	run?: ToolExecutionRunIdentity,
): Promise<void> {
	if (runtime) {
		if (!run || (runtime.runId === run.runId && runtime.chatId === run.chatId)) return
		throw new ToolExecutionTargetPersistenceError(
			'dataset_target_unavailable',
			'The Dataset target for this tool run is no longer available.',
		)
	}
	if (run) {
		throw new ToolExecutionTargetPersistenceError(
			'dataset_target_unavailable',
			'The Dataset target for this tool run was released before its result completed.',
		)
	}
	await ensureDatasetDraftForMutation()
}
