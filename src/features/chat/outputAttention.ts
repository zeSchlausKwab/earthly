import { useMemo, useSyncExternalStore } from 'react'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { DraftActionTarget } from '@/features/geo-editor/draftActions'
import { accounts } from '@/lib/nostr'

export interface AiOutputNotice {
	chatId: string
	target: DraftActionTarget
	key: string
	version: number
	listSeen: boolean
	ownerPubkey: string | null
}

export function aiOutputKey(target: DraftActionTarget): string {
	return target.kind === 'dataset' ? `map:${target.workspaceId}` : `story:${target.draftKey}`
}

/** Session-only attention, separate from durable drafts and AI permissions. */
export class AiOutputAttentionStore {
	private notices: readonly AiOutputNotice[] = []
	private version = 0
	private listeners = new Set<() => void>()
	getSnapshot = () => this.notices
	subscribe = (listener: () => void) => {
		this.listeners.add(listener)
		return () => {
			this.listeners.delete(listener)
		}
	}
	private update(next: readonly AiOutputNotice[]) {
		if (next === this.notices) return
		this.notices = next
		for (const listener of this.listeners) {
			try {
				listener()
			} catch (error) {
				console.error('[Chat] Could not update the AI work indicator', error)
			}
		}
	}
	record(chatId: string, target: DraftActionTarget, ownerPubkey: string | null) {
		const key = aiOutputKey(target)
		const remaining = this.notices.filter(
			(notice) =>
				notice.chatId !== chatId || notice.key !== key || notice.ownerPubkey !== ownerPubkey,
		)
		this.update([
			...remaining.slice(-199),
			{
				chatId,
				target: { ...target },
				key,
				ownerPubkey,
				version: ++this.version,
				listSeen: false,
			},
		])
	}
	acknowledgeList(chatId: string, ownerPubkey?: string | null) {
		const matches = (notice: AiOutputNotice) =>
			notice.chatId === chatId && (ownerPubkey === undefined || notice.ownerPubkey === ownerPubkey)
		if (!this.notices.some((notice) => matches(notice) && !notice.listSeen)) return
		this.update(
			this.notices.map((notice) => (matches(notice) ? { ...notice, listSeen: true } : notice)),
		)
	}
	acknowledgeTarget(target: DraftActionTarget, ownerPubkey?: string | null) {
		const key = aiOutputKey(target)
		const matches = (notice: AiOutputNotice) =>
			notice.key === key && (ownerPubkey === undefined || notice.ownerPubkey === ownerPubkey)
		if (!this.notices.some(matches)) return
		this.update(this.notices.filter((notice) => !matches(notice)))
	}
}

const attention = new AiOutputAttentionStore()
export const reportAiOutputChange = (
	chatId: string,
	target: DraftActionTarget,
	ownerPubkey: string | null,
) => attention.record(chatId, target, ownerPubkey)
export const acknowledgeAiOutputList = (chatId: string) =>
	attention.acknowledgeList(chatId, accounts.active?.pubkey ?? null)
export const acknowledgeAiOutput = (target: DraftActionTarget) =>
	attention.acknowledgeTarget(target, accounts.active?.pubkey ?? null)

/** Read the small bridge without loading the chat execution runtime. */
export function useAiOutputAttention(chatId?: string): readonly AiOutputNotice[] {
	const all = useSyncExternalStore(
		attention.subscribe,
		attention.getSnapshot,
		attention.getSnapshot,
	)
	const account = useActiveAccount()
	const ownerPubkey = account?.pubkey ?? null
	return useMemo(
		() =>
			all.filter(
				(notice) =>
					notice.ownerPubkey === ownerPubkey && (chatId === undefined || notice.chatId === chatId),
			),
		[all, chatId, ownerPubkey],
	)
}
