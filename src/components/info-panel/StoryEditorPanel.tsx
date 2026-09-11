/**
 * StoryEditorPanel — the author-facing create/edit surface for a kind-37520 Story
 * (NIP-23 long-form geo narrative; Phase 10, STORY-01/02/03/04). The structural
 * twin of `GroupEditorPanel`, copied wholesale with Article substituted for Group.
 *
 * Metadata block (Title `Input`, Summary `Textarea`, Cover image
 * `BlossomUploaderButton` + 16:9 preview) feeds NIP-23 `title`/`summary`/`image`.
 * The Markdown body is authored in the shared TipTap `GeoRichTextEditor` (its
 * built-in `@`-mention picker / `GeoMentionExtension` / `MediaExtensions` cover the
 * STORY-02 insert half — inline `nostr:naddr…` geo-refs and image/video embeds),
 * wrapped in a Write/Preview `Tabs` pair where Preview renders ONLY through the
 * sanitized `RichContentRenderer` exactly as readers see it (T-10-04: no raw HTML,
 * no inner-HTML injection sink).
 *
 * Publish/edit goes through the Plan-01 `publishStory`/`editStory` service — NOT a
 * re-inlined ArticleFactory — which destructively re-derives the queryable `a` tags
 * from the body's inline refs on every publish (STORY-03) and preserves the `d`-tag
 * lineage on edit (STORY-04). A local-first draft (`writeStoryDraft`/`readStoryDraft`/
 * `clearStoryDraft`) is saved before publish and cleared on publish.
 *
 * Accent (`--primary`) is reserved per the UI-SPEC for the submit button only
 * (Publish Story / Save changes).
 */

import { useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowDown,
	ArrowUp,
	Camera,
	Eye,
	EyeOff,
	Layers3,
	MessageSquare,
	Plus,
	RotateCcw,
	Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import { publishFailureMessage } from '@/features/geo-editor/hooks/publishFailure'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import {
	GeoRichTextEditor,
	type GeoFeatureItem,
	type GeoRichTextEditorRef,
	RichContentRenderer,
	type StoryViewCapture,
} from '@/components/editor'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { AspectRatio } from '@/components/ui/aspect-ratio'
import { Button } from '@/components/ui/button'
import {
	MobilePanelHeaderActions,
	useMobilePanelHeaderActionTarget,
} from '@/features/geo-editor/components/MobilePanelHeaderAction'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
	getStoryEditorOpenRequest,
	getStoryEditorTarget,
	subscribeStoryEditorOpenRequests,
} from '@/features/geo-editor/storyEditorBridge'
import { addTargetToActiveThread } from '@/features/chat/store'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import { useDraftPublishReview } from '@/features/geo-editor/hooks/useDraftPublishReview'
import { clearDraftReview, getDraftReviewRequest, subscribeDraftReview, registerStoryDraftDiscard, removeDraftEditingAccess } from '@/features/geo-editor/draftActions'
import { resolveLocalStoryDependencies } from '@/features/chat/referencePublishing/localStoryDependencies'
import { flushSync } from 'react-dom'
import { publishSavedStory, registerStoryPublicationEditor } from '@/features/geo-editor/storyPublication'
import { useRetainedEditorDraft } from '@/hooks/useRetainedEditorDraft'
import type { StoryViewDraftContext } from '@/components/editor/StoryViewDraftContext'
import { accounts } from '@/lib/nostr'
import { Article, type ArticleContent, getArticleContent, isArticle } from '@/lib/nostr/article'
import {
	authorizePresentationLayer,
	deriveStoryPresentationAuthorization,
	getUsableMapPresentation,
	parseMapPresentation,
	parseMapPresentationSource,
	type MapPresentationAuthorization,
	type MapPresentationLayerV1,
	type MapPresentationStyleOverrideV1,
	type MapPresentationV1,
	type StoryViewBlockV1,
	type StoryViewSnapshotV1,
	reduceStoryMarkdownViews,
} from '@/lib/map-presentation'
import { naddrToCoordinate, coordinateToNaddrReference } from '@/lib/nostr/references'
import {
	NEW_STORY_DRAFT_KEY,
	clearStoryDraft,
	getStoryProposalUnsupportedFields,
	proposeStoryEdit,
	readStoryDraft,
	writeStoryDraft,
} from '@/lib/nostr/story'

export interface StoryEditorPanelProps {
	/** The Story being edited (published Article cast). Absent ⇒ create mode. */
	initialStory?: Article | null
	onClose: () => void
	/** Returns the saved Story as an Article cast. */
	onSave: (story: Article) => void
	availableFeatures?: GeoFeatureItem[]
	/** Explicitly capture the shared canvas; never called from pan/zoom effects. */
	captureMapPresentation?: (
		authorization: MapPresentationAuthorization,
	) => MapPresentationV1 | null | undefined
	/** Explicit view-delta capture used by the editor's physical view block. */
	captureStoryView?: () => StoryViewCapture | null | undefined
	/** Clear an applied draft snapshot after discard or replacement of its content. */
	onStoryViewPreviewReset?: (draftKey: string) => void
	/** The actual mounted authoring surface, not merely a retained editor target. */
	onStoryEditorActiveChange?: (draftKey: string, active: boolean) => void
	onStoryViewActivate?: (
		snapshot: StoryViewSnapshotV1,
		index: number,
		draft?: StoryViewDraftContext,
	) => void
	renderStoryViewFigure?: (
		snapshot: StoryViewSnapshotV1,
		index: number,
		draft?: StoryViewDraftContext,
	) => ReactNode
}

/**
 * Pre-fill source for the editor fields. When editing a published Story, read the
 * NIP-23 content out of the raw event; otherwise fall back to the local draft (keyed
 * by the Story's `d`-tag, or the `new-story` sentinel for an unsaved create).
 */
