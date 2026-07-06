import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { Play, ExternalLink } from 'lucide-react'
import { useState } from 'react'

/**
 * Custom Video Node for embedding video URLs (non-YouTube)
 * Supports .mp4, .webm, video.nostr.build, etc.
 */
function VideoNodeView({ node }: NodeViewProps) {
	const { src, title } = node.attrs as { src: string; title?: string }
	const [error, setError] = useState(false)

	if (error) {
		return (
			<NodeViewWrapper className="my-2">
				<a
					href={src}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 text-sm text-info hover:text-info hover:underline"
				>
					<Play className="h-4 w-4" />
					<span className="truncate">{title || 'Video'}</span>
					<ExternalLink className="h-3 w-3" />
				</a>
			</NodeViewWrapper>
		)
	}

	return (
		<NodeViewWrapper className="my-2 w-full min-w-0 max-w-full overflow-hidden block">
			<video
				src={src}
				controls
				className="w-full max-w-full rounded-lg block"
				style={{ maxHeight: '300px' }}
				onError={() => setError(true)}
			>
				<track kind="captions" />
				Your browser does not support the video tag.
			</video>
		</NodeViewWrapper>
	)
}

export const VideoNode = Node.create({
	name: 'video',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			src: { default: null },
			title: { default: null },
		}
	},

	parseHTML() {
		return [{ tag: 'video[src]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['video', mergeAttributes(HTMLAttributes, { controls: true })]
	},

	addNodeView() {
		return ReactNodeViewRenderer(VideoNodeView)
	},
})

/**
 * Embedded Image Node with proper sizing and loading
 */
function ImageNodeView({ node }: NodeViewProps) {
	const { src, alt, title } = node.attrs as { src: string; alt?: string; title?: string }
	const [error, setError] = useState(false)
	const [loaded, setLoaded] = useState(false)

	if (error) {
		return (
			<NodeViewWrapper className="my-2">
				<a
					href={src}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 text-sm text-info hover:text-info hover:underline"
				>
					<span className="truncate">{alt || title || 'Image'}</span>
					<ExternalLink className="h-3 w-3" />
				</a>
			</NodeViewWrapper>
		)
	}

	return (
		<NodeViewWrapper className="my-2 w-full min-w-0 max-w-full overflow-hidden block">
			<a href={src} target="_blank" rel="noopener noreferrer" className="block w-full">
				{!loaded && (
					<div className="w-full h-32 bg-muted animate-pulse rounded-lg flex items-center justify-center text-muted-foreground text-sm">
						Loading...
					</div>
				)}
				<img
					src={src}
					alt={alt || ''}
					title={title}
					className={`w-full max-w-full rounded-lg cursor-pointer hover:opacity-90 transition-opacity block ${loaded ? '' : 'hidden'}`}
					style={{ maxHeight: '300px', objectFit: 'contain' }}
					onLoad={() => setLoaded(true)}
					onError={() => setError(true)}
					loading="lazy"
				/>
			</a>
		</NodeViewWrapper>
	)
}

export const ImageNode = Node.create({
	name: 'image',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			src: { default: null },
			alt: { default: null },
			title: { default: null },
		}
	},

	parseHTML() {
		return [{ tag: 'img[src]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['img', mergeAttributes(HTMLAttributes)]
	},

	addNodeView() {
		return ReactNodeViewRenderer(ImageNodeView)
	},
})

/**
 * YouTube Embed Node with responsive iframe
 */
function YouTubeNodeView({ node }: NodeViewProps) {
	const { src } = node.attrs as { src: string }

	// Extract video ID from various YouTube URL formats
	const getEmbedUrl = (url: string): string | null => {
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

	const embedUrl = getEmbedUrl(src)

	if (!embedUrl) {
		return (
			<NodeViewWrapper className="my-2">
				<a
					href={src}
					target="_blank"
					rel="noopener noreferrer"
					className="flex items-center gap-2 text-sm text-destructive hover:text-destructive hover:underline"
				>
					<Play className="h-4 w-4" />
					<span>YouTube Video</span>
					<ExternalLink className="h-3 w-3" />
				</a>
			</NodeViewWrapper>
		)
	}

	return (
		<NodeViewWrapper className="my-2 w-full min-w-0 max-w-full overflow-hidden block">
			<div className="relative w-full min-w-0 max-w-full" style={{ paddingBottom: '56.25%' }}>
				<iframe
					src={embedUrl}
					title="YouTube video"
					className="absolute top-0 left-0 w-full h-full rounded-lg"
					allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
					allowFullScreen
				/>
			</div>
		</NodeViewWrapper>
	)
}

export const YouTubeNode = Node.create({
	name: 'youtube',
	group: 'block',
	atom: true,

	addAttributes() {
		return {
			src: { default: null },
		}
	},

	parseHTML() {
		return [{ tag: 'div[data-youtube]' }]
	},

	renderHTML({ HTMLAttributes }) {
		return ['div', mergeAttributes({ 'data-youtube': '' }, HTMLAttributes)]
	},

	addNodeView() {
		return ReactNodeViewRenderer(YouTubeNodeView)
	},
})
