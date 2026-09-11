const READ_STATE_VERSION = 1
const MAX_EXPLICIT_READ_IDS = 1_000

export interface InboxReadStateV1 {
	version: 1
	/** Notifications at or before this Unix timestamp are read. */
	readThrough: number
	/** Individually opened notifications newer than readThrough. */
	readIds: string[]
}

export const EMPTY_INBOX_READ_STATE: InboxReadStateV1 = {
	version: READ_STATE_VERSION,
	readThrough: 0,
	readIds: [],
}

export function inboxReadStorageKey(pubkey: string): string {
	return `earthly:inbox-read:v1:${pubkey}`
}

export function parseInboxReadState(raw: string | null | undefined): InboxReadStateV1 {
	if (!raw) return { ...EMPTY_INBOX_READ_STATE }
	try {
		const value = JSON.parse(raw) as Partial<InboxReadStateV1>
		if (value.version !== READ_STATE_VERSION) return { ...EMPTY_INBOX_READ_STATE }
		return {
			version: READ_STATE_VERSION,
			readThrough:
				typeof value.readThrough === 'number' && Number.isFinite(value.readThrough)
					? Math.max(0, value.readThrough)
					: 0,
			readIds: Array.isArray(value.readIds)
				? value.readIds
						.filter((id): id is string => typeof id === 'string')
						.slice(-MAX_EXPLICIT_READ_IDS)
				: [],
		}
	} catch {
		return { ...EMPTY_INBOX_READ_STATE }
	}
}

export function isInboxItemRead(
	state: InboxReadStateV1,
	item: { id: string; createdAt: number },
): boolean {
	return item.createdAt <= state.readThrough || state.readIds.includes(item.id)
}

export function markInboxItemRead(state: InboxReadStateV1, id: string): InboxReadStateV1 {
	if (state.readIds.includes(id)) return state
	return {
		...state,
		readIds: [...state.readIds, id].slice(-MAX_EXPLICIT_READ_IDS),
	}
}

export function markInboxAllRead(
	state: InboxReadStateV1,
	items: readonly { createdAt: number }[],
	now = Math.floor(Date.now() / 1_000),
): InboxReadStateV1 {
	const newestItem = items.reduce((latest, item) => Math.max(latest, item.createdAt), 0)
	return {
		version: READ_STATE_VERSION,
		readThrough: Math.max(state.readThrough, newestItem, now),
		readIds: [],
	}
}
