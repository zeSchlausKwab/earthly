/**
 * Chat Store - Zustand store for Routstr AI chat
 */
import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
	ChatMessage,
	ChatMessageContent,
	ChatTextContentPart,
	RoutstrModel,
	ToolCall,
	ProviderType,
	ProviderConfig,
} from './routstr'
import type { EntityType } from '@/components/entity-search'
import {
	fetchModels,
	streamChatCompletion,
	estimateTokens,
	estimateMaxCost,
	BUILTIN_PROVIDERS,
} from './routstr'
import {
	createMapContextSystemMessage,
	buildSessionPublishContextMessage,
	getGeoTools,
	executeToolCall,
	consumeMapSnapshot,
	getMapContextSnapshotForTarget,
	compactToolMessageContentForPrompt,
	type PromptProfile,
} from './tools'
import type { ToolExecutionRunIdentity, ToolExecutionTarget } from './tools/types'
import { prepareToolExecutionRun, releaseToolExecutionRun } from './tools/executionTarget'
import { isToolError, type ToolError } from './tools/errors'
import { appendRequestContextToLatestUserMessage } from './requestContext'
import { ToolLoopRecovery } from './toolLoopRecovery'
import { getTokenMetadata } from '@cashu/cashu-ts'
import {
	getWalletSnapshot,
	receiveCashuToken,
	resolveWalletPaymentMint,
	sendCashuToken,
} from '@/lib/wallet'
import { detectVisionSupport } from './vision/detectVisionSupport'
import { sanitizeDanglingToolCalls, syntheticCancelledToolResult } from './toolCallIntegrity'
import { gateToolsForVision } from './vision/gateToolsForVision'
import { setSafetyLevelProvider } from './safeEditing/safetyAccess'
import {
	cancelPendingDiffs,
	getAllPendingDiffs,
	setPendingDiffRunContext,
	setPendingDiffToolContext,
	subscribePendingDiffs,
} from './safeEditing/pendingDiffStore'
import { toast } from 'sonner'
import {
	useEditorStore,
	type GeoCollectionEditDraft,
	type GeoEditorWorkspace,
} from '@/features/geo-editor/store'
import { eventStore } from '@/lib/nostr'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import {
	cancelPendingReferencePublishes,
	getReferencePublishRequest,
	setReferencePublishingChatContext,
	setReferencePublishingRunTarget,
	setReferencePublishingToolContext,
	subscribeReferencePublishRequest,
} from '@/features/chat/referencePublishing'
import {
	cancelPendingStoryTargetRequests,
	getStoryTargetRequest,
	subscribeStoryTargetRequest,
} from '@/features/chat/storyTargeting'
import { chatComposerActions } from './composerState'

// Output is NOT artificially capped. We size the completion budget from the
// room left in the context window (see deriveOutputBudget). The constants below
// are floors/margins, never a fixed truncation cap.
//
// MIN_OUTPUT_BUDGET_TOKENS: a floor so every request — especially a tool call —
//   always has room to emit something, even when the prompt is large.
// OUTPUT_BUDGET_SAFETY_TOKENS: kept clear of the context window so prompt +
//   completion never collides with the model's hard limit.
const MIN_OUTPUT_BUDGET_TOKENS = 1024
const OUTPUT_BUDGET_SAFETY_TOKENS = 512
const CONTEXT_SAFETY_TOKENS = 256
const LMSTUDIO_CONTEXT_SAFETY_TOKENS = 1536
const MIN_PROMPT_BUDGET_TOKENS = 512
// Fraction of the context window reserved for completion when trimming the
// prompt. The prompt still gets the lion's share; this only guarantees the
// completion is never starved down to a fixed sliver (old behavior reserved a
// fixed `maxTokens` slice regardless of window size).
const COMPLETION_RESERVE_FRACTION = 0.25
// Cost-estimation fallback when the context window is unknown for a paid model.
// Mirrors routstr.estimateMaxCost's own default so prepay/refund stay consistent.
const PAID_OUTPUT_BUDGET_FALLBACK_TOKENS = 4096
const DEFAULT_LMSTUDIO_CONTEXT_TOKENS = 4096
const DEFAULT_OLLAMA_CONTEXT_TOKENS = 8192
const DEFAULT_GENERIC_CONTEXT_TOKENS = 16384
const LMSTUDIO_HARD_CONTEXT_CAP_TOKENS = 4096
const MAX_USER_MESSAGE_CHARS = 6000
const MAX_ASSISTANT_MESSAGE_CHARS = 8000
const MAX_TOOL_MESSAGE_CHARS = 12000
// The map policy is intentionally substantial. Whole-request token budgeting
// below is the authoritative context limit; this per-message ceiling only
// prevents pathological inputs and must not silently discard normal policy.
const MAX_SYSTEM_MESSAGE_CHARS = 64_000
const MAX_REASONING_CONTENT_CHARS = 4000
const BUDGET_ESTIMATE_CHARS_PER_TOKEN = 2
const MESSAGE_TOKEN_OVERHEAD = 24
// Provider image tokenization varies by model and detail level. This is a
// deliberately conservative accounting unit for one normalized screenshot or
// attachment; the base64 character count is transport encoding, not text.
const IMAGE_INPUT_TOKEN_ESTIMATE = 2048
const MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE = 16000
const STREAM_STALL_WARNING_MS = 30000
// Reasoning-heavy providers can legitimately remain silent for several minutes
// before emitting their first visible delta. Keep the warning early, but avoid
// aborting work that is still progressing provider-side.
export const STREAM_STALL_TIMEOUT_MS = 240000
const STREAM_STALL_WARNING_SECONDS = STREAM_STALL_WARNING_MS / 1000
const STREAM_STALL_TIMEOUT_SECONDS = STREAM_STALL_TIMEOUT_MS / 1000
const OVERLOAD_RETRY_DELAYS_MS = [1500, 4000]
const FINISH_APPLIED_CHANGES_INSTRUCTION = [
	'One or more requested map changes in the preceding tool results were already applied successfully.',
	'Do not call tools or repeat any map work.',
	'Give the user a concise final response summarizing what completed and anything that did not complete according to the transcript.',
].join(' ')

/**
 * Models receive every currently registered background-safe tool. Interactive
 * `editor_*` commands depend on the visible toolbar/editor and are rejected by
 * executeToolCall when a chat run identity is present, so advertising them only
 * creates guaranteed-failure rounds. Vision-only tools retain their capability
 * gate as well.
 */
export function getAdvertisedGeoTools(canUseVision: boolean) {
	return gateToolsForVision(
		getGeoTools().filter((tool) => !tool.function.name.startsWith('editor_')),
		canUseVision,
	)
}

type StreamProgressKind =
	| 'request_start'
	| 'token'
	| 'reasoning'
	| 'tool_calls'
	| 'tool_result'
	| 'round_complete'
	| 'complete'
	| 'error'

type StreamPhase =
	| 'idle'
	| 'requesting'
	| 'streaming'
	| 'executing_tools'
	| 'recovering_context'
	| 'finalizing'

export interface ChatDiagnostics {
	provider: ProviderType | null
	modelId: string | null
	modelReportedContextTokens: number | null
	effectiveContextTokens: number | null
	promptBudgetTokens: number | null
	mapContextTokens: number | null
	estimatedPromptTokens: number | null
	estimatedCompletionTokens: number | null
	finishReason: string | null
	requestMessageCount: number
	modelRequestCount: number
	cumulativeEstimatedPromptTokens: number
	cumulativeEstimatedCompletionTokens: number
	toolCallCount: number
	mapChangingToolResultCount: number
	toolResultBytes: number
	totalToolDurationMs: number
	toolStats: Record<
		string,
		{ calls: number; durationMs: number; resultBytes: number; errors: number }
	>
	round: number
	startedAt: number | null
	completedAt: number | null
	promptProfile: PromptProfile
	advertisedToolCount: number
	advertisedToolSchemaChars: number
	systemPromptChars: number
}

export type ChatRunStatus =
	| 'idle'
	| 'working'
	| 'awaiting_approval'
	| 'completed'
	| 'error'
	| 'stopped'

export type ChatErrorRecovery = 'retry_turn' | 'finish_response'

export function resolveChatErrorRecovery(
	mapChangingToolResultCount: number,
	continuingAfterAppliedChanges = false,
): ChatErrorRecovery {
	return continuingAfterAppliedChanges || mapChangingToolResultCount > 0
		? 'finish_response'
		: 'retry_turn'
}

const EMPTY_CHAT_DIAGNOSTICS: ChatDiagnostics = {
	provider: null,
	modelId: null,
	modelReportedContextTokens: null,
	effectiveContextTokens: null,
	promptBudgetTokens: null,
	mapContextTokens: null,
	estimatedPromptTokens: null,
	estimatedCompletionTokens: null,
	finishReason: null,
	requestMessageCount: 0,
	modelRequestCount: 0,
	cumulativeEstimatedPromptTokens: 0,
	cumulativeEstimatedCompletionTokens: 0,
	toolCallCount: 0,
	mapChangingToolResultCount: 0,
	toolResultBytes: 0,
	totalToolDurationMs: 0,
	toolStats: {},
	round: 0,
	startedAt: null,
	completedAt: null,
	promptProfile: 'legacy',
	advertisedToolCount: 0,
	advertisedToolSchemaChars: 0,
	systemPromptChars: 0,
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length
}

function serializedToolResultIsError(content: string): boolean {
	try {
		const value = JSON.parse(content) as Record<string, unknown>
		return isToolError(value) || value.ok === false
	} catch {
		return false
	}
}

const TERMINAL_DATASET_TARGET_ERROR_CODES = new Set([
	'dataset_target_required',
	'dataset_target_unavailable',
	'dataset_target_conflict',
])

/** Target failures need explicit user action; another model round only burns
 * context while retrying the same immutable run identity. */
export function terminalDatasetTargetError(content: string): ToolError | null {
	try {
		const value = JSON.parse(content)
		return isToolError(value) &&
			typeof value.code === 'string' &&
			TERMINAL_DATASET_TARGET_ERROR_CODES.has(value.code)
			? value
			: null
	} catch {
		return null
	}
}

function serializedToolResultChangedMap(content: string, toolName?: string): boolean {
	try {
		const value = JSON.parse(content) as Record<string, unknown>
		// Dataset metadata is a real persisted edit, but its compact result predates
		// the shared mutation-count envelope used by geometry/callout tools.
		if (toolName === 'set_dataset_metadata' && value.ok === true) return true
		const editorImport = value.editorImport as Record<string, unknown> | undefined
		if (typeof editorImport?.importedCount === 'number' && editorImport.importedCount > 0)
			return true
		if (typeof value.importedCount === 'number' && value.importedCount > 0) return true
		const counts = value.counts as Record<string, unknown> | undefined
		if (
			counts &&
			['created', 'updated', 'deleted'].some(
				(key) => typeof counts[key] === 'number' && (counts[key] as number) > 0,
			)
		) {
			return true
		}
		const data = value.data as Record<string, unknown> | undefined
		return Boolean(
			data &&
				['createdCount', 'updatedCount', 'deletedCount'].some(
					(key) => typeof data[key] === 'number' && (data[key] as number) > 0,
				),
		)
	} catch {
		return false
	}
}

const DEFAULT_CHAT_TITLE = 'New conversation'
const MAX_CHAT_TITLE_CHARS = 60

export interface ChatSession {
	id: string
	title: string
	messages: ChatMessage[]
	references: ChatReference[]
	/** Explicit authoring target. Multiple conversations may point at one workspace. */
	targetWorkspaceId: string | null
	createdAt: number
	updatedAt: number
}

export interface ChatReference {
	id: string
	name: string
	type: EntityType
	subtitle?: string
	/** Bare `naddr1…` address of the referenced entity (or its parent dataset for features). */
	address?: string
	/** For `feature` references: the feature id inside the parent dataset. */
	featureId?: string
	pubkey?: string
	createdAt?: number
}

export interface SendMessageOptions {
	referenceContextMessage?: string
	selectionContextMessage?: string
	geometryContextMessage?: string
	geometryAttachment?: FeatureCollection | null
	/**
	 * The D-11 composed outbound content (ChatPanel `composeOutboundContent`):
	 * attached datasets as `{ ingestHandle, ingestSummary }` text parts + gated
	 * `image_url` parts. When present it OVERRIDES the plain-string `content` as
	 * the user message — carrying the handle+summary, never `fullRows`.
	 */
	composedContent?: ChatMessageContent
	/** Retry an immediately-failed user turn without appending duplicate text. */
	reuseLastUserMessage?: boolean
	/**
	 * Resume only the missing final narration after a run already applied map
	 * changes. This is an internal recovery mode: no user message is appended and
	 * no tools are advertised, so applied work cannot be replayed accidentally.
	 */
	continueAfterAppliedChanges?: boolean
}

/** Per-conversation runtime. It is intentionally memory-only (never persisted). */
export interface ChatRunState {
	identity: ToolExecutionRunIdentity | null
	status: ChatRunStatus
	streamingContent: string
	streamingReasoningContent: string
	pendingToolCalls: ToolCall[]
	executingTools: boolean
	streamPhase: StreamPhase
	streamWarning: string | null
	lastProgressAt: number | null
	lastProgressKind: StreamProgressKind | null
	error: string | null
	errorRecovery: ChatErrorRecovery | null
	diagnostics: ChatDiagnostics
	lastTurnRequest: { content: string; options?: SendMessageOptions } | null
	totalSpent: number
	totalRefunded: number
}

export interface ProviderOverride {
	baseUrl: string
	apiKey: string
}

export interface ProviderOverrideMap {
	lmstudio: ProviderOverride
	ollama: ProviderOverride
	custom: ProviderOverride
}

