/**
 * CreateMapPopover - UI for extracting PMTiles map excerpts
 *
 * Allows users to:
 * 1. Select source: from dataset bbox or from current selection
 * 2. Enter a Blossom server URL
 * 3. Configure max zoom level
 * 4. Extract, sign, and upload the map
 */

import { useState, useMemo, useEffect } from 'react'
import {
	AlertTriangle,
	Check,
	Copy,
	Loader2,
	Map as MapIcon,
	Maximize,
	MousePointer2,
	PenTool,
} from 'lucide-react'
import type { Geometry, Position } from 'geojson'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { useEditorStore } from '../store'
import { accounts } from '@/lib/nostr'
import { useActiveAccount } from 'applesauce-react/hooks'
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { config } from '@/config'

// Area calculation helpers
function calculateBBoxAreaSqKm(bbox: {
	west: number
	south: number
	east: number
	north: number
}): number {
	const { west, south, east, north } = bbox

	// Convert to radians
	const lat1 = (south * Math.PI) / 180
	const lat2 = (north * Math.PI) / 180
	const lon1 = (west * Math.PI) / 180
	const lon2 = (east * Math.PI) / 180

	// Earth radius in km
	const R = 6371

	// Approximate area using spherical geometry
	const width = R * Math.cos((lat1 + lat2) / 2) * Math.abs(lon2 - lon1)
	const height = R * Math.abs(lat2 - lat1)

	return width * height
}

// Max area in sqkm (configurable)
const MAX_AREA_SQKM = 3000
const DATASET_EXCERPT_PADDING_METERS = 5000
const WEB_MERCATOR_MAX_LAT = 85.05112878

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function padBBoxMeters(bbox: BBox, paddingMeters: number): BBox {
	const midLat = (bbox.south + bbox.north) / 2
	const latRad = (midLat * Math.PI) / 180
	const metersPerDegreeLat = 111_320
	const metersPerDegreeLon = Math.max(1e-6, metersPerDegreeLat * Math.cos(latRad))

	const padLat = paddingMeters / metersPerDegreeLat
	const padLon = paddingMeters / metersPerDegreeLon

	return {
		west: clamp(bbox.west - padLon, -180, 180),
		south: clamp(bbox.south - padLat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT),
		east: clamp(bbox.east + padLon, -180, 180),
		north: clamp(bbox.north + padLat, -WEB_MERCATOR_MAX_LAT, WEB_MERCATOR_MAX_LAT),
	}
}

interface BBox {
	west: number
	south: number
	east: number
	north: number
}

type SourceType = 'viewport' | 'dataset' | 'selection'
type FlowState = 'idle' | 'extracting' | 'signing' | 'uploading' | 'done' | 'error'

interface CreateMapPopoverProps {
	small?: boolean
}

interface MapExtractUnsignedEvent {
	kind: number
	content: string
	created_at: number
	tags: string[][]
}

interface MapExtractClient {
	CreateMapExtract: (
		west: number,
		south: number,
		east: number,
		north: number,
		maxZoom: number,
		blossomUrl: string,
		routeNaddr?: string,
	) => Promise<{
		result?: {
			requestId: string
			unsignedEvent: MapExtractUnsignedEvent
		}
	}>
	CreateMapUpload: (
		requestId: string,
		event: MapExtractUnsignedEvent & {
			id: string
			pubkey: string
			sig: string
		},
	) => Promise<{
		result?: {
			blobUrl?: string
		}
	}>
}

