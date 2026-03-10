import { AlertTriangle, ChevronDown, ChevronRight, Locate, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { EditorFeature } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { parseCustomValue } from '@/features/geo-editor/utils'
import { cn } from '@/lib/utils'
import { GeoRichTextEditor, type GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { GeometryBadge, GeometryDisplay } from './GeometryDisplay'
import { StylePropertiesSection } from '../StylePropertiesSection'

type ContextPropertyTypeHint = 'string' | 'number' | 'integer' | 'boolean'

function coercePropertyInput(
	rawValue: string,
	hint?: ContextPropertyTypeHint,
	currentValue?: unknown,
): string | number | boolean {
	const trimmed = rawValue.trim()
	// Force string with single/double quotes, e.g. "true" or '33'
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2)
	) {
		return trimmed.slice(1, -1)
	}

	const targetType: ContextPropertyTypeHint | null =
		hint ??
		(typeof currentValue === 'number'
			? 'number'
			: typeof currentValue === 'boolean'
				? 'boolean'
				: null)

	if (targetType === 'string') return rawValue
	if (targetType === 'boolean') {
		if (trimmed.toLowerCase() === 'true') return true
		if (trimmed.toLowerCase() === 'false') return false
		return rawValue
	}
	if (targetType === 'number' || targetType === 'integer') {
		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed)) return rawValue
		if (targetType === 'integer') {
			if (!Number.isInteger(parsed)) return rawValue
			return parsed
		}
		return parsed
	}

	return parseCustomValue(rawValue)
}

function inferDisplayType(
	value: unknown,
	hint?: ContextPropertyTypeHint,
): ContextPropertyTypeHint | 'unknown' {
	if (hint) return hint
	if (typeof value === 'boolean') return 'boolean'
	if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
	if (typeof value === 'string') return 'string'
	return 'unknown'
}

interface FeatureRowProps {
	feature: EditorFeature
	name: string
	isSelected: boolean
	isExpanded: boolean
	validationIssues?: string[]
	propertyTypeHints?: Map<string, ContextPropertyTypeHint>
	availableFeatures?: GeoFeatureItem[]
	onToggleExpand: () => void
	onSelect: (event: React.MouseEvent) => void
	onDelete: () => void
	onZoomTo: () => void
}

