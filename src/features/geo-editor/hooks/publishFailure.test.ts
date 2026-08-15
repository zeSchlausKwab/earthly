import { describe, expect, test } from 'bun:test'
import { PlatformCommandError } from '@/platform/errors'
import { publishFailureMessage } from './publishFailure'

describe('publishFailureMessage', () => {
	test('keeps the native failure visible and gives an on-device retry path', () => {
		const message = publishFailureMessage(
			'publish this dataset',
			new PlatformCommandError('The publish outbox is unavailable', 'outbox-lock-failed'),
		)

		expect(message).toContain('The publish outbox is unavailable')
		expect(message).toContain('Tap Publish to retry')
		expect(message).not.toContain('console')
	})
})
