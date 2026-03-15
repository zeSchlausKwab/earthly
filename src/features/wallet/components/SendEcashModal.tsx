import { useState, useEffect } from 'react'
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogHeader,
	DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useCashuStore, cashuActions } from '@/lib/stores/cashu'
import { useNip60Store } from '@/lib/stores/nip60'
import { Loader2, Copy, Check, Send } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { getMintHostname } from '@/lib/wallet'
import { Label } from '@radix-ui/react-label'
import { Input } from '@/components/ui/input'

interface SendEcashModalProps {
	open: boolean
	onClose: () => void
}

type View = 'form' | 'token'

export function SendEcashModal({ open, onClose }: SendEcashModalProps) {
	const { mints, defaultMint, mintBalances, balance: nip60Balance } = useNip60Store()
	const { status: cashuStatus, balances: cashuBalances } = useCashuStore()

	// Always use nip60 balances for display since that's where the actual proofs are stored
	const balances = mintBalances
	const totalBalance = nip60Balance

	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [view, setView] = useState<View>('form')

	// Sync selectedMint with defaultMint when modal opens or defaultMint changes
	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
		}
	}, [open, defaultMint, mints])

	const handleGenerate = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		// Check balance at selected mint
		const mintBalance = selectedMint ? (balances[selectedMint] ?? 0) : totalBalance
		if (amountNum > mintBalance) {
			toast.error(
				`Insufficient balance at ${selectedMint ? getMintHostname(selectedMint) : 'wallet'}`,
			)
			return
		}

		setIsGenerating(true)
		setError(null)
		try {
			// Check if coco has balance at the selected mint
			const cashuMintBalance = cashuBalances[selectedMint] ?? 0
			const useCoco = cashuStatus === 'ready' && selectedMint && cashuMintBalance >= amountNum

			let token: string | null = null

			if (useCoco) {
				// Use coco if it has sufficient balance
				console.log('[SendEcash] Using coco for send')
				token = await cashuActions.send(selectedMint, amountNum)
			} else {
				// Fall back to nip60 which has the actual proofs from Nostr
				console.log('[SendEcash] Using nip60 for send (coco balance:', cashuMintBalance, ')')
				const { nip60Actions } = await import('@/lib/stores/nip60')
				token = await nip60Actions.sendEcash(amountNum, selectedMint || undefined)
			}

			if (token) {
				setGeneratedToken(token)
				setView('token')
				toast.success('eCash token generated!')
			} else {
				throw new Error('Failed to generate token')
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to generate eCash token'
			setError(message)
			toast.error(message)
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyToken = async () => {
		if (!generatedToken) return
		try {
			await navigator.clipboard.writeText(generatedToken)
			setCopied(true)
			toast.success('Token copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy token')
		}
	}

	const handleClose = () => {
		setAmount('')
		setGeneratedToken(null)
		setCopied(false)
		setError(null)
		setView('form')
		onClose()
	}

	// Get mints that have balance
	const mintsWithBalance = mints.filter((mint) => (balances[mint] ?? 0) > 0)

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Send className="w-5 h-5 text-purple-500" />
						Send eCash
					</DialogTitle>
					<DialogDescription>
						Generate a Cashu token to send eCash (Balance: {totalBalance.toLocaleString()} sats)
					</DialogDescription>
				</DialogHeader>

				{view === 'token' && generatedToken ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="p-4 bg-white rounded-lg">
								<QRCodeSVG value={generatedToken} size={200} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Cashu Token</p>
							<div className="flex gap-2">
								<textarea
									value={generatedToken}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono resize-none h-24"
								/>
							</div>
							<div className="flex justify-end">
								<Button variant="outline" size="sm" onClick={handleCopyToken} className="gap-2">
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
									{copied ? 'Copied!' : 'Copy Token'}
								</Button>
							</div>
						</div>
						<p className="text-sm text-muted-foreground text-center">
							Share this token with the recipient. It can only be redeemed once.
						</p>
						<p className="text-xs text-muted-foreground text-center">
							Token saved to pending list. You can reclaim it if the recipient doesn't claim it.
						</p>
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={() => setView('form')}>
								Send Another
							</Button>
							<Button onClick={handleClose}>Done</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="space-y-2">
							<Label className="text-sm font-medium">Amount (sats)</Label>
							<Input
								type="number"
								value={amount}
								onChange={(e) => setAmount(e.target.value)}
								placeholder="Enter amount in sats"
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								min="1"
								max={totalBalance}
							/>
						</div>

						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-sm font-medium">From Mint</label>
								<select
									value={selectedMint}
									onChange={(e) => setSelectedMint(e.target.value)}
									className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								>
									{mintsWithBalance.map((mint) => (
										<option key={mint} value={mint}>
											{getMintHostname(mint)} ({(balances[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

						{cashuStatus === 'initializing' && (
							<p className="text-sm text-muted-foreground flex items-center gap-2">
								<Loader2 className="w-4 h-4 animate-spin" />
								Initializing wallet...
							</p>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button
								onClick={handleGenerate}
								disabled={
									isGenerating || !amount || !selectedMint || cashuStatus === 'initializing'
								}
							>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Token
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
