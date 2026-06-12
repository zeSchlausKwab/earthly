/**
 * Incoming NIP-61 nutzaps for the active account.
 *
 * Lists unclaimed nutzaps with per-item receive plus a receive-all shortcut.
 * Redemption goes through `receiveNutzaps`, which swaps the P2PK-locked
 * proofs at the mint and adds them to the wallet (couch-protected).
 */

import { getDisplayName } from 'applesauce-core/helpers'
import { use$ } from 'applesauce-react/hooks'
import type { Nutzap } from 'applesauce-wallet/casts'
import { Loader2, Zap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getMintHostname, receiveNutzaps, useNutzaps, useWallet } from '@/lib/wallet'

export function NutzapsSection() {
	const { unlocked } = useWallet()
	const { unclaimed, loading } = useNutzaps()
	const [receivingAll, setReceivingAll] = useState(false)

	const handleReceiveAll = async () => {
		if (unclaimed.length === 0) return
		setReceivingAll(true)
		try {
			await receiveNutzaps(unclaimed.map((nutzap) => nutzap.event))
			toast.success(`Received ${unclaimed.length} nutzap${unclaimed.length === 1 ? '' : 's'}`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to receive nutzaps')
		} finally {
			setReceivingAll(false)
		}
	}

	if (loading) {
		return <p className="text-sm text-muted-foreground py-2">Looking for nutzaps…</p>
	}

	if (unclaimed.length === 0) {
		return <p className="text-sm text-muted-foreground py-2">No unclaimed nutzaps</p>
	}

	return (
		<div className="space-y-2">
			<Button
				size="sm"
				className="w-full"
				onClick={handleReceiveAll}
				disabled={receivingAll || !unlocked}
			>
				{receivingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
				Receive All ({unclaimed.length})
			</Button>
			<div className="space-y-2 max-h-48 overflow-y-auto">
				{unclaimed.map((nutzap) => (
					<NutzapRow key={nutzap.id} nutzap={nutzap} unlocked={unlocked} />
				))}
			</div>
		</div>
	)
}

function NutzapRow({ nutzap, unlocked }: { nutzap: Nutzap; unlocked: boolean }) {
	const senderProfile = use$(() => nutzap.sender.profile$, [nutzap])
	const [receiving, setReceiving] = useState(false)

	const handleReceive = async () => {
		setReceiving(true)
		try {
			await receiveNutzaps(nutzap.event)
			toast.success(`Received ${nutzap.amount} sats`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to receive nutzap')
		} finally {
			setReceiving(false)
		}
	}

	return (
		<div className="bg-muted rounded-md p-2 text-sm space-y-1">
			<div className="flex items-center justify-between gap-2">
				<span className="truncate min-w-0 font-medium">
					{getDisplayName(senderProfile, `${nutzap.sender.pubkey.slice(0, 8)}…`)}
				</span>
				<span className="shrink-0 text-green-500 font-medium">⚡ {nutzap.amount}</span>
			</div>
			<div className="flex items-center justify-between gap-2">
				<span className="truncate min-w-0 text-xs text-muted-foreground" title={nutzap.mint}>
					{getMintHostname(nutzap.mint)}
				</span>
				<Button
					size="sm"
					variant="secondary"
					className="h-6 px-2 text-xs shrink-0"
					onClick={handleReceive}
					disabled={receiving || !unlocked}
				>
					{receiving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Receive'}
				</Button>
			</div>
			{nutzap.comment && (
				<p className="text-xs text-muted-foreground break-words">{nutzap.comment}</p>
			)}
		</div>
	)
}
