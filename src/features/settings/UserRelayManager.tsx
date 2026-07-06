import { MailboxesFactory } from 'applesauce-core/factories'
import {
	getInboxes,
	getOutboxes,
	isSafeRelayURL,
	kinds,
	normalizeRelayUrl,
} from 'applesauce-core/helpers'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import type { GroupReqMessage, PublishResponse } from 'applesauce-relay'
import type { NostrEvent } from 'nostr-tools'
import {
	Activity,
	AlertTriangle,
	CheckCircle2,
	ExternalLink,
	Loader2,
	Plus,
	RefreshCw,
	Search,
	Server,
	Trash2,
	UploadCloud,
	XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Subscription } from 'rxjs'
import { toast } from 'sonner'
import { config } from '@/config'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { accounts, devRelayFlags$, eventStore, pool, publish, setDevRelayFlags } from '@/lib/nostr'

type RelayDraft = {
	url: string
	read: boolean
	write: boolean
}

type DiscoveryResult = {
	event: NostrEvent
	seenOn: string[]
}

type Mailboxes = {
	inboxes: string[]
	outboxes: string[]
}

type ConnectionRole = {
	label: string
	className: string
}

type EventMessage = Extract<GroupReqMessage, { type: 'EVENT' }>
type RelayDoneMessage = Extract<GroupReqMessage, { type: 'EOSE' | 'ERROR' | 'CLOSED' }>

const DEFAULT_DISCOVERY_RELAYS = [
	'wss://purplepag.es',
	'wss://relay.nostr.net',
	'wss://nos.lol',
	'wss://relay.damus.io',
	'wss://relay.primal.net',
	'wss://relay.earthly.city',
]

const EXAMPLE_RELAYS: Array<RelayDraft & { label: string }> = [
	{ label: 'Earthly', url: 'wss://relay.earthly.city', read: true, write: true },
	{ label: 'Nostr.net', url: 'wss://relay.nostr.net', read: true, write: true },
	{ label: 'nos.lol', url: 'wss://nos.lol', read: true, write: true },
	{ label: 'Damus', url: 'wss://relay.damus.io', read: true, write: true },
	{ label: 'Primal', url: 'wss://relay.primal.net', read: true, write: true },
	{ label: 'Profiles', url: 'wss://purplepag.es', read: true, write: false },
	{ label: 'Relay monitor', url: 'wss://relay.nostr.watch', read: true, write: false },
]

function isEventMessage(message: GroupReqMessage): message is EventMessage {
	return message.type === 'EVENT'
}

function isRelayDoneMessage(message: GroupReqMessage): message is RelayDoneMessage {
	return message.type === 'EOSE' || message.type === 'ERROR' || message.type === 'CLOSED'
}

function tryNormalizeRelayUrl(value: string): string | null {
	const trimmed = value.trim()
	if (!trimmed) return null

	try {
		const normalized = normalizeRelayUrl(trimmed).toString()
		return isSafeRelayURL(normalized) ? normalized : null
	} catch {
		return null
	}
}

function dedupeRelayUrls(values: Array<string | null | undefined>): string[] {
	const seen = new Set<string>()
	const urls: string[] = []

	for (const value of values) {
		if (!value) continue
		const normalized = tryNormalizeRelayUrl(value)
		if (!normalized || seen.has(normalized)) continue
		seen.add(normalized)
		urls.push(normalized)
	}

	return urls
}

function relayDraftFromEvent(event?: NostrEvent | null): RelayDraft[] {
	if (!event) return []

	const inboxes = new Set(getInboxes(event))
	const outboxes = new Set(getOutboxes(event))
	const ordered = dedupeRelayUrls(event.tags.filter((tag) => tag[0] === 'r').map((tag) => tag[1]))
	const fallback = dedupeRelayUrls([...inboxes, ...outboxes])
	const urls = dedupeRelayUrls([...ordered, ...fallback])

	return urls.map((url) => ({
		url,
		read: inboxes.has(url),
		write: outboxes.has(url),
	}))
}

function relayDraftFromMailboxes(mailboxes?: Mailboxes | null): RelayDraft[] {
	if (!mailboxes) return []

	const inboxes = new Set(dedupeRelayUrls(mailboxes.inboxes))
	const outboxes = new Set(dedupeRelayUrls(mailboxes.outboxes))
	const urls = dedupeRelayUrls([...inboxes, ...outboxes])

	return urls.map((url) => ({
		url,
		read: inboxes.has(url),
		write: outboxes.has(url),
	}))
}

