import type {
	CapturedDatasetPublication,
	PublishedDatasetReference,
	ReferencePublishDecision,
} from './types'
import type { ToolExecutionTarget } from '@/features/chat/tools/types'

export type ReferencePublishingRunTarget = ToolExecutionTarget

export type ReferencePublishRequestStatus = 'awaiting-confirmation' | 'publishing' | 'error'

export interface ReferencePublishRequestView {
	id: string
	chatId: string
	toolCallId: string
	workspaceId: string
	draftId: string
	datasetTitle: string
	status: ReferencePublishRequestStatus
	error: string | null
}

interface PendingReferencePublishRequest {
	captured: CapturedDatasetPublication
	view: ReferencePublishRequestView
	publish: () => Promise<PublishedDatasetReference>
	resolve: (decision: ReferencePublishDecision) => void
}

export interface CompletedReferencePublication {
	captured: CapturedDatasetPublication
	published: PublishedDatasetReference
}

let currentChatId: string | null = null
let currentToolCallId: string | null = null
let currentRunTarget: ReferencePublishingRunTarget | null = null
let pendingRequest: PendingReferencePublishRequest | null = null
let completedPublication: CompletedReferencePublication | null = null
let snapshot: ReferencePublishRequestView | null = null
let counter = 0
const subscribers = new Set<() => void>()

/** Mirrored by the chat run beside setPendingDiffChatContext. */
export function setReferencePublishingChatContext(chatId: string | null): void {
	currentChatId = chatId
}

/** Mirrored by the chat run around each executeToolCall call. */
export function setReferencePublishingToolContext(toolCallId: string | null): void {
	currentToolCallId = toolCallId
}

/** Immutable Dataset/editor target captured when Send starts the owning run. */
export function setReferencePublishingRunTarget(target: ReferencePublishingRunTarget | null): void {
	currentRunTarget = target
	// A receipt is valid only inside the run/manual action that produced it. A
	// new Send captures a fresh base revision and must evaluate publication again.
	completedPublication = null
}

export function getReferencePublishingExecutionContext(): {
	chatId: string | null
	toolCallId: string | null
	runTarget: ReferencePublishingRunTarget | null
} {
	return { chatId: currentChatId, toolCallId: currentToolCallId, runTarget: currentRunTarget }
}

export function getCompletedReferencePublication(): CompletedReferencePublication | null {
	return completedPublication
}

function nextRequestId(): string {
	counter += 1
	return `reference-publish-${Date.now().toString(36)}-${counter}`
}

function notify(): void {
	snapshot = pendingRequest ? { ...pendingRequest.view } : null
	for (const subscriber of subscribers) subscriber()
}

export function getReferencePublishRequest(): ReferencePublishRequestView | null {
	return snapshot
}

export function subscribeReferencePublishRequest(subscriber: () => void): () => void {
	subscribers.add(subscriber)
	return () => subscribers.delete(subscriber)
}

/**
 * Park the tool call until the user explicitly publishes or cancels. Only one
 * AI run may execute globally, so a second pending request is a programming
 * error rather than a queue whose ownership could become ambiguous.
 */
export function requestReferencePublish(
	captured: CapturedDatasetPublication,
	publish: () => Promise<PublishedDatasetReference>,
): Promise<ReferencePublishDecision> {
	if (pendingRequest) {
		return Promise.reject(
			new Error('Another publish-before-reference decision is already pending.'),
		)
	}

	return new Promise<ReferencePublishDecision>((resolve) => {
		pendingRequest = {
			captured,
			view: {
				id: nextRequestId(),
				chatId: captured.binding.chatId,
				toolCallId: captured.binding.toolCallId,
				workspaceId: captured.binding.workspaceId,
				draftId: captured.binding.draftId,
				datasetTitle: captured.title,
				status: 'awaiting-confirmation',
				error: null,
			},
			publish,
			resolve,
		}
		notify()
	})
}

export async function confirmReferencePublish(requestId: string): Promise<void> {
	const request = pendingRequest
	if (!request || request.view.id !== requestId || request.view.status === 'publishing') return

	request.view = { ...request.view, status: 'publishing', error: null }
	notify()
	try {
		const published = await request.publish()
		// Stop/delete may have cancelled the parked tool while signing or publishing.
		// The immutable dataset event may still have landed, but never resume a stale
		// Story write after its owning run was detached.
		if (pendingRequest !== request) return
		pendingRequest = null
		completedPublication = { captured: request.captured, published }
		notify()
		request.resolve({ decision: 'published', published })
	} catch (error) {
		if (pendingRequest !== request) return
		request.view = {
			...request.view,
			status: 'error',
			error: error instanceof Error ? error.message : 'Failed to publish this Dataset.',
		}
		notify()
	}
}

export function cancelReferencePublish(requestId: string): void {
	const request = pendingRequest
	if (!request || request.view.id !== requestId) return
	pendingRequest = null
	notify()
	request.resolve({ decision: 'cancelled' })
}

/** Stream teardown hook. Returns 1 when it released a parked tool call. */
export function cancelPendingReferencePublishes(): number {
	const request = pendingRequest
	if (!request) return 0
	pendingRequest = null
	notify()
	request.resolve({ decision: 'cancelled' })
	return 1
}

/** Test reset; also releases any outstanding Promise. */
export function clearReferencePublishRequests(): void {
	cancelPendingReferencePublishes()
	currentChatId = null
	currentToolCallId = null
	currentRunTarget = null
	completedPublication = null
}
