import { expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey, nip44, type NostrEvent } from 'nostr-tools'
import { createMapletDataServices } from './data'
import { myMapsDataPolicy } from '@/features/maplets/myMapsPolicy'
import { myMapsModel } from '@/features/maplets/myMapsModel'

function setup() {
	const key = generateSecretKey()
	const pubkey = getPublicKey(key)
	let current = pubkey
	const storage = new Map<string, string>()
	const published: NostrEvent[] = []
	let queried: NostrEvent[] = []
	let afterSign = () => {}
	const signerErrors: Partial<Record<'sign' | 'encrypt' | 'decrypt', unknown>> = {}
	const checkSigner = (operation: keyof typeof signerErrors) => {
		if (operation in signerErrors) throw signerErrors[operation]
	}
	const cipher = nip44.getConversationKey(key, pubkey)
	const request = createMapletDataServices(myMapsDataPolicy, {
		pubkey: () => current,
		storage: {
			get length() {
				return storage.size
			},
			key: (i) => [...storage.keys()][i] ?? null,
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => {
				storage.set(key, value)
			},
			removeItem: (key) => {
				storage.delete(key)
			},
		},
		query: async () => queried,
		encrypt: async (_, content) => {
			checkSigner('encrypt')
			return nip44.encrypt(content, cipher)
		},
		decrypt: async (_, content) => {
			checkSigner('decrypt')
			return nip44.decrypt(content, cipher)
		},
		sign: async (template) => {
			checkSigner('sign')
			const event = finalizeEvent(template, key)
			afterSign()
			return event
		},
		publish: async (event, _, beforeCommit) => {
			beforeCommit()
			published.push(event)
		},
	})
	return {
		request: (type: string, data: Record<string, unknown>, signal = new AbortController().signal) =>
			request(type, data, signal),
		published,
		pubkey,
		key,
		cipher,
		signerErrors,
		switchAccount: (next: string) => {
			current = next
		},
		setQuery: (events: NostrEvent[]) => {
			queried = events
		},
		afterSign: (fn: () => void) => {
			afterSign = fn
		},
	}
}
const source = myMapsModel.source({
	url: 'https://www.google.com/maps/d/viewer?mid=publicMap123',
	title: 'Coast',
})

test('signer failures explain recovery, preserve local sources, and allow an explicit retry', async () => {
	const host = setup()
	const failure = "Uncaught TypeError: Cannot read properties of undefined (reading 'find')"
	const preferences = { version: 1, sources: [source] }
	await host.request('storage.set', { key: 'saved', value: preferences })
	host.signerErrors.sign = new Error(failure)
	await expect(
		host.request('relay.publish', { event: myMapsModel.announcement(source) }),
	).rejects.toThrow(
		`Your signer could not sign this request. Open your signer, unlock it if needed, and retry. Signer error: ${failure}`,
	)
	expect(host.published).toHaveLength(0)
	delete host.signerErrors.sign
	await host.request('relay.publish', { event: myMapsModel.announcement(source) })
	expect(host.published).toHaveLength(1)

	const encrypted = {
		event: {
			kind: 30078,
			content: JSON.stringify(preferences),
			tags: [['d', myMapsModel.preferencesId]],
		},
		recipient: host.pubkey,
		encryption: 'nip44',
	}
	host.signerErrors.encrypt = failure
	await expect(host.request('relay.publishEncrypted', encrypted)).rejects.toThrow(
		'Your signer could not encrypt this request. Open your signer',
	)
	expect(host.published).toHaveLength(1)
	expect(await host.request('storage.get', { key: 'saved' })).toEqual({ value: preferences })
	delete host.signerErrors.encrypt
	await host.request('relay.publishEncrypted', encrypted)
	const saved = host.published[1]
	if (!saved) throw new Error('Missing saved preferences')
	host.setQuery([saved])
	host.signerErrors.decrypt = new Error(failure)
	await expect(
		host.request('relay.query', {
			filters: [{ kinds: [30078], authors: [host.pubkey], '#d': [myMapsModel.preferencesId] }],
		}),
	).rejects.toThrow('Your signer could not decrypt this request. Open your signer')
})

