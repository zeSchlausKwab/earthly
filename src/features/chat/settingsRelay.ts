import type { ISigner } from 'applesauce-signers'
import { type NostrEvent, verifyEvent } from 'nostr-tools'
import type { Subscription } from 'rxjs'
import { normalizeChatSettings } from './settingsStorage'
import type { ChatSettingsSnapshot } from './store'

export const CHAT_SETTINGS_KIND = 30078
export const CHAT_SETTINGS_IDENTIFIER = 'earthly:chat-settings'
export const chatSettingsDirtyKey = (pubkey: string) => `earthly.chat-settings.dirty.${pubkey}`
const key = (pubkey: string) => `earthly.chat-settings.relay.v1.${pubkey}`

export function newerSettingsEvent(a: NostrEvent, b: NostrEvent): NostrEvent {
	return a.created_at > b.created_at || (a.created_at === b.created_at && a.id < b.id) ? a : b
}

export function isChatSettingsEvent(event: NostrEvent, pubkey: string): boolean {
	return (
		event.kind === CHAT_SETTINGS_KIND &&
		event.pubkey === pubkey &&
		event.tags.some((tag) => tag[0] === 'd' && tag[1] === CHAT_SETTINGS_IDENTIFIER) &&
		event.content.length <= 100_000 &&
		verifyEvent(event)
	)
}

function cached(pubkey: string): { event: NostrEvent; pending: boolean } | null {
	const raw = localStorage.getItem(key(pubkey))
	if (!raw) return null
	const value = JSON.parse(raw)
	if (!value.event || !isChatSettingsEvent(value.event, pubkey))
		throw new Error('Invalid encrypted connection cache')
	return value
}

export async function queryChatSettings(pubkey: string): Promise<NostrEvent | null> {
	const { pool, readRelaysFor, eventStore } = await import('@/lib/nostr')
	const relays = [
		...new Set([
			...readRelaysFor('content'),
			...readRelaysFor('discovery'),
			...(eventStore
				.getReplaceable(10002, pubkey)
				?.tags.filter((tag) => tag[0] === 'r' && tag[2] !== 'read')
				.map((tag) => tag[1])
				.filter((url): url is string => Boolean(url)) ?? []),
		]),
	]
	if (!relays.length) throw new Error('No relays configured for connection sync')
	return new Promise((resolve, reject) => {
		let latest: NostrEvent | null = null
		let subscription: Subscription | undefined
		const completed = new Set<string>()
		let successful = 0
		let finished = false
		const finish = () => {
			if (finished) return
			finished = true
			clearTimeout(timer)
			subscription?.unsubscribe()
			if (!successful)
				reject(
					new Error('Relays could not be reached. Connections remain encrypted on this device.'),
				)
			else resolve(latest)
		}
		const timer = setTimeout(finish, 8_000)
		subscription = pool
			.req(
				relays,
				[
					{
						kinds: [CHAT_SETTINGS_KIND],
						authors: [pubkey],
						'#d': [CHAT_SETTINGS_IDENTIFIER],
						limit: 1,
					},
				],
				{ reconnect: false, resubscribe: false },
			)
			.subscribe({
				next(message) {
					if (message.type === 'EVENT' && isChatSettingsEvent(message.event, pubkey))
						latest = latest ? newerSettingsEvent(latest, message.event) : message.event
					if (message.type === 'EOSE' || message.type === 'CLOSED' || message.type === 'ERROR') {
						if (!completed.has(message.from) && message.type === 'EOSE') successful += 1
						completed.add(message.from)
						if (completed.size === relays.length) finish()
					}
				},
				error: finish,
			})
		if (finished) subscription.unsubscribe()
	})
}

export async function loadRelayChatSettings(
	signer: ISigner,
	pubkey: string,
): Promise<{ settings: ChatSettingsSnapshot | null; pending: boolean }> {
	const local = cached(pubkey)
	const remote = await queryChatSettings(pubkey)
	const event = local && remote ? newerSettingsEvent(local.event, remote) : (remote ?? local?.event)
	if (!event) return { settings: null, pending: false }
	if (!signer.nip44) throw new Error('Your signer needs NIP-44 to sync connections')
	const settings = normalizeChatSettings(
		JSON.parse(await signer.nip44.decrypt(pubkey, event.content)),
	)
	const pending = local?.event.id === event.id && local.pending && remote?.id !== event.id
	localStorage.setItem(key(pubkey), JSON.stringify({ event, pending }))
	return { settings, pending: Boolean(pending) }
}

/** Persist the signed ciphertext before publishing, so failed delivery is recoverable. */
export async function saveRelayChatSettings(
	signer: ISigner,
	pubkey: string,
	settings: ChatSettingsSnapshot,
	isCurrent: () => boolean,
): Promise<boolean> {
	if (!signer.nip44)
		throw new Error('Your signer needs NIP-44 to sync connections; saved locally only')
	if (!isCurrent()) return false
	const previous = cached(pubkey)
	const content = await signer.nip44.encrypt(
		pubkey,
		JSON.stringify(normalizeChatSettings(settings)),
	)
	if (!isCurrent()) return false
	const event = await signer.signEvent({
		kind: CHAT_SETTINGS_KIND,
		created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.event.created_at ?? 0) + 1),
		tags: [['d', CHAT_SETTINGS_IDENTIFIER]],
		content,
	})
	if (!isCurrent() || event.pubkey !== pubkey) return false
	localStorage.setItem(key(pubkey), JSON.stringify({ event, pending: true }))
	const { publish } = await import('@/lib/nostr')
	if (!isCurrent()) return false
	const responses = await publish(event, {
		routing: 'outbox',
		beforeCommit: () => {
			if (!isCurrent()) throw new Error('Account changed during settings sync')
		},
	})
	// Native publication may be durably queued but not yet acknowledged by a relay.
	if (!responses.some((response) => response.ok)) return false
	localStorage.setItem(key(pubkey), JSON.stringify({ event, pending: false }))
	localStorage.removeItem(chatSettingsDirtyKey(pubkey))
	return true
}
