import { describe, expect, it } from 'bun:test'
import { PlatformCommandError } from '@/platform/errors'
import { savedRegionStorageGuidance } from './storageGuidance'

describe('saved region storage guidance', () => {
	it('explains the preflight failure without suggesting a network retry', () => {
		const guidance = savedRegionStorageGuidance(
			new PlatformCommandError('native detail', 'region-insufficient-storage'),
		)
		expect(guidance?.title).toContain('Not enough free space')
		expect(guidance?.detail).toContain('smaller area')
	})

	it('explains that completed files survive a write failure', () => {
		const guidance = savedRegionStorageGuidance('region-storage-write-failed')
		expect(guidance?.detail).toContain('choose Resume')
		expect(guidance?.detail).toContain('instead of starting over')
	})

	it('ignores unrelated download failures', () => {
		expect(savedRegionStorageGuidance('region-auth-required')).toBeNull()
	})
})
