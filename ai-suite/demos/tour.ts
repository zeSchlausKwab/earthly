import { expect } from '@playwright/test'
import type { EarthlySession } from '../core/session'
import { hideAiChat, openAiChat } from '../tasks/chat/conversation'
import type { DemoTourKind } from './manifest'

async function hideChatWhenOpen(earthly: EarthlySession): Promise<void> {
	const chat = earthly.page.getByRole('region', { name: 'AI chat', exact: true })
	if (await chat.isVisible()) await hideAiChat(earthly)
}

async function waitForMapToSettle(earthly: EarthlySession): Promise<void> {
	await expect
		.poll(() =>
			earthly.page.evaluate(() => {
				const map = (window as typeof window & { __earthlyMap?: { isMoving(): boolean } })
					.__earthlyMap
				return Boolean(map && !map.isMoving())
			}),
		)
		.toBe(true)
}

async function tourChat(earthly: EarthlySession): Promise<void> {
	await openAiChat(earthly)
	const answer = earthly.page.getByTitle('Copy assistant message').last()
	await expect(answer).toBeVisible()
	await answer.scrollIntoViewIfNeeded()
}

async function tourGeometry(earthly: EarthlySession): Promise<void> {
	await hideChatWhenOpen(earthly)
	const mapStack = earthly.page.getByRole('region', { name: 'Map stack', exact: true })
	if (!(await mapStack.isVisible())) {
		await earthly.page.getByRole('button', { name: 'Show map stack', exact: true }).click()
	}
	await expect(mapStack).toBeVisible()

	const zoomToEdit = mapStack.getByRole('button', { name: 'Zoom to edit', exact: true })
	const zoomToDataset = mapStack
		.getByRole('button', { name: 'Zoom to dataset', exact: true })
		.last()
	if (await zoomToEdit.isVisible()) await zoomToEdit.click()
	else if (await zoomToDataset.isVisible()) await zoomToDataset.click()
	else throw new Error('Geometry tour found no editable or published result in the Map stack.')
	await waitForMapToSettle(earthly)

	const openEditor = mapStack.getByRole('button', { name: 'Open editor panel', exact: true })
	if (await openEditor.isVisible()) await openEditor.click()
	await expect(earthly.page.getByText(/^Geometries \([1-9][0-9]*\)$/)).toBeVisible()

	const selectFeature = earthly.page.getByRole('button', { name: /^Select / }).first()
	await selectFeature.click()
	const expandFeature = earthly.page.getByRole('button', { name: /^Expand / }).first()
	await expandFeature.click()
	await earthly.page.getByRole('button', { name: 'Zoom to feature', exact: true }).first().click()
	await waitForMapToSettle(earthly)
}

async function tourStory(earthly: EarthlySession): Promise<void> {
	await hideChatWhenOpen(earthly)
	const storyRail = earthly.page.getByRole('button', { name: 'Story', exact: true })
	await expect(storyRail).toBeVisible()
	await storyRail.click()
	await expect(earthly.page.getByText(/^(New|Edit) Story$/).first()).toBeVisible()
	const preview = earthly.page.getByRole('tab', { name: 'Preview', exact: true })
	await preview.click()
	await expect(preview).toHaveAttribute('data-state', 'active')
	await preview.scrollIntoViewIfNeeded()
	await earthly.page.mouse.wheel(0, 420)
	await earthly.page.mouse.wheel(0, 420)
}

export async function tourDemoResult(
	earthly: EarthlySession,
	tours: DemoTourKind[],
): Promise<void> {
	for (const tour of tours) {
		if (tour === 'chat') await tourChat(earthly)
		else if (tour === 'geometry') await tourGeometry(earthly)
		else await tourStory(earthly)
	}
}
