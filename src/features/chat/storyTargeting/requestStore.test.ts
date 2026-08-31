import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
	cancelPendingStoryTargetRequests,
	cancelStoryTarget,
	clearStoryTargetRequests,
	confirmStoryTarget,
	getStoryTargetRequest,
	requestStoryTarget,
} from './requestStore'

const REQUEST = {
	chatId: 'chat-a',
	toolCallId: 'tool-a',
	storyTitle: 'Rivers remember',
}

beforeEach(() => clearStoryTargetRequests())

describe('Story target request bridge', () => {
	test('carries exact chat and tool ownership into an awaiting dialog snapshot', async () => {
		const decision = requestStoryTarget(REQUEST, () => undefined)

		expect(getStoryTargetRequest()).toMatchObject({
			chatId: 'chat-a',
			toolCallId: 'tool-a',
			storyTitle: 'Rivers remember',
			status: 'awaiting-confirmation',
		})
		const id = getStoryTargetRequest()?.id
		if (!id) throw new Error('expected request')
		cancelStoryTarget(id)
		await expect(decision).resolves.toEqual({ decision: 'cancelled' })
	})

	test('establishes the Story target before releasing the parked tool call', async () => {
		let targetEstablished = false
		const establishTarget = mock(() => {
			targetEstablished = true
		})
		const decision = requestStoryTarget(REQUEST, establishTarget)
		const observed = decision.then(() => targetEstablished)
		const id = getStoryTargetRequest()?.id
		if (!id) throw new Error('expected request')

		confirmStoryTarget(id)

		expect(establishTarget).toHaveBeenCalledTimes(1)
		expect(getStoryTargetRequest()).toBeNull()
		await expect(decision).resolves.toEqual({ decision: 'created' })
		await expect(observed).resolves.toBe(true)
	})

	test('allows only one pending request so ownership cannot become ambiguous', async () => {
		const first = requestStoryTarget(REQUEST, () => undefined)
		await expect(
			requestStoryTarget(
				{ chatId: 'chat-b', toolCallId: 'tool-b', storyTitle: 'Second Story' },
				() => undefined,
			),
		).rejects.toThrow('Another Story target decision is already pending.')

		expect(getStoryTargetRequest()).toMatchObject({ chatId: 'chat-a', toolCallId: 'tool-a' })
		expect(cancelPendingStoryTargetRequests()).toBe(1)
		await expect(first).resolves.toEqual({ decision: 'cancelled' })
	})

	test('stream teardown and clear release the pending decision as cancelled', async () => {
		const tornDown = requestStoryTarget(REQUEST, () => undefined)
		expect(cancelPendingStoryTargetRequests()).toBe(1)
		expect(cancelPendingStoryTargetRequests()).toBe(0)
		await expect(tornDown).resolves.toEqual({ decision: 'cancelled' })

		const cleared = requestStoryTarget(REQUEST, () => undefined)
		clearStoryTargetRequests()
		expect(getStoryTargetRequest()).toBeNull()
		await expect(cleared).resolves.toEqual({ decision: 'cancelled' })
	})

	test('ignores stale request ids without creating or cancelling the target', async () => {
		const establishTarget = mock(() => undefined)
		const decision = requestStoryTarget(REQUEST, establishTarget)

		confirmStoryTarget('story-target-stale')
		cancelStoryTarget('story-target-stale')

		expect(establishTarget).not.toHaveBeenCalled()
		expect(getStoryTargetRequest()).not.toBeNull()
		clearStoryTargetRequests()
		await expect(decision).resolves.toEqual({ decision: 'cancelled' })
	})
})