function readInitialContent(initialStory?: Article | null): {
	title: string
	summary: string
	image: string
	body: string
	bodyTab: 'write' | 'preview'
	draftKey: string
	presentation?: unknown
} {
	const draftKey = initialStory?.dTag ?? getStoryEditorTarget()?.draftKey ?? NEW_STORY_DRAFT_KEY
	const draft = readStoryDraft(draftKey)
	if (draft) {
		return {
			title: draft.title ?? '',
			summary: draft.summary ?? '',
			image: draft.image ?? '',
			body: draft.content ?? '',
			bodyTab: draft.bodyTab ?? 'write',
			presentation: draft.presentation,
			draftKey,
		}
	}
	const editedEvent = initialStory?.rawEvent()
	if (editedEvent && isArticle(editedEvent)) {
		const content = getArticleContent(editedEvent)
		return {
			title: content.title ?? '',
			summary: content.summary ?? '',
			image: content.image ?? '',
			body: content.content ?? '',
			bodyTab: 'write',
			presentation: content.presentation,
			draftKey,
		}
	}
	return {
		title: '',
		summary: '',
		image: '',
		body: '',
		bodyTab: 'write',
		presentation: undefined,
		draftKey,
	}
}

interface StoryEditorDraftSnapshot {
	title: string
	summary: string
	image: string
	content: string
	bodyTab: 'write' | 'preview'
	presentation?: unknown
}

function storyDraftSnapshot(values: {
	title: string
	summary: string
	image: string
	body: string
	bodyTab: 'write' | 'preview'
	presentation?: unknown
}): StoryEditorDraftSnapshot {
	return {
		title: values.title,
		summary: values.summary,
		image: values.image,
		content: values.body,
		bodyTab: values.bodyTab,
		presentation: values.presentation,
	}
}

function persistStoryEditorDraft(identity: string, snapshot: StoryEditorDraftSnapshot): void {
	writeStoryDraft(identity, snapshot)
}

interface AuthorizedStorySourceOption {
	source: MapPresentationLayerV1['source']
	label: string
	featureIds?: readonly string[]
}

function stableLayerId(source: string, usedIds: ReadonlySet<string>): string {
	const parsed = parseMapPresentationSource(source)
	const stem =
		(parsed?.identifier ?? 'map')
			.toLowerCase()
			.replace(/[^a-z0-9._:-]+/gu, '-')
			.replace(/^[^a-z0-9]+/u, '')
			.slice(0, 80) || 'map'
	let candidate = stem
	let suffix = 2
	while (usedIds.has(candidate)) {
		candidate = `${stem}-${suffix}`
		suffix += 1
	}
	return candidate
}

function storySourceOptions(
	body: string,
	availableFeatures: GeoFeatureItem[],
): AuthorizedStorySourceOption[] {
	const authorization = deriveStoryPresentationAuthorization(body)
	const labels = new Map<string, string>()
	for (const item of availableFeatures) {
		if (!item.address.startsWith('naddr1')) continue
		const source = parseMapPresentationSource(naddrToCoordinate(item.address))?.coordinate
		if (!source || labels.has(source)) continue
		labels.set(source, item.datasetName || item.name)
	}
	return [...authorization.values()].map((grant) => {
		const parsed = parseMapPresentationSource(grant.source)
		return {
			source: grant.source,
			label: labels.get(grant.source) ?? parsed?.identifier ?? grant.source,
			...(grant.scope === 'features' ? { featureIds: grant.featureIds } : {}),
		}
	})
}

function withoutLayerStyle(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { style: _style, ...rest } = layer
	return rest
}

function withoutLayerFeatureIds(layer: MapPresentationLayerV1): MapPresentationLayerV1 {
	const { featureIds: _featureIds, ...rest } = layer
	return rest
}

function withoutInitialView(presentation: MapPresentationV1): MapPresentationV1 {
	const { initialView: _initialView, ...rest } = presentation
	return rest
}

function updateLayerStyle(
	layer: MapPresentationLayerV1,
	key: keyof MapPresentationStyleOverrideV1,
	value: string | number | boolean | undefined,
): MapPresentationLayerV1 {
	const style: Record<string, unknown> = { ...layer.style }
	if (value === undefined || value === '') delete style[key]
	else style[key] = value
	return Object.keys(style).length > 0
		? { ...layer, style: style as MapPresentationStyleOverrideV1 }
		: withoutLayerStyle(layer)
}

