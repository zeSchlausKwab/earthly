import { useNDK } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { default as NDKType } from '@nostr-dev-kit/ndk'
import { useNip60Store, nip60Actions, type PendingNip60Token } from '@/lib/stores/nip60'
import { useCashuStore, cashuActions, type PendingToken } from '@/lib/stores/cashu'
import {
	ArrowDownLeft,
	ArrowUpRight,
	ArrowUpDown,
	Loader2,
	Landmark,
	Plus,
	RefreshCw,
	X,
	Save,
	Star,
	Zap,
	Send,
	QrCode,
	ChevronRight,
	Coins,
	Clock,
	Eye,
	Copy,
	Check,
	RotateCcw,
	Trash2,
} from 'lucide-react'
import { useEffect, useState, useMemo } from 'react'
import { DepositLightningModal } from './DepositLightningModal'
import { WithdrawLightningModal } from './WithdrawLightningModal'
import { SendEcashModal } from './SendEcashModal'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogHeader,
	DialogDescription,
} from '@/components/ui/dialog'
import { extractProofsByMint, getMintHostname, type ProofInfo } from '@/lib/wallet'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'

// Unified pending token type for UI
type UnifiedPendingToken = (PendingToken | PendingNip60Token) & { source: 'cashu' | 'nip60' }

// Default mints for new wallets
const DEFAULT_MINTS = [
	'https://mint.minibits.cash/Bitcoin',
	'https://mint.coinos.io',
	'https://mint.cubabitcoin.org',
]

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null

