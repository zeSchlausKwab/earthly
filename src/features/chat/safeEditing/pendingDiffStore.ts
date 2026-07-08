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
import type { ConfirmDecision } from './AuthoringGate'

/** Terminal render/resolution state of a pending-diff entry. */
export type PendingDiffStatus = 'pending' | 'applied' | 'cancelled'

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
	/**
	 * The tool call whose execution emitted this diff (stamped from the
	 * module-level context the chat store sets around each executeToolCall).
	 * Lets the transcript render the card INLINE under its own tool turn —
	 * a trailing clump of APPLIED cards loses all temporal ordering.
	 */
	toolCallId?: string
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
 * start (and on chat switch) rather than imported from it — this module is
 * imported BY the chat store, so reading the store back would be a cycle.
 */
let currentDiffChatId: string | null = null

export function setPendingDiffChatContext(chatId: string | null): void {
	currentDiffChatId = chatId
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
		toolCallId: currentDiffToolCallId ?? undefined,
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
	if (decision === 'pending') return
	const entry = pendingDiffs.get(id)
	if (!entry || entry.status !== 'pending') return // idempotent: already resolved / unknown

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
 * Cancel every still-pending diff, resolving each awaited `requestConfirm` as
 * `'cancel'` (zero editor mutation — the buffered apply never ran). Returns the
 * number of entries cancelled.
 *
 * This is the abort path for the confirm gate. The gate `await`s `requestConfirm`
 * inside the chat tool loop; without this, a pending diff that is never answered
 * via the Apply/Cancel buttons (the stream was stopped, or its chat was
 * deleted/switched/reset) leaves the loop awaiting forever — stranding the whole
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
	notify()
}
