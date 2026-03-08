import {
	ChevronDown,
	Download,
	Eye,
	EyeOff,
	Globe,
	GripVertical,
	Radio,
	Server,
} from 'lucide-react'
import type React from 'react'
import { useMemo, useRef, useState } from 'react'
import { UserProfile } from '@/components/user-profile'
import { SessionsManager } from '@/features/auth/SessionsManager'
import { ChatSettingsSection } from '@/features/chat'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { useEditorStore, type MapLayerState } from '../store'

type MapSourceType = 'default' | 'pmtiles' | 'blossom'

export function MapSettingsPanel() {
	const mapSource = useEditorStore((state) => state.mapSource)
	const setMapSource = useEditorStore((state) => state.setMapSource)
	const mapLayers = useEditorStore((state) => state.mapLayers)
	const announcementSource = useEditorStore((state) => state.announcementSource)
	const updateMapLayerState = useEditorStore((state) => state.updateMapLayerState)
	const reorderMapLayers = useEditorStore((state) => state.reorderMapLayers)

	const fileInputRef = useRef<HTMLInputElement>(null)

	// Drag-and-drop state
	const [dragIndex, setDragIndex] = useState<number | null>(null)
	const [dropIndex, setDropIndex] = useState<number | null>(null)

	// Group layers by blossom server
	const layersByServer = useMemo(() => {
		const groups: { server: string; layers: (MapLayerState & { globalIndex: number })[] }[] = []
		const serverMap = new Map<string, (MapLayerState & { globalIndex: number })[]>()
		const serverOrder: string[] = []

		for (const [i, layer] of mapLayers.entries()) {
			const server = layer.blossomServer || 'unknown'
			let serverLayers = serverMap.get(server)
			if (!serverLayers) {
				serverLayers = []
				serverMap.set(server, serverLayers)
				serverOrder.push(server)
			}
			serverLayers.push({ ...layer, globalIndex: i })
		}

		for (const server of serverOrder) {
			const layers = serverMap.get(server)
			if (layers) {
				groups.push({ server, layers })
			}
		}
		return groups
	}, [mapLayers])

	const handleSourceTypeChange = (value: MapSourceType) => {
		if (value === 'default') {
			setMapSource({
				type: 'default',
				location: 'remote',
			})
		} else if (value === 'pmtiles') {
			setMapSource({
				type: 'pmtiles',
				location: mapSource.location,
				url: mapSource.url,
				file: mapSource.file,
			})
		} else if (value === 'blossom') {
			setMapSource({
				type: 'blossom',
				location: 'remote',
			})
		}
	}

	const handleLocationChange = (value: 'remote' | 'local') => {
		setMapSource({
			...mapSource,
			location: value,
		})
	}

	const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setMapSource({
			...mapSource,
			url: e.target.value,
		})
	}

	const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			setMapSource({
				...mapSource,
				file,
			})
		}
	}

	const handleLayerToggle = (layerId: string, enabled: boolean) => {
		updateMapLayerState(layerId, { enabled })
	}

	const handleLayerOpacity = (layerId: string, opacity: number) => {
		updateMapLayerState(layerId, { opacity })
	}

	const handleDragStart = (index: number) => (e: React.DragEvent) => {
		setDragIndex(index)
		e.dataTransfer.effectAllowed = 'move'
		e.dataTransfer.setData('text/plain', String(index))
	}

	const handleDragOver = (index: number) => (e: React.DragEvent) => {
		e.preventDefault()
		e.dataTransfer.dropEffect = 'move'
		if (dragIndex !== null && dragIndex !== index) {
			setDropIndex(index)
		}
	}

	const handleDragLeave = () => {
		setDropIndex(null)
	}

	const handleDrop = (toIndex: number) => (e: React.DragEvent) => {
		e.preventDefault()
		const fromIndex = dragIndex
		if (fromIndex !== null && fromIndex !== toIndex) {
			reorderMapLayers(fromIndex, toIndex)
		}
		setDragIndex(null)
		setDropIndex(null)
	}

	const handleDragEnd = () => {
		setDragIndex(null)
		setDropIndex(null)
	}

	return (
		<div className="space-y-4">
			{/* Sessions Manager */}
			<SessionsManager />

			<Separator />

			<ChatSettingsSection />

			<Separator />

			{/* Map Source Settings */}
			<div className="space-y-2">
				<Label>Map Source</Label>
				<Select value={mapSource.type} onValueChange={handleSourceTypeChange}>
					<SelectTrigger>
						<SelectValue placeholder="Select source" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="default">Default (OpenFreeMap)</SelectItem>
						<SelectItem value="pmtiles">Protomaps (PMTiles)</SelectItem>
						<SelectItem value="blossom">Blossom Map Discovery</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{mapSource.type === 'pmtiles' && (
				<>
					<div className="space-y-2">
						<Label>Location</Label>
						<Select value={mapSource.location} onValueChange={handleLocationChange}>
							<SelectTrigger>
								<SelectValue placeholder="Select location" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="remote">Remote URL</SelectItem>
								<SelectItem value="local">Local File</SelectItem>
							</SelectContent>
						</Select>
					</div>

					{mapSource.location === 'remote' ? (
						<div className="space-y-2">
							<Label>URL</Label>
							<div className="flex gap-2">
								<Input
									value={mapSource.url || ''}
									onChange={handleUrlChange}
									placeholder="https://example.com/map.pmtiles"
									className="flex-1"
								/>
								{mapSource.url && (
									<Button
										variant="outline"
										size="icon"
										onClick={() => {
											if (!mapSource.url) return
											const url = mapSource.url
											const filename = url.split('/').pop() || 'map.pmtiles'
											const a = document.createElement('a')
											a.href = url
											a.download = filename
											a.target = '_blank'
											document.body.appendChild(a)
											a.click()
											document.body.removeChild(a)
										}}
										title="Download for offline use"
									>
										<Download className="h-4 w-4" />
									</Button>
								)}
							</div>
							<p className="text-xs text-gray-500">Enter the URL to a remote PMTiles file.</p>
						</div>
					) : (
						<div className="space-y-2">
							<Label>File</Label>
							<div className="flex gap-2">
								<Button
									variant="outline"
									className="w-full"
									onClick={() => fileInputRef.current?.click()}
								>
									{mapSource.file ? mapSource.file.name : 'Select File'}
								</Button>
								<input
									type="file"
									ref={fileInputRef}
									className="hidden"
									accept=".pmtiles"
									onChange={handleFileChange}
								/>
							</div>
							<p className="text-xs text-gray-500">
								Select a local .pmtiles file from your device.
							</p>
						</div>
					)}

					{/* Bounds Lock Option */}
					<div className="flex items-center gap-2 pt-2">
						<Checkbox
							id="bounds-lock"
							checked={mapSource.boundsLocked ?? true}
							onCheckedChange={(checked: boolean | 'indeterminate') =>
								setMapSource({
									...mapSource,
									boundsLocked: checked === true,
								})
							}
						/>
						<label htmlFor="bounds-lock" className="text-sm cursor-pointer">
							Lock to map bounds
						</label>
					</div>
					<p className="text-xs text-gray-500">
						Prevents zooming/panning beyond the PMTiles extent.
					</p>
				</>
			)}

			{mapSource.type === 'blossom' && (
				<>
					{/* Announcement Source Info */}
					{announcementSource && (
						<div className="rounded-lg border bg-card p-3 space-y-2">
							<div className="flex items-center gap-2">
								<Radio className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm font-medium">
									{announcementSource.name || 'Announcement Source'}
								</span>
							</div>
							{announcementSource.about && (
								<p className="text-xs text-muted-foreground pl-6">{announcementSource.about}</p>
							)}
							{announcementSource.pubkey && (
								<div className="flex items-center gap-1.5 pl-6">
									<Globe className="h-3 w-3 text-muted-foreground" />
									<UserProfile
										pubkey={announcementSource.pubkey}
										mode="avatar-name"
										size="xs"
										showNip05Badge={false}
										interactive={false}
									/>
								</div>
							)}
						</div>
					)}

					{/* Servers & Layers */}
					{layersByServer.length > 0 && (
						<div className="space-y-3">
							{layersByServer.map((group) => (
								<Collapsible key={group.server} defaultOpen className="pt-2 border-t">
									<CollapsibleTrigger className="flex items-center gap-2 w-full group cursor-pointer">
										<ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
										<Server className="h-3.5 w-3.5 text-muted-foreground" />
										<span className="text-xs text-muted-foreground font-mono truncate">
											{group.server}
										</span>
										<span className="text-xs text-muted-foreground ml-auto">
											{group.layers.length} {group.layers.length === 1 ? 'layer' : 'layers'}
										</span>
									</CollapsibleTrigger>
									<CollapsibleContent className="space-y-1 pt-2">
										{group.layers.map((layer) => (
											<div key={layer.id}>
												{/* Drop indicator line */}
												{dropIndex === layer.globalIndex &&
													dragIndex !== null &&
													dragIndex > layer.globalIndex && (
														<div className="h-0.5 bg-primary rounded-full mx-2 mb-1" />
													)}
												<li
													draggable
													aria-label={`Reorder layer ${layer.title}`}
													onDragStart={handleDragStart(layer.globalIndex)}
													onDragOver={handleDragOver(layer.globalIndex)}
													onDragLeave={handleDragLeave}
													onDrop={handleDrop(layer.globalIndex)}
													onDragEnd={handleDragEnd}
													className={`list-none rounded-lg border bg-card p-3 space-y-2 transition-opacity ${
														dragIndex === layer.globalIndex ? 'opacity-50' : ''
													}`}
												>
													<div className="flex items-center justify-between">
														<div className="flex items-center gap-2">
															<GripVertical className="h-4 w-4 text-muted-foreground cursor-grab active:cursor-grabbing" />
															<Checkbox
																id={`layer-${layer.id}`}
																checked={layer.enabled}
																onCheckedChange={(checked: boolean | 'indeterminate') =>
																	handleLayerToggle(layer.id, checked === true)
																}
															/>
															<label
																htmlFor={`layer-${layer.id}`}
																className="text-sm font-medium cursor-pointer"
															>
																{layer.title}
															</label>
														</div>
														<div className="flex items-center gap-1">
															{layer.enabled ? (
																<Eye className="h-3.5 w-3.5 text-muted-foreground" />
															) : (
																<EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
															)}
															<span className="text-xs text-muted-foreground capitalize px-1.5 py-0.5 rounded bg-muted">
																{layer.kind === 'chunked-vector'
																	? 'vector'
																	: layer.pmtilesType || 'raster'}
															</span>
														</div>
													</div>
													<div className="flex items-center gap-3 pl-6">
														<span className="text-xs text-muted-foreground w-14">Opacity</span>
														<Slider
															value={[layer.opacity]}
															onValueChange={(values: number[]) =>
																handleLayerOpacity(layer.id, values[0] ?? layer.opacity)
															}
															min={0}
															max={1}
															step={0.05}
															disabled={!layer.enabled}
															className="flex-1"
														/>
														<span className="text-xs text-muted-foreground w-10 text-right">
															{Math.round(layer.opacity * 100)}%
														</span>
													</div>
												</li>
												{/* Drop indicator line for after last item */}
												{dropIndex === layer.globalIndex &&
													dragIndex !== null &&
													dragIndex < layer.globalIndex && (
														<div className="h-0.5 bg-primary rounded-full mx-2 mt-1" />
													)}
											</div>
										))}
									</CollapsibleContent>
								</Collapsible>
							))}
						</div>
					)}

					{!announcementSource && mapLayers.length === 0 && (
						<div className="text-xs text-muted-foreground italic flex items-center gap-2 pt-2 border-t">
							<Radio className="h-4 w-4" />
							<span>Waiting for layer announcements...</span>
						</div>
					)}
				</>
			)}
		</div>
	)
}
