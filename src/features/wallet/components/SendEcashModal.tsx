/**
 * Generate a Cashu token from this wallet's eCash.
 *
 * Routes through `sendCashuToken`, which runs `TokensOperation` to swap
 * proofs for an exact-amount token and persists the change back to the wallet.
 */

import { Label } from '@radix-ui/react-label'
import { Check, Copy, Loader2, Send } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { getMintHostname, sendCashuToken } from '@/lib/wallet'

interface SendEcashModalProps {
	open: boolean
	onClose: () => void
	mints: string[]
	balance: Record<string, number>
	totalBalance: number
	defaultMint: string | null
}

type View = 'form' | 'token'

export function SendEcashModal({
	open,
	onClose,
	mints,
	balance,
	totalBalance,
	defaultMint,
}: SendEcashModalProps) {
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [generatedToken, setGeneratedToken] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [view, setView] = useState<View>('form')

	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
		}
	}, [open, defaultMint, mints])

	const mintsWithBalance = mints.filter((m) => (balance[m] ?? 0) > 0)

	const handleGenerate = async () => {
		const amountNum = Number.parseInt(amount, 10)
		if (Number.isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		const mintBalance = selectedMint ? (balance[selectedMint] ?? 0) : totalBalance
		if (amountNum > mintBalance) {
			toast.error(
				`Insufficient balance at ${selectedMint ? getMintHostname(selectedMint) : 'wallet'}`,
			)
			return
		}

		setIsGenerating(true)
		setError(null)
		try {
			const token = await sendCashuToken(amountNum, { mint: selectedMint || undefined })
			setGeneratedToken(token)
			setView('token')
			toast.success('eCash token generated')
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
							<textarea
								value={generatedToken}
								readOnly
								className="w-full px-3 py-2 text-sm bg-muted rounded-md font-mono resize-none h-24"
							/>
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
											{getMintHostname(mint)} ({(balance[mint] ?? 0).toLocaleString()} sats)
										</option>
									))}
								</select>
							</div>
						)}

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleGenerate} disabled={isGenerating || !amount}>
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
