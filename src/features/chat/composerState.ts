import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import type { EditorFeature } from '@/features/geo-editor/core'
import type { AttachedFileView } from './components/FileChip'
import { evictDataset } from './ingest/ingestStore'

export type ChatComposerValueUpdate<T> = T | ((current: T) => T)

/**
 * Unsent, session-only input owned by one conversation. This intentionally
 * lives outside ChatPanel so closing the mobile sheet or crossing a breakpoint
 * cannot discard a half-written turn or an in-flight attachment parse.
 */
export interface ChatComposerDraft {
	input: string
	selectionContext: EditorFeature[]
	geometry: FeatureCollection | null
	files: AttachedFileView[]
	sendAnyway: boolean
}

export function createEmptyChatComposerDraft(): ChatComposerDraft {
	return {
		input: '',
		selectionContext: [],
		geometry: null,
		files: [],
		sendAnyway: false,
	}
}

interface ChatComposerState {
	drafts: Record<string, ChatComposerDraft>
	setDraft: (chatId: string, next: ChatComposerValueUpdate<ChatComposerDraft>) => void
	deleteDraft: (chatId: string) => void
	reset: () => void
}

function evictUnsentDatasetHandles(draft: ChatComposerDraft | undefined): void {
	for (const file of draft?.files ?? []) {
		if (file.summary?.handleId) evictDataset(file.summary.handleId)
	}
}

/** Apply a composer update to its initiating Chat, never the currently visible one. */
export function updateChatComposerValue<T>(
	current: Record<string, T>,
	chatId: string,
	next: ChatComposerValueUpdate<T>,
	defaultValue: T,
): Record<string, T> {
	const previous = current[chatId] ?? defaultValue
	return {
		...current,
		[chatId]: typeof next === 'function' ? (next as (value: T) => T)(previous) : next,
	}
}

/**
 * Memory-only companion store. Keeping this separate from the persisted Chat
 * history avoids rewriting localStorage on every keystroke while still
 * surviving ChatPanel/mobile-sheet unmounts.
 */
export const useChatComposerStore = create<ChatComposerState>()((set) => ({
	drafts: {},
	setDraft: (chatId, next) => {
		set((state) => ({
			drafts: updateChatComposerValue(state.drafts, chatId, next, createEmptyChatComposerDraft()),
		}))
	},
	deleteDraft: (chatId) => {
		set((state) => {
			if (!(chatId in state.drafts)) return state
			evictUnsentDatasetHandles(state.drafts[chatId])
			const drafts = { ...state.drafts }
			delete drafts[chatId]
			return { drafts }
		})
	},
	reset: () =>
		set((state) => {
			for (const draft of Object.values(state.drafts)) evictUnsentDatasetHandles(draft)
			return { drafts: {} }
		}),
}))

export const chatComposerActions = {
	setDraft: (chatId: string, next: ChatComposerValueUpdate<ChatComposerDraft>) =>
		useChatComposerStore.getState().setDraft(chatId, next),
	deleteDraft: (chatId: string) => useChatComposerStore.getState().deleteDraft(chatId),
	reset: () => useChatComposerStore.getState().reset(),
}
