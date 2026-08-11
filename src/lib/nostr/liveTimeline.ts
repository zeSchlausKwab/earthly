import type { IEventStoreActions } from 'applesauce-core/event-store'
import type { GroupReqMessage, GroupReqOptions, RelayPool } from 'applesauce-relay'
import type { Filter } from 'nostr-tools'
import type { Subscription } from 'rxjs'

export interface LiveTimelineEnvironment {
	isVisible(): boolean
	onVisibilityChange(callback: () => void): () => void
	onOnline(callback: () => void): () => void
}

type LiveTimelinePool = Pick<RelayPool, 'req'>
type LiveTimelineStore = Pick<IEventStoreActions, 'add'>

/**
 * A catalog REQ must survive both kinds of relay interruption:
 * - reconnect: transport/socket failures
 * - resubscribe: a relay's clean CLOSED response for this REQ
 */
export const LIVE_TIMELINE_REQ_OPTIONS = {
	reconnect: true,
	resubscribe: true,
} satisfies GroupReqOptions

function browserEnvironment(): LiveTimelineEnvironment {
	return {
		isVisible: () => document.visibilityState !== 'hidden',
		onVisibilityChange: (callback) => {
			document.addEventListener('visibilitychange', callback)
			return () => document.removeEventListener('visibilitychange', callback)
		},
		onOnline: (callback) => {
			window.addEventListener('online', callback)
			return () => window.removeEventListener('online', callback)
		},
	}
}

function isEventMessage(
	message: GroupReqMessage,
): message is Extract<GroupReqMessage, { type: 'EVENT' }> {
	return message.type === 'EVENT'
}

function isRelayDoneMessage(
	message: GroupReqMessage,
): message is Extract<GroupReqMessage, { type: 'EOSE' | 'ERROR' | 'CLOSED' }> {
	return message.type === 'EOSE' || message.type === 'ERROR' || message.type === 'CLOSED'
}

/**
 * Start a durable live REQ and refresh it when a suspended app returns to the
 * foreground or the browser regains network access. Reopening the broad filter
 * also catches events that arrived while a mobile WebView was frozen; the
 * EventStore deduplicates the replay and applies addressable replacements.
 */
export function startLiveTimelineSubscription({
	pool,
	store,
	relays,
	filters,
	onRelayDone,
	environment = browserEnvironment(),
}: {
	pool: LiveTimelinePool
	store: LiveTimelineStore
	relays: string[]
	filters: Filter | Filter[]
	onRelayDone?: (relay: string) => void
	environment?: LiveTimelineEnvironment
}): () => void {
	let active: Subscription | null = null
	let stopped = false

	const open = () => {
		if (stopped) return
		active?.unsubscribe()
		active = pool.req(relays, filters, LIVE_TIMELINE_REQ_OPTIONS).subscribe({
			next: (message) => {
				if (isRelayDoneMessage(message)) onRelayDone?.(message.from)
				if (!isEventMessage(message)) return
				try {
					store.add(message.event)
				} catch {
					// Invalid events are ignored at the ingestion boundary. A later
					// valid relay event must keep the live subscription usable.
				}
			},
			// Transport errors are normally handled by reconnect:true. Keep an
			// unexpected terminal error from becoming an unhandled RxJS exception;
			// online/foreground recovery will open a fresh REQ.
			error: () => undefined,
		})
	}

	const refreshIfVisible = () => {
		if (environment.isVisible()) open()
	}
	const unsubscribeVisibility = environment.onVisibilityChange(refreshIfVisible)
	const unsubscribeOnline = environment.onOnline(refreshIfVisible)
	open()

	return () => {
		stopped = true
		active?.unsubscribe()
		active = null
		unsubscribeVisibility()
		unsubscribeOnline()
	}
}
