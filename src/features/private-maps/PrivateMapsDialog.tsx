import type { NostrSigner } from '@contextvm/sdk'
import { useActiveAccount } from 'applesauce-react/hooks'
import {
	Check,
	Copy,
	Database,
	KeyRound,
	LockKeyhole,
	MapPinned,
	MessageSquareText,
	Plus,
	RefreshCw,
	ShieldCheck,
	UserMinus,
	UserPlus,
} from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import { config } from '@/config'
import {
	BrowserPrivateWorkspaceStore,
	CordnCoordinatorClient,
	PRIVATE_WORKSPACE_METADATA_KIND,
	PrivateWorkspaceService,
	type StoredWorkspace,
	type WorkspaceJoinRequest,
} from '@/lib/private-workspace'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { accounts } from '@/lib/nostr'
import { cn } from '@/lib/utils'

const browserStore = new BrowserPrivateWorkspaceStore()

function shortKey(value: string) {
	return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function invitationFromLocation() {
	if (typeof location === 'undefined') return ''
	return new URL(location.href).searchParams.get('private-invite') ?? ''
}

function describeDataset(content: string) {
	try {
		const parsed = JSON.parse(content) as { features?: unknown[] }
		return `${parsed.features?.length ?? 0} map feature${parsed.features?.length === 1 ? '' : 's'}`
	} catch {
		return 'Encrypted map dataset'
	}
}

export function PrivateMapsDialog() {
	const activeAccount = useActiveAccount()
	const [open, setOpen] = useState(false)
	const [busy, setBusy] = useState<string>()
	const [workspaces, setWorkspaces] = useState<StoredWorkspace[]>([])
	const [selectedId, setSelectedId] = useState<string>()
	const [joinRequests, setJoinRequests] = useState<WorkspaceJoinRequest[]>([])
	const [invitation] = useState(invitationFromLocation)
	const [joinSubmitted, setJoinSubmitted] = useState(false)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [basemap, setBasemap] = useState('Local PMTiles when available')
	const [chat, setChat] = useState('')
	const [markerName, setMarkerName] = useState('North trailhead')

	const service = useMemo(() => {
		const signer = accounts.signer
		if (!activeAccount || !signer || !config.cordnServerPubkey) return undefined
		return new PrivateWorkspaceService({
			signer: signer as NostrSigner,
			store: browserStore,
			coordinatorPubkey: config.cordnServerPubkey,
			relays: [...config.cordnRelays],
			createCoordinator: (options) => new CordnCoordinatorClient(options),
		})
	}, [activeAccount])

	const selected = workspaces.find((workspace) => workspace.workspaceId === selectedId)
	const messages = selected?.envelopes.filter(
		(envelope) => envelope.kind !== PRIVATE_WORKSPACE_METADATA_KIND,
	)
	const members = selected && service ? service.members(selected) : []

	const refreshLocal = useCallback(async () => {
		if (!service) {
			setWorkspaces([])
			return
		}
		const next = await service.listWorkspaces()
		setWorkspaces(next)
		setSelectedId((current) =>
			current && next.some((workspace) => workspace.workspaceId === current)
				? current
				: next[0]?.workspaceId,
		)
	}, [service])

	const run = async (label: string, action: () => Promise<void>) => {
		setBusy(label)
		try {
			await action()
		} catch (error) {
			console.error(`[private-maps] ${label} failed`, error)
			toast.error(error instanceof Error ? error.message : `Could not ${label}`)
		} finally {
			setBusy(undefined)
		}
	}

	const handleOpenChange = (next: boolean) => {
		setOpen(next)
		if (next) void refreshLocal()
	}

	const handleCreate = () =>
		run('create private map', async () => {
			if (!service) throw new Error('Sign in and configure a private-map coordinator first')
			const created = await service.createWorkspace({
				name,
				description: description || undefined,
				recommendedBasemap: basemap || undefined,
			})
			setName('')
			setDescription('')
			await refreshLocal()
			setSelectedId(created.workspaceId)
			toast.success('Private map created locally')
		})

	const handleCopyInvite = () =>
		run('create invitation', async () => {
			if (!service || !selected) return
			const token = await service.createInvitation(selected.workspaceId)
			const url = new URL(location.href)
			url.searchParams.set('private-invite', token)
			url.hash = ''
			await navigator.clipboard.writeText(url.toString())
			toast.success('Private-map invitation copied')
		})

	const handleRequestJoin = () =>
		run('request access', async () => {
			if (!service || !invitation) throw new Error('The invitation is missing or invalid')
			await service.requestToJoin(invitation)
			setJoinSubmitted(true)
			const url = new URL(location.href)
			url.searchParams.delete('private-invite')
			history.replaceState(history.state, '', url)
			toast.success('Join request sent. An administrator must approve this device.')
		})

	const handleWelcomes = () =>
		run('check invitations', async () => {
			if (!service) return
			const accepted = await service.acceptPendingWelcomes()
			await refreshLocal()
			if (accepted[0]) setSelectedId(accepted[0].workspaceId)
			toast.success(
				accepted.length > 0
					? `Joined ${accepted.length} private map${accepted.length === 1 ? '' : 's'}`
					: 'No approved invitations yet',
			)
		})

	const handleFetchRequests = () =>
		run('check join requests', async () => {
			if (!service || !selected) return
			setJoinRequests(await service.fetchJoinRequests(selected.workspaceId))
		})

	const handleApprove = (request: WorkspaceJoinRequest) =>
		run('approve member', async () => {
			if (!service) return
			await service.approveJoinRequest(request)
			setJoinRequests((current) => current.filter((item) => item.kp_ref !== request.kp_ref))
			await refreshLocal()
			toast.success('Device added and encrypted Welcome stored')
		})

	const handleSync = () =>
		run('sync private map', async () => {
			if (!service || !selected) return
			await service.syncWorkspace(selected.workspaceId)
			await refreshLocal()
			toast.success('Private map is current')
		})

	const handleSendChat = () =>
		run('send message', async () => {
			if (!service || !selected) return
			await service.sendChat(selected.workspaceId, chat)
			setChat('')
			await refreshLocal()
		})

	const handleMarker = () =>
		run('add private marker', async () => {
			if (!service || !selected) return
			await service.sendDemoDataset(selected.workspaceId, markerName)
			await refreshLocal()
			toast.success('Encrypted dataset posted')
		})

	const handleRemove = (pubkey: string) =>
		run('remove member', async () => {
			if (!service || !selected) return
			await service.removeMember(selected.workspaceId, pubkey)
			await refreshLocal()
			toast.success('Member removed from future epochs')
		})

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button
					aria-label="Open private maps"
					className="fixed right-3 bottom-3 z-40 h-9 gap-2 border border-amber-300/30 bg-zinc-950 px-3 text-amber-100 shadow-xl shadow-black/30 hover:bg-zinc-900 dark:bg-zinc-950"
				>
					<LockKeyhole className="size-4 text-amber-400" />
					Private maps
					<span className="size-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,.8)]" />
				</Button>
			</DialogTrigger>
			<DialogContent className="h-[min(820px,calc(100vh-2rem))] gap-0 overflow-hidden border-amber-400/20 bg-zinc-950 p-0 text-zinc-100 sm:max-w-[1080px]">
				<div className="grid h-full min-h-0 grid-rows-[auto_1fr]">
					<header className="border-b border-white/10 bg-zinc-950 px-5 py-4">
						<DialogHeader className="pr-10">
							<div className="flex flex-wrap items-center gap-2">
								<Badge className="rounded-sm bg-amber-400 text-zinc-950">FIELD VAULT</Badge>
								<Badge
									variant="outline"
									className="rounded-sm border-emerald-400/30 text-emerald-300"
								>
									<ShieldCheck /> MLS epoch protection
								</Badge>
								<Badge variant="outline" className="rounded-sm border-white/15 text-zinc-400">
									Browser demo
								</Badge>
							</div>
							<DialogTitle className="mt-2 text-xl font-semibold tracking-tight text-zinc-50">
								Private maps
							</DialogTitle>
							<DialogDescription className="max-w-2xl text-zinc-400">
								Map records are MLS-encrypted before Cordn stores them. Membership and traffic
								timing remain visible; browser state is not yet hardware-protected.
							</DialogDescription>
						</DialogHeader>
					</header>

					{!activeAccount ? (
						<div className="grid place-items-center p-8 text-center">
							<div className="max-w-sm">
								<KeyRound className="mx-auto mb-4 size-9 text-amber-400" />
								<h3 className="text-base font-medium">A Nostr account anchors membership</h3>
								<p className="mt-2 text-sm text-zinc-400">
									Sign in from Earthly’s account menu, then reopen Private maps.
								</p>
							</div>
						</div>
					) : !config.cordnServerPubkey ? (
						<div className="grid place-items-center p-8 text-center text-zinc-400">
							Set CORDN_SERVER_PUBKEY to enable private maps in this deployment.
						</div>
					) : (
						<div className="grid min-h-0 grid-cols-1 md:grid-cols-[250px_1fr]">
							<aside className="flex min-h-0 flex-col border-b border-white/10 bg-zinc-900/50 md:border-r md:border-b-0">
								<div className="space-y-2 border-b border-white/10 p-3">
									{invitation && !joinSubmitted && (
										<div className="border border-amber-400/30 bg-amber-400/5 p-3">
											<p className="text-xs font-medium text-amber-200">Invitation detected</p>
											<p className="mt-1 text-[11px] text-zinc-400">
												Publish this device’s KeyPackage for administrator approval.
											</p>
											<Button
												className="mt-2 w-full"
												onClick={handleRequestJoin}
												disabled={Boolean(busy)}
											>
												<UserPlus /> Request access
											</Button>
										</div>
									)}
									{joinSubmitted && (
										<div className="border border-emerald-400/20 bg-emerald-400/5 p-3 text-xs text-emerald-200">
											<Check className="mr-1 inline size-3" /> Request waiting for approval
										</div>
									)}
									<Button
										variant="outline"
										className="w-full"
										onClick={handleWelcomes}
										disabled={Boolean(busy)}
									>
										<RefreshCw className={cn(busy === 'check invitations' && 'animate-spin')} />
										Check approved invites
									</Button>
								</div>

								<ScrollArea className="min-h-24 flex-1 p-2">
									<div className="space-y-1 pr-2">
										{workspaces.map((workspace) => (
											<button
												type="button"
												key={workspace.workspaceId}
												onClick={() => {
													setSelectedId(workspace.workspaceId)
													setJoinRequests([])
												}}
												className={cn(
													'w-full border px-3 py-2 text-left transition-colors',
													selectedId === workspace.workspaceId
														? 'border-amber-400/40 bg-amber-400/10'
														: 'border-transparent hover:border-white/10 hover:bg-white/5',
												)}
											>
												<div className="flex items-center gap-2">
													<MapPinned className="size-3.5 text-amber-400" />
													<span className="truncate text-xs font-medium">
														{workspace.metadata?.name ?? 'Decrypting metadata…'}
													</span>
												</div>
												<div className="mt-1 flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
													<span>{workspace.role}</span>
													<span>MLS state secured</span>
												</div>
											</button>
										))}
										{workspaces.length === 0 && (
											<p className="px-3 py-4 text-xs text-zinc-500">
												No private maps in this profile.
											</p>
										)}
									</div>
								</ScrollArea>

								<div className="space-y-2 border-t border-white/10 p-3">
									<p className="text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-500">
										New private map
									</p>
									<Input
										aria-label="Private map name"
										placeholder="Map name"
										value={name}
										onChange={(e) => setName(e.target.value)}
									/>
									<Input
										aria-label="Private map description"
										placeholder="Description (encrypted)"
										value={description}
										onChange={(e) => setDescription(e.target.value)}
									/>
									<Input
										aria-label="Recommended basemap"
										placeholder="Recommended basemap"
										value={basemap}
										onChange={(e) => setBasemap(e.target.value)}
									/>
									<Button
										className="w-full"
										onClick={handleCreate}
										disabled={!name.trim() || Boolean(busy)}
									>
										<Plus /> Create private map
									</Button>
								</div>
							</aside>

							<main className="min-h-0 bg-zinc-900/30">
								{selected ? (
									<ScrollArea className="h-full">
										<div className="space-y-5 p-4 md:p-6">
											<section className="border border-white/10 bg-zinc-950/90 p-4">
												<div className="flex flex-wrap items-start justify-between gap-3">
													<div>
														<div className="flex items-center gap-2">
															<LockKeyhole className="size-4 text-amber-400" />
															<h2 className="text-lg font-semibold">
																{selected.metadata?.name ?? 'Private map'}
															</h2>
															<Badge
																variant={selected.status === 'active' ? 'outline' : 'destructive'}
																className="rounded-sm"
															>
																{selected.status}
															</Badge>
														</div>
														<p className="mt-1 max-w-xl text-xs text-zinc-400">
															{selected.metadata?.description || 'No description'}
														</p>
													</div>
													<div className="flex gap-2">
														<Button variant="outline" onClick={handleSync} disabled={Boolean(busy)}>
															<RefreshCw
																className={cn(busy === 'sync private map' && 'animate-spin')}
															/>{' '}
															Sync
														</Button>
														{selected.role === 'administrator' && (
															<Button
																variant="outline"
																onClick={handleCopyInvite}
																disabled={Boolean(busy)}
															>
																<Copy /> Copy invite
															</Button>
														)}
													</div>
												</div>
												<div className="mt-4 grid gap-2 text-[11px] text-zinc-400 sm:grid-cols-3">
													<div className="border border-white/10 bg-white/[.02] p-2">
														<span className="text-zinc-600">BASEMAP</span>
														<br />
														{selected.metadata?.recommendedBasemap ?? 'Member choice'}
													</div>
													<div className="border border-white/10 bg-white/[.02] p-2">
														<span className="text-zinc-600">COORDINATOR</span>
														<br />
														<code>{shortKey(selected.coordinatorPubkey)}</code>
													</div>
													<div className="border border-white/10 bg-white/[.02] p-2">
														<span className="text-zinc-600">CURSOR</span>
														<br />
														{selected.cursor} ordered messages
													</div>
												</div>
											</section>

											<div className="grid gap-4 lg:grid-cols-[1fr_280px]">
												<section className="space-y-3 border border-white/10 bg-zinc-950/90 p-4">
													<div className="flex items-center justify-between">
														<h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-[.14em] text-zinc-300">
															<Database className="size-3.5 text-amber-400" /> Encrypted activity
														</h3>
														<Badge variant="outline" className="rounded-sm">
															{messages?.length ?? 0} records
														</Badge>
													</div>
													<div className="max-h-56 space-y-2 overflow-y-auto pr-1">
														{messages?.map((message) => (
															<div
																key={message.id}
																className="border-l-2 border-amber-400/40 bg-white/[.03] px-3 py-2"
															>
																<div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-zinc-500">
																	<span>
																		{message.kind === GEO_EVENT_KIND ? 'Dataset' : 'Message'}
																	</span>
																	<code>{shortKey(message.pubkey)}</code>
																</div>
																<p className="mt-1 text-xs text-zinc-200">
																	{message.kind === GEO_EVENT_KIND
																		? describeDataset(message.content)
																		: message.content}
																</p>
															</div>
														))}
														{messages?.length === 0 && (
															<p className="py-6 text-center text-xs text-zinc-500">
																The encrypted timeline is empty.
															</p>
														)}
													</div>
													<Separator className="bg-white/10" />
													<div className="flex gap-2">
														<Textarea
															aria-label="Private map message"
															className="min-h-16"
															placeholder="Message the private map…"
															value={chat}
															onChange={(e) => setChat(e.target.value)}
														/>
														<Button
															className="h-auto px-3"
															onClick={handleSendChat}
															disabled={!chat.trim() || Boolean(busy)}
														>
															<MessageSquareText />
															<span className="sr-only">Send private message</span>
														</Button>
													</div>
													<div className="flex gap-2">
														<Input
															aria-label="Private marker name"
															value={markerName}
															onChange={(e) => setMarkerName(e.target.value)}
														/>
														<Button
															variant="outline"
															onClick={handleMarker}
															disabled={Boolean(busy)}
														>
															<MapPinned /> Add demo marker
														</Button>
													</div>
												</section>

												<section className="space-y-3 border border-white/10 bg-zinc-950/90 p-4">
													<div className="flex items-center justify-between">
														<h3 className="text-xs font-medium uppercase tracking-[.14em] text-zinc-300">
															Members / devices
														</h3>
														{selected.role === 'administrator' && (
															<Button
																size="xs"
																variant="outline"
																onClick={handleFetchRequests}
																disabled={Boolean(busy)}
															>
																<UserPlus /> Requests
															</Button>
														)}
													</div>
													<div className="space-y-2">
														{members.map((member) => (
															<div
																key={member}
																className="flex items-center justify-between border border-white/10 px-2 py-2 text-[11px]"
															>
																<div>
																	<code>{shortKey(member)}</code>
																	{member === selected.adminPubkey && (
																		<span className="ml-2 text-amber-300">ADMIN</span>
																	)}
																</div>
																{selected.role === 'administrator' &&
																	member !== activeAccount.pubkey && (
																		<Button
																			size="icon-xs"
																			variant="destructive"
																			aria-label={`Remove ${shortKey(member)}`}
																			onClick={() => handleRemove(member)}
																			disabled={Boolean(busy)}
																		>
																			<UserMinus />
																		</Button>
																	)}
															</div>
														))}
													</div>
													{joinRequests.length > 0 && <Separator className="bg-white/10" />}
													{joinRequests.map((request) => (
														<div
															key={request.kp_ref}
															className="border border-emerald-400/20 bg-emerald-400/5 p-2"
														>
															<p className="text-[10px] uppercase tracking-wider text-emerald-300">
																Pending device
															</p>
															<code className="text-[11px] text-zinc-300">
																{shortKey(request.pk)}
															</code>
															<Button
																className="mt-2 w-full"
																size="sm"
																onClick={() => handleApprove(request)}
																disabled={Boolean(busy)}
															>
																<Check /> Approve device
															</Button>
														</div>
													))}
													<p className="text-[10px] leading-relaxed text-zinc-600">
														Removal protects future epochs. It cannot erase data a former member
														already decrypted.
													</p>
												</section>
											</div>
										</div>
									</ScrollArea>
								) : (
									<div className="grid h-full place-items-center p-8 text-center">
										<div className="max-w-sm">
											<LockKeyhole className="mx-auto mb-3 size-8 text-zinc-600" />
											<h3 className="text-sm font-medium">Create or join a private map</h3>
											<p className="mt-2 text-xs text-zinc-500">
												The web app and Tauri shell use this same MLS workspace client.
											</p>
										</div>
									</div>
								)}
							</main>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	)
}
