import { X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent';
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent';
import { type CollectionColumnsContext, type CollectionRowData, createCollectionColumns } from './collections-columns';
import { createDatasetColumns, type DatasetColumnsContext, type DatasetRowData } from './datasets-columns';
import { Button } from './ui/button';
import { DataTable } from './ui/data-table';
import { Input } from './ui/Input';

export interface GeoDatasetsPanelProps {
	geoEvents: NDKGeoEvent[];
	collectionEvents: NDKGeoCollectionEvent[];
	activeDataset: NDKGeoEvent | null;
	currentUserPubkey?: string;
	datasetVisibility: Record<string, boolean>;
	isPublishing: boolean;
	deletingKey: string | null;
	onClearEditing: () => void;
	onLoadDataset: (event: NDKGeoEvent) => void;
	onToggleVisibility: (event: NDKGeoEvent) => void;
	onZoomToDataset: (event: NDKGeoEvent) => void;
	onDeleteDataset: (event: NDKGeoEvent) => void;
	getDatasetKey: (event: NDKGeoEvent) => string;
	getDatasetName: (event: NDKGeoEvent) => string;
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void;
	onInspectDataset?: (event: NDKGeoEvent) => void;
	onInspectCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void;
	onOpenDebug?: (event: NDKGeoEvent | NDKGeoCollectionEvent) => void;
	onClose?: () => void;
}

const getDatasetDescriptionText = (event: NDKGeoEvent): string | undefined => {
	const featureCollection = event.featureCollection as Record<string, any>;
	if (!featureCollection) return undefined;
	const candidates = [
		featureCollection?.description,
		featureCollection?.summary,
		featureCollection?.properties?.description,
		featureCollection?.properties?.summary
	];
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value;
		}
	}
	return undefined;
};

const getCollectionDisplayName = (collection: NDKGeoCollectionEvent): string => {
	const metadata = collection.metadata;
	return metadata.name ?? collection.collectionId ?? collection.id ?? 'Untitled';
};

