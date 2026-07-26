import { PrivateKeyAccount } from 'applesauce-accounts/accounts'
import { EventFactory } from 'applesauce-core/factories'
import { bytesToHex } from 'applesauce-core/helpers/event'
import { PrivateKeySigner } from 'applesauce-signers'
import { Scanner } from '@yudiel/react-qr-scanner'
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	CheckCircle2,
	ChevronDown,
	Copy,
	Download,
	Key,
	QrCode,
	RefreshCw,
	Sparkles,
} from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { QRCodeCanvas } from 'qrcode.react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { loginWithAccount, publish } from '@/lib/nostr'

interface SignupDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	/** Optional callback fired after the account is added and made active. */
	onSuccess?: () => void
}

type WizardView =
	| 'choose'
	| 'beginner-keys'
	| 'beginner-profile'
	| 'beginner-done'
	| 'expert-create'
	| 'expert-import'

type ScannedCode = { rawValue?: string }

interface ProfileDraft {
	name: string
	about: string
	picture: string
}

export function SignupDialog({ open, onOpenChange, onSuccess }: SignupDialogProps) {
	const [view, setView] = useState<WizardView>('choose')
	const [signer, setSigner] = useState<PrivateKeySigner | null>(null)
	const [nsec, setNsec] = useState('')
	const [npub, setNpub] = useState('')
	const [nsecCopied, setNsecCopied] = useState(false)
	const [npubCopied, setNpubCopied] = useState(false)
	const [keySaved, setKeySaved] = useState(false)
	const [rememberMe, setRememberMe] = useState(true)
	const [loading, setLoading] = useState(false)
	const [profileDraft, setProfileDraft] = useState<ProfileDraft>({
		name: '',
		about: '',
		picture: '',
	})
	const [profileLoading, setProfileLoading] = useState(false)
	const [importKey, setImportKey] = useState('')
	const [importError, setImportError] = useState('')
	const [isImportWarningExpanded, setIsImportWarningExpanded] = useState(true)
	const [showScanner, setShowScanner] = useState(false)
	const [scanError, setScanError] = useState<string | null>(null)

	const qrContainerRef = useRef<HTMLDivElement>(null)

	const reset = useCallback(() => {
		setView('choose')
		setSigner(null)
		setNsec('')
		setNpub('')
		setNsecCopied(false)
		setNpubCopied(false)
		setKeySaved(false)
		setRememberMe(true)
		setLoading(false)
		setProfileDraft({ name: '', about: '', picture: '' })
		setProfileLoading(false)
		setImportKey('')
		setImportError('')
		setIsImportWarningExpanded(true)
		setShowScanner(false)
		setScanError(null)
	}, [])

	const generateNewKey = useCallback(async () => {
		const newSigner = new PrivateKeySigner()
		setSigner(newSigner)
		setNsecCopied(false)
		setNpubCopied(false)
		setKeySaved(false)
		setNsec(nip19.nsecEncode(newSigner.key))
		const pubkey = await newSigner.getPublicKey()
		setNpub(nip19.npubEncode(pubkey))
	}, [])

	useEffect(() => {
		if (!open) reset()
	}, [open, reset])

	useEffect(() => {
		if (open && (view === 'beginner-keys' || view === 'expert-create') && !signer) {
			void generateNewKey()
		}
	}, [open, view, signer, generateNewKey])

	const handleCopyNsec = async () => {
		await navigator.clipboard.writeText(nsec)
		setNsecCopied(true)
		setTimeout(() => setNsecCopied(false), 2000)
	}

	const handleCopyNpub = async () => {
		await navigator.clipboard.writeText(npub)
		setNpubCopied(true)
		setTimeout(() => setNpubCopied(false), 2000)
	}

	const handleDownloadBackup = () => {
		const canvas = qrContainerRef.current?.querySelector('canvas')
		const qrDataUrl = canvas ? canvas.toDataURL('image/png') : ''

		const printWindow = window.open('', '_blank', 'width=800,height=700')
		if (!printWindow) return

		printWindow.document.write(`<!DOCTYPE html>
<html><head>
  <title>Earthly – Nostr Identity Backup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 40px auto; padding: 32px; color: #111; }
    .header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; border-bottom: 2px solid #111; padding-bottom: 16px; }
    .app-name { font-size: 20px; font-weight: 700; }
    .date { font-size: 12px; color: #666; margin-top: 3px; }
    .warning { background: #fff8e1; border: 2px solid #f59e0b; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .warning-title { font-weight: 700; color: #92400e; margin-bottom: 6px; font-size: 14px; }
    .warning p { font-size: 13px; color: #78350f; line-height: 1.5; }
    .qr-section { text-align: center; margin: 24px 0; }
    .qr-section img { border: 6px solid white; box-shadow: 0 0 0 2px #d1d5db; border-radius: 4px; }
    .qr-caption { font-size: 12px; color: #6b7280; margin-top: 8px; }
    .key-section { background: #fef2f2; border: 2px solid #fca5a5; border-radius: 8px; padding: 16px; margin-bottom: 14px; }
    .key-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #dc2626; margin-bottom: 8px; }
    .key-value { font-family: 'Courier New', monospace; font-size: 11.5px; word-break: break-all; background: white; border: 1px solid #fca5a5; border-radius: 4px; padding: 10px; line-height: 1.7; }
    .pub-section { background: #f0fdf4; border: 2px solid #86efac; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .pub-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #16a34a; margin-bottom: 8px; }
    .footer { font-size: 11px; color: #9ca3af; text-align: center; border-top: 1px solid #e5e7eb; padding-top: 14px; }
    @media print { body { margin: 0; } }
  </style>
</head>
<body>
  <div class="header">
    <span style="font-size:26px">&#127758;</span>
    <div>
      <div class="app-name">Earthly · Nostr Identity Backup</div>
      <div class="date">Created ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    </div>
  </div>
  <div class="warning">
    <div class="warning-title">⚠️ Keep this document private</div>
    <p>Your private key gives full access to your account. Anyone who has it can post as you. Store this in a secure place — a safe, password manager, or encrypted drive. Do not photograph or share it.</p>
  </div>
  ${
		qrDataUrl
			? `
  <div class="qr-section">
    <img src="${qrDataUrl}" width="170" height="170" alt="QR code of private key" />
    <div class="qr-caption">Scan with a Nostr client to import your private key</div>
  </div>`
			: ''
	}
  <div class="key-section">
    <div class="key-label">🔒 Private Key (nsec) — Keep secret, never share</div>
    <div class="key-value">${nsec}</div>
  </div>
  <div class="pub-section">
    <div class="pub-label">📢 Public Key (npub) — Your address, safe to share</div>
    <div class="key-value">${npub}</div>
  </div>
  <div class="footer">earthly.city · Your keys never leave your device · Generated by Earthly</div>
  <script>setTimeout(() => window.print(), 400)</script>
</body></html>`)
		printWindow.document.close()
	}

	const parsePrivateKey = useCallback((input: string): string | null => {
		const trimmed = input.trim()
		if (trimmed.startsWith('nsec1')) {
			try {
				const { type, data } = nip19.decode(trimmed)
				if (type === 'nsec') {
					return Array.from(data as Uint8Array)
						.map((b) => b.toString(16).padStart(2, '0'))
						.join('')
				}
			} catch (_e) {
				return null
			}
		}
		if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
			return trimmed.toLowerCase()
		}
		return null
	}, [])

	const handleImportKeyChange = (value: string) => {
		setImportKey(value)
		setImportError('')
		if (value.trim()) {
			const parsed = parsePrivateKey(value)
			if (!parsed) {
				setImportError('Invalid key. Enter a valid nsec1... or 64-character hex private key.')
			}
		}
	}

	const handleScan = useCallback(
		(detectedCodes: ScannedCode[]) => {
			if (detectedCodes && detectedCodes.length > 0) {
				const result = detectedCodes[0]?.rawValue
				if (result) {
					const parsed = parsePrivateKey(result)
					if (parsed) {
						setImportKey(result)
						setImportError('')
						setShowScanner(false)
						setScanError(null)
					} else {
						setScanError('QR code does not contain a valid private key (nsec or hex format).')
					}
				}
			}
		},
		[parsePrivateKey],
	)

	const handleScanError = useCallback((err: unknown) => {
		console.error(err)
		const msg = err instanceof Error ? err.message : 'Unknown error'
		setScanError(`Camera error: ${msg}`)
	}, [])

	/** Logs the user in by registering their key as the active applesauce account. */
	const loginWithSigner = async (active: PrivateKeySigner) => {
		const account = PrivateKeyAccount.fromKey(bytesToHex(active.key))
		await loginWithAccount(account, { remember: rememberMe })
	}

	const handleBeginnerNext = async () => {
		if (!signer || !keySaved) return
		setLoading(true)
		try {
			await loginWithSigner(signer)
			setView('beginner-profile')
		} catch (error) {
			console.error('Login failed:', error)
		} finally {
			setLoading(false)
		}
	}

	const handlePublishProfile = async (skip = false) => {
		setProfileLoading(true)
		try {
			if (!skip && signer && (profileDraft.name || profileDraft.about || profileDraft.picture)) {
				const profileContent = JSON.stringify({
					name: profileDraft.name || undefined,
					display_name: profileDraft.name || undefined,
					about: profileDraft.about || undefined,
					picture: profileDraft.picture || undefined,
				})
				const event = await EventFactory.fromKind(0).content(profileContent).sign(signer)
				await publish(event, { routing: 'outbox' })
			}
			setView('beginner-done')
			onSuccess?.()
		} catch (error) {
			console.error('Profile publish failed:', error)
			// Advance even on failure — the account is already logged in.
			setView('beginner-done')
		} finally {
			setProfileLoading(false)
		}
	}

	const handleExpertConfirm = async () => {
		if (!signer) return
		setLoading(true)
		try {
			await loginWithSigner(signer)
			onSuccess?.()
			onOpenChange(false)
		} catch (error) {
			console.error('Login failed:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleImportConfirm = async () => {
		const privateKeyHex = parsePrivateKey(importKey)
		if (!privateKeyHex) {
			setImportError('Invalid key. Enter a valid nsec1... or 64-character hex private key.')
			return
		}
		setLoading(true)
		try {
			const account = PrivateKeyAccount.fromKey(privateKeyHex)
			await loginWithAccount(account, { remember: rememberMe })
			onSuccess?.()
			onOpenChange(false)
		} catch (error) {
			console.error('Import failed:', error)
		} finally {
			setLoading(false)
		}
	}

	const titles: Record<WizardView, { title: string; description: string }> = {
		choose: { title: 'Connect to Nostr', description: 'Choose how you want to get started.' },
		'beginner-keys': {
			title: 'Your Nostr Identity',
			description: 'Step 1 of 2 — Save your keys before continuing.',
		},
		'beginner-profile': {
			title: 'Set Up Your Profile',
			description: 'Step 2 of 2 — Optional, you can always change this later.',
		},
		'beginner-done': {
			title: "You're on Nostr!",
			description: 'Your identity is ready. Welcome to the decentralized web.',
		},
		'expert-create': {
			title: 'Generate New Key',
			description: 'A fresh Nostr identity has been created for you.',
		},
		'expert-import': {
			title: 'Import Existing Key',
			description: 'Enter your private key to access your existing account.',
		},
	}

	const { title, description } = titles[view]

	return (
		<>
			<Dialog open={open} onOpenChange={onOpenChange}>
				<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-5 sm:max-w-2xl sm:gap-6 sm:p-7">
					<DialogHeader className="gap-1.5 pr-8">
						<DialogTitle className="text-lg">{title}</DialogTitle>
						<DialogDescription className="text-sm">{description}</DialogDescription>
					</DialogHeader>

					{nsec && (
						<div ref={qrContainerRef} className="hidden" aria-hidden="true">
							<QRCodeCanvas value={nsec} size={200} />
						</div>
					)}

					{view === 'choose' && (
						<div className="space-y-5 py-1">
							<Button
								type="button"
								variant="outline"
								className="group h-auto w-full cursor-pointer items-center justify-start whitespace-normal rounded-xl border-2 border-primary bg-primary/5 p-5 text-left transition-colors hover:bg-primary/10 sm:p-6"
								onClick={() => setView('beginner-keys')}
							>
								<div className="flex min-w-0 w-full items-center gap-4">
									<div className="shrink-0 rounded-lg bg-primary p-2.5">
										<Sparkles className="h-5 w-5 text-primary-foreground" />
									</div>
									<div className="min-w-0 flex-1">
										<div className="text-base font-semibold">New to Nostr? Get your identity</div>
										<div className="mt-1 text-sm font-normal text-muted-foreground">
											Guided setup with key backup and profile
										</div>
									</div>
									<ArrowRight className="h-5 w-5 ml-auto text-primary shrink-0 group-hover:translate-x-0.5 transition-transform" />
								</div>
							</Button>

							<div className="relative">
								<div className="absolute inset-0 flex items-center">
									<span className="w-full border-t" />
								</div>
								<div className="relative flex justify-center text-xs uppercase">
									<span className="bg-popover px-3 text-center text-muted-foreground">
										or, if you know what you're doing
									</span>
								</div>
							</div>

							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Button
									type="button"
									variant="outline"
									className="h-auto min-w-0 w-full cursor-pointer flex-col items-start justify-start whitespace-normal rounded-xl p-5 text-left transition-colors hover:bg-muted/80"
									onClick={() => setView('expert-create')}
								>
									<Key className="mb-3 h-5 w-5 text-muted-foreground" />
									<div className="text-sm font-semibold">Generate new key</div>
									<div className="mt-1 text-xs font-normal text-muted-foreground">
										Create a fresh private key
									</div>
								</Button>
								<Button
									type="button"
									variant="outline"
									className="h-auto min-w-0 w-full cursor-pointer flex-col items-start justify-start whitespace-normal rounded-xl p-5 text-left transition-colors hover:bg-muted/80"
									onClick={() => setView('expert-import')}
								>
									<ArrowRight className="mb-3 h-5 w-5 text-muted-foreground" />
									<div className="text-sm font-semibold">Import existing key</div>
									<div className="mt-1 text-xs font-normal text-muted-foreground">
										Use your nsec or hex key
									</div>
								</Button>
							</div>
						</div>
					)}

					{view === 'beginner-keys' && (
						<div className="space-y-4 py-2">
							<div className="rounded-lg bg-muted/60 p-4 text-sm space-y-1">
								<p className="font-medium">What is Nostr?</p>
								<p className="text-muted-foreground">
									A decentralized protocol where your identity is two cryptographic keys — no
									company controls your account, and no one can delete you.
								</p>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label>🔒 Private Key (nsec)</Label>
									<Button
										variant="ghost"
										size="sm"
										onClick={generateNewKey}
										disabled={loading}
										className="h-6 gap-1 px-2 text-xs text-muted-foreground"
									>
										<RefreshCw className="h-3 w-3" />
										Regenerate
									</Button>
								</div>
								<div className="flex gap-2">
									<div className="flex-1 p-3 bg-destructive/10 border border-destructive/30 rounded-md font-mono text-xs break-all leading-relaxed select-all">
										{nsec}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopyNsec}
										className="flex-shrink-0 self-stretch"
									>
										{nsecCopied ? (
											<CheckCircle2 className="w-4 h-4 text-ok" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</Button>
								</div>
								<p className="text-xs text-destructive font-medium">
									⚠️ Like a password — never share this with anyone.
								</p>
							</div>

							<div className="space-y-2">
								<Label>📢 Public Key (npub)</Label>
								<div className="flex gap-2">
									<div className="flex-1 p-3 bg-muted rounded-md font-mono text-xs break-all leading-relaxed select-all">
										{npub}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopyNpub}
										className="flex-shrink-0 self-stretch"
									>
										{npubCopied ? (
											<CheckCircle2 className="w-4 h-4 text-ok" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</Button>
								</div>
								<p className="text-xs text-muted-foreground">
									Your address on Nostr — share this so others can find you.
								</p>
							</div>

							<Button
								variant="outline"
								className="w-full gap-2"
								onClick={handleDownloadBackup}
								disabled={!nsec}
							>
								<Download className="h-4 w-4" />
								Download backup card (printable PDF with QR code)
							</Button>

							<div className="flex items-start gap-3 p-3 rounded-lg border border-orange-200 bg-orange-50 dark:border-orange-900 dark:bg-orange-950/30">
								<Checkbox
									id="key-saved"
									checked={keySaved}
									onCheckedChange={(c) => setKeySaved(c === true)}
									className="mt-0.5"
								/>
								<label htmlFor="key-saved" className="text-sm cursor-pointer leading-relaxed">
									I have saved my private key in a safe place. I understand that losing it means
									permanently losing access to my account.
								</label>
							</div>

							<div className="flex items-center gap-2">
								<Checkbox
									id="remember-beginner"
									checked={rememberMe}
									onCheckedChange={(c) => setRememberMe(c === true)}
								/>
								<label
									htmlFor="remember-beginner"
									className="text-sm cursor-pointer text-muted-foreground"
								>
									Stay logged in on this device
								</label>
							</div>
						</div>
					)}

					{view === 'beginner-profile' && (
						<div className="space-y-4 py-2">
							<div className="space-y-2">
								<Label htmlFor="profile-name">Display name</Label>
								<Input
									id="profile-name"
									placeholder="e.g. Alice"
									value={profileDraft.name}
									onChange={(e) => setProfileDraft((d) => ({ ...d, name: e.target.value }))}
									autoFocus
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="profile-about">
									About{' '}
									<span className="text-muted-foreground font-normal text-xs">(optional)</span>
								</Label>
								<Textarea
									id="profile-about"
									placeholder="A short bio..."
									rows={3}
									value={profileDraft.about}
									onChange={(e) => setProfileDraft((d) => ({ ...d, about: e.target.value }))}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="profile-picture">
									Profile picture URL{' '}
									<span className="text-muted-foreground font-normal text-xs">(optional)</span>
								</Label>
								<div className="flex items-center gap-2">
									<Input
										id="profile-picture"
										placeholder="https://..."
										value={profileDraft.picture}
										onChange={(e) => setProfileDraft((d) => ({ ...d, picture: e.target.value }))}
									/>
									<BlossomUploaderButton
										currentUrl={profileDraft.picture}
										onUploaded={({ url }) =>
											setProfileDraft((draft) => ({ ...draft, picture: url }))
										}
										buttonLabel="Blossom"
									/>
								</div>
							</div>
							<p className="text-xs text-muted-foreground">
								You can always update your profile later in the settings.
							</p>
						</div>
					)}

					{view === 'beginner-done' && (
						<div className="py-8 flex flex-col items-center gap-4 text-center">
							<div className="p-4 rounded-full bg-ok/15">
								<CheckCircle2 className="h-10 w-10 text-ok" />
							</div>
							<div>
								<h3 className="text-lg font-semibold mb-1">Welcome to Nostr!</h3>
								<p className="text-muted-foreground text-sm max-w-xs">
									Your identity is set up. Start exploring and editing maps — you can update your
									profile any time in the settings.
								</p>
							</div>
						</div>
					)}

					{view === 'expert-create' && (
						<div className="space-y-5 py-2">
							<Alert variant="destructive">
								<AlertTriangle className="h-4 w-4" />
								<AlertTitle>Save your private key</AlertTitle>
								<AlertDescription>
									This is the only way to access your account. Losing it means losing access
									permanently. Store it in a password manager.
								</AlertDescription>
							</Alert>

							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label>Private Key (nsec)</Label>
									<Button
										variant="ghost"
										size="sm"
										onClick={generateNewKey}
										disabled={loading}
										className="h-6 gap-1 px-2 text-xs text-muted-foreground"
									>
										<RefreshCw className="h-3 w-3" />
										Generate new
									</Button>
								</div>
								<div className="flex gap-2">
									<div className="flex-1 p-3 bg-destructive/10 border border-destructive/30 rounded-md font-mono text-xs break-all leading-relaxed">
										{nsec}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopyNsec}
										className="flex-shrink-0 self-stretch"
									>
										{nsecCopied ? (
											<CheckCircle2 className="w-4 h-4 text-ok" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</Button>
								</div>
							</div>

							<div className="space-y-2">
								<Label>Public Key (npub)</Label>
								<div className="flex gap-2">
									<div className="flex-1 p-3 bg-muted rounded-md font-mono text-xs break-all leading-relaxed">
										{npub}
									</div>
									<Button
										variant="outline"
										size="icon"
										onClick={handleCopyNpub}
										className="flex-shrink-0 self-stretch"
									>
										{npubCopied ? (
											<CheckCircle2 className="w-4 h-4 text-ok" />
										) : (
											<Copy className="w-4 h-4" />
										)}
									</Button>
								</div>
							</div>

							<div className="flex items-center gap-2">
								<Checkbox
									id="remember-expert"
									checked={rememberMe}
									onCheckedChange={(c) => setRememberMe(c === true)}
								/>
								<label htmlFor="remember-expert" className="text-sm cursor-pointer">
									Stay logged in
								</label>
							</div>
						</div>
					)}

					{view === 'expert-import' && (
						<div className="space-y-4 py-2">
							<Collapsible
								open={isImportWarningExpanded}
								onOpenChange={setIsImportWarningExpanded}
								className="border-2 border-destructive rounded-lg p-4 bg-destructive/5"
							>
								<div className="flex items-start justify-between gap-4">
									<div className="flex items-start gap-3 flex-1">
										<AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
										<div className="space-y-1">
											<h3 className="font-semibold text-destructive">Security Warning</h3>
											<p className="text-sm text-muted-foreground">
												Only enter your private key on trusted devices. Anyone with your private key
												controls your account.
											</p>
										</div>
									</div>
									<CollapsibleTrigger asChild>
										<Button
											variant="ghost"
											size="sm"
											className="h-8 w-8 p-0 shrink-0 hover:bg-destructive/20"
										>
											<ChevronDown
												className={`h-4 w-4 transition-transform ${isImportWarningExpanded ? 'rotate-180' : ''}`}
											/>
											<span className="sr-only">Toggle input</span>
										</Button>
									</CollapsibleTrigger>
								</div>

								<CollapsibleContent className="mt-4">
									<div className="space-y-2">
										<Label htmlFor="import-key">Private Key (nsec or hex)</Label>
										<div className="flex gap-2">
											<Input
												id="import-key"
												type="password"
												placeholder="nsec1... or 64-char hex"
												value={importKey}
												onChange={(e) => handleImportKeyChange(e.target.value)}
												className={`flex-1 font-mono ${importError ? 'border-destructive' : ''}`}
												autoComplete="off"
											/>
											<Button
												type="button"
												variant="outline"
												size="icon"
												onClick={() => setShowScanner(true)}
												disabled={loading}
												className="flex-shrink-0"
											>
												<QrCode className="h-4 w-4" />
											</Button>
										</div>
										{importError && <p className="text-xs text-destructive">{importError}</p>}
										<p className="text-xs text-muted-foreground">
											Your key never leaves your device.
										</p>
									</div>
								</CollapsibleContent>
							</Collapsible>

							<div className="flex items-center gap-2">
								<Checkbox
									id="remember-import"
									checked={rememberMe}
									onCheckedChange={(c) => setRememberMe(c === true)}
								/>
								<label htmlFor="remember-import" className="text-sm cursor-pointer">
									Stay logged in
								</label>
							</div>
						</div>
					)}

					<DialogFooter className="gap-2 flex-wrap">
						{(view === 'beginner-keys' || view === 'expert-create' || view === 'expert-import') && (
							<Button
								variant="ghost"
								onClick={() => {
									setSigner(null)
									setView('choose')
								}}
								disabled={loading}
								className="mr-auto gap-1"
							>
								<ArrowLeft className="h-4 w-4" />
								Back
							</Button>
						)}

						{view === 'choose' && (
							<Button variant="outline" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
						)}

						{view === 'beginner-keys' && (
							<>
								<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
									Cancel
								</Button>
								<Button onClick={handleBeginnerNext} disabled={loading || !keySaved}>
									{loading ? 'Setting up...' : 'Next: Set up profile →'}
								</Button>
							</>
						)}

						{view === 'beginner-profile' && (
							<>
								<Button
									variant="ghost"
									onClick={() => handlePublishProfile(true)}
									disabled={profileLoading}
									className="mr-auto"
								>
									Skip for now
								</Button>
								<Button onClick={() => handlePublishProfile(false)} disabled={profileLoading}>
									{profileLoading ? 'Saving...' : 'Create my identity →'}
								</Button>
							</>
						)}

						{view === 'beginner-done' && (
							<Button className="w-full" onClick={() => onOpenChange(false)}>
								Start Exploring
							</Button>
						)}

						{view === 'expert-create' && (
							<>
								<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
									Cancel
								</Button>
								<Button onClick={handleExpertConfirm} disabled={loading || !signer}>
									{loading ? 'Creating account...' : "I've saved my key, Continue"}
								</Button>
							</>
						)}

						{view === 'expert-import' && (
							<>
								<Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
									Cancel
								</Button>
								<Button
									onClick={handleImportConfirm}
									disabled={loading || !importKey || !!importError}
								>
									{loading ? 'Logging in...' : 'Login'}
								</Button>
							</>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<Dialog open={showScanner} onOpenChange={setShowScanner}>
				<DialogContent className="sm:max-w-md">
					<DialogHeader>
						<DialogTitle>Scan Private Key QR Code</DialogTitle>
						<DialogDescription>
							Scan a QR code containing your private key (nsec or hex format)
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						{scanError ? (
							<div className="space-y-4">
								<Alert variant="destructive">
									<AlertTriangle className="h-4 w-4" />
									<AlertDescription>{scanError}</AlertDescription>
								</Alert>
								<Button variant="outline" onClick={() => setScanError(null)} className="w-full">
									Try Again
								</Button>
							</div>
						) : (
							<div className="relative w-full aspect-square overflow-hidden rounded-lg">
								<Scanner
									onScan={handleScan}
									onError={handleScanError}
									constraints={{ facingMode: 'environment' }}
								/>
							</div>
						)}
					</div>
					<div className="flex justify-end">
						<Button variant="outline" onClick={() => setShowScanner(false)}>
							Cancel
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	)
}
