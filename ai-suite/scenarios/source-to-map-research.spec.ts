import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import {
	approveAiEdit,
	configureChatProvider,
	openAiChat,
	sendAiChatMessage,
} from '../tasks/chat/conversation'
import { expectGeometryFeatureCount } from '../tasks/create/geometry'
import { installDeterministicChatProvider } from '../tasks/setup/deterministic-chat-provider'

test('structured research commits one provenance-valid Dataset behind a compact operation summary @ai-journey', async ({
	earthly,
}, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'Source-to-map contract is asserted on desktop')
	test.setTimeout(120_000)

	const provider = await installDeterministicChatProvider(earthly, 'source-to-map-research')
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	await earthly.open({ tour: 'preserve' })
	await openAiChat(earthly)
	await sendAiChatMessage(
		earthly,
		'Create a map from the current cases in the researched source and retain exact provenance.',
	)

	const operation = earthly.page.getByText('Working on your map', { exact: true })
	await expect(operation).toBeVisible({ timeout: 15_000 })
	await expect(earthly.page.getByText('2 actions', { exact: true })).toBeVisible()
	await expectGeometryFeatureCount(earthly, 0)
	await approveAiEdit(earthly)
	await expectGeometryFeatureCount(earthly, 2)
	await expect(earthly.page.getByText(/I created one validated Dataset/)).toBeVisible({
		timeout: 15_000,
	})
	await expect(earthly.page.getByText('requests 2', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText(/^Σ input ~/)).toBeVisible()
	await expect(earthly.page.getByText(/^Σ output ~/)).toBeVisible()

	const sourced = await earthly.page.evaluate(() => {
		const editor = (
			window as typeof window & {
				__earthlyEditorStore?: {
					getState(): {
						features: Array<{ properties?: Record<string, unknown> }>
						collectionMeta: { name: string }
					}
				}
			}
		).__earthlyEditorStore?.getState()
		if (!editor) throw new Error('Earthly editor debug store is unavailable')
		return {
			name: editor.collectionMeta.name,
			rows: editor.features.map((feature) => feature.properties?.sourceRow),
			placeholders: editor.features.some((feature) =>
				JSON.stringify(feature).includes('undefined'),
			),
		}
	})
	expect(sourced).toEqual({ name: 'Current sourced cases', rows: [1, 2], placeholders: false })
	expect(provider.requests()).toHaveLength(2)
})
