import { Plus, Trash2 } from 'lucide-react'
import { useEditorStore } from '@/features/geo-editor/store'
import { GeoRichTextEditor, type GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

/**
 * Compact section for editing dataset/collection metadata.
 */
interface DatasetMetadataSectionProps {
	availableFeatures?: GeoFeatureItem[]
}

export function DatasetMetadataSection({
	availableFeatures = [],
}: DatasetMetadataSectionProps = {}) {
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const setCollectionMeta = useEditorStore((state) => state.setCollectionMeta)
	const newCollectionProp = useEditorStore((state) => state.newCollectionProp)
	const setNewCollectionProp = useEditorStore((state) => state.setNewCollectionProp)

	const onNameChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, name: value })
	}

	const onDescriptionChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, description: value })
	}

	const onColorChange = (value: string) => {
		setCollectionMeta({ ...collectionMeta, color: value })
	}

	const onCustomPropertyChange = (key: string, value: string) => {
		setCollectionMeta({
			...collectionMeta,
			customProperties: { ...collectionMeta.customProperties, [key]: value },
		})
	}

	const onCustomPropertyRemove = (key: string) => {
		const next = { ...collectionMeta.customProperties }
		delete next[key]
		setCollectionMeta({ ...collectionMeta, customProperties: next })
	}

	const onAddCustomProperty = () => {
		if (!newCollectionProp.key) return
		setCollectionMeta({
			...collectionMeta,
			customProperties: {
				...collectionMeta.customProperties,
				[newCollectionProp.key]: newCollectionProp.value,
			},
		})
		setNewCollectionProp({ key: '', value: '' })
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && newCollectionProp.key) {
			onAddCustomProperty()
		}
	}

	return (
		<div className="space-y-2">
			{/* Name + Color inline */}
			<div className="flex items-center gap-2">
				<Input
					className="h-7 text-xs flex-1"
					placeholder="Name"
					value={collectionMeta.name}
					onChange={(e) => onNameChange(e.target.value)}
				/>
				<Input
					type="color"
					className="h-7 w-10 p-0.5 rounded border border-border"
					value={collectionMeta.color}
					onChange={(e) => onColorChange(e.target.value)}
				/>
			</div>

			<GeoRichTextEditor
				initialValue={collectionMeta.description}
				placeholder="Description (optional)"
				availableFeatures={availableFeatures}
				onChange={onDescriptionChange}
				rows={3}
				className="min-h-[110px]"
			/>

			{/* Custom properties - compact */}
			<div className="space-y-1">
				<div className="text-[10px] text-muted-foreground uppercase tracking-wide">Properties</div>
				{Object.entries(collectionMeta.customProperties).map(([key, value]) => (
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
							onClick={() => onCustomPropertyRemove(key)}
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
						value={newCollectionProp.key}
						onChange={(e) => setNewCollectionProp({ ...newCollectionProp, key: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Input
						className="h-6 text-xs flex-1"
						placeholder="value"
						value={newCollectionProp.value}
						onChange={(e) => setNewCollectionProp({ ...newCollectionProp, value: e.target.value })}
						onKeyDown={handleKeyDown}
					/>
					<Button
						size="icon-xs"
						variant="outline"
						onClick={onAddCustomProperty}
						disabled={!newCollectionProp.key}
					>
						<Plus className="h-3 w-3" />
					</Button>
				</div>
			</div>
		</div>
	)
}
