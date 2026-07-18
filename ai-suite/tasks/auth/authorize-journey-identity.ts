import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import type { TestIdentityId } from '../../test-identities'
import { signIn } from './sign-in'

export const authorizeJourneyIdentityTask: AiTaskMetadata = {
	id: 'auth.authorize-journey-identity',
	summary:
		'Pre-authorize a local test identity before a responsive journey without making identity setup part of that journey.',
	preconditions: ['Fresh local Earthly session', 'Local NIP-07 adapter is allowed'],
	sideEffects: ['Persists the selected development account in browser storage'],
	viewports: 'both',
}

/**
 * Earthly intentionally hides browser-extension login at mobile widths. Experience
 * journeys that evaluate capture rather than key management still need a signed-in
 * local author, so setup happens at a desktop width before returning to the exact
 * journey viewport. This is fixture setup, not a simulated mobile login path.
 */
export async function authorizeJourneyIdentity(
	earthly: EarthlySession,
	identityId: TestIdentityId = 'owner',
): Promise<void> {
	const journeyViewport = earthly.page.viewportSize()
	if (!journeyViewport) throw new Error('Journey page has no configured viewport')

	if (journeyViewport.width >= 768) {
		await signIn(earthly, identityId)
		return
	}

	await earthly.page.setViewportSize({ width: 1024, height: Math.max(768, journeyViewport.height) })
	await signIn(earthly, identityId)
	await earthly.page.setViewportSize(journeyViewport)
	await earthly.open({ tour: 'seen' })
	const accountMenu = earthly.page.getByRole('button', { name: 'Account menu' })
	if (!(await accountMenu.isVisible())) {
		await earthly.page.getByRole('button', { name: 'Menu', exact: true }).click()
		await expect(accountMenu).toBeVisible()
		await earthly.page.getByRole('button', { name: 'Map', exact: true }).click()
	} else {
		await expect(accountMenu).toBeVisible()
	}
}
