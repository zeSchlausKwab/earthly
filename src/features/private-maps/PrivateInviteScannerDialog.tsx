import { Scanner } from '@yudiel/react-qr-scanner'
import { Camera, ScanLine } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { parsePrivateInviteLink, type ParsedPrivateInviteLink } from './privateInviteLink'

export function PrivateInviteScannerDialog({
	open,
	onOpenChange,
	onInvite,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	onInvite: (invite: ParsedPrivateInviteLink) => void
}) {
	const [error, setError] = useState<string | null>(null)
	const acceptingResultRef = useRef(false)

	useEffect(() => {
		if (open) return
		setError(null)
		acceptingResultRef.current = false
	}, [open])

	const handleScan = useCallback(
		(detectedCodes: { rawValue?: string }[]) => {
			if (acceptingResultRef.current) return
			const value = detectedCodes[0]?.rawValue
			if (!value) return
			try {
				const invite = parsePrivateInviteLink(value)
				acceptingResultRef.current = true
				onInvite(invite)
			} catch (scanError) {
				setError(scanError instanceof Error ? scanError.message : 'Could not read this invitation')
			}
		},
		[onInvite],
	)

	const handleCameraError = useCallback((cameraError: unknown) => {
		console.error('Unable to scan private-group invitation', cameraError)
		setError(
			cameraError instanceof Error
				? `Camera unavailable: ${cameraError.message}`
				: 'Camera unavailable. Check Earthly’s camera permission and try again.',
		)
	}, [])

	const retry = () => {
		acceptingResultRef.current = false
		setError(null)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[calc(100vw-1.5rem)] rounded-[2px] sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<ScanLine className="h-4 w-4 text-primary" />
						Scan private-group invite
					</DialogTitle>
					<DialogDescription>
						Point this phone at the invitation QR shown on another device.
					</DialogDescription>
				</DialogHeader>

				{error ? (
					<div className="space-y-3 border border-destructive/35 bg-destructive/5 p-3">
						<div className="flex items-start gap-2 text-xs leading-relaxed text-destructive">
							<Camera className="mt-0.5 h-4 w-4 shrink-0" />
							<p>{error}</p>
						</div>
						<Button variant="outline" size="sm" className="w-full" onClick={retry}>
							Try again
						</Button>
					</div>
				) : (
					<div className="relative aspect-square overflow-hidden border border-border bg-black">
						<Scanner
							onScan={handleScan}
							onError={handleCameraError}
							constraints={{ facingMode: 'environment' }}
						/>
						<div className="pointer-events-none absolute inset-[12%] border border-primary/80">
							<span className="absolute top-1/2 right-0 left-0 h-px bg-primary/80 shadow-[0_0_8px_var(--primary)]" />
						</div>
					</div>
				)}

				<Button variant="outline" onClick={() => onOpenChange(false)}>
					Cancel
				</Button>
			</DialogContent>
		</Dialog>
	)
}
