import {
	AlertTriangle,
	Camera,
	Check,
	CheckCircle2,
	Clock3,
	Copy,
	Download,
	Laptop,
	Link2,
	Loader2,
	MapPinned,
	Network,
	QrCode,
	RadioTower,
	RefreshCw,
	ShieldCheck,
	Smartphone,
	Trash2,
	Unplug,
	Wifi,
	WifiOff,
	X,
} from 'lucide-react'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
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
import { eventStore } from '@/lib/nostr'
import { inspectPmtiles } from '@/lib/localPmtiles'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	consumePendingNativeDeepLink,
	getLocalNodeService,
	getPendingNativeDeepLink,
	NATIVE_DEEP_LINK_EVENT,
	notifyLocalBlobsChanged,
	type NativeDeepLinkDetail,
} from '@/platform/registry'
import type {
	LocalNodeService,
	LocalNodeStatus,
	NetworkAddress,
	PairingCapability,
	PairingInvitation,
	PendingPairingClaim,
	PeerGrant,
	RemoteNodeRecord,
} from '@/platform/contracts'
import {
	decodePairingQrImage,
	normalizePairingInvitation,
	pairingInvitationLink,
} from './pairingQr'

const LAN_SESSION_SECONDS = 15 * 60

const capabilityLabels: Record<PairingCapability, string> = {
	'relay-read': 'Read events',
	'relay-write': 'Publish events',
	'blob-read': 'Read files',
	'blob-list-own': 'List own files',
	'blob-write': 'Upload files',
	'blob-delete-own': 'Delete own files',
	'blob-mirror': 'Mirror files',
}

const shortKey = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function CapabilityBadges({ capabilities }: { capabilities: PairingCapability[] }) {
	return (
		<div className="flex flex-wrap gap-1.5">
			{capabilities.map((capability) => (
				<Badge key={capability} variant="outline" className="rounded-[2px] font-mono">
					{capabilityLabels[capability]}
				</Badge>
			))}
		</div>
	)
}