function FeatureRow({
	feature,
	name,
	isSelected,
	isExpanded,
	validationIssues,
	propertyTypeHints,
	availableFeatures = [],
	onToggleExpand,
	onSelect,
	onDelete,
	onZoomTo,
}: FeatureRowProps) {
	const editor = useEditorStore((state) => state.editor)

	// Local state for new property - each row has its own
	const [newPropKey, setNewPropKey] = useState('')
	const [newPropValue, setNewPropValue] = useState('')

	const onFieldChange = (field: 'name' | 'description', value: string) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, [field]: value },
		})
	}

	const onCustomPropertyChange = (key: string, value: string) => {
		if (!editor) return
		const currentProps = feature.properties?.customProperties || {}
		const typedValue = coercePropertyInput(value, propertyTypeHints?.get(key), currentProps[key])
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: { ...currentProps, [key]: typedValue },
			},
		})
	}

	const onRemoveCustomProperty = (key: string) => {
		if (!editor) return
		const currentProps = { ...(feature.properties?.customProperties || {}) }
		delete currentProps[key]
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: currentProps,
			},
		})
	}

	const onAddCustomProperty = () => {
		if (!editor || !newPropKey) return
		const currentProps = feature.properties?.customProperties || {}
		const key = newPropKey.trim()
		const typedValue = coercePropertyInput(newPropValue, propertyTypeHints?.get(key))
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: {
					...currentProps,
					[key]: typedValue,
				},
			},
		})
		setNewPropKey('')
		setNewPropValue('')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && newPropKey) {
			onAddCustomProperty()
		}
	}

	const isAnnotation = feature.properties?.featureType === 'annotation'

	const onAnnotationTextChange = (text: string) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, text },
		})
	}

	const onAnnotationStyleChange = (
		styleProp: 'textFontSize' | 'textColor' | 'textHaloColor' | 'textHaloWidth',
		value: string | number,
	) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, [styleProp]: value },
		})
	}

	const customProperties = feature.properties?.customProperties ?? {}
	const hasValidationIssues = Boolean(validationIssues && validationIssues.length > 0)
	const validationSummary = validationIssues?.slice(0, 3).join(' | ')
	const newPropertyTypeHint = propertyTypeHints?.get(newPropKey.trim())

	return (
		<div
			className={cn(
				'rounded border text-xs',
				isSelected ? 'border-blue-400 bg-blue-50' : 'border-gray-200 bg-white hover:bg-gray-50',
			)}
		>
			{/* Row header */}
			<div className="flex items-center gap-1 px-1.5 py-1">
				<button
					type="button"
					onClick={onToggleExpand}
					className="text-gray-400 hover:text-gray-600"
				>
					{isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				</button>

				<GeometryBadge geometry={feature.geometry} isAnnotation={isAnnotation} />

				<button
					type="button"
					onClick={(e) => onSelect(e)}
					className="flex-1 text-left truncate text-gray-700 hover:text-gray-900"
				>
					{name}
				</button>

				{hasValidationIssues && (
					<div className="flex items-center gap-1 text-amber-600" title={validationSummary}>
						<AlertTriangle className="h-3 w-3" />
						<span className="text-[10px]">{validationIssues?.length}</span>
					</div>
				)}

				<Button
					size="icon-sm"
					variant="ghost"
					className="text-blue-500 hover:text-blue-700"
					onClick={onZoomTo}
					aria-label="Zoom to feature"
				>
					<Locate className="h-3 w-3" />
				</Button>

				<Button
					size="icon-sm"
					variant="ghost"
					className="text-red-500 hover:text-red-700"
					onClick={onDelete}
					aria-label="Delete feature"
				>
					<Trash2 className="h-3 w-3" />
				</Button>
			</div>

			{/* Expanded content */}
			{isExpanded && (
				<div className="border-t border-gray-100 px-2 py-2 bg-gray-50/50 space-y-2">
					{hasValidationIssues && (
						<div className="rounded border border-amber-300 bg-amber-50 px-2 py-1">
							<div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-amber-800 uppercase tracking-wide">
								<AlertTriangle className="h-3 w-3" />
								Context warnings
							</div>
							<div className="space-y-0.5 text-[10px] text-amber-800">
								{validationIssues?.slice(0, 3).map((issue) => (
									<p key={issue}>{issue}</p>
								))}
								{(validationIssues?.length ?? 0) > 3 && (
									<p>+{(validationIssues?.length ?? 0) - 3} more</p>
								)}
							</div>
						</div>
					)}

					{/* Annotation-specific: Text input prominently displayed */}
					{isAnnotation && (
						<div className="space-y-1.5 p-1.5 bg-amber-50 rounded border border-amber-200">
							<div className="text-[10px] text-amber-700 uppercase tracking-wide font-medium">
								Annotation Text
							</div>
							<textarea
								className="w-full h-12 rounded border border-amber-300 px-1.5 py-1 text-xs resize-none bg-white"
								placeholder="Enter annotation text..."
								value={(feature.properties?.text as string) ?? ''}
								onChange={(e) => onAnnotationTextChange(e.target.value)}
							/>
							<div className="flex items-center gap-2">
								<div className="flex items-center gap-1 flex-1">
									<span className="text-[9px] text-gray-500">Size</span>
									<Input
										type="number"
										className="h-5 text-[11px] w-12"
										min={8}
										max={72}
										value={feature.properties?.textFontSize ?? 14}
										onChange={(e) =>
											onAnnotationStyleChange('textFontSize', Number(e.target.value))
										}
									/>
								</div>
								<div className="flex items-center gap-1">
									<span className="text-[9px] text-gray-500">Text</span>
									<Input
										type="color"
										className="h-5 w-6 p-0.5 rounded border border-gray-200"
										value={(feature.properties?.textColor as string) ?? '#1f2937'}
										onChange={(e) => onAnnotationStyleChange('textColor', e.target.value)}
									/>
								</div>
								<div className="flex items-center gap-1">
									<span className="text-[9px] text-gray-500">Halo</span>
									<Input
										type="color"
										className="h-5 w-6 p-0.5 rounded border border-gray-200"
										value={(feature.properties?.textHaloColor as string) ?? '#ffffff'}
										onChange={(e) => onAnnotationStyleChange('textHaloColor', e.target.value)}
									/>
								</div>
							</div>
						</div>
					)}

					{/* Name */}
					<Input
						className="h-6 text-xs"
						placeholder="Name"
						value={(feature.properties?.name as string) ?? ''}
						onChange={(e) => onFieldChange('name', e.target.value)}
					/>

					{/* Style Properties Section (for non-annotation features) */}
					{!isAnnotation && <StylePropertiesSection feature={feature} />}

					{/* Description */}
					<GeoRichTextEditor
						initialValue={(feature.properties?.description as string) ?? ''}
						placeholder="Description"
						availableFeatures={availableFeatures}
						onChange={(value) => onFieldChange('description', value)}
						rows={2}
						className="min-h-[92px]"
					/>

					{/* Custom properties - compact */}
					{Object.keys(customProperties).length > 0 && (
						<div className="space-y-0.5">
							{Object.entries(customProperties).map(([key, value]) => (
								<div key={key} className="flex items-center gap-1">
									<span className="text-[10px] text-gray-500 min-w-[32px] truncate">{key}</span>
									<span className="rounded bg-gray-100 px-1 py-0.5 text-[9px] text-gray-600 uppercase">
										{inferDisplayType(value, propertyTypeHints?.get(key))}
									</span>
									<Input
										className="h-5 text-[11px] flex-1"
										value={String(value)}
										onChange={(e) => onCustomPropertyChange(key, e.target.value)}
									/>
									<Button
										size="icon-sm"
										variant="ghost"
										className="text-red-400 hover:text-red-600"
										onClick={() => onRemoveCustomProperty(key)}
									>
										<Trash2 className="h-2.5 w-2.5" />
									</Button>
								</div>
							))}
						</div>
					)}

					{/* Add new property */}
					<div className="flex items-center gap-1">
						<Input
							className="h-5 text-[11px] flex-1"
							placeholder="key"
							value={newPropKey}
							onChange={(e) => setNewPropKey(e.target.value)}
							onKeyDown={handleKeyDown}
						/>
						<Input
							className="h-5 text-[11px] flex-1"
							placeholder="value"
							value={newPropValue}
							onChange={(e) => setNewPropValue(e.target.value)}
							onKeyDown={handleKeyDown}
						/>
						{newPropertyTypeHint && (
							<span className="rounded bg-blue-100 px-1 py-0.5 text-[9px] text-blue-700 uppercase">
								{newPropertyTypeHint}
							</span>
						)}
						<Button
							size="icon-sm"
							variant="ghost"
							onClick={onAddCustomProperty}
							disabled={!newPropKey}
						>
							<Plus className="h-2.5 w-2.5" />
						</Button>
					</div>

					{/* Geometry coordinates */}
					<GeometryDisplay geometry={feature.geometry} />
				</div>
			)}
		</div>
	)
}

