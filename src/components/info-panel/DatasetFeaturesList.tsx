import {
	ChevronDown,
	ChevronRight,
	Cloud,
	Copy,
	Locate,
	MessageCircle,
	MoreHorizontal,
} from 'lucide-react'
import { useState } from 'react'
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { stringifyGeoReference } from '@/lib/geo/reference'
import { ZoomActionIcon } from '../entity-action-icons'
import { GeometryBadge, GeometryDisplay } from './geometry/GeometryDisplay'

async function copyFeatureText(value: string, message: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(value)
		toast.success(message)
	} catch {
		toast.error('Unable to copy geometry')
	}
}

function deriveFeatureCustomProperties(properties: GeoJsonProperties | null | undefined) {
	if (!properties || typeof properties !== 'object') return {}

	const explicitCustom =
		properties.customProperties &&
		typeof properties.customProperties === 'object' &&
		!Array.isArray(properties.customProperties)
			? (properties.customProperties as Record<string, unknown>)
			: {}

	const mirrored: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(properties)) {
		if (
			key === 'customProperties' ||
			key === 'name' ||
			key === 'description' ||
			key === 'meta' ||
			key === 'featureId' ||
			key === 'datasetId' ||
			key === 'sourceEventId' ||
			key === 'hashtags'
		) {
			continue
		}
		mirrored[key] = value
	}

	return {
		...mirrored,
		...explicitCustom,
	}
}

interface ReadOnlyFeatureRowProps {
	feature: Feature<Geometry | null, GeoJsonProperties>
	featureId: string
	datasetAddress?: string
	name: string
	isExpanded: boolean
	onToggleExpand: () => void
	isExternal?: boolean
	/** Zoom the map to this feature (inspect-view parity with the edit view). */
	onZoomToFeature?: (feature: Feature<Geometry | null, GeoJsonProperties>) => void
	onCommentOnFeature?: (feature: Feature<Geometry | null, GeoJsonProperties>) => void
}

