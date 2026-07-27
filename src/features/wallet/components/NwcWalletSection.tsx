import { Scanner } from '@yudiel/react-qr-scanner'
import { Check, Loader2, QrCode, ScanLine, Unplug, WalletCards } from 'lucide-react'
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
import { getNwcWalletStatus } from '@/lib/wallet/nwc'
import { useNwcConnection } from '../hooks/useNwcConnection'

export function NwcWalletSection() {
	const { connection, save, remove } = useNwcConnection()
	const [dialogOpen, setDialogOpen] = useState(false)
	const [showScanner, setShowScanner] = useState(false)
	const [connectionUri, setConnectionUri] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [isChecking, setIsChecking] = useState(false)
	const [balanceSats, setBalanceSats] = useState<number | null>(null)
	const [canPay, setCanPay] = useState<boolean | null>(null)

	useEffect(() => {
		if (!connection) {
			setBalanceSats(null)
			setCanPay(null)
			return
		}
		let cancelled = false
		setIsChecking(true)
		getNwcWalletStatus(connection)
			.then((status) => {
				if (cancelled) return
				setCanPay(status.canPay)
				setBalanceSats(status.balanceSats ?? null)
			})
			.catch(() => {
				if (cancelled) return
				setCanPay(null)
				setBalanceSats(null)
			})
			.finally(() => {
				if (!cancelled) setIsChecking(false)
			})
		return () => {
			cancelled = true
		}
	}, [connection])

	const resetDialog = () => {
		setShowScanner(false)
		setConnectionUri('')
		setError(null)
	}

	const handleSave = () => {
		try {
			save(connectionUri)
			setDialogOpen(false)
			resetDialog()
			toast.success('NWC wallet added')
		} catch (saveError) {
			setError(saveError instanceof Error ? saveError.message : 'Invalid NWC connection')
		}
	}

	const handleScan = (codes: { rawValue?: string }[]) => {
		const value = codes[0]?.rawValue?.trim()
		if (!value) return
		if (!value.toLowerCase().startsWith('nostr+walletconnect://')) {
			setError('This QR code is not an NWC connection.')
			return
		}
		setConnectionUri(value)
		setShowScanner(false)
		setError(null)
	}

	return (
		<>
			<div className="rounded-lg border bg-card p-4">
				<div className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2">
							<WalletCards className="h-4 w-4 text-primary" />
							<h2 className="text-sm font-semibold">Nostr Wallet Connect</h2>
						</div>
						{connection ? (
							<div className="mt-1 space-y-1 text-xs text-muted-foreground">
								<p className="truncate" title={connection.service}>
									Connected · {connection.lud16 ?? `${connection.service.slice(0, 12)}…`}
								</p>
								<p>
									{isChecking
										? 'Checking wallet…'
										: canPay === false
											? 'Invoice payments are not permitted'
											: balanceSats !== null
												? `${balanceSats.toLocaleString()} sats available`
												: `${connection.relays.length} relay${connection.relays.length === 1 ? '' : 's'}`}
								</p>
							</div>
						) : (
							<p className="mt-1 text-xs text-muted-foreground">
								Add an NIP-47 wallet to pay zap invoices without leaving Earthly.
							</p>
						)}
					</div>
					{isChecking ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
				</div>
				<div className="mt-3 flex gap-2">
					<Button
						type="button"
						size="sm"
						variant={connection ? 'outline' : 'secondary'}
						onClick={() => setDialogOpen(true)}
					>
						{connection ? <QrCode className="h-4 w-4" /> : <ScanLine className="h-4 w-4" />}
						{connection ? 'Replace' : 'Add NWC wallet'}
					</Button>
					{connection ? (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={() => {
								remove()
								toast.success('NWC wallet removed')
							}}
						>
							<Unplug className="h-4 w-4" />
							Remove
						</Button>
					) : null}
				</div>
			</div>

			<Dialog
				open={dialogOpen}
				onOpenChange={(open) => {
					setDialogOpen(open)
					if (!open) resetDialog()
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Add an NWC wallet</DialogTitle>
						<DialogDescription>
							Scan or paste the connection QR from your wallet. Its secret stays in this browser
							profile.
						</DialogDescription>
					</DialogHeader>
					{showScanner ? (
						<div className="space-y-3">
							<div className="aspect-square overflow-hidden rounded-lg border">
								<Scanner
									onScan={handleScan}
									onError={(scannerError) => {
										console.error('NWC scanner error', scannerError)
										setError('Camera access failed. Paste the connection instead.')
									}}
									constraints={{ facingMode: 'environment' }}
								/>
							</div>
							<Button type="button" variant="outline" onClick={() => setShowScanner(false)}>
								Cancel scan
							</Button>
						</div>
					) : (
						<div className="space-y-3">
							<textarea
								aria-label="NWC connection"
								value={connectionUri}
								onChange={(event) => setConnectionUri(event.target.value)}
								placeholder="nostr+walletconnect://…"
								className="min-h-28 w-full resize-y rounded-md border bg-background p-3 font-mono text-xs"
							/>
							{error ? <p className="text-sm text-destructive">{error}</p> : null}
							<div className="flex flex-wrap justify-between gap-2">
								<Button type="button" variant="outline" onClick={() => setShowScanner(true)}>
									<ScanLine className="h-4 w-4" />
									Scan QR code
								</Button>
								<Button type="button" onClick={handleSave} disabled={!connectionUri.trim()}>
									<Check className="h-4 w-4" />
									Save wallet
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>
		</>
	)
}
