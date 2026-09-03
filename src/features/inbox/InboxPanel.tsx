import { formatDistanceToNow } from 'date-fns'
import {
	AtSign,
	Check,
	Heart,
	Inbox as InboxIcon,
	Layers,
	MessageCircle,
	PenLine,
	UserPlus,
	X,
	Zap,
	type LucideIcon,
} from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PublishOutboxPanel } from '@/features/delivery'
import { cn } from '@/lib/utils'
import { filterInboxItems } from './deriveInbox'
import type { InboxFilter, InboxItemKind, InboxItemWithReadState } from './types'

type InboxTab = InboxFilter | 'outgoing'

const ITEM_ICONS: Record<InboxItemKind, LucideIcon> = {
	proposal: PenLine,
	reply: MessageCircle,
	mention: AtSign,
	'atlas-arrival': Layers,
	accepted: Check,
	declined: X,
	follow: UserPlus,
	reaction: Heart,
	zap: Zap,
}

const ITEM_TONES: Record<InboxItemKind, string> = {
	proposal: 'border-amber-500/35 bg-amber-500/10 text-amber-700',
	reply: 'border-sky-500/35 bg-sky-500/10 text-sky-700',
	mention: 'border-violet-500/35 bg-violet-500/10 text-violet-700',
	'atlas-arrival': 'border-primary/35 bg-primary/10 text-primary',
	accepted: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700',
	declined: 'border-border bg-muted text-muted-foreground',
	follow: 'border-indigo-500/35 bg-indigo-500/10 text-indigo-700',
	reaction: 'border-rose-500/35 bg-rose-500/10 text-rose-700',
	zap: 'border-amber-500/35 bg-amber-500/10 text-amber-700',
}

export interface InboxPanelProps {
	currentUserPubkey?: string
	items: readonly InboxItemWithReadState[]
	unreadCount: number
	isLoading?: boolean
	onMarkRead: (id: string) => void
	onMarkAllRead: () => void
	onOpenItem?: (item: InboxItemWithReadState) => void
}

function relativeTime(seconds: number): string {
	try {
		return formatDistanceToNow(new Date(seconds * 1_000), { addSuffix: true })
	} catch {
		return 'unknown time'
	}
}

function isoTime(seconds: number): string | undefined {
	try {
		return new Date(seconds * 1_000).toISOString()
	} catch {
		return undefined
	}
}

function InboxRow({
	item,
	onMarkRead,
	onOpenItem,
}: {
	item: InboxItemWithReadState
	onMarkRead: (id: string) => void
	onOpenItem?: (item: InboxItemWithReadState) => void
}) {
	const Icon = ITEM_ICONS[item.kind]
	const handleOpen = () => {
		onMarkRead(item.id)
		onOpenItem?.(item)
	}
	return (
		<button
			type="button"
			onClick={handleOpen}
			className={cn(
				'group relative flex w-full items-start gap-2.5 border border-border bg-background px-2.5 py-2.5 text-left transition-colors hover:border-foreground/25 hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
				item.read && 'bg-muted/15 text-muted-foreground',
			)}
		>
			{!item.read ? <span className="sr-only">Unread notification. </span> : null}
			<span
				className={cn(
					'mt-0.5 flex size-7 shrink-0 items-center justify-center border',
					ITEM_TONES[item.kind],
				)}
				aria-hidden="true"
			>
				<Icon className="size-3.5" />
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex min-w-0 items-center gap-2">
					<UserProfile
						pubkey={item.actorPubkey}
						mode="avatar-name"
						size="sm"
						interactive={false}
						className="min-w-0 flex-1"
					/>
					<time
						dateTime={isoTime(item.createdAt)}
						className="shrink-0 font-mono text-[9px] text-muted-foreground"
					>
						{relativeTime(item.createdAt)}
					</time>
				</div>
				<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
					{item.action} <strong className="font-medium text-foreground">{item.thingLabel}</strong>
				</p>
				{item.preview ? (
					<p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/85">
						“{item.preview}”
					</p>
				) : null}
			</div>
			{!item.read ? (
				<span className="mt-1 size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
			) : null}
		</button>
	)
}

