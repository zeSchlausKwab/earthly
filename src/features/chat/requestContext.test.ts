import { describe, expect, it } from 'bun:test'
import type { ChatMessage } from './routstr'
import { appendRequestContextToLatestUserMessage } from './requestContext'

describe('appendRequestContextToLatestUserMessage', () => {
	it('places attached references in the current user turn without mutating the transcript', () => {
		const messages: ChatMessage[] = [
			{ role: 'assistant', content: 'What should I read?' },
			{ role: 'user', content: 'Summarize the attached story.' },
		]
		const augmented = appendRequestContextToLatestUserMessage(messages, [
			'Attached story: "Under the Plane Trees" → nostr:naddr1story',
		])

		expect(messages[1]?.content).toBe('Summarize the attached story.')
		expect(JSON.stringify(augmented[1]?.content)).toContain('Under the Plane Trees')
		expect(JSON.stringify(augmented[1]?.content)).toContain('nostr:naddr1story')
	})

	it('places the latest publish breadcrumb beside the follow-up request', () => {
		const messages: ChatMessage[] = [
			{ role: 'user', content: 'Draw a triangle.' },
			{ role: 'assistant', content: 'Done.' },
			{ role: 'user', content: 'What did I just publish? Give me its reference.' },
		]
		const augmented = appendRequestContextToLatestUserMessage(messages, [
			'Recently published: "UAT AI Shape" → nostr:naddr1published',
		])

		expect(JSON.stringify(augmented[2]?.content)).toContain('UAT AI Shape')
		expect(JSON.stringify(augmented[2]?.content)).toContain('nostr:naddr1published')
		expect(augmented[0]).toEqual(messages[0])
	})

	it('preserves image parts while appending textual request context', () => {
		const messages: ChatMessage[] = [
			{
				role: 'user',
				content: [
					{ type: 'text', text: 'Inspect this.' },
					{ type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
				],
			},
		]
		const augmented = appendRequestContextToLatestUserMessage(messages, ['Reference context'])
		const content = augmented[0]?.content
		expect(Array.isArray(content)).toBe(true)
		expect(JSON.stringify(content)).toContain('data:image/png;base64,abc')
		expect(JSON.stringify(content)).toContain('Reference context')
	})
})