function StoryPresentationEditor({
	value,
	body,
	availableFeatures,
	onChange,
	captureMapPresentation,
}: {
	value: unknown
	body: string
	availableFeatures: GeoFeatureItem[]
	onChange: (value: unknown) => void
	captureMapPresentation?: StoryEditorPanelProps['captureMapPresentation']
}) {
	const [selectedSource, setSelectedSource] = useState('')
	const [captureError, setCaptureError] = useState<string | null>(null)
	const parsed = useMemo(() => parseMapPresentation(value), [value])
	const presentation = getUsableMapPresentation(parsed)
	const authorization = useMemo(() => deriveStoryPresentationAuthorization(body), [body])
	const options = useMemo(
		() => storySourceOptions(body, availableFeatures),
		[body, availableFeatures],
	)

	const acceptCaptured = (mode: 'all' | 'camera') => {
		const captured = captureMapPresentation?.(authorization)
		const result = parseMapPresentation(captured)
		const usable = getUsableMapPresentation(result)
		if (!usable || (result.status === 'valid' && result.issues.length > 0)) {
			setCaptureError('The current map could not be captured as a valid opening view.')
			return
		}
		if (mode === 'camera' && !usable.initialView) {
			setCaptureError('The map did not provide a camera position.')
			return
		}
		setCaptureError(null)
		if (mode === 'all') {
			onChange(usable)
			return
		}
		onChange({
			...(presentation ?? { version: 1 as const, layers: [] }),
			initialView: usable.initialView,
		})
	}

	if (!presentation) {
		const future = parsed.status === 'unsupported'
		const invalid =
			parsed.status === 'invalid' ||
			(parsed.status === 'valid' && parsed.issues.some((issue) => issue.path === '$.layers'))
		return (
			<div className="space-y-3">
				{future && (
					<p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
						This Story uses a newer opening-view format. It will be preserved unchanged unless you
						replace or remove it here.
					</p>
				)}
				{invalid && (
					<p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
						The stored opening view is malformed. Readers will use normal map framing until it is
						replaced.
					</p>
				)}
				{!future && !invalid && (
					<p className="text-xs text-muted-foreground">
						No authored opening view. Readers start with the referenced Maps framed normally.
					</p>
				)}
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						variant="outline"
						className="gap-1 rounded-none"
						onClick={() => onChange({ version: 1 as const, layers: [] })}
					>
						<Layers3 className="h-3.5 w-3.5" />
						Start empty
					</Button>
					<Button
						type="button"
						variant="outline"
						className="gap-1 rounded-none"
						onClick={() => acceptCaptured('all')}
						disabled={!captureMapPresentation}
					>
						<Camera className="h-3.5 w-3.5" />
						Use current map
					</Button>
					{(future || invalid) && (
						<Button
							type="button"
							variant="ghost"
							className="gap-1 rounded-none text-destructive"
							onClick={() => onChange(undefined)}
						>
							<Trash2 className="h-3.5 w-3.5" />
							Remove opening view
						</Button>
					)}
				</div>
				{captureError && <p className="text-xs text-destructive">{captureError}</p>}
			</div>
		)
	}

	const updateLayer = (index: number, layer: MapPresentationLayerV1) => {
		onChange({
			...presentation,
			layers: presentation.layers.map((entry, layerIndex) =>
				layerIndex === index ? layer : entry,
			),
		})
	}
	const addLayer = () => {
		const option = options.find((entry) => entry.source === selectedSource)
		if (!option) return
		const usedIds = new Set(presentation.layers.map((layer) => layer.id))
		onChange({
			...presentation,
			layers: [
				...presentation.layers,
				{
					id: stableLayerId(option.source, usedIds),
					source: option.source,
					...(option.featureIds ? { featureIds: [...option.featureIds] } : {}),
					visible: true,
					opacityMultiplier: 1,
				},
			],
		})
		setSelectedSource('')
	}

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/30 px-3 py-2">
				<div className="min-w-0">
					<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
						<Camera className="h-3.5 w-3.5 text-primary" />
						{presentation.initialView
							? `${presentation.initialView.center[1].toFixed(4)}, ${presentation.initialView.center[0].toFixed(4)} · zoom ${presentation.initialView.zoom.toFixed(1)}`
							: 'Opening camera not set'}
					</div>
					<p className="mt-1 text-[10px] text-muted-foreground">
						The camera changes only when you capture it explicitly.
					</p>
				</div>
				<div className="flex flex-wrap gap-1">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-7 gap-1 rounded-none px-2 text-[10px]"
						onClick={() => acceptCaptured('camera')}
						disabled={!captureMapPresentation}
					>
						<Camera className="h-3 w-3" />
						Capture camera
					</Button>
					{presentation.initialView && (
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="h-7 rounded-none px-2 text-[10px]"
							onClick={() => onChange(withoutInitialView(presentation))}
						>
							Clear
						</Button>
					)}
				</div>
			</div>

			<div className="space-y-2">
				<div className="flex items-center gap-2">
					<select
						value={selectedSource}
						onChange={(event) => setSelectedSource(event.target.value)}
						className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs text-foreground"
					>
						<option value="">Add a Map referenced in the body…</option>
						{options.map((option) => (
							<option key={option.source} value={option.source}>
								{option.label}
								{option.featureIds ? ` · ${option.featureIds.length} cited features` : ''}
							</option>
						))}
					</select>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 gap-1 rounded-none px-2 text-xs"
						onClick={addLayer}
						disabled={!selectedSource}
					>
						<Plus className="h-3.5 w-3.5" />
						Add layer
					</Button>
				</div>
				<p className="text-[10px] text-muted-foreground">
					The same Map may be added more than once with different features and styling.
				</p>
			</div>

			<div className="space-y-2">
				{presentation.layers.length === 0 && (
					<p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
						No opening layers yet. Add one after referencing its Map in the narrative.
					</p>
				)}
				{presentation.layers.map((layer, index) => {
					const grant = authorization.get(layer.source)
					const authorizationResult = authorizePresentationLayer(layer, authorization)
					const controlPrefix = `story-presentation-${index}`
					return (
						<div key={layer.id} className="space-y-3 border border-border bg-background px-3 py-2">
							<div className="flex items-start gap-2">
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									className="h-7 w-7 flex-shrink-0 rounded-none"
									onClick={() => updateLayer(index, { ...layer, visible: !layer.visible })}
									aria-label={layer.visible ? 'Hide layer at open' : 'Show layer at open'}
								>
									{layer.visible ? (
										<Eye className="h-3.5 w-3.5" />
									) : (
										<EyeOff className="h-3.5 w-3.5" />
									)}
								</Button>
								<div className="min-w-0 flex-1">
									<Input
										value={layer.id}
										onChange={(event) => updateLayer(index, { ...layer, id: event.target.value })}
										className="h-7 rounded-none font-mono text-xs"
										aria-label="Stable presentation layer id"
									/>
									<p
										className="mt-1 truncate font-mono text-[9px] text-muted-foreground"
										title={layer.source}
									>
										{layer.source}
									</p>
								</div>
								<div className="flex flex-shrink-0 items-center gap-0.5">
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										disabled={index === 0}
										onClick={() => {
											const layers = [...presentation.layers]
											const current = layers[index]
											const previous = layers[index - 1]
											if (!current || !previous) return
											layers[index - 1] = current
											layers[index] = previous
											onChange({ ...presentation, layers })
										}}
										aria-label="Move layer down"
									>
										<ArrowUp className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none"
										disabled={index === presentation.layers.length - 1}
										onClick={() => {
											const layers = [...presentation.layers]
											const current = layers[index]
											const next = layers[index + 1]
											if (!current || !next) return
											layers[index] = next
											layers[index + 1] = current
											onChange({ ...presentation, layers })
										}}
										aria-label="Move layer up"
									>
										<ArrowDown className="h-3.5 w-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										className="h-7 w-7 rounded-none text-muted-foreground hover:text-destructive"
										onClick={() =>
											onChange({
												...presentation,
												layers: presentation.layers.filter((_, layerIndex) => layerIndex !== index),
											})
										}
										aria-label="Remove layer"
									>
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							</div>

							{authorizationResult.status !== 'authorized' && (
								<p className="border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-foreground">
									This layer is outside the Story body's current reference scope and cannot be
									published.
								</p>
							)}

							<div className="grid gap-3 sm:grid-cols-2">
								<label className="space-y-1 text-[10px] text-muted-foreground">
									<span className="flex items-center justify-between">
										Opacity <span className="font-mono">{layer.opacityMultiplier.toFixed(2)}</span>
									</span>
									<input
										type="range"
										min="0"
										max="1"
										step="0.05"
										value={layer.opacityMultiplier}
										onChange={(event) =>
											updateLayer(index, {
												...layer,
												opacityMultiplier: Number(event.target.value),
											})
										}
										className="w-full"
									/>
								</label>
								<label className="space-y-1 text-[10px] text-muted-foreground">
									<span>Feature scope</span>
									<select
										value={layer.featureIds === undefined ? 'whole' : 'features'}
										disabled={grant?.scope === 'features'}
										onChange={(event) =>
											updateLayer(
												index,
												event.target.value === 'whole'
													? withoutLayerFeatureIds(layer)
													: { ...layer, featureIds: [] },
											)
										}
										className="h-8 w-full border border-border bg-background px-2 text-xs text-foreground"
									>
										<option value="whole">Whole Map</option>
										<option value="features">Selected features</option>
									</select>
								</label>
							</div>
							{layer.featureIds !== undefined && (
								<Label
									htmlFor={`${controlPrefix}-features`}
									className="block space-y-1 text-[10px] font-normal text-muted-foreground"
								>
									<span>Feature ids, separated by commas or new lines</span>
									<Textarea
										id={`${controlPrefix}-features`}
										value={layer.featureIds.join(', ')}
										onChange={(event) =>
											updateLayer(index, {
												...layer,
												featureIds: event.target.value
													.split(/[\n,]/u)
													.map((id) => id.trim())
													.filter(Boolean),
											})
										}
										rows={2}
										className="rounded-none font-mono text-xs"
									/>
								</Label>
							)}

							<details className="border-t border-border pt-2">
								<summary className="flex cursor-pointer list-none items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
									<Layers3 className="h-3 w-3" /> Style override
								</summary>
								<div className="mt-2 grid gap-2 sm:grid-cols-3">
									{(['color', 'fillColor', 'strokeColor'] as const).map((key) => (
										<Label
											key={key}
											htmlFor={`${controlPrefix}-${key}`}
											className="space-y-1 text-[9px] font-normal text-muted-foreground"
										>
											<span>{key}</span>
											<Input
												id={`${controlPrefix}-${key}`}
												value={layer.style?.[key] ?? ''}
												onChange={(event) =>
													updateLayer(
														index,
														updateLayerStyle(layer, key, event.target.value || undefined),
													)
												}
												placeholder="author style"
												className="h-7 rounded-none px-2 text-[10px]"
											/>
										</Label>
									))}
									{(['fillOpacity', 'strokeOpacity', 'strokeWidth', 'radius'] as const).map(
										(key) => (
											<Label
												key={key}
												htmlFor={`${controlPrefix}-${key}`}
												className="space-y-1 text-[9px] font-normal text-muted-foreground"
											>
												<span>{key}</span>
												<Input
													id={`${controlPrefix}-${key}`}
													type="number"
													step={key.includes('Opacity') ? '0.05' : '0.5'}
													min={key.includes('Opacity') ? '0' : '0.1'}
													max={key.includes('Opacity') ? '1' : undefined}
													value={layer.style?.[key] ?? ''}
													onChange={(event) =>
														updateLayer(
															index,
															updateLayerStyle(
																layer,
																key,
																event.target.value === '' ? undefined : Number(event.target.value),
															),
														)
													}
													className="h-7 rounded-none px-2 text-[10px]"
												/>
											</Label>
										),
									)}
									<label className="space-y-1 text-[9px] text-muted-foreground">
										<span>lineDash</span>
										<select
											value={layer.style?.lineDash ?? ''}
											onChange={(event) =>
												updateLayer(
													index,
													updateLayerStyle(layer, 'lineDash', event.target.value || undefined),
												)
											}
											className="h-7 w-full border border-border bg-background px-2 text-[10px] text-foreground"
										>
											<option value="">author style</option>
											<option value="solid">solid</option>
											<option value="dashed">dashed</option>
											<option value="dotted">dotted</option>
										</select>
									</label>
									{(['arrowStart', 'arrowEnd'] as const).map((key) => (
										<label key={key} className="space-y-1 text-[9px] text-muted-foreground">
											<span>{key}</span>
											<select
												value={layer.style?.[key] === undefined ? '' : String(layer.style[key])}
												onChange={(event) =>
													updateLayer(
														index,
														updateLayerStyle(
															layer,
															key,
															event.target.value === '' ? undefined : event.target.value === 'true',
														),
													)
												}
												className="h-7 w-full border border-border bg-background px-2 text-[10px] text-foreground"
											>
												<option value="">author style</option>
												<option value="true">on</option>
												<option value="false">off</option>
											</select>
										</label>
									))}
									<Label
										htmlFor={`${controlPrefix}-displayIcon`}
										className="space-y-1 text-[9px] font-normal text-muted-foreground sm:col-span-2"
									>
										<span>displayIcon</span>
										<Input
											id={`${controlPrefix}-displayIcon`}
											value={layer.style?.displayIcon ?? ''}
											onChange={(event) =>
												updateLayer(
													index,
													updateLayerStyle(layer, 'displayIcon', event.target.value || undefined),
												)
											}
											placeholder="lucide:map-pin"
											className="h-7 rounded-none px-2 font-mono text-[10px]"
										/>
									</Label>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-7 gap-1 self-end rounded-none text-[10px]"
										onClick={() => updateLayer(index, withoutLayerStyle(layer))}
										disabled={!layer.style}
									>
										<RotateCcw className="h-3 w-3" /> Use author styling
									</Button>
								</div>
							</details>
						</div>
					)
				})}
			</div>

			{parsed.status === 'valid' && parsed.issues.length > 0 && (
				<div className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[10px] text-foreground">
					{parsed.issues.map((issue) => `${issue.path}: ${issue.message}`).join(' ')}
				</div>
			)}
			{captureError && <p className="text-xs text-destructive">{captureError}</p>}
			<div className="flex flex-wrap justify-between gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-1 rounded-none"
					onClick={() => acceptCaptured('all')}
					disabled={!captureMapPresentation}
				>
					<Camera className="h-3.5 w-3.5" /> Replace from current map
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="gap-1 rounded-none text-destructive"
					onClick={() => onChange(undefined)}
				>
					<Trash2 className="h-3.5 w-3.5" /> Remove opening view
				</Button>
			</div>
		</div>
	)
}