export function GeoDatasetsPanelContent({
	geoEvents,
	collectionEvents,
	activeDataset,
	currentUserPubkey,
	datasetVisibility,
	isPublishing,
	deletingKey,
	onClearEditing,
	onLoadDataset,
	onToggleVisibility,
	onZoomToDataset,
	onDeleteDataset,
	getDatasetKey,
	getDatasetName,
	onZoomToCollection,
	onInspectDataset,
	onInspectCollection,
	onOpenDebug,
	onClose
}: GeoDatasetsPanelProps) {
	const [activeTab, setActiveTab] = useState<'datasets' | 'collections'>('datasets');
	const [searchQuery, setSearchQuery] = useState('');
	const [ownedOnly, setOwnedOnly] = useState(false);

	useEffect(() => {
		if (!currentUserPubkey) {
			setOwnedOnly(false);
		}
	}, [currentUserPubkey]);

	const normalizedQuery = searchQuery.trim().toLowerCase();

	const datasetReferenceMap = useMemo(() => {
		const map = new Map<string, NDKGeoEvent>();
		geoEvents.forEach((event) => {
			const datasetId = event.datasetId ?? event.dTag ?? event.id;
			if (!datasetId) return;
			const kind = event.kind ?? NDKGeoEvent.kinds[0];
			map.set(`${kind}:${event.pubkey}:${datasetId}`, event);
		});
		return map;
	}, [geoEvents]);

	const filteredGeoEvents = useMemo(() => {
		return geoEvents.filter((event) => {
			if (ownedOnly && (!currentUserPubkey || event.pubkey !== currentUserPubkey)) {
				return false;
			}
			if (!normalizedQuery) {
				return true;
			}
			const datasetDescription = getDatasetDescriptionText(event);
			const searchValues = [getDatasetName(event), datasetDescription];
			return searchValues.some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery));
		});
	}, [geoEvents, ownedOnly, currentUserPubkey, getDatasetName, normalizedQuery]);

	const filteredCollections = useMemo(() => {
		return collectionEvents.filter((collection) => {
			if (ownedOnly && (!currentUserPubkey || collection.pubkey !== currentUserPubkey)) {
				return false;
			}
			if (!normalizedQuery) {
				return true;
			}
			const metadata = collection.metadata;
			const searchValues = [metadata.name, metadata.description, collection.collectionId, collection.id];
			return searchValues.some((value) => typeof value === 'string' && value.toLowerCase().includes(normalizedQuery));
		});
	}, [collectionEvents, ownedOnly, currentUserPubkey, normalizedQuery]);

	// Prepare dataset table data
	const datasetTableData: DatasetRowData[] = useMemo(() => {
		return filteredGeoEvents.map((event) => {
			const datasetKey = getDatasetKey(event);
			const isActive = activeDataset && getDatasetKey(activeDataset) === datasetKey;
			const isOwned = currentUserPubkey === event.pubkey;
			const primaryLabel = isActive ? 'Loaded in editor' : isOwned ? 'Edit dataset' : 'Load copy';
			const datasetName = getDatasetName(event);
			const isVisible = datasetVisibility[datasetKey] !== false;

			return {
				event,
				datasetKey,
				datasetName,
				isActive: !!isActive,
				isOwned,
				isVisible,
				primaryLabel
			};
		});
	}, [filteredGeoEvents, activeDataset, currentUserPubkey, datasetVisibility, getDatasetKey, getDatasetName]);

	// Prepare collection table data
	const collectionTableData: CollectionRowData[] = useMemo(() => {
		return filteredCollections.map((collection) => {
			const collectionName = getCollectionDisplayName(collection);
			const datasetCount = collection.datasetReferences.length;
			const referencedEvents = collection.datasetReferences
				.map((reference) => datasetReferenceMap.get(reference))
				.filter((event): event is NDKGeoEvent => Boolean(event));
			const zoomDisabled = !onZoomToCollection || (!collection.boundingBox && referencedEvents.length === 0);

			return {
				collection,
				collectionName,
				datasetCount,
				referencedEvents,
				zoomDisabled
			};
		});
	}, [filteredCollections, datasetReferenceMap, onZoomToCollection]);

	// Dataset columns context
	const datasetColumnsContext: DatasetColumnsContext = useMemo(
		() => ({
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			isPublishing,
			deletingKey
		}),
		[
			onLoadDataset,
			onDeleteDataset,
			onToggleVisibility,
			onZoomToDataset,
			onInspectDataset,
			onOpenDebug,
			isPublishing,
			deletingKey
		]
	);

	// Collection columns context
	const collectionColumnsContext: CollectionColumnsContext = useMemo(
		() => ({
			onZoomToCollection,
			onInspectCollection,
			onOpenDebug,
			getDatasetName
		}),
		[onZoomToCollection, onInspectCollection, onOpenDebug, getDatasetName]
	);

	const datasetColumns = useMemo(() => createDatasetColumns(datasetColumnsContext), [datasetColumnsContext]);

	const collectionColumns = useMemo(
		() => createCollectionColumns(collectionColumnsContext),
		[collectionColumnsContext]
	);

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-base font-semibold text-gray-800">Datasets</h3>
					<p className="text-xs text-gray-500">Remote GeoJSON datasets and collections available to load.</p>
				</div>
				{onClose && (
					<Button size="icon" variant="ghost" aria-label="Close datasets panel" onClick={onClose}>
						<X className="h-4 w-4" />
					</Button>
				)}
			</div>
			<div className="flex gap-2">
				<Button
					size="sm"
					variant={activeTab === 'datasets' ? 'default' : 'outline'}
					className="flex-1"
					onClick={() => setActiveTab('datasets')}
				>
					Geo events
				</Button>
				<Button
					size="sm"
					variant={activeTab === 'collections' ? 'default' : 'outline'}
					className="flex-1"
					onClick={() => setActiveTab('collections')}
				>
					Collections
				</Button>
			</div>
			<div className="flex flex-wrap gap-2">
				<Input
					size="xs"
					value={searchQuery}
					onChange={(event) => setSearchQuery(event.target.value)}
					placeholder="Search name or description…"
					className="flex-1 min-w-0"
				/>
				<Button
					size="xs"
					variant={ownedOnly ? 'default' : 'outline'}
					onClick={() => setOwnedOnly((value) => !value)}
					aria-pressed={ownedOnly}
					disabled={!currentUserPubkey}
					className="whitespace-nowrap"
					title={currentUserPubkey ? undefined : 'Connect a pubkey to filter datasets you own'}
				>
					Owned by me
				</Button>
			</div>

			{activeTab === 'datasets' ? (
				<>
					{activeDataset && (
						<Button size="sm" onClick={onClearEditing} variant="destructive" className="w-full">
							Cancel editing
						</Button>
					)}

					{geoEvents.length === 0 ? (
						<p className="text-xs text-gray-500">Listening for GeoJSON datasets…</p>
					) : filteredGeoEvents.length === 0 ? (
						<p className="text-xs text-gray-500">No datasets match your filters.</p>
					) : (
						<DataTable
							columns={datasetColumns}
							data={datasetTableData}
							getRowClassName={(row) => (!row.isVisible ? 'opacity-60' : undefined)}
						/>
					)}
				</>
			) : (
				<>
					{collectionEvents.length === 0 ? (
						<p className="text-xs text-gray-500">Listening for GeoJSON collections…</p>
					) : filteredCollections.length === 0 ? (
						<p className="text-xs text-gray-500">No collections match your filters.</p>
					) : (
						<DataTable columns={collectionColumns} data={collectionTableData} />
					)}
				</>
			)}
		</div>
	);
}

export function GeoDatasetsSidebar({ className, ...props }: GeoDatasetsPanelProps & { className?: string }) {
	return (
		<div className={cn('w-80 rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur', className)}>
			<GeoDatasetsPanelContent {...props} />
		</div>
	);
}
