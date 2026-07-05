import { Map } from 'lucide-react'
import type React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { earthlyGeoServer, type OsmElementType, type OsmFilters } from '@/ctxcn'

// Common OSM feature type presets
const FEATURE_PRESETS = [
	{ label: 'All Features', value: 'all', filters: {} },
	{ label: 'Highways (all roads)', value: 'highway', filters: { highway: '*' } },
	{ label: 'Railways', value: 'railway', filters: { railway: '*' } },
	{ label: 'Waterways', value: 'waterway', filters: { waterway: '*' } },
	{ label: 'Buildings', value: 'building', filters: { building: '*' } },
	{ label: 'Natural features', value: 'natural', filters: { natural: '*' } },
	{ label: 'Land use', value: 'landuse', filters: { landuse: '*' } },
	{ label: 'Amenities', value: 'amenity', filters: { amenity: '*' } },
	{ label: 'Leisure', value: 'leisure', filters: { leisure: '*' } },
] as const

interface OsmFeatureResult {
	id: string
	name: string
	type: string
	feature: GeoJSON.Feature
	selected: boolean
}

interface ImportOsmDialogProps {
	open: boolean
	onOpenChange: (open: boolean) => void
	mapCenter?: { lat: number; lon: number }
	mapBounds?: { west: number; south: number; east: number; north: number }
	onImport: (features: GeoJSON.Feature[]) => void
}

