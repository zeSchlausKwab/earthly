/**
 * Wallet maintenance tools, mirroring the applesauce wallet example's
 * Settings tab:
 *
 *   - Wallet relays: where token/history events are published.
 *   - Nutzap mints:  the kind 10019 mint list others use to send nutzaps.
 *   - Sync tokens:   re-publish every token event to the wallet relays.
 *   - Recover:       sweep tokens stranded in the couch after a crash.
 */

import { use$ } from 'applesauce-react/hooks'
import type { Wallet } from 'applesauce-wallet/casts'
import { Combine, LifeBuoy, Loader2, Plus, UploadCloud, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { pool } from '@/lib/nostr'
import {
	addNutzapMint,
	consolidateTokens,
	getMintHostname,
	recoverFromCouch,
	removeNutzapMint,
	setWalletRelays,
	useNutzapInfo,
} from '@/lib/wallet'

export function WalletToolsSection({ wallet }: { wallet: Wallet }) {
	return (
		<div className="space-y-4">
			<WalletRelaysTool wallet={wallet} />
			<NutzapMintsTool />
			<MaintenanceTool wallet={wallet} />
		</div>
	)
}

function WalletRelaysTool({ wallet }: { wallet: Wallet }) {
	const relays = use$(() => wallet.relays$, [wallet])
	const [newRelay, setNewRelay] = useState('')
	const [saving, setSaving] = useState(false)

	const saveRelays = async (next: string[]) => {
		setSaving(true)
		try {
			await setWalletRelays(next)
			toast.success('Wallet relays saved')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save relays')
		} finally {
			setSaving(false)
		}
	}

	const handleAdd = () => {
		const url = newRelay.trim()
		if (!url) return
		if (relays?.includes(url)) {
			toast.info('Relay already in list')
			return
		}
		setNewRelay('')
		void saveRelays([...(relays ?? []), url])
	}

	return (
		<div>
			<p className="text-sm font-medium mb-2">Wallet Relays</p>
			<div className="space-y-1 mb-2">
				{relays && relays.length > 0 ? (
					relays.map((relay) => (
						<div key={relay} className="flex items-center justify-between text-sm gap-2">
							<span className="truncate min-w-0 font-mono text-xs" title={relay}>
								{relay}
							</span>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 shrink-0"
								disabled={saving}
								onClick={() => void saveRelays((relays ?? []).filter((r) => r !== relay))}
								title="Remove relay"
							>
								<X className="w-3 h-3" />
							</Button>
						</div>
					))
				) : (
					<p className="text-xs text-muted-foreground">No wallet relays configured</p>
				)}
			</div>
			<div className="flex gap-2">
				<Input
					type="url"
					value={newRelay}
					onChange={(e) => setNewRelay(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
					placeholder="wss://relay.example.com"
					className="flex-1 h-8 text-sm min-w-0"
				/>
				<Button
					variant="secondary"
					size="sm"
					onClick={handleAdd}
					disabled={saving || !newRelay.trim()}
					className="h-8 px-2 shrink-0"
				>
					{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
				</Button>
			</div>
		</div>
	)
}

function NutzapMintsTool() {
	const nutzapInfo = useNutzapInfo()
	const mints = nutzapInfo?.mints ?? []
	const [newMint, setNewMint] = useState('')
	const [saving, setSaving] = useState(false)

	const handleAdd = async () => {
		const url = newMint.trim()
		if (!url) return
		if (mints.some((m) => m.mint === url)) {
			toast.info('Mint already in list')
			return
		}
		setSaving(true)
		try {
			await addNutzapMint(url)
			setNewMint('')
			toast.success('Nutzap mint added')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to add mint')
		} finally {
			setSaving(false)
		}
	}

	const handleRemove = async (mint: string) => {
		setSaving(true)
		try {
			await removeNutzapMint(mint)
			toast.success('Nutzap mint removed')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to remove mint')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div>
			<p className="text-sm font-medium mb-1">Nutzap Mints</p>
			<p className="text-xs text-muted-foreground mb-2">
				Mints others can use to send you nutzaps (kind 10019)
			</p>
			<div className="space-y-1 mb-2">
				{mints.length > 0 ? (
					mints.map(({ mint }) => (
						<div key={mint} className="flex items-center justify-between text-sm gap-2">
							<span className="truncate min-w-0" title={mint}>
								{getMintHostname(mint)}
							</span>
							<Button
								variant="ghost"
								size="icon"
								className="h-6 w-6 shrink-0"
								disabled={saving}
								onClick={() => void handleRemove(mint)}
								title="Remove mint"
							>
								<X className="w-3 h-3" />
							</Button>
						</div>
					))
				) : (
					<p className="text-xs text-muted-foreground">No nutzap mints configured</p>
				)}
			</div>
			<div className="flex gap-2">
				<Input
					type="url"
					value={newMint}
					onChange={(e) => setNewMint(e.target.value)}
					onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
					placeholder="https://mint.example.com"
					className="flex-1 h-8 text-sm min-w-0"
				/>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => void handleAdd()}
					disabled={saving || !newMint.trim()}
					className="h-8 px-2 shrink-0"
				>
					{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
				</Button>
			</div>
		</div>
	)
}

function MaintenanceTool({ wallet }: { wallet: Wallet }) {
	const relays = use$(() => wallet.relays$, [wallet])
	const tokens = use$(() => wallet.tokens$, [wallet])
	const [syncing, setSyncing] = useState(false)
	const [recovering, setRecovering] = useState(false)
	const [consolidating, setConsolidating] = useState(false)

	const handleSync = async () => {
		if (!relays || relays.length === 0) {
			toast.error('No wallet relays configured')
			return
		}
		if (!tokens || tokens.length === 0) {
			toast.info('No tokens to sync')
			return
		}
		setSyncing(true)
		try {
			for (const token of tokens) {
				await pool.publish(relays, token.event)
			}
			toast.success(`Synced ${tokens.length} token event${tokens.length === 1 ? '' : 's'}`)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to sync tokens')
		} finally {
			setSyncing(false)
		}
	}

	const handleRecover = async () => {
		setRecovering(true)
		try {
			await recoverFromCouch()
			toast.success('Couch recovery complete')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to recover tokens')
		} finally {
			setRecovering(false)
		}
	}

	const handleConsolidate = async () => {
		setConsolidating(true)
		try {
			await consolidateTokens()
			toast.success('Tokens consolidated')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to consolidate tokens')
		} finally {
			setConsolidating(false)
		}
	}

	return (
		<div>
			<p className="text-sm font-medium mb-2">Maintenance</p>
			<div className="grid grid-cols-3 gap-2">
				<Button variant="secondary" size="sm" onClick={handleConsolidate} disabled={consolidating}>
					{consolidating ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Combine className="w-4 h-4" />
					)}
					Consolidate
				</Button>
				<Button variant="secondary" size="sm" onClick={handleSync} disabled={syncing}>
					{syncing ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<UploadCloud className="w-4 h-4" />
					)}
					Sync
				</Button>
				<Button variant="secondary" size="sm" onClick={handleRecover} disabled={recovering}>
					{recovering ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<LifeBuoy className="w-4 h-4" />
					)}
					Recover
				</Button>
			</div>
			<p className="text-xs text-muted-foreground mt-1">
				Consolidate verifies proofs at the mints and merges everything into one token event per
				mint. Sync re-publishes token events to your wallet relays. Recover sweeps tokens stranded
				mid-operation back into the wallet.
			</p>
		</div>
	)
}
