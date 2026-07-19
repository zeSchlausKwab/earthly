/**
 * gateEditorImport — routes the direct editor-import tools
 * (`write_geojson_to_editor` / `add_feature_to_editor`) through the safe-editing
 * gate (SAFE-03 / SAFE-04 / D-11 / D-12).
 *
 * These tools previously called `importFeaturesToEditor` (→ `createAuthoring`)
 * synchronously and applied immediately. This helper fronts that apply with
 * `createAuthoringGate` so an AI write is classified, previewed, and (per the
 * persisted safety level) confirmed BEFORE it touches the editor — exactly the
 * AuthoringGate contract Plan 04 exposed. The real commit still routes through
 * the `createAuthoring` → `runInterceptors` facade (no bypass — T-05-22).
 *
 * `computeProposed` mirrors `writeGeoJSON`'s normalization (`toEditorFeature`) so
 * the dry-run classification matches what the real apply will do:
 *   - append (replace=false): proposed = current + new ids not already present
 *     (intent 'add'); a colliding id is the skippedDuplicate, not a modify.
 *   - replace (replace=true): proposed = the new set ONLY (intent 'delete' so the
 *     dropped current ids classify as deletions and the gate confirms at Level 2).
 */

import { useEditorStore } from '@/features/geo-editor/store'
import { ensureDatasetDraftForMutation } from '@/features/geo-editor/authoringTaskBridge'
import { toEditorFeature } from '@/features/geo-editor/utils'
import type { EditorFeature } from '@/features/geo-editor/core'
import { type GateResult, type GateStatus, createAuthoringGate } from './AuthoringGate'
import {
	emitDiffBlock,
	getPendingDiff,
	requestConfirm,
	resolvePendingDiff,
} from './pendingDiffStore'
import { getSafetyLevel } from './safetyAccess'

export interface GatedImportOutcome {
	status: GateStatus
	/** Count of features the real apply created (0 on cancel). */
	importedCount: number
	skippedDuplicates: number
	totalFeaturesInEditor: number
	replaceExisting: boolean
}

/**
 * Gate an editor import. `applyReal` performs the real interceptor-routed write
 * (the existing `importFeaturesToEditor` call) and returns its counts; it is only
 * invoked on the apply path. Returns the gate outcome + counts.
 */
export async function gateEditorImport(
	features: GeoJSON.Feature[],
	replaceExisting: boolean,
	applyReal: () => {
		importedCount: number
		skippedDuplicates: number
		totalFeaturesInEditor: number
	},
): Promise<GatedImportOutcome> {
	const editor = useEditorStore.getState().editor
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}

	// Normalize the proposed features the same way the facade will (id-preserving).
	const usable = features.filter((f) => f && f.type === 'Feature' && f.geometry != null)
	const normalized: EditorFeature[] = usable.map((f) => toEditorFeature(f, 'ai-import'))

	// A handle id shared between emitDiffBlock (gate step 4) and requestConfirm
	// (the buffered path) for THIS apply unit. The gate always calls emitDiffBlock
	// before requestConfirm, so `pendingId` is set by the time confirm runs. For a
	// Level-3 / immediate apply the gate never awaits, so the block is registered
	// pending and we mark it applied below (D-12: the diff still renders).
	let pendingId: string | null = null
	const gate = createAuthoringGate(editor, {
		getSafetyLevel,
		ensureBinding: ensureDatasetDraftForMutation,
		emitDiffBlock: (diff) => {
			const handle = emitDiffBlock(diff)
			pendingId = handle.id
		},
		requestConfirm: () =>
			pendingId === null ? Promise.resolve('cancel' as const) : requestConfirm(pendingId),
	})

	let applied: {
		importedCount: number
		skippedDuplicates: number
		totalFeaturesInEditor: number
	} = {
		importedCount: 0,
		skippedDuplicates: 0,
		totalFeaturesInEditor: editor.getAllFeatures().length,
	}

	const result: GateResult = await gate.review({
		intent: replaceExisting ? 'delete' : 'add',
		label: 'AI edit',
		computeProposed: (current) => {
			if (replaceExisting) return normalized
			const existingIds = new Set(current.map((f) => f.id))
			const appended = normalized.filter((f) => !existingIds.has(f.id))
			return [...current, ...appended]
		},
		commit: () => {
			applied = applyReal()
		},
	})

	// The gate may have applied immediately (Level 3 / non-destructive) WITHOUT
	// going through the disclosure's resolvePendingDiff — settle the emitted block
	// so the transcript shows the resolved outcome (Applied/Cancelled) instead of
	// stale Apply/Cancel buttons (D-12: the diff stays visible).
	if (pendingId !== null && getPendingDiff(pendingId)?.status === 'pending') {
		resolvePendingDiff(pendingId, result.status)
	}

	if (result.status === 'cancelled') {
		return {
			status: 'cancelled',
			importedCount: 0,
			skippedDuplicates: 0,
			totalFeaturesInEditor: editor.getAllFeatures().length,
			replaceExisting,
		}
	}

	return {
		status: 'applied',
		importedCount: applied.importedCount,
		skippedDuplicates: applied.skippedDuplicates,
		totalFeaturesInEditor: applied.totalFeaturesInEditor,
		replaceExisting,
	}
}
