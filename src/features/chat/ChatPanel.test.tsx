import { beforeEach, describe, expect, test } from 'bun:test'
import { resolveChatHeaderControlSizing, resolveChatSendState } from './ChatPanel'
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

describe('ChatPanel mobile control sizing', () => {
	test('gives all conversation header controls 44px mobile hit areas only', () => {
		expect(resolveChatHeaderControlSizing(true, 'new-conversation')).toContain('min-h-11')
		expect(resolveChatHeaderControlSizing(true, 'conversation-select')).toContain(
			'[&>select]:min-h-11',
		)
		expect(resolveChatHeaderControlSizing(true, 'icon')).toContain('min-w-11')

		expect(resolveChatHeaderControlSizing(false, 'new-conversation')).toBe('h-8 px-2.5')
		expect(resolveChatHeaderControlSizing(false, 'conversation-select')).toBe('')
		expect(resolveChatHeaderControlSizing(false, 'icon')).toBe('h-8 w-8')
	})
})
