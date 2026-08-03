import type { MapCalloutSide } from '@/lib/geo/callouts'

export type CalloutDisplayMode = 'full' | 'compact' | 'collapsed'

export function nextCalloutDisplayMode(mode: CalloutDisplayMode): CalloutDisplayMode {
	switch (mode) {
		case 'full':
			return 'compact'
		case 'compact':
			return 'collapsed'
		case 'collapsed':
			return 'full'
	}
}

export function calloutDisplayModeActionLabel(mode: CalloutDisplayMode): string {
	switch (mode) {
		case 'full':
			return 'Callout size: full. Switch to compact'
		case 'compact':
			return 'Callout size: compact. Switch to pins'
		case 'collapsed':
			return 'Callout size: pins. Switch to full'
	}
}

export interface ScreenPoint {
	x: number
	y: number
}

export interface ScreenSize {
	width: number
	height: number
}

export interface CalloutLayoutCandidate {
	key: string
	anchor: ScreenPoint
	preferredSide: MapCalloutSide
	offset: [number, number]
	fullSize: ScreenSize
	priority?: boolean
	initialMode?: CalloutDisplayMode
}

export interface ResolvedCalloutLayout {
	key: string
	anchor: ScreenPoint
	card: ScreenPoint & ScreenSize
	side: Exclude<MapCalloutSide, 'auto'>
	mode: CalloutDisplayMode
	connector: ScreenPoint
}

const GAP = 16
const COMPACT_SIZE: ScreenSize = { width: 168, height: 46 }
const COLLAPSED_SIZE: ScreenSize = { width: 30, height: 30 }
const ESTIMATED_DEFAULT_CARD_SIZE: ScreenSize = { width: 248, height: 92 }

/**
 * Approximate whether normal callout text can still be read comfortably at the
 * current scale. This is intentionally a presentation hint rather than an
 * authoring constraint: every callout remains present and can be expanded.
 */
export function defaultCalloutDisplayMode({
	zoom,
	viewport,
	calloutCount,
}: {
	zoom: number
	viewport: ScreenSize
	calloutCount: number
}): Extract<CalloutDisplayMode, 'full' | 'compact'> {
	const viewportArea = Math.max(1, viewport.width * viewport.height)
	const estimatedCoverage =
		(calloutCount * ESTIMATED_DEFAULT_CARD_SIZE.width * ESTIMATED_DEFAULT_CARD_SIZE.height) /
		viewportArea
	const compactBelowZoom = viewport.width < 640 ? 3.25 : 2.25

	return zoom < compactBelowZoom || estimatedCoverage > 0.4 ? 'compact' : 'full'
}

function sideOrder(side: MapCalloutSide): Exclude<MapCalloutSide, 'auto'>[] {
	if (side === 'auto') return ['right', 'top', 'left', 'bottom']
	return [side, ...(['right', 'top', 'left', 'bottom'] as const).filter((item) => item !== side)]
}

function positionFor(
	anchor: ScreenPoint,
	size: ScreenSize,
	side: Exclude<MapCalloutSide, 'auto'>,
	offset: [number, number],
): ScreenPoint {
	const [offsetX, offsetY] = offset
	switch (side) {
		case 'top':
			return { x: anchor.x - size.width / 2 + offsetX, y: anchor.y - GAP - size.height + offsetY }
		case 'bottom':
			return { x: anchor.x - size.width / 2 + offsetX, y: anchor.y + GAP + offsetY }
		case 'left':
			return { x: anchor.x - GAP - size.width + offsetX, y: anchor.y - size.height / 2 + offsetY }
		case 'right':
			return { x: anchor.x + GAP + offsetX, y: anchor.y - size.height / 2 + offsetY }
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function clampedCard(
	point: ScreenPoint,
	size: ScreenSize,
	viewport: ScreenSize,
	padding: number,
): ScreenPoint & ScreenSize {
	return {
		x: clamp(point.x, padding, Math.max(padding, viewport.width - padding - size.width)),
		y: clamp(point.y, padding, Math.max(padding, viewport.height - padding - size.height)),
		...size,
	}
}

function overlaps(a: ScreenPoint & ScreenSize, b: ScreenPoint & ScreenSize, margin = 6): boolean {
	return !(
		a.x + a.width + margin <= b.x ||
		b.x + b.width + margin <= a.x ||
		a.y + a.height + margin <= b.y ||
		b.y + b.height + margin <= a.y
	)
}

function connectorFor(anchor: ScreenPoint, card: ScreenPoint & ScreenSize): ScreenPoint {
	return {
		x: clamp(anchor.x, card.x, card.x + card.width),
		y: clamp(anchor.y, card.y, card.y + card.height),
	}
}

/**
 * Resolve authored preferences against the current viewport. Every candidate is
 * retained: collisions progressively compact/collapse cards but never discard
 * authored callouts merely because the map is dense.
 */
export function resolveCalloutLayout(
	candidates: CalloutLayoutCandidate[],
	viewport: ScreenSize,
	padding = 12,
): ResolvedCalloutLayout[] {
	const placed: ResolvedCalloutLayout[] = []
	const ordered = [...candidates].sort(
		(a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority)),
	)

	for (const candidate of ordered) {
		const fullMode = { mode: 'full' as const, size: candidate.fullSize }
		const fallbackModes: Array<{ mode: CalloutDisplayMode; size: ScreenSize }> = [
			fullMode,
			{ mode: 'compact', size: COMPACT_SIZE },
			{ mode: 'collapsed', size: COLLAPSED_SIZE },
		]
		const initialModeIndex = fallbackModes.findIndex(
			({ mode }) => mode === (candidate.initialMode ?? 'full'),
		)
		const modes = candidate.priority
			? [fullMode]
			: fallbackModes.slice(Math.max(0, initialModeIndex))

		let resolved: ResolvedCalloutLayout | null = null
		for (const { mode, size: desiredSize } of modes) {
			const size = {
				width: Math.min(
					desiredSize.width,
					Math.max(COLLAPSED_SIZE.width, viewport.width - padding * 2),
				),
				height: Math.min(
					desiredSize.height,
					Math.max(COLLAPSED_SIZE.height, viewport.height - padding * 2),
				),
			}
			for (const side of sideOrder(candidate.preferredSide)) {
				const card = clampedCard(
					positionFor(candidate.anchor, size, side, candidate.offset),
					size,
					viewport,
					padding,
				)
				if (!candidate.priority && placed.some((item) => overlaps(card, item.card))) continue
				resolved = {
					key: candidate.key,
					anchor: candidate.anchor,
					card,
					side,
					mode,
					connector: connectorFor(candidate.anchor, card),
				}
				break
			}
			if (resolved) break
		}

		// Even an extremely dense map retains the authored item. At the final
		// fallback it may overlap another collapsed marker, matching the local
		// presentation rule without imposing a content/count limit.
		if (!resolved) {
			const side = sideOrder(candidate.preferredSide)[0] ?? 'right'
			const card = clampedCard(
				positionFor(candidate.anchor, COLLAPSED_SIZE, side, candidate.offset),
				COLLAPSED_SIZE,
				viewport,
				padding,
			)
			resolved = {
				key: candidate.key,
				anchor: candidate.anchor,
				card,
				side,
				mode: 'collapsed',
				connector: connectorFor(candidate.anchor, card),
			}
		}

		placed.push(resolved)
	}

	return placed
}
