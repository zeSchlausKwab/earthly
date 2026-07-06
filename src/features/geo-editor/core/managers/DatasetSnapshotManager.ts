import type { Map as MapLibreMap } from 'maplibre-gl'
import type { CollectionMeta } from '../../types'
import type { EditorFeature, IManager } from '../types'

/**
 * One dataset-level snapshot: the full editor state BEFORE a confirmed AI apply.
 *
 * Distinct from `HistoryManager`'s `HistoryAction` — it additionally carries the
 * FeatureCollection-level `collectionMeta` (name/description/color/customProperties)
 * so an apply that renames a dataset or restyles a feature is reversible as ONE
 * undo step (SAFE-06 / D-10 / D-11). HistoryManager is geometry-only.
 */
export interface DatasetSnapshot {
	/**
	 * The feature set at snapshot time. Each entry is a SHALLOW copy (`{...f}`) of
	 * the live `EditorFeature` — the same ceiling `HistoryManager` already lives
	 * under. Nested geometry/coordinate arrays are shared BY REFERENCE (no deep
	 * clone — that would reintroduce the Phase-4 OOM class, Pitfall 3). The shallow
	 * top-level copy decouples the snapshot from later in-place `feature.properties`
	 * reassignments (`GeoEditor.updateActiveStates`, A1 defence).
	 */
	features: EditorFeature[]
	/** FeatureCollection-level metadata captured at snapshot time (shallow copy, D-10). */
	collectionMeta: CollectionMeta
	/** Human-readable label for the apply this snapshot precedes (e.g. the tool name). */
	label: string
	/** Wall-clock time the snapshot was taken (ordered-timeline precedence, Open Q 2). */
	timestamp: number
}

/**
 * A SEPARATE, bounded snapshot/undo stack for dataset-level AI applies (D-10).
 *
 * Mirrors `HistoryManager`'s class shape (the `IManager` interface, a bounded
 * private array with shift-on-overflow) but stores `DatasetSnapshot` entries
 * rather than `HistoryAction`. One `push` per confirmed apply (the whole tool
 * call / recorded batch, D-11), one `undo` step per apply (LIFO).
 *
 * The manager is a PURE STACK: it captures + returns snapshots but never itself
 * calls `editor.setFeatures` / `setCollectionMeta`. The caller (`GeoEditor.undo`)
 * performs the restore, keeping the manager free of an editor dependency and
 * trivially unit-testable.
 *
 * Memory (Pitfall 3 / A1): the depth is bounded small (default 20) and `push`
 * shallow-copies features (no deep coordinate clone), so the stack cannot
 * reintroduce the Phase-4 OOM class.
 */
export class DatasetSnapshotManager implements IManager {
	private snapshots: DatasetSnapshot[] = []
	private maxSnapshots: number

	/** Default depth (Pitfall 3): bounded small, never above the SAFE-06 ~10-20 band. */
	constructor(maxSnapshots: number = 20) {
		this.maxSnapshots = Math.max(1, maxSnapshots)
	}

	onAdd(_map: MapLibreMap): void {
		// No map dependency — the manager is a pure in-memory stack.
	}

	onRemove(): void {
		this.clear()
	}

	/**
	 * Capture the pre-apply dataset state. Call EXACTLY once per confirmed apply
	 * (D-11), BEFORE the apply mutates the editor.
	 *
	 * `features` should be `editor.getAllFeatures()`. Each feature is shallow-copied
	 * (`{...f}`) to decouple the snapshot from later in-place property reassignment
	 * (A1) while sharing nested geometry by reference (the memory ceiling, Pitfall 3).
	 * `collectionMeta` is shallow-copied for the same reason.
	 */
	push(features: EditorFeature[], collectionMeta: CollectionMeta, label: string): void {
		this.snapshots.push({
			features: features.map((f) => ({ ...f })),
			collectionMeta: {
				...collectionMeta,
				customProperties: { ...collectionMeta.customProperties },
			},
			label,
			timestamp: Date.now(),
		})

		// Bound the stack: drop the oldest on overflow (mirrors HistoryManager.shift()).
		if (this.snapshots.length > this.maxSnapshots) {
			this.snapshots.shift()
		}
	}

	canUndo(): boolean {
		return this.snapshots.length > 0
	}

	/**
	 * Pop and return the most-recent snapshot (LIFO), or `null` if the stack is
	 * empty (a safe no-op). The CALLER restores it via `editor.setFeatures` +
	 * `setCollectionMeta` — this manager never mutates the editor.
	 */
	undo(): DatasetSnapshot | null {
		return this.snapshots.pop() ?? null
	}

	/** The timestamp of the top (most-recent) snapshot, or `null` if empty. */
	peekTimestamp(): number | null {
		const top = this.snapshots[this.snapshots.length - 1]
		return top ? top.timestamp : null
	}

	/** Current stack depth (test/diagnostic). */
	size(): number {
		return this.snapshots.length
	}

	clear(): void {
		this.snapshots = []
	}
}
