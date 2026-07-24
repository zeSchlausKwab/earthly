import {
	AlertTriangle,
	CheckCircle2,
	Download,
	HardDrive,
	Loader2,
	MapPinned,
	RefreshCw,
	ShieldCheck,
	Square,
	Trash2,
	X,
} from 'lucide-react'
import { use$ } from 'applesauce-react/hooks'
import type { NostrEvent } from 'nostr-tools'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { NativeAppDownloadLinks } from '@/components/NativeAppDownloadLinks'
import { config } from '@/config/env.client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { useEditorStore } from '@/features/geo-editor/store'
import { formatBytes } from '@/lib/blossom/blossomUpload'
import { eventStore, isEventDeleted } from '@/lib/nostr'
import { deletionTargetForEvent, deletionTargetsEvent } from '@/lib/nostr/deletionCache'
import {
	ARTICLE_KIND,
	GEO_COMMENT_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
	MAP_LAYER_SET_KIND,
	TEMPORAL_SIGHTING_KIND,
} from '@/lib/nostr/kinds'
import { readCachedMapLayerSet } from '@/lib/nostr/map-layer-set/cache'
import type { SavedRegion, SavedRegionProgress, SavedRegionService } from '@/platform/contracts'
import { getSavedRegionService, notifyLocalBlobsChanged } from '@/platform/registry'
import { planSavedRegion } from './planSavedRegion'
import { selectSavedRegionEvents, type SavedRegionEventSelection } from './selectSavedRegionEvents'
import { savedRegionStorageGuidance, type SavedRegionStorageGuidance } from './storageGuidance'
import { useSavedRegionDeletionSync } from './useSavedRegionDeletionSync'
import {
	setSavedRegionDeletionTargets,
	unregisterSavedRegionDeletionTargets,
	useSavedRegionHydration,
} from './useSavedRegionHydration'

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function progressValue(region: SavedRegion): number {
	if (region.bytesTotal && region.bytesTotal > 0) {
		return Math.min(100, (region.bytesDone / region.bytesTotal) * 100)
	}
	if (region.blobsTotal > 0) return Math.min(100, (region.blobsDone / region.blobsTotal) * 100)
	return 0
}

function mergeProgress(region: SavedRegion, progress: SavedRegionProgress): SavedRegion {
	if (region.id !== progress.regionId) return region
	return {
		...region,
		status: progress.status,
		bytesTotal: progress.bytesTotal,
		bytesDone: progress.bytesDone,
		blobsTotal: progress.blobsTotal,
		blobsDone: progress.blobsDone,
		lastError: progress.message,
	}
}

const SAVED_REGION_CANDIDATE_KINDS = [
	0,
	GEO_EVENT_KIND,
	GEO_COMMENT_KIND,
	MAP_CONTEXT_KIND,
	ARTICLE_KIND,
	TEMPORAL_SIGHTING_KIND,
]
const MAX_SAVED_REGION_CANDIDATES = 50_000

function selectContentForRegion(
	bbox: [number, number, number, number],
	source: { eventId: string | null; pubkey: string | null },
	includeEarthlyContent: boolean,
	candidateEvents: readonly NostrEvent[],
): SavedRegionEventSelection {
	const eventId = source.eventId
	const pubkey = source.pubkey
	if (candidateEvents.length > MAX_SAVED_REGION_CANDIDATES) {
		throw new Error('Too many loaded Earthly records to plan this area safely')
	}
	if (!eventId || !pubkey) throw new Error('The trusted map announcement is not available')
	const stored = eventStore.getEvent(eventId)
	const cached = readCachedMapLayerSet(config.trustedMapnoliaPubkeys)
	const announcement = stored?.id === eventId ? stored : cached?.id === eventId ? cached : null
	if (!announcement || announcement.kind !== MAP_LAYER_SET_KIND || announcement.pubkey !== pubkey) {
		throw new Error('Reload the trusted map announcement before saving this area')
	}
	if (isEventDeleted(announcement)) {
		throw new Error('The trusted map announcement was deleted; refresh map discovery')
	}
	const selection = selectSavedRegionEvents({
		bbox,
		events: includeEarthlyContent ? candidateEvents.filter((event) => !isEventDeleted(event)) : [],
		requiredEvents: [announcement],
	})
	if (selection.truncated) {
		throw new Error('This area contains too many Earthly records; save a smaller area')
	}
	return selection
}

