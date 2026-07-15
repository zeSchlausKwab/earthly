import {
	Check,
	Copy,
	Laptop,
	Loader2,
	QrCode,
	RadioTower,
	RefreshCw,
	ShieldCheck,
	Smartphone,
	Unplug,
	WifiOff,
	X,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getLocalNodeService } from '@/platform/registry'
import type {
	LocalNodeService,
	LocalNodeStatus,
	PairingCapability,
	PairingInvitation,
	PendingPairingClaim,
	PeerGrant,
} from '@/platform/contracts'

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
	const [service, setService] = useState<LocalNodeService | null>(null)
	const [status, setStatus] = useState<LocalNodeStatus>({ state: 'starting' })
	const [invitation, setInvitation] = useState<PairingInvitation | null>(null)
	const [claims, setClaims] = useState<PendingPairingClaim[]>([])
	const [grants, setGrants] = useState<PeerGrant[]>([])
	const [operation, setOperation] = useState<string | null>(null)
	const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

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
		if (!service) return
		try {
			const nextStatus = await service.status()
			setStatus(nextStatus)
			if (nextStatus.state !== 'running') {
				setClaims([])
				setGrants([])
				return
			}
			const [nextClaims, nextGrants] = await Promise.all([
				service.pendingClaims(),
				service.peerGrants(),
			])
			setClaims(nextClaims)
			setGrants(nextGrants)
		} catch (error) {
			setStatus({ state: 'failed', message: errorMessage(error) })
		}
	}, [service])

	useEffect(() => {
		if (!service) return
		void refresh()
		if (!service.supported) return
		const refreshTimer = window.setInterval(() => void refresh(), 2_500)
		return () => window.clearInterval(refreshTimer)
	}, [refresh, service])

	useEffect(() => {
		if (!invitation) return
		const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1_000)
		return () => window.clearInterval(timer)
	}, [invitation])

	const remainingSeconds = useMemo(
		() => (invitation ? Math.max(0, invitation.expiresAt - nowSeconds) : 0),
		[invitation, nowSeconds],
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
			await refresh()
		})

	const copyInvitation = async () => {
		if (!invitation) return
		try {
			await navigator.clipboard.writeText(invitation.encoded)
			toast.success('Pairing invitation copied')
		} catch {
			toast.error('Unable to copy the pairing invitation')
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

			<div className="grid gap-4 border border-border p-4">
				<div className="space-y-3">
					<div className="flex items-start gap-2">
						<ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
						<div>
							<p className="text-sm font-semibold text-foreground">Pair another application</p>
							<p className="text-xs text-muted-foreground">
								Invitations expire after ten minutes and still require your approval.
							</p>
							{descriptor.scope === 'loopback' ? (
								<p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-400">
									This node is currently reachable only by other applications on this device.
								</p>
							) : null}
						</div>
					</div>
					{invitation ? (
						<>
							<CapabilityBadges capabilities={invitation.capabilities} />
							<div className="flex flex-wrap gap-2">
								<Button type="button" variant="outline" onClick={() => void copyInvitation()}>
									<Copy /> Copy invitation
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
							disabled={operation === 'invite'}
						>
							{operation === 'invite' ? <Loader2 className="animate-spin" /> : <QrCode />}
							Create pairing invitation
						</Button>
					)}
				</div>
				{invitation ? (
					<div className="justify-self-center border border-border bg-white p-2">
						<QRCodeSVG
							value={invitation.encoded}
							size={224}
							level="L"
							className="h-auto max-w-full"
							aria-label="Local-node pairing QR code"
						/>
					</div>
				) : null}
			</div>

			{claims.length > 0 ? (
				<section className="space-y-2" aria-labelledby="pairing-requests-heading">
					<div className="flex items-center justify-between">
						<h4
							id="pairing-requests-heading"
							className="text-xs font-semibold uppercase tracking-wide"
						>
							Pairing requests
						</h4>
						<Badge className="rounded-[2px]">{claims.length} pending</Badge>
					</div>
					{claims.map((claim) => (
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
				<h4 id="paired-devices-heading" className="text-xs font-semibold uppercase tracking-wide">
					Paired devices
				</h4>
				{grants.length === 0 ? (
					<div className="border border-dashed border-border p-4 text-sm text-muted-foreground">
						No applications have access to this node yet.
					</div>
				) : (
					grants.map((grant) => (
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
		</div>
	)
}
