import type { NostrSigner } from '@contextvm/sdk'
import { useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowLeft,
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
	UsersRound,
} from 'lucide-react'
import { useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
	EmbeddedListPanelContext,
	GlyphTile,
	ListPanel,
	ListRow,
	RowBadge,
} from '@/components/entity-list'
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { useRouting } from '@/features/geo-editor/hooks/useRouting'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { accounts } from '@/lib/nostr'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
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

function PanelNotice({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-start gap-2 rounded-[2px] border border-border bg-muted/35 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
			<ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
			<span>{children}</span>
		</div>
	)
}

export function PrivateGroupsPanel() {
	const activeAccount = useActiveAccount()
	const embedded = useContext(EmbeddedListPanelContext)
	const { privateGroupId, navigateToPrivateGroup, navigateToView } = useRouting()
	const [busy, setBusy] = useState<string>()
	const [loaded, setLoaded] = useState(false)
	const [workspaces, setWorkspaces] = useState<StoredWorkspace[]>([])
	const [pendingWorkspaceIds, setPendingWorkspaceIds] = useState<Set<string>>(new Set())
	const [joinRequestState, setJoinRequestState] = useState<{
		workspaceId: string
		requests: WorkspaceJoinRequest[]
	}>({ workspaceId: '', requests: [] })
	const [invitation] = useState(invitationFromLocation)
	const [showCreate, setShowCreate] = useState(false)
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

	const selected = privateGroupId
		? workspaces.find((workspace) => workspace.workspaceId === privateGroupId)
		: undefined
	const messages = selected?.envelopes.filter(
		(envelope) => envelope.kind !== PRIVATE_WORKSPACE_METADATA_KIND,
	)
	const joinRequests =
		joinRequestState.workspaceId === privateGroupId ? joinRequestState.requests : []
	const members = selected && service ? service.members(selected) : []
	const pendingForRoute = Boolean(privateGroupId && pendingWorkspaceIds.has(privateGroupId))

	const refreshLocal = useCallback(async () => {
		if (!service) {
			setWorkspaces([])
			setPendingWorkspaceIds(new Set())
			setLoaded(true)
			return
		}
		const [next, pending] = await Promise.all([
			service.listWorkspaces(),
			service.listPendingJoins(),
		])
		setWorkspaces(next)
		setPendingWorkspaceIds(new Set(pending.map((item) => item.workspaceId)))
		setLoaded(true)
	}, [service])

	useEffect(() => {
		void refreshLocal()
	}, [refreshLocal])

	const run = async (label: string, action: () => Promise<void>) => {
		setBusy(label)
		try {
			await action()
		} catch (error) {
			console.error(`[private-groups] ${label} failed`, error)
			toast.error(error instanceof Error ? error.message : `Could not ${label}`)
		} finally {
			setBusy(undefined)
		}
	}

	const handleCreate = () =>
		run('create private group', async () => {
			if (!service) throw new Error('Sign in and configure a private-group coordinator first')
			const created = await service.createWorkspace({
				name,
				description: description || undefined,
				recommendedBasemap: basemap || undefined,
			})
			setName('')
			setDescription('')
			setShowCreate(false)
			await refreshLocal()
			navigateToPrivateGroup(created.workspaceId)
			toast.success('Private group created locally')
		})

	const handleCopyInvite = () =>
		run('create invitation', async () => {
			if (!service || !selected) return
			const token = await service.createInvitation(selected.workspaceId)
			const url = new URL(location.href)
			url.pathname = `/privategroup/${encodeURIComponent(selected.workspaceId)}`
			url.search = ''
			url.hash = ''
			url.searchParams.set('private-invite', token)
			await navigator.clipboard.writeText(url.toString())
			toast.success('Private-group invitation copied')
		})

	const handleRequestJoin = () =>
		run('request access', async () => {
			if (!service || !invitation) throw new Error('The invitation is missing or invalid')
			const pending = await service.requestToJoin(invitation)
			await refreshLocal()
			navigateToPrivateGroup(pending.workspaceId)
			const url = new URL(location.href)
			url.pathname = `/privategroup/${encodeURIComponent(pending.workspaceId)}`
			url.searchParams.delete('private-invite')
			history.replaceState(history.state, '', url)
			toast.success('Join request sent. An administrator must approve this device.')
		})

	const handleWelcomes = () =>
		run('check invitations', async () => {
			if (!service) return
			const accepted = await service.acceptPendingWelcomes()
			await refreshLocal()
			if (accepted[0]) navigateToPrivateGroup(accepted[0].workspaceId)
			toast.success(
				accepted.length > 0
					? `Joined ${accepted.length} private group${accepted.length === 1 ? '' : 's'}`
					: 'No approved invitations yet',
			)
		})

	const handleFetchRequests = () =>
		run('check join requests', async () => {
			if (!service || !selected) return
			setJoinRequestState({
				workspaceId: selected.workspaceId,
				requests: await service.fetchJoinRequests(selected.workspaceId),
			})
		})

	const handleApprove = (request: WorkspaceJoinRequest) =>
		run('approve member', async () => {
			if (!service) return
			await service.approveJoinRequest(request)
			setJoinRequestState((current) => ({
				...current,
				requests: current.requests.filter((item) => item.kp_ref !== request.kp_ref),
			}))
			await refreshLocal()
			toast.success('Member added and encrypted Welcome stored')
		})

	const handleSync = () =>
		run('sync private group', async () => {
			if (!service || !selected) return
			await service.syncWorkspace(selected.workspaceId)
			await refreshLocal()
			toast.success('Private group is current')
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

	if (!activeAccount) {
		return (
			<div className="p-2">
				<SignedOutCta
					title="Private groups"
					description="Sign in to create or join an MLS-protected mapping group."
				/>
			</div>
		)
	}

	if (!config.cordnServerPubkey) {
		return (
			<div className="grid h-full place-items-center p-5 text-center">
				<div>
					<KeyRound className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
					<p className="text-sm font-medium text-foreground">Private groups are unavailable</p>
					<p className="mt-1 text-xs text-muted-foreground">
						Configure CORDN_SERVER_PUBKEY for this deployment.
					</p>
				</div>
			</div>
		)
	}

	if (privateGroupId) {
		return (
			<div className="flex h-full min-h-0 flex-col">
				<button
					type="button"
					onClick={() => navigateToView('private-groups')}
					className="flex w-full shrink-0 items-center gap-1.5 border-b border-border px-2 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
				>
					<ArrowLeft className="h-3.5 w-3.5" />
					Back to Private groups
				</button>

				<div className="min-h-0 flex-1 overflow-y-auto px-1 py-2 [scrollbar-gutter:stable]">
					{!loaded ? (
						<p className="px-2 py-6 text-center text-xs text-muted-foreground">
							Opening encrypted group…
						</p>
					) : selected ? (
						<div className="space-y-4">
							<section className="space-y-3 border-b border-border px-2 pb-4">
								<div className="flex items-start gap-2">
									<GlyphTile icon={LockKeyhole} className="bg-primary/15 text-primary" />
									<div className="min-w-0 flex-1">
										<div className="flex items-center gap-1.5">
											<h2 className="truncate text-sm font-semibold text-foreground">
												{selected.metadata?.name ?? 'Private group'}
											</h2>
											<RowBadge
												label={selected.status}
												className={
													selected.status === 'active'
														? 'bg-ok/15 text-ok'
														: 'bg-destructive/15 text-destructive'
												}
											/>
										</div>
										<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
											{selected.metadata?.description || 'No description'}
										</p>
									</div>
								</div>

								<div className="grid grid-cols-2 gap-1.5">
									<Button variant="outline" size="sm" onClick={handleSync} disabled={Boolean(busy)}>
										<RefreshCw className={cn(busy === 'sync private group' && 'animate-spin')} />
										Sync
									</Button>
									{selected.role === 'administrator' ? (
										<Button
											variant="outline"
											size="sm"
											onClick={handleCopyInvite}
											disabled={Boolean(busy)}
										>
											<Copy /> Invite
										</Button>
									) : null}
								</div>

								<div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-border bg-border font-mono text-[9.5px]">
									<div className="bg-card p-2">
										<span className="text-muted-foreground">ROLE</span>
										<div className="mt-0.5 text-foreground">{selected.role}</div>
									</div>
									<div className="bg-card p-2">
										<span className="text-muted-foreground">CURSOR</span>
										<div className="mt-0.5 text-foreground">{selected.cursor} messages</div>
									</div>
									<div className="col-span-2 bg-card p-2">
										<span className="text-muted-foreground">BASEMAP</span>
										<div className="mt-0.5 truncate text-foreground">
											{selected.metadata?.recommendedBasemap ?? 'Member choice'}
										</div>
									</div>
								</div>
								<PanelNotice>
									MLS encrypts map records before the Cordn ContextVM coordinator stores them.
								</PanelNotice>
							</section>

							<section className="space-y-2 px-2">
								<div className="flex items-center gap-2">
									<Database className="h-3.5 w-3.5 text-primary" />
									<h3 className="text-xs font-semibold text-foreground">Encrypted activity</h3>
									<span className="ml-auto font-mono text-[9px] text-muted-foreground">
										{messages?.length ?? 0} records
									</span>
								</div>
								<div className="divide-y divide-border border-y border-border">
									{messages?.map((message) => (
										<div key={message.id} className="py-2">
											<div className="flex items-center gap-2 font-mono text-[9px] uppercase text-muted-foreground">
												<span>{message.kind === GEO_EVENT_KIND ? 'Dataset' : 'Message'}</span>
												<code className="ml-auto">{shortKey(message.pubkey)}</code>
											</div>
											<p className="mt-1 break-words text-xs text-foreground">
												{message.kind === GEO_EVENT_KIND
													? describeDataset(message.content)
													: message.content}
											</p>
										</div>
									))}
									{messages?.length === 0 ? (
										<p className="py-5 text-center text-xs text-muted-foreground">
											No encrypted activity yet.
										</p>
									) : null}
								</div>
								<div className="flex gap-1.5">
									<Textarea
										aria-label="Private group message"
										className="min-h-14 resize-none text-xs"
										placeholder="Message this private group…"
										value={chat}
										onChange={(event) => setChat(event.target.value)}
									/>
									<Button
										size="icon"
										className="h-auto shrink-0 rounded-[2px]"
										onClick={handleSendChat}
										disabled={!chat.trim() || Boolean(busy)}
										aria-label="Send private message"
									>
										<MessageSquareText />
									</Button>
								</div>
								<div className="flex gap-1.5">
									<Input
										aria-label="Private marker name"
										className="h-8 text-xs"
										value={markerName}
										onChange={(event) => setMarkerName(event.target.value)}
									/>
									<Button
										variant="outline"
										size="sm"
										className="shrink-0"
										onClick={handleMarker}
										disabled={Boolean(busy)}
									>
										<MapPinned /> Demo point
									</Button>
								</div>
							</section>

							<section className="space-y-2 border-t border-border px-2 pt-4">
								<div className="flex items-center gap-2">
									<UsersRound className="h-3.5 w-3.5 text-primary" />
									<h3 className="text-xs font-semibold text-foreground">Members</h3>
									{selected.role === 'administrator' ? (
										<Button
											className="ml-auto h-6 text-[10px]"
											size="sm"
											variant="outline"
											onClick={handleFetchRequests}
											disabled={Boolean(busy)}
										>
											<UserPlus /> Requests
										</Button>
									) : null}
								</div>
								<div className="divide-y divide-border border-y border-border">
									{members.map((member) => (
										<div key={member} className="flex items-center gap-2 py-2 text-[11px]">
											<code className="truncate">{shortKey(member)}</code>
											{member === selected.adminPubkey ? (
												<RowBadge label="admin" className="bg-primary/15 text-primary" />
											) : null}
											{selected.role === 'administrator' && member !== activeAccount.pubkey ? (
												<Button
													className="ml-auto"
													size="icon-xs"
													variant="ghost"
													aria-label={`Remove ${shortKey(member)}`}
													onClick={() => handleRemove(member)}
													disabled={Boolean(busy)}
												>
													<UserMinus className="text-destructive" />
												</Button>
											) : null}
										</div>
									))}
								</div>
								{joinRequests.map((request) => (
									<div
										key={request.kp_ref}
										className="rounded-[2px] border border-ok/30 bg-ok/5 p-2"
									>
										<p className="font-mono text-[9px] uppercase text-ok">Pending member</p>
										<code className="text-[10px]">{shortKey(request.pk)}</code>
										<Button
											className="mt-2 w-full"
											size="sm"
											onClick={() => handleApprove(request)}
											disabled={Boolean(busy)}
										>
											<Check /> Approve member
										</Button>
									</div>
								))}
								<p className="text-[10px] leading-relaxed text-muted-foreground">
									Removal protects future epochs; it cannot erase data a former member already
									decrypted.
								</p>
							</section>
						</div>
					) : (
						<div className="space-y-3 px-2 py-3">
							<div className="rounded-[2px] border border-border bg-card p-3 text-center">
								<LockKeyhole className="mx-auto mb-2 h-7 w-7 text-primary" />
								<h2 className="text-sm font-semibold text-foreground">
									{pendingForRoute ? 'Approval pending' : 'Private group invitation'}
								</h2>
								<p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
									{pendingForRoute
										? 'An administrator must approve this account before its MLS Welcome is available.'
										: invitation
											? 'This invitation can publish your MLS KeyPackage for administrator approval.'
											: 'This group is not available in the current browser profile.'}
								</p>
								{invitation && !pendingForRoute ? (
									<Button
										className="mt-3 w-full"
										onClick={handleRequestJoin}
										disabled={Boolean(busy)}
									>
										<UserPlus /> Request access
									</Button>
								) : null}
								{pendingForRoute ? (
									<Button
										className="mt-3 w-full"
										variant="outline"
										onClick={handleWelcomes}
										disabled={Boolean(busy)}
									>
										<RefreshCw className={cn(busy === 'check invitations' && 'animate-spin')} />
										Check approval
									</Button>
								) : null}
							</div>
						</div>
					)}
				</div>
			</div>
		)
	}

	return (
		<ListPanel
			icon={UsersRound}
			title="Private groups"
			count={workspaces.length}
			onNew={() => setShowCreate((open) => !open)}
			newLabel="New private group"
			headerExtra={
				<div className="space-y-2">
					{embedded ? (
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={() => setShowCreate((open) => !open)}
						>
							<Plus /> New private group
						</Button>
					) : null}
					<PanelNotice>
						Group data is MLS-encrypted; Cordn is reached through ContextVM over Nostr.
					</PanelNotice>
					{invitation ? (
						<div className="rounded-[2px] border border-primary/30 bg-primary/5 p-2 text-[11px]">
							A private-group invitation is ready. Open its detail route to request access.
						</div>
					) : null}
					{pendingWorkspaceIds.size > 0 ? (
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							onClick={handleWelcomes}
							disabled={Boolean(busy)}
						>
							<RefreshCw className={cn(busy === 'check invitations' && 'animate-spin')} />
							Check approved invitations
						</Button>
					) : null}
					{showCreate ? (
						<div className="space-y-1.5 rounded-[2px] border border-border bg-card p-2">
							<Input
								aria-label="Private group name"
								className="h-8 text-xs"
								placeholder="Group name"
								value={name}
								onChange={(event) => setName(event.target.value)}
							/>
							<Input
								aria-label="Private group description"
								className="h-8 text-xs"
								placeholder="Description (encrypted)"
								value={description}
								onChange={(event) => setDescription(event.target.value)}
							/>
							<Input
								aria-label="Recommended basemap"
								className="h-8 text-xs"
								placeholder="Recommended basemap"
								value={basemap}
								onChange={(event) => setBasemap(event.target.value)}
							/>
							<Button
								size="sm"
								className="w-full"
								onClick={handleCreate}
								disabled={!name.trim() || Boolean(busy)}
							>
								<Plus /> Create private group
							</Button>
						</div>
					) : null}
				</div>
			}
			footerLeft={`${workspaces.length} local`}
			footerRight={
				pendingWorkspaceIds.size > 0 ? `${pendingWorkspaceIds.size} pending` : 'MLS secured'
			}
		>
			{!loaded ? (
				<p className="px-1 py-4 text-xs text-muted-foreground">Loading private groups…</p>
			) : workspaces.length === 0 ? (
				<div className="px-1 py-5 text-center">
					<UsersRound className="mx-auto mb-2 h-7 w-7 text-muted-foreground" />
					<p className="text-xs font-medium text-foreground">No private groups yet</p>
					<p className="mt-1 text-[11px] text-muted-foreground">
						Create one here or open an invitation link.
					</p>
				</div>
			) : (
				<div>
					{workspaces.map((workspace) => (
						<ListRow
							key={workspace.workspaceId}
							leading={<GlyphTile icon={LockKeyhole} className="bg-primary/15 text-primary" />}
							title={workspace.metadata?.name ?? 'Decrypting group metadata…'}
							onTitleClick={() => navigateToPrivateGroup(workspace.workspaceId)}
							titleAriaLabel={`Open ${workspace.metadata?.name ?? 'private group'}`}
							badges={
								<RowBadge
									label={workspace.role === 'administrator' ? 'admin' : 'member'}
									className="bg-primary/15 text-primary"
								/>
							}
							meta={
								<>
									<span>{workspace.cursor} messages</span>
									<span>·</span>
									<code>{shortKey(workspace.coordinatorPubkey)}</code>
								</>
							}
							note={workspace.metadata?.description || 'MLS-protected map workspace'}
						/>
					))}
				</div>
			)}
		</ListPanel>
	)
}

// Kept as a temporary source-compatible export for code outside this branch.
export const PrivateMapsDialog = PrivateGroupsPanel
