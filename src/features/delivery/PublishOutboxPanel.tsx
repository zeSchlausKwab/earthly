import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
	AlertTriangle,
	CheckCircle2,
	CircleDashed,
	CloudUpload,
	RefreshCw,
	RotateCcw,
	Trash2,
	Wifi,
	WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { ListPanel } from '@/components/entity-list/ListPanel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { isTauri } from '@/config/platform'
import { flushPublishOutbox } from '@/lib/nostr'
import type { OutboxItemSummary } from '@/platform/contracts'
import {
	getPublishOutboxService,
	notifyPublishOutboxChanged,
	PUBLISH_OUTBOX_CHANGED_EVENT,
} from '@/platform/registry'
import { cn } from '@/lib/utils'
import {
	canDiscardOutboxItem,
	canRetryOutboxItem,
	outboxKindLabel,
	partitionOutbox,
	relayAcknowledgementCount,
	summarizeOutbox,
} from './outboxPresentation'

type LedgerTab = 'pending' | 'history'

const statePresentation: Record<OutboxItemSummary['state'], { label: string; className: string }> =
	{
		queued: { label: 'Queued', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700' },
		delivering: { label: 'Sending', className: 'border-sky-500/40 bg-sky-500/10 text-sky-700' },
		delivered: {
			label: 'Delivered',
			className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
		},
		partial: { label: 'Partial', className: 'border-amber-500/40 bg-amber-500/10 text-amber-700' },
		retryWait: {
			label: 'Waiting',
			className: 'border-orange-500/40 bg-orange-500/10 text-orange-700',
		},
		rejected: {
			label: 'Rejected',
			className: 'border-destructive/40 bg-destructive/10 text-destructive',
		},
		discarded: { label: 'Discarded', className: 'border-border bg-muted text-muted-foreground' },
	}

function relativeTime(seconds: number): string {
	try {
		return formatDistanceToNow(new Date(seconds * 1000), { addSuffix: true })
	} catch {
		return 'unknown time'
	}
}

function relayHost(url: string): string {
	try {
		return new URL(url).host
	} catch {
		return url
	}
}

function actionError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

export function PublishOutboxPanel() {
	const native = isTauri()
	const [items, setItems] = useState<OutboxItemSummary[]>([])
	const [tab, setTab] = useState<LedgerTab>('pending')
	const [loading, setLoading] = useState(native)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [busyAction, setBusyAction] = useState<string | null>(null)
	const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)

	const refresh = useCallback(
		async (quiet = false) => {
			if (!native) {
				setLoading(false)
				return
			}
			if (!quiet) setLoading(true)
			try {
				const service = await getPublishOutboxService()
				if (!service) throw new Error('The native delivery queue is unavailable')
				setItems(await service.listSummaries())
				setLoadError(null)
			} catch (error) {
				setLoadError(actionError(error))
			} finally {
				setLoading(false)
			}
		},
		[native],
	)

	useEffect(() => {
		void refresh()
		const handleChanged = () => void refresh(true)
		const handleOnline = () => {
			setOnline(true)
			void refresh(true)
		}
		const handleOffline = () => setOnline(false)
		const handleVisibility = () => {
			if (document.visibilityState === 'visible') void refresh(true)
		}
		window.addEventListener(PUBLISH_OUTBOX_CHANGED_EVENT, handleChanged)
		window.addEventListener('online', handleOnline)
		window.addEventListener('offline', handleOffline)
		document.addEventListener('visibilitychange', handleVisibility)
		return () => {
			window.removeEventListener(PUBLISH_OUTBOX_CHANGED_EVENT, handleChanged)
			window.removeEventListener('online', handleOnline)
			window.removeEventListener('offline', handleOffline)
			document.removeEventListener('visibilitychange', handleVisibility)
		}
	}, [refresh])

	const summary = useMemo(() => summarizeOutbox(items), [items])
	const partitions = useMemo(() => partitionOutbox(items), [items])
	const visibleItems = partitions[tab]
	const pendingCount = partitions.pending.length

	const handleSendNow = async () => {
		setBusyAction('flush')
		try {
			const service = await getPublishOutboxService()
			if (!service) throw new Error('The native delivery queue is unavailable')
			for (const item of partitions.pending) {
				if (canRetryOutboxItem(item)) await service.retry(item.id)
			}
			notifyPublishOutboxChanged()
			await flushPublishOutbox()
			await refresh(true)
			toast.info('Delivery attempt finished')
		} catch (error) {
			toast.error(actionError(error))
		} finally {
			setBusyAction(null)
		}
	}

	const handleRetry = async (item: OutboxItemSummary) => {
		setBusyAction(`retry:${item.id}`)
		try {
			const service = await getPublishOutboxService()
			if (!service) throw new Error('The native delivery queue is unavailable')
			await service.retry(item.id)
			notifyPublishOutboxChanged()
			await flushPublishOutbox()
			await refresh(true)
			toast.info(`${outboxKindLabel(item.eventKind)} delivery retried`)
		} catch (error) {
			toast.error(actionError(error))
		} finally {
			setBusyAction(null)
		}
	}

	const handleDiscard = async (item: OutboxItemSummary) => {
		if (
			!window.confirm(
				`Discard this queued ${outboxKindLabel(item.eventKind).toLowerCase()}? It will no longer be delivered.`,
			)
		)
			return
		setBusyAction(`discard:${item.id}`)
		try {
			const service = await getPublishOutboxService()
			if (!service) throw new Error('The native delivery queue is unavailable')
			await service.discard(item.id)
			notifyPublishOutboxChanged()
			await refresh(true)
			toast.success('Queued event discarded')
		} catch (error) {
			toast.error(actionError(error))
		} finally {
			setBusyAction(null)
		}
	}

	return (
		<ListPanel
			icon={CloudUpload}
			title="Sync & delivery"
			accent="text-emerald-600"
			count={native ? pendingCount : undefined}
			footerLeft={native ? `${items.length} ledger records` : 'WEB'}
			footerRight={native ? (online ? 'NETWORK AVAILABLE' : 'OFFLINE') : 'IMMEDIATE PUBLISH'}
			headerExtra={
				native ? (
					<div className="space-y-2">
						<div className="grid grid-cols-3 divide-x divide-border border border-border bg-muted/20">
							<LedgerMetric label="Waiting" value={summary.waiting} />
							<LedgerMetric label="Attention" value={summary.attention} attention />
							<LedgerMetric label="Delivered" value={summary.delivered} />
						</div>
						<div className="flex items-center gap-2">
							<div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
								{online ? (
									<Wifi className="h-3 w-3 text-emerald-600" />
								) : (
									<WifiOff className="h-3 w-3 text-amber-600" />
								)}
								<span className="truncate">
									{online ? 'Network available' : 'Offline — new work is safely queued'}
								</span>
							</div>
							<Button
								type="button"
								size="sm"
								className="ml-auto"
								onClick={() => void handleSendNow()}
								disabled={pendingCount === 0 || busyAction !== null}
							>
								<RefreshCw className={cn('h-3 w-3', busyAction === 'flush' && 'animate-spin')} />
								Send now
							</Button>
						</div>
						<Tabs value={tab} onValueChange={(value) => setTab(value as LedgerTab)}>
							<TabsList
								variant="line"
								className="h-7 w-full justify-start border-b border-border p-0"
							>
								<TabsTrigger value="pending" className="flex-none px-3">
									Pending {pendingCount}
								</TabsTrigger>
								<TabsTrigger value="history" className="flex-none px-3">
									History {partitions.history.length}
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
				) : undefined
			}
		>
			{!native ? (
				<Alert className="rounded-none border-dashed p-3">
					<CloudUpload className="h-4 w-4" />
					<AlertTitle>Available in the Earthly Android app</AlertTitle>
					<AlertDescription>
						The web app publishes directly. Android stores signed changes first, then delivers them
						when a connection is available.
					</AlertDescription>
				</Alert>
			) : loadError ? (
				<Alert variant="destructive" className="rounded-none p-3">
					<AlertTriangle className="h-4 w-4" />
					<AlertTitle>Delivery ledger unavailable</AlertTitle>
					<AlertDescription>{loadError}</AlertDescription>
				</Alert>
			) : loading ? (
				<div className="flex items-center justify-center gap-2 py-10 text-xs text-muted-foreground">
					<RefreshCw className="h-3.5 w-3.5 animate-spin" /> Loading delivery ledger…
				</div>
			) : visibleItems.length === 0 ? (
				<div className="flex flex-col items-center border border-dashed border-border px-4 py-10 text-center">
					<CheckCircle2 className="mb-2 h-6 w-6 text-emerald-600" />
					<p className="text-xs font-medium text-foreground">
						{tab === 'pending' ? 'Everything is delivered' : 'No delivery history yet'}
					</p>
					<p className="mt-1 max-w-56 text-[10px] leading-relaxed text-muted-foreground">
						{tab === 'pending'
							? 'New signed changes will appear here whenever they need a relay.'
							: 'Successful native deliveries remain visible in this ledger.'}
					</p>
				</div>
			) : (
				<div className="space-y-2">
					{visibleItems.map((item) => (
						<OutboxLedgerRow
							key={item.id}
							item={item}
							busyAction={busyAction}
							onRetry={handleRetry}
							onDiscard={handleDiscard}
						/>
					))}
				</div>
			)}
		</ListPanel>
	)
}

