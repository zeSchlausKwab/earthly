import { NostrConnectAccount } from 'applesauce-accounts/accounts'
import { NostrConnectSigner, PrivateKeySigner } from 'applesauce-signers'
import { Scanner } from '@yudiel/react-qr-scanner'
import { ExternalLink, Loader2, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { allowRelays, loginWithAccount } from '@/lib/nostr'
import { openExternalProtocol } from '@/platform/externalProtocol'

interface Nip46LoginDialogProps {
	trigger: React.ReactNode
	/** Called after the account is successfully added and made active. */
	onSuccess?: () => void
}

type TabType = 'scan' | 'paste'

const DEFAULT_RELAYS = [
	{ value: 'wss://relay.earthly.city', label: 'relay.earthly.city' },
	{ value: 'wss://relay.nsec.app', label: 'relay.nsec.app' },
	{ value: 'wss://relay.damus.io', label: 'relay.damus.io' },
	{ value: 'wss://nos.lol', label: 'nos.lol' },
	{ value: 'wss://relay.primal.net', label: 'relay.primal.net' },
]

const APP_METADATA = {
	name: 'Earthly City',
	url: typeof window !== 'undefined' ? window.location.origin : 'https://earthly.city',
	permissions: NostrConnectSigner.buildSigningPermissions([0, 1, 3, 10002]),
}

type ConnectionState = 'idle' | 'generating' | 'waiting' | 'connected' | 'error'

export function Nip46LoginDialog({ trigger, onSuccess }: Nip46LoginDialogProps) {
	const [open, setOpen] = useState(false)
	const [activeTab, setActiveTab] = useState<TabType>('scan')

	const [state, setState] = useState<ConnectionState>('idle')
	const [error, setError] = useState<string | null>(null)
	const [selectedRelay, setSelectedRelay] = useState(
		DEFAULT_RELAYS[0]?.value ?? 'wss://relay.earthly.city',
	)

	// Scan tab state — the URI we display + the signer we're awaiting on
	const [connectionUri, setConnectionUri] = useState('')
	const signerRef = useRef<NostrConnectSigner | null>(null)
	const abortRef = useRef<AbortController | null>(null)

	// Paste tab state
	const [bunkerUrl, setBunkerUrl] = useState('')
	const [showScanner, setShowScanner] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)
	const [rememberMe, setRememberMe] = useState(true)
	const rememberMeRef = useRef(rememberMe)
	const onSuccessRef = useRef(onSuccess)
	rememberMeRef.current = rememberMe
	onSuccessRef.current = onSuccess

	const cleanup = useCallback(() => {
		abortRef.current?.abort()
		abortRef.current = null
		signerRef.current?.close().catch(() => {})
		signerRef.current = null
	}, [])

	const handleOpenChange = useCallback(
		(isOpen: boolean) => {
			setOpen(isOpen)
			if (!isOpen) {
				cleanup()
				setState('idle')
				setError(null)
				setConnectionUri('')
				setBunkerUrl('')
				setShowScanner(false)
				setScanError(null)
				setRememberMe(true)
			}
		},
		[cleanup],
	)

	const handleRelayChange = (relay: string) => {
		setSelectedRelay(relay)
		if (activeTab === 'scan' && connectionUri) {
			cleanup()
			setConnectionUri('')
			setState('idle')
			setError(null)
		}
	}

	// Drives the scan tab: spin up a NostrConnectSigner, show its URI,
	// wait for the remote to ping back, then create an account.
	useEffect(() => {
		if (!open || activeTab !== 'scan') return

		let cancelled = false
		let handedOff = false
		let ownedSigner: NostrConnectSigner | null = null
		let ownedAbort: AbortController | null = null
		const run = async () => {
			setState('generating')
			setError(null)

			try {
				// NIP-46 relays are signer transport, not content — vouch for them
				// with the dev pool guard so bunker login works under relay isolation.
				allowRelays([selectedRelay])
				const localSigner = new PrivateKeySigner()
				const ncSigner = new NostrConnectSigner({
					relays: [selectedRelay],
					signer: localSigner,
				})
				ownedSigner = ncSigner
				signerRef.current = ncSigner

				const uri = ncSigner.getNostrConnectURI(APP_METADATA)
				if (cancelled) return
				setConnectionUri(uri)
				setState('waiting')

				const abort = new AbortController()
				ownedAbort = abort
				abortRef.current = abort

				await ncSigner.waitForSigner(abort.signal)
				if (cancelled) return

				const pubkey = await ncSigner.getPublicKey()
				const account = new NostrConnectAccount(pubkey, ncSigner)
				await loginWithAccount(account, { remember: rememberMeRef.current })
				// The account now owns the live signer. Closing the dialog must not
				// close the connection it just adopted.
				handedOff = true
				if (signerRef.current === ncSigner) signerRef.current = null
				if (abortRef.current === abort) abortRef.current = null

				setState('connected')
				onSuccessRef.current?.()
				handleOpenChange(false)
			} catch (err) {
				if (cancelled) return
				console.error('NIP-46 connect failed', err)
				setState('error')
				setError(err instanceof Error ? err.message : 'Connection failed')
			}
		}

		run()
		return () => {
			cancelled = true
			if (!handedOff) {
				ownedAbort?.abort()
				void ownedSigner?.close().catch(() => {})
				if (signerRef.current === ownedSigner) signerRef.current = null
				if (abortRef.current === ownedAbort) abortRef.current = null
			}
		}
		// rememberMe intentionally omitted — flipping it after the fact shouldn't
		// re-trigger the connection, just affect the next add
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [open, activeTab, selectedRelay, handleOpenChange])

	const handlePasteLogin = async () => {
		if (!bunkerUrl.trim()) {
			setError('Please enter a bunker URL')
			return
		}

		setState('generating')
		setError(null)

		try {
			// Vouch for the bunker's relays with the dev pool guard (signer
			// transport, not content).
			try {
				const parsed = new URL(bunkerUrl)
				allowRelays(parsed.searchParams.getAll('relay'))
			} catch {
				// Malformed URL — fromBunkerURI below will produce the user-facing error.
			}
			const ncSigner = await NostrConnectSigner.fromBunkerURI(bunkerUrl, {
				permissions: APP_METADATA.permissions,
			})
			const pubkey = await ncSigner.getPublicKey()
			const account = new NostrConnectAccount(pubkey, ncSigner)
			await loginWithAccount(account, { remember: rememberMe })

			setState('connected')
			onSuccess?.()
			setOpen(false)
		} catch (err) {
			console.error('Bunker connect failed', err)
			setState('error')
			setError(err instanceof Error ? err.message : 'Failed to connect with bunker URL')
		}
	}

	const handleScanQR = () => {
		setShowScanner(true)
		setScanError(null)
	}

	const handleScan = useCallback((detectedCodes: { rawValue?: string }[]) => {
		if (!detectedCodes?.length) return
		const result = detectedCodes[0]?.rawValue
		if (result?.startsWith('bunker://')) {
			setBunkerUrl(result)
			setError(null)
			setShowScanner(false)
		} else if (result) {
			setScanError('The scanned code is not a valid bunker:// URI')
		}
	}, [])

	const handleScanError = useCallback((err: unknown) => {
		console.error(err)
		setScanError(`Error accessing camera: ${err instanceof Error ? err.message : 'Unknown error'}`)
	}, [])

	const handleOpenSigner = async () => {
		if (!connectionUri) return
		try {
			await openExternalProtocol(connectionUri)
		} catch (err) {
			console.error('Unable to open remote signer', err)
			toast.error('No compatible signer app could open this request')
		}
	}

	useEffect(() => () => cleanup(), [cleanup])

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect with Remote Signer</DialogTitle>
					<DialogDescription>Use a remote signer app like Amber or nsec.app</DialogDescription>
				</DialogHeader>

				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="relay">NIP-46 Relay</Label>
						<Select value={selectedRelay} onValueChange={handleRelayChange}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{DEFAULT_RELAYS.map((relay) => (
									<SelectItem key={relay.value} value={relay.value}>
										{relay.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							Choose the relay for the NIP-46 connection. Your remote signer should use the same
							relay.
						</p>
					</div>

					<div className="flex gap-2 border-b border-brutal">
						<Button
							variant="ghost"
							onClick={() => setActiveTab('scan')}
							className={`px-4 py-2 text-sm font-medium transition-colors ${
								activeTab === 'scan'
									? 'border-b-2 border-info/40 text-info'
									: 'text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground'
							}`}
						>
							Scan QR Code
						</Button>
						<Button
							variant="ghost"
							onClick={() => setActiveTab('paste')}
							className={`px-4 py-2 text-sm font-medium transition-colors ${
								activeTab === 'paste'
									? 'border-b-2 border-info/40 text-info'
									: 'text-muted-foreground dark:text-muted-foreground hover:text-foreground dark:hover:text-foreground'
							}`}
						>
							Paste Bunker URL
						</Button>
					</div>

					{activeTab === 'scan' ? (
						<div className="space-y-4">
							{state === 'connected' ? (
								<div className="flex flex-col items-center gap-2 py-8">
									<div className="text-ok mb-2">
										<svg
											xmlns="http://www.w3.org/2000/svg"
											width="36"
											height="36"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										>
											<title>Connected</title>
											<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
											<polyline points="22 4 12 14.01 9 11.01" />
										</svg>
									</div>
									<p className="text-sm text-ok font-medium">Connected successfully!</p>
									<p className="text-sm text-muted-foreground">Logging you in...</p>
								</div>
							) : state === 'generating' ? (
								<div className="flex flex-col items-center gap-2 py-8">
									<Loader2 className="h-8 w-8 animate-spin" />
									<p className="text-sm text-muted-foreground">Generating connection...</p>
								</div>
							) : connectionUri ? (
								<>
									<div className="text-sm text-muted-foreground dark:text-muted-foreground">
										Scan this QR code with your remote signer app (e.g., Amber)
									</div>

									<button
										type="button"
										onClick={() => void handleOpenSigner()}
										className="mx-auto flex max-w-full flex-col items-center gap-2 rounded-lg bg-card p-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										aria-label="Open connection request in a remote signer app"
									>
										<QRCodeSVG
											value={connectionUri}
											size={250}
											bgColor="#ffffff"
											fgColor="#000000"
											level="L"
											className="h-auto max-w-full"
										/>
										<span className="flex items-center gap-1 text-xs font-medium text-foreground">
											<ExternalLink className="h-3.5 w-3.5" /> Open signer app
										</span>
									</button>

									{state === 'waiting' && (
										<div className="flex items-center justify-center gap-2">
											<Loader2 className="h-4 w-4 animate-spin" />
											<span className="text-sm">Waiting for approval...</span>
										</div>
									)}

									<div className="space-y-2">
										<Input
											value={connectionUri}
											readOnly
											onClick={(e) => e.currentTarget.select()}
											className="font-mono text-xs"
										/>
									</div>
								</>
							) : (
								<div className="flex flex-col items-center gap-2 py-8">
									<Loader2 className="h-8 w-8 animate-spin" />
									<p className="text-sm text-muted-foreground">Initializing connection...</p>
								</div>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="bunker-url">Bunker URL</Label>
								<p className="text-xs text-muted-foreground dark:text-muted-foreground mb-2">
									Paste your bunker:// connection string from your remote signer (e.g., nsec.app,
									Amber).
								</p>
								<div className="flex gap-2">
									<Input
										id="bunker-url"
										type="text"
										placeholder="bunker://..."
										value={bunkerUrl}
										onChange={(e) => {
											setBunkerUrl(e.target.value)
											setError(null)
										}}
										disabled={state === 'generating'}
										className="flex-1 font-mono text-sm"
									/>
									<Button
										type="button"
										variant="outline"
										size="icon"
										onClick={handleScanQR}
										disabled={state === 'generating'}
										title="Scan QR code"
									>
										<QrCode className="h-4 w-4" />
									</Button>
								</div>
							</div>

							<Button
								onClick={handlePasteLogin}
								disabled={state === 'generating' || !bunkerUrl.trim()}
								className="w-full"
							>
								{state === 'generating' ? (
									<>
										<Loader2 className="h-4 w-4 animate-spin mr-2" />
										Connecting...
									</>
								) : (
									'Connect'
								)}
							</Button>

							<div className="p-3 bg-muted dark:bg-muted-foreground rounded-lg">
								<h4 className="text-sm font-medium mb-2">How to get a bunker URL:</h4>
								<ol className="text-sm text-muted-foreground dark:text-muted-foreground space-y-1 list-decimal list-inside">
									<li>Open your remote signer app (nsec.app, Amber, etc.)</li>
									<li>Generate or copy your bunker connection string</li>
									<li>Paste it into the field above or scan the QR code</li>
								</ol>
							</div>
						</div>
					)}

					<div className="flex items-center gap-2 pt-2">
						<Checkbox
							id="nip46-remember-me"
							checked={rememberMe}
							onCheckedChange={(checked) => setRememberMe(checked === true)}
						/>
						<label htmlFor="nip46-remember-me" className="text-sm cursor-pointer select-none">
							Stay logged in
						</label>
					</div>

					{error && (
						<div className="text-sm text-destructive p-3 bg-destructive/10 rounded-md border border-destructive/40">
							{error}
						</div>
					)}
				</div>
			</DialogContent>

			<Dialog open={showScanner} onOpenChange={setShowScanner}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Scan Bunker QR Code</DialogTitle>
						<DialogDescription>
							Scan a bunker:// connection QR code from your remote signer
						</DialogDescription>
					</DialogHeader>

					<div className="mt-4 mb-4">
						{scanError ? (
							<div className="p-4 mb-4 text-sm text-destructive bg-destructive/10 rounded-lg">
								{scanError}
								<Button
									onClick={() => setScanError(null)}
									variant="outline"
									size="sm"
									className="ml-2 mt-2"
								>
									Try Again
								</Button>
							</div>
						) : (
							<div className="relative w-full aspect-square overflow-hidden rounded-lg">
								<Scanner
									onScan={handleScan}
									onError={handleScanError}
									constraints={{
										facingMode: 'environment',
									}}
								/>
							</div>
						)}
					</div>

					<div className="flex justify-end gap-2">
						<Button variant="outline" onClick={() => setShowScanner(false)}>
							Cancel
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</Dialog>
	)
}
