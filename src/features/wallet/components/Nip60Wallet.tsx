/**
 * NIP-60 wallet panel — applesauce-wallet edition.
 *
 * Reads everything from `useWallet()` / `useWalletHistory()` / `useWalletTokens()`
 * (which reactively follow the active applesauce account). All mutations go
 * through `@/lib/wallet/actions`, which uses the dev-safety-aware `walletActions`
 * runner.
 *
 * The "default mint" preference is browser-local (kept in localStorage by
 * `useDefaultMint`) and is independent from the wallet event itself.
 */

import { use$, useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowDownLeft,
	ArrowUpDown,
	ArrowUpRight,
	ChevronRight,
	Coins,
	Landmark,
	Loader2,
	Plus,
	QrCode,
	RefreshCw,
	Send,
	Star,
	Unlock,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	consolidateTokens,
	createWallet,
	getMintHostname,
	setMints as setWalletMints,
	unlockWallet,
	useDefaultMint,
	useWallet,
} from '@/lib/wallet'
import { DepositLightningModal } from './DepositLightningModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { SendEcashModal } from './SendEcashModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'

const DEFAULT_MINTS = [
	'https://mint.minibits.cash/Bitcoin',
	'https://mint.coinos.io',
	'https://mint.cubabitcoin.org',
]

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null
type Section = 'mints' | 'transactions' | 'proofs' | null

