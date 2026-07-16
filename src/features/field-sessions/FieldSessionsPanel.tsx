import { useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowLeft,
	Check,
	Clock3,
	Copy,
	Database,
	Link2,
	Loader2,
	Map as MapIcon,
	MessageSquare,
	QrCode,
	RadioTower,
	RefreshCw,
	Send,
	Settings2,
	ShieldCheck,
	Smartphone,
	Square,
	UploadCloud,
	UserPlus,
	Users,
	Wifi,
	WifiOff,
	X,
} from 'lucide-react'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useRouting } from '@/features/geo-editor/hooks/useRouting'
import { eventStore } from '@/lib/nostr'
import type {
	LocalNodeService,
	LocalNodeStatus,
	NetworkAddress,
	PairingInvitation,
	PendingPairingClaim,
	PeerGrant,
	RemoteNodeRecord,
} from '@/platform/contracts'
import { getLocalNodeService } from '@/platform/registry'
import {
	decodePairingQrImage,
	normalizePairingInvitation,
	pairingInvitationLink,
} from '@/features/offline/pairingQr'
import {
	fieldSessionInfo,
	removeFieldSession,
	recordFromRemoteNode,
	updateFieldSession,
	upsertFieldSession,
	useFieldSessions,
	type FieldSessionRecord,
} from './model'
import { fieldSessionMessageTemplate, parseFieldSessionMessage } from './events'

const FIELD_SESSION_SECONDS = 60 * 60
const POLL_INTERVAL_MS = 3_000

const shortKey = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))

type DetailTab = 'chat' | 'map' | 'people' | 'settings'

function sessionDeliveryLabel(session: FieldSessionRecord): string {
	if (session.internetPolicy === 'never') return 'Nearby only'
	if (session.internetPolicy === 'automatic') return 'Nearby + automatic internet sync'
	return 'Nearby now · ask before internet sync'
}

