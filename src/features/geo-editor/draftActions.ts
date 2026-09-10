import { accounts } from '@/lib/nostr'
import { clearStoryDraft, readStoryDraft } from '@/lib/nostr/story/draft'
import { openChatWorkspace } from './authoringTaskBridge'
import { navigateToRoute } from './hooks/useRouting'
import { requestOpenStoryEditor } from './storyEditorBridge'
import { useEditorStore } from './store'

/** The same saved draft can appear in Drafts, a conversation, and the map strip. */
export type DraftActionTarget =
	| { kind: 'dataset'; workspaceId: string; title: string; draftId?: string }
	| { kind: 'story'; draftKey: string; storyReference?: string; title: string }

export function draftActionKey(target: DraftActionTarget): string {
	return target.kind === 'dataset' ? `map:${target.workspaceId}` : `story:${target.draftKey}`
}

type MapDraftActions = {
	view: (workspaceId: string) => Promise<void>
	discard: (workspaceId: string, draftId: string) => void
}
let mapActions: MapDraftActions | null = null
export function registerMapDraftActions(actions: MapDraftActions) {
	mapActions = actions
	return () => {
		if (mapActions === actions) mapActions = null
	}
}

// Mounted Story forms must suppress their unmount save before a draft is deleted.
const storyDiscarders = new Map<string, () => void>()
export function registerStoryDraftDiscard(key: string, discard: () => void) {
	storyDiscarders.set(key, discard)
	return () => {
		if (storyDiscarders.get(key) === discard) storyDiscarders.delete(key)
	}
}

export async function openSavedDraft(target: DraftActionTarget): Promise<void> {
	if (target.kind === 'dataset') return openChatWorkspace(target.workspaceId)
	if (target.storyReference) {
		navigateToRoute(`/story/${target.storyReference.replace(/^nostr:/, '')}/edit`, {
			preserveThread: true,
		})
	} else {
		if (!readStoryDraft(target.draftKey)) throw new Error('This Story draft is unavailable.')
		requestOpenStoryEditor(null, target.draftKey, { reveal: true })
	}
}

export async function viewSavedDraft(target: DraftActionTarget): Promise<void> {
	if (target.kind === 'dataset') {
		if (!mapActions) throw new Error('The map editor is not ready yet.')
		await mapActions.view(target.workspaceId)
	} else {
		await openSavedDraft(target)
		requestDraftReview(target, 'preview')
	}
}

/** No network publication here: the author reviews the normal publishing controls. */
export async function reviewSavedDraft(target: DraftActionTarget): Promise<void> {
	await openSavedDraft(target)
	requestDraftReview(target, 'publish')
}

export async function discardSavedDraft(
	target: DraftActionTarget,
	owner: string | undefined,
): Promise<void> {
	if (accounts.active?.pubkey !== owner)
		throw new Error('The account changed. Reopen Drafts and try again.')
	// Keep the chat runtime off the initial Drafts bundle.
	const { useChatStore } = await import('@/features/chat/store')
	if (accounts.active?.pubkey !== owner)
		throw new Error('The account changed. Reopen Drafts and try again.')
	if (useChatStore.getState().runningChatId)
		throw new Error('Wait for AI to finish, or stop it before discarding a draft.')
	if (target.kind === 'dataset') {
		const state = useEditorStore.getState()
		const workspace = state.workspaces[target.workspaceId]
		if (!mapActions || !workspace?.activeDraftId) throw new Error('This map draft is unavailable.')
		if (target.draftId && target.draftId !== workspace.activeDraftId)
			throw new Error(
				'A different draft is now selected. Reopen the draft actions before discarding.',
			)
		mapActions.discard(target.workspaceId, workspace.activeDraftId)
	} else {
		storyDiscarders.get(target.draftKey)?.()
		clearStoryDraft(target.draftKey, owner)
	}
	await removeDraftEditingAccess(target, owner)
}

/** Also used by the global inventory and the editor's own discard command. */
export async function removeDraftEditingAccess(
	target: DraftActionTarget,
	owner: string | undefined,
): Promise<void> {
	const { useChatStore } = await import('@/features/chat/store')
	if (accounts.active?.pubkey !== owner) return
	// A sibling Map draft must not silently inherit the discarded draft's grants.
	for (const chat of useChatStore.getState().chatSessions) {
		const remaining = (chat.workingSet ?? []).filter(
			(item) => draftActionKey(item) !== draftActionKey(target),
		)
		if (
			remaining.length !== (chat.workingSet ?? []).length ||
			(target.kind === 'dataset' && chat.targetWorkspaceId === target.workspaceId)
		) {
			useChatStore.getState().setWorkingSet(chat.id, remaining)
		}
	}
}

export type DraftReviewRequest = {
	key: string
	owner: string | undefined
	action: 'publish' | 'preview'
}
let reviewRequest: DraftReviewRequest | null = null
const reviewSubscribers = new Set<() => void>()
export const getDraftReviewRequest = () => reviewRequest
export function subscribeDraftReview(subscriber: () => void) {
	reviewSubscribers.add(subscriber)
	return () => {
		reviewSubscribers.delete(subscriber)
	}
}
export function requestDraftReview(
	target: DraftActionTarget,
	action: DraftReviewRequest['action'],
) {
	reviewRequest = { key: draftActionKey(target), action, owner: accounts.active?.pubkey }
	for (const subscriber of reviewSubscribers) subscriber()
}
export function clearDraftReview(request: DraftReviewRequest) {
	if (reviewRequest !== request) return
	reviewRequest = null
	for (const subscriber of reviewSubscribers) subscriber()
}
