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
	pendingDiffs.set(id, { id, diff, status: opts?.status ?? 'pending' })
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
