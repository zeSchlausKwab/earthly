import { useTimelineWithEose } from '@/lib/nostr/hooks'
import type { ColumnDef } from '@tanstack/react-table'
import { Database, Eye, Globe, Layers, MessageCircle, MessageSquare, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { GeoProposal } from '@/lib/nostr/geo-proposal'
import { castEvent } from 'applesauce-core/casts'
import { eventStore } from '@/lib/nostr'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import {
	GEO_EDIT_PROPOSAL_KIND,
	GEO_EVENT_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
} from '../lib/nostr/kinds'
import { getLatestProposalStatus, type ProposalStatus } from '@/lib/nostr/geo-proposal'
import {
	getContextCoordinate,
	getEffectiveContextUse,
	getEffectiveContextValidationMode,
} from '../lib/context/validation'
import { orderContextsForDisplay } from '../lib/context/displayOrdering'
import { useEditorStore } from '../features/geo-editor/store'
import {
	createContextColumns,
	type ContextColumnsContext,
	type ContextRowData,
} from '../features/contexts/contexts-columns'
import {
	DatasetFilterToolbar,
	useFilterState,
	useSortedFilteredItems,
	type FilterConfig,
} from './data-filter'
import {
	createDatasetColumns,
	type DatasetColumnsContext,
	type DatasetRowData,
} from './datasets-columns'
import { Button } from './ui/button'
import { DataTable } from './ui/data-table'
import { UserProfile } from './user-profile/UserProfile'

export interface UserProfilePanelProps {
	pubkey: string
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	onLoadDataset: (event: GeoDataset) => void
	onToggleVisibility: (event: GeoDataset) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: GeoDataset) => void
	onDeleteDataset: (event: GeoDataset) => void
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onInspectDataset?: (event: GeoDataset) => void
	onAddDatasetToMap?: (event: GeoDataset) => void
	onRemoveDatasetFromMap?: (event: GeoDataset) => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>
	onInspectContext?: (context: MapContext) => void
	onEditContext?: (context: MapContext) => void
	onOpenDebug?: (event: GeoDataset | MapContext) => void
}

type TabMode = 'datasets' | 'contexts' | 'proposals' | 'workspaces'

interface UserProposalRow {
	proposal: GeoProposal
	description: string
	targetName: string
	targetAddress: string
	targetDataset: GeoDataset | null
	status: ProposalStatus
	created_at?: number
	pubkey: string
}

