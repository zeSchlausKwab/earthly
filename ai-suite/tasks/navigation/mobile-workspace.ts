import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { openPanel } from './open-panel'

export type MobileWorkspacePanel = 'Shelf' | 'Edit' | 'Inspect' | 'Chat'
export type MobileEntitySurface = 'Map' | 'Story' | 'Atlas' | 'Inspect'

export const switchMobileWorkspacePanelTask: AiTaskMetadata = {
	id: 'navigation.switch-mobile-workspace-panel',
	summary: 'Open Shelf or the current object’s Details/Thread through visible route controls.',
	preconditions: ['Mobile Earthly session', 'The map workspace sheet is open'],
	sideEffects: ['Navigates to Shelf, object Details, or the route-bound Thread'],
	viewports: 'mobile',
}

export const setMobileWorkspaceTransparencyTask: AiTaskMetadata = {
	id: 'navigation.set-mobile-workspace-transparency',
	summary: 'Make the mobile map workspace sheet translucent or opaque.',
	preconditions: ['Mobile Earthly session', 'The map workspace sheet is open'],
	sideEffects: ['Changes only the visual opacity of the map workspace sheet'],
	viewports: 'mobile',
}

export const selectMobileEntitySurfaceTask: AiTaskMetadata = {
	id: 'navigation.select-mobile-entity-surface',
	summary: 'Resume a retained Map, Story, Atlas, or inspection through saved work.',
	preconditions: ['Mobile Earthly session', 'At least two retained entity surfaces exist'],
	sideEffects: ['Restores the retained entity through its canonical route'],
	viewports: 'mobile',
}

function requireMobile(earthly: EarthlySession): void {
	if (!earthly.isMobile) throw new Error('The mobile workspace task requires a mobile viewport.')
}

export function mobileWorkspaceSheet(earthly: EarthlySession) {
	return earthly.page.getByTestId('mobile-sheet')
}

export function mobileWorkspaceSheetControls(earthly: EarthlySession) {
	return mobileWorkspaceSheet(earthly).getByTestId('mobile-sheet-controls')
}

/** Object tabs belong to the inspected entity, never to the sheet chrome. */
export function mobileWorkspaceTabs(earthly: EarthlySession) {
	return mobileWorkspaceSheet(earthly).getByRole('tablist', {
		name: 'Object sections',
		exact: true,
	})
}

/** Navigate through the actual account, object, or draft controls. */
export async function switchMobileWorkspacePanel(
	earthly: EarthlySession,
	panel: MobileWorkspacePanel,
): Promise<void> {
	requireMobile(earthly)
	const page = earthly.page
	if (panel === 'Shelf') {
		await openPanel(earthly, 'Shelf')
		return
	}
	const tabs = mobileWorkspaceTabs(earthly)
	if (panel === 'Chat') {
		const thread = page.getByRole('region', { name: 'AI Thread', exact: true })
		if (await thread.isVisible()) return
		// Deep-link hydration may still be mounting its already-routed Thread.
		// Do not click a draft dock that this route deliberately replaces.
		if (new URL(page.url()).searchParams.get('tab') === 'thread') {
			await expect(thread).toBeVisible()
			return
		}
		if (await tabs.isVisible()) {
			await tabs.getByRole('tab', { name: 'Thread', exact: true }).click()
		} else {
			await page.getByRole('button', { name: 'Ask', exact: true }).click()
		}
		await expect(page.getByRole('region', { name: 'AI Thread', exact: true })).toBeVisible()
		return
	}
	if (await tabs.isVisible()) {
		await tabs.getByRole('tab', { name: 'Details', exact: true }).click()
		return
	}
	const back = page.getByRole('button', { name: 'Back to Map', exact: true })
	if (await back.isVisible()) await back.click()
	const details = page.getByRole('button', { name: 'Map details', exact: true })
	if (await details.isVisible()) await details.click()
	if (
		await mobileWorkspaceSheet(earthly)
			.getByPlaceholder('Name', { exact: true })
			.first()
			.isVisible()
	)
		return
	await selectMobileEntitySurface(earthly, panel === 'Inspect' ? 'Inspect' : 'Map')
}

