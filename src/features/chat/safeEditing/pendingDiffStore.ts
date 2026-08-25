/**
 * pendingDiffStore — the bridge between the host-side AuthoringGate (Plan 04) and
 * the React transcript (this plan).
 *
 * The gate is UI-agnostic: it calls injected `emitDiffBlock(diff)` /
 * `requestConfirm()` deps. This module is the concrete implementation of those
 * deps wired to the chat transcript:
 *
 *   - `emitDiffBlock(diff, opts?)` — the gate-facing dep. Registers a pending diff
 *     entry keyed by a stable id and returns a handle. Used for the buffered path
 *     AND (with `{ status: 'applied' }`) the Level-3 / immediate-apply path so the
 *     diff is ALWAYS recorded + rendered (D-12 / T-05-20).
 *   - `requestConfirm(id)` — the gate-facing dep. Returns a Promise resolving
 *     `'apply' | 'cancel'` (the `ConfirmDecision` the gate awaits).
 *   - `getPendingDiff(id)` / `subscribePendingDiffs` — the React-facing accessor
 *     the `DatasetDiffDisclosure` transcript branch reads.
 *   - `resolvePendingDiff(id, decision)` — what the disclosure's Apply/Cancel
 *     buttons call to settle the awaited Promise. IDEMPOTENT — a second resolve is
 *     a no-op (T-05-23: one apply unit = one resolve).
 *
 * Framework-light (a module-level Map + a subscriber set, mirroring
 * `tools/context.ts`'s `mapSnapshotCache`) so the gate — which lives in
 * `features/chat/` — can import it without pulling in React.
 */

import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { MutationIntent } from '@/features/geo-editor/api/interceptor'
import type { ToolExecutionRunIdentity, ToolExecutionTarget } from '@/features/chat/tools/types'
import type { ConfirmDecision } from './AuthoringGate'
import {
	buildAttachedPendingDatasetCommit,
	sameToolExecutionTarget,
	type AttachedPendingDatasetCommit,
	type PendingDatasetCommitInput,
	type PendingDiffExecutionScope,
} from './pendingDiffCommit'

/** Terminal render/resolution state of a pending-diff entry. */
export type PendingDiffStatus =
	| 'pending'
	| 'applied'
	| 'cancelled'
	| 'failed'
	| 'undone'
	| 'undo-unavailable'

export interface PendingDiffEntry {
	/** Stable id keying the transcript marker + the resolver. */
	id: string
	/** The classified diff to render. */
	diff: DatasetDiff
	/** `pending` shows live Apply/Cancel; `applied`/`cancelled` shows the outcome. */
	status: PendingDiffStatus
	/**
	 * Optional metrics-aware optimization summary (D-04b / GEO-02). When present,
	 * the disclosure renders this verbatim in place of the generic
	 * `+N added · ~N changed · −N deleted` counts headline. Omitted by every
	 * Phase 5/6 caller — strictly additive, backward-compatible.
	 */
	headline?: string
	/**
	 * Optional originating mutation intent (`'add' | 'modify' | 'delete'`) of the
	 * gated batch (GEO-01). Threaded through so a transcript/test can tell which
	 * kind of apply produced this block (e.g. the optimizer's whole-collection
	 * `'modify'`). Omitted by every Phase 5/6 caller — strictly additive.
	 */
	intent?: MutationIntent
	/**
	 * The chat the emitting run belonged to (stamped from the module-level
	 * context set by the chat store at run start). Entries without a chatId
	 * render in every chat (back-compat); entries WITH one render only in their
	 * owning chat — applied/cancelled cards must not leak across chats.
	 */
	chatId?: string
	/** Exact model-run id; tool-call ids alone may be reused by providers. */
	runId?: number
	/**
	 * The tool call whose execution emitted this diff (stamped from the
	 * module-level context the chat store sets around each executeToolCall).
	 * Lets the transcript render the card INLINE under its own tool turn —
	 * a trailing clump of APPLIED cards loses all temporal ordering.
	 */
	toolCallId?: string
	/** Immutable Dataset target used to keep Undo away from a newly visible edit. */
	target?: ToolExecutionTarget
	/** Bounded exact commit record; absent means target-bound Undo is not offered. */
	commit?: AttachedPendingDatasetCommit
	/** Groups every disclosure emitted by one exact run/tool commit. */
	commitScopeKey?: string
}

export interface EmitDiffBlockHandle {
	id: string
}

export interface EmitDiffBlockOptions {
	/**
	 * Register the entry already resolved (Level-3 auto-apply / immediate apply):
	 * the diff renders with this status and no confirm is awaited (D-12).
	 */
	status?: PendingDiffStatus
	/**
	 * Optional metrics-aware optimization summary (D-04b / GEO-02), stored on the
	 * entry so the disclosure can render it instead of the generic counts headline.
	 * Omitted by every existing caller — additive, backward-compatible.
	 */
	headline?: string
	/**
	 * Optional originating mutation intent stored on the entry (GEO-01). Omitted by
	 * every existing caller — additive, backward-compatible.
	 */
	intent?: MutationIntent
}

