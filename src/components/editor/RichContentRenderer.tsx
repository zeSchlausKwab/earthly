import { ExternalLink, Eye, EyeOff, LocateFixed, MapPin, Maximize2, Play, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { geoReferenceLabel, parseGeoReference, stringifyGeoReference } from '@/lib/geo/reference'
import { parseMarkdownTableAt, type MarkdownTableAlignment } from '@/lib/markdown/table'
import { decodeNostrFeatureId, stringifyNostrAddressReference } from '@/lib/nostr/references'
import { parseStoryViewBlock, type StoryViewBlockV1 } from '@/lib/map-presentation'
import type { GeoFeatureItem } from './GeoRichTextEditor'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export interface RichContentRendererProps {
	content: string
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	isMentionVisible?: (address: string, featureId: string | undefined) => boolean
	className?: string
	emptyState?: string | null
	/** Apply a driving cue/both view to the shared main canvas. */
	onStoryViewActivate?: (view: StoryViewBlockV1, index: number) => void
	/** Render the live in-flow map for figure/both views using the caller's map runtime. */
	renderStoryViewFigure?: (view: StoryViewBlockV1, index: number) => ReactNode
	activeStoryViewId?: string | null
}

interface InlineTokenBase {
	value: string
	/** Nested inline tokens (strong/emphasis wrap other inline content, incl. mentions) */
	children?: InlineToken[]
}

interface BaseInlineToken extends InlineTokenBase {
	type: 'text' | 'strong' | 'emphasis' | 'code'
}

interface MentionInlineToken extends InlineTokenBase {
	type: 'mention'
	address: string
	featureId?: string
	displayName?: string
}

interface LinkInlineToken extends InlineTokenBase {
	type: 'link'
	url: string
}

type InlineToken = BaseInlineToken | MentionInlineToken | LinkInlineToken

interface ParagraphBlock {
	type: 'paragraph'
	tokens: InlineToken[]
}

interface HeadingBlock {
	type: 'heading'
	level: number
	tokens: InlineToken[]
}

interface QuoteBlock {
	type: 'quote'
	tokens: InlineToken[]
}

interface ListBlock {
	type: 'list'
	ordered: boolean
	items: InlineToken[][]
}

interface CodeBlock {
	type: 'codeblock'
	code: string
}

interface StoryViewContentBlock {
	type: 'story-view'
	view: StoryViewBlockV1
	viewIndex: number
}

interface MediaBlock {
	type: 'image' | 'video' | 'youtube'
	url: string
	label?: string
}

interface TableBlock {
	type: 'table'
	header: InlineToken[][]
	alignments: MarkdownTableAlignment[]
	rows: InlineToken[][][]
}

type ContentBlock =
	| ParagraphBlock
	| HeadingBlock
	| QuoteBlock
	| ListBlock
	| CodeBlock
	| StoryViewContentBlock
	| MediaBlock
	| TableBlock

const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?.*)?$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|m4v)(\?.*)?$/i
const VIDEO_HOSTS = [
	/video\.nostr\.build/i,
	/v\.nostr\.build/i,
	/cdn\.satellite\.earth.*\.(mp4|webm)/i,
]
const YOUTUBE_PATTERNS = [
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtu\.be\/[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/[a-zA-Z0-9_-]{11}/i,
	/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/[a-zA-Z0-9_-]{11}/i,
]
const MEDIA_LINE_PATTERN = /^(https?:\/\/[^\s<>"{}|\\^`[\]]+)$/i
const LABELED_MEDIA_PATTERN = /^(image|video|media)\s*:\s*(https?:\/\/[^\s<>"{}|\\^`[\]]+)\s*$/i
const MEDIA_LABEL_ONLY_PATTERN = /^(image|video|media)\s*:\s*$/i
const MARKDOWN_IMAGE_PATTERN = /^!\[([^\]]*)\]\((https?:\/\/[^\s<>"{}|\\^`()[\]]+)\)\s*$/i
const TOKEN_PATTERN =
	/(?<mentionLink>\[(?<mentionLinkLabel>[^\]]+)\]\(nostr:(?<mentionLinkAddress>naddr1[a-z0-9]+)(?:#(?<mentionLinkFeatureId>[a-zA-Z0-9_%~-]+))?\))|(?<spatial>geo:[+-]?(?:\d+(?:\.\d+)?|\.\d+),[+-]?(?:\d+(?:\.\d+)?|\.\d+)|https?:\/\/(?:www\.)?openstreetmap\.org\/(?:node|way|relation)\/\d+\/?)|(?<link>\[(?<linkLabel>[^\]]+)\]\((?<linkUrl>https?:\/\/[^\s)]+)\))|(?<mention>nostr:(?<mentionAddress>naddr1[a-z0-9]+)(?:#(?<mentionFeatureId>[a-zA-Z0-9_%~-]+))?)|(?<url>https?:\/\/[^\s<>"{}|\\^`[\]]+)|(?<code>`[^`]+`)|(?<strong>\*\*[^*]+\*\*)|(?<emphasis>\*[^*\n]+\*)/gi

function detectMediaType(url: string): 'image' | 'video' | 'youtube' | 'link' {
	for (const pattern of YOUTUBE_PATTERNS) {
		if (pattern.test(url)) return 'youtube'
	}

	for (const pattern of VIDEO_HOSTS) {
		if (pattern.test(url)) return 'video'
	}

	if (IMAGE_EXTENSIONS.test(url)) return 'image'
	if (VIDEO_EXTENSIONS.test(url)) return 'video'
	return 'link'
}

function getYouTubeEmbedUrl(url: string): string | null {
	const patterns = [
		/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
	]

	for (const pattern of patterns) {
		const match = url.match(pattern)
		if (match?.[1]) {
			return `https://www.youtube-nocookie.com/embed/${match[1]}`
		}
	}

	return null
}

function resolveMentionLabel(
	address: string,
	featureId: string | undefined,
	availableFeatures: GeoFeatureItem[],
): string {
	if (featureId) {
		const exactMatch = availableFeatures.find(
			(feature) => feature.address === address && feature.featureId === featureId,
		)
		return exactMatch?.name ?? `Feature ${featureId}`
	}

	const match = availableFeatures.find((feature) => feature.address === address)
	return match?.name ?? 'Reference'
}

export function parseInlineTokens(
	text: string,
	availableFeatures: GeoFeatureItem[],
): InlineToken[] {
	if (!text) return []

	const tokens: InlineToken[] = []
	let cursor = 0
	const matches = Array.from(text.matchAll(TOKEN_PATTERN))

	for (const match of matches) {
		const matchedValue = match[0]
		if (!matchedValue) continue
		const groups = match.groups ?? {}

		if (match.index > cursor) {
			tokens.push({
				type: 'text',
				value: text.slice(cursor, match.index),
			})
		}

		if (groups.mentionLink && groups.mentionLinkAddress) {
			// Markdown link targeting a nostr reference: [Anchorage lanes](nostr:naddr1…#feat)
			const address = groups.mentionLinkAddress
			const featureId = groups.mentionLinkFeatureId
				? (decodeNostrFeatureId(groups.mentionLinkFeatureId) ?? undefined)
				: undefined
			const label = groups.mentionLinkLabel?.trim()
			const displayName =
				label && !/^nostr:naddr1/i.test(label)
					? label
					: resolveMentionLabel(address, featureId, availableFeatures)
			tokens.push({
				type: 'mention',
				value: matchedValue,
				address,
				featureId,
				displayName,
			})
		} else if (groups.spatial) {
			const reference = parseGeoReference(groups.spatial)
			if (reference) {
				tokens.push({
					type: 'mention',
					value: matchedValue,
					address: stringifyGeoReference(reference),
					displayName: geoReferenceLabel(reference),
				})
			}
		} else if (groups.link && groups.linkUrl) {
			tokens.push({
				type: 'link',
				value: groups.linkLabel ?? groups.link,
				url: groups.linkUrl,
			})
		} else if (groups.mention && groups.mentionAddress) {
			const address = groups.mentionAddress
			const featureId = groups.mentionFeatureId
				? (decodeNostrFeatureId(groups.mentionFeatureId) ?? undefined)
				: undefined
			tokens.push({
				type: 'mention',
				value: matchedValue,
				address,
				featureId,
				displayName: resolveMentionLabel(address, featureId, availableFeatures),
			})
		} else if (groups.url) {
			const cleanUrl = groups.url.replace(/[.,;:!?)]+$/, '')
			tokens.push({
				type: 'link',
				value: cleanUrl,
				url: cleanUrl,
			})
		} else if (groups.code) {
			const codeValue = groups.code.slice(1, -1)
			// AI-composed prose habitually wraps references in backticks
			// (`nostr:naddr1…`). A code span that is EXACTLY one reference renders
			// as the mention pill; mixed-content code spans stay code.
			const trimmedCode = codeValue.trim()
			const parsedCodeReference = parseGeoReference(
				trimmedCode.startsWith('naddr1') ? `nostr:${trimmedCode}` : trimmedCode,
			)
			if (parsedCodeReference) {
				const address =
					parsedCodeReference.kind === 'nostr'
						? parsedCodeReference.address
						: stringifyGeoReference(parsedCodeReference)
				const featureId =
					parsedCodeReference.kind === 'nostr' ? parsedCodeReference.featureId : undefined
				tokens.push({
					type: 'mention',
					value: matchedValue,
					address,
					featureId,
					displayName:
						parsedCodeReference.kind === 'nostr'
							? resolveMentionLabel(address, featureId, availableFeatures)
							: geoReferenceLabel(parsedCodeReference),
				})
			} else {
				tokens.push({
					type: 'code',
					value: codeValue,
				})
			}
		} else if (groups.strong) {
			const inner = groups.strong.slice(2, -2)
			tokens.push({
				type: 'strong',
				value: inner,
				children: parseInlineTokens(inner, availableFeatures),
			})
		} else if (groups.emphasis) {
			const inner = groups.emphasis.slice(1, -1)
			tokens.push({
				type: 'emphasis',
				value: inner,
				children: parseInlineTokens(inner, availableFeatures),
			})
		}

		cursor = match.index + matchedValue.length
	}

	if (cursor < text.length) {
		tokens.push({
			type: 'text',
			value: text.slice(cursor),
		})
	}

	return tokens
}

function pushParagraph(
	lines: string[],
	blocks: ContentBlock[],
	availableFeatures: GeoFeatureItem[],
) {
	if (lines.length === 0) return
	blocks.push({
		type: 'paragraph',
		tokens: parseInlineTokens(lines.join(' '), availableFeatures),
	})
	lines.length = 0
}

function takeTrailingMediaLabel(lines: string[]): string | undefined {
	const lastLine = lines.at(-1)?.trim()
	if (!lastLine) return undefined
	const match = lastLine.match(MEDIA_LABEL_ONLY_PATTERN)
	if (!match?.[1]) return undefined
	lines.pop()
	return match[1]
}

function parseContent(text: string, availableFeatures: GeoFeatureItem[]): ContentBlock[] {
	const trimmed = text.trim()
	if (!trimmed) return []

	const lines = text.split('\n')
	const blocks: ContentBlock[] = []
	const paragraphLines: string[] = []
	let activeList: ListBlock | null = null
	let inCodeBlock = false
	let codeFence: { marker: '`' | '~'; length: number; language: string } | null = null
	const codeLines: string[] = []
	let storyViewIndex = 0

	const flushList = () => {
		if (activeList) {
			blocks.push(activeList)
			activeList = null
		}
	}

	const flushCodeBlock = (closed: boolean) => {
		if (!inCodeBlock) return
		let parsedAsView = false
		if (closed && codeFence?.language === 'earthly-view') {
			try {
				const parsed = parseStoryViewBlock(JSON.parse(codeLines.join('\n').trim()))
				if (parsed.status === 'valid') {
					blocks.push({ type: 'story-view', view: parsed.value, viewIndex: storyViewIndex })
					storyViewIndex += 1
					parsedAsView = true
				}
			} catch {
				// Malformed/future view blocks remain visible as inert code, never as map commands.
			}
		}
		if (!parsedAsView) {
			blocks.push({
				type: 'codeblock',
				code: codeLines.join('\n'),
			})
		}
		inCodeBlock = false
		codeFence = null
		codeLines.length = 0
	}

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
		const rawLine = lines[lineIndex] ?? ''
		const line = rawLine.trimEnd()
		const trimmedLine = line.trim()

		if (inCodeBlock) {
			const closingRun = trimmedLine.match(/^(`+|~+)$/u)?.[1]
			if (
				closingRun &&
				codeFence &&
				closingRun[0] === codeFence.marker &&
				closingRun.length >= codeFence.length
			) {
				flushCodeBlock(true)
				continue
			}
			codeLines.push(line)
			continue
		}

		const opening = trimmedLine.match(/^(`{3,}|~{3,})(.*)$/u)
		const openingRun = opening?.[1]
		const openingMarker = openingRun?.[0]
		const openingInfo = (opening?.[2] ?? '').trim()
		if (
			openingRun &&
			(openingMarker === '`' || openingMarker === '~') &&
			!(openingMarker === '`' && openingInfo.includes('`'))
		) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			inCodeBlock = true
			codeFence = {
				marker: openingMarker,
				length: openingRun.length,
				language: openingInfo.split(/\s+/u)[0]?.toLowerCase() ?? '',
			}
			continue
		}

		if (!trimmedLine) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			continue
		}

		const table = parseMarkdownTableAt(lines, lineIndex)
		if (table) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			blocks.push({
				type: 'table',
				header: table.header.map((cell) => parseInlineTokens(cell, availableFeatures)),
				alignments: table.alignments,
				rows: table.rows.map((row) =>
					row.map((cell) => parseInlineTokens(cell, availableFeatures)),
				),
			})
			lineIndex = table.endIndex
			continue
		}

		const labeledMediaMatch = trimmedLine.match(LABELED_MEDIA_PATTERN)
		if (labeledMediaMatch?.[1] && labeledMediaMatch[2]) {
			const mediaType = detectMediaType(labeledMediaMatch[2])
			if (mediaType !== 'link') {
				pushParagraph(paragraphLines, blocks, availableFeatures)
				flushList()
				blocks.push({
					type: mediaType,
					url: labeledMediaMatch[2],
					label: labeledMediaMatch[1],
				})
				continue
			}
		}

		const markdownImageMatch = trimmedLine.match(MARKDOWN_IMAGE_PATTERN)
		if (markdownImageMatch?.[2]) {
			const mediaType = detectMediaType(markdownImageMatch[2])
			if (mediaType !== 'link') {
				const mediaLabel = takeTrailingMediaLabel(paragraphLines)
				pushParagraph(paragraphLines, blocks, availableFeatures)
				flushList()
				blocks.push({
					type: mediaType,
					url: markdownImageMatch[2],
					label: mediaLabel ?? markdownImageMatch[1] ?? undefined,
				})
				continue
			}
		}

		const mediaMatch = trimmedLine.match(MEDIA_LINE_PATTERN)
		if (mediaMatch?.[1]) {
			const mediaType = detectMediaType(mediaMatch[1])
			if (mediaType !== 'link') {
				const mediaLabel = takeTrailingMediaLabel(paragraphLines)
				pushParagraph(paragraphLines, blocks, availableFeatures)
				flushList()
				blocks.push({
					type: mediaType,
					url: mediaMatch[1],
					label: mediaLabel,
				})
				continue
			}
		}

		const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
		if (headingMatch?.[1] && headingMatch[2]) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			blocks.push({
				type: 'heading',
				level: headingMatch[1].length,
				tokens: parseInlineTokens(headingMatch[2], availableFeatures),
			})
			continue
		}

		const quoteMatch = trimmedLine.match(/^>\s?(.*)$/)
		if (quoteMatch) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			blocks.push({
				type: 'quote',
				tokens: parseInlineTokens(quoteMatch[1] ?? '', availableFeatures),
			})
			continue
		}

		const orderedListMatch = trimmedLine.match(/^\d+\.\s+(.+)$/)
		const unorderedListMatch = trimmedLine.match(/^[-*]\s+(.+)$/)
		const listItemText = orderedListMatch?.[1] ?? unorderedListMatch?.[1]
		if (listItemText) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			const ordered = Boolean(orderedListMatch)
			if (!activeList || activeList.ordered !== ordered) {
				flushList()
				activeList = {
					type: 'list',
					ordered,
					items: [],
				}
			}
			activeList.items.push(parseInlineTokens(listItemText, availableFeatures))
			continue
		}

		flushList()
		paragraphLines.push(trimmedLine)
	}

	pushParagraph(paragraphLines, blocks, availableFeatures)
	flushList()
	flushCodeBlock(false)

	return blocks
}

function tokenKey(token: InlineToken): string {
	const base = `${token.type}:${token.value}`
	if (token.type === 'mention') {
		return `${base}:${token.address}:${token.featureId ?? ''}`
	}
	if (token.type === 'link') {
		return `${base}:${token.url}`
	}
	return base
}

type MentionCallbacks = Pick<
	RichContentRendererProps,
	'onMentionVisibilityToggle' | 'onMentionZoomTo' | 'isMentionVisible'
>

function renderInlineToken(token: InlineToken, callbacks: MentionCallbacks) {
	if (token.type === 'text') {
		return (
			<span key={tokenKey(token)} className="whitespace-pre-wrap break-words">
				{token.value}
			</span>
		)
	}

	if (token.type === 'strong') {
		return (
			<strong key={tokenKey(token)} className="font-semibold text-foreground">
				{token.children?.length ? renderInlineTokens(token.children, callbacks) : token.value}
			</strong>
		)
	}

	if (token.type === 'emphasis') {
		return (
			<em key={tokenKey(token)} className="italic">
				{token.children?.length ? renderInlineTokens(token.children, callbacks) : token.value}
			</em>
		)
	}

	if (token.type === 'code') {
		return (
			<code
				key={tokenKey(token)}
				className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
			>
				{token.value}
			</code>
		)
	}

	if (token.type === 'link') {
		return (
			<a
				key={tokenKey(token)}
				href={token.url}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1 break-all text-info underline underline-offset-2 hover:text-info"
			>
				<span>{token.value}</span>
				<ExternalLink className="h-3 w-3 flex-shrink-0" />
			</a>
		)
	}

	if (token.type === 'mention') {
		return <GeoMentionChip key={tokenKey(token)} token={token} {...callbacks} />
	}
	return null
}

function GeoMentionChip({
	token,
	onMentionVisibilityToggle,
	onMentionZoomTo,
	isMentionVisible,
}: { token: MentionInlineToken } & MentionCallbacks) {
	const [localVisible, setLocalVisible] = useState(false)
	const address = token.address ?? ''
	const featureId = token.featureId
	const reference = parseGeoReference(
		address.startsWith('naddr1') ? stringifyNostrAddressReference({ address, featureId }) : address,
	)
	const isOsmReference = reference?.kind === 'osm'
	const isCoordinateReference = reference?.kind === 'coordinate'
	const isVisible = isMentionVisible?.(address, featureId) ?? localVisible

	const handleToggle = () => {
		const next = !isVisible
		setLocalVisible(next)
		onMentionVisibilityToggle?.(address, featureId, next)
	}

	return (
		<span className="mx-0.5 inline-flex items-center gap-0.5 rounded-md border border-info/40 bg-info/15 px-1.5 py-0.5 align-middle text-xs font-medium text-info">
			{isCoordinateReference ? (
				<LocateFixed className="h-3 w-3 flex-shrink-0" />
			) : (
				<MapPin className="h-3 w-3 flex-shrink-0" />
			)}
			<span className="max-w-[180px] truncate" title={address}>
				{token.displayName ?? 'Reference'}
			</span>
			{onMentionVisibilityToggle && !isOsmReference && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={handleToggle}
							aria-label={
								isVisible ? 'Hide referenced geometry on map' : 'Show referenced geometry on map'
							}
							className={`h-4 w-4 p-0 ${isVisible ? 'text-info' : 'text-muted-foreground'} hover:text-info`}
						>
							{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
				</Tooltip>
			)}
			{onMentionZoomTo && !isOsmReference && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={() => onMentionZoomTo?.(address, featureId)}
							aria-label="Zoom to referenced geometry"
							className="h-4 w-4 p-0 text-muted-foreground hover:text-info"
						>
							<Maximize2 className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Zoom to feature</TooltipContent>
				</Tooltip>
			)}
			{isOsmReference && reference && (
				<Tooltip>
					<TooltipTrigger asChild>
						<a
							href={stringifyGeoReference(reference)}
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
		</span>
	)
}

function renderMediaBlock(block: MediaBlock, index: number, onImageOpen?: (url: string) => void) {
	const label = block.label ? `${block.label.charAt(0).toUpperCase()}${block.label.slice(1)}` : null

	if (block.type === 'image') {
		return (
			<div key={`image-${index}`} className="space-y-2">
				{label && (
					<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
						{label}
					</div>
				)}
				<button
					type="button"
					onClick={() => onImageOpen?.(block.url)}
					className="block w-full overflow-hidden rounded-xl border border-primary/40 bg-primary/10 text-left"
				>
					<img
						src={block.url}
						alt=""
						loading="lazy"
						className="block max-h-[320px] w-full object-contain"
					/>
				</button>
			</div>
		)
	}

	if (block.type === 'youtube') {
		const embedUrl = getYouTubeEmbedUrl(block.url)
		if (embedUrl) {
			return (
				<div key={`youtube:${block.url}:${index}`} className="space-y-2">
					{label && (
						<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							{label}
						</div>
					)}
					<div className="overflow-hidden rounded-xl border border-border bg-black">
						<div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
							<iframe
								src={embedUrl}
								title="Embedded video"
								className="absolute inset-0 h-full w-full"
								allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
								allowFullScreen
							/>
						</div>
					</div>
				</div>
			)
		}
	}

	if (block.type === 'video' || block.type === 'youtube') {
		return (
			<div key={`video:${block.url}:${index}`} className="space-y-2">
				{label && (
					<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
						{label}
					</div>
				)}
				<div className="overflow-hidden rounded-xl border border-border bg-background p-1">
					<video src={block.url} controls className="block max-h-[320px] w-full rounded-lg">
						<track kind="captions" />
					</video>
				</div>
			</div>
		)
	}

	return (
		<a
			key={`fallback-${index}`}
			href={block.url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 text-info underline underline-offset-2"
		>
			<Play className="h-3.5 w-3.5" />
			<span>{block.url}</span>
		</a>
	)
}

function renderInlineTokens(tokens: InlineToken[], callbacks: MentionCallbacks) {
	return tokens.map((token) => renderInlineToken(token, callbacks))
}

function storyViewSummary(view: StoryViewBlockV1): string {
	const shown: string[] = []
	const hidden: string[] = []
	let styled = 0
	for (const [layerId, patch] of Object.entries(view.layers ?? {})) {
		if (patch.visible === true) shown.push(layerId)
		if (patch.visible === false) hidden.push(layerId)
		if (patch.opacityMultiplier !== undefined || patch.style) styled += 1
	}
	return [
		shown.length > 0 ? `Shows ${shown.join(', ')}` : '',
		hidden.length > 0 ? `Hides ${hidden.join(', ')}` : '',
		styled > 0 ? `Restyles ${styled} layer${styled === 1 ? '' : 's'}` : '',
		view.camera ? 'Moves the camera' : '',
	]
		.filter(Boolean)
		.join(' · ')
}

function renderStoryView(
	block: StoryViewContentBlock,
	options: Pick<
		RichContentRendererProps,
		'onStoryViewActivate' | 'renderStoryViewFigure' | 'activeStoryViewId'
	>,
) {
	const { view, viewIndex } = block
	const drivesCanvas = view.display === 'cue' || view.display === 'both'
	const showsFigure = view.display === 'figure' || view.display === 'both'
	const isActive = options.activeStoryViewId === view.id
	const summary = storyViewSummary(view) || 'Continues the current map state'
	return (
		<section
			key={`story-view-${view.id}-${viewIndex}`}
			data-story-view-id={view.id}
			data-story-view-index={viewIndex}
			className={`overflow-hidden border ${isActive ? 'border-primary bg-primary/10' : 'border-border bg-muted/30'}`}
		>
			{drivesCanvas ? (
				<button
					type="button"
					onClick={() => options.onStoryViewActivate?.(view, viewIndex)}
					disabled={!options.onStoryViewActivate}
					className="flex w-full items-start gap-3 px-3 py-2.5 text-left enabled:hover:bg-primary/5 disabled:cursor-default"
				>
					<span className="flex h-7 w-7 flex-shrink-0 items-center justify-center border border-primary/30 bg-background font-mono text-[10px] font-semibold text-primary">
						{viewIndex + 1}
					</span>
					<span className="min-w-0 flex-1">
						<span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
							Map view
						</span>
						<span className="block font-medium text-foreground">{view.title}</span>
						<span className="mt-0.5 block text-[11px] text-muted-foreground">{summary}</span>
					</span>
					<LocateFixed className="mt-1 h-4 w-4 flex-shrink-0 text-primary" />
				</button>
			) : (
				<div className="flex items-start gap-3 px-3 py-2.5">
					<MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
					<div className="min-w-0 flex-1">
						<div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
							Map figure
						</div>
						<div className="font-medium text-foreground">{view.title}</div>
						<div className="text-[11px] text-muted-foreground">{summary}</div>
					</div>
				</div>
			)}
			{showsFigure && (
				<figure className="border-t border-border bg-background">
					{options.renderStoryViewFigure ? (
						options.renderStoryViewFigure(view, viewIndex)
					) : (
						<div className="flex aspect-[16/9] items-center justify-center gap-2 bg-muted/40 text-xs text-muted-foreground">
							<LocateFixed className="h-4 w-4" />
							Live map figure
						</div>
					)}
					{view.caption && (
						<figcaption className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
							{view.caption}
						</figcaption>
					)}
				</figure>
			)}
		</section>
	)
}

export function RichContentRenderer({
	content,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	isMentionVisible,
	className = '',
	emptyState = null,
	onStoryViewActivate,
	renderStoryViewFigure,
	activeStoryViewId,
}: RichContentRendererProps) {
	const blocks = useMemo(
		() => parseContent(content, availableFeatures),
		[content, availableFeatures],
	)
	const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

	if (blocks.length === 0) {
		return emptyState ? <div className={className}>{emptyState}</div> : null
	}

	return (
		<div className={`space-y-3 text-sm leading-relaxed text-foreground ${className}`}>
			{blocks.map((block, index) => {
				if (block.type === 'story-view') {
					return renderStoryView(block, {
						onStoryViewActivate,
						renderStoryViewFigure,
						activeStoryViewId,
					})
				}
				if (block.type === 'paragraph') {
					return (
						<p key={`paragraph-${index}`} className="break-words">
							{renderInlineTokens(block.tokens, {
								onMentionVisibilityToggle,
								onMentionZoomTo,
								isMentionVisible,
							})}
						</p>
					)
				}

				if (block.type === 'heading') {
					const headingContent = renderInlineTokens(block.tokens, {
						onMentionVisibilityToggle,
						onMentionZoomTo,
						isMentionVisible,
					})
					if (block.level <= 1) {
						return (
							<h1 key={`heading-${index}`} className="font-serif text-2xl text-foreground">
								{headingContent}
							</h1>
						)
					}
					if (block.level === 2) {
						return (
							<h2 key={`heading-${index}`} className="font-serif text-2xl text-foreground">
								{headingContent}
							</h2>
						)
					}
					if (block.level === 3) {
						return (
							<h3 key={`heading-${index}`} className="font-serif text-xl text-foreground">
								{headingContent}
							</h3>
						)
					}
					return (
						<h4 key={`heading-${index}`} className="text-base font-semibold text-foreground">
							{headingContent}
						</h4>
					)
				}

				if (block.type === 'quote') {
					return (
						<blockquote
							key={`quote-${index}`}
							className="border-l-2 border-primary/40 bg-primary/10 px-4 py-2 text-foreground"
						>
							{renderInlineTokens(block.tokens, {
								onMentionVisibilityToggle,
								onMentionZoomTo,
								isMentionVisible,
							})}
						</blockquote>
					)
				}

				if (block.type === 'list') {
					const ListTag = block.ordered ? 'ol' : 'ul'
					return (
						<ListTag
							key={`list-${index}`}
							className={`space-y-1 pl-5 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
						>
							{block.items.map((item, itemIndex) => (
								<li key={`list-item-${index}-${itemIndex}`} className="pl-1">
									{renderInlineTokens(item, {
										onMentionVisibilityToggle,
										onMentionZoomTo,
										isMentionVisible,
									})}
								</li>
							))}
						</ListTag>
					)
				}

				if (block.type === 'codeblock') {
					return (
						<pre
							key={`code-${index}`}
							className="overflow-x-auto rounded-2xl border border-border bg-background/95 p-4 font-mono text-xs text-foreground"
						>
							<code>{block.code}</code>
						</pre>
					)
				}

				if (block.type === 'table') {
					const callbacks = {
						onMentionVisibilityToggle,
						onMentionZoomTo,
						isMentionVisible,
					}
					return (
						<div
							// biome-ignore lint/suspicious/noArrayIndexKey: Markdown blocks are positional in the immutable source text.
							key={`table-${index}`}
							className="max-w-full overflow-x-auto border border-border bg-background"
						>
							<table className="min-w-full border-collapse text-left text-xs">
								<thead className="bg-muted/70">
									<tr>
										{block.header.map((cell, cellIndex) => (
											<th
												// biome-ignore lint/suspicious/noArrayIndexKey: Table columns are positional by definition.
												key={`table-${index}-heading-${cellIndex}`}
												scope="col"
												className="border-b border-border px-2.5 py-2 align-top font-semibold text-foreground"
												style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}
											>
												{renderInlineTokens(cell, callbacks)}
											</th>
										))}
									</tr>
								</thead>
								<tbody className="divide-y divide-border/70">
									{block.rows.map((row, rowIndex) => (
										// biome-ignore lint/suspicious/noArrayIndexKey: Table rows are positional in the immutable source text.
										<tr key={`table-${index}-row-${rowIndex}`}>
											{row.map((cell, cellIndex) => (
												<td
													// biome-ignore lint/suspicious/noArrayIndexKey: Table columns are positional by definition.
													key={`table-${index}-row-${rowIndex}-cell-${cellIndex}`}
													className="min-w-24 break-words px-2.5 py-2 align-top text-foreground"
													style={{ textAlign: block.alignments[cellIndex] ?? 'left' }}
												>
													{renderInlineTokens(cell, callbacks)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)
				}

				return renderMediaBlock(block, index, setLightboxUrl)
			})}
			{lightboxUrl &&
				typeof document !== 'undefined' &&
				createPortal(
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Image preview"
						tabIndex={-1}
						className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
						onClick={(event) => {
							if (event.target === event.currentTarget) setLightboxUrl(null)
						}}
						onKeyDown={(event) => {
							if (event.key === 'Escape') setLightboxUrl(null)
						}}
					>
						<Button
							type="button"
							variant="ghost"
							size="icon-lg"
							className="absolute right-4 top-4 rounded-full bg-card/10 text-white hover:bg-card/20 hover:text-white"
							onClick={() => setLightboxUrl(null)}
							aria-label="Close image preview"
						>
							<X className="h-5 w-5" />
						</Button>
						<img
							src={lightboxUrl}
							alt=""
							className="max-h-[90vh] max-w-[90vw] object-contain shadow-2xl"
						/>
					</div>,
					document.body,
				)}
		</div>
	)
}
