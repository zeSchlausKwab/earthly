import { test, expect } from '../fixtures/earthly'
import { createIdentity } from '../tasks/auth/create-identity'
import { signIn } from '../tasks/auth/sign-in'
import { createStoryDraft } from '../tasks/create/story'
import { openPanel } from '../tasks/navigation/open-panel'
import { completeTour, skipTour } from '../tasks/onboarding/tour'

test('anonymous first visit can complete the tour', async ({ earthly }) => {
	await earthly.open({ tour: 'new' })
	await expect(earthly.page.getByText('Welcome to Earthly')).toBeVisible()
	await completeTour(earthly)
	await expect
		.poll(() => earthly.page.evaluate(() => localStorage.getItem('earthly-tour-seen')))
		.toBe('true')
})

test('seeded owner can sign in through the NIP-07 adapter', async ({ earthly }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The current extension login control is desktop-only',
	)
	await signIn(earthly, 'owner')
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
})

test('a new visitor can create a fresh identity', async ({ earthly }, testInfo) => {
	test.skip(
		testInfo.project.name !== 'desktop',
		'The current create-identity trigger is desktop-only',
	)
	await earthly.open({ tour: 'seen' })
	await createIdentity(earthly)
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
})

test('anonymous first visit can skip the tour', async ({ earthly }) => {
	await earthly.open({ tour: 'new' })
	await skipTour(earthly)
	await expect(earthly.page.locator('.driver-popover')).toBeHidden()
})

test('Contexts can be opened through the current viewport navigation', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Contexts')
})

test('Private groups can be opened as a routed panel', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Private groups')
	await expect(
		earthly.page
			.locator('h2:visible')
			.filter({ hasText: /^Private groups$/ })
			.first(),
	).toBeVisible()
})

test('the web app describes native offline sharing without pretending to host a node', async ({
	earthly,
}) => {
	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Offline', exact: true }).click()
	await expect(earthly.page.getByText('Native app required', { exact: true })).toBeVisible()
	await expect(earthly.page.getByText(/does not expose a local relay or file server/)).toBeVisible()
})

test('the native command bridge exposes local-node pairing controls', async ({ earthly }) => {
	await earthly.page.addInitScript(() => {
		const descriptor = {
			version: 1,
			nodeId: 'a'.repeat(64),
			relayUrl: 'ws://127.0.0.1:17447/',
			blossomUrl: 'http://127.0.0.1:17448/',
			scope: 'loopback',
			availability: 'process',
		}
		const invoke = async (command: string) => {
			switch (command) {
				case 'local_node_status_v1':
					return { state: 'running', descriptor }
				case 'local_node_pending_claims_v1':
				case 'local_node_peer_grants_v1':
					return []
				case 'local_node_create_invitation_v1':
					return {
						version: 1,
						encoded: `earthly-pair-v1:${'x'.repeat(96)}`,
						expiresAt: Math.floor(Date.now() / 1000) + 600,
						capabilities: ['relay-write', 'blob-read', 'blob-write'],
						descriptor,
					}
				default:
					throw new Error(`Unexpected native command: ${command}`)
			}
		}
		Object.defineProperty(window, '__TAURI_INTERNALS__', {
			configurable: true,
			value: { invoke },
		})
	})

	await earthly.open({ tour: 'seen' })
	await openPanel(earthly, 'Settings')
	await earthly.page.getByRole('tab', { name: 'Offline', exact: true }).click()
	await expect(earthly.page.getByText('Local node running', { exact: true })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Create pairing invitation' }).click()
	await expect(earthly.page.getByLabel('Local-node pairing QR code')).toBeVisible()
	await expect(earthly.page.getByRole('button', { name: 'Copy invitation' })).toBeVisible()
})

test('a Story can be saved as a local draft', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await createStoryDraft(earthly, {
		title: 'AI suite smoke story',
		summary: 'A deterministic unpublished browser-test draft.',
		body: 'This story was composed by the Earthly AI suite.',
	})
	await expect(earthly.page.getByRole('button', { name: 'Save draft' })).toBeVisible()
})
