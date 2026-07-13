import type { ChatContentPart, ChatMessage } from './routstr'

const REQUEST_CONTEXT_HEADING =
	'CURRENT REQUEST CONTEXT (authoritative app context; not user-authored prose):'

/**
 * Put ephemeral UI context next to the latest user turn for the provider request
 * without changing the persisted/rendered transcript. This is intentionally in
 * addition to the system prompt: attachments and fresh publish breadcrumbs are
 * request-local facts, and keeping them beside the question prevents a large map
 * prompt or long conversation from obscuring them.
 */
export function appendRequestContextToLatestUserMessage(
	messages: ChatMessage[],
	sections: Array<string | null | undefined>,
): ChatMessage[] {
	const context = sections
		.map((section) => section?.trim())
		.filter((section): section is string => Boolean(section))
		.join('\n\n')
	if (!context) return messages

	let userIndex = -1
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		if (messages[index]?.role === 'user') {
			userIndex = index
			break
		}
	}
	if (userIndex === -1) return messages

	const message = messages[userIndex]
	if (!message) return messages
	const contextPart: ChatContentPart = {
		type: 'text',
		text: `\n\n${REQUEST_CONTEXT_HEADING}\n${context}`,
	}
	const content = Array.isArray(message.content)
		? [...message.content, contextPart]
		: [
				...(typeof message.content === 'string' && message.content
					? ([{ type: 'text', text: message.content }] satisfies ChatContentPart[])
					: []),
				contextPart,
			]

	const result = [...messages]
	result[userIndex] = { ...message, content }
	return result
}
