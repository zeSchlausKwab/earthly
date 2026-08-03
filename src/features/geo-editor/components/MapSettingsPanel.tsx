import { EventFactory } from 'applesauce-core/factories'
import { use$, useActiveAccount } from 'applesauce-react/hooks'
import { accounts, eventStore, publish } from '@/lib/nostr'

interface ProfileMetadata {
	name?: string
	displayName?: string
	display_name?: string
	about?: string
	website?: string
	nip05?: string
	image?: string
	picture?: string
	banner?: string
	lud16?: string
	[key: string]: unknown
}
import {
	ChevronDown,
	Download,
	Eye,
	EyeOff,
	Globe,
	GripVertical,
	HardDrive,
	Loader2,
	Radio,
	ShieldCheck,
	Server,
} from 'lucide-react'
import { FileSource } from 'pmtiles'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import { BASEMAP_STYLE_OPTIONS, useBasemapStyle } from '@/lib/basemap'
import { inspectPmtiles } from '@/lib/localPmtiles'
import { UserProfile } from '@/components/user-profile'
import { SessionsManager } from '@/features/auth/SessionsManager'
import { ChatSettingsSection } from '@/features/chat'
import { OfflineSharingSection } from '@/features/offline/OfflineSharingSection'
import { OfflineDiagnosticsSection } from '@/features/offline/OfflineDiagnosticsSection'
import { SavedRegionsSection } from '@/features/offline/saved-regions/SavedRegionsSection'
import { UserRelayManager } from '@/features/settings/UserRelayManager'
import { Badge } from '@/components/ui/badge'
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
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore, type MapLayerState, type SettingsTab } from '../store'

type MapSourceType = 'default' | 'pmtiles' | 'blossom'
type MapSettingsPanelMode = 'full' | 'map-only'

interface ProfileDraft {
	name: string
	displayName: string
	about: string
	website: string
	nip05: string
	image: string
	banner: string
	lud16: string
}

function createProfileDraft(profile?: ProfileMetadata | null): ProfileDraft {
	return {
		name: profile?.name ?? '',
		displayName: profile?.displayName ?? profile?.display_name ?? '',
		about: profile?.about ?? '',
		website: profile?.website ?? '',
		nip05: profile?.nip05 ?? '',
		image: profile?.image ?? profile?.picture ?? '',
		banner: profile?.banner ?? '',
		lud16: profile?.lud16 ?? '',
	}
}

function SettingsShell({
	title,
	description,
	children,
}: {
	title: string
	description: string
	children: React.ReactNode
}) {
	return (
		<section className="space-y-4 border border-border bg-card p-4 shadow-sm">
			<div className="space-y-1">
				<h3 className="text-sm font-semibold tracking-wide text-foreground uppercase">{title}</h3>
				<p className="text-sm text-muted-foreground">{description}</p>
			</div>
			{children}
		</section>
	)
}