test('storage is scoped to the active account and bounded by quota', async () => {
	const host = setup()
	await host.request('storage.set', { key: 'saved', value: { private: 'my sources' } })
	host.switchAccount('b'.repeat(64))
	expect(await host.request('storage.get', { key: 'saved' })).toEqual({ value: null })
	host.switchAccount(host.pubkey)
	expect(await host.request('storage.get', { key: 'saved' })).toEqual({
		value: { private: 'my sources' },
	})
	await expect(
		host.request('storage.set', { key: 'huge', value: 'a'.repeat(200_000) }),
	).rejects.toThrow('128 KiB')
})
test('private preferences are self-encrypted, signed, and decrypted only for their owner', async () => {
	const host = setup()
	const content = JSON.stringify({ version: 1, sources: [source] })
	await host.request('relay.publishEncrypted', {
		event: { kind: 30078, content, tags: [['d', myMapsModel.preferencesId]] },
		recipient: host.pubkey,
		encryption: 'nip44',
	})
	const saved = host.published[0]
	if (!saved) throw new Error('Missing saved preferences')
	expect(saved.content).not.toContain('google.com')
	expect(JSON.parse(nip44.decrypt(saved.content, host.cipher)).sources).toHaveLength(1)
	host.setQuery([saved])
	const filters = [{ kinds: [30078], authors: [host.pubkey], '#d': [myMapsModel.preferencesId] }]
	const result = await host.request('relay.query', { filters })
	expect((result.events as { event: NostrEvent }[])[0]?.event.content).toBe(content)
	host.switchAccount('b'.repeat(64))
	await expect(host.request('relay.query', { filters })).rejects.toThrow('signed-in account')
})
test('relay reads reject tampered signatures and publication timestamps advance for replacements', async () => {
	const host = setup()
	const template = myMapsModel.announcement(source)
	await host.request('relay.publish', { event: template })
	await host.request('relay.publish', { event: template })
	const [first, second] = host.published
	if (!first || !second) throw new Error('Missing source publications')
	expect(second.created_at).toBeGreaterThan(first.created_at)
	host.setQuery([{ ...first, content: '{}' }])
	expect(
		await host.request('relay.query', {
			filters: [{ kinds: [myMapsModel.kind], '#t': ['maplet-source'] }],
		}),
	).toEqual({ events: [] })
})
test('account switches and cancellation during signing prevent publication', async () => {
	const host = setup()
	host.afterSign(() => host.switchAccount('b'.repeat(64)))
	await expect(
		host.request('relay.publish', { event: myMapsModel.announcement(source) }),
	).rejects.toThrow('Account changed')
	expect(host.published).toHaveLength(0)
	host.switchAccount(host.pubkey)
	const controller = new AbortController()
	host.afterSign(() => controller.abort())
	await expect(
		host.request('relay.publish', { event: myMapsModel.announcement(source) }, controller.signal),
	).rejects.toThrow()
	expect(host.published).toHaveLength(0)
})
test('anonymous publication, unrelated kinds, and encryption to another person are denied', async () => {
	const host = setup()
	await expect(
		host.request('relay.publish', { event: { kind: 1, content: '', tags: [] } }),
	).rejects.toThrow()
	await expect(
		host.request('relay.publishEncrypted', {
			recipient: 'b'.repeat(64),
			encryption: 'nip44',
			event: {},
		}),
	).rejects.toThrow('own account')
	host.switchAccount('')
	await expect(
		host.request('relay.publish', { event: myMapsModel.announcement(source) }),
	).rejects.toThrow('Sign in')
	expect(host.published).toHaveLength(0)
})
