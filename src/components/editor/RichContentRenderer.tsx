import { ExternalLink, Eye, EyeOff, MapPin, Maximize2, Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { GeoFeatureItem } from './GeoRichTextEditor'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

interface RichContentRendererProps {
	content: string
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	className?: string
	emptyState?: string | null
}

interface BaseInlineToken {
	type: 'text' | 'link' | 'mention' | 'strong' | 'emphasis' | 'code'
	value: string
}

interface MentionInlineToken extends BaseInlineToken {
	type: 'mention'
	address: string
	featureId?: string
	displayName?: string
}

interface LinkInlineToken extends BaseInlineToken {
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

interface MediaBlock {
	type: 'image' | 'video' | 'youtube'
	url: string
}

type ContentBlock = ParagraphBlock | HeadingBlock | QuoteBlock | ListBlock | CodeBlock | MediaBlock

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
const TOKEN_PATTERN =
	/(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?)|(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/gi

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

function parseInlineTokens(text: string, availableFeatures: GeoFeatureItem[]): InlineToken[] {
	if (!text) return []

	const tokens: InlineToken[] = []
	let cursor = 0
	const matches = Array.from(text.matchAll(TOKEN_PATTERN))

	for (const match of matches) {
		const matchedValue = match[0]
		if (!matchedValue) continue

		if (match.index > cursor) {
			tokens.push({
				type: 'text',
				value: text.slice(cursor, match.index),
			})
		}

		if (match[1] && match[2]) {
			const linkLabel = matchedValue.slice(1, matchedValue.indexOf(']('))
			tokens.push({
				type: 'link',
				value: linkLabel,
				url: match[2],
			})
		} else if (match[3]) {
			const address = match[4]
			const featureId = match[6] || undefined
			if (address) {
				tokens.push({
					type: 'mention',
					value: matchedValue,
					address,
					featureId,
					displayName: resolveMentionLabel(address, featureId, availableFeatures),
				})
			}
		} else if (match[7]) {
			const cleanUrl = match[7].replace(/[.,;:!?)]+$/, '')
			tokens.push({
				type: 'link',
				value: cleanUrl,
				url: cleanUrl,
			})
		} else if (match[8]) {
			tokens.push({
				type: 'code',
				value: match[8].slice(1, -1),
			})
		} else if (match[9]) {
			tokens.push({
				type: 'strong',
				value: match[9].slice(2, -2),
			})
		} else if (match[10]) {
			tokens.push({
				type: 'emphasis',
				value: match[10].slice(1, -1),
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

function pushParagraph(lines: string[], blocks: ContentBlock[], availableFeatures: GeoFeatureItem[]) {
	if (lines.length === 0) return
	blocks.push({
		type: 'paragraph',
		tokens: parseInlineTokens(lines.join(' '), availableFeatures),
	})
	lines.length = 0
}

function parseContent(text: string, availableFeatures: GeoFeatureItem[]): ContentBlock[] {
	const trimmed = text.trim()
	if (!trimmed) return []

	const lines = text.split('\n')
	const blocks: ContentBlock[] = []
	const paragraphLines: string[] = []
	let activeList: ListBlock | null = null
	let inCodeBlock = false
	let codeFence: string | null = null
	const codeLines: string[] = []

	const flushList = () => {
		if (activeList) {
			blocks.push(activeList)
			activeList = null
		}
	}

	const flushCodeBlock = () => {
		if (!inCodeBlock) return
		blocks.push({
			type: 'codeblock',
			code: codeLines.join('\n'),
		})
		inCodeBlock = false
		codeFence = null
		codeLines.length = 0
	}

	for (const rawLine of lines) {
		const line = rawLine.trimEnd()
		const trimmedLine = line.trim()

		if (trimmedLine.startsWith('```')) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			if (inCodeBlock) {
				flushCodeBlock()
			} else {
				inCodeBlock = true
				codeFence = trimmedLine
			}
			void codeFence
			continue
		}

		if (inCodeBlock) {
			codeLines.push(line)
			continue
		}

		if (!trimmedLine) {
			pushParagraph(paragraphLines, blocks, availableFeatures)
			flushList()
			continue
		}

		const mediaMatch = trimmedLine.match(MEDIA_LINE_PATTERN)
		if (mediaMatch?.[1]) {
			const mediaType = detectMediaType(mediaMatch[1])
			if (mediaType !== 'link') {
				pushParagraph(paragraphLines, blocks, availableFeatures)
				flushList()
				blocks.push({ type: mediaType, url: mediaMatch[1] })
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
				tokens: parseInlineTokens(quoteMatch[1], availableFeatures),
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
	flushCodeBlock()

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

function renderInlineToken(token: InlineToken) {
	if (token.type === 'text') {
		return (
			<span key={tokenKey(token)} className="whitespace-pre-wrap break-words">
				{token.value}
			</span>
		)
	}

	if (token.type === 'strong') {
		return (
			<strong key={tokenKey(token)} className="font-semibold text-stone-900">
				{token.value}
			</strong>
		)
	}

	if (token.type === 'emphasis') {
		return (
			<em key={tokenKey(token)} className="italic">
				{token.value}
			</em>
		)
	}

	if (token.type === 'code') {
		return (
			<code
				key={tokenKey(token)}
				className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[0.9em] text-stone-800"
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
				className="inline-flex items-center gap-1 break-all text-sky-700 underline underline-offset-2 hover:text-sky-800"
			>
				<span>{token.value}</span>
				<ExternalLink className="h-3 w-3 flex-shrink-0" />
			</a>
		)
	}

	return <GeoMentionChip key={tokenKey(token)} token={token} />
}

function GeoMentionChip({ token }: { token: MentionInlineToken }) {
	const [isVisible, setIsVisible] = useState(false)
	const address = token.address ?? ''
	const featureId = token.featureId
	const callbacks = token as MentionInlineToken & {
		onMentionVisibilityToggle?: RichContentRendererProps['onMentionVisibilityToggle']
		onMentionZoomTo?: RichContentRendererProps['onMentionZoomTo']
	}

	const handleToggle = () => {
		const next = !isVisible
		setIsVisible(next)
		callbacks.onMentionVisibilityToggle?.(address, featureId, next)
	}

	return (
		<span className="mx-0.5 inline-flex items-center gap-0.5 rounded-md border border-sky-200 bg-sky-50 px-1.5 py-0.5 align-middle text-xs font-medium text-sky-700">
			<MapPin className="h-3 w-3 flex-shrink-0" />
			<span className="max-w-[180px] truncate" title={address}>
				{token.displayName ?? 'Reference'}
			</span>
			{callbacks.onMentionVisibilityToggle && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={handleToggle}
							className={`h-4 w-4 p-0 ${isVisible ? 'text-sky-600' : 'text-gray-400'} hover:text-sky-700`}
						>
							{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
						</Button>
					</TooltipTrigger>
					<TooltipContent>{isVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
				</Tooltip>
			)}
			{callbacks.onMentionZoomTo && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							onClick={() => callbacks.onMentionZoomTo?.(address, featureId)}
							className="h-4 w-4 p-0 text-gray-400 hover:text-sky-700"
						>
							<Maximize2 className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Zoom to feature</TooltipContent>
				</Tooltip>
			)}
		</span>
	)
}

function renderMediaBlock(block: MediaBlock, index: number) {
	if (block.type === 'image') {
		return (
			<a
				key={`image-${index}`}
				href={block.url}
				target="_blank"
				rel="noopener noreferrer"
				className="block overflow-hidden rounded-xl border border-amber-200 bg-amber-50/60"
			>
				<img
					src={block.url}
					alt=""
					loading="lazy"
					className="block max-h-[320px] w-full object-contain"
				/>
			</a>
		)
	}

	if (block.type === 'youtube') {
		const embedUrl = getYouTubeEmbedUrl(block.url)
		if (embedUrl) {
			return (
				<div
					key={`youtube:${block.url}:${index}`}
					className="overflow-hidden rounded-xl border border-gray-200 bg-black"
				>
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
			)
		}
	}

	if (block.type === 'video' || block.type === 'youtube') {
		return (
			<div
				key={`video:${block.url}:${index}`}
				className="overflow-hidden rounded-xl border border-gray-200 bg-gray-950 p-1"
			>
				<video src={block.url} controls className="block max-h-[320px] w-full rounded-lg">
					<track kind="captions" />
				</video>
			</div>
		)
	}

	return (
		<a
			key={`fallback-${index}`}
			href={block.url}
			target="_blank"
			rel="noopener noreferrer"
			className="inline-flex items-center gap-1 text-sky-700 underline underline-offset-2"
		>
			<Play className="h-3.5 w-3.5" />
			<span>{block.url}</span>
		</a>
	)
}

function renderInlineTokens(
	tokens: InlineToken[],
	callbacks: Pick<
		RichContentRendererProps,
		'onMentionVisibilityToggle' | 'onMentionZoomTo'
	>,
) {
	return tokens.map((token) => {
		if (token.type !== 'mention') {
			return renderInlineToken(token)
		}

		return renderInlineToken({
			...token,
			...callbacks,
		} as MentionInlineToken)
	})
}

export function RichContentRenderer({
	content,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	className = '',
	emptyState = null,
}: RichContentRendererProps) {
	const blocks = useMemo(
		() => parseContent(content, availableFeatures),
		[content, availableFeatures],
	)

	if (blocks.length === 0) {
		return emptyState ? <div className={className}>{emptyState}</div> : null
	}

	return (
		<div className={`space-y-3 text-sm leading-relaxed text-gray-800 ${className}`}>
			{blocks.map((block, index) => {
				if (block.type === 'paragraph') {
					return (
						<p key={`paragraph-${index}`} className="break-words">
							{renderInlineTokens(block.tokens, {
								onMentionVisibilityToggle,
								onMentionZoomTo,
							})}
						</p>
					)
				}

				if (block.type === 'heading') {
					const headingContent = renderInlineTokens(block.tokens, {
						onMentionVisibilityToggle,
						onMentionZoomTo,
					})
					if (block.level <= 1) {
						return (
							<h1 key={`heading-${index}`} className="font-serif text-2xl text-stone-900">
								{headingContent}
							</h1>
						)
					}
					if (block.level === 2) {
						return (
							<h2 key={`heading-${index}`} className="font-serif text-2xl text-stone-900">
								{headingContent}
							</h2>
						)
					}
					if (block.level === 3) {
						return (
							<h3 key={`heading-${index}`} className="font-serif text-xl text-stone-900">
								{headingContent}
							</h3>
						)
					}
					return (
						<h4 key={`heading-${index}`} className="text-base font-semibold text-stone-900">
							{headingContent}
						</h4>
					)
				}

				if (block.type === 'quote') {
					return (
						<blockquote
							key={`quote-${index}`}
							className="border-l-2 border-amber-300 bg-amber-50/60 px-4 py-2 text-stone-700"
						>
							{renderInlineTokens(block.tokens, {
								onMentionVisibilityToggle,
								onMentionZoomTo,
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
							className="overflow-x-auto rounded-2xl border border-stone-200 bg-stone-950/95 p-4 font-mono text-xs text-stone-100"
						>
							<code>{block.code}</code>
						</pre>
					)
				}

				return renderMediaBlock(block, index)
			})}
		</div>
	)
}
