import {
	ArrowLeft,
	Check,
	Copy,
	Database,
	KeyRound,
	Link2,
	LockKeyhole,
	MessageSquareText,
	Plus,
	QrCode,
	RefreshCw,
	ScanLine,
	Settings2,
	ShieldCheck,
	ShieldMinus,
	ShieldPlus,
	Trash2,
	UserMinus,
	UserPlus,
	UsersRound,
} from 'lucide-react'
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { FeatureCollection } from 'geojson'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import {
	EmbeddedListPanelContext,
	GlyphTile,
	ListPanel,
	ListRow,
	RowActionButton,
	RowBadge,
} from '@/components/entity-list'
import { SignedOutCta } from '@/features/auth/SignedOutCta'
import { useRouting } from '@/features/geo-editor/hooks/useRouting'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { config } from '@/config'
import { earthlyPublicUrl } from '@/platform/publicUrl'
import {
	PRIVATE_WORKSPACE_CHAT_KIND,
	projectPrivateWorkspaceComments,
	projectPrivateWorkspaceDatasets,
	type WorkspaceJoinRequest,
} from '@/lib/private-workspace'
import { computeCommentBbox, type GeoComment } from '@/lib/nostr/geo-comment'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { GeoCommentForm } from '@/features/social/comments/GeoCommentForm'
import { cn } from '@/lib/utils'
import { PrivateCommentItem } from './PrivateCommentItem'
import { PrivateGeometryReferences, type PrivateDatasetActions } from './PrivateGeometryReferences'
import { PrivateInviteScannerDialog } from './PrivateInviteScannerDialog'
import { copyPrivateInviteText } from './privateInviteClipboard'
import { parsePrivateInviteLink, type ParsedPrivateInviteLink } from './privateInviteLink'
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

function PrivateGroupsSecurityNotice() {
	return (
		<PanelNotice>
			<span className="font-medium text-foreground">Experimental.</span> MLS encrypts group records
			before Cordn stores them; membership and traffic timing remain visible. Avoid highly sensitive
			operations for now.
		</PanelNotice>
	)
}