export function OfflineSharingSection() {
	const activeLocalBlobHash = useEditorStore((state) => state.mapSource.localBlobHash)
	const setMapSource = useEditorStore((state) => state.setMapSource)
	const [service, setService] = useState<LocalNodeService | null>(null)
	const [status, setStatus] = useState<LocalNodeStatus>({ state: 'starting' })
	const [invitation, setInvitation] = useState<PairingInvitation | null>(null)
	const [qrOpen, setQrOpen] = useState(false)
	const [claims, setClaims] = useState<PendingPairingClaim[]>([])
	const [grants, setGrants] = useState<PeerGrant[]>([])
	const [addresses, setAddresses] = useState<NetworkAddress[]>([])
	const [selectedAddress, setSelectedAddress] = useState('')
	const [remoteNodes, setRemoteNodes] = useState<RemoteNodeRecord[]>([])
	const [invitationInput, setInvitationInput] = useState('')
	const [pairingTab, setPairingTab] = useState<'share' | 'join'>('share')
	const [peerName, setPeerName] = useState('Earthly on this device')
	const [operation, setOperation] = useState<string | null>(null)
	const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
	const refreshInFlight = useRef(false)
	const scanInputRef = useRef<HTMLInputElement>(null)

	const acceptInvitationInput = useCallback((value: string): boolean => {
		const normalized = normalizePairingInvitation(value)
		if (!normalized) return false
		setInvitationInput(normalized)
		setPairingTab('join')
		return true
	}, [])

	useEffect(() => {
		const acceptNativeLink = (url: string) => {
			if (!acceptInvitationInput(url)) return
			consumePendingNativeDeepLink(url)
		}
		const pending = getPendingNativeDeepLink()
		if (pending) acceptNativeLink(pending)
		const onNativeLink = (event: Event) => {
			acceptNativeLink((event as CustomEvent<NativeDeepLinkDetail>).detail.url)
		}
		window.addEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
		return () => window.removeEventListener(NATIVE_DEEP_LINK_EVENT, onNativeLink)
	}, [acceptInvitationInput])

	useEffect(() => {
		let active = true
		void getLocalNodeService().then((next) => {
			if (active) setService(next)
		})
		return () => {
			active = false
		}
	}, [])

	const refresh = useCallback(async () => {
		if (!service || refreshInFlight.current) return
		refreshInFlight.current = true
		try {
			let nextStatus: LocalNodeStatus
			try {
				nextStatus = await service.status()
			} catch (error) {
				setStatus({ state: 'failed', message: errorMessage(error) })
				return
			}
			setStatus(nextStatus)
			if (nextStatus.state !== 'running') {
				setClaims([])
				setGrants([])
				setAddresses([])
				setRemoteNodes([])
				return
			}
			const [nextClaims, nextGrants, nextAddresses, storedRemoteNodes] = await Promise.allSettled([
				service.pendingClaims(),
				service.peerGrants(),
				service.networkAddresses(),
				service.remoteNodes(),
			])
			if (nextClaims.status === 'fulfilled') setClaims(nextClaims.value)
			if (nextGrants.status === 'fulfilled') setGrants(nextGrants.value)
			if (nextAddresses.status === 'fulfilled') {
				setAddresses(nextAddresses.value)
				setSelectedAddress((current) =>
					nextAddresses.value.some((candidate) => candidate.address === current)
						? current
						: (nextAddresses.value[0]?.address ?? ''),
				)
			}
			if (storedRemoteNodes.status === 'fulfilled') {
				const refreshedRemoteNodes = await Promise.all(
					storedRemoteNodes.value.map(async (remote) => {
						if (remote.status.state !== 'pending') return remote
						try {
							return await service.refreshRemoteNode(remote.nodeId)
						} catch {
							return remote
						}
					}),
				)
				setRemoteNodes(refreshedRemoteNodes)
			}
			setInvitation((current) => {
				if (!current) return current
				return current.descriptor.nodeId === nextStatus.descriptor.nodeId &&
					current.descriptor.scope === nextStatus.descriptor.scope
					? current
					: null
			})
		} finally {
			refreshInFlight.current = false
		}
	}, [service])

	useEffect(() => {
		if (!service) return
		void refresh()
		if (!service.supported) return
		const refreshTimer = window.setInterval(() => void refresh(), 3_000)
		return () => window.clearInterval(refreshTimer)
	}, [refresh, service])

	useEffect(() => {
		if (!invitation && !(status.state === 'running' && status.lanExpiresAt)) return
		const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1_000)
		return () => window.clearInterval(timer)
	}, [invitation, status])

	const remainingSeconds = useMemo(
		() => (invitation ? Math.max(0, invitation.expiresAt - nowSeconds) : 0),
		[invitation, nowSeconds],
	)
	const remainingLanSeconds = useMemo(
		() =>
			status.state === 'running' && status.lanExpiresAt
				? Math.max(0, status.lanExpiresAt - nowSeconds)
				: 0,
		[nowSeconds, status],
	)
	const globalClaims = useMemo(() => claims.filter((claim) => !claim.fieldSession), [claims])
	const globalGrants = useMemo(
		() => grants.filter((grant) => grant.capabilities.length > 0),
		[grants],
	)

	useEffect(() => {
		if (invitation && remainingSeconds === 0) setInvitation(null)
	}, [invitation, remainingSeconds])

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

	const createInvitation = () =>
		run('invite', async () => {
			if (!service) return
			setInvitation(await service.createInvitation())
			setQrOpen(true)
			await refresh()
		})

	const enableLan = () =>
		run('enable-lan', async () => {
			if (!service || !selectedAddress) return
			setStatus(await service.enableLan(selectedAddress, LAN_SESSION_SECONDS))
			setInvitation(null)
			toast.success('Local-network sharing is active for 15 minutes')
			await refresh()
		})

	const disableLan = () =>
		run('disable-lan', async () => {
			if (!service) return
			setStatus(await service.disableLan())
			setInvitation(null)
			toast.success('Local-network sharing stopped')
			await refresh()
		})

	const copyInvitation = async () => {
		if (!invitation) return
		try {
			await navigator.clipboard.writeText(pairingInvitationLink(invitation.encoded))
			toast.success('Pairing link copied')
		} catch {
			toast.error('Unable to copy the pairing link')
		}
	}

	const approve = (claim: PendingPairingClaim) =>
		run(`approve:${claim.claimId}`, async () => {
			if (!service) return
			await service.approveClaim(claim.claimId)
			toast.success(`${claim.peerName ?? 'Nearby device'} approved`)
			await refresh()
		})

	const reject = (claim: PendingPairingClaim) =>
		run(`reject:${claim.claimId}`, async () => {
			if (!service) return
			await service.rejectClaim(claim.claimId, 'Rejected by the Earthly host')
			toast.success('Pairing request rejected')
			await refresh()
		})

	const revoke = (grant: PeerGrant) =>
		run(`revoke:${grant.peerPubkey}`, async () => {
			if (!service) return
			await service.revokePeer(grant.peerPubkey)
			toast.success('Device access revoked')
			await refresh()
		})

	const joinInvitation = () =>
		run('join', async () => {
			if (!service) return
			const invitation = normalizePairingInvitation(invitationInput)
			if (!invitation) {
				throw new Error('Paste or scan an Earthly pairing invitation first')
			}
			const remote = await service.joinInvitation(invitation, peerName.trim() || undefined)
			setRemoteNodes((current) => [
				remote,
				...current.filter((candidate) => candidate.nodeId !== remote.nodeId),
			])
			setInvitationInput('')
			toast.success('Access requested — approve it on the host device')
		})

	const scanInvitation = (file: File) =>
		run('scan', async () => {
			acceptInvitationInput(await decodePairingQrImage(file))
			toast.success('Earthly pairing invitation scanned')
		})

	const refreshRemote = (remote: RemoteNodeRecord) =>
		run(`refresh-remote:${remote.nodeId}`, async () => {
			if (!service) return
			const refreshed = await service.refreshRemoteNode(remote.nodeId)
			setRemoteNodes((current) =>
				current.map((candidate) => (candidate.nodeId === refreshed.nodeId ? refreshed : candidate)),
			)
			if (refreshed.status.state === 'accepted') toast.success('Device pairing approved')
		})

	const forgetRemote = (remote: RemoteNodeRecord) =>
		run(`forget-remote:${remote.nodeId}`, async () => {
			if (!service) return
			await service.forgetRemoteNode(remote.nodeId)
			setRemoteNodes((current) => current.filter((candidate) => candidate.nodeId !== remote.nodeId))
			toast.success('Remote device removed from this installation')
		})

	const syncRemote = (remote: RemoteNodeRecord) =>
		run(`sync-remote:${remote.nodeId}`, async () => {
			if (!service) return
			const result = await service.syncRemoteNode(remote.nodeId)
			const verifiedEvents = result.events.map((event) => event as NostrEvent)
			if (!verifiedEvents.every((event) => verifyEvent(event))) {
				throw new Error('The native node returned an invalid signed event')
			}
			for (const event of verifiedEvents) eventStore.add(event)
			setRemoteNodes((current) =>
				current.map((candidate) =>
					candidate.nodeId === result.remoteNode.nodeId ? result.remoteNode : candidate,
				),
			)
			if (result.receivedEvents === 0) {
				toast.success('Map records are already up to date')
			} else {
				toast.success(
					`Synced ${result.receivedEvents} new map record${result.receivedEvents === 1 ? '' : 's'}`,
				)
			}
			if (result.eventsTruncated) {
				toast.warning(
					`${result.receivedEvents - result.hydratedEvents} additional records were saved in the local node but were not added to this view`,
				)
			}
		})

	const mirrorRemoteBlobs = (remote: RemoteNodeRecord) =>
		run(`mirror-remote:${remote.nodeId}`, async () => {
			if (!service) return
			const missingHashes = remote.discoveredBlobHashes.filter(
				(hash) => !remote.mirroredBlobHashes.includes(hash),
			)
			const batch = missingHashes.slice(0, 64)
			if (batch.length === 0) return
			const result = await service.mirrorRemoteBlobs(remote.nodeId, batch)
			setRemoteNodes((current) =>
				current.map((candidate) =>
					candidate.nodeId === result.remoteNode.nodeId ? result.remoteNode : candidate,
				),
			)
			notifyLocalBlobsChanged(result.items.map((item) => item.sha256))
			toast.success(
				`Saved ${result.items.length} referenced file${result.items.length === 1 ? '' : 's'} locally`,
			)
		})

	const activateMirroredBlobMap = (sha256: string) =>
		run(`use-map:${sha256}`, async () => {
			if (!service) return
			const url = await service.localBlobUrl(sha256)
			if (!url) throw new Error('This file is not available through Earthly’s local storage')
			const inspected = await inspectPmtiles(url)
			setMapSource({
				type: 'pmtiles',
				location: 'local',
				url,
				localBlobHash: sha256,
				pmtilesKind: inspected.kind,
				boundsLocked: true,
			})
			toast.success(
				`${inspected.kind === 'vector' ? 'Vector' : 'Raster'} offline map is now active`,
			)
		})

	if (!service || status.state === 'starting') {
		return (
			<div className="flex items-center gap-3 border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
				<Loader2 className="h-4 w-4 animate-spin text-primary" />
				Starting the local relay and file service…
			</div>
		)
	}

	if (status.state === 'unsupported') {
		return (
			<div className="grid gap-4 border border-dashed border-border bg-muted/35 p-4 sm:grid-cols-[auto_1fr]">
				<div className="flex h-10 w-10 items-center justify-center border border-border bg-card">
					<Laptop className="h-5 w-5 text-muted-foreground" />
				</div>
				<div className="space-y-1">
					<p className="text-sm font-semibold text-foreground">Native app required</p>
					<p className="text-sm text-muted-foreground">{status.reason}</p>
					<p className="text-xs text-muted-foreground">
						The web app can join ordinary relays, but it does not expose a local relay or file
						server to other applications.
					</p>
				</div>
			</div>
		)
	}

	if (status.state === 'failed') {
		return (
			<div className="space-y-3 border border-destructive/40 bg-destructive/5 p-4">
				<div className="flex items-start gap-3">
					<WifiOff className="mt-0.5 h-5 w-5 text-destructive" />
					<div>
						<p className="text-sm font-semibold text-foreground">Local node unavailable</p>
						<p className="text-sm text-muted-foreground">{status.message}</p>
					</div>
				</div>
				<Button type="button" variant="outline" onClick={() => void refresh()}>
					<RefreshCw /> Retry
				</Button>
			</div>
		)
	}

	const descriptor = status.descriptor
	const lanAddress = new URL(descriptor.relayUrl).hostname

	return (
		<div className="space-y-4">
			<div className="grid gap-3 border border-border bg-muted/30 p-3 sm:grid-cols-3">
				<div className="sm:col-span-3 flex items-center gap-2 border-b border-border pb-3">
					<span className="relative flex h-9 w-9 items-center justify-center bg-emerald-500/10 text-emerald-600">
						<RadioTower className="h-4 w-4" />
						<span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-emerald-500" />
					</span>
					<div>
						<p className="text-sm font-semibold text-foreground">Local node running</p>
						<p className="text-xs text-muted-foreground">
							Available while Earthly is open on this device
						</p>
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="ml-auto"
						onClick={() => void refresh()}
						aria-label="Refresh local node"
					>
						<RefreshCw />
					</Button>
				</div>
				<div>
					<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
						Node identity
					</p>
					<p className="mt-1 font-mono text-xs text-foreground" title={descriptor.nodeId}>
						{shortKey(descriptor.nodeId)}
					</p>
				</div>
				<div>
					<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
						Reachability
					</p>
					<p className="mt-1 text-xs text-foreground">
						{descriptor.scope === 'loopback' ? 'This device only' : 'Local network'}
					</p>
				</div>
				<div>
					<p className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
						Paired devices
					</p>
					<p className="mt-1 text-xs text-foreground">{grants.length}</p>
				</div>
			</div>

			<Tabs
				value={pairingTab}
				onValueChange={(value) => setPairingTab(value as 'share' | 'join')}
				className="space-y-4"
			>
				<TabsList className="grid h-auto w-full grid-cols-2 rounded-none border border-border bg-muted/40 p-1">
					<TabsTrigger value="share" className="rounded-none">
						<RadioTower /> Share this device
					</TabsTrigger>
					<TabsTrigger value="join" className="rounded-none">
						<Link2 /> Join a device
					</TabsTrigger>
				</TabsList>

				<TabsContent value="share" className="mt-0 space-y-4">
					<section
						className="space-y-3 border border-border p-4"
						aria-labelledby="lan-sharing-heading"
					>
						<div className="flex items-start gap-2">
							<Network className="mt-0.5 h-4 w-4 text-primary" />
							<div className="min-w-0 flex-1">
								<h4 id="lan-sharing-heading" className="text-sm font-semibold">
									Local-network reachability
								</h4>
								<p className="text-xs text-muted-foreground">
									Both devices may use the same Wi-Fi or a phone hotspot; internet is not required.
								</p>
							</div>
						</div>
						{descriptor.scope === 'local-network' ? (
							<div className="space-y-3 border border-emerald-500/35 bg-emerald-500/5 p-3">
								<div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
									<Wifi className="h-4 w-4" />
									<span className="text-sm font-semibold">Serving on {lanAddress}</span>
								</div>
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="flex items-center gap-1 font-mono text-[10px] text-muted-foreground">
										<Clock3 className="h-3 w-3" />
										Stops in {Math.floor(remainingLanSeconds / 60)}:
										{String(remainingLanSeconds % 60).padStart(2, '0')}
									</span>
									<Button
										type="button"
										variant="outline"
										onClick={() => void disableLan()}
										disabled={operation !== null}
									>
										<WifiOff /> Stop serving
									</Button>
								</div>
							</div>
						) : addresses.length > 0 ? (
							<div className="space-y-2">
								<Label htmlFor="offline-lan-address">Network address</Label>
								<Select value={selectedAddress} onValueChange={setSelectedAddress}>
									<SelectTrigger id="offline-lan-address" className="w-full rounded-none">
										<SelectValue placeholder="Choose a local address" />
									</SelectTrigger>
									<SelectContent>
										{addresses.map((candidate) => (
											<SelectItem key={candidate.address} value={candidate.address}>
												{candidate.address} · {candidate.interfaceName}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								<Button
									type="button"
									onClick={() => void enableLan()}
									disabled={!selectedAddress || operation !== null}
									className="w-full"
								>
									{operation === 'enable-lan' ? <Loader2 className="animate-spin" /> : <Wifi />}
									Serve for 15 minutes
								</Button>
							</div>
						) : (
							<div className="space-y-2 border border-dashed border-border p-3 text-xs text-muted-foreground">
								<p>Join Wi-Fi or enable a hotspot to make this device reachable.</p>
								<Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
									<RefreshCw /> Check again
								</Button>
							</div>
						)}
					</section>

					<section
						className="grid gap-4 border border-border p-4"
						aria-labelledby="invite-device-heading"
					>
						<div className="space-y-3">
							<div className="flex items-start gap-2">
								<ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
								<div>
									<h4 id="invite-device-heading" className="text-sm font-semibold">
										Invite another Earthly device
									</h4>
									<p className="text-xs text-muted-foreground">
										The invitation expires after ten minutes and still requires approval here.
									</p>
								</div>
							</div>
							{descriptor.scope === 'loopback' ? (
								<p className="flex items-start gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									Turn on local-network reachability above before inviting another device.
								</p>
							) : null}
							{invitation ? (
								<>
									<CapabilityBadges capabilities={invitation.capabilities} />
									<div className="flex flex-wrap gap-2">
										<Button type="button" onClick={() => setQrOpen(true)}>
											<QrCode /> Show large QR
										</Button>
										<Button type="button" variant="outline" onClick={() => void copyInvitation()}>
											<Copy /> Copy app link
										</Button>
										<Button type="button" variant="ghost" onClick={() => void createInvitation()}>
											<RefreshCw /> Replace
										</Button>
									</div>
									<p className="font-mono text-[10px] text-muted-foreground">
										Expires in {Math.floor(remainingSeconds / 60)}:
										{String(remainingSeconds % 60).padStart(2, '0')}
									</p>
								</>
							) : (
								<Button
									type="button"
									onClick={() => void createInvitation()}
									disabled={descriptor.scope !== 'local-network' || operation !== null}
								>
									{operation === 'invite' ? <Loader2 className="animate-spin" /> : <QrCode />}
									Create pairing invitation
								</Button>
							)}
						</div>
						{invitation ? (
							<div className="justify-self-center border border-border bg-white p-3">
								<QRCodeSVG
									value={pairingInvitationLink(invitation.encoded)}
									size={288}
									level="L"
									marginSize={4}
									className="h-auto max-w-full"
									aria-label="Local-node pairing QR code"
								/>
							</div>
						) : null}
					</section>

					{globalClaims.length > 0 ? (
						<section className="space-y-2" aria-labelledby="pairing-requests-heading">
							<div className="flex items-center justify-between">
								<h4
									id="pairing-requests-heading"
									className="text-xs font-semibold uppercase tracking-wide"
								>
									Pairing requests
								</h4>
								<Badge className="rounded-[2px]">{globalClaims.length} pending</Badge>
							</div>
							{globalClaims.map((claim) => (
								<div
									key={claim.claimId}
									className="space-y-3 border border-primary/40 bg-primary/5 p-3"
								>
									<div className="flex items-start gap-2">
										<Smartphone className="mt-0.5 h-4 w-4 text-primary" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold text-foreground">
												{claim.peerName ?? 'Unnamed nearby device'}
											</p>
											<p
												className="font-mono text-[10px] text-muted-foreground"
												title={claim.peerPubkey}
											>
												{shortKey(claim.peerPubkey)}
											</p>
										</div>
									</div>
									<CapabilityBadges capabilities={claim.requestedCapabilities} />
									<div className="flex gap-2">
										<Button
											type="button"
											onClick={() => void approve(claim)}
											disabled={operation !== null}
										>
											{operation === `approve:${claim.claimId}` ? (
												<Loader2 className="animate-spin" />
											) : (
												<Check />
											)}
											Approve
										</Button>
										<Button
											type="button"
											variant="outline"
											onClick={() => void reject(claim)}
											disabled={operation !== null}
										>
											<X /> Reject
										</Button>
									</div>
								</div>
							))}
						</section>
					) : null}

					<section className="space-y-2" aria-labelledby="paired-devices-heading">
						<h4
							id="paired-devices-heading"
							className="text-xs font-semibold uppercase tracking-wide"
						>
							Applications with access
						</h4>
						{globalGrants.length === 0 ? (
							<div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
								No applications have access to this node yet.
							</div>
						) : (
							globalGrants.map((grant) => (
								<div key={grant.peerPubkey} className="space-y-2 border border-border p-3">
									<div className="flex items-center gap-2">
										<Smartphone className="h-4 w-4 text-muted-foreground" />
										<span
											className="min-w-0 flex-1 truncate font-mono text-xs"
											title={grant.peerPubkey}
										>
											{shortKey(grant.peerPubkey)}
										</span>
										<Button
											type="button"
											variant="destructive"
											size="sm"
											onClick={() => void revoke(grant)}
											disabled={operation !== null}
										>
											<Unplug /> Revoke
										</Button>
									</div>
									<CapabilityBadges capabilities={grant.capabilities} />
								</div>
							))
						)}
					</section>
				</TabsContent>

				<TabsContent value="join" className="mt-0 space-y-4">
					<section
						className="space-y-4 border border-border p-4"
						aria-labelledby="join-device-heading"
					>
						<div className="flex items-start gap-2">
							<Smartphone className="mt-0.5 h-4 w-4 text-primary" />
							<div>
								<h4 id="join-device-heading" className="text-sm font-semibold">
									Request access
								</h4>
								<p className="text-xs text-muted-foreground">
									Scan the QR shown by the host, or paste its invitation. The host must approve this
									installation.
								</p>
							</div>
						</div>
						<div className="space-y-2">
							<Label htmlFor="offline-peer-name">Device name shown to the host</Label>
							<Input
								id="offline-peer-name"
								value={peerName}
								maxLength={128}
								onChange={(event) => setPeerName(event.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="offline-pairing-invitation">Pairing invitation</Label>
							<Textarea
								id="offline-pairing-invitation"
								value={invitationInput}
								onChange={(event) => setInvitationInput(event.target.value)}
								placeholder="earthly://pair?invitation=… or earthly-pair-v1:…"
								className="min-h-24 break-all font-mono text-[10px]"
							/>
						</div>
						<input
							ref={scanInputRef}
							type="file"
							accept="image/*"
							capture="environment"
							className="sr-only"
							aria-label="Choose a pairing QR image"
							onChange={(event) => {
								const file = event.target.files?.[0]
								if (file) void scanInvitation(file)
								event.target.value = ''
							}}
						/>
						<div className="grid gap-2 sm:grid-cols-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => scanInputRef.current?.click()}
								disabled={operation !== null}
							>
								{operation === 'scan' ? <Loader2 className="animate-spin" /> : <Camera />}
								Scan QR image
							</Button>
							<Button
								type="button"
								onClick={() => void joinInvitation()}
								disabled={!normalizePairingInvitation(invitationInput) || operation !== null}
							>
								{operation === 'join' ? <Loader2 className="animate-spin" /> : <Link2 />}
								Request access
							</Button>
						</div>
					</section>

					<section className="space-y-2" aria-labelledby="joined-devices-heading">
						<div className="flex items-center justify-between">
							<h4
								id="joined-devices-heading"
								className="text-xs font-semibold uppercase tracking-wide"
							>
								Joined devices
							</h4>
							<Badge variant="outline" className="rounded-[2px]">
								{remoteNodes.length}
							</Badge>
						</div>
						{remoteNodes.length === 0 ? (
							<div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
								This installation has not joined another Earthly node yet.
							</div>
						) : (
							remoteNodes.map((remote) => {
								const missingBlobHashes = remote.discoveredBlobHashes.filter(
									(hash) => !remote.mirroredBlobHashes.includes(hash),
								)
								const mirrorBatchSize = Math.min(missingBlobHashes.length, 64)
								return (
									<div key={remote.nodeId} className="space-y-3 border border-border p-3">
										<div className="flex items-start gap-2">
											{remote.status.state === 'accepted' ? (
												<CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
											) : remote.status.state === 'rejected' ? (
												<X className="mt-0.5 h-4 w-4 text-destructive" />
											) : (
												<Clock3 className="mt-0.5 h-4 w-4 text-amber-600" />
											)}
											<div className="min-w-0 flex-1">
												<p className="text-sm font-semibold">
													{remote.status.state === 'accepted'
														? 'Connected Earthly node'
														: remote.status.state === 'rejected'
															? 'Request rejected'
															: 'Waiting for host approval'}
												</p>
												<p
													className="truncate font-mono text-[10px] text-muted-foreground"
													title={remote.nodeId}
												>
													{shortKey(remote.nodeId)} · {new URL(remote.descriptor.relayUrl).hostname}
												</p>
											</div>
										</div>
										{remote.status.state === 'rejected' ? (
											<p className="text-xs text-destructive">{remote.status.reason}</p>
										) : null}
										<CapabilityBadges capabilities={remote.capabilities} />
										{remote.lastSync ? (
											<p className="text-xs text-muted-foreground">
												Last sync {new Date(remote.lastSync.syncedAt * 1000).toLocaleString()} ·{' '}
												{remote.lastSync.receivedEvents} new
											</p>
										) : null}
										{remote.discoveredBlobHashes.length > 0 ? (
											<div className="space-y-2 border border-border bg-muted/30 p-2.5">
												<p className="text-xs font-medium text-foreground">
													{remote.mirroredBlobHashes.length} of {remote.discoveredBlobHashes.length}{' '}
													referenced files saved locally
												</p>
												<p className="text-[11px] text-muted-foreground">
													Files are copied by verified SHA-256 hash; arbitrary links in map records
													are not opened.
												</p>
												{remote.mirroredBlobHashes.length > 0 ? (
													<div className="max-h-44 space-y-1 overflow-y-auto">
														{remote.mirroredBlobHashes.map((sha256) => {
															const isActive = activeLocalBlobHash === sha256
															return (
																<div
																	key={sha256}
																	className="flex items-center gap-2 border border-border bg-card p-2"
																>
																	<MapPinned className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
																	<span
																		className="min-w-0 flex-1 truncate font-mono text-[10px]"
																		title={sha256}
																	>
																		{shortKey(sha256)}
																	</span>
																	<Button
																		type="button"
																		variant={isActive ? 'secondary' : 'outline'}
																		size="sm"
																		onClick={() => void activateMirroredBlobMap(sha256)}
																		disabled={isActive || operation !== null}
																	>
																		{operation === `use-map:${sha256}` ? (
																			<Loader2 className="animate-spin" />
																		) : (
																			<MapPinned />
																		)}
																		{isActive ? 'Active map' : 'Use as map'}
																	</Button>
																</div>
															)
														})}
													</div>
												) : null}
												{mirrorBatchSize > 0 && remote.capabilities.includes('blob-read') ? (
													<Button
														type="button"
														variant="outline"
														size="sm"
														onClick={() => void mirrorRemoteBlobs(remote)}
														disabled={operation !== null}
													>
														{operation === `mirror-remote:${remote.nodeId}` ? (
															<Loader2 className="animate-spin" />
														) : (
															<Download />
														)}
														Mirror {mirrorBatchSize} referenced file
														{mirrorBatchSize === 1 ? '' : 's'}
													</Button>
												) : null}
											</div>
										) : null}
										{remote.status.state === 'accepted' &&
										!remote.capabilities.includes('relay-read') ? (
											<p className="text-xs text-amber-700 dark:text-amber-400">
												This older grant cannot read map records. Create a new invitation on the
												host to add read access.
											</p>
										) : null}
										<div className="flex flex-wrap gap-2">
											{remote.status.state === 'pending' ? (
												<Button
													type="button"
													variant="outline"
													size="sm"
													onClick={() => void refreshRemote(remote)}
													disabled={operation !== null}
												>
													<RefreshCw /> Check approval
												</Button>
											) : null}
											{remote.status.state === 'accepted' &&
											remote.capabilities.includes('relay-read') ? (
												<Button
													type="button"
													size="sm"
													onClick={() => void syncRemote(remote)}
													disabled={operation !== null}
												>
													{operation === `sync-remote:${remote.nodeId}` ? (
														<Loader2 className="animate-spin" />
													) : (
														<Download />
													)}
													Sync map records
												</Button>
											) : null}
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={() => void forgetRemote(remote)}
												disabled={operation !== null}
											>
												<Trash2 /> Forget
											</Button>
										</div>
									</div>
								)
							})
						)}
					</section>
				</TabsContent>
			</Tabs>

			<Dialog open={qrOpen && invitation !== null} onOpenChange={setQrOpen}>
				<DialogContent
					className="max-h-[calc(100dvh-2rem)] overflow-auto rounded-none sm:max-w-xl"
					onEscapeKeyDown={(event) => event.stopPropagation()}
				>
					<DialogHeader>
						<DialogTitle>Scan with the other Earthly device</DialogTitle>
						<DialogDescription>
							Keep both devices on the same Wi-Fi or hotspot. The request still appears here for
							approval.
						</DialogDescription>
					</DialogHeader>
					{invitation ? (
						<div className="mx-auto w-full max-w-[512px] border border-border bg-white p-2">
							<QRCodeSVG
								value={invitation.encoded}
								size={512}
								level="L"
								marginSize={4}
								className="h-auto w-full"
								aria-label="Expanded pairing QR code"
							/>
						</div>
					) : null}
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="font-mono text-[10px] text-muted-foreground">
							Expires in {Math.floor(remainingSeconds / 60)}:
							{String(remainingSeconds % 60).padStart(2, '0')}
						</p>
						<Button type="button" variant="outline" onClick={() => void copyInvitation()}>
							<Copy /> Copy instead
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</div>
	)
}
