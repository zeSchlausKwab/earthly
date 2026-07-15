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

test('a Story can be saved as a local draft', async ({ earthly }) => {
	await earthly.open({ tour: 'seen' })
	await createStoryDraft(earthly, {
		title: 'AI suite smoke story',
		summary: 'A deterministic unpublished browser-test draft.',
		body: 'This story was composed by the Earthly AI suite.',
	})
	await expect(earthly.page.getByRole('button', { name: 'Save draft' })).toBeVisible()
})
