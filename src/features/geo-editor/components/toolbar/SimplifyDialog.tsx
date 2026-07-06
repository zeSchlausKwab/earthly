import { useMemo, useState } from 'react'
import type { Geometry } from 'geojson'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Slider } from '@/components/ui/slider'
import { formatBytes } from '@/lib/blossom/blossomUpload'
import { countGeometryVertices, isSimplifiableGeometryType } from '@/lib/geo/geometry'
import { executeEditorCommand } from '@/features/geo-editor/commands'
import { BLOSSOM_UPLOAD_THRESHOLD_BYTES } from '@/features/geo-editor/constants'
import type { EditorFeature, GeoEditor } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'

const SIMPLIFY_SLIDER_MIN = 0
const SIMPLIFY_SLIDER_MAX = 100
const SIMPLIFY_TOLERANCE_MIN = 1e-8
const SIMPLIFY_TOLERANCE_MAX = 1e-3
const DEFAULT_SIMPLIFY_TOLERANCE = 0.0001
const BYTE_ENCODER = new TextEncoder()

type SimplifyPreviewMetrics = {
	selectedFeatureCount: number
	updatedFeatureCount: number
	skippedFeatureCount: number
	vertexCountBefore: number
	vertexCountAfter: number
	selectedBytesBefore: number
	selectedBytesAfter: number
	datasetBytesBefore: number
	datasetBytesAfter: number
}

function sliderValueToTolerance(value: number): number {
	const clamped = Math.max(SIMPLIFY_SLIDER_MIN, Math.min(SIMPLIFY_SLIDER_MAX, value))
	const ratio = clamped / (SIMPLIFY_SLIDER_MAX - SIMPLIFY_SLIDER_MIN)
	const scale = SIMPLIFY_TOLERANCE_MAX / SIMPLIFY_TOLERANCE_MIN
	return SIMPLIFY_TOLERANCE_MIN * scale ** ratio
}

function toleranceToSliderValue(tolerance: number): number {
	const safe = Math.max(SIMPLIFY_TOLERANCE_MIN, Math.min(SIMPLIFY_TOLERANCE_MAX, tolerance))
	const scale = SIMPLIFY_TOLERANCE_MAX / SIMPLIFY_TOLERANCE_MIN
	return Math.round((Math.log(safe / SIMPLIFY_TOLERANCE_MIN) / Math.log(scale)) * 100)
}

function estimateFeatureCollectionBytes(features: EditorFeature[]): number {
	return BYTE_ENCODER.encode(
		JSON.stringify({
			type: 'FeatureCollection',
			features,
		}),
	).length
}

function estimateSingleFeatureBytes(feature: EditorFeature): number {
	return BYTE_ENCODER.encode(JSON.stringify(feature)).length
}

function isGeometryEquivalent(a: Geometry, b: Geometry): boolean {
	return JSON.stringify(a) === JSON.stringify(b)
}

function buildSimplifyPreviewMetrics(
	editor: GeoEditor | null,
	features: EditorFeature[],
	selectedFeatureIds: string[],
	tolerance: number,
): SimplifyPreviewMetrics {
	const selectedIdSet = new Set(selectedFeatureIds)
	const selectedFeatures = features.filter(
		(feature) =>
			selectedIdSet.has(feature.id) &&
			feature.geometry &&
			isSimplifiableGeometryType(feature.geometry.type),
	)

	if (!editor || selectedFeatures.length === 0) {
		const datasetBytes = estimateFeatureCollectionBytes(features)
		return {
			selectedFeatureCount: selectedFeatures.length,
			updatedFeatureCount: 0,
			skippedFeatureCount: 0,
			vertexCountBefore: 0,
			vertexCountAfter: 0,
			selectedBytesBefore: 0,
			selectedBytesAfter: 0,
			datasetBytesBefore: datasetBytes,
			datasetBytesAfter: datasetBytes,
		}
	}

	let vertexCountBefore = 0
	let vertexCountAfter = 0
	let selectedBytesBefore = 0
	let selectedBytesAfter = 0
	let updatedFeatureCount = 0
	let skippedFeatureCount = 0

	const simplifiedById = new Map<string, EditorFeature>()

	for (const feature of selectedFeatures) {
		vertexCountBefore += countGeometryVertices(feature.geometry)
		selectedBytesBefore += estimateSingleFeatureBytes(feature)

		try {
			const simplified = editor.transform.simplify(feature, tolerance)
			const simplifiedFeature: EditorFeature = {
				...feature,
				geometry: simplified.geometry,
			}
			vertexCountAfter += countGeometryVertices(simplifiedFeature.geometry)
			selectedBytesAfter += estimateSingleFeatureBytes(simplifiedFeature)
			simplifiedById.set(feature.id, simplifiedFeature)

			if (isGeometryEquivalent(feature.geometry, simplifiedFeature.geometry)) {
				skippedFeatureCount += 1
			} else {
				updatedFeatureCount += 1
			}
		} catch {
			vertexCountAfter += countGeometryVertices(feature.geometry)
			selectedBytesAfter += estimateSingleFeatureBytes(feature)
			skippedFeatureCount += 1
		}
	}

	const datasetBytesBefore = estimateFeatureCollectionBytes(features)
	const featuresAfter = features.map((feature) => simplifiedById.get(feature.id) ?? feature)
	const datasetBytesAfter = estimateFeatureCollectionBytes(featuresAfter)

	return {
		selectedFeatureCount: selectedFeatures.length,
		updatedFeatureCount,
		skippedFeatureCount,
		vertexCountBefore,
		vertexCountAfter,
		selectedBytesBefore,
		selectedBytesAfter,
		datasetBytesBefore,
		datasetBytesAfter,
	}
}

