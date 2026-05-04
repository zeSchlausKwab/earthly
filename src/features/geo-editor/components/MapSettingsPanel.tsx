import { EventFactory } from 'applesauce-core/factories'
import { useActiveAccount } from 'applesauce-react/hooks'
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
	Loader2,
	Radio,
	Server,
} from 'lucide-react'
import type React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
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
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useEditorStore, type MapLayerState } from '../store'

type MapSourceType = 'default' | 'pmtiles' | 'blossom'
type SettingsTab = 'profile' | 'chat' | 'sessions'
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
		<section className="space-y-4 border border-slate-200 bg-white/90 p-4 shadow-sm">
			<div className="space-y-1">
				<h3 className="text-sm font-semibold tracking-wide text-slate-900 uppercase">{title}</h3>
				<p className="text-sm text-slate-500">{description}</p>
			</div>
			{children}
		</section>
	)
}

function ProfileSettingsSection() {
	const currentUser = useActiveAccount()
	const [loadedProfile, setLoadedProfile] = useState<ProfileMetadata | null>(null)
	const [draft, setDraft] = useState<ProfileDraft>(() => createProfileDraft())
	const [hasLocalEdits, setHasLocalEdits] = useState(false)
	const [isLoadingProfile, setIsLoadingProfile] = useState(false)
	const [isSaving, setIsSaving] = useState(false)

	const loadedDraft = useMemo(() => createProfileDraft(loadedProfile), [loadedProfile])
	const isDirty = JSON.stringify(draft) !== JSON.stringify(loadedDraft)

	useEffect(() => {
		if (!currentUser?.pubkey) {
			setLoadedProfile(null)
			setDraft(createProfileDraft())
			setHasLocalEdits(false)
			return
		}

		setIsLoadingProfile(true)

		// Subscribe to the active user's profile event in the EventStore. The
		// store auto-loads via the configured event-loader, so this fires once
		// the kind 0 lands (cached or freshly fetched).
		const sub = eventStore.profile(currentUser.pubkey).subscribe((profile) => {
			setLoadedProfile((profile ?? null) as ProfileMetadata | null)
			setIsLoadingProfile(false)
		})

		return () => sub.unsubscribe()
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
			await publish(signed, { routing: 'outbox' })

			setLoadedProfile(nextProfile)
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
				<div className="border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
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
			<div className="border border-slate-200 bg-slate-50/80 p-4">
				<UserProfile
					pubkey={currentUser.pubkey}
					mode="full-profile"
					size="lg"
					showWebsite={false}
					interactive={false}
				/>
			</div>

			{isLoadingProfile ? (
				<div className="flex items-center gap-2 border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
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

			<div className="flex items-center justify-between gap-3 border border-slate-200 bg-slate-50 px-3 py-2">
				<p className="text-xs text-slate-500">
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
	const mapLayers = useEditorStore((state) => state.mapLayers)
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

	const defaultTab: SettingsTab = currentUser ? 'profile' : 'chat'
	const mapSettingsContent = (
		<div className="space-y-4">
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

			{mode === 'map-only' && (
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
										<Input
											type="file"
											ref={fileInputRef}
											className="hidden"
											accept=".pmtiles"
											onChange={handleFileChange}
										/>
									</div>
									<p className="text-xs text-gray-500">
										Select a local `.pmtiles` file from your device.
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
							<p className="text-xs text-gray-500">
								Prevents zooming and panning beyond the PMTiles extent.
							</p>
						</>
					)}
				</>
			)}

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
							<span>Waiting for layer announcements...</span>
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
		<Tabs defaultValue={defaultTab} className="space-y-4">
			<TabsList className="grid h-auto w-full grid-cols-3 rounded-none bg-slate-100 p-1">
				<TabsTrigger value="profile" className="rounded-none px-3 py-2 text-xs sm:text-sm">
					Profile
				</TabsTrigger>
				<TabsTrigger value="chat" className="rounded-none px-3 py-2 text-xs sm:text-sm">
					Chat settings
				</TabsTrigger>
				<TabsTrigger value="sessions" className="rounded-none px-3 py-2 text-xs sm:text-sm">
					Sessions
				</TabsTrigger>
			</TabsList>

			<TabsContent value="profile" className="mt-0">
				<ProfileSettingsSection />
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