export function ImportOsmDialog({
	open,
	onOpenChange,
	mapCenter,
	mapBounds,
	onImport,
}: ImportOsmDialogProps) {
	const [activeTab, setActiveTab] = useState<'id' | 'nearby' | 'bbox'>('nearby')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [results, setResults] = useState<OsmFeatureResult[]>([])

	// By ID form state
	const [osmType, setOsmType] = useState<OsmElementType>('way')
	const [osmId, setOsmId] = useState('')

	// Nearby form state
	const [nearbyLat, setNearbyLat] = useState(mapCenter?.lat.toFixed(6) ?? '')
	const [nearbyLon, setNearbyLon] = useState(mapCenter?.lon.toFixed(6) ?? '')
	const [nearbyRadius, setNearbyRadius] = useState('200')
	const [nearbyPreset, setNearbyPreset] = useState('highway')

	// Bbox form state
	const [bboxWest, setBboxWest] = useState(mapBounds?.west.toFixed(6) ?? '')
	const [bboxSouth, setBboxSouth] = useState(mapBounds?.south.toFixed(6) ?? '')
	const [bboxEast, setBboxEast] = useState(mapBounds?.east.toFixed(6) ?? '')
	const [bboxNorth, setBboxNorth] = useState(mapBounds?.north.toFixed(6) ?? '')
	const [bboxPreset, setBboxPreset] = useState('building')

	const getFiltersForPreset = (preset: string): OsmFilters | undefined => {
		const found = FEATURE_PRESETS.find((p) => p.value === preset)
		return found && Object.keys(found.filters).length > 0 ? found.filters : undefined
	}

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
		// Find the main tag
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

	const handleQueryById = async () => {
		if (!osmId.trim()) {
			setError('Please enter an OSM ID')
			return
		}

		setLoading(true)
		setError(null)
		setResults([])

		try {
			const response = await earthlyGeoServer.QueryOsmById(osmType, parseInt(osmId, 10))
			if (!response?.result) {
				setError('Failed to query OSM - no response received')
				return
			}
			if (response.result.feature) {
				setResults([
					{
						id: `${osmType}/${osmId}`,
						name: getFeatureName(response.result.feature),
						type: getFeatureType(response.result.feature),
						feature: response.result.feature,
						selected: true,
					},
				])
			} else {
				setError(`No feature found for ${osmType}/${osmId}`)
			}
		} catch (err: any) {
			setError(err.message || 'Failed to query OSM')
		} finally {
			setLoading(false)
		}
	}

	const handleQueryNearby = async () => {
		const lat = parseFloat(nearbyLat)
		const lon = parseFloat(nearbyLon)
		const radius = parseInt(nearbyRadius, 10)

		if (Number.isNaN(lat) || Number.isNaN(lon)) {
			setError('Please enter valid coordinates')
			return
		}

		setLoading(true)
		setError(null)
		setResults([])

		try {
			const filters = getFiltersForPreset(nearbyPreset)
			const response = await earthlyGeoServer.QueryOsmNearby(lat, lon, radius, filters, 50)

			if (!response?.result) {
				setError('Failed to query OSM - no response received')
				return
			}

			if (response.result.features.length === 0) {
				setError('No features found in this area')
			} else {
				setResults(
					response.result.features.map((f) => ({
						id: String(f.id || Math.random().toString(36).slice(2)),
						name: getFeatureName(f),
						type: getFeatureType(f),
						feature: f,
						selected: false,
					})),
				)
			}
		} catch (err: any) {
			setError(err.message || 'Failed to query OSM')
		} finally {
			setLoading(false)
		}
	}

	const handleQueryBbox = async () => {
		const west = parseFloat(bboxWest)
		const south = parseFloat(bboxSouth)
		const east = parseFloat(bboxEast)
		const north = parseFloat(bboxNorth)

		if ([west, south, east, north].some(Number.isNaN)) {
			setError('Please enter valid bounding box coordinates')
			return
		}

		setLoading(true)
		setError(null)
		setResults([])

		try {
			const filters = getFiltersForPreset(bboxPreset)
			const response = await earthlyGeoServer.QueryOsmBbox(west, south, east, north, filters, 50)

			if (!response?.result) {
				setError('Failed to query OSM - no response received')
				return
			}

			if (response.result.features.length === 0) {
				setError('No features found in this area')
			} else {
				setResults(
					response.result.features.map((f) => ({
						id: String(f.id || Math.random().toString(36).slice(2)),
						name: getFeatureName(f),
						type: getFeatureType(f),
						feature: f,
						selected: false,
					})),
				)
			}
		} catch (err: any) {
			setError(err.message || 'Failed to query OSM')
		} finally {
			setLoading(false)
		}
	}

	const handleSearch = () => {
		switch (activeTab) {
			case 'id':
				handleQueryById()
				break
			case 'nearby':
				handleQueryNearby()
				break
			case 'bbox':
				handleQueryBbox()
				break
		}
	}

	const toggleResult = (id: string) => {
		setResults((prev) => prev.map((r) => (r.id === id ? { ...r, selected: !r.selected } : r)))
	}

	const selectAll = () => {
		setResults((prev) => prev.map((r) => ({ ...r, selected: true })))
	}

	const selectNone = () => {
		setResults((prev) => prev.map((r) => ({ ...r, selected: false })))
	}

	const handleImport = () => {
		const selectedFeatures = results.filter((r) => r.selected).map((r) => r.feature)
		if (selectedFeatures.length > 0) {
			onImport(selectedFeatures)
			onOpenChange(false)
			setResults([])
		}
	}

	const useMapCenter = () => {
		if (mapCenter) {
			setNearbyLat(mapCenter.lat.toFixed(6))
			setNearbyLon(mapCenter.lon.toFixed(6))
		}
	}

	const useMapBounds = () => {
		if (mapBounds) {
			setBboxWest(mapBounds.west.toFixed(6))
			setBboxSouth(mapBounds.south.toFixed(6))
			setBboxEast(mapBounds.east.toFixed(6))
			setBboxNorth(mapBounds.north.toFixed(6))
		}
	}

	const selectedCount = results.filter((r) => r.selected).length

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Map className="h-5 w-5" />
						Import from OpenStreetMap
					</DialogTitle>
					<DialogDescription>Query OSM features and import them as GeoJSON</DialogDescription>
				</DialogHeader>

				<Tabs
					value={activeTab}
					onValueChange={(v: string) => setActiveTab(v as typeof activeTab)}
					className="flex-1 flex flex-col min-h-0"
				>
					<TabsList className="grid grid-cols-3">
						<TabsTrigger value="id">By ID</TabsTrigger>
						<TabsTrigger value="nearby">Nearby</TabsTrigger>
						<TabsTrigger value="bbox">Bounding Box</TabsTrigger>
					</TabsList>

					<TabsContent value="id" className="space-y-4 mt-4">
						<div className="grid grid-cols-3 gap-2">
							<div className="space-y-1">
								<Label htmlFor="osm-type">Type</Label>
								<Select value={osmType} onValueChange={(v) => setOsmType(v as OsmElementType)}>
									<SelectTrigger id="osm-type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="node">Node</SelectItem>
										<SelectItem value="way">Way</SelectItem>
										<SelectItem value="relation">Relation</SelectItem>
									</SelectContent>
								</Select>
							</div>
							<div className="col-span-2 space-y-1">
								<Label htmlFor="osm-id">OSM ID</Label>
								<Input
									id="osm-id"
									type="number"
									placeholder="123456789"
									value={osmId}
									onChange={(e) => setOsmId(e.target.value)}
								/>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="nearby" className="space-y-4 mt-4">
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1">
								<Label htmlFor="nearby-lat">Latitude</Label>
								<Input
									id="nearby-lat"
									type="number"
									step="any"
									value={nearbyLat}
									onChange={(e) => setNearbyLat(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="nearby-lon">Longitude</Label>
								<Input
									id="nearby-lon"
									type="number"
									step="any"
									value={nearbyLon}
									onChange={(e) => setNearbyLon(e.target.value)}
								/>
							</div>
						</div>
						{mapCenter && (
							<Button variant="outline" size="sm" onClick={useMapCenter} className="w-full">
								Use Map Center
							</Button>
						)}
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1">
								<Label htmlFor="nearby-radius">Radius (m)</Label>
								<Input
									id="nearby-radius"
									type="number"
									min={1}
									max={5000}
									value={nearbyRadius}
									onChange={(e) => setNearbyRadius(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="nearby-filter">Feature Type</Label>
								<Select value={nearbyPreset} onValueChange={setNearbyPreset}>
									<SelectTrigger id="nearby-filter">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{FEATURE_PRESETS.map((p) => (
											<SelectItem key={p.value} value={p.value}>
												{p.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						</div>
					</TabsContent>

					<TabsContent value="bbox" className="space-y-4 mt-4">
						<div className="grid grid-cols-2 gap-2">
							<div className="space-y-1">
								<Label htmlFor="bbox-west">West</Label>
								<Input
									id="bbox-west"
									type="number"
									step="any"
									value={bboxWest}
									onChange={(e) => setBboxWest(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="bbox-east">East</Label>
								<Input
									id="bbox-east"
									type="number"
									step="any"
									value={bboxEast}
									onChange={(e) => setBboxEast(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="bbox-south">South</Label>
								<Input
									id="bbox-south"
									type="number"
									step="any"
									value={bboxSouth}
									onChange={(e) => setBboxSouth(e.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="bbox-north">North</Label>
								<Input
									id="bbox-north"
									type="number"
									step="any"
									value={bboxNorth}
									onChange={(e) => setBboxNorth(e.target.value)}
								/>
							</div>
						</div>
						{mapBounds && (
							<Button variant="outline" size="sm" onClick={useMapBounds} className="w-full">
								Use Current View
							</Button>
						)}
						<div className="space-y-1">
							<Label htmlFor="bbox-filter">Feature Type</Label>
							<Select value={bboxPreset} onValueChange={setBboxPreset}>
								<SelectTrigger id="bbox-filter">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{FEATURE_PRESETS.map((p) => (
										<SelectItem key={p.value} value={p.value}>
											{p.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</TabsContent>

					<div className="mt-4">
						<Button onClick={handleSearch} disabled={loading} className="w-full">
							{loading ? 'Searching...' : 'Search'}
						</Button>
					</div>

					{error && (
						<div className="text-sm text-destructive p-2 bg-destructive/10 rounded">{error}</div>
					)}

					{results.length > 0 && (
						<div className="flex-1 min-h-0 flex flex-col mt-4">
							<div className="flex items-center justify-between mb-2">
								<span className="text-sm text-muted-foreground">
									{results.length} results, {selectedCount} selected
								</span>
								<div className="flex gap-1">
									<Button variant="ghost" size="sm" onClick={selectAll}>
										All
									</Button>
									<Button variant="ghost" size="sm" onClick={selectNone}>
										None
									</Button>
								</div>
							</div>
							<div className="flex-1 overflow-y-auto border rounded-lg max-h-48">
								{results.map((r) => (
									<Button
										key={r.id}
										type="button"
										onClick={() => toggleResult(r.id)}
										className={`w-full text-left p-2 border-b last:border-0 hover:bg-muted/50 transition-colors ${
											r.selected ? 'bg-primary/10' : ''
										}`}
									>
										<div className="flex items-center gap-2">
											<Input
												type="checkbox"
												checked={r.selected}
												onChange={() => {}}
												className="pointer-events-none"
											/>
											<div className="flex-1 min-w-0">
												<div className="font-medium text-sm truncate">{r.name}</div>
												<div className="text-xs text-muted-foreground truncate">{r.type}</div>
											</div>
										</div>
									</Button>
								))}
							</div>
						</div>
					)}
				</Tabs>

				<DialogFooter className="mt-4">
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
					<Button onClick={handleImport} disabled={selectedCount === 0}>
						Import {selectedCount > 0 ? `(${selectedCount})` : ''}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
