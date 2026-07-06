import { Calendar, MessageCircle, X } from 'lucide-react'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import { RichContentRenderer } from '@/components/editor'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import { UserProfile } from '@/components/user-profile'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { resolveMapPopupPosition, type MapPopupPlacement } from './map-popup-positioning'

export interface CommentAnnotationPopupData {
	comment: GeoComment
	feature: Feature<Geometry>
	screenPosition: { x: number; y: number }
	pinned?: boolean
}

interface CommentAnnotationPopupProps {
	data: CommentAnnotationPopupData | null
	containerRef: React.RefObject<HTMLDivElement | null>
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	onHoverChange?: (hovered: boolean) => void
	availableFeatures?: GeoFeatureItem[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	onClose: () => void
}

const POPUP_WIDTH = 360
const POPUP_HEIGHT_ESTIMATE = 280

function formatCreatedAt(createdAt?: number): string {
	if (!createdAt || !Number.isFinite(createdAt)) return 'Unknown time'
	return new Date(createdAt * 1000).toLocaleString()
}

function getAnnotationTitle(feature: Feature<Geometry>): string {
	const props = (feature.properties ?? {}) as Record<string, unknown>
	const candidates = [props.name, props.title, props.text, props.label, feature.id]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) return value.trim()
		if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	}
	return 'Annotation'
}

function getAnnotationDescription(feature: Feature<Geometry>): string | null {
	const props = (feature.properties ?? {}) as Record<string, unknown>
	const candidates = [props.description, props.text]
	for (const value of candidates) {
		if (typeof value === 'string' && value.trim()) return value.trim()
	}
	return null
}

export function CommentAnnotationPopup({
	data,
	containerRef,
	placementMode = 'geometry',
	toolbarOffset = 72,
	onHoverChange,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	onClose,
}: CommentAnnotationPopupProps) {
	const popupRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 320 })

	const updatePosition = useCallback(() => {
		if (!data || !containerRef.current || !popupRef.current) return
		const containerRect = containerRef.current.getBoundingClientRect()
		const popupWidth = popupRef.current.offsetWidth || POPUP_WIDTH
		const popupHeight = popupRef.current.offsetHeight || POPUP_HEIGHT_ESTIMATE
		setPosition(
			resolveMapPopupPosition({
				containerWidth: containerRect.width,
				containerHeight: containerRect.height,
				popupWidth,
				popupHeight,
				anchorPoint: data.screenPosition,
				placement: placementMode,
				toolbarOffset,
				offset: 16,
			}),
		)
	}, [containerRef, data, placementMode, toolbarOffset])

	useLayoutEffect(() => {
		if (!data) return
		updatePosition()

		const popupEl = popupRef.current
		const containerEl = containerRef.current
		if (!popupEl || !containerEl) return

		const handleResize = () => updatePosition()
		window.addEventListener('resize', handleResize)

		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(() => updatePosition())
			observer.observe(popupEl)
			observer.observe(containerEl)
			return () => {
				window.removeEventListener('resize', handleResize)
				observer.disconnect()
			}
		}

		return () => {
			window.removeEventListener('resize', handleResize)
		}
	}, [containerRef, data, updatePosition])

	if (!data) return null

	const { comment, feature } = data
	const title = getAnnotationTitle(feature)
	const featureDescription = getAnnotationDescription(feature)

	return (
		<div
			ref={popupRef}
			role="dialog"
			aria-label={`${title} annotation`}
			className="pointer-events-auto absolute z-50 overflow-hidden rounded-2xl border border-primary/40 bg-card/95 shadow-2xl backdrop-blur"
			style={{
				width: `min(${POPUP_WIDTH}px, calc(100% - 24px))`,
				left: position.left,
				top: position.top,
				maxHeight: position.maxHeight,
			}}
			onMouseEnter={() => onHoverChange?.(true)}
			onMouseLeave={() => onHoverChange?.(false)}
		>
			<div className="flex items-start justify-between gap-3 border-b border-primary/40 bg-primary/10 px-4 py-3">
				<div className="min-w-0">
					<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
						Annotation
					</div>
					<h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
					<div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
						<div className="inline-flex items-center gap-1">
							<MessageCircle className="h-3 w-3" />
							<UserProfile
								pubkey={comment.pubkey}
								mode="avatar-name"
								size="xs"
								showNip05Badge={false}
								interactive={false}
							/>
						</div>
						<span className="inline-flex items-center gap-1">
							<Calendar className="h-3 w-3" />
							{formatCreatedAt(comment.created_at)}
						</span>
					</div>
				</div>
				<Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			<div className="space-y-4 overflow-y-auto px-4 py-4">
				{featureDescription && (
					<div className="rounded-xl border border-primary/40 bg-primary/10 p-3">
						<RichContentRenderer
							content={featureDescription}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="space-y-2 text-sm text-foreground"
						/>
					</div>
				)}

				{comment.text && (
					<div className="space-y-2">
						<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
							Comment
						</div>
						<RichContentRenderer
							content={comment.text}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="space-y-2"
						/>
					</div>
				)}
			</div>
		</div>
	)
}