function percentageChange(before: number, after: number): number {
	if (before <= 0) return 0
	return ((after - before) / before) * 100
}

export interface SimplifyDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
}

export function SimplifyDialog({ open, onOpenChange }: SimplifyDialogProps) {
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	const [simplifySliderValue, setSimplifySliderValue] = useState<number[]>([
		toleranceToSliderValue(DEFAULT_SIMPLIFY_TOLERANCE),
	])

	const simplifyTolerance = useMemo(
		() => sliderValueToTolerance(simplifySliderValue[0] ?? SIMPLIFY_SLIDER_MIN),
		[simplifySliderValue],
	)

	const metrics = useMemo(
		() => buildSimplifyPreviewMetrics(editor, features, selectedFeatureIds, simplifyTolerance),
		[editor, features, selectedFeatureIds, simplifyTolerance],
	)

	const canSimplify = selectedFeatureIds.some((id) => {
		const f = features.find((feat) => feat.id === id)
		return f?.geometry && isSimplifiableGeometryType(f.geometry.type)
	})

	const vertexDeltaPercent = percentageChange(metrics.vertexCountBefore, metrics.vertexCountAfter)
	const datasetDeltaPercent = percentageChange(
		metrics.datasetBytesBefore,
		metrics.datasetBytesAfter,
	)
	const nextDatasetOverLimit = metrics.datasetBytesAfter > BLOSSOM_UPLOAD_THRESHOLD_BYTES

	const handleApply = () => {
		executeEditorCommand('simplify_selected_features', { tolerance: simplifyTolerance })
		onOpenChange(false)
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Simplify Selection</DialogTitle>
					<DialogDescription>
						Reduce vertices in selected lines/polygons and preview impact before applying.
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-1">
					<div className="space-y-2">
						<div className="flex items-center justify-between text-xs">
							<span className="font-medium text-foreground">Tolerance</span>
							<span className="font-mono text-muted-foreground">
								{simplifyTolerance.toExponential(2)} (~{(simplifyTolerance * 111320).toFixed(2)} m)
							</span>
						</div>
						<Slider
							value={simplifySliderValue}
							onValueChange={setSimplifySliderValue}
							min={SIMPLIFY_SLIDER_MIN}
							max={SIMPLIFY_SLIDER_MAX}
							step={1}
							disabled={!canSimplify}
						/>
						<div className="flex items-center justify-between text-[10px] text-muted-foreground">
							<span>Fine detail</span>
							<span>Aggressive</span>
						</div>
					</div>

					<div className="grid grid-cols-1 gap-2 text-xs">
						<div className="rounded-md border border-border bg-muted p-2">
							<div className="font-medium text-foreground">Selected geometries</div>
							<div className="mt-1 text-muted-foreground">
								{metrics.selectedFeatureCount} selected • {metrics.updatedFeatureCount} will change
								• {metrics.skippedFeatureCount} unchanged
							</div>
						</div>

						<div className="rounded-md border border-border p-2">
							<div className="font-medium text-foreground">Coordinate points</div>
							<div className="mt-1 text-foreground">
								{metrics.vertexCountBefore.toLocaleString()} →{' '}
								{metrics.vertexCountAfter.toLocaleString()}
							</div>
							<div className="text-[10px] text-muted-foreground">
								{vertexDeltaPercent <= 0
									? `${Math.abs(vertexDeltaPercent).toFixed(1)}% fewer points`
									: `${vertexDeltaPercent.toFixed(1)}% more points`}
							</div>
						</div>

						<div className="rounded-md border border-border p-2">
							<div className="font-medium text-foreground">Selected payload estimate</div>
							<div className="mt-1 text-foreground">
								{formatBytes(metrics.selectedBytesBefore)} →{' '}
								{formatBytes(metrics.selectedBytesAfter)}
							</div>
						</div>

						<div
							className={`rounded-md border p-2 ${
								nextDatasetOverLimit ? 'border-primary/40 bg-primary/10' : 'border-ok/40 bg-ok/15'
							}`}
						>
							<div className="font-medium text-foreground">Dataset size estimate</div>
							<div className="mt-1 text-foreground">
								{formatBytes(metrics.datasetBytesBefore)} → {formatBytes(metrics.datasetBytesAfter)}
							</div>
							<div className="text-[10px] text-muted-foreground">
								{datasetDeltaPercent <= 0
									? `${Math.abs(datasetDeltaPercent).toFixed(1)}% smaller`
									: `${datasetDeltaPercent.toFixed(1)}% larger`}{' '}
								• limit {formatBytes(BLOSSOM_UPLOAD_THRESHOLD_BYTES)} •{' '}
								{nextDatasetOverLimit ? 'still over limit' : 'within limit'}
							</div>
						</div>
					</div>
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button
						onClick={handleApply}
						disabled={
							!canSimplify ||
							metrics.selectedFeatureCount === 0 ||
							metrics.updatedFeatureCount === 0
						}
					>
						Apply Simplify
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
