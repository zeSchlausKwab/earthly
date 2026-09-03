import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import {
	Camera,
	ExternalLink,
	Eye,
	EyeOff,
	FileText,
	Globe,
	Layers3,
	LocateFixed,
	Map as MapIcon,
	MapPin,
	Maximize2,
	Play,
	Shapes,
	Trash2,
} from 'lucide-react'
import { nip19 } from 'nostr-tools'
import { useState } from 'react'
import {
	extractGeoReferences,
	geoReferenceLabel,
	parseGeoReference,
	stringifyGeoReference,
} from '@/lib/geo/reference'
import { stringifyNostrAddressReference } from '@/lib/nostr/references'
import { ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import {
	parseStoryMarkdown,
	parseStoryViewBlock,
	stringifyStoryViewBlock,
	stringifyStoryViewMarkdownBlock,
	type StoryViewBlockV1,
	type StoryViewLayerPatchV1,
} from '@/lib/map-presentation'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export interface GeoMentionAttrs {
	/** Bare naddr1..., geo: URI, or canonical OpenStreetMap URL. */
	address: string
	/** Optional feature ID within the dataset */
	featureId?: string
	/** Display name for the mention */
	displayName: string
	/** User-visible spatial reference type. Not part of the serialized URI. */
	referenceType?: GeoMentionReferenceType
}

export type GeoMentionReferenceType =
	| 'dataset'
	| 'context'
	| 'feature'
	| 'story'
	| 'coordinate'
	| 'osm'

function inferNostrReferenceType(address: string, featureId?: string): GeoMentionReferenceType {
	if (featureId) return 'feature'
	try {
		const decoded = nip19.decode(address)
		if (decoded.type !== 'naddr') return 'dataset'
		switch (decoded.data.kind) {
			case MAP_CONTEXT_KIND:
				return 'context'
			case ARTICLE_KIND:
				return 'story'
			default:
				return 'dataset'
		}
	} catch {
		return 'dataset'
	}
}

function referenceTypeLabel(type: GeoMentionReferenceType): string {
	if (type === 'osm') return 'OSM'
	return `${type.charAt(0).toUpperCase()}${type.slice(1)}`
}

/** Callbacks for geo mention interactions */
export interface GeoMentionCallbacks {
	onVisibilityToggle?: (address: string, featureId: string | undefined, visible: boolean) => void
	onZoomTo?: (address: string, featureId: string | undefined) => void
}

/** Options for configuring the GeoMentionNode extension */
export interface GeoMentionNodeOptions {
	callbacks?: GeoMentionCallbacks
}

/**
 * React component for rendering geo mentions in the TipTap editor.
 * Shows visibility, zoom, and optionally delete buttons.
 */
function GeoMentionNodeView({ node, deleteNode, editor }: NodeViewProps) {
	const attrs = node.attrs as GeoMentionAttrs
	const { address, featureId, displayName } = attrs
	const reference = parseGeoReference(
		address.startsWith('naddr1') ? stringifyNostrAddressReference({ address, featureId }) : address,
	)
	const isOsmReference = reference?.kind === 'osm'
	const isCoordinateReference = reference?.kind === 'coordinate'
	const referenceType: GeoMentionReferenceType =
		attrs.referenceType ??
		(isCoordinateReference
			? 'coordinate'
			: isOsmReference
				? 'osm'
				: inferNostrReferenceType(address, featureId))
	const typeLabel = referenceTypeLabel(referenceType)
	const referenceText = reference
		? stringifyGeoReference(reference)
		: stringifyNostrAddressReference({ address, featureId })

	// Get callbacks from extension storage (type-safe access)
	const extension = editor.extensionManager.extensions.find((ext) => ext.name === 'geoMention')
	const callbacks = (extension?.storage?.callbacks ?? extension?.options?.callbacks) as
		| GeoMentionCallbacks
		| undefined
	const isEditable = editor.isEditable

	// Local visibility state for UI feedback
	const [isVisible, setIsVisible] = useState(false)

	const handleToggleVisibility = () => {
		const newVisible = !isVisible
		setIsVisible(newVisible)
		callbacks?.onVisibilityToggle?.(address, featureId, newVisible)
	}

	const handleZoomTo = () => {
		callbacks?.onZoomTo?.(address, featureId)
	}

	const referenceIcon = (() => {
		switch (referenceType) {
			case 'coordinate':
				return <LocateFixed className="h-3 w-3 flex-shrink-0" />
			case 'dataset':
				return <Layers3 className="h-3 w-3 flex-shrink-0" />
			case 'feature':
				return <Shapes className="h-3 w-3 flex-shrink-0" />
			case 'osm':
				return <MapIcon className="h-3 w-3 flex-shrink-0" />
			case 'context':
				return <Globe className="h-3 w-3 flex-shrink-0" />
			case 'story':
				return <FileText className="h-3 w-3 flex-shrink-0" />
			default:
				return <MapPin className="h-3 w-3 flex-shrink-0" />
		}
	})()

	return (
		<NodeViewWrapper as="span" className="inline">
			<span
				className="mx-0.5 inline-flex items-center gap-1 border border-info/40 bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info"
				data-reference-type={typeLabel}
				contentEditable={false}
			>
				{referenceIcon}
				<span className="border-r border-info/30 pr-1 text-[8px] font-semibold uppercase tracking-[0.1em] opacity-80">
					{typeLabel}
				</span>
				<span className="truncate max-w-[120px]" title={referenceText}>
					{displayName}
				</span>

				{/* Visibility Toggle - always shown if callback exists */}
				{callbacks?.onVisibilityToggle && !isOsmReference && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={handleToggleVisibility}
								className={`h-4 w-4 p-0 ${isVisible ? 'text-info' : 'text-muted-foreground'} hover:text-info`}
							>
								{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{isVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
					</Tooltip>
				)}

				{/* Zoom Button - always shown if callback exists */}
				{callbacks?.onZoomTo && !isOsmReference && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={handleZoomTo}
								className="h-4 w-4 p-0 text-muted-foreground hover:text-info"
							>
								<Maximize2 className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Zoom to feature</TooltipContent>
					</Tooltip>
				)}

				{isOsmReference && (
					<Tooltip>
						<TooltipTrigger asChild>
							<a
								href={referenceText}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-4 w-4 items-center justify-center text-muted-foreground hover:text-info"
							>
								<ExternalLink className="h-3 w-3" />
							</a>
						</TooltipTrigger>
						<TooltipContent>Open on OpenStreetMap</TooltipContent>
					</Tooltip>
				)}

				{/* Delete Button - only in edit mode */}
				{isEditable && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={deleteNode}
								className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
							>
								<span className="text-xs">×</span>
							</Button>
						</TooltipTrigger>
						<TooltipContent>Remove mention</TooltipContent>
					</Tooltip>
				)}
			</span>
		</NodeViewWrapper>
	)
}

