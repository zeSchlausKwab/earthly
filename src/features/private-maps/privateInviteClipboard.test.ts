import { describe, expect, test } from 'bun:test'
import { copyPrivateInviteText } from './privateInviteClipboard'

describe('private invitation clipboard', () => {
	test('does not leave the invite UI waiting when a WebView clipboard promise hangs', async () => {
		await expect(
			copyPrivateInviteText(
				'https://earthly.city/privategroup/example?private-invite=token',
				{ writeText: () => new Promise<void>(() => undefined) },
				5,
			),
		).rejects.toThrow('Copying timed out')
	})

	test('copies through a responsive clipboard', async () => {
		let copied = ''
		await copyPrivateInviteText(
			'https://earthly.city/privategroup/example?private-invite=token',
			{
				writeText: async (value) => {
					copied = value
				},
			},
			50,
		)
		expect(copied).toContain('private-invite=token')
	})
})
