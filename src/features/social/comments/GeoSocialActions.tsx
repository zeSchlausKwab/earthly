import { Heart, MessageCircle, PencilLine, Zap } from 'lucide-react'
import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useGeoReactions, type ReactableEvent } from '../hooks/useGeoReactions'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

interface GeoSocialActionsProps {
	/** Any Nostr event that can receive reactions */
	target: ReactableEvent
	onReplyClick?: () => void
	commentCount?: number
	showCommentButton?: boolean
	showAnnotateButton?: boolean
	onAnnotateClick?: () => void
	/** Whether to show the zap button (default: true for geo events) */
	showZapButton?: boolean
	className?: string
	compact?: boolean
}

/**
 * Social actions bar for any Nostr event: reactions, zaps, and comments.
 * Works with geo events (NDKGeoEvent, etc.) and regular events (NDKEvent).
 */
export function GeoSocialActions({
	target,
	onReplyClick,
	commentCount = 0,
	showCommentButton = true,
	showAnnotateButton = false,
	onAnnotateClick,
	showZapButton = true,
	className = '',
	compact = false,
}: GeoSocialActionsProps) {
	const currentUser = useNDKCurrentUser()
	const {
		reactionCount,
		zapCount,
		userHasReacted,
		userHasZapped,
		isLoading,
		toggleReaction,
		openZapDialog,
	} = useGeoReactions({ target })

	const formatCount = (count: number): string => {
		if (count === 0) return ''
		if (count >= 1000) return `${(count / 1000).toFixed(1)}k`
		return count.toString()
	}

	const handleReaction = async () => {
		if (!currentUser) {
			toast.info('Please log in to react')
			return
		}
		try {
			await toggleReaction()
		} catch (error) {
			console.error('Failed to react:', error)
			toast.error('Failed to react')
		}
	}

	const handleZap = () => {
		if (!currentUser) {
			toast.info('Please log in to zap')
			return
		}
		// Zapping not yet implemented
		toast.info('Zapping coming soon! ⚡', {
			description: 'This feature is not yet implemented.',
		})
		void openZapDialog // Suppress unused warning
	}

	const buttonSize = compact ? 'sm' : 'default'
	const iconSize = compact ? 'h-3.5 w-3.5' : 'h-4 w-4'

	return (
		<div className={`flex items-center gap-1 ${className}`}>
			{/* Heart/Reaction Button */}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size={buttonSize}
						onClick={handleReaction}
						disabled={isLoading}
						className={`gap-1 ${
							userHasReacted
								? 'text-rose-500 hover:text-rose-600'
								: 'text-gray-500 hover:text-rose-500'
						}`}
					>
						<Heart className={`${iconSize} ${userHasReacted ? 'fill-current' : ''}`} />
						{reactionCount > 0 && (
							<span className="text-xs font-medium">{formatCount(reactionCount)}</span>
						)}
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					{userHasReacted ? 'You liked this' : currentUser ? 'Like' : 'Log in to like'}
				</TooltipContent>
			</Tooltip>

			{/* Lightning/Zap Button */}
			{showZapButton && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={handleZap}
							disabled={isLoading || !currentUser}
							className={`gap-1 ${
								userHasZapped
									? 'text-amber-500 hover:text-amber-600'
									: 'text-gray-500 hover:text-amber-500'
							}`}
						>
							<Zap className={`${iconSize} ${userHasZapped ? 'fill-current' : ''}`} />
							{zapCount > 0 && <span className="text-xs font-medium">{formatCount(zapCount)}</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>
						{userHasZapped ? 'You zapped this' : currentUser ? 'Zap' : 'Log in to zap'}
					</TooltipContent>
				</Tooltip>
			)}

			{showAnnotateButton && onAnnotateClick && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={onAnnotateClick}
							className="gap-1 text-amber-600 hover:text-amber-700"
						>
							<PencilLine className={iconSize} />
							{!compact && <span className="text-xs font-medium">Annotate</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Add comment annotation</TooltipContent>
				</Tooltip>
			)}

			{/* Comment/Reply Button */}
			{showCommentButton && onReplyClick && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={onReplyClick}
							className="gap-1 text-gray-500 hover:text-emerald-500"
						>
							<MessageCircle className={iconSize} />
							{commentCount > 0 && (
								<span className="text-xs font-medium">{formatCount(commentCount)}</span>
							)}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Reply</TooltipContent>
				</Tooltip>
			)}
		</div>
	)
}
