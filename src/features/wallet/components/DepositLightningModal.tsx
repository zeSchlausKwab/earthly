/**
 * Lightning → eCash deposit flow.
 *
 * Talks directly to a chosen mint via cashu-ts: requests a bolt11 mint quote,
 * shows the invoice (qr + copy), polls until paid, then runs `AddToken` to
 * record the new proofs in the wallet.
 */

import { Label } from '@radix-ui/react-label'
import { Check, Copy, ExternalLink, Loader2, Zap } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'
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
import { type DepositSession, getMintHostname, startLightningDeposit } from '@/lib/wallet'
import { normalizeLightningUri, openExternalProtocol } from '@/platform/externalProtocol'

interface DepositLightningModalProps {
	open: boolean
	onClose: () => void
	mints: string[]
	defaultMint: string | null
}

export function DepositLightningModal({
	open,
	onClose,
	mints,
	defaultMint,
}: DepositLightningModalProps) {
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState('')
	const [session, setSession] = useState<DepositSession | null>(null)
	const [phase, setPhase] = useState<'idle' | 'awaitingPayment' | 'claiming' | 'success' | 'error'>(
		'idle',
	)
	const [errorMsg, setErrorMsg] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const abortRef = useRef<AbortController | null>(null)

	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
		}
	}, [open, defaultMint, mints])

	useEffect(() => {
		return () => {
			abortRef.current?.abort()
		}
	}, [])

	const handleStart = async () => {
		const amountNum = Number.parseInt(amount, 10)
		if (Number.isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}
		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setErrorMsg(null)
		setPhase('awaitingPayment')

		try {
			const next = await startLightningDeposit({ mint: selectedMint, amount: amountNum })
			setSession(next)

			const controller = new AbortController()
			abortRef.current = controller

			await next.waitForPayment({ signal: controller.signal })
			setPhase('claiming')
			await next.claim()
			setPhase('success')
			toast.success('Deposit complete')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Deposit failed'
			setErrorMsg(message)
			setPhase('error')
			if (message !== 'Cancelled') toast.error(message)
		}
	}

	const handleCopyInvoice = async () => {
		if (!session) return
		try {
			await navigator.clipboard.writeText(session.invoice)
			setCopied(true)
			toast.success('Invoice copied')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy invoice')
		}
	}

	const handleOpenWallet = async () => {
		if (!session) return
		try {
			await openExternalProtocol(normalizeLightningUri(session.invoice))
		} catch (err) {
			console.error('Unable to open Lightning wallet', err)
			toast.error('No compatible Lightning wallet could open this invoice')
		}
	}

	const handleClose = () => {
		abortRef.current?.abort()
		abortRef.current = null
		setAmount('')
		setSession(null)
		setPhase('idle')
		setErrorMsg(null)
		setCopied(false)
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-yellow-500" />
						Deposit Lightning
					</DialogTitle>
					<DialogDescription>Generate a Lightning invoice to mint eCash</DialogDescription>
				</DialogHeader>

				{phase === 'success' ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-ok/15 flex items-center justify-center">
							<Check className="w-6 h-6 text-ok" />
						</div>
						<p className="text-lg font-medium text-ok">Deposit Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your eCash has been minted</p>
						<Button onClick={handleClose} className="mt-4">
							Done
						</Button>
					</div>
				) : session ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<button
								type="button"
								onClick={() => void handleOpenWallet()}
								className="flex flex-col items-center gap-2 rounded-lg bg-card p-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="Open invoice in a Lightning wallet"
							>
								<QRCodeSVG value={normalizeLightningUri(session.invoice)} size={200} />
								<span className="flex items-center gap-1 text-xs font-medium text-foreground">
									<ExternalLink className="h-3.5 w-3.5" /> Open Lightning wallet
								</span>
							</button>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Lightning Invoice</p>
							<div className="flex gap-2">
								<Input
									type="text"
									value={session.invoice}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
								/>
								<Button variant="outline" size="icon" onClick={handleCopyInvoice}>
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
								</Button>
							</div>
						</div>
						<p className="text-sm text-muted-foreground text-center">
							{phase === 'claiming' ? 'Minting proofs…' : 'Waiting for payment…'}
						</p>
						<div className="flex justify-center">
							<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
						</div>
						{errorMsg && <p className="text-sm text-destructive text-center">{errorMsg}</p>}
						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
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
							/>
						</div>

						<div className="space-y-2">
							<Label className="text-sm font-medium">Mint</Label>
							<select
								value={selectedMint}
								onChange={(e) => setSelectedMint(e.target.value)}
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
							>
								{mints.map((mint) => (
									<option key={mint} value={mint}>
										{getMintHostname(mint)}
									</option>
								))}
							</select>
						</div>

						{errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button
								onClick={handleStart}
								disabled={phase === 'awaitingPayment' || !amount || !selectedMint}
							>
								Generate Invoice
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
