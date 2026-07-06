import { Check, X } from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '../store'

interface OsmResultsPanelProps {
	onImport: (features: GeoJSON.Feature[]) => void
	onClose: () => void
}

export function OsmResultsPanel({ onImport, onClose }: OsmResultsPanelProps) {
	const position = useEditorStore((state) => state.osmQueryPosition)
	const results = useEditorStore((state) => state.osmQueryResults)
	const error = useEditorStore((state) => state.osmQueryError)
	const loading = useEditorStore((state) => state.osmQueryMode === 'loading')
	const selectedIds = useEditorStore((state) => state.osmQuerySelectedIds)
	const toggleSelection = useEditorStore((state) => state.toggleOsmQuerySelection)
	const clearOsmQuery = useEditorStore((state) => state.clearOsmQuery)

	const selectedCount = selectedIds.size

	// Get feature display info
	const getFeatureName = (feature: GeoJSON.Feature): string => {
		const props = feature.properties || {}
		return (
			props.name ||
			props.ref ||
			props['@id'] ||
			`${props['@type'] || 'feature'} ${feature.id || ''}`
		)
	}

	const getFeatureType = (feature: GeoJSON.Feature): string => {
		const props = feature.properties || {}
		for (const key of [
			'highway',
			'railway',
			'waterway',
			'building',
			'natural',
			'landuse',
			'amenity',
			'leisure',
		]) {
			if (props[key]) {
				return `${key}=${props[key]}`
			}
		}
		return props['@type'] || feature.geometry.type
	}

	const handleImport = useCallback(() => {
		const selectedFeatures = results.filter((f) => selectedIds.has(String(f.id)))
		if (selectedFeatures.length > 0) {
			onImport(selectedFeatures)
			clearOsmQuery()
		}
	}, [results, selectedIds, onImport, clearOsmQuery])

	const handleClose = useCallback(() => {
		clearOsmQuery()
		onClose()
	}, [clearOsmQuery, onClose])

	const selectAll = useCallback(() => {
		results.forEach((f) => {
			const id = String(f.id)
			if (!selectedIds.has(id)) {
				toggleSelection(id)
			}
		})
	}, [results, selectedIds, toggleSelection])

	const selectNone = useCallback(() => {
		results.forEach((f) => {
			const id = String(f.id)
			if (selectedIds.has(id)) {
				toggleSelection(id)
			}
		})
	}, [results, selectedIds, toggleSelection])

	// Close on Escape
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				handleClose()
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [handleClose])

	// Position the panel near the query location
	const panelStyle = useMemo(() => {
		if (!position) return {}
		return {
			position: 'absolute' as const,
			left: `${Math.min(position.x + 20, window.innerWidth - 320)}px`,
			top: `${Math.min(position.y - 20, window.innerHeight - 400)}px`,
		}
	}, [position])

	// Don't render if no position (idle mode)
	if (!position && !loading && results.length === 0 && !error) {
		return null
	}

	return (
		<div className="z-50 w-72 glass-panel rounded-lg shadow-lg overflow-hidden" style={panelStyle}>
			{/* Header */}
			<div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
				<span className="text-sm font-medium">OSM Features</span>
				<Button variant="ghost" size="icon-sm" onClick={handleClose} aria-label="Close">
					<X className="h-4 w-4" />
				</Button>
			</div>

			{/* Content */}
			<div className="p-2">
				{loading && (
					<div className="text-sm text-muted-foreground text-center py-4">Searching...</div>
				)}

				{error && (
					<div className="text-sm text-destructive p-2 bg-destructive/10 rounded">{error}</div>
				)}

				{!loading && !error && results.length === 0 && (
					<div className="text-sm text-muted-foreground text-center py-4">No features found</div>
				)}

				{!loading && results.length > 0 && (
					<>
						{/* Selection controls */}
						<div className="flex items-center justify-between mb-2 px-1">
							<span className="text-xs text-muted-foreground">
								{results.length} found, {selectedCount} selected
							</span>
							<div className="flex gap-1">
								<Button variant="link" className="h-auto p-0 text-xs" onClick={selectAll}>
									All
								</Button>
								<span className="text-xs text-muted-foreground">/</span>
								<Button variant="link" className="h-auto p-0 text-xs" onClick={selectNone}>
									None
								</Button>
							</div>
						</div>

						{/* Results list */}
						<div className="max-h-48 overflow-y-auto border rounded-lg">
							{results.map((feature) => {
								const id = String(feature.id)
								const isSelected = selectedIds.has(id)
								return (
									<button
										key={id}
										type="button"
										onClick={() => toggleSelection(id)}
										className={`w-full text-left p-2 border-b last:border-0 hover:bg-muted/50 transition-colors flex items-center gap-2 ${
											isSelected ? 'bg-primary/10' : ''
										}`}
									>
										<div
											className={`w-4 h-4 rounded border flex items-center justify-center ${
												isSelected
													? 'bg-primary border-primary text-primary-foreground'
													: 'border-input'
											}`}
										>
											{isSelected && <Check className="h-3 w-3" />}
										</div>
										<div className="flex-1 min-w-0">
											<div className="font-medium text-sm truncate">{getFeatureName(feature)}</div>
											<div className="text-xs text-muted-foreground truncate">
												{getFeatureType(feature)}
											</div>
										</div>
									</button>
								)
							})}
						</div>
					</>
				)}
			</div>

			{/* Footer */}
			{results.length > 0 && (
				<div className="flex items-center justify-end gap-2 px-3 py-2 border-t bg-muted/50">
					<Button variant="outline" size="sm" onClick={handleClose}>
						Cancel
					</Button>
					<Button size="sm" onClick={handleImport} disabled={selectedCount === 0}>
						Import {selectedCount > 0 && `(${selectedCount})`}
					</Button>
				</div>
			)}
		</div>
	)
}
