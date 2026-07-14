import type { NostrSigner } from '@contextvm/sdk'
import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { config } from '@/config'
import {
	BrowserPrivateWorkspaceStore,
	CordnCoordinatorClient,
	PrivateWorkspaceRuntime,
	PrivateWorkspaceService,
} from '@/lib/private-workspace'
import { accounts } from '@/lib/nostr'

const browserStore = new BrowserPrivateWorkspaceStore()
const runtimes = new Map<string, PrivateWorkspaceRuntime>()
const EMPTY_SNAPSHOT = {
	loaded: true,
	workspaces: [],
	pendingJoins: [],
	syncByWorkspace: {},
} as const
const subscribeToNothing = () => () => undefined
const getEmptySnapshot = () => EMPTY_SNAPSHOT

function getRuntime(pubkey: string): PrivateWorkspaceRuntime | undefined {
	const existing = runtimes.get(pubkey)
	if (existing) return existing
	const signer = accounts.signer
	if (!signer || !config.cordnServerPubkey) return undefined
	const service = new PrivateWorkspaceService({
		signer: signer as NostrSigner,
		store: browserStore,
		coordinatorPubkey: config.cordnServerPubkey,
		relays: [...config.cordnRelays],
		createCoordinator: (options) => new CordnCoordinatorClient(options),
	})
	const runtime = new PrivateWorkspaceRuntime(service)
	runtimes.set(pubkey, runtime)
	return runtime
}

export function usePrivateWorkspaceRuntime() {
	const account = useActiveAccount()
	const accountPubkey = account?.pubkey
	const runtime = useMemo(
		() => (accountPubkey ? getRuntime(accountPubkey) : undefined),
		[accountPubkey],
	)
	const snapshot = useSyncExternalStore(
		runtime?.subscribe ?? subscribeToNothing,
		runtime?.getSnapshot ?? getEmptySnapshot,
		runtime?.getSnapshot ?? getEmptySnapshot,
	)

	useEffect(() => {
		if (runtime && !snapshot.loaded) void runtime.refresh()
	}, [runtime, snapshot.loaded])

	return { account, runtime, snapshot }
}
