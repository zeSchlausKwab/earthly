import { installIsolatedRelays } from '../tasks/setup/isolated-relays'
import type { NostrEvent } from 'nostr-tools'
import { addChatConnection } from '../tasks/chat/connections'
import { expect, test } from '../fixtures/earthly'
import { authorizeJourneyIdentity } from '../tasks/auth/authorize-journey-identity'
import { openPanel } from '../tasks/navigation/open-panel'
import { configureChatProvider } from '../tasks/chat/conversation'
import {
	installDeterministicChatProvider,
	DETERMINISTIC_CHAT_BASE_URL,
} from '../tasks/setup/deterministic-chat-provider'

test('connections sync encrypted, restore in a fresh browser, and retain deletion', async ({
	earthly,
	newEarthlySession,
}) => {
	const events = new Map<string, NostrEvent>()
	await installIsolatedRelays(earthly, events)
	const provider = await installDeterministicChatProvider(earthly)
	await authorizeJourneyIdentity(earthly, 'owner')
	await configureChatProvider(earthly, provider.settings)
	const panel = earthly.page.getByRole('tabpanel', { name: 'Chat', exact: true })
	await addChatConnection(earthly, {
		presetId: 'openrouter',
		name: 'Work test connection',
		baseUrl: DETERMINISTIC_CHAT_BASE_URL,
		apiKey: 'fixture-key-never-publish-plaintext',
		expectedPresetEndpoint: 'https://openrouter.ai/api/v1',
	})
	await expect(
		panel.getByText('Encrypted connections synced to Nostr.', { exact: true }),
	).toBeVisible({ timeout: 15000 })
	const state = await earthly.page.evaluate(() => {
		const entries = Object.entries(localStorage).filter(
			([key]) => key.startsWith('earthly.chat-settings') || key === 'chat-store',
		)
		const relay = entries.find(([key]) => key.startsWith('earthly.chat-settings.relay.'))
		return {
			leaked: entries.some(([, value]) => value.includes('fixture-key-never-publish-plaintext')),
			relayKind: relay ? JSON.parse(relay[1]).event.kind : null,
		}
	})
	expect(state).toEqual({ leaked: false, relayKind: 30078 })
	expect([...events.values()].filter((event) => event.kind === 30078)).not.toHaveLength(0)
	expect(JSON.stringify([...events.values()])).not.toContain('fixture-key-never-publish-plaintext')
	const restored = await newEarthlySession()
	await installIsolatedRelays(restored, events)
	await installDeterministicChatProvider(restored)
	await authorizeJourneyIdentity(restored, 'owner')
	await openPanel(restored, 'Settings')
	await restored.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	const other = restored.page.getByRole('tabpanel', { name: 'Chat', exact: true })
	await expect(
		other.getByLabel('Connection', { exact: true }).locator('option:checked'),
	).toHaveText('Work test connection', { timeout: 15000 })
	await other.getByRole('button', { name: 'Edit', exact: true }).click()
	await expect(other.getByLabel('API key', { exact: true })).toHaveValue(
		'fixture-key-never-publish-plaintext',
	)
	await other.getByLabel('Connection name', { exact: true }).fill('Renamed work connection')
	await other.getByRole('button', { name: 'Save connection', exact: true }).click()
	await expect(
		other.getByLabel('Connection', { exact: true }).locator('option:checked'),
	).toHaveText('Renamed work connection')
	await other.getByRole('button', { name: 'Delete connection', exact: true }).click()
	await other.getByRole('button', { name: 'Confirm deletion', exact: true }).click()
	await expect(
		other.getByText('Encrypted connections synced to Nostr.', { exact: true }),
	).toBeVisible({ timeout: 15000 })
	await restored.page.reload()
	if (!(await restored.page.getByRole('tab', { name: 'Chat', exact: true }).isVisible()))
		await openPanel(restored, 'Settings')
	await restored.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	await expect(other.getByLabel('Connection', { exact: true }).locator('option')).toHaveCount(1)
	await expect(
		other.getByLabel('Connection', { exact: true }).locator('option:checked'),
	).toHaveText('Custom endpoint')
	const separate = await newEarthlySession()
	await installIsolatedRelays(separate, events)
	await authorizeJourneyIdentity(separate, 'mara')
	await openPanel(separate, 'Settings')
	await separate.page.getByRole('tab', { name: 'Chat', exact: true }).click()
	await expect(
		separate.page.getByRole('button', { name: 'New connection', exact: true }),
	).toBeEnabled()
	await expect(
		separate.page.getByLabel('Connection', { exact: true }).locator('option'),
	).toHaveText(['Choose a connection'])
	await restored.page.screenshot({
		path: earthly.isMobile
			? 'ai-suite/artifacts/chat-connections-mobile.png'
			: 'ai-suite/artifacts/chat-connections-desktop.png',
		fullPage: true,
	})
})