/**
 * TipTap extension for geo mentions.
 * Renders as inline chips with visibility/zoom/delete controls.
 */
export const GeoMentionNode = Node.create<GeoMentionNodeOptions>({
	name: 'geoMention',
	group: 'inline',
	inline: true,
	selectable: true,
	atom: true,

	addOptions() {
		return {
			callbacks: undefined,
		}
	},

	addStorage() {
		return {
			callbacks: this.options.callbacks,
		}
	},

	addAttributes() {
		return {
			address: {
				default: null,
			},
			featureId: {
				default: null,
			},
			referenceType: {
				default: null,
			},
			displayName: {
				default: 'Unknown',
			},
		}
	},

	parseHTML() {
		return [
			{
				tag: 'span[data-geo-mention]',
			},
		]
	},

	renderHTML({ HTMLAttributes }) {
		return [
			'span',
			mergeAttributes(HTMLAttributes, { 'data-geo-mention': '' }),
			HTMLAttributes.displayName || 'Unknown',
		]
	},

	addNodeView() {
		return ReactNodeViewRenderer(GeoMentionNodeView)
	},
})

export interface StoryViewCapture {
	camera?: StoryViewBlockV1['camera']
	layers?: Readonly<Record<string, StoryViewLayerPatchV1>>
}

export interface StoryViewNodeCallbacks {
	onCapture?: () => StoryViewCapture | null | undefined
	onActivate?: (view: StoryViewBlockV1) => void
}

export interface StoryViewNodeOptions {
	callbacks?: StoryViewNodeCallbacks
}

function readStoryViewAttr(value: unknown): StoryViewBlockV1 | null {
	if (typeof value !== 'string') return null
	try {
		const parsed = parseStoryViewBlock(JSON.parse(value))
		return parsed.status === 'valid' ? parsed.value : null
	} catch {
		return null
	}
}

