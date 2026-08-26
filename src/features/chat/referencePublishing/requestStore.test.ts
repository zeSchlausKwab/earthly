import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
	cancelPendingReferencePublishes,
	cancelReferencePublish,
	clearReferencePublishRequests,
	confirmReferencePublish,
	getCompletedReferencePublication,
	getReferencePublishRequest,
	getReferencePublishingExecutionContext,
	requestReferencePublish,
	setReferencePublishingChatContext,
	setReferencePublishingRunTarget,
	setReferencePublishingToolContext,
} from './requestStore'
import type { CapturedDatasetPublication, PublishedDatasetReference } from './types'

const CAPTURED: CapturedDatasetPublication = {
	binding: {
		chatId: 'chat-a',
		toolCallId: 'tool-a',
		workspaceId: 'workspace-a',
		draftId: 'draft-a',
		sourceId: 'session:a',
		draftUpdatedAt: 10,
		baseRevisionId: null,
		baseCoordinate: null,
	},
	title: 'River crossings',
	publishChannel: { kind: 'public' },
	featureCollection: { type: 'FeatureCollection', features: [] },
	contextReferences: [],
	blobReferences: [],
	featureIds: [],
	baseEvent: null,
}

const PUBLISHED: PublishedDatasetReference = {
	mode: 'new',
	datasetCoordinate: `37515:${'1'.repeat(64)}:river-crossings`,
	datasetMention: 'nostr:naddr1fresh',
	featureIds: [],
	addressChanged: true,
	eventId: 'event-1',
}

beforeEach(() => clearReferencePublishRequests())

describe('publish-before-reference request bridge', () => {
	test('carries exact chat/tool/workspace/draft identity into the dialog snapshot', () => {
		const decision = requestReferencePublish(CAPTURED, async () => PUBLISHED)
		expect(getReferencePublishRequest()).toMatchObject({
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			workspaceId: 'workspace-a',
			draftId: 'draft-a',
			datasetTitle: 'River crossings',
			status: 'awaiting-confirmation',
		})
		const id = getReferencePublishRequest()?.id
		if (!id) throw new Error('expected request')
		cancelReferencePublish(id)
		return expect(decision).resolves.toEqual({ decision: 'cancelled' })
	})

	test('awaits publication and resolves the parked tool only after success', async () => {
		let release!: () => void
		const wait = new Promise<void>((resolve) => {
			release = resolve
		})
		const publish = mock(async () => {
			await wait
			return PUBLISHED
		})
		const decision = requestReferencePublish(CAPTURED, publish)
		const id = getReferencePublishRequest()?.id
		if (!id) throw new Error('expected request')

		const confirming = confirmReferencePublish(id)
		expect(getReferencePublishRequest()?.status).toBe('publishing')
		expect(publish).toHaveBeenCalledTimes(1)
		release()
		await confirming

		expect(getReferencePublishRequest()).toBeNull()
		expect(getCompletedReferencePublication()).toMatchObject({
			captured: { binding: { workspaceId: 'workspace-a', draftId: 'draft-a' } },
			published: PUBLISHED,
		})
		await expect(decision).resolves.toEqual({ decision: 'published', published: PUBLISHED })
		setReferencePublishingRunTarget(null)
		expect(getCompletedReferencePublication()).toBeNull()
	})

	test('keeps a failed publish open for an explicit retry', async () => {
		let attempts = 0
		const decision = requestReferencePublish(CAPTURED, async () => {
			attempts += 1
			if (attempts === 1) throw new Error('relay rejected the event')
			return PUBLISHED
		})
		const id = getReferencePublishRequest()?.id
		if (!id) throw new Error('expected request')

		await confirmReferencePublish(id)
		expect(getReferencePublishRequest()).toMatchObject({
			id,
			status: 'error',
			error: 'relay rejected the event',
		})
		await confirmReferencePublish(id)
		await expect(decision).resolves.toEqual({ decision: 'published', published: PUBLISHED })
	})

	test('stream teardown cancels and releases a parked tool call', async () => {
		const decision = requestReferencePublish(CAPTURED, async () => PUBLISHED)
		expect(cancelPendingReferencePublishes()).toBe(1)
		expect(cancelPendingReferencePublishes()).toBe(0)
		await expect(decision).resolves.toEqual({ decision: 'cancelled' })
	})

	test('exposes run identity setters for chat-store wiring', () => {
		setReferencePublishingChatContext('chat-z')
		setReferencePublishingToolContext('tool-z')
		const runTarget = {
			entityType: 'dataset' as const,
			draftId: 'draft-z',
			entityId: 'dataset-z',
			sourceId: 'session:z',
			baseRevisionId: null,
			draftUpdatedAt: 42,
			wasDirty: true,
			workspaceId: 'workspace-z',
		}
		setReferencePublishingRunTarget(runTarget)
		expect(getReferencePublishingExecutionContext()).toEqual({
			chatId: 'chat-z',
			toolCallId: 'tool-z',
			runTarget,
		})
	})
})
