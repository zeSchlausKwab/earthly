import type { StoryViewSnapshotV1 } from './types'

/** Document indexes, not presentation-step ordinals: figures keep their place in the body. */
export function drivingStoryViewIndexes(snapshots: readonly StoryViewSnapshotV1[]): number[] {
	return snapshots.flatMap((snapshot, index) => (snapshot.view.display === 'figure' ? [] : [index]))
}

/** Keep the last driving view crossed by the reading line through intervening prose. */
export function storyViewAtReadingLine(
	positions: readonly { index: number; top: number }[],
	readingLine: number,
): number | null {
	let active: number | null = null
	for (const position of positions) {
		if (position.top > readingLine) break
		active = position.index
	}
	return active
}

const pendingScrolls = new WeakMap<HTMLElement, { cancel: () => void }>()

export function scrollStoryViewIntoView(root: HTMLElement | null, index: number): void {
	const viewport = root?.ownerDocument.defaultView
	if (!root || !viewport) return
	pendingScrolls.get(root)?.cancel()
	let frame: number | undefined
	const pendingImages = new Map<HTMLImageElement, () => void>()
	const interactions = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const
	const cancel = () => {
		if (frame !== undefined) viewport.cancelAnimationFrame(frame)
		for (const [image, settled] of pendingImages) {
			image.removeEventListener('load', settled)
			image.removeEventListener('error', settled)
		}
		pendingImages.clear()
		for (const event of interactions) root.removeEventListener(event, cancel, true)
		pendingScrolls.delete(root)
	}
	pendingScrolls.set(root, { cancel })
	// Disabling the focused final Next button during React's commit cancels a
	// synchronously started smooth scroll in Chromium. Start after that commit.
	frame = viewport.requestAnimationFrame(() => {
		frame = undefined
		const target = root.querySelector<HTMLElement>(`[data-story-view-index="${index}"]`)
		if (!root.isConnected || !target) {
			cancel()
			return
		}
		// A lazy image above the cue can acquire height after the jump. Mobile
		// browsers do not consistently preserve that scroll anchor. Follow only
		// these pending loads, and stop as soon as the reader interacts again.
		for (const image of root.querySelectorAll<HTMLImageElement>('img')) {
			if (
				image.complete ||
				!(image.compareDocumentPosition(target) & target.DOCUMENT_POSITION_FOLLOWING)
			)
				continue
			const settled = () => {
				image.removeEventListener('load', settled)
				image.removeEventListener('error', settled)
				pendingImages.delete(image)
				if (frame !== undefined) return
				frame = viewport.requestAnimationFrame(() => {
					frame = undefined
					if (!root.isConnected || !target.isConnected) {
						cancel()
						return
					}
					target.scrollIntoView({ block: 'start', behavior: 'instant' })
					if (pendingImages.size === 0) cancel()
				})
			}
			pendingImages.set(image, settled)
			image.addEventListener('load', settled)
			image.addEventListener('error', settled)
		}
		for (const event of interactions)
			root.addEventListener(event, cancel, { capture: true, passive: true })
		target.scrollIntoView({
			block: 'start',
			behavior: viewport.matchMedia('(prefers-reduced-motion: reduce)').matches
				? 'instant'
				: 'smooth',
		})
		if (pendingImages.size === 0) cancel()
	})
}