function ProfileSettingsSection() {
	const currentUser = useActiveAccount()
	const [draft, setDraft] = useState<ProfileDraft>(() => createProfileDraft())
	const [hasLocalEdits, setHasLocalEdits] = useState(false)
	const [isSaving, setIsSaving] = useState(false)

	// Reactive read straight from the EventStore (auto-loads via the configured
	// event-loader) — no manual subscribe + useState copy that goes stale.
	const profileValue = use$(
		() => (currentUser?.pubkey ? eventStore.profile(currentUser.pubkey) : undefined),
		[currentUser?.pubkey],
	)
	const loadedProfile = (profileValue ?? null) as ProfileMetadata | null
	const isLoadingProfile = Boolean(currentUser?.pubkey) && profileValue === undefined

	const loadedDraft = useMemo(() => createProfileDraft(loadedProfile), [loadedProfile])
	const isDirty = JSON.stringify(draft) !== JSON.stringify(loadedDraft)

	useEffect(() => {
		if (!currentUser?.pubkey) {
			setDraft(createProfileDraft())
			setHasLocalEdits(false)
		}
	}, [currentUser?.pubkey])

	useEffect(() => {
		if (!hasLocalEdits) {
			setDraft(loadedDraft)
		}
	}, [hasLocalEdits, loadedDraft])

	const updateField =
		(field: keyof ProfileDraft) =>
		(event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
			const value = event.target.value
			setDraft((current) => ({ ...current, [field]: value }))
			setHasLocalEdits(true)
		}

	const handleUploadedField = useCallback((field: keyof Pick<ProfileDraft, 'image' | 'banner'>) => {
		return ({ url }: { url: string }) => {
			setDraft((current) => ({ ...current, [field]: url }))
			setHasLocalEdits(true)
		}
	}, [])

	const handleReset = () => {
		setDraft(loadedDraft)
		setHasLocalEdits(false)
	}

	const handleSave = async () => {
		const signer = accounts.signer
		if (!signer || !currentUser?.pubkey) {
			toast.error('Sign in to edit your profile')
			return
		}

		setIsSaving(true)
		try {
			const nextProfile: ProfileMetadata = {
				...(loadedProfile ?? {}),
				name: draft.name || undefined,
				displayName: draft.displayName || undefined,
				display_name: draft.displayName || undefined,
				about: draft.about || undefined,
				website: draft.website || undefined,
				nip05: draft.nip05 || undefined,
				image: draft.image || undefined,
				picture: draft.image || undefined,
				banner: draft.banner || undefined,
				lud16: draft.lud16 || undefined,
			}

			const signed = await EventFactory.fromKind(0)
				.content(JSON.stringify(nextProfile))
				.sign(signer)
			// publish() adds the event to the EventStore optimistically, so the
			// reactive use$ profile read above refreshes on its own.
			await publish(signed, { routing: 'outbox' })

			setDraft(createProfileDraft(nextProfile))
			setHasLocalEdits(false)
			toast.success('Profile saved')
		} catch (error) {
			console.error('Failed to save profile:', error)
			toast.error(error instanceof Error ? error.message : 'Failed to save profile')
		} finally {
			setIsSaving(false)
		}
	}

	if (!currentUser?.pubkey) {
		return (
			<SettingsShell
				title="Profile"
				description="Profile settings are tied to your active Nostr session."
			>
				<div className="border border-dashed border-border bg-muted px-4 py-6 text-sm text-muted-foreground">
					Sign in to edit your display name, bio, website, and Lightning address.
				</div>
			</SettingsShell>
		)
	}

	return (
		<SettingsShell
			title="Profile"
			description="Edit the metadata published on your kind 0 profile event."
		>
			<div className="border border-border bg-muted/50 p-4">
				<UserProfile
					pubkey={currentUser.pubkey}
					mode="full-profile"
					size="lg"
					showWebsite={false}
					interactive={false}
				/>
			</div>

			{isLoadingProfile ? (
				<div className="flex items-center gap-2 border border-border bg-muted px-3 py-2 text-sm text-muted-foreground">
					<Loader2 className="h-4 w-4 animate-spin" />
					Loading current profile...
				</div>
			) : null}

			<div className="grid gap-4 md:grid-cols-2">
				<div className="space-y-2">
					<Label htmlFor="profile-name">Name</Label>
					<Input id="profile-name" value={draft.name} onChange={updateField('name')} />
				</div>
				<div className="space-y-2">
					<Label htmlFor="profile-display-name">Display name</Label>
					<Input
						id="profile-display-name"
						value={draft.displayName}
						onChange={updateField('displayName')}
					/>
				</div>
				<div className="space-y-2 md:col-span-2">
					<Label htmlFor="profile-about">Bio</Label>
					<Textarea
						id="profile-about"
						value={draft.about}
						onChange={updateField('about')}
						placeholder="What are you publishing or working on?"
						className="min-h-24"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="profile-website">Website</Label>
					<Input
						id="profile-website"
						value={draft.website}
						onChange={updateField('website')}
						placeholder="https://example.com"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="profile-nip05">NIP-05</Label>
					<Input
						id="profile-nip05"
						value={draft.nip05}
						onChange={updateField('nip05')}
						placeholder="name@domain.com"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="profile-image">Avatar URL</Label>
					<div className="flex items-center gap-2">
						<Input
							id="profile-image"
							value={draft.image}
							onChange={updateField('image')}
							placeholder="https://..."
						/>
						<BlossomUploaderButton
							currentUrl={draft.image}
							onUploaded={handleUploadedField('image')}
							buttonLabel="Blossom"
						/>
					</div>
				</div>
				<div className="space-y-2">
					<Label htmlFor="profile-banner">Banner URL</Label>
					<div className="flex items-center gap-2">
						<Input
							id="profile-banner"
							value={draft.banner}
							onChange={updateField('banner')}
							placeholder="https://..."
						/>
						<BlossomUploaderButton
							currentUrl={draft.banner}
							onUploaded={handleUploadedField('banner')}
							buttonLabel="Blossom"
						/>
					</div>
				</div>
				<div className="space-y-2 md:col-span-2">
					<Label htmlFor="profile-lud16">Lightning address</Label>
					<Input
						id="profile-lud16"
						value={draft.lud16}
						onChange={updateField('lud16')}
						placeholder="name@domain.com"
					/>
				</div>
			</div>

			<div className="flex items-center justify-between gap-3 border border-border bg-muted px-3 py-2">
				<p className="text-xs text-muted-foreground">
					{isDirty ? 'You have unpublished profile changes.' : 'Profile metadata is up to date.'}
				</p>
				<div className="flex gap-2">
					<Button
						type="button"
						variant="outline"
						onClick={handleReset}
						disabled={!isDirty || isSaving}
					>
						Reset
					</Button>
					<Button type="button" onClick={() => void handleSave()} disabled={!isDirty || isSaving}>
						{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save profile'}
					</Button>
				</div>
			</div>
		</SettingsShell>
	)
}

export function MapSettingsPanel({ mode = 'full' }: { mode?: MapSettingsPanelMode }) {
	const currentUser = useActiveAccount()
	const mapSource = useEditorStore((state) => state.mapSource)
	const setMapSource = useEditorStore((state) => state.setMapSource)
	const pointClusteringEnabled = useEditorStore((state) => state.pointClusteringEnabled)
	const setPointClusteringEnabled = useEditorStore((state) => state.setPointClusteringEnabled)
	const calloutsEnabled = useEditorStore((state) => state.calloutsEnabled)
	const setCalloutsEnabled = useEditorStore((state) => state.setCalloutsEnabled)
	const geometryPointProxyEnabled = useEditorStore((state) => state.geometryPointProxyEnabled)
	const setGeometryPointProxyEnabled = useEditorStore((state) => state.setGeometryPointProxyEnabled)
	const mapLayers = useEditorStore((state) => state.mapLayers)
	const [basemapStyle, setBasemapStyle] = useBasemapStyle()
	const announcementSource = useEditorStore((state) => state.announcementSource)
	const updateMapLayerState = useEditorStore((state) => state.updateMapLayerState)
	const reorderMapLayers = useEditorStore((state) => state.reorderMapLayers)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const [dragIndex, setDragIndex] = useState<number | null>(null)
	const [dropIndex, setDropIndex] = useState<number | null>(null)

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
				localBlobHash: mapSource.localBlobHash,
				pmtilesKind: mapSource.pmtilesKind,
				boundsLocked: mapSource.boundsLocked,
			})
		} else if (value === 'blossom') {
			setMapSource({
				type: 'blossom',
				location: 'remote',
			})
		}
	}

	const handleLocationChange = (value: 'remote' | 'local') => {
		const keepNativeUrl = value === 'local' && Boolean(mapSource.localBlobHash)
		setMapSource({
			...mapSource,
			location: value,
			url: keepNativeUrl ? mapSource.url : undefined,
			file: value === 'local' ? mapSource.file : undefined,
			localBlobHash: keepNativeUrl ? mapSource.localBlobHash : undefined,
			pmtilesKind: keepNativeUrl ? mapSource.pmtilesKind : undefined,
		})
	}

	const handleUrlChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setMapSource({
			...mapSource,
			url: e.target.value,
			localBlobHash: undefined,
			pmtilesKind: undefined,
		})
	}

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return
		try {
			const inspected = await inspectPmtiles(new FileSource(file))
			setMapSource({
				...mapSource,
				file,
				url: undefined,
				localBlobHash: undefined,
				pmtilesKind: inspected.kind,
			})
		} catch (error) {
			e.currentTarget.value = ''
			toast.error(
				error instanceof Error ? error.message : 'That file is not a valid PMTiles archive',
			)
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

	const defaultTab: SettingsTab = currentUser ? 'profile' : 'chat'
	// Deep-link support: the status-bar relay indicator sets `settingsTab` in the
	// store before opening settings; land on that tab, then consume it once.
	const requestedTab = useEditorStore((state) => state.settingsTab)
	const setRequestedTab = useEditorStore((state) => state.setSettingsTab)
	const [activeTab, setActiveTab] = useState<SettingsTab>(requestedTab ?? defaultTab)
	useEffect(() => {
		if (requestedTab) {
			setActiveTab(requestedTab)
			setRequestedTab(null)
		}
	}, [requestedTab, setRequestedTab])
	const mapSettingsContent = (
		<div className="space-y-4">
			<div className="rounded-lg border bg-card p-3">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<Label htmlFor="map-callouts" className="text-sm font-medium">
							Map callouts
						</Label>
						<p className="text-xs text-muted-foreground">
							Show contextual cards authored directly on geometry.
						</p>
					</div>
					<Switch
						id="map-callouts"
						checked={calloutsEnabled}
						onCheckedChange={setCalloutsEnabled}
						aria-label="Toggle map callouts"
					/>
				</div>
			</div>

			<div className="rounded-lg border bg-card p-3">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<Label htmlFor="point-clustering" className="text-sm font-medium">
							Point clustering
						</Label>
						<p className="text-xs text-muted-foreground">
							Group nearby points into clusters while zoomed out.
						</p>
					</div>
					<Switch
						id="point-clustering"
						checked={pointClusteringEnabled}
						onCheckedChange={setPointClusteringEnabled}
						aria-label="Toggle point clustering"
					/>
				</div>
			</div>

			<div className="rounded-lg border bg-card p-3">
				<div className="flex items-start justify-between gap-4">
					<div className="space-y-1">
						<Label htmlFor="geometry-point-proxy" className="text-sm font-medium">
							Simplify tiny shapes to points
						</Label>
						<p className="text-xs text-muted-foreground">
							Replace polygons and lines that are only a few pixels on screen with a point marker
							while zoomed far out.
						</p>
					</div>
					<Switch
						id="geometry-point-proxy"
						checked={geometryPointProxyEnabled}
						onCheckedChange={setGeometryPointProxyEnabled}
						aria-label="Toggle tiny-shape point simplification"
					/>
				</div>
			</div>

			{/* Map source + basemap + overlay layers render in BOTH modes: the
			    desktop toolbar popover (map-only) and the full settings' Map tab —
			    the mobile sheet's only path to these controls. */}
			<>
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

				{mapSource.type === 'default' && (
					<div className="space-y-2">
						<Label>Basemap style</Label>
						<Select
							value={basemapStyle}
							onValueChange={(value) =>
								setBasemapStyle(value as (typeof BASEMAP_STYLE_OPTIONS)[number]['id'])
							}
						>
							<SelectTrigger>
								<SelectValue placeholder="Select basemap style" />
							</SelectTrigger>
							<SelectContent>
								{BASEMAP_STYLE_OPTIONS.map((option) => (
									<SelectItem key={option.id} value={option.id}>
										{option.label}
										{option.hint ? (
											<span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
												{option.hint}
											</span>
										) : null}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">
							<span className="font-mono">Auto</span> follows the app theme — Liberty in light, Dark
							in dark. Pin a style to keep it regardless of theme.
						</p>
					</div>
				)}

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
								<p className="text-xs text-muted-foreground">
									Enter the URL to a remote PMTiles file.
								</p>
							</div>
						) : (
							<div className="space-y-2">
								<Label>Offline archive</Label>
								{mapSource.localBlobHash ? (
									<div className="flex items-center gap-2 border border-border bg-muted/40 p-2.5">
										<HardDrive className="h-4 w-4 shrink-0 text-primary" />
										<div className="min-w-0 flex-1">
											<p className="text-xs font-medium text-foreground">Saved on this device</p>
											<p className="truncate font-mono text-[10px] text-muted-foreground">
												{mapSource.localBlobHash}
											</p>
										</div>
										<Badge variant="outline" className="rounded-[2px] capitalize">
											{mapSource.pmtilesKind ?? 'PMTiles'}
										</Badge>
									</div>
								) : null}
								<div className="flex gap-2">
									<Button
										variant="outline"
										className="w-full"
										onClick={() => fileInputRef.current?.click()}
									>
										{mapSource.file
											? mapSource.file.name
											: mapSource.localBlobHash
												? 'Choose another file'
												: 'Select file'}
									</Button>
									<Input
										type="file"
										ref={fileInputRef}
										className="hidden"
										accept=".pmtiles"
										onChange={(event) => void handleFileChange(event)}
									/>
								</div>
								<p className="text-xs text-muted-foreground">
									Mirrored native archives survive restart. Files chosen through the picker remain
									available only for this app session.
								</p>
							</div>
						)}

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
						<p className="text-xs text-muted-foreground">
							Prevents zooming and panning beyond the PMTiles extent.
						</p>
					</>
				)}
			</>

			{mapSource.type === 'blossom' && (
				<>
					{announcementSource && (
						<div className="space-y-2 border bg-card p-3">
							<div className="flex items-center gap-2">
								<Radio className="h-4 w-4 text-muted-foreground" />
								<span className="text-sm font-medium">
									{announcementSource.name || 'Announcement Source'}
								</span>
							</div>
							<div className="flex items-center gap-1.5 pl-6 text-xs text-emerald-700">
								<ShieldCheck className="h-3.5 w-3.5" />
								Trusted map publisher
							</div>
							{announcementSource.about && (
								<p className="pl-6 text-xs text-muted-foreground">{announcementSource.about}</p>
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

					{layersByServer.length > 0 && (
						<div className="space-y-3">
							{layersByServer.map((group) => (
								<Collapsible key={group.server} defaultOpen className="border-t pt-2">
									<CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2">
										<ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-data-[state=closed]:-rotate-90" />
										<Server className="h-3.5 w-3.5 text-muted-foreground" />
										<span className="truncate font-mono text-xs text-muted-foreground">
											{group.server}
										</span>
										<span className="ml-auto text-xs text-muted-foreground">
											{group.layers.length} {group.layers.length === 1 ? 'layer' : 'layers'}
										</span>
									</CollapsibleTrigger>
									<CollapsibleContent className="space-y-1 pt-2">
										{group.layers.map((layer) => (
											<div key={layer.id}>
												{dropIndex === layer.globalIndex &&
												dragIndex !== null &&
												dragIndex > layer.globalIndex ? (
													<div className="mx-2 mb-1 h-0.5 bg-primary" />
												) : null}
												<li
													draggable
													aria-label={`Reorder layer ${layer.title}`}
													onDragStart={handleDragStart(layer.globalIndex)}
													onDragOver={handleDragOver(layer.globalIndex)}
													onDragLeave={handleDragLeave}
													onDrop={handleDrop(layer.globalIndex)}
													onDragEnd={handleDragEnd}
													className={`list-none space-y-2 border bg-card p-3 transition-opacity ${
														dragIndex === layer.globalIndex ? 'opacity-50' : ''
													}`}
												>
													<div className="flex items-center justify-between">
														<div className="flex items-center gap-2">
															<GripVertical className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing" />
															<Checkbox
																id={`layer-${layer.id}`}
																checked={layer.enabled}
																onCheckedChange={(checked: boolean | 'indeterminate') =>
																	handleLayerToggle(layer.id, checked === true)
																}
															/>
															<label
																htmlFor={`layer-${layer.id}`}
																className="cursor-pointer text-sm font-medium"
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
															<span className="bg-muted px-1.5 py-0.5 text-xs capitalize text-muted-foreground">
																{layer.kind === 'chunked-vector'
																	? 'vector'
																	: layer.pmtilesType || 'raster'}
															</span>
														</div>
													</div>
													<div className="flex items-center gap-3 pl-6">
														<span className="w-14 text-xs text-muted-foreground">Opacity</span>
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
														<span className="w-10 text-right text-xs text-muted-foreground">
															{Math.round(layer.opacity * 100)}%
														</span>
													</div>
												</li>
												{dropIndex === layer.globalIndex &&
												dragIndex !== null &&
												dragIndex < layer.globalIndex ? (
													<div className="mx-2 mt-1 h-0.5 bg-primary" />
												) : null}
											</div>
										))}
									</CollapsibleContent>
								</Collapsible>
							))}
						</div>
					)}

					{!announcementSource && mapLayers.length === 0 ? (
						<div className="flex items-center gap-2 border-t pt-2 text-xs italic text-muted-foreground">
							<Radio className="h-4 w-4" />
							<span>Waiting for a trusted layer announcement...</span>
						</div>
					) : null}
				</>
			)}
		</div>
	)

	if (mode === 'map-only') {
		return mapSettingsContent
	}

	return (
		<Tabs
			value={activeTab}
			onValueChange={(value) => setActiveTab(value as SettingsTab)}
			className="space-y-4"
		>
			<h2 className="sr-only">Settings</h2>
			{/* One scrollable row: the base TabsList pins its height (h-8 via the
			    orientation variant), so wrapped grid rows overflow it — never wrap;
			    scroll horizontally instead when space runs out. */}
			<TabsList className="flex w-full justify-start gap-1 overflow-x-auto rounded-none bg-muted p-1">
				<TabsTrigger value="map" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Map
				</TabsTrigger>
				<TabsTrigger value="profile" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Profile
				</TabsTrigger>
				<TabsTrigger value="relays" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Relays
				</TabsTrigger>
				<TabsTrigger value="offline" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Offline
				</TabsTrigger>
				<TabsTrigger value="chat" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Chat
				</TabsTrigger>
				<TabsTrigger value="sessions" className="flex-none rounded-none px-3 text-xs sm:text-sm">
					Sessions
				</TabsTrigger>
			</TabsList>

			<TabsContent value="map" className="mt-0">
				<SettingsShell
					title="Map"
					description="Map source, basemap style, point clustering, and overlay layers."
				>
					{mapSettingsContent}
				</SettingsShell>
			</TabsContent>

			<TabsContent value="profile" className="mt-0">
				<ProfileSettingsSection />
			</TabsContent>

			<TabsContent value="relays" className="mt-0">
				<SettingsShell
					title="Relays"
					description="Manage the NIP-65 relay list used for account reads, writes, and discovery."
				>
					<UserRelayManager />
				</SettingsShell>
			</TabsContent>

			<TabsContent value="offline" className="mt-0">
				<SettingsShell
					title="Offline"
					description="Keep map areas on this device or pair nearby apps without internet access."
				>
					<div className="space-y-4">
						<SavedRegionsSection />
						<OfflineSharingSection />
						<OfflineDiagnosticsSection />
					</div>
				</SettingsShell>
			</TabsContent>

			<TabsContent value="chat" className="mt-0">
				<SettingsShell
					title="Chat settings"
					description="Choose providers, models, tools, and local chat behavior."
				>
					<ChatSettingsSection />
				</SettingsShell>
			</TabsContent>

			<TabsContent value="sessions" className="mt-0">
				<SettingsShell
					title="Sessions"
					description="Manage active accounts, imported keys, and local session persistence."
				>
					<SessionsManager />
				</SettingsShell>
			</TabsContent>
		</Tabs>
	)
}
