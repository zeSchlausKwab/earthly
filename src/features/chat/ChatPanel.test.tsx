import { beforeEach, describe, expect, test } from 'bun:test'
import { resolveChatSendState } from './ChatPanel'
import { useChatComposerStore } from './composerState'
import { useChatStore } from './store'

describe('ChatPanel editing-target send contract', () => {
	beforeEach(() => {
		useChatStore.getState().reset()
	})

	test('keeps an unbound prompt editable but makes Send target-required', () => {
		const chatId = useChatStore.getState().activeChatId as string
		useChatStore.setState({
			provider: 'custom',
			models: [
				{
					id: 'test-model',
					name: 'Test model',
					contextLength: 262_144,
					pricing: { input: 0, output: 0, request: 0 },
				},
			],
			selectedModel: 'test-model',
		})
		useChatComposerStore.getState().setDraft(chatId, (current) => ({
			...current,
			input: 'Keep this prompt while I choose a map',
		}))

		expect(useChatComposerStore.getState().drafts[chatId]?.input).toBe(
			'Keep this prompt while I choose a map',
		)
		expect(
			resolveChatSendState({
				canCompose: true,
				hasValidEditingTarget: false,
				targetCreationPending: false,
				anotherChatIsRunning: false,
			}),
		).toEqual({
			canSend: false,
			title: 'Choose New map or Use current edit before sending.',
		})
		expect(
			resolveChatSendState({
				canCompose: true,
				hasValidEditingTarget: true,
				targetCreationPending: false,
				anotherChatIsRunning: false,
			}),
		).toEqual({ canSend: true, title: 'Send' })
	})
})
