import { test, expect, describe, beforeEach } from 'bun:test'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import {
	cancelPendingDiffs,
	emitDiffBlock,
	getAllPendingDiffs,
	getPendingDiff,
	requestConfirm,
	resolvePendingDiff,
	clearPendingDiffs,
} from './pendingDiffStore'

const DIFF: DatasetDiff = {
	added: [],
	modified: [],
	deleted: [],
}

beforeEach(() => {
	clearPendingDiffs()
})

describe('emitDiffBlock registration', () => {
	test('registers a retrievable pending diff carrying the DatasetDiff', () => {
		const handle = emitDiffBlock(DIFF)
		const entry = getPendingDiff(handle.id)
		expect(entry).not.toBeNull()
		expect(entry?.diff).toBe(DIFF)
		expect(entry?.status).toBe('pending')
	})
})

describe('requestConfirm / resolvePendingDiff', () => {
	test("requestConfirm resolves 'apply' when resolvePendingDiff(id, 'applied')", async () => {
		const handle = emitDiffBlock(DIFF)
		const confirm = requestConfirm(handle.id)
		resolvePendingDiff(handle.id, 'applied')
		await expect(confirm).resolves.toBe('apply')
	})

	test("requestConfirm resolves 'cancel' when resolvePendingDiff(id, 'cancelled')", async () => {
		const handle = emitDiffBlock(DIFF)
		const confirm = requestConfirm(handle.id)
		resolvePendingDiff(handle.id, 'cancelled')
		await expect(confirm).resolves.toBe('cancel')
	})

	test('resolving flips the entry status and is idempotent (no double-resolve)', async () => {
		const handle = emitDiffBlock(DIFF)
		const confirm = requestConfirm(handle.id)
		resolvePendingDiff(handle.id, 'applied')
		// status flips
		expect(getPendingDiff(handle.id)?.status).toBe('applied')
		await expect(confirm).resolves.toBe('apply')
		// a second resolve is a no-op — status does not change to cancelled
		resolvePendingDiff(handle.id, 'cancelled')
		expect(getPendingDiff(handle.id)?.status).toBe('applied')
	})
})

describe('cancelPendingDiffs — abort path for the confirm gate', () => {
	test("resolves an outstanding requestConfirm as 'cancel' (unwedges a stranded tool loop)", async () => {
		const handle = emitDiffBlock(DIFF)
		const confirm = requestConfirm(handle.id)
		const cancelled = cancelPendingDiffs()
		expect(cancelled).toBe(1)
		await expect(confirm).resolves.toBe('cancel')
		expect(getPendingDiff(handle.id)?.status).toBe('cancelled')
	})

	test('leaves already-resolved entries untouched and reports zero', () => {
		const handle = emitDiffBlock(DIFF)
		const confirm = requestConfirm(handle.id)
		resolvePendingDiff(handle.id, 'applied')
		const cancelled = cancelPendingDiffs()
		expect(cancelled).toBe(0)
		// status stays applied — cancel must not clobber a committed apply
		expect(getPendingDiff(handle.id)?.status).toBe('applied')
		return expect(confirm).resolves.toBe('apply')
	})

	test('cancels multiple outstanding pending diffs at once', async () => {
		const a = emitDiffBlock(DIFF)
		const b = emitDiffBlock(DIFF)
		const confirmA = requestConfirm(a.id)
		const confirmB = requestConfirm(b.id)
		expect(cancelPendingDiffs()).toBe(2)
		await expect(confirmA).resolves.toBe('cancel')
		await expect(confirmB).resolves.toBe('cancel')
	})
})

describe('getAllPendingDiffs snapshot caching (CR-01)', () => {
	test('returns the SAME reference across calls when nothing changes', () => {
		emitDiffBlock(DIFF)
		const a = getAllPendingDiffs()
		const b = getAllPendingDiffs()
		// useSyncExternalStore compares with Object.is — a fresh array every call
		// would drive a React 19 render loop.
		expect(b).toBe(a)
	})

	test('returns a NEW reference after a mutation invalidates the cache', () => {
		const first = emitDiffBlock(DIFF)
		const a = getAllPendingDiffs()
		emitDiffBlock(DIFF)
		const b = getAllPendingDiffs()
		expect(b).not.toBe(a)
		expect(b.length).toBe(2)
		// resolving also invalidates
		resolvePendingDiff(first.id, 'applied')
		const c = getAllPendingDiffs()
		expect(c).not.toBe(b)
	})
})

describe('auto-apply registration (Level 3, D-12)', () => {
	test("emitDiffBlock can register a diff with status 'applied' WITHOUT an awaited confirm", () => {
		const handle = emitDiffBlock(DIFF, { status: 'applied' })
		const entry = getPendingDiff(handle.id)
		expect(entry?.status).toBe('applied')
		// the diff still renders even though no confirm was awaited
		expect(entry?.diff).toBe(DIFF)
	})
})

describe('optional metrics headline (D-04b / GEO-02)', () => {
	test('emitDiffBlock(diff, { headline }) stores the headline on the entry', () => {
		const handle = emitDiffBlock(DIFF, { headline: 'X' })
		const entry = getPendingDiff(handle.id)
		expect(entry?.headline).toBe('X')
	})

	test('emitDiffBlock(diff) leaves headline undefined (backward-compatible)', () => {
		const handle = emitDiffBlock(DIFF)
		const entry = getPendingDiff(handle.id)
		expect(entry?.headline).toBeUndefined()
	})

	test('headline coexists with an applied status (auto-apply optimization path)', () => {
		const handle = emitDiffBlock(DIFF, { status: 'applied', headline: 'opt' })
		const entry = getPendingDiff(handle.id)
		expect(entry?.status).toBe('applied')
		expect(entry?.headline).toBe('opt')
	})
})
