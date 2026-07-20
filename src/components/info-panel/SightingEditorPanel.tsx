/**
 * SightingEditorPanel — the author-facing map-first create/edit surface for a
 * kind-37522 Temporal Sighting (NIP-52 time-bound observation with a NIP-40
 * expiry; Phase 11, SIGHT-01/02/03). The structural twin of `StoryEditorPanel`,
 * cloned for its shell/state/draft/submit spine — but a Sighting has NO Markdown
 * body and NO cover image, so the TipTap `GeoRichTextEditor` and the
 * `BlossomUploaderButton` are dropped.
 *
 * Three net-new form sections (no Story twin):
 *   (a) Observation time (D-03) — collapsed "Observed now" by default; an
 *       "Adjust time" affordance reveals `start` + optional "Until (optional)"
 *       `end` via the `@/components/ui/calendar` popover. Maps to content
 *       `start`/`end` (epoch seconds).
 *   (b) NIP-40 expiry preset (D-04) — a `RadioGroup` of 1 day / 1 week / 1 month
 *       / Never / Custom date, default "After 1 month". The chosen TTL is passed
 *       to `publishSighting` and is INDEPENDENT of the observation `end`
 *       (Pitfall P-4).
 *   (c) Group attach (SIGHT-02) — `GroupAttachField` drives `contextReferences()`
 *       (the `c` tag). The off-thread schema validator is warn-not-block; publish
 *       is NEVER disabled by the verdict (GROUP-04).
 * On mobile create, those three advanced decisions sit behind one `More options`
 * disclosure. Desktop and every edit flow stay expanded, and the canonical
 * `GroupAttachField` still owns the only publish action.
 *
 * The placed `geometry` arrives as a prop from the GeoEditorView pin-drop wiring
 * (D-01/D-02) and is stored into content on submit. Publish/edit goes through the
 * Plan-02 `publishSighting`/`editSighting` lifecycle service — NOT a re-inlined
 * factory — which re-derives the queryable `bbox`/`g` discovery tags from the
 * geometry on every publish (SIGHT-01) and preserves the `d`-tag on edit.
 *
 * Accent (`--primary`) is reserved per the UI-SPEC for the submit button and the
 * selected expiry preset ring only. Title/description render as escaped React
 * text nodes — NO `dangerouslySetInnerHTML` (T-11-03-01).
 */

