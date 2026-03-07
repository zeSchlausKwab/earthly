import { Heart, MessageCircle, PencilLine, Share2, Zap } from 'lucide-react'
import { useNDKCurrentUser } from '@nostr-dev-kit/react'
import { nip19 } from 'nostr-tools'
import { useMemo } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { buildRouteHash } from '@/features/geo-editor/hooks/useRouting'
import {
	GEO_COLLECTION_KIND,
	GEO_COMMENT_KIND,
	GEO_EVENT_KIND,
	MAP_CONTEXT_KIND,
} from '@/lib/ndk/kinds'
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

function getEntityRouteParts(kind: number): {
	sidebarView: 'datasets' | 'collections' | 'contexts'
	focusType: 'geoevent' | 'collection' | 'mapcontext'
} | null {
	switch (kind) {
		case GEO_EVENT_KIND:
			return { sidebarView: 'datasets', focusType: 'geoevent' }
		case GEO_COLLECTION_KIND:
			return { sidebarView: 'collections', focusType: 'collection' }
		case MAP_CONTEXT_KIND:
			return { sidebarView: 'contexts', focusType: 'mapcontext' }
		default:
			return null
	}
}

function buildShareHash(target: ReactableEvent): string | null {
	if (!target.kind) return null

	if (target.kind === GEO_COMMENT_KIND) {
		const commentTarget = target as {
			rootAddress?: string
			commentId?: string
			dTag?: string
		}
		const rootAddress = commentTarget.rootAddress
		const commentId = commentTarget.commentId ?? commentTarget.dTag
		if (!rootAddress || !commentId) return null

		const [kindValue, pubkey, ...identifierParts] = rootAddress.split(':')
		const rootKind = Number.parseInt(kindValue ?? '', 10)
		const identifier = identifierParts.join(':')
		if (!Number.isFinite(rootKind) || !pubkey || !identifier) return null

		const route = getEntityRouteParts(rootKind)
		if (!route) return null

		return buildRouteHash({
			sidebarView: route.sidebarView,
			focusType: route.focusType,
			naddr: nip19.naddrEncode({
				kind: rootKind,
				pubkey,
				identifier,
			}),
			commentId,
		})
	}

	const targetWithDTag = target as {
		dTag?: string
		datasetId?: string
		contextId?: string
		pubkey: string
	}
	const identifier = targetWithDTag.dTag ?? targetWithDTag.datasetId ?? targetWithDTag.contextId
	if (!identifier) return null

	const route = getEntityRouteParts(target.kind)
	if (!route) return null

	return buildRouteHash({
		sidebarView: route.sidebarView,
		focusType: route.focusType,
		naddr: nip19.naddrEncode({
			kind: target.kind,
			pubkey: target.pubkey,
			identifier,
		}),
	})
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
	const shareHash = useMemo(() => buildShareHash(target), [target])

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

	const handleShare = async () => {
		if (!shareHash) {
			toast.error('No share route available for this item')
			return
		}

		const shareUrl = new URL(window.location.href)
		shareUrl.hash = shareHash

		try {
			await navigator.clipboard.writeText(shareUrl.toString())
			toast.success('Share link copied')
		} catch (error) {
			console.error('Failed to copy share link:', error)
			toast.error('Failed to copy share link')
		}
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
						} rounded-none px-2 text-xs`}
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
							} rounded-none px-2 text-xs`}
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

			{shareHash && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size={buttonSize}
							onClick={handleShare}
							className="gap-1 rounded-none px-2 text-xs text-gray-500 hover:text-sky-600"
						>
							<Share2 className={iconSize} />
							{!compact && <span className="text-xs font-medium">Share</span>}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Copy share link</TooltipContent>
				</Tooltip>
			)}

			{showAnnotateButton && onAnnotateClick && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size={buttonSize}
							onClick={onAnnotateClick}
							className="gap-1 rounded-none px-2 text-xs text-amber-600 hover:text-amber-700"
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
							className="gap-1 rounded-none px-2 text-xs text-gray-500 hover:text-emerald-500"
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
