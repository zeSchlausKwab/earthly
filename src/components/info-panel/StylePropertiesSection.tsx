import { RotateCcw } from 'lucide-react'
import type { EditorFeature } from '@/features/geo-editor/core'
import {
	DEFAULT_LINESTRING_STYLE,
	DEFAULT_POINT_STYLE,
	DEFAULT_POLYGON_STYLE,
	getGeometryCategory,
	type GeometryCategory,
} from '@/features/geo-editor/types/styleProperties'
import { useEditorStore } from '@/features/geo-editor/store'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

export interface StylePropertiesSectionProps {
	feature: EditorFeature
}

/**
 * Geometry-aware style properties section.
 * Shows only relevant style controls based on geometry type.
 */
export function StylePropertiesSection({ feature }: StylePropertiesSectionProps) {
	const editor = useEditorStore((state) => state.editor)

	const geometryType = feature.geometry?.type ?? 'Polygon'
	const category = getGeometryCategory(geometryType)

	const onStyleChange = (key: string, value: string | number) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, [key]: value },
		})
	}

	const resetToDefaults = () => {
		if (!editor) return
		const defaults =
			category === 'Point'
				? DEFAULT_POINT_STYLE
				: category === 'LineString'
					? DEFAULT_LINESTRING_STYLE
					: DEFAULT_POLYGON_STYLE

		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				...defaults,
				label: undefined,
			},
		})
	}

	return (
		<div className="space-y-2 p-2 bg-info/15 rounded-md border border-info/40">
			<div className="flex items-center justify-between">
				<span className="text-[10px] text-info uppercase tracking-wide font-medium">Style</span>
				<Button
					size="icon-xs"
					variant="ghost"
					className="h-5 w-5 text-info hover:text-info"
					onClick={resetToDefaults}
					title="Reset to defaults"
				>
					<RotateCcw className="h-3 w-3" />
				</Button>
			</div>

			{category === 'Point' && (
				<PointStyleControls feature={feature} onStyleChange={onStyleChange} />
			)}

			{category === 'LineString' && (
				<LineStringStyleControls feature={feature} onStyleChange={onStyleChange} />
			)}

			{category === 'Polygon' && (
				<PolygonStyleControls feature={feature} onStyleChange={onStyleChange} />
			)}

			{/* Label - available for all geometry types */}
			<LabelControl feature={feature} onStyleChange={onStyleChange} />
		</div>
	)
}

// ============================================================================
// Point Style Controls
// ============================================================================

