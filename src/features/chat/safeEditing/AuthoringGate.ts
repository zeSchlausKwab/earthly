/**
 * AuthoringGate — host-side async buffer-then-apply confirm gate (SAFE-03 / SAFE-04).
 *
 * This is the AI-proposal → editor-apply TRUST BOUNDARY. Nothing destructive
 * crosses it without classification + (per the persisted safety level)
 * confirmation, and every apply is snapshotted for SAFE-06 undo.
 *
 * WHY it lives here (features/chat/), one layer ABOVE the facade:
 * The Authoring facade interceptor fires SYNCHRONOUSLY (Plan 01, Pitfall 1) —
 * making it async would ripple through run_code's synchronous recorded-call
 * replay, the primitives, MutationResult, and the A3 boundary test. SAFE-03/04
 * need an ASYNC confirm BEFORE geometry touches the editor, so the gate sits on
 * the already-async chat apply path (store.ts:1710-1722). It MAY import from chat
 * AND from geo-editor/api — it is NOT under the api/ boundary.
 *
 * Flow per apply unit (the WHOLE tool call / recorded run_code batch is ONE unit
 * → one snapshot → one diff block → one undo step — Open Question 3 / D-11):
 *   1. dry-run the proposal against a CLONE of the current set (never the real
 *      editor) to produce the proposed EditorFeature[];
 *   2. classifyMutation(editor.getAllFeatures(), proposed, intent) → DatasetDiff;
 *   3. decide via the safety level + D-07:
 *        - pure-add OR Level 3 → snapshot, emit diff, commit immediately;
 *        - Level 1 (any change incl. adds) OR Level 2 with modify/delete present →
 *          emit diff, AWAIT requestConfirm; on Apply snapshot + commit, on Cancel
 *          discard with ZERO editor mutation.
 *   4. only on the apply path, ensure a durable binding immediately before commit.
 *
 * The real apply ALWAYS routes through createAuthoring / the Plan-01 verbs, so it
 * flows through runInterceptors (no bypass — T-05-17). The gate never calls
 * editor.* mutation methods directly.
 */

import { type Authoring, createAuthoring } from '@/features/geo-editor/api/authoring'
import { type DatasetDiff, classifyMutation } from '@/features/geo-editor/api/diff'
import type { MutationIntent } from '@/features/geo-editor/api/interceptor'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import type { EditorFeature } from '@/features/geo-editor/core/types'

/** The user's persisted safety posture (SAFE-04, default 2). */
export type SafetyLevel = 1 | 2 | 3

/** The Apply/Cancel decision the chat resolves from the inline disclosure (Plan 05). */
export type ConfirmDecision = 'apply' | 'cancel'

/** Terminal outcome of a gated apply unit. */
export type GateStatus = 'applied' | 'cancelled'

export interface GateResult {
	status: GateStatus
	/** The classified diff for this apply unit (emitted even on cancel for the record). */
	diff: DatasetDiff
}

/**
 * A single apply unit handed to the gate. The model/host describes the proposed
 * mutation as a PURE function of the current set (`computeProposed`) for the
 * dry-run classification, plus a `commit` that performs the real mutation through
 * the injected facade. Keeping these separate guarantees the dry-run runs against
 * a clone and never the real editor (T-05-18).
 */
export interface GateProposal {
	/** The mutation intent driving classification (`add` | `modify` | `delete`). */
	intent: MutationIntent
	/** Human label for the snapshot / undo step. */
	label: string
	/**
	 * Produce the PROPOSED feature set from the current set, WITHOUT mutating the
	 * editor. For a recorded run_code batch this simulates the recorded authoring.*
	 * ops against the clone; for a single tool call it builds the set from its args.
	 */
	computeProposed(current: EditorFeature[]): EditorFeature[]
	/**
	 * Perform the REAL mutation through the facade (so it routes through
	 * runInterceptors). Receives the interceptor-routed `authoring` facade and the
	 * current feature set (a fresh `getAllFeatures()` snapshot taken just before
	 * commit). Called at most once, only on the apply path.
	 */
	commit(authoring: Authoring, current: EditorFeature[]): void
}

