import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import type { ReverseLookupOutput } from '@/ctxcn/EarthlyGeoServerClient'

type ReverseLookupResult = ReverseLookupOutput['result']

interface LocationInspectorPopupProps {
	isOpen: boolean
	loading: boolean
	error: string | null
	result: ReverseLookupResult | null
	/** Position in screen coordinates where the user clicked */
	clickPosition: { x: number; y: number } | null
	/** Container dimensions to calculate popup positioning */
	containerRef: React.RefObject<HTMLDivElement | null>
	onClose: () => void
}

const POPUP_WIDTH = 320
const POPUP_HEIGHT_ESTIMATE = 200
const OFFSET = 16

export function LocationInspectorPopup({
	isOpen,
	loading,
	error,
	result,
	clickPosition,
	containerRef,
	onClose,
}: LocationInspectorPopupProps) {
	const popupRef = useRef<HTMLDivElement>(null)
	const [position, setPosition] = useState<{ x: number; y: number; anchor: 'top' | 'bottom' }>({
		x: 0,
		y: 0,
		anchor: 'bottom',
	})

	// Calculate optimal popup position based on click location and container bounds
	useEffect(() => {
		if (!clickPosition || !containerRef.current) return

		const container = containerRef.current
		const containerRect = container.getBoundingClientRect()
		const containerWidth = containerRect.width
		const containerHeight = containerRect.height

		// Calculate X position (centered on click, but clamped to container)
		let x = clickPosition.x - POPUP_WIDTH / 2
		x = Math.max(8, Math.min(x, containerWidth - POPUP_WIDTH - 8))

		// Calculate Y position (prefer above cursor, but flip if not enough space)
		const spaceAbove = clickPosition.y - OFFSET
		const spaceBelow = containerHeight - clickPosition.y - OFFSET

		let y: number
		let anchor: 'top' | 'bottom'

		if (spaceAbove >= POPUP_HEIGHT_ESTIMATE) {
			// Position above cursor
			y = clickPosition.y - OFFSET
			anchor = 'bottom'
		} else if (spaceBelow >= POPUP_HEIGHT_ESTIMATE) {
			// Position below cursor
			y = clickPosition.y + OFFSET
			anchor = 'top'
		} else {
			// Default to above if neither fits well
			y = clickPosition.y - OFFSET
			anchor = 'bottom'
		}

		setPosition({ x, y, anchor })
	}, [clickPosition, containerRef])

	if (!isOpen || !clickPosition) return null

	const hasContent = loading || error || result

	return (
		<div
			ref={popupRef}
			className="pointer-events-auto absolute z-50 w-80 overflow-hidden rounded-xl bg-card/95 shadow-2xl backdrop-blur ring-1 ring-black/5"
			style={{
				left: position.x,
				...(position.anchor === 'bottom'
					? { bottom: `calc(100% - ${position.y}px)` }
					: { top: position.y }),
				maxHeight: 'min(400px, 50vh)',
			}}
		>
			{/* Header */}
			<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/80 px-3 py-2">
				<div className="text-xs font-medium text-muted-foreground">Location Details</div>
				<Button
					size="icon"
					variant="ghost"
					className="h-6 w-6"
					aria-label="Close"
					onClick={onClose}
				>
					<X className="h-3.5 w-3.5" />
				</Button>
			</div>

			{/* Content */}
			<div className="max-h-[300px] overflow-y-auto px-3 py-3 text-sm text-foreground">
				{loading && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<div className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-gray-600" />
						Fetching location info...
					</div>
				)}

				{error && <div className="text-xs text-destructive">{error}</div>}

				{result && (
					<div className="space-y-3">
						<div>
							<div className="font-medium leading-tight">
								{result.result?.displayName ?? 'No address found'}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{result.coordinates.lat.toFixed(5)}, {result.coordinates.lon.toFixed(5)}
							</div>
						</div>

						<div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							{result.result?.type && (
								<span className="rounded-full bg-muted px-2 py-0.5 capitalize">
									{result.result.type}
								</span>
							)}
							{result.result?.class && (
								<span className="rounded-full bg-muted px-2 py-0.5 capitalize">
									{result.result.class}
								</span>
							)}
							{result.zoom !== undefined && (
								<span className="rounded-full bg-muted px-2 py-0.5">zoom {result.zoom}</span>
							)}
						</div>

						{result.result?.address && (
							<div className="rounded-lg border border-border bg-muted p-2 text-[11px] text-foreground">
								{Object.entries(result.result.address)
									.slice(0, 8)
									.map(([key, value]) => (
										<div key={key} className="flex items-center gap-1">
											<span className="capitalize text-muted-foreground">{key}:</span>
											<span className="truncate">{value}</span>
										</div>
									))}
							</div>
						)}
					</div>
				)}

				{!hasContent && (
					<div className="text-xs text-muted-foreground">
						Click on the map to inspect a location.
					</div>
				)}
			</div>
		</div>
	)
}
