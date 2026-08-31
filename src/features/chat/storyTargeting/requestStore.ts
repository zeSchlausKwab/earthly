export type StoryTargetRequestStatus = 'awaiting-confirmation'

export interface StoryTargetRequestInput {
	chatId: string
	toolCallId: string
	storyTitle: string
}

export interface StoryTargetRequestView extends StoryTargetRequestInput {
	id: string
	status: StoryTargetRequestStatus
}

export type StoryTargetDecision = { decision: 'created' } | { decision: 'cancelled' }

interface PendingStoryTargetRequest {
	view: StoryTargetRequestView
	establishTarget: () => void
	resolve: (decision: StoryTargetDecision) => void
}

let pendingRequest: PendingStoryTargetRequest | null = null
let snapshot: StoryTargetRequestView | null = null
let counter = 0
const subscribers = new Set<() => void>()

function nextRequestId(): string {
	counter += 1
	return `story-target-${Date.now().toString(36)}-${counter}`
}

function notify(): void {
	snapshot = pendingRequest ? { ...pendingRequest.view } : null
	for (const subscriber of subscribers) subscriber()
}

export function getStoryTargetRequest(): StoryTargetRequestView | null {
	return snapshot
}

export function subscribeStoryTargetRequest(subscriber: () => void): () => void {
	subscribers.add(subscriber)
	return () => subscribers.delete(subscriber)
}

/**
 * Park one Story-writing tool call until the user explicitly creates its Story
 * edit target or cancels. Earthly runs one AI turn globally, so a second pending
 * request is an ownership error rather than a queue that could resume the wrong
 * chat/tool call.
 */
export function requestStoryTarget(
	input: StoryTargetRequestInput,
	establishTarget: () => void,
): Promise<StoryTargetDecision> {
	if (pendingRequest) {
		return Promise.reject(new Error('Another Story target decision is already pending.'))
	}

	return new Promise<StoryTargetDecision>((resolve) => {
		pendingRequest = {
			view: {
				id: nextRequestId(),
				chatId: input.chatId,
				toolCallId: input.toolCallId,
				storyTitle: input.storyTitle,
				status: 'awaiting-confirmation',
			},
			establishTarget,
			resolve,
		}
		notify()
	})
}

export function confirmStoryTarget(requestId: string): void {
	const request = pendingRequest
	if (!request || request.view.id !== requestId) return

	// Establish the retained Story target before releasing the parked tool call.
	// This ordering prevents the resumed write from observing a targetless state.
	request.establishTarget()
	if (pendingRequest !== request) return
	pendingRequest = null
	notify()
	request.resolve({ decision: 'created' })
}

export function cancelStoryTarget(requestId: string): void {
	const request = pendingRequest
	if (!request || request.view.id !== requestId) return
	pendingRequest = null
	notify()
	request.resolve({ decision: 'cancelled' })
}

/** Stream teardown hook. Returns 1 when it released a parked tool call. */
export function cancelPendingStoryTargetRequests(): number {
	const request = pendingRequest
	if (!request) return 0
	pendingRequest = null
	notify()
	request.resolve({ decision: 'cancelled' })
	return 1
}

/** Test/reset helper; also releases any outstanding Promise. */
export function clearStoryTargetRequests(): void {
	cancelPendingStoryTargetRequests()
}
