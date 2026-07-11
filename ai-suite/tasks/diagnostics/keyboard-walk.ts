import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const keyboardWalkTask: AiTaskMetadata = {
	id: 'diagnostics.keyboard-walk',
	summary: 'Walk the rendered tab order and record the focus target, name, and viewport position.',
	preconditions: ['Earthly is open', 'No modal interaction is in progress'],
	sideEffects: ['Moves keyboard focus without activating controls'],
	viewports: 'both',
}

export interface KeyboardStop {
	step: number
	tag: string
	name: string
	role: string | null
	disabled: boolean
	insideViewport: boolean
	position: { x: number; y: number; width: number; height: number }
}

export async function walkKeyboardOrder(
	earthly: EarthlySession,
	steps = 30,
): Promise<KeyboardStop[]> {
	await earthly.page.locator('body').focus()
	const stops: KeyboardStop[] = []
	for (let step = 1; step <= steps; step += 1) {
		await earthly.page.keyboard.press('Tab')
		stops.push(
			await earthly.page.evaluate((currentStep) => {
				const element = document.activeElement as HTMLElement | null
				if (!element) {
					return {
						step: currentStep,
						tag: 'none',
						name: '',
						role: null,
						disabled: false,
						insideViewport: false,
						position: { x: 0, y: 0, width: 0, height: 0 },
					}
				}
				const rect = element.getBoundingClientRect()
				const labelledBy = element.getAttribute('aria-labelledby')
				const labelledText = labelledBy
					?.split(/\s+/)
					.map((id) => document.getElementById(id)?.textContent?.trim() ?? '')
					.filter(Boolean)
					.join(' ')
				const inputLabel =
					element instanceof HTMLInputElement ||
					element instanceof HTMLTextAreaElement ||
					element instanceof HTMLSelectElement
						? element.labels?.[0]?.textContent?.trim()
						: ''
				return {
					step: currentStep,
					tag: element.tagName.toLowerCase(),
					name: (
						element.getAttribute('aria-label')?.trim() ||
						labelledText ||
						inputLabel ||
						element.textContent?.replace(/\s+/g, ' ').trim() ||
						element.getAttribute('title')?.trim() ||
						element.getAttribute('placeholder')?.trim() ||
						''
					).slice(0, 120),
					role: element.getAttribute('role'),
					disabled:
						element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true',
					insideViewport:
						rect.width > 0 &&
						rect.height > 0 &&
						rect.right > 0 &&
						rect.left < window.innerWidth &&
						rect.bottom > 0 &&
						rect.top < window.innerHeight,
					position: {
						x: Math.round(rect.x),
						y: Math.round(rect.y),
						width: Math.round(rect.width),
						height: Math.round(rect.height),
					},
				}
			}, step),
		)
	}
	return stops
}