function StatusDot({ active }: { active: boolean }) {
	return (
		<span
			className={`h-2 w-2 shrink-0 rounded-full ${active ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
		/>
	)
}

function EmptyNativeState({ reason }: { reason: string }) {
	return (
		<div className="grid place-items-center border border-dashed border-border px-5 py-10 text-center">
			<Smartphone className="mb-3 h-8 w-8 text-muted-foreground" />
			<h3 className="text-sm font-semibold">Earthly app required</h3>
			<p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">{reason}</p>
		</div>
	)
}

export function FieldSessionsPanel() {
	const activeAccount = useActiveAccount()
	const sessions = useFieldSessions()
	const { fieldSessionId, navigateToFieldSession, navigateToView } = useRouting()
	const [service, setService] = useState<LocalNodeService | null>(null)
	const [status, setStatus] = useState<LocalNodeStatus>({ state: 'starting' })
	const [addresses, setAddresses] = useState<NetworkAddress[]>([])
	const [selectedAddress, setSelectedAddress] = useState('')
	const [claims, setClaims] = useState<PendingPairingClaim[]>([])
	const [grants, setGrants] = useState<PeerGrant[]>([])
	const [remoteNodes, setRemoteNodes] = useState<RemoteNodeRecord[]>([])
	const [messages, setMessages] = useState<ReturnType<typeof parseFieldSessionMessage>[]>([])
	const [allSessionEvents, setAllSessionEvents] = useState<NostrEvent[]>([])
	const [detailTab, setDetailTab] = useState<DetailTab>('chat')
	const [operation, setOperation] = useState<string | null>(null)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [allowPeerWrites, setAllowPeerWrites] = useState(true)
	const [internetPolicy, setInternetPolicy] = useState<'never' | 'ask'>('never')
	const [invitationInput, setInvitationInput] = useState('')
	const [invitation, setInvitation] = useState<PairingInvitation | null>(null)
	const [inviteOpen, setInviteOpen] = useState(false)
	const [joinOpen, setJoinOpen] = useState(false)
	const [draftMessage, setDraftMessage] = useState('')
	const refreshInFlight = useRef(false)
	const recordsInFlight = useRef(false)
	const scanInputRef = useRef<HTMLInputElement>(null)

	const selected = useMemo(
		() => sessions.find((session) => session.id === fieldSessionId) ?? null,
		[sessions, fieldSessionId],
	)
	const selectedRemote = useMemo(
		() =>
			selected?.role === 'participant'
				? (remoteNodes.find((remote) => remote.nodeId === selected.hostNodeId) ?? null)
				: null,
		[remoteNodes, selected],
	)

	useEffect(() => {
		let active = true
		void getLocalNodeService().then((next) => {
			if (active) setService(next)
		})
		return () => {
			active = false
		}
	}, [])

	const refreshNode = useCallback(async () => {
		if (!service || refreshInFlight.current) return
		refreshInFlight.current = true
		try {
			const nextStatus = await service.status()
			setStatus(nextStatus)
			if (nextStatus.state !== 'running') return
			const [addressResult, claimResult, grantResult, remoteResult] = await Promise.allSettled([
				service.networkAddresses(),
				service.pendingClaims(),
				service.peerGrants(),
				service.remoteNodes(),
			])
			if (addressResult.status === 'fulfilled') {
				setAddresses(addressResult.value)
				setSelectedAddress((current) =>
					addressResult.value.some((candidate) => candidate.address === current)
						? current
						: (addressResult.value[0]?.address ?? ''),
				)
			}
			if (claimResult.status === 'fulfilled') setClaims(claimResult.value)
			if (grantResult.status === 'fulfilled') setGrants(grantResult.value)
			if (remoteResult.status === 'fulfilled') {
				const refreshed = await Promise.all(
					remoteResult.value.map(async (remote) => {
						if (remote.status.state !== 'pending') return remote
						try {
							return await service.refreshRemoteNode(remote.nodeId)
						} catch {
							return remote
						}
					}),
				)
				setRemoteNodes(refreshed)
				for (const remote of refreshed) {
					const record = recordFromRemoteNode(remote)
					if (record) upsertFieldSession(record)
				}
			}
		} catch (error) {
			setStatus({ state: 'failed', message: errorMessage(error) })
		} finally {
			refreshInFlight.current = false
		}
	}, [service])

	const refreshRecords = useCallback(async () => {
		if (!service || !selected || recordsInFlight.current) return
		recordsInFlight.current = true
		try {
			if (selected.role === 'participant' && selectedRemote?.status.state === 'accepted') {
				const sync = await service.syncRemoteNode(selected.hostNodeId)
				const hydrated = sync.events as NostrEvent[]
				for (const event of hydrated) {
					if (verifyEvent(event)) eventStore.add(event)
				}
				setRemoteNodes((current) =>
					current.map((remote) =>
						remote.nodeId === sync.remoteNode.nodeId ? sync.remoteNode : remote,
					),
				)
			}
			const events = (await service.fieldSessionEvents(selected.id)) as NostrEvent[]
			const verified = events.filter(verifyEvent)
			setAllSessionEvents(verified)
			setMessages(
				verified
					.map((event) => parseFieldSessionMessage(event, selected.id))
					.filter((message) => message !== null),
			)
		} catch (error) {
			// Reconciliation is intentionally quiet. The explicit refresh control
			// remains available when a nearby host temporarily disappears.
			console.warn('[field-session] reconciliation failed', error)
		} finally {
			recordsInFlight.current = false
		}
	}, [selected, selectedRemote?.status.state, service])

	useEffect(() => {
		if (!service) return
		void refreshNode()
		if (!service.supported) return
		const timer = window.setInterval(() => void refreshNode(), POLL_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [refreshNode, service])

	useEffect(() => {
		if (!selected || !service?.supported) {
			setMessages([])
			setAllSessionEvents([])
			return
		}
		void refreshRecords()
		const timer = window.setInterval(() => void refreshRecords(), POLL_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [refreshRecords, selected, service?.supported])

	const run = async (key: string, action: () => Promise<void>) => {
		setOperation(key)
		try {
			await action()
		} catch (error) {
			toast.error(errorMessage(error))
		} finally {
			setOperation(null)
		}
	}

	const startSession = () =>
		run('start', async () => {
			if (!service || !selectedAddress) throw new Error('Join Wi-Fi or enable a hotspot first')
			const trimmedName = name.trim()
			if (!trimmedName) throw new Error('Give the field session a name')
			const nextStatus = await service.enableLan(selectedAddress, FIELD_SESSION_SECONDS)
			if (nextStatus.state !== 'running') throw new Error('The local node did not start')
			const now = Math.floor(Date.now() / 1000)
			const record: FieldSessionRecord = {
				version: 1,
				id: crypto.randomUUID(),
				name: trimmedName,
				description: description.trim() || undefined,
				role: 'host',
				hostNodeId: nextStatus.descriptor.nodeId,
				internetPolicy,
				conversationPolicy: 'nearby-only',
				allowPeerWrites,
				contextCoordinates: [],
				state: 'active',
				createdAt: now,
				updatedAt: now,
			}
			upsertFieldSession(record)
			setStatus(nextStatus)
			setName('')
			setDescription('')
			navigateToFieldSession(record.id)
			toast.success('Field session is live on the nearby network')
		})

	const resumeHost = (session: FieldSessionRecord) =>
		run('resume', async () => {
			if (!service || !selectedAddress) throw new Error('Join Wi-Fi or enable a hotspot first')
			setStatus(await service.enableLan(selectedAddress, FIELD_SESSION_SECONDS))
			updateFieldSession(session.id, { state: 'active' })
			toast.success('Nearby hosting resumed for one hour')
		})

	const createInvite = () =>
		run('invite', async () => {
			if (!service || !selected) return
			let nextStatus = status
			if (nextStatus.state !== 'running' || nextStatus.descriptor.scope !== 'local-network') {
				if (!selectedAddress) throw new Error('Join Wi-Fi or enable a hotspot first')
				nextStatus = await service.enableLan(selectedAddress, FIELD_SESSION_SECONDS)
				setStatus(nextStatus)
			}
			setInvitation(await service.createInvitation(fieldSessionInfo(selected)))
			setInviteOpen(true)
			await refreshNode()
		})

	const joinSession = () =>
		run('join', async () => {
			if (!service) return
			const normalized = normalizePairingInvitation(invitationInput)
			if (!normalized) throw new Error('Paste or scan an Earthly invitation first')
			const remote = await service.joinInvitation(normalized, 'Earthly field device')
			const record = recordFromRemoteNode(remote)
			if (!record) throw new Error('This invitation does not belong to a Field session')
			upsertFieldSession(record)
			setRemoteNodes((current) => [
				remote,
				...current.filter((candidate) => candidate.nodeId !== remote.nodeId),
			])
			setInvitationInput('')
			setJoinOpen(false)
			navigateToFieldSession(record.id)
			toast.success('Access requested — approve this device on the field host')
		})

	const scanInvitation = (file: File) =>
		run('scan', async () => {
			const decoded = await decodePairingQrImage(file)
			const normalized = normalizePairingInvitation(decoded)
			if (!normalized) throw new Error('This QR code is not an Earthly invitation')
			setInvitationInput(normalized)
			setJoinOpen(true)
		})

	const approveClaim = (claim: PendingPairingClaim) =>
		run(`approve:${claim.claimId}`, async () => {
			if (!service) return
			await service.approveClaim(claim.claimId)
			await refreshNode()
			toast.success(`${claim.peerName ?? 'Nearby device'} can now join`)
		})

	const rejectClaim = (claim: PendingPairingClaim) =>
		run(`reject:${claim.claimId}`, async () => {
			if (!service) return
			await service.rejectClaim(claim.claimId, 'Rejected by the field host')
			await refreshNode()
		})

	const revokeGrant = (grant: PeerGrant) =>
		run(`revoke:${grant.peerPubkey}`, async () => {
			if (!service) return
			await service.revokePeer(grant.peerPubkey)
			await refreshNode()
			toast.success('Device removed from future nearby updates')
		})

	const sendMessage = () =>
		run('send', async () => {
			if (!service || !selected) return
			if (!activeAccount?.signer) throw new Error('Sign in before posting to the Field session')
			const signed = (await activeAccount.signer.signEvent(
				fieldSessionMessageTemplate(selected.id, draftMessage),
			)) as NostrEvent
			if (!verifyEvent(signed)) throw new Error('The signer returned an invalid event')
			if (selected.role === 'host') {
				await service.ingestLocalEvent(signed)
			} else {
				if (selectedRemote?.status.state !== 'accepted') {
					throw new Error('The field host has not approved this device yet')
				}
				await service.publishRemoteEvent(selected.hostNodeId, signed)
			}
			eventStore.add(signed)
			setDraftMessage('')
			await refreshRecords()
		})

	const stopSession = () =>
		run('stop', async () => {
			if (!service || !selected) return
			if (selected.role === 'host') {
				setStatus(await service.disableLan())
				updateFieldSession(selected.id, { state: 'ended' })
				toast.success('Field session ended on this device')
			} else {
				await service.forgetRemoteNode(selected.hostNodeId)
				removeFieldSession(selected.id)
				navigateToView('field-sessions')
				toast.success('Field session removed from this device')
			}
		})

	if (!service || status.state === 'starting') {
		return (
			<div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin" /> Starting the nearby workspace…
			</div>
		)
	}

	if (!service.supported || status.state === 'unsupported') {
		return (
			<div className="space-y-4 p-2">
				<header className="border-b border-border pb-3">
					<div className="flex items-center gap-2">
						<RadioTower className="h-5 w-5 text-primary" />
						<h2 className="text-lg font-semibold">Field sessions</h2>
					</div>
				</header>
				<EmptyNativeState
					reason={
						status.state === 'unsupported'
							? status.reason
							: 'Field sessions use the embedded relay in the Earthly Android app.'
					}
				/>
			</div>
		)
	}

	if (status.state === 'failed') {
		return (
			<div className="space-y-3 border border-destructive/40 bg-destructive/5 p-4">
				<p className="text-sm font-semibold">Nearby workspace unavailable</p>
				<p className="text-xs text-muted-foreground">{status.message}</p>
				<Button variant="outline" onClick={() => void refreshNode()}>
					<RefreshCw /> Retry
				</Button>
			</div>
		)
	}

	if (!selected) {
		return (
			<div className="space-y-5 p-2">
				<header className="border-b border-border pb-4">
					<div className="flex items-center gap-2">
						<RadioTower className="h-5 w-5 text-primary" />
						<h2 className="text-lg font-semibold">Field sessions</h2>
					</div>
					<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
						A shared nearby workspace for a team on the same Wi-Fi or phone hotspot. The host
						decides who may contribute.
					</p>
				</header>

				{sessions.length > 0 ? (
					<section className="space-y-2">
						<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
							Recent sessions
						</p>
						{sessions.map((session) => {
							const remote = remoteNodes.find(
								(candidate) => candidate.nodeId === session.hostNodeId,
							)
							const live =
								session.state === 'active' &&
								(session.role === 'host'
									? status.descriptor.scope === 'local-network'
									: remote?.status.state === 'accepted')
							return (
								<button
									key={session.id}
									type="button"
									className="flex w-full items-start gap-3 border border-border bg-card p-3 text-left transition-colors hover:border-primary/50 hover:bg-muted/30"
									onClick={() => navigateToFieldSession(session.id)}
								>
									<span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center bg-primary/10 text-primary">
										<RadioTower className="h-4 w-4" />
									</span>
									<span className="min-w-0 flex-1">
										<span className="flex items-center gap-2 text-sm font-semibold">
											<span className="truncate">{session.name}</span>
											<StatusDot active={live} />
										</span>
										<span className="mt-1 block font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
											{session.role} · {sessionDeliveryLabel(session)}
										</span>
									</span>
								</button>
							)
						})}
					</section>
				) : null}

				<section className="space-y-3 border border-border p-3">
					<div>
						<p className="text-sm font-semibold">Start on this phone</p>
						<p className="text-xs text-muted-foreground">This device becomes the field host.</p>
					</div>
					<div className="space-y-2">
						<Label htmlFor="field-session-name">Session name</Label>
						<Input
							id="field-session-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Saturday watershed survey"
						/>
						<Textarea
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Purpose and meeting point (optional)"
							rows={2}
						/>
					</div>
					<div className="space-y-2">
						<Label>Nearby network</Label>
						<Select value={selectedAddress} onValueChange={setSelectedAddress}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Join Wi-Fi or enable a hotspot" />
							</SelectTrigger>
							<SelectContent>
								{addresses.map((address) => (
									<SelectItem key={address.address} value={address.address}>
										{address.address} · {address.interfaceName}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<label className="flex cursor-pointer items-start gap-3 border border-border p-3">
						<input
							type="checkbox"
							checked={allowPeerWrites}
							onChange={(event) => setAllowPeerWrites(event.target.checked)}
							className="mt-0.5"
						/>
						<span>
							<span className="block text-xs font-semibold">Participants may contribute</span>
							<span className="block text-[10px] leading-relaxed text-muted-foreground">
								Approved phones may publish to the field host so everyone nearby receives updates.
							</span>
						</span>
					</label>
					<div className="grid grid-cols-2 gap-2">
						<Button
							type="button"
							variant={internetPolicy === 'never' ? 'default' : 'outline'}
							onClick={() => setInternetPolicy('never')}
						>
							<WifiOff /> Nearby only
						</Button>
						<Button
							type="button"
							variant={internetPolicy === 'ask' ? 'default' : 'outline'}
							onClick={() => setInternetPolicy('ask')}
						>
							<UploadCloud /> Ask to sync
						</Button>
					</div>
					<Button
						type="button"
						className="w-full"
						disabled={!selectedAddress || !name.trim() || operation !== null}
						onClick={() => void startSession()}
					>
						{operation === 'start' ? <Loader2 className="animate-spin" /> : <RadioTower />}
						Start Field session
					</Button>
				</section>

				<div className="grid grid-cols-2 gap-2">
					<Button variant="outline" onClick={() => setJoinOpen(true)}>
						<Link2 /> Paste invite
					</Button>
					<Button variant="outline" onClick={() => scanInputRef.current?.click()}>
						<QrCode /> Scan invite
					</Button>
					<input
						ref={scanInputRef}
						type="file"
						accept="image/*"
						capture="environment"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0]
							if (file) void scanInvitation(file)
							event.currentTarget.value = ''
						}}
					/>
				</div>
				<JoinDialog
					open={joinOpen}
					onOpenChange={setJoinOpen}
					value={invitationInput}
					onChange={setInvitationInput}
					onJoin={() => void joinSession()}
					busy={operation === 'join'}
				/>
			</div>
		)
	}

	const hostLive =
		selected.role === 'host' &&
		selected.state === 'active' &&
		status.descriptor.scope === 'local-network'
	const remoteAccepted = selectedRemote?.status.state === 'accepted'
	const sessionLive = selected.role === 'host' ? hostLive : Boolean(remoteAccepted)
	const geometryEvents = allSessionEvents.filter((event) => event.kind !== 37_523)
	const canContribute = selected.role === 'host' || selected.allowPeerWrites

	return (
		<div className="space-y-4 p-2">
			<button
				type="button"
				className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
				onClick={() => navigateToView('field-sessions')}
			>
				<ArrowLeft className="h-3.5 w-3.5" /> Back to Field sessions
			</button>

			<header className="border-b border-border pb-3">
				<div className="flex items-start gap-3">
					<span className="flex h-9 w-9 shrink-0 items-center justify-center bg-primary/10 text-primary">
						<RadioTower className="h-4 w-4" />
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-2">
							<h2 className="truncate text-lg font-semibold">{selected.name}</h2>
							<Badge variant="outline" className="rounded-[2px] text-[9px] uppercase">
								{selected.role}
							</Badge>
						</div>
						<p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
							<StatusDot active={sessionLive} />
							{sessionLive ? sessionDeliveryLabel(selected) : 'Not currently reachable nearby'}
						</p>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						onClick={() => void refreshRecords()}
						aria-label="Refresh Field session"
					>
						<RefreshCw />
					</Button>
				</div>
				{selected.description ? (
					<p className="mt-2 text-xs leading-relaxed text-muted-foreground">
						{selected.description}
					</p>
				) : null}
			</header>

			{selected.role === 'participant' && !remoteAccepted ? (
				<div className="border border-amber-500/40 bg-amber-500/5 p-3 text-xs">
					<p className="font-semibold">Waiting for the field host</p>
					<p className="mt-1 text-muted-foreground">
						Approve this phone on the host, then Earthly will connect automatically.
					</p>
					<Button variant="outline" size="sm" className="mt-2" onClick={() => void refreshNode()}>
						<RefreshCw /> Check approval
					</Button>
				</div>
			) : null}

			{selected.role === 'host' && !hostLive ? (
				<div className="space-y-2 border border-border bg-muted/30 p-3">
					<p className="text-xs font-semibold">Nearby hosting is paused</p>
					<Select value={selectedAddress} onValueChange={setSelectedAddress}>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Choose a nearby network" />
						</SelectTrigger>
						<SelectContent>
							{addresses.map((address) => (
								<SelectItem key={address.address} value={address.address}>
									{address.address} · {address.interfaceName}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button className="w-full" onClick={() => void resumeHost(selected)}>
						<Wifi /> Resume for one hour
					</Button>
				</div>
			) : null}

			<Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as DetailTab)}>
				<TabsList className="grid h-auto w-full grid-cols-4 rounded-none border border-border bg-muted/30 p-0">
					<TabsTrigger value="chat" className="rounded-none text-[10px]">
						<MessageSquare /> Chat
					</TabsTrigger>
					<TabsTrigger value="map" className="rounded-none text-[10px]">
						<MapIcon /> Map
					</TabsTrigger>
					<TabsTrigger value="people" className="relative rounded-none text-[10px]">
						<Users /> People
						{claims.length > 0 ? (
							<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
						) : null}
					</TabsTrigger>
					<TabsTrigger value="settings" className="rounded-none text-[10px]">
						<Settings2 /> Settings
					</TabsTrigger>
				</TabsList>

				<TabsContent value="chat" className="mt-3 space-y-3">
					<div className="min-h-40 divide-y divide-border border-y border-border">
						{messages.length === 0 ? (
							<div className="grid place-items-center px-4 py-10 text-center">
								<MessageSquare className="mb-2 h-6 w-6 text-muted-foreground" />
								<p className="text-xs font-semibold">No field notes yet</p>
								<p className="mt-1 text-[10px] text-muted-foreground">
									Messages remain on the nearby workspace unless the session policy changes.
								</p>
							</div>
						) : (
							messages.map((message) =>
								message ? (
									<article key={message.event.id} className="py-3">
										<div className="flex items-center gap-2">
											<UserProfile
												pubkey={message.event.pubkey}
												mode="avatar-name"
												size="xs"
												interactive={false}
												className="min-w-0 flex-1"
											/>
											<time className="font-mono text-[9px] text-muted-foreground">
												{new Date(message.event.created_at * 1000).toLocaleTimeString([], {
													hour: '2-digit',
													minute: '2-digit',
												})}
											</time>
										</div>
										<p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
											{message.text}
										</p>
									</article>
								) : null,
							)
						)}
					</div>
					{activeAccount && canContribute ? (
						<div className="grid grid-cols-[1fr_auto] gap-2">
							<Textarea
								value={draftMessage}
								onChange={(event) => setDraftMessage(event.target.value)}
								placeholder="Message everyone in this Field session…"
								rows={3}
							/>
							<Button
								type="button"
								className="h-auto w-11"
								onClick={() => void sendMessage()}
								disabled={!draftMessage.trim() || operation !== null || !sessionLive}
								aria-label="Send field message"
							>
								{operation === 'send' ? <Loader2 className="animate-spin" /> : <Send />}
							</Button>
						</div>
					) : (
						<p className="border border-dashed border-border p-3 text-xs text-muted-foreground">
							{!activeAccount
								? 'Sign in to contribute. The nearby device grant and your Nostr authorship are separate.'
								: 'This Field session is read-only for participant phones.'}
						</p>
					)}
				</TabsContent>

				<TabsContent value="map" className="mt-3 space-y-3">
					<div className="grid grid-cols-2 gap-2">
						<div className="border border-border p-3">
							<Database className="mb-2 h-4 w-4 text-primary" />
							<p className="text-lg font-semibold">{geometryEvents.length}</p>
							<p className="font-mono text-[9px] uppercase text-muted-foreground">Map records</p>
						</div>
						<div className="border border-border p-3">
							<MessageSquare className="mb-2 h-4 w-4 text-primary" />
							<p className="text-lg font-semibold">{messages.length}</p>
							<p className="font-mono text-[9px] uppercase text-muted-foreground">Field notes</p>
						</div>
					</div>
					<div className="border border-dashed border-border p-4 text-xs leading-relaxed text-muted-foreground">
						Map entities tagged for this session will appear here and in the Map Stack. Chat
						transport is active now; session-bound drawing is the next vertical slice.
					</div>
				</TabsContent>

				<TabsContent value="people" className="mt-3 space-y-3">
					{selected.role === 'host' ? (
						<>
							<Button
								className="w-full"
								onClick={() => void createInvite()}
								disabled={operation !== null}
							>
								{operation === 'invite' ? <Loader2 className="animate-spin" /> : <QrCode />}
								Invite a nearby phone
							</Button>
							{claims.map((claim) => (
								<div key={claim.claimId} className="border border-primary/35 bg-primary/5 p-3">
									<p className="font-mono text-[9px] uppercase text-primary">Access request</p>
									<p className="mt-1 text-xs font-semibold">
										{claim.peerName ?? shortKey(claim.peerPubkey)}
									</p>
									<div className="mt-2 grid grid-cols-2 gap-2">
										<Button size="sm" onClick={() => void approveClaim(claim)}>
											<Check /> Approve
										</Button>
										<Button size="sm" variant="outline" onClick={() => void rejectClaim(claim)}>
											<X /> Reject
										</Button>
									</div>
								</div>
							))}
							<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
								Approved nearby devices
							</p>
							<div className="divide-y divide-border border-y border-border">
								{grants.length === 0 ? (
									<p className="py-4 text-xs text-muted-foreground">No participant phones yet.</p>
								) : (
									grants.map((grant) => (
										<div key={grant.peerPubkey} className="flex items-center gap-2 py-2">
											<Smartphone className="h-4 w-4 text-muted-foreground" />
											<div className="min-w-0 flex-1">
												<p className="font-mono text-[10px]">{shortKey(grant.peerPubkey)}</p>
												<p className="text-[9px] text-muted-foreground">
													{grant.capabilities.includes('relay-write')
														? 'Can contribute'
														: 'Read only'}
												</p>
											</div>
											<Button
												variant="ghost"
												size="icon-sm"
												onClick={() => void revokeGrant(grant)}
												aria-label="Remove device"
											>
												<X />
											</Button>
										</div>
									))
								)}
							</div>
						</>
					) : (
						<div className="border border-border p-4">
							<div className="flex items-center gap-2">
								<ShieldCheck className="h-4 w-4 text-primary" />
								<p className="text-xs font-semibold">This installation</p>
							</div>
							<p className="mt-2 font-mono text-[10px] text-muted-foreground">
								{selectedRemote ? shortKey(selectedRemote.peerPubkey) : 'Waiting for host metadata'}
							</p>
						</div>
					)}
				</TabsContent>

				<TabsContent value="settings" className="mt-3 space-y-3">
					<div className="space-y-2 border border-border p-3">
						<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
							Delivery policy
						</p>
						<div className="grid grid-cols-2 gap-2">
							<Button
								variant={selected.internetPolicy === 'never' ? 'default' : 'outline'}
								onClick={() => updateFieldSession(selected.id, { internetPolicy: 'never' })}
							>
								<WifiOff /> Nearby only
							</Button>
							<Button
								variant={selected.internetPolicy === 'ask' ? 'default' : 'outline'}
								onClick={() => updateFieldSession(selected.id, { internetPolicy: 'ask' })}
							>
								<UploadCloud /> Ask first
							</Button>
						</div>
						<p className="text-[10px] leading-relaxed text-muted-foreground">
							Internet publication is not enabled in this release. This setting records the
							session’s intent so queued and nearby delivery cannot be confused later.
						</p>
					</div>
					<div className="border border-amber-500/35 bg-amber-500/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
						<strong className="text-foreground">Access-controlled, not MLS private.</strong>{' '}
						Approved installations authenticate to the field host. Use a Private group when records
						require end-to-end group encryption.
					</div>
					<Button variant="destructive" className="w-full" onClick={() => void stopSession()}>
						<Square /> {selected.role === 'host' ? 'End on this device' : 'Leave this session'}
					</Button>
				</TabsContent>
			</Tabs>

			<InviteDialog invitation={invitation} open={inviteOpen} onOpenChange={setInviteOpen} />
		</div>
	)
}

function JoinDialog({
	open,
	onOpenChange,
	value,
	onChange,
	onJoin,
	busy,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	value: string
	onChange: (value: string) => void
	onJoin: () => void
	busy: boolean
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Join a Field session</DialogTitle>
					<DialogDescription>
						Paste the invite shown by the nearby field host. Internet is not required.
					</DialogDescription>
				</DialogHeader>
				<Textarea
					value={value}
					onChange={(event) => onChange(event.target.value)}
					placeholder="earthly://pair?..."
					rows={5}
				/>
				<Button onClick={onJoin} disabled={!value.trim() || busy}>
					{busy ? <Loader2 className="animate-spin" /> : <UserPlus />} Request access
				</Button>
			</DialogContent>
		</Dialog>
	)
}

function InviteDialog({
	invitation,
	open,
	onOpenChange,
}: {
	invitation: PairingInvitation | null
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	const link = invitation ? pairingInvitationLink(invitation.encoded) : ''
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(link)
			toast.success('Field-session invite copied')
		} catch {
			toast.error('Unable to copy the invite')
		}
	}
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Invite a nearby phone</DialogTitle>
					<DialogDescription>
						The invite is signed by this field host and expires after ten minutes.
					</DialogDescription>
				</DialogHeader>
				{invitation ? (
					<div className="space-y-3">
						<div className="mx-auto w-fit border border-border bg-white p-3">
							<QRCodeSVG value={link} size={220} level="M" />
						</div>
						<div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
							<Clock3 className="h-3 w-3" /> Expires at{' '}
							{new Date(invitation.expiresAt * 1000).toLocaleTimeString()}
						</div>
						<Button variant="outline" className="w-full" onClick={() => void copy()}>
							<Copy /> Copy invite link
						</Button>
					</div>
				) : null}
			</DialogContent>
		</Dialog>
	)
}
