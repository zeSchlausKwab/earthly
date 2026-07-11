import { expect } from '@playwright/test'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const createIdentityTask: AiTaskMetadata = {
	id: 'auth.create-identity',
	summary: 'Create a fresh Nostr identity through the guided new-user wizard.',
	preconditions: ['Anonymous desktop session', 'First-run tour is not blocking the UI'],
	sideEffects: ['Creates and persists a fresh private-key account in browser storage'],
	viewports: 'desktop',
}

export async function createIdentity(earthly: EarthlySession): Promise<void> {
	if (earthly.isMobile) throw new Error('The current create-identity trigger is desktop-only')
	await earthly.page.getByRole('button', { name: 'Get a Nostr identity' }).click()
	await expect(earthly.page.getByRole('dialog', { name: 'Connect to Nostr' })).toBeVisible()
	await earthly.page.getByRole('button', { name: /New to Nostr\? Get your identity/ }).click()
	await expect(earthly.page.getByRole('dialog', { name: 'Your Nostr Identity' })).toBeVisible()
	await earthly.page.getByRole('checkbox', { name: /I have saved my private key/ }).check()
	await earthly.page.getByRole('button', { name: 'Next: Set up profile →' }).click()
	await expect(earthly.page.getByRole('dialog', { name: 'Set Up Your Profile' })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Skip for now' }).click()
	await expect(earthly.page.getByRole('dialog', { name: "You're on Nostr!" })).toBeVisible()
	await earthly.page.getByRole('button', { name: 'Start Exploring' }).click()
	await expect(earthly.page.getByRole('button', { name: 'Account menu' })).toBeVisible()
}
