import { Check, Copy, Heart, Loader2, MessageCircle, PencilLine, Share2, Zap } from 'lucide-react'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import { ZapRequestFactory } from 'applesauce-common/factories'
import { getInvoice, parseLNURLOrAddress } from 'applesauce-common/helpers'
import type { NostrEvent } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
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
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { accounts, eventStore } from '@/lib/nostr'
import { useTimeline } from '@/lib/nostr/hooks'
import { useGeoReactions, type ReactableEvent } from '../hooks/useGeoReactions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GeoSocialActionsProps {
	/** Any Nostr event that can receive reactions */
	target: ReactableEvent
	onReplyClick?: () => void
	commentCount?: number
	showCommentButton?: boolean
	showAnnotateButton?: boolean
	onAnnotateClick?: () => void
	/** Whether to show the zap button (default: true for geo events) */
	showZapButton?: boolean
	showShareButton?: boolean
	className?: string
	compact?: boolean
	loadCounts?: boolean
}

function getEntitySharePath(kind: number): 'geoevent' | 'context' | 'story' | 'sighting' | null {
	switch (kind) {
		case GEO_EVENT_KIND:
			return 'geoevent'
		case MAP_CONTEXT_KIND:
			return 'context'
		case ARTICLE_KIND:
			return 'story'
		case TEMPORAL_SIGHTING_KIND:
			return 'sighting'
		default:
			return null
	}
}

const COMMON_ZAP_AMOUNTS = [10, 21, 100, 210, 500, 1000] as const

function buildTargetAddress(target: ReactableEvent | null): string | null {
	if (!target || !('dTag' in target) || !target.dTag || !target.kind || !target.pubkey) return null
	return `${target.kind}:${target.pubkey}:${target.dTag}`
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
	if (!profileEvent) return undefined
	let parsed: { lud16?: string; lud06?: string }
	try {
		parsed = JSON.parse(profileEvent.content) as typeof parsed
	} catch {
		return undefined
	}
	const candidate = parsed.lud16 ?? parsed.lud06
	if (!candidate) return undefined
	return parseLNURLOrAddress(candidate)
}

interface ZapDialogProps {
	target: ReactableEvent
	open: boolean
	onClose: () => void
}

