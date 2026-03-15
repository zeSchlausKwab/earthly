import type { NDKEncryptionScheme, NDKSigner, NDKUser } from '@nostr-dev-kit/ndk'
import type { ChatSettingsSnapshot } from './store'

const CHAT_SETTINGS_STORAGE_PREFIX = 'earthly.chat-settings.v1'

interface StoredChatSettingsEnvelope {
	version: 1
	scheme: NDKEncryptionScheme
	ciphertext: string
	updatedAt: number
}

function getChatSettingsStorageKey(pubkey: string): string {
	return `${CHAT_SETTINGS_STORAGE_PREFIX}.${pubkey}`
}

async function resolveEncryptionScheme(signer: NDKSigner): Promise<NDKEncryptionScheme> {
	const supportedSchemes = await signer.encryptionEnabled?.()
	if (supportedSchemes?.includes('nip44')) return 'nip44'
	return 'nip04'
}

export async function loadEncryptedChatSettings(
	signer: NDKSigner,
	user: NDKUser,
): Promise<ChatSettingsSnapshot | null> {
	if (typeof window === 'undefined') return null

	const raw = window.localStorage.getItem(getChatSettingsStorageKey(user.pubkey))
	if (!raw) return null

	const envelope = JSON.parse(raw) as StoredChatSettingsEnvelope
	if (!envelope?.ciphertext || !envelope?.scheme) return null

	const decrypted = await signer.decrypt(user, envelope.ciphertext, envelope.scheme)
	return JSON.parse(decrypted) as ChatSettingsSnapshot
}

export async function saveEncryptedChatSettings(
	signer: NDKSigner,
	user: NDKUser,
	settings: ChatSettingsSnapshot,
): Promise<void> {
	if (typeof window === 'undefined') return

	const scheme = await resolveEncryptionScheme(signer)
	const ciphertext = await signer.encrypt(user, JSON.stringify(settings), scheme)
	const envelope: StoredChatSettingsEnvelope = {
		version: 1,
		scheme,
		ciphertext,
		updatedAt: Date.now(),
	}

	window.localStorage.setItem(getChatSettingsStorageKey(user.pubkey), JSON.stringify(envelope))
}
