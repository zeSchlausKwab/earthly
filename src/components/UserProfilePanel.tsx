import { useSubscribe } from '@nostr-dev-kit/react'
import type { NDKEvent } from '@nostr-dev-kit/react'
import type { ColumnDef } from '@tanstack/react-table'
import { Eye } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import { NDKGeoEditProposalEvent } from '../lib/ndk/NDKGeoEditProposalEvent'
import { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import type { NDKMapContextEvent } from '../lib/ndk/NDKMapContextEvent'
import {
	GEO_EDIT_PROPOSAL_KIND,
	PROPOSAL_STATUS_APPLIED_KIND,
	PROPOSAL_STATUS_CLOSED_KIND,
	PROPOSAL_STATUS_DRAFT_KIND,
	PROPOSAL_STATUS_OPEN_KIND,
} from '../lib/ndk/kinds'
import { getLatestProposalStatus, type ProposalStatus } from '../lib/ndk/proposalStatus'
import {
	type CollectionColumnsContext,
	type CollectionRowData,
	createCollectionColumns,
} from '../features/collections/collections-columns'
import {
	type ContextColumnsContext,
	type ContextRowData,
	createContextColumns,
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
	/** The pubkey of the user to display */
	pubkey: string
	/** All available geo events */
	geoEvents: NDKGeoEvent[]
	/** All available collection events */
	collectionEvents: NDKGeoCollectionEvent[]
	/** All available map context events */
	mapContextEvents: NDKMapContextEvent[]
	/** Current logged-in user's pubkey */
	currentUserPubkey?: string
	datasetVisibility: Record<string, boolean>
	collectionVisibility: Record<string, boolean>
	isPublishing: boolean
	deletingKey: string | null
	// Dataset callbacks
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onToggleAllVisibility: (visible: boolean) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
	onInspectDataset?: (event: NDKGeoEvent) => void
	// Collection callbacks
	onToggleCollectionVisibility: (collection: NDKGeoCollectionEvent) => void
	onToggleAllCollectionVisibility: (visible: boolean) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	onInspectContext?: (context: NDKMapContextEvent) => void
	onEditCollection?: (collection: NDKGeoCollectionEvent) => void
	onEditContext?: (context: NDKMapContextEvent) => void
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent | NDKMapContextEvent) => void
}

type TabMode = 'datasets' | 'collections' | 'contexts' | 'proposals'

interface UserProposalRow {
	proposal: NDKGeoEditProposalEvent
	description: string
	targetName: string
	targetAddress: string
	targetDataset: NDKGeoEvent | null
	status: ProposalStatus
	created_at?: number
	pubkey: string
}

const getDatasetDescriptionText = (event: NDKGeoEvent): string | undefined => {
	const featureCollection = event.featureCollection as Record<string, unknown>
	if (!featureCollection) return undefined
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		(featureCollection?.properties as Record<string, unknown>)?.description,
		(featureCollection?.properties as Record<string, unknown>)?.summary,
	]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value
		}
	}
	return undefined
}

const getCollectionDisplayName = (collection: NDKGeoCollectionEvent): string => {
	const metadata = collection.metadata
	return metadata.name ?? collection.collectionId ?? collection.id ?? 'Untitled'
}

const createDatasetFilterConfig = (
	getDatasetName: (event: NDKGeoEvent) => string,
): FilterConfig<NDKGeoEvent> => ({
	getSearchableText: (event) => [getDatasetName(event), getDatasetDescriptionText(event)],
	getName: (event) => getDatasetName(event),
})

const collectionFilterConfig: FilterConfig<NDKGeoCollectionEvent> = {
	getSearchableText: (collection) => {
		const metadata = collection.metadata
		return [metadata.name, metadata.description, collection.collectionId, collection.id]
	},
	getName: (collection) => getCollectionDisplayName(collection),
}

const getContextDisplayName = (context: NDKMapContextEvent): string => {
	return context.context.name || context.contextId || context.id || 'Untitled'
}

