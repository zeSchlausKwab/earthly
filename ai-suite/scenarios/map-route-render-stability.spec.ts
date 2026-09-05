import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { configureChatProvider, setAiThreadSettingsOpen } from '../tasks/chat/conversation'
import { monitorBrowserHealth } from '../tasks/diagnostics/browser-health'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'
import { installInMemoryMapFixture } from '../tasks/setup/in-memory-map-fixture'

for (const initialTab of ['details', 'comments', 'thread'] as const) {
	test(`Map ${initialTab} auth hydration, object controls and reload stay render-stable`, async ({
		earthly,
	}, testInfo) => {
		const page = earthly.page
		// Preserve the viewport of the reported composed-ref update-depth failure.
		if (earthly.isMobile) await page.setViewportSize({ width: 464, height: 977 })
		const health = monitorBrowserHealth(page)
		const checkpoints: Array<{ step: string; url: string }> = []
		const assertNoUpdateLoop = () => {
			const snapshot = health.snapshot()
			expect(
				[...snapshot.pageErrors, ...snapshot.consoleErrors].filter((message) =>
					/Maximum update depth exceeded/i.test(message),
				),
				'The reported React update-depth error, including its original rendered stack',
			).toEqual([])
		}
		const checkpoint = (step: string) => {
			checkpoints.push({ step, url: page.url() })
			assertNoUpdateLoop()
		}
		try {
			const provider = await installDeterministicChatProvider(earthly, 'target-binding')
			await authorizeJourneyIdentity(earthly, 'mara')
			await configureChatProvider(earthly, provider.settings)
			const map = await installInMemoryMapFixture(earthly, {
				title: 'Render stability Map',
				identifier: 'ai-suite-render-stability-map',
				commentCount: 1,
			})
			const commentText = map.commentTexts[0]
			if (!commentText) throw new Error('The route fixture must include a rendered comment.')
			await earthly.open({
				path: `${map.path}${initialTab === 'details' ? '' : `?tab=${initialTab}`}`,
				tour: 'preserve',
			})
			const inspect = page.getByRole('region', { name: 'Map inspection', exact: true })
			const tabs = inspect.getByRole('tablist', { name: 'Object sections', exact: true })
			const thread = page.getByRole('region', { name: 'AI Thread', exact: true })
			await expect(inspect.getByText(map.title, { exact: true }).first()).toBeVisible()
			await expect(
				tabs.getByRole('tab', { name: new RegExp(`^${initialTab}`, 'i') }),
			).toHaveAttribute('aria-selected', 'true')
			checkpoint(`fresh authenticated ${initialTab} deep link`)
			for (let round = 0; round < 2; round++) {
				await tabs.getByRole('tab', { name: 'Details', exact: true }).click()
				await expect(inspect.getByText('Meeting point', { exact: true })).toBeVisible()
				checkpoint(`${round}: Details`)
				await tabs.getByRole('tab', { name: /^Comments/ }).click()
				await expect(inspect.getByText(commentText, { exact: true })).toBeVisible()
				const sort = inspect.getByRole('combobox', { name: 'Sort comments', exact: true })
				await sort.selectOption('most-liked')
				await sort.selectOption('newest')
				checkpoint(`${round}: Comments and real sort select`)
				await tabs.getByRole('tab', { name: 'Thread', exact: true }).click()
				await expect(thread).toBeVisible()
				await setAiThreadSettingsOpen(earthly)
				await expect(
					thread.getByRole('combobox', { name: 'Select chat model', exact: true }),
				).toBeVisible()
				await setAiThreadSettingsOpen(earthly, false)
				await thread.locator('textarea').fill(`Unsent render check ${round}`)
				checkpoint(`${round}: real Thread settings and composer rerender`)
				await tabs.getByRole('tab', { name: 'Details', exact: true }).click()
				await inspect.getByRole('button', { name: 'Other ways to edit', exact: true }).click()
				await expect(page.getByRole('menuitem', { name: 'Fork map', exact: true })).toBeVisible()
				checkpoint(`${round}: real object edit dropdown`)
				// A fresh route visit also disposes the open portal without invoking its action.
				await earthly.open({ path: `${map.path}?tab=thread`, tour: 'preserve' })
				await page.reload({ waitUntil: 'domcontentloaded' })
				await expect(thread).toBeVisible()
				await expect(tabs.getByRole('tab', { name: 'Thread', exact: true })).toHaveAttribute(
					'aria-selected',
					'true',
				)
				checkpoint(`${round}: authenticated Thread reload`)
			}
			expect(provider.requests()).toHaveLength(0)
		} finally {
			await testInfo.attach('Map route render stability evidence', {
				body: JSON.stringify({ checkpoints, ...health.snapshot() }, null, 2),
				contentType: 'application/json',
			})
			health.stop()
			assertNoUpdateLoop()
		}
	})
}
