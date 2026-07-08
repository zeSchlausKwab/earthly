import { ChevronDown, ChevronRight, Cloud } from 'lucide-react'
import { useState } from 'react'
import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ZoomActionIcon } from '../entity-action-icons'
import { GeometryBadge, GeometryDisplay } from './geometry/GeometryDisplay'

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
	name: string
	isExpanded: boolean
	onToggleExpand: () => void
	isExternal?: boolean
	/** Zoom the map to this feature (inspect-view parity with the edit view). */
	onZoomToFeature?: (feature: Feature<Geometry | null, GeoJsonProperties>) => void
}

function ReadOnlyFeatureRow({
	feature,
	name,
	isExpanded,
	onToggleExpand,
	isExternal,
	onZoomToFeature,
}: ReadOnlyFeatureRowProps) {
	const isAnnotation = feature.properties?.featureType === 'annotation'
	const isExternalPlaceholder = feature.properties?.externalPlaceholder === true
	const hasGeometry = feature.geometry !== null
	const customProperties = deriveFeatureCustomProperties(feature.properties)

	return (
		<div
			className={cn(
				'rounded border text-xs',
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

				<span className="flex-1 text-left truncate text-foreground">{name}</span>

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
							<div className="space-y-1">
								{Object.entries(customProperties).map(([key, value]) => (
									<div key={key} className="text-[11px] text-muted-foreground">
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
}: DatasetFeaturesListProps) {
	const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

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
				No features in this dataset.
			</div>
		)
	}

	const features = hiddenFeatureIds
		? featureCollection.features.filter((feature, index) => {
				const featureId =
					typeof feature.id === 'string' || typeof feature.id === 'number'
						? String(feature.id)
						: String(index)
				return !hiddenFeatureIds.has(featureId)
			})
		: featureCollection.features

	return (
		<div className={cn('space-y-1', className)}>
			{features.map((feature, index) => {
				const isAnnotation = feature.properties?.featureType === 'annotation'
				const isExternalPlaceholder = feature.properties?.externalPlaceholder === true

				let name = feature.properties?.name as string | undefined
				if (!name) {
					if (isExternalPlaceholder) {
						name = 'External geometry'
					} else if (isAnnotation) {
						const text = feature.properties?.text as string | undefined
						name = text ? `"${text.slice(0, 20)}${text.length > 20 ? '…' : ''}"` : 'Annotation'
					} else {
						const id = feature.id ?? index
						name = `${feature.geometry?.type ?? 'Unknown'} • ${String(id).slice(0, 6)}`
					}
				}

				return (
					<ReadOnlyFeatureRow
						key={feature.id ?? index}
						feature={feature as Feature<Geometry | null, GeoJsonProperties>}
						name={name}
						isExpanded={expandedIds.has(index)}
						onToggleExpand={() => toggleExpand(index)}
						isExternal={isExternalPlaceholder}
						onZoomToFeature={onZoomToFeature}
					/>
				)
			})}
		</div>
	)
}