function InboxLoadingRows() {
	return (
		<div className="space-y-2" role="status" aria-label="Loading Inbox" aria-live="polite">
			{[0, 1, 2, 3].map((row) => (
				<div
					key={row}
					className="flex animate-pulse items-start gap-2.5 border border-border p-2.5"
				>
					<div className="size-7 shrink-0 bg-muted" />
					<div className="min-w-0 flex-1 space-y-2">
						<div className="h-2.5 w-2/5 bg-muted" />
						<div className="h-2.5 w-4/5 bg-muted" />
					</div>
				</div>
			))}
		</div>
	)
}

export function InboxPanel({
	currentUserPubkey,
	items,
	unreadCount,
	isLoading = false,
	onMarkRead,
	onMarkAllRead,
	onOpenItem,
}: InboxPanelProps) {
	const headingId = useId()
	const [tab, setTab] = useState<InboxTab>('all')
	const visibleItems = useMemo(
		() => (tab === 'outgoing' ? [] : filterInboxItems(items, tab)),
		[items, tab],
	)
	const replyCount = useMemo(
		() => items.filter((item) => item.category === 'replies').length,
		[items],
	)
	const proposalCount = useMemo(
		() => items.filter((item) => item.category === 'proposals').length,
		[items],
	)

	return (
		<section className="flex h-full min-h-0 flex-col" aria-labelledby={headingId}>
			<div className="shrink-0 border-b border-border pb-2">
				<div className="flex min-h-7 items-center gap-2">
					<InboxIcon className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
					<h2 id={headingId} className="text-[13px] font-semibold text-foreground">
						Inbox
					</h2>
					{unreadCount > 0 ? (
						<span className="font-mono text-[10px] text-primary">
							<span className="sr-only">{unreadCount} unread</span>
							<span aria-hidden="true">{unreadCount}</span>
						</span>
					) : null}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onMarkAllRead}
						disabled={unreadCount === 0}
						className="ml-auto h-6 px-2 text-[10px]"
					>
						Mark all read
					</Button>
				</div>
				<Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)}>
					<TabsList
						variant="line"
						className="mt-2 h-7 w-full justify-start overflow-x-auto border-b border-border p-0"
					>
						<TabsTrigger value="all" className="flex-none px-2.5">
							All {items.length}
						</TabsTrigger>
						<TabsTrigger value="replies" className="flex-none px-2.5">
							Replies {replyCount}
						</TabsTrigger>
						<TabsTrigger value="proposals" className="flex-none px-2.5">
							Proposals {proposalCount}
						</TabsTrigger>
						<TabsTrigger value="outgoing" className="flex-none px-2.5">
							Outgoing
						</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{tab === 'outgoing' ? (
				<div className="min-h-0 flex-1 pt-2">
					<PublishOutboxPanel />
				</div>
			) : (
				<>
					<div className="min-h-0 flex-1 overflow-y-auto py-2 pr-1 [scrollbar-gutter:stable]">
						{!currentUserPubkey ? (
							<div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-border px-5 text-center">
								<InboxIcon className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
								<p className="text-xs font-medium text-foreground">
									Sign in to receive your Inbox.
								</p>
								<p className="mt-1 max-w-60 text-[10px] leading-relaxed text-muted-foreground">
									Replies, proposals, Atlas arrivals, and social activity will collect here.
								</p>
							</div>
						) : isLoading && items.length === 0 ? (
							<InboxLoadingRows />
						) : visibleItems.length === 0 ? (
							<div className="flex min-h-44 flex-col items-center justify-center border border-dashed border-border px-5 text-center">
								<InboxIcon className="mb-2 size-6 text-muted-foreground" aria-hidden="true" />
								<p className="text-xs font-medium text-foreground">
									{tab === 'all'
										? 'Nothing here yet, and that is the point.'
										: tab === 'replies'
											? 'No replies yet.'
											: 'No proposal activity yet.'}
								</p>
								<p className="mt-1 max-w-60 text-[10px] leading-relaxed text-muted-foreground">
									New activity appears here from the same events that power Earthly.
								</p>
							</div>
						) : (
							<div className="space-y-2">
								{visibleItems.map((item) => (
									<InboxRow
										key={item.id}
										item={item}
										onMarkRead={onMarkRead}
										onOpenItem={onOpenItem}
									/>
								))}
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center border-t border-border pt-1.5 font-mono text-[9.5px] text-muted-foreground">
						<span>{items.length} notifications</span>
						<span className="ml-auto">{unreadCount} unread</span>
					</div>
				</>
			)}
		</section>
	)
}
