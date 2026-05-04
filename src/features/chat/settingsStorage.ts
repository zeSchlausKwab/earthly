import type { ISigner } from 'applesauce-signers'
import type { ChatSettingsSnapshot } from './store'

const CHAT_SETTINGS_STORAGE_PREFIX = 'earthly.chat-settings.v1'

type Scheme = 'nip04' | 'nip44'

interface StoredChatSettingsEnvelope {
	version: 1
	scheme: Scheme
	ciphertext: string
	updatedAt: number
}

function getChatSettingsStorageKey(pubkey: string): string {
	return `${CHAT_SETTINGS_STORAGE_PREFIX}.${pubkey}`
}

/** Pick nip44 if the signer supports it, fall back to nip04. */
function resolveEncryptionScheme(signer: ISigner): Scheme {
	if (signer.nip44) return 'nip44'
	return 'nip04'
}

export async function loadEncryptedChatSettings(
	signer: ISigner,
	pubkey: string,
): Promise<ChatSettingsSnapshot | null> {
	if (typeof window === 'undefined') return null

	const raw = window.localStorage.getItem(getChatSettingsStorageKey(pubkey))
	if (!raw) return null

	const envelope = JSON.parse(raw) as StoredChatSettingsEnvelope
	if (!envelope?.ciphertext || !envelope?.scheme) return null

	const provider = envelope.scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) {
		throw new Error(`Active signer does not support ${envelope.scheme} decryption`)
	}
	const decrypted = await provider.decrypt(pubkey, envelope.ciphertext)
	return JSON.parse(decrypted) as ChatSettingsSnapshot
}

export async function saveEncryptedChatSettings(
	signer: ISigner,
	pubkey: string,
	settings: ChatSettingsSnapshot,
): Promise<void> {
	if (typeof window === 'undefined') return

	const scheme = resolveEncryptionScheme(signer)
	const provider = scheme === 'nip44' ? signer.nip44 : signer.nip04
	if (!provider) throw new Error(`Active signer does not support ${scheme} encryption`)
	const ciphertext = await provider.encrypt(pubkey, JSON.stringify(settings))
	const envelope: StoredChatSettingsEnvelope = {
		version: 1,
		scheme,
		ciphertext,
		updatedAt: Date.now(),
	}

	window.localStorage.setItem(getChatSettingsStorageKey(pubkey), JSON.stringify(envelope))
}
