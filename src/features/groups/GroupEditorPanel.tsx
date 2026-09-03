/**
 * GroupEditorPanel — the owner-facing create/edit surface for a kind-37518 Group
 * (Phase 9, D-01 / D-04). The slimmed successor to `MapContextEditorPanel`,
 * refactored in place: the `contextUse`/`validationMode`/`Switch
 * allowForeignAttachments` triad is replaced by a single governance ladder of 3
 * plain-language radio cards (open · schema · closed), and the schema-authoring
 * section is conditionally mounted ONLY under `governance: 'schema'`.
 *
 * Both schema-authoring paths — the visual builder (`compileBuilderSchema`) and the
 * raw-JSON Advanced tab — compile to the SAME draft-2020-12 schema fed to the
 * Phase-8 hardened off-thread `validateSchema` worker. On save the Group publishes
 * with a canonical `schema-hash` (`computeSchemaHash`); edits preserve the `d` tag.
 *
 * Accent (`--primary`) is reserved per the UI-SPEC: the selected governance card
 * and the submit button only. The legacy unlabeled-checkbox a11y gap
 * (`MapContextEditorPanel.tsx:900-913`) is fixed via shadcn `Checkbox` + `Label
 * htmlFor` pairing.
 *
 * NOTE (consumer migration, Plans 05/06): this panel still accepts/returns the
 * `MapContext` cast at its props boundary so the existing GeoEditorInfoPanel
 * view/save lifecycle is unchanged. The full `Group`-typed view + save lifecycle
 * (GroupViewPanel, useGroups wiring at the call sites) migrates in Plan 06. The
 * editor's internals are entirely Group-native (GroupFactory / GroupContent /
 * compileBuilderSchema).
 */

import { toast } from 'sonner'
import { castEvent } from 'applesauce-core/casts'
import { useActiveAccount } from 'applesauce-react/hooks'
import {
	ArrowDown,
	ArrowUp,
	Camera,
	Eye,
	EyeOff,
	Layers3,
	Plus,
	RotateCcw,
	Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
	GeoRichTextEditor,
	type GeoFeatureItem,
	type GeoRichTextEditorRef,
} from '@/components/editor'
import { EntitySearchPopover, type EntitySearchResult } from '@/components/entity-search'
import { BlossomUploaderButton } from '@/components/blossom/BlossomUploaderButton'
import {
	EntityPanelSectionHeader,
	EntityPanelShell,
	EntityPanelSurface,
} from '@/components/info-panel/EntityPanelShell'
import { Button } from '@/components/ui/button'
import {
	MobilePanelHeaderActions,
	useMobilePanelHeaderActionTarget,
} from '@/features/geo-editor/components/MobilePanelHeaderAction'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { ensureDatasetReferencePublished } from '@/features/chat/referencePublishing'
import { captureVisibleDatasetReferenceTarget } from '@/features/chat/store'
import { useRetainedEditorDraft } from '@/hooks/useRetainedEditorDraft'
import { computeSchemaHash } from '@/lib/group/schemaHash'
import { accounts, eventStore, publish } from '@/lib/nostr'
import {
	GROUP_GEOMETRY_TYPES,
	GroupFactory,
	type GroupContent,
	type GroupGeometryType,
	type GroupGovernance,
	getGroupContent,
	getGroupReferencedAddresses,
	isGroup,
} from '@/lib/nostr/group'
import { MapContext } from '@/lib/nostr/map-context'
import {
	authorizePresentationLayer,
	deriveAtlasPresentationAuthorization,
	getUsableMapPresentation,
	parseMapPresentation,
	parseMapPresentationSource,
	type MapPresentationLayerV1,
	type MapPresentationSource,
	type MapPresentationV1,
} from '@/lib/map-presentation'
import {
	coordinateToNaddrReference,
	dedupeNostrAddressReferences,
	extractNostrAddressReferences,
	extractNostrAddressReferencesFromList,
	extractReferencedCoordinates,
	extractReferencedCoordinatesFromList,
	setAddressReferenceTags,
	stringifyNostrAddressReference,
} from '@/lib/nostr/references'
import { validateSchema } from '@/lib/validation/schemaWorker'
import {
	NEW_GROUP_EDITOR_DRAFT_KEY,
	AtlasPresentationValidationError,
	clearGroupEditorDraft,
	type GroupEditorDraftSnapshot,
	type GroupSchemaAuthorMode,
	normalizeAtlasPresentationForPublish,
	readGroupEditorDraft,
	writeGroupEditorDraft,
} from './editorDraft'
import {
	compileBuilderSchema,
	decodeAllowedGeometryTypes,
	decodeBuilderSchema,
	type SchemaBuilderRow,
	type SchemaFieldType,
} from './schemaBuilder'
import type { GroupCreationSeed } from './creationSeed'
import {
	addAtlasPresentationLayer,
	atlasPresentationSourceOptions,
	emptyAtlasPresentation,
	moveAtlasPresentationLayer,
	parseAtlasFeatureIds,
	removeAtlasPresentationLayer,
	updateAtlasLayerStyle,
	updateAtlasPresentationLayer,
	withoutAtlasInitialView,
	withoutAtlasLayerFeatureIds,
	withoutAtlasLayerStyle,
} from './atlasPresentationAuthoring'

type SchemaAuthorMode = GroupSchemaAuthorMode

interface BuilderRow extends SchemaBuilderRow {
	/** Stable React key for the row (not serialized into the schema). */
	id: string
}

export interface GroupEditorPanelProps {
	/** The Group being edited, surfaced through the existing MapContext cast. */
	initialContext?: MapContext | null
	/** One-shot values for a new Atlas, used by actions such as Save this view. */
	creationSeed?: GroupCreationSeed | null
	onClose: () => void
	/** Returns the saved Group as a MapContext cast (lifecycle migrates in Plan 06). */
	onSave: (group: MapContext) => void
	availableFeatures?: GeoFeatureItem[]
	/** Explicit capture only. Final owner-authored `a` coordinates let the canvas omit foreign `c`. */
	captureMapPresentation?: (
		acceptedSources: readonly MapPresentationSource[],
	) => MapPresentationV1 | null | undefined
}

