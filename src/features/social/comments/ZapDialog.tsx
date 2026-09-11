import {
	AlertTriangle,
	Check,
	Copy,
	ExternalLink,
	Loader2,
	WalletCards,
	Zap,
} from 'lucide-react'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import { ZapRequestFactory } from 'applesauce-common/factories'
import { getInvoice, parseLNURLOrAddress } from 'applesauce-common/helpers'
import { getNutzapInfoMints, NUTZAP_INFO_KIND } from 'applesauce-wallet/helpers/nutzap-info'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
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
import { accounts, eventStore } from '@/lib/nostr'
import { useTimeline } from '@/lib/nostr/hooks'
import type { ReactableEvent } from '../hooks/useGeoReactions'
import { normalizeLightningUri, openExternalProtocol } from '@/platform/externalProtocol'
import { payInvoiceWithNwc } from '@/lib/wallet/nwc'
import { sendNutzap, useWallet } from '@/lib/wallet'
import { useNwcConnection } from '@/features/wallet/hooks/useNwcConnection'
import { zapReceiptDeliveryRelays, zapReceiptWatchRelays } from '../zap/receiptRelays'

const COMMON_ZAP_AMOUNTS = [10, 21, 100, 210, 500, 1000] as const
const ZAP_RECEIPT_CLOSE_DELAY_MS = 1_800

function buildTargetAddress(target: ReactableEvent | null): string | null {
	if (!target?.kind || !target.pubkey) return null
	const raw = rawNostrEvent(target)
	const dTag = (target as { dTag?: string }).dTag ?? raw.tags.find((tag) => tag[0] === 'd')?.[1]
	return dTag ? `${target.kind}:${target.pubkey}:${dTag}` : null
}

function buildZapFilters(target: ReactableEvent | null) {
	const targetAddress = buildTargetAddress(target)
	if (targetAddress) {
		return [
			{
				kinds: [9735 as number],
				'#a': [targetAddress],
			},
		]
	}

	if (target?.id) {
		return [
			{
				kinds: [9735 as number],
				'#e': [target.id],
			},
		]
	}

	return []
}

/** Get the underlying raw NostrEvent regardless of whether we got a Cast/wrapper. */
function rawNostrEvent(target: ReactableEvent): NostrEvent {
	if ('event' in target && (target as { event?: NostrEvent }).event) {
		return (target as { event: NostrEvent }).event
	}
	const rawEvent = (target as { rawEvent?: () => NostrEvent }).rawEvent
	if (typeof rawEvent === 'function') return rawEvent()
	return target as NostrEvent
}

/** LNURL pay-endpoint payload (NIP-57 §3). */
interface NostrLnurlSpec {
	callback: string
	minSendable?: number
	maxSendable?: number
	allowsNostr?: boolean
	nostrPubkey?: string
}

/** Extract a Lightning address (lud16) or LNURLp (lud06) from a kind 0 event. */
function getLightningEndpointFromProfile(profileEvent: NostrEvent | undefined): URL | undefined {
	const candidate = getLightningIdentifierFromProfile(profileEvent)
	return candidate ? parseLNURLOrAddress(candidate) : undefined
}

function getLightningIdentifierFromProfile(
	profileEvent: NostrEvent | undefined,
): string | undefined {
	if (!profileEvent) return undefined
	let parsed: { lud16?: string; lud06?: string }
	try {
		parsed = JSON.parse(profileEvent.content) as typeof parsed
	} catch {
		return undefined
	}
	return parsed.lud16 ?? parsed.lud06
}

interface ZapDialogProps {
	target: ReactableEvent
	open: boolean
	onClose: () => void
}