export function Nip60Wallet() {
	const { ndk } = useNDK()
	const currentUser = useActiveAccount()
	const isAuthenticated = !!currentUser
	const userPubkey = currentUser?.pubkey

	const {
		status,
		balance,
		mintBalances,
		mints,
		defaultMint,
		transactions,
		error,
		pendingTokens: nip60PendingTokens,
	} = useNip60Store()
	const { pendingTokens: cashuPendingTokens } = useCashuStore()
	const [isCreating, setIsCreating] = useState(false)
	const [isRefreshing, setIsRefreshing] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [isSaving, setIsSaving] = useState(false)
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [openSection, setOpenSection] = useState<
		'mints' | 'transactions' | 'proofs' | 'pending' | null
	>(null)
	const [expandedMints, setExpandedMints] = useState<Set<string>>(new Set())
	const [viewingToken, setViewingToken] = useState<UnifiedPendingToken | null>(null)
	const [isReclaiming, setIsReclaiming] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)

	// Combine pending tokens from both stores
	const activePendingTokens: UnifiedPendingToken[] = useMemo(
		() =>
			[
				...cashuPendingTokens
					.filter((t) => t.status === 'pending')
					.map((t) => ({ ...t, source: 'cashu' as const })),
				...nip60PendingTokens
					.filter((t) => t.status === 'pending')
					.map((t) => ({ ...t, source: 'nip60' as const })),
			].sort((a, b) => b.createdAt - a.createdAt),
		[cashuPendingTokens, nip60PendingTokens],
	)

	// Get proofs from wallet state using shared utility
	const proofsByMint = useMemo(() => {
		const wallet = nip60Actions.getWallet()
		if (!wallet) return new Map<string, ProofInfo[]>()
		return extractProofsByMint(wallet, mints)
	}, [balance, mints]) // Re-compute when balance or mints change

	const toggleMintExpanded = (mint: string) => {
		setExpandedMints((prev) => {
			const next = new Set(prev)
			if (next.has(mint)) {
				next.delete(mint)
			} else {
				next.add(mint)
			}
			return next
		})
	}

	useEffect(() => {
		if (!isAuthenticated || !userPubkey || !ndk) {
			return
		}

		// Initialize wallet if not already initialized
		if (status === 'idle') {
			// Type cast needed due to NDK version mismatch between @nostr-dev-kit/react and @nostr-dev-kit/wallet
			nip60Actions.initialize(userPubkey, ndk as unknown as NDKType)
		}
	}, [isAuthenticated, userPubkey, ndk, status])

	const handleCreateWallet = async () => {
		setIsCreating(true)
		try {
			await nip60Actions.createWallet(DEFAULT_MINTS)
		} finally {
			setIsCreating(false)
		}
	}

	const handleRefresh = async () => {
		setIsRefreshing(true)
		try {
			// Always consolidate on manual refresh to clean up spent proofs
			await nip60Actions.refresh({ consolidate: true })
		} finally {
			setIsRefreshing(false)
		}
	}

	const handleAddMint = () => {
		if (!newMintUrl.trim()) return
		nip60Actions.addMint(newMintUrl)
		setNewMintUrl('')
	}

	const handleRemoveMint = (mintUrl: string) => {
		nip60Actions.removeMint(mintUrl)
	}

	const handleSaveWallet = async () => {
		setIsSaving(true)
		try {
			await nip60Actions.publishWallet()
		} finally {
			setIsSaving(false)
		}
	}

	const handleCopyToken = async (tokenString: string) => {
		try {
			await navigator.clipboard.writeText(tokenString)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleReclaim = async (pendingToken: UnifiedPendingToken) => {
		setIsReclaiming(pendingToken.id)
		try {
			let success: boolean
			if (pendingToken.source === 'cashu') {
				success = await cashuActions.reclaimToken(pendingToken.id)
			} else {
				success = await nip60Actions.reclaimToken(pendingToken.id)
			}
			if (success) {
				toast.success('Token reclaimed! Funds returned to wallet.')
			} else {
				toast.info('Token already claimed by recipient')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to reclaim token'
			toast.error(message)
		} finally {
			setIsReclaiming(null)
		}
	}

	const handleRemovePendingToken = (token: UnifiedPendingToken) => {
		if (token.source === 'cashu') {
			cashuActions.removePendingToken(token.id)
		} else {
			nip60Actions.removePendingToken(token.id)
		}
		toast.success('Token removed from history')
	}

	if (!isAuthenticated) {
		return (
			<div className="p-4 text-center text-muted-foreground bg-muted rounded-lg">
				<p>Please log in to view your wallet</p>
			</div>
		)
	}

	if (status === 'idle' || status === 'initializing') {
		return (
			<div className="flex items-center justify-center p-4 bg-muted rounded-lg">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		)
	}

	if (status === 'error') {
		return (
			<div className="p-4 text-center text-destructive bg-muted rounded-lg">
				<p>{error}</p>
			</div>
		)
	}

	if (status === 'no_wallet') {
		return (
			<div className="p-4 text-center bg-muted rounded-lg">
				<p className="text-muted-foreground mb-4">No Cashu wallet found</p>
				<Button onClick={handleCreateWallet} disabled={isCreating} variant="secondary">
					{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
					Create Wallet
				</Button>
			</div>
		)
	}

	return (
		<div className="p-4 max-w-full overflow-hidden bg-card rounded-lg border">
			<div className="text-center mb-4 relative">
				<div className="absolute right-0 top-0 flex gap-1">
					<Button
						variant="ghost"
						size="icon"
						onClick={handleRefresh}
						disabled={isRefreshing}
						title="Refresh & sync wallet"
					>
						<RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
					</Button>
				</div>
				<p className="text-sm text-muted-foreground mb-1">Balance</p>
				<p className="text-2xl font-bold">{balance.toLocaleString()} sats</p>
			</div>

			{/* Action Buttons */}
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
					disabled={balance === 0}
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
					disabled={balance === 0}
				>
					<Send className="w-4 h-4" />
					Send eCash
				</Button>
			</div>

			{/* Default Mint Selector */}
			<div className="pt-2 mb-2 overflow-hidden">
				<p className="text-sm font-medium mb-2">Default Mint</p>
				{mints.length > 0 ? (
					<Select
						value={defaultMint ?? ''}
						onValueChange={(value) => nip60Actions.setDefaultMint(value || null)}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a default mint">
								{defaultMint ? (
									<span className="flex items-center gap-2 truncate">
										<Star className="w-4 h-4 text-yellow-500 fill-current shrink-0" />
										<span className="truncate">{getMintHostname(defaultMint)}</span>
										{mintBalances[defaultMint] !== undefined && (
											<span className="text-muted-foreground shrink-0">
												({mintBalances[defaultMint].toLocaleString()})
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
										{mintBalances[mint] !== undefined && (
											<span className="text-muted-foreground shrink-0">
												({mintBalances[mint].toLocaleString()})
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

			{/* Toggle Row: Mints, Transactions, Proofs */}
			<div className="pt-2 overflow-hidden">
				{/* Toggle buttons row */}
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
						<span className="text-xs">{transactions.length}</span>
					</Button>
					<Button
						variant={openSection === 'proofs' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'proofs' ? null : 'proofs')}
						className="flex-1 gap-1.5 px-2"
						title="Proofs"
					>
						<Coins className="w-4 h-4 shrink-0" />
						<span className="text-xs">{Array.from(proofsByMint.values()).flat().length}</span>
					</Button>
					{activePendingTokens.length > 0 && (
						<Button
							variant={openSection === 'pending' ? 'default' : 'ghost'}
							size="sm"
							onClick={() => setOpenSection(openSection === 'pending' ? null : 'pending')}
							className="flex-1 gap-1.5 px-2"
							title="Pending tokens"
						>
							<Clock className="w-4 h-4 shrink-0" />
							<span className="text-xs">{activePendingTokens.length}</span>
						</Button>
					)}
				</div>

				{/* Content panels */}
				{openSection === 'mints' && (
					<div className="space-y-2 pt-2 overflow-hidden border-t">
						{mints.map((mint) => (
							<div key={mint} className="flex items-center justify-between text-sm gap-2">
								<span className="truncate min-w-0" title={mint}>
									{getMintHostname(mint)}
								</span>
								<div className="flex items-center gap-1 shrink-0">
									{mintBalances[mint] !== undefined && (
										<span className="text-xs text-muted-foreground">
											{mintBalances[mint].toLocaleString()}
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
						<Button size="sm" onClick={handleSaveWallet} disabled={isSaving} className="w-full">
							{isSaving ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<Save className="h-4 w-4" />
							)}
							Save Wallet
						</Button>
					</div>
				)}

				{openSection === 'transactions' && (
					<div className="pt-2 overflow-hidden border-t">
						{transactions.length > 0 ? (
							<div className="space-y-2 max-h-48 overflow-y-auto">
								{transactions.map((tx) => (
									<div key={tx.id} className="flex items-center justify-between text-sm gap-2">
										<div className="flex items-center gap-2 min-w-0">
											{tx.direction === 'in' ? (
												<ArrowDownLeft className="w-4 h-4 text-green-500 shrink-0" />
											) : (
												<ArrowUpRight className="w-4 h-4 text-red-500 shrink-0" />
											)}
											<span className="text-muted-foreground truncate">
												{new Date(tx.timestamp * 1000).toLocaleDateString()}
											</span>
										</div>
										<span
											className={`shrink-0 ${tx.direction === 'in' ? 'text-green-500' : 'text-red-500'}`}
										>
											{tx.direction === 'in' ? '+' : '-'}
											{tx.amount.toLocaleString()}
										</span>
									</div>
								))}
							</div>
						) : (
							<p className="text-muted-foreground text-sm">No transactions yet</p>
						)}
					</div>
				)}

				{openSection === 'proofs' && (
					<div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pt-2 border-t">
						{proofsByMint.size === 0 ? (
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
												{proofs.map((proof, idx) => (
													<div
														key={`${proof.id}-${proof.secret.slice(0, 8)}-${idx}`}
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

				{openSection === 'pending' && (
					<div className="space-y-2 max-h-48 overflow-y-auto pt-2 border-t">
						{activePendingTokens.map((token) => (
							<div
								key={token.id}
								className="flex items-center justify-between p-2 bg-muted rounded-lg gap-2"
							>
								<div className="min-w-0">
									<p className="font-medium text-sm">{token.amount.toLocaleString()} sats</p>
									<p className="text-xs text-muted-foreground truncate">
										{getMintHostname(token.mintUrl)} •{' '}
										{new Date(token.createdAt).toLocaleDateString()}
									</p>
								</div>
								<div className="flex gap-0.5 shrink-0">
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => setViewingToken(token)}
										title="View token"
									>
										<Eye className="w-3.5 h-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => handleCopyToken(token.token)}
										title="Copy token"
									>
										<Copy className="w-3.5 h-3.5" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7"
										onClick={() => handleReclaim(token)}
										disabled={isReclaiming === token.id}
										title="Try to reclaim"
									>
										{isReclaiming === token.id ? (
											<Loader2 className="w-3.5 h-3.5 animate-spin" />
										) : (
											<RotateCcw className="w-3.5 h-3.5" />
										)}
									</Button>
									<Button
										variant="destructive"
										size="icon"
										className="h-7 w-7"
										onClick={() => handleRemovePendingToken(token)}
										title="Remove from list"
									>
										<Trash2 className="w-3.5 h-3.5" />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			{/* Modals */}
			<DepositLightningModal open={openModal === 'deposit'} onClose={() => setOpenModal(null)} />
			<WithdrawLightningModal open={openModal === 'withdraw'} onClose={() => setOpenModal(null)} />
			<SendEcashModal open={openModal === 'send'} onClose={() => setOpenModal(null)} />
			<ReceiveEcashModal open={openModal === 'receive'} onClose={() => setOpenModal(null)} />

			{/* Pending Token Detail Modal */}
			<Dialog
				open={viewingToken !== null}
				onOpenChange={(isOpen) => !isOpen && setViewingToken(null)}
			>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Send className="w-5 h-5 text-purple-500" />
							Pending Token
						</DialogTitle>
						<DialogDescription>
							{viewingToken?.amount.toLocaleString()} sats •{' '}
							{viewingToken ? getMintHostname(viewingToken.mintUrl) : ''}
						</DialogDescription>
					</DialogHeader>

					{viewingToken && (
						<div className="space-y-4">
							<div className="flex justify-center">
								<div className="p-4 bg-white rounded-lg">
									<QRCodeSVG value={viewingToken.token} size={200} />
								</div>
							</div>
							<div className="space-y-2">
								<p className="text-sm font-medium">Cashu Token</p>
								<textarea
									value={viewingToken.token}
									readOnly
									className="w-full px-3 py-2 text-sm bg-muted rounded-md font-mono resize-none h-24"
								/>
								<div className="flex justify-end">
									<Button
										variant="outline"
										size="sm"
										onClick={() => handleCopyToken(viewingToken.token)}
										className="gap-2"
									>
										{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
										{copied ? 'Copied!' : 'Copy Token'}
									</Button>
								</div>
							</div>
							<p className="text-xs text-muted-foreground text-center">
								Created {new Date(viewingToken.createdAt).toLocaleString()}
							</p>
							<div className="flex justify-end gap-2">
								<Button
									variant="outline"
									onClick={() => {
										handleReclaim(viewingToken)
										setViewingToken(null)
									}}
									disabled={isReclaiming === viewingToken.id}
								>
									{isReclaiming === viewingToken.id ? (
										<Loader2 className="w-4 h-4 animate-spin mr-2" />
									) : (
										<RotateCcw className="w-4 h-4 mr-2" />
									)}
									Reclaim
								</Button>
								<Button onClick={() => setViewingToken(null)}>Close</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	)
}
