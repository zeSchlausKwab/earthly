import { Eye, EyeOff, MapPin, Maximize2 } from 'lucide-react'
import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GeoMentionProps {
	/** The nostr address (naddr1...) */
	address: string
	/** Optional feature ID within the dataset */
	featureId?: string
	/** Display name for the mention */
	displayName?: string
	/** Callback when visibility is toggled */
	onToggleVisibility?: (visible: boolean) => void
	/** Callback when zoom is clicked */
	onZoomTo?: () => void
	/** Whether the geometry is currently visible */
	isVisible?: boolean
	/** Loading state while resolving the reference */
	isLoading?: boolean
	className?: string
}

/**
 * Inline mention component for referencing geo datasets and features.
 * Similar to @mentions in social apps but for geometry.
 * Includes eye toggle for visibility and zoom-to button.
 */
export function GeoMention({
	address,
	featureId,
	displayName,
	onToggleVisibility,
	onZoomTo,
	isVisible = false,
	isLoading = false,
	className = '',
}: GeoMentionProps) {
	const [localVisible, setLocalVisible] = useState(isVisible)

	const handleToggleVisibility = () => {
		const newVisible = !localVisible
		setLocalVisible(newVisible)
		onToggleVisibility?.(newVisible)
	}

	const label = useMemo(() => {
		if (displayName) return displayName
		if (featureId) return `Feature: ${featureId}`
		// Truncate the address for display
		if (address.length > 20) {
			return `${address.slice(0, 12)}…${address.slice(-6)}`
		}
		return address
	}, [address, featureId, displayName])

	const mentionType = featureId ? 'feature' : 'dataset'

	return (
		<span
			className={`inline-flex items-center gap-0.5 rounded-md bg-info/15 border border-info/40 px-1.5 py-0.5 text-xs font-medium text-info ${className}`}
		>
			<MapPin className="h-3 w-3 flex-shrink-0" />
			<span
				className="truncate max-w-[120px]"
				title={featureId ? `${address}#${featureId}` : address}
			>
				{label}
			</span>

			{/* Visibility Toggle */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-xs"
						onClick={handleToggleVisibility}
						disabled={isLoading}
						className={`ml-0.5 h-4 w-4 p-0 ${
							localVisible ? 'text-info' : 'text-muted-foreground'
						} hover:text-info`}
					>
						{localVisible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{localVisible ? `Hide ${mentionType}` : `Show ${mentionType}`}
				</TooltipContent>
			</Tooltip>

			{/* Zoom To Button */}
			{onZoomTo && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="icon-xs"
							onClick={onZoomTo}
							disabled={isLoading}
							className="h-4 w-4 p-0 text-muted-foreground hover:text-info"
						>
							<Maximize2 className="h-3 w-3" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Zoom to {mentionType}</TooltipContent>
				</Tooltip>
			)}
		</span>
	)
}

/**
 * Parses comment text and returns segments with GeoMention components.
 */
export interface TextSegment {
	type: 'text' | 'mention'
	content: string
	address?: string
	featureId?: string
}

export function parseGeoMentions(text: string): TextSegment[] {
	const segments: TextSegment[] = []
	const pattern = /nostr:(naddr1[a-z0-9]+)(#([a-zA-Z0-9_-]+))?/g
	let lastIndex = 0
	let match = pattern.exec(text)

	while (match !== null) {
		const matchIndex = match.index

		// Add text before the match
		if (matchIndex > lastIndex) {
			segments.push({
				type: 'text',
				content: text.slice(lastIndex, matchIndex),
			})
		}

		// Add the mention
		segments.push({
			type: 'mention',
			content: match[0],
			address: match[1],
			featureId: match[3],
		})

		lastIndex = matchIndex + match[0].length
		match = pattern.exec(text)
	}

	// Add remaining text
	if (lastIndex < text.length) {
		segments.push({
			type: 'text',
			content: text.slice(lastIndex),
		})
	}

	return segments
}
