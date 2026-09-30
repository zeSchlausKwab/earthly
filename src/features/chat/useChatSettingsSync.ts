import { chatSettingsDirtyKey, loadRelayChatSettings, saveRelayChatSettings } from './settingsRelay'
import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { accounts } from '@/lib/nostr'
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
	mapSnapshotsEnabled: boolean,
	safetyLevel: ChatSettingsSnapshot['safetyLevel'],
	promptProfile: ChatSettingsSnapshot['promptProfile'],
	connections: ChatSettingsSnapshot['connections'],
	activeConnectionId: ChatSettingsSnapshot['activeConnectionId'],
): ChatSettingsSnapshot {
	return {
		provider,
		providerOverrides,
		selectedModel,
		toolsEnabled,
		mapSnapshotsEnabled,
		safetyLevel,
		promptProfile,
		version: 3,
		connections,
		activeConnectionId,
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
	const mapSnapshotsEnabled = useChatStore((state) => state.mapSnapshotsEnabled)
	const safetyLevel = useChatStore((state) => state.safetyLevel)
	const promptProfile = useChatStore((state) => state.promptProfile)
	const settingsStatus = useChatStore((state) => state.settingsStatus)
	const connections = useChatStore((state) => state.connections)
	const activeConnectionId = useChatStore((state) => state.activeConnectionId)
	const settingsLoadNonce = useChatStore((state) => state.settingsLoadNonce)
	const settingsImportNonce = useChatStore((state) => state.settingsImportNonce)

	const hydrateGenerationRef = useRef(0)
	const handledSettingsImportNonceRef = useRef(0)
	const activeSettingsPubkeyRef = useRef<string | null>(null)
	const loadedPubkeyRef = useRef<string | null>(null)
	const lastSavedSnapshotRef = useRef<string>(JSON.stringify(DEFAULT_CHAT_SETTINGS))
	const saveTimeoutRef = useRef<number | null>(null)
	const saveErrorRef = useRef(false)
	const loadErrorRef = useRef(false)
	// "Load failed / not safe to save" guard (CR-01): set on a decrypt FAILURE, this blocks the
	// debounced save effect so a subsequent edit cannot overwrite the still-recoverable ciphertext.
	// Cleared on a successful load, a no-signer reset, or an explicit user import (settingsImportNonce).
	const loadFailedRef = useRef(false)
	const scrubbedLegacyStorageRef = useRef(false)

	const snapshot = buildSnapshot(
		provider,
		providerOverrides,
		selectedModel,
		toolsEnabled,
		mapSnapshotsEnabled,
		safetyLevel,
		promptProfile,
		connections,
		activeConnectionId,
	)
	const serializedSnapshot = JSON.stringify(snapshot)
	const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
	const latestSnapshotRef = useRef(serializedSnapshot)
	latestSnapshotRef.current = serializedSnapshot

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
				'connections',
				'activeConnectionId',
				'selectedModel',
				'toolsEnabled',
				'mapSnapshotsEnabled',
				'promptProfile',
				'safetyLevel',
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
		const accountChanged = activeSettingsPubkeyRef.current !== userPubkey
		activeSettingsPubkeyRef.current = userPubkey
		if (accountChanged) {
			// Quarantine the previous account's provider credentials and preferences
			// immediately, and stop work authorized with that account's configuration.
			chatActions.cancelStream()
			loadedPubkeyRef.current = null
			lastSavedSnapshotRef.current = JSON.stringify(DEFAULT_CHAT_SETTINGS)
			chatActions.hydrateSettings(DEFAULT_CHAT_SETTINGS)
		}

		if (!signer || !currentUser) {
			// No signer/account: settings stay in-memory only (D-12). Reset to defaults but
			// surface a distinct 'no-signer' state so the UI shows a sign-in hint, not a failure.
			loadedPubkeyRef.current = null
			chatActions.setSettingsOwnerPubkey(null)
			loadFailedRef.current = false
			lastSavedSnapshotRef.current = JSON.stringify(DEFAULT_CHAT_SETTINGS)
			chatActions.hydrateSettings(DEFAULT_CHAT_SETTINGS)
			chatActions.setSettingsStatus('no-signer')
			return
		}

		const generation = hydrateGenerationRef.current + 1
		hydrateGenerationRef.current = generation

		// Fail closed immediately on account changes: until this exact pubkey's
		// encrypted settings load, autonomous screenshots are not authorized.
		chatActions.setSettingsOwnerPubkey(null)
		chatActions.setSettingsStatus('loading')

		void (async () => {
			try {
				if (!userPubkey) return
				let settings = await loadEncryptedChatSettings(signer, userPubkey)
				let needsPublish = Boolean(settings)
				chatActions.setSettingsSyncStatus('syncing')
				try {
					const synced = await loadRelayChatSettings(signer, userPubkey)
					if (hydrateGenerationRef.current !== generation || accounts.active?.pubkey !== userPubkey)
						return
					const dirty = Boolean(settings && localStorage.getItem(chatSettingsDirtyKey(userPubkey)))
					if (synced.settings && !dirty) {
						settings = synced.settings
						await saveEncryptedChatSettings(signer, userPubkey, settings)
					}
					if (hydrateGenerationRef.current !== generation || accounts.active?.pubkey !== userPubkey)
						return
					needsPublish = dirty || synced.pending || (Boolean(settings) && !synced.settings)
					chatActions.setSettingsSyncStatus(synced.settings && !synced.pending ? 'synced' : 'local')
				} catch (error) {
					if (hydrateGenerationRef.current !== generation || accounts.active?.pubkey !== userPubkey)
						return
					chatActions.setSettingsSyncStatus(
						'error',
						error instanceof Error ? error.message : 'Connection sync failed',
					)
					// Without a local copy, an offline relay is not evidence of an empty account.
					if (!settings) throw error
					needsPublish = false
				}
				if (hydrateGenerationRef.current !== generation) return
				// Guard against an account swap that has not yet bumped `generation` at resolve time
				// (CR-02): the generation counter is global and cannot distinguish "newer generation
				// for the same user" from "different user". Re-read the LIVE active account and bail
				// if it no longer matches the pubkey this load was issued for, so account A's settings
				// can never be hydrated into account B's session.
				if (accounts.active?.pubkey !== userPubkey) return

				// A null result is a valid "loaded / no settings saved yet" — NOT a failure.
				// Distinguish it from a decrypt failure by reporting 'loaded' with no error (D-11).
				chatActions.hydrateSettings(settings ?? DEFAULT_CHAT_SETTINGS)
				loadedPubkeyRef.current = currentUser.pubkey
				chatActions.setSettingsOwnerPubkey(currentUser.pubkey)
				const hydrated = useChatStore.getState()
				lastSavedSnapshotRef.current = needsPublish
					? ''
					: JSON.stringify(
							buildSnapshot(
								hydrated.provider,
								hydrated.providerOverrides,
								hydrated.selectedModel,
								hydrated.toolsEnabled,
								hydrated.mapSnapshotsEnabled,
								hydrated.safetyLevel,
								hydrated.promptProfile,
								hydrated.connections,
								hydrated.activeConnectionId,
							),
						)
				loadErrorRef.current = false
				loadFailedRef.current = false
				chatActions.setSettingsStatus('loaded')
			} catch (error) {
				console.warn('Failed to load encrypted chat settings', error)
				if (hydrateGenerationRef.current !== generation) return
				// Same account-swap identity guard as the success path (CR-02): do not stamp a
				// 'failed' status or arm the save guard against a session that has moved on.
				if (accounts.active?.pubkey !== userPubkey) return
				// Do NOT masquerade a decrypt failure as the user's data with silent DEFAULT
				// hydration (D-11). Surface a visible 'failed' state with the error message; the
				// status banner (ChatSettingsSection) is now the primary surface. Keep the
				// loadErrorRef one-time toast guard as a secondary signal.
				// Arm the save guard (CR-01): the ciphertext is undecryptable-but-recoverable. We must
				// NOT let the debounced save effect overwrite it with default/in-memory plaintext.
				// Cleared only on a successful (re)load or an explicit user import.
				loadFailedRef.current = true
				loadedPubkeyRef.current = currentUser.pubkey
				chatActions.setSettingsOwnerPubkey(null)
				chatActions.setSettingsStatus(
					'failed',
					error instanceof Error ? error.message : 'Failed to decrypt saved chat settings',
				)
				if (!loadErrorRef.current) {
					toast.error('Could not load saved chat settings. Retry in Settings → Chat.')
					loadErrorRef.current = true
				}
			}
		})()

		return () => {
			hydrateGenerationRef.current += 1
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

	// An explicit user-initiated import (settingsImportNonce bump) is a deliberate overwrite of the
	// undecryptable ciphertext (D-09). Clear the load-failed guard so the save effect below is
	// allowed to re-encrypt the imported snapshot — the recovery write CR-01 must still permit.
	useEffect(() => {
		if (
			settingsImportNonce === 0 ||
			settingsImportNonce === handledSettingsImportNonceRef.current
		) {
			return
		}
		handledSettingsImportNonceRef.current = settingsImportNonce
		// Supersede any decrypt that began before this explicit import, and force
		// persistence even when the imported snapshot happens to equal defaults.
		hydrateGenerationRef.current += 1
		lastSavedSnapshotRef.current = ''
		loadFailedRef.current = false
		if (userPubkey) {
			loadedPubkeyRef.current = userPubkey
			chatActions.setSettingsOwnerPubkey(userPubkey)
			chatActions.setSettingsStatus('loaded')
		}
	}, [settingsImportNonce, userPubkey])

	useEffect(() => {
		// The import nonce intentionally retriggers this effect even when the
		// imported snapshot serializes identically to the current in-memory value.
		void settingsImportNonce
		if (!signer || !currentUser || settingsStatus !== 'loaded') return
		if (loadedPubkeyRef.current !== currentUser.pubkey) return
		// Block saves while a decrypt failure is unresolved (CR-01): overwriting here would destroy
		// the still-recoverable ciphertext. Reset happens on successful load or explicit import.
		if (loadFailedRef.current) return
		if (serializedSnapshot === lastSavedSnapshotRef.current) return
		chatActions.setSettingsSyncStatus('syncing')

		if (saveTimeoutRef.current !== null) {
			window.clearTimeout(saveTimeoutRef.current)
		}

		saveTimeoutRef.current = window.setTimeout(() => {
			const savePubkey = currentUser.pubkey
			const generation = hydrateGenerationRef.current
			const isCurrent = () =>
				accounts.active?.pubkey === savePubkey && hydrateGenerationRef.current === generation
			saveQueueRef.current = saveQueueRef.current
				.catch(() => undefined)
				.then(async () => {
					if (!isCurrent()) return
					try {
						const toSave = JSON.parse(serializedSnapshot) as ChatSettingsSnapshot
						await saveEncryptedChatSettings(signer, savePubkey, toSave)
						localStorage.setItem(chatSettingsDirtyKey(savePubkey), '1')
						if (!isCurrent()) return
						lastSavedSnapshotRef.current = serializedSnapshot
						chatActions.setSettingsSyncStatus('syncing')
						const acknowledged = await saveRelayChatSettings(signer, savePubkey, toSave, isCurrent)
						if (isCurrent() && latestSnapshotRef.current === serializedSnapshot)
							chatActions.setSettingsSyncStatus(acknowledged ? 'synced' : 'local')
						saveErrorRef.current = false
					} catch (error) {
						if (!isCurrent()) return
						chatActions.setSettingsSyncStatus(
							'error',
							error instanceof Error ? error.message : 'Could not sync connections',
						)
						if (!saveErrorRef.current) {
							toast.error('Connection sync failed. Use Retry sync in chat settings.')
							saveErrorRef.current = true
						}
					}
				})
		}, 350)

		return () => {
			if (saveTimeoutRef.current !== null) {
				window.clearTimeout(saveTimeoutRef.current)
				saveTimeoutRef.current = null
			}
		}
	}, [currentUser, serializedSnapshot, settingsImportNonce, signer, settingsStatus])
}