function relayDraftSignature(draft: RelayDraft[]): string {
	return JSON.stringify(
		draft
			.filter((relay) => relay.read || relay.write)
			.map((relay) => ({ read: relay.read, url: relay.url, write: relay.write }))
			.sort((a, b) => a.url.localeCompare(b.url)),
	)
}

function relayHostname(url: string): string {
	try {
		return new URL(url).hostname
	} catch {
		return url
	}
}

function mergeRelayDrafts(base: RelayDraft[], additions: RelayDraft[]): RelayDraft[] {
	const map = new Map<string, RelayDraft>()
	for (const relay of base) {
		map.set(relay.url, { ...relay })
	}
	for (const relay of additions) {
		const existing = map.get(relay.url)
		if (existing) {
			existing.read = existing.read || relay.read
			existing.write = existing.write || relay.write
		} else {
			map.set(relay.url, { ...relay })
		}
	}
	return Array.from(map.values())
}

function parseRelayInputList(value: string): string[] {
	return dedupeRelayUrls(value.split(/[\s,]+/))
}

function isLoopbackRelay(url: string): boolean {
	try {
		const hostname = new URL(url).hostname
		return (
			hostname === 'localhost' ||
			hostname === '127.0.0.1' ||
			hostname === '0.0.0.0' ||
			hostname === '::1' ||
			hostname === '[::1]'
		)
	} catch {
		return false
	}
}

function getAccountSignerRelays(account: unknown): string[] {
	const signer = (account as { signer?: { relays?: unknown } } | null)?.signer
	return Array.isArray(signer?.relays) ? dedupeRelayUrls(signer.relays as string[]) : []
}

function formatEventDate(event?: NostrEvent | null): string {
	if (!event) return 'Never published'
	return new Date(event.created_at * 1000).toLocaleString()
}

async function discoverRelayLists({
	pubkey,
	relays,
	timeoutMs = 8000,
}: {
	pubkey: string
	relays: string[]
	timeoutMs?: number
}): Promise<DiscoveryResult[]> {
	if (relays.length === 0) return []

	return new Promise((resolve) => {
		const events = new Map<string, { event: NostrEvent; seenOn: Set<string> }>()
		const doneRelays = new Set<string>()
		let settled = false
		let subscription: Subscription | null = null
		let timeout: number | null = null

		const finish = () => {
			if (settled) return
			settled = true
			if (timeout !== null) window.clearTimeout(timeout)
			subscription?.unsubscribe()
			resolve(
				Array.from(events.values())
					.map(({ event, seenOn }) => ({ event, seenOn: Array.from(seenOn).sort() }))
					.sort((a, b) => b.event.created_at - a.event.created_at),
			)
		}

		timeout = window.setTimeout(finish, timeoutMs)
		subscription = pool
			.req(relays, { kinds: [kinds.RelayList], authors: [pubkey], limit: 1 })
			.subscribe({
				next(message) {
					if (isEventMessage(message)) {
						eventStore.add(message.event)
						const existing = events.get(message.event.id)
						if (existing) {
							existing.seenOn.add(message.from)
						} else {
							events.set(message.event.id, {
								event: message.event,
								seenOn: new Set([message.from]),
							})
						}
						return
					}

					if (!isRelayDoneMessage(message)) return
					doneRelays.add(message.from)
					if (doneRelays.size >= relays.length) finish()
				},
				error(error) {
					console.error('Relay list discovery failed:', error)
					finish()
				},
				complete: finish,
			})
	})
}

