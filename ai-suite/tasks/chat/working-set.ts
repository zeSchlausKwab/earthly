import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const setThreadWorkingSetOpenTask: AiTaskMetadata = {
	id: 'chat.set-working-set-open',
	summary: 'Reveal or collapse the Thread’s explicit outputs and read-only references.',
	preconditions: ['AI Thread is visible'],
	sideEffects: ['Changes a local disclosure only'],
	viewports: 'both',
}

export async function setThreadWorkingSetOpen(earthly: EarthlySession, open = true) {
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const summary = panel.locator('summary').filter({ hasText: 'Working on:' })
	const details = summary.locator('..')
	if (((await details.getAttribute('open')) !== null) !== open) await summary.click()
	const working = panel.getByLabel('Thread working set')
	if (open) await expect(working).toBeVisible()
	else await expect(working).toBeHidden()
	return working
}

/** Only authoring identities/counts are read; never provider credentials. */
export function threadWorkSnapshot(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const stored = JSON.parse(localStorage.getItem('chat-store') ?? '{}').state ?? {}
		const chat = stored.chatSessions?.find(
			(item: { id: string }) => item.id === stored.activeChatId,
		)
		return {
			id: chat?.id as string,
			outputs: (chat?.workingSet ?? []) as Array<{ id: string; title: string; kind: string }>,
			referenceCount: chat?.references?.length ?? 0,
			allowCreate: chat?.allowCreate === true,
		}
	})
}

export function localMapOutputCounts(earthly: EarthlySession) {
	return earthly.page.evaluate(() => {
		const drafts: Array<{ title: string; features: number }> = []
		for (const [key, value] of Object.entries(localStorage)) {
			if (!key.startsWith('earthly:geo-editor:collection-drafts:v1:')) continue
			const state = JSON.parse(value) as {
				drafts?: Record<string, { collectionMeta: { name: string }; features: unknown[] }>
			}
			for (const draft of Object.values(state.drafts ?? {}))
				drafts.push({ title: draft.collectionMeta.name, features: draft.features.length })
		}
		return drafts
	})
}