export function CreateMapPopover({ small = false }: CreateMapPopoverProps) {
	const [open, setOpen] = useState(false)
	const [sourceType, setSourceType] = useState<SourceType>('viewport')
	const [blossomUrl, setBlossomUrl] = useState(
		config.isDevelopment ? 'http://localhost:3544' : 'https://blossom.earthly.city',
	)
	const [maxZoom, setMaxZoom] = useState(16)
	const [flowState, setFlowState] = useState<FlowState>('idle')
	const [error, setError] = useState<string | null>(null)
	const [resultUrl, setResultUrl] = useState<string | null>(null)
	const [copiedUrl, setCopiedUrl] = useState(false)
	const [includeRoute, setIncludeRoute] = useState(true)

	const currentUser = useActiveAccount()
	const editor = useEditorStore((state) => state.editor)
	const setMode = useEditorStore((state) => state.setMode)
	const setMapSource = useEditorStore((state) => state.setMapSource)
	const mapAreaRect = useEditorStore((state) => state.mapAreaRect)
	const clearMapAreaRect = useEditorStore((state) => state.clearMapAreaRect)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const activeDataset = useEditorStore((state) => state.activeDataset)
	const focusedMapGeometry = useEditorStore((state) => state.focusedMapGeometry)
	const clearFocusedMapGeometry = useEditorStore((state) => state.clearFocusedMapGeometry)
	const focusedNaddr = useEditorStore((state) => state.focusedNaddr)
	const focusedType = useEditorStore((state) => state.focusedType)

	// Check if we have a focused dataset that could be added as a route
	const canIncludeRoute = sourceType === 'dataset' && focusedNaddr && focusedType === 'geoevent'

	// Compute bbox based on source type (used for extraction)
	// biome-ignore lint/correctness/useExhaustiveDependencies: selection and open refresh bbox reads from imperative editor/map state.
	const bbox = useMemo((): BBox | null => {
		if (sourceType === 'viewport') {
			// Use current map viewport from editor
			const mapBounds = editor?.getMapBounds()
			if (mapBounds) {
				return {
					west: mapBounds[0],
					south: mapBounds[1],
					east: mapBounds[2],
					north: mapBounds[3],
				}
			}
			return null
		} else if (sourceType === 'dataset') {
			// Use bbox from last clicked remote geometry (external datasets)
			if (focusedMapGeometry) {
				const baseBbox = {
					west: focusedMapGeometry.bbox[0],
					south: focusedMapGeometry.bbox[1],
					east: focusedMapGeometry.bbox[2],
					north: focusedMapGeometry.bbox[3],
				}
				return padBBoxMeters(baseBbox, DATASET_EXCERPT_PADDING_METERS)
			}

			// Get bbox from selected features on the map (clicked geometries)
			const selectedFeatures = editor?.getSelectedFeatures() ?? []

			if (selectedFeatures.length > 0) {
				let west = Infinity,
					south = Infinity,
					east = -Infinity,
					north = -Infinity

				for (const feature of selectedFeatures) {
					const coords = getAllCoordinates(feature.geometry)
					for (const [lon, lat] of coords) {
						if (lon < west) west = lon
						if (lon > east) east = lon
						if (lat < south) south = lat
						if (lat > north) north = lat
					}
				}

				if (Number.isFinite(west)) {
					return padBBoxMeters({ west, south, east, north }, DATASET_EXCERPT_PADDING_METERS)
				}
			}

			// Fallback to activeDataset bbox if available
			if (activeDataset?.boundingBox?.length === 4) {
				const datasetBbox = activeDataset.boundingBox
				return padBBoxMeters(
					{
						west: datasetBbox[0],
						south: datasetBbox[1],
						east: datasetBbox[2],
						north: datasetBbox[3],
					},
					DATASET_EXCERPT_PADDING_METERS,
				)
			}
			return null
		} else {
			// From drawn rectangle
			if (mapAreaRect) {
				return {
					west: mapAreaRect.bbox[0],
					south: mapAreaRect.bbox[1],
					east: mapAreaRect.bbox[2],
					north: mapAreaRect.bbox[3],
				}
			}
			return null
		}
	}, [sourceType, editor, mapAreaRect, selectedFeatureIds, open, activeDataset, focusedMapGeometry])

	// Handle source type change - activates appropriate tool
	const setIsDrawingMapArea = useEditorStore((state) => state.setIsDrawingMapArea)
	const [waitingForSelection, setWaitingForSelection] = useState(false)
	const handleSourceChange = (newSource: SourceType) => {
		setSourceType(newSource)
		clearMapAreaRect()
		setWaitingForSelection(false)

		if (newSource === 'viewport') {
			// Viewport uses current bounds, no need to close popover
			// Keep popover open
		} else if (newSource === 'dataset') {
			clearFocusedMapGeometry()
			// Activate select tool for clicking geometry
			setMode('select')
			// Track that we're waiting for selection (like draw area)
			setWaitingForSelection(true)
			// Close popover to let user click on geometry
			setOpen(false)
		} else {
			// selection - draw area
			setIsDrawingMapArea(true)
			setMode('draw_polygon')
			// Close popover to let user draw
			setOpen(false)
		}
	}

	// Auto-reopen popover when mapAreaRect is captured after drawing
	useEffect(() => {
		if (mapAreaRect && !open) {
			setSourceType('selection')
			setOpen(true)
		}
	}, [mapAreaRect, open])

	// Auto-reopen popover when geometry is selected in 'dataset' mode
	useEffect(() => {
		if (waitingForSelection && (selectedFeatureIds.length > 0 || focusedMapGeometry) && !open) {
			setWaitingForSelection(false)
			setOpen(true)
		}
	}, [waitingForSelection, selectedFeatureIds, focusedMapGeometry, open])

	// Calculate area
	const areaSqKm = bbox ? calculateBBoxAreaSqKm(bbox) : 0
	const isAreaTooLarge = areaSqKm > MAX_AREA_SQKM

	// Validate URL
	const isUrlValid = useMemo(() => {
		try {
			new URL(blossomUrl)
			return true
		} catch {
			return false
		}
	}, [blossomUrl])

	const canCreate = bbox && isUrlValid && !isAreaTooLarge && currentUser

	// Handle create map flow
	const handleCreate = async () => {
		if (!bbox || !accounts.signer) return

		setError(null)
		setResultUrl(null)
		setFlowState('extracting')

		try {
			// Create client
			const client = new EarthlyGeoServerClient() as unknown as MapExtractClient

			// Step 1: Extract PMTiles
			// Note: CreateMapExtract method will be available after client regeneration
			// If includeRoute is checked and we have a focused dataset, pass its naddr
			const routeNaddr = canIncludeRoute && includeRoute ? focusedNaddr : undefined
			const extractResult = await client.CreateMapExtract(
				bbox.west,
				bbox.south,
				bbox.east,
				bbox.north,
				maxZoom,
				blossomUrl,
				routeNaddr, // Optional: dataset naddr to include as route
			)

			if (!extractResult?.result) {
				throw new Error('Extraction failed: no result')
			}

			const { requestId, unsignedEvent } = extractResult.result

			// Step 2: Sign the event with the active applesauce signer
			setFlowState('signing')

			const signer = accounts.signer
			if (!signer) throw new Error('No active account')
			const signed = await signer.signEvent({
				kind: unsignedEvent.kind,
				content: unsignedEvent.content,
				created_at: unsignedEvent.created_at,
				tags: unsignedEvent.tags,
			})

			if (!signed.sig) {
				throw new Error('User cancelled signing')
			}

			// Step 3: Upload
			setFlowState('uploading')

			// Note: CreateMapUpload method will be available after client regeneration
			const uploadResult = await client.CreateMapUpload(requestId, {
				id: signed.id,
				pubkey: signed.pubkey,
				kind: signed.kind,
				created_at: signed.created_at,
				tags: signed.tags,
				content: signed.content,
				sig: signed.sig,
			})

			if (!uploadResult?.result?.blobUrl) {
				throw new Error('Upload failed: no result URL')
			}

			setResultUrl(uploadResult.result.blobUrl)
			setFlowState('done')
		} catch (err) {
			console.error('Create map failed:', err)
			setError(err instanceof Error ? err.message : 'Unknown error')
			setFlowState('error')
		}
	}

	const handleCopyUrl = async () => {
		if (resultUrl) {
			await navigator.clipboard.writeText(resultUrl)
			setCopiedUrl(true)
			setTimeout(() => setCopiedUrl(false), 2000)
		}
	}

	const handleReset = () => {
		setFlowState('idle')
		setError(null)
		setResultUrl(null)
	}

	const handleUseAsMapSource = () => {
		if (!resultUrl) return

		// Set as current map source
		setMapSource({
			type: 'pmtiles',
			location: 'remote',
			url: resultUrl,
		})

		// Update browser URL with shareable param
		const url = new URL(window.location.href)
		url.searchParams.set('pmtiles', resultUrl)
		window.history.replaceState({}, '', url.toString())

		// Close the popover
		setOpen(false)
		handleReset()
	}

	return (
		<TooltipProvider delayDuration={500}>
			<Popover open={open} onOpenChange={setOpen}>
				<Tooltip>
					<TooltipTrigger asChild>
						<PopoverTrigger asChild>
							<Button
								variant={small ? 'ghost' : 'outline'}
								size={small ? 'icon-sm' : 'icon'}
								className={
									small ? 'h-8 w-8 rounded-md border border-transparent shadow-none' : undefined
								}
								aria-label="Create Map"
							>
								<MapIcon className="h-4 w-4" />
							</Button>
						</PopoverTrigger>
					</TooltipTrigger>
					<TooltipContent side="bottom" sideOffset={8}>
						<p>Create map excerpt</p>
					</TooltipContent>
				</Tooltip>

				<PopoverContent className="w-80" side="bottom" align="end">
					<div className="space-y-4">
						<div>
							<h4 className="text-sm font-semibold">Create Map</h4>
							<p className="text-xs text-muted-foreground">
								Extract a PMTiles map excerpt and upload to Blossom
							</p>
						</div>

						{flowState === 'idle' && (
							<>
								{/* Source selection - icon buttons with tooltips */}
								<div className="space-y-2">
									<Label>Source</Label>
									<TooltipProvider delayDuration={300}>
										<div className="flex gap-1">
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant={sourceType === 'viewport' ? 'default' : 'outline'}
														size="icon"
														onClick={() => handleSourceChange('viewport')}
													>
														<Maximize className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													<p>Current View</p>
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant={sourceType === 'dataset' ? 'default' : 'outline'}
														size="icon"
														onClick={() => handleSourceChange('dataset')}
													>
														<MousePointer2 className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													<p>From Geometry</p>
												</TooltipContent>
											</Tooltip>
											<Tooltip>
												<TooltipTrigger asChild>
													<Button
														variant={sourceType === 'selection' ? 'default' : 'outline'}
														size="icon"
														onClick={() => handleSourceChange('selection')}
													>
														<PenTool className="h-4 w-4" />
													</Button>
												</TooltipTrigger>
												<TooltipContent side="bottom">
													<p>Draw Area</p>
												</TooltipContent>
											</Tooltip>
										</div>
									</TooltipProvider>
									<p className="text-xs text-muted-foreground">
										{sourceType === 'viewport'
											? 'Uses current map viewport bounds'
											: sourceType === 'dataset'
												? 'Click geometry to select, or all if none'
												: 'Draw a polygon to define area'}
									</p>
								</div>

								{/* Blossom URL */}
								<div className="space-y-2">
									<Label htmlFor="blossom-url">Blossom Server</Label>
									<Input
										id="blossom-url"
										value={blossomUrl}
										onChange={(e) => setBlossomUrl(e.target.value)}
										placeholder="https://blossom.example.com"
									/>
									{!isUrlValid && blossomUrl && (
										<p className="text-xs text-destructive">Invalid URL</p>
									)}
								</div>

								{/* Max Zoom */}
								<div className="space-y-2">
									<div className="flex items-center justify-between">
										<Label>Max Zoom</Label>
										<span className="text-xs text-muted-foreground">{maxZoom}</span>
									</div>
									<Slider
										value={[maxZoom]}
										onValueChange={([v]) => v !== undefined && setMaxZoom(v)}
										min={4}
										max={16}
										step={1}
									/>
								</div>

								{/* Include Route checkbox - only when using dataset source with focused geometry */}
								{canIncludeRoute && (
									<div className="flex items-center space-x-2">
										<Checkbox
											id="include-route"
											checked={includeRoute}
											onCheckedChange={(checked) => setIncludeRoute(checked === true)}
										/>
										<Label htmlFor="include-route" className="text-sm cursor-pointer">
											Include dataset as route
										</Label>
									</div>
								)}

								{/* Area display */}
								{bbox && (
									<div className="rounded-md bg-muted p-2">
										<div className="flex items-center justify-between text-xs">
											<span>Area:</span>
											<span className={isAreaTooLarge ? 'text-destructive font-medium' : ''}>
												{areaSqKm.toFixed(2)} km²
											</span>
										</div>
										{isAreaTooLarge && (
											<div className="flex items-center gap-1 mt-1 text-xs text-destructive">
												<AlertTriangle className="h-3 w-3" />
												Max {MAX_AREA_SQKM} km² allowed
											</div>
										)}
									</div>
								)}

								{!bbox && (
									<p className="text-xs text-muted-foreground">
										{sourceType === 'dataset'
											? 'No features in current dataset'
											: 'Draw a selection on the map'}
									</p>
								)}

								{!currentUser && (
									<p className="text-xs text-destructive">Please log in to sign the upload</p>
								)}

								<Button onClick={handleCreate} disabled={!canCreate} className="w-full">
									Create Map
								</Button>
							</>
						)}

						{(flowState === 'extracting' ||
							flowState === 'signing' ||
							flowState === 'uploading') && (
							<div className="flex flex-col items-center py-4 gap-2">
								<Loader2 className="h-8 w-8 animate-spin text-primary" />
								<p className="text-sm text-muted-foreground">
									{flowState === 'extracting' && 'Extracting map...'}
									{flowState === 'signing' && 'Waiting for signature...'}
									{flowState === 'uploading' && 'Uploading to Blossom...'}
								</p>
							</div>
						)}

						{flowState === 'done' && resultUrl && (
							<div className="space-y-3">
								<div className="flex items-center gap-2 text-green-600">
									<Check className="h-5 w-5" />
									<span className="text-sm font-medium">Upload complete!</span>
								</div>
								<div className="space-y-1">
									<Label>PMTiles URL</Label>
									<div className="flex gap-2">
										<Input value={resultUrl} readOnly className="text-xs" />
										<Button size="icon" variant="outline" onClick={handleCopyUrl}>
											{copiedUrl ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
										</Button>
									</div>
								</div>
								<Button onClick={handleUseAsMapSource} className="w-full">
									Use as Map Source
								</Button>
								<Button variant="outline" onClick={handleReset} className="w-full">
									Create another
								</Button>
							</div>
						)}

						{flowState === 'error' && (
							<div className="space-y-3">
								<div className="rounded-md bg-destructive/10 p-3">
									<p className="text-sm text-destructive">{error}</p>
								</div>
								<Button variant="outline" onClick={handleReset} className="w-full">
									Try again
								</Button>
							</div>
						)}
					</div>
				</PopoverContent>
			</Popover>
		</TooltipProvider>
	)
}

// Helper to extract all coordinates from a geometry
function getAllCoordinates(geometry: Geometry | null | undefined): [number, number][] {
	const coords: [number, number][] = []

	function pushPosition(position: Position) {
		const [lon, lat] = position
		if (typeof lon === 'number' && typeof lat === 'number') {
			coords.push([lon, lat])
		}
	}

	function extract(g: Geometry | null | undefined) {
		if (!g) return

		switch (g.type) {
			case 'Point':
				pushPosition(g.coordinates)
				break
			case 'MultiPoint':
			case 'LineString':
				for (const c of g.coordinates) {
					pushPosition(c)
				}
				break
			case 'MultiLineString':
			case 'Polygon':
				for (const ring of g.coordinates) {
					for (const c of ring) {
						pushPosition(c)
					}
				}
				break
			case 'MultiPolygon':
				for (const poly of g.coordinates) {
					for (const ring of poly) {
						for (const c of ring) {
							pushPosition(c)
						}
					}
				}
				break
			case 'GeometryCollection':
				for (const geom of g.geometries) {
					extract(geom)
				}
				break
		}
	}

	extract(geometry)
	return coords
}