function RelayInfo({ url }: { url: string }) {
	const relay = useMemo(() => pool.relay(url), [url])
	const info = use$(() => relay.information$, [relay])
	const status = use$(() => relay.status$, [relay])

	return (
		<div className="min-w-0">
			<div className="flex min-w-0 items-center gap-2">
				<Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
				<span className="truncate font-mono text-xs text-foreground">{url}</span>
				{status?.connected ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" /> : null}
			</div>
			<div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span className="truncate">{info?.name || relayHostname(url)}</span>
				{Array.isArray(info?.supported_nips) && info.supported_nips.length > 0 ? (
					<span>NIPs {info.supported_nips.slice(0, 4).join(', ')}</span>
				) : null}
				<a
					href={url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:')}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
				>
					<ExternalLink className="h-3 w-3" />
					Open
				</a>
			</div>
		</div>
	)
}

function PublishResultList({ responses }: { responses: PublishResponse[] }) {
	if (responses.length === 0) return null

	return (
		<div className="space-y-1 border border-border bg-muted p-3">
			{responses.map((response) => (
				<div
					key={`${response.from}-${response.ok ? 'ok' : response.message}`}
					className="flex min-w-0 items-center gap-2 text-xs"
				>
					{response.ok ? (
						<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" />
					) : (
						<XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
					)}
					<span className="truncate font-mono text-foreground">{response.from}</span>
					{response.message ? (
						<span className="truncate text-muted-foreground">{response.message}</span>
					) : null}
				</div>
			))}
		</div>
	)
}

function ActiveConnectionRow({ url, roles }: { url: string; roles: ConnectionRole[] }) {
	const relay = useMemo(() => pool.relay(url), [url])
	const status = use$(() => relay.status$, [relay])
	const error = use$(() => relay.error$, [relay])
	const reqs = use$(() => relay.reqs$, [relay])
	const notices = use$(() => relay.notices$, [relay])
	const reqCount = Object.keys(reqs ?? {}).length
	const noticeCount = notices?.length ?? 0
	const state = status?.connected ? (status.ready ? 'Ready' : 'Opening') : error ? 'Failed' : 'Idle'

	return (
		<div className="grid grid-cols-[minmax(0,1fr)_72px_72px] items-center gap-2 px-3 py-3">
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-2">
					{state === 'Ready' ? (
						<CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" />
					) : state === 'Failed' ? (
						<XCircle className="h-3.5 w-3.5 shrink-0 text-destructive" />
					) : (
						<Activity className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="truncate font-mono text-xs text-foreground">{url}</span>
				</div>
				<div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
					{roles.map((role) => (
						<span key={role.label} className={`px-1.5 py-0.5 ${role.className}`}>
							{role.label}
						</span>
					))}
					{status?.authRequiredForRead || status?.authRequiredForPublish ? (
						<span className="border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-primary">
							Auth required
						</span>
					) : null}
					{noticeCount > 0 ? (
						<span className="border border-border bg-muted px-1.5 py-0.5 text-muted-foreground">
							{noticeCount} notice{noticeCount === 1 ? '' : 's'}
						</span>
					) : null}
					{error ? <span className="truncate text-destructive">{error.message}</span> : null}
				</div>
			</div>
			<div className="text-center text-xs text-foreground">{state}</div>
			<div className="text-center text-xs text-foreground">{reqCount}</div>
		</div>
	)
}

function ActiveConnectionsPanel({
	draft,
	discoveryRelayInput,
	signerRelays,
}: {
	draft: RelayDraft[]
	discoveryRelayInput: string
	signerRelays: string[]
}) {
	const relaysMap = use$(() => pool.relays$)
	const statuses = use$(() => pool.status$)
	const relayUrls = useMemo(
		() =>
			dedupeRelayUrls([
				...Array.from((relaysMap ?? pool.relays).keys()),
				...Object.keys(statuses ?? {}),
			]),
		[relaysMap, statuses],
	)
	const connectedCount = Object.values(statuses ?? {}).filter((status) => status.connected).length
	const readyCount = Object.values(statuses ?? {}).filter((status) => status.ready).length

	const roleForRelay = useMemo(() => {
		const userRelays = new Map(draft.map((relay) => [relay.url, relay]))
		const appReadRelays = new Set(dedupeRelayUrls(config.readRelays))
		const appWriteRelays = new Set(dedupeRelayUrls(config.writeRelays))
		const discoveryRelays = new Set(
			dedupeRelayUrls([...DEFAULT_DISCOVERY_RELAYS, ...parseRelayInputList(discoveryRelayInput)]),
		)
		const signerRelaySet = new Set(signerRelays)

		return (url: string): ConnectionRole[] => {
			const normalized = tryNormalizeRelayUrl(url) ?? url
			const roles: ConnectionRole[] = []
			const userRelay = userRelays.get(normalized)

			if (userRelay) {
				roles.push({
					label:
						userRelay.read && userRelay.write
							? 'NIP-65 read/write'
							: userRelay.read
								? 'NIP-65 read'
								: 'NIP-65 write',
					className: 'border border-info/40 bg-info/15 text-info',
				})
			}
			if (appReadRelays.has(normalized) || appWriteRelays.has(normalized)) {
				roles.push({
					label:
						appReadRelays.has(normalized) && appWriteRelays.has(normalized)
							? 'App read/write'
							: appReadRelays.has(normalized)
								? 'App read'
								: 'App write',
					className: 'border border-edit/40 bg-edit/15 text-edit',
				})
			}
			if (signerRelaySet.has(normalized)) {
				roles.push({
					label: 'Signer',
					className: 'border border-ok/40 bg-ok/15 text-ok',
				})
			}
			if (discoveryRelays.has(normalized)) {
				roles.push({
					label: 'Discovery',
					className: 'border border-border bg-card text-muted-foreground',
				})
			}
			if (isLoopbackRelay(normalized)) {
				roles.push({
					label: 'Loopback',
					className: 'border border-border bg-muted text-muted-foreground',
				})
			}

			if (roles.length === 0) {
				roles.push({
					label: 'External',
					className: 'border border-primary/40 bg-primary/10 text-primary',
				})
			}

			return roles
		}
	}, [draft, discoveryRelayInput, signerRelays])

	return (
		<div className="overflow-hidden border border-border bg-card">
			<div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2">
				<div className="min-w-0">
					<div className="flex items-center gap-2 text-sm font-medium text-foreground">
						<Activity className="h-4 w-4 text-muted-foreground" />
						Active app connections
					</div>
					<div className="mt-1 text-xs text-muted-foreground">
						{readyCount}/{relayUrls.length} ready, {connectedCount} connected
					</div>
				</div>
				{relayUrls.some((url) => roleForRelay(url).some((role) => role.label === 'External')) ? (
					<div className="flex shrink-0 items-center gap-1 text-xs text-primary">
						<AlertTriangle className="h-3.5 w-3.5" />
						External relays
					</div>
				) : null}
			</div>

			<div className="grid grid-cols-[minmax(0,1fr)_72px_72px] gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
				<div>Relay</div>
				<div className="text-center">State</div>
				<div className="text-center">Reqs</div>
			</div>

			{relayUrls.length > 0 ? (
				<div className="max-h-72 divide-y divide-slate-200 overflow-y-auto">
					{relayUrls.map((url) => (
						<ActiveConnectionRow key={url} url={url} roles={roleForRelay(url)} />
					))}
				</div>
			) : (
				<div className="px-3 py-6 text-center text-sm text-muted-foreground">
					No relay connections have been opened yet.
				</div>
			)}
		</div>
	)
}

/**
 * Dev-only escape hatches for relay stage isolation (docs/RELAY_STAGES.md).
 * Content stays on the local relay in dev; these flags open public relays for
 * reading (debugging) or writing (authoring). Not rendered in production.
 */
function DevRelayIsolationPanel() {
	const flags = use$(() => devRelayFlags$, [])
	if (!config.isDevelopment || !flags) return null

	return (
		<div className="space-y-3 border border-primary/40 bg-primary/5 p-3">
			<div className="flex items-center gap-2 text-sm font-medium text-foreground">
				<AlertTriangle className="h-4 w-4 text-primary" />
				Dev relay isolation
			</div>
			<p className="text-xs text-muted-foreground">
				Content entities talk only to the local relay in dev. Profile and wallet data still read
				from public relays. Flip these to debug against or author to public relays — seeded data
				must never be published with writes enabled.
			</p>
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="dev-public-reads" className="text-xs text-foreground">
					Allow public-relay reads (debugging)
				</Label>
				<Switch
					id="dev-public-reads"
					checked={flags.allowPublicReads}
					onCheckedChange={(checked) => setDevRelayFlags({ allowPublicReads: checked })}
				/>
			</div>
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor="dev-public-writes" className="text-xs text-foreground">
					Allow public-relay writes (authoring) ⚠
				</Label>
				<Switch
					id="dev-public-writes"
					checked={flags.allowPublicWrites}
					onCheckedChange={(checked) => setDevRelayFlags({ allowPublicWrites: checked })}
				/>
			</div>
		</div>
	)
}

export function UserRelayManager() {
	const account = useActiveAccount()
	const relayListEvent = use$(
		() => (account?.pubkey ? eventStore.replaceable(kinds.RelayList, account.pubkey) : undefined),
		[account?.pubkey],
	)
	const mailboxes = use$(
		() => (account?.pubkey ? eventStore.mailboxes(account.pubkey) : undefined),
		[account?.pubkey],
	)

	const publishedDraft = useMemo(
		() =>
			relayListEvent ? relayDraftFromEvent(relayListEvent) : relayDraftFromMailboxes(mailboxes),
		[relayListEvent, mailboxes],
	)
	const [draft, setDraft] = useState<RelayDraft[]>([])
	const [hasLocalEdits, setHasLocalEdits] = useState(false)
	const [relayInput, setRelayInput] = useState('')
	const [discoveryRelayInput, setDiscoveryRelayInput] = useState('')
	const [isDiscovering, setIsDiscovering] = useState(false)
	const [isPublishing, setIsPublishing] = useState(false)
	const [discovered, setDiscovered] = useState<DiscoveryResult[]>([])
	const [publishResponses, setPublishResponses] = useState<PublishResponse[]>([])

	useEffect(() => {
		if (!account?.pubkey) {
			setDraft([])
			setHasLocalEdits(false)
			setDiscovered([])
			setPublishResponses([])
			return
		}

		if (!hasLocalEdits) setDraft(publishedDraft)
	}, [account?.pubkey, hasLocalEdits, publishedDraft])

	const normalizedExamples = useMemo(
		() =>
			EXAMPLE_RELAYS.map((relay) => ({
				...relay,
				url: tryNormalizeRelayUrl(relay.url) ?? relay.url,
			})),
		[],
	)

	const draftSignature = useMemo(() => relayDraftSignature(draft), [draft])
	const publishedSignature = useMemo(() => relayDraftSignature(publishedDraft), [publishedDraft])
	const isDirty = draftSignature !== publishedSignature
	const activeRelays = draft.filter((relay) => relay.read || relay.write)
	const inboxes = activeRelays.filter((relay) => relay.read).map((relay) => relay.url)
	const outboxes = activeRelays.filter((relay) => relay.write).map((relay) => relay.url)
	const signerRelays = useMemo(() => getAccountSignerRelays(account), [account])
	const publishTargets = useMemo(
		() => dedupeRelayUrls([...config.writeRelays, ...inboxes, ...outboxes]),
		[inboxes, outboxes],
	)

	const setDraftEdited = useCallback((updater: (current: RelayDraft[]) => RelayDraft[]) => {
		setDraft((current) => updater(current))
		setHasLocalEdits(true)
		setPublishResponses([])
	}, [])

	const addRelays = useCallback(
		(relays: RelayDraft[]) => {
			const normalized = relays
				.map((relay) => {
					const url = tryNormalizeRelayUrl(relay.url)
					return url ? { ...relay, url } : null
				})
				.filter((relay): relay is RelayDraft => Boolean(relay))

			if (normalized.length === 0) {
				toast.error('Enter a valid ws:// or wss:// relay URL')
				return
			}

			setDraftEdited((current) => mergeRelayDrafts(current, normalized))
			setRelayInput('')
		},
		[setDraftEdited],
	)

	const handleAddRelay = () => {
		const urls = parseRelayInputList(relayInput)
		addRelays(urls.map((url) => ({ url, read: true, write: true })))
	}

	const handleImportAppRelays = () => {
		addRelays([
			...config.readRelays.map((url) => ({ url, read: true, write: false })),
			...config.writeRelays.map((url) => ({ url, read: false, write: true })),
		])
	}

	const handleToggle = (url: string, key: 'read' | 'write', value: boolean | 'indeterminate') => {
		setDraftEdited((current) =>
			current.map((relay) => (relay.url === url ? { ...relay, [key]: value === true } : relay)),
		)
	}

	const handleRemove = (url: string) => {
		setDraftEdited((current) => current.filter((relay) => relay.url !== url))
	}

	const handleReset = () => {
		setDraft(publishedDraft)
		setHasLocalEdits(false)
		setPublishResponses([])
	}

	const buildDiscoveryRelays = () =>
		dedupeRelayUrls([
			...config.readRelays,
			...DEFAULT_DISCOVERY_RELAYS,
			...draft.map((relay) => relay.url),
			...parseRelayInputList(discoveryRelayInput),
		])

	const handleDiscover = async () => {
		if (!account?.pubkey) {
			toast.error('Sign in to discover relay lists')
			return
		}

		const relays = buildDiscoveryRelays()
		if (relays.length === 0) {
			toast.error('Add at least one discovery relay')
			return
		}

		setIsDiscovering(true)
		try {
			const results = await discoverRelayLists({ pubkey: account.pubkey, relays })
			setDiscovered(results)

			if (results.length > 0) {
				toast.success(`Found ${results.length} relay list event${results.length === 1 ? '' : 's'}`)
			} else {
				toast.info('No relay list found on the searched relays')
			}
		} catch (error) {
			console.error('Relay list discovery failed:', error)
			toast.error(error instanceof Error ? error.message : 'Relay list discovery failed')
		} finally {
			setIsDiscovering(false)
		}
	}

	const handleUseDiscovered = (event: NostrEvent) => {
		setDraft(relayDraftFromEvent(event))
		setHasLocalEdits(true)
		setPublishResponses([])
	}

	const handlePublish = async () => {
		const signer = accounts.signer
		if (!signer || !account?.pubkey) {
			toast.error('Sign in to publish your relay list')
			return
		}
		if (activeRelays.length === 0) {
			toast.error('Add at least one read or write relay before publishing')
			return
		}
		if (publishTargets.length === 0) {
			toast.error('No publish target relays available')
			return
		}

		setIsPublishing(true)
		try {
			const signed = await MailboxesFactory.create({ inboxes, outboxes })
				.alt('Nostr relay list metadata')
				.sign(signer)
			const responses = await publish(signed, { relays: publishTargets })
			setPublishResponses(responses)
			setDraft(relayDraftFromEvent(signed))
			setHasLocalEdits(false)

			const successful = responses.filter((response) => response.ok).length
			if (successful > 0) {
				toast.success(`Relay list published to ${successful}/${responses.length} relays`)
			} else {
				toast.error('Relay list publish failed on every relay')
			}
		} catch (error) {
			console.error('Failed to publish relay list:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to publish relay list')
		} finally {
			setIsPublishing(false)
		}
	}

	if (!account?.pubkey) {
		return (
			<div className="border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
				Sign in to manage your NIP-65 read and write relays.
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<div className="grid gap-3 md:grid-cols-3">
				<div className="border border-border bg-muted p-3">
					<div className="text-xs font-medium text-muted-foreground uppercase">Read relays</div>
					<div className="mt-1 text-2xl font-semibold text-foreground">{inboxes.length}</div>
				</div>
				<div className="border border-border bg-muted p-3">
					<div className="text-xs font-medium text-muted-foreground uppercase">Write relays</div>
					<div className="mt-1 text-2xl font-semibold text-foreground">{outboxes.length}</div>
				</div>
				<div className="border border-border bg-muted p-3">
					<div className="text-xs font-medium text-muted-foreground uppercase">Published</div>
					<div className="mt-2 truncate text-xs text-foreground">
						{formatEventDate(relayListEvent)}
					</div>
				</div>
			</div>

			{mailboxes && !relayListEvent ? (
				<div className="border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary">
					Mailbox data is in memory, but the source relay-list event is still loading.
				</div>
			) : null}

			<DevRelayIsolationPanel />

			<ActiveConnectionsPanel
				draft={draft}
				discoveryRelayInput={discoveryRelayInput}
				signerRelays={signerRelays}
			/>

			<div className="space-y-3 border border-border bg-card p-3">
				<div className="flex flex-col gap-2 sm:flex-row">
					<Input
						value={relayInput}
						onChange={(event) => setRelayInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === 'Enter') handleAddRelay()
						}}
						placeholder="wss://relay.example.com"
						className="min-w-0 flex-1"
					/>
					<Button type="button" onClick={handleAddRelay} className="shrink-0">
						<Plus className="h-4 w-4" />
						Add relay
					</Button>
					<Button
						type="button"
						variant="outline"
						onClick={handleImportAppRelays}
						className="shrink-0"
					>
						<RefreshCw className="h-4 w-4" />
						App relays
					</Button>
				</div>

				<div className="flex flex-wrap gap-2">
					{normalizedExamples.map((relay) => {
						const exists = draft.some((item) => item.url === relay.url)
						return (
							<Button
								key={relay.url}
								type="button"
								variant={exists ? 'secondary' : 'outline'}
								size="sm"
								onClick={() => addRelays([relay])}
								disabled={exists}
								title={`${relay.url}${relay.write ? ' read/write' : ' read'}`}
							>
								<Plus className="h-3.5 w-3.5" />
								{relay.label}
							</Button>
						)
					})}
				</div>
			</div>

			<div className="overflow-hidden border border-border bg-card">
				<div className="grid grid-cols-[1fr_72px_72px_44px] gap-2 border-b border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground uppercase">
					<div>Relay</div>
					<div className="text-center">Read</div>
					<div className="text-center">Write</div>
					<div />
				</div>

				{draft.length > 0 ? (
					<div className="divide-y divide-slate-200">
						{draft.map((relay) => (
							<div
								key={relay.url}
								className="grid grid-cols-[minmax(0,1fr)_72px_72px_44px] items-center gap-2 px-3 py-3"
							>
								<RelayInfo url={relay.url} />
								<div className="flex justify-center">
									<Checkbox
										checked={relay.read}
										onCheckedChange={(value) => handleToggle(relay.url, 'read', value)}
										aria-label={`Use ${relay.url} for reads`}
									/>
								</div>
								<div className="flex justify-center">
									<Checkbox
										checked={relay.write}
										onCheckedChange={(value) => handleToggle(relay.url, 'write', value)}
										aria-label={`Use ${relay.url} for writes`}
									/>
								</div>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											onClick={() => handleRemove(relay.url)}
											aria-label={`Remove ${relay.url}`}
										>
											<Trash2 className="h-4 w-4 text-muted-foreground" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Remove relay</TooltipContent>
								</Tooltip>
							</div>
						))}
					</div>
				) : (
					<div className="px-3 py-8 text-center text-sm text-muted-foreground">
						No relay list loaded. Add relays, import app relays, or discover an existing list.
					</div>
				)}
			</div>

			<div className="space-y-3 border border-border bg-card p-3">
				<div className="flex items-center justify-between gap-3">
					<div className="min-w-0">
						<Label className="text-sm font-medium">Discover existing relay list</Label>
						<p className="text-xs text-muted-foreground">
							Search configured, example, and custom discovery relays for your latest kind 10002.
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						onClick={() => void handleDiscover()}
						disabled={isDiscovering}
						className="shrink-0"
					>
						{isDiscovering ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Search className="h-4 w-4" />
						)}
						Discover
					</Button>
				</div>
				<Input
					value={discoveryRelayInput}
					onChange={(event) => setDiscoveryRelayInput(event.target.value)}
					placeholder="Extra discovery relays, comma separated"
				/>

				{discovered.length > 0 ? (
					<div className="space-y-2">
						{discovered.map(({ event, seenOn }) => {
							const relays = relayDraftFromEvent(event)
							const active = event.id === relayListEvent?.id
							return (
								<div key={event.id} className="border border-border bg-muted p-3">
									<div className="flex items-start justify-between gap-3">
										<div className="min-w-0 space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<span className="font-mono text-xs text-foreground">
													{event.id.slice(0, 12)}...
												</span>
												{active ? (
													<span className="border border-ok/40 bg-ok/15 px-1.5 py-0.5 text-xs text-ok">
														Current
													</span>
												) : null}
											</div>
											<div className="text-xs text-muted-foreground">
												{formatEventDate(event)} - {relays.length} relay
												{relays.length === 1 ? '' : 's'} - seen on {seenOn.length}
											</div>
											<div className="truncate text-xs font-mono text-muted-foreground">
												{seenOn.join(', ')}
											</div>
										</div>
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={() => handleUseDiscovered(event)}
										>
											Use list
										</Button>
									</div>
								</div>
							)
						})}
					</div>
				) : null}
			</div>

			<div className="space-y-3 border border-border bg-muted p-3">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<div className="text-sm font-medium text-foreground">
							{isDirty ? 'You have unpublished relay changes.' : 'Relay list is up to date.'}
						</div>
						<div className="mt-1 truncate text-xs text-muted-foreground">
							Publishing targets: {publishTargets.length > 0 ? publishTargets.join(', ') : 'none'}
						</div>
					</div>
					<div className="flex shrink-0 gap-2">
						<Button
							type="button"
							variant="outline"
							onClick={handleReset}
							disabled={!isDirty || isPublishing}
						>
							Reset
						</Button>
						<Button
							type="button"
							onClick={() => void handlePublish()}
							disabled={activeRelays.length === 0 || isPublishing}
						>
							{isPublishing ? (
								<Loader2 className="h-4 w-4 animate-spin" />
							) : (
								<UploadCloud className="h-4 w-4" />
							)}
							Publish relay list
						</Button>
					</div>
				</div>

				<PublishResultList responses={publishResponses} />
			</div>
		</div>
	)
}