export function Nip60Wallet() {
	const account = useActiveAccount()
	const { loading, syncing, exists, unlocked, ready, balance, totalBalance, mints, wallet } =
		useWallet()
	const tokens = use$(() => wallet?.tokens$, [wallet])
	const history = use$(() => wallet?.history$, [wallet])
	const [defaultMint, setDefaultMint] = useDefaultMint()

	const [isCreating, setIsCreating] = useState(false)
	const [isUnlocking, setIsUnlocking] = useState(false)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [isSavingMints, setIsSavingMints] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [editedMints, setEditedMints] = useState<string[] | null>(null)
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [openSection, setOpenSection] = useState<Section>(null)
	const [expandedMints, setExpandedMints] = useState<Set<string>>(new Set())

	const lockedTokenCount = tokens?.filter((token) => !token.unlocked).length ?? 0
	const lockedHistoryCount = history?.filter((entry) => !entry.unlocked).length ?? 0

	// Auto-unlock when the wallet event or locked wallet data becomes available.
	useEffect(() => {
		if (!exists || isUnlocking) return
		if (unlocked && lockedTokenCount === 0 && lockedHistoryCount === 0) return
		setIsUnlocking(true)
		unlockWallet()
			.catch((err) => {
				console.warn('[wallet] auto-unlock failed', err)
			})
			.finally(() => setIsUnlocking(false))
	}, [exists, unlocked, lockedTokenCount, lockedHistoryCount, isUnlocking])

	// Reset edited mint draft whenever the source list changes (e.g. after save)
	// biome-ignore lint/correctness/useExhaustiveDependencies: mints is the reset signal.
	useEffect(() => {
		setEditedMints(null)
	}, [mints])

	const workingMints = editedMints ?? mints

	const proofsByMint = useMemo(() => {
		const map = new Map<string, Array<{ id: string; secret: string; amount: number; C: string }>>()
		if (!tokens) return map
		for (const token of tokens) {
			const mint = token.mint
			const proofs = token.proofs
			if (!mint || !proofs) continue
			const list = map.get(mint) ?? []
			list.push(...proofs)
			map.set(mint, list)
		}
		return map
	}, [tokens])
	const proofCount = useMemo(
		() => Array.from(proofsByMint.values()).reduce((sum, proofs) => sum + proofs.length, 0),
		[proofsByMint],
	)

	// Subscribe to history meta so direction/amount populate as decryption settles
	const historyEntries = use$(() => {
		if (!history) return undefined
		return undefined // we don't need a derived stream; use the `history` array directly below
	}, [history])
	void historyEntries

	const toggleMintExpanded = (mint: string) => {
		setExpandedMints((prev) => {
			const next = new Set(prev)
			if (next.has(mint)) next.delete(mint)
			else next.add(mint)
			return next
		})
	}

	const handleCreateWallet = async () => {
		setIsCreating(true)
		try {
			await createWallet({ mints: DEFAULT_MINTS, receiveNutzaps: true })
			toast.success('Wallet created')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to create wallet')
		} finally {
			setIsCreating(false)
		}
	}

	const handleUnlock = async () => {
		setIsUnlocking(true)
		try {
			await unlockWallet()
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to unlock wallet')
		} finally {
			setIsUnlocking(false)
		}
	}

	const handleRefresh = async () => {
		if (!ready) return
		setIsRefreshing(true)
		try {
			await consolidateTokens()
			toast.success('Wallet refreshed')
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Refresh failed')
		} finally {
			setIsRefreshing(false)
		}
	}

	const handleAddMint = () => {
		const url = newMintUrl.trim()
		if (!url) return
		if (workingMints.includes(url)) {
			toast.info('Mint already in list')
			return
		}
		setEditedMints([...workingMints, url])
		setNewMintUrl('')
	}

	const handleRemoveMint = (mintUrl: string) => {
		setEditedMints(workingMints.filter((m) => m !== mintUrl))
	}

	const handleSaveMints = async () => {
		if (!editedMints) return
		setIsSavingMints(true)
		try {
			await setWalletMints(editedMints)
			toast.success('Mints saved')
			setEditedMints(null)
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Failed to save mints')
		} finally {
			setIsSavingMints(false)
		}
	}

	if (!account) {
		return (
			<div className="p-4 text-center text-muted-foreground bg-muted rounded-lg">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (!exists) {
		return (
			<div className="p-4 text-center bg-muted rounded-lg">
				<p className="text-muted-foreground mb-4">
					{loading ? 'Checking Cashu wallet…' : 'No Cashu wallet found'}
				</p>
				<Button onClick={handleCreateWallet} disabled={isCreating || loading} variant="secondary">
					{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
					Create Wallet
				</Button>
			</div>
		)
	}

	if (!unlocked) {
		return (
			<div className="p-4 text-center bg-muted rounded-lg space-y-3">
				<p className="text-muted-foreground">
					{isUnlocking ? 'Unlocking wallet…' : 'Wallet is locked'}
				</p>
				<Button onClick={handleUnlock} disabled={isUnlocking} variant="secondary">
					{isUnlocking ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<Unlock className="h-4 w-4" />
					)}
					Unlock
				</Button>
			</div>
		)
	}

	const balanceEntries = balance ?? {}

	return (
		<div className="p-4 max-w-full overflow-hidden bg-card rounded-lg border">
			<div className="text-center mb-4 relative">
				<div className="absolute right-0 top-0 flex gap-1">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefresh}
						disabled={!ready || isRefreshing}
						title="Consolidate & refresh"
					>
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="text-sm text-muted-foreground mb-1">
					{syncing ? 'Syncing wallet…' : 'Balance'}
				</p>
				<p className="text-2xl font-bold">
					{syncing ? (
						<Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
					) : (
						`${totalBalance.toLocaleString()} sats`
					)}
				</p>
			</div>

			<div className="grid grid-cols-2 gap-2 mb-4">
				<Button
					size="sm"
					onClick={() => setOpenModal('deposit')}
					className="bg-green-600 hover:bg-green-700 text-white"
				>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button
					size="sm"
					onClick={() => setOpenModal('withdraw')}
					disabled={!ready || totalBalance === 0}
					className="bg-amber-600 hover:bg-amber-700 text-white"
				>
					<Zap className="w-4 h-4" />
					Withdraw
				</Button>
				<Button variant="secondary" size="sm" onClick={() => setOpenModal('receive')}>
					<QrCode className="w-4 h-4" />
					Receive eCash
				</Button>
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setOpenModal('send')}
					disabled={!ready || totalBalance === 0}
				>
					<Send className="w-4 h-4" />
					Send eCash
				</Button>
			</div>

			<div className="pt-2 mb-2 overflow-hidden">
				<p className="text-sm font-medium mb-2">Default Mint</p>
				{mints.length > 0 ? (
					<Select
						value={defaultMint ?? ''}
						onValueChange={(value) => setDefaultMint(value || null)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a default mint">
								{defaultMint ? (
									<span className="flex items-center gap-2 truncate">
										<Star className="w-4 h-4 text-yellow-500 fill-current shrink-0" />
										<span className="truncate">{getMintHostname(defaultMint)}</span>
										{balanceEntries[defaultMint] !== undefined && (
											<span className="text-muted-foreground shrink-0">
												({balanceEntries[defaultMint].toLocaleString()})
											</span>
										)}
									</span>
								) : (
									'Select a default mint'
								)}
							</SelectValue>
						</SelectTrigger>
						<SelectContent className="max-w-[calc(100vw-2rem)]">
							{mints.map((mint) => (
								<SelectItem key={mint} value={mint}>
									<div className="flex items-center gap-2">
										<Landmark className="w-4 h-4 shrink-0" />
										<span className="truncate">{getMintHostname(mint)}</span>
										{balanceEntries[mint] !== undefined && (
											<span className="text-muted-foreground shrink-0">
												({balanceEntries[mint].toLocaleString()})
											</span>
										)}
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<p className="text-muted-foreground text-sm">No mints configured</p>
				)}
			</div>

			<div className="pt-2 overflow-hidden">
				<div className="flex gap-1 mb-2">
					<Button
						variant={openSection === 'mints' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'mints' ? null : 'mints')}
						className="flex-1 gap-1.5 px-2"
						title="Manage mints"
					>
						<Landmark className="w-4 h-4 shrink-0" />
						<span className="text-xs">{mints.length}</span>
					</Button>
					<Button
						variant={openSection === 'transactions' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'transactions' ? null : 'transactions')}
						className="flex-1 gap-1.5 px-2"
						title="Transactions"
					>
						<ArrowUpDown className="w-4 h-4 shrink-0" />
						<span className="text-xs">{syncing ? '…' : (history?.length ?? 0)}</span>
					</Button>
					<Button
						variant={openSection === 'proofs' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'proofs' ? null : 'proofs')}
						className="flex-1 gap-1.5 px-2"
						title="Proofs"
					>
						<Coins className="w-4 h-4 shrink-0" />
						<span className="text-xs">{syncing ? '…' : proofCount}</span>
					</Button>
				</div>

				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 overflow-hidden border-t">
						{workingMints.map((mint) => (
							<div key={mint} className="flex items-center justify-between text-sm gap-2">
								<span className="truncate min-w-0" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{balanceEntries[mint] !== undefined && (
										<span className="text-xs text-muted-foreground">
											{balanceEntries[mint].toLocaleString()}
										</span>
									)}
									<Button
										variant="ghost"
										size="icon"
										onClick={() => handleRemoveMint(mint)}
										title="Remove mint"
										className="h-6 w-6"
									>
										<X className="w-3 h-3" />
									</Button>
								</div>
							</div>
						))}
						<div className="flex gap-2">
							<Input
								type="url"
								value={newMintUrl}
								onChange={(e) => setNewMintUrl(e.target.value)}
								onKeyDown={(e) => e.key === 'Enter' && handleAddMint()}
								placeholder="https://mint.example.com"
								className="flex-1 h-8 text-sm min-w-0"
							/>
							<Button
								variant="secondary"
								size="sm"
								onClick={handleAddMint}
								disabled={!newMintUrl.trim()}
								className="h-8 px-2 shrink-0"
							>
								<Plus className="w-4 h-4" />
							</Button>
						</div>
						{editedMints && (
							<Button
								size="sm"
								onClick={handleSaveMints}
								disabled={isSavingMints}
								className="w-full"
							>
								{isSavingMints ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<Plus className="h-4 w-4" />
								)}
								Save Mints
							</Button>
						)}
					</div>
				)}

				{openSection === 'transactions' && (
					<div className="pt-2 overflow-hidden border-t">
						{history && history.length > 0 ? (
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{history.map((entry) => (
									<HistoryRow key={entry.event.id} entry={entry} />
								))}
							</div>
						) : (
							<p className="text-muted-foreground text-sm">No transactions yet</p>
						)}
					</div>
				)}

				{openSection === 'proofs' && (
					<div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pt-2 border-t">
						{syncing ? (
							<p className="text-sm text-muted-foreground">Syncing proofs…</p>
						) : proofsByMint.size === 0 ? (
							<p className="text-sm text-muted-foreground">No proofs in wallet</p>
						) : (
							Array.from(proofsByMint.entries()).map(([mint, proofs]) => (
								<Collapsible
									key={mint}
									open={expandedMints.has(mint)}
									onOpenChange={() => toggleMintExpanded(mint)}
								>
									<div className="bg-muted rounded-md p-2 overflow-hidden">
										<CollapsibleTrigger asChild>
											<Button
												variant="ghost"
												size="sm"
												className="w-full justify-start gap-2 px-1 h-auto py-1 overflow-hidden"
											>
												<ChevronRight className="w-3 h-3 shrink-0 transition-transform [[data-state=open]>&]:rotate-90" />
												<span className="font-medium truncate flex-1 text-left min-w-0">
													{getMintHostname(mint)}
												</span>
												<span className="text-muted-foreground text-xs shrink-0 whitespace-nowrap">
													{proofs.length} •{' '}
													{proofs.reduce((s, p) => s + p.amount, 0).toLocaleString()}
												</span>
											</Button>
										</CollapsibleTrigger>
										<CollapsibleContent>
											<div className="mt-2 space-y-1 pl-5 overflow-hidden">
												{proofs.map((proof) => (
													<div
														key={`${proof.id}-${proof.secret}`}
														className="flex items-center justify-between text-xs bg-background rounded px-2 py-1 gap-2"
													>
														<span
															className="font-mono text-muted-foreground truncate min-w-0"
															title={`Keyset: ${proof.id}`}
														>
															{proof.id.slice(0, 8)}...
														</span>
														<span className="font-medium shrink-0">{proof.amount}</span>
													</div>
												))}
											</div>
										</CollapsibleContent>
									</div>
								</Collapsible>
							))
						)}
					</div>
				)}
			</div>

			<DepositLightningModal
				open={openModal === 'deposit'}
				onClose={() => setOpenModal(null)}
				mints={mints}
				defaultMint={defaultMint}
			/>
			<WithdrawLightningModal
				open={openModal === 'withdraw'}
				onClose={() => setOpenModal(null)}
				mints={mints}
				balance={balanceEntries}
				totalBalance={totalBalance}
				defaultMint={defaultMint}
			/>
			<SendEcashModal
				open={openModal === 'send'}
				onClose={() => setOpenModal(null)}
				mints={mints}
				balance={balanceEntries}
				totalBalance={totalBalance}
				defaultMint={defaultMint}
			/>
			<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />

			{/* unused but reserved — wallet cast is exposed if subviews need it */}
			{wallet ? null : null}
		</div>
	)
}

function HistoryRow({ entry }: { entry: import('applesauce-wallet/casts').WalletHistory }) {
	const meta = use$(() => entry.meta$, [entry])
	const direction = meta?.direction
	const amount = meta?.amount ?? 0
	const ts = entry.event.created_at
	return (
		<div className="flex items-center justify-between text-sm gap-2">
			<div className="flex items-center gap-2 min-w-0">
				{direction === 'in' ? (
					<ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
				) : direction === 'out' ? (
					<ArrowUpRight className="w-4 h-4 text-red-500 shrink-0" />
				) : (
					<ArrowUpDown className="w-4 h-4 text-muted-foreground shrink-0" />
				)}
				<span className="text-muted-foreground truncate">
					{new Date(ts * 1000).toLocaleDateString()}
				</span>
			</div>
			<span
				className={`shrink-0 ${
					direction === 'in'
						? 'text-green-500'
						: direction === 'out'
							? 'text-red-500'
							: 'text-muted-foreground'
				}`}
			>
				{direction === 'in' ? '+' : direction === 'out' ? '-' : ''}
				{amount.toLocaleString()}
			</span>
		</div>
	)
}