function ReadOnlyFeatureRow({
	feature,
	featureId,
	datasetAddress,
	name,
	isExpanded,
	onToggleExpand,
	isExternal,
	onZoomToFeature,
	onCommentOnFeature,
}: ReadOnlyFeatureRowProps) {
	const isAnnotation = feature.properties?.featureType === 'annotation'
	const isExternalPlaceholder = feature.properties?.externalPlaceholder === true
	const hasGeometry = feature.geometry !== null
	const customProperties = deriveFeatureCustomProperties(feature.properties)
	const featureReference = datasetAddress
		? stringifyGeoReference({ kind: 'nostr', address: datasetAddress, featureId })
		: null
	const pointCoordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null

	return (
		<div
			className={cn(
				'group/feature border-b last:border-b-0 text-xs',
				isExternalPlaceholder ? 'border-info/40 bg-info/15' : 'border-border bg-card',
			)}
		>
			{/* Row header */}
			<div className="flex items-center gap-1 px-1.5 py-1">
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					onClick={onToggleExpand}
					disabled={!hasGeometry}
					aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${name}`}
					aria-expanded={isExpanded}
				>
					{hasGeometry ? (
						isExpanded ? (
							<ChevronDown className="h-3 w-3" />
						) : (
							<ChevronRight className="h-3 w-3" />
						)
					) : (
						<Cloud className="h-3 w-3 text-info" />
					)}
				</Button>

				<GeometryBadge
					geometry={feature.geometry}
					isAnnotation={isAnnotation}
					isExternal={isExternal || isExternalPlaceholder}
				/>

				<button
					type="button"
					onClick={() => onZoomToFeature?.(feature)}
					disabled={!hasGeometry || !onZoomToFeature}
					className="min-w-0 flex-1 text-left text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-default"
				>
					<span className="block truncate">{name}</span>
					<span className="block font-mono text-[10px] text-muted-foreground">
						{summarizeFeature(feature)}
					</span>
				</button>
				<div className="flex shrink-0 items-center sm:opacity-0 sm:group-hover/feature:opacity-100 sm:group-focus-within/feature:opacity-100">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={() =>
							void copyFeatureText(
								featureReference ?? JSON.stringify(feature, null, 2),
								featureReference ? 'Feature reference copied' : 'Geometry GeoJSON copied',
							)
						}
						aria-label={featureReference ? `Copy reference to ${name}` : `Copy ${name} as GeoJSON`}
						title={featureReference ? 'Copy feature reference' : 'Copy GeoJSON'}
					>
						<Copy className="h-3 w-3" />
					</Button>

					{onZoomToFeature && hasGeometry ? (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => onZoomToFeature(feature)}
							aria-label={`Zoom to ${name}`}
							title="Zoom to this feature"
						>
							<ZoomActionIcon className="h-3 w-3" />
						</Button>
					) : null}
					{onCommentOnFeature && hasGeometry && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							onClick={() => onCommentOnFeature(feature)}
							aria-label={`Comment on ${name}`}
							title="Comment on this feature"
						>
							<MessageCircle className="h-3 w-3" />
						</Button>
					)}

					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={`More actions for ${name}`}
							>
								<MoreHorizontal className="h-3.5 w-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-44">
							<DropdownMenuItem
								onClick={() =>
									void copyFeatureText(JSON.stringify(feature, null, 2), 'Geometry GeoJSON copied')
								}
							>
								<Copy className="h-3.5 w-3.5" />
								Copy GeoJSON
							</DropdownMenuItem>
							{pointCoordinates ? (
								<DropdownMenuItem
									onClick={() =>
										void copyFeatureText(
											stringifyGeoReference({
												kind: 'coordinate',
												latitude: Number(pointCoordinates[1]),
												longitude: Number(pointCoordinates[0]),
											}),
											'Coordinate reference copied',
										)
									}
								>
									<Locate className="h-3.5 w-3.5" />
									Copy coordinate reference
								</DropdownMenuItem>
							) : null}
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			{/* External placeholder info */}
			{isExternalPlaceholder && !hasGeometry && (
				<div className="border-t border-info/40 px-2 py-1.5 text-[11px] text-info">
					<span className="flex items-center gap-1">
						<Cloud className="h-3 w-3" />
						Geometry stored externally
					</span>
					{feature.properties?.blobUrl && (
						<span className="block truncate text-[10px] text-info mt-0.5">
							{feature.properties.blobUrl}
						</span>
					)}
				</div>
			)}

			{/* Expanded content */}
			{isExpanded && hasGeometry && (
				<div className="border-t border-border px-2 py-2 bg-muted/50 space-y-2">
					{/* Annotation text */}
					{isAnnotation && feature.properties?.text && (
						<div className="text-xs text-muted-foreground italic">"{feature.properties.text}"</div>
					)}

					{/* Name if different from display */}
					{feature.properties?.name && (
						<div className="text-[11px] text-muted-foreground">
							<span className="text-muted-foreground">Name:</span> {feature.properties.name}
						</div>
					)}

					{/* Description */}
					{feature.properties?.description && (
						<div className="text-[11px] text-muted-foreground">
							<span className="text-muted-foreground">Description:</span>{' '}
							{feature.properties.description}
						</div>
					)}

					{Object.keys(customProperties).length > 0 && (
						<div className="space-y-1">
							<div className="text-[10px] uppercase tracking-wide text-muted-foreground">
								Properties
							</div>
							<div className="flex flex-wrap gap-1">
								{Object.entries(customProperties).map(([key, value]) => (
									<div
										key={key}
										className="max-w-full break-words border border-border bg-card px-1.5 py-0.5 text-[11px] text-muted-foreground"
									>
										<span className="text-muted-foreground">{key}:</span> {String(value)}
									</div>
								))}
							</div>
						</div>
					)}

					{/* Geometry coordinates */}
					{feature.geometry && <GeometryDisplay geometry={feature.geometry} />}
				</div>
			)}
		</div>
	)
}

interface DatasetFeaturesListProps {
	featureCollection: FeatureCollection | null | undefined
	hiddenFeatureIds?: Set<string>
	className?: string
	/** When provided, each geometry row gets a zoom-to button. */
	onZoomToFeature?: (feature: Feature<Geometry | null, GeoJsonProperties>) => void
	/** Canonical naddr of the containing Dataset, used for fine-grained feature refs. */
	datasetAddress?: string
	onCommentOnFeature?: (feature: Feature<Geometry | null, GeoJsonProperties>) => void
}

/**
 * Read-only list of features from a dataset's feature collection.
 * Used in view mode to display the contents of a dataset.
 */
export function DatasetFeaturesList({
	featureCollection,
	hiddenFeatureIds,
	className,
	onZoomToFeature,
	datasetAddress,
	onCommentOnFeature,
}: DatasetFeaturesListProps) {
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
	const [query, setQuery] = useState('')
	const [typeFilter, setTypeFilter] = useState('All')
	const [showAll, setShowAll] = useState(false)

	const toggleExpand = (index: number) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(index)) {
				next.delete(index)
			} else {
				next.add(index)
			}
			return next
		})
	}

	if (!featureCollection?.features?.length) {
		return (
			<div className={cn('text-xs text-muted-foreground py-2', className)}>
				No features in this Map.
			</div>
		)
	}

	const featuresWithIds = featureCollection.features.map((feature, originalIndex) => ({
		feature,
		originalIndex,
		featureId:
			typeof feature.id === 'string' || typeof feature.id === 'number'
				? String(feature.id)
				: String(originalIndex),
	}))
	const visibleFeatures = hiddenFeatureIds
		? featuresWithIds.filter(({ featureId }) => {
				return !hiddenFeatureIds.has(featureId)
			})
		: featuresWithIds
	const typeCounts = new Map<string, number>()
	for (const { feature } of visibleFeatures) {
		const type = feature.geometry?.type ?? 'External'
		typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1)
	}
	const features = visibleFeatures.filter(
		({ feature }) =>
			(typeFilter === 'All' || (feature.geometry?.type ?? 'External') === typeFilter) &&
			(!query.trim() ||
				JSON.stringify(feature.properties ?? {})
					.toLowerCase()
					.includes(query.trim().toLowerCase())),
	)
	const displayedFeatures = showAll ? features : features.slice(0, 12)

	return (
		<div className={cn('space-y-1', className)}>
			<div className="mb-2 space-y-1.5">
				<Input
					aria-label="Filter features"
					placeholder="Filter features…"
					value={query}
					onChange={(event) => {
						setQuery(event.target.value)
						setShowAll(false)
					}}
					className="h-7 rounded-none text-xs"
				/>
				<fieldset className="flex flex-wrap gap-1" aria-label="Feature types">
					{[['All', visibleFeatures.length], ...typeCounts.entries()].map(([type, count]) => (
						<Button
							key={type}
							size="sm"
							variant={typeFilter === type ? 'secondary' : 'outline'}
							className="h-6 rounded-none px-1.5 font-mono text-[10px]"
							aria-pressed={typeFilter === type}
							onClick={() => {
								setTypeFilter(String(type))
								setShowAll(false)
							}}
						>
							{type} {count}
						</Button>
					))}
				</fieldset>
			</div>
			<div className="max-h-[40vh] overflow-y-auto border border-border">
				{displayedFeatures.map(({ feature, featureId, originalIndex }) => {
					const isAnnotation = feature.properties?.featureType === 'annotation'
					const isExternalPlaceholder = feature.properties?.externalPlaceholder === true

					let name = feature.properties?.name as string | undefined
					if (!name) {
						if (isExternalPlaceholder) {
							name = 'External geometry'
						} else if (isAnnotation) {
							const text = feature.properties?.text as string | undefined
							name = text ? `${text.slice(0, 20)}${text.length > 20 ? '…' : ''}` : 'Unnamed label'
						} else {
							const id = feature.id ?? originalIndex
							name = `${feature.geometry?.type ?? 'Unknown'} • ${String(id).slice(0, 6)}`
						}
					}

					return (
						<ReadOnlyFeatureRow
							key={`${featureId}:${originalIndex}`}
							feature={feature as Feature<Geometry | null, GeoJsonProperties>}
							featureId={featureId}
							datasetAddress={datasetAddress}
							name={name}
							isExpanded={expandedIds.has(originalIndex)}
							onToggleExpand={() => toggleExpand(originalIndex)}
							isExternal={isExternalPlaceholder}
							onZoomToFeature={onZoomToFeature}
							onCommentOnFeature={onCommentOnFeature}
						/>
					)
				})}
				{features.length === 0 && (
					<p className="p-3 text-xs text-muted-foreground">No features match this filter.</p>
				)}
			</div>
			{!showAll && features.length > 12 && (
				<Button
					size="sm"
					variant="ghost"
					className="w-full rounded-none"
					onClick={() => setShowAll(true)}
				>
					Show all {features.length}
				</Button>
			)}
		</div>
	)
}

function coordinateCount(coordinates: unknown): number {
	if (!Array.isArray(coordinates)) return 0
	if (typeof coordinates[0] === 'number') return 1
	return coordinates.reduce((count: number, item: unknown) => count + coordinateCount(item), 0)
}

export function summarizeFeature(feature: Feature<Geometry | null, GeoJsonProperties>): string {
	const countGeometry = (geometry: Geometry): number =>
		geometry.type === 'GeometryCollection'
			? geometry.geometries.reduce((total, child) => total + countGeometry(child), 0)
			: coordinateCount(geometry.coordinates)
	const count = feature.geometry ? countGeometry(feature.geometry) : 0
	const properties = Object.keys(deriveFeatureCustomProperties(feature.properties)).length
	return `${count} point${count === 1 ? '' : 's'}${properties ? ` · ${properties} propert${properties === 1 ? 'y' : 'ies'}` : ''}`
}
