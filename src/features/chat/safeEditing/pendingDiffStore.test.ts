import { test, expect, describe, beforeEach } from 'bun:test'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import {
	emitDiffBlock,
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

describe('auto-apply registration (Level 3, D-12)', () => {
	test("emitDiffBlock can register a diff with status 'applied' WITHOUT an awaited confirm", () => {
		const handle = emitDiffBlock(DIFF, { status: 'applied' })
		const entry = getPendingDiff(handle.id)
		expect(entry?.status).toBe('applied')
		// the diff still renders even though no confirm was awaited
		expect(entry?.diff).toBe(DIFF)
	})
})
