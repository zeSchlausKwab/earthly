export type MapPopupPlacement = 'geometry' | 'dock'

interface ResolveMapPopupPositionOptions {
	containerWidth: number
	containerHeight: number
	popupWidth: number
	popupHeight: number
	anchorPoint?: { x: number; y: number } | null
	placement: MapPopupPlacement
	toolbarOffset: number
	margin?: number
	offset?: number
}

interface MapPopupPosition {
	left: number
	top: number
	maxHeight: number
}

function clamp(value: number, min: number, max: number): number {
	if (max <= min) return min
	return Math.min(Math.max(value, min), max)
}

export function resolveMapPopupPosition({
	containerWidth,
	containerHeight,
	popupWidth,
	popupHeight,
	anchorPoint,
	placement,
	toolbarOffset,
	margin = 12,
	offset = 14,
}: ResolveMapPopupPositionOptions): MapPopupPosition {
	if (placement === 'dock' || !anchorPoint) {
		const left = clamp(
			containerWidth - popupWidth - margin,
			margin,
			containerWidth - popupWidth - margin,
		)
		const top = clamp(
			toolbarOffset,
			margin,
			Math.max(margin, containerHeight - popupHeight - margin),
		)
		return {
			left,
			top,
			maxHeight: Math.max(120, containerHeight - top - margin),
		}
	}

	const left = clamp(
		anchorPoint.x - popupWidth / 2,
		margin,
		Math.max(margin, containerWidth - popupWidth - margin),
	)

	const aboveTop = anchorPoint.y - popupHeight - offset
	const belowTop = anchorPoint.y + offset
	let top = aboveTop

	if (aboveTop >= margin) {
		top = aboveTop
	} else if (belowTop + popupHeight <= containerHeight - margin) {
		top = belowTop
	} else {
		top = clamp(
			anchorPoint.y - popupHeight / 2,
			margin,
			Math.max(margin, containerHeight - popupHeight - margin),
		)
	}

	return {
		left,
		top,
		maxHeight: Math.max(120, containerHeight - top - margin),
	}
}