interface GeometriesTableProps {
	className?: string
	onZoomToFeature?: (feature: EditorFeature) => void
	contextValidationIssuesByFeatureId?: Map<string, string[]>
	contextPropertyTypeHints?: Map<string, ContextPropertyTypeHint>
	availableFeatures?: GeoFeatureItem[]
}

export function GeometriesTable({
	className,
	onZoomToFeature,
	contextValidationIssuesByFeatureId,
	contextPropertyTypeHints,
	availableFeatures = [],
}: GeometriesTableProps) {
	const features = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const editor = useEditorStore((state) => state.editor)

	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

	const toggleExpand = (id: string) => {
		setExpandedIds((prev) => {
			const next = new Set(prev)
			if (next.has(id)) {
				next.delete(id)
			} else {
				next.add(id)
			}
			return next
		})
	}

	const handleSelect = (featureId: string, event: React.MouseEvent) => {
		const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
		const isMultiSelect = isMac ? event.metaKey : event.ctrlKey

		if (isMultiSelect) {
			// Toggle selection
			if (selectedFeatureIds.includes(featureId)) {
				setSelectedFeatureIds(selectedFeatureIds.filter((id) => id !== featureId))
			} else {
				setSelectedFeatureIds([...selectedFeatureIds, featureId])
			}
		} else {
			// Single select
			setSelectedFeatureIds([featureId])
		}
	}

	const handleDelete = (featureId: string) => {
		if (!editor) return
		editor.deleteFeatures([featureId])
	}

	const rows = useMemo(
		() =>
			features.map((feature) => {
				const isAnnotation = feature.properties?.featureType === 'annotation'
				let name = feature.properties?.name as string
				if (!name) {
					if (isAnnotation) {
						// Show annotation text (truncated) or fallback
						const text = feature.properties?.text as string
						name = text ? `"${text.slice(0, 20)}${text.length > 20 ? '…' : ''}"` : 'Annotation'
					} else {
						name = `${feature.geometry.type} • ${String(feature.id).slice(0, 6)}`
					}
				}
				return {
					feature,
					name,
					isSelected: selectedFeatureIds.includes(feature.id),
					validationIssues: contextValidationIssuesByFeatureId?.get(String(feature.id)) ?? [],
					propertyTypeHints: contextPropertyTypeHints,
				}
			}),
		[features, selectedFeatureIds, contextValidationIssuesByFeatureId, contextPropertyTypeHints],
	)

	if (features.length === 0) {
		return (
			<div className={cn('text-xs text-gray-500 py-2', className)}>
				Draw or load geometries to edit.
			</div>
		)
	}

	return (
		<div className={cn('space-y-1', className)}>
			{rows.map((row) => (
				<FeatureRow
					key={row.feature.id}
					feature={row.feature}
					name={row.name}
					isSelected={row.isSelected}
					isExpanded={expandedIds.has(row.feature.id)}
					validationIssues={row.validationIssues}
					propertyTypeHints={row.propertyTypeHints}
					availableFeatures={availableFeatures}
					onToggleExpand={() => toggleExpand(row.feature.id)}
					onSelect={(e) => handleSelect(row.feature.id, e)}
					onDelete={() => handleDelete(row.feature.id)}
					onZoomTo={() => onZoomToFeature?.(row.feature)}
				/>
			))}
		</div>
	)
}
