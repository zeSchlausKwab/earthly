import { Eye, EyeOff, MapPin } from 'lucide-react'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { RichContentRenderer } from '@/components/editor'
import { UserProfile } from '@/components/user-profile/UserProfile'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'

function formatRelativeTime(createdAt: number) {
	const date = new Date(createdAt * 1000)
	const elapsed = Date.now() - date.getTime()
	const minutes = Math.floor(elapsed / 60_000)
	const hours = Math.floor(elapsed / 3_600_000)
	const days = Math.floor(elapsed / 86_400_000)
	if (minutes < 1) return 'just now'
	if (minutes < 60) return `${minutes}m ago`
	if (hours < 24) return `${hours}h ago`
	if (days < 7) return `${days}d ago`
	return date.toLocaleDateString()
}

export function PrivateCommentItem({
	comment,
	geometryVisible,
	onGeometryVisibilityChange,
	onZoomToGeometry,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
}: {
	comment: GeoComment
	geometryVisible: boolean
	onGeometryVisibilityChange?: (comment: GeoComment, visible: boolean) => void
	onZoomToGeometry?: (comment: GeoComment) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
}) {
	const featureCount = comment.geojson?.features.length ?? 0
	const hasGeometry = featureCount > 0

	return (
		<div className="py-2.5">
			<div className="flex items-center justify-between gap-2">
				<UserProfile
					pubkey={comment.pubkey}
					mode="avatar-name"
					size="xs"
					showNip05Badge={false}
					interactive={false}
					className="min-w-0"
				/>
				<span className="shrink-0 text-[9px] text-muted-foreground">
					{formatRelativeTime(comment.created_at)}
				</span>
			</div>

			{comment.text ? (
				<RichContentRenderer
					content={comment.text}
					availableFeatures={availableFeatures}
					onMentionVisibilityToggle={onMentionVisibilityToggle}
					onMentionZoomTo={onMentionZoomTo}
					className="mt-1.5 break-words text-xs leading-relaxed text-foreground"
				/>
			) : null}

			{hasGeometry ? (
				<div className="mt-2 flex items-center gap-2 rounded-[2px] border border-ok/35 bg-ok/5 px-2 py-1.5 text-[11px] text-ok">
					<MapPin className="h-3.5 w-3.5 shrink-0" />
					<span>
						{featureCount} geometr{featureCount === 1 ? 'y' : 'ies'} attached
					</span>
					{onGeometryVisibilityChange ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="ghost"
									size="icon-xs"
									className="ml-auto h-5 w-5 text-ok hover:text-ok"
									onClick={() => onGeometryVisibilityChange(comment, !geometryVisible)}
									aria-label={geometryVisible ? 'Hide attachment on map' : 'Show attachment on map'}
								>
									{geometryVisible ? <Eye /> : <EyeOff />}
								</Button>
							</TooltipTrigger>
							<TooltipContent>{geometryVisible ? 'Hide on map' : 'Show on map'}</TooltipContent>
						</Tooltip>
					) : null}
					{onZoomToGeometry ? (
						<Button
							variant="ghost"
							size="xs"
							className={
								onGeometryVisibilityChange
									? 'h-5 px-1.5 text-ok hover:text-ok'
									: 'ml-auto h-5 px-1.5 text-ok hover:text-ok'
							}
							onClick={() => onZoomToGeometry(comment)}
						>
							Zoom
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	)
}
