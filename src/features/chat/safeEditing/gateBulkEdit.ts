/**
 * gateBulkEdit — the safe-editing gate for fixAll-style REAL-APPLY bulk batches
 * (TOOLS-02 / TOOLS-03 dedup / STYLE-01 — Phase 6).
 *
 * WHY a generalization of `gateRunCodeBatch` (and not `createAuthoringGate`):
 * the bulk tools apply their mutation host-side via `runFixAllRule` /
 * `authoring.deleteFeatures` — the geometry/property writes happen INSIDE the
 * facade replay (interceptor-routed), exactly like a recorded `run_code` batch.
 * A pure `computeProposed(current)` dry-run (what `createAuthoringGate` wants)
 * would have to re-derive every per-feature transform outside the facade and risk
 * drift. So we reuse the run_code pattern — snapshot BEFORE the real apply,
 * classify from the real before/after, and on Cancel restore the snapshot so the
 * net editor mutation is ZERO (Pitfall 5 / T-05-24).
 *
 * Two generalizations over `gateRunCodeBatch`:
 *   1. the caller supplies the `intent` (`'modify'` for batch-edit / restyle,
 *      `'delete'` for dedup) — threaded into `classifyMutation` so dedup's dropped
 *      ids classify as DELETIONS and a Level-2 user is asked to confirm
 *      (Pitfall 6), not silently dropped as an add-collision;
 *   2. the caller supplies the real `apply()` (e.g. `runFixAllRule(editor, rule)`),
 *      invoked exactly ONCE after the snapshot — the only writer.
 *
 * The style-aware headline (`~N restyled`) is rendered downstream by
 * `DatasetDiffDisclosure` from the emitted diff (Plan 03's `classifyModifyKind`);
 * this helper just emits the classified diff and never inspects style itself.
 *
 * Like `gateRunCodeBatch`, this helper NEVER calls `editor.*` mutation methods
 * directly except the shared `pushDatasetSnapshot` / `undoLastDatasetSnapshot`
 * (the snapshot stack the AuthoringGate also uses — one batch = one undo, D-11).
 * The real writes live in the caller's `apply()`, so the A3 boundary stays clean.
 */

import { type DatasetDiff, classifyMutation } from '@/features/geo-editor/api/diff'
import type { MutationIntent } from '@/features/geo-editor/api/interceptor'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { ensureExecutionTargetForMutation } from '@/features/chat/tools/executionTarget'
import type { SafetyLevel } from './AuthoringGate'
import { emitDiffBlock, requestConfirm } from './pendingDiffStore'

export interface GateBulkDeps {
	/** Read the user's current safety level (SAFE-04). Read fresh per review. */
	getSafetyLevel(): SafetyLevel
	/** Snapshot label for the undo step (one snapshot = one undo, D-11). */
	label: string
	/**
	 * Optional metrics-aware optimization summary (D-04b / GEO-02) — e.g.
	 * `12.0MB → 0.9MB · 41k→3.2k pts · 312→18 features · 47 joins`. When supplied
	 * it is threaded into the emitted diff block so `DatasetDiffDisclosure` renders
	 * this before/after summary instead of the generic `+N · ~N · −N` counts wall.
	 * Omitted by every Phase 5/6 caller — strictly additive, backward-compatible.
	 */
	headline?: string
}

export interface GateBulkResult {
	/** 'applied' when the batch stays committed; 'cancelled' when rolled back. */
	status: 'applied' | 'cancelled'
	/** The classified diff for the batch (emitted to the transcript either way). */
	diff: DatasetDiff
	/** The pending-diff transcript entry id (so the caller can mark its message). */
	diffId: string
}

/**
 * Gate a fixAll-style REAL-APPLY bulk batch.
 *
 * `apply` performs the real, interceptor-routed mutation (e.g.
 * `runFixAllRule(editor, rule)` or the gated `createAuthoring(editor).
 * deleteFeatures(ids)`) and is invoked exactly ONCE, AFTER the snapshot is taken
 * (so Cancel can restore it). The caller-supplied `intent` drives classification:
 * `'modify'` for an attribute/style edit, `'delete'` for a dedup drop (so the
 * dropped ids classify as deletions → Level-2 confirms, Pitfall 6).
 *
 * Decision (mirrors the AuthoringGate): Level 3 → never await (trust + undo);
 * Level 1 → always await; Level 2 → await only when the batch is destructive
 * (modify or delete present — a bulk modify/delete always is). On Cancel the
 * snapshot is restored → ZERO net editor mutation (T-05-24).
 */
