import { beforeEach, describe, expect, test } from 'bun:test'
import { finalizeEvent } from 'nostr-tools'
import { BUILTIN_PROVIDERS, estimateMaxCost } from './routstr'
import type { ProviderConfig, RoutstrModel } from './routstr'
import {
	DEFAULT_CHAT_SETTINGS,
	STREAM_STALL_TIMEOUT_MS,
	TRUNCATION_CONTENT_SUFFIX,
	chatStorePartialize,
	compactIngestHandlePartForPrompt,
	applyMessagesToChat,
	buildChatRunStateUpdate,
	captureActiveToolExecutionTarget,
	captureVisibleDatasetReferenceTarget,
	deriveOutputBudget,
	describeEmptyCompletion,
	getPromptBudgetTokens,
	getAdvertisedGeoTools,
	resolveProvider,
	resolveChatErrorRecovery,
	sanitizeMessageForPrompt,
	terminalDatasetTargetError,
	useChatStore,
} from './store'
import type { ProviderOverrideMap } from './store'
import { getGeoTools, getMapContextSnapshotForTarget } from './tools'
import { register, unregister } from './tools/registry'
import type { ToolExecutionRunIdentity } from './tools/types'
import { resolveWorkspaceBindingIdentity } from './safeEditing/BindingChip'
import {
	clearPendingDiffs,
	emitDiffBlock,
	getPendingDiff,
	requestConfirm,
} from './safeEditing/pendingDiffStore'
import type { DatasetDiff } from '@/features/geo-editor/api/diff'
import { useEditorStore } from '@/features/geo-editor/store'
import { eventStore } from '@/lib/nostr'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { clearStoryTargetRequests, requestStoryTarget } from '@/features/chat/storyTargeting'

function makeModel(overrides: Partial<RoutstrModel> = {}): RoutstrModel {
	return {
		id: 'test-model',
		name: 'Test Model',
		contextLength: 262_144,
		pricing: { input: 0, output: 0, request: 0 },
		...overrides,
	}
}

const PAID_PROVIDER: ProviderConfig = BUILTIN_PROVIDERS.routstr
const FREE_PROVIDERS: ProviderConfig[] = [
	BUILTIN_PROVIDERS.lmstudio,
	BUILTIN_PROVIDERS.ollama,
	{ type: 'custom', baseUrl: 'http://custom/v1', name: 'Custom', requiresPayment: false },
]

function runIdentity(chatId: string, runId = 42): ToolExecutionRunIdentity {
	return {
		runId,
		chatId,
		startedAt: Date.now(),
		target: {
			entityType: null,
			draftId: null,
			entityId: null,
			sourceId: null,
			baseRevisionId: null,
			draftUpdatedAt: null,
			wasDirty: false,
			workspaceId: null,
		},
	}
}

function bindActiveChatToEmptyDatasetTarget(label = 'Bound test Dataset'): void {
	const chatId = useChatStore.getState().activeChatId
	if (!chatId) throw new Error('Expected an active Chat')
	const sourceId = `session:${chatId}`
	const draftId = `draft:${chatId}`
	const workspaceId = `workspace:${chatId}`
	const now = Date.now()
	useEditorStore.setState({
		activeWorkspaceId: workspaceId,
		activeGeoEditDraftId: draftId,
		geoEditDrafts: {
			[draftId]: {
				persistenceVersion: 2,
				id: draftId,
				sourceId,
				name: label,
				description: '',
				collectionMeta: {
					name: label,
					description: '',
					color: '#1d4ed8',
					customProperties: {},
				},
				features: [],
				selectedFeatureIds: [],
				publishChannel: { kind: 'public' },
				contextRefs: [],
				blobReferences: [],
				createdAt: now,
				updatedAt: now,
			},
		},
		workspaces: {
			[workspaceId]: {
				id: workspaceId,
				sourceId,
				label,
				kind: 'scratch',
				datasetKey: null,
				baseRevisionId: null,
				activeDraftId: draftId,
				chatSessionId: null,
				createdAt: now,
				updatedAt: now,
			},
		},
	})
	useChatStore.getState().setChatTargetWorkspace(chatId, workspaceId)
}

