import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { personas, type PersonaId } from '../../personas'
import { installNip07Adapter } from '../../personas/nip07-adapter'

export const signInTask: AiTaskMetadata = {
	id: 'auth.sign-in',
	summary: 'Sign in through the real NIP-07 browser-extension control using a seeded persona.',
	preconditions: ['Fresh browser page', 'Local Earthly server'],
	sideEffects: ['Persists the selected development account in browser storage'],
	viewports: 'desktop',
}

export async function signIn(
	earthly: EarthlySession,
	personaId: PersonaId = 'owner',
): Promise<void> {
	if (earthly.isMobile) throw new Error('NIP-07 sign-in control is currently desktop-only')
	await installNip07Adapter(earthly.page, personas[personaId])
	await earthly.open({ tour: 'seen' })
	await earthly.page.getByRole('button', { name: 'Sign in with browser extension' }).click()
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
}
