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

interface TextToken {
	type: 'text' | 'link' | 'mention'
	value: string
	address?: string
	featureId?: string
	displayName?: string
}

interface ParagraphBlock {
	type: 'paragraph'
	tokens: TextToken[]
}

interface MediaBlock {
	type: 'image' | 'video' | 'youtube'
	url: string
}

type ContentBlock = ParagraphBlock | MediaBlock

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
const TOKEN_PATTERN =
	/(nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?)|(https?:\/\/[^\s<>"{}|\\^`[\]]+)/gi

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

function parseContent(text: string, availableFeatures: GeoFeatureItem[]): ContentBlock[] {
	const trimmed = text.trim()
	if (!trimmed) return []

	const lines = text.split('\n')
	const blocks: ContentBlock[] = []

	for (const rawLine of lines) {
		const line = rawLine.trim()
		if (!line) continue

		const matches = Array.from(line.matchAll(TOKEN_PATTERN))
		if (matches.length === 1) {
			const standaloneUrl = matches[0]?.[5]?.replace(/[.,;:!?)]+$/, '')
			if (standaloneUrl) {
				const standaloneType = detectMediaType(standaloneUrl)
				if (standaloneType !== 'link') {
					blocks.push({ type: standaloneType, url: standaloneUrl })
					continue
				}
			}
		}

		const tokens: TextToken[] = []
		const mediaBlocks: MediaBlock[] = []
		let cursor = 0

		for (const match of matches) {
			const matchedValue = match[0]
			if (!matchedValue) continue

			if (match.index > cursor) {
				tokens.push({
					type: 'text',
					value: line.slice(cursor, match.index),
				})
			}

			if (match[1]) {
				const address = match[2]
				const featureId = match[4] || undefined
				if (address) {
					tokens.push({
						type: 'mention',
						value: matchedValue,
						address,
						featureId,
						displayName: resolveMentionLabel(address, featureId, availableFeatures),
					})
				}
			} else if (match[5]) {
				const cleanUrl = match[5].replace(/[.,;:!?)]+$/, '')
				const mediaType = detectMediaType(cleanUrl)
				if (mediaType === 'link') {
					tokens.push({
						type: 'link',
						value: cleanUrl,
					})
				} else {
					mediaBlocks.push({ type: mediaType, url: cleanUrl })
				}
			}

			cursor = match.index + matchedValue.length
		}

		if (cursor < line.length) {
			tokens.push({
				type: 'text',
				value: line.slice(cursor),
			})
		}

		if (tokens.some((token) => token.value.length > 0)) {
			blocks.push({ type: 'paragraph', tokens })
		}
		blocks.push(...mediaBlocks)
	}

	return blocks
}

function tokenKey(token: TextToken): string {
	return `${token.type}:${token.value}:${token.address ?? ''}:${token.featureId ?? ''}`
}

function renderTextToken(token: TextToken) {
	if (token.type === 'text') {
		return (
			<span key={tokenKey(token)} className="whitespace-pre-wrap break-words">
				{token.value}
			</span>
		)
	}

	if (token.type === 'link') {
		return (
			<a
				key={tokenKey(token)}
				href={token.value}
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

function GeoMentionChip({ token }: { token: TextToken }) {
	const [isVisible, setIsVisible] = useState(false)
	const address = token.address ?? ''
	const featureId = token.featureId
	const callbacks = token as TextToken & {
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
				const blockKey =
					block.type === 'paragraph'
						? `paragraph:${block.tokens.map((token) => tokenKey(token)).join('|')}`
						: `${block.type}:${block.url}:${index}`
				if (block.type === 'paragraph') {
					const tokens = block.tokens.map((token) => ({
						...token,
						onMentionVisibilityToggle,
						onMentionZoomTo,
					}))
					return (
						<p key={blockKey} className="break-words">
							{tokens.map((token) => renderTextToken(token))}
						</p>
					)
				}

				return renderMediaBlock(block, index)
			})}
		</div>
	)
}
