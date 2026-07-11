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

import type { WalletHistory, WalletToken } from 'applesauce-wallet/casts'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowDownLeft,
	ArrowUpDown,
	ArrowUpRight,
	Check,
	Coins,
	Copy,
	Landmark,
	Loader2,
	Lock,
	Plus,
	QrCode,
	Send,
	Star,
	Unlock,
	Wrench,
	X,
	Zap,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import {
	createWallet,
	encodeWalletToken,
	getMintHostname,
	setMints as setWalletMints,
	unlockWallet,
	useDefaultMint,
	useNutzaps,
	useWallet,
} from '@/lib/wallet'
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { DepositLightningModal } from './DepositLightningModal'
import { NutzapsSection } from './NutzapsSection'
import { ReceiveEcashModal } from './ReceiveEcashModal'
import { SendEcashModal } from './SendEcashModal'
import { WalletToolsSection } from './WalletToolsSection'
import { WithdrawLightningModal } from './WithdrawLightningModal'

const DEFAULT_MINTS = [
	'https://mint.minibits.cash/Bitcoin',
	'https://mint.coinos.io',
	'https://mint.cubabitcoin.org',
]

type ModalType = 'deposit' | 'withdraw' | 'send' | 'receive' | null
type Section = 'mints' | 'transactions' | 'tokens' | 'nutzaps' | 'tools' | null

export function Nip60Wallet() {
	const account = useActiveAccount()
	const { loading, syncing, exists, unlocked, ready, balance, totalBalance, mints, wallet } =
		useWallet()
	const tokens = use$(() => wallet?.tokens$, [wallet])
	const history = use$(() => wallet?.history$, [wallet])
	const { unclaimed: unclaimedNutzaps } = useNutzaps()
	const [defaultMint, setDefaultMint] = useDefaultMint()

	const [isCreating, setIsCreating] = useState(false)
	const [isUnlocking, setIsUnlocking] = useState(false)
	const [isSavingMints, setIsSavingMints] = useState(false)
	const [newMintUrl, setNewMintUrl] = useState('')
	const [editedMints, setEditedMints] = useState<string[] | null>(null)
	const [openModal, setOpenModal] = useState<ModalType>(null)
	const [openSection, setOpenSection] = useState<Section>(null)

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
			<div className="bg-muted rounded-lg">
				<SignedOutCta description="Sign in to view your wallet and send or receive zaps." />
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
			<div className="text-center mb-4">
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
					className="bg-ok hover:bg-ok/15 text-white"
				>
					<Zap className="w-4 h-4" />
					Deposit
				</Button>
				<Button
					size="sm"
					onClick={() => setOpenModal('withdraw')}
					disabled={!ready || totalBalance === 0}
					className="bg-primary hover:bg-primary/15 text-white"
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
						variant={openSection === 'tokens' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'tokens' ? null : 'tokens')}
						className="flex-1 gap-1.5 px-2"
						title="Tokens"
					>
						<Coins className="w-4 h-4 shrink-0" />
						<span className="text-xs">{syncing ? '…' : (tokens?.length ?? 0)}</span>
					</Button>
					<Button
						variant={openSection === 'nutzaps' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'nutzaps' ? null : 'nutzaps')}
						className="flex-1 gap-1.5 px-2"
						title="Nutzaps"
					>
						<Zap className="w-4 h-4 shrink-0" />
						<span className="text-xs">{unclaimedNutzaps.length}</span>
					</Button>
					<Button
						variant={openSection === 'tools' ? 'default' : 'ghost'}
						size="sm"
						onClick={() => setOpenSection(openSection === 'tools' ? null : 'tools')}
						className="flex-1 gap-1.5 px-2"
						title="Wallet tools"
					>
						<Wrench className="w-4 h-4 shrink-0" />
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

				{openSection === 'tokens' && (
					<div className="space-y-2 max-h-48 overflow-y-auto overflow-x-hidden pt-2 border-t">
						{!tokens || tokens.length === 0 ? (
							<p className="text-sm text-muted-foreground">No tokens in wallet</p>
						) : (
							tokens.map((token) => <TokenRow key={token.event.id} token={token} />)
						)}
					</div>
				)}

				{openSection === 'nutzaps' && (
					<div className="pt-2 overflow-hidden border-t">
						<NutzapsSection />
					</div>
				)}

				{openSection === 'tools' && wallet && (
					<div className="pt-2 overflow-hidden border-t">
						<WalletToolsSection wallet={wallet} />
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
		</div>
	)
}

/** A single NIP-60 token event: amount, mint, and a copy-as-cashu-token shortcut. */
function TokenRow({ token }: { token: WalletToken }) {
	const amount = use$(() => token.amount$, [token])
	const mint = use$(() => token.mint$, [token])
	const [copied, setCopied] = useState(false)

	// Cheap enough to compute per render; recomputes naturally once the token unlocks.
	const encoded = encodeWalletToken({ mint: token.mint, proofs: token.proofs })

	const handleCopy = async () => {
		if (!encoded) return
		try {
			await navigator.clipboard.writeText(encoded)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	if (!token.unlocked) {
		return (
			<div className="flex items-center gap-2 text-sm text-muted-foreground">
				<Lock className="w-3 h-3 shrink-0" />
				Locked
			</div>
		)
	}

	return (
		<div className="flex items-center justify-between text-sm gap-2">
			<div className="flex items-center gap-2 min-w-0">
				<span className="font-medium shrink-0">{(amount ?? 0).toLocaleString()}</span>
				{mint && (
					<span className="text-xs text-muted-foreground truncate min-w-0" title={mint}>
						{getMintHostname(mint)}
					</span>
				)}
			</div>
			{encoded && (
				<Button
					variant="ghost"
					size="icon"
					className="h-6 w-6 shrink-0"
					onClick={handleCopy}
					title="Copy cashu token"
				>
					{copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
				</Button>
			)}
		</div>
	)
}

function HistoryRow({ entry }: { entry: WalletHistory }) {
	const meta = use$(() => entry.meta$, [entry])
	const direction = meta?.direction
	const amount = meta?.amount ?? 0
	const ts = entry.event.created_at
	return (
		<div className="flex items-center justify-between text-sm gap-2">
			<div className="flex items-center gap-2 min-w-0">
				{direction === 'in' ? (
					<ArrowDownLeft className="w-4 h-4 text-ok shrink-0" />
				) : direction === 'out' ? (
					<ArrowUpRight className="w-4 h-4 text-destructive shrink-0" />
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
						? 'text-ok'
						: direction === 'out'
							? 'text-destructive'
							: 'text-muted-foreground'
				}`}
			>
				{direction === 'in' ? '+' : direction === 'out' ? '-' : ''}
				{amount.toLocaleString()}
			</span>
		</div>
	)
}
