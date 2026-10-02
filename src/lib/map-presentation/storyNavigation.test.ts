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
		const interactions = new Map<string, Set<() => void>>()
		const images: ReturnType<typeof pendingImage>[] = []
		let targetSelector = ''
		const target = {
			isConnected: true,
			DOCUMENT_POSITION_FOLLOWING: 4,
			scrollIntoView: (options: ScrollIntoViewOptions) =>
				calls.push({ selector: targetSelector, options }),
		}
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
			querySelector: (selector: string) => {
				targetSelector = selector
				return target
			},
			querySelectorAll: () => images,
			addEventListener: (event: string, callback: () => void) => {
				const listeners = interactions.get(event) ?? new Set()
				listeners.add(callback)
				interactions.set(event, listeners)
			},
			removeEventListener: (event: string, callback: () => void) =>
				interactions.get(event)?.delete(callback),
		}
		return {
			root: root as unknown as HTMLElement,
			calls,
			images,
			interact: (event: string) => {
				for (const callback of interactions.get(event) ?? []) callback()
			},
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
	function pendingImage(beforeTarget = true) {
		const events = new Map<string, Set<() => void>>()
		const image = {
			complete: false,
			compareDocumentPosition: () => (beforeTarget ? 4 : 2),
			addEventListener: (event: string, callback: () => void) => {
				const listeners = events.get(event) ?? new Set()
				listeners.add(callback)
				events.set(event, listeners)
			},
			removeEventListener: (event: string, callback: () => void) =>
				events.get(event)?.delete(callback),
			settle: (event: 'load' | 'error' = 'load') => {
				image.complete = true
				for (const callback of events.get(event) ?? []) callback()
			},
		}
		return image
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
	test('realigns only pending preceding image loads, coalescing load and error notifications', () => {
		const harness = scrollHarness()
		const first = pendingImage()
		const second = pendingImage()
		const following = pendingImage(false)
		harness.images.push(first, second, following)
		scrollStoryViewIntoView(harness.root, 1)
		harness.flush()
		following.settle()
		harness.flush()
		expect(harness.calls).toHaveLength(1)
		first.settle()
		second.settle('error')
		expect(harness.calls).toHaveLength(1)
		harness.flush()
		expect(harness.calls[1]).toEqual({
			selector: '[data-story-view-index="1"]',
			options: { block: 'start', behavior: 'instant' },
		})
	})
	test('reader interactions and a superseding jump cancel deferred image realignment', () => {
		for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
			const harness = scrollHarness()
			const image = pendingImage()
			harness.images.push(image)
			scrollStoryViewIntoView(harness.root, 1)
			harness.flush()
			image.settle()
			harness.interact(event)
			harness.flush()
			expect(harness.calls).toHaveLength(1)
		}
		const harness = scrollHarness()
		const image = pendingImage()
		harness.images.push(image)
		scrollStoryViewIntoView(harness.root, 1)
		harness.flush()
		image.settle()
		scrollStoryViewIntoView(harness.root, 3)
		harness.flush()
		expect(harness.calls.map((entry) => entry.selector)).toEqual([
			'[data-story-view-index="1"]',
			'[data-story-view-index="3"]',
		])
	})
	test('pending image loads do not scroll an article detached after the initial jump', () => {
		const harness = scrollHarness()
		const image = pendingImage()
		harness.images.push(image)
		scrollStoryViewIntoView(harness.root, 1)
		harness.flush()
		harness.detach()
		image.settle()
		harness.flush()
		expect(harness.calls).toHaveLength(1)
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