/**
 * The chat id stamped onto newly emitted entries. Set by the chat store at run
 * start rather than imported from it — this module is
 * imported BY the chat store, so reading the store back would be a cycle.
 */
let currentDiffChatId: string | null = null
let currentDiffRunId: number | null = null
let currentDiffRunTarget: ToolExecutionTarget | null = null

/** Stamp an exact immutable run in one operation (preferred production API). */
export function setPendingDiffRunContext(run: ToolExecutionRunIdentity | null): void {
	currentDiffRunId = run?.runId ?? null
	currentDiffChatId = run?.chatId ?? null
	currentDiffRunTarget = run ? Object.freeze({ ...run.target }) : null
}

export function setPendingDiffChatContext(chatId: string | null): void {
	currentDiffChatId = chatId
}

export function setPendingDiffRunTarget(target: ToolExecutionTarget | null): void {
	currentDiffRunTarget = target
}

/** The tool call currently executing (set around each executeToolCall). */
let currentDiffToolCallId: string | null = null

export function setPendingDiffToolContext(toolCallId: string | null): void {
	currentDiffToolCallId = toolCallId
}

const pendingDiffs = new Map<string, PendingDiffEntry>()
/** id → the resolver settling the `requestConfirm` Promise for that entry. */
const resolvers = new Map<string, (decision: ConfirmDecision) => void>()
const subscribers = new Set<() => void>()

/**
 * Cached `getAllPendingDiffs()` result. `useSyncExternalStore` compares snapshots
 * with `Object.is`, so a fresh array on every call drives a render loop in React 19
 * ("The result of getSnapshot should be cached…"). We hold a stable reference and
 * invalidate it only when the entries actually change (CR-01).
 */
let snapshotCache: PendingDiffEntry[] | null = null

let counter = 0
function nextId(): string {
	counter += 1
	return `diff-${Date.now().toString(36)}-${counter}`
}

function notify(): void {
	// Entries changed — drop the cached snapshot so the next read rebuilds it once.
	snapshotCache = null
	for (const fn of subscribers) fn()
}

/**
 * Gate-facing dep: register a pending diff and return its handle. With
 * `{ status: 'applied' }` (or `'cancelled'`) it registers an already-resolved
 * block (the Level-3 / immediate-apply path) so the diff is still rendered (D-12).
 */
export function emitDiffBlock(diff: DatasetDiff, opts?: EmitDiffBlockOptions): EmitDiffBlockHandle {
	const id = nextId()
	pendingDiffs.set(id, {
		id,
		diff,
		status: opts?.status ?? 'pending',
		headline: opts?.headline,
		intent: opts?.intent,
		chatId: currentDiffChatId ?? undefined,
		runId: currentDiffRunId ?? undefined,
		toolCallId: currentDiffToolCallId ?? undefined,
		target: currentDiffRunTarget ? Object.freeze({ ...currentDiffRunTarget }) : undefined,
	})
	notify()
	return { id }
}

/** React-facing accessor: the entry for `id`, or null if none/cleared. */
export function getPendingDiff(id: string): PendingDiffEntry | null {
	return pendingDiffs.get(id) ?? null
}

/**
 * Snapshot of all current entries (for a transcript that maps over them).
 * Returns a STABLE reference between mutations so `useSyncExternalStore` does not
 * see a new snapshot on every render (CR-01); `notify()` invalidates the cache.
 */
export function getAllPendingDiffs(): PendingDiffEntry[] {
	if (snapshotCache === null) snapshotCache = [...pendingDiffs.values()]
	return snapshotCache
}

/**
 * Gate-facing dep: await the Apply/Cancel decision for `id`. Resolves `'apply'`
 * or `'cancel'` when `resolvePendingDiff(id, …)` is called. If the entry is
 * already resolved (a race), it resolves immediately to the matching decision.
 */
export function requestConfirm(id: string): Promise<ConfirmDecision> {
	const existing = pendingDiffs.get(id)
	if (existing && existing.status !== 'pending') {
		return Promise.resolve(existing.status === 'applied' ? 'apply' : 'cancel')
	}
	return new Promise<ConfirmDecision>((resolve) => {
		resolvers.set(id, resolve)
	})
}

/**
 * Settle a pending diff (the Apply/Cancel button handler). Flips the entry status
 * and resolves the awaited `requestConfirm` Promise. IDEMPOTENT: a second call on
 * an already-resolved entry is a no-op (T-05-23 — one apply unit = one resolve).
 */