function LedgerMetric({
	label,
	value,
	attention = false,
}: {
	label: string
	value: number
	attention?: boolean
}) {
	return (
		<div className="px-2 py-1.5">
			<p className="font-mono text-[8px] uppercase tracking-wider text-muted-foreground">{label}</p>
			<p
				className={cn(
					'font-mono text-base font-semibold',
					attention && value > 0 && 'text-amber-600',
				)}
			>
				{value}
			</p>
		</div>
	)
}

function OutboxLedgerRow({
	item,
	busyAction,
	onRetry,
	onDiscard,
}: {
	item: OutboxItemSummary
	busyAction: string | null
	onRetry: (item: OutboxItemSummary) => Promise<void>
	onDiscard: (item: OutboxItemSummary) => Promise<void>
}) {
	const state = statePresentation[item.state]
	const acknowledged = relayAcknowledgementCount(item)
	const retrying = busyAction === `retry:${item.id}`
	const discarding = busyAction === `discard:${item.id}`

	return (
		<article className="border border-border bg-card">
			<div className="flex items-start gap-2 px-2.5 py-2">
				<div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-border bg-muted/40">
					{item.state === 'delivered' ? (
						<CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
					) : item.state === 'rejected' || item.state === 'partial' ? (
						<AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
					) : (
						<CircleDashed className="h-3.5 w-3.5 text-muted-foreground" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5">
						<p className="truncate text-xs font-semibold text-foreground">
							{outboxKindLabel(item.eventKind)}
						</p>
						<Badge
							variant="outline"
							className={cn(
								'ml-auto rounded-[2px] font-mono text-[8px] uppercase',
								state.className,
							)}
						>
							{state.label}
						</Badge>
					</div>
					<div className="mt-0.5 flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground">
						<span>
							{item.eventId.slice(0, 8)}…{item.eventId.slice(-4)}
						</span>
						<span>·</span>
						<span>{relativeTime(item.createdAt)}</span>
						{item.attemptCount > 0 ? <span>· try {item.attemptCount}</span> : null}
					</div>
					{item.lastError ? (
						<p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-destructive">
							{item.lastError}
						</p>
					) : null}
				</div>
			</div>

			<details className="group border-t border-border px-2.5 py-1.5">
				<summary className="cursor-pointer select-none font-mono text-[9px] text-muted-foreground hover:text-foreground">
					{acknowledged}/{item.relays.length} relay acknowledgements · {item.routing}
				</summary>
				<div className="mt-1.5 space-y-1 border-l border-border pl-2">
					{item.relays.map((relay) => (
						<div key={relay.relayUrl} className="flex items-start gap-1.5 text-[9px]">
							<span
								className={cn(
									'mt-1 h-1.5 w-1.5 shrink-0 rounded-full',
									relay.state === 'acknowledged'
										? 'bg-emerald-500'
										: relay.state === 'rejected'
											? 'bg-destructive'
											: 'bg-amber-500',
								)}
							/>
							<div className="min-w-0">
								<p className="truncate font-mono text-foreground">
									{relayHost(relay.relayUrl)} {relay.required ? '· required' : '· optional'}
								</p>
								{relay.lastError ? (
									<p className="line-clamp-2 text-muted-foreground">{relay.lastError}</p>
								) : null}
							</div>
						</div>
					))}
				</div>
			</details>

			{canRetryOutboxItem(item) || canDiscardOutboxItem(item) ? (
				<div className="flex justify-end gap-1 border-t border-border bg-muted/20 px-2 py-1.5">
					{canDiscardOutboxItem(item) ? (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							onClick={() => void onDiscard(item)}
							disabled={busyAction !== null}
						>
							<Trash2 className={cn('h-2.5 w-2.5', discarding && 'animate-pulse')} />
							Discard
						</Button>
					) : null}
					{canRetryOutboxItem(item) ? (
						<Button
							type="button"
							variant="outline"
							size="xs"
							onClick={() => void onRetry(item)}
							disabled={busyAction !== null}
						>
							<RotateCcw className={cn('h-2.5 w-2.5', retrying && 'animate-spin')} />
							Retry
						</Button>
					) : null}
				</div>
			) : null}
		</article>
	)
}
