import {
	ArrowLeft,
	Check,
	Copy,
	Database,
	KeyRound,
	LockKeyhole,
	MessageSquareText,
	Plus,
	RefreshCw,
	Settings2,
	ShieldCheck,
	UserMinus,
	UserPlus,
	UsersRound,
} from 'lucide-react'
import { useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { UserProfile } from '@/components/user-profile/UserProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { config } from '@/config'
import {
	PRIVATE_WORKSPACE_CHAT_KIND,
	projectPrivateWorkspaceDatasets,
	type WorkspaceJoinRequest,
} from '@/lib/private-workspace'
import { cn } from '@/lib/utils'
import { PrivateGeometryReferences, type PrivateDatasetActions } from './PrivateGeometryReferences'
import { usePrivateWorkspaceRuntime } from './usePrivateWorkspaceRuntime'

function shortKey(value: string) {
	return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function invitationFromLocation() {
	if (typeof location === 'undefined') return ''
	return new URL(location.href).searchParams.get('private-invite') ?? ''
}

function PanelNotice({ children }: { children: ReactNode }) {
	return (
		<div className="flex items-start gap-2 rounded-[2px] border border-border bg-muted/35 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
			<ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ok" />
			<span>{children}</span>
		</div>
	)
}

export function PrivateGroupsPanel({
	onStartNewDataset,
	datasetActions,
}: {
	onStartNewDataset?: () => void
	datasetActions?: PrivateDatasetActions
}) {
	const { account: activeAccount, runtime, snapshot } = usePrivateWorkspaceRuntime()
	const embedded = useContext(EmbeddedListPanelContext)
	const { privateGroupId, navigateToPrivateGroup, navigateToView } = useRouting()
	const [busy, setBusy] = useState<string>()
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
	const [detailView, setDetailView] = useState<{
		workspaceId?: string
		tab: 'chat' | 'geometry' | 'settings'
	}>({ workspaceId: privateGroupId, tab: 'chat' })
	const detailTab = detailView.workspaceId === privateGroupId ? detailView.tab : 'chat'
	const { loaded, workspaces, pendingJoins } = snapshot
	const pendingWorkspaceIds = new Set(pendingJoins.map((item) => item.workspaceId))
	const service = runtime?.service

	const selected = privateGroupId
		? workspaces.find((workspace) => workspace.workspaceId === privateGroupId)
		: undefined
	const selectedWorkspaceId = selected?.workspaceId
	const chatMessages = selected?.envelopes.filter(
		(envelope) => envelope.kind === PRIVATE_WORKSPACE_CHAT_KIND,
	)
	const privateDatasets = useMemo(
		() => (selected ? projectPrivateWorkspaceDatasets(selected) : []),
		[selected],
	)
	const joinRequests =
		joinRequestState.workspaceId === privateGroupId ? joinRequestState.requests : []
	const members = selected && service ? service.members(selected) : []
	const pendingForRoute = Boolean(privateGroupId && pendingWorkspaceIds.has(privateGroupId))
	const selectedSyncState = selected ? snapshot.syncByWorkspace[selected.workspaceId] : undefined

	useEffect(() => {
		if (!runtime || !privateGroupId || !selectedWorkspaceId) return
		return runtime.watchWorkspace(privateGroupId)
	}, [runtime, privateGroupId, selectedWorkspaceId])

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
			if (!runtime || !service)
				throw new Error('Sign in and configure a private-group coordinator first')
			const created = await runtime.perform((workspaceService) =>
				workspaceService.createWorkspace({
					name,
					description: description || undefined,
					recommendedBasemap: basemap || undefined,
				}),
			)
			setName('')
			setDescription('')
			setShowCreate(false)
			navigateToPrivateGroup(created.workspaceId)
			toast.success('Private group created locally')
		})

	const handleCopyInvite = () =>
		run('create invitation', async () => {
			if (!runtime || !service || !selected) return
			const token = await runtime.perform((workspaceService) =>
				workspaceService.createInvitation(selected.workspaceId),
			)
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
			if (!runtime || !service || !invitation)
				throw new Error('The invitation is missing or invalid')
			const pending = await runtime.perform((workspaceService) =>
				workspaceService.requestToJoin(invitation),
			)
			navigateToPrivateGroup(pending.workspaceId)
			const url = new URL(location.href)
			url.pathname = `/privategroup/${encodeURIComponent(pending.workspaceId)}`
			url.searchParams.delete('private-invite')
			history.replaceState(history.state, '', url)
			toast.success('Join request sent. An administrator must approve this device.')
		})

	const handleWelcomes = () =>
		run('check invitations', async () => {
			if (!runtime || !service) return
			const accepted = await runtime.perform((workspaceService) =>
				workspaceService.acceptPendingWelcomes(),
			)
			if (accepted[0]) navigateToPrivateGroup(accepted[0].workspaceId)
			toast.success(
				accepted.length > 0
					? `Joined ${accepted.length} private group${accepted.length === 1 ? '' : 's'}`
					: 'No approved invitations yet',
			)
		})

	const handleFetchRequests = () =>
		run('check join requests', async () => {
			if (!runtime || !service || !selected) return
			setJoinRequestState({
				workspaceId: selected.workspaceId,
				requests: await runtime.perform((workspaceService) =>
					workspaceService.fetchJoinRequests(selected.workspaceId),
				),
			})
		})

	const handleApprove = (request: WorkspaceJoinRequest) =>
		run('approve member', async () => {
			if (!runtime || !service) return
			await runtime.perform((workspaceService) => workspaceService.approveJoinRequest(request))
			setJoinRequestState((current) => ({
				...current,
				requests: current.requests.filter((item) => item.kp_ref !== request.kp_ref),
			}))
			toast.success('Member added and encrypted Welcome stored')
		})

	const handleSync = () =>
		run('sync private group', async () => {
			if (!runtime || !service || !selected) return
			await runtime.syncWorkspace(selected.workspaceId)
			toast.success('Private group is current')
		})

	const handleSendChat = () =>
		run('send message', async () => {
			if (!runtime || !service || !selected) return
			await runtime.perform((workspaceService) =>
				workspaceService.sendChat(selected.workspaceId, chat),
			)
			setChat('')
		})

	const handleStartDataset = () => {
		if (!onStartNewDataset) return
		onStartNewDataset()
		navigateToView('edit')
	}

	const handleRemove = (pubkey: string) =>
		run('remove member', async () => {
			if (!runtime || !service || !selected) return
			await runtime.perform((workspaceService) =>
				workspaceService.removeMember(selected.workspaceId, pubkey),
			)
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

				<div className="min-h-0 flex-1">
					{!loaded ? (
						<p className="px-2 py-6 text-center text-xs text-muted-foreground">
							Opening encrypted group…
						</p>
					) : selected ? (
						<div className="flex h-full min-h-0 flex-col">
							<section className="shrink-0 border-b border-border px-3 py-3">
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
										<p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
											{selected.metadata?.description || 'No description'}
										</p>
									</div>
								</div>
							</section>

							<Tabs
								value={detailTab}
								onValueChange={(value) =>
									setDetailView({
										workspaceId: privateGroupId,
										tab: value as typeof detailTab,
									})
								}
								className="flex min-h-0 flex-1 flex-col gap-0"
							>
								<TabsList className="grid h-9 w-full shrink-0 grid-cols-3 rounded-none border-b border-border bg-transparent p-0">
									<TabsTrigger
										value="chat"
										className="h-9 rounded-none border-b-2 border-transparent px-2 text-[11px] data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
									>
										<MessageSquareText className="h-3.5 w-3.5" /> Chat
										<span className="font-mono text-[9px] text-muted-foreground">
											{chatMessages?.length ?? 0}
										</span>
									</TabsTrigger>
									<TabsTrigger
										value="geometry"
										className="h-9 rounded-none border-b-2 border-transparent px-2 text-[11px] data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
									>
										<Database className="h-3.5 w-3.5" /> Geometry
										<span className="font-mono text-[9px] text-muted-foreground">
											{privateDatasets.length}
										</span>
									</TabsTrigger>
									<TabsTrigger
										value="settings"
										className="h-9 rounded-none border-b-2 border-transparent px-2 text-[11px] data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
									>
										<Settings2 className="h-3.5 w-3.5" /> Settings
										{joinRequests.length > 0 ? (
											<span className="h-1.5 w-1.5 rounded-full bg-primary" />
										) : null}
									</TabsTrigger>
								</TabsList>

								<TabsContent
									value="chat"
									className="m-0 min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]"
								>
									<div className="divide-y divide-border border-y border-border">
										{chatMessages?.map((message) => (
											<div key={message.id} className="py-2.5">
												<UserProfile
													pubkey={message.pubkey}
													mode="avatar-name"
													size="xs"
													showNip05Badge={false}
													interactive={false}
													className="min-w-0"
												/>
												<p className="mt-1.5 break-words text-xs leading-relaxed text-foreground">
													{message.content}
												</p>
											</div>
										))}
										{chatMessages?.length === 0 ? (
											<p className="py-8 text-center text-xs text-muted-foreground">
												No private messages yet.
											</p>
										) : null}
									</div>
									<div className="mt-3 flex gap-1.5">
										<Textarea
											aria-label="Private group message"
											className="min-h-16 resize-none text-xs"
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
								</TabsContent>

								<TabsContent
									value="geometry"
									className="m-0 min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
								>
									<div className="px-3 py-3">
										<p className="text-[11px] leading-relaxed text-muted-foreground">
											Current encrypted dataset references. Removing one from the Map Stack does not
											delete it from the group.
										</p>
									</div>
									<PrivateGeometryReferences
										workspaceId={selected.workspaceId}
										datasets={privateDatasets}
										actions={datasetActions}
									/>
									<div className="p-3">
										<Button
											variant="default"
											size="sm"
											className="w-full"
											onClick={handleStartDataset}
											disabled={!onStartNewDataset || Boolean(busy)}
										>
											<Plus /> New private dataset
										</Button>
									</div>
								</TabsContent>

								<TabsContent
									value="settings"
									className="m-0 min-h-0 flex-1 space-y-4 overflow-y-auto px-3 py-3 [scrollbar-gutter:stable]"
								>
									<div className="grid grid-cols-2 gap-1.5">
										<Button
											variant="outline"
											size="sm"
											onClick={handleSync}
											disabled={Boolean(busy) || selectedSyncState === 'syncing'}
										>
											<RefreshCw
												className={cn(selectedSyncState === 'syncing' && 'animate-spin')}
											/>
											{selectedSyncState === 'offline'
												? 'Retry sync'
												: selectedSyncState === 'syncing'
													? 'Updating'
													: selectedSyncState === 'current'
														? 'Current'
														: 'Check sync'}
										</Button>
										{selected.role === 'administrator' ? (
											<Button
												variant="outline"
												size="sm"
												onClick={handleCopyInvite}
												disabled={Boolean(busy)}
											>
												<Copy /> Copy invite
											</Button>
										) : null}
									</div>

									<div className="grid grid-cols-2 gap-px overflow-hidden rounded-[2px] border border-border bg-border font-mono text-[9.5px]">
										<div className="bg-card p-2">
											<span className="text-muted-foreground">ROLE</span>
											<div className="mt-0.5 text-foreground">{selected.role}</div>
										</div>
										<div className="bg-card p-2">
											<span className="text-muted-foreground">RECORD CURSOR</span>
											<div className="mt-0.5 text-foreground">{selected.cursor}</div>
										</div>
										<div className="col-span-2 bg-card p-2">
											<span className="text-muted-foreground">RECOMMENDED BASEMAP</span>
											<div className="mt-0.5 truncate text-foreground">
												{selected.metadata?.recommendedBasemap ?? 'Member choice'}
											</div>
										</div>
									</div>

									<section className="space-y-2">
										<div className="flex items-center gap-2">
											<UsersRound className="h-3.5 w-3.5 text-primary" />
											<h3 className="text-xs font-semibold text-foreground">Members & invites</h3>
											{selected.role === 'administrator' ? (
												<Button
													className="ml-auto h-6 text-[10px]"
													size="sm"
													variant="outline"
													onClick={handleFetchRequests}
													disabled={Boolean(busy)}
												>
													<UserPlus /> Check requests
												</Button>
											) : null}
										</div>
										<div className="divide-y divide-border border-y border-border">
											{members.map((member) => (
												<div key={member} className="flex items-center gap-2 py-2 text-[11px]">
													<UserProfile
														pubkey={member}
														mode="avatar-name"
														size="sm"
														showNip05Badge={false}
														interactive={false}
														className="min-w-0 flex-1"
													/>
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
												<UserProfile
													pubkey={request.pk}
													mode="avatar-name"
													size="sm"
													showNip05Badge={false}
													interactive={false}
													className="mt-1"
												/>
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

									<PanelNotice>
										MLS encrypts group records before the Cordn ContextVM coordinator stores them.
									</PanelNotice>
								</TabsContent>
							</Tabs>
						</div>
					) : (
						<div className="h-full space-y-3 overflow-y-auto px-2 py-3">
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