export interface ChatSettingsSnapshot {
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	selectedModel: string | null
	toolsEnabled: boolean
	// Edit-safety level (SAFE-04 / D-09 / D-12): 1 = preview + confirm all, 2 = confirm
	// destructive only (default), 3 = trust + undo (the D-12 "just accept" toggle sets 3).
	// Rides the same encrypt-to-self envelope as the rest of the snapshot; never a bespoke key.
	safetyLevel: 1 | 2 | 3
	promptProfile: PromptProfile
	version?: 2
}

/**
 * Observable lifecycle of the encrypted-settings load (D-11/D-12). Promoted from the sync
 * hook's internal refs so the settings UI can render loading / failed(+Retry) / loaded /
 * no-signer states distinctly instead of silently masquerading a decrypt failure as defaults.
 */
export type SettingsStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'no-signer'

export const DEFAULT_CHAT_SETTINGS: ChatSettingsSnapshot = {
	provider: 'routstr',
	providerOverrides: {
		lmstudio: { baseUrl: '', apiKey: '' },
		ollama: { baseUrl: '', apiKey: '' },
		custom: { baseUrl: '', apiKey: '' },
	},
	selectedModel: null,
	toolsEnabled: true,
	safetyLevel: 2,
	promptProfile: 'legacy',
	version: 2,
}

