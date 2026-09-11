import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const setThreadWorkingSetOpenTask: AiTaskMetadata = {
	id: 'chat.set-working-set-open',
	summary: 'Open or close the AI editing menu, listing the maps and stories AI may change.',
	preconditions: ['AI Thread is visible'],
	sideEffects: ['Changes a local disclosure only'],
	viewports: 'both',
}

export async function setThreadWorkingSetOpen(earthly: EarthlySession, open = true) {
	const panel = earthly.page.getByRole('region', { name: 'AI Thread', exact: true })
	const trigger = panel.getByRole('button', { name: 'AI editing and references', exact: true })
	if ((await trigger.getAttribute('aria-expanded')) !== String(open)) await trigger.click()
	const working = earthly.page.getByRole('region', { name: 'AI editing and references', exact: true })
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

/** Draft titles only; this never reads provider settings or account secrets. */
export function localStoryDraftTitles(earthly: EarthlySession) {
	return earthly.page.evaluate(() => Object.entries(localStorage)
		.filter(([key]) => key.startsWith('earthly:story:drafts:v1'))
		.flatMap(([, value]) => Object.values(JSON.parse(value) as Record<string, { title?: string }>).map(draft => draft.title)))
}