function StoryViewNodeView({ node, deleteNode, editor, updateAttributes }: NodeViewProps) {
	const view = readStoryViewAttr(node.attrs.value)
	if (!view) return null
	const extension = editor.extensionManager.extensions.find((entry) => entry.name === 'storyView')
	const callbacks = (extension?.storage?.callbacks ?? extension?.options?.callbacks) as
		| StoryViewNodeCallbacks
		| undefined
	const updateView = (patch: Partial<StoryViewBlockV1>) => {
		const candidate = { ...view, ...patch }
		const parsed = parseStoryViewBlock(candidate)
		if (parsed.status !== 'valid') return
		updateAttributes({ value: stringifyStoryViewBlock(parsed.value) })
	}
	const updateCaption = (caption: string) => {
		const { caption: _caption, ...withoutCaption } = view
		const candidate = caption.trim() ? { ...withoutCaption, caption } : withoutCaption
		const parsed = parseStoryViewBlock(candidate)
		if (parsed.status !== 'valid') return
		updateAttributes({ value: stringifyStoryViewBlock(parsed.value) })
	}
	const layerPatchCount = Object.keys(view.layers ?? {}).length

	return (
		<NodeViewWrapper
			as="section"
			className="my-2 border border-primary/40 bg-primary/5 p-3"
			data-story-view=""
			contentEditable={false}
		>
			<div className="flex items-start gap-2">
				<div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center border border-primary/30 bg-background text-primary">
					<MapIcon className="h-4 w-4" />
				</div>
				<div className="min-w-0 flex-1 space-y-2">
					<div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
						<label className="space-y-1">
							<span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
								View title
							</span>
							<input
								value={view.title}
								disabled={!editor.isEditable}
								onChange={(event) => updateView({ title: event.target.value || 'Untitled view' })}
								className="h-8 w-full border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-70"
							/>
						</label>
						<label className="space-y-1">
							<span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
								Display
							</span>
							<select
								value={view.display}
								disabled={!editor.isEditable}
								onChange={(event) =>
									updateView({ display: event.target.value as StoryViewBlockV1['display'] })
								}
								className="h-8 w-full border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-70"
							>
								<option value="cue">Main map</option>
								<option value="figure">Figure</option>
								<option value="both">Both</option>
							</select>
						</label>
					</div>
					<label className="space-y-1">
						<span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
							Caption
						</span>
						<input
							value={view.caption ?? ''}
							disabled={!editor.isEditable}
							onChange={(event) => updateCaption(event.target.value)}
							placeholder="Optional figure caption"
							className="h-8 w-full border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-primary disabled:opacity-70"
						/>
					</label>
					<div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<Camera className="h-3 w-3" />
							{view.camera ? `Zoom ${view.camera.zoom.toFixed(1)}` : 'Camera inherited'}
						</span>
						<span className="inline-flex items-center gap-1">
							<Layers3 className="h-3 w-3" />
							{layerPatchCount} layer change{layerPatchCount === 1 ? '' : 's'}
						</span>
					</div>
					<div className="flex flex-wrap items-center gap-2">
						{callbacks?.onCapture && editor.isEditable && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 gap-1 rounded-none px-2 text-[10px]"
								onClick={() => {
									const captured = callbacks.onCapture?.()
									if (!captured) return
									updateView({
										...(captured.camera ? { camera: captured.camera } : {}),
										...(captured.layers ? { layers: captured.layers } : {}),
									})
								}}
							>
								<Camera className="h-3 w-3" />
								Capture current map
							</Button>
						)}
						{callbacks?.onActivate && (
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="h-7 gap-1 rounded-none px-2 text-[10px]"
								onClick={() => callbacks.onActivate?.(view)}
							>
								<Play className="h-3 w-3" />
								Apply view
							</Button>
						)}
					</div>
				</div>
				{editor.isEditable && (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						className="h-7 w-7 flex-shrink-0 rounded-none text-muted-foreground hover:text-destructive"
						onClick={deleteNode}
						aria-label="Remove Story view"
					>
						<Trash2 className="h-3.5 w-3.5" />
					</Button>
				)}
			</div>
		</NodeViewWrapper>
	)
}