function createChatId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID()
	}
	return `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function trimChatTitle(title: string): string {
	if (title.length <= MAX_CHAT_TITLE_CHARS) return title
	return `${title.slice(0, MAX_CHAT_TITLE_CHARS)}...`
}

function buildChatTitle(messages: ChatMessage[]): string {
	const firstUserMessage = messages.find((message) => message.role === 'user')
	if (!firstUserMessage) return DEFAULT_CHAT_TITLE
	const content = messageContentToText(firstUserMessage.content)
	const normalized = content.replace(/\s+/g, ' ').trim()
	if (!normalized) return DEFAULT_CHAT_TITLE
	return trimChatTitle(normalized)
}

function createEmptyChatSession(): ChatSession {
	const now = Date.now()
	return {
		id: createChatId(),
		title: DEFAULT_CHAT_TITLE,
		messages: [],
		references: [],
		targetWorkspaceId: null,
		createdAt: now,
		updatedAt: now,
	}
}

function cloneEmptyDiagnostics(): ChatDiagnostics {
	return { ...EMPTY_CHAT_DIAGNOSTICS, toolStats: {} }
}

function createEmptyChatRunState(): ChatRunState {
	return {
		identity: null,
		status: 'idle',
		streamingContent: '',
		streamingReasoningContent: '',
		pendingToolCalls: [],
		executingTools: false,
		streamPhase: 'idle',
		streamWarning: null,
		lastProgressAt: null,
		lastProgressKind: null,
		error: null,
		errorRecovery: null,
		diagnostics: cloneEmptyDiagnostics(),
		lastTurnRequest: null,
		totalSpent: 0,
		totalRefunded: 0,
	}
}

function emptyToolExecutionTarget(): ToolExecutionTarget {
	return Object.freeze({
		entityType: null,
		draftId: null,
		entityId: null,
		sourceId: null,
		baseRevisionId: null,
		draftUpdatedAt: null,
		wasDirty: false,
		workspaceId: null,
	})
}

function datasetKeyParts(datasetKey: string | null): { pubkey: string; identifier: string } | null {
	if (!datasetKey) return null
	const separator = datasetKey.indexOf(':')
	if (separator <= 0 || separator === datasetKey.length - 1) return null
	return {
		pubkey: datasetKey.slice(0, separator),
		identifier: datasetKey.slice(separator + 1),
	}
}

function activeDatasetKey(editorState: ReturnType<typeof useEditorStore.getState>): string | null {
	const dataset = editorState.activeDataset
	return dataset?.dTag ? `${dataset.pubkey}:${dataset.dTag}` : null
}

function resolveWorkspaceBaseRevisionId(
	workspace: GeoEditorWorkspace,
	editorState: ReturnType<typeof useEditorStore.getState>,
): string | null {
	if (workspace.baseRevisionId) return workspace.baseRevisionId

	let resolved: string | null = null
	if (
		editorState.activeWorkspaceId === workspace.id &&
		workspace.datasetKey !== null &&
		activeDatasetKey(editorState) === workspace.datasetKey
	) {
		resolved = editorState.activeDataset?.event.id ?? null
	}

	if (!resolved) {
		const parts = datasetKeyParts(workspace.datasetKey)
		if (parts) {
			resolved =
				eventStore.getReplaceable(GEO_EVENT_KIND, parts.pubkey, parts.identifier)?.id ?? null
		}
	}
	if (resolved) {
		// One-time migration/backfill for legacy retained workspaces. Subsequent
		// remote replaceable updates cannot silently change the draft's base.
		editorState.updateWorkspace(workspace.id, { baseRevisionId: resolved })
	}
	return resolved
}

export function resolveChatTargetWorkspace(
	chatId: string | null,
	chatSessions: readonly ChatSession[],
	workspaces: Record<string, GeoEditorWorkspace>,
): GeoEditorWorkspace | null {
	if (!chatId) return null
	const session = chatSessions.find((chat) => chat.id === chatId)
	if (!session?.targetWorkspaceId) return null
	return workspaces[session.targetWorkspaceId] ?? null
}

/**
 * Resolve the exact writable draft owned by a workspace.
 *
 * The Chat header and Send-time capture must use the same identity rule. A
 * stale `activeDraftId` is not enough: the draft must still belong to the
 * workspace source. Returning null fails closed instead of showing a target
 * that the tool runtime will later reject.
 */
export function resolveWorkspaceTargetDraft(
	workspace: GeoEditorWorkspace | null,
	drafts: Record<string, GeoCollectionEditDraft>,
): GeoCollectionEditDraft | null {
	if (!workspace?.activeDraftId) return null
	const draft = drafts[workspace.activeDraftId]
	if (!draft || draft.sourceId !== workspace.sourceId) return null
	return draft
}

function captureDatasetTarget(
	workspace: GeoEditorWorkspace | null,
	editorState: ReturnType<typeof useEditorStore.getState>,
): ToolExecutionTarget {
	if (!workspace) return emptyToolExecutionTarget()
	const draft = resolveWorkspaceTargetDraft(workspace, editorState.geoEditDrafts)
	if (!draft) return emptyToolExecutionTarget()
	const baseRevisionId = resolveWorkspaceBaseRevisionId(workspace, editorState)
	const entityId = workspace.datasetKey ?? null
	return Object.freeze({
		entityType: 'dataset' as const,
		draftId: draft.id,
		entityId,
		sourceId: draft.sourceId,
		baseRevisionId,
		draftUpdatedAt: draft.updatedAt,
		wasDirty: Boolean(editorState.activeWorkspaceId === workspace.id ? editorState.isDirty : true),
		workspaceId: workspace.id,
	})
}

export function captureVisibleDatasetReferenceTarget(): ToolExecutionTarget {
	const editorState = useEditorStore.getState()
	const workspace = editorState.activeWorkspaceId
		? (editorState.workspaces[editorState.activeWorkspaceId] ?? null)
		: null
	return captureDatasetTarget(workspace, editorState)
}

export function captureActiveToolExecutionTarget(chatId: string | null): ToolExecutionTarget {
	const editorState = useEditorStore.getState()
	const chatState = useChatStore.getState()
	const workspace = resolveChatTargetWorkspace(
		chatId,
		chatState.chatSessions,
		editorState.workspaces,
	)
	return captureDatasetTarget(workspace, editorState)
}

export function applyMessagesToChat(
	chatSessions: ChatSession[],
	chatId: string | null,
	messages: ChatMessage[],
): ChatSession[] {
	const nextSessions = chatSessions.map((chat) => {
		if (chat.id !== chatId) return chat
		return {
			...chat,
			messages,
			references: chat.references ?? [],
			title: buildChatTitle(messages),
			updatedAt: Date.now(),
		}
	})
	if (nextSessions.some((chat) => chat.id === chatId)) return nextSessions

	const fallback = createEmptyChatSession()
	return [
		...nextSessions,
		{
			...fallback,
			id: chatId ?? fallback.id,
			messages,
			title: buildChatTitle(messages),
			references: [],
		},
	]
}

const applyMessagesToActiveChat = applyMessagesToChat

function hasChatSession(chatSessions: ChatSession[], chatId: string | null): boolean {
	if (!chatId) return false
	return chatSessions.some((chat) => chat.id === chatId)
}

function applyReferencesToActiveChat(
	chatSessions: ChatSession[],
	activeChatId: string | null,
	references: ChatReference[],
): ChatSession[] {
	const nextSessions = chatSessions.map((chat) => {
		if (chat.id !== activeChatId) return chat
		return {
			...chat,
			references,
			updatedAt: Date.now(),
		}
	})
	if (nextSessions.some((chat) => chat.id === activeChatId)) return nextSessions

	const fallback = createEmptyChatSession()
	return [
		...nextSessions,
		{
			...fallback,
			id: activeChatId ?? fallback.id,
			references,
		},
	]
}

function sortChatSessionsByRecent(chatSessions: ChatSession[]): ChatSession[] {
	return [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt)
}

function messageContentToText(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content
	if (!content) return ''

	return content
		.map((part) => {
			if (part.type === 'text') return part.text
			if (part.type === 'image_url') return '[image]'
			return ''
		})
		.join(' ')
}

function messageReasoningToText(reasoningContent: ChatMessage['reasoning_content']): string {
	return typeof reasoningContent === 'string' ? reasoningContent : ''
}

function truncateTextForPrompt(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text
	return `${text.slice(0, maxChars)}\n...[truncated for context window]`
}

/**
 * WR-08: a composed user message carries an attached dataset as a JSON text part
 * `{"ingestHandle":...,"ingestSummary":{...}}` (composeOutboundContent). Blindly
 * char-truncating that part to MAX_USER_MESSAGE_CHARS can cut the JSON mid-string
 * → invalid JSON → the model loses `ingestHandle` and can't call
 * `place_dataset_features`. Instead, if a text part IS the ingest-handle JSON and
 * is over budget, shrink it FIELD-WISE (drop the bulky `sampleRows`, then the
 * schema tail) so the result stays parseable JSON with `ingestHandle` ALWAYS
 * intact. Returns the (possibly shrunk) JSON string, or `undefined` if the part
 * is not an ingest-handle part (caller falls back to plain char-truncation).
 */
export function compactIngestHandlePartForPrompt(
	text: string,
	maxChars: number,
): string | undefined {
	if (text.length <= maxChars) {
		// Only claim this part if it actually IS the ingest-handle shape; otherwise
		// let the caller treat it as a normal text part.
		return isIngestHandleJson(text) ? text : undefined
	}

	let parsed: { ingestHandle?: unknown; ingestSummary?: Record<string, unknown> }
	try {
		parsed = JSON.parse(text)
	} catch {
		return undefined
	}
	if (typeof parsed.ingestHandle !== 'string' || !parsed.ingestSummary) {
		return undefined
	}

	const summary = { ...parsed.ingestSummary }
	// 1. Drop the bulkiest field first: the row sample.
	if ('sampleRows' in summary) {
		summary.sampleRows = []
		summary.sampleRowsOmittedForPrompt = true
	}
	let candidate = JSON.stringify({ ingestHandle: parsed.ingestHandle, ingestSummary: summary })

	// 2. Still too big (very wide schema)? Trim the schema from the tail until it
	//    fits, recording how many columns were dropped.
	if (candidate.length > maxChars && Array.isArray(summary.schema)) {
		const schema = summary.schema as unknown[]
		let kept = schema.length
		while (kept > 0 && candidate.length > maxChars) {
			kept -= 1
			summary.schema = schema.slice(0, kept)
			summary.schemaTruncatedForPrompt = schema.length - kept
			candidate = JSON.stringify({
				ingestHandle: parsed.ingestHandle,
				ingestSummary: summary,
			})
		}
	}

	// 3. Floor: a minimal handle-only object is tiny and ALWAYS parseable, so the
	//    handle is never lost even if maxChars is pathologically small.
	if (candidate.length > maxChars) {
		candidate = JSON.stringify({
			ingestHandle: parsed.ingestHandle,
			ingestSummary: {
				handleId: summary.handleId,
				fileName: summary.fileName,
				type: summary.type,
				rowCount: summary.rowCount,
				columnCount: summary.columnCount,
				truncatedForPrompt: true,
			},
		})
	}

	return candidate
}

function isIngestHandleJson(text: string): boolean {
	// Cheap prefix gate before a full parse.
	if (!text.startsWith('{') || !text.includes('"ingestHandle"')) return false
	try {
		const parsed = JSON.parse(text) as { ingestHandle?: unknown; ingestSummary?: unknown }
		return typeof parsed.ingestHandle === 'string' && !!parsed.ingestSummary
	} catch {
		return false
	}
}

/**
 * Describe a terminal model turn that produced NO content and NO tool calls.
 *
 * Without this the agent loop would end the turn silently (set idle, append no
 * message, surface nothing) — the user sees the spinner stop with no outcome.
 * Output is no longer artificially capped (the budget is derived from the
 * context window), so `finishReason: 'length'` now means the model genuinely
 * exhausted the context-derived output room — e.g. a reasoning-heavy endpoint on
 * a small window — or the model returned a genuinely empty completion. We turn
 * that into a visible notice routed through the same `error` surface ChatPanel
 * already renders for failures.
 *
 * Returns the user-facing copy plus a `truncated` flag (true only for the
 * token-limit case) so callers / tests can distinguish the two outcomes.
 */
export function describeEmptyCompletion(finishReason: string | null | undefined): {
	message: string
	truncated: boolean
} {
	if (finishReason === 'length') {
		return {
			message:
				'The response was cut off — the model ran out of room in its context ' +
				'window. Shorten the prompt/context (or use a model with a larger ' +
				'context window) and retry.',
			truncated: true,
		}
	}
	const reasonLabel = finishReason ?? 'none'
	return {
		message: `The model returned an empty response (finish reason: ${reasonLabel}).`,
		truncated: false,
	}
}

/**
 * Suffix appended to a non-empty assistant message when the model still hit its
 * output-token limit (`finishReason: 'length'`), so truncation stays visible even
 * when partial content was produced.
 */
export const TRUNCATION_CONTENT_SUFFIX = '\n\n_(response truncated — hit output-token limit)_'

function getMessageCharLimit(role: ChatMessage['role']): number {
	switch (role) {
		case 'tool':
			return MAX_TOOL_MESSAGE_CHARS
		case 'assistant':
			return MAX_ASSISTANT_MESSAGE_CHARS
		case 'system':
			return MAX_SYSTEM_MESSAGE_CHARS
		default:
			return MAX_USER_MESSAGE_CHARS
	}
}

export function sanitizeMessageForPrompt(message: ChatMessage): ChatMessage {
	const maxChars = getMessageCharLimit(message.role)
	const { content } = message
	const reasoning_content =
		typeof message.reasoning_content === 'string'
			? truncateTextForPrompt(message.reasoning_content, MAX_REASONING_CONTENT_CHARS)
			: message.reasoning_content

	if (typeof content === 'string') {
		const normalizedContent =
			message.role === 'tool' ? compactToolMessageContentForPrompt(content) : content
		return {
			...message,
			content: truncateTextForPrompt(normalizedContent, maxChars),
			reasoning_content,
		}
	}

	if (!content) {
		return {
			...message,
			reasoning_content,
		}
	}

	let remainingChars = maxChars
	const sanitizedParts = content
		.map((part) => {
			if (part.type !== 'text') return part
			if (remainingChars <= 0) {
				return null
			}

			// WR-08: never char-truncate the ingest-handle JSON part (it would cut
			// the JSON mid-string and lose `ingestHandle`). Shrink it field-wise so
			// it stays parseable with the handle intact.
			const ingestCompacted = compactIngestHandlePartForPrompt(part.text, remainingChars)
			if (ingestCompacted !== undefined) {
				remainingChars -= ingestCompacted.length
				return { ...part, text: ingestCompacted }
			}

			const truncated = truncateTextForPrompt(part.text, remainingChars)
			remainingChars -= truncated.length
			return { ...part, text: truncated }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: sanitizedParts.length > 0 ? sanitizedParts : '',
		reasoning_content,
	}
}

function estimateMessageTokensForBudget(message: ChatMessage): number {
	const contentText = messageContentToText(message.content)
	const imageCount = Array.isArray(message.content)
		? message.content.filter((part) => part.type === 'image_url').length
		: 0
	const reasoningText = messageReasoningToText(message.reasoning_content)
	const toolCallsText = message.tool_calls ? JSON.stringify(message.tool_calls) : ''
	const combined = `${contentText}${reasoningText}${toolCallsText}`
	return (
		Math.ceil(combined.length / BUDGET_ESTIMATE_CHARS_PER_TOKEN) +
		imageCount * IMAGE_INPUT_TOKEN_ESTIMATE +
		MESSAGE_TOKEN_OVERHEAD
	)
}

function estimateMessagesTokensForBudget(messages: ChatMessage[]): number {
	return messages.reduce((total, message) => total + estimateMessageTokensForBudget(message), 0)
}

function truncateMessageToTokenBudget(message: ChatMessage, budgetTokens: number): ChatMessage {
	const maxChars = Math.max(128, budgetTokens * BUDGET_ESTIMATE_CHARS_PER_TOKEN)
	const { content } = message
	const reasoning_content =
		typeof message.reasoning_content === 'string'
			? truncateTextForPrompt(message.reasoning_content, maxChars)
			: message.reasoning_content

	if (typeof content === 'string') {
		const normalizedContent =
			message.role === 'tool' ? compactToolMessageContentForPrompt(content) : content
		return {
			...message,
			content: truncateTextForPrompt(normalizedContent, maxChars),
			reasoning_content,
		}
	}

	if (!content) {
		return {
			...message,
			content: '[content omitted for context window]',
			reasoning_content,
		}
	}

	const imageCount = content.filter((part) => part.type === 'image_url').length
	const maxImages = Math.max(
		0,
		Math.floor((budgetTokens - MESSAGE_TOKEN_OVERHEAD) / IMAGE_INPUT_TOKEN_ESTIMATE),
	)
	const keptImageCount = Math.min(imageCount, maxImages)
	let remainingImages = keptImageCount
	let remainingChars = Math.max(
		128,
		(budgetTokens - keptImageCount * IMAGE_INPUT_TOKEN_ESTIMATE - MESSAGE_TOKEN_OVERHEAD) *
			BUDGET_ESTIMATE_CHARS_PER_TOKEN,
	)
	const truncatedParts = content
		.map((part) => {
			if (part.type === 'text') {
				if (remainingChars <= 0) return null
				const truncated = truncateTextForPrompt(part.text, remainingChars)
				remainingChars -= truncated.length
				return { ...part, text: truncated }
			}

			if (remainingImages > 0) {
				remainingImages -= 1
				return part
			}

			const placeholder = '[image omitted for context window]'
			if (placeholder.length > remainingChars) return null
			remainingChars -= placeholder.length
			return { type: 'text' as const, text: placeholder }
		})
		.filter((part): part is NonNullable<typeof part> => part !== null)

	return {
		...message,
		content: truncatedParts.length > 0 ? truncatedParts : '[content omitted for context window]',
		reasoning_content,
	}
}

function getEffectiveContextTokens(model: RoutstrModel, provider: ProviderConfig): number {
	if (provider.type === 'lmstudio') {
		// LM Studio often reports the model's theoretical max context while the runtime
		// slot may be smaller (commonly 4096). Use a hard cap for safe prompt trimming.
		const reported =
			typeof model.contextLength === 'number' && model.contextLength > 0
				? model.contextLength
				: DEFAULT_LMSTUDIO_CONTEXT_TOKENS
		return Math.min(reported, LMSTUDIO_HARD_CONTEXT_CAP_TOKENS)
	}

	if (typeof model.contextLength === 'number' && model.contextLength > 0) {
		return model.contextLength
	}

	switch (provider.type) {
		case 'ollama':
			return DEFAULT_OLLAMA_CONTEXT_TOKENS
		default:
			return DEFAULT_GENERIC_CONTEXT_TOKENS
	}
}

export function getPromptBudgetTokens(model: RoutstrModel, provider: ProviderConfig): number {
	const contextTokens = getEffectiveContextTokens(model, provider)
	// Reserve a proportional completion slice (not a fixed sliver) so a short
	// prompt does NOT eat the whole window and starve the output. The prompt
	// still gets the remainder, which on a large window is the vast majority.
	const completionReserve = Math.max(
		MIN_OUTPUT_BUDGET_TOKENS,
		Math.floor(contextTokens * COMPLETION_RESERVE_FRACTION),
	)
	const safetyTokens =
		provider.type === 'lmstudio' ? LMSTUDIO_CONTEXT_SAFETY_TOKENS : CONTEXT_SAFETY_TOKENS
	return Math.max(MIN_PROMPT_BUDGET_TOKENS, contextTokens - completionReserve - safetyTokens)
}

/**
 * Derive the output-token budget for a single request from the room left in the
 * context window AFTER the prompt — the model is no longer artificially capped.
 *
 * Returns both:
 *  - `maxTokens`: the value to send as `max_tokens`. `undefined` means OMIT the
 *    field entirely (free/local providers run to their natural stop within the
 *    context window — no truncation).
 *  - `costTokens`: the same budget expressed as a concrete number, used for paid
 *    prepay/refund cost estimation so prepayment NEVER underpays.
 *
 * The two values are derived from one number so cost estimation and the actual
 * request stay consistent for paid providers.
 */
export function deriveOutputBudget(
	model: RoutstrModel,
	provider: ProviderConfig,
	estimatedPromptTokens: number,
): { maxTokens: number | undefined; costTokens: number } {
	const contextTokens = getEffectiveContextTokens(model, provider)
	// Room left after the prompt, kept clear of the window's hard edge. Floored
	// so a tool call always has room even when the prompt is large.
	const remaining = contextTokens - estimatedPromptTokens - OUTPUT_BUDGET_SAFETY_TOKENS
	const derived =
		contextTokens > 0
			? Math.max(MIN_OUTPUT_BUDGET_TOKENS, remaining)
			: PAID_OUTPUT_BUDGET_FALLBACK_TOKENS
	const maxCompletionTokens =
		typeof model.maxCompletionTokens === 'number' &&
		Number.isFinite(model.maxCompletionTokens) &&
		model.maxCompletionTokens > 0
			? Math.floor(model.maxCompletionTokens)
			: undefined
	const capped = maxCompletionTokens ? Math.min(derived, maxCompletionTokens) : derived

	if (!provider.requiresPayment) {
		// Free/local (lmstudio, ollama, custom): omit max_tokens so the model is
		// not truncated. costTokens is unused for these (no payment) but reported
		// for diagnostics/consistency.
		return { maxTokens: undefined, costTokens: capped }
	}

	// Paid (routstr/cashu): send the derived budget so prepay reserves against it
	// and refunds the unused remainder. Clamp to upstream max-completion metadata
	// when present so large-context models don't receive impossible max_tokens.
	return { maxTokens: capped, costTokens: capped }
}

function trimMessagesToPromptBudget(messages: ChatMessage[], budgetTokens: number): ChatMessage[] {
	if (messages.length === 0) return messages
	const sanitized = messages.map(sanitizeMessageForPrompt)
	const selected: ChatMessage[] = []
	let usedTokens = 0

	for (let i = sanitized.length - 1; i >= 0; i--) {
		let candidate = sanitized[i]
		if (!candidate) continue
		let candidateTokens = estimateMessageTokensForBudget(candidate)

		if (usedTokens + candidateTokens > budgetTokens) {
			if (selected.length === 0) {
				candidate = truncateMessageToTokenBudget(candidate, budgetTokens)
				candidateTokens = estimateMessageTokensForBudget(candidate)
				if (candidateTokens > budgetTokens) {
					candidate = {
						...candidate,
						content: '[message truncated for context window]',
					}
				}
				selected.unshift(candidate)
			}
			break
		}

		usedTokens += candidateTokens
		selected.unshift(candidate)
	}

	while (selected.length > 1 && selected[0]?.role === 'tool') {
		selected.shift()
	}

	if (selected.length > 0) {
		return selected
	}

	const fallback = sanitized.at(-1)
	if (!fallback) return []
	return [truncateMessageToTokenBudget(fallback, budgetTokens)]
}

function providerMayRequireReasoningContent(provider: ProviderConfig, modelId: string): boolean {
	if (provider.type !== 'custom') return false
	const lowerModel = modelId.toLowerCase()
	const lowerBaseUrl = provider.baseUrl.toLowerCase()
	return lowerModel.includes('kimi') || lowerBaseUrl.includes('moonshot.ai')
}

function ensureReasoningContentForToolMessages(
	messages: ChatMessage[],
	required: boolean,
): ChatMessage[] {
	if (!required) return messages
	return messages.map((message) => {
		if (message.role !== 'assistant' || !message.tool_calls?.length) {
			return message
		}
		return {
			...message,
			reasoning_content:
				typeof message.reasoning_content === 'string' ? message.reasoning_content : '',
		}
	})
}

function tryExtractSnapshotId(toolResultContent: string): string | null {
	try {
		const parsed = JSON.parse(toolResultContent) as Record<string, unknown>
		return typeof parsed.snapshotId === 'string' ? parsed.snapshotId : null
	} catch {
		return null
	}
}

function isContextOverflowError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	return (
		lower.includes('exceeds the available context size') ||
		lower.includes('cannot truncate prompt with n_keep') ||
		lower.includes('n_ctx')
	)
}

function isTransientProviderOverloadError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	const lower = message.toLowerCase()
	return (
		lower.includes('currently overloaded') ||
		lower.includes('server is busy') ||
		lower.includes('rate limit') ||
		lower.includes('too many requests') ||
		lower.includes('503') ||
		lower.includes('429')
	)
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildEmergencyRetryMessages(conversationMessages: ChatMessage[]): ChatMessage[] {
	const sanitized = conversationMessages.map(sanitizeMessageForPrompt)
	const recentUserMessages = sanitized
		.filter((message) => message.role === 'user')
		.slice(-2)
		.map((message) => truncateMessageToTokenBudget(message, 220))
	const latestToolMessage = [...sanitized].reverse().find((message) => message.role === 'tool')

	const messages: ChatMessage[] = [
		{
			role: 'system',
			content: [
				'Context window recovery mode.',
				'Preserve user intent from recent turns.',
				'If user asks to draw/edit map features, call tools directly with sensible defaults instead of asking to restate.',
				'Keep output concise.',
			].join(' '),
		},
	]

	if (latestToolMessage) {
		messages.push({
			role: 'system',
			content: `Most recent tool output excerpt:\n${truncateTextForPrompt(
				messageContentToText(latestToolMessage.content),
				900,
			)}`,
		})
	}

	if (recentUserMessages.length === 0) {
		messages.push({ role: 'user', content: 'Continue with a concise response.' })
		return messages
	}

	messages.push(...recentUserMessages)
	return messages
}

function buildAppliedChangesContinuationMessages(
	conversationMessages: ChatMessage[],
): ChatMessage[] {
	const sanitized = conversationMessages.map(sanitizeMessageForPrompt)
	const latestUserMessage = [...sanitized].reverse().find((message) => message.role === 'user')
	const latestToolMessage = [...sanitized].reverse().find((message) => message.role === 'tool')
	const messages: ChatMessage[] = [{ role: 'system', content: FINISH_APPLIED_CHANGES_INSTRUCTION }]

	if (latestUserMessage) {
		messages.push(truncateMessageToTokenBudget(latestUserMessage, 300))
	}
	if (latestToolMessage) {
		messages.push({
			role: 'system',
			content: `Most recent applied tool output excerpt:\n${truncateTextForPrompt(
				messageContentToText(latestToolMessage.content),
				1200,
			)}`,
		})
	}

	return messages
}

export function resolveProvider(
	type: ProviderType,
	providerOverrides: ProviderOverrideMap,
): ProviderConfig {
	if (type === 'custom') {
		const override = providerOverrides.custom
		return {
			type: 'custom',
			baseUrl: override.baseUrl,
			apiKey: override.apiKey || undefined,
			name: 'Custom',
			requiresPayment: false,
		}
	}
	if (type === 'routstr') {
		return BUILTIN_PROVIDERS.routstr
	}
	// lmstudio / ollama: use override baseUrl when non-empty, else BUILTIN localhost default.
	// Guard against an unexpected `type` or a missing override map key (WR-03/WR-04): indexing
	// BUILTIN_PROVIDERS / providerOverrides with an unvalidated key can yield undefined, and the
	// subsequent spread/`.baseUrl` access would throw or produce a malformed ProviderConfig.
	const builtin = BUILTIN_PROVIDERS[type]
	if (!builtin) {
		// Unknown provider type slipped past validation — fall back to a known-good builtin
		// rather than crash downstream model loading.
		return BUILTIN_PROVIDERS.lmstudio
	}
	const override = providerOverrides[type]
	return {
		...builtin,
		baseUrl: override?.baseUrl || builtin.baseUrl,
		apiKey: override?.apiKey || undefined,
	}
}

interface ChatState {
	// Provider
	provider: ProviderType
	providerOverrides: ProviderOverrideMap
	// Sessions
	chatSessions: ChatSession[]
	activeChatId: string | null
	/** The one globally executing run; activeChatId remains presentation-only. */
	runningChatId: string | null
	activeRun: ToolExecutionRunIdentity | null
	chatRunStates: Record<string, ChatRunState>
	// Messages
	messages: ChatMessage[]
	// Models
	models: RoutstrModel[]
	selectedModel: string | null
	modelsLoading: boolean
	modelsError: string | null
	// Encrypted-settings load lifecycle (observable surface for the settings UI; D-11/D-12)
	settingsStatus: SettingsStatus
	settingsError: string | null
	settingsLoadNonce: number
	// Bumped by an explicit user-initiated import (D-09); clears the sync hook's
	// "load failed / not safe to save" guard so the recovery write is allowed (CR-01).
	settingsImportNonce: number
	// Settings
	toolsEnabled: boolean // Whether to send tools with requests
	safetyLevel: 1 | 2 | 3 // Edit-safety level (SAFE-04): 1 preview-all / 2 confirm-destructive (default) / 3 trust+undo
	promptProfile: PromptProfile
	// Chat state. `isStreaming` is a global execution lock, not an active-chat flag.
	isStreaming: boolean
	streamingContent: string
	streamingReasoningContent: string
	pendingToolCalls: ToolCall[] // Tool calls waiting to be executed
	executingTools: boolean // Whether we're currently executing tools
	streamPhase: StreamPhase
	streamWarning: string | null
	lastProgressAt: number | null
	lastProgressKind: StreamProgressKind | null
	error: string | null
	errorRecovery: ChatErrorRecovery | null
	diagnostics: ChatDiagnostics
	lastTurnRequest: { content: string; options?: SendMessageOptions } | null
	references: ChatReference[]
	// Stats
	totalSpent: number // Total sats spent in this session
	totalRefunded: number // Total sats refunded
}

interface ChatActions {
	// Provider
	setProvider: (provider: ProviderType) => void
	setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) => void
	// Model management
	loadModels: () => Promise<void>
	setSelectedModel: (modelId: string) => void
	// Settings
	setToolsEnabled: (enabled: boolean) => void
	setSafetyLevel: (level: 1 | 2 | 3) => void
	setPromptProfile: (profile: PromptProfile) => void
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => void
	setSettingsStatus: (status: SettingsStatus, error?: string | null) => void
	requestSettingsReload: () => void
	notifySettingsImported: () => void
	// Message management
	addMessage: (message: ChatMessage) => void
	clearMessages: () => void
	createChat: () => void
	switchChat: (chatId: string) => void
	deleteChat: (chatId: string) => void
	setChatTargetWorkspace: (chatId: string, workspaceId: string | null) => void
	setReferences: (references: ChatReference[]) => void
	addReferenceToChat: (chatId: string, reference: ChatReference) => void
	// Chat actions
	sendMessage: (content: string, options?: SendMessageOptions) => Promise<void>
	retryLastMessage: () => Promise<void>
	finishLastResponse: () => Promise<void>
	cancelStream: () => void
	// Reset
	reset: () => void
}

type ChatStore = ChatState & ChatActions

type ActiveChatRunView = Pick<
	ChatState,
	| 'streamingContent'
	| 'streamingReasoningContent'
	| 'pendingToolCalls'
	| 'executingTools'
	| 'streamPhase'
	| 'streamWarning'
	| 'lastProgressAt'
	| 'lastProgressKind'
	| 'error'
	| 'errorRecovery'
	| 'diagnostics'
	| 'lastTurnRequest'
	| 'totalSpent'
	| 'totalRefunded'
>

function chatRunStateToActiveView(runState: ChatRunState): ActiveChatRunView {
	return {
		streamingContent: runState.streamingContent,
		streamingReasoningContent: runState.streamingReasoningContent,
		pendingToolCalls: runState.pendingToolCalls,
		executingTools: runState.executingTools,
		streamPhase: runState.streamPhase,
		streamWarning: runState.streamWarning,
		lastProgressAt: runState.lastProgressAt,
		lastProgressKind: runState.lastProgressKind,
		error: runState.error,
		errorRecovery: runState.errorRecovery,
		diagnostics: runState.diagnostics,
		lastTurnRequest: runState.lastTurnRequest,
		totalSpent: runState.totalSpent,
		totalRefunded: runState.totalRefunded,
	}
}

function getChatRunState(state: ChatState, chatId: string | null): ChatRunState {
	if (!chatId) return createEmptyChatRunState()
	return state.chatRunStates[chatId] ?? createEmptyChatRunState()
}

export function buildChatRunStateUpdate(
	state: ChatState,
	chatId: string,
	updater: Partial<ChatRunState> | ((current: ChatRunState) => ChatRunState),
): Partial<ChatState> {
	const current = getChatRunState(state, chatId)
	const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }
	return {
		chatRunStates: { ...state.chatRunStates, [chatId]: next },
		...(state.activeChatId === chatId ? chatRunStateToActiveView(next) : {}),
	}
}

function createInitialState(): ChatState {
	const initialChat = createEmptyChatSession()
	return {
		...DEFAULT_CHAT_SETTINGS,
		chatSessions: [initialChat],
		activeChatId: initialChat.id,
		runningChatId: null,
		activeRun: null,
		chatRunStates: { [initialChat.id]: createEmptyChatRunState() },
		messages: [],
		models: [],
		selectedModel: null,
		modelsLoading: false,
		modelsError: null,
		settingsStatus: 'idle',
		settingsError: null,
		settingsLoadNonce: 0,
		settingsImportNonce: 0,
		toolsEnabled: true,
		isStreaming: false,
		streamingContent: '',
		streamingReasoningContent: '',
		pendingToolCalls: [],
		executingTools: false,
		streamPhase: 'idle',
		streamWarning: null,
		lastProgressAt: null,
		lastProgressKind: null,
		error: null,
		errorRecovery: null,
		diagnostics: EMPTY_CHAT_DIAGNOSTICS,
		lastTurnRequest: null,
		references: initialChat.references,
		totalSpent: 0,
		totalRefunded: 0,
	}
}

const initialState: ChatState = createInitialState()

/**
 * persist `partialize` allow-list. ONLY `chatSessions` + `activeChatId` may cross into the
 * `chat-store` localStorage blob — secret-bearing settings (`providerOverrides[*].apiKey`)
 * must NEVER persist here (SC-1 / T-01-01). Settings flow exclusively through the encrypted
 * envelope in `settingsStorage.ts`. Exported so unit tests can assert the serialized shape.
 */
// Persisted-history hygiene. The `chat-store` localStorage blob is rewritten on
// every set(). Without bounding it, base64 image parts (attached images, map
// snapshots) and large tool results (run_code output, GeoJSON/ingest dumps)
// accumulate across sessions and overflow the ~5MB localStorage quota — after
// which every subsequent write throws QuotaExceededError. We persist a slimmed
// copy of history: image data URLs are dropped (they are only needed for the
// live model round, not for restoring a readable transcript) and oversized text
// is truncated. The in-memory store still holds the full content for the session.
const PERSIST_MAX_TEXT_CHARS = 16_000
const PERSIST_MAX_REASONING_CHARS = 4_000
const PERSIST_OMITTED_IMAGE = '[image omitted from saved history]'

function truncateForPersist(text: string, max: number): string {
	if (text.length <= max) return text
	return `${text.slice(0, max)}\n…[${text.length - max} chars truncated from saved history]`
}

function sanitizeContentForPersist(content: ChatMessageContent | null): ChatMessageContent | null {
	if (content == null) return content
	if (typeof content === 'string') return truncateForPersist(content, PERSIST_MAX_TEXT_CHARS)
	return content.map<ChatTextContentPart>((part) =>
		part.type === 'image_url'
			? { type: 'text', text: PERSIST_OMITTED_IMAGE }
			: { type: 'text', text: truncateForPersist(part.text, PERSIST_MAX_TEXT_CHARS) },
	)
}

function sanitizeMessageForPersist(message: ChatMessage): ChatMessage {
	const next: ChatMessage = { ...message, content: sanitizeContentForPersist(message.content) }
	if (typeof next.reasoning_content === 'string') {
		next.reasoning_content = truncateForPersist(next.reasoning_content, PERSIST_MAX_REASONING_CHARS)
	}
	return next
}

function sanitizeSessionForPersist(session: ChatSession): ChatSession {
	return { ...session, messages: session.messages.map(sanitizeMessageForPersist) }
}

export function chatStorePartialize(
	state: ChatStore,
): Pick<ChatState, 'chatSessions' | 'activeChatId'> {
	return {
		chatSessions: state.chatSessions.map(sanitizeSessionForPersist),
		activeChatId: state.activeChatId,
	}
}

// A localStorage wrapper that never lets a persistence failure (quota overflow,
// storage disabled in private mode) bubble up as an unhandled promise rejection
// that breaks the chat UI. On quota overflow it drops the stale oversized blob
// and retries once — which self-heals an already-overflowed store on the next
// write now that partialize emits a slimmed payload.
const resilientChatStorage = {
	getItem: (name: string): string | null => {
		if (typeof window === 'undefined') return null
		try {
			return window.localStorage.getItem(name)
		} catch {
			return null
		}
	},
	setItem: (name: string, value: string): void => {
		if (typeof window === 'undefined') return
		try {
			window.localStorage.setItem(name, value)
		} catch {
			try {
				window.localStorage.removeItem(name)
				window.localStorage.setItem(name, value)
			} catch (err) {
				console.warn(
					'[chat-store] Skipped persisting chat history:',
					err instanceof Error ? err.message : err,
				)
			}
		}
	},
	removeItem: (name: string): void => {
		if (typeof window === 'undefined') return
		try {
			window.localStorage.removeItem(name)
		} catch {
			// ignore
		}
	},
}

// AbortController for canceling streams
let streamAbortController: AbortController | null = null
let currentStreamRunId = 0
let currentStreamingChatId: string | null = null
let modelsLoadGeneration = 0
const DETACHED_STREAM_ERROR = 'Chat stream was canceled or detached from its session.'

export const useChatStore = create<ChatStore>()(
	persist(
		(set, get) => ({
			...initialState,

			setProvider: (providerType: ProviderType) => {
				modelsLoadGeneration += 1
				set({ provider: providerType, models: [], selectedModel: null, modelsError: null })
				get().loadModels()
			},

			setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) => {
				if (type === 'routstr') return
				modelsLoadGeneration += 1
				set((state) => ({
					modelsLoading: false,
					modelsError: null,
					providerOverrides: {
						...state.providerOverrides,
						[type]: { ...state.providerOverrides[type], ...patch },
					},
				}))
			},

			loadModels: async () => {
				const generation = modelsLoadGeneration + 1
				modelsLoadGeneration = generation
				const { provider, providerOverrides } = get()
				const providerConfig = resolveProvider(provider, providerOverrides)

				if (provider === 'custom' && !providerOverrides.custom.baseUrl) {
					set({ modelsError: 'Enter an endpoint URL first' })
					return
				}

				set({ modelsLoading: true, modelsError: null })
				try {
					const models = await fetchModels(providerConfig)
					if (modelsLoadGeneration !== generation) return
					// An empty list must be recorded as an ERROR, not left as
					// `{ models: [], modelsError: null }`. The ChatPanel mount effect
					// re-runs loadModels whenever `models.length === 0 && !modelsLoading &&
					// !modelsError`; without setting an error here a provider that returns
					// zero models (e.g. a paid provider with no entitlements) drives an
					// infinite fetch+set loop that pegs the CPU and spams the persist write.
					if (models.length === 0) {
						set({
							models: [],
							modelsLoading: false,
							modelsError: 'No models available from this provider.',
						})
						return
					}
					const selectedModel = get().selectedModel
					set({
						models,
						modelsLoading: false,
						selectedModel:
							selectedModel && models.find((m) => m.id === selectedModel)
								? selectedModel
								: (models[0]?.id ?? null),
					})
				} catch (err) {
					if (modelsLoadGeneration !== generation) return
					const message = err instanceof Error ? err.message : 'Failed to load models'
					set({ modelsLoading: false, modelsError: message })
				}
			},

			setSelectedModel: (modelId: string) => {
				set({ selectedModel: modelId })
			},

			setToolsEnabled: (enabled: boolean) => {
				set({ toolsEnabled: enabled })
			},

			// SAFE-04 / D-09 / D-12: set the level and let useChatSettingsSync's debounced
			// encrypted save persist it. Never writes localStorage directly.
			setSafetyLevel: (level: 1 | 2 | 3) => {
				set({ safetyLevel: level })
			},

			setPromptProfile: (profile: PromptProfile) => {
				set({ promptProfile: profile })
			},

			hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) => {
				// Invalidate any model request that started under the pre-hydration
				// provider. Otherwise its late response can replace the imported model.
				modelsLoadGeneration += 1
				const incomingOverrides = settings.providerOverrides
				set({
					provider: settings.provider ?? DEFAULT_CHAT_SETTINGS.provider,
					providerOverrides: {
						lmstudio:
							incomingOverrides?.lmstudio ?? DEFAULT_CHAT_SETTINGS.providerOverrides.lmstudio,
						ollama: incomingOverrides?.ollama ?? DEFAULT_CHAT_SETTINGS.providerOverrides.ollama,
						custom: incomingOverrides?.custom ?? DEFAULT_CHAT_SETTINGS.providerOverrides.custom,
					},
					selectedModel: settings.selectedModel ?? DEFAULT_CHAT_SETTINGS.selectedModel,
					toolsEnabled: settings.toolsEnabled ?? DEFAULT_CHAT_SETTINGS.toolsEnabled,
					safetyLevel: settings.safetyLevel ?? DEFAULT_CHAT_SETTINGS.safetyLevel,
					promptProfile: settings.promptProfile ?? DEFAULT_CHAT_SETTINGS.promptProfile,
					models: [],
					modelsLoading: false,
					modelsError: null,
				})
			},

			setSettingsStatus: (status: SettingsStatus, error?: string | null) => {
				set({ settingsStatus: status, settingsError: error ?? null })
			},

			// Retry trigger (D-11). Only bumps the nonce the load effect depends on; it must
			// NOT call the loader directly so Retry re-enters the generation-counter guard
			// (Pitfall 2) and an in-flight stale load cannot clobber the retry result.
			requestSettingsReload: () => {
				set((state) => ({ settingsLoadNonce: state.settingsLoadNonce + 1 }))
			},

			// Signals the sync hook that the user explicitly replaced settings via import (D-09).
			// Bumping this nonce clears the hook's load-failed guard so the debounced save effect
			// is allowed to re-encrypt the imported snapshot — the recovery path CR-01 protects.
			notifySettingsImported: () => {
				set((state) => ({ settingsImportNonce: state.settingsImportNonce + 1 }))
			},

			addMessage: (message: ChatMessage) => {
				set((state) => ({
					messages: [...state.messages, message],
					chatSessions: applyMessagesToActiveChat(state.chatSessions, state.activeChatId, [
						...state.messages,
						message,
					]),
				}))
			},

			clearMessages: () => {
				const activeChatId = get().activeChatId
				if (activeChatId && get().runningChatId === activeChatId) {
					toast.info('Stop this conversation before clearing it')
					return
				}
				set((state) => {
					if (!activeChatId) return {}
					const clearedRun = createEmptyChatRunState()
					return {
						messages: [],
						chatSessions: applyMessagesToActiveChat(state.chatSessions, activeChatId, []),
						chatRunStates: { ...state.chatRunStates, [activeChatId]: clearedRun },
						...chatRunStateToActiveView(clearedRun),
					}
				})
			},

			createChat: () => {
				const chat = createEmptyChatSession()
				const runState = createEmptyChatRunState()
				set((state) => ({
					chatSessions: sortChatSessionsByRecent([...state.chatSessions, chat]),
					activeChatId: chat.id,
					messages: [],
					chatRunStates: { ...state.chatRunStates, [chat.id]: runState },
					...chatRunStateToActiveView(runState),
				}))
			},

			switchChat: (chatId: string) => {
				set((state) => {
					const target = state.chatSessions.find((chat) => chat.id === chatId)
					if (!target) return {}
					const runState = getChatRunState(state, target.id)
					return {
						activeChatId: target.id,
						messages: target.messages,
						references: target.references ?? [],
						chatRunStates: state.chatRunStates[target.id]
							? state.chatRunStates
							: { ...state.chatRunStates, [target.id]: runState },
						...chatRunStateToActiveView(runState),
					}
				})
			},

			deleteChat: (chatId: string) => {
				chatComposerActions.deleteDraft(chatId)
				const deletingRunningChat = currentStreamingChatId === chatId
				if (currentStreamingChatId === chatId) {
					const stoppedRunId = get().activeRun?.runId
					currentStreamRunId += 1
					streamAbortController?.abort()
					streamAbortController = null
					currentStreamingChatId = null
					// Release any confirm gate the aborted run was awaiting, else its
					// tool loop stays parked on requestConfirm forever.
					cancelPendingDiffs()
					cancelPendingReferencePublishes()
					cancelPendingStoryTargetRequests()
					setPendingDiffRunContext(null)
					setPendingDiffToolContext(null)
					setReferencePublishingChatContext(null)
					setReferencePublishingRunTarget(null)
					setReferencePublishingToolContext(null)
					releaseToolExecutionRun(stoppedRunId)
				}
				set((state) => {
					const remaining = state.chatSessions.filter((chat) => chat.id !== chatId)
					const ensured = remaining.length > 0 ? remaining : [createEmptyChatSession()]
					const nextActiveId = ensured.some((chat) => chat.id === state.activeChatId)
						? state.activeChatId
						: (ensured[0]?.id ?? null)
					const activeChat = ensured.find((chat) => chat.id === nextActiveId)
					const nextRunStates = { ...state.chatRunStates }
					delete nextRunStates[chatId]
					if (nextActiveId && !nextRunStates[nextActiveId]) {
						nextRunStates[nextActiveId] = createEmptyChatRunState()
					}
					const nextActiveRunState = getChatRunState(
						{ ...state, chatRunStates: nextRunStates },
						nextActiveId,
					)
					return {
						chatSessions: sortChatSessionsByRecent(ensured),
						activeChatId: nextActiveId,
						messages: activeChat?.messages ?? [],
						references: activeChat?.references ?? [],
						chatRunStates: nextRunStates,
						...(deletingRunningChat
							? { isStreaming: false, runningChatId: null, activeRun: null }
							: {}),
						...chatRunStateToActiveView(nextActiveRunState),
					}
				})
			},

			setChatTargetWorkspace: (chatId: string, workspaceId: string | null) => {
				set((state) => {
					if (!state.chatSessions.some((chat) => chat.id === chatId)) return {}
					if (workspaceId && !useEditorStore.getState().workspaces[workspaceId]) return {}
					return {
						chatSessions: state.chatSessions.map((chat) =>
							chat.id === chatId
								? { ...chat, targetWorkspaceId: workspaceId, updatedAt: Date.now() }
								: chat,
						),
					}
				})
			},

			setReferences: (references: ChatReference[]) => {
				set((state) => ({
					references,
					chatSessions: applyReferencesToActiveChat(
						state.chatSessions,
						state.activeChatId,
						references,
					),
				}))
			},

			addReferenceToChat: (chatId: string, reference: ChatReference) => {
				set((state) => {
					const target = state.chatSessions.find((chat) => chat.id === chatId)
					if (!target) return {}
					const key = `${reference.type}:${reference.id || reference.name}:${reference.pubkey ?? ''}`
					const currentReferences = target.references ?? []
					if (
						currentReferences.some(
							(candidate) =>
								`${candidate.type}:${candidate.id || candidate.name}:${candidate.pubkey ?? ''}` ===
								key,
						)
					) {
						return {}
					}
					const nextReferences = [...currentReferences, reference]
					return {
						chatSessions: state.chatSessions.map((chat) =>
							chat.id === chatId
								? { ...chat, references: nextReferences, updatedAt: Date.now() }
								: chat,
						),
						...(state.activeChatId === chatId ? { references: nextReferences } : {}),
					}
				})
			},

			sendMessage: async (content: string, options?: SendMessageOptions) => {
				// Atomic turn acquisition: Zustand writes synchronously, so a second
				// rapid submission cannot append another user turn while this one owns
				// the stream — including when a connection makes the UI feel unresponsive.
				if (get().isStreaming || currentStreamingChatId !== null) {
					toast.info('A response is already in progress')
					return
				}
				const targetChatId = get().activeChatId
				if (!targetChatId || !hasChatSession(get().chatSessions, targetChatId)) {
					toast.error('Select a conversation first')
					return
				}
				const targetChat = get().chatSessions.find((chat) => chat.id === targetChatId)
				if (!targetChat?.targetWorkspaceId) {
					toast.error('Choose New map or Use current edit before sending.')
					return
				}
				const sendTarget = captureActiveToolExecutionTarget(targetChatId)
				if (sendTarget.entityType !== 'dataset' || !sendTarget.workspaceId || !sendTarget.draftId) {
					toast.error('The selected map edit is no longer available. Choose an editing target.')
					return
				}
				const { selectedModel, models, toolsEnabled, provider, providerOverrides, promptProfile } =
					get()
				const continuingAfterAppliedChanges = options?.continueAfterAppliedChanges === true
				const toolsEnabledForRun = toolsEnabled && !continuingAfterAppliedChanges
				const providerConfig = resolveProvider(provider, providerOverrides)
				// Hoisted so the request-builder closure can gate capture_map_snapshot on
				// it; assigned once vision support resolves below. Default false fails
				// closed (gates the vision-only tool OFF if ever read before assignment).
				let canUseVision = false
				const referenceContextMessage = options?.referenceContextMessage?.trim()
				const selectionContextMessage = options?.selectionContextMessage?.trim()
				const geometryContextMessage = options?.geometryContextMessage?.trim()
				const geometryAttachment = options?.geometryAttachment ?? null

				if (!selectedModel) {
					toast.error('Please select a model first')
					return
				}
				const selectedModelId = selectedModel

				const model = models.find((m) => m.id === selectedModelId)
				if (!model) {
					toast.error('Selected model not found')
					return
				}

				// Check wallet status (only for paid providers)
				if (providerConfig.requiresPayment) {
					const snap = getWalletSnapshot()
					if (!snap.exists || snap.mints.length === 0) {
						toast.error('Wallet not ready. Please initialize your wallet first.')
						return
					}
				}

				// Add user message immediately. The D-11 composed content (datasets as
				// handle+summary + gated image parts) overrides the plain string when
				// attachments are present — fullRows never enter the message.
				const userMessage: ChatMessage = {
					role: 'user',
					content: options?.composedContent ?? content,
				}
				const streamRunId = currentStreamRunId + 1
				const runStartedAt = Date.now()
				const runIdentity: ToolExecutionRunIdentity = Object.freeze({
					runId: streamRunId,
					chatId: targetChatId,
					target: sendTarget,
					startedAt: runStartedAt,
				})
				prepareToolExecutionRun(runIdentity)
				const capturedMapSnapshot = getMapContextSnapshotForTarget(runIdentity.target)
				const capturedSessionPublishContext = buildSessionPublishContextMessage() ?? null
				const setOwnedRunState = (
					updater: Partial<ChatRunState> | ((current: ChatRunState) => ChatRunState),
				) => {
					set((state) => buildChatRunStateUpdate(state, targetChatId, updater))
				}
				const finishOwnedRun = (
					updater: Partial<ChatRunState> | ((current: ChatRunState) => ChatRunState),
				) => {
					set((state) => ({
						...buildChatRunStateUpdate(state, targetChatId, updater),
						...(state.activeRun?.runId === streamRunId
							? { isStreaming: false, runningChatId: null, activeRun: null }
							: {}),
					}))
				}
				currentStreamRunId = streamRunId
				currentStreamingChatId = targetChatId
				// Stamp confirmation requests emitted during this run with immutable
				// ownership. Presentation changes never rewrite these module contexts.
				setPendingDiffRunContext(runIdentity)
				setReferencePublishingChatContext(targetChatId)
				setReferencePublishingRunTarget(runIdentity.target)
				set((state) => {
					const targetChat = state.chatSessions.find((chat) => chat.id === targetChatId)
					if (!targetChat) return {}
					const reuseLastUserMessage =
						options?.reuseLastUserMessage === true && targetChat.messages.at(-1)?.role === 'user'
					const nextMessages = continuingAfterAppliedChanges
						? targetChat.messages
						: reuseLastUserMessage
							? targetChat.messages
							: [...targetChat.messages, userMessage]
					const nextRun: ChatRunState = {
						...createEmptyChatRunState(),
						identity: runIdentity,
						status: 'working',
						streamPhase: 'requesting',
						lastProgressAt: runStartedAt,
						lastProgressKind: 'request_start',
						lastTurnRequest: {
							content,
							options: options ? { ...options, reuseLastUserMessage: false } : undefined,
						},
					}
					return {
						chatSessions: applyMessagesToActiveChat(state.chatSessions, targetChatId, nextMessages),
						...(state.activeChatId === targetChatId
							? { messages: nextMessages, ...chatRunStateToActiveView(nextRun) }
							: {}),
						chatRunStates: { ...state.chatRunStates, [targetChatId]: nextRun },
						isStreaming: true,
						runningChatId: targetChatId,
						activeRun: runIdentity,
					}
				})

				const isStreamRunActive = () => {
					const state = get()
					return (
						currentStreamRunId === streamRunId &&
						currentStreamingChatId === targetChatId &&
						hasChatSession(state.chatSessions, targetChatId)
					)
				}

				// Helper to process refund (no-ops when refundToken is null).
				// A refund is real money: on redeem failure the encoded token is
				// surfaced to the user (toast + console) instead of being dropped —
				// it can be pasted into the wallet's Receive panel to recover it.
				const processRefund = async (refundToken: string | null) => {
					if (!refundToken) return
					console.log('[Chat] Received refund token, redeeming...')
					try {
						await receiveCashuToken(refundToken)
						try {
							const amount = getTokenMetadata(refundToken).amount.toNumber()
							setOwnedRunState((current) => ({
								...current,
								totalRefunded: current.totalRefunded + amount,
							}))
						} catch {
							// Amount accounting is best-effort; the redeem already succeeded.
						}
					} catch (err) {
						console.error('[Chat] Failed to redeem refund token:', err, refundToken)
						toast.error('Refund received but could not be redeemed automatically.', {
							description:
								'The token was logged to the console — paste it into Wallet → Receive to recover the sats.',
							duration: 15_000,
						})
					}
				}

				// Helper to make a streaming request.
				// `outputBudget` is derived per-round from the room left after the
				// prompt: `.maxTokens` is what we send (undefined => omit, i.e. no cap),
				// `.costTokens` is the concrete number used for paid cost estimation so
				// prepay/refund stay consistent and never underpay.
				const makeRequest = async (
					requestMessages: ChatMessage[],
					outputBudget: { maxTokens: number | undefined; costTokens: number },
					allowTools = true,
				): Promise<{
					content: string
					reasoningContent: string
					toolCalls: ToolCall[]
					finishReason?: string
					estimatedCompletionTokens: number
				}> => {
					let cashuToken: string | null | undefined

					// Payment flow only for paid providers
					if (providerConfig.requiresPayment) {
						const inputTokens = estimateMessagesTokensForBudget(requestMessages)
						// Use the SAME budget number we send as max_tokens so the server's
						// reservation and our prepayment agree (refund returns the rest).
						const estimatedCost = estimateMaxCost(model, inputTokens, outputBudget.costTokens)

						console.log('[Chat] Cost estimate:', {
							inputTokens,
							maxOutputTokens: outputBudget.costTokens,
							estimatedCost,
							modelPricing: model.pricing,
						})

						const snap = getWalletSnapshot()
						if (snap.totalBalance < estimatedCost) {
							throw new Error(
								`Insufficient balance. Need ~${estimatedCost} sats, have ${snap.totalBalance}`,
							)
						}

						const paymentMint = resolveWalletPaymentMint(snap, { amountSats: estimatedCost })
						if (!paymentMint.mint) {
							throw new Error('No mint available for payment')
						}
						if (paymentMint.balance < estimatedCost) {
							const label = paymentMint.source === 'default' ? 'Default mint' : 'Selected mint'
							throw new Error(
								`${label} has insufficient balance. Need ~${estimatedCost} sats, have ${paymentMint.balance} on ${paymentMint.mint}`,
							)
						}

						console.log('[Chat] Generating payment token for inference', {
							amountSats: estimatedCost,
							mint: paymentMint.mint,
							source: paymentMint.source,
							mintBalance: paymentMint.balance,
						})
						try {
							cashuToken = await sendCashuToken(estimatedCost, { mint: paymentMint.mint })
						} catch (err) {
							throw new Error(
								`Failed to generate payment token: ${err instanceof Error ? err.message : String(err)}`,
							)
						}

						setOwnedRunState((current) => ({
							...current,
							totalSpent: current.totalSpent + estimatedCost,
						}))
					}

					return new Promise((resolve, reject) => {
						let accumulatedContent = ''
						let accumulatedReasoningContent = ''
						let accumulatedToolCalls: ToolCall[] = []
						let resultFinishReason: string | undefined
						let settled = false
						let warningTimer: ReturnType<typeof setTimeout> | null = null
						let timeoutTimer: ReturnType<typeof setTimeout> | null = null

						// D-05: read live registry state at request time so MCP-sync
						// register/unregister changes propagate (falls back to the
						// hardcoded bootstrapped entries when sync is inactive/failed).
						//
						// D-08/D-09: do NOT advertise `capture_map_snapshot` to a model that
						// cannot consume the resulting image. Mirror the autonomous-snapshot
						// vision gate (canUseVision) on the ADVERTISED surface so a no-vision
						// (or merely 'uncertain') model never sees the tool, calls it, and
						// then wastes a round reasoning that it cannot view the snapshot.
						const requestTools =
							toolsEnabledForRun && allowTools ? getAdvertisedGeoTools(canUseVision) : undefined
						console.log('[Chat] Request config:', {
							provider: providerConfig.type,
							model: selectedModelId,
							toolsEnabled: toolsEnabledForRun,
							toolCount: requestTools?.length ?? 0,
							toolNames: requestTools?.map((t) => t.function.name) ?? [],
						})

						const clearTimers = () => {
							if (warningTimer) {
								clearTimeout(warningTimer)
								warningTimer = null
							}
							if (timeoutTimer) {
								clearTimeout(timeoutTimer)
								timeoutTimer = null
							}
						}

						const failStalledRequest = () => {
							if (streamAbortController) {
								streamAbortController.abort()
							}
							if (settled) return
							if (!isStreamRunActive()) return
							settled = true
							clearTimers()
							cancelStreamingFlush()
							setOwnedRunState({
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
							})
							reject(
								new Error(
									`Stream stalled: no response updates for ${STREAM_STALL_TIMEOUT_SECONDS} seconds. Stop and retry.`,
								),
							)
						}

						const armStallTimers = () => {
							clearTimers()
							warningTimer = setTimeout(() => {
								setOwnedRunState({
									streamWarning: `No stream updates for ${STREAM_STALL_WARNING_SECONDS}s. The provider may be stuck. You can stop and retry.`,
								})
							}, STREAM_STALL_WARNING_MS)
							timeoutTimer = setTimeout(failStalledRequest, STREAM_STALL_TIMEOUT_MS)
						}

						const refreshActivity = (kind: StreamProgressKind) => {
							if (!isStreamRunActive()) return
							setOwnedRunState({
								lastProgressAt: Date.now(),
								lastProgressKind: kind,
								streamWarning: null,
								streamPhase:
									kind === 'request_start'
										? 'requesting'
										: kind === 'tool_calls'
											? 'finalizing'
											: 'streaming',
							})
							armStallTimers()
						}

						// Coalesce high-frequency token deltas into a single store write per
						// animation frame. ChatPanel subscribes to the whole chat store, so a
						// set() per SSE token meant a full panel re-render + markdown re-parse
						// + auto-scroll on every token — hundreds of times a second, which
						// pegged the CPU and froze the UI during streaming. Stall timers are
						// still armed per-token (pure timer ops, no render) so stall detection
						// and backgrounded-tab behavior are unchanged.
						let streamFlushScheduled = false
						let streamFlushRaf: number | null = null
						const flushStreamingContent = () => {
							streamFlushScheduled = false
							streamFlushRaf = null
							if (settled || !isStreamRunActive()) return
							setOwnedRunState({
								streamingContent: accumulatedContent,
								streamingReasoningContent: accumulatedReasoningContent,
								lastProgressAt: Date.now(),
								lastProgressKind: accumulatedContent ? 'token' : 'reasoning',
								streamWarning: null,
								streamPhase: 'streaming',
							})
						}
						const scheduleStreamingFlush = () => {
							if (streamFlushScheduled) return
							streamFlushScheduled = true
							streamFlushRaf = requestAnimationFrame(flushStreamingContent)
						}
						const cancelStreamingFlush = () => {
							if (streamFlushRaf !== null) {
								cancelAnimationFrame(streamFlushRaf)
								streamFlushRaf = null
							}
							streamFlushScheduled = false
						}

						refreshActivity('request_start')

						void streamChatCompletion(
							{
								model: selectedModelId,
								messages: requestMessages,
								stream: true,
								// Omitted (undefined) for free/local providers so the model
								// runs to its natural stop within the context window; the
								// derived budget for paid providers.
								max_tokens: outputBudget.maxTokens,
								tools: requestTools,
							},
							{
								onToken: (token: string) => {
									if (settled || !isStreamRunActive()) return
									accumulatedContent += token
									armStallTimers()
									scheduleStreamingFlush()
								},
								onReasoningToken: (token: string) => {
									if (settled || !isStreamRunActive()) return
									accumulatedReasoningContent += token
									armStallTimers()
									scheduleStreamingFlush()
								},
								onToolCall: (toolCalls: ToolCall[]) => {
									if (settled || !isStreamRunActive()) return
									console.log(
										'[Chat] Received tool calls:',
										toolCalls.map((t) => t.function.name),
									)
									accumulatedToolCalls = toolCalls
									refreshActivity('tool_calls')
								},
								onComplete: async (refundToken: string | null, finishReason?: string) => {
									if (settled) return
									if (!isStreamRunActive()) {
										settled = true
										clearTimers()
										// The UI detached, but the refund is still money — redeem it.
										await processRefund(refundToken)
										reject(new Error(DETACHED_STREAM_ERROR))
										return
									}
									settled = true
									resultFinishReason = finishReason
									clearTimers()
									cancelStreamingFlush()
									setOwnedRunState({
										streamWarning: null,
										lastProgressAt: Date.now(),
										lastProgressKind: 'round_complete',
									})
									await processRefund(refundToken)
									resolve({
										content: accumulatedContent,
										reasoningContent: accumulatedReasoningContent,
										toolCalls: accumulatedToolCalls,
										finishReason: resultFinishReason,
										estimatedCompletionTokens: estimateTokens(
											`${accumulatedContent}\n${accumulatedReasoningContent}\n${JSON.stringify(accumulatedToolCalls)}`,
										),
									})
								},
								onError: async (error: Error, refundToken?: string | null) => {
									if (settled) return
									if (!isStreamRunActive()) {
										settled = true
										clearTimers()
										// The UI detached, but the refund is still money — redeem it.
										await processRefund(refundToken ?? null)
										reject(new Error(DETACHED_STREAM_ERROR))
										return
									}
									settled = true
									clearTimers()
									cancelStreamingFlush()
									if (refundToken) {
										console.log('[Chat] Processing refund from error response')
										await processRefund(refundToken)
									}
									setOwnedRunState({
										streamWarning: null,
										lastProgressAt: Date.now(),
										lastProgressKind: 'error',
									})
									reject(error)
								},
							},
							providerConfig,
							cashuToken || undefined,
							streamAbortController?.signal,
						).catch((error) => {
							if (settled) return
							if (!isStreamRunActive()) return
							settled = true
							clearTimers()
							cancelStreamingFlush()
							setOwnedRunState({
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
							})
							reject(error instanceof Error ? error : new Error(String(error)))
						})
					})
				}

				let mapChangingToolResultCount = 0
				try {
					streamAbortController = new AbortController()
					// Repair any assistant tool_calls left unanswered by a stopped run
					// (protocol requirement) — heals previously wedged chats on send.
					let conversationMessages = [
						...sanitizeDanglingToolCalls(
							get().chatSessions.find((chat) => chat.id === targetChatId)?.messages ?? [],
						),
					]
					let oneShotVisionMessages: ChatMessage[] = []
					let oneShotGeometryContextMessage = geometryContextMessage
					let totalToolCalls = 0
					const toolLoopRecovery = new ToolLoopRecovery()
					let pendingLoopRecoveryInstruction: string | null = null
					let modelRequestCount = 0
					let cumulativeEstimatedPromptTokens = 0
					let cumulativeEstimatedCompletionTokens = 0
					let toolResultBytes = 0
					let totalToolDurationMs = 0
					let toolStats: ChatDiagnostics['toolStats'] = {}
					let terminalTargetError: ToolError | null = null
					let round = 0
					const effectiveContextTokens = getEffectiveContextTokens(model, providerConfig)
					const requiresReasoningContent = providerMayRequireReasoningContent(
						providerConfig,
						selectedModelId,
					)
					// D-07/D-09: one authoritative, cached, fail-safe vision verdict gates
					// BOTH image paths (user-attached images AND the autonomous
					// capture_map_snapshot one-shot below). Resolved once per request; the
					// per-(type,baseUrl,modelId) cache makes the reuse free.
					const visionSupport = await detectVisionSupport(providerConfig, selectedModelId, model)
					// The autonomous snapshot path may only send on CONFIRMED 'vision'
					// (acceptance criterion #4 fail-safe). 'uncertain' is opt-in via the
					// Plan 06 UI, never the silent snapshot loop; 'no-vision' is hard-off.
					canUseVision =
						visionSupport === 'vision' &&
						effectiveContextTokens >= MIN_CONTEXT_TOKENS_FOR_INLINE_IMAGE
					const promptBudgetTokens = getPromptBudgetTokens(model, providerConfig)
					const advertisedTools = toolsEnabledForRun ? getAdvertisedGeoTools(canUseVision) : []
					const streamStartAt = Date.now()

					setOwnedRunState({
						status: 'working',
						streamPhase: 'requesting',
						streamWarning: null,
						lastProgressAt: streamStartAt,
						lastProgressKind: 'request_start',
						diagnostics: {
							provider: providerConfig.type,
							modelId: selectedModelId,
							modelReportedContextTokens:
								typeof model.contextLength === 'number' ? model.contextLength : null,
							effectiveContextTokens,
							promptBudgetTokens,
							mapContextTokens: null,
							estimatedPromptTokens: null,
							estimatedCompletionTokens: null,
							finishReason: null,
							requestMessageCount: 0,
							modelRequestCount: 0,
							cumulativeEstimatedPromptTokens: 0,
							cumulativeEstimatedCompletionTokens: 0,
							toolCallCount: 0,
							mapChangingToolResultCount: 0,
							toolResultBytes: 0,
							totalToolDurationMs: 0,
							toolStats: {},
							round: 0,
							startedAt: streamStartAt,
							completedAt: null,
							promptProfile,
							advertisedToolCount: advertisedTools.length,
							advertisedToolSchemaChars: JSON.stringify(advertisedTools).length,
							systemPromptChars: 0,
						},
					})

					const recordModelRequest = (promptTokens: number) => {
						modelRequestCount += 1
						cumulativeEstimatedPromptTokens += promptTokens
						setOwnedRunState((current) => ({
							...current,
							diagnostics: {
								...current.diagnostics,
								modelRequestCount,
								cumulativeEstimatedPromptTokens,
							},
						}))
					}
					const recordModelCompletion = (completionTokens: number) => {
						cumulativeEstimatedCompletionTokens += completionTokens
						setOwnedRunState((current) => ({
							...current,
							diagnostics: {
								...current.diagnostics,
								cumulativeEstimatedCompletionTokens,
							},
						}))
					}

					// Loop to handle tool calls until the model returns a final answer.
					while (true) {
						if (!isStreamRunActive()) {
							throw new Error(DETACHED_STREAM_ERROR)
						}
						round += 1
						const roundNumber = round
						let requestMessages: ChatMessage[] = [...conversationMessages]
						if (pendingLoopRecoveryInstruction) {
							requestMessages.push({
								role: 'system',
								content: pendingLoopRecoveryInstruction,
							})
							pendingLoopRecoveryInstruction = null
						}
						if (oneShotVisionMessages.length > 0) {
							requestMessages.push(...oneShotVisionMessages)
							oneShotVisionMessages = []
						}

						const advertisedToolNames = toolsEnabledForRun
							? getAdvertisedGeoTools(canUseVision).map((tool) => tool.function.name)
							: []
						const systemSections = continuingAfterAppliedChanges
							? [FINISH_APPLIED_CHANGES_INSTRUCTION]
							: [
									toolsEnabledForRun
										? createMapContextSystemMessage(promptProfile, advertisedToolNames, {
												mapSnapshot: capturedMapSnapshot,
												sessionPublishContextMessage: capturedSessionPublishContext,
											})?.content
										: null,
									referenceContextMessage || null,
									selectionContextMessage || null,
									oneShotGeometryContextMessage || null,
								]
									.map((section) =>
										typeof section === 'string'
											? section.trim()
											: messageContentToText(section ?? null),
									)
									.filter((section): section is string => Boolean(section))
						const combinedSystemMessage: ChatMessage | null =
							systemSections.length > 0
								? {
										role: 'system',
										content: systemSections.join('\n\n'),
									}
								: null

						const combinedSystemTokens = combinedSystemMessage
							? estimateMessageTokensForBudget(sanitizeMessageForPrompt(combinedSystemMessage))
							: 0
						const conversationBudget = Math.max(
							MIN_PROMPT_BUDGET_TOKENS,
							promptBudgetTokens - combinedSystemTokens,
						)
						requestMessages = trimMessagesToPromptBudget(requestMessages, conversationBudget)

						if (combinedSystemMessage) {
							requestMessages = [
								sanitizeMessageForPrompt(combinedSystemMessage),
								...requestMessages,
							]
							oneShotGeometryContextMessage = undefined
						}
						if (!continuingAfterAppliedChanges) {
							requestMessages = appendRequestContextToLatestUserMessage(requestMessages, [
								referenceContextMessage,
								capturedSessionPublishContext ?? undefined,
							])
						}
						requestMessages = ensureReasoningContentForToolMessages(
							requestMessages,
							requiresReasoningContent,
						)
						const estimatedPromptTokens = estimateMessagesTokensForBudget(requestMessages)
						// Output budget is sized per-round from the room left after this
						// round's prompt — no fixed cap. Free/local omit max_tokens; paid
						// send the derived budget (cost estimate uses the same number).
						const outputBudget = deriveOutputBudget(model, providerConfig, estimatedPromptTokens)

						setOwnedRunState((current) => ({
							...current,
							streamPhase: 'requesting',
							lastProgressAt: Date.now(),
							lastProgressKind: 'request_start',
							diagnostics: {
								...current.diagnostics,
								mapContextTokens: combinedSystemTokens,
								requestMessageCount: requestMessages.length,
								estimatedPromptTokens,
								round: roundNumber,
								systemPromptChars:
									typeof combinedSystemMessage?.content === 'string'
										? combinedSystemMessage.content.length
										: 0,
							},
						}))

						let result: {
							content: string
							reasoningContent: string
							toolCalls: ToolCall[]
							finishReason?: string
							estimatedCompletionTokens: number
						} | null = null

						try {
							let lastError: unknown
							for (let attempt = 0; attempt <= OVERLOAD_RETRY_DELAYS_MS.length; attempt += 1) {
								try {
									recordModelRequest(estimatedPromptTokens)
									result = await makeRequest(
										requestMessages,
										outputBudget,
										!continuingAfterAppliedChanges,
									)
									lastError = null
									break
								} catch (error) {
									lastError = error
									if (
										!isTransientProviderOverloadError(error) ||
										attempt >= OVERLOAD_RETRY_DELAYS_MS.length
									) {
										throw error
									}

									const retryDelayMs =
										OVERLOAD_RETRY_DELAYS_MS[attempt] ??
										OVERLOAD_RETRY_DELAYS_MS[OVERLOAD_RETRY_DELAYS_MS.length - 1] ??
										1500
									setOwnedRunState({
										streamPhase: 'requesting',
										streamWarning: `Provider overloaded. Retrying in ${Math.ceil(
											retryDelayMs / 1000,
										)}s...`,
										lastProgressAt: Date.now(),
										lastProgressKind: 'request_start',
									})
									await sleep(retryDelayMs)
								}
							}
							if (!result && lastError) {
								throw lastError
							}
						} catch (error) {
							if (!isContextOverflowError(error)) {
								throw error
							}

							console.warn('[Chat] Context overflow detected. Retrying with reduced prompt.')
							setOwnedRunState({
								streamPhase: 'recovering_context',
								streamWarning:
									'Context overflow detected. Retrying with a reduced prompt window...',
							})
							const emergencyMessages = continuingAfterAppliedChanges
								? buildAppliedChangesContinuationMessages(conversationMessages)
								: appendRequestContextToLatestUserMessage(
										buildEmergencyRetryMessages(conversationMessages),
										[referenceContextMessage, capturedSessionPublishContext ?? undefined],
									)
							// Re-derive the budget for the reduced prompt so a paid retry's
							// cost estimate matches the smaller request (more room => budget
							// floored, never starved).
							const emergencyPromptTokens = estimateMessagesTokensForBudget(emergencyMessages)
							const emergencyOutputBudget = deriveOutputBudget(
								model,
								providerConfig,
								emergencyPromptTokens,
							)
							recordModelRequest(emergencyPromptTokens)
							result = await makeRequest(
								emergencyMessages,
								emergencyOutputBudget,
								!continuingAfterAppliedChanges,
							)
						}
						if (!result) {
							throw new Error('Chat request finished without a result.')
						}
						recordModelCompletion(result.estimatedCompletionTokens)

						// If we got tool calls, execute them and continue
						if (result.toolCalls.length > 0) {
							if (!isStreamRunActive()) {
								throw new Error(DETACHED_STREAM_ERROR)
							}
							totalToolCalls += result.toolCalls.length
							setOwnedRunState((current) => ({
								...current,
								status: 'working',
								executingTools: true,
								streamingContent: '',
								streamingReasoningContent: '',
								streamPhase: 'executing_tools',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'tool_calls',
								diagnostics: {
									...current.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
								},
							}))

							const normalizedReasoningContent = result.reasoningContent.trim()

							// Add assistant message with tool calls
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: result.content || null,
								tool_calls: result.toolCalls,
								reasoning_content:
									normalizedReasoningContent || (requiresReasoningContent ? '' : undefined),
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set((state) => ({
								chatSessions: applyMessagesToActiveChat(
									state.chatSessions,
									targetChatId,
									conversationMessages,
								),
								...(state.activeChatId === targetChatId ? { messages: conversationMessages } : {}),
							}))

							// PROTOCOL INTEGRITY on any early round exit: the assistant message
							// carrying tool_calls is already persisted above, so the run MUST
							// still persist one tool result per call id — a dangling
							// tool_calls message makes the whole chat unsendable ("must be
							// followed by tool messages responding to each tool_call_id").
							// The executed tool's REAL result answers its own call; every
							// not-yet-run call gets a synthetic cancelled result. Writes go
							// to the OWNING chat session (and to the visible transcript only
							// when that chat is still active) — never to another chat's UI.
							const persistRemainingRoundResults = (
								pendingCalls: ToolCall[],
								executedResult: { tool_call_id: string; content: string } | null,
								cancellationReason = 'The run was stopped before this tool call completed. Nothing was applied for it.',
							): void => {
								const filler: ChatMessage[] = pendingCalls.map((call, index) => ({
									role: 'tool' as const,
									content:
										index === 0 && executedResult
											? executedResult.content
											: syntheticCancelledToolResult(cancellationReason),
									tool_call_id:
										index === 0 && executedResult ? executedResult.tool_call_id : call.id,
								}))
								conversationMessages = [...conversationMessages, ...filler]
								set((state) => ({
									chatSessions: applyMessagesToActiveChat(
										state.chatSessions,
										targetChatId,
										conversationMessages,
									),
									...(state.activeChatId === targetChatId
										? { messages: conversationMessages }
										: {}),
								}))
							}

							// Execute each tool call
							const roundToolCalls = result.toolCalls
							for (let callIndex = 0; callIndex < roundToolCalls.length; callIndex++) {
								const toolCall = roundToolCalls[callIndex] as ToolCall
								// Run-currency check PER TOOL, not just per round: STOP, delete,
								// and reset bump the run id mid-round, and without
								// this check the rest of the round's tools kept executing in
								// the background — mutating the editor through the gates and
								// flipping the visible transcript between chats.
								if (!isStreamRunActive()) {
									persistRemainingRoundResults(roundToolCalls.slice(callIndex), null)
									throw new Error(DETACHED_STREAM_ERROR)
								}
								console.log(`[Chat] Executing tool: ${toolCall.function.name}`)
								// Tag any safe-editing diff this tool emits with its call id so
								// the transcript can render the card inline at this turn.
								setPendingDiffToolContext(toolCall.id)
								setReferencePublishingToolContext(toolCall.id)
								let toolResult: Awaited<ReturnType<typeof executeToolCall>>
								const toolStartedAt = performance.now()
								try {
									toolResult = await executeToolCall(toolCall, {
										attachedGeometry: geometryAttachment,
										userMessage: content,
										toolCallId: toolCall.id,
										run: runIdentity,
									})
								} finally {
									setPendingDiffToolContext(null)
									setReferencePublishingToolContext(null)
								}
								const toolDurationMs = performance.now() - toolStartedAt
								const resultBytes = utf8ByteLength(toolResult.content)
								const previousToolStats = toolStats[toolCall.function.name] ?? {
									calls: 0,
									durationMs: 0,
									resultBytes: 0,
									errors: 0,
								}
								toolStats = {
									...toolStats,
									[toolCall.function.name]: {
										calls: previousToolStats.calls + 1,
										durationMs: previousToolStats.durationMs + toolDurationMs,
										resultBytes: previousToolStats.resultBytes + resultBytes,
										errors:
											previousToolStats.errors +
											(serializedToolResultIsError(toolResult.content) ? 1 : 0),
									},
								}
								toolResultBytes += resultBytes
								totalToolDurationMs += toolDurationMs
								setOwnedRunState((current) => ({
									...current,
									diagnostics: {
										...current.diagnostics,
										toolResultBytes,
										totalToolDurationMs,
										toolStats,
									},
								}))

								// Re-check AFTER the await: the run may have been superseded
								// while this tool executed (e.g. STOP while a safe-editing gate
								// awaited Apply/Cancel). Persist this tool's real result +
								// synthetic results for the rest of the round, then end. If the
								// tool emitted a gate AFTER cancelStream's sweep, that late gate
								// is parked un-cancellable — sweep it now, but only when no NEW
								// stream is running (a new run's own pending gates must not be
								// collateral damage).
								if (!isStreamRunActive()) {
									if (!get().isStreaming) {
										cancelPendingDiffs()
										cancelPendingReferencePublishes()
										cancelPendingStoryTargetRequests()
									}
									persistRemainingRoundResults(roundToolCalls.slice(callIndex), toolResult)
									throw new Error(DETACHED_STREAM_ERROR)
								}

								// Add tool result message
								const toolMessage: ChatMessage = {
									role: 'tool',
									content: toolResult.content,
									tool_call_id: toolResult.tool_call_id,
								}
								conversationMessages = [...conversationMessages, toolMessage]
								set((state) => ({
									chatSessions: applyMessagesToActiveChat(
										state.chatSessions,
										targetChatId,
										conversationMessages,
									),
									...(state.activeChatId === targetChatId
										? { messages: conversationMessages }
										: {}),
								}))
								setOwnedRunState({
									lastProgressAt: Date.now(),
									lastProgressKind: 'tool_result',
								})
								const currentTerminalTargetError = terminalDatasetTargetError(toolResult.content)
								if (currentTerminalTargetError) {
									terminalTargetError ??= currentTerminalTargetError
									const unexecutedCalls = roundToolCalls.slice(callIndex + 1)
									if (unexecutedCalls.length > 0) {
										persistRemainingRoundResults(
											unexecutedCalls,
											null,
											'A previous tool call ended the run with a Dataset editing-target error. This tool call was not executed; nothing was applied for it.',
										)
									}
									break
								}

								const mapChanged = serializedToolResultChangedMap(
									toolResult.content,
									toolCall.function.name,
								)
								if (mapChanged) mapChangingToolResultCount += 1
								const loopRecoveryInstruction = toolLoopRecovery.observe(
									toolCall,
									toolResult.content,
									mapChanged,
								)
								if (mapChanged) {
									pendingLoopRecoveryInstruction = null
								} else if (loopRecoveryInstruction) {
									pendingLoopRecoveryInstruction = loopRecoveryInstruction
								}
								setOwnedRunState((current) => ({
									...current,
									diagnostics: {
										...current.diagnostics,
										mapChangingToolResultCount,
									},
								}))

								if (canUseVision && toolCall.function.name === 'capture_map_snapshot') {
									const snapshotId = tryExtractSnapshotId(toolResult.content)
									if (!snapshotId) continue

									const snapshot = consumeMapSnapshot(snapshotId)
									if (!snapshot) continue

									oneShotVisionMessages.push({
										role: 'user',
										content: [
											{
												type: 'text',
												text: 'Map snapshot for visual analysis. Use this image together with the tool outputs.',
											},
											{
												type: 'image_url',
												image_url: {
													url: snapshot.dataUrl,
												},
											},
										],
									})
								}
							}

							if (terminalTargetError) {
								const completedAt = Date.now()
								const terminalTargetErrorMessage = terminalTargetError.message
								const errorRecovery = resolveChatErrorRecovery(mapChangingToolResultCount)
								finishOwnedRun((current) => ({
									...current,
									status: 'error',
									executingTools: false,
									streamPhase: 'idle',
									streamWarning: null,
									lastProgressAt: completedAt,
									lastProgressKind: 'error',
									error: terminalTargetErrorMessage,
									errorRecovery,
									diagnostics: {
										...current.diagnostics,
										toolCallCount: totalToolCalls,
										mapChangingToolResultCount,
										completedAt,
									},
								}))
								break
							}

							setOwnedRunState({ executingTools: false, status: 'working' })
							// Continue loop to get next response
							continue
						}

						// No tool calls - we're done
						if (result.content) {
							if (!isStreamRunActive()) {
								throw new Error(DETACHED_STREAM_ERROR)
							}
							const normalizedReasoningContent = result.reasoningContent.trim()
							// Truncation visibility even when content WAS produced: append a
							// subtle marker so the user knows the answer is incomplete.
							const truncatedWithContent = result.finishReason === 'length'
							const assistantContent = truncatedWithContent
								? `${result.content}${TRUNCATION_CONTENT_SUFFIX}`
								: result.content
							const assistantMessage: ChatMessage = {
								role: 'assistant',
								content: assistantContent,
								reasoning_content: normalizedReasoningContent || undefined,
							}
							conversationMessages = [...conversationMessages, assistantMessage]
							set((state) => ({
								chatSessions: applyMessagesToActiveChat(
									state.chatSessions,
									targetChatId,
									conversationMessages,
								),
								...(state.activeChatId === targetChatId ? { messages: conversationMessages } : {}),
							}))
							finishOwnedRun((current) => ({
								...current,
								status: 'completed',
								streamingContent: '',
								streamingReasoningContent: '',
								executingTools: false,
								streamPhase: 'idle',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'complete',
								error: null,
								errorRecovery: null,
								diagnostics: {
									...current.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
									completedAt: Date.now(),
								},
							}))
						} else {
							// Empty completion, no tool calls. Never end the turn silently:
							// surface a visible notice through the same `error` channel
							// ChatPanel renders for failures, with truncation-specific copy
							// when the model hit its output-token limit.
							const { message: emptyNotice } = describeEmptyCompletion(result.finishReason)
							const errorRecovery = resolveChatErrorRecovery(
								mapChangingToolResultCount,
								continuingAfterAppliedChanges,
							)
							finishOwnedRun((current) => ({
								...current,
								status: 'error',
								streamingContent: '',
								streamingReasoningContent: '',
								streamPhase: 'idle',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
								error: emptyNotice,
								errorRecovery,
								diagnostics: {
									...current.diagnostics,
									estimatedCompletionTokens: result.estimatedCompletionTokens,
									finishReason: result.finishReason ?? null,
									toolCallCount: totalToolCalls,
									completedAt: Date.now(),
								},
							}))
							if (errorRecovery === 'finish_response') {
								toast.warning('Map changes were applied, but the final response was empty.', {
									description: emptyNotice,
								})
							} else {
								toast.error(emptyNotice)
							}
						}
						break
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : 'Failed to send message'
					if (message === DETACHED_STREAM_ERROR) {
						// Normally a newer run (or an explicit cancel/delete/reset) superseded
						// this one and owns the streaming UI state, so we must not clobber it.
						// That supersede always bumps the run id. If the id still matches, the
						// detach came from something else (e.g. the chat session vanished) and
						// nobody else will clear the flags — so clear them here to avoid a
						// stuck-disabled UI.
						if (currentStreamRunId === streamRunId) {
							finishOwnedRun({
								status: 'stopped',
								streamingContent: '',
								streamingReasoningContent: '',
								executingTools: false,
								streamPhase: 'idle',
								streamWarning: null,
							})
						}
						return
					}
					const errorRecovery = resolveChatErrorRecovery(
						mapChangingToolResultCount,
						continuingAfterAppliedChanges,
					)
					finishOwnedRun((current) => ({
						...current,
						status: 'error',
						streamingContent: '',
						streamingReasoningContent: '',
						executingTools: false,
						streamPhase: 'idle',
						streamWarning: null,
						lastProgressAt: Date.now(),
						lastProgressKind: 'error',
						error: message,
						errorRecovery,
						diagnostics: {
							...current.diagnostics,
							completedAt: Date.now(),
						},
					}))
					if (errorRecovery === 'finish_response') {
						toast.warning('Map changes were applied, but the final response failed.', {
							description: message,
						})
					} else {
						toast.error(message)
					}
				} finally {
					releaseToolExecutionRun(streamRunId)
					if (currentStreamRunId === streamRunId) {
						streamAbortController = null
						currentStreamingChatId = null
						setPendingDiffRunContext(null)
						setPendingDiffToolContext(null)
						setReferencePublishingChatContext(null)
						setReferencePublishingRunTarget(null)
						setReferencePublishingToolContext(null)
					}
				}
			},

			retryLastMessage: async () => {
				const state = get()
				if (state.errorRecovery === 'finish_response') {
					await state.finishLastResponse()
					return
				}
				const request = state.lastTurnRequest
				if (!request || state.isStreaming) return
				await get().sendMessage(request.content, {
					...request.options,
					reuseLastUserMessage: true,
					continueAfterAppliedChanges: false,
				})
			},

			finishLastResponse: async () => {
				const state = get()
				const request = state.lastTurnRequest
				if (!request || state.isStreaming || state.errorRecovery !== 'finish_response') return
				await get().sendMessage(request.content, {
					...request.options,
					reuseLastUserMessage: false,
					continueAfterAppliedChanges: true,
				})
			},

			cancelStream: () => {
				const ownedChatId = currentStreamingChatId ?? get().runningChatId
				const stoppedRunId = get().activeRun?.runId
				if (ownedChatId) {
					currentStreamRunId += 1
				}
				streamAbortController?.abort()
				streamAbortController = null
				currentStreamingChatId = null
				// Settle any confirm gate the cancelled run was awaiting (resolves as
				// 'cancel', zero editor mutation) so the tool loop can unwind.
				cancelPendingDiffs()
				cancelPendingReferencePublishes()
				cancelPendingStoryTargetRequests()
				setPendingDiffRunContext(null)
				setPendingDiffToolContext(null)
				setReferencePublishingChatContext(null)
				setReferencePublishingRunTarget(null)
				setReferencePublishingToolContext(null)
				releaseToolExecutionRun(stoppedRunId)
				set((state) => {
					const runUpdate = ownedChatId
						? buildChatRunStateUpdate(state, ownedChatId, (current) => ({
								...current,
								status: 'stopped',
								streamingContent: '',
								streamingReasoningContent: '',
								executingTools: false,
								streamPhase: 'idle',
								streamWarning: null,
								lastProgressAt: Date.now(),
								lastProgressKind: 'error',
							}))
						: {}
					return {
						...runUpdate,
						isStreaming: false,
						runningChatId: null,
						activeRun: null,
					}
				})
			},

			reset: () => {
				chatComposerActions.reset()
				const stoppedRunId = get().activeRun?.runId
				if (streamAbortController || currentStreamingChatId) {
					currentStreamRunId += 1
				}
				streamAbortController?.abort()
				streamAbortController = null
				currentStreamingChatId = null
				cancelPendingDiffs()
				cancelPendingReferencePublishes()
				cancelPendingStoryTargetRequests()
				setPendingDiffRunContext(null)
				setPendingDiffToolContext(null)
				setReferencePublishingChatContext(null)
				setReferencePublishingRunTarget(null)
				setReferencePublishingToolContext(null)
				releaseToolExecutionRun(stoppedRunId)
				set(createInitialState())
			},
		}),
		{
			name: 'chat-store',
			storage: createJSONStorage(() => resilientChatStorage),
			partialize: chatStorePartialize,
			merge: (persistedState, currentState) => {
				const persisted = (persistedState as Partial<ChatState> | undefined) ?? {}
				const persistedSessions = Array.isArray(persisted.chatSessions)
					? persisted.chatSessions.filter((session) => typeof session?.id === 'string')
					: []
				const rawChatSessions =
					persistedSessions.length > 0
						? persistedSessions
						: (currentState.chatSessions ?? [createEmptyChatSession()])
				const chatSessions = rawChatSessions.map((session) => ({
					...session,
					targetWorkspaceId:
						typeof session.targetWorkspaceId === 'string' ? session.targetWorkspaceId : null,
				}))
				const persistedActiveChatId =
					typeof persisted.activeChatId === 'string' ? persisted.activeChatId : null
				const activeChatId = chatSessions.some((session) => session.id === persistedActiveChatId)
					? persistedActiveChatId
					: (chatSessions[0]?.id ?? null)
				const activeChat = chatSessions.find((session) => session.id === activeChatId)
				const chatRunStates = Object.fromEntries(
					chatSessions.map((session) => [session.id, createEmptyChatRunState()]),
				)
				const activeRunState = activeChatId
					? (chatRunStates[activeChatId] ?? createEmptyChatRunState())
					: createEmptyChatRunState()
				return {
					...currentState,
					chatSessions: sortChatSessionsByRecent(chatSessions),
					activeChatId,
					messages: activeChat?.messages ?? [],
					references: activeChat?.references ?? [],
					chatRunStates,
					runningChatId: null,
					activeRun: null,
					isStreaming: false,
					...chatRunStateToActiveView(activeRunState),
				}
			},
		},
	),
)