export function resolvePendingDiff(id: string, decision: PendingDiffStatus): void {
	if (
		decision === 'pending' ||
		decision === 'failed' ||
		decision === 'undone' ||
		decision === 'undo-unavailable'
	) {
		return
	}
	const entry = pendingDiffs.get(id)
	if (entry?.status !== 'pending') return // idempotent: already resolved / unknown

	entry.status = decision
	pendingDiffs.set(id, entry)

	const resolve = resolvers.get(id)
	if (resolve) {
		resolvers.delete(id)
		resolve(decision === 'applied' ? 'apply' : 'cancel')
	}
	notify()
}

/**
 * A safe-edit gate resolves before the detached Dataset snapshot is durably
 * persisted. If that final compare-and-swap fails, the transcript must not keep
 * claiming that the edit was applied. Reclassify only the applied cards emitted
 * by that exact tool call; cancelled and unrelated cards remain untouched.
 */
function scopeKey(scope: PendingDiffExecutionScope): string {
	return JSON.stringify([
		scope.runId,
		scope.chatId,
		scope.toolCallId,
		scope.target.entityType,
		scope.target.workspaceId,
		scope.target.draftId,
		scope.target.sourceId,
		scope.target.entityId,
		scope.target.baseRevisionId,
		scope.target.draftUpdatedAt,
		scope.target.wasDirty,
	])
}

function entryMatchesScope(entry: PendingDiffEntry, scope: PendingDiffExecutionScope): boolean {
	return (
		entry.runId === scope.runId &&
		entry.chatId === scope.chatId &&
		entry.toolCallId === scope.toolCallId &&
		sameToolExecutionTarget(entry.target, scope.target)
	)
}

/** Attach one successful durable commit only to disclosures from its exact run/tool. */
export function attachPendingDiffCommit(
	scope: PendingDiffExecutionScope,
	commit: PendingDatasetCommitInput,
): number {
	if (!sameToolExecutionTarget(scope.target, commit.target)) return 0
	let changed = 0
	const key = scopeKey(scope)
	for (const entry of pendingDiffs.values()) {
		if (entry.status !== 'applied' || entry.commit || !entryMatchesScope(entry, scope)) continue
		const attached = buildAttachedPendingDatasetCommit(commit, entry.diff)
		if (!attached) continue
		entry.commit = attached
		entry.commitScopeKey = key
		pendingDiffs.set(entry.id, entry)
		changed += 1
	}
	if (changed > 0) notify()
	return changed
}

export function markToolDiffsNotApplied(scope: PendingDiffExecutionScope): number {
	let changed = 0
	for (const entry of pendingDiffs.values()) {
		if (entry.status !== 'applied' || !entryMatchesScope(entry, scope)) continue
		entry.status = 'failed'
		entry.commit = undefined
		entry.commitScopeKey = undefined
		pendingDiffs.set(entry.id, entry)
		changed += 1
	}
	if (changed > 0) notify()
	return changed
}

/** Complete an exact commit's Undo attempt and retire every card for that commit. */
export function settlePendingDiffUndo(id: string, status: 'undone' | 'undo-unavailable'): boolean {
	const entry = pendingDiffs.get(id)
	if (entry?.status !== 'applied' || !entry.commit || !entry.commitScopeKey) return false
	let changed = false
	for (const candidate of pendingDiffs.values()) {
		if (candidate.status !== 'applied' || candidate.commitScopeKey !== entry.commitScopeKey)
			continue
		candidate.status = status
		candidate.commit = undefined
		pendingDiffs.set(candidate.id, candidate)
		changed = true
	}
	if (changed) notify()
	return changed
}

/**
 * Cancel every still-pending diff, resolving each awaited `requestConfirm` as
 * `'cancel'` (zero editor mutation — the buffered apply never ran). Returns the
 * number of entries cancelled.
 *
 * This is the abort path for the confirm gate. The gate `await`s `requestConfirm`
 * inside the chat tool loop; without this, a pending diff that is never answered
 * via the Apply/Cancel buttons (the stream was stopped, or its chat was
 * deleted/stopped/reset) leaves the loop awaiting forever — stranding the whole
 * turn with `isStreaming` stuck true, which disables the model/provider/chat
 * controls until a page reload. Called from those stream-teardown paths so a
 * cancelled/abandoned run can never wedge the gate.
 */
export function cancelPendingDiffs(): number {
	let cancelled = 0
	for (const entry of pendingDiffs.values()) {
		if (entry.status !== 'pending') continue
		entry.status = 'cancelled'
		pendingDiffs.set(entry.id, entry)
		const resolve = resolvers.get(entry.id)
		if (resolve) {
			resolvers.delete(entry.id)
			resolve('cancel')
		}
		cancelled += 1
	}
	if (cancelled > 0) notify()
	return cancelled
}

/** Subscribe to entry changes (React `useSyncExternalStore` wiring). */
export function subscribePendingDiffs(fn: () => void): () => void {
	subscribers.add(fn)
	return () => {
		subscribers.delete(fn)
	}
}

/** Test/reset helper — clears all entries + resolvers. */
export function clearPendingDiffs(): void {
	pendingDiffs.clear()
	resolvers.clear()
	currentDiffRunId = null
	notify()
}