function ZapDialog({ target, open, onClose }: ZapDialogProps) {
	const currentUser = useActiveAccount()
	const [selectedAmount, setSelectedAmount] = useState<number | 'custom' | null>(null)
	const [customAmount, setCustomAmount] = useState('')
	const [invoice, setInvoice] = useState('')
	const [invoiceAmount, setInvoiceAmount] = useState<number | null>(null)
	const [isGenerating, setIsGenerating] = useState(false)
	const [generationError, setGenerationError] = useState<string | null>(null)
	const [copied, setCopied] = useState(false)
	const receiptEventIdRef = useRef<string | null>(null)

	const zapFilters = useMemo(() => {
		const filters = buildZapFilters(target)
		return filters.length ? filters : null
	}, [target])
	const zapReceiptEvents = useTimeline(open ? zapFilters : null)

	// Read recipient's profile (kind 0) to extract their Lightning endpoint.
	const recipientProfileEvent = use$(
		() => (target?.pubkey ? eventStore.replaceable(0, target.pubkey) : undefined),
		[target?.pubkey],
	)

	const resetDialogState = useCallback(() => {
		setSelectedAmount(null)
		setCustomAmount('')
		setInvoice('')
		setInvoiceAmount(null)
		setIsGenerating(false)
		setGenerationError(null)
		setCopied(false)
		receiptEventIdRef.current = null
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

		const matchingReceipt = zapReceiptEvents.find(
			(event) => event.tags.find((t) => t[0] === 'bolt11')?.[1] === invoice,
		)
		if (!matchingReceipt) return

		const receiptId = matchingReceipt.id ?? invoice
		if (receiptEventIdRef.current === receiptId) return
		receiptEventIdRef.current = receiptId
		toast.success('Zap received')
		handleClose()
	}, [handleClose, invoice, open, zapReceiptEvents])

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
				const targetEvent = rawNostrEvent(target)
				const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.nostr.band']
				const zapRequest = await ZapRequestFactory.event(targetEvent, amountMsats, relays).sign(
					signer,
				)

				// Step 3: Call the LNURL callback with the zap request and amount.
				const callbackUrl = new URL(spec.callback)
				callbackUrl.searchParams.set('amount', String(amountMsats))
				callbackUrl.searchParams.set('nostr', encodeURIComponent(JSON.stringify(zapRequest)))

				const pr = await getInvoice(callbackUrl)
				if (!pr) throw new Error('Unable to fetch a Lightning invoice.')

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
		[currentUser?.pubkey, recipientProfileEvent, target],
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

	const customAmountValue = Number.parseInt(customAmount, 10)

	return (
		<Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Zap className="h-5 w-5 text-amber-500 fill-current" />
						Send a zap
					</DialogTitle>
					<DialogDescription>
						Choose an amount, generate a Lightning invoice, then scan the QR code or copy the
						invoice into your wallet.
					</DialogDescription>
				</DialogHeader>

				{invoice ? (
					<div className="space-y-4">
						<div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
							<span>Zap amount</span>
							<span className="font-semibold">{invoiceAmount?.toLocaleString() ?? '—'} sats</span>
						</div>
						<div className="flex justify-center">
							<div className="rounded-lg border bg-white p-4">
								<QRCodeSVG value={invoice} size={208} />
							</div>
						</div>
						<div className="space-y-2">
							<p className="text-sm font-medium text-slate-900">Lightning invoice</p>
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
						<div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
							<Loader2 className="h-4 w-4 animate-spin" />
							Waiting for zap receipt...
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
										void generateInvoice(amount)
									}}
									disabled={isGenerating}
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
							<div className="space-y-2 rounded-lg border border-slate-200 p-3">
								<label className="text-sm font-medium text-slate-900" htmlFor="custom-zap-amount">
									Custom amount
								</label>
								<div className="flex gap-2">
									<Input
										id="custom-zap-amount"
										type="number"
										min={1}
										step={1}
										value={customAmount}
										onChange={(event) => setCustomAmount(event.target.value)}
										placeholder="Amount in sats"
									/>
									<Button
										type="button"
										onClick={() => void generateInvoice(customAmountValue)}
										disabled={
											isGenerating || !Number.isFinite(customAmountValue) || customAmountValue <= 0
										}
									>
										Generate
									</Button>
								</div>
							</div>
						) : null}

						{generationError ? <p className="text-sm text-red-600">{generationError}</p> : null}

						<div className="flex justify-end">
							<Button type="button" variant="ghost" onClick={handleClose} disabled={isGenerating}>
								Cancel
							</Button>
						</div>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}

function buildSharePath(target: ReactableEvent): string | null {
	if (!target.kind) return null

	if (target.kind === GEO_COMMENT_KIND) {
		const commentTarget = target as {
			rootAddress?: string
			commentId?: string
			dTag?: string
		}
		const rootAddress = commentTarget.rootAddress
		const commentId = commentTarget.commentId ?? commentTarget.dTag
		if (!rootAddress || !commentId) return null

		const [kindValue, pubkey, ...identifierParts] = rootAddress.split(':')
		const rootKind = Number.parseInt(kindValue ?? '', 10)
		const identifier = identifierParts.join(':')
		if (!Number.isFinite(rootKind) || !pubkey || !identifier) return null

		const sharePath = getEntitySharePath(rootKind)
		if (!sharePath) return null

		const naddr = nip19.naddrEncode({
			kind: rootKind,
			pubkey,
			identifier,
		})
		return `/${sharePath}/${naddr}/comment/${encodeURIComponent(commentId)}`
	}

	const targetWithDTag = target as {
		dTag?: string
		datasetId?: string
		contextId?: string
		pubkey: string
	}
	const identifier = targetWithDTag.dTag ?? targetWithDTag.datasetId ?? targetWithDTag.contextId
	if (!identifier) return null

	const sharePath = getEntitySharePath(target.kind)
	if (!sharePath) return null

	const naddr = nip19.naddrEncode({
		kind: target.kind,
		pubkey: target.pubkey,
		identifier,
	})
	return `/${sharePath}/${naddr}`
}

/**
 * Social actions bar for any Nostr event: reactions, zaps, and comments.
 * Works with geo events (GeoDataset, etc.) and regular events (NDKEvent).
 */
