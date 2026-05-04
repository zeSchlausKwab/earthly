import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { RichContentRenderer } from '@/components/editor'
import { UserProfile } from '@/components/user-profile'
import { resolveMapPopupPosition, type MapPopupPlacement } from './map-popup-positioning'

export interface FeaturePopupData {
	/** The dataset containing the hovered feature */
	dataset: GeoDataset
	/** The hovered feature */
	feature: Feature<Geometry>
	/** Screen position where user hovered */
	clickPosition: { x: number; y: number }
	/** Whether the current user owns this dataset */
	isOwner: boolean
	/** Name of the dataset */
	datasetName: string
}

interface FeaturePopupProps {
	data: FeaturePopupData | null
	/** Container ref for positioning calculations */
	containerRef: React.RefObject<HTMLDivElement | null>
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	interactive?: boolean
	onHoverChange?: (hovered: boolean) => void
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 240

function getDatasetDescription(dataset: GeoDataset): string | null {
	const featureCollection = dataset.featureCollection as Record<string, unknown> | undefined
	if (!featureCollection) return null

	const candidates = [
		featureCollection.description,
		featureCollection.summary,
		(featureCollection.properties as Record<string, unknown> | undefined)?.description,
		(featureCollection.properties as Record<string, unknown> | undefined)?.summary,
	]

	for (const value of candidates) {
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim()
		}
	}

	return null
}

function formatCreatedAt(createdAt?: number): string {
	if (!createdAt || !Number.isFinite(createdAt)) return 'Unknown'
	return new Date(createdAt * 1000).toLocaleString()
}

function getFeatureLabel(feature: Feature<Geometry>): string | null {
	const props = (feature.properties ?? {}) as Record<string, unknown>
	const labelCandidates = [
		props.name,
		props.title,
		props.label,
		props.text,
		props.featureId,
		props.id,
		feature.id,
	]
	for (const value of labelCandidates) {
		if (typeof value === 'string' && value.trim().length > 0) return value.trim()
		if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	}
	return null
}

function countGeometryVertices(geometry: Geometry): number {
	const walk = (coords: unknown): number => {
		if (!Array.isArray(coords)) return 0
		if (coords.length === 0) return 0
		if (typeof coords[0] === 'number') return 1
		let count = 0
		for (const child of coords) count += walk(child)
		return count
	}
	return walk(geometry.coordinates)
}

export function FeaturePopup({
	data,
	containerRef,
	placementMode = 'geometry',
	toolbarOffset = 72,
	interactive = false,
	onHoverChange,
}: FeaturePopupProps) {
	const popupRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 280 })

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
				anchorPoint: data.clickPosition,
				placement: placementMode,
				toolbarOffset,
				offset: 12,
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

	const { dataset, datasetName, feature } = data
	const description = getDatasetDescription(dataset)
	const featureLabel = getFeatureLabel(feature)
	const vertexCount = countGeometryVertices(feature.geometry)

	return (
		<div
			ref={popupRef}
			role="dialog"
			aria-label={`${datasetName} details`}
			className={`absolute z-50 flex flex-col overflow-hidden rounded-xl bg-white/95 shadow-2xl backdrop-blur ring-1 ring-black/5 ${
				interactive ? 'pointer-events-auto' : 'pointer-events-none'
			}`}
			style={{
				width: `min(${POPUP_WIDTH}px, calc(100% - 24px))`,
				left: position.left,
				top: position.top,
				maxHeight: position.maxHeight,
			}}
			onMouseEnter={() => onHoverChange?.(true)}
			onMouseLeave={() => onHoverChange?.(false)}
		>
			<div className="border-b border-gray-100 bg-gray-50/80 px-3 py-2">
				<div className="font-semibold text-sm text-gray-900 truncate">{datasetName}</div>
				<div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-600">
					<span className="text-gray-400">Author:</span>
					<UserProfile
						pubkey={dataset.pubkey}
						mode="avatar-name"
						size="xs"
						showNip05Badge={false}
						interactive={false}
					/>
				</div>
			</div>

			<div className="space-y-2 overflow-y-auto px-3 py-2">
				{description && (
					<RichContentRenderer content={description} className="space-y-2 text-xs text-gray-700" />
				)}
				<div className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1.5 text-[11px] text-gray-700 space-y-0.5">
					<div>
						<span className="text-gray-400">Geometry:</span> {feature.geometry.type}
					</div>
					{featureLabel && (
						<div className="truncate">
							<span className="text-gray-400">Feature:</span> {featureLabel}
						</div>
					)}
					<div>
						<span className="text-gray-400">Vertices:</span> {vertexCount}
					</div>
				</div>
				<div className="text-[11px] text-gray-600">
					<span className="text-gray-400">Created:</span> {formatCreatedAt(dataset.created_at)}
				</div>
			</div>
		</div>
	)
}