export function PrivateGroupsPanel({
	onStartNewDataset,
	datasetActions,
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
}: {
	onStartNewDataset?: () => void
	datasetActions?: PrivateDatasetActions
	onCommentGeometryVisibility?: (comment: GeoComment, visible: boolean) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}) {
	const { account: activeAccount, runtime, snapshot } = usePrivateWorkspaceRuntime()
	const embedded = useContext(EmbeddedListPanelContext)
	const { privateGroupId, navigateToPrivateGroup, navigateToView } = useRouting()
	const [busy, setBusy] = useState<string>()
	const [joinRequestState, setJoinRequestState] = useState<{
		workspaceId: string
		requests: WorkspaceJoinRequest[]
		checked: boolean
	}>({ workspaceId: '', requests: [], checked: false })
	const [checkingJoinRequests, setCheckingJoinRequests] = useState(false)
	const [invitation, setInvitation] = useState(invitationFromLocation)
	const [inviteLinkInput, setInviteLinkInput] = useState('')
	const [inviteScannerOpen, setInviteScannerOpen] = useState(false)
	const [showCreate, setShowCreate] = useState(false)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [basemap, setBasemap] = useState('Local PMTiles when available')
	const [inviteLinkState, setInviteLinkState] = useState<{
		workspaceId: string
		url: string
	} | null>(null)
	const [visibleCommentState, setVisibleCommentState] = useState<{
		workspaceId?: string
		ids: Set<string>
	}>({ workspaceId: privateGroupId, ids: new Set() })
	const defaultVisibleCommentIdsRef = useRef(new Map<string, Set<string>>())
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
	const legacyChatMessages = selected?.envelopes.filter(
		(envelope) => envelope.kind === PRIVATE_WORKSPACE_CHAT_KIND,
	)
	const privateComments = useMemo(
		() => (selected ? projectPrivateWorkspaceComments(selected) : []),
		[selected],
	)
	const privateCommentGeometryCount = privateComments.filter(
		(comment) => (comment.geojson?.features.length ?? 0) > 0,
	).length
	const discussionItems = useMemo(
		() =>
			[
				...privateComments.map((comment) => ({
					type: 'comment' as const,
					createdAt: comment.created_at,
					id: comment.id,
					comment,
				})),
				...(legacyChatMessages ?? []).map((message) => ({
					type: 'legacy' as const,
					createdAt: message.created_at,
					id: message.id,
					message,
				})),
			].sort((a, b) => a.createdAt - b.createdAt),
		[legacyChatMessages, privateComments],
	)
	const privateDatasets = useMemo(
		() => (selected ? projectPrivateWorkspaceDatasets(selected) : []),
		[selected],
	)
	const joinRequests =
		joinRequestState.workspaceId === privateGroupId ? joinRequestState.requests : []
	const members = selected && service ? service.members(selected) : []
	const administrators = selected && service ? service.administrators(selected) : []
	const pendingForRoute = Boolean(privateGroupId && pendingWorkspaceIds.has(privateGroupId))
	const selectedSyncState = selected ? snapshot.syncByWorkspace[selected.workspaceId] : undefined
	const inviteLink =
		inviteLinkState && inviteLinkState.workspaceId === selected?.workspaceId
			? inviteLinkState.url
			: undefined
	const visibleCommentIds =
		visibleCommentState.workspaceId === privateGroupId ? visibleCommentState.ids : new Set<string>()

	// Warm Android App Links now update the existing WebView instead of reloading
	// it. Keep invite state in sync with that external/browser navigation while
	// leaving scanner/paste flows free to set the same state directly.
	useEffect(() => {
		const syncInvitationFromRoute = () => setInvitation(invitationFromLocation())
		window.addEventListener('popstate', syncInvitationFromRoute)
		return () => window.removeEventListener('popstate', syncInvitationFromRoute)
	}, [])

	useEffect(() => {
		if (!runtime || !privateGroupId || !selectedWorkspaceId) return
		return runtime.watchWorkspace(privateGroupId)
	}, [runtime, privateGroupId, selectedWorkspaceId])

	useEffect(() => {
		if (!selected) return
		let seenIds = defaultVisibleCommentIdsRef.current.get(selected.workspaceId)
		if (!seenIds) {
			seenIds = new Set<string>()
			defaultVisibleCommentIdsRef.current.set(selected.workspaceId, seenIds)
		}

		const newlyVisible = privateComments.filter((comment) => {
			const commentId = comment.commentId ?? comment.id ?? ''
			return Boolean(commentId && comment.geojson?.features.length && !seenIds.has(commentId))
		})
		if (newlyVisible.length === 0) return

		const ids = newlyVisible.map((comment) => comment.commentId ?? comment.id ?? '')
		for (const id of ids) seenIds.add(id)
		setVisibleCommentState((current) => {
			const nextIds =
				current.workspaceId === selected.workspaceId ? new Set(current.ids) : new Set<string>()
			for (const id of ids) nextIds.add(id)
			return { workspaceId: selected.workspaceId, ids: nextIds }
		})
		for (const comment of newlyVisible) onCommentGeometryVisibility?.(comment, true)
	}, [selected, privateComments, onCommentGeometryVisibility])

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

	const createInviteLink = async () => {
		if (!runtime || !service || !selected)
			throw new Error('Open a private group as an administrator first')
		const token = await runtime.createInvitation(selected.workspaceId)
		// Native WebViews have an internal origin that is meaningless on another
		// phone. Share the public HTTPS route so the link works in a browser today
		// and becomes an Android App Link once release signing is configured.
		const url = new URL(earthlyPublicUrl())
		url.pathname = `/privategroup/${encodeURIComponent(selected.workspaceId)}`
		url.search = ''
		url.hash = ''
		url.searchParams.set('private-invite', token)
		const value = url.toString()
		setInviteLinkState({ workspaceId: selected.workspaceId, url: value })
		return value
	}

	const handleCopyInvite = () =>
		run('copy invitation', async () => {
			const value = await createInviteLink()
			await copyPrivateInviteText(value)
			toast.success('Signed 24-hour private-group invitation copied')
		})

	const handleShowInviteQr = () =>
		run('create invitation', async () => {
			await createInviteLink()
		})

	const handleCopyShownInvite = () =>
		run('copy invitation', async () => {
			if (!inviteLink) throw new Error('Create an invitation QR first')
			await copyPrivateInviteText(inviteLink)
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

	const openInvite = ({ workspaceId, invitation: scannedInvitation }: ParsedPrivateInviteLink) => {
		setInvitation(scannedInvitation)
		setInviteScannerOpen(false)
		navigateToPrivateGroup(workspaceId)
		const url = new URL(location.href)
		url.pathname = `/privategroup/${encodeURIComponent(workspaceId)}`
		url.search = ''
		url.searchParams.set('private-invite', scannedInvitation)
		history.replaceState(history.state, '', url)
	}

	const handleScannedInvite = (invite: ParsedPrivateInviteLink) => {
		openInvite(invite)
		toast.success('Private-group invitation scanned')
	}

	const handleOpenInviteLink = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		void run('open invitation', async () => {
			const parsed = parsePrivateInviteLink(inviteLinkInput)
			openInvite(parsed)
			setInviteLinkInput('')
			toast.success('Private-group invitation opened')
		})
	}

	const handleFetchRequests = async () => {
		if (!runtime || !service || !selected || checkingJoinRequests) return
		const workspaceId = selected.workspaceId
		setCheckingJoinRequests(true)
		try {
			const requests = await runtime.fetchJoinRequests(workspaceId)
			setJoinRequestState({ workspaceId, requests, checked: true })
			toast.success(
				requests.length > 0
					? `${requests.length} pending join request${requests.length === 1 ? '' : 's'}`
					: 'No pending join requests',
			)
		} catch (error) {
			console.error('[private-groups] check join requests failed', error)
			toast.error(error instanceof Error ? error.message : 'Could not check join requests')
		} finally {
			setCheckingJoinRequests(false)
		}
	}

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

	const handleSendComment = (text: string, geojson?: FeatureCollection) =>
		run('send comment', async () => {
			if (!runtime || !service || !selected) return
			await runtime.perform((workspaceService) =>
				workspaceService.sendComment(selected.workspaceId, text, geojson),
			)
		})

	const handleCommentGeometryVisibility = (comment: GeoComment, visible: boolean) => {
		const commentId = comment.commentId ?? comment.id ?? ''
		if (!commentId || !selected) return
		setVisibleCommentState((current) => {
			const ids =
				current.workspaceId === selected.workspaceId ? new Set(current.ids) : new Set<string>()
			if (visible) ids.add(commentId)
			else ids.delete(commentId)
			return { workspaceId: selected.workspaceId, ids }
		})
		onCommentGeometryVisibility?.(comment, visible)
	}

	const handleZoomToCommentGeometry = (comment: GeoComment) => {
		const bounds = computeCommentBbox(comment.geojson)
		if (!bounds) return
		handleCommentGeometryVisibility(comment, true)
		onZoomToBounds?.(bounds)
	}

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

	const handleAdministrator = (pubkey: string, administrator: boolean) =>
		run(administrator ? 'promote administrator' : 'demote administrator', async () => {
			if (!runtime || !service || !selected) return
			await runtime.perform((workspaceService) =>
				workspaceService.setAdministrator(selected.workspaceId, pubkey, administrator),
			)
			toast.success(administrator ? 'Member promoted to administrator' : 'Administrator demoted')
		})

	const handleDeleteWorkspace = (workspaceId: string, workspaceName: string) => {
		if (
			!window.confirm(
				`Delete "${workspaceName}" from this device? This removes the local encrypted state and cannot erase copies held by other members.`,
			)
		) {
			return
		}
		void run('delete private group', async () => {
			if (!runtime) return
			await runtime.perform((workspaceService) => workspaceService.deleteWorkspace(workspaceId))
			if (privateGroupId === workspaceId) navigateToView('private-groups')
			toast.success('Private group deleted from this device')
		})
	}

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
								<div className="mt-2">
									<PrivateGroupsSecurityNotice />
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
											{discussionItems.length}
										</span>
									</TabsTrigger>
									<TabsTrigger
										value="geometry"
										className="h-9 rounded-none border-b-2 border-transparent px-2 text-[11px] data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none"
									>
										<Database className="h-3.5 w-3.5" /> Geometry
										<span className="font-mono text-[9px] text-muted-foreground">
											{privateDatasets.length + privateCommentGeometryCount}
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
										{discussionItems.map((item) =>
											item.type === 'comment' ? (
												<PrivateCommentItem
													key={item.id}
													comment={item.comment}
													geometryVisible={visibleCommentIds.has(
														item.comment.commentId ?? item.comment.id ?? '',
													)}
													onGeometryVisibilityChange={handleCommentGeometryVisibility}
													onZoomToGeometry={handleZoomToCommentGeometry}
													availableFeatures={availableFeatures}
													onMentionVisibilityToggle={onMentionVisibilityToggle}
													onMentionZoomTo={onMentionZoomTo}
												/>
											) : (
												<div key={item.id} className="py-2.5">
													<UserProfile
														pubkey={item.message.pubkey}
														mode="avatar-name"
														size="xs"
														showNip05Badge={false}
														interactive={false}
														className="min-w-0"
													/>
													<p className="mt-1.5 break-words text-xs leading-relaxed text-foreground">
														{item.message.content}
													</p>
												</div>
											),
										)}
										{discussionItems.length === 0 ? (
											<p className="py-8 text-center text-xs text-muted-foreground">
												No private comments yet.
											</p>
										) : null}
									</div>
									<GeoCommentForm
										onSubmit={handleSendComment}
										placeholder="Comment in this private group…"
										availableFeatures={availableFeatures}
										searchRelayMentions={false}
										className="mt-3"
									/>
								</TabsContent>

								<TabsContent
									value="geometry"
									className="m-0 min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"
								>
									<div className="px-3 py-3">
										<p className="text-[11px] leading-relaxed text-muted-foreground">
											Encrypted datasets and optional comment attachments. Removing a dataset from
											the Map Stack does not delete it from the group.
										</p>
									</div>
									<PrivateGeometryReferences
										workspaceId={selected.workspaceId}
										datasets={privateDatasets}
										comments={privateComments}
										actions={datasetActions}
										visibleCommentIds={visibleCommentIds}
										onCommentGeometryVisibilityChange={handleCommentGeometryVisibility}
										onZoomToCommentGeometry={handleZoomToCommentGeometry}
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
												{busy === 'copy invitation' ? (
													<RefreshCw className="animate-spin" />
												) : (
													<Copy />
												)}
												{busy === 'copy invitation' ? 'Copying…' : 'Copy invite'}
											</Button>
										) : null}
										{selected.role === 'administrator' ? (
											<Button
												className="col-span-2"
												variant="outline"
												size="sm"
												onClick={handleShowInviteQr}
												disabled={Boolean(busy)}
											>
												{busy === 'create invitation' ? (
													<RefreshCw className="animate-spin" />
												) : (
													<QrCode />
												)}
												{busy === 'create invitation' ? 'Creating…' : 'Create invite QR'}
											</Button>
										) : null}
									</div>
									{selected.role === 'administrator' ? (
										<p className="text-[10px] leading-relaxed text-muted-foreground">
											New invitation links are administrator-signed and expire after 24 hours.
										</p>
									) : null}
									{inviteLink ? (
										<div className="space-y-2 rounded-[2px] border border-border bg-muted/25 p-3 text-center">
											<div className="mx-auto w-fit max-w-full rounded-[2px] bg-white p-2">
												<QRCodeSVG value={inviteLink} size={208} className="h-auto max-w-full" />
											</div>
											<p className="text-[10px] leading-relaxed text-muted-foreground">
												Scan on the invited device. The signed link expires after 24 hours.
											</p>
											<Button
												variant="outline"
												size="sm"
												onClick={handleCopyShownInvite}
												disabled={Boolean(busy)}
											>
												{busy === 'copy invitation' ? (
													<RefreshCw className="animate-spin" />
												) : (
													<Copy />
												)}
												{busy === 'copy invitation' ? 'Copying…' : 'Copy this invitation'}
											</Button>
										</div>
									) : null}

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
													disabled={checkingJoinRequests || Boolean(busy)}
												>
													{checkingJoinRequests ? (
														<RefreshCw className="animate-spin" />
													) : (
														<UserPlus />
													)}
													{checkingJoinRequests ? 'Checking…' : 'Check requests'}
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
													{administrators.includes(member) ? (
														<RowBadge label="admin" className="bg-primary/15 text-primary" />
													) : null}
													{selected.role === 'administrator' && member !== activeAccount.pubkey ? (
														<div className="ml-auto flex items-center gap-0.5">
															<Button
																size="icon-xs"
																variant="ghost"
																aria-label={`${administrators.includes(member) ? 'Demote' : 'Promote'} ${shortKey(member)}`}
																onClick={() =>
																	handleAdministrator(member, !administrators.includes(member))
																}
																disabled={Boolean(busy)}
															>
																{administrators.includes(member) ? <ShieldMinus /> : <ShieldPlus />}
															</Button>
															{!administrators.includes(member) ? (
																<Button
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
													) : null}
												</div>
											))}
										</div>
										{checkingJoinRequests ? (
											<p
												className="text-[10px] leading-relaxed text-muted-foreground"
												role="status"
											>
												Checking Cordn for pending join requests…
											</p>
										) : joinRequestState.workspaceId === selected.workspaceId &&
											joinRequestState.checked &&
											joinRequests.length === 0 ? (
											<p className="text-[10px] leading-relaxed text-muted-foreground">
												No pending join requests found.
											</p>
										) : null}
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
												<p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
													Approval shares the current datasets. Earlier discussion and its
													attachments remain private to members who already received them.
												</p>
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
									<section className="space-y-2 border-t border-border pt-3">
										<p className="text-[10px] leading-relaxed text-muted-foreground">
											Deleting removes this installation’s encrypted copy. It cannot erase records
											already received by the coordinator or other members.
										</p>
										<Button
											variant="destructive"
											size="sm"
											className="w-full"
											disabled={Boolean(busy)}
											onClick={() =>
												handleDeleteWorkspace(
													selected.workspaceId,
													selected.metadata?.name ?? 'Private group',
												)
											}
										>
											<Trash2 /> Delete from this device
										</Button>
									</section>
								</TabsContent>
							</Tabs>
						</div>
					) : (
						<div className="h-full space-y-3 overflow-y-auto px-2 py-3">
							<PrivateGroupsSecurityNotice />
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
										{busy === 'request access' ? (
											<RefreshCw className="animate-spin" />
										) : (
											<UserPlus />
										)}
										{busy === 'request access' ? 'Connecting…' : 'Request access'}
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
					<form className="flex gap-1.5" onSubmit={handleOpenInviteLink}>
						<Input
							aria-label="Private group invitation link"
							className="h-8 min-w-0 text-xs"
							placeholder="Paste invitation link"
							value={inviteLinkInput}
							onChange={(event) => setInviteLinkInput(event.target.value)}
						/>
						<Button
							type="submit"
							variant="outline"
							size="sm"
							disabled={!inviteLinkInput.trim() || Boolean(busy)}
						>
							<Link2 /> Open
						</Button>
					</form>
					<Button
						variant="outline"
						size="sm"
						className="w-full"
						onClick={() => setInviteScannerOpen(true)}
					>
						<ScanLine /> Scan invite QR
					</Button>
					<PrivateInviteScannerDialog
						open={inviteScannerOpen}
						onOpenChange={setInviteScannerOpen}
						onInvite={handleScannedInvite}
					/>
					<PrivateGroupsSecurityNotice />
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
							actions={
								<RowActionButton
									icon={Trash2}
									label={`Delete ${workspace.metadata?.name ?? 'private group'} from this device`}
									hover="hover:text-destructive"
									disabled={Boolean(busy)}
									onClick={() =>
										handleDeleteWorkspace(
											workspace.workspaceId,
											workspace.metadata?.name ?? 'Private group',
										)
									}
								/>
							}
						/>
					))}
				</div>
			)}
		</ListPanel>
	)
}

// Kept as a temporary source-compatible export for code outside this branch.
export const PrivateMapsDialog = PrivateGroupsPanel