/** Governance ladder copy — verbatim from the UI-SPEC copy table (D-01). */
const GOVERNANCE_CARDS: { value: GroupGovernance; title: string; explanation: string }[] = [
	{
		value: 'open',
		title: 'Anyone',
		explanation: 'Anyone can add a Map — contributions appear below your curated picks.',
	},
	{
		value: 'schema',
		title: 'Anyone, if the Map fits',
		explanation: 'Anyone can add a Map, but contributions are checked against your rules first.',
	},
	{
		value: 'closed',
		title: 'Only me',
		explanation: 'Only the Maps you curate appear — no outside contributions.',
	},
]

function createRowId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `group-row-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function rowsFromSchema(schema: unknown): BuilderRow[] {
	return decodeBuilderSchema(schema).map((row) => ({ ...row, id: createRowId() }))
}

function rowsFromDraft(rows: SchemaBuilderRow[]): BuilderRow[] {
	return rows.map((row) => ({ ...row, id: createRowId() }))
}

/** Read the slimmed Group content out of an editable MapContext (defensive). */
function readInitialGroupContent(context?: MapContext | null): GroupContent | undefined {
	if (!context) return undefined
	const event = context.rawEvent()
	if (!isGroup(event)) return undefined
	return getGroupContent(event)
}

/**
 * Seed the curated-reference editor from an edited Group's existing `a` tags (CR-03). The
 * curated list stores `nostr:naddr1…` reference strings, so each `kind:pubkey:identifier`
 * coordinate is re-encoded; coordinates that fail to encode are dropped from the editable
 * list but are still preserved on save via `preservedCoordinates`. Returns `[]` for a new
 * Group (no `initialContext`) or a non-Group event so creation starts with an empty lane.
 */
function readInitialCuratedReferences(context?: MapContext | null): string[] {
	if (!context) return []
	const event = context.rawEvent()
	if (!isGroup(event)) return []
	return getGroupReferencedAddresses(event)
		.map((coordinate) => coordinateToNaddrReference(coordinate))
		.filter((reference): reference is string => reference !== null)
}

interface InitialGroupEditorState extends Omit<GroupEditorDraftSnapshot, 'rows'> {
	rows: BuilderRow[]
	draftKey: string
}

function groupEditorDraftKey(context?: MapContext | null): string {
	if (!context) return NEW_GROUP_EDITOR_DRAFT_KEY
	const event = context.rawEvent()
	if (!isGroup(event)) return NEW_GROUP_EDITOR_DRAFT_KEY
	return `edit:${event.pubkey}:${context.dTag ?? event.id}`
}

function readInitialGroupEditorState(
	context?: MapContext | null,
	creationSeed?: GroupCreationSeed | null,
): InitialGroupEditorState {
	const draftKey = groupEditorDraftKey(context)
	// An explicit creation intent is authoritative over a generic retained "new
	// Atlas" form. It must not silently inherit stale references from an earlier
	// abandoned draft.
	const retained = creationSeed && !context ? null : readGroupEditorDraft(draftKey)
	if (retained) {
		return {
			...retained,
			rows: rowsFromDraft(retained.rows),
			draftKey,
		}
	}

	const content = readInitialGroupContent(context)
	const rows = rowsFromSchema(content?.schema)
	const allowedGeometryTypes =
		content?.geometryConstraints?.allowedTypes ?? decodeAllowedGeometryTypes(content?.schema)
	return {
		name: creationSeed?.name ?? content?.name ?? '',
		description: creationSeed?.description ?? content?.description ?? '',
		curatedReferences: creationSeed?.curatedReferences
			? [...creationSeed.curatedReferences]
			: readInitialCuratedReferences(context),
		image: content?.image ?? '',
		governance: creationSeed?.governance ?? content?.governance ?? 'open',
		schemaMode: 'builder',
		allowedGeometryTypes,
		rows,
		advancedJson: JSON.stringify(
			content?.schema ?? compileBuilderSchema(rows, allowedGeometryTypes),
			null,
			2,
		),
		sampleJson: '{}',
		presentation: creationSeed?.presentation ?? content?.presentation,
		draftKey,
	}
}

function groupDraftSnapshot(values: {
	name: string
	description: string
	curatedReferences: string[]
	image: string
	governance: GroupGovernance
	schemaMode: SchemaAuthorMode
	allowedGeometryTypes: GroupGeometryType[]
	rows: BuilderRow[]
	advancedJson: string
	sampleJson: string
	presentation?: unknown
}): GroupEditorDraftSnapshot {
	return {
		name: values.name,
		description: values.description,
		curatedReferences: [...values.curatedReferences],
		image: values.image,
		governance: values.governance,
		schemaMode: values.schemaMode,
		allowedGeometryTypes: [...values.allowedGeometryTypes],
		rows: values.rows.map(({ id: _id, ...row }) => ({
			...row,
			allowedValues: row.allowedValues ? [...row.allowedValues] : undefined,
		})),
		advancedJson: values.advancedJson,
		sampleJson: values.sampleJson,
		presentation: values.presentation,
	}
}

function persistGroupEditorDraft(identity: string, snapshot: GroupEditorDraftSnapshot): void {
	writeGroupEditorDraft(identity, snapshot)
}

function atlasAcceptedSources(addresses: readonly string[]): MapPresentationSource[] {
	return addresses.flatMap((coordinate) => {
		const parsed = parseMapPresentationSource(coordinate)
		return parsed ? [parsed.coordinate] : []
	})
}

function readPreservedCuratedCoordinates(context?: MapContext | null): string[] {
	const event = context?.rawEvent()
	if (!event || !isGroup(event)) return []
	return getGroupReferencedAddresses(event).filter(
		(coordinate) => coordinateToNaddrReference(coordinate) === null,
	)
}

function AtlasDefaultViewEditor({
	value,
	acceptedSources,
	availableFeatures,
	onChange,
	captureMapPresentation,
}: {
	value: unknown
	acceptedSources: readonly MapPresentationSource[]
	availableFeatures: readonly GeoFeatureItem[]
	onChange: (value: unknown) => void
	captureMapPresentation?: GroupEditorPanelProps['captureMapPresentation']
}) {
	const [selectedSource, setSelectedSource] = useState('')
	const [captureError, setCaptureError] = useState<string | null>(null)
	const parsed = useMemo(() => parseMapPresentation(value), [value])
	const presentation = getUsableMapPresentation(parsed)
	const authorization = useMemo(
		() => deriveAtlasPresentationAuthorization(acceptedSources),
		[acceptedSources],
	)
	const sourceOptions = useMemo(
		() => atlasPresentationSourceOptions(acceptedSources, availableFeatures),
		[acceptedSources, availableFeatures],
	)
	const validationError = useMemo(() => {
		try {
			normalizeAtlasPresentationForPublish(value, acceptedSources)
			return null
		} catch (error) {
			return error instanceof Error ? error.message : 'The default view is invalid.'
		}
	}, [acceptedSources, value])

	const capture = (mode: 'all' | 'camera') => {
		const captured = captureMapPresentation?.(acceptedSources)
		try {
			const normalized = normalizeAtlasPresentationForPublish(captured, acceptedSources)
			const result = parseMapPresentation(normalized)
			const usable = getUsableMapPresentation(result)
			if (!usable || (result.status === 'valid' && result.issues.length > 0)) {
				throw new AtlasPresentationValidationError(
					'The current map could not be captured as a valid Atlas default view.',
				)
			}
			if (mode === 'camera' && !usable.initialView) {
				throw new AtlasPresentationValidationError('The map did not provide a camera position.')
			}
			setCaptureError(null)
			if (mode === 'all') {
				onChange(usable)
				return
			}
			onChange({
				...(presentation ?? emptyAtlasPresentation()),
				initialView: usable.initialView,
			})
		} catch (error) {
			setCaptureError(
				error instanceof Error
					? error.message
					: 'The current map could not be captured as a valid Atlas default view.',
			)
		}
	}

	const future = parsed.status === 'unsupported'
	const invalid = parsed.status === 'invalid'

	const updateLayer = (index: number, layer: MapPresentationLayerV1) => {
		if (!presentation) return
		onChange(updateAtlasPresentationLayer(presentation, index, layer))
	}

	const addLayer = () => {
		if (!presentation) return
		const source = parseMapPresentationSource(selectedSource)?.coordinate
		if (!source || !authorization.has(source)) return
		onChange(addAtlasPresentationLayer(presentation, source))
		setSelectedSource('')
	}

	return (
		<div className="space-y-3">
			{future && (
				<p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
					This Atlas uses a newer default-view format. It stays unchanged through unrelated edits
					unless you explicitly replace or remove it.
				</p>
			)}
			{invalid && (
				<p className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
					The stored default view is malformed. Readers will fall back to framing the Atlas Maps.
				</p>
			)}
			{presentation ? (
				<div className="flex flex-wrap items-center justify-between gap-2 border border-border bg-muted/30 px-3 py-2">
					<div className="min-w-0">
						<div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
							<Camera className="h-3.5 w-3.5 text-primary" />
							{presentation.initialView
								? `${presentation.initialView.center[1].toFixed(4)}, ${presentation.initialView.center[0].toFixed(4)} · zoom ${presentation.initialView.zoom.toFixed(1)}`
								: 'Default camera not set'}
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
							onClick={() => capture('camera')}
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
								onClick={() => onChange(withoutAtlasInitialView(presentation))}
							>
								Clear camera
							</Button>
						)}
					</div>
				</div>
			) : !future && !invalid ? (
				<p className="text-xs text-muted-foreground">
					No canonical default view. Showing the Atlas on the map uses normal framing.
				</p>
			) : null}

			{validationError && presentation && (
				<p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
					{validationError}
				</p>
			)}
			{presentation && (
				<div className="space-y-3">
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<select
								value={selectedSource}
								onChange={(event) => setSelectedSource(event.target.value)}
								className="h-8 min-w-0 flex-1 border border-border bg-background px-2 text-xs text-foreground"
								aria-label="Accepted Map source"
							>
								<option value="">
									{sourceOptions.length > 0
										? 'Add an accepted Map…'
										: 'Reference or curate a Map first…'}
								</option>
								{sourceOptions.map((option) => (
									<option key={option.source} value={option.source}>
										{option.label}
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
							Layers render bottom to top. Add the same Map repeatedly for different feature
							selections or styling.
						</p>
					</div>

					<div className="space-y-2">
						{presentation.layers.length === 0 && (
							<p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
								No default layers yet. Add one of the Maps accepted by this Atlas.
							</p>
						)}
						{presentation.layers.map((layer, index) => {
							const authorizationResult = authorizePresentationLayer(layer, authorization)
							const controlPrefix = `atlas-presentation-${index}`
							const sourceLabel =
								sourceOptions.find((option) => option.source === layer.source)?.label ??
								parseMapPresentationSource(layer.source)?.identifier ??
								layer.source
							return (
								<div
									key={layer.id}
									className="space-y-3 border border-border bg-background px-3 py-2"
								>
									<div className="flex items-start gap-2">
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											className="h-7 w-7 flex-shrink-0 rounded-none"
											onClick={() => updateLayer(index, { ...layer, visible: !layer.visible })}
											aria-label={layer.visible ? 'Hide default layer' : 'Show default layer'}
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
												onChange={(event) =>
													updateLayer(index, { ...layer, id: event.target.value })
												}
												className="h-7 rounded-none font-mono text-xs"
												aria-label="Stable presentation layer id"
											/>
											<p
												className="mt-1 truncate text-[10px] text-muted-foreground"
												title={layer.source}
											>
												{sourceLabel} ·{' '}
												{index === 0
													? 'bottom'
													: index === presentation.layers.length - 1
														? 'top'
														: `level ${index + 1}`}
											</p>
										</div>
										<div className="flex flex-shrink-0 items-center gap-0.5">
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 rounded-none"
												disabled={index === 0}
												onClick={() =>
													onChange(moveAtlasPresentationLayer(presentation, index, index - 1))
												}
												aria-label="Move layer toward bottom"
											>
												<ArrowUp className="h-3.5 w-3.5" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 rounded-none"
												disabled={index === presentation.layers.length - 1}
												onClick={() =>
													onChange(moveAtlasPresentationLayer(presentation, index, index + 1))
												}
												aria-label="Move layer toward top"
											>
												<ArrowDown className="h-3.5 w-3.5" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon-sm"
												className="h-7 w-7 rounded-none text-muted-foreground hover:text-destructive"
												onClick={() => onChange(removeAtlasPresentationLayer(presentation, index))}
												aria-label="Remove layer"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
										</div>
									</div>

									{authorizationResult.status !== 'authorized' && (
										<p className="border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[10px] text-foreground">
											This layer no longer references a Map accepted by the Atlas owner and cannot
											be published.
										</p>
									)}

									<div className="grid gap-3 sm:grid-cols-2">
										<label className="space-y-1 text-[10px] text-muted-foreground">
											<span className="flex items-center justify-between">
												Opacity{' '}
												<span className="font-mono">{layer.opacityMultiplier.toFixed(2)}</span>
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
												aria-label={`Opacity for ${layer.id}`}
											/>
										</label>
										<label className="space-y-1 text-[10px] text-muted-foreground">
											<span>Feature scope</span>
											<select
												value={layer.featureIds === undefined ? 'whole' : 'features'}
												onChange={(event) =>
													updateLayer(
														index,
														event.target.value === 'whole'
															? withoutAtlasLayerFeatureIds(layer)
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
											<span>Feature IDs, separated by commas or new lines</span>
											<Textarea
												id={`${controlPrefix}-features`}
												value={layer.featureIds.join(', ')}
												onChange={(event) =>
													updateLayer(index, {
														...layer,
														featureIds: parseAtlasFeatureIds(event.target.value),
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
																updateAtlasLayerStyle(layer, key, event.target.value || undefined),
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
																	updateAtlasLayerStyle(
																		layer,
																		key,
																		event.target.value === ''
																			? undefined
																			: Number(event.target.value),
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
															updateAtlasLayerStyle(
																layer,
																'lineDash',
																event.target.value || undefined,
															),
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
																updateAtlasLayerStyle(
																	layer,
																	key,
																	event.target.value === ''
																		? undefined
																		: event.target.value === 'true',
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
															updateAtlasLayerStyle(
																layer,
																'displayIcon',
																event.target.value || undefined,
															),
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
												onClick={() => updateLayer(index, withoutAtlasLayerStyle(layer))}
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
				</div>
			)}
			<p className="text-[10px] text-muted-foreground">
				Only Maps referenced or pinned by the Atlas owner may enter this view. Community
				contribution layers and route-only overlays are never persisted automatically.
			</p>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="gap-1 rounded-none"
					onClick={() => capture('all')}
					disabled={!captureMapPresentation}
				>
					<Camera className="h-3.5 w-3.5" />
					Set from current view
				</Button>
				{value !== undefined && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="gap-1 rounded-none text-destructive"
						onClick={() => {
							setCaptureError(null)
							onChange(undefined)
						}}
					>
						<Trash2 className="h-3.5 w-3.5" />
						Clear
					</Button>
				)}
			</div>
			{captureError && <p className="text-xs text-destructive">{captureError}</p>}
		</div>
	)
}

export function GroupEditorPanel({
	initialContext,
	creationSeed,
	onClose,
	onSave,
	availableFeatures = [],
	captureMapPresentation,
}: GroupEditorPanelProps) {
	const currentUser = useActiveAccount()
	const mobileHeaderActionTarget = useMobilePanelHeaderActionTarget()
	const initial = useMemo(
		() => readInitialGroupEditorState(initialContext, creationSeed),
		[creationSeed, initialContext],
	)
	const descriptionEditorRef = useRef<GeoRichTextEditorRef>(null)

	const [name, setName] = useState(initial.name)
	const [description, setDescription] = useState(initial.description)
	// CR-03: seed from the edited Group's existing curated `a` refs so a name/description/
	// governance edit does not silently wipe the curated lane (empty for a new Group).
	const [curatedReferences, setCuratedReferences] = useState<string[]>(initial.curatedReferences)
	const [image, setImage] = useState(initial.image)
	const [governance, setGovernance] = useState<GroupGovernance>(initial.governance)
	const [schemaMode, setSchemaMode] = useState<SchemaAuthorMode>(initial.schemaMode)
	const [allowedGeometryTypes, setAllowedGeometryTypes] = useState<GroupGeometryType[]>(
		initial.allowedGeometryTypes,
	)
	const [rows, setRows] = useState<BuilderRow[]>(initial.rows)
	const [advancedJson, setAdvancedJson] = useState(initial.advancedJson)
	const [sampleJson, setSampleJson] = useState(initial.sampleJson)
	const [presentation, setPresentation] = useState<unknown>(initial.presentation)
	const [sampleVerdict, setSampleVerdict] = useState<{
		status: 'valid' | 'invalid' | 'error'
		message: string
	} | null>(null)
	const [isSaving, setIsSaving] = useState(false)
	const [saveError, setSaveError] = useState<string | null>(null)
	const draftSnapshot = useMemo(
		() =>
			groupDraftSnapshot({
				name,
				description,
				curatedReferences,
				image,
				governance,
				schemaMode,
				allowedGeometryTypes,
				rows,
				advancedJson,
				sampleJson,
				presentation,
			}),
		[
			name,
			description,
			curatedReferences,
			image,
			governance,
			schemaMode,
			allowedGeometryTypes,
			rows,
			advancedJson,
			sampleJson,
			presentation,
		],
	)
	const draftSignature = useMemo(() => JSON.stringify(draftSnapshot), [draftSnapshot])
	const cleanDraftSignatureRef = useRef(JSON.stringify(groupDraftSnapshot(initial)))
	const { setDirty, clearRetainedDraft } = useRetainedEditorDraft({
		identity: initial.draftKey,
		snapshot: draftSnapshot,
		persist: persistGroupEditorDraft,
		clear: clearGroupEditorDraft,
	})

	const isEditing = Boolean(readInitialGroupContent(initialContext))

	// Reset all fields when the edited Group changes.
	useEffect(() => {
		const next = readInitialGroupEditorState(initialContext, creationSeed)
		cleanDraftSignatureRef.current = JSON.stringify(groupDraftSnapshot(next))
		setName(next.name)
		setDescription(next.description)
		descriptionEditorRef.current?.setContent(next.description)
		// CR-03: re-seed curated refs from the edited Group (not []) so they survive the edit.
		setCuratedReferences(next.curatedReferences)
		setImage(next.image)
		setGovernance(next.governance)
		setSchemaMode(next.schemaMode)
		setAllowedGeometryTypes(next.allowedGeometryTypes)
		setRows(next.rows)
		setAdvancedJson(next.advancedJson)
		setSampleJson(next.sampleJson)
		setPresentation(next.presentation)
		setSampleVerdict(null)
		setSaveError(null)
	}, [creationSeed, initialContext])

	useEffect(() => {
		setDirty(draftSignature !== cleanDraftSignatureRef.current)
	}, [draftSignature, setDirty])

	const builderSchema = useMemo(
		() => compileBuilderSchema(rows, allowedGeometryTypes),
		[rows, allowedGeometryTypes],
	)

	/** The effective schema for the active authoring tab + its parse error, if any. */
	const effectiveSchema = useMemo<{
		schema: Record<string, unknown> | null
		error: string | null
	}>(() => {
		if (schemaMode === 'builder') return { schema: builderSchema, error: null }
		try {
			const parsed = JSON.parse(advancedJson) as Record<string, unknown>
			return { schema: parsed, error: null }
		} catch (error) {
			return {
				schema: null,
				error: error instanceof Error ? error.message : 'Invalid JSON',
			}
		}
	}, [schemaMode, builderSchema, advancedJson])

	const referencedEntities = useMemo(() => {
		const featureMap = new Map<string, GeoFeatureItem>()
		availableFeatures.forEach((item) => {
			featureMap.set(`${item.address}#${item.featureId ?? ''}`, item)
			if (!item.featureId) featureMap.set(item.address, item)
		})
		return dedupeNostrAddressReferences(extractNostrAddressReferences(description)).map(
			(reference) => {
				const key = `${reference.address}#${reference.featureId ?? ''}`
				const matched =
					featureMap.get(key) ??
					(!reference.featureId ? featureMap.get(reference.address) : undefined)
				return {
					key,
					name: matched?.name ?? reference.address,
				}
			},
		)
	}, [availableFeatures, description])

	const curatedReferenceEntities = useMemo(() => {
		return dedupeNostrAddressReferences(
			extractNostrAddressReferencesFromList(curatedReferences),
		).map((reference) => ({
			key: `${reference.address}#${reference.featureId ?? ''}`,
			raw: stringifyNostrAddressReference(reference),
			name: reference.address,
		}))
	}, [curatedReferences])

	const availableCuratedReferenceFeatures = useMemo(
		() => availableFeatures.filter((item) => item.entityType !== 'context'),
		[availableFeatures],
	)
	const acceptedPresentationSources = useMemo(
		() =>
			atlasAcceptedSources([
				...extractReferencedCoordinates(description),
				...extractReferencedCoordinatesFromList(curatedReferences),
				...readPreservedCuratedCoordinates(initialContext),
			]),
		[curatedReferences, description, initialContext],
	)

	const toggleAllowedGeometryType = (type: GroupGeometryType, checked: boolean) => {
		setAllowedGeometryTypes((prev) => {
			const next = new Set(prev)
			if (checked) next.add(type)
			else next.delete(type)
			return Array.from(next.values())
		})
	}

	// Live "Sample properties" affordance — runs OFF-THREAD through the Phase-8 worker.
	useEffect(() => {
		let cancelled = false
		if (governance !== 'schema') {
			setSampleVerdict(null)
			return
		}
		if (effectiveSchema.error || !effectiveSchema.schema) {
			setSampleVerdict({
				status: 'error',
				message: `Schema JSON is invalid: ${effectiveSchema.error ?? 'unknown error'}. Fix it or switch back to the builder.`,
			})
			return
		}
		let sample: unknown
		try {
			sample = JSON.parse(sampleJson)
		} catch (error) {
			setSampleVerdict({
				status: 'error',
				message: error instanceof Error ? error.message : 'Invalid sample JSON',
			})
			return
		}
		const schema = effectiveSchema.schema
		void (async () => {
			const verdict = await validateSchema(schema, sample, { schemaHash: 'sha256:sample' })
			if (cancelled) return
			if (verdict.ok) {
				setSampleVerdict({ status: 'valid', message: 'Sample is valid.' })
			} else {
				const first = verdict.errors?.[0]
				const detail = first
					? `${first.instancePath || '/'} ${first.message ?? 'failed'}`
					: (verdict.error ?? 'Validation failed')
				setSampleVerdict({ status: 'invalid', message: detail })
			}
		})()
		return () => {
			cancelled = true
		}
	}, [governance, effectiveSchema, sampleJson])

	const handleCuratedReferenceSelect = (result: EntitySearchResult) => {
		const selected = result.entity as GeoFeatureItem
		const nextReference = stringifyNostrAddressReference({
			address: selected.address,
			featureId: selected.featureId,
		})
		setCuratedReferences((prev) => (prev.includes(nextReference) ? prev : [...prev, nextReference]))
	}

	const switchToAdvanced = () => {
		// Seed the raw-JSON tab from the builder so the rules round-trip.
		setAdvancedJson(JSON.stringify(builderSchema, null, 2))
		setSchemaMode('advanced')
	}

	const handleDiscardAndClose = () => {
		clearRetainedDraft()
		onClose()
	}

	const handleSave = async () => {
		if (!currentUser) return
		setSaveError(null)

		if (!name.trim()) {
			setSaveError('Atlas name is required.')
			return
		}

		// Compile the schema only under governance:'schema' (O-02 field-coexistence:
		// leaving 'schema' strips geometryConstraints/schema from content).
		let schema: Record<string, unknown> | undefined
		let geometryConstraints: GroupContent['geometryConstraints']

		if (governance === 'schema') {
			if (effectiveSchema.error || !effectiveSchema.schema) {
				setSaveError(
					`Schema JSON is invalid: ${effectiveSchema.error ?? 'unknown error'}. Fix it or switch back to the builder.`,
				)
				return
			}
			const hasRows = rows.some((row) => row.name.trim().length > 0)
			if (!hasRows && allowedGeometryTypes.length === 0 && schemaMode === 'builder') {
				setSaveError('Add at least one property rule or one allowed geometry type.')
				return
			}
			schema = effectiveSchema.schema
			geometryConstraints =
				allowedGeometryTypes.length > 0 ? { allowedTypes: allowedGeometryTypes } : undefined
		}

		const initialEvent = initialContext?.rawEvent()
		const editedGroupEvent = initialEvent && isGroup(initialEvent) ? initialEvent : null
		// Existing malformed `a` coordinates were never shown in the editable lane,
		// so keep them as accepted only for non-destructive unrelated edits.
		const preservedCuratedCoords = readPreservedCuratedCoordinates(initialContext)
		const curatedCoords = extractReferencedCoordinatesFromList(curatedReferences)
		const descriptionCoords = extractReferencedCoordinates(description)
		let normalizedPresentation: unknown
		try {
			normalizedPresentation = normalizeAtlasPresentationForPublish(presentation, [
				...descriptionCoords,
				...curatedCoords,
				...preservedCuratedCoords,
			])
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : 'The Atlas default view is invalid.')
			return
		}

		// Capture the exact visible Dataset before any dialog/async boundary. If the
		// description or curated lane references it, an unpublished edit must be
		// persisted before this Context can store its stable Nostr address.
		const referenceTarget = captureVisibleDatasetReferenceTarget()
		setIsSaving(true)
		try {
			const referenceGate = await ensureDatasetReferencePublished({
				markdown: [description, ...curatedReferences].filter(Boolean).join('\n'),
				chatId: `manual-context:${initial.draftKey}`,
				toolCallId: `publish-context:${Date.now()}`,
				target: referenceTarget,
			})
			if (referenceGate.status === 'blocked') {
				setSaveError(referenceGate.message)
				return
			}

			const schemaHashTag = schema ? await computeSchemaHash(schema) : undefined
			const signer = accounts.signer
			if (!signer) throw new Error('No active account')

			// CR-03 (defense-in-depth): the curated lane the owner actually manages round-trips
			// through `curatedReferences` → `referencedCoords`, so kept refs are re-added and
			// removed refs are correctly dropped. But an existing `a` coordinate that could NOT be
			// reverse-encoded to an naddr never reached the editable UI — preserve ONLY those so
			// the destructive `a`-reconcile can't silently drop a curated reference the owner had
			// no way to see or remove. Encodable-and-removed refs are intentionally NOT preserved.
			const content: GroupContent = {
				name: name.trim(),
				description: description.length > 0 ? description : undefined,
				descriptionFormat: 'markdown',
				governance,
				image: image.trim() || undefined,
				geometryConstraints,
				schema,
				presentation: normalizedPresentation,
			}

			const referencedCoords = [...descriptionCoords, ...curatedCoords]
			const factory = editedGroupEvent
				? GroupFactory.modify(editedGroupEvent).group(content)
				: GroupFactory.create(content)

			const signedEvent = await factory
				.schemaHash(schemaHashTag)
				.modifyPublicTags(setAddressReferenceTags(referencedCoords, preservedCuratedCoords))
				.sign(signer)

			await publish(signedEvent, { routing: 'outbox' })
			clearRetainedDraft()
			toast.success(isEditing ? 'Atlas updated.' : 'Atlas published.')
			// Surface the saved Group through the existing MapContext cast so the
			// current GeoEditorInfoPanel view/save lifecycle is unchanged (Plan 06).
			const cast = castEvent(signedEvent, MapContext, eventStore)
			onSave(cast)
			onClose()
		} catch (error) {
			setSaveError(
				error instanceof Error
					? error.message
					: "Couldn't publish — check your connection and try again.",
			)
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<EntityPanelShell title={isEditing ? 'Edit Atlas' : 'Create Atlas'}>
			<MobilePanelHeaderActions>
				<div className="flex items-center gap-1">
					<Button type="button" variant="ghost" size="sm" onClick={handleDiscardAndClose}>
						Cancel
					</Button>
					<Button type="button" size="sm" onClick={handleSave} disabled={isSaving || !currentUser}>
						{isSaving ? 'Saving…' : isEditing ? 'Save Atlas' : 'Create Atlas'}
					</Button>
				</div>
			</MobilePanelHeaderActions>
			<EntityPanelSurface tone="context" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Narrative"
					title="Describe the Atlas"
					description="Markdown is stored verbatim. Use $ to insert NIP-27 nostr references inline."
				/>
				<div className="space-y-2">
					<Label htmlFor="group-name">Name</Label>
					<Input
						id="group-name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						placeholder="Roman ruins in Carinthia"
						className="rounded-none"
					/>
				</div>
				<div className="space-y-2">
					<Label>Description</Label>
					<GeoRichTextEditor
						ref={descriptionEditorRef}
						initialValue={description}
						onChange={setDescription}
						availableFeatures={availableFeatures}
						placeholder={`## Scope
Write in Markdown. Use $ to insert Maps, Atlases, or features.`}
						rows={8}
						className="min-h-[280px] w-full"
					/>
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label>Referenced entities</Label>
						<span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
							{referencedEntities.length}
						</span>
					</div>
					{referencedEntities.length === 0 ? (
						<p className="border border-border px-3 py-2 text-[11px] text-muted-foreground">
							No inline nostr references yet.
						</p>
					) : (
						<div className="border border-border">
							{referencedEntities.map((reference, index) => (
								<div
									key={reference.key}
									className={`px-3 py-2 ${index > 0 ? 'border-t border-border' : ''}`}
								>
									<p className="truncate text-xs text-foreground">{reference.name}</p>
								</div>
							))}
						</div>
					)}
				</div>
				<div className="space-y-2">
					<div className="flex items-center justify-between gap-2">
						<Label>Curated references</Label>
						<span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
							{curatedReferenceEntities.length}
						</span>
					</div>
					<EntitySearchPopover
						sources={{ features: availableCuratedReferenceFeatures }}
						entityTypes={['feature']}
						onSelect={handleCuratedReferenceSelect}
						placeholder="Add curated reference…"
						searchMode="local"
						inputClassName="rounded-none"
					/>
					{curatedReferenceEntities.length > 0 && (
						<div className="border border-border">
							{curatedReferenceEntities.map((reference, index) => (
								<div
									key={reference.key}
									className={`flex items-start justify-between gap-3 px-3 py-2 ${
										index > 0 ? 'border-t border-border' : ''
									}`}
								>
									<p className="min-w-0 truncate text-xs text-foreground">{reference.name}</p>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="h-6 rounded-none px-2 text-[11px]"
										onClick={() =>
											setCuratedReferences((prev) =>
												prev.filter((value) => value !== reference.raw),
											)
										}
									>
										Remove
									</Button>
								</div>
							))}
						</div>
					)}
				</div>
				<div className="space-y-2">
					<Label htmlFor="group-image">Image URL</Label>
					<div className="flex items-center gap-2">
						<Input
							id="group-image"
							value={image}
							onChange={(event) => setImage(event.target.value)}
							placeholder="https://..."
							className="rounded-none"
						/>
						<BlossomUploaderButton
							currentUrl={image}
							onUploaded={({ url }) => setImage(url)}
							buttonLabel="Blossom"
							className="rounded-none"
						/>
					</div>
				</div>
			</EntityPanelSurface>

			<EntityPanelSurface tone="neutral" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Map presentation"
					title="Default view"
					description="Capture the camera, order, visibility, selection, and styling for the Maps this Atlas curates."
				/>
				<AtlasDefaultViewEditor
					value={presentation}
					acceptedSources={acceptedPresentationSources}
					availableFeatures={availableFeatures}
					onChange={setPresentation}
					captureMapPresentation={captureMapPresentation}
				/>
			</EntityPanelSurface>

			{/* Governance ladder (D-01) — 3 plain-language radio cards. */}
			<EntityPanelSurface tone="neutral" className="space-y-3">
				<EntityPanelSectionHeader
					eyebrow="Governance"
					title="Who can contribute?"
					description="Pick who may add outside Maps to this Atlas."
				/>
				<RadioGroup
					value={governance}
					onValueChange={(value) => setGovernance(value as GroupGovernance)}
					className="gap-2"
				>
					{GOVERNANCE_CARDS.map((card) => {
						const selected = governance === card.value
						const inputId = `governance-${card.value}`
						return (
							<Card
								key={card.value}
								size="sm"
								className={`rounded-none ${
									selected ? 'bg-primary/5 ring-2 ring-primary' : 'ring-1 ring-border'
								}`}
							>
								<CardContent className="flex items-start gap-3">
									<RadioGroupItem id={inputId} value={card.value} className="mt-0.5" />
									<Label htmlFor={inputId} className="flex flex-col items-start gap-1">
										<span className="text-sm font-semibold text-foreground">{card.title}</span>
										<span className="text-[13px] font-normal leading-5 text-muted-foreground">
											{card.explanation}
										</span>
									</Label>
								</CardContent>
							</Card>
						)
					})}
				</RadioGroup>
			</EntityPanelSurface>

			{/* Schema-authoring section — mounted ONLY under governance:'schema' (O-02). */}
			{governance === 'schema' && (
				<EntityPanelSurface tone="neutral" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Schema"
						title="Contribution rules"
						description="Build property rules and allowed geometry types, or paste raw JSON Schema."
					/>
					<Tabs
						value={schemaMode}
						onValueChange={(value) => {
							if (value === 'advanced') switchToAdvanced()
							else setSchemaMode('builder')
						}}
						className="space-y-3"
					>
						<TabsList className="h-8 w-full justify-start rounded-none border-b border-border bg-transparent p-0">
							<TabsTrigger
								value="builder"
								className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
							>
								Builder
							</TabsTrigger>
							<TabsTrigger
								value="advanced"
								className="h-8 rounded-none border-b-2 border-transparent px-2 text-xs data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
							>
								Advanced (JSON)
							</TabsTrigger>
						</TabsList>

						<TabsContent value="builder" className="mt-0 space-y-3">
							<div className="space-y-2">
								{rows.length === 0 ? (
									<p className="border border-border px-3 py-2 text-xs text-muted-foreground">
										No property rules yet. Add one, or switch to the Advanced tab to paste raw JSON.
									</p>
								) : (
									rows.map((row, index) => {
										const requiredId = `row-required-${row.id}`
										return (
											<div key={row.id} className="space-y-2 border border-border px-3 py-2">
												<div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
													<Input
														value={row.name}
														onChange={(event) => {
															const next = [...rows]
															next[index] = { ...row, name: event.target.value }
															setRows(next)
														}}
														placeholder="property name"
														className="rounded-none"
													/>
													<Select
														value={row.type}
														onValueChange={(value) => {
															const next = [...rows]
															next[index] = { ...row, type: value as SchemaFieldType }
															setRows(next)
														}}
													>
														<SelectTrigger className="rounded-none">
															<SelectValue />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="text">text</SelectItem>
															<SelectItem value="number">number</SelectItem>
															<SelectItem value="integer">integer</SelectItem>
															<SelectItem value="boolean">boolean</SelectItem>
															<SelectItem value="enum">enum</SelectItem>
														</SelectContent>
													</Select>
												</div>
												{row.type === 'enum' && (
													<Input
														value={(row.allowedValues ?? []).join(', ')}
														onChange={(event) => {
															const next = [...rows]
															next[index] = {
																...row,
																allowedValues: event.target.value
																	.split(',')
																	.map((value) => value.trim())
																	.filter((value) => value.length > 0),
															}
															setRows(next)
														}}
														placeholder="allowed values, comma-separated"
														className="rounded-none"
													/>
												)}
												<div className="flex items-center justify-between">
													<div className="flex items-center gap-2">
														<Checkbox
															id={requiredId}
															checked={row.required ?? false}
															onCheckedChange={(checked) => {
																const next = [...rows]
																next[index] = { ...row, required: checked === true }
																setRows(next)
															}}
														/>
														<Label htmlFor={requiredId} className="text-xs text-muted-foreground">
															Required
														</Label>
													</div>
													<Button
														size="sm"
														variant="ghost"
														onClick={() => setRows(rows.filter((_, i) => i !== index))}
														className="h-6 rounded-none px-2 text-[11px]"
													>
														Remove
													</Button>
												</div>
											</div>
										)
									})
								)}
								<Button
									size="sm"
									variant="outline"
									onClick={() =>
										setRows([
											...rows,
											{ id: createRowId(), name: '', type: 'text', required: false },
										])
									}
									className="rounded-none"
								>
									Add property
								</Button>
							</div>

							<div className="space-y-2">
								<Label>Allowed geometry types</Label>
								{/* Wrapping flex (not a fixed grid): long labels like
								    "MultiLineString"/"GeometryCollection" stay on one line and
								    flow to the next row instead of clipping/overlapping when the
								    panel is narrow. */}
								<div className="flex flex-wrap gap-x-4 gap-y-2">
									{GROUP_GEOMETRY_TYPES.map((geometryType) => {
										const geometryId = `geometry-${geometryType}`
										return (
											<div key={geometryType} className="flex items-center gap-2">
												<Checkbox
													id={geometryId}
													checked={allowedGeometryTypes.includes(geometryType)}
													onCheckedChange={(checked) =>
														toggleAllowedGeometryType(geometryType, checked === true)
													}
												/>
												<Label
													htmlFor={geometryId}
													className="whitespace-nowrap text-xs text-foreground"
												>
													{geometryType}
												</Label>
											</div>
										)
									})}
								</div>
							</div>
						</TabsContent>

						<TabsContent value="advanced" className="mt-0 space-y-2">
							<Textarea
								value={advancedJson}
								onChange={(event) => setAdvancedJson(event.target.value)}
								rows={12}
								className="rounded-none font-mono text-xs"
							/>
							{effectiveSchema.error && (
								<p className="text-xs text-destructive">
									Schema JSON is invalid: {effectiveSchema.error}. Fix it or switch back to the
									builder.
								</p>
							)}
						</TabsContent>
					</Tabs>

					<div className="space-y-1">
						<Label htmlFor="group-sample">Sample properties</Label>
						<Textarea
							id="group-sample"
							value={sampleJson}
							onChange={(event) => setSampleJson(event.target.value)}
							rows={4}
							className="rounded-none font-mono text-xs"
						/>
						{sampleVerdict && (
							<p
								className={`text-xs ${
									sampleVerdict.status === 'valid'
										? 'text-ok'
										: sampleVerdict.status === 'invalid'
											? 'text-primary'
											: 'text-destructive'
								}`}
							>
								{sampleVerdict.message}
							</p>
						)}
					</div>
				</EntityPanelSurface>
			)}

			<EntityPanelSurface tone="neutral" className="space-y-2">
				{saveError && <p className="text-xs text-destructive">{saveError}</p>}
				{!mobileHeaderActionTarget ? (
					<div className="flex items-center justify-end gap-2">
						<Button variant="outline" onClick={handleDiscardAndClose} className="rounded-none">
							Cancel
						</Button>
						<Button
							onClick={handleSave}
							disabled={isSaving || !currentUser}
							className="rounded-none bg-primary text-primary-foreground"
						>
							{isSaving ? 'Saving…' : isEditing ? 'Save Atlas' : 'Create Atlas'}
						</Button>
					</div>
				) : null}
			</EntityPanelSurface>
		</EntityPanelShell>
	)
}
