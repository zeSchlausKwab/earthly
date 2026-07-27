import { useActiveAccount } from 'applesauce-react/hooks'
import { useCallback, useEffect, useState } from 'react'
import {
	loadNwcConnection,
	NWC_CONNECTION_CHANGE_EVENT,
	removeNwcConnection,
	saveNwcConnection,
	type NwcConnectionDetails,
} from '@/lib/wallet/nwc'

export function useNwcConnection(): {
	connection: NwcConnectionDetails | null
	save: (uri: string) => NwcConnectionDetails
	remove: () => void
} {
	const account = useActiveAccount()
	const pubkey = account?.pubkey
	const [connection, setConnection] = useState<NwcConnectionDetails | null>(() =>
		pubkey ? loadNwcConnection(pubkey) : null,
	)

	useEffect(() => {
		const sync = () => setConnection(pubkey ? loadNwcConnection(pubkey) : null)
		sync()
		window.addEventListener('storage', sync)
		window.addEventListener(NWC_CONNECTION_CHANGE_EVENT, sync)
		return () => {
			window.removeEventListener('storage', sync)
			window.removeEventListener(NWC_CONNECTION_CHANGE_EVENT, sync)
		}
	}, [pubkey])

	const save = useCallback(
		(uri: string) => {
			if (!pubkey) throw new Error('Sign in before adding a wallet.')
			const next = saveNwcConnection(uri, pubkey)
			setConnection(next)
			return next
		},
		[pubkey],
	)

	const remove = useCallback(() => {
		if (!pubkey) return
		removeNwcConnection(pubkey)
		setConnection(null)
	}, [pubkey])

	return { connection, save, remove }
}