/** Physical block node for canonical fenced `earthly-view` JSON. */
export const StoryViewNode = Node.create<StoryViewNodeOptions>({
	name: 'storyView',
	group: 'block',
	atom: true,
	selectable: true,
	draggable: true,

	addOptions() {
		return { callbacks: undefined }
	},

	addStorage() {
		return { callbacks: this.options.callbacks }
	},

	addAttributes() {
		return { value: { default: null } }
	},

	parseHTML() {
		return [{ tag: 'section[data-story-view]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['section', mergeAttributes(HTMLAttributes, { 'data-story-view': '' })]
	},

	addNodeView() {
		return ReactNodeViewRenderer(StoryViewNodeView)
	},
})

/** TipTap JSON node structure */
export interface TipTapNode {
	type: string
	content?: TipTapNode[]
	text?: string
	attrs?: Record<string, unknown>
}

function resolveMentionDisplayName(
	address: string,
	featureId: string | null,
	nameResolver?: (address: string) => string | undefined,
): string {
	if (featureId) {
		return `Feature: ${featureId}`
	}
	if (nameResolver) {
		return nameResolver(address) ?? 'Map'
	}
	return 'Map'
}

function parseInlineContent(
	text: string,
	nameResolver?: (address: string) => string | undefined,
): TipTapNode[] | undefined {
	if (!text) return undefined

	const content: TipTapNode[] = []
	let lastIndex = 0
	for (const match of extractGeoReferences(text)) {
		const matchIndex = match.start
		const address =
			match.reference.kind === 'nostr'
				? match.reference.address
				: stringifyGeoReference(match.reference)
		const featureId = match.reference.kind === 'nostr' ? (match.reference.featureId ?? null) : null

		if (matchIndex > lastIndex) {
			content.push({
				type: 'text',
				text: text.slice(lastIndex, matchIndex),
			})
		}

		content.push({
			type: 'geoMention',
			attrs: {
				address,
				featureId,
				referenceType:
					match.reference.kind === 'nostr'
						? inferNostrReferenceType(address, featureId ?? undefined)
						: match.reference.kind,
				displayName:
					match.reference.kind === 'nostr'
						? resolveMentionDisplayName(address, featureId, nameResolver)
						: geoReferenceLabel(match.reference),
			},
		})

		lastIndex = match.end
	}

	if (lastIndex < text.length) {
		content.push({
			type: 'text',
			text: text.slice(lastIndex),
		})
	}

	return content.length > 0 ? content : undefined
}

/**
 * Converts editor content to plain text with nostr: mentions.
 * Following NIP-27 format: nostr:naddr1...#featureId
 */
export function serializeToText(json: TipTapNode | null): string {
	if (!json?.content) return ''

	const processNode = (node: TipTapNode): string => {
		if (node.type === 'text') {
			return node.text || ''
		}

		if (node.type === 'geoMention') {
			const address = node.attrs?.address as string
			const featureId = node.attrs?.featureId as string | undefined
			if (address.startsWith('naddr1')) {
				return stringifyNostrAddressReference({ address, featureId })
			}
			const reference = parseGeoReference(address)
			return reference ? stringifyGeoReference(reference) : address
		}

		if (node.type === 'storyView') {
			const view = readStoryViewAttr(node.attrs?.value)
			return view ? stringifyStoryViewMarkdownBlock(view) : ''
		}

		if (node.type === 'paragraph') {
			const content = node.content?.map(processNode).join('') || ''
			return content
		}

		if (node.type === 'doc') {
			return node.content?.map(processNode).join('\n') || ''
		}

		// Handle other nodes by processing their content
		if (node.content) {
			return node.content.map(processNode).join('')
		}

		return ''
	}

	return processNode(json)
}

/**
 * Parses plain text with nostr: mentions back to TipTap JSON.
 * @param text The text to parse
 * @param nameResolver Optional function to resolve display names from naddr addresses
 */
export function parseFromText(
	text: string,
	nameResolver?: (address: string) => string | undefined,
): TipTapNode {
	const lines = text.length > 0 ? text.split('\n') : ['']
	const validViewsByLine = new Map<
		number,
		{ readonly endLine: number; readonly view: StoryViewBlockV1 }
	>()
	const opaqueViewLineRanges: Array<{ readonly startLine: number; readonly endLine: number }> = []
	for (const occurrence of parseStoryMarkdown(text).views) {
		const startLine = text.slice(0, occurrence.start).split('\n').length - 1
		const endLine = text.slice(0, occurrence.end).split('\n').length - 1
		if (occurrence.result.status === 'valid') {
			validViewsByLine.set(startLine, { endLine, view: occurrence.result.value })
		} else {
			opaqueViewLineRanges.push({ startLine, endLine })
		}
	}

	const content: TipTapNode[] = []
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const physicalView = validViewsByLine.get(lineIndex)
		if (physicalView) {
			content.push({
				type: 'storyView',
				attrs: { value: stringifyStoryViewBlock(physicalView.view) },
			})
			lineIndex = physicalView.endLine
			continue
		}
		const paragraph = lines[lineIndex] ?? ''
		const isOpaqueViewSource = opaqueViewLineRanges.some(
			(range) => lineIndex >= range.startLine && lineIndex <= range.endLine,
		)
		content.push({
			type: 'paragraph',
			content: isOpaqueViewSource
				? paragraph
					? [{ type: 'text', text: paragraph }]
					: undefined
				: parseInlineContent(paragraph, nameResolver),
		})
	}

	return {
		type: 'doc',
		content,
	}
}
