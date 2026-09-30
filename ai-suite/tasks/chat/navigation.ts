import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const openChatViewTask: AiTaskMetadata = {
	id: 'chat.open-view',
	summary: 'Open one chat details destination or return to the retained conversation.',
	preconditions: ['AI Thread is visible'],
	sideEffects: ['Changes only the visible chat view; keeps the run and composer'],
	viewports: 'both',
}

export async function openChatView(
	earthly: EarthlySession,
	view: 'chat' | 'edit' | 'sources' | 'settings' | 'usage',
) {
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const back = panel.getByRole('button', { name: 'Back to chat', exact: true })
	if (view === 'chat') {
		if (await back.isVisible()) await back.click()
		await expect(panel.locator('textarea')).toBeVisible()
		return panel
	}
	if (view === 'usage') {
		await panel.getByRole('button', { name: 'Chat usage details', exact: true }).click()
		await expect(
			panel.getByRole('region', { name: 'Usage & diagnostics', exact: true }),
		).toBeVisible()
		return panel
	}
	const tab = panel.getByRole('tab', {
		name: { edit: 'AI can edit', sources: 'Sources', settings: 'Settings' }[view],
		exact: true,
	})
	if (await tab.isVisible()) await tab.click()
	else {
		if (await back.isVisible()) await back.click()
		await panel
			.getByRole('button', {
				name:
					view === 'settings'
						? 'Thread settings'
						: view === 'edit'
							? /^AI can edit \d+$/
							: /^Sources \d+$/,
			})
			.click()
	}
	await expect(tab).toHaveAttribute('data-state', 'active')
	return panel
}
