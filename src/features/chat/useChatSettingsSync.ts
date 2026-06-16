import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { loadEncryptedChatSettings, saveEncryptedChatSettings } from './settingsStorage'
import {
	DEFAULT_CHAT_SETTINGS,
	chatActions,
	useChatStore,
	type ChatSettingsSnapshot,
} from './store'

function buildSnapshot(
	provider: ChatSettingsSnapshot['provider'],
	providerOverrides: ChatSettingsSnapshot['providerOverrides'],
	selectedModel: string | null,
	toolsEnabled: boolean,
): ChatSettingsSnapshot {
	return {
		provider,
		providerOverrides,
		selectedModel,
		toolsEnabled,
		version: 2,
	}
}

export function useChatSettingsSync(): void {
	const currentUser = useActiveAccount()
	const signer = currentUser?.signer ?? null
	const userPubkey = currentUser?.pubkey ?? null
	const provider = useChatStore((state) => state.provider)
	const providerOverrides = useChatStore((state) => state.providerOverrides)
	const selectedModel = useChatStore((state) => state.selectedModel)
	const toolsEnabled = useChatStore((state) => state.toolsEnabled)

	const hydrateGenerationRef = useRef(0)
	const loadedPubkeyRef = useRef<string | null>(null)
	const lastSavedSnapshotRef = useRef<string>(JSON.stringify(DEFAULT_CHAT_SETTINGS))
	const saveTimeoutRef = useRef<number | null>(null)
	const saveErrorRef = useRef(false)
	const loadErrorRef = useRef(false)
	const scrubbedLegacyStorageRef = useRef(false)

	const snapshot = buildSnapshot(provider, providerOverrides, selectedModel, toolsEnabled)
	const serializedSnapshot = JSON.stringify(snapshot)

	useEffect(() => {
		if (scrubbedLegacyStorageRef.current || typeof window === 'undefined') return
		scrubbedLegacyStorageRef.current = true

		try {
			const raw = window.localStorage.getItem('chat-store')
			if (!raw) return

			const parsed = JSON.parse(raw) as {
				state?: Record<string, unknown>
				version?: number
			}
			if (!parsed?.state) return

			let changed = false
			for (const key of [
				'provider',
				// Legacy v1 flat keys — may still exist in stale chat-store blobs.
				'customEndpoint',
				'customApiKey',
				// v2 secret-bearing key — partialize already prevents new writes; scrub defensively.
				'providerOverrides',
				'selectedModel',
				'toolsEnabled',
			] as const) {
				if (key in parsed.state) {
					delete parsed.state[key]
					changed = true
				}
			}

			if (changed) {
				window.localStorage.setItem('chat-store', JSON.stringify(parsed))
			}
		} catch (error) {
			console.warn('Failed to scrub legacy chat settings storage', error)
		}
	}, [])

	useEffect(() => {
		if (saveTimeoutRef.current !== null) {
			window.clearTimeout(saveTimeoutRef.current)
			saveTimeoutRef.current = null
		}

		if (!signer || !currentUser) {
			loadedPubkeyRef.current = null
			lastSavedSnapshotRef.current = JSON.stringify(DEFAULT_CHAT_SETTINGS)
			chatActions.hydrateSettings(DEFAULT_CHAT_SETTINGS)
			return
		}

		const generation = hydrateGenerationRef.current + 1
		hydrateGenerationRef.current = generation

		void (async () => {
			try {
				if (!userPubkey) return
				const settings = await loadEncryptedChatSettings(signer, userPubkey)
				if (hydrateGenerationRef.current !== generation) return

				chatActions.hydrateSettings(settings ?? DEFAULT_CHAT_SETTINGS)
				loadedPubkeyRef.current = currentUser.pubkey
				lastSavedSnapshotRef.current = JSON.stringify(settings ?? DEFAULT_CHAT_SETTINGS)
				loadErrorRef.current = false
			} catch (error) {
				console.warn('Failed to load encrypted chat settings', error)
				if (hydrateGenerationRef.current !== generation) return
				chatActions.hydrateSettings(DEFAULT_CHAT_SETTINGS)
				loadedPubkeyRef.current = currentUser.pubkey
				lastSavedSnapshotRef.current = JSON.stringify(DEFAULT_CHAT_SETTINGS)
				if (!loadErrorRef.current) {
					toast.error('Failed to decrypt saved chat settings. Using defaults instead.')
					loadErrorRef.current = true
				}
			}
		})()

		return () => {
			if (saveTimeoutRef.current !== null) {
				window.clearTimeout(saveTimeoutRef.current)
				saveTimeoutRef.current = null
			}
		}
	}, [currentUser, signer])

	useEffect(() => {
		if (!signer || !currentUser) return
		if (loadedPubkeyRef.current !== currentUser.pubkey) return
		if (serializedSnapshot === lastSavedSnapshotRef.current) return

		if (saveTimeoutRef.current !== null) {
			window.clearTimeout(saveTimeoutRef.current)
		}

		saveTimeoutRef.current = window.setTimeout(() => {
			void (async () => {
				try {
					await saveEncryptedChatSettings(signer, userPubkey ?? currentUser.pubkey, snapshot)
					lastSavedSnapshotRef.current = serializedSnapshot
					saveErrorRef.current = false
				} catch (error) {
					console.warn('Failed to save encrypted chat settings', error)
					if (!saveErrorRef.current) {
						toast.error('Failed to save chat settings with your current signer.')
						saveErrorRef.current = true
					}
				}
			})()
		}, 350)

		return () => {
			if (saveTimeoutRef.current !== null) {
				window.clearTimeout(saveTimeoutRef.current)
				saveTimeoutRef.current = null
			}
		}
	}, [currentUser, serializedSnapshot, signer, snapshot])
}
