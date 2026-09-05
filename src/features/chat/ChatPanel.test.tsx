import { beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	resolveChatErrorPresentation,
	resolveChatHeaderControlSizing,
	resolveInitialThreadPrompt,
	resolveChatSendState,
} from './ChatPanel'
import { useChatComposerStore } from './composerState'
import { useChatStore } from './store'
import {
	chatSafetyPresentation,
	ChatSafetyIndicator,
	ChatThreadIdentity,
} from './components/ChatHeaderPresentation'

describe('compact Thread header', () => {
	test('omits an embedded object title but preserves standalone Thread identity', () => {
		expect(renderToStaticMarkup(<ChatThreadIdentity title="Western Front" embedded />)).toBe('')
		expect(
			renderToStaticMarkup(<ChatThreadIdentity title="Western Front" embedded={false} />),
		).toContain('Western Front')
	})

	test('keeps permissive editing explicit while settings are collapsed', () => {
		const markup = renderToStaticMarkup(<ChatSafetyIndicator readOnly={false} safetyLevel={3} />)
		expect(markup).toContain('Auto apply')
		expect(markup).toContain('AI changes are applied automatically')
		expect(markup).toContain('text-amber-700')
		expect(chatSafetyPresentation(false, 1).label).toBe('Ask always')
		expect(chatSafetyPresentation(false, 2).label).toBe('Ask first')
	})

	test('never presents writable safety in a read-only object Thread', () => {
		const markup = renderToStaticMarkup(<ChatSafetyIndicator readOnly safetyLevel={3} />)
		expect(markup).toContain('Read-only')
		expect(markup).toContain('Text only; no tools or map changes.')
		expect(markup).not.toContain('Auto apply')
		expect(chatSafetyPresentation(true, 3).permissive).toBe(false)
	})
})

describe('ChatPanel editing-target send contract', () => {
	beforeEach(() => {
		useChatStore.getState().reset()
	})

	test('fails closed when a writable Thread has no route-owned Map', () => {
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
			title: 'Open this Thread from a Map before sending.',
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

	test('does not silently send text while an attached image is blocked', () => {
		expect(
			resolveChatSendState({
				canCompose: true,
				hasValidEditingTarget: true,
				targetCreationPending: false,
				anotherChatIsRunning: false,
				imageSendBlocked: true,
			}),
		).toEqual({
			canSend: false,
			title: 'Resolve the image support warning before sending.',
		})
	})

	test('allows an explicit read-only Thread to use the same send state without an editor target', () => {
		// ChatPanel supplies the read-only capability as a valid no-edit target to
		// this presentation helper; the store independently enforces tool gating.
		expect(
			resolveChatSendState({
				canCompose: true,
				hasValidEditingTarget: true,
				targetCreationPending: false,
				anotherChatIsRunning: false,
			}),
		).toEqual({ canSend: true, title: 'Send' })
	})

	test('offers the route-owned authoring verb when a Map Thread can prepare its target', () => {
		expect(
			resolveChatSendState({
				canCompose: true,
				hasValidEditingTarget: false,
				canCreateEditingTarget: true,
				authoringActionLabel: 'Propose & send',
				targetCreationPending: false,
				anotherChatIsRunning: false,
			}),
		).toEqual({ canSend: true, title: 'Propose & send' })
	})
})

describe('ChatPanel initial Thread prompt', () => {
	test('seeds only an empty composer and never overwrites an existing draft', () => {
		expect(resolveInitialThreadPrompt('  Where was this made?  ', '')).toBe('Where was this made?')
		expect(resolveInitialThreadPrompt('Where was this made?', 'Keep my draft')).toBeNull()
		expect(resolveInitialThreadPrompt('   ', '')).toBeNull()
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

describe('ChatPanel error recovery presentation', () => {
	test('distinguishes an applied map from a failed final summary', () => {
		expect(resolveChatErrorPresentation('Provider overloaded.', 'finish_response')).toEqual({
			message: 'Map changes were applied, but the final summary failed. Provider overloaded.',
			actionLabel: 'Finish response',
			changesApplied: true,
		})
	})

	test('keeps a normal failed turn retryable', () => {
		expect(resolveChatErrorPresentation('Provider unavailable.', 'retry_turn')).toEqual({
			message: 'Provider unavailable.',
			actionLabel: 'Retry',
			changesApplied: false,
		})
	})
})
