import { Plus, Trash2 } from 'lucide-react'
import type { EditorFeature } from '@/features/geo-editor/core'
import { NON_CUSTOM_EDITOR_PROPERTY_KEYS } from '@/features/geo-editor/constants'
import { isStyleProperty } from '@/features/geo-editor/types/styleProperties'
import { useEditorStore } from '@/features/geo-editor/store'
import { GeoRichTextEditor, type GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { StylePropertiesSection } from './StylePropertiesSection'

function deriveCustomProperties(properties: EditorFeature['properties'] | undefined) {
	if (!properties || typeof properties !== 'object') return {}
	const base = properties as Record<string, unknown>
	const explicitCustom =
		base.customProperties && typeof base.customProperties === 'object'
			? (base.customProperties as Record<string, unknown>)
			: {}
	const mirroredFromRoot: Record<string, unknown> = {}
	for (const [key, value] of Object.entries(base)) {
		if (NON_CUSTOM_EDITOR_PROPERTY_KEYS.has(key) || isStyleProperty(key)) continue
		mirroredFromRoot[key] = value
	}
	return {
		...mirroredFromRoot,
		...explicitCustom,
	}
}

export interface FeaturePropertiesSectionProps {
	feature: EditorFeature
	availableFeatures?: GeoFeatureItem[]
}

/**
 * Compact section for editing properties of a selected feature.
 */
export function FeaturePropertiesSection({
	feature,
	availableFeatures = [],
}: FeaturePropertiesSectionProps) {
	const editor = useEditorStore((state) => state.editor)
	const newFeatureProp = useEditorStore((state) => state.newFeatureProp)
	const setNewFeatureProp = useEditorStore((state) => state.setNewFeatureProp)

	const isAnnotation = feature.properties?.featureType === 'annotation'

	const onFieldChange = (field: 'name' | 'description', value: string) => {
		if (!editor) return
		editor.updateFeature(feature.id, {
			...feature,
			properties: { ...feature.properties, [field]: value },
		})
	}

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

	const onCustomPropertyChange = (key: string, value: string) => {
		if (!editor) return
		const currentProps = deriveCustomProperties(feature.properties)
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: { ...currentProps, [key]: value },
			},
		})
	}

	const onRemoveCustomProperty = (key: string) => {
		if (!editor) return
		const currentProps = { ...deriveCustomProperties(feature.properties) }
		delete currentProps[key]
		const nextRootProperties = { ...(feature.properties as Record<string, unknown>) }
		delete nextRootProperties[key]
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...nextRootProperties,
				...(Object.keys(currentProps).length > 0 ? { customProperties: currentProps } : {}),
			},
		})
	}

	const onAddCustomProperty = () => {
		if (!editor || !newFeatureProp.key) return
		const currentProps = deriveCustomProperties(feature.properties)
		editor.updateFeature(feature.id, {
			...feature,
			properties: {
				...feature.properties,
				customProperties: {
					...currentProps,
					[newFeatureProp.key]: newFeatureProp.value,
				},
			},
		})
		setNewFeatureProp({ key: '', value: '' })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && newFeatureProp.key) {
			onAddCustomProperty()
		}
	}

	const customPropertiesToDisplay = deriveCustomProperties(feature.properties)

	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between">
				<span className="text-xs font-medium text-foreground">
					{isAnnotation ? 'Annotation' : 'Feature'}
				</span>
				<span className="text-[10px] text-muted-foreground font-mono">
					{feature.id.slice(0, 10)}…
				</span>
			</div>

			{/* Annotation-specific: Text input prominently displayed */}
			{isAnnotation && (
				<div className="space-y-2 p-2 bg-primary/10 rounded border border-primary/40">
					<div className="text-[10px] text-primary uppercase tracking-wide font-medium">
						Annotation Text
					</div>
					<textarea
						className="w-full h-16 rounded border border-primary/40 px-2 py-1 text-sm resize-none bg-card"
						placeholder="Enter annotation text..."
						value={(feature.properties?.text as string) ?? ''}
						onChange={(e) => onAnnotationTextChange(e.target.value)}
						autoFocus
					/>
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-1 flex-1">
							<span className="text-[10px] text-muted-foreground">Size</span>
							<Input
								type="number"
								className="h-6 text-xs w-14"
								min={8}
								max={72}
								value={feature.properties?.textFontSize ?? 14}
								onChange={(e) => onAnnotationStyleChange('textFontSize', Number(e.target.value))}
							/>
						</div>
						<div className="flex items-center gap-1">
							<span className="text-[10px] text-muted-foreground">Color</span>
							<Input
								type="color"
								className="h-6 w-8 p-0.5 rounded border border-border"
								value={(feature.properties?.textColor as string) ?? '#1f2937'}
								onChange={(e) => onAnnotationStyleChange('textColor', e.target.value)}
							/>
						</div>
						<div className="flex items-center gap-1">
							<span className="text-[10px] text-muted-foreground">Halo</span>
							<Input
								type="color"
								className="h-6 w-8 p-0.5 rounded border border-border"
								value={(feature.properties?.textHaloColor as string) ?? '#ffffff'}
								onChange={(e) => onAnnotationStyleChange('textHaloColor', e.target.value)}
							/>
						</div>
					</div>
				</div>
			)}

			{/* Name field */}
			<Input
				className="h-7 text-xs"
				placeholder="Name"
				value={(feature.properties?.name as string) ?? ''}
				onChange={(e) => onFieldChange('name', e.target.value)}
			/>

			{/* Style Properties Section (not for annotations - they have their own styling) */}
			{!isAnnotation && <StylePropertiesSection feature={feature} />}

			{/* Description */}
			<GeoRichTextEditor
				initialValue={(feature.properties?.description as string) ?? ''}
				placeholder="Description"
				availableFeatures={availableFeatures}
				onChange={(value) => onFieldChange('description', value)}
				rows={3}
				className="min-h-[104px]"
			/>

			{/* Custom properties - compact */}
			<div className="space-y-1">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide">Properties</div>
				{Object.entries(customPropertiesToDisplay).map(([key, value]) => (
					<div key={key} className="flex items-center gap-1">
						<span className="text-[10px] text-muted-foreground min-w-[40px] truncate">{key}</span>
						<Input
							className="h-6 text-xs flex-1"
							value={String(value)}
							onChange={(e) => onCustomPropertyChange(key, e.target.value)}
						/>
						<Button
							size="icon-xs"
							variant="ghost"
							className="text-destructive"
							onClick={() => onRemoveCustomProperty(key)}
						>
							<Trash2 className="h-3 w-3" />
						</Button>
					</div>
				))}

				{/* Add new */}
				<div className="flex items-center gap-1">
					<Input
						className="h-6 text-xs flex-1"
						placeholder="key"
						value={newFeatureProp.key}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, key: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Input
						className="h-6 text-xs flex-1"
						placeholder="value"
						value={newFeatureProp.value}
						onChange={(e) => setNewFeatureProp({ ...newFeatureProp, value: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={onAddCustomProperty}
						disabled={!newFeatureProp.key}
					>
						<Plus className="h-3 w-3" />
					</Button>
				</div>
			</div>
		</div>
	)
}
