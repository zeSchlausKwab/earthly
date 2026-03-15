import { mergeAttributes, Node } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { MapPin, Eye, EyeOff, Maximize2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'

export interface GeoMentionAttrs {
	/** The naddr1... address of the dataset */
	address: string
	/** Optional feature ID within the dataset */
	featureId?: string
	/** Display name for the mention */
	displayName: string
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

	return (
		<NodeViewWrapper as="span" className="inline">
			<span
				className="inline-flex items-center gap-0.5 rounded-md bg-sky-50 border border-sky-200 px-1.5 py-0.5 text-xs font-medium text-sky-700 mx-0.5"
				contentEditable={false}
			>
				<MapPin className="h-3 w-3 flex-shrink-0" />
				<span
					className="truncate max-w-[120px]"
					title={featureId ? `${address}#${featureId}` : address}
				>
					{displayName}
				</span>

				{/* Visibility Toggle - always shown if callback exists */}
				{callbacks?.onVisibilityToggle && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={handleToggleVisibility}
								className={`h-4 w-4 p-0 ${isVisible ? 'text-sky-600' : 'text-gray-400'} hover:text-sky-700`}
							>
								{isVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
							</Button>
						</TooltipTrigger>
						<TooltipContent>{isVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
					</Tooltip>
				)}

				{/* Zoom Button - always shown if callback exists */}
				{callbacks?.onZoomTo && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon-xs"
								onClick={handleZoomTo}
								className="h-4 w-4 p-0 text-gray-400 hover:text-sky-700"
							>
								<Maximize2 className="h-3 w-3" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Zoom to feature</TooltipContent>
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
								className="h-4 w-4 p-0 text-gray-400 hover:text-red-500"
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

/** TipTap JSON node structure */
interface TipTapNode {
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
		return nameResolver(address) ?? 'Dataset'
	}
	return 'Dataset'
}

function parseInlineContent(
	text: string,
	nameResolver?: (address: string) => string | undefined,
): TipTapNode[] | undefined {
	if (!text) return undefined

	const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
	const content: TipTapNode[] = []
	let lastIndex = 0
	let match = pattern.exec(text)

	while (match !== null) {
		const matchIndex = match.index
		const address = match[1]
		const featureId = match[3] || null

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
				displayName: resolveMentionDisplayName(address, featureId, nameResolver),
			},
		})

		lastIndex = matchIndex + match[0].length
		match = pattern.exec(text)
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
			if (featureId) {
				return `nostr:${address}#${featureId}`
			}
			return `nostr:${address}`
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
	const paragraphs = text.length > 0 ? text.split('\n') : ['']

	return {
		type: 'doc',
		content: paragraphs.map((paragraph) => ({
			type: 'paragraph',
			content: parseInlineContent(paragraph, nameResolver),
		})),
	}
}
