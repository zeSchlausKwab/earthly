import { ChatRunStatusBar } from './components/ChatRunStatusBar'
import { beforeEach, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
	resolveChatErrorPresentation,
	resolveInitialThreadPrompt,
	resolveChatSendState,
	getChatReferenceKey,
	chatReferenceToSearchResult,
	referenceForViewedObject,
} from './ChatPanel'
import { useChatComposerStore } from './composerState'
import { useChatStore } from './store'
import { chatSafetyPresentation, ChatSafetyIndicator } from './components/ChatHeaderPresentation'

describe('compact Thread header', () => {
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
		expect(markup).toContain('Questions and research; no changes to maps or stories.')
		expect(markup).not.toContain('Auto apply')
		expect(chatSafetyPresentation(true, 3).permissive).toBe(false)
	})
})

describe('chat reference picker identity', () => {
	test('removal keeps the exact feature and local draft identity', () => {
		const reference = {
			id: 'foreign-map',
			name: 'Western Front',
			type: 'feature' as const,
			pubkey: 'author',
			featureId: 'verdun',
			localWorkspaceId: 'draft-1',
		}
		const chip = chatReferenceToSearchResult(reference)
		expect(getChatReferenceKey(chip)).toBe(getChatReferenceKey(reference))
		expect(chip).toMatchObject({ featureId: 'verdun', localWorkspaceId: 'draft-1' })
		const sibling = { ...reference, featureId: 'somme' }
		const remaining = [reference, sibling].filter(
			(item) => getChatReferenceKey(item) !== getChatReferenceKey(chip),
		)
		expect(remaining).toEqual([sibling])
	})

	test('current-object shortcuts preserve unpublished draft identity without granting writes', () => {
		expect(referenceForViewedObject('map-draft:workspace-1', 'My map')).toMatchObject({
			id: 'workspace-1',
			name: 'My map',
			type: 'dataset',
			localWorkspaceId: 'workspace-1',
			address: undefined,
		})
		expect(referenceForViewedObject('story:naddr1example', 'A story')).toMatchObject({
			type: 'story',
			address: 'naddr1example',
			localWorkspaceId: undefined,
		})
		expect(referenceForViewedObject('ask')).toBeNull()
		expect(referenceForViewedObject('unknown:somewhere')).toBeNull()
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

describe('persistent composer progress', () => {
	test('shows working, approval and terminal states independently of transcript content', () => {
		for (const [status, label] of [
			['working', 'Thinking'],
			['awaiting_approval', 'Waiting for your approval'],
			['completed', 'Finished'],
			['stopped', 'Stopped'],
			['error', 'Response failed'],
		] as const) {
			const html = renderToStaticMarkup(<ChatRunStatusBar status={status} phase="Thinking" />)
			expect(html).toContain('role="status"')
			expect(html).toContain(label)
		}
	})
})
