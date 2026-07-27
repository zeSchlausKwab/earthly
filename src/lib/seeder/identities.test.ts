import { describe, expect, it } from 'bun:test'
import { WALLETED_USER_LUD16 } from '@/lib/fixtures'
import { devIdentities, signProfile } from './identities'

describe('signProfile', () => {
	it('gives every local development profile the shared Lightning test address', async () => {
		const { owner, contributors } = devIdentities()

		for (const identity of [owner, ...contributors]) {
			const event = await signProfile(identity)
			const profile = JSON.parse(event.content) as Record<string, unknown>

			expect(profile.lud16).toBe(WALLETED_USER_LUD16)
		}
	})

	it('allows a scenario to override the default Lightning address', async () => {
		const { owner } = devIdentities()
		const event = await signProfile(owner, undefined, { lud16: 'other@example.com' })
		const profile = JSON.parse(event.content) as Record<string, unknown>

		expect(profile.lud16).toBe('other@example.com')
	})
})