export interface AuthoringGateDeps {
	/** Read the user's current safety level (SAFE-04). Read fresh per review. */
	getSafetyLevel(): SafetyLevel
	/**
	 * Render the inline diff disclosure (the chat's `DatasetDiffDisclosure`).
	 * Injected so the gate is UI-agnostic and headlessly testable; called for
	 * EVERY apply unit (immediate or buffered) so the action is always visible.
	 */
	emitDiffBlock(diff: DatasetDiff): void
	/**
	 * Await the Apply/Cancel decision. In Plan 05 this resolves from the disclosure
	 * buttons; in tests it is injected directly. Only called on the buffered path
	 * (Level 1, or Level 2 with a destructive change).
	 */
	requestConfirm(): Promise<ConfirmDecision>
	/**
	 * OPTIONAL: ensure a bound target exists before applying (auto-create-and-bind
	 * via the Plan-03 resolver when `needsAutoCreate`). Wired in Plan 05; when
	 * omitted the gate assumes a target is already bound (the headless default).
	 */
	ensureBinding?(): void | Promise<void>
}

/**
 * `true` when the diff contains a DESTRUCTIVE change — modify OR delete (D-07).
 * A pure add is NEVER destructive: it cannot overwrite or remove existing data,
 * so it never triggers the Level-2 confirm path.
 */
function hasDestructiveChange(diff: DatasetDiff): boolean {
	return diff.modified.length > 0 || diff.deleted.length > 0
}

/**
 * Decide whether this apply unit must AWAIT user confirmation, given the safety
 * level and the classified diff (D-07 / D-12):
 *   - Level 3 → never await (trust + undo; still snapshots + emits the diff).
 *   - Level 1 → await for ANY change (confirm-all, incl. pure adds).
 *   - Level 2 → await only when the change is destructive (modify/delete).
 */
function requiresConfirmation(level: SafetyLevel, diff: DatasetDiff): boolean {
	if (level === 3) return false
	if (level === 1) return true
	return hasDestructiveChange(diff)
}

/**
 * Construct the host-side authoring gate bound to a `GeoEditor`. The returned
 * `review(proposal)` orchestrates snapshot → classify → safety-level decision →
 * apply/await for ONE apply unit.
 */
export function createAuthoringGate(editor: GeoEditor, deps: AuthoringGateDeps) {
	const authoring = createAuthoring(editor)

	/**
	 * Snapshot BEFORE the real mutation, then commit through the facade. One
	 * snapshot per apply unit (D-11) so SAFE-06 undo reverts the whole unit as one
	 * step. `getAllFeatures()` is re-read here so `commit` sees the live set.
	 */
	async function applyNow(proposal: GateProposal): Promise<void> {
		if (deps.ensureBinding) await deps.ensureBinding()
		editor.pushDatasetSnapshot(proposal.label)
		proposal.commit(authoring, editor.getAllFeatures())
	}

	async function review(proposal: GateProposal): Promise<GateResult> {
		// (1) Dry-run against a CLONE of the current set — never the real editor
		// (T-05-18). classifyMutation is pure and holds no editor reference, so the
		// proposed set is computed without touching editor state.
		const current = editor.getAllFeatures()
		const proposed = proposal.computeProposed(current)

		// (2) Classify add/modify/delete by id against the live (un-compacted) set.
		const diff = classifyMutation(current, proposed, proposal.intent)

		// (3) The diff is ALWAYS emitted so the action is visible + recorded — even on
		// an immediate apply (D-12) and even if the user later cancels.
		deps.emitDiffBlock(diff)

		const level = deps.getSafetyLevel()

		// Immediate-apply path: pure-add (non-destructive) OR Level 3 (trust + undo).
		if (!requiresConfirmation(level, diff)) {
			await applyNow(proposal)
			return { status: 'applied', diff }
		}

		// Buffered path: await the Apply/Cancel decision. NOTHING has touched the
		// editor yet — the dry-run ran against the clone.
		const decision = await deps.requestConfirm()
		if (decision === 'cancel') {
			// Discard the buffered mutation with ZERO editor mutation (T-05-18).
			return { status: 'cancelled', diff }
		}

		await applyNow(proposal)
		return { status: 'applied', diff }
	}

	return { review }
}
