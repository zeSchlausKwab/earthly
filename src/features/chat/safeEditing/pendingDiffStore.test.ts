import { test, expect, describe, beforeEach } from 'bun:test'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import type { EditorFeature } from '@/features/geo-editor/core'
import {
	attachPendingDiffCommit,
	cancelPendingDiffs,
	emitDiffBlock,
	getAllPendingDiffs,
	getPendingDiff,
	markToolDiffsNotApplied,
	requestConfirm,
	resolvePendingDiff,
	clearPendingDiffs,
	setPendingDiffChatContext,
	setPendingDiffRunTarget,
	setPendingDiffRunContext,
	setPendingDiffToolContext,
} from './pendingDiffStore'
import { buildPendingDatasetFeatureCommitInput } from './pendingDiffCommit'

const DIFF: DatasetDiff = {
	added: [],
	modified: [],
	deleted: [],
}

const TARGET = {
	entityType: 'dataset' as const,
	workspaceId: 'workspace-a',
	draftId: 'draft-a',
	sourceId: 'session:a',
	entityId: null,
	baseRevisionId: null,
	draftUpdatedAt: 1,
	wasDirty: true,
}

const RUN = { runId: 7, chatId: 'chat-a', target: TARGET, startedAt: 2 }

function feature(id: string, name: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties: { name },
	} as EditorFeature
}

beforeEach(() => {
	clearPendingDiffs()
	setPendingDiffChatContext(null)
	setPendingDiffRunTarget(null)
	setPendingDiffRunContext(null)
	setPendingDiffToolContext(null)
})

describe('emitDiffBlock registration', () => {
	test('registers a retrievable pending diff carrying the DatasetDiff', () => {
		const handle = emitDiffBlock(DIFF)
		const entry = getPendingDiff(handle.id)
		expect(entry).not.toBeNull()
		expect(entry?.diff).toBe(DIFF)
		expect(entry?.status).toBe('pending')
	})

	test('stamps the current chat context so cards stay in their owning chat', () => {
		setPendingDiffChatContext('chat-a')
		const inChatA = emitDiffBlock(DIFF)
		setPendingDiffChatContext(null)
		const untagged = emitDiffBlock(DIFF)
		expect(getPendingDiff(inChatA.id)?.chatId).toBe('chat-a')
		expect(getPendingDiff(untagged.id)?.chatId).toBeUndefined()
	})

	test('stamps the current tool-call context so cards can anchor to their turn', () => {
		setPendingDiffToolContext('style_by_attribute:12')
		const anchored = emitDiffBlock(DIFF)
		setPendingDiffToolContext(null)
		const unanchored = emitDiffBlock(DIFF)
		expect(getPendingDiff(anchored.id)?.toolCallId).toBe('style_by_attribute:12')
		expect(getPendingDiff(unanchored.id)?.toolCallId).toBeUndefined()
	})

	test('stamps the immutable Dataset target so Undo cannot affect a later visible edit', () => {
		setPendingDiffRunContext(RUN)
		const handle = emitDiffBlock(DIFF, { status: 'applied' })
		expect(getPendingDiff(handle.id)?.target).toEqual(TARGET)
		expect(getPendingDiff(handle.id)?.target).not.toBe(TARGET)
		expect(getPendingDiff(handle.id)?.runId).toBe(7)
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

describe('durable persistence failure', () => {
	test('reclassifies only cards from the exact chat/run/tool/target scope', () => {
		setPendingDiffRunContext(RUN)
		setPendingDiffToolContext('geometry-a')
		const failed = emitDiffBlock(DIFF, { status: 'applied' })
		setPendingDiffRunContext({ ...RUN, runId: 8 })
		setPendingDiffToolContext('geometry-a')
		const reusedCallId = emitDiffBlock(DIFF, { status: 'applied' })
		setPendingDiffRunContext(RUN)
		setPendingDiffToolContext('geometry-b')
		const unrelated = emitDiffBlock(DIFF, { status: 'applied' })

		expect(
			markToolDiffsNotApplied({
				runId: RUN.runId,
				chatId: RUN.chatId,
				toolCallId: 'geometry-a',
				target: TARGET,
			}),
		).toBe(1)
		expect(getPendingDiff(failed.id)?.status).toBe('failed')
		expect(getPendingDiff(reusedCallId.id)?.status).toBe('applied')
		expect(getPendingDiff(unrelated.id)?.status).toBe('applied')
		expect(
			markToolDiffsNotApplied({
				runId: RUN.runId,
				chatId: RUN.chatId,
				toolCallId: 'geometry-a',
				target: TARGET,
			}),
		).toBe(0)
	})
})

describe('successful target-bound commit attachment', () => {
	test('attaches only to the exact emitted diff and retains no full feature arrays', () => {
		const before = [feature('existing', 'Before')]
		const after = [feature('existing', 'After'), feature('added', 'New')]
		const features = buildPendingDatasetFeatureCommitInput(before, after)
		expect(features).not.toBeNull()
		setPendingDiffRunContext(RUN)
		setPendingDiffToolContext('geometry-a')
		const handle = emitDiffBlock(features?.diff ?? DIFF, { status: 'applied' })

		const attached = attachPendingDiffCommit(
			{ runId: 7, chatId: 'chat-a', toolCallId: 'geometry-a', target: TARGET },
			{ target: TARGET, fields: { features: features ?? undefined } },
		)

		expect(attached).toBe(1)
		const commit = getPendingDiff(handle.id)?.commit
		expect(commit?.fields.features?.addedIds).toEqual(['added'])
		expect(commit?.fields.features?.modifiedIds).toEqual(['existing'])
		expect(commit?.fields.features).not.toHaveProperty('before')
		expect(commit?.fields.features).not.toHaveProperty('after')
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