function syncRunningChatApprovalStatus(): void {
	const state = useChatStore.getState()
	const chatId = state.runningChatId
	if (!chatId) return
	const current = state.chatRunStates[chatId]
	if (!current || (current.status !== 'working' && current.status !== 'awaiting_approval')) return

	const awaitingDiff = getAllPendingDiffs().some(
		(entry) => entry.chatId === chatId && entry.status === 'pending',
	)
	const publishRequest = getReferencePublishRequest()
	const awaitingPublish = publishRequest?.chatId === chatId
	const storyTargetRequest = getStoryTargetRequest()
	const awaitingStoryTarget = storyTargetRequest?.chatId === chatId
	const status: ChatRunStatus =
		awaitingDiff || awaitingPublish || awaitingStoryTarget ? 'awaiting_approval' : 'working'
	if (current.status === status) return

	useChatStore.setState((latest) => buildChatRunStateUpdate(latest, chatId, { status }))
}

// Confirmation surfaces live outside Zustand, so bridge their lifecycle into
// the per-conversation status shown by the selector/rail. Both subscriptions
// These subscriptions are module-lifetime singletons, just like their backing request stores.
subscribePendingDiffs(syncRunningChatApprovalStatus)
subscribeReferencePublishRequest(syncRunningChatApprovalStatus)
subscribeStoryTargetRequest(syncRunningChatApprovalStatus)

