/**
 * Toolbar measure popover (AI_GEO_AWARENESS §2 — the UI surface of the same
 * read-only `measureFeatures` primitive the AI `measure` tool uses).
 *
 * Measures the CURRENT SELECTION, falling back to the whole dataset when
 * nothing is selected. Everything is computed lazily while the popover is
 * open — closed, it costs one store subscription and nothing else.
 */

import { Ruler } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import {
	aggregateMeasurements,
	formatAreaKm2,
	formatLengthKm,
	formatGeometryMeasurement,
	measureFeatures,
} from '../api/measure'
import type { EditorFeature } from '../core/types'
import { useEditorStore } from '../store'

/** Per-feature rows shown before the list truncates (totals stay exact). */
const MAX_FEATURE_ROWS = 10

interface MeasureRowProps {
	label: string
	value: string
}

function MeasureRow({ label, value }: MeasureRowProps) {
	return (
		<div className="flex items-baseline justify-between gap-3 text-xs">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-mono">{value}</span>
		</div>
	)
}

function featureLabel(feature: EditorFeature): string {
	const name = feature.properties?.name
	if (typeof name === 'string' && name.trim()) return name
	return String(feature.id).slice(0, 12)
}

interface Measurements {
	scope: string
	pointCount: number
	aggregates: ReturnType<typeof aggregateMeasurements>
	perimeterKm: number
	bbox: number[] | null
	/** Centroid-to-centroid distance when exactly two features are targeted. */
	pairDistanceKm: number | null
	rows: { id: string; label: string; measurement: string }[]
	truncatedRows: number
}

function computeMeasurements(
	targets: EditorFeature[],
	selectionCount: number,
): Measurements | null {
	if (targets.length === 0) return null
	const aggregates = aggregateMeasurements(targets)
	const pointCount = targets.filter(
		(f) => f.geometry?.type === 'Point' || f.geometry?.type === 'MultiPoint',
	).length
	const perimeter = measureFeatures('perimeter', targets) as { totalKm: number }
	let bbox: number[] | null = null
	try {
		bbox = (measureFeatures('bbox', targets) as { bbox: number[] }).bbox
	} catch {
		// no measurable geometry
	}
	let pairDistanceKm: number | null = null
	if (targets.length === 2) {
		try {
			pairDistanceKm = (measureFeatures('distance', targets) as { km: number }).km
		} catch {
			// degenerate geometry
		}
	}
	const measurable = targets
		.map((feature) => ({
			id: String(feature.id),
			label: featureLabel(feature),
			measurement: formatGeometryMeasurement(feature.geometry) ?? '',
		}))
		.filter((row) => row.measurement)
	return {
		scope:
			selectionCount > 0
				? `${selectionCount} selected feature${selectionCount === 1 ? '' : 's'}`
				: `all ${targets.length} feature${targets.length === 1 ? '' : 's'}`,
		pointCount,
		aggregates,
		perimeterKm: perimeter.totalKm,
		bbox,
		pairDistanceKm,
		rows: measurable.slice(0, MAX_FEATURE_ROWS),
		truncatedRows: Math.max(0, measurable.length - MAX_FEATURE_ROWS),
	}
}

export function MeasurePopover() {
	const [open, setOpen] = useState(false)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	const measurements = useMemo(() => {
		if (!open) return null
		const selected = new Set(selectedFeatureIds)
		const targets = selected.size > 0 ? features.filter((f) => selected.has(f.id)) : features
		return computeMeasurements(targets, selected.size)
	}, [open, features, selectedFeatureIds])

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger asChild>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Measure"
					title="Measure selection (or all features)"
					className={cn(
						'h-8 w-8 shrink-0 rounded-md border border-transparent shadow-none',
						open &&
							'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
					)}
				>
					<Ruler className="h-4 w-4" />
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-72" side="bottom" align="end">
				{!measurements ? (
					<p className="text-xs text-muted-foreground">
						Nothing to measure — draw or select features first.
					</p>
				) : (
					<div className="space-y-2">
						<p className="text-xs font-medium">Measuring {measurements.scope}</p>
						<div className="space-y-1">
							{measurements.aggregates && measurements.aggregates.lineCount > 0 && (
								<MeasureRow
									label={`Length (${measurements.aggregates.lineCount} line${measurements.aggregates.lineCount === 1 ? '' : 's'})`}
									value={formatLengthKm(measurements.aggregates.totalLengthKm)}
								/>
							)}
							{measurements.aggregates && measurements.aggregates.polygonCount > 0 && (
								<>
									<MeasureRow
										label={`Area (${measurements.aggregates.polygonCount} polygon${measurements.aggregates.polygonCount === 1 ? '' : 's'})`}
										value={formatAreaKm2(measurements.aggregates.totalAreaKm2)}
									/>
									<MeasureRow label="Perimeter" value={formatLengthKm(measurements.perimeterKm)} />
								</>
							)}
							{measurements.pointCount > 0 && (
								<MeasureRow label="Points" value={String(measurements.pointCount)} />
							)}
							{measurements.pairDistanceKm !== null && (
								<MeasureRow
									label="Distance (centroids)"
									value={formatLengthKm(measurements.pairDistanceKm)}
								/>
							)}
							{measurements.bbox && (
								<MeasureRow
									label="Bounding box"
									value={measurements.bbox.map((v) => v.toFixed(2)).join(', ')}
								/>
							)}
						</div>
						{measurements.rows.length > 1 && (
							<div className="border-t pt-1.5 space-y-0.5">
								{measurements.rows.map((row) => (
									<div
										key={row.id}
										className="flex items-baseline justify-between gap-3 text-[10px] text-muted-foreground"
									>
										<span className="truncate">{row.label}</span>
										<span className="font-mono shrink-0">{row.measurement}</span>
									</div>
								))}
								{measurements.truncatedRows > 0 && (
									<p className="text-[10px] text-muted-foreground">
										+{measurements.truncatedRows} more (totals include them)
									</p>
								)}
							</div>
						)}
					</div>
				)}
			</PopoverContent>
		</Popover>
	)
}
