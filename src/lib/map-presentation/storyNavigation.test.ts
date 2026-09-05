import { describe, expect, test } from 'bun:test'
import {
	drivingStoryViewIndexes,
	scrollStoryViewIntoView,
	storyViewAtReadingLine,
} from './storyNavigation'
import { reduceStoryViewBlocks } from './views'

describe('Story timeline navigation', () => {
	function scrollHarness(reducedMotion = false) {
		let frameId = 0
		const frames = new Map<number, () => void>()
		const calls: { selector: string; options: ScrollIntoViewOptions }[] = []
		const root = {
			isConnected: true,
			ownerDocument: {
				defaultView: {
					requestAnimationFrame: (callback: () => void) => {
						frames.set(++frameId, callback)
						return frameId
					},
					cancelAnimationFrame: (id: number) => frames.delete(id),
					matchMedia: () => ({ matches: reducedMotion }),
				},
			},
			querySelector: (selector: string) => ({
				scrollIntoView: (options: ScrollIntoViewOptions) => calls.push({ selector, options }),
			}),
		}
		return {
			root: root as unknown as HTMLElement,
			calls,
			detach: () => {
				root.isConnected = false
			},
			flush: () => {
				const callbacks = [...frames.values()]
				frames.clear()
				for (const callback of callbacks) callback()
			},
		}
	}
	test('scrolling waits for the committed presenter state and coalesces rapid steps', () => {
		const harness = scrollHarness()
		scrollStoryViewIntoView(harness.root, 2)
		scrollStoryViewIntoView(harness.root, 4)
		expect(harness.calls).toEqual([])
		harness.flush()
		expect(harness.calls).toEqual([
			{ selector: '[data-story-view-index="4"]', options: { block: 'start', behavior: 'smooth' } },
		])
	})
	test('scrolling honors reduced motion and does not revive a detached article', () => {
		const harness = scrollHarness(true)
		scrollStoryViewIntoView(harness.root, 0)
		harness.flush()
		expect(harness.calls[0]?.options.behavior).toBe('instant')
		scrollStoryViewIntoView(harness.root, 1)
		harness.detach()
		harness.flush()
		expect(harness.calls).toHaveLength(1)
		scrollStoryViewIntoView(null, 0)
	})
	test('Present steps only driving views without changing their physical indexes', () => {
		const { snapshots } = reduceStoryViewBlocks(
			{ version: 1, layers: [] },
			(['figure', 'cue', 'figure', 'both'] as const).map((display, index) => ({
				version: 1,
				type: 'view',
				id: `view-${index}`,
				title: `View ${index}`,
				display,
			})),
		)
		expect(drivingStoryViewIndexes(snapshots)).toEqual([1, 3])
		expect(drivingStoryViewIndexes([])).toEqual([])
	})
	test('Follow text holds its stage through prose, returns to opening, and crosses back in order', () => {
		const positions = [
			{ index: 0, top: 200 },
			{ index: 2, top: 600 },
			{ index: 3, top: 1000 },
		]
		expect(storyViewAtReadingLine(positions, 100)).toBeNull()
		expect(storyViewAtReadingLine(positions, 200)).toBe(0)
		expect(storyViewAtReadingLine(positions, 550)).toBe(0)
		expect(storyViewAtReadingLine(positions, 650)).toBe(2)
		expect(storyViewAtReadingLine(positions, 1200)).toBe(3)
		expect(storyViewAtReadingLine(positions, 450)).toBe(0)
		expect(storyViewAtReadingLine([], 100)).toBeNull()
	})
})
