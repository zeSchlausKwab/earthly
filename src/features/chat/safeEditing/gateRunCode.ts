/**
 * gateRunCode — the chat-loop wiring that fronts the `run_code` recorded-batch
 * replay with the safe-editing gate (SAFE-03 / SAFE-04 / D-11 / D-12).
 *
 * WHY a bespoke gate helper for run_code (vs. `createAuthoringGate` directly):
 * the AuthoringGate's `GateProposal` wants a PURE `computeProposed(current)`
 * dry-run. A `run_code` batch is a list of recorded `authoring.*` ops whose
 * geometry (`circle`/`buffer`) is produced INSIDE the facade — reproducing it
 * outside would duplicate `makeCircle`/`makeBuffer`/normalization and risk drift.
 * The recorded ops are also APPEND-ONLY (`addFeature` / `writeGeoJSON` / `circle`
 * / `buffer` / `setDatasetMetadata` — never modify/delete existing features), so
 * the batch is a non-destructive add unit. We therefore gate it with the SAME
 * snapshot stack the AuthoringGate uses (one batch = one snapshot = one undo,
 * D-11) but classify from the real before/after and, on Cancel, restore the
 * snapshot so the net editor mutation is ZERO (T-05-24) — the same guarantee the
 * buffer-then-apply gate gives, achieved here via snapshot+restore because the
 * facade replay cannot be dry-run purely.
 *
 * Flow per batch (ONE apply unit):
 *   1. capture `before = getAllFeatures()`, push a dataset snapshot;
 *   2. `replay()` the recorded ops for real through the facade (interceptor-routed);
 *   3. classify the add-intent diff from before → after;
 *   4. Level 3 OR non-destructive (always true for an add batch) → keep, emit the
 *      diff with status 'applied' (D-12); Level 1 → emit a pending diff, await
 *      Apply/Cancel; on Cancel restore the snapshot (zero net mutation) and emit
 *      'cancelled'.
 *
 * The real apply stays interceptor-routed (the caller's `replay()` is the only
 * writer); this helper never calls `editor.*` mutation methods directly except
 * the shared `undoLastDatasetSnapshot()` restore on cancel.
 */

import { type DatasetDiff, classifyMutation } from '@/features/geo-editor/api/diff'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { ensureExecutionTargetForMutation } from '@/features/chat/tools/executionTarget'
import { emitDiffBlock, requestConfirm } from './pendingDiffStore'
import type { SafetyLevel } from './AuthoringGate'

export interface GateRunCodeDeps {
	/** Read the user's current safety level (SAFE-04). */
	getSafetyLevel(): SafetyLevel
	/** Snapshot label for the undo step. */
	label: string
}

export interface GateRunCodeResult {
	/** 'applied' when the batch stays committed; 'cancelled' when it was rolled back. */
	status: 'applied' | 'cancelled'
	/** The classified diff for the batch (emitted to the transcript either way). */
	diff: DatasetDiff
	/** The pending-diff transcript entry id (so the caller can mark the tool message). */
	diffId: string
}

/**
 * Gate a `run_code` recorded batch. `replay` performs the real facade replay
 * (the caller's existing loop) and is invoked exactly once, BEFORE the confirm
 * decision (the batch is append-only, so we classify from the real result and
 * roll back on Cancel via the snapshot). Returns the outcome + the emitted diff.
 */
export async function gateRunCodeBatch(
	editor: GeoEditor,
	deps: GateRunCodeDeps,
	replay: () => void,
): Promise<GateRunCodeResult> {
	await ensureExecutionTargetForMutation()
	const before = editor.getAllFeatures()

	// One snapshot per batch (D-11) — taken BEFORE the replay so Cancel restores it.
	editor.pushDatasetSnapshot(deps.label)

	// Real, interceptor-routed replay (the caller owns the writes).
	replay()

	const after = editor.getAllFeatures()
	// Append-only batch → 'add' intent. classifyMutation buckets added/modified/deleted.
	const diff = classifyMutation(before, after, 'add')

	const level = deps.getSafetyLevel()
	const destructive = diff.modified.length > 0 || diff.deleted.length > 0
	// Mirror the AuthoringGate decision: Level 3 → never await; Level 1 → always
	// await; Level 2 → await only when destructive (an add batch never is).
	const mustConfirm = level === 1 || (level === 2 && destructive)

	if (!mustConfirm) {
		// Immediate-apply path: emit the resolved diff (D-12 — the diff is still shown).
		const handle = emitDiffBlock(diff, { status: 'applied' })
		return { status: 'applied', diff, diffId: handle.id }
	}

	// Confirm path: emit a pending diff and await the Apply/Cancel decision.
	const handle = emitDiffBlock(diff)
	const decision = await requestConfirm(handle.id)
	if (decision === 'cancel') {
		// Roll the batch back via the snapshot — zero net editor mutation (T-05-24).
		editor.undoLastDatasetSnapshot()
		return { status: 'cancelled', diff, diffId: handle.id }
	}
	return { status: 'applied', diff, diffId: handle.id }
}
