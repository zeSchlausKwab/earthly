/**
 * Redeem an incoming Cashu token into this wallet.
 *
 * Routes through `receiveCashuToken`, which decodes, swaps the proofs at the
 * mint, and adds them as a new wallet token event with a history entry.
 */

import { Scanner } from '@yudiel/react-qr-scanner'
import { Check, Loader2, QrCode, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { receiveCashuToken } from '@/lib/wallet'

interface ReceiveEcashModalProps {
	open: boolean
	onClose: () => void
}

export function ReceiveEcashModal({ open, onClose }: ReceiveEcashModalProps) {
	const [token, setToken] = useState('')
	const [isReceiving, setIsReceiving] = useState(false)
	const [isSuccess, setIsSuccess] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleReceive = async () => {
		const trimmed = token.trim()
		if (!trimmed) {
			toast.error('Please enter a Cashu token')
			return
		}
		if (!trimmed.startsWith('cashuA') && !trimmed.startsWith('cashuB')) {
			toast.error('Invalid Cashu token format')
			return
		}

		setIsReceiving(true)
		setError(null)
		try {
			await receiveCashuToken(trimmed)
			setIsSuccess(true)
			toast.success('eCash received')
		} catch (err) {
			const message = err instanceof Error ? err.message : 'Failed to receive eCash'
			setError(message)
			toast.error(message)
		} finally {
			setIsReceiving(false)
		}
	}

	const handleScan = (detectedCodes: { rawValue?: string }[]) => {
		if (!detectedCodes.length) return
		const result = detectedCodes[0]?.rawValue
		if (!result) return
		if (result.startsWith('cashuA') || result.startsWith('cashuB')) {
			setToken(result)
			setShowScanner(false)
			toast.success('Token scanned')
		} else {
			toast.error('Invalid Cashu token')
		}
	}

	const handleClose = () => {
		setToken('')
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
						<QrCode className="w-5 h-5 text-blue-500" />
						Receive eCash
					</DialogTitle>
					<DialogDescription>Scan or paste a Cashu token to receive eCash</DialogDescription>
				</DialogHeader>

				{isSuccess ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
							<Check className="w-6 h-6 text-green-600" />
						</div>
						<p className="text-lg font-medium text-green-600">eCash Received!</p>
						<p className="text-sm text-muted-foreground mt-2">
							The tokens have been added to your wallet
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
						<div className="space-y-2">
							<label className="text-sm font-medium" htmlFor="receive-ecash-token">
								Cashu Token
							</label>
							<textarea
								id="receive-ecash-token"
								value={token}
								onChange={(e) => setToken(e.target.value)}
								placeholder="cashuA..."
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
							<Button onClick={handleReceive} disabled={isReceiving || !token.trim()}>
								{isReceiving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Receive
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