export function GeoSocialActions({
	target,
	onReplyClick,
	commentCount = 0,
	showCommentButton = true,
	showAnnotateButton = false,
	onAnnotateClick,
	showZapButton = true,
	showShareButton = true,
	className = '',
	compact = false,
	loadCounts = true,
}: GeoSocialActionsProps) {
	const currentUser = useActiveAccount()
	const {
		reactionCount,
		zapCount,
		userHasReacted,
		userHasZapped,
		isLoading,
		toggleReaction,
		openZapDialog,
		zapDialogOpen,
		closeZapDialog,
	} = useGeoReactions({ target, loadCounts })
	const sharePath = useMemo(() => buildSharePath(target), [target])

	const formatCount = (count: number): string => {
		if (count === 0) return ''
		if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
		return count.toString()
	}

	const handleReaction = async () => {
		if (!currentUser) {
			toast.info('Please log in to react')
			return
		}
		try {
			await toggleReaction()
		} catch (error) {
			console.error('Failed to react:', error)
			toast.error('Failed to react')
		}
	}

	const handleZap = () => {
		if (!currentUser) {
			toast.info('Please log in to zap')
			return
		}
		openZapDialog()
	}

	const handleShare = async () => {
		if (!sharePath) {
			toast.error('No share route available for this item')
			return
		}

		const shareUrl = new URL(sharePath, window.location.origin)

		try {
			await navigator.clipboard.writeText(shareUrl.toString())
			toast.success('Share link copied')
		} catch (error) {
			console.error('Failed to copy share link:', error)
			toast.error('Failed to copy share link')
		}
	}

	const buttonSize = compact ? 'sm' : 'default'
	const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'

	return (
		<>
			<div className={`flex items-center gap-1 ${className}`}>
				{/* Heart/Reaction Button */}
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={handleReaction}
							disabled={isLoading}
							aria-label={userHasReacted ? 'Unlike' : 'Like'}
							className={`gap-1 ${
								userHasReacted
									? 'text-rose-500 hover:text-rose-600'
									: 'text-gray-500 hover:text-rose-500'
							} rounded-none px-2 text-xs`}
						>
							<Heart className={`${iconSize} ${userHasReacted ? 'fill-current' : ''}`} />
							{reactionCount > 0 && (
								<span className="text-xs font-medium">{formatCount(reactionCount)}</span>
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{userHasReacted ? 'You liked this' : currentUser ? 'Like' : 'Log in to like'}
					</TooltipContent>
				</Tooltip>

				{/* Lightning/Zap Button */}
				{showZapButton && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size={buttonSize}
								onClick={handleZap}
								disabled={isLoading || !currentUser}
								className={`gap-1 ${
									userHasZapped
										? 'text-amber-500 hover:text-amber-600'
										: 'text-gray-500 hover:text-amber-500'
								} rounded-none px-2 text-xs`}
							>
								<Zap className={`${iconSize} ${userHasZapped ? 'fill-current' : ''}`} />
								{zapCount > 0 && (
									<span className="text-xs font-medium">{formatCount(zapCount)}</span>
								)}
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							{userHasZapped ? 'You zapped this' : currentUser ? 'Zap' : 'Log in to zap'}
						</TooltipContent>
					</Tooltip>
				)}

				{showShareButton && sharePath && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size={buttonSize}
								onClick={handleShare}
								aria-label="Share"
								className="gap-1 rounded-none px-2 text-xs text-gray-500 hover:text-sky-600"
							>
								<Share2 className={iconSize} />
								{!compact ? <span className="text-xs font-medium">Share</span> : null}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Copy share link</TooltipContent>
					</Tooltip>
				)}

				{showAnnotateButton && onAnnotateClick && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size={buttonSize}
								onClick={onAnnotateClick}
								className="gap-1 rounded-none px-2 text-xs text-amber-600 hover:text-amber-700"
							>
								<PencilLine className={iconSize} />
								{!compact && <span className="text-xs font-medium">Annotate</span>}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Add comment annotation</TooltipContent>
					</Tooltip>
				)}

				{/* Comment/Reply Button */}
				{showCommentButton && onReplyClick && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size={buttonSize}
								onClick={onReplyClick}
								aria-label="Reply"
								className="gap-1 rounded-none px-2 text-xs text-gray-500 hover:text-emerald-500"
							>
								<MessageCircle className={iconSize} />
								{commentCount > 0 ? (
									<span className="text-xs font-medium">{formatCount(commentCount)}</span>
								) : !compact ? (
									<span className="text-xs font-medium">Reply</span>
								) : null}
							</Button>
						</TooltipTrigger>
						<TooltipContent>Reply</TooltipContent>
					</Tooltip>
				)}
			</div>
			{showZapButton ? (
				<ZapDialog target={target} open={zapDialogOpen} onClose={closeZapDialog} />
			) : null}
		</>
	)
}
