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

const pendingScrolls = new WeakMap<HTMLElement, number>()

export function scrollStoryViewIntoView(root: HTMLElement | null, index: number): void {
	const viewport = root?.ownerDocument.defaultView
	if (!root || !viewport) return
	const pending = pendingScrolls.get(root)
	if (pending !== undefined) viewport.cancelAnimationFrame(pending)
	// Disabling the focused final Next button during React's commit cancels a
	// synchronously started smooth scroll in Chromium. Start after that commit.
	pendingScrolls.set(
		root,
		viewport.requestAnimationFrame(() => {
			pendingScrolls.delete(root)
			if (!root.isConnected) return
			root.querySelector<HTMLElement>(`[data-story-view-index="${index}"]`)?.scrollIntoView({
				block: 'start',
				behavior: viewport.matchMedia('(prefers-reduced-motion: reduce)').matches
					? 'instant'
					: 'smooth',
			})
		}),
	)
}