import type { MediaAttachment } from 'applesauce-common/helpers/file-metadata'
import { castEvent } from 'applesauce-core/casts'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { Geometry, LineString, Point, Polygon } from 'geojson'
import { CalendarIcon, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { GroupAttachField } from '@/features/geo-editor/components/GroupAttachField'
import {
	MobilePanelHeaderActions,
	useMobilePanelHeaderActionTarget,
} from '@/features/geo-editor/components/MobilePanelHeaderAction'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { eventStore } from '@/lib/nostr'
import {
	NEW_SIGHTING_DRAFT_KEY,
	TemporalSighting,
	type TemporalSightingContent,
	clearSightingDraft,
	editSighting,
	getTemporalSightingContent,
	isTemporalSighting,
	publishSighting,
	readSightingDraft,
	writeSightingDraft,
} from '@/lib/nostr/temporal-sighting'

/** A placeable Sighting geometry (Point default; small Line/Polygon for an area). */
type SightingGeometry = Point | LineString | Polygon

/** NIP-40 expiry preset (D-04). The TTL is in seconds; `never`/`custom` are special. */
type ExpiryPreset = '1d' | '1w' | '1m' | 'never' | 'custom'

const EXPIRY_PRESETS: { value: ExpiryPreset; label: string; ttlSeconds: number | null }[] = [
	{ value: '1d', label: 'After 1 day', ttlSeconds: 86_400 },
	{ value: '1w', label: 'After 1 week', ttlSeconds: 7 * 86_400 },
	{ value: '1m', label: 'After 1 month', ttlSeconds: 30 * 86_400 },
	{ value: 'never', label: 'Never', ttlSeconds: null },
	{ value: 'custom', label: 'Custom date…', ttlSeconds: null },
]

/** Default preset is the conservative "After 1 month" (UI-SPEC; Open-Question Q-1). */
const DEFAULT_EXPIRY_PRESET: ExpiryPreset = '1m'

interface SightingEditorPanelProps {
	/** The Sighting being edited (published cast). Absent ⇒ create mode. */
	initialSighting?: TemporalSighting | null
	/**
	 * The geometry placed by the map-first pin-drop (D-01) for a NEW Sighting, or
	 * an updated geometry from the "Draw an area instead" affordance (D-02). When
	 * editing an existing Sighting this falls back to the stored content geometry.
	 */
	placedGeometry?: SightingGeometry | null
	/** Switch the create flow to line/polygon draw (D-02 "Draw an area instead"). */
	onDrawArea?: () => void
	onClose: () => void
	/** Returns the saved Sighting as a TemporalSighting cast. */
	onSave: (sighting: TemporalSighting) => void
}

/**
 * Pre-fill source for the editor fields. When editing a published Sighting, read
 * the content out of the raw event; otherwise fall back to the local draft (keyed
 * by the Sighting's `d`-tag, or the `new-sighting` sentinel for an unsaved create).
 */
function readInitialContent(initialSighting?: TemporalSighting | null): {
	title: string
	description: string
	start?: number
	end?: number
	geometry?: SightingGeometry
	contextRefs: string[]
	draftKey: string
} {
	const editedEvent = initialSighting?.rawEvent()
	if (editedEvent && isTemporalSighting(editedEvent)) {
		const content = getTemporalSightingContent(editedEvent)
		return {
			title: content.title ?? '',
			description: content.description ?? '',
			start: content.start,
			end: content.end,
			geometry: content.geometry,
			// Pre-fill the existing Group (`c`-tag) attachments so an edit preserves
			// them — without this, editSighting overwrites with [] and silently
			// drops every attachment (SIGHT-02 data loss). A draft-backed create has
			// no cast, so it falls through to the empty draft branch below.
			contextRefs: initialSighting?.contextReferences ?? [],
			draftKey: initialSighting?.dTag ?? NEW_SIGHTING_DRAFT_KEY,
		}
	}
	const draftKey = initialSighting?.dTag ?? NEW_SIGHTING_DRAFT_KEY
	const draft = readSightingDraft(draftKey)
	return {
		title: draft?.title ?? '',
		description: draft?.description ?? '',
		start: draft?.start,
		end: draft?.end,
		geometry: draft?.geometry as SightingGeometry | undefined,
		contextRefs: [],
		draftKey,
	}
}

/** Format an epoch-seconds timestamp as a short local date for the time popover. */
function formatEpochDate(epoch?: number): string {
	if (!epoch) return 'Pick a date'
	return new Date(epoch * 1000).toLocaleDateString()
}

/** Epoch seconds (UTC) for a JS Date at local midnight — the calendar's granularity. */
function dateToEpochSeconds(date: Date): number {
	return Math.floor(date.getTime() / 1000)
}

export function SightingEditorPanel({
	initialSighting,
	placedGeometry,
	onDrawArea,
	onClose,
	onSave,
}: SightingEditorPanelProps) {
	const currentUser = useActiveAccount()
	const isMobile = useIsMobile()
	const mobileHeaderActionTarget = useMobilePanelHeaderActionTarget()

	const initial = useMemo(() => readInitialContent(initialSighting), [initialSighting])
	// Editing a *published* Sighting switches the submit to "Save changes" and the
	// edit code path; a draft-backed create stays in publish mode.
	const isEditing = useMemo(() => {
		const event = initialSighting?.rawEvent()
		return Boolean(event && isTemporalSighting(event))
	}, [initialSighting])

	const [title, setTitle] = useState(initial.title)
	const [description, setDescription] = useState(initial.description)
	const [start, setStart] = useState<number | undefined>(initial.start)
	const [end, setEnd] = useState<number | undefined>(initial.end)
	const [timeExpanded, setTimeExpanded] = useState<boolean>(
		initial.start !== undefined || initial.end !== undefined,
	)
	const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>(DEFAULT_EXPIRY_PRESET)
	const [customExpiryEpoch, setCustomExpiryEpoch] = useState<number | undefined>(undefined)
	const [contextRefs, setContextRefs] = useState<string[]>(initial.contextRefs)
	// NIP-92 imeta attachments (SPEC §6.1). Order matters: images[0] is the
	// primary shown in the map pin bubble.
	const [images, setImages] = useState<MediaAttachment[]>(initialSighting?.images ?? [])
	// The active geometry: the freshly-placed prop wins; else the stored/draft one.
	const [geometry, setGeometry] = useState<SightingGeometry | undefined>(
		placedGeometry ?? initial.geometry,
	)
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const [advancedOpen, setAdvancedOpen] = useState(
		() =>
			isEditing ||
			initial.start !== undefined ||
			initial.end !== undefined ||
			initial.contextRefs.length > 0,
	)

	// Reset all fields when the edited Sighting changes.
	useEffect(() => {
		const next = readInitialContent(initialSighting)
		setTitle(next.title)
		setDescription(next.description)
		setStart(next.start)
		setEnd(next.end)
		setTimeExpanded(next.start !== undefined || next.end !== undefined)
		setExpiryPreset(DEFAULT_EXPIRY_PRESET)
		setCustomExpiryEpoch(undefined)
		setContextRefs(next.contextRefs)
		setImages(initialSighting?.images ?? [])
		setGeometry(next.geometry)
		setSaveError(null)
		setAdvancedOpen(
			isEditing ||
				next.start !== undefined ||
				next.end !== undefined ||
				next.contextRefs.length > 0,
		)
	}, [initialSighting, isEditing])

	// A freshly-placed geometry (pin-drop or area redraw) replaces the current one.
	useEffect(() => {
		if (placedGeometry) setGeometry(placedGeometry)
	}, [placedGeometry])

	const draftKey = initial.draftKey
	const advancedControlsVisible = !isMobile || isEditing || advancedOpen

	const hasPlacement = Boolean(geometry)
	const signerReady = Boolean(currentUser)

	const handleSaveDraft = () => {
		setSaveError(null)
		try {
			writeSightingDraft(draftKey, {
				title: title.trim() || undefined,
				description: description.trim() || undefined,
				start,
				end,
				geometry: geometry as Point | LineString | Polygon | undefined,
			})
		} catch {
			setSaveError("Couldn't save your draft locally. Your text is still here — try again.")
		}
	}

	/** Resolve the NIP-40 expiration epoch from the selected preset (independent of `end`). */
	const resolveExpiration = (): number | undefined => {
		if (expiryPreset === 'never') return undefined
		if (expiryPreset === 'custom') return customExpiryEpoch
		const preset = EXPIRY_PRESETS.find((option) => option.value === expiryPreset)
		if (!preset?.ttlSeconds) return undefined
		return Math.floor(Date.now() / 1000) + preset.ttlSeconds
	}

	const handleSave = async () => {
		if (!currentUser) return
		setSaveError(null)

		if (!title.trim()) {
			setSaveError('A title is required to publish.')
			return
		}
		if (!geometry) {
			setSaveError('Drop a pin on the map before publishing.')
			return
		}

		setIsSaving(true)
		try {
			const signer = currentUser
			const content: Partial<TemporalSightingContent> = {
				title: title.trim(),
				description: description.trim() || undefined,
				start,
				end,
				geometry: geometry as Geometry as Point | LineString | Polygon,
			}

			const options = {
				content,
				expiration: resolveExpiration(),
				groupCoords: contextRefs,
				images,
			}

			const editedEvent = initialSighting?.rawEvent()
			// publishSighting/editSighting (Plan 02) own the SIGHT-01 bbox/g re-derive
			// and the d-tag lineage — never re-inline TemporalSightingFactory here.
			const signed =
				editedEvent && isTemporalSighting(editedEvent)
					? await editSighting(editedEvent, options, signer)
					: await publishSighting(options, signer)

			clearSightingDraft(draftKey)
			const cast = castEvent(signed, TemporalSighting, eventStore)
			onSave(cast)
			onClose()
		} catch (error) {
			setSaveError(
				error instanceof Error && error.message === 'No active account'
					? error.message
					: "Couldn't publish your sighting. Check your connection and try again.",
			)
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<EntityPanelShell title={isEditing ? 'Edit Sighting' : 'New Sighting'}>
			<MobilePanelHeaderActions>
				<Button type="button" variant="ghost" size="sm" onClick={onClose}>
					Cancel
				</Button>
			</MobilePanelHeaderActions>
			<EntityPanelSurface tone="context" className="space-y-4">
				<EntityPanelSectionHeader
					eyebrow="Sighting"
					title="What did you see?"
					description="A placed, time-stamped observation that fades from the map when it's no longer relevant."
				/>
				<div className="space-y-2">
					<Label htmlFor="sighting-title">Title</Label>
					<Input
						id="sighting-title"
						value={title}
						onChange={(event) => setTitle(event.target.value)}
						placeholder="What did you see?"
						className="rounded-none"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="sighting-description">Description</Label>
					<Textarea
						id="sighting-description"
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="Add details — what, where exactly, anything notable…"
						rows={3}
						className="rounded-none"
					/>
				</div>
				<div className="space-y-2">
					<Label>Photos</Label>
					{images.length > 0 ? (
						<div className="grid grid-cols-3 gap-2">
							{images.map((image, index) => (
								<div key={image.url} className="group relative border border-border">
									<img
										src={image.url}
										alt={image.alt ?? `Photo ${index + 1}`}
										className="aspect-square w-full object-cover"
										loading="lazy"
									/>
									{index === 0 ? (
										<span className="absolute top-1 left-1 bg-primary px-1 text-[10px] font-medium text-primary-foreground">
											Primary
										</span>
									) : (
										<button
											type="button"
											className="absolute top-1 left-1 hidden bg-background/90 px-1 text-[10px] group-hover:block"
											onClick={() =>
												setImages((current) => [
													image,
													...current.filter((entry) => entry.url !== image.url),
												])
											}
										>
											Make primary
										</button>
									)}
									<button
										type="button"
										aria-label="Remove photo"
										className="absolute top-1 right-1 hidden bg-background/90 px-1 text-[10px] text-destructive group-hover:block"
										onClick={() =>
											setImages((current) => current.filter((entry) => entry.url !== image.url))
										}
									>
										✕
									</button>
								</div>
							))}
						</div>
					) : null}
					<BlossomUploaderButton
						accept="image/*"
						multiple
						buttonLabel={images.length > 0 ? 'Add another photo' : 'Add a photo'}
						buttonVariant="outline"
						buttonSize="sm"
						title="Add a photo"
						description="Select one or more photos. They upload to your Blossom server (defaults to blossom.earthly.city, images scaled to ≤1 MB). The first photo becomes the primary image."
						onUploaded={(result) =>
							setImages((current) => {
								if (current.some((entry) => entry.url === result.url)) return current
								return [
									...current,
									{
										url: result.url,
										type: result.mimeType,
										sha256: result.sha256,
										size: result.size,
									},
								]
							})
						}
					/>
					<p className="text-xs text-muted-foreground">
						The first photo is shown on the map, in lists, and in the sighting inspector.
					</p>
				</div>
				{!hasPlacement ? (
					<p className="text-xs text-destructive">Drop a pin on the map to place this sighting.</p>
				) : null}
				{onDrawArea ? (
					<button
						type="button"
						onClick={onDrawArea}
						className="text-left text-xs text-muted-foreground underline-offset-2 hover:underline"
					>
						Draw an area instead
					</button>
				) : null}
			</EntityPanelSurface>

			<Collapsible
				open={advancedControlsVisible}
				onOpenChange={isMobile && !isEditing ? setAdvancedOpen : undefined}
			>
				{isMobile && !isEditing ? (
					<EntityPanelSurface tone="neutral">
						<CollapsibleTrigger asChild>
							<button
								type="button"
								className="group flex min-h-11 w-full items-center gap-3 text-left"
							>
								<span className="flex size-8 shrink-0 items-center justify-center border border-border bg-muted/35 text-muted-foreground">
									<SlidersHorizontal className="size-4" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-semibold text-foreground">More options</span>
									<span className="block text-xs text-muted-foreground">
										Time, lifespan, and Context
									</span>
								</span>
								<ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
							</button>
						</CollapsibleTrigger>
					</EntityPanelSurface>
				) : null}

				<CollapsibleContent className="space-y-3">
					{/* ── Observation time (D-03) — collapsed "Observed now" by default ── */}
					<EntityPanelSurface tone="neutral" className="space-y-4">
						<EntityPanelSectionHeader eyebrow="When" title="Observation time" />
						{!timeExpanded ? (
							<div className="flex items-center justify-between gap-2">
								<span className="text-sm text-foreground">Observed now</span>
								<button
									type="button"
									onClick={() => setTimeExpanded(true)}
									className="text-xs text-muted-foreground underline-offset-2 hover:underline"
								>
									Adjust time
								</button>
							</div>
						) : (
							<div className="space-y-3">
								<div className="space-y-2">
									<Label>Observed</Label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												type="button"
												variant="outline"
												className="h-8 w-full justify-start gap-2 rounded-none text-[13px] font-normal"
											>
												<CalendarIcon className="size-3.5 opacity-60" />
												{formatEpochDate(start)}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto rounded-none p-0" align="start">
											<Calendar
												mode="single"
												selected={start ? new Date(start * 1000) : undefined}
												onSelect={(date) => setStart(date ? dateToEpochSeconds(date) : undefined)}
											/>
										</PopoverContent>
									</Popover>
								</div>
								<div className="space-y-2">
									<Label>Until (optional)</Label>
									<Popover>
										<PopoverTrigger asChild>
											<Button
												type="button"
												variant="outline"
												className="h-8 w-full justify-start gap-2 rounded-none text-[13px] font-normal"
											>
												<CalendarIcon className="size-3.5 opacity-60" />
												{formatEpochDate(end)}
											</Button>
										</PopoverTrigger>
										<PopoverContent className="w-auto rounded-none p-0" align="start">
											<Calendar
												mode="single"
												selected={end ? new Date(end * 1000) : undefined}
												onSelect={(date) => setEnd(date ? dateToEpochSeconds(date) : undefined)}
											/>
										</PopoverContent>
									</Popover>
								</div>
							</div>
						)}
					</EntityPanelSurface>

					{/* ── NIP-40 expiry preset (D-04) — default "After 1 month" ── */}
					<EntityPanelSurface tone="neutral" className="space-y-4">
						<EntityPanelSectionHeader eyebrow="Lifespan" title="Fade from map" />
						<RadioGroup
							value={expiryPreset}
							onValueChange={(value) => setExpiryPreset(value as ExpiryPreset)}
							className="gap-2"
						>
							{EXPIRY_PRESETS.map((preset) => {
								const selected = expiryPreset === preset.value
								return (
									<label
										key={preset.value}
										htmlFor={`expiry-${preset.value}`}
										className={
											selected
												? 'flex cursor-pointer items-center gap-2 border border-primary px-2 py-1.5 text-sm ring-1 ring-primary'
												: 'flex cursor-pointer items-center gap-2 border border-border px-2 py-1.5 text-sm'
										}
									>
										<RadioGroupItem id={`expiry-${preset.value}`} value={preset.value} />
										<span>{preset.label}</span>
									</label>
								)
							})}
						</RadioGroup>
						{expiryPreset === 'custom' ? (
							<Popover>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="outline"
										className="h-8 w-full justify-start gap-2 rounded-none text-[13px] font-normal"
									>
										<CalendarIcon className="size-3.5 opacity-60" />
										{formatEpochDate(customExpiryEpoch)}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-auto rounded-none p-0" align="start">
									<Calendar
										mode="single"
										selected={customExpiryEpoch ? new Date(customExpiryEpoch * 1000) : undefined}
										onSelect={(date) =>
											setCustomExpiryEpoch(date ? dateToEpochSeconds(date) : undefined)
										}
									/>
								</PopoverContent>
							</Popover>
						) : null}
					</EntityPanelSurface>
				</CollapsibleContent>
			</Collapsible>

			{/* ── Group attach (SIGHT-02) + submit. Publish NEVER disabled by verdict ── */}
			<EntityPanelSurface tone="neutral" className="space-y-3">
				{advancedControlsVisible ? (
					<EntityPanelSectionHeader eyebrow="Optional" title="Add to a Context (optional)" />
				) : null}
				{saveError && <p className="text-xs text-destructive">{saveError}</p>}
				<GroupAttachField
					contextRefs={contextRefs}
					onContextRefsChange={setContextRefs}
					featureProperties={[{}]}
					onPublish={handleSave}
					canPublish={hasPlacement && signerReady}
					isPublishing={isSaving}
					publishLabel={isEditing ? 'Save changes' : 'Publish Sighting'}
					showAttachmentControls={advancedControlsVisible}
					publishControlTarget={mobileHeaderActionTarget}
				/>
				<div className="flex flex-wrap items-center justify-end gap-2">
					<Button variant="outline" onClick={handleSaveDraft} className="rounded-none">
						Save draft
					</Button>
					{!mobileHeaderActionTarget ? (
						<Button variant="outline" onClick={onClose} className="rounded-none">
							Cancel
						</Button>
					) : null}
				</div>
			</EntityPanelSurface>
		</EntityPanelShell>
	)
}