function retainRelevantDeletionEvents(
	events: readonly NostrEvent[],
	deletions: readonly NostrEvent[],
): NostrEvent[] {
	const eventsByAuthor = new Map<string, NostrEvent[]>()
	for (const event of events) {
		const authored = eventsByAuthor.get(event.pubkey) ?? []
		authored.push(event)
		eventsByAuthor.set(event.pubkey, authored)
	}
	const relevant = new Map<string, NostrEvent>()
	for (const deletion of deletions) {
		if (
			eventsByAuthor.get(deletion.pubkey)?.some((target) => deletionTargetsEvent(deletion, target))
		) {
			relevant.set(deletion.id, deletion)
		}
	}
	return [
		...[...relevant.values()].sort(
			(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
		),
		...events,
	]
}

export function SavedRegionsSection() {
	const savedContentHydration = useSavedRegionHydration()
	const candidateEvents =
		use$(() => eventStore.timeline({ kinds: SAVED_REGION_CANDIDATE_KINDS }), []) ?? []
	const editor = useEditorStore((state) => state.editor)
	const mapAreaRect = useEditorStore((state) => state.mapAreaRect)
	const mapLayers = useEditorStore((state) => state.mapLayers)
	const source = useEditorStore((state) => state.announcementSource)
	const [service, setService] = useState<SavedRegionService | null>(null)
	const [regions, setRegions] = useState<SavedRegion[]>([])
	const [name, setName] = useState('Offline map')
	const [includeEarthlyContent, setIncludeEarthlyContent] = useState(true)
	const [bbox, setBbox] = useState<[number, number, number, number] | null>(null)
	const [operation, setOperation] = useState<string | null>('loading')
	const [storageGuidance, setStorageGuidance] = useState<SavedRegionStorageGuidance | null>(null)
	const sourceDeletionTargets = useMemo(
		() =>
			source?.pubkey && source.eventId ? [{ pubkey: source.pubkey, eventId: source.eventId }] : [],
		[source?.eventId, source?.pubkey],
	)
	const deletionCandidateSelection = useMemo(() => {
		if (!service?.supported || !bbox || !source?.trusted || !source.pubkey || !source.eventId) {
			return null
		}
		try {
			return selectContentForRegion(bbox, source, includeEarthlyContent, candidateEvents)
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error))
		}
	}, [bbox, candidateEvents, includeEarthlyContent, service?.supported, source])
	const deletionSync = useSavedRegionDeletionSync(
		deletionCandidateSelection && !(deletionCandidateSelection instanceof Error)
			? deletionCandidateSelection.events
			: [],
		Boolean(
			service?.supported &&
				source?.pubkey &&
				bbox &&
				!(deletionCandidateSelection instanceof Error),
		),
		sourceDeletionTargets,
	)
	const deletionsReady = deletionSync.ready
	const incompleteRegionIds = useMemo(
		() =>
			new Set(
				savedContentHydration.state === 'ready' ? savedContentHydration.incompleteRegionIds : [],
			),
		[savedContentHydration],
	)
	const deferredRegionIds = useMemo(
		() =>
			new Set(
				savedContentHydration.state === 'ready' ? savedContentHydration.deferredRegionIds : [],
			),
		[savedContentHydration],
	)

	const reportFailure = useCallback((error: unknown) => {
		const guidance = savedRegionStorageGuidance(error)
		if (guidance) {
			setStorageGuidance(guidance)
			toast.error(guidance.title)
			return
		}
		toast.error(errorMessage(error))
	}, [])

	const refresh = useCallback(
		async (nextService?: SavedRegionService) => {
			const activeService = nextService ?? service
			if (!activeService) return
			try {
				setRegions(await activeService.list())
			} catch (error) {
				toast.error(errorMessage(error))
			}
		},
		[service],
	)

	const captureCurrentView = useCallback(() => {
		const bounds = editor?.getMapBounds()
		if (!bounds) {
			toast.error('The map view is not ready yet')
			return
		}
		setBbox(bounds)
	}, [editor])

	useEffect(() => {
		let active = true
		let unlisten: (() => void) | undefined
		void getSavedRegionService().then(async (nextService) => {
			if (!active) return
			setService(nextService)
			try {
				setRegions(await nextService.list())
				unlisten = await nextService.listenProgress((progress) => {
					setRegions((current) => current.map((region) => mergeProgress(region, progress)))
					const guidance = progress.errorCode
						? savedRegionStorageGuidance(progress.errorCode)
						: null
					if (guidance) setStorageGuidance(guidance)
				})
			} catch (error) {
				toast.error(errorMessage(error))
			} finally {
				if (active) setOperation(null)
			}
		})
		return () => {
			active = false
			unlisten?.()
		}
	}, [])

	useEffect(() => {
		if (!bbox && editor) captureCurrentView()
	}, [bbox, editor, captureCurrentView])

	const layer = useMemo(
		() =>
			mapLayers.find(
				(candidate) =>
					candidate.enabled && candidate.kind === 'chunked-vector' && candidate.announcement,
			) ??
			mapLayers.find((candidate) => candidate.kind === 'chunked-vector' && candidate.announcement),
		[mapLayers],
	)

	const eventSelection = useMemo(() => {
		if (
			!service?.supported ||
			!deletionsReady ||
			!bbox ||
			!source?.trusted ||
			!source.pubkey ||
			!source.eventId
		)
			return null
		try {
			return selectContentForRegion(bbox, source, includeEarthlyContent, candidateEvents)
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error))
		}
	}, [bbox, candidateEvents, deletionsReady, includeEarthlyContent, service?.supported, source])

	const preview = useMemo(() => {
		if (!bbox || !layer || !source?.trusted || !source.pubkey || !source.eventId || !eventSelection)
			return null
		if (eventSelection instanceof Error) return eventSelection
		try {
			return planSavedRegion({
				id: 'preview',
				name,
				bbox,
				sourcePubkey: source.pubkey,
				announcementId: source.eventId,
				layer,
				events: retainRelevantDeletionEvents(eventSelection.events, deletionSync.deletions),
			})
		} catch (error) {
			return error instanceof Error ? error : new Error(String(error))
		}
	}, [bbox, deletionSync.deletions, eventSelection, layer, name, source])

	const download = useCallback(
		async (regionId: string) => {
			if (!service) return
			setOperation(regionId)
			try {
				const region = await service.download(regionId)
				setRegions((current) => [region, ...current.filter((item) => item.id !== region.id)])
				notifyLocalBlobsChanged(region.blobs.map((blob) => blob.sha256))
				setStorageGuidance(null)
				toast.success(`${region.name} is ready offline`)
			} catch (error) {
				reportFailure(error)
				await refresh()
			} finally {
				setOperation(null)
			}
		},
		[refresh, reportFailure, service],
	)

	const save = useCallback(async () => {
		if (!deletionsReady) {
			if (deletionSync.error) toast.error(deletionSync.error)
			else toast.info('Checking deleted Earthly records before saving')
			return
		}
		if (
			!service ||
			preview instanceof Error ||
			!preview ||
			!bbox ||
			!layer ||
			!source?.pubkey ||
			!source.eventId
		)
			return
		if (!name.trim()) {
			toast.error('Give this offline map a name')
			return
		}
		setOperation('create')
		try {
			const selectedEvents = selectContentForRegion(
				bbox,
				source,
				includeEarthlyContent,
				candidateEvents,
			)
			const retainedEvents = retainRelevantDeletionEvents(
				selectedEvents.events,
				deletionSync.deletions,
			)
			const plan = planSavedRegion({
				id: crypto.randomUUID(),
				name,
				bbox,
				sourcePubkey: source.pubkey,
				announcementId: source.eventId,
				layer,
				events: retainedEvents,
			})
			const region = await service.create(plan.request)
			setSavedRegionDeletionTargets(region.id, [
				{ pubkey: region.sourcePubkey, eventId: region.announcementId },
				...selectedEvents.events.map(deletionTargetForEvent),
			])
			setRegions((current) => [region, ...current])
			setOperation(null)
			await download(region.id)
		} catch (error) {
			reportFailure(error)
			setOperation(null)
		}
	}, [
		bbox,
		candidateEvents,
		deletionSync.deletions,
		deletionSync.error,
		deletionsReady,
		download,
		includeEarthlyContent,
		layer,
		name,
		preview,
		reportFailure,
		service,
		source,
	])

	const cancel = useCallback(
		async (regionId: string) => {
			if (!service) return
			try {
				await service.cancel(regionId)
			} catch (error) {
				toast.error(errorMessage(error))
			}
		},
		[service],
	)

	const remove = useCallback(
		async (region: SavedRegion) => {
			if (!service) return
			setOperation(`remove:${region.id}`)
			try {
				await service.remove(region.id)
				unregisterSavedRegionDeletionTargets(region.id)
				setRegions((current) => current.filter((item) => item.id !== region.id))
				toast.success(`${region.name} removed from saved regions`)
			} catch (error) {
				toast.error(errorMessage(error))
			} finally {
				setOperation(null)
			}
		},
		[service],
	)

	const repair = useCallback(
		async (region: SavedRegion) => {
			if (!service) return
			setOperation(`repair:${region.id}`)
			try {
				const repaired = await service.repair(region.id)
				setRegions((current) =>
					current.map((candidate) => (candidate.id === repaired.id ? repaired : candidate)),
				)
				notifyLocalBlobsChanged(repaired.blobs.map((blob) => blob.sha256))
				if (repaired.status === 'ready') {
					toast.success(`${repaired.name} passed its integrity check`)
				} else {
					toast.warning(`${repaired.name} needs missing files to be downloaded again`)
				}
			} catch (error) {
				toast.error(errorMessage(error))
				await refresh()
			} finally {
				setOperation(null)
			}
		},
		[refresh, service],
	)

	const cleanup = useCallback(async () => {
		if (!service) return
		setOperation('cleanup')
		try {
			const result = await service.collectGarbage()
			if (result.removedBlobs > 0) {
				setStorageGuidance(null)
				toast.success(
					`${result.removedBlobs} unused ${result.removedBlobs === 1 ? 'file' : 'files'} removed · ${formatBytes(result.reclaimedBytes)}`,
				)
			} else if (result.retainedBlobs > 0) {
				toast.info('Unused files are still referenced by a mirrored peer')
			} else {
				toast.info('Offline map storage is already tidy')
			}
		} catch (error) {
			toast.error(errorMessage(error))
		} finally {
			setOperation(null)
		}
	}, [service])

	if (service && !service.supported) {
		return (
			<section className="rounded-none border bg-card p-4">
				<div className="flex gap-3">
					<HardDrive className="mt-0.5 size-5 text-muted-foreground" />
					<div>
						<h3 className="font-semibold">Saved map regions</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							Downloadable map regions are available in the native Earthly apps. The browser keeps
							using streamed map tiles.
						</p>
						<NativeAppDownloadLinks />
					</div>
				</div>
			</section>
		)
	}

	return (
		<section className="space-y-3 rounded-none border bg-card p-4">
			<div className="flex items-start justify-between gap-3">
				<div className="flex gap-3">
					<div className="grid size-9 shrink-0 place-items-center bg-primary text-primary-foreground">
						<MapPinned className="size-5" />
					</div>
					<div>
						<h3 className="font-semibold">Saved map regions</h3>
						<p className="text-xs text-muted-foreground">
							Verified map files survive restarts and are used before network mirrors.
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onClick={() => void refresh()}
					aria-label="Refresh saved regions"
				>
					<RefreshCw className="size-4" />
				</Button>
			</div>

			{storageGuidance ? (
				<div className="space-y-1 border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
					<div className="flex items-center gap-2 font-semibold text-amber-800 dark:text-amber-300">
						<AlertTriangle className="size-4 shrink-0" />
						{storageGuidance.title}
					</div>
					<p className="pl-6 text-muted-foreground">{storageGuidance.detail}</p>
				</div>
			) : null}

			<div className="space-y-2 border-t pt-3">
				<Label htmlFor="saved-region-name">Area name</Label>
				<Input
					id="saved-region-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					maxLength={120}
					placeholder="Weekend hike"
				/>
				<div className="grid grid-cols-2 gap-2">
					<Button type="button" variant="outline" onClick={captureCurrentView}>
						<MapPinned className="size-4" /> Current view
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={!mapAreaRect}
						onClick={() => mapAreaRect && setBbox(mapAreaRect.bbox)}
					>
						<Square className="size-4" /> Drawn area
					</Button>
				</div>
				{bbox ? (
					<p className="font-mono text-[10px] text-muted-foreground">
						{bbox.map((value) => value.toFixed(3)).join(' · ')}
					</p>
				) : null}
				<label className="flex cursor-pointer items-start gap-3 border p-3">
					<input
						type="checkbox"
						checked={includeEarthlyContent}
						onChange={(event) => setIncludeEarthlyContent(event.target.checked)}
						className="mt-0.5"
					/>
					<span>
						<span className="block text-xs font-semibold">Include Earthly content</span>
						<span className="block text-[10px] leading-relaxed text-muted-foreground">
							Keep the datasets, groups, stories, sightings, comments, and contributor names
							currently loaded for this area.
						</span>
					</span>
				</label>
				{preview && !(preview instanceof Error) ? (
					<div className="space-y-1 border bg-muted/40 px-3 py-2 text-xs">
						<div className="flex items-center justify-between">
							<span>
								{preview.chunkCount} verified map files
								{preview.request.blobs.length > preview.chunkCount
									? ` · ${preview.request.blobs.length - preview.chunkCount} geometry files`
									: ''}
							</span>
							<strong>
								{preview.bytesTotal === null
									? 'Size calculated while downloading'
									: formatBytes(preview.bytesTotal)}
							</strong>
						</div>
						{eventSelection && !(eventSelection instanceof Error) ? (
							<div className="flex items-center justify-between text-muted-foreground">
								<span>
									{eventSelection.counts.total - eventSelection.counts.required} Earthly records
								</span>
								<span>{formatBytes(eventSelection.counts.bytesTotal)} metadata</span>
							</div>
						) : null}
					</div>
				) : (
					<div className="flex gap-2 border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
						<AlertTriangle className="size-4 shrink-0 text-amber-600" />
						<span>
							{preview instanceof Error
								? preview.message
								: 'Choose Blossom Map Discovery and wait for a trusted map announcement.'}
						</span>
					</div>
				)}
				{deletionSync.error ? (
					<p className="flex items-start gap-2 text-xs text-destructive">
						<AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {deletionSync.error}
					</p>
				) : !deletionsReady ? (
					<p className="flex items-center gap-2 text-xs text-muted-foreground">
						<Loader2 className="size-3.5 animate-spin" /> Checking deleted Earthly records…
					</p>
				) : null}
				<Button
					className="w-full"
					disabled={
						!service ||
						operation !== null ||
						!preview ||
						preview instanceof Error ||
						!deletionsReady
					}
					onClick={() => void save()}
				>
					{operation === 'create' ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Download className="size-4" />
					)}
					Save & download
				</Button>
			</div>

			{regions.length > 0 ? (
				<div className="space-y-2 border-t pt-3">
					<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
						On this device
					</p>
					{regions.map((region) => (
						<div key={region.id} className="space-y-2 border p-3">
							<div className="flex items-start justify-between gap-2">
								<div className="min-w-0">
									<p className="truncate text-sm font-semibold">{region.name}</p>
									<p className="text-xs text-muted-foreground">
										{region.blobsDone}/{region.blobsTotal} files
										{region.bytesTotal ? ` · ${formatBytes(region.bytesTotal)}` : ''}
									</p>
									<p className="text-[10px] text-muted-foreground">
										{deferredRegionIds.has(region.id)
											? 'Earthly content was not restored at startup to protect device memory'
											: incompleteRegionIds.has(region.id)
												? 'Some pinned records are missing · save this area again'
												: region.eventsCount > 1
													? `${region.eventsCount - 1} Earthly records kept offline`
													: region.eventsCount === 1
														? 'Map identity kept offline'
														: 'Legacy map · Earthly content not pinned'}
									</p>
								</div>
								<Badge
									variant={
										region.status === 'ready' &&
										!incompleteRegionIds.has(region.id) &&
										!deferredRegionIds.has(region.id)
											? 'default'
											: 'outline'
									}
									className="rounded-none"
								>
									{incompleteRegionIds.has(region.id) || deferredRegionIds.has(region.id) ? (
										<AlertTriangle className="mr-1 size-3 text-amber-600" />
									) : region.status === 'ready' ? (
										<CheckCircle2 className="mr-1 size-3" />
									) : null}
									{deferredRegionIds.has(region.id)
										? 'content deferred'
										: incompleteRegionIds.has(region.id)
											? 'content incomplete'
											: region.status}
								</Badge>
							</div>
							<Progress value={progressValue(region)} className="h-1.5 rounded-none" />
							{region.lastError ? (
								<p className="text-xs text-destructive">{region.lastError}</p>
							) : null}
							<div className="flex gap-2">
								{region.status === 'downloading' ? (
									<Button
										size="sm"
										variant="outline"
										className="flex-1"
										onClick={() => void cancel(region.id)}
									>
										<X className="size-4" /> Cancel
									</Button>
								) : region.status !== 'ready' ? (
									<Button
										size="sm"
										variant="outline"
										className="flex-1"
										disabled={operation !== null}
										onClick={() => void download(region.id)}
									>
										<Download className="size-4" /> Resume
									</Button>
								) : incompleteRegionIds.has(region.id) || deferredRegionIds.has(region.id) ? (
									<div className="flex flex-1 items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
										<AlertTriangle className="size-4" /> Map available · content not loaded
									</div>
								) : (
									<div className="flex flex-1 items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400">
										<CheckCircle2 className="size-4" /> Available without internet
									</div>
								)}
								<Button
									size="icon-sm"
									variant="ghost"
									disabled={region.status === 'downloading' || operation !== null}
									onClick={() => void repair(region)}
									aria-label={`Check ${region.name} offline files`}
								>
									{operation === `repair:${region.id}` ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<ShieldCheck className="size-4" />
									)}
								</Button>
								<Button
									size="icon-sm"
									variant="ghost"
									disabled={region.status === 'downloading' || operation !== null}
									onClick={() => void remove(region)}
									aria-label={`Remove ${region.name} from saved regions`}
								>
									{operation === `remove:${region.id}` ? (
										<Loader2 className="size-4 animate-spin" />
									) : (
										<Trash2 className="size-4" />
									)}
								</Button>
							</div>
						</div>
					))}
					<p className="text-[11px] text-muted-foreground">
						Removing a region also reclaims files downloaded solely for saved maps. Files used by
						another saved map or mirrored peer remain available.
					</p>
				</div>
			) : operation === 'loading' ? (
				<div className="flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
					<Loader2 className="size-4 animate-spin" /> Loading saved regions…
				</div>
			) : null}

			<Button
				type="button"
				variant="outline"
				size="sm"
				className="w-full"
				disabled={!service || operation !== null}
				onClick={() => void cleanup()}
			>
				{operation === 'cleanup' ? (
					<Loader2 className="size-4 animate-spin" />
				) : (
					<HardDrive className="size-4" />
				)}
				Clean unused files
			</Button>
		</section>
	)
}
