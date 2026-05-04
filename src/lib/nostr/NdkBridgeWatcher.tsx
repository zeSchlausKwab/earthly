/**
 * Mounts inside the React tree to mirror the applesauce active-account state
 * into NDK's signer + session state. Renders nothing.
 *
 * This is a temporary glue component. Deleted in Step 6 with the rest of NDK.
 */

import { useNDK, useNDKSessionLogin, useNDKSessionLogout } from '@nostr-dev-kit/react'
import { useEffect } from 'react'
import { accounts } from './index'
import { AccountBackedNdkSigner } from './ndk-bridge'

export function NdkBridgeWatcher() {
	const { ndk } = useNDK()
	const ndkLogin = useNDKSessionLogin()
	const ndkLogout = useNDKSessionLogout()

	useEffect(() => {
		if (!ndk) return

		const sub = accounts.active$.subscribe(async (account) => {
			try {
				if (!account) {
					await ndkLogout()
					return
				}
				const adapter = new AccountBackedNdkSigner(account)
				// `setActive=true` makes this the current NDK session signer.
				// We deliberately ignore NDK's persistence layer (NDKSessionLocalStorage)
				// because applesauce now owns persistence — both writing to localStorage
				// from two systems would race.
				// biome-ignore lint/suspicious/noExplicitAny: NDK's two bundled copies cause type drift; behavior is fine.
				await ndkLogin(adapter as any, true)
			} catch (err) {
				console.error('[ndk-bridge] failed to mirror account into NDK session', err)
			}
		})

		return () => sub.unsubscribe()
	}, [ndk, ndkLogin, ndkLogout])

	return null
}