export function StoryEditorPanel({
	initialStory,
	onClose,
	onSave,
	availableFeatures = [],
	captureMapPresentation,
	captureStoryView,
	onStoryViewPreviewReset,
	onStoryEditorActiveChange,
	onStoryViewActivate,
	renderStoryViewFigure,
}: StoryEditorPanelProps) {
	const currentUser = useActiveAccount()
	const mobileHeaderActionTarget = useMobilePanelHeaderActionTarget()
	const bodyEditorRef = useRef<GeoRichTextEditorRef>(null)

	const selectedDraftKey = useSyncExternalStore(subscribeStoryEditorOpenRequests, () => getStoryEditorTarget()?.draftKey ?? null, () => null)
	const initial = useMemo(() => readInitialContent(initialStory), [initialStory, selectedDraftKey])
	// Editing a *published* Article switches the submit to "Save changes" and the
	// edit code path; a draft-backed create stays in publish mode.
	const isEditing = useMemo(() => {
		const event = initialStory?.rawEvent()
		return Boolean(event && isArticle(event))
	}, [initialStory])
	const isProposal = isEditing && currentUser?.pubkey !== initialStory?.pubkey
	const publishedContent = useMemo(() => {
		const event = initialStory?.rawEvent()
		return event && isArticle(event) ? getArticleContent(event) : undefined
	}, [initialStory])

	const [title, setTitle] = useState(initial.title)
	const [summary, setSummary] = useState(initial.summary)
	const [image, setImage] = useState(initial.image)
	const [body, setBody] = useState(initial.body)
	const [bodyTab, setBodyTab] = useState<'write' | 'preview'>(initial.bodyTab)
	const [presentation, setPresentation] = useState<unknown>(initial.presentation)
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	// Controlled inputs represent absent optional strings as ''. Map unchanged
	// values back to their exact source representation; proposals do not trim or
	// otherwise normalize metadata that the body-only protocol cannot carry.
	const proposalContent: ArticleContent = {
		title: title === (publishedContent?.title ?? '') ? publishedContent?.title : title,
		summary: summary === (publishedContent?.summary ?? '') ? publishedContent?.summary : summary,
		image: image === (publishedContent?.image ?? '') ? publishedContent?.image : image,
		presentation,
		content: body,
	}
	const proposalMetadataChanged =
		isProposal &&
		getStoryProposalUnsupportedFields(publishedContent ?? {}, proposalContent).length > 0
	const submitLabel = isSaving
		? isProposal
			? 'Sending…'
			: 'Publishing…'
		: isProposal
			? 'Send proposal'
			: isEditing
				? 'Save changes'
				: 'Publish Story'
	const openingPresentation = useMemo(
		() => getUsableMapPresentation(parseMapPresentation(presentation)),
		[presentation],
	)
	const viewReduction = useMemo(() => {
		const base = openingPresentation ?? { version: 1 as const, layers: [] }
		return reduceStoryMarkdownViews(base, body)
	}, [body, openingPresentation])
	const activateStoryView = (view: StoryViewBlockV1, index?: number) => {
		if (view.display === 'figure') {
			setBodyTab('preview')
			return
		}
		const snapshot =
			index === undefined
				? viewReduction.snapshots.find((entry) => entry.view.id === view.id)
				: viewReduction.snapshots[index]
		if (!snapshot) return
		const resolvedIndex = index ?? viewReduction.snapshots.indexOf(snapshot)
		onStoryViewActivate?.(snapshot, resolvedIndex, { body, draftKey: initial.draftKey })
	}
	const draftKey = initial.draftKey
	const loadedStoryRef = useRef({
		draftKey,
		eventId: initialStory?.rawEvent().id ?? null,
	})
	useEffect(() => {
		onStoryEditorActiveChange?.(draftKey, true)
		return () => onStoryEditorActiveChange?.(draftKey, false)
	}, [draftKey, onStoryEditorActiveChange])
	const draftSnapshot = useMemo(
		() => storyDraftSnapshot({ title, summary, image, body, bodyTab, presentation }),
		[title, summary, image, body, bodyTab, presentation],
	)
	const draftSignature = useMemo(() => JSON.stringify(draftSnapshot), [draftSnapshot])
	const cleanDraftSignatureRef = useRef(
		JSON.stringify(storyDraftSnapshot({ ...initial, bodyTab: initial.bodyTab })),
	)
	const { setDirty, persistNow, clearRetainedDraft } = useRetainedEditorDraft({
		identity: draftKey,
		snapshot: draftSnapshot,
		persist: persistStoryEditorDraft,
		clear: clearStoryDraft,
	})

	// Reset only for a genuinely replaced Story/revision, not a recreated Article
	// wrapper or an unrelated parent render. The mounted create slot starts from state.
	useEffect(() => {
		const previous = loadedStoryRef.current
		const eventId = initialStory?.rawEvent().id ?? null
		if (previous.draftKey === draftKey && previous.eventId === eventId) return
		loadedStoryRef.current = { draftKey, eventId }
		onStoryViewPreviewReset?.(previous.draftKey)
		const next = readInitialContent(initialStory)
		cleanDraftSignatureRef.current = JSON.stringify(storyDraftSnapshot(next))
		setTitle(next.title)
		setSummary(next.summary)
		setImage(next.image)
		setBody(next.body)
		bodyEditorRef.current?.setContent(next.body)
		setBodyTab(next.bodyTab)
		setPresentation(next.presentation)
		setSaveError(null)
	}, [draftKey, initialStory, onStoryViewPreviewReset])

	// Chat seam (storyEditorBridge): re-run pre-fill when AI writes either the
	// new-story slot or the d-tag slot of the published Story already being edited.
	useEffect(() => {
		return subscribeStoryEditorOpenRequests(() => {
			const request = getStoryEditorOpenRequest()
			if (initialStory) {
				if (
					request?.mode !== 'edit' ||
					request.story?.dTag !== initialStory.dTag ||
					request.story?.pubkey !== initialStory.pubkey
				) {
					return
				}
			} else if (request?.mode !== 'create') {
				return
			}
			const next = readInitialContent(initialStory)
			onStoryViewPreviewReset?.(next.draftKey)
			cleanDraftSignatureRef.current = JSON.stringify(storyDraftSnapshot(next))
			setTitle(next.title)
			setSummary(next.summary)
			setImage(next.image)
			setBody(next.body)
			bodyEditorRef.current?.setContent(next.body)
			setBodyTab(next.bodyTab)
			setPresentation(next.presentation)
			setSaveError(null)
		})
	}, [initialStory, onStoryViewPreviewReset])

	useEffect(() => {
		setDirty(draftSignature !== cleanDraftSignatureRef.current)
	}, [draftSignature, setDirty])
	useEffect(() => {
		if (draftSignature === cleanDraftSignatureRef.current && !readStoryDraft(draftKey)) return
		// Keep the chat's publication status in sync while this form is mounted.
		const timer = setTimeout(persistNow, 250)
		return () => clearTimeout(timer)
	}, [draftKey, draftSignature, persistNow])

	const handleSaveDraft = () => {
		setSaveError(null)
		try {
			persistNow()
			cleanDraftSignatureRef.current = draftSignature
		} catch {
			setSaveError("Couldn't save your draft locally. Your text is still here — try again.")
		}
	}

	const handleDiscardDraft = () => {
		const discarded = storyDraftSnapshot({
			title: isProposal ? (publishedContent?.title ?? '') : '',
			summary: isProposal ? (publishedContent?.summary ?? '') : '',
			image: isProposal ? (publishedContent?.image ?? '') : '',
			body: '',
			bodyTab: 'write',
			presentation: isProposal ? publishedContent?.presentation : undefined,
		})
		cleanDraftSignatureRef.current = JSON.stringify(discarded)
		clearRetainedDraft()
		onStoryViewPreviewReset?.(draftKey)
		void removeDraftEditingAccess({ kind: 'story', draftKey, title }, accounts.active?.pubkey)
		setTitle(discarded.title)
		setSummary(discarded.summary)
		setImage(discarded.image)
		setBody('')
		bodyEditorRef.current?.setContent('')
		setBodyTab('write')
		setPresentation(discarded.presentation)
	}
	useEffect(() => registerStoryDraftDiscard(draftKey, () => {
		handleDiscardDraft()
		onClose()
	}), [draftKey, handleDiscardDraft, onClose])
	const publishRef = useDraftPublishReview(`story:${draftKey}`)
	useEffect(() => registerStoryPublicationEditor(draftKey, {
		flush: persistNow,
		published: clearRetainedDraft,
		resolvedBody: (resolved) => {
			// The publisher validates again before signing. Commit the resolved
			// body now so its flush callback cannot overwrite it with stale state.
			flushSync(() => setBody(resolved))
			bodyEditorRef.current?.setContent(resolved)
		},
	}), [draftKey, persistNow, clearRetainedDraft])
	useEffect(() => {
		const preview = () => {
			const request = getDraftReviewRequest()
			if (request?.key !== `story:${draftKey}` || request.action !== 'preview' || request.owner !== accounts.active?.pubkey) return
			clearDraftReview(request)
			setBodyTab('preview')
		}
		preview()
		return subscribeDraftReview(preview)
	}, [draftKey])
	const restoreProposalMetadata = () => {
		setTitle(publishedContent?.title ?? '')
		setSummary(publishedContent?.summary ?? '')
		setImage(publishedContent?.image ?? '')
		setPresentation(publishedContent?.presentation)
		setSaveError(null)
		onStoryViewPreviewReset?.(draftKey)
	}

	const handleSave = async () => {
		if (!currentUser) return
		setSaveError(null)
		toast.dismiss('story-publish-error')

		if (!isProposal && !title.trim()) {
			setSaveError('A title is required to publish.')
			return
		}
		if (!body.trim()) {
			setSaveError(
				isProposal
					? 'Add some narrative before proposing your edit.'
					: 'Add some narrative before publishing.',
			)
			return
		}
		if (proposalMetadataChanged) {
			setSaveError(
				'This saved draft changes cover details or the opening view, which proposals cannot carry. Restore the original cover and opening view to send your narrative changes.',
			)
			return
		}

		setIsSaving(true)
		try {
			if (!isProposal) {
				const storyReference = initialStory?.dTag ? coordinateToNaddrReference(`${initialStory.kind}:${initialStory.pubkey}:${initialStory.dTag}`) ?? undefined : undefined
				await publishSavedStory({ kind: 'story', draftKey, title, storyReference })
				toast.success('Story published. Further edits stay in your draft.')
				return
			}
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')
			const ownerPubkey = currentUser.pubkey
			persistNow()
			let expectedDraft = JSON.stringify(readStoryDraft(draftKey, ownerPubkey))

			const content: ArticleContent = { ...proposalContent }

			// Only explicit LOCAL dependencies need publishing. An ordinary public
			// reference never publishes the visible editor's unrelated changes.
			content.content = await resolveLocalStoryDependencies(content.content ?? '', {
				storyDraftKey: draftKey,
				storyTitle: title,
				onProgress: (resolvedBody) => {
					if (JSON.stringify(readStoryDraft(draftKey, ownerPubkey)) !== expectedDraft) throw new Error('This Story draft changed while publishing its Maps. The published Maps remain available; review your draft before retrying.')
					writeStoryDraft(draftKey, { ...draftSnapshot, content: resolvedBody }, ownerPubkey)
					expectedDraft = JSON.stringify(readStoryDraft(draftKey, ownerPubkey))
					setBody(resolvedBody)
					bodyEditorRef.current?.setContent(resolvedBody)
				},
			})
			if (accounts.active?.pubkey !== ownerPubkey || JSON.stringify(readStoryDraft(draftKey, ownerPubkey)) !== expectedDraft) throw new Error('The account or Story draft changed. Nothing further was published; review and retry.')

			const editedEvent = initialStory?.rawEvent()
			if (isProposal && initialStory && editedEvent && isArticle(editedEvent)) {
				// Existing Story proposals carry only Markdown. Both the UI guard and
				// service reject unsupported metadata changes instead of dropping them.
				await proposeStoryEdit(editedEvent, content, signer)
				clearRetainedDraft()
				onStoryViewPreviewReset?.(draftKey)
				toast.success('Edit proposed — the author will see it for review.')
				onSave(initialStory)
				return
			}
			throw new Error('The original Story is unavailable. Reopen it before proposing changes.')
		} catch (error) {
			const message = publishFailureMessage(isProposal ? 'send this Story proposal' : 'publish this Story', error, submitLabel)
			setSaveError(message)
			toast.error(message, { id: 'story-publish-error', duration: 10_000 })
		} finally {
			setIsSaving(false)
		}
	}

	const coverDetails = (
		<EntityPanelSurface tone="context" className="space-y-3">
			<EntityPanelSectionHeader eyebrow="Story" title="Cover details" description="Title and summary appear on the story card and social previews." />
			<div className="space-y-2">
				<Label htmlFor="story-title">Title</Label>
				<Input id="story-title" value={title} readOnly={isProposal} onChange={event => setTitle(event.target.value)} placeholder="Roman ruins in Carinthia" className="rounded-none" />
			</div>
			<div className="space-y-2">
				<Label htmlFor="story-summary">Summary</Label>
				<Textarea id="story-summary" value={summary} readOnly={isProposal} onChange={event => setSummary(event.target.value)} placeholder="A one-line summary readers see on the story card." rows={2} className="rounded-none" />
			</div>
			<div className="space-y-2">
				<Label>Cover image</Label>
				<p className="text-[11px] text-muted-foreground">Optional — shown on the story card and social previews.</p>
				{image.trim() ? <AspectRatio ratio={16 / 9} className="overflow-hidden border border-border bg-muted">
					<img src={image} alt="Story cover" className="h-full w-full object-cover" onError={event => { event.currentTarget.style.display = 'none' }} />
				</AspectRatio> : null}
				<div className="flex items-center gap-2">
					<Input value={image} aria-label="Cover image URL" readOnly={isProposal} onChange={event => setImage(event.target.value)} placeholder="https://..." className="rounded-none" />
					<BlossomUploaderButton currentUrl={image} disabled={isProposal} onUploaded={({url}) => setImage(url)} buttonLabel="Blossom" className="rounded-none" />
				</div>
			</div>
		</EntityPanelSurface>
	)
	const openingView = (
		<EntityPanelSurface tone="neutral" className="space-y-3">
			<EntityPanelSectionHeader eyebrow="Map presentation" title="Opening view" description="Choose ordered Map instances, feature subsets, styling, and the camera readers see first. View blocks in the narrative change this state later." />
			{isProposal && <p className="text-xs text-muted-foreground">Opening view is read-only in proposals. You can change its existing layers and camera within the narrative's inline views.</p>}
			<fieldset disabled={isProposal} className="min-w-0">
				<legend className="sr-only">Opening view settings</legend>
				<StoryPresentationEditor value={presentation} body={body} availableFeatures={availableFeatures} onChange={setPresentation} captureMapPresentation={captureMapPresentation} />
			</fieldset>
		</EntityPanelSurface>
	)

	return (
		<EntityPanelShell
			title={isProposal ? 'Propose a Story edit' : isEditing ? 'Edit Story' : 'New Story'}
		>
			<MobilePanelHeaderActions>
				<div className="flex items-center gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={onClose}>
						Cancel
					</Button>
					<Button ref={mobileHeaderActionTarget ? publishRef : undefined} type="button" size="sm" onClick={handleSave} disabled={isSaving || !currentUser}>
						{submitLabel}
					</Button>
				</div>
			</MobilePanelHeaderActions>
			<fieldset disabled={isSaving} className="min-w-0 space-y-3">
			<Button type="button" size="sm" variant="outline" onClick={() => {
				persistNow()
				const storyReference = initialStory?.dTag ? coordinateToNaddrReference(`${initialStory.kind}:${initialStory.pubkey}:${initialStory.dTag}`) ?? undefined : undefined
				addTargetToActiveThread({ id: `story:${draftKey}`, kind: 'story', draftKey, title: title.trim() || 'Untitled Story', intent: isProposal ? 'propose' : isEditing ? 'edit' : 'create', storyReference })
				navigateToRoute('/ask')
			}}><MessageSquare className="size-3.5" /> Edit this Story with AI</Button>
			{isProposal ? (
				<div className="space-y-2 border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
					<p>
						Suggest changes to the narrative and inline map views. The author can accept or decline
						your proposal. Cover details and the opening view are read-only because proposals carry
						only the narrative.
					</p>
					{!currentUser ? (
						<p>Sign in to send a proposal. You can still save a local draft.</p>
					) : null}
					{proposalMetadataChanged ? (
						<div className="space-y-2 text-destructive">
							<p>
								This saved draft contains cover or opening-view changes that cannot be proposed.
								They are preserved here until you explicitly restore the original; your narrative
								will stay.
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-auto whitespace-normal rounded-none text-left"
								onClick={restoreProposalMetadata}
							>
								Restore original cover and opening view
							</Button>
						</div>
					) : null}
				</div>
			) : null}
			{!isProposal && coverDetails}

			<EntityPanelSurface tone="neutral" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Narrative"
					title="Write your story"
					description="Type $ to reference a Map or feature. Place the cursor in your prose, then use View in the toolbar to insert a map cue or figure."
				/>
				{body.includes('earthly-draft:') && (
					<p className="text-xs text-muted-foreground">
						This story includes local Map references. When you publish, you’ll be asked to publish
						each required Map and replace its draft reference with a public link. Cancelling keeps
						your Story draft and any completed links. Inline map views currently require published Maps.
					</p>
				)}
				<Tabs
					value={bodyTab}
					onValueChange={(value) => setBodyTab(value as 'write' | 'preview')}
					className="space-y-3"
				>
					<TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
						<TabsTrigger
							value="write"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Write
						</TabsTrigger>
						<TabsTrigger
							value="preview"
							className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
						>
							Preview
						</TabsTrigger>
					</TabsList>

					<TabsContent value="write" className="mt-0">
						<GeoRichTextEditor
							ref={bodyEditorRef}
							autoFocus={isProposal}
							initialValue={body}
							disabled={isSaving}
							onChange={setBody}
							availableFeatures={availableFeatures}
							placeholder={`Start writing…
Type $ to reference a Map, feature, OSM element, or coordinate.`}
							rows={12}
							className="min-h-[320px] w-full"
							enableStoryViews
							storyViewLayers={openingPresentation?.layers}
							captureStoryView={captureStoryView}
							onStoryViewActivate={(view) => activateStoryView(view)}
						/>
					</TabsContent>

					<TabsContent value="preview" className="mt-0">
						{/* Preview renders ONLY through the sanitized RichContentRenderer,
						    exactly as readers see it — never raw HTML (T-10-04). */}
						<RichContentRenderer
							content={body}
							availableFeatures={availableFeatures}
							emptyState="Nothing to preview yet — switch to Write and add some narrative."
							className="min-h-[160px]"
							onStoryViewActivate={(view, index) => activateStoryView(view, index)}
							renderStoryViewFigure={
								renderStoryViewFigure
									? (_view, index) => {
											const snapshot = viewReduction.snapshots[index]
											return snapshot
												? renderStoryViewFigure(snapshot, index, { body, draftKey })
												: null
										}
									: undefined
							}
						/>
					</TabsContent>
				</Tabs>
			</EntityPanelSurface>

			{isProposal ? <details className="border border-border p-3 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium">Cover and opening view · read-only</summary><div className="mt-3 space-y-3">{coverDetails}{openingView}</div></details> : openingView}

			<EntityPanelSurface tone="neutral" className="space-y-2">
				{saveError && <p className="text-xs text-destructive">{saveError}</p>}
				<div className="flex flex-wrap items-center justify-end gap-2">
					<AlertDialog>
						<AlertDialogTrigger asChild>
							<Button variant="ghost" className="rounded-none text-destructive">
								Discard draft
							</Button>
						</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>Discard this draft?</AlertDialogTitle>
								<AlertDialogDescription>
									Your unpublished changes will be lost. This can't be undone.
								</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>Keep editing</AlertDialogCancel>
								<AlertDialogAction
									onClick={handleDiscardDraft}
									className="bg-destructive text-destructive-foreground"
								>
									Discard
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
					<Button variant="outline" onClick={handleSaveDraft} className="rounded-none">
						Save draft
					</Button>
					{!mobileHeaderActionTarget ? (
						<>
							<Button variant="outline" onClick={onClose} className="rounded-none">
								Cancel
							</Button>
							<Button
								onClick={handleSave}
								ref={publishRef}
								disabled={isSaving || !currentUser}
								className="rounded-none bg-primary text-primary-foreground"
							>
								{submitLabel}
							</Button>
						</>
					) : null}
				</div>
			</EntityPanelSurface>
			</fieldset>
		</EntityPanelShell>
	)
}