function PointStyleControls({
	feature,
	onStyleChange,
}: {
	feature: EditorFeature
	onStyleChange: (key: string, value: string | number) => void
}) {
	return (
		<div className="space-y-1.5">
			{/* Color Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-8">Fill</span>
					<Input
						type="color"
						className="h-6 w-10 p-0.5 rounded border border-border"
						value={feature.properties?.color ?? DEFAULT_POINT_STYLE.color}
						onChange={(e) => onStyleChange('color', e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-8">Stroke</span>
					<Input
						type="color"
						className="h-6 w-10 p-0.5 rounded border border-border"
						value={feature.properties?.strokeColor ?? DEFAULT_POINT_STYLE.strokeColor}
						onChange={(e) => onStyleChange('strokeColor', e.target.value)}
					/>
				</div>
			</div>

			{/* Size Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-8">Size</span>
					<Input
						type="number"
						className="h-6 text-xs flex-1"
						min={2}
						max={32}
						value={feature.properties?.radius ?? DEFAULT_POINT_STYLE.radius}
						onChange={(e) => onStyleChange('radius', Number(e.target.value))}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-8">Width</span>
					<Input
						type="number"
						className="h-6 text-xs flex-1"
						min={0}
						max={10}
						value={feature.properties?.strokeWidth ?? DEFAULT_POINT_STYLE.strokeWidth}
						onChange={(e) => onStyleChange('strokeWidth', Number(e.target.value))}
					/>
				</div>
			</div>
		</div>
	)
}

// ============================================================================
// LineString Style Controls
// ============================================================================

function LineStringStyleControls({
	feature,
	onStyleChange,
}: {
	feature: EditorFeature
	onStyleChange: (key: string, value: string | number) => void
}) {
	return (
		<div className="space-y-1.5">
			{/* Color & Pattern Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1">
					<span className="text-[10px] text-muted-foreground w-8">Color</span>
					<Input
						type="color"
						className="h-6 w-10 p-0.5 rounded border border-border"
						value={feature.properties?.strokeColor ?? DEFAULT_LINESTRING_STYLE.strokeColor}
						onChange={(e) => onStyleChange('strokeColor', e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-10">Pattern</span>
					<select
						className="h-6 text-xs flex-1 rounded border border-border bg-card px-1"
						value={feature.properties?.lineDash ?? DEFAULT_LINESTRING_STYLE.lineDash}
						onChange={(e) => onStyleChange('lineDash', e.target.value)}
					>
						<option value="solid">Solid</option>
						<option value="dashed">Dashed</option>
						<option value="dotted">Dotted</option>
					</select>
				</div>
			</div>

			{/* Width & Opacity Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-8">Width</span>
					<Input
						type="number"
						className="h-6 text-xs flex-1"
						min={1}
						max={20}
						value={feature.properties?.strokeWidth ?? DEFAULT_LINESTRING_STYLE.strokeWidth}
						onChange={(e) => onStyleChange('strokeWidth', Number(e.target.value))}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-10">Opacity</span>
					<Input
						type="range"
						className="h-6 flex-1"
						min={0}
						max={1}
						step={0.1}
						value={feature.properties?.strokeOpacity ?? DEFAULT_LINESTRING_STYLE.strokeOpacity}
						onChange={(e) => onStyleChange('strokeOpacity', Number(e.target.value))}
					/>
				</div>
			</div>
		</div>
	)
}

// ============================================================================
// Polygon Style Controls
// ============================================================================

function PolygonStyleControls({
	feature,
	onStyleChange,
}: {
	feature: EditorFeature
	onStyleChange: (key: string, value: string | number) => void
}) {
	return (
		<div className="space-y-1.5">
			{/* Fill Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1">
					<span className="text-[10px] text-muted-foreground w-8">Fill</span>
					<Input
						type="color"
						className="h-6 w-10 p-0.5 rounded border border-border"
						value={feature.properties?.fillColor ?? DEFAULT_POLYGON_STYLE.fillColor}
						onChange={(e) => onStyleChange('fillColor', e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-10">Opacity</span>
					<Input
						type="range"
						className="h-6 flex-1"
						min={0}
						max={1}
						step={0.05}
						value={feature.properties?.fillOpacity ?? DEFAULT_POLYGON_STYLE.fillOpacity}
						onChange={(e) => onStyleChange('fillOpacity', Number(e.target.value))}
					/>
				</div>
			</div>

			{/* Stroke Row */}
			<div className="flex items-center gap-2">
				<div className="flex items-center gap-1">
					<span className="text-[10px] text-muted-foreground w-8">Stroke</span>
					<Input
						type="color"
						className="h-6 w-10 p-0.5 rounded border border-border"
						value={feature.properties?.strokeColor ?? DEFAULT_POLYGON_STYLE.strokeColor}
						onChange={(e) => onStyleChange('strokeColor', e.target.value)}
					/>
				</div>
				<div className="flex items-center gap-1 flex-1">
					<span className="text-[10px] text-muted-foreground w-10">Width</span>
					<Input
						type="number"
						className="h-6 text-xs flex-1"
						min={0}
						max={10}
						value={feature.properties?.strokeWidth ?? DEFAULT_POLYGON_STYLE.strokeWidth}
						onChange={(e) => onStyleChange('strokeWidth', Number(e.target.value))}
					/>
				</div>
			</div>
		</div>
	)
}

// ============================================================================
// Label Control (available for all geometry types)
// ============================================================================

function LabelControl({
	feature,
	onStyleChange,
}: {
	feature: EditorFeature
	onStyleChange: (key: string, value: string | number) => void
}) {
	return (
		<div className="flex items-center gap-1 pt-1 border-t border-info/40">
			<span className="text-[10px] text-muted-foreground w-8">Label</span>
			<Input
				type="text"
				className="h-6 text-xs flex-1"
				placeholder="Optional label..."
				value={(feature.properties?.label as string) ?? ''}
				onChange={(e) => onStyleChange('label', e.target.value)}
			/>
		</div>
	)
}
