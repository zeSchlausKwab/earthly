import {
	matchFilters,
	validateEvent,
	verifyEvent,
	type EventTemplate,
	type Filter,
	type NostrEvent,
} from 'nostr-tools'

export interface MapletDataPolicy {
	namespace: string
	filters(value: unknown, pubkey: string): Filter[]
	template(value: unknown, pubkey: string, encrypted: boolean): EventTemplate
	privateKind: number
}
export interface MapletDataDependencies {
	pubkey(): string
	storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'length' | 'key'>
	query(filters: Filter[], signal: AbortSignal): Promise<NostrEvent[]>
	sign(template: EventTemplate): Promise<NostrEvent>
	encrypt(pubkey: string, content: string): Promise<string>
	decrypt(pubkey: string, content: string): Promise<string>
	publish(event: NostrEvent, signal: AbortSignal, beforeCommit: () => void): Promise<void>
}

/** Capability broker: identity-scoped storage and explicitly granted Nostr reads/writes. */
export function createMapletDataServices(policy: MapletDataPolicy, deps: MapletDataDependencies) {
	// Serialize signing/publication, including updates made in the same second.
	let writing = false
	const timestamps = new Map<string, number>()
	return async (
		type: string,
		data: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<Record<string, unknown>> => {
		const pubkey = deps.pubkey()
		const check = () => {
			signal.throwIfAborted()
			if (deps.pubkey() !== pubkey) throw new Error('Account changed during the request')
		}
		const withSigner = async <T>(operation: string, action: () => Promise<T>): Promise<T> => {
			try {
				return await action()
			} catch (cause) {
				check()
				// Extension failures can be strings and may expose an internal exception
				// when a remembered Earthly account outlives the signer's unlocked session.
				const detail = (cause instanceof Error ? cause.message : String(cause)).slice(0, 500)
				throw new Error(
					`Your signer could not ${operation} this request. Open your signer, unlock it if needed, and retry. Signer error: ${detail}`,
					{ cause },
				)
			}
		}
		check()
		if (type.startsWith('storage.')) {
			const prefix = `earthly:maplet-storage:${policy.namespace}:${pubkey || 'anonymous'}:`
			if (type === 'storage.keys') {
				const keys: string[] = []
				for (let i = 0; i < deps.storage.length; i++) {
					const key = deps.storage.key(i)
					if (key?.startsWith(prefix)) keys.push(key.slice(prefix.length))
				}
				return { keys }
			}
			if (typeof data.key !== 'string' || !/^[a-zA-Z0-9:_-]{1,128}$/.test(data.key))
				throw new Error('Invalid storage key')
			const key = prefix + data.key
			if (type === 'storage.get') return { value: JSON.parse(deps.storage.getItem(key) ?? 'null') }
			if (type === 'storage.remove') deps.storage.removeItem(key)
			else if (type === 'storage.set') {
				const value = JSON.stringify(data.value)
				if (!value || value.length > 128 * 1024) throw new Error('Storage value exceeds 128 KiB')
				let total = value.length
				for (let i = 0; i < deps.storage.length; i++) {
					const entry = deps.storage.key(i)
					if (entry?.startsWith(prefix) && entry !== key)
						total += deps.storage.getItem(entry)?.length ?? 0
				}
				if (total > 256 * 1024) throw new Error('Maplet storage quota exceeded')
				deps.storage.setItem(key, value)
			} else throw new Error('Unsupported storage operation')
			return { ok: true }
		}
		if (type === 'relay.query') {
			const filters = policy.filters(data.filters, pubkey)
			const received = await deps.query(filters, signal)
			check()
			const events: { event: NostrEvent }[] = []
			for (const input of received.slice(0, 500)) {
				if (!input || JSON.stringify(input).length > 200_000) continue
				const event = JSON.parse(JSON.stringify(input)) as NostrEvent
				if (!validateEvent(event) || !verifyEvent(event) || !matchFilters(filters, event)) continue
				if (event.kind === policy.privateKind) {
					if (!pubkey || event.pubkey !== pubkey) continue
					event.content = await withSigner('decrypt', () => deps.decrypt(pubkey, event.content))
					check()
				}
				try {
					policy.template(event, event.pubkey, event.kind === policy.privateKind)
				} catch {
					continue
				}
				const address = `${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1]}`
				timestamps.set(address, Math.max(timestamps.get(address) ?? 0, event.created_at))
				events.push({ event })
			}
			return { events }
		}
		if (type !== 'relay.publish' && type !== 'relay.publishEncrypted')
			throw new Error('Unsupported relay operation')
		if (!pubkey) throw new Error('Sign in to save or publish sources')
		if (writing) throw new Error('Another save is still in progress')
		writing = true
		try {
			const encrypted = type === 'relay.publishEncrypted'
			if (encrypted && (data.recipient !== pubkey || data.encryption !== 'nip44'))
				throw new Error('Only NIP-44 encryption to your own account is permitted')
			const template = policy.template(data.event, pubkey, encrypted)
			const address = `${template.kind}:${pubkey}:${template.tags.find((tag) => tag[0] === 'd')?.[1]}`
			template.created_at = Math.max(
				Math.floor(Date.now() / 1000),
				(timestamps.get(address) ?? 0) + 1,
			)
			if (template.created_at > Math.floor(Date.now() / 1000) + 30)
				throw new Error('Please wait before updating this source again')
			if (encrypted) {
				template.content = await withSigner('encrypt', () => deps.encrypt(pubkey, template.content))
				check()
			}
			const event = await withSigner('sign', () => deps.sign(template))
			check()
			if (
				event.pubkey !== pubkey ||
				!verifyEvent(JSON.parse(JSON.stringify(event))) ||
				event.kind !== template.kind ||
				event.content !== template.content ||
				event.created_at !== template.created_at ||
				JSON.stringify(event.tags) !== JSON.stringify(template.tags)
			)
				throw new Error('Signer returned an unexpected event')
			await deps.publish(event, signal, check)
			check()
			timestamps.set(address, event.created_at)
			return { ok: true, event, eventId: event.id }
		} finally {
			writing = false
		}
	}
}