const getDatasetDescriptionText = (event: GeoDataset): string | undefined => {
	const featureCollection = event.featureCollection as unknown as Record<string, unknown>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection.description,
		featureCollection.summary,
		(featureCollection.properties as Record<string, unknown> | undefined)?.description,
		(featureCollection.properties as Record<string, unknown> | undefined)?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

const createDatasetFilterConfig = (
	getDatasetName: (event: GeoDataset) => string,
): FilterConfig<GeoDataset> => ({
	getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
	getName: (event) => getDatasetName(event),
})

const getContextDisplayName = (context: MapContext): string =>
	context.context.name || context.contextId || context.id || 'Untitled'

const contextFilterConfig: FilterConfig<MapContext> = {
	getSearchableText: (context) => {
		const content = context.context
		return [
			content.name,
			content.description,
			content.contextUse,
			content.validationMode,
			context.contextId,
			context.id,
		]
	},
	getName: (context) => getContextDisplayName(context),
}

const PROPOSAL_STATUS_STYLES: Record<ProposalStatus, string> = {
	open: 'bg-green-100 text-green-700',
	applied: 'bg-blue-100 text-blue-700',
	closed: 'bg-red-100 text-red-700',
	draft: 'bg-gray-100 text-gray-600',
}

export function UserProfilePanel({
	pubkey,
	geoEvents,
	mapContextEvents,
	currentUserPubkey,
	datasetVisibility,
	isPublishing,
	deletingKey,
	onLoadDataset,
	onToggleVisibility,
	onToggleAllVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onInspectDataset,
	onAddDatasetToMap,
	onRemoveDatasetFromMap,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onInspectContext,
	onEditContext,
	onOpenDebug,
}: UserProfilePanelProps) {
	const [activeTab, setActiveTab] = useState<TabMode>('datasets')
	const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null)
	const [confirmingWorkspaceId, setConfirmingWorkspaceId] = useState<string | null>(null)
	const filterState = useFilterState()

	const isOwnProfile = currentUserPubkey === pubkey
	const workspaces = useEditorStore((state) => state.workspaces)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const viewContext = useEditorStore((state) => state.viewContext)
	const activeContextScopeCoordinate = useEditorStore((state) => state.activeContextScopeCoordinate)
	const mapStackEntries = useEditorStore((state) => state.mapStackEntries)
	// Round H.2: catalog favorites are global — starring here writes the same
	// scoped-localStorage set the main catalog reads, so state stays in sync.
	const pinnedEntityIds = useEditorStore((state) => state.pinnedEntityIds)
	const togglePinnedEntity = useEditorStore((state) => state.togglePinnedEntity)
	const pinnedEntitySet = useMemo(() => new Set(pinnedEntityIds), [pinnedEntityIds])
	const toggleDatasetFavorite = useCallback(
		(event: GeoDataset) => {
			togglePinnedEntity(`dataset:${getDatasetKey(event)}`)
		},
		[togglePinnedEntity, getDatasetKey],
	)
	const toggleContextFavorite = useCallback(
		(context: MapContext) => {
			const coordinate = getContextCoordinate(context)
			if (coordinate) togglePinnedEntity(`context:${coordinate}`)
		},
		[togglePinnedEntity],
	)
	const effectiveContextCoordinate = viewContext?.contextCoordinate ?? activeContextScopeCoordinate

	const userGeoEvents = useMemo(
		() => geoEvents.filter((event) => event.pubkey === pubkey),
		[geoEvents, pubkey],
	)
	const userContextEvents = useMemo(
		() => mapContextEvents.filter((event) => event.pubkey === pubkey),
		[mapContextEvents, pubkey],
	)
	const sortedWorkspaces = useMemo(
		() => Object.values(workspaces).sort((a, b) => b.updatedAt - a.updatedAt),
		[workspaces],
	)

	const handleDeleteWorkspace = useCallback(
		async (workspaceId: string) => {
			if (!onDeleteWorkspace) return
			setDeletingWorkspaceId(workspaceId)
			try {
				await onDeleteWorkspace(workspaceId)
			} finally {
				setConfirmingWorkspaceId((current) => (current === workspaceId ? null : current))
				setDeletingWorkspaceId((current) => (current === workspaceId ? null : current))
			}
		},
		[onDeleteWorkspace],
	)

	const datasetReferenceMap = useMemo(() => {
		const map = new Map<string, GeoDataset>()
		geoEvents.forEach((event) => {
			const datasetId = event.datasetId ?? event.dTag ?? event.id
			if (!datasetId) return
			const kind = event.kind ?? GEO_EVENT_KIND
			map.set(`${kind}:${event.pubkey}:${datasetId}`, event)
		})
		return map
	}, [geoEvents])

	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const proposalFilters = useMemo(() => {
		if (!pubkey) return null
		return [{ kinds: [GEO_EDIT_PROPOSAL_KIND], authors: [pubkey] }]
	}, [pubkey])

	const { events: proposalEvents, eose: proposalEose } = useTimelineWithEose(proposalFilters)

	const userProposalEvents = useMemo(() => {
		return proposalEvents
			.filter((event) => event.kind === GEO_EDIT_PROPOSAL_KIND)
			.map((event) => castEvent(event, GeoProposal, eventStore))
			.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [proposalEvents])

	const proposalStatusFilters = useMemo(() => {
		if (userProposalEvents.length === 0) return null
		const addresses = userProposalEvents
			.map((proposal) => proposal.proposalCoordinate)
			.filter((value): value is string => Boolean(value))
		if (addresses.length === 0) return null
		return [
			{
				kinds: [
					PROPOSAL_STATUS_OPEN_KIND,
					PROPOSAL_STATUS_APPLIED_KIND,
					PROPOSAL_STATUS_CLOSED_KIND,
					PROPOSAL_STATUS_DRAFT_KIND,
				],
				'#a': addresses,
			},
		]
	}, [userProposalEvents])

	const { events: proposalStatusEvents, eose: proposalStatusEose } =
		useTimelineWithEose(proposalStatusFilters)

	const datasetResult = useSortedFilteredItems(userGeoEvents, datasetFilterConfig, filterState)
	const contextResult = useSortedFilteredItems(userContextEvents, contextFilterConfig, filterState)

	const userProposalRows = useMemo<UserProposalRow[]>(() => {
		return userProposalEvents.map((proposal) => {
			const targetAddress = proposal.targetAddress ?? ''
			const targetDataset = targetAddress ? (datasetReferenceMap.get(targetAddress) ?? null) : null
			const statusInfo = proposal.proposalCoordinate
				? getLatestProposalStatus(proposalStatusEvents, proposal.proposalCoordinate)
				: undefined
			return {
				proposal,
				description: proposal.description?.trim() || '(No description)',
				targetName: targetDataset
					? getDatasetName(targetDataset)
					: proposal.targetDatasetId || 'Unknown dataset',
				targetAddress,
				targetDataset,
				status: statusInfo?.status ?? 'open',
				created_at: proposal.created_at,
				pubkey: proposal.pubkey,
			}
		})
	}, [userProposalEvents, datasetReferenceMap, proposalStatusEvents, getDatasetName])

	const proposalFilterConfig = useMemo<FilterConfig<UserProposalRow>>(
		() => ({
			getSearchableText: (row) => [
				row.description,
				row.targetName,
				row.targetAddress,
				row.proposal.targetDatasetId,
				row.status,
			],
			getName: (row) => row.targetName,
		}),
		[],
	)

	const proposalResult = useSortedFilteredItems(userProposalRows, proposalFilterConfig, filterState)
	const filteredGeoEvents = datasetResult.items
	const filteredContexts = contextResult.items
	const filteredProposals = proposalResult.items

	const tabItems = useMemo(() => {
		const items: Array<{ id: TabMode; label: string; count: number; icon: typeof Database }> = [
			{ id: 'datasets', label: 'Datasets', count: userGeoEvents.length, icon: Database },
			{ id: 'contexts', label: 'Contexts', count: userContextEvents.length, icon: Globe },
			{ id: 'proposals', label: 'Proposals', count: userProposalRows.length, icon: MessageSquare },
		]
		if (isOwnProfile) {
			items.push({
				id: 'workspaces',
				label: 'Workspaces',
				count: sortedWorkspaces.length,
				icon: Layers,
			})
		}
		return items
	}, [
		isOwnProfile,
		sortedWorkspaces.length,
		userContextEvents.length,
		userGeoEvents.length,
		userProposalRows.length,
	])

	const datasetTableData: DatasetRowData[] = useMemo(
		() =>
			filteredGeoEvents.map((event) => {
				const datasetKey = getDatasetKey(event)
				return {
					event,
					datasetKey,
					datasetName: getDatasetName(event),
					isActive: false,
					isOwned: true,
					isVisible: datasetVisibility[datasetKey] !== false,
					isInMapStack: Boolean(mapStackEntries[`dataset:${datasetKey}`]),
					isCatalogPinned: pinnedEntitySet.has(`dataset:${datasetKey}`),
					primaryLabel: isOwnProfile ? 'Edit dataset' : 'Load copy',
				}
			}),
		[
			filteredGeoEvents,
			getDatasetKey,
			getDatasetName,
			datasetVisibility,
			isOwnProfile,
			mapStackEntries,
			pinnedEntitySet,
		],
	)

	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onAddDatasetToMap,
			onRemoveDatasetFromMap,
			onToggleCatalogPin: toggleDatasetFavorite,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		}),
		[
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
			onAddDatasetToMap,
			onRemoveDatasetFromMap,
			toggleDatasetFavorite,
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		],
	)
	const datasetColumns = useMemo(
		() => createDatasetColumns(datasetColumnsContext),
		[datasetColumnsContext],
	)

	// Round F.3: same stack-toggle verb as the main catalog — store-direct so
	// the profile view stays consistent without extra prop drilling.
	const toggleContextOnMap = useCallback((context: MapContext) => {
		const coordinate = getContextCoordinate(context)
		if (!coordinate) return
		const store = useEditorStore.getState()
		const entryId = `context:${coordinate}`
		if (store.mapStackEntries[entryId]) {
			store.removeMapStackEntry(entryId)
			return
		}
		store.addMapStackEntry({
			entityType: 'context',
			entityKey: coordinate,
			title: getContextDisplayName(context),
			source: 'manual',
			visible: true,
			pinned: false,
		})
	}, [])

	const contextColumnsContext: ContextColumnsContext = useMemo(
		() => ({
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onToggleContextOnMap: toggleContextOnMap,
			onToggleCatalogPin: toggleContextFavorite,
			onOpenDebug,
		}),
		[
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onOpenDebug,
			toggleContextOnMap,
			toggleContextFavorite,
		],
	)
	const contextColumns = useMemo(
		() => createContextColumns(contextColumnsContext),
		[contextColumnsContext],
	)

	const contextTableData: ContextRowData[] = useMemo(() => {
		const nameByCoordinate = new Map<string, string>()
		filteredContexts.forEach((context) => {
			const coordinate = context.contextCoordinate
			if (coordinate) {
				nameByCoordinate.set(coordinate, getContextDisplayName(context))
			}
		})
		return orderContextsForDisplay(filteredContexts).map(
			({ context, depth, displayParentCoordinate }) => ({
				context,
				contextName: getContextDisplayName(context),
				contextUse: getEffectiveContextUse(context),
				validationMode: context.context.allowForeignAttachments
					? getEffectiveContextValidationMode(context)
					: null,
				attachmentPolicy: context.context.allowForeignAttachments ? 'open' : 'closed',
				displayDepth: depth,
				displayParentName: displayParentCoordinate
					? (nameByCoordinate.get(displayParentCoordinate) ?? null)
					: null,
				isCuratedChild:
					depth > 0 &&
					!context.context.allowForeignAttachments &&
					context.contextReferences.length > 0,
				attachmentCount: context.contextReferences.length,
				isInMapStack: Boolean(
					getContextCoordinate(context) &&
						mapStackEntries[`context:${getContextCoordinate(context)}`],
				),
				isCatalogPinned: Boolean(
					getContextCoordinate(context) &&
						pinnedEntitySet.has(`context:${getContextCoordinate(context)}`),
				),
				isMapActive: getContextCoordinate(context) === effectiveContextCoordinate,
			}),
		)
	}, [filteredContexts, effectiveContextCoordinate, mapStackEntries, pinnedEntitySet])

	const proposalColumns = useMemo<ColumnDef<UserProposalRow>[]>(
		() => [
			{
				accessorKey: 'description',
				header: 'Proposal',
				cell: ({ row }) => {
					const item = row.original
					return (
						<div className="max-w-[260px] space-y-0.5">
							<div className="line-clamp-2 text-xs font-semibold text-gray-900">
								{item.description}
							</div>
							<div className="truncate text-[10px] text-gray-500" title={item.targetAddress}>
								Target: {item.targetName}
							</div>
						</div>
					)
				},
			},
			{
				accessorKey: 'status',
				header: 'Status',
				size: 110,
				cell: ({ row }) => {
					const status = row.original.status
					return (
						<span
							className={`rounded px-1.5 py-0.5 text-[10px] capitalize ${PROPOSAL_STATUS_STYLES[status]}`}
						>
							{status}
						</span>
					)
				},
			},
			{
				id: 'actions',
				header: '',
				size: 90,
				cell: ({ row }) => {
					const item = row.original
					const inspectDisabled = !item.targetDataset || !onInspectDataset
					return (
						<div className="flex items-center gap-0.5">
							<Button
								size="icon-sm"
								variant="outline"
								disabled={inspectDisabled}
								onClick={() => {
									if (!item.targetDataset) return
									onInspectDataset?.(item.targetDataset)
								}}
								aria-label="Inspect target dataset"
								title={inspectDisabled ? 'Target dataset not loaded' : 'Inspect target dataset'}
							>
								<Eye className="h-3 w-3" />
							</Button>
						</div>
					)
				},
			},
		],
		[onInspectDataset],
	)

	const isProposalsLoading =
		!proposalEose ||
		(userProposalEvents.length > 0 && proposalStatusFilters !== null && !proposalStatusEose)

	const activeResult =
		activeTab === 'datasets'
			? datasetResult
			: activeTab === 'contexts'
				? contextResult
				: activeTab === 'proposals'
					? proposalResult
					: null

	return (
		<div className="space-y-4">
			<div className="px-1">
				<UserProfile
					pubkey={pubkey}
					mode="avatar-name-bio"
					size="lg"
					showNip05Badge={true}
					showBio={true}
				/>
				{isOwnProfile ? (
					<p className="mt-2 text-xs text-emerald-600">This is your profile</p>
				) : null}
			</div>

			<div
				className={isOwnProfile ? 'grid grid-cols-4 gap-2' : 'grid grid-cols-3 gap-2'}
				role="tablist"
				aria-label="Profile sections"
			>
				{tabItems.map((tab) => {
					const Icon = tab.icon
					const isActive = activeTab === tab.id
					return (
						<Button
							key={tab.id}
							type="button"
							variant={isActive ? 'default' : 'outline'}
							size="sm"
							role="tab"
							aria-selected={isActive}
							aria-label={`${tab.label} (${tab.count})`}
							title={`${tab.label} (${tab.count})`}
							onClick={() => setActiveTab(tab.id)}
							className="flex h-auto min-h-14 w-full flex-col gap-1 rounded-xl px-2 py-2 text-center"
						>
							<span className="flex items-center justify-center gap-2">
								<Icon className="h-4 w-4 shrink-0" />
								<span className="text-sm font-semibold leading-none">{tab.count}</span>
							</span>
							<span className="hidden text-[10px] uppercase tracking-[0.14em] text-current/75 md:block">
								{tab.label}
							</span>
						</Button>
					)
				})}
			</div>

			{activeResult ? (
				<DatasetFilterToolbar
					{...filterState}
					totalCount={activeResult.totalCount}
					filteredCount={activeResult.filteredCount}
					displayedCount={activeResult.displayedCount}
					hasMore={activeResult.hasMore}
				/>
			) : null}

			{activeTab === 'datasets' ? (
				userGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets published by this user.</p>
				) : filteredGeoEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No datasets match your filters.</p>
				) : (
					<DataTable
						columns={datasetColumns}
						data={datasetTableData}
						getRowId={(row) => row.datasetKey}
						getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
					/>
				)
			) : activeTab === 'contexts' ? (
				userContextEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No contexts published by this user.</p>
				) : filteredContexts.length === 0 ? (
					<p className="text-xs text-gray-500">No contexts match your filters.</p>
				) : (
					<DataTable
						columns={contextColumns}
						data={contextTableData}
						getRowId={(row) =>
							row.context.contextId ?? row.context.dTag ?? row.context.id ?? row.context.pubkey
						}
					/>
				)
			) : activeTab === 'proposals' ? (
				isProposalsLoading && userProposalRows.length === 0 ? (
					<p className="text-xs text-gray-500">Loading change proposals...</p>
				) : userProposalRows.length === 0 ? (
					<p className="text-xs text-gray-500">No change proposals published by this user.</p>
				) : filteredProposals.length === 0 ? (
					<p className="text-xs text-gray-500">No proposals match your filters.</p>
				) : (
					<DataTable
						columns={proposalColumns}
						data={filteredProposals}
						getRowId={(row) =>
							row.proposal.id ??
							row.proposal.proposalId ??
							`${row.proposal.pubkey}:${row.proposal.created_at ?? 0}`
						}
					/>
				)
			) : !isOwnProfile ? (
				<p className="text-xs text-gray-500">
					Workspace management is only available on your profile.
				</p>
			) : sortedWorkspaces.length === 0 ? (
				<p className="text-xs text-gray-500">No local workspaces yet.</p>
			) : (
				<div className="space-y-2">
					{sortedWorkspaces.map((workspace) => {
						const isActive = workspace.id === activeWorkspaceId
						const isDeleting = deletingWorkspaceId === workspace.id
						const isConfirmingDelete = confirmingWorkspaceId === workspace.id
						return (
							<div
								key={workspace.id}
								className="rounded-xl border border-border/70 bg-card/70 px-3 py-3 shadow-sm"
							>
								<div className="flex items-start justify-between gap-3">
									<div className="min-w-0 space-y-1">
										<div className="flex flex-wrap items-center gap-2">
											<p className="truncate text-sm font-medium text-foreground">
												{workspace.label}
											</p>
											<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
												{workspace.kind === 'scratch' ? 'draft' : 'dataset'}
											</span>
											{isActive ? (
												<span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-700">
													Active
												</span>
											) : null}
										</div>
										<p className="text-xs text-muted-foreground">
											Updated {new Date(workspace.updatedAt).toLocaleString()}
										</p>
										<div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
											<span>{workspace.activeDraftId ? 'Draft linked' : 'No draft linked'}</span>
											<span className="inline-flex items-center gap-1">
												<MessageCircle className="h-3 w-3" />
												{workspace.chatSessionId ? 'Chat attached' : 'No chat'}
											</span>
										</div>
									</div>
									<div className="flex shrink-0 items-center gap-2">
										{!isActive && onSwitchWorkspace ? (
											<Button
												size="sm"
												variant="outline"
												onClick={() => onSwitchWorkspace(workspace.id)}
												disabled={isDeleting || isConfirmingDelete}
											>
												Open
											</Button>
										) : null}
										<Button
											size="sm"
											variant="ghost"
											className="text-destructive hover:text-destructive"
											onClick={() =>
												setConfirmingWorkspaceId((current) =>
													current === workspace.id ? null : workspace.id,
												)
											}
											disabled={!onDeleteWorkspace || isDeleting}
										>
											<Trash2 className="mr-1 h-3.5 w-3.5" />
											{isConfirmingDelete ? 'Cancel' : isDeleting ? 'Deleting...' : 'Delete'}
										</Button>
									</div>
								</div>
								{isConfirmingDelete ? (
									<div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-900">
										<span className="min-w-0 flex-1 truncate">
											Remove workspace "{workspace.label}"?
										</span>
										<div className="flex shrink-0 items-center gap-2">
											<Button
												size="sm"
												variant="ghost"
												className="h-7 px-2 text-[11px]"
												onClick={() => setConfirmingWorkspaceId(null)}
												disabled={isDeleting}
											>
												Keep
											</Button>
											<Button
												size="sm"
												variant="destructive"
												className="h-7 px-2 text-[11px]"
												onClick={() => void handleDeleteWorkspace(workspace.id)}
												disabled={isDeleting}
											>
												{isDeleting ? 'Deleting...' : 'Delete'}
											</Button>
										</div>
									</div>
								) : null}
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}
