import { describe, expect, test } from 'bun:test'
import {
	CONVERSATION_DUMP_SCHEMA,
	CONVERSATION_DUMP_VERSION,
	buildConversationDump,
	buildConversationDumpFilename,
	serializeConversationDump,
} from './conversationDump'
import type { ConversationDumpInput } from './conversationDump'
import type { ChatMessage, RoutstrModel } from './routstr'
import type { ProviderOverrideMap } from './store'

const SECRET = 'sk-super-secret-api-key-do-not-leak'

function overridesWithSecret(): ProviderOverrideMap {
	return {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: 'http://localhost:9999/v1', apiKey: SECRET },
	}
}

const MODELS: RoutstrModel[] = [
	{
		id: 'local-model-1',
		name: 'Local Model One',
		pricing: { input: 0, output: 0, request: 0 },
	},
]

// A representative "run_code errored, then retried" transcript: an assistant
// tool_call, a role:'tool' error result, a retry tool_call, and a final answer.
const MESSAGES: ChatMessage[] = [
	{ role: 'user', content: 'Buffer this polygon by 100m' },
	{
		role: 'assistant',
		content: null,
		reasoning_content: 'I should write code to buffer the geometry.',
		tool_calls: [
			{
				id: 'call_1',
				type: 'function',
				function: { name: 'run_code', arguments: '{"code":"turf.buffer(bad)"}' },
			},
		],
	},
	{
		role: 'tool',
		tool_call_id: 'call_1',
		content: '{"ok":false,"error":"ReferenceError: bad is not defined"}',
	},
	{
		role: 'assistant',
		content: null,
		tool_calls: [
			{
				id: 'call_2',
				type: 'function',
				function: { name: 'run_code', arguments: '{"code":"turf.buffer(input, 0.1)"}' },
			},
		],
	},
	{
		role: 'tool',
		tool_call_id: 'call_2',
		content: '{"ok":true,"features":1}',
	},
	{ role: 'assistant', content: 'Done — buffered your polygon.' },
]

function baseInput(overrides?: Partial<ConversationDumpInput>): ConversationDumpInput {
	return {
		exportedAt: 1_700_000_000_000,
		activeChat: {
			id: 'chat-abcdef12',
			title: 'Buffer chat',
			targetWorkspaceId: 'workspace-now',
			createdAt: 1,
			updatedAt: 2,
		},
		currentTarget: {
			entityType: 'dataset',
			draftId: 'draft-now',
			entityId: 'pubkey:dataset-now',
			sourceId: 'source-now',
			baseRevisionId: 'revision-now',
			draftUpdatedAt: 1_699_999_999_900,
			wasDirty: true,
			workspaceId: 'workspace-now',
		},
		lastRun: {
			identity: {
				runId: 17,
				chatId: 'chat-abcdef12',
				startedAt: 1_699_999_999_000,
				target: {
					entityType: 'dataset',
					draftId: 'draft-at-send',
					entityId: 'pubkey:dataset-at-send',
					sourceId: 'source-at-send',
					baseRevisionId: 'revision-at-send',
					draftUpdatedAt: 1_699_999_998_000,
					wasDirty: false,
					workspaceId: 'workspace-at-send',
				},
			},
			completedAt: 1_699_999_999_800,
			status: 'error',
		},
		messages: MESSAGES,
		references: [],
		provider: 'custom',
		providerOverrides: overridesWithSecret(),
		selectedModel: 'local-model-1',
		models: MODELS,
		toolsEnabled: true,
		diagnostics: { finishReason: 'tool_calls', toolCallCount: 2 },
		...overrides,
	}
}

