import type { Page } from '@playwright/test'
import { nip04, nip44 } from 'nostr-tools'
import { finalizeEvent, type EventTemplate } from 'nostr-tools/pure'
import type { TestIdentity } from './index'

const SIGN_BINDING = '__earthlyAiSignEvent'
const NIP04_ENCRYPT_BINDING = '__earthlyAiNip04Encrypt'
const NIP04_DECRYPT_BINDING = '__earthlyAiNip04Decrypt'
const NIP44_ENCRYPT_BINDING = '__earthlyAiNip44Encrypt'
const NIP44_DECRYPT_BINDING = '__earthlyAiNip44Decrypt'

function hexToBytes(value: string): Uint8Array {
	const pairs = value.match(/.{2}/g)
	if (pairs?.length !== 32) throw new Error('Test identity secret key must be 32 bytes')
	return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)))
}

export async function installNip07Adapter(page: Page, identity: TestIdentity): Promise<void> {
	const secretKey = hexToBytes(identity.secretKeyHex)
	await page.exposeFunction(SIGN_BINDING, (template: EventTemplate) =>
		finalizeEvent(template, secretKey),
	)
	await page.exposeFunction(NIP04_ENCRYPT_BINDING, (pubkey: string, plaintext: string) =>
		nip04.encrypt(secretKey, pubkey, plaintext),
	)
	await page.exposeFunction(NIP04_DECRYPT_BINDING, (pubkey: string, ciphertext: string) =>
		nip04.decrypt(secretKey, pubkey, ciphertext),
	)
	await page.exposeFunction(NIP44_ENCRYPT_BINDING, (pubkey: string, plaintext: string) => {
		const conversationKey = nip44.getConversationKey(secretKey, pubkey)
		return nip44.encrypt(plaintext, conversationKey)
	})
	await page.exposeFunction(NIP44_DECRYPT_BINDING, (pubkey: string, ciphertext: string) => {
		const conversationKey = nip44.getConversationKey(secretKey, pubkey)
		return nip44.decrypt(ciphertext, conversationKey)
	})
	await page.addInitScript(
		({ publicKey, bindings }) => {
			type SignFunction = (template: EventTemplate) => Promise<unknown>
			type CipherFunction = (pubkey: string, value: string) => Promise<string>
			const exposed = window as unknown as Record<string, SignFunction | CipherFunction>
			const sign = exposed[bindings.sign] as SignFunction
			const nip04Encrypt = exposed[bindings.nip04Encrypt] as CipherFunction
			const nip04Decrypt = exposed[bindings.nip04Decrypt] as CipherFunction
			const nip44Encrypt = exposed[bindings.nip44Encrypt] as CipherFunction
			const nip44Decrypt = exposed[bindings.nip44Decrypt] as CipherFunction
			Object.defineProperty(window, 'nostr', {
				configurable: true,
				value: {
					getPublicKey: async () => publicKey,
					signEvent: async (template: EventTemplate) => sign?.(template),
					getRelays: async () => ({}),
					nip04: {
						encrypt: (pubkey: string, plaintext: string) => nip04Encrypt(pubkey, plaintext),
						decrypt: (pubkey: string, ciphertext: string) => nip04Decrypt(pubkey, ciphertext),
					},
					nip44: {
						encrypt: (pubkey: string, plaintext: string) => nip44Encrypt(pubkey, plaintext),
						decrypt: (pubkey: string, ciphertext: string) => nip44Decrypt(pubkey, ciphertext),
					},
				},
			})
		},
		{
			publicKey: identity.publicKey,
			bindings: {
				sign: SIGN_BINDING,
				nip04Encrypt: NIP04_ENCRYPT_BINDING,
				nip04Decrypt: NIP04_DECRYPT_BINDING,
				nip44Encrypt: NIP44_ENCRYPT_BINDING,
				nip44Decrypt: NIP44_DECRYPT_BINDING,
			},
		},
	)
}