export function ZapDialog({ target, open, onClose }: ZapDialogProps) {
	const currentUser = useActiveAccount()
	const [selectedAmount, setSelectedAmount] = useState<number | 'custom' | null>(null)
	const [customAmount, setCustomAmount] = useState('')
	const [invoice, setInvoice] = useState('')
	const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null)
	const [isGenerating, setIsGenerating] = useState(false)
	const [generationError, setGenerationError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const [zapReceived, setZapReceived] = useState(false)
	const [nutzapSent, setNutzapSent] = useState(false)
	const [isSendingNutzap, setIsSendingNutzap] = useState(false)
	const [isPayingWithNwc, setIsPayingWithNwc] = useState(false)
	const [nwcPaymentSent, setNwcPaymentSent] = useState(false)
	const receiptEventIdRef = useRef<string | null>(null)
	const zapRequestIdRef = useRef<string | null>(null)
	const receiptPubkeyRef = useRef<string | null>(null)
	const { connection: nwcConnection } = useNwcConnection()
	const walletState = useWallet()
	const receiptDeliveryRelays = useMemo(zapReceiptDeliveryRelays, [])
	const receiptWatchRelays = useMemo(zapReceiptWatchRelays, [])

	const zapFilters = useMemo(() => {
		const filters = buildZapFilters(target)
		return filters.length ? filters : null
	}, [target])
	const zapReceiptEvents = useTimeline(open ? zapFilters : null, receiptWatchRelays)

	// Read recipient's profile (kind 0) to extract their Lightning endpoint.
	const recipientProfileEvent = use$(
		() => (target?.pubkey ? eventStore.replaceable(0, target.pubkey) : undefined),
		[target?.pubkey],
	)
	const recipientLightningIdentifier = useMemo(
		() => getLightningIdentifierFromProfile(recipientProfileEvent),
		[recipientProfileEvent],
	)
	const isNwcSelfPayment = Boolean(
		nwcConnection?.lud16 &&
			recipientLightningIdentifier?.includes('@') &&
			nwcConnection.lud16.toLowerCase() === recipientLightningIdentifier.toLowerCase(),
	)
	const recipientNutzapEvents = useTimeline(
		open && target?.pubkey
			? { kinds: [NUTZAP_INFO_KIND], authors: [target.pubkey], limit: 1 }
			: null,
	)
	const recipientNutzapInfo = recipientNutzapEvents[0]

	const resetDialogState = useCallback(() => {
		setSelectedAmount(null)
		setCustomAmount('')
		setInvoice('')
		setInvoiceAmount(null)
		setIsGenerating(false)
		setGenerationError(null)
		setCopied(false)
		setZapReceived(false)
		setNutzapSent(false)
		setIsSendingNutzap(false)
		setIsPayingWithNwc(false)
		setNwcPaymentSent(false)
		receiptEventIdRef.current = null
		zapRequestIdRef.current = null
		receiptPubkeyRef.current = null
	}, [])

	const handleClose = useCallback(() => {
		resetDialogState()
		onClose()
	}, [onClose, resetDialogState])

	useEffect(() => {
		if (!open) {
			resetDialogState()
		}
	}, [open, resetDialogState])

	useEffect(() => {
		if (!open || !invoice) return

		const matchingReceipt = zapReceiptEvents.find((event) => {
			if (event.tags.find((tag) => tag[0] === 'bolt11')?.[1] !== invoice) return false
			if (receiptPubkeyRef.current && event.pubkey !== receiptPubkeyRef.current) return false
			const description = event.tags.find((tag) => tag[0] === 'description')?.[1]
			if (!description || !zapRequestIdRef.current) return false
			try {
				return (JSON.parse(description) as NostrEvent).id === zapRequestIdRef.current
			} catch {
				return false
			}
		})
		if (!matchingReceipt) return

		const receiptId = matchingReceipt.id ?? invoice
		if (receiptEventIdRef.current === receiptId) return
		receiptEventIdRef.current = receiptId
		setZapReceived(true)
		toast.success('Zap received')
	}, [invoice, open, zapReceiptEvents])

	useEffect(() => {
		if (!open || !zapReceived) return
		const closeTimer = window.setTimeout(handleClose, ZAP_RECEIPT_CLOSE_DELAY_MS)
		return () => window.clearTimeout(closeTimer)
	}, [handleClose, open, zapReceived])

	const generateInvoice = useCallback(
		async (amountSats: number) => {
			const signer = accounts.signer
			if (!signer) {
				toast.error('Sign in to send zaps')
				return
			}
			if (!Number.isFinite(amountSats) || amountSats <= 0) {
				setGenerationError('Enter a valid zap amount in sats.')
				return
			}

			setIsGenerating(true)
			setGenerationError(null)
			setCopied(false)
			setZapReceived(false)
			setNwcPaymentSent(false)
			receiptEventIdRef.current = null

			try {
				const senderPubkey = currentUser?.pubkey
				if (!senderPubkey) throw new Error('No active signer.')

				const lnurlEndpoint = getLightningEndpointFromProfile(recipientProfileEvent)
				if (!lnurlEndpoint) {
					throw new Error('This recipient does not expose a Lightning zap endpoint.')
				}

				// Step 1: Fetch the LNURL-pay metadata.
				const spec: NostrLnurlSpec = await fetch(lnurlEndpoint).then((r) => r.json())
				if (!spec.callback) {
					throw new Error('Recipient LNURL endpoint did not return a callback.')
				}
				if (!spec.allowsNostr) {
					throw new Error('Recipient endpoint does not support Nostr zaps.')
				}

				const amountMsats = amountSats * 1000
				if (spec.minSendable && amountMsats < spec.minSendable) {
					throw new Error(`Minimum zap is ${Math.ceil(spec.minSendable / 1000)} sats.`)
				}
				if (spec.maxSendable && amountMsats > spec.maxSendable) {
					throw new Error(`Maximum zap is ${Math.floor(spec.maxSendable / 1000)} sats.`)
				}

				// Step 2: Build the zap request (kind 9734). ZapRequestFactory wires up
				// the e/a/k/p/relays/amount tags for us; we only need to choose relays.
				// The relays tag tells the recipient's LNURL server where to publish the
				// zap receipt — route it where we read content (local relay in dev).
				const targetEvent = rawNostrEvent(target)
				const zapRequest = await ZapRequestFactory.event(
					targetEvent,
					amountMsats,
					receiptDeliveryRelays,
				).sign(signer)

				// Step 3: Call the LNURL callback with the zap request and amount.
				const callbackUrl = new URL(spec.callback)
				callbackUrl.searchParams.set('amount', String(amountMsats))
				callbackUrl.searchParams.set('nostr', JSON.stringify(zapRequest))

				const pr = await getInvoice(callbackUrl)
				if (!pr) throw new Error('Unable to fetch a Lightning invoice.')

				zapRequestIdRef.current = zapRequest.id
				receiptPubkeyRef.current = spec.nostrPubkey ?? null
				setInvoice(pr)
				setInvoiceAmount(amountSats)
			} catch (error) {
				console.error('Failed to generate zap invoice:', error)
				const message = error instanceof Error ? error.message : 'Failed to generate zap invoice.'
				setGenerationError(message)
				toast.error(message)
			} finally {
				setIsGenerating(false)
			}
		},
		[currentUser?.pubkey, receiptDeliveryRelays, recipientProfileEvent, target],
	)

	const handleCopyInvoice = useCallback(async () => {
		if (!invoice) return
		try {
			await navigator.clipboard.writeText(invoice)
			setCopied(true)
			toast.success('Invoice copied')
			window.setTimeout(() => setCopied(false), 2000)
		} catch (error) {
			console.error('Failed to copy zap invoice:', error)
			toast.error('Failed to copy invoice')
		}
	}, [invoice])

	const handleOpenWallet = useCallback(async () => {
		if (!invoice) return
		try {
			await openExternalProtocol(normalizeLightningUri(invoice))
		} catch (error) {
			console.error('Unable to open Lightning wallet', error)
			toast.error('No compatible Lightning wallet could open this invoice')
		}
	}, [invoice])

	const customAmountValue = Number.parseInt(customAmount, 10)
	const chosenAmount =
		typeof selectedAmount === 'number'
			? selectedAmount
			: selectedAmount === 'custom' && Number.isFinite(customAmountValue) && customAmountValue > 0
				? customAmountValue
				: null
	const eligibleNutzapMint = useMemo(() => {
		if (!recipientNutzapInfo || !chosenAmount || !walletState.ready) return null
		const recipientMints = new Set(
			getNutzapInfoMints(recipientNutzapInfo)
				.filter(({ units }) => !units?.length || units.includes('sat'))
				.map(({ mint }) => mint),
		)
		return (
			walletState.mints.find(
				(mint) => recipientMints.has(mint) && (walletState.balance?.[mint] ?? 0) >= chosenAmount,
			) ?? null
		)
	}, [chosenAmount, recipientNutzapInfo, walletState.balance, walletState.mints, walletState.ready])

	const handleSendNutzap = useCallback(async () => {
		if (!chosenAmount || !eligibleNutzapMint) return
		setIsSendingNutzap(true)
		setGenerationError(null)
		try {
			await sendNutzap(rawNostrEvent(target), chosenAmount, { mint: eligibleNutzapMint })
			setInvoiceAmount(chosenAmount)
			setNutzapSent(true)
			toast.success('Nutzap sent')
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to send nutzap.'
			setGenerationError(message)
			toast.error(message)
		} finally {
			setIsSendingNutzap(false)
		}
	}, [chosenAmount, eligibleNutzapMint, target])

	const handlePayWithNwc = useCallback(async () => {
		if (!invoice || !nwcConnection) return
		setIsPayingWithNwc(true)
		setGenerationError(null)
		try {
			await payInvoiceWithNwc(nwcConnection, invoice)
			setNwcPaymentSent(true)
			toast.success('Payment sent from NWC wallet')
		} catch (error) {
			const message = error instanceof Error ? error.message : 'NWC payment failed.'
			setGenerationError(message)
			toast.error(message)
		} finally {
			setIsPayingWithNwc(false)
		}
	}, [invoice, nwcConnection])

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="h-5 w-5 text-primary fill-current" />
						Send a zap
					</DialogTitle>
					<DialogDescription>
						Choose an amount and send it with an available wallet or a Lightning invoice.
					</DialogDescription>
				</DialogHeader>

				{nutzapSent ? (
					<div className="space-y-4 py-4 text-center">
						<div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-ok/15">
							<Check className="h-6 w-6 text-ok" />
						</div>
						<div>
							<p className="font-semibold text-ok">Nutzap sent</p>
							<p className="mt-1 text-sm text-muted-foreground">
								{invoiceAmount?.toLocaleString() ?? '—'} sats were sent from your Cashu wallet.
							</p>
						</div>
						<Button type="button" onClick={handleClose}>
							Done
						</Button>
					</div>
				) : invoice ? (
					<div className="space-y-4">
						<div className="flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
							<span>Zap amount</span>
							<span className="font-semibold">{invoiceAmount?.toLocaleString() ?? '—'} sats</span>
						</div>
						{recipientLightningIdentifier ? (
							<div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm">
								<span className="text-muted-foreground">Recipient</span>
								<span className="truncate font-medium">{recipientLightningIdentifier}</span>
							</div>
						) : null}
						{isNwcSelfPayment ? (
							<div className="flex gap-2 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
								<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
								<p>
									This invoice belongs to your connected NWC wallet. A self-payment may only show
									its routing fee; use another wallet to test an incoming zap.
								</p>
							</div>
						) : null}
						<div className="flex justify-center">
							<button
								type="button"
								onClick={() => void handleOpenWallet()}
								className="flex flex-col items-center gap-2 rounded-lg border bg-card p-4 transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="Open zap invoice in a Lightning wallet"
							>
								<QRCodeSVG value={normalizeLightningUri(invoice)} size={208} />
								<span className="flex items-center gap-1 text-xs font-medium text-foreground">
									<ExternalLink className="h-3.5 w-3.5" /> Open Lightning wallet
								</span>
							</button>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium text-foreground">Lightning invoice</p>
							<div className="flex gap-2">
								<Input value={invoice} readOnly disabled className="font-mono text-xs" />
								<Button
									type="button"
									variant="outline"
									size="icon"
									onClick={handleCopyInvoice}
									aria-label="Copy invoice"
								>
									{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
								</Button>
							</div>
						</div>
						{nwcConnection ? (
							<Button
								type="button"
								className="w-full"
								onClick={() => void handlePayWithNwc()}
								disabled={isPayingWithNwc || nwcPaymentSent || zapReceived}
							>
								{isPayingWithNwc ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : nwcPaymentSent || zapReceived ? (
									<Check className="h-4 w-4" />
								) : (
									<WalletCards className="h-4 w-4" />
								)}
								{zapReceived
									? 'Zap confirmed'
									: nwcPaymentSent
										? 'Payment sent'
										: 'Pay with NWC wallet'}
							</Button>
						) : null}
						{generationError ? <p className="text-sm text-destructive">{generationError}</p> : null}
						<div
							className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
								zapReceived
									? 'border-ok/40 bg-ok/10 text-ok'
									: 'border-border bg-muted text-muted-foreground'
							}`}
						>
							{zapReceived ? (
								<Check className="h-4 w-4" />
							) : (
								<Loader2 className="h-4 w-4 animate-spin" />
							)}
							{zapReceived
								? 'Zap received'
								: nwcPaymentSent
									? 'Payment sent — waiting for zap receipt...'
									: 'Waiting for zap receipt...'}
						</div>
						<div className="flex justify-between gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setInvoice('')
									setInvoiceAmount(null)
									setGenerationError(null)
								}}
							>
								Change amount
							</Button>
							<Button type="button" variant="ghost" onClick={handleClose}>
								Close
							</Button>
						</div>
					</div>
				) : (
					<div className="space-y-4">
						<div className="grid grid-cols-3 gap-2">
							{COMMON_ZAP_AMOUNTS.map((amount) => (
								<Button
									key={amount}
									type="button"
									variant={selectedAmount === amount ? 'default' : 'outline'}
									onClick={() => {
										setSelectedAmount(amount)
										setGenerationError(null)
									}}
									disabled={isGenerating || isSendingNutzap}
									className="justify-center"
								>
									{amount}
								</Button>
							))}
							<Button
								type="button"
								variant={selectedAmount === 'custom' ? 'default' : 'outline'}
								onClick={() => {
									setSelectedAmount('custom')
									setGenerationError(null)
								}}
								disabled={isGenerating}
								className="justify-center"
							>
								Custom
							</Button>
						</div>

						{selectedAmount === 'custom' ? (
							<div className="space-y-2 rounded-lg border border-border p-3">
								<label className="text-sm font-medium text-foreground" htmlFor="custom-zap-amount">
									Custom amount
								</label>
								<Input
									id="custom-zap-amount"
									type="number"
									min={1}
									step={1}
									value={customAmount}
									onChange={(event) => setCustomAmount(event.target.value)}
									placeholder="Amount in sats"
								/>
							</div>
						) : null}

						{chosenAmount ? (
							<div className="space-y-2 rounded-lg border border-border p-3">
								<p className="text-sm font-medium">Payment method</p>
								{eligibleNutzapMint ? (
									<Button
										type="button"
										className="w-full"
										onClick={() => void handleSendNutzap()}
										disabled={isSendingNutzap || isGenerating}
									>
										{isSendingNutzap ? (
											<Loader2 className="h-4 w-4 animate-spin" />
										) : (
											<Zap className="h-4 w-4" />
										)}
										Send nutzap from Cashu wallet
									</Button>
								) : null}
								<Button
									type="button"
									variant={eligibleNutzapMint ? 'outline' : 'default'}
									className="w-full"
									onClick={() => void generateInvoice(chosenAmount)}
									disabled={isGenerating || isSendingNutzap}
								>
									{isGenerating ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<ExternalLink className="h-4 w-4" />
									)}
									Generate Lightning invoice
								</Button>
							</div>
						) : null}

						{generationError ? <p className="text-sm text-destructive">{generationError}</p> : null}

						<div className="flex justify-end">
							<Button
								type="button"
								variant="ghost"
								onClick={handleClose}
								disabled={isGenerating || isSendingNutzap}
							>
								Cancel
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