export async function selectMobileEntitySurface(
	earthly: EarthlySession,
	surface: MobileEntitySurface,
	expectedName?: string,
): Promise<void> {
	requireMobile(earthly)
	const page = earthly.page
	const shelf = mobileWorkspaceSheet(earthly).getByRole('region', { name: 'On the map', exact: true })
	if (surface === 'Map' && (await shelf.isVisible())) {
		if (expectedName) await expect(shelf).toContainText(expectedName)
		await shelf.getByRole('button', { name: 'Open editor panel', exact: true }).click()
	} else {
		const picker = mobileWorkspaceSheet(earthly).getByRole('button', {
			name: 'Resume saved work',
			exact: true,
		})
		await expect(picker).toBeVisible()
		await picker.click()
		const option = page
			.getByRole('menuitem', {
				name: expectedName ? `${surface} · ${expectedName}` : new RegExp(`^${surface} · `),
				exact: Boolean(expectedName),
			})
			.first()
		await expect(option).toBeVisible()
		await option.click()
		await expect(page.getByRole('menu')).toBeHidden()
	}
	if (surface === 'Map') {
		const details = page.getByRole('button', { name: 'Map details', exact: true })
		const name = mobileWorkspaceSheet(earthly).getByPlaceholder('Name', { exact: true }).first()
		await expect(details.or(name).first()).toBeVisible()
		if (await details.isVisible()) await details.click()
		await expect(name).toBeVisible()
	}
}

export async function setMobileWorkspaceTransparency(
	earthly: EarthlySession,
	translucent: boolean,
): Promise<void> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	await expect(sheet).toBeVisible()
	const currentAction = translucent ? 'See map through panel' : 'Use opaque panel'
	const resultingAction = translucent ? 'Use opaque panel' : 'See map through panel'
	const toggle = sheet.getByRole('button', { name: currentAction, exact: true })
	if (await toggle.isVisible()) await toggle.click()
	await expect(sheet.getByRole('button', { name: resultingAction, exact: true })).toBeVisible()
	await expect(sheet).toHaveAttribute('data-translucent', translucent ? 'true' : 'false')
}

type ControlBox = { x: number; y: number; width: number; height: number }

export interface MobileWorkspaceChromeSnapshot {
	sheet: ControlBox
	controls: ControlBox
	slider: ControlBox
	detentPx: number
	transparency: ControlBox
	close: ControlBox
	resume: ControlBox | null
}

export interface MobileEditingTargetPillSnapshot {
	shell: { x: number; y: number; width: number; height: number }
	visualCapsule: { x: number; y: number; width: number; height: number }
	openAction: { x: number; y: number; width: number; height: number }
	label: string
	foregroundRgb: [number, number, number]
	visualCapsuleBackgroundRgb: [number, number, number]
	textContrastRatio: number
}

/** Capture the compact sheet rail without the removed workspace tabs/picker. */
export async function mobileWorkspaceChromeSnapshot(
	earthly: EarthlySession,
): Promise<MobileWorkspaceChromeSnapshot> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	const controls = mobileWorkspaceSheetControls(earthly)
	const slider = controls.getByRole('slider', { name: 'Resize panel', exact: true })
	const transparency = sheet.getByRole('button', {
		name: /^(?:See map through panel|Use opaque panel)$/,
	})
	const close = sheet.getByRole('button', { name: /^Close / }).first()
	const resume = sheet.getByRole('button', { name: 'Resume saved work', exact: true })
	await expect(controls).toBeVisible()
	await expect(controls.getByRole('tablist')).toHaveCount(0)
	await expect(sheet.getByRole('combobox', { name: 'Edit or inspect target' })).toHaveCount(0)
	for (const control of [slider, transparency, close]) await expect(control).toBeVisible()
	const [sheetBox, controlsBox, sliderBox, transparencyBox, closeBox, resumeBox] =
		await Promise.all([
			sheet.boundingBox(),
			controls.boundingBox(),
			slider.boundingBox(),
			transparency.boundingBox(),
			close.boundingBox(),
			resume.isVisible().then((visible) => (visible ? resume.boundingBox() : null)),
		])
	const detentPx = Number(await slider.getAttribute('aria-valuenow'))
	if (
		!sheetBox ||
		!controlsBox ||
		!sliderBox ||
		!transparencyBox ||
		!closeBox ||
		!Number.isFinite(detentPx)
	) {
		throw new Error('The compact mobile sheet rail did not produce measurable controls.')
	}
	return {
		sheet: sheetBox,
		controls: controlsBox,
		slider: sliderBox,
		transparency: transparencyBox,
		close: closeBox,
		resume: resumeBox,
		detentPx,
	}
}

