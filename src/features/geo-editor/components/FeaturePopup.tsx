import { useEffect, useState } from 'react'
import type { Feature, Geometry } from 'geojson'
import type { NDKGeoEvent } from '@/lib/ndk/NDKGeoEvent'
import { RichContentRenderer } from '@/components/editor'

export interface FeaturePopupData {
	/** The dataset containing the hovered feature */
	dataset: NDKGeoEvent
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
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 240
const OFFSET = 12

function getDatasetDescription(dataset: NDKGeoEvent): string | null {
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

function shortPubkey(pubkey: string): string {
	if (!pubkey) return 'Unknown'
	if (pubkey.length <= 16) return pubkey
	return `${pubkey.slice(0, 8)}…${pubkey.slice(-4)}`
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

export function FeaturePopup({ data, containerRef }: FeaturePopupProps) {
	const [position, setPosition] = useState<{ x: number; y: number; anchor: 'top' | 'bottom' }>({
		x: 0,
		y: 0,
		anchor: 'bottom',
	})

	useEffect(() => {
		if (!data?.clickPosition || !containerRef.current) return

		const container = containerRef.current
		const containerRect = container.getBoundingClientRect()
		const containerWidth = containerRect.width
		const containerHeight = containerRect.height

		let x = data.clickPosition.x - POPUP_WIDTH / 2
		x = Math.max(8, Math.min(x, containerWidth - POPUP_WIDTH - 8))

		const spaceAbove = data.clickPosition.y - OFFSET
		const spaceBelow = containerHeight - data.clickPosition.y - OFFSET

		let y: number
		let anchor: 'top' | 'bottom'

		if (spaceAbove >= POPUP_HEIGHT_ESTIMATE) {
			y = data.clickPosition.y - OFFSET
			anchor = 'bottom'
		} else if (spaceBelow >= POPUP_HEIGHT_ESTIMATE) {
			y = data.clickPosition.y + OFFSET
			anchor = 'top'
		} else {
			y = data.clickPosition.y - OFFSET
			anchor = 'bottom'
		}

		setPosition({ x, y, anchor })
	}, [data?.clickPosition, containerRef])

	if (!data) return null

	const { dataset, datasetName, feature } = data
	const description = getDatasetDescription(dataset)
	const featureLabel = getFeatureLabel(feature)
	const vertexCount = countGeometryVertices(feature.geometry)

	return (
		<div
			className="pointer-events-none absolute z-50 overflow-hidden rounded-xl bg-white/95 shadow-2xl backdrop-blur ring-1 ring-black/5"
			style={{
				width: POPUP_WIDTH,
				left: position.x,
				...(position.anchor === 'bottom'
					? { bottom: `calc(100% - ${position.y}px)` }
					: { top: position.y }),
			}}
		>
			<div className="border-b border-gray-100 bg-gray-50/80 px-3 py-2">
				<div className="font-semibold text-sm text-gray-900 truncate">{datasetName}</div>
				<div className="mt-0.5 text-[11px] text-gray-600">
					<span className="text-gray-400">Author:</span> {shortPubkey(dataset.pubkey)}
				</div>
			</div>

			<div className="px-3 py-2 space-y-2">
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
