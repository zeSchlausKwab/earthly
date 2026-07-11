import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export interface TourStepObservation {
	step: number
	progress: string
	title: string
	target: string | null
	targetVisible: boolean
	popoverFitsViewport: boolean
}

export const completeTourTask: AiTaskMetadata = {
	id: 'onboarding.complete-tour',
	summary: 'Progress every first-run tour step and finish the tour.',
	preconditions: ['Earthly opened with tour state new'],
	sideEffects: ['Sets earthly-tour-seen in browser storage'],
	viewports: 'both',
}

export const skipTourTask: AiTaskMetadata = {
	id: 'onboarding.skip-tour',
	summary: 'Dismiss the first-run tour through its close control.',
	preconditions: ['Visible first-run tour'],
	sideEffects: ['Sets earthly-tour-seen in browser storage'],
	viewports: 'both',
}

export const inspectTourTask: AiTaskMetadata = {
	id: 'onboarding.inspect-tour-targets',
	summary: 'Progress the tour while recording target visibility and popover fit.',
	preconditions: ['Earthly opened with tour state new'],
	sideEffects: ['Completes the tour', 'Sets earthly-tour-seen in browser storage'],
	viewports: 'both',
}

async function waitForTour(earthly: EarthlySession): Promise<void> {
	await expect(earthly.page.locator('.driver-popover')).toBeVisible()
}

async function waitForTourTransition(earthly: EarthlySession): Promise<void> {
	await earthly.page.evaluate(
		() =>
			new Promise<void>((resolve) => {
				let previousFrame = ''
				let stableFrames = 0
				const checkFrame = () => {
					const overlayPath =
						document.querySelector('.driver-overlay path')?.getAttribute('d') ?? ''
					const title = document.querySelector('.driver-popover-title')?.textContent ?? ''
					const activeTargets = Array.from(document.querySelectorAll('.driver-active-element'))
						.map((element) => element.getAttribute('data-tour') ?? element.id)
						.join('|')
					const currentFrame = `${overlayPath}::${title}::${activeTargets}`
					stableFrames = currentFrame === previousFrame ? stableFrames + 1 : 0
					previousFrame = currentFrame
					if (stableFrames >= 3) resolve()
					else requestAnimationFrame(checkFrame)
				}
				requestAnimationFrame(checkFrame)
			}),
	)
}

export async function completeTour(earthly: EarthlySession): Promise<void> {
	await waitForTour(earthly)
	for (let step = 1; step <= 11; step += 1) {
		const progress = earthly.page.locator('.driver-popover-progress-text')
		await expect(progress).toHaveText(`${step} of 11`)
		await earthly.page.locator('.driver-popover-next-btn').click()
		if (step < 11) {
			await waitForTourTransition(earthly)
			await expect(progress).toHaveText(`${step + 1} of 11`)
		}
	}
	await expect(earthly.page.locator('.driver-popover')).toBeHidden()
}

export async function skipTour(earthly: EarthlySession): Promise<void> {
	await waitForTour(earthly)
	await earthly.page.locator('.driver-popover-close-btn').click()
	await expect(earthly.page.locator('.driver-popover')).toBeHidden()
}

export async function inspectTourTargets(earthly: EarthlySession): Promise<TourStepObservation[]> {
	await waitForTour(earthly)
	const observations: TourStepObservation[] = []

	for (let step = 1; step <= 11; step += 1) {
		const observation = await earthly.page.evaluate((currentStep) => {
			const popover = document.querySelector<HTMLElement>('.driver-popover')
			const active = document.querySelector<HTMLElement>('.driver-active-element')
			const activeRect = active?.getBoundingClientRect()
			const popoverRect = popover?.getBoundingClientRect()
			return {
				step: currentStep,
				progress:
					popover?.querySelector('.driver-popover-progress-text')?.textContent?.trim() ?? '',
				title: popover?.querySelector('.driver-popover-title')?.textContent?.trim() ?? '',
				target: active?.getAttribute('data-tour') ?? null,
				targetVisible: Boolean(
					activeRect &&
						activeRect.width > 0 &&
						activeRect.height > 0 &&
						activeRect.bottom > 0 &&
						activeRect.right > 0 &&
						activeRect.top < innerHeight &&
						activeRect.left < innerWidth,
				),
				popoverFitsViewport: Boolean(
					popoverRect &&
						popoverRect.left >= 0 &&
						popoverRect.top >= 0 &&
						popoverRect.right <= innerWidth &&
						popoverRect.bottom <= innerHeight,
				),
			}
		}, step)
		observations.push(observation)

		await earthly.page.locator('.driver-popover-next-btn').click()
		if (step < 11) {
			await waitForTourTransition(earthly)
			await expect(earthly.page.locator('.driver-popover-progress-text')).toHaveText(
				`${step + 1} of 11`,
			)
			await expect(earthly.page.locator('.driver-popover-title')).not.toHaveText(observation.title)
		}
	}

	await expect(earthly.page.locator('.driver-popover')).toBeHidden()
	return observations
}
