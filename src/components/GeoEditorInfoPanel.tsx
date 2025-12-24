import { Eye, EyeOff, Maximize2, X } from 'lucide-react'
import React from 'react'
import { cn } from '@/lib/utils'
import { useEditorStore } from '../features/geo-editor/store'
import type { NDKGeoCollectionEvent } from '../lib/ndk/NDKGeoCollectionEvent'
import type { NDKGeoEvent } from '../lib/ndk/NDKGeoEvent'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

export interface GeoEditorInfoPanelProps {
	currentUserPubkey?: string
	onLoadDataset: (event: NDKGeoEvent) => void
	onToggleVisibility: (event: NDKGeoEvent) => void
	onZoomToDataset: (event: NDKGeoEvent) => void
	onDeleteDataset: (event: NDKGeoEvent) => void
	onZoomToCollection?: (collection: NDKGeoCollectionEvent, events: NDKGeoEvent[]) => void
	deletingKey: string | null
	onExitViewMode?: () => void
	onClose?: () => void
	getDatasetKey: (event: NDKGeoEvent) => string
	getDatasetName: (event: NDKGeoEvent) => string
}

export function GeoEditorInfoPanelContent(props: GeoEditorInfoPanelProps) {
	const {
		onLoadDataset,
		onToggleVisibility,
		onZoomToDataset,
		onDeleteDataset,
		onZoomToCollection,
		currentUserPubkey,
		deletingKey,
		onExitViewMode,
		onClose,
		getDatasetKey,
		getDatasetName
	} = props

	const stats = useEditorStore((state) => state.stats)
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const newCollectionProp = useEditorStore((state) => state.newCollectionProp)
	const setNewCollectionProp = useEditorStore((state) => state.setNewCollectionProp)

	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const editor = useEditorStore((state) => state.editor)

	const newFeatureProp = useEditorStore((state) => state.newFeatureProp)
	const setNewFeatureProp = useEditorStore((state) => state.setNewFeatureProp)

	const activeDataset = useEditorStore((state) => state.activeDataset)
	const datasetVisibility = useEditorStore((state) => state.datasetVisibility)

	const isPublishing = useEditorStore((state) => state.isPublishing)
	const publishMessage = useEditorStore((state) => state.publishMessage)
	const publishError = useEditorStore((state) => state.publishError)

	const blobReferences = useEditorStore((state) => state.blobReferences)
	const blobDraftUrl = useEditorStore((state) => state.blobDraftUrl)
	const setBlobDraftUrl = useEditorStore((state) => state.setBlobDraftUrl)
	const blobDraftStatus = useEditorStore((state) => state.blobDraftStatus)
	const blobDraftError = useEditorStore((state) => state.blobDraftError)
	const previewingBlobReferenceId = useEditorStore((state) => state.previewingBlobReferenceId)

	const fetchBlobReference = useEditorStore((state) => state.fetchBlobReference)
	const previewBlobReference = useEditorStore((state) => state.previewBlobReference)
	const removeBlobReference = useEditorStore((state) => state.removeBlobReference)

	const viewMode = useEditorStore((state) => state.viewMode)
	const viewDataset = useEditorStore((state) => state.viewDataset)
	const viewCollection = useEditorStore((state) => state.viewCollection)
	const viewCollectionEvents = useEditorStore((state) => state.viewCollectionEvents)

	const selectionCount = selectedFeatureIds.length
	const selectedFeatureId = selectionCount === 1 ? selectedFeatureIds[0] : null
	const selectedFeature = selectedFeatureId
		? (features.find((f) => f.id === selectedFeatureId) ?? null)
		: null

	const multiSelectModifierLabel = editor?.getMultiSelectModifierLabel() ?? 'Shift'

	const activeDatasetInfo = activeDataset
		? {
				name: getDatasetName(activeDataset),
				isOwner: currentUserPubkey === activeDataset.pubkey
			}
		: null

	// Handlers
	const onCollectionNameChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, name: value })
	}

	const onCollectionDescriptionChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, description: value })
	}

	const onCollectionColorChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, color: value })
	}

	const onCollectionCustomPropertyChange = (key: string, value: string) => {
		setCollectionMeta({
			...collectionMeta,
			customProperties: { ...collectionMeta.customProperties, [key]: value }
		})
	}

	const onCollectionCustomPropertyRemove = (key: string) => {
		const next = { ...collectionMeta.customProperties }
		delete next[key]
		setCollectionMeta({ ...collectionMeta, customProperties: next })
	}

	const onCollectionPropKeyChange = (value: string) => {
		setNewCollectionProp({ ...newCollectionProp, key: value })
	}

	const onCollectionPropValueChange = (value: string) => {
		setNewCollectionProp({ ...newCollectionProp, value: value })
	}

	const onAddCollectionProp = () => {
		if (!newCollectionProp.key) return
		setCollectionMeta({
			...collectionMeta,
			customProperties: {
				...collectionMeta.customProperties,
				[newCollectionProp.key]: newCollectionProp.value
			}
		})
		setNewCollectionProp({ key: '', value: '' })
	}

	const onFeatureFieldChange = (field: 'name' | 'description' | 'color', value: string) => {
		if (!selectedFeature || !editor) return
		editor.updateFeature(selectedFeature.id, {
			...selectedFeature,
			properties: { ...selectedFeature.properties, [field]: value }
		})
	}

	const onFeatureCustomPropertyChange = (key: string, value: string) => {
		if (!selectedFeature || !editor) return
		const currentProps = selectedFeature.properties?.customProperties || {}
		editor.updateFeature(selectedFeature.id, {
			...selectedFeature,
			properties: {
				...selectedFeature.properties,
				customProperties: { ...currentProps, [key]: value }
			}
		})
	}

	const onRemoveFeatureCustomProperty = (key: string) => {
		if (!selectedFeature || !editor) return
		const currentProps = {
			...(selectedFeature.properties?.customProperties || {})
		}
		delete currentProps[key]
		editor.updateFeature(selectedFeature.id, {
			...selectedFeature,
			properties: {
				...selectedFeature.properties,
				customProperties: currentProps
			}
		})
	}

	const onFeaturePropKeyChange = (value: string) => {
		setNewFeatureProp({ ...newFeatureProp, key: value })
	}

	const onFeaturePropValueChange = (value: string) => {
		setNewFeatureProp({ ...newFeatureProp, value: value })
	}

	const onAddFeatureCustomProperty = () => {
		if (!selectedFeature || !editor || !newFeatureProp.key) return
		const currentProps = selectedFeature.properties?.customProperties || {}
		editor.updateFeature(selectedFeature.id, {
			...selectedFeature,
			properties: {
				...selectedFeature.properties,
				customProperties: {
					...currentProps,
					[newFeatureProp.key]: newFeatureProp.value
				}
			}
		})
		setNewFeatureProp({ key: '', value: '' })
	}

	const onSelectFeature = (id: string) => {
		setSelectedFeatureIds([id])
	}

	const datasetActionCard = (event: NDKGeoEvent) => {
		const datasetKey = getDatasetKey(event)
		const datasetName = getDatasetName(event)
		const isVisible = datasetVisibility[datasetKey] !== false
		const isOwned = currentUserPubkey === event.pubkey
		const primaryLabel = isOwned ? 'Edit dataset' : 'Load copy'

		return (
			<div
				key={`${event.id}-${datasetKey}`}
				className={cn(
					'rounded-lg border border-gray-200 bg-white p-3 text-sm space-y-2',
					!isVisible && 'opacity-60'
				)}
			>
				<div className="font-semibold text-gray-900 truncate">{datasetName}</div>
				<div className="text-[11px] text-gray-500 truncate">
					Owner: {event.pubkey.slice(0, 8)}…{event.pubkey.slice(-4)}
				</div>
				{event.hashtags.length > 0 && (
					<div className="flex flex-wrap gap-1">
						{event.hashtags.slice(0, 3).map((tag) => (
							<span
								key={tag}
								className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
							>
								#{tag}
							</span>
						))}
					</div>
				)}
				<div className="flex flex-col gap-2">
					<Button
						size="sm"
						className={cn(
							'w-full',
							isOwned
								? 'bg-green-600 text-white hover:bg-green-700'
								: 'bg-blue-600 text-white hover:bg-blue-700'
						)}
						onClick={() => onLoadDataset(event)}
						disabled={isPublishing}
					>
						{primaryLabel}
					</Button>
					{isOwned && (
						<Button
							size="sm"
							variant="destructive"
							className="w-full"
							onClick={() => onDeleteDataset(event)}
							disabled={deletingKey === datasetKey}
						>
							{deletingKey === datasetKey ? 'Deleting…' : 'Delete'}
						</Button>
					)}
					<div className="flex items-center justify-between gap-2 text-[11px]">
						<Button
							size="sm"
							variant="outline"
							className="flex-1"
							onClick={() => onToggleVisibility(event)}
						>
							{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
							{isVisible ? 'Hide' : 'Show'}
						</Button>
						<Button
							size="sm"
							variant="outline"
							className="flex-1"
							onClick={() => onZoomToDataset(event)}
						>
							<Maximize2 className="h-3 w-3" />
							Zoom
						</Button>
					</div>
				</div>
			</div>
		)
	}

	if (viewMode === 'view') {
		const headerTitle = viewCollection ? 'Collection overview' : 'Dataset overview'
		const subtitle = viewCollection
			? 'Inspect linked datasets and metadata'
			: 'Inspect dataset metadata without editing'

		return (
			<div className="space-y-4 text-sm">
				<div className="flex items-center justify-between gap-2">
					<div>
						<h2 className="text-lg font-bold text-gray-900">{headerTitle}</h2>
						<p className="text-xs text-gray-500">{subtitle}</p>
					</div>
					<div className="flex gap-2">
						{onExitViewMode && (
							<Button variant="outline" size="sm" onClick={onExitViewMode}>
								Back to editing
							</Button>
						)}
						{onClose && (
							<Button
								size="icon"
								variant="ghost"
								onClick={onClose}
								aria-label="Close properties panel"
							>
								<X className="h-4 w-4" />
							</Button>
						)}
					</div>
				</div>

				{viewCollection && (
					<>
						<section className="rounded-lg border border-gray-200 p-3 space-y-2">
							<div className="flex items-center justify-between gap-2">
								<h3 className="text-base font-semibold text-gray-900">
									{viewCollection.metadata.name ?? viewCollection.collectionId}
								</h3>
								{onZoomToCollection && (
									<Button
										size="sm"
										variant="outline"
										onClick={() => onZoomToCollection(viewCollection, viewCollectionEvents)}
									>
										<Maximize2 className="h-3 w-3" />
										Zoom bounds
									</Button>
								)}
							</div>
							{viewCollection.metadata.description && (
								<p className="text-sm text-gray-600 whitespace-pre-line">
									{viewCollection.metadata.description}
								</p>
							)}
							<div className="text-[11px] text-gray-500">
								Maintainer: {viewCollection.pubkey.slice(0, 8)}…{viewCollection.pubkey.slice(-4)}
							</div>
							<div className="text-[11px] text-gray-500">
								{viewCollection.datasetReferences.length} linked dataset
								{viewCollection.datasetReferences.length === 1 ? '' : 's'}
							</div>
							{viewCollection.metadata.tags && viewCollection.metadata.tags.length > 0 && (
								<div className="flex flex-wrap gap-1">
									{viewCollection.metadata.tags.slice(0, 5).map((tag) => (
										<span
											key={tag}
											className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] text-purple-700"
										>
											#{tag}
										</span>
									))}
								</div>
							)}
						</section>
						<section className="space-y-2">
							<h4 className="text-sm font-semibold text-gray-800">Linked geo events</h4>
							{viewCollectionEvents.length === 0 ? (
								<p className="text-xs text-gray-500">
									No linked geo events are currently loaded. Listen for their coordinates or load
									datasets first.
								</p>
							) : (
								<div className="space-y-2">
									{viewCollectionEvents.map((event) => datasetActionCard(event))}
								</div>
							)}
						</section>
					</>
				)}

				{viewDataset && !viewCollection && (
					<>
						<section className="rounded-lg border border-gray-200 p-3 space-y-2">
							<div className="text-base font-semibold text-gray-900">
								{getDatasetName(viewDataset)}
							</div>
							<div className="text-[11px] text-gray-500">
								Owner: {viewDataset.pubkey.slice(0, 8)}…{viewDataset.pubkey.slice(-4)}
							</div>
							{viewDataset.hashtags.length > 0 && (
								<div className="flex flex-wrap gap-1">
									{viewDataset.hashtags.slice(0, 5).map((tag) => (
										<span
											key={tag}
											className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700"
										>
											#{tag}
										</span>
									))}
								</div>
							)}
							<div className="text-xs text-gray-600 space-y-1">
								<div>
									Bounding box:{' '}
									{viewDataset.boundingBox ? viewDataset.boundingBox.join(', ') : 'Not provided'}
								</div>
								<div>Geohash: {viewDataset.geohash ?? '—'}</div>
								<div>Collections referenced: {viewDataset.collectionReferences.length}</div>
							</div>
						</section>
						<section className="space-y-2">
							<h4 className="text-sm font-semibold text-gray-800">Dataset controls</h4>
							{datasetActionCard(viewDataset)}
						</section>
					</>
				)}
			</div>
		)
	}

	return (
		<div className="space-y-4 text-sm">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h2 className="text-lg font-bold text-gray-900">GeoJSON Editor</h2>
					<p className="text-xs text-gray-500">Dataset metadata & feature details</p>
				</div>
				{onClose && (
					<Button size="icon" variant="ghost" onClick={onClose} aria-label="Close properties panel">
						<X className="h-4 w-4" />
					</Button>
				)}
			</div>

			<div className="space-y-1">
				{[
					{ label: 'Points', value: stats.points },
					{ label: 'Lines', value: stats.lines },
					{ label: 'Polygons', value: stats.polygons },
					{ label: 'Total', value: stats.total }
				].map(({ label, value }) => (
					<div key={label} className="flex justify-between text-sm">
						<span className="text-gray-600">{label}:</span>
						<span className="font-semibold text-gray-900">{value}</span>
					</div>
				))}
			</div>

			<section className="rounded-lg border border-gray-200 p-3 space-y-3">
				<h4 className="text-sm font-semibold text-gray-800">Dataset metadata</h4>
				<label className="block text-xs text-gray-600">
					Name
					<Input
						className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
						placeholder="Dataset name"
						value={collectionMeta.name}
						onChange={(e) => onCollectionNameChange(e.target.value)}
					/>
				</label>
				<label className="block text-xs text-gray-600">
					Description
					<textarea
						className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
						rows={2}
						placeholder="Describe this dataset"
						value={collectionMeta.description}
						onChange={(e) => onCollectionDescriptionChange(e.target.value)}
					/>
				</label>
				<label className="block text-xs text-gray-600">
					Accent color
					<Input
						type="color"
						className="mt-1 h-8 w-16 rounded border border-gray-200"
						value={collectionMeta.color}
						onChange={(e) => onCollectionColorChange(e.target.value)}
					/>
				</label>
				<div className="space-y-2">
					<div className="text-xs font-semibold text-gray-600">Custom properties</div>
					{Object.keys(collectionMeta.customProperties).length === 0 ? (
						<p className="text-[11px] text-gray-500">No custom properties</p>
					) : (
						Object.entries(collectionMeta.customProperties).map(([key, value]) => (
							<div key={key} className="flex items-center gap-2 text-xs">
								<span className="min-w-[60px] font-medium text-gray-700">{key}</span>
								<Input
									className="flex-1 rounded border border-gray-200 px-2 py-1"
									value={String(value)}
									onChange={(e) => onCollectionCustomPropertyChange(key, e.target.value)}
								/>
								<Button
									size="sm"
									variant="destructive"
									onClick={() => onCollectionCustomPropertyRemove(key)}
								>
									✕
								</Button>
							</div>
						))
					)}
					<div className="flex items-center gap-2">
						<Input
							className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
							placeholder="key"
							value={newCollectionProp.key}
							onChange={(e) => onCollectionPropKeyChange(e.target.value)}
						/>
						<Input
							className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
							placeholder="value"
							value={newCollectionProp.value}
							onChange={(e) => onCollectionPropValueChange(e.target.value)}
						/>
						<Button size="sm" onClick={onAddCollectionProp}>
							Add
						</Button>
					</div>
				</div>
			</section>

			<section className="rounded-lg border border-gray-200 p-3 space-y-3">
				<div>
					<h4 className="text-sm font-semibold text-gray-800">External geometry references</h4>
					<p className="text-xs text-gray-500">
						Link remote GeoJSON blobs for oversized geometries. They will be referenced via blob
						tags when publishing.
					</p>
				</div>
				<div className="flex flex-col gap-2">
					<Input
						placeholder="https://example.org/dataset.geojson"
						value={blobDraftUrl}
						onChange={(e) => setBlobDraftUrl(e.target.value)}
						disabled={blobDraftStatus === 'loading'}
					/>
					<Button
						onClick={fetchBlobReference}
						disabled={!blobDraftUrl || blobDraftStatus === 'loading'}
					>
						{blobDraftStatus === 'loading' ? 'Fetching…' : 'Fetch & attach'}
					</Button>
					{blobDraftStatus === 'error' && blobDraftError && (
						<p className="text-xs text-red-600">{blobDraftError}</p>
					)}
				</div>
				<div className="space-y-2">
					{blobReferences.length === 0 && (
						<p className="text-xs text-gray-500">No external references added yet.</p>
					)}
					{blobReferences.map((reference) => {
						const isPreviewing =
							previewingBlobReferenceId === reference.id && reference.status === 'ready'
						return (
							<div
								key={reference.id}
								className="rounded border border-gray-200 p-3 text-sm space-y-2 bg-white"
							>
								<div className="flex items-start justify-between gap-2">
									<div className="space-y-1">
										<div className="font-semibold text-gray-900 break-all">{reference.url}</div>
										<div className="text-[11px] text-gray-500 space-x-2">
											<span>
												Scope:{' '}
												{reference.scope === 'feature' ? 'Single feature' : 'Full collection'}
											</span>
											{reference.scope === 'feature' && reference.featureId && (
												<span>Feature ID: {reference.featureId}</span>
											)}
										</div>
										{reference.featureCount !== undefined && (
											<div className="text-[11px] text-gray-500 space-x-2">
												<span>Features: {reference.featureCount}</span>
												{reference.geometryTypes && reference.geometryTypes.length > 0 && (
													<span>Geometry: {reference.geometryTypes.join(', ')}</span>
												)}
											</div>
										)}
										<div className="text-[11px] text-gray-500">
											Status:{' '}
											{reference.status === 'loading'
												? 'Loading…'
												: reference.status === 'error'
													? (reference.error ?? 'Error')
													: 'Ready'}
										</div>
										{reference.status === 'error' && reference.error && (
											<div className="text-[11px] text-red-600">{reference.error}</div>
										)}
									</div>
									<Button
										variant="ghost"
										size="sm"
										className="text-red-600"
										onClick={() => removeBlobReference(reference.id)}
									>
										Remove
									</Button>
								</div>
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => previewBlobReference(reference.id)}
										disabled={reference.status === 'loading'}
									>
										{reference.status === 'loading'
											? 'Loading…'
											: isPreviewing
												? 'Previewing'
												: 'Preview on map'}
									</Button>
								</div>
							</div>
						)
					})}
				</div>
			</section>

			{selectedFeature && (
				<section className="rounded-lg border border-gray-200 p-3 space-y-3">
					<div className="text-sm font-semibold text-gray-800">Feature properties</div>
					<p className="text-[11px] text-gray-500 break-all">ID: {selectedFeature.id}</p>
					<label className="block text-xs text-gray-600">
						Name
						<Input
							className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
							value={(selectedFeature.properties?.name as string) ?? ''}
							onChange={(e) => onFeatureFieldChange('name', e.target.value)}
						/>
					</label>
					<label className="block text-xs text-gray-600">
						Description
						<textarea
							className="mt-1 w-full rounded border border-gray-200 px-2 py-1 text-sm"
							rows={2}
							value={(selectedFeature.properties?.description as string) ?? ''}
							onChange={(e) => onFeatureFieldChange('description', e.target.value)}
						/>
					</label>
					<label className="block text-xs text-gray-600">
						Color
						<Input
							type="color"
							className="mt-1 h-8 w-16 rounded border border-gray-200"
							value={(selectedFeature.properties?.color as string) ?? '#16a34a'}
							onChange={(e) => onFeatureFieldChange('color', e.target.value)}
						/>
					</label>
					<div className="space-y-2">
						<div className="text-xs font-semibold text-gray-600">Custom properties</div>
						{Object.entries(selectedFeature.properties?.customProperties ?? {}).length === 0 ? (
							<p className="text-[11px] text-gray-500">No custom properties</p>
						) : (
							Object.entries(selectedFeature.properties?.customProperties ?? {}).map(
								([key, value]) => (
									<div key={key} className="flex items-center gap-2 text-xs">
										<span className="min-w-[60px] font-medium text-gray-700">{key}</span>
										<Input
											className="flex-1 rounded border border-gray-200 px-2 py-1"
											value={String(value)}
											onChange={(e) => onFeatureCustomPropertyChange(key, e.target.value)}
										/>
										<Button
											size="sm"
											variant="destructive"
											onClick={() => onRemoveFeatureCustomProperty(key)}
										>
											✕
										</Button>
									</div>
								)
							)
						)}
						<div className="flex items-center gap-2">
							<Input
								className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
								placeholder="key"
								value={newFeatureProp.key}
								onChange={(e) => onFeaturePropKeyChange(e.target.value)}
							/>
							<Input
								className="flex-1 rounded border border-gray-200 px-2 py-1 text-xs"
								placeholder="value"
								value={newFeatureProp.value}
								onChange={(e) => onFeaturePropValueChange(e.target.value)}
							/>
							<Button size="sm" onClick={onAddFeatureCustomProperty}>
								Add
							</Button>
						</div>
					</div>
				</section>
			)}

			{activeDatasetInfo && (
				<div className="text-xs text-gray-600">
					Editing dataset: <span className="font-semibold">{activeDatasetInfo.name}</span>{' '}
					{activeDatasetInfo.isOwner ? '(owned)' : '(read-only copy)'}
				</div>
			)}
			{publishMessage && <p className="text-xs text-green-600">{publishMessage}</p>}
			{publishError && <p className="text-xs text-red-600">{publishError}</p>}

			<section className="rounded-lg border border-gray-200 p-3">
				<div className="text-sm font-semibold text-gray-800 mb-2">
					Geometries ({features.length})
				</div>
				{features.length === 0 ? (
					<p className="text-xs text-gray-500">Draw or load geometries to edit their metadata.</p>
				) : (
					<div className="flex flex-wrap gap-2">
						{features.map((feature) => (
							<button
								type="button"
								key={feature.id}
								onClick={() => onSelectFeature(feature.id)}
								className={cn(
									'rounded-full border px-3 py-1 text-xs',
									selectedFeatureId === feature.id
										? 'border-blue-500 bg-blue-50 text-blue-800'
										: 'border-gray-200 text-gray-700'
								)}
							>
								{feature.properties?.name ||
									`${feature.geometry.type} • ${feature.id.slice(0, 8)}…`}
							</button>
						))}
					</div>
				)}
			</section>

			<section className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900 space-y-1">
				{selectionCount > 0 ? (
					<>
						<p className="font-semibold">
							{selectionCount} feature{selectionCount === 1 ? '' : 's'} selected
						</p>
						<p>
							Press <strong>Delete/Backspace</strong> or use the trash icon to remove them. Hold{' '}
							<strong>{multiSelectModifierLabel}</strong> while clicking or dragging with the Select
							tool to add to the selection.
						</p>
					</>
				) : (
					<>
						<p className="font-semibold">Selection tips</p>
						<ul className="list-inside list-disc space-y-1">
							<li>Use the Select tool to click a feature.</li>
							<li>
								Hold <strong>{multiSelectModifierLabel}</strong> to multi-select or drag to
								box-select.
							</li>
							<li>The active geometry is highlighted on the map.</li>
						</ul>
					</>
				)}
			</section>

			<section className="border-t pt-3 text-xs text-gray-600 space-y-1">
				<p className="font-semibold">Keyboard Shortcuts:</p>
				<ul className="list-inside list-disc space-y-0.5">
					<li>Cmd/Ctrl + Z: Undo</li>
					<li>Cmd/Ctrl + Shift + Z: Redo</li>
					<li>Delete/Backspace: Delete selected</li>
					<li>Enter: Finish drawing</li>
					<li>Escape: Cancel drawing</li>
				</ul>
			</section>
		</div>
	)
}

export function GeoEditorInfoPanel({
	className,
	...props
}: GeoEditorInfoPanelProps & { className?: string }) {
	return (
		<div className={cn('w-96 rounded-2xl bg-white p-4 shadow-xl', className)}>
			<GeoEditorInfoPanelContent {...props} />
		</div>
	)
}
