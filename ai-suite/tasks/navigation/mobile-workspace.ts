import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export type MobileWorkspacePanel = 'Stack' | 'Edit' | 'Inspect' | 'Chat'
export type MobileEntitySurface = 'Dataset' | 'Story' | 'Context' | 'Inspect'

export const switchMobileWorkspacePanelTask: AiTaskMetadata = {
	id: 'navigation.switch-mobile-workspace-panel',
	summary: 'Switch between the map-bound Stack, Edit or Inspect, and Chat panels.',
	preconditions: ['Mobile Earthly session', 'The map workspace sheet is open'],
	sideEffects: ['Changes only the visible map workspace panel'],
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
	summary: 'Choose one retained Dataset, Story, Context, or inspection surface in mobile Edit.',
	preconditions: ['Mobile Earthly session', 'At least two retained entity surfaces exist'],
	sideEffects: ['Changes only the entity surface shown in the Edit panel'],
	viewports: 'mobile',
}

function requireMobile(earthly: EarthlySession): void {
	if (!earthly.isMobile) throw new Error('The mobile workspace task requires a mobile viewport.')
}

export function mobileWorkspaceSheet(earthly: EarthlySession) {
	return earthly.page.getByTestId('mobile-sheet')
}

export function mobileWorkspaceTabs(earthly: EarthlySession) {
	return mobileWorkspaceSheet(earthly).getByRole('tablist', {
		name: 'Map workspace panels',
		exact: true,
	})
}

export function mobileWorkspaceTab(earthly: EarthlySession, panel: MobileWorkspacePanel) {
	const panelName = panel === 'Edit' || panel === 'Inspect' ? '(?:Edit|Inspect)' : panel
	return mobileWorkspaceTabs(earthly).getByRole('tab', {
		name: new RegExp(`^${panelName}(?:,|$)`),
	})
}

/**
 * Reveal a retained map-work surface. This task deliberately clicks only the
 * visible switcher: it never invokes create, load, bind, or Map Stack actions.
 */
export async function switchMobileWorkspacePanel(
	earthly: EarthlySession,
	panel: MobileWorkspacePanel,
): Promise<void> {
	requireMobile(earthly)
	const tabs = mobileWorkspaceTabs(earthly)
	await expect(tabs).toBeVisible()
	const tab = mobileWorkspaceTab(earthly, panel)
	await expect(tab).toBeVisible()
	if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
	await expect(tab).toHaveAttribute('aria-selected', 'true')
}

export async function selectMobileEntitySurface(
	earthly: EarthlySession,
	surface: MobileEntitySurface,
	expectedName?: string,
): Promise<void> {
	requireMobile(earthly)
	await switchMobileWorkspacePanel(earthly, 'Edit')
	const picker = mobileWorkspaceSheet(earthly).getByRole('combobox', {
		name: 'Edit or inspect target',
		exact: true,
	})
	await expect(picker).toBeVisible()
	const option = picker
		.locator('option')
		.filter({ hasText: new RegExp(`^${surface} · `) })
		.first()
	await expect(option).toHaveCount(1)
	if (expectedName) await expect(option).toContainText(expectedName)
	const value = await option.getAttribute('value')
	if (!value) throw new Error(`The retained ${surface} option has no selectable value.`)
	await picker.selectOption(value)
	await expect(picker).toHaveValue(value)
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

/**
 * Approximate the effective alpha of all sheet backgrounds painted over quiet
 * candidates in its body. This catches the real failure mode where the outer
 * sheet becomes translucent but an opaque child still hides the map.
 */
export async function mobileWorkspaceBodyBackgroundAlpha(earthly: EarthlySession): Promise<number> {
	requireMobile(earthly)
	const sheet = mobileWorkspaceSheet(earthly)
	await expect(sheet).toBeVisible()
	const body = sheet.getByRole('tabpanel').first()
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