describe('buildConversationDump', () => {
	test('includes schema, endpoint label, and message count', () => {
		const dump = buildConversationDump(baseInput())
		expect(dump.schema).toBe(CONVERSATION_DUMP_SCHEMA)
		expect(CONVERSATION_DUMP_VERSION).toBe(3)
		expect(dump.version).toBe(CONVERSATION_DUMP_VERSION)
		expect(dump.exportedAt).toBe(new Date(1_700_000_000_000).toISOString())
		expect(dump.endpoint.provider).toBe('custom')
		expect(dump.endpoint.baseUrl).toBe('http://localhost:9999/v1')
		expect(dump.endpoint.modelId).toBe('local-model-1')
		expect(dump.endpoint.modelLabel).toBe('Local Model One')
		expect(dump.endpoint.toolsEnabled).toBe(true)
		expect(dump.endpoint.promptProfile).toBe('legacy')
		expect(dump.chat?.targetWorkspaceId).toBe('workspace-now')
		expect(dump.messageCount).toBe(MESSAGES.length)
		expect(dump.diagnostics).toEqual({ finishReason: 'tool_calls', toolCallCount: 2 })
		expect(dump.analysis.toolCallCount).toBe(2)
		expect(dump.analysis.toolErrorCount).toBe(1)
		expect(dump.analysis.completedWithAssistant).toBe(true)
	})

	test('labels current Chat pointer failures instead of presenting them as resolved targets', () => {
		const emptyTarget = {
			entityType: null,
			draftId: null,
			entityId: null,
			sourceId: null,
			baseRevisionId: null,
			draftUpdatedAt: null,
			wasDirty: false,
			workspaceId: null,
		} as const
		const unavailable = buildConversationDump(baseInput({ currentTarget: emptyTarget }))
		expect(unavailable.editingTarget.current.status).toBe('unavailable')
		expect(unavailable.editingTarget.current.target.wasDirty).toBeNull()

		const populated = baseInput()
		if (!populated.activeChat || !populated.currentTarget) {
			throw new Error('Expected the diagnostic fixture to have a current target')
		}
		const unbound = buildConversationDump(
			baseInput({
				activeChat: { ...populated.activeChat, targetWorkspaceId: null },
				currentTarget: emptyTarget,
			}),
		)
		expect(unbound.editingTarget.current.status).toBe('unbound')

		const mismatch = buildConversationDump(
			baseInput({
				currentTarget: { ...populated.currentTarget, workspaceId: 'workspace-other' },
			}),
		)
		expect(mismatch.editingTarget.current.status).toBe('mismatch')
	})

	test('distinguishes the current Chat target from the immutable target captured at Send', () => {
		const dump = buildConversationDump(baseInput())

		expect(dump.editingTarget.current).toEqual({
			chatId: 'chat-abcdef12',
			targetWorkspaceId: 'workspace-now',
			status: 'resolved',
			target: {
				entityType: 'dataset',
				draftId: 'draft-now',
				entityId: 'pubkey:dataset-now',
				sourceId: 'source-now',
				baseRevisionId: 'revision-now',
				draftUpdatedAt: 1_699_999_999_900,
				wasDirty: true,
				workspaceId: 'workspace-now',
			},
		})
		expect(dump.editingTarget.lastRun).toEqual({
			runId: 17,
			chatId: 'chat-abcdef12',
			startedAt: 1_699_999_999_000,
			completedAt: 1_699_999_999_800,
			status: 'error',
			target: {
				entityType: 'dataset',
				draftId: 'draft-at-send',
				entityId: 'pubkey:dataset-at-send',
				sourceId: 'source-at-send',
				baseRevisionId: 'revision-at-send',
				draftUpdatedAt: 1_699_999_998_000,
				wasDirty: false,
				workspaceId: 'workspace-at-send',
			},
		})
	})

	test('captures tool calls (id/name/arguments) and RAW tool results', () => {
		const dump = buildConversationDump(baseInput())

		const firstCall = dump.messages[1]?.tool_calls?.[0]
		expect(firstCall?.id).toBe('call_1')
		expect(firstCall?.function.name).toBe('run_code')
		expect(firstCall?.function.arguments).toBe('{"code":"turf.buffer(bad)"}')

		// The raw, structured tool result is preserved verbatim (not a rendered summary),
		// including the error that triggered the retry.
		const errorResult = dump.messages[2]
		expect(errorResult?.role).toBe('tool')
		expect(errorResult?.tool_call_id).toBe('call_1')
		expect(errorResult?.content).toBe('{"ok":false,"error":"ReferenceError: bad is not defined"}')

		// Retry call + success result both survive.
		expect(dump.messages[3]?.tool_calls?.[0]?.id).toBe('call_2')
		expect(dump.messages[4]?.content).toBe('{"ok":true,"features":1}')
	})

	test('preserves reasoning blocks', () => {
		const dump = buildConversationDump(baseInput())
		expect(dump.messages[1]?.reasoning_content).toBe('I should write code to buffer the geometry.')
		// Messages without reasoning normalize to null.
		expect(dump.messages[0]?.reasoning_content).toBeNull()
	})

	test('EXCLUDES provider API keys from the payload and serialized JSON', () => {
		const dump = buildConversationDump(baseInput())
		const json = serializeConversationDump(dump)

		expect(json).not.toContain(SECRET)
		expect(json).not.toContain('apiKey')
		// The endpoint object surfaces baseUrl but never apiKey.
		expect(dump.endpoint).not.toHaveProperty('apiKey')
		expect(JSON.stringify(dump)).not.toContain(SECRET)
	})

	test('omits inline image bytes while retaining an attachment breadcrumb', () => {
		const dataUrl = 'data:image/png;base64,PRIVATE-PIXELS'
		const dump = buildConversationDump(
			baseInput({
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: 'Review this map' },
							{ type: 'image_url', image_url: { url: dataUrl } },
						],
					},
				],
			}),
		)
		const json = serializeConversationDump(dump)

		expect(json).not.toContain('PRIVATE-PIXELS')
		expect(json).toContain('[inline image/png omitted from conversation export]')
	})

	test('falls back to modelId when the model is not in the list', () => {
		const dump = buildConversationDump(baseInput({ models: [] }))
		expect(dump.endpoint.modelLabel).toBe('local-model-1')
	})

	test('uses explicit nulls when there is no active Chat or previous run', () => {
		const dump = buildConversationDump(
			baseInput({ activeChat: null, currentTarget: null, lastRun: null }),
		)
		expect(dump.chat).toBeNull()
		expect(dump.editingTarget.current).toEqual({
			chatId: null,
			targetWorkspaceId: null,
			status: 'no_active_chat',
			target: {
				entityType: null,
				draftId: null,
				entityId: null,
				sourceId: null,
				baseRevisionId: null,
				draftUpdatedAt: null,
				wasDirty: null,
				workspaceId: null,
			},
		})
		expect(dump.editingTarget.lastRun).toEqual({
			runId: null,
			chatId: null,
			startedAt: null,
			completedAt: null,
			status: null,
			target: {
				entityType: null,
				draftId: null,
				entityId: null,
				sourceId: null,
				baseRevisionId: null,
				draftUpdatedAt: null,
				wasDirty: null,
				workspaceId: null,
			},
		})
	})
})

describe('buildConversationDumpFilename', () => {
	test('produces a filesystem-safe .json name carrying the chat id prefix', () => {
		const dump = buildConversationDump(baseInput())
		const filename = buildConversationDumpFilename(dump)
		expect(filename.startsWith('earthly-chat-dump-chat-abc')).toBe(true)
		expect(filename.endsWith('.json')).toBe(true)
		expect(filename).not.toContain(':')
	})
})
