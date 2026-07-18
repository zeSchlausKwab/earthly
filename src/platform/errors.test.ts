import { describe, expect, it } from 'bun:test'
import { PlatformCommandError, platformCommandError, platformErrorCode } from './errors'

describe('platform command errors', () => {
	it('preserves a structured native command error code', () => {
		const error = platformCommandError({
			code: 'region-insufficient-storage',
			message: 'Choose a smaller area',
		})
		expect(error).toBeInstanceOf(PlatformCommandError)
		expect(error.message).toBe('Choose a smaller area')
		expect(platformErrorCode(error)).toBe('region-insufficient-storage')
	})

	it('normalizes unstructured failures without inventing a code', () => {
		const error = platformCommandError('offline')
		expect(error.message).toBe('offline')
		expect(platformErrorCode(error)).toBeNull()
	})
})