// SAFE-04: expose the persisted safety level to the run_code gate without a
// static import cycle (runCode is pulled into the registry bootstrap that this
// store transitively imports). The gate reads through this injected getter.
setSafetyLevelProvider(() => useChatStore.getState().safetyLevel)

// Action helpers for non-hook usage
export const chatActions = {
	setProvider: (provider: ProviderType) => useChatStore.getState().setProvider(provider),
	setProviderOverride: (type: ProviderType, patch: Partial<ProviderOverride>) =>
		useChatStore.getState().setProviderOverride(type, patch),
	loadModels: () => useChatStore.getState().loadModels(),
	setSelectedModel: (modelId: string) => useChatStore.getState().setSelectedModel(modelId),
	setToolsEnabled: (enabled: boolean) => useChatStore.getState().setToolsEnabled(enabled),
	setSafetyLevel: (level: 1 | 2 | 3) => useChatStore.getState().setSafetyLevel(level),
	setPromptProfile: (profile: PromptProfile) => useChatStore.getState().setPromptProfile(profile),
	hydrateSettings: (settings: Partial<ChatSettingsSnapshot>) =>
		useChatStore.getState().hydrateSettings(settings),
	setSettingsStatus: (status: SettingsStatus, error?: string | null) =>
		useChatStore.getState().setSettingsStatus(status, error),
	requestSettingsReload: () => useChatStore.getState().requestSettingsReload(),
	notifySettingsImported: () => useChatStore.getState().notifySettingsImported(),
	sendMessage: (content: string, options?: SendMessageOptions) =>
		useChatStore.getState().sendMessage(content, options),
	retryLastMessage: () => useChatStore.getState().retryLastMessage(),
	finishLastResponse: () => useChatStore.getState().finishLastResponse(),
	clearMessages: () => useChatStore.getState().clearMessages(),
	createChat: () => useChatStore.getState().createChat(),
	switchChat: (chatId: string) => useChatStore.getState().switchChat(chatId),
	deleteChat: (chatId: string) => useChatStore.getState().deleteChat(chatId),
	setChatTargetWorkspace: (chatId: string, workspaceId: string | null) =>
		useChatStore.getState().setChatTargetWorkspace(chatId, workspaceId),
	setReferences: (references: ChatReference[]) => useChatStore.getState().setReferences(references),
	addReferenceToChat: (chatId: string, reference: ChatReference) =>
		useChatStore.getState().addReferenceToChat(chatId, reference),
	cancelStream: () => useChatStore.getState().cancelStream(),
	reset: () => useChatStore.getState().reset(),
}
