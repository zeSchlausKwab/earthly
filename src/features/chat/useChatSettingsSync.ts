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
	const settingsLoadNonce = useChatStore((state) => state.settingsLoadNonce)

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: settingsLoadNonce is an intentional Retry re-run trigger, not read in the body (Pitfall 2)
	useEffect(() => {
		if (saveTimeoutRef.current !== null) {
			window.clearTimeout(saveTimeoutRef.current)
			saveTimeoutRef.current = null
		}

		if (!signer || !currentUser) {
			// No signer/account: settings stay in-memory only (D-12). Reset to defaults but
			// surface a distinct 'no-signer' state so the UI shows a sign-in hint, not a failure.
			loadedPubkeyRef.current = null
			lastSavedSnapshotRef.current = JSON.stringify(DEFAULT_CHAT_SETTINGS)
			chatActions.hydrateSettings(DEFAULT_CHAT_SETTINGS)
			chatActions.setSettingsStatus('no-signer')
			return
		}

		const generation = hydrateGenerationRef.current + 1
		hydrateGenerationRef.current = generation

		chatActions.setSettingsStatus('loading')

		void (async () => {
			try {
				if (!userPubkey) return
				const settings = await loadEncryptedChatSettings(signer, userPubkey)
				if (hydrateGenerationRef.current !== generation) return

				// A null result is a valid "loaded / no settings saved yet" — NOT a failure.
				// Distinguish it from a decrypt failure by reporting 'loaded' with no error (D-11).
				chatActions.hydrateSettings(settings ?? DEFAULT_CHAT_SETTINGS)
				loadedPubkeyRef.current = currentUser.pubkey
				lastSavedSnapshotRef.current = JSON.stringify(settings ?? DEFAULT_CHAT_SETTINGS)
				loadErrorRef.current = false
				chatActions.setSettingsStatus('loaded')
			} catch (error) {
				console.warn('Failed to load encrypted chat settings', error)
				if (hydrateGenerationRef.current !== generation) return
				// Do NOT masquerade a decrypt failure as the user's data with silent DEFAULT
				// hydration (D-11). Surface a visible 'failed' state with the error message; the
				// status banner (ChatSettingsSection) is now the primary surface. Keep the
				// loadErrorRef one-time toast guard as a secondary signal.
				loadedPubkeyRef.current = currentUser.pubkey
				chatActions.setSettingsStatus(
					'failed',
					error instanceof Error ? error.message : 'Failed to decrypt saved chat settings',
				)
				if (!loadErrorRef.current) {
					toast.error('Failed to decrypt saved chat settings.')
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
		// settingsLoadNonce drives Retry (D-11): bumping it (via requestSettingsReload) re-enters
		// this effect, which increments `generation` so any in-flight prior load fails its guard
		// and cannot clobber the retry result (Pitfall 2). It is intentionally in the deps as a
		// re-run trigger even though it is not read in the body. userPubkey IS read inside.
	}, [currentUser, signer, settingsLoadNonce, userPubkey])

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
