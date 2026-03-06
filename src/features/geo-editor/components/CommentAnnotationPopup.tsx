import { Calendar, MessageCircle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import { RichContentRenderer } from '@/components/editor'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import type { NDKGeoCommentEvent } from '@/lib/ndk/NDKGeoCommentEvent'

export interface CommentAnnotationPopupData {
	comment: NDKGeoCommentEvent
	feature: Feature<Geometry>
	screenPosition: { x: number; y: number }
	pinned?: boolean
}

interface CommentAnnotationPopupProps {
	data: CommentAnnotationPopupData | null
	containerRef: React.RefObject<HTMLDivElement | null>
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
const OFFSET = 16

function shortPubkey(pubkey: string): string {
	if (!pubkey) return 'Unknown'
	if (pubkey.length <= 16) return pubkey
	return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
}

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
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	onClose,
}: CommentAnnotationPopupProps) {
	const [position, setPosition] = useState<{ x: number; y: number; anchor: 'top' | 'bottom' }>({
		x: 0,
		y: 0,
		anchor: 'bottom',
	})

	useEffect(() => {
		if (!data?.screenPosition || !containerRef.current) return

		const containerRect = containerRef.current.getBoundingClientRect()
		let x = data.screenPosition.x - POPUP_WIDTH / 2
		x = Math.max(8, Math.min(x, containerRect.width - POPUP_WIDTH - 8))

		const spaceAbove = data.screenPosition.y - OFFSET
		const spaceBelow = containerRect.height - data.screenPosition.y - OFFSET

		if (spaceAbove >= POPUP_HEIGHT_ESTIMATE) {
			setPosition({ x, y: data.screenPosition.y - OFFSET, anchor: 'bottom' })
		} else {
			setPosition({ x, y: data.screenPosition.y + OFFSET, anchor: 'top' })
		}
	}, [data?.screenPosition, containerRef])

	if (!data) return null

	const { comment, feature } = data
	const title = getAnnotationTitle(feature)
	const featureDescription = getAnnotationDescription(feature)

	return (
		<div
			className="pointer-events-auto absolute z-50 overflow-hidden rounded-2xl border border-amber-200 bg-white/95 shadow-2xl backdrop-blur"
			style={{
				width: POPUP_WIDTH,
				left: position.x,
				...(position.anchor === 'bottom'
					? { bottom: `calc(100% - ${position.y}px)` }
					: { top: position.y }),
				maxHeight: 'min(70vh, 560px)',
			}}
		>
			<div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50/80 px-4 py-3">
				<div className="min-w-0">
					<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700">
						Annotation
					</div>
					<h3 className="truncate text-sm font-semibold text-gray-900">{title}</h3>
					<div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-gray-500">
						<span className="inline-flex items-center gap-1">
							<MessageCircle className="h-3 w-3" />
							{shortPubkey(comment.pubkey)}
						</span>
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
					<div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3">
						<RichContentRenderer
							content={featureDescription}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="space-y-2 text-sm text-gray-700"
						/>
					</div>
				)}

				{comment.text && (
					<div className="space-y-2">
						<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-400">
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
