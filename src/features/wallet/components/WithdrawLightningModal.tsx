/**
 * Pay a Lightning invoice using eCash from this wallet.
 *
 * Routed via `payLightningInvoice`, which selects proofs from the chosen mint
 * (or any mint with sufficient balance), creates a melt quote, and pays it.
 */

import { Scanner } from '@yudiel/react-qr-scanner'
import { Check, Loader2, ScanLine, Zap } from 'lucide-react'
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
import { getMintHostname, payLightningInvoice } from '@/lib/wallet'

interface WithdrawLightningModalProps {
	open: boolean
	onClose: () => void
	mints: string[]
	balance: Record<string, number>
	totalBalance: number
	defaultMint: string | null
}

export function WithdrawLightningModal({
	open,
	onClose,
	mints,
	balance,
	totalBalance,
	defaultMint,
}: WithdrawLightningModalProps) {
	const [invoice, setInvoice] = useState('')
	const [selectedMint, setSelectedMint] = useState('')
	const [isPaying, setIsPaying] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
		}
	}, [open, defaultMint, mints])

	const mintsWithBalance = mints.filter((m) => (balance[m] ?? 0) > 0)

	const handleWithdraw = async () => {
		const trimmed = invoice.trim().replace(/^lightning:/i, '')
		if (!trimmed) {
			toast.error('Please enter a Lightning invoice')
			return
		}
		if (!trimmed.toLowerCase().startsWith('lnbc')) {
			toast.error('Invalid Lightning invoice format')
			return
		}

		setIsPaying(true)
		setError(null)
		try {
			await payLightningInvoice(trimmed, { mint: selectedMint || undefined })
			setIsSuccess(true)
			toast.success('Withdrawal successful')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Withdrawal failed'
			setError(message)
			toast.error(message)
		} finally {
			setIsPaying(false)
		}
	}

	const handleScan = (detectedCodes: { rawValue?: string }[]) => {
		if (!detectedCodes.length) return
		const result = detectedCodes[0]?.rawValue
		if (!result) return
		setInvoice(result.replace(/^lightning:/i, '').trim())
		setShowScanner(false)
		toast.success('Invoice scanned')
	}

	const handleClose = () => {
		setInvoice('')
		setSelectedMint('')
		setIsSuccess(false)
		setShowScanner(false)
		setError(null)
		onClose()
	}

	return (
		<Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="w-5 h-5 text-orange-500" />
						Withdraw to Lightning
					</DialogTitle>
					<DialogDescription>
						Pay a Lightning invoice using your eCash (Balance: {totalBalance.toLocaleString()} sats)
					</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-ok/15 flex items-center justify-center">
							<Check className="w-6 h-6 text-ok" />
						</div>
						<p className="text-lg font-medium text-ok">Withdrawal Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">
							Your Lightning invoice has been paid
						</p>
						<Button onClick={handleClose} className="mt-4">
							Done
						</Button>
					</div>
				) : showScanner ? (
					<div className="space-y-4">
						<div className="relative w-full aspect-square overflow-hidden rounded-lg">
							<Scanner
								onScan={handleScan}
								onError={(err) => {
									console.error('Scanner error:', err)
									toast.error('Camera error')
								}}
								constraints={{ facingMode: 'environment' }}
							/>
						</div>
						<div className="flex justify-end">
							<Button variant="outline" onClick={() => setShowScanner(false)}>
								Cancel
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						{mintsWithBalance.length > 0 && (
							<div className="space-y-2">
								<label className="text-sm font-medium" htmlFor="withdraw-mint">
									From Mint
								</label>
								<select
									id="withdraw-mint"
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

						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="withdraw-invoice">
								Lightning Invoice
							</label>
							<textarea
								id="withdraw-invoice"
								value={invoice}
								onChange={(e) => setInvoice(e.target.value)}
								placeholder="lnbc..."
								className="w-full px-3 py-2 text-sm border rounded-md bg-background font-mono resize-none h-24"
							/>
							<div className="flex justify-end">
								<Button
									variant="ghost"
									size="sm"
									onClick={() => setShowScanner(true)}
									className="gap-2"
								>
									<ScanLine className="w-4 h-4" />
									Scan QR
								</Button>
							</div>
						</div>

						{error && <p className="text-sm text-destructive">{error}</p>}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button onClick={handleWithdraw} disabled={isPaying || !invoice.trim()}>
								{isPaying ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Withdraw
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