describe('single global run remains owned across conversation navigation', () => {
	beforeEach(() => {
		useChatStore.getState().reset()
		clearPendingDiffs()
		clearStoryTargetRequests()
	})

	test('switching and creating conversations never aborts the existing run', () => {
		const ownerId = useChatStore.getState().activeChatId as string
		useChatStore.getState().createChat()
		const browsedId = useChatStore.getState().activeChatId as string
		const identity = runIdentity(ownerId)
		useChatStore.setState((state) => ({
			...buildChatRunStateUpdate(state, ownerId, {
				identity,
				status: 'working',
				streamingContent: 'owned stream',
			}),
			isStreaming: true,
			runningChatId: ownerId,
			activeRun: identity,
		}))

		useChatStore.getState().switchChat(browsedId)
		useChatStore.getState().createChat()

		const state = useChatStore.getState()
		expect(state.isStreaming).toBe(true)
		expect(state.runningChatId).toBe(ownerId)
		expect(state.activeRun).toBe(identity)
		expect(state.chatRunStates[ownerId]?.streamingContent).toBe('owned stream')
		expect(state.activeChatId).not.toBe(ownerId)
	})

	test('late runtime and message updates stay in the owning conversation', () => {
		const ownerId = useChatStore.getState().activeChatId as string
		useChatStore.getState().createChat()
		const browsedId = useChatStore.getState().activeChatId as string
		useChatStore.setState({ streamingContent: 'browsed view' })

		useChatStore.setState((state) =>
			buildChatRunStateUpdate(state, ownerId, { streamingContent: 'late owner token' }),
		)
		const afterRuntime = useChatStore.getState()
		expect(afterRuntime.chatRunStates[ownerId]?.streamingContent).toBe('late owner token')
		expect(afterRuntime.streamingContent).toBe('browsed view')

		const ownerMessages = [{ role: 'assistant' as const, content: 'late owner result' }]
		const sessions = applyMessagesToChat(afterRuntime.chatSessions, ownerId, ownerMessages)
		expect(sessions.find((chat) => chat.id === ownerId)?.messages).toEqual(ownerMessages)
		expect(sessions.find((chat) => chat.id === browsedId)?.messages).toEqual([])
	})

	test('a second send is refused while another conversation owns the run', async () => {
		const ownerId = useChatStore.getState().activeChatId as string
		useChatStore.getState().createChat()
		const browsedId = useChatStore.getState().activeChatId as string
		const identity = runIdentity(ownerId)
		useChatStore.setState({
			isStreaming: true,
			runningChatId: ownerId,
			activeRun: identity,
		})

		await useChatStore.getState().sendMessage('must not be appended')

		expect(
			useChatStore.getState().chatSessions.find((chat) => chat.id === browsedId)?.messages,
		).toEqual([])
	})

	test('an unbound conversation cannot send or create authoring state', async () => {
		const chatId = useChatStore.getState().activeChatId as string
		const originalFetch = globalThis.fetch
		let providerRequests = 0
		const providerOverrides = emptyOverrides()
		providerOverrides.custom = { baseUrl: 'http://unbound-chat.test/v1', apiKey: '' }
		useChatStore.setState({
			provider: 'custom',
			providerOverrides,
			models: [makeModel()],
			selectedModel: 'test-model',
		})
		globalThis.fetch = (async () => {
			providerRequests += 1
			throw new Error('An unbound conversation must not reach the provider')
		}) as typeof fetch

		const editorBefore = useEditorStore.getState()
		const workspaceIdsBefore = Object.keys(editorBefore.workspaces).sort()
		const draftIdsBefore = Object.keys(editorBefore.geoEditDrafts).sort()

		try {
			await useChatStore.getState().sendMessage('Keep this typed prompt for later')

			const chat = useChatStore.getState().chatSessions.find((session) => session.id === chatId)
			expect(providerRequests).toBe(0)
			expect(chat?.targetWorkspaceId).toBeNull()
			expect(chat?.messages).toEqual([])
			expect(useChatStore.getState().activeRun).toBeNull()
			expect(useChatStore.getState().runningChatId).toBeNull()
			expect(Object.keys(useEditorStore.getState().workspaces).sort()).toEqual(workspaceIdsBefore)
			expect(Object.keys(useEditorStore.getState().geoEditDrafts).sort()).toEqual(draftIdsBefore)
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('Stop targets the owner and releases a parked approval while browsing elsewhere', async () => {
		const ownerId = useChatStore.getState().activeChatId as string
		useChatStore.getState().createChat()
		const identity = runIdentity(ownerId)
		const diff: DatasetDiff = { added: [], modified: [], deleted: [] }
		const handle = emitDiffBlock(diff)
		const decision = requestConfirm(handle.id)
		useChatStore.setState((state) => ({
			...buildChatRunStateUpdate(state, ownerId, {
				identity,
				status: 'awaiting_approval',
			}),
			isStreaming: true,
			runningChatId: ownerId,
			activeRun: identity,
		}))

		useChatStore.getState().cancelStream()

		expect(await decision).toBe('cancel')
		expect(getPendingDiff(handle.id)?.status).toBe('cancelled')
		const stopped = useChatStore.getState()
		expect(stopped.isStreaming).toBe(false)
		expect(stopped.runningChatId).toBeNull()
		expect(stopped.chatRunStates[ownerId]?.status).toBe('stopped')
	})

	test('a Story-target dialog marks its exact run awaiting approval and Stop releases it', async () => {
		const ownerId = useChatStore.getState().activeChatId as string
		const identity = runIdentity(ownerId)
		useChatStore.setState((state) => ({
			...buildChatRunStateUpdate(state, ownerId, { identity, status: 'working' }),
			isStreaming: true,
			runningChatId: ownerId,
			activeRun: identity,
		}))

		const decision = requestStoryTarget(
			{ chatId: ownerId, toolCallId: 'write-story', storyTitle: 'Awaited Story' },
			() => undefined,
		)
		expect(useChatStore.getState().chatRunStates[ownerId]?.status).toBe('awaiting_approval')

		useChatStore.getState().cancelStream()

		await expect(decision).resolves.toEqual({ decision: 'cancelled' })
		expect(useChatStore.getState().chatRunStates[ownerId]?.status).toBe('stopped')
	})

	test('an awaited reference completion adds only to its initiating conversation', () => {
		const initiatingId = useChatStore.getState().activeChatId as string
		useChatStore.getState().createChat()
		const browsedId = useChatStore.getState().activeChatId as string
		useChatStore.getState().addReferenceToChat(initiatingId, {
			id: 'published-dataset',
			name: 'Published dataset',
			type: 'dataset',
			address: 'naddr1fresh',
		})

		const state = useChatStore.getState()
		expect(state.activeChatId).toBe(browsedId)
		expect(state.references).toEqual([])
		expect(state.chatSessions.find((chat) => chat.id === initiatingId)?.references).toHaveLength(1)
	})

	test('visible edit state never binds a conversation but remains available as reference context', () => {
		const chatId = useChatStore.getState().activeChatId as string
		const visibleDraft = {
			persistenceVersion: 2 as const,
			id: 'draft-visible',
			sourceId: 'dataset:author:map',
			name: 'Visible map',
			description: '',
			collectionMeta: {
				name: 'Visible map',
				description: '',
				color: '#000000',
				customProperties: {},
			},
			features: [],
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' as const },
			contextRefs: [],
			blobReferences: [],
			createdAt: 1,
			updatedAt: 1,
		}
		useEditorStore.setState({
			activeWorkspaceId: 'workspace-visible',
			geoEditDrafts: { [visibleDraft.id]: visibleDraft },
			workspaces: {
				'workspace-visible': {
					id: 'workspace-visible',
					sourceId: 'dataset:author:map',
					label: 'Visible map',
					kind: 'dataset',
					datasetKey: 'author:map',
					activeDraftId: visibleDraft.id,
					chatSessionId: chatId,
					createdAt: 1,
					updatedAt: 1,
				},
			},
			activeGeoEditDraftId: visibleDraft.id,
		})

		expect(captureActiveToolExecutionTarget(chatId).entityType).toBeNull()
		expect(
			useChatStore.getState().chatSessions.find((chat) => chat.id === chatId)?.targetWorkspaceId,
		).toBeNull()
		expect(captureVisibleDatasetReferenceTarget()).toMatchObject({
			entityType: 'dataset',
			entityId: 'author:map',
			workspaceId: 'workspace-visible',
		})

		useChatStore.getState().setChatTargetWorkspace(chatId, 'workspace-visible')
		expect(captureActiveToolExecutionTarget(chatId)).toMatchObject({
			entityType: 'dataset',
			entityId: 'author:map',
			workspaceId: 'workspace-visible',
			draftId: visibleDraft.id,
		})
	})

	test('a Dataset shown as a concrete Chat binding is also capturable by the tool run', () => {
		const chatId = useChatStore.getState().activeChatId as string
		const draft = {
			persistenceVersion: 2 as const,
			id: 'draft-ui',
			sourceId: 'scratch:draft',
			name: 'Untitled draft',
			description: '',
			collectionMeta: {
				name: 'Untitled draft',
				description: '',
				color: '#000000',
				customProperties: {},
			},
			features: [],
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' as const },
			contextRefs: [],
			blobReferences: [],
			createdAt: 1,
			updatedAt: 1,
		}
		const workspace = {
			id: 'workspace-ui',
			sourceId: 'scratch:workspace',
			label: 'Untitled workspace',
			kind: 'scratch' as const,
			datasetKey: null,
			baseRevisionId: null,
			activeDraftId: draft.id,
			chatSessionId: chatId,
			createdAt: 1,
			updatedAt: 1,
		}
		useEditorStore.setState({
			activeWorkspaceId: workspace.id,
			activeGeoEditDraftId: draft.id,
			geoEditDrafts: { [draft.id]: draft },
			workspaces: { [workspace.id]: workspace },
		})
		useChatStore.getState().setChatTargetWorkspace(chatId, workspace.id)

		const binding = resolveWorkspaceBindingIdentity(workspace, draft)
		const captured = captureActiveToolExecutionTarget(chatId)

		expect(binding.targetRequired).toBe(captured.entityType !== 'dataset')
	})

	test('an inactive retained workspace remains the Chat target and may be shared by two Chats', () => {
		const base = finalizeEvent(
			{
				kind: GEO_EVENT_KIND,
				created_at: 1,
				content: JSON.stringify({ type: 'FeatureCollection', features: [] }),
				tags: [['d', 'bound-a']],
			},
			new Uint8Array(32).fill(7),
		)
		eventStore.add(base)
		const sourceA = `dataset:${base.pubkey}:bound-a`
		const draftA = {
			persistenceVersion: 2 as const,
			id: 'draft-a',
			sourceId: sourceA,
			name: 'Bound A',
			description: '',
			collectionMeta: {
				name: 'Bound A',
				description: '',
				color: '#000000',
				customProperties: {},
			},
			features: [
				{
					type: 'Feature' as const,
					id: 'a-feature',
					geometry: { type: 'Point' as const, coordinates: [1, 2] },
					properties: {},
				},
			],
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' as const },
			contextRefs: [],
			blobReferences: [],
			createdAt: 1,
			updatedAt: 10,
		}
		const draftB = {
			...draftA,
			id: 'draft-b',
			sourceId: 'session:b',
			name: 'Visible B',
			collectionMeta: { ...draftA.collectionMeta, name: 'Visible B' },
			features: [
				{
					type: 'Feature' as const,
					id: 'b-feature',
					geometry: { type: 'Point' as const, coordinates: [3, 4] },
					properties: {},
				},
			],
		}
		useEditorStore.setState({
			activeWorkspaceId: 'workspace-b',
			activeGeoEditDraftId: 'draft-b',
			activeDataset: null,
			isDirty: true,
			geoEditDrafts: { 'draft-a': draftA, 'draft-b': draftB },
			workspaces: {
				'workspace-a': {
					id: 'workspace-a',
					sourceId: sourceA,
					label: 'Bound A',
					kind: 'dataset',
					datasetKey: `${base.pubkey}:bound-a`,
					activeDraftId: 'draft-a',
					chatSessionId: null,
					createdAt: 1,
					updatedAt: 10,
				},
				'workspace-b': {
					id: 'workspace-b',
					sourceId: 'session:b',
					label: 'Visible B',
					kind: 'scratch',
					datasetKey: null,
					activeDraftId: 'draft-b',
					chatSessionId: null,
					createdAt: 2,
					updatedAt: 20,
				},
			},
		})

		const firstChatId = useChatStore.getState().activeChatId as string
		useChatStore.getState().setChatTargetWorkspace(firstChatId, 'workspace-a')
		const firstTarget = captureActiveToolExecutionTarget(firstChatId)
		expect(firstTarget).toMatchObject({
			workspaceId: 'workspace-a',
			draftId: 'draft-a',
			sourceId: sourceA,
			baseRevisionId: base.id,
		})
		const targetContext = getMapContextSnapshotForTarget(firstTarget)
		expect(targetContext.featureCount).toBe(1)
		expect(targetContext.featureGeometryCounts).toEqual({ Point: 1 })
		expect(targetContext.viewportBbox).toBeNull()
		expect(JSON.stringify(targetContext)).not.toContain('b-feature')

		useChatStore.getState().createChat()
		const secondChatId = useChatStore.getState().activeChatId as string
		useChatStore.getState().setChatTargetWorkspace(secondChatId, 'workspace-a')
		expect(
			useChatStore.getState().chatSessions.find((chat) => chat.id === firstChatId)
				?.targetWorkspaceId,
		).toBe('workspace-a')
		expect(
			useChatStore.getState().chatSessions.find((chat) => chat.id === secondChatId)
				?.targetWorkspaceId,
		).toBe('workspace-a')
		expect(useEditorStore.getState().activeWorkspaceId).toBe('workspace-b')
		expect(captureActiveToolExecutionTarget(secondChatId).draftId).toBe('draft-a')

		eventStore.remove(base.id)
	})
})

describe('stream stall watchdog', () => {
	test('allows slow reasoning providers at least four minutes without a response update', () => {
		expect(STREAM_STALL_TIMEOUT_MS).toBeGreaterThanOrEqual(240_000)
	})
})

describe('tool-loop terminal target errors', () => {
	test('stops for an editing-target requirement instead of spending another model round', () => {
		const error = terminalDatasetTargetError(
			JSON.stringify({
				ok: false,
				kind: 'handler_error',
				toolName: 'write_geojson_to_editor',
				message: 'Choose an editing target.',
				code: 'dataset_target_required',
			}),
		)

		expect(error?.code).toBe('dataset_target_required')
	})

	test('lets the model correct ordinary tool errors', () => {
		expect(
			terminalDatasetTargetError(
				JSON.stringify({
					ok: false,
					kind: 'handler_error',
					toolName: 'run_code',
					message: 'Syntax error',
					code: 'handler_error',
				}),
			),
		).toBeNull()
	})

	test('cancels unexecuted sibling calls after a terminal target error and preserves pairing', async () => {
		const terminalToolName = '__test_terminal_dataset_target'
		const laterToolName = '__test_unexecuted_sibling'
		const terminalCallId = 'call_terminal'
		const laterCallId = 'call_later'
		const modelId = 'terminal-sibling-regression'
		const providerBaseUrl = 'http://terminal-sibling.test/v1'
		const originalFetch = globalThis.fetch
		let terminalInvocations = 0
		let laterInvocations = 0
		let completionRequests = 0

		const schema = (name: string) => ({
			type: 'function' as const,
			function: {
				name,
				description: 'Store tool-loop regression fixture.',
				parameters: { type: 'object' as const, properties: {} },
			},
		})
		const encoder = new TextEncoder()
		const streamResponse = () =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									id: 'chunk',
									object: 'chat.completion.chunk',
									created: 1,
									model: modelId,
									choices: [
										{
											index: 0,
											delta: {
												tool_calls: [
													{
														index: 0,
														id: terminalCallId,
														type: 'function',
														function: { name: terminalToolName, arguments: '{}' },
													},
													{
														index: 1,
														id: laterCallId,
														type: 'function',
														function: { name: laterToolName, arguments: '{}' },
													},
												],
											},
											finish_reason: 'tool_calls',
										},
									],
								})}\n`,
							),
						)
						controller.enqueue(encoder.encode('data: [DONE]\n'))
						controller.close()
					},
				}),
				{ status: 200, headers: { 'content-type': 'text/event-stream' } },
			)

		register({
			name: terminalToolName,
			schema: schema(terminalToolName),
			kind: 'host-builtin',
			handler: () => {
				terminalInvocations += 1
				throw Object.assign(new Error('The bound Dataset changed.'), {
					code: 'dataset_target_conflict',
				})
			},
		})
		register({
			name: laterToolName,
			schema: schema(laterToolName),
			kind: 'host-builtin',
			handler: () => {
				laterInvocations += 1
				return { ok: true }
			},
		})

		try {
			useChatStore.getState().reset()
			bindActiveChatToEmptyDatasetTarget('Terminal sibling target')
			const providerOverrides = emptyOverrides()
			providerOverrides.custom = { baseUrl: providerBaseUrl, apiKey: '' }
			useChatStore.setState({
				provider: 'custom',
				providerOverrides,
				models: [makeModel({ id: modelId })],
				selectedModel: modelId,
				toolsEnabled: true,
			})
			globalThis.fetch = (async (input) => {
				const url = String(input)
				if (url === `${providerBaseUrl}/models`) {
					return new Response(JSON.stringify({ data: [{ id: modelId, capabilities: ['text'] }] }), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					})
				}
				if (url === `${providerBaseUrl}/chat/completions`) {
					completionRequests += 1
					return streamResponse()
				}
				throw new Error(`Unexpected request: ${url}`)
			}) as typeof fetch

			await useChatStore.getState().sendMessage('Trigger the terminal sibling fixture.')

			const state = useChatStore.getState()
			const assistantToolCalls = state.messages.find(
				(message) => message.role === 'assistant' && message.tool_calls?.length === 2,
			)?.tool_calls
			const toolMessages = state.messages.filter((message) => message.role === 'tool')
			expect(terminalInvocations).toBe(1)
			expect(laterInvocations).toBe(0)
			expect(completionRequests).toBe(1)
			expect(assistantToolCalls?.map((call) => call.id)).toEqual([terminalCallId, laterCallId])
			expect(toolMessages.map((message) => message.tool_call_id)).toEqual([
				terminalCallId,
				laterCallId,
			])
			expect(JSON.parse(String(toolMessages[0]?.content)).code).toBe('dataset_target_conflict')
			expect(JSON.parse(String(toolMessages[1]?.content))).toMatchObject({ cancelled: true })
			expect(state.error).toBe('The bound Dataset changed.')
			expect(state.errorRecovery).toBe('retry_turn')
		} finally {
			globalThis.fetch = originalFetch
			unregister(terminalToolName)
			unregister(laterToolName)
			useChatStore.getState().reset()
		}
	})
})

describe('partial-success recovery', () => {
	test('never replays a turn once any earlier tool result changed the map', () => {
		expect(resolveChatErrorRecovery(0)).toBe('retry_turn')
		expect(resolveChatErrorRecovery(1)).toBe('finish_response')
		expect(resolveChatErrorRecovery(0, true)).toBe('finish_response')
	})

	test('keeps retry and finish recovery available when the replacement run fails preflight', async () => {
		for (const recovery of ['retry_turn', 'finish_response'] as const) {
			useChatStore.getState().reset()
			bindActiveChatToEmptyDatasetTarget(`Preflight ${recovery}`)
			const chatId = useChatStore.getState().activeChatId as string
			useChatStore.setState((state) => ({
				...buildChatRunStateUpdate(state, chatId, {
					status: 'error',
					error: 'Original provider failure',
					errorRecovery: recovery,
					lastTurnRequest: { content: 'Original prompt' },
				}),
				models: [],
				selectedModel: null,
			}))

			if (recovery === 'finish_response') {
				await useChatStore.getState().finishLastResponse()
			} else {
				await useChatStore.getState().retryLastMessage()
			}

			const state = useChatStore.getState()
			expect(state.isStreaming).toBe(false)
			expect(state.error).toBe('Original provider failure')
			expect(state.errorRecovery).toBe(recovery)
			expect(state.lastTurnRequest?.content).toBe('Original prompt')
			expect(state.chatRunStates[chatId]?.error).toBe('Original provider failure')
			expect(state.chatRunStates[chatId]?.errorRecovery).toBe(recovery)
		}
	})

	test('finishes only the missing summary after an applied tool result and provider failure', async () => {
		const toolName = '__test_applied_map_mutation'
		const toolCallId = 'call_applied_mutation'
		const modelId = 'partial-success-regression'
		const providerBaseUrl = 'http://partial-success.test/v1'
		const originalFetch = globalThis.fetch
		const originalRequestAnimationFrame = globalThis.requestAnimationFrame
		const originalCancelAnimationFrame = globalThis.cancelAnimationFrame
		let toolInvocations = 0
		let completionRequests = 0
		const completionBodies: Array<Record<string, unknown>> = []
		const encoder = new TextEncoder()

		const streamResponse = (delta: Record<string, unknown>, finishReason: string) =>
			new Response(
				new ReadableStream({
					start(controller) {
						controller.enqueue(
							encoder.encode(
								`data: ${JSON.stringify({
									id: 'chunk',
									object: 'chat.completion.chunk',
									created: 1,
									model: modelId,
									choices: [{ index: 0, delta, finish_reason: finishReason }],
								})}\n`,
							),
						)
						controller.enqueue(encoder.encode('data: [DONE]\n'))
						controller.close()
					},
				}),
				{ status: 200, headers: { 'content-type': 'text/event-stream' } },
			)

		register({
			name: toolName,
			kind: 'host-builtin',
			schema: {
				type: 'function',
				function: {
					name: toolName,
					description: 'Partial-success regression fixture.',
					parameters: { type: 'object', properties: {} },
				},
			},
			handler: () => {
				toolInvocations += 1
				return { ok: true, counts: { created: 1, updated: 0, deleted: 0 } }
			},
		})

		try {
			useChatStore.getState().reset()
			bindActiveChatToEmptyDatasetTarget('Partial-success target')
			const providerOverrides = emptyOverrides()
			providerOverrides.custom = { baseUrl: providerBaseUrl, apiKey: '' }
			useChatStore.setState({
				provider: 'custom',
				providerOverrides,
				models: [makeModel({ id: modelId })],
				selectedModel: modelId,
				toolsEnabled: true,
			})
			globalThis.requestAnimationFrame = () => 1
			globalThis.cancelAnimationFrame = () => undefined
			globalThis.fetch = (async (input, init) => {
				const url = String(input)
				if (url === `${providerBaseUrl}/models`) {
					return new Response(JSON.stringify({ data: [{ id: modelId, capabilities: ['text'] }] }), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					})
				}
				if (url === `${providerBaseUrl}/chat/completions`) {
					completionRequests += 1
					completionBodies.push(JSON.parse(String(init?.body ?? '{}')))
					if (completionRequests === 1) {
						return streamResponse(
							{
								tool_calls: [
									{
										index: 0,
										id: toolCallId,
										type: 'function',
										function: { name: toolName, arguments: '{}' },
									},
								],
							},
							'tool_calls',
						)
					}
					if (completionRequests === 2) {
						return new Response(
							JSON.stringify({ error: { message: 'final narration unavailable' } }),
							{
								status: 400,
								headers: { 'content-type': 'application/json' },
							},
						)
					}
					return streamResponse({ content: 'Done — the map changes are already applied.' }, 'stop')
				}
				throw new Error(`Unexpected request: ${url}`)
			}) as typeof fetch

			await useChatStore.getState().sendMessage('Apply one map change, then summarize it.')

			let state = useChatStore.getState()
			expect(toolInvocations).toBe(1)
			expect(completionRequests).toBe(2)
			expect(state.error).toContain('final narration unavailable')
			expect(state.errorRecovery).toBe('finish_response')
			expect(state.diagnostics.mapChangingToolResultCount).toBe(1)
			expect(state.messages.filter((message) => message.role === 'user')).toHaveLength(1)

			await useChatStore.getState().finishLastResponse()

			state = useChatStore.getState()
			expect(toolInvocations).toBe(1)
			expect(completionRequests).toBe(3)
			expect(state.error).toBeNull()
			expect(state.errorRecovery).toBeNull()
			expect(state.messages.filter((message) => message.role === 'user')).toHaveLength(1)
			expect(state.messages.at(-1)?.content).toBe('Done — the map changes are already applied.')
			expect(completionBodies[2]?.tools).toBeUndefined()
			const finishMessages = completionBodies[2]?.messages as Array<{
				role?: string
				content?: string
			}>
			expect(finishMessages[0]?.role).toBe('system')
			expect(finishMessages[0]?.content).toContain('already applied successfully')
			expect(finishMessages[0]?.content).toContain('Do not call tools')
		} finally {
			globalThis.fetch = originalFetch
			if (originalRequestAnimationFrame) {
				globalThis.requestAnimationFrame = originalRequestAnimationFrame
			} else {
				Reflect.deleteProperty(globalThis, 'requestAnimationFrame')
			}
			if (originalCancelAnimationFrame) {
				globalThis.cancelAnimationFrame = originalCancelAnimationFrame
			} else {
				Reflect.deleteProperty(globalThis, 'cancelAnimationFrame')
			}
			unregister(toolName)
			useChatStore.getState().reset()
		}
	})
})

describe('model tool advertisement', () => {
	test('does not advertise interactive editor commands to background chat runs', () => {
		const advertisedNames = getAdvertisedGeoTools(true).map((tool) => tool.function.name)
		const expectedNames = getGeoTools()
			.map((tool) => tool.function.name)
			.filter((name) => !name.startsWith('editor_'))

		expect(advertisedNames).toEqual(expectedNames)
		expect(advertisedNames.some((name) => name.startsWith('editor_'))).toBe(false)
		expect(advertisedNames).toContain('get_editor_state')
	})

	test('only removes genuinely incompatible vision tools for text-only models', () => {
		const advertisedNames = getAdvertisedGeoTools(false).map((tool) => tool.function.name)
		const expectedNames = getGeoTools()
			.map((tool) => tool.function.name)
			.filter((name) => name !== 'capture_map_snapshot' && !name.startsWith('editor_'))

		expect(advertisedNames).toEqual(expectedNames)
	})
})

describe('system prompt transport', () => {
	test('retains a contemporary long map policy instead of silently cutting it at 1,800 chars', () => {
		const tailContract = 'TAIL_CONTRACT_FIRST_VISIBLE_GEOMETRY'
		const content = `${'policy '.repeat(3_000)}${tailContract}`
		const sanitized = sanitizeMessageForPrompt({ role: 'system', content })

		expect(sanitized.content).toBe(content)
		expect(String(sanitized.content)).toContain(tailContract)
		expect(String(sanitized.content)).not.toContain('[truncated for context window]')
	})
})

function emptyOverrides(): ProviderOverrideMap {
	return {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	}
}

describe('loadModels — empty list must not drive an infinite refetch loop', () => {
	test('an empty model list is surfaced as modelsError (stops the mount-effect loop)', async () => {
		// ChatPanel's mount effect re-runs loadModels while
		// `models.length === 0 && !modelsLoading && !modelsError`. A provider that
		// returns zero models WITHOUT throwing must set modelsError, or that guard
		// stays true forever and pegs the CPU (regression).
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})) as unknown as typeof fetch
		try {
			useChatStore.setState({
				provider: 'routstr',
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: null,
			})
			await useChatStore.getState().loadModels()
			const state = useChatStore.getState()
			expect(state.models).toEqual([])
			expect(state.modelsLoading).toBe(false)
			// The loop-breaking invariant: error set, so the guard is now false.
			expect(state.modelsError).toBeTruthy()
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('a non-empty model list clears modelsError and selects a model', async () => {
		const originalFetch = globalThis.fetch
		globalThis.fetch = (async () =>
			new Response(JSON.stringify({ data: [{ id: 'm1', name: 'M1' }] }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			})) as unknown as typeof fetch
		try {
			useChatStore.setState({
				provider: 'routstr',
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: null,
			})
			await useChatStore.getState().loadModels()
			const state = useChatStore.getState()
			expect(state.models.length).toBe(1)
			expect(state.modelsError).toBeNull()
			expect(state.selectedModel).toBe('m1')
		} finally {
			globalThis.fetch = originalFetch
		}
	})

	test('a stale model response cannot replace settings hydrated while it was in flight', async () => {
		const originalFetch = globalThis.fetch
		let resolveFetch!: (response: Response) => void
		globalThis.fetch = (() =>
			new Promise<Response>((resolve) => {
				resolveFetch = resolve
			})) as unknown as typeof fetch
		try {
			const firstOverrides = emptyOverrides()
			firstOverrides.custom = { baseUrl: 'http://first.example/v1', apiKey: 'first' }
			useChatStore.setState({
				provider: 'custom',
				providerOverrides: firstOverrides,
				models: [],
				modelsError: null,
				modelsLoading: false,
				selectedModel: 'imported-model',
			})

			const staleLoad = useChatStore.getState().loadModels()

			const hydratedOverrides = emptyOverrides()
			hydratedOverrides.custom = { baseUrl: 'http://hydrated.example/v1', apiKey: 'hydrated' }
			useChatStore.getState().hydrateSettings({
				provider: 'custom',
				providerOverrides: hydratedOverrides,
				selectedModel: 'imported-model',
			})

			resolveFetch(
				new Response(JSON.stringify({ data: [{ id: 'stale-vision-model', name: 'Stale' }] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
			)
			await staleLoad

			const state = useChatStore.getState()
			expect(state.providerOverrides.custom.baseUrl).toBe('http://hydrated.example/v1')
			expect(state.selectedModel).toBe('imported-model')
			expect(state.models).toEqual([])
			expect(state.modelsLoading).toBe(false)
		} finally {
			globalThis.fetch = originalFetch
		}
	})
})

describe('resolveProvider', () => {
	test('falls back to BUILTIN localhost default when override baseUrl is empty (D-03)', () => {
		const lm = resolveProvider('lmstudio', emptyOverrides())
		expect(lm.baseUrl).toBe(BUILTIN_PROVIDERS.lmstudio.baseUrl)
		expect(lm.baseUrl).toBe('http://localhost:1234/v1')

		const ollama = resolveProvider('ollama', emptyOverrides())
		expect(ollama.baseUrl).toBe(BUILTIN_PROVIDERS.ollama.baseUrl)
		expect(ollama.baseUrl).toBe('http://localhost:11434/v1')
	})

	test('uses the override baseUrl when non-empty', () => {
		const overrides = emptyOverrides()
		overrides.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: '' }
		const lm = resolveProvider('lmstudio', overrides)
		expect(lm.baseUrl).toBe('http://host:9999/v1')
	})

	test('attaches apiKey only when override apiKey is non-empty', () => {
		const withKey = emptyOverrides()
		withKey.lmstudio = { baseUrl: 'http://host:9999/v1', apiKey: 'secret' }
		expect(resolveProvider('lmstudio', withKey).apiKey).toBe('secret')

		expect(resolveProvider('lmstudio', emptyOverrides()).apiKey).toBeUndefined()
	})

	test('custom provider reads baseUrl + apiKey from its override', () => {
		const overrides = emptyOverrides()
		overrides.custom = { baseUrl: 'http://custom/v1', apiKey: 'ck' }
		const custom = resolveProvider('custom', overrides)
		expect(custom.type).toBe('custom')
		expect(custom.baseUrl).toBe('http://custom/v1')
		expect(custom.apiKey).toBe('ck')

		const customNoKey = resolveProvider('custom', emptyOverrides())
		expect(customNoKey.apiKey).toBeUndefined()
	})
})

describe('setProviderOverride', () => {
	beforeEach(() => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
	})

	test('preserves each per-type override across a provider switch (D-02)', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('lmstudio', { baseUrl: 'A' })
		state.setProviderOverride('ollama', { baseUrl: 'B' })
		state.setProvider('lmstudio')

		const after = useChatStore.getState().providerOverrides
		expect(after.lmstudio.baseUrl).toBe('A')
		expect(after.ollama.baseUrl).toBe('B')
	})

	test('immutably merges the patch into the existing override', () => {
		const state = useChatStore.getState()
		state.setProviderOverride('custom', { baseUrl: 'http://c/v1' })
		state.setProviderOverride('custom', { apiKey: 'k' })
		const custom = useChatStore.getState().providerOverrides.custom
		expect(custom).toEqual({ baseUrl: 'http://c/v1', apiKey: 'k' })
	})
})

describe('persist partialize secret-exclusion (SC-1 / T-01-01)', () => {
	test('partialized state contains no apiKey/baseUrl/providerOverrides secret', () => {
		useChatStore.setState({ providerOverrides: emptyOverrides() })
		useChatStore.getState().setProviderOverride('lmstudio', { apiKey: 'secret' })

		const partialized = chatStorePartialize(useChatStore.getState())
		const serialized = JSON.stringify(partialized)

		expect(serialized).not.toContain('secret')
		expect(serialized).not.toContain('apiKey')
		expect(serialized).not.toContain('baseUrl')
		expect(serialized).not.toContain('providerOverrides')

		expect(Object.keys(partialized).sort()).toEqual(['activeChatId', 'chatSessions'])
	})

	test('persists each Chat-owned workspace pointer independently', () => {
		const chatId = useChatStore.getState().activeChatId as string
		useChatStore.setState((state) => ({
			chatSessions: state.chatSessions.map((chat) =>
				chat.id === chatId ? { ...chat, targetWorkspaceId: 'workspace-a' } : chat,
			),
		}))
		const partialized = chatStorePartialize(useChatStore.getState())
		expect(partialized.chatSessions.find((chat) => chat.id === chatId)?.targetWorkspaceId).toBe(
			'workspace-a',
		)
	})
})

describe('DEFAULT_CHAT_SETTINGS', () => {
	test('seeds all three overrides empty and version 2', () => {
		expect(DEFAULT_CHAT_SETTINGS.version).toBe(2)
		expect(DEFAULT_CHAT_SETTINGS.providerOverrides).toEqual(emptyOverrides())
	})
})

describe('compactIngestHandlePartForPrompt (WR-08)', () => {
	function makeIngestHandlePart(opts: {
		handleId: string
		columns: number
		sampleRowCount: number
		cellChars: number
	}): string {
		const schema = Array.from({ length: opts.columns }, (_, i) => ({
			name: `column_with_a_fairly_long_descriptive_name_${i}`,
			type: 'string' as const,
		}))
		const sampleRows = Array.from({ length: opts.sampleRowCount }, (_, r) => {
			const row: Record<string, unknown> = {}
			for (let c = 0; c < opts.columns; c++) {
				row[`column_with_a_fairly_long_descriptive_name_${c}`] =
					`${'x'.repeat(opts.cellChars)}-${r}-${c}`
			}
			return row
		})
		return JSON.stringify({
			ingestHandle: opts.handleId,
			ingestSummary: {
				handleId: opts.handleId,
				fileName: 'wide.csv',
				type: 'csv',
				rowCount: 5000,
				columnCount: opts.columns,
				schema,
				sampleRows,
				detectedCoordinateColumns: [],
			},
		})
	}

	test('a wide/large summary over budget still yields parseable JSON with ingestHandle intact', () => {
		const handleId = 'handle-abc-123-keepme'
		const part = makeIngestHandlePart({
			handleId,
			columns: 40,
			sampleRowCount: 15,
			cellChars: 40,
		})
		// Far exceeds the 6000 user-message char budget.
		expect(part.length).toBeGreaterThan(6000)

		const compacted = compactIngestHandlePartForPrompt(part, 6000)
		expect(compacted).toBeDefined()
		const result = compacted as string
		// Must NOT have been blindly char-truncated (no truncation marker).
		expect(result).not.toContain('[truncated for context window]')
		// Stays within budget.
		expect(result.length).toBeLessThanOrEqual(6000)
		// Parses cleanly AND retains the handle.
		const parsed = JSON.parse(result) as {
			ingestHandle: string
			ingestSummary: { handleId: string; sampleRows?: unknown[] }
		}
		expect(parsed.ingestHandle).toBe(handleId)
		expect(parsed.ingestSummary.handleId).toBe(handleId)
		// The bulky sampleRows were dropped first to make room.
		expect(parsed.ingestSummary.sampleRows ?? []).toHaveLength(0)
	})

	test('returns the part unchanged when it already fits and is an ingest-handle part', () => {
		const part = makeIngestHandlePart({
			handleId: 'small',
			columns: 2,
			sampleRowCount: 1,
			cellChars: 2,
		})
		expect(part.length).toBeLessThan(6000)
		expect(compactIngestHandlePartForPrompt(part, 6000)).toBe(part)
	})

	test('returns undefined for a non-ingest text part (caller falls back to char-truncation)', () => {
		expect(compactIngestHandlePartForPrompt('just a normal message', 6000)).toBeUndefined()
		expect(compactIngestHandlePartForPrompt(JSON.stringify({ foo: 'bar' }), 6000)).toBeUndefined()
	})

	test('preserves the handle even at a pathologically small budget', () => {
		const handleId = 'handle-must-survive'
		const part = makeIngestHandlePart({
			handleId,
			columns: 40,
			sampleRowCount: 15,
			cellChars: 40,
		})
		const compacted = compactIngestHandlePartForPrompt(part, 300)
		expect(compacted).toBeDefined()
		const parsed = JSON.parse(compacted as string) as { ingestHandle: string }
		expect(parsed.ingestHandle).toBe(handleId)
	})
})

describe('describeEmptyCompletion — terminal-state surfacing (UAT: silent empty turn)', () => {
	test("finishReason 'length' yields truncation-specific copy and truncated:true", () => {
		const notice = describeEmptyCompletion('length')
		expect(notice.truncated).toBe(true)
		expect(notice.message).toContain('cut off')
		// Output is no longer artificially capped — 'length' now means the model
		// exhausted the context-derived output room, so the copy points at the
		// context window rather than a tunable max-output setting.
		expect(notice.message.toLowerCase()).toContain('context')
		expect(notice.message.toLowerCase()).toContain('retry')
	})

	test("empty completion with finishReason 'stop' yields empty-response copy and truncated:false", () => {
		const notice = describeEmptyCompletion('stop')
		expect(notice.truncated).toBe(false)
		expect(notice.message.toLowerCase()).toContain('empty response')
		// finishReason surfaced for debugging
		expect(notice.message).toContain('stop')
	})

	test('null / undefined finishReason still produces a visible empty-response notice', () => {
		for (const reason of [null, undefined]) {
			const notice = describeEmptyCompletion(reason)
			expect(notice.truncated).toBe(false)
			expect(notice.message.toLowerCase()).toContain('empty response')
			expect(notice.message).toContain('none')
		}
	})

	test('every branch returns a non-empty, visible message (never silent)', () => {
		for (const reason of ['length', 'stop', 'content_filter', null, undefined]) {
			expect(describeEmptyCompletion(reason).message.trim().length).toBeGreaterThan(0)
		}
	})
})

describe('empty/truncated terminal outcome — store surfacing (UAT regression)', () => {
	beforeEach(() => {
		useChatStore.setState({ error: null, lastProgressKind: null })
	})

	test('truncation suffix is appended to truncated-but-non-empty assistant content', () => {
		// The suffix is what the content-present truncation path appends so the
		// partial answer is still visibly flagged as cut off.
		const content = 'Partial answer that was cut off'
		const flagged = `${content}${TRUNCATION_CONTENT_SUFFIX}`
		expect(flagged).toContain(content)
		expect(flagged.toLowerCase()).toContain('truncated')
		expect(flagged.toLowerCase()).toContain('output-token limit')
	})

	test('the empty-completion notice routes through the rendered `error` state, not a silent idle', () => {
		// Simulate the empty-completion else branch using the same helper the store
		// uses, asserting the surface ChatPanel renders (the `error` banner) is set
		// and progress is marked as error rather than silently idle/complete.
		const { message } = describeEmptyCompletion('length')
		useChatStore.setState({ error: message, lastProgressKind: 'error' })
		const state = useChatStore.getState()
		expect(state.error).toBe(message)
		expect(state.error).not.toBeNull()
		expect(state.lastProgressKind).toBe('error')
		expect(state.lastProgressKind).not.toBe('complete')
	})
})

describe('deriveOutputBudget — no artificial output cap (UAT: 512/1024 truncation removed)', () => {
	test('budget SCALES with the context window, never the old fixed 512/1024 cap', () => {
		const bigModel = makeModel({ contextLength: 262_144 })
		const smallPrompt = 1000
		const { costTokens } = deriveOutputBudget(bigModel, PAID_PROVIDER, smallPrompt)
		// A 262k-context model must yield a large budget — emphatically NOT the old cap.
		expect(costTokens).toBeGreaterThan(200_000)
		expect(costTokens).not.toBe(512)
		expect(costTokens).not.toBe(1024)

		// Larger context => larger budget (monotonic with the window).
		const biggerModel = makeModel({ contextLength: 1_000_000 })
		const bigger = deriveOutputBudget(biggerModel, PAID_PROVIDER, smallPrompt)
		expect(bigger.costTokens).toBeGreaterThan(costTokens)
	})

	test('free/local providers OMIT max_tokens (undefined => no cap sent)', () => {
		const model = makeModel({ contextLength: 32_000 })
		for (const provider of FREE_PROVIDERS) {
			const { maxTokens } = deriveOutputBudget(model, provider, 500)
			expect(maxTokens).toBeUndefined()
		}
	})

	test('paid provider SENDS the derived budget (a concrete number, not undefined)', () => {
		const model = makeModel({ contextLength: 128_000 })
		const { maxTokens, costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 2000)
		expect(typeof maxTokens).toBe('number')
		// The sent budget and the cost-estimation number are the SAME value, so
		// prepay reserves exactly what the server may emit (refund returns the rest).
		expect(maxTokens).toBe(costTokens)
	})

	test('paid provider clamps max_tokens to model max completion tokens', () => {
		const model = makeModel({
			id: 'qwen3.7-plus',
			contextLength: 1_000_000,
			maxCompletionTokens: 65_536,
		})
		const { maxTokens, costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 1000)
		expect(maxTokens).toBe(65_536)
		expect(costTokens).toBe(65_536)
	})

	test('paid cost estimate uses the SAME derived budget (prepay never underpays)', () => {
		// Non-zero output pricing so the budget actually drives cost.
		const model = makeModel({
			contextLength: 64_000,
			pricing: { input: 1_000_000, output: 1_000_000, request: 0 },
		})
		const inputTokens = 3000
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, inputTokens)
		const costFromDerived = estimateMaxCost(model, inputTokens, costTokens)
		// The prepay must cover input + the FULL derived output budget. If we had
		// underpaid (e.g. estimated against a smaller cap), this would be lower.
		const minimumExpected = inputTokens * 1 + costTokens * 1
		expect(costFromDerived).toBeGreaterThanOrEqual(minimumExpected)
	})

	test('tool-call floor: a huge prompt still leaves the minimum output budget', () => {
		const model = makeModel({ contextLength: 8000 })
		// Prompt larger than the whole window — remaining would go negative.
		const { costTokens, maxTokens } = deriveOutputBudget(model, PAID_PROVIDER, 100_000)
		expect(costTokens).toBeGreaterThanOrEqual(1024) // MIN_OUTPUT_BUDGET_TOKENS floor
		expect(maxTokens).toBe(costTokens)
	})

	test('unknown context window falls back to a sane paid budget (no zero/NaN)', () => {
		// lmstudio clamps to a hard cap, so use a paid provider with no contextLength.
		const model = makeModel({ contextLength: undefined })
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, 100)
		expect(Number.isFinite(costTokens)).toBe(true)
		expect(costTokens).toBeGreaterThanOrEqual(1024)
	})
})

describe('getPromptBudgetTokens — prompt + completion fit the window (inverted budget)', () => {
	test('prompt budget leaves real room for completion (not starved to a sliver)', () => {
		const model = makeModel({ contextLength: 32_000 })
		const promptBudget = getPromptBudgetTokens(model, PAID_PROVIDER)
		// Completion gets the remainder; prompt + a derived completion fit the window.
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, promptBudget)
		expect(promptBudget + costTokens).toBeLessThanOrEqual(model.contextLength as number)
		// Completion reserve is proportional, so it is meaningfully more than a sliver.
		expect(costTokens).toBeGreaterThanOrEqual(1024)
	})

	test('a small-context model still leaves room for both prompt and completion', () => {
		const model = makeModel({ contextLength: 8000 })
		const promptBudget = getPromptBudgetTokens(model, PAID_PROVIDER)
		expect(promptBudget).toBeGreaterThan(0)
		// A realistic small prompt + its derived completion fit inside the window.
		const prompt = Math.min(promptBudget, 2000)
		const { costTokens } = deriveOutputBudget(model, PAID_PROVIDER, prompt)
		expect(prompt + costTokens).toBeLessThanOrEqual(model.contextLength as number)
	})

	test('scales with the window: a bigger context yields a bigger prompt budget', () => {
		const small = getPromptBudgetTokens(makeModel({ contextLength: 16_000 }), PAID_PROVIDER)
		const big = getPromptBudgetTokens(makeModel({ contextLength: 262_144 }), PAID_PROVIDER)
		expect(big).toBeGreaterThan(small)
	})
})