const contextFilterConfig: FilterConfig<NDKMapContextEvent> = {
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
	collectionEvents,
	mapContextEvents,
	currentUserPubkey,
	datasetVisibility,
	collectionVisibility,
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
	onToggleCollectionVisibility,
	onToggleAllCollectionVisibility,
	onZoomToCollection,
	onInspectCollection,
	onInspectContext,
	onEditCollection,
	onEditContext,
	onOpenDebug,
}: UserProfilePanelProps) {
	const [activeTab, setActiveTab] = useState<TabMode>('datasets')
	const filterState = useFilterState()

	const isOwnProfile = currentUserPubkey === pubkey

	// Filter events to only show items owned by this user
	const userGeoEvents = useMemo(
		() => geoEvents.filter((event) => event.pubkey === pubkey),
		[geoEvents, pubkey],
	)

	const userCollectionEvents = useMemo(
		() => collectionEvents.filter((event) => event.pubkey === pubkey),
		[collectionEvents, pubkey],
	)

	const userContextEvents = useMemo(
		() => mapContextEvents.filter((event) => event.pubkey === pubkey),
		[mapContextEvents, pubkey],
	)

	// Build reference map for collections
	const datasetReferenceMap = useMemo(() => {
		const map = new Map<string, NDKGeoEvent>()
		geoEvents.forEach((event) => {
			const datasetId = event.datasetId ?? event.dTag ?? event.id
			if (!datasetId) return
			const kind = event.kind ?? NDKGeoEvent.kinds[0]
			map.set(`${kind}:${event.pubkey}:${datasetId}`, event)
		})
		return map
	}, [geoEvents])

	// Filter configs
	const datasetFilterConfig = useMemo(
		() => createDatasetFilterConfig(getDatasetName),
		[getDatasetName],
	)

	const proposalFilters = useMemo(() => {
		if (!pubkey) return false
		return [
			{
				kinds: [GEO_EDIT_PROPOSAL_KIND],
				authors: [pubkey],
			},
		]
	}, [pubkey])

	const { events: proposalEvents, eose: proposalEose } = useSubscribe(proposalFilters)

	const userProposalEvents = useMemo(() => {
		return proposalEvents
			.filter((event: NDKEvent) => event.kind === GEO_EDIT_PROPOSAL_KIND)
			.map((event: NDKEvent) => NDKGeoEditProposalEvent.from(event))
			.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0))
	}, [proposalEvents])

	const proposalStatusFilters = useMemo(() => {
		if (userProposalEvents.length === 0) return false
		const addresses = userProposalEvents
			.map((proposal) => proposal.proposalCoordinate)
			.filter((value): value is string => Boolean(value))
		if (addresses.length === 0) return false
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
		useSubscribe(proposalStatusFilters)

	// Apply sorting/filtering to user's items
	const datasetResult = useSortedFilteredItems(userGeoEvents, datasetFilterConfig, filterState)
	const collectionResult = useSortedFilteredItems(
		userCollectionEvents,
		collectionFilterConfig,
		filterState,
	)
	const contextResult = useSortedFilteredItems(userContextEvents, contextFilterConfig, filterState)

	const userProposalRows = useMemo<UserProposalRow[]>(() => {
		return userProposalEvents.map((proposal) => {
			const targetAddress = proposal.targetAddress ?? ''
			const targetDataset = targetAddress ? (datasetReferenceMap.get(targetAddress) ?? null) : null
			const statusInfo = proposal.proposalCoordinate
				? getLatestProposalStatus(proposalStatusEvents, proposal.proposalCoordinate)
				: undefined
			const status = statusInfo?.status ?? 'open'
			return {
				proposal,
				description: proposal.description?.trim() || '(No description)',
				targetName: targetDataset
					? getDatasetName(targetDataset)
					: proposal.targetDatasetId || 'Unknown dataset',
				targetAddress,
				targetDataset,
				status,
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
	const filteredCollections = collectionResult.items
	const filteredContexts = contextResult.items
	const filteredProposals = proposalResult.items

	// Dataset table data
	const datasetTableData: DatasetRowData[] = useMemo(() => {
		return filteredGeoEvents.map((event) => {
			const datasetKey = getDatasetKey(event)
			const isVisible = datasetVisibility[datasetKey] !== false
			const datasetName = getDatasetName(event)

			return {
				event,
				datasetKey,
				datasetName,
				isActive: false,
				isOwned: true, // All items in this panel are owned by the profile user
				isVisible,
				primaryLabel: isOwnProfile ? 'Edit dataset' : 'Load copy',
			}
		})
	}, [filteredGeoEvents, datasetVisibility, getDatasetKey, getDatasetName, isOwnProfile])

	// Visibility state for datasets
	const allVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (datasetTableData.length === 0) return 'none'
		const visibleCount = datasetTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === datasetTableData.length) return 'all'
		return 'some'
	}, [datasetTableData])

	// Collection key helper
	const getCollectionKey = useCallback((collection: NDKGeoCollectionEvent): string => {
		return collection.dTag ?? collection.id ?? collection.collectionId ?? ''
	}, [])

	// Collection table data
	const collectionTableData: CollectionRowData[] = useMemo(() => {
		return filteredCollections.map((collection) => {
			const collectionName = getCollectionDisplayName(collection)
			const datasetCount = collection.datasetReferences.length
			const referencedEvents = collection.datasetReferences
				.map((reference) => datasetReferenceMap.get(reference))
				.filter((event): event is NDKGeoEvent => Boolean(event))
			const zoomDisabled =
				!onZoomToCollection || (!collection.boundingBox && referencedEvents.length === 0)
			const collectionKey = getCollectionKey(collection)
			const isVisible = collectionVisibility[collectionKey] !== false

			return {
				collection,
				collectionName,
				datasetCount,
				referencedEvents,
				zoomDisabled,
				isVisible,
			}
		})
	}, [
		filteredCollections,
		datasetReferenceMap,
		onZoomToCollection,
		collectionVisibility,
		getCollectionKey,
	])

	// Visibility state for collections
	const allCollectionVisibleState = useMemo((): 'all' | 'none' | 'some' => {
		if (collectionTableData.length === 0) return 'none'
		const visibleCount = collectionTableData.filter((row) => row.isVisible).length
		if (visibleCount === 0) return 'none'
		if (visibleCount === collectionTableData.length) return 'all'
		return 'some'
	}, [collectionTableData])

	// Dataset columns context
	// Note: resolvingDatasets/resolvingProgress not included - DatasetLoadButton subscribes directly to store
	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onToggleAllVisibility,
			onZoomToDataset,
			onInspectDataset,
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
			onOpenDebug,
			isPublishing,
			deletingKey,
			allVisibleState,
		],
	)

	// Collection columns context
	const collectionColumnsContext: CollectionColumnsContext = useMemo(
		() => ({
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleVisibility: onToggleCollectionVisibility,
			onToggleAllVisibility: onToggleAllCollectionVisibility,
			currentUserPubkey,
			allVisibleState: allCollectionVisibleState,
		}),
		[
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName,
			onEditCollection,
			onToggleCollectionVisibility,
			onToggleAllCollectionVisibility,
			currentUserPubkey,
			allCollectionVisibleState,
		],
	)

	const datasetColumns = useMemo(
		() => createDatasetColumns(datasetColumnsContext),
		[datasetColumnsContext],
	)

	const collectionColumns = useMemo(
		() => createCollectionColumns(collectionColumnsContext),
		[collectionColumnsContext],
	)

	const contextColumnsContext: ContextColumnsContext = useMemo(
		() => ({
			currentUserPubkey,
			onInspectContext,
			onEditContext,
			onOpenDebug,
		}),
		[currentUserPubkey, onInspectContext, onEditContext, onOpenDebug],
	)

	const contextColumns = useMemo(
		() => createContextColumns(contextColumnsContext),
		[contextColumnsContext],
	)

	const contextTableData: ContextRowData[] = useMemo(
		() =>
			filteredContexts.map((context) => ({
				context,
				contextName: getContextDisplayName(context),
				contextUse: context.context.contextUse,
				validationMode: context.context.validationMode,
			})),
		[filteredContexts],
	)

	const proposalColumns = useMemo<ColumnDef<UserProposalRow>[]>(
		() => [
			{
				accessorKey: 'description',
				header: 'Proposal',
				cell: ({ row }) => {
					const item = row.original
					return (
						<div className="space-y-0.5 max-w-[260px]">
							<div className="text-xs font-semibold text-gray-900 line-clamp-2">
								{item.description}
							</div>
							<div className="text-[10px] text-gray-500 truncate" title={item.targetAddress}>
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
		(userProposalEvents.length > 0 && proposalStatusFilters !== false && !proposalStatusEose)

	const activeResult =
		activeTab === 'datasets'
			? datasetResult
			: activeTab === 'collections'
				? collectionResult
				: activeTab === 'contexts'
					? contextResult
					: proposalResult

	return (
		<div className="space-y-4">
			{/* User Profile Header */}
			<div className="px-1">
				<UserProfile
					pubkey={pubkey}
					mode="avatar-name-bio"
					size="lg"
					showNip05Badge={true}
					showBio={true}
				/>
				{isOwnProfile && <p className="text-xs text-emerald-600 mt-2">This is your profile</p>}
			</div>

			{/* Tabs */}
			<div className="flex gap-1 border-b border-gray-200">
				<Button
					variant={activeTab === 'datasets' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('datasets')}
					className="rounded-b-none"
				>
					Datasets ({userGeoEvents.length})
				</Button>
				<Button
					variant={activeTab === 'collections' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('collections')}
					className="rounded-b-none"
				>
					Collections ({userCollectionEvents.length})
				</Button>
				<Button
					variant={activeTab === 'contexts' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('contexts')}
					className="rounded-b-none"
				>
					Contexts ({userContextEvents.length})
				</Button>
				<Button
					variant={activeTab === 'proposals' ? 'default' : 'ghost'}
					size="sm"
					onClick={() => setActiveTab('proposals')}
					className="rounded-b-none"
				>
					Proposals ({userProposalRows.length})
				</Button>
			</div>

			{/* Filter toolbar */}
			<DatasetFilterToolbar
				{...filterState}
				totalCount={activeResult.totalCount}
				filteredCount={activeResult.filteredCount}
				displayedCount={activeResult.displayedCount}
				hasMore={activeResult.hasMore}
			/>

			{/* Content */}
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
			) : activeTab === 'collections' ? (
				userCollectionEvents.length === 0 ? (
					<p className="text-xs text-gray-500">No collections created by this user.</p>
				) : filteredCollections.length === 0 ? (
					<p className="text-xs text-gray-500">No collections match your filters.</p>
				) : (
					<DataTable
						columns={collectionColumns}
						data={collectionTableData}
						getRowId={(row) =>
							row.collection.dTag ??
							row.collection.collectionId ??
							row.collection.id ??
							row.collection.pubkey
						}
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
			) : isProposalsLoading && userProposalRows.length === 0 ? (
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
			)}
		</div>
	)
}
