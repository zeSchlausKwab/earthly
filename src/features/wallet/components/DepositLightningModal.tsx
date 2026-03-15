import { useState, useEffect } from 'react'
import {
	Dialog,
	DialogContent,
	DialogTitle,
	DialogHeader,
	DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useNip60Store, nip60Actions } from '@/lib/stores/nip60'
import { Loader2, Copy, Check, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { QRCodeSVG } from 'qrcode.react'
import { Input } from '@/components/ui/input'
import { Label } from '@radix-ui/react-label'

interface DepositLightningModalProps {
	open: boolean
	onClose: () => void
}

export function DepositLightningModal({ open, onClose }: DepositLightningModalProps) {
	const { mints, defaultMint, depositInvoice, depositStatus } = useNip60Store()
	const [amount, setAmount] = useState('')
	const [selectedMint, setSelectedMint] = useState<string>('')
	const [isGenerating, setIsGenerating] = useState(false)
	const [copied, setCopied] = useState(false)

	// Sync selectedMint with defaultMint when modal opens or defaultMint changes
	useEffect(() => {
		if (open) {
			setSelectedMint(defaultMint ?? mints[0] ?? '')
		}
	}, [open, defaultMint, mints])

	const handleGenerateInvoice = async () => {
		const amountNum = parseInt(amount, 10)
		if (isNaN(amountNum) || amountNum <= 0) {
			toast.error('Please enter a valid amount')
			return
		}

		if (!selectedMint) {
			toast.error('Please select a mint')
			return
		}

		setIsGenerating(true)
		try {
			await nip60Actions.startDeposit(amountNum, selectedMint)
		} finally {
			setIsGenerating(false)
		}
	}

	const handleCopyInvoice = async () => {
		if (!depositInvoice) return
		try {
			await navigator.clipboard.writeText(depositInvoice)
			setCopied(true)
			toast.success('Invoice copied to clipboard')
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error('Failed to copy invoice')
		}
	}

	const handleClose = () => {
		if (depositStatus === 'pending') {
			nip60Actions.cancelDeposit()
		}
		setAmount('')
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

				{depositStatus === 'success' ? (
					<div className="py-6 text-center">
						<div className="w-12 h-12 mx-auto mb-4 rounded-full bg-green-100 flex items-center justify-center">
							<Check className="w-6 h-6 text-green-600" />
						</div>
						<p className="text-lg font-medium text-green-600">Deposit Successful!</p>
						<p className="text-sm text-muted-foreground mt-2">Your eCash has been minted</p>
						<Button onClick={handleClose} className="mt-4">
							Done
						</Button>
					</div>
				) : depositInvoice ? (
					<div className="space-y-4">
						<div className="flex justify-center">
							<div className="p-4 bg-white rounded-lg">
								<QRCodeSVG value={depositInvoice} size={200} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium">Lightning Invoice</p>
							<div className="flex gap-2">
								<Input
									type="text"
									value={depositInvoice}
									readOnly
									className="flex-1 px-3 py-2 text-sm bg-muted rounded-md font-mono truncate"
								/>
								<Button variant="outline" size="icon" onClick={handleCopyInvoice}>
									{copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
								</Button>
							</div>
						</div>
						<p className="text-sm text-muted-foreground text-center">Waiting for payment...</p>
						<div className="flex justify-center">
							<Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
						</div>
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
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
								min="1"
							/>
						</div>

						<div className="space-y-2">
							<Label className="text-sm font-medium">Mint</Label>
							<Input
								as="select"
								value={selectedMint}
								onChange={(e) => setSelectedMint(e.target.value)}
								className="w-full px-3 py-2 text-sm border rounded-md bg-background"
							>
								{mints.map((mint) => (
									<option key={mint} value={mint}>
										{new URL(mint).hostname}
									</option>
								))}
							</Input>
						</div>

						{depositStatus === 'error' && (
							<p className="text-sm text-destructive">
								Failed to generate invoice. Please try again.
							</p>
						)}

						<div className="flex justify-end gap-2">
							<Button variant="outline" onClick={handleClose}>
								Cancel
							</Button>
							<Button
								onClick={handleGenerateInvoice}
								disabled={isGenerating || !amount || !selectedMint}
							>
								{isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
								Generate Invoice
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