/**
 * Measure the compact painted target capsule independently from its preserved
 * 44px interaction row. The semantic editor action identifies the correct
 * target when more than one retained entity is present.
 */
export async function mobileEditingTargetPillSnapshot(
	earthly: EarthlySession,
	targetName: string,
): Promise<MobileEditingTargetPillSnapshot> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	const openAction = sheet.getByRole('button', {
		name: `Open ${targetName} in geometry editor`,
		exact: true,
	})
	await expect(openAction).toBeVisible()
	const shell = openAction.locator('xpath=ancestor::*[@data-binding-chip-density="compact"][1]')
	await expect(shell).toHaveCount(1)
	await expect(shell).toBeVisible()
	const label = shell.getByText(targetName, { exact: true })
	await expect(label).toBeVisible()
	await expect(label).toHaveAttribute('title', targetName)

	const [openActionBox, measurement, labelText] = await Promise.all([
		openAction.boundingBox(),
		shell.evaluate((element) => {
			if (!(element instanceof HTMLElement)) {
				throw new Error('The mobile editing-target shell is not an HTML element.')
			}
			const shellBox = element.getBoundingClientRect()
			const before = getComputedStyle(element, '::before')
			const insetTop = Number.parseFloat(before.top)
			const insetRight = Number.parseFloat(before.right)
			const insetBottom = Number.parseFloat(before.bottom)
			const insetLeft = Number.parseFloat(before.left)
			if (![insetTop, insetRight, insetBottom, insetLeft].every(Number.isFinite)) {
				throw new Error('The compact editing-target capsule did not expose measurable insets.')
			}

			const labelElement = element.querySelector<HTMLElement>('span[title]')
			if (!labelElement) {
				throw new Error('The compact editing-target capsule did not expose its visible label.')
			}

			type Rgba = { red: number; green: number; blue: number; alpha: number }
			const canvas = document.createElement('canvas')
			canvas.width = 1
			canvas.height = 1
			const context = canvas.getContext('2d', { willReadFrequently: true })
			if (!context) {
				throw new Error('Canvas context unavailable while measuring target-pill contrast.')
			}
			const parseColor = (value: string): Rgba => {
				context.clearRect(0, 0, 1, 1)
				context.fillStyle = 'rgba(0, 0, 0, 0)'
				context.fillStyle = value
				context.fillRect(0, 0, 1, 1)
				const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data
				return { red, green, blue, alpha: alpha / 255 }
			}
			const composite = (front: Rgba, back: Rgba): Rgba => {
				const alpha = front.alpha + back.alpha * (1 - front.alpha)
				if (alpha === 0) return { red: 0, green: 0, blue: 0, alpha: 0 }
				const channel = (frontValue: number, backValue: number) =>
					(frontValue * front.alpha + backValue * back.alpha * (1 - front.alpha)) / alpha
				return {
					red: channel(front.red, back.red),
					green: channel(front.green, back.green),
					blue: channel(front.blue, back.blue),
					alpha,
				}
			}

			// Rebuild the solid color beneath the capsule from the page root inward,
			// then paint the capsule pseudo-element over it. The target is measured
			// before the workspace transparency check, so no map imagery or backdrop
			// sampling is involved in this normal-text contrast contract.
			const ancestors: HTMLElement[] = []
			for (let current = element.parentElement; current; current = current.parentElement) {
				ancestors.unshift(current)
			}
			let capsuleBackground: Rgba = { red: 255, green: 255, blue: 255, alpha: 1 }
			for (const ancestor of ancestors) {
				capsuleBackground = composite(
					parseColor(getComputedStyle(ancestor).backgroundColor),
					capsuleBackground,
				)
			}
			capsuleBackground = composite(
				parseColor(getComputedStyle(element).backgroundColor),
				capsuleBackground,
			)
			capsuleBackground = composite(parseColor(before.backgroundColor), capsuleBackground)
			const foreground = composite(
				parseColor(getComputedStyle(labelElement).color),
				capsuleBackground,
			)
			const relativeLuminance = ({ red, green, blue }: Rgba) => {
				const linearize = (channel: number) => {
					const normalized = channel / 255
					return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
				}
				return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
			}
			const foregroundLuminance = relativeLuminance(foreground)
			const backgroundLuminance = relativeLuminance(capsuleBackground)
			const textContrastRatio =
				(Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
				(Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
			const roundedRgb = ({ red, green, blue }: Rgba): [number, number, number] => [
				Math.round(red),
				Math.round(green),
				Math.round(blue),
			]
			return {
				shell: {
					x: shellBox.x,
					y: shellBox.y,
					width: shellBox.width,
					height: shellBox.height,
				},
				visualCapsule: {
					x: shellBox.x + insetLeft,
					y: shellBox.y + insetTop,
					width: shellBox.width - insetLeft - insetRight,
					height: shellBox.height - insetTop - insetBottom,
				},
				foregroundRgb: roundedRgb(foreground),
				visualCapsuleBackgroundRgb: roundedRgb(capsuleBackground),
				textContrastRatio,
			}
		}),
		label.textContent(),
	])
	if (!openActionBox) {
		throw new Error('The mobile editing-target action did not produce a measurable hit target.')
	}

	return {
		...measurement,
		openAction: openActionBox,
		label: labelText?.trim() ?? '',
	}
}

/** Raw alpha painted by the sheet root before its translucent children. */
export async function mobileWorkspaceRootBackgroundAlpha(earthly: EarthlySession): Promise<number> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	await expect(sheet).toBeVisible()
	return sheet.evaluate((element) => {
		const canvas = document.createElement('canvas')
		canvas.width = 1
		canvas.height = 1
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Canvas context unavailable while sampling sheet opacity.')
		context.clearRect(0, 0, 1, 1)
		context.fillStyle = 'rgba(0, 0, 0, 0)'
		context.fillStyle = getComputedStyle(element).backgroundColor
		context.fillRect(0, 0, 1, 1)
		return (context.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255
	})
}

/**
 * Approximate the effective alpha of all sheet backgrounds painted over quiet
 * candidates in its body. This catches the real failure mode where the outer
 * sheet becomes translucent but an opaque child still hides the map.
 */
export async function mobileWorkspaceBodyBackgroundAlpha(earthly: EarthlySession): Promise<number> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	await expect(sheet).toBeVisible()
	const body = sheet.getByTestId('mobile-sheet-body')
	await expect(body).toBeVisible()
	return body.evaluate((body) => {
		const root = body.closest<HTMLElement>('[data-testid="mobile-sheet"]')
		if (!root) throw new Error('The visible workspace body has no mobile sheet ancestor.')
		const bounds = body.getBoundingClientRect()
		const canvas = document.createElement('canvas')
		canvas.width = 1
		canvas.height = 1
		const context = canvas.getContext('2d', { willReadFrequently: true })
		if (!context) throw new Error('Canvas context unavailable while sampling panel opacity.')

		const effectiveAlphaAt = (x: number, y: number): number => {
			let remainingTransparency = 1
			for (const element of document.elementsFromPoint(x, y)) {
				if (!(element instanceof HTMLElement) || !root.contains(element)) continue
				const color = getComputedStyle(element).backgroundColor
				context.clearRect(0, 0, 1, 1)
				context.fillStyle = 'rgba(0, 0, 0, 0)'
				context.fillStyle = color
				context.fillRect(0, 0, 1, 1)
				const alpha = (context.getImageData(0, 0, 1, 1).data[3] ?? 0) / 255
				remainingTransparency *= 1 - alpha
				if (element === root || remainingTransparency === 0) break
			}
			return 1 - remainingTransparency
		}

		// Sample several quiet candidates and retain the least-painted point. A
		// message bubble or form control may legitimately be opaque; a full-body
		// surface that blocks the map will make every candidate opaque.
		const horizontalFractions = [0.12, 0.35, 0.65, 0.88]
		const verticalFractions = [0.2, 0.45, 0.7, 0.88]
		return Math.min(
			...horizontalFractions.flatMap((horizontal) =>
				verticalFractions.map((vertical) =>
					effectiveAlphaAt(
						bounds.left + bounds.width * horizontal,
						bounds.top + bounds.height * vertical,
					),
				),
			),
		)
	})
}
