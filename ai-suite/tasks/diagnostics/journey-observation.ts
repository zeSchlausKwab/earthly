import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { inspectSurface, type SurfaceAudit } from './inspect-surface'

export const observeJourneyStepTask: AiTaskMetadata = {
	id: 'diagnostics.observe-journey-step',
	summary:
		'Capture user-visible state and layout risks at a meaningful journey step for later experience analysis.',
	preconditions: ['Earthly is open', 'The journey has reached a meaningful decision or outcome'],
	sideEffects: ['None; reads rendered state only'],
	viewports: 'both',
}

export interface JourneyStepObservation {
	step: string
	note?: string
	timestamp: string
	url: string
	pathname: string
	currentDestination: string | null
	headings: SurfaceAudit['headings']
	visibleDialogs: string[]
	visibleAlerts: string[]
	focusedControl: string | null
	surface: {
		documentOverflowX: number
		visibleControlCount: number
		unnamedControlCount: number
		undersizedControlCount: number
		clippedControlCount: number
		tinyTextCount: number
		unnamedControls: SurfaceAudit['unnamedControls']
		undersizedControls: SurfaceAudit['undersizedControls']
		clippedControls: SurfaceAudit['clippedControls']
		tinyText: SurfaceAudit['tinyText']
		repeatedControlNames: SurfaceAudit['repeatedControlNames']
	}
}

export async function observeJourneyStep(
	earthly: EarthlySession,
	step: string,
	note?: string,
): Promise<JourneyStepObservation> {
	await earthly.page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
			),
	)
	const surface = await inspectSurface(earthly)
	const visibleState = await earthly.page.evaluate(() => {
		const isVisible = (element: Element) => {
			const node = element as HTMLElement
			const rect = node.getBoundingClientRect()
			const style = getComputedStyle(node)
			return (
				style.display !== 'none' &&
				style.visibility !== 'hidden' &&
				rect.width > 0 &&
				rect.height > 0 &&
				rect.bottom > 0 &&
				rect.top < window.innerHeight
			)
		}
		const name = (element: Element) => {
			const node = element as HTMLElement
			return (
				node.getAttribute('aria-label')?.trim() ||
				node.getAttribute('title')?.trim() ||
				node.textContent?.replace(/\s+/g, ' ').trim() ||
				null
			)
		}
		const destination = Array.from(
			document.querySelectorAll('[aria-label^="Current destination:"]'),
		).find(isVisible)
		const focused = document.activeElement
		return {
			currentDestination: destination?.getAttribute('aria-label') ?? null,
			visibleDialogs: Array.from(document.querySelectorAll('[role="dialog"]'))
				.filter(isVisible)
				.map(name)
				.filter((value): value is string => Boolean(value)),
			visibleAlerts: Array.from(document.querySelectorAll('[role="alert"], [data-sonner-toast]'))
				.filter(isVisible)
				.map(name)
				.filter((value): value is string => Boolean(value)),
			focusedControl: focused && focused !== document.body ? name(focused) : null,
		}
	})

	return {
		step,
		note,
		timestamp: new Date().toISOString(),
		url: surface.url,
		pathname: new URL(surface.url).pathname,
		...visibleState,
		headings: surface.headings,
		surface: {
			documentOverflowX: surface.documentOverflowX,
			visibleControlCount: surface.visibleControlCount,
			unnamedControlCount: surface.unnamedControls.length,
			undersizedControlCount: surface.undersizedControls.length,
			clippedControlCount: surface.clippedControls.length,
			tinyTextCount: surface.tinyText.length,
			unnamedControls: surface.unnamedControls.slice(0, 12),
			undersizedControls: surface.undersizedControls.slice(0, 12),
			clippedControls: surface.clippedControls.slice(0, 12),
			tinyText: surface.tinyText.slice(0, 12),
			repeatedControlNames: surface.repeatedControlNames.slice(0, 12),
		},
	}
}