export async function gateBulkApply(
	editor: GeoEditor,
	deps: GateBulkDeps,
	intent: MutationIntent,
	apply: () => void,
): Promise<GateBulkResult> {
	await ensureExecutionTargetForMutation()
	const before = editor.getAllFeatures()

	// One snapshot per batch (D-11) — taken BEFORE the apply so Cancel restores it.
	editor.pushDatasetSnapshot(deps.label)

	// Real, interceptor-routed mutation (the caller owns the writes). The apply runs
	// the mutation feature-by-feature (un-buffered), so a throw mid-batch would leave
	// a PARTIALLY-mutated dataset plus the snapshot above dangling on the bounded
	// undo stack (CR-01 / T-06-05e). Wrap it: on throw, restore the snapshot (zero
	// net mutation, mirroring the Cancel guarantee) and re-throw so dispatch() yields
	// a ToolError the model can self-correct from.
	try {
		apply()
	} catch (err) {
		editor.undoLastDatasetSnapshot()
		throw err
	}

	const after = editor.getAllFeatures()
	// Classify with the CALLER'S intent (not hardcoded 'add') so dedup's dropped
	// ids bucket as deletions and an attribute/style edit buckets as modifies.
	const diff = classifyMutation(before, after, intent)

	// No-op guard (CR-03): a batch that produces zero net change (e.g. a declarative
	// `set` that writes a value a feature already had) must NOT leave a phantom
	// "undo AI edit" step on the snapshot stack, and must NOT be reported as a
	// confirmed apply. Drop the snapshot and return early with an empty, applied diff
	// — the dataset is unchanged, so there is nothing to confirm or roll back.
	// A whole-collection replace whose apply mints NEW ids (e.g. the optimizer's
	// stitch/merge, which collapses several features into a fresh Multi*) drops the
	// old ids: they appear in `before` but not in `after`. `classifyMutation` only
	// buckets those as `deleted` under `intent === 'delete'`, so under a `'modify'`
	// intent the diff is a pure-add and the no-op/destructive checks below would miss
	// the data that was removed. Detect dropped ids directly so the optimize apply
	// (and any future id-minting modify) is neither mistaken for a no-op nor waved
	// through without confirmation. Phase 5/6 callers keep ids on a modify, so this
	// is a no-op for them (droppedIds is empty).
	const afterIds = new Set(after.map((f) => f.id))
	const droppedIds = before.filter((f) => !afterIds.has(f.id))

	const isNoop =
		diff.added.length === 0 &&
		diff.modified.length === 0 &&
		diff.deleted.length === 0 &&
		droppedIds.length === 0
	if (isNoop) {
		editor.undoLastDatasetSnapshot()
		const handle = emitDiffBlock(diff, { status: 'applied', headline: deps.headline, intent })
		return { status: 'applied', diff, diffId: handle.id }
	}

	const level = deps.getSafetyLevel()
	const destructive = diff.modified.length > 0 || diff.deleted.length > 0 || droppedIds.length > 0
	// Level 3 → never await; Level 1 → always await; Level 2 → await iff destructive.
	const mustConfirm = level === 1 || (level === 2 && destructive)

	if (!mustConfirm) {
		// Immediate-apply path: emit the resolved diff (D-12 — still shown).
		const handle = emitDiffBlock(diff, { status: 'applied', headline: deps.headline, intent })
		return { status: 'applied', diff, diffId: handle.id }
	}

	// Confirm path: emit a pending diff and await the Apply/Cancel decision.
	const handle = emitDiffBlock(diff, { headline: deps.headline, intent })
	const decision = await requestConfirm(handle.id)
	if (decision === 'cancel') {
		// Roll the batch back via the snapshot — zero net editor mutation (T-05-24).
		editor.undoLastDatasetSnapshot()
		return { status: 'cancelled', diff, diffId: handle.id }
	}
	return { status: 'applied', diff, diffId: handle.id }
}
