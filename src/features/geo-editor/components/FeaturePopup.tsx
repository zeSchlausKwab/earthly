import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { RichContentRenderer } from '@/components/editor'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	countGeometryVertices,
	featureDetailDescription,
	featureDetailName,
	featureDetailProperties,
	formatFeatureProperty,
	resolveInspectedFeature,
} from './feature-details'
import type { PresentationFeatureProvenance } from '../map-presentation/ids'
import { resolveMapPopupPosition, type MapPopupPlacement } from './map-popup-positioning'

export interface FeaturePopupData {
	/** The dataset containing the selected feature */
	dataset: GeoDataset
	/** The selected feature */
	feature: Feature<Geometry>
	/** Complete data for externally stored or presentation-selected Maps. */
	sourceCollection?: FeatureCollection
	/** Screen position where the feature was selected */
	clickPosition: { x: number; y: number }
	/** Whether the current user owns this dataset */
	isOwner: boolean
	/** Name of the dataset */
	datasetName: string
	/** Present when this is a Story/Atlas render instance rather than author view. */
	presentation?: PresentationFeatureProvenance
}

interface FeaturePopupProps {
	data: FeaturePopupData | null
	/** Container ref for positioning calculations */
	containerRef: React.RefObject<HTMLDivElement | null>
	placementMode?: MapPopupPlacement
	toolbarOffset?: number
	interactive?: boolean
	onHoverChange?: (hovered: boolean) => void
	onClose?: () => void
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 240

export function FeaturePopup({
	data,
	containerRef,
	placementMode = 'geometry',
	toolbarOffset = 72,
	interactive = false,
	onHoverChange,
	onClose,
}: FeaturePopupProps) {
	const details = useMemo(() => {
		if (!data) return null
		const feature = resolveInspectedFeature(
			data.feature,
			data.sourceCollection ?? data.dataset.featureCollection,
			data.presentation?.sourceFeatureId,
		)
		return {
			feature,
			name: featureDetailName(feature),
			description: featureDetailDescription(feature),
			properties: featureDetailProperties(feature),
			vertexCount: countGeometryVertices(feature.geometry),
		}
	}, [data])
	useEffect(() => {
		if (!data || !onClose) return
		const dismiss = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose()
		}
		window.addEventListener('keydown', dismiss)
		return () => window.removeEventListener('keydown', dismiss)
	}, [data, onClose])
	const popupRef = useRef<HTMLDivElement>(null)
	const contentRef = useRef<HTMLElement>(null)
	useLayoutEffect(() => {
		if (data && contentRef.current) contentRef.current.scrollTop = 0
	}, [data])
	const [position, setPosition] = useState({ left: 12, top: 12, maxHeight: 280 })

	const updatePosition = useCallback(() => {
		if (!data || !containerRef.current || !popupRef.current) return
		const containerRect = containerRef.current.getBoundingClientRect()
		const bottomInset =
			Number.parseFloat(
				getComputedStyle(containerRef.current).getPropertyValue('--mobile-sheet-height'),
			) || 0
		const availableHeight = Math.max(0, containerRect.height - bottomInset)
		const popupWidth = popupRef.current.offsetWidth || POPUP_WIDTH
		const popupHeight = Math.min(
			popupRef.current.offsetHeight || POPUP_HEIGHT_ESTIMATE,
			Math.max(120, availableHeight - 24),
		)
		setPosition(
			resolveMapPopupPosition({
				containerWidth: containerRect.width,
				containerHeight: availableHeight,
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
		// The mobile sheet changes the exposed map area without resizing its canvas.
		const insetObserver = new MutationObserver(updatePosition)
		insetObserver.observe(containerEl, { attributes: true, attributeFilter: ['style'] })

		if (typeof ResizeObserver !== 'undefined') {
			const observer = new ResizeObserver(() => updatePosition())
			observer.observe(popupEl)
			observer.observe(containerEl)
			return () => {
				window.removeEventListener('resize', handleResize)
				observer.disconnect()
				insetObserver.disconnect()
			}
		}

		return () => {
			window.removeEventListener('resize', handleResize)
			insetObserver.disconnect()
		}
	}, [containerRef, data, updatePosition])

	if (!data || !details) return null

	const { datasetName } = data
	const { feature, name, description, properties, vertexCount } = details

	return (
		<div
			ref={popupRef}
			role="dialog"
			aria-label={`${name} details`}
			className={`absolute z-50 flex flex-col overflow-hidden border border-border bg-card/95 shadow-xl backdrop-blur ${
				interactive ? 'pointer-events-auto' : 'pointer-events-none'
			}`}
			style={{
				width: `min(${POPUP_WIDTH}px, calc(100% - 24px))`,
				left: position.left,
				top: position.top,
				maxHeight: Math.min(420, position.maxHeight),
			}}
			onMouseEnter={() => onHoverChange?.(true)}
			onMouseLeave={() => onHoverChange?.(false)}
		>
			<div className="flex shrink-0 items-start gap-2 border-b border-border bg-muted/80 px-3 py-2">
				<div className="min-w-0 flex-1">
					<h3 className="break-words font-semibold text-sm text-foreground">{name}</h3>
					<p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={datasetName}>
						{datasetName}
					</p>
				</div>
				{onClose && (
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						onClick={onClose}
						aria-label="Close feature details"
					>
						<X className="size-4" aria-hidden="true" />
					</Button>
				)}
			</div>

			<section
				ref={contentRef}
				tabIndex={interactive ? 0 : undefined}
				className="min-h-0 space-y-3 overflow-y-auto overscroll-contain px-3 py-2"
				aria-label="Feature information"
			>
				{description && (
					<RichContentRenderer
						content={description}
						className="space-y-2 break-words text-xs text-foreground"
					/>
				)}
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-y border-border py-2 text-[11px]">
					<dt className="text-muted-foreground">Geometry</dt>
					<dd>{feature.geometry?.type ?? 'External geometry'}</dd>
					{feature.id != null && (
						<>
							<dt className="text-muted-foreground">Feature ID</dt>
							<dd className="break-all font-mono">{String(feature.id)}</dd>
						</>
					)}
					<dt className="text-muted-foreground">Vertices</dt>
					<dd>{vertexCount.toLocaleString()}</dd>
					{feature.geometry?.type === 'Point' && (
						<>
							<dt className="text-muted-foreground">Coordinates</dt>
							<dd>{feature.geometry.coordinates.map((value) => value.toFixed(5)).join(', ')}</dd>
						</>
					)}
				</dl>
				<section aria-label="Feature properties">
					<h4 className="mb-1 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
						Properties · {properties.length}
					</h4>
					{properties.length ? (
						<dl className="divide-y divide-border text-xs">
							{properties.map(([key, value]) => (
								<div key={key} className="py-1.5">
									<dt className="break-words font-medium text-muted-foreground">{key}</dt>
									<dd className="mt-0.5 whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-foreground">
										{formatFeatureProperty(value)}
									</dd>
								</div>
							))}
						</dl>
					) : (
						<p className="text-xs text-muted-foreground">No properties provided.</p>
					)}
				</section>
			</section>
		</div>
	)
}
