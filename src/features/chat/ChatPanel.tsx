import { useEffect, useMemo, useRef, useState } from 'react'
import type { FeatureCollection } from 'geojson'
import { resolveProvider, useChatStore } from './store'
import { composeOutboundContent } from './composeOutboundContent'
import { FileChipStrip } from './components/FileChipStrip'
import { evictDataset } from './ingest/ingestStore'
import type { AttachedFileView, ImageVisionTier } from './components/FileChip'
import type { IngestSummary } from './ingest/datasetTypes'
import { VisionGateControl } from './components/VisionGateControl'
import { detectVisionSupport, type VisionSupport } from './vision/detectVisionSupport'
import { useWallet } from '@/lib/wallet'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useEditorStore } from '@/features/geo-editor/store'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import {
	EntityReferenceToolbar,
	getEntityReferenceKey,
	type EntitySearchResult,
} from '@/components/entity-search'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import type { EditorFeature } from '@/features/geo-editor/core'
import { Button } from '@/components/ui/button'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
	AlertTriangle,
	Loader2,
	Send,
	Trash2,
	Settings2,
	Wallet,
	Bot,
	User,
	AlertCircle,
	Wrench,
	MapPin,
	ToggleLeft,
	ToggleRight,
	Server,
	Check,
	Copy,
	ArrowDownToLine,
	Code2,
	Bug,
} from 'lucide-react'
import { estimateTokens, type ChatMessage, type ToolCall, type ProviderType } from './routstr'
import { analyzeToolResultGeometryContent, bakeToolResultContentToEditor } from './tools'
import { isToolError, type ToolError } from './tools/errors'
import { ChatGeometryAttachment } from './ChatGeometryAttachment'
import { CodeRunDisclosure, parseRunCodeResult } from './CodeRunDisclosure'
import { BindingChipContainer } from './safeEditing/BindingChip'
import { AttachmentCard, parseIngestHandlePart } from './components/AttachmentCard'
import {
	buildConversationDump,
	buildConversationDumpFilename,
	serializeConversationDump,
} from './conversationDump'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import type { ChatReference } from './store'

const EMPTY_STATE_PROMPTS = [
	'Get me the route from Linz to Vienna and bring it to the editor.',
	'Generate a 20-minute bicycle isochrone from the current map center and add it to the editor.',
	'Give me all military installations as points in Saudi Arabia. Keep only features within Saudi borders and preserve useful metadata.',
	'Give me the River Elbe within German borders only. Keep it as line geometry clipped to Germany.',
	'Use the currently selected polygon as the search area and add all parking benches inside it.',
	'Resolve Vienna as an OSM relation, fetch clean boundary geometry, and import it into the editor.',
	'Import all rivers in my current viewport and label the major ones.',
	'Capture a map snapshot and tell me what notable places are visible right now.',
	'Use web search + Wikipedia to find historically significant places in this viewport and import matching OSM features.',
	'Set editor mode to draw_polygon, then explain the next 2 user actions to complete a polygon.',
] as const

const PROVIDER_LABELS: Record<ProviderType, string> = {
	routstr: 'Routstr (paid)',
	lmstudio: 'LM Studio',
	ollama: 'Ollama',
	custom: 'Custom endpoint',
}

interface ChatPanelProps {
	geoEvents?: GeoDataset[]
	mapContextEvents?: MapContext[]
	availableFeatures?: GeoFeatureItem[]
	getDatasetName?: (event: GeoDataset) => string
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onOpenSettings?: () => void
}

const defaultGetDatasetName = (event: GeoDataset): string =>
	event.datasetId ?? event.dTag ?? event.id ?? 'Untitled'

function DangerIndicator() {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<span className="inline-flex shrink-0 items-center justify-center text-orange-500 dark:text-orange-400">
					<AlertTriangle className="h-3.5 w-3.5" />
				</span>
			</TooltipTrigger>
			<TooltipContent side="top" sideOffset={6}>
				danger
			</TooltipContent>
		</Tooltip>
	)
}

export function ChatPanel({
	geoEvents = [],
	mapContextEvents = [],
	availableFeatures = [],
	getDatasetName = defaultGetDatasetName,
	onStartNewDataset,
	onSwitchWorkspace,
	onOpenSettings,
}: ChatPanelProps) {
	const {
		messages,
		chatSessions,
		activeChatId,
		models,
		selectedModel,
		modelsLoading,
		modelsError,
		isStreaming,
		streamingContent,
		executingTools,
		streamPhase,
		streamWarning,
		lastProgressAt,
		toolsEnabled,
		error,
		totalSpent,
		diagnostics,
		provider,
		providerOverrides,
		loadModels,
		sendMessage,
		createChat,
		switchChat,
		deleteChat,
		references,
		setReferences,
		cancelStream,
	} = useChatStore()
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const updateWorkspace = useEditorStore((state) => state.updateWorkspace)
	const setMobilePanelTab = useEditorStore((state) => state.setMobilePanelTab)
	const setMobilePanelOpen = useEditorStore((state) => state.setMobilePanelOpen)
	const editorFeatures = useEditorStore((state) => state.features)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	const { exists: walletExists, totalBalance: walletBalance } = useWallet()
	const walletStatus: 'ready' | 'no_wallet' = walletExists ? 'ready' : 'no_wallet'
	const isMobile = useIsMobile()

	const [input, setInput] = useState('')
	const [selectionContextEnabled, setSelectionContextEnabled] = useState(false)
	const [attachedGeometry, setAttachedGeometry] = useState<FeatureCollection | null>(null)
	const [attachedFiles, setAttachedFiles] = useState<AttachedFileView[]>([])
	const [sendAnyway, setSendAnyway] = useState(false)
	const [visionSupport, setVisionSupport] = useState<VisionSupport>('no-vision')
	const [nowMs, setNowMs] = useState(Date.now())
	const messagesEndRef = useRef<HTMLDivElement>(null)
	const textareaRef = useRef<HTMLTextAreaElement>(null)

	// Load models on mount
	useEffect(() => {
		if (provider === 'custom' && !providerOverrides.custom.baseUrl.trim()) return
		if (models.length === 0 && !modelsLoading && !modelsError) {
			void loadModels()
		}
	}, [
		providerOverrides.custom.baseUrl,
		loadModels,
		models.length,
		modelsError,
		modelsLoading,
		provider,
	])

	// Auto-scroll to bottom when messages change
	const scrollTrigger = `${messages.length}:${streamingContent.length}:${executingTools ? 1 : 0}:${streamWarning ? 1 : 0}`
	useEffect(() => {
		if (!scrollTrigger) return
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [scrollTrigger])

	// Auto-resize textarea
	const inputLength = input.length
	useEffect(() => {
		if (inputLength < 0) return
		if (textareaRef.current) {
			textareaRef.current.style.height = 'auto'
			textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`
		}
	}, [inputLength])

	useEffect(() => {
		if (!isStreaming) return
		const interval = window.setInterval(() => setNowMs(Date.now()), 1000)
		return () => window.clearInterval(interval)
	}, [isStreaming])

	const selectedEditorFeatures = useMemo(() => {
		if (selectedFeatureIds.length === 0) return []
		const selectedIds = new Set(selectedFeatureIds)
		return editorFeatures.filter((feature) => selectedIds.has(feature.id))
	}, [editorFeatures, selectedFeatureIds])
	const selectedPolygonCount = useMemo(
		() =>
			selectedEditorFeatures.filter(
				(feature) =>
					feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
			).length,
		[selectedEditorFeatures],
	)

	useEffect(() => {
		if (selectedEditorFeatures.length > 0) return
		setSelectionContextEnabled(false)
	}, [selectedEditorFeatures.length])

	useEffect(() => {
		void activeChatId
		setAttachedGeometry(null)
		// WR-02: evict any not-yet-sent attached datasets before dropping the list,
		// so switching/clearing chats doesn't leave their `fullRows` resident in the
		// session-only ingest store. (Sent datasets are cleared without eviction in
		// `handleSubmit` because the placement tools still need their handles.)
		setAttachedFiles((prev) => {
			for (const file of prev) {
				if (file.summary?.handleId) evictDataset(file.summary.handleId)
			}
			return []
		})
		setSendAnyway(false)
		setSelectionContextEnabled(false)
	}, [activeChatId])

	// D-09: resolve the single vision verdict for the selected model. The same
	// ladder result gates user-attached images here AND the autonomous
	// capture_map_snapshot one-shot in the store (cached per model, so free).
	useEffect(() => {
		if (!selectedModel) {
			setVisionSupport('no-vision')
			return
		}
		let cancelled = false
		const providerConfig = resolveProvider(provider, providerOverrides)
		void detectVisionSupport(providerConfig, selectedModel).then((support) => {
			if (!cancelled) setVisionSupport(support)
		})
		return () => {
			cancelled = true
		}
	}, [provider, providerOverrides, selectedModel])

	const ensureChatWorkspace = () => {
		const store = useEditorStore.getState()
		if (store.activeWorkspaceId) {
			onSwitchWorkspace?.(store.activeWorkspaceId)
			return true
		}
		onStartNewDataset?.()
		return Boolean(useEditorStore.getState().activeWorkspaceId)
	}

	const visionTier: ImageVisionTier = visionSupport
	const hasAttachedImage = useMemo(
		() => attachedFiles.some((file) => file.status === 'image'),
		[attachedFiles],
	)
	// Stamp the resolved vision tier onto image chips so their visual language
	// (amber-uncertain / dimmed-unsupported) tracks the gate (UI-SPEC Color).
	const displayedFiles = useMemo(
		() => attachedFiles.map((file) => (file.status === 'image' ? { ...file, visionTier } : file)),
		[attachedFiles, visionTier],
	)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		if (!input.trim() || isStreaming) return

		const message = input.trim()
		const geometryContextMessage = attachedGeometry
			? buildAttachedGeometryContextMessage(attachedGeometry)
			: undefined
		// D-11/D-08/D-09: compose the outbound content — datasets as
		// {ingestHandle, ingestSummary} (never fullRows) + gated image parts.
		const composedContent =
			attachedFiles.length > 0
				? composeOutboundContent({
						text: message,
						attachedFiles,
						visionSupport,
						sendAnyway,
					})
				: undefined
		setInput('')
		if (!ensureChatWorkspace()) return
		await sendMessage(message, {
			referenceContextMessage: buildReferenceContextMessage(references),
			selectionContextMessage: selectionContextEnabled
				? buildSelectedGeometryContextMessage(selectedEditorFeatures)
				: undefined,
			geometryContextMessage,
			geometryAttachment: attachedGeometry,
			composedContent,
		})
		if (geometryContextMessage) {
			setAttachedGeometry(null)
		}
		if (attachedFiles.length > 0) {
			setAttachedFiles([])
			setSendAnyway(false)
		}
	}

	const bindActiveWorkspaceChat = (chatId: string | null) => {
		if (!activeWorkspaceId || !chatId) return
		updateWorkspace(activeWorkspaceId, { chatSessionId: chatId })
	}

	const handleCreateChat = () => {
		if (isStreaming) return
		createChat()
		const nextChatId = useChatStore.getState().activeChatId
		bindActiveWorkspaceChat(nextChatId)
	}

	const handleSwitchChat = (chatId: string) => {
		if (isStreaming) return
		switchChat(chatId)
		bindActiveWorkspaceChat(chatId)
	}

	const handleDeleteChat = () => {
		if (!activeChatId || isStreaming) return
		deleteChat(activeChatId)
		bindActiveWorkspaceChat(useChatStore.getState().activeChatId)
	}

	const handleExportConversation = async () => {
		if (messages.length === 0) {
			toast.error('Nothing to export yet')
			return
		}
		const dump = buildConversationDump({
			exportedAt: Date.now(),
			activeChat: activeChatSession,
			messages,
			references,
			provider,
			providerOverrides,
			selectedModel,
			models,
			toolsEnabled,
			diagnostics: diagnostics as unknown as Record<string, unknown>,
		})
		const json = serializeConversationDump(dump)

		// Default to copying the JSON to the clipboard...
		let copied = false
		try {
			await navigator.clipboard.writeText(json)
			copied = true
		} catch (clipboardError) {
			console.error('Failed to copy conversation dump', clipboardError)
		}

		// ...AND offer a .json download (Blob + object URL, dependency-free).
		try {
			const blob = new Blob([json], { type: 'application/json' })
			const url = URL.createObjectURL(blob)
			const anchor = document.createElement('a')
			anchor.href = url
			anchor.download = buildConversationDumpFilename(dump)
			document.body.appendChild(anchor)
			anchor.click()
			anchor.remove()
			URL.revokeObjectURL(url)
		} catch (downloadError) {
			console.error('Failed to download conversation dump', downloadError)
			if (!copied) {
				toast.error('Failed to export conversation')
				return
			}
		}

		toast.success(copied ? 'Conversation copied & downloaded' : 'Conversation downloaded')
	}

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault()
			handleSubmit(e)
		}
	}

	const handleExamplePromptClick = (prompt: string) => {
		setInput(prompt)
		window.requestAnimationFrame(() => {
			textareaRef.current?.focus()
		})
	}

	const handleAddReference = (result: EntitySearchResult) => {
		const key = getEntityReferenceKey(result)
		const nextReference: ChatReference = {
			id: result.id,
			name: result.name,
			type: result.type,
			subtitle: result.subtitle,
			address: result.address,
			pubkey: result.pubkey,
			createdAt: result.createdAt,
		}
		if (references.some((reference) => getChatReferenceKey(reference) === key)) return
		setReferences([...references, nextReference])
	}

	const handleRemoveReference = (referenceKey: string) => {
		setReferences(references.filter((reference) => getChatReferenceKey(reference) !== referenceKey))
	}

	const handleClearReferences = () => {
		setReferences([])
	}

	const selectedModelData = models.find((m) => m.id === selectedModel)
	const sortedChatSessions = useMemo(
		() => [...chatSessions].sort((a, b) => b.updatedAt - a.updatedAt),
		[chatSessions],
	)
	const activeChatSession = useMemo(
		() => sortedChatSessions.find((chat) => chat.id === activeChatId) ?? null,
		[activeChatId, sortedChatSessions],
	)
	const selectedModelLabel = selectedModelData?.name ?? 'No model selected'
	const providerLabel = PROVIDER_LABELS[provider]
	const isWalletRequired = provider === 'routstr'
	const canSend = !!selectedModel && (!isWalletRequired || walletStatus === 'ready')
	const handleOpenSettings = () => {
		if (onOpenSettings) {
			onOpenSettings()
			return
		}
		if (isMobile) {
			setMobilePanelTab('settings')
			setMobilePanelOpen(true)
			return
		}
		navigateToRoute('/settings')
	}
	const stalledSeconds =
		isStreaming && lastProgressAt ? Math.max(0, Math.floor((nowMs - lastProgressAt) / 1000)) : 0
	const phaseLabel = useMemo(() => {
		switch (streamPhase) {
			case 'requesting':
				return 'Requesting model'
			case 'streaming':
				return 'Streaming response'
			case 'executing_tools':
				return 'Executing tools'
			case 'recovering_context':
				return 'Recovering context'
			case 'finalizing':
				return 'Finalizing'
			default:
				return 'Idle'
		}
	}, [streamPhase])
	const contextTokenDisplay =
		diagnostics.effectiveContextTokens ?? selectedModelData?.contextLength ?? null
	// Pair each run_code tool call (which carries the source `code` argument) with
	// its later role:'tool' result message by tool_call_id, so MessageBubble can
	// render the source + output together as a single CodeRunDisclosure block
	// (D-07: one block per result message keeps each self-correction retry distinct).
	const runCodeSourceByCallId = useMemo(() => {
		const map = new Map<string, string>()
		for (const message of messages) {
			if (message.role !== 'assistant' || !message.tool_calls) continue
			for (const call of message.tool_calls) {
				if (call.function.name !== 'run_code') continue
				let source = ''
				try {
					const args = JSON.parse(call.function.arguments) as { code?: unknown }
					if (typeof args.code === 'string') source = args.code
				} catch {
					source = ''
				}
				map.set(call.id, source)
			}
		}
		return map
	}, [messages])
	const renderedMessages = useMemo(() => {
		const seen = new Map<string, number>()
		return messages.map((message) => {
			const contentPreview = contentToDisplayText(message.content).slice(0, 80)
			const toolCallKey = message.tool_calls?.map((call) => call.id).join(',') ?? ''
			const baseKey = `${message.role}|${message.tool_call_id ?? ''}|${toolCallKey}|${contentPreview}`
			const nextCount = (seen.get(baseKey) ?? 0) + 1
			seen.set(baseKey, nextCount)
			return {
				message,
				key: `${baseKey}|${nextCount}`,
			}
		})
	}, [messages])

	return (
		<div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
			{/* Header with provider, model picker and wallet info */}
			<div className="p-3 border-b space-y-2">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="h-8 text-xs"
						onClick={handleCreateChat}
						disabled={isStreaming}
					>
						New chat
					</Button>
					<Select
						value={activeChatId ?? ''}
						onValueChange={handleSwitchChat}
						disabled={isStreaming}
					>
						<SelectTrigger className="h-8 min-w-0 flex-1 text-xs">
							{activeChatSession ? (
								<div className="flex min-w-0 items-center gap-2">
									<span className="min-w-0 flex-1 truncate text-left">
										{activeChatSession.title}
									</span>
									<span className="shrink-0 text-[10px] text-muted-foreground">
										{new Date(activeChatSession.updatedAt).toLocaleTimeString()}
									</span>
								</div>
							) : (
								<span className="truncate text-muted-foreground">Select chat</span>
							)}
						</SelectTrigger>
						<SelectContent>
							{sortedChatSessions.map((chat) => (
								<SelectItem key={chat.id} value={chat.id}>
									<div className="flex min-w-0 items-center gap-2">
										<span className="truncate">{chat.title}</span>
										<span className="shrink-0 text-[10px] text-muted-foreground">
											{new Date(chat.updatedAt).toLocaleTimeString()}
										</span>
									</div>
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={handleExportConversation}
						disabled={messages.length === 0}
						title="Export conversation (copy JSON + download .json)"
						aria-label="Export conversation"
					>
						<Bug className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={handleDeleteChat}
						disabled={!activeChatId || isStreaming}
						title="Delete chat"
					>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>

				<div className="flex items-center gap-2">
					<div className="flex min-w-0 flex-1 items-center gap-2 rounded-md border bg-muted/20 px-2.5 py-2">
						<Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<div className="min-w-0">
							<p className="flex items-center gap-1.5 truncate text-xs font-medium">
								<span className="truncate">{providerLabel}</span>
								{provider === 'routstr' ? <DangerIndicator /> : null}
								<span className="shrink-0">·</span>
								<span className="truncate">{selectedModelLabel}</span>
							</p>
							<p className="truncate text-[11px] text-muted-foreground">
								Configure provider, model, tools, and credentials in Settings
							</p>
						</div>
					</div>
					<Button
						type="button"
						variant="outline"
						size="icon"
						onClick={handleOpenSettings}
						title="Open chat settings"
						aria-label="Open chat settings"
					>
						<Settings2 className="h-4 w-4" />
					</Button>
				</div>

				{/* Wallet status / provider info and tools toggle */}
				<div className="flex items-center justify-between text-sm">
					{isWalletRequired ? (
						<div className="flex items-center gap-1.5 text-muted-foreground">
							<Wallet className="h-3.5 w-3.5" />
							{walletStatus === 'ready' ? (
								<span>{walletBalance.toLocaleString()} sats</span>
							) : (
								<span className="text-destructive">Wallet not connected</span>
							)}
						</div>
					) : (
						<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<Server className="h-3.5 w-3.5" />
							<span>Local - free</span>
						</div>
					)}
					{totalSpent > 0 ? (
						<span className="text-xs text-muted-foreground">Spent: {totalSpent} sats</span>
					) : (
						<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
							<MapPin className="h-3 w-3" />
							<span>Tools {toolsEnabled ? 'enabled' : 'disabled'}</span>
						</div>
					)}
				</div>

				{/* Bound-target chip + "Just accept" toggle — always visible (SAFE-01 / SAFE-04 / D-12) */}
				<BindingChipContainer />

				{/* Diagnostics */}
				<div className="min-w-0">
					<div className="flex min-w-0 flex-wrap items-center gap-1 pb-0.5 text-[11px] text-muted-foreground">
						{contextTokenDisplay ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								{diagnostics.effectiveContextTokens ? 'ctx' : 'ctx(model)'}{' '}
								{contextTokenDisplay.toLocaleString()}
							</span>
						) : null}
						{diagnostics.promptBudgetTokens ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								prompt budget {diagnostics.promptBudgetTokens.toLocaleString()}
							</span>
						) : null}
						{diagnostics.estimatedPromptTokens ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								~prompt {diagnostics.estimatedPromptTokens.toLocaleString()} tok
							</span>
						) : null}
						{diagnostics.estimatedCompletionTokens ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								~completion {diagnostics.estimatedCompletionTokens.toLocaleString()} tok
							</span>
						) : null}
						{diagnostics.finishReason ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								finish {diagnostics.finishReason}
							</span>
						) : null}
						{diagnostics.toolCallCount > 0 ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								tools {diagnostics.toolCallCount}
							</span>
						) : null}
						{isStreaming ? (
							<span className="max-w-full rounded border px-1.5 py-0.5 break-words">
								{phaseLabel}
								{stalledSeconds > 0 ? ` · ${stalledSeconds}s` : ''}
							</span>
						) : null}
					</div>
				</div>

				{/* Errors */}
				{modelsError && (
					<div className="flex items-center gap-1.5 text-xs text-destructive">
						<AlertCircle className="h-3.5 w-3.5" />
						{modelsError}
						<Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={loadModels}>
							Retry
						</Button>
					</div>
				)}
			</div>

			{/* Messages */}
			<div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-3">
				{messages.length === 0 && !isStreaming ? (
					<div className="h-full flex flex-col items-center justify-center text-center text-muted-foreground p-4">
						<Bot className="h-12 w-12 mb-4 opacity-50" />
						<p className="text-sm font-medium">AI Chat</p>
						<p className="text-xs mt-1">
							{isWalletRequired
								? 'Pay per message with eCash. Unused funds are refunded automatically.'
								: 'Running locally \u2014 no payment required.'}
						</p>
						{selectedModelData && <p className="text-xs mt-2">Using {selectedModelData.name}</p>}
						{toolsEnabled && (
							<p className="text-xs mt-2 text-orange-600 dark:text-orange-400">
								<MapPin className="inline h-3 w-3 mr-1" />
								Tools enabled (geo search, OSM queries, web search, and Wikipedia)
							</p>
						)}
						<div className="mt-4 w-full max-w-xl rounded-lg border bg-muted/30 p-3 text-left">
							<p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
								Try an example prompt
							</p>
							<div className="grid gap-2 sm:grid-cols-2">
								{EMPTY_STATE_PROMPTS.map((prompt) => (
									<button
										key={prompt}
										type="button"
										onClick={() => handleExamplePromptClick(prompt)}
										className="rounded-md border bg-background px-2.5 py-2 text-left text-xs text-foreground transition-colors hover:bg-muted"
									>
										{prompt}
									</button>
								))}
							</div>
						</div>
					</div>
				) : (
					<>
						{renderedMessages.map(({ message, key }) => (
							<MessageBubble
								key={key}
								message={message}
								runCodeSourceByCallId={runCodeSourceByCallId}
							/>
						))}

						{/* Streaming message */}
						{isStreaming && streamingContent && (
							<MessageBubble
								message={{ role: 'assistant', content: streamingContent }}
								isStreaming
							/>
						)}

						{/* Streaming/executing indicator */}
						{isStreaming && !streamingContent && (
							<div className="flex gap-2">
								<div
									className={cn(
										'flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center',
										executingTools ? 'bg-orange-100 dark:bg-orange-900' : 'bg-muted',
									)}
								>
									{executingTools ? (
										<Wrench className="h-3.5 w-3.5 text-orange-600 dark:text-orange-400" />
									) : (
										<Bot className="h-3.5 w-3.5" />
									)}
								</div>
								<div
									className={cn(
										'rounded-lg px-3 py-2 text-sm flex items-center gap-2',
										executingTools
											? 'bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800'
											: 'bg-muted',
									)}
								>
									<span className="animate-pulse">{phaseLabel}...</span>
									<Loader2 className="h-4 w-4 animate-spin" />
								</div>
							</div>
						)}

						{isStreaming && streamWarning && (
							<div className="flex gap-2">
								<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-amber-100 dark:bg-amber-900">
									<AlertCircle className="h-3.5 w-3.5 text-amber-700 dark:text-amber-300" />
								</div>
								<div className="rounded-lg px-3 py-2 text-xs bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
									<div>{streamWarning}</div>
									<div className="mt-1 flex items-center gap-2">
										<span className="opacity-80">last update {stalledSeconds}s ago</span>
										<Button type="button" size="sm" variant="outline" onClick={cancelStream}>
											Stop
										</Button>
									</div>
								</div>
							</div>
						)}

						<div ref={messagesEndRef} />
					</>
				)}
			</div>

			{/* Error display */}
			{error && (
				<div className="px-3 py-2 text-xs text-destructive bg-destructive/10 border-t">{error}</div>
			)}

			{/* Input */}
			<form onSubmit={handleSubmit} className="shrink-0 border-t p-3">
				<div className="space-y-2">
					<div className="flex flex-wrap items-start gap-2">
						<EntityReferenceToolbar
							sources={{
								datasets: geoEvents,
								contexts: mapContextEvents,
								features: availableFeatures,
							}}
							references={references.map(chatReferenceToSearchResult)}
							onAddReference={handleAddReference}
							onRemoveReference={handleRemoveReference}
							onClearReferences={handleClearReferences}
							searchMode="both"
							getDatasetName={getDatasetName}
							placeholder="Add geometry, dataset, or context references..."
							className="min-w-0 flex-1"
						/>
						<Button
							type="button"
							variant={selectionContextEnabled ? 'default' : 'outline'}
							size="sm"
							className="h-8 shrink-0 gap-1.5 text-xs"
							onClick={() => setSelectionContextEnabled((prev) => !prev)}
							disabled={selectedEditorFeatures.length === 0}
							title={
								selectedEditorFeatures.length === 0
									? 'Select one or more map features first'
									: 'Attach current selection as spatial chat context'
							}
						>
							{selectionContextEnabled ? (
								<ToggleRight className="h-3.5 w-3.5" />
							) : (
								<ToggleLeft className="h-3.5 w-3.5" />
							)}
							Select
						</Button>
						<ChatGeometryAttachment
							key={activeChatId ?? 'chat-geometry'}
							value={attachedGeometry}
							onChange={setAttachedGeometry}
							layout="detached"
							panelClassName="w-full"
						/>
						<FileChipStrip
							files={displayedFiles}
							onChange={setAttachedFiles}
							visionTier={visionTier}
						/>
						<VisionGateControl
							support={visionSupport}
							modelLabel={selectedModelLabel}
							hasImage={hasAttachedImage}
							sendAnyway={sendAnyway}
							onSendAnywayChange={setSendAnyway}
						/>
						{(selectedEditorFeatures.length > 0 || attachedGeometry) && (
							<div className="basis-full text-[11px] text-muted-foreground">
								{selectedEditorFeatures.length > 0 && (
									<span>
										{selectedEditorFeatures.length} selected
										{selectedPolygonCount > 0
											? ` · ${selectedPolygonCount} polygon${selectedPolygonCount === 1 ? '' : 's'}`
											: ''}
									</span>
								)}
								{selectedEditorFeatures.length > 0 && attachedGeometry ? <span> · </span> : null}
								{attachedGeometry ? (
									<span>{attachedGeometry.features.length} drawn attached</span>
								) : null}
							</div>
						)}
					</div>
					<div className="flex gap-2">
						<textarea
							ref={textareaRef}
							value={input}
							onChange={(e) => setInput(e.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={
								!selectedModel
									? 'Select a model...'
									: isWalletRequired && walletStatus !== 'ready'
										? 'Connect wallet to chat...'
										: 'Type a message...'
							}
							disabled={isStreaming || !canSend}
							className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 min-h-[38px] max-h-[150px]"
							rows={1}
						/>
						{isStreaming ? (
							<Button
								type="button"
								variant="destructive"
								size="icon"
								onClick={cancelStream}
								title="Stop"
							>
								<span className="h-3 w-3 bg-current" />
							</Button>
						) : (
							<Button type="submit" size="icon" disabled={!input.trim() || !canSend} title="Send">
								<Send className="h-4 w-4" />
							</Button>
						)}
					</div>
				</div>
			</form>
		</div>
	)
}

function getChatReferenceKey(reference: ChatReference): string {
	const stableId = reference.id || reference.name || 'unknown'
	return `${reference.type}:${stableId}:${reference.pubkey ?? ''}`
}

function chatReferenceToSearchResult(reference: ChatReference): EntitySearchResult {
	return {
		id: reference.id,
		name: reference.name,
		type: reference.type,
		subtitle: reference.subtitle,
		address: reference.address,
		pubkey: reference.pubkey,
		createdAt: reference.createdAt,
		entity: reference as unknown as GeoFeatureItem,
	}
}

function buildReferenceContextMessage(references: ChatReference[]): string | undefined {
	if (references.length === 0) return undefined
	const lines = references.map((reference, index) => {
		const parts = [
			`${index + 1}. type=${reference.type}`,
			`name="${reference.name}"`,
			reference.subtitle ? `subtitle="${reference.subtitle}"` : null,
			reference.address ? `address="${reference.address}"` : null,
			reference.pubkey ? `pubkey="${reference.pubkey}"` : null,
			reference.createdAt ? `createdAt=${reference.createdAt}` : null,
		].filter(Boolean)
		return parts.join(' | ')
	})
	return [
		'The user attached the following entity references for this request.',
		'Use them as high-priority context and as likely targets for inspection, comparison, or editing.',
		'If a reference needs verification or expansion, use tools to inspect it before making destructive changes.',
		...lines,
	].join('\n')
}

function buildSelectedGeometryContextMessage(
	selectedFeatures: EditorFeature[],
): string | undefined {
	if (selectedFeatures.length === 0) return undefined

	const polygonCount = selectedFeatures.filter(
		(feature) => feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
	).length
	const lines = selectedFeatures.slice(0, 8).map((feature, index) => {
		const properties = feature.properties as Record<string, unknown> | undefined
		const featureName = typeof properties?.name === 'string' ? properties.name : null
		const featureType = typeof properties?.featureType === 'string' ? properties.featureType : null
		return [
			`${index + 1}. id=${feature.id}`,
			`geometry=${feature.geometry?.type ?? 'Unknown'}`,
			featureName ? `name="${featureName}"` : null,
			featureType ? `featureType="${featureType}"` : null,
		]
			.filter(Boolean)
			.join(' | ')
	})

	return [
		'The user explicitly attached the current editor selection as context for this request.',
		polygonCount > 0
			? 'Treat the selected polygon or multipolygon features as the active area of interest. For area-constrained OSM lookup, prefer query_osm_area with selectedOnly=true.'
			: 'Treat the selected features as high-priority context for inspection or follow-up tool calls.',
		'Do not ask the user to redraw or re-describe the selection unless no selected geometry remains.',
		`Selected feature count: ${selectedFeatures.length}. Polygon area count: ${polygonCount}.`,
		'Selection summary:',
		...lines,
	].join('\n')
}

function buildAttachedGeometryContextMessage(geojson: FeatureCollection): string | undefined {
	if (geojson.features.length === 0) return undefined

	const featureSummary = geojson.features.slice(0, 8).map((feature, index) => {
		const properties = feature.properties as Record<string, unknown> | undefined
		const featureType = typeof properties?.featureType === 'string' ? properties.featureType : null
		const featureName =
			typeof properties?.name === 'string'
				? properties.name
				: typeof properties?.text === 'string'
					? properties.text
					: null
		return [
			`${index + 1}. geometry=${feature.geometry?.type ?? 'Unknown'}`,
			featureType ? `featureType="${featureType}"` : null,
			featureName ? `label="${featureName}"` : null,
		]
			.filter(Boolean)
			.join(' | ')
	})

	const geojsonText = JSON.stringify(geojson)
	const truncatedGeojsonText =
		geojsonText.length > 4000 ? `${geojsonText.slice(0, 4000)}...[truncated]` : geojsonText

	return [
		'The user attached transient chat geometry for this request.',
		'This geometry is scratch context only. It is not canonical map data and was intentionally kept out of the editor dataset.',
		'If the geometry is a polygon area, prefer query_osm_area. The tool executor can use the attached geometry directly for this request even if no editor feature is selected.',
		'If the geometry is points, lines, or annotations, use it as spatial guidance and explain any assumptions.',
		`Attached feature count: ${geojson.features.length}.`,
		'Attachment summary:',
		...featureSummary,
		`Attached GeoJSON JSON:\n${truncatedGeojsonText}`,
	].join('\n')
}

interface MessageBubbleProps {
	message: ChatMessage
	isStreaming?: boolean
	/** Maps a run_code tool_call_id → its source `code`, so the result bubble can
	 * pair source + output into one CodeRunDisclosure block (D-07/D-09). */
	runCodeSourceByCallId?: Map<string, string>
}

interface ParsedAssistantContent {
	answerText: string
	reasoningBlocks: string[]
}

interface ChatMarkdownTextToken {
	type: 'text'
	value: string
}

interface ChatMarkdownStrongToken {
	type: 'strong'
	value: string
}

interface ChatMarkdownEmphasisToken {
	type: 'emphasis'
	value: string
}

interface ChatMarkdownCodeToken {
	type: 'code'
	value: string
}

interface ChatMarkdownLinkToken {
	type: 'link'
	value: string
	url: string
}

type ChatMarkdownInlineToken =
	| ChatMarkdownTextToken
	| ChatMarkdownStrongToken
	| ChatMarkdownEmphasisToken
	| ChatMarkdownCodeToken
	| ChatMarkdownLinkToken

interface ChatMarkdownParagraphBlock {
	type: 'paragraph'
	tokens: ChatMarkdownInlineToken[]
}

interface ChatMarkdownHeadingBlock {
	type: 'heading'
	level: number
	tokens: ChatMarkdownInlineToken[]
}

interface ChatMarkdownQuoteBlock {
	type: 'quote'
	tokens: ChatMarkdownInlineToken[]
}

interface ChatMarkdownListBlock {
	type: 'list'
	ordered: boolean
	items: ChatMarkdownInlineToken[][]
}

interface ChatMarkdownCodeBlock {
	type: 'codeblock'
	code: string
}

type ChatMarkdownBlock =
	| ChatMarkdownParagraphBlock
	| ChatMarkdownHeadingBlock
	| ChatMarkdownQuoteBlock
	| ChatMarkdownListBlock
	| ChatMarkdownCodeBlock

const CHAT_MARKDOWN_TOKEN_PATTERN =
	/(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<>"{}|\\^`[\]]+)|(`[^`]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)/gi

function contentToDisplayText(content: ChatMessage['content']): string {
	if (typeof content === 'string') return content
	if (!content) return ''

	return content
		.map((part) => {
			if (part.type === 'text') {
				// Slice A: a dataset attachment part is the `{ ingestHandle, ingestSummary }`
				// JSON; it renders as a file card, never as inline text. Surface a compact
				// placeholder in plain-text contexts (copy, previews) instead of the blob.
				const dataset = parseIngestHandlePart(part.text)
				if (dataset) return `[Attached dataset: ${dataset.ingestSummary.fileName}]`
				return part.text
			}
			if (part.type === 'image_url') return '[Image]'
			return ''
		})
		.filter((part) => part.length > 0)
		.join('\n')
}

/**
 * Slice A (ingest + attachment rethink, Move 1): split a user message's content
 * into the prose text (concatenated, markdown-rendered) and the attached-dataset
 * summaries (rendered as collapsible `AttachmentCard`s — NOT as raw JSON text).
 * A plain-string message has no attachments; a parts array may interleave both.
 * The model payload is untouched — this is a pure display-side decoupling.
 */
function splitUserMessageContent(content: ChatMessage['content']): {
	text: string
	datasets: IngestSummary[]
} {
	if (typeof content === 'string') return { text: content, datasets: [] }
	if (!content) return { text: '', datasets: [] }

	const textParts: string[] = []
	const datasets: IngestSummary[] = []
	for (const part of content) {
		if (part.type === 'text') {
			const dataset = parseIngestHandlePart(part.text)
			if (dataset) {
				datasets.push(dataset.ingestSummary)
				continue
			}
			if (part.text.length > 0) textParts.push(part.text)
			continue
		}
		if (part.type === 'image_url') {
			textParts.push('[Image]')
		}
	}
	return { text: textParts.join('\n'), datasets }
}

/**
 * D-16: the tool registry serializes a `ToolError` into the role:'tool' content
 * envelope. Try to recover it so the chat UI can render failures distinctly.
 * Returns null for normal (non-error) tool output.
 */
function parseToolErrorContent(content: string): ToolError | null {
	const trimmed = content.trim()
	if (!trimmed.startsWith('{')) return null
	try {
		const parsed = JSON.parse(trimmed)
		return isToolError(parsed) ? parsed : null
	} catch {
		return null
	}
}

function parseChatMarkdownInlineTokens(text: string): ChatMarkdownInlineToken[] {
	if (!text) return []

	const tokens: ChatMarkdownInlineToken[] = []
	let cursor = 0
	const matches = Array.from(text.matchAll(CHAT_MARKDOWN_TOKEN_PATTERN))

	for (const match of matches) {
		const matchedValue = match[0]
		if (!matchedValue) continue

		if (match.index > cursor) {
			tokens.push({
				type: 'text',
				value: text.slice(cursor, match.index),
			})
		}

		if (match[1] && match[2]) {
			const linkLabel = matchedValue.slice(1, matchedValue.indexOf(']('))
			tokens.push({
				type: 'link',
				value: linkLabel,
				url: match[2],
			})
		} else if (match[3]) {
			const cleanUrl = match[3].replace(/[.,;:!?)]+$/, '')
			tokens.push({
				type: 'link',
				value: cleanUrl,
				url: cleanUrl,
			})
		} else if (match[4]) {
			tokens.push({
				type: 'code',
				value: match[4].slice(1, -1),
			})
		} else if (match[5]) {
			tokens.push({
				type: 'strong',
				value: match[5].slice(2, -2),
			})
		} else if (match[6]) {
			tokens.push({
				type: 'emphasis',
				value: match[6].slice(1, -1),
			})
		}

		cursor = match.index + matchedValue.length
	}

	if (cursor < text.length) {
		tokens.push({
			type: 'text',
			value: text.slice(cursor),
		})
	}

	return tokens
}

function pushChatMarkdownParagraph(lines: string[], blocks: ChatMarkdownBlock[]) {
	if (lines.length === 0) return
	blocks.push({
		type: 'paragraph',
		tokens: parseChatMarkdownInlineTokens(lines.join(' ')),
	})
	lines.length = 0
}

function parseChatMarkdown(text: string): ChatMarkdownBlock[] {
	const trimmed = text.trim()
	if (!trimmed) return []

	const lines = text.split('\n')
	const blocks: ChatMarkdownBlock[] = []
	const paragraphLines: string[] = []
	let activeList: ChatMarkdownListBlock | null = null
	let inCodeBlock = false
	const codeLines: string[] = []

	const flushList = () => {
		if (!activeList) return
		blocks.push(activeList)
		activeList = null
	}

	const flushCodeBlock = () => {
		if (!inCodeBlock) return
		blocks.push({
			type: 'codeblock',
			code: codeLines.join('\n'),
		})
		inCodeBlock = false
		codeLines.length = 0
	}

	for (const rawLine of lines) {
		const line = rawLine.trimEnd()
		const trimmedLine = line.trim()

		if (trimmedLine.startsWith('```')) {
			pushChatMarkdownParagraph(paragraphLines, blocks)
			flushList()
			if (inCodeBlock) {
				flushCodeBlock()
			} else {
				inCodeBlock = true
			}
			continue
		}

		if (inCodeBlock) {
			codeLines.push(line)
			continue
		}

		if (!trimmedLine) {
			pushChatMarkdownParagraph(paragraphLines, blocks)
			flushList()
			continue
		}

		const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/)
		if (headingMatch?.[1] && headingMatch[2]) {
			pushChatMarkdownParagraph(paragraphLines, blocks)
			flushList()
			blocks.push({
				type: 'heading',
				level: headingMatch[1].length,
				tokens: parseChatMarkdownInlineTokens(headingMatch[2]),
			})
			continue
		}

		const quoteMatch = trimmedLine.match(/^>\s?(.*)$/)
		if (quoteMatch) {
			pushChatMarkdownParagraph(paragraphLines, blocks)
			flushList()
			blocks.push({
				type: 'quote',
				tokens: parseChatMarkdownInlineTokens(quoteMatch[1]),
			})
			continue
		}

		const orderedListMatch = trimmedLine.match(/^\d+\.\s+(.+)$/)
		const unorderedListMatch = trimmedLine.match(/^[-*]\s+(.+)$/)
		const listItemText = orderedListMatch?.[1] ?? unorderedListMatch?.[1]
		if (listItemText) {
			pushChatMarkdownParagraph(paragraphLines, blocks)
			const ordered = Boolean(orderedListMatch)
			if (!activeList || activeList.ordered !== ordered) {
				flushList()
				activeList = {
					type: 'list',
					ordered,
					items: [],
				}
			}
			activeList.items.push(parseChatMarkdownInlineTokens(listItemText))
			continue
		}

		flushList()
		paragraphLines.push(trimmedLine)
	}

	pushChatMarkdownParagraph(paragraphLines, blocks)
	flushList()
	flushCodeBlock()

	return blocks
}

function getChatMarkdownInlineTokenSignature(token: ChatMarkdownInlineToken): string {
	if (token.type === 'link') {
		return `${token.type}:${token.value}:${token.url}`
	}
	return `${token.type}:${token.value}`
}

function getChatMarkdownBlockSignature(block: ChatMarkdownBlock): string {
	if (block.type === 'paragraph' || block.type === 'quote') {
		return `${block.type}:${block.tokens
			.map((token) => getChatMarkdownInlineTokenSignature(token))
			.join('|')}`
	}
	if (block.type === 'heading') {
		return `heading:${block.level}:${block.tokens
			.map((token) => getChatMarkdownInlineTokenSignature(token))
			.join('|')}`
	}
	if (block.type === 'list') {
		return `list:${block.ordered}:${block.items
			.map((item) => item.map((token) => getChatMarkdownInlineTokenSignature(token)).join('|'))
			.join('||')}`
	}
	return `codeblock:${block.code}`
}

function renderChatMarkdownInlineToken(
	token: ChatMarkdownInlineToken,
	variant: 'assistant' | 'user',
	key: string,
) {
	if (token.type === 'text') {
		return (
			<span key={key} className="whitespace-pre-wrap break-words">
				{token.value}
			</span>
		)
	}

	if (token.type === 'strong') {
		return (
			<strong key={key} className="font-semibold">
				{token.value}
			</strong>
		)
	}

	if (token.type === 'emphasis') {
		return (
			<em key={key} className="italic">
				{token.value}
			</em>
		)
	}

	if (token.type === 'code') {
		return (
			<code
				key={key}
				className={cn(
					'rounded px-1.5 py-0.5 font-mono text-[0.9em]',
					variant === 'assistant'
						? 'bg-background/90 text-foreground'
						: 'bg-primary-foreground/15 text-primary-foreground',
				)}
			>
				{token.value}
			</code>
		)
	}

	return (
		<a
			key={key}
			href={token.url}
			target="_blank"
			rel="noopener noreferrer"
			className={cn(
				'break-all underline underline-offset-2',
				variant === 'assistant'
					? 'text-blue-700 hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200'
					: 'text-primary-foreground hover:text-primary-foreground/85',
			)}
		>
			{token.value}
		</a>
	)
}

function renderChatMarkdownInlineTokens(
	tokens: ChatMarkdownInlineToken[],
	variant: 'assistant' | 'user',
) {
	const seen = new Map<string, number>()
	return tokens.map((token) => {
		const signature = getChatMarkdownInlineTokenSignature(token)
		const nextCount = (seen.get(signature) ?? 0) + 1
		seen.set(signature, nextCount)
		return renderChatMarkdownInlineToken(token, variant, `${signature}:${nextCount}`)
	})
}

function ChatMarkdownContent({
	content,
	variant,
}: {
	content: string
	variant: 'assistant' | 'user'
}) {
	const blocks = useMemo(() => parseChatMarkdown(content), [content])
	const keyedBlocks = useMemo(() => {
		const seen = new Map<string, number>()
		return blocks.map((block) => {
			const signature = getChatMarkdownBlockSignature(block)
			const nextCount = (seen.get(signature) ?? 0) + 1
			seen.set(signature, nextCount)
			return {
				block,
				key: `${signature}:${nextCount}`,
			}
		})
	}, [blocks])

	if (keyedBlocks.length === 0) return null

	return (
		<div className="space-y-3 leading-relaxed">
			{keyedBlocks.map(({ block, key }) => {
				if (block.type === 'paragraph') {
					return (
						<p key={key} className="break-words [overflow-wrap:anywhere]">
							{renderChatMarkdownInlineTokens(block.tokens, variant)}
						</p>
					)
				}

				if (block.type === 'heading') {
					const content = renderChatMarkdownInlineTokens(block.tokens, variant)
					if (block.level <= 2) {
						return (
							<h2 key={key} className="text-base font-semibold tracking-tight">
								{content}
							</h2>
						)
					}
					return (
						<h3 key={key} className="text-sm font-semibold tracking-tight">
							{content}
						</h3>
					)
				}

				if (block.type === 'quote') {
					return (
						<blockquote
							key={key}
							className={cn(
								'border-l-2 pl-3 italic',
								variant === 'assistant'
									? 'border-border/80 text-muted-foreground'
									: 'border-primary-foreground/40 text-primary-foreground/85',
							)}
						>
							{renderChatMarkdownInlineTokens(block.tokens, variant)}
						</blockquote>
					)
				}

				if (block.type === 'list') {
					const ListTag = block.ordered ? 'ol' : 'ul'
					const seenItems = new Map<string, number>()
					return (
						<ListTag
							key={key}
							className={cn('space-y-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}
						>
							{block.items.map((item) => {
								const signature = item
									.map((token) => getChatMarkdownInlineTokenSignature(token))
									.join('|')
								const nextCount = (seenItems.get(signature) ?? 0) + 1
								seenItems.set(signature, nextCount)
								return (
									<li key={`${signature}:${nextCount}`} className="pl-1 break-words">
										{renderChatMarkdownInlineTokens(item, variant)}
									</li>
								)
							})}
						</ListTag>
					)
				}

				return (
					<pre
						key={key}
						className={cn(
							'overflow-x-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed',
							variant === 'assistant'
								? 'border-border/80 bg-background/80 text-foreground'
								: 'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground',
						)}
					>
						<code>{block.code}</code>
					</pre>
				)
			})}
		</div>
	)
}

function MessageBubble({ message, isStreaming, runCodeSourceByCallId }: MessageBubbleProps) {
	const isUser = message.role === 'user'
	const isTool = message.role === 'tool'
	const isAssistant = message.role === 'assistant'
	const hasToolCalls =
		message.role === 'assistant' && message.tool_calls && message.tool_calls.length > 0
	const contentText = contentToDisplayText(message.content)
	const parsedAssistantContent: ParsedAssistantContent = useMemo(() => {
		if (!isAssistant) {
			return { answerText: contentText, reasoningBlocks: [] }
		}
		const parsed = parseAssistantContent(contentText)
		const explicitReasoning =
			typeof message.reasoning_content === 'string' ? message.reasoning_content.trim() : ''
		if (
			explicitReasoning &&
			!parsed.reasoningBlocks.some((block) => block.trim() === explicitReasoning)
		) {
			parsed.reasoningBlocks.push(explicitReasoning)
		}
		return parsed
	}, [isAssistant, contentText, message.reasoning_content])
	const tokenEstimate = estimateTokens(contentText || ' ')
	const bubbleCopyText = buildBubbleCopyText(message, parsedAssistantContent, contentText)

	// Tool result message
	if (isTool) {
		// D-16: a serialized ToolError (unknown tool or handler failure) renders
		// distinctly from normal tool output so failures are visible, not buried.
		const toolError = parseToolErrorContent(contentText)
		if (toolError) {
			return (
				<div className="ml-8 flex min-w-0 gap-2">
					<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-red-100 dark:bg-red-900">
						<AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" />
					</div>
					<div className="relative min-w-0 max-w-[85%] overflow-hidden rounded-lg border border-red-300/80 bg-red-50/80 px-3 py-2 text-xs dark:border-red-800/70 dark:bg-red-950/40">
						<div className="flex items-center gap-1.5 font-medium text-red-700 dark:text-red-300">
							<span>{toolError.kind === 'unknown_tool' ? 'Unknown tool' : 'Tool error'}:</span>
							<code className="rounded bg-red-100 px-1 py-0.5 text-[11px] dark:bg-red-900/60">
								{toolError.toolName}
							</code>
						</div>
						<div className="mt-1 break-words text-red-800 dark:text-red-200">
							{toolError.message}
						</div>
						{toolError.origin && (
							<div className="mt-1 text-[10px] text-red-600/80 dark:text-red-400/80">
								origin: {toolError.origin}
							</div>
						)}
					</div>
				</div>
			)
		}

		// run_code special-case (D-09/D-10/D-12): a successful run_code result renders
		// as the collapsible read-only code+output block. We pair the source (from the
		// matching assistant tool-call, looked up by tool_call_id) with the output
		// (this result message). Only run_code is rerouted; every other tool keeps the
		// generic ToolResultDisclosure path below. A failed run_code is a serialized
		// ToolError and was already handled by the red bubble above (D-11).
		const runCodeSource =
			message.tool_call_id !== undefined
				? runCodeSourceByCallId?.get(message.tool_call_id)
				: undefined
		if (runCodeSource !== undefined) {
			const runResult = parseRunCodeResult(contentText)
			if (runResult) {
				return (
					<div className="ml-8 flex min-w-0 gap-2">
						<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-violet-100 dark:bg-violet-900">
							<Code2 className="h-3 w-3 text-violet-600 dark:text-violet-400" />
						</div>
						<div className="min-w-0 max-w-[85%]">
							<CodeRunDisclosure source={runCodeSource} result={runResult} />
						</div>
					</div>
				)
			}
		}

		return (
			<div className="ml-8 flex min-w-0 gap-2">
				<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-blue-100 dark:bg-blue-900">
					<MapPin className="h-3 w-3 text-blue-600 dark:text-blue-400" />
				</div>
				<div className="min-w-0 max-w-[85%]">
					<ToolResultDisclosure content={contentText} tokenEstimate={tokenEstimate} />
				</div>
			</div>
		)
	}

	// Assistant message with tool calls
	if (hasToolCalls) {
		// run_code calls render their source inside the paired result block
		// (CodeRunDisclosure), so suppress them from the generic orange chip strip.
		const nonRunCodeCalls =
			message.tool_calls?.filter((tc) => tc.function.name !== 'run_code') ?? []
		return (
			<div className="min-w-0 space-y-2">
				{(parsedAssistantContent.answerText ||
					parsedAssistantContent.reasoningBlocks.length > 0) && (
					<div className="flex gap-2">
						<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-muted">
							<Bot className="h-3.5 w-3.5" />
						</div>
						<div className="min-w-0 max-w-[85%] space-y-2">
							{parsedAssistantContent.answerText && (
								<div className="relative rounded-lg px-3 py-2 text-sm bg-muted">
									<CopyBubbleButton
										text={bubbleCopyText}
										className="absolute right-1.5 top-1.5"
										title="Copy assistant message"
									/>
									<div className="pr-6">
										<ChatMarkdownContent
											content={parsedAssistantContent.answerText}
											variant="assistant"
										/>
									</div>
									<div className="mt-2 text-[10px] text-muted-foreground">
										~{tokenEstimate.toLocaleString()} tok
									</div>
								</div>
							)}
							{parsedAssistantContent.reasoningBlocks.length > 0 && (
								<ReasoningDisclosure blocks={parsedAssistantContent.reasoningBlocks} />
							)}
						</div>
					</div>
				)}
				{nonRunCodeCalls.length > 0 && (
					<div className="ml-8 flex min-w-0 gap-2">
						<div className="flex-shrink-0 h-5 w-5 rounded flex items-center justify-center bg-orange-100 dark:bg-orange-900">
							<Wrench className="h-3 w-3 text-orange-600 dark:text-orange-400" />
						</div>
						<div className="relative min-w-0 overflow-hidden rounded-lg border border-orange-200/80 bg-orange-50/70 px-2 py-1.5 text-xs text-muted-foreground dark:border-orange-800/70 dark:bg-orange-950/40">
							<CopyBubbleButton
								text={JSON.stringify(nonRunCodeCalls, null, 2)}
								className="absolute right-1 top-1"
								title="Copy tool calls JSON"
							/>
							{nonRunCodeCalls.map((tc: ToolCall) => (
								<span
									key={tc.id}
									className="mr-1 inline-flex max-w-full items-center gap-1 rounded bg-orange-50 px-2 py-1 dark:bg-orange-950"
								>
									<Wrench className="h-3 w-3" />
									<span className="truncate">{tc.function.name}</span>
								</span>
							))}
							<div className="mt-1 text-[10px] text-muted-foreground">
								{nonRunCodeCalls.length} tool call(s)
							</div>
						</div>
					</div>
				)}
			</div>
		)
	}

	// Regular user message
	if (isUser) {
		// Slice A: attached datasets render as collapsible file cards, NOT as the raw
		// `{ ingestHandle, ingestSummary }` JSON blob. The model payload is unchanged
		// (composeOutboundContent still sends the JSON part); this only decouples the
		// transcript's display from that payload.
		const { text: userText, datasets } = splitUserMessageContent(message.content)
		return (
			<div className="flex min-w-0 flex-row-reverse gap-2">
				<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-primary text-primary-foreground">
					<User className="h-3.5 w-3.5" />
				</div>
				<div
					className={cn(
						'relative rounded-lg px-3 py-2 min-w-0 max-w-[85%] overflow-hidden text-sm bg-primary text-primary-foreground',
						isStreaming && 'animate-pulse',
					)}
				>
					<CopyBubbleButton
						text={bubbleCopyText}
						className="absolute right-1.5 top-1.5"
						title="Copy user message"
					/>
					{userText.length > 0 && (
						<div className="pr-6">
							<ChatMarkdownContent content={userText} variant="user" />
						</div>
					)}
					{datasets.length > 0 && (
						<div
							className={cn(
								'flex flex-col gap-1.5 rounded-md bg-background/95 p-1.5 text-foreground',
								userText.length > 0 && 'mt-2',
							)}
						>
							{datasets.map((summary) => (
								<AttachmentCard key={summary.handleId} summary={summary} />
							))}
						</div>
					)}
					<div className="mt-2 text-[10px] text-primary-foreground/80">
						~{tokenEstimate.toLocaleString()} tok
					</div>
				</div>
			</div>
		)
	}

	// Regular assistant message
	return (
		<div className="flex min-w-0 gap-2">
			<div className="flex-shrink-0 h-6 w-6 rounded-full flex items-center justify-center bg-muted">
				<Bot className="h-3.5 w-3.5" />
			</div>
			<div className="min-w-0 max-w-[85%] space-y-2">
				{parsedAssistantContent.answerText && (
					<div
						className={cn(
							'relative min-w-0 overflow-hidden rounded-lg bg-muted px-3 py-2 text-sm',
							isStreaming && 'animate-pulse',
						)}
					>
						<CopyBubbleButton
							text={bubbleCopyText}
							className="absolute right-1.5 top-1.5"
							title="Copy assistant message"
						/>
						<div className="pr-6">
							<ChatMarkdownContent
								content={parsedAssistantContent.answerText}
								variant="assistant"
							/>
						</div>
						<div className="mt-2 text-[10px] text-muted-foreground">
							~{tokenEstimate.toLocaleString()} tok
						</div>
					</div>
				)}
				{parsedAssistantContent.reasoningBlocks.length > 0 && (
					<ReasoningDisclosure blocks={parsedAssistantContent.reasoningBlocks} />
				)}
			</div>
		</div>
	)
}

function ReasoningDisclosure({ blocks }: { blocks: string[] }) {
	const [isOpen, setIsOpen] = useState(false)
	const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
	const scrollRef = useRef<HTMLDivElement>(null)
	const collapsedScrollRef = useRef<HTMLDivElement>(null)
	const lines = blocks
		.flatMap((block) => block.split(/\r?\n/))
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0)
	const occurrenceByLine = new Map<string, number>()
	const keyedLines = lines.map((line) => {
		const nextCount = (occurrenceByLine.get(line) ?? 0) + 1
		occurrenceByLine.set(line, nextCount)
		return {
			line,
			key: `${line}:${nextCount}`,
		}
	})
	const lineCount = keyedLines.length

	useEffect(() => {
		if (!isOpen || !autoScrollEnabled || !scrollRef.current || lineCount === 0) return
		scrollRef.current.scrollTop = scrollRef.current.scrollHeight
	}, [isOpen, autoScrollEnabled, lineCount])

	useEffect(() => {
		if (isOpen || !collapsedScrollRef.current || lineCount === 0) return
		collapsedScrollRef.current.scrollTop = collapsedScrollRef.current.scrollHeight
	}, [isOpen, lineCount])

	if (lines.length === 0) return null

	const toggleAutoScroll = () => {
		const next = !autoScrollEnabled
		setAutoScrollEnabled(next)
		if (next && scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}

	return (
		<div className="rounded-md border border-orange-200/80 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/20">
			<div className="flex items-center justify-between gap-2 px-2 py-1.5">
				<div className="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						onClick={() => setIsOpen((prev) => !prev)}
						className="h-auto p-0 text-xs font-medium text-orange-700 dark:text-orange-300 cursor-pointer select-none"
						aria-expanded={isOpen}
					>
						<span className="mr-1">{isOpen ? '▾' : '▸'}</span>
						Reasoning ({lines.length} lines)
					</Button>
					<CopyBubbleButton text={blocks.join('\n\n')} title="Copy reasoning" compact />
				</div>
				<div className="flex items-center gap-1.5">
					{isOpen && (
						<Button
							type="button"
							variant="outline"
							size="sm"
							onClick={toggleAutoScroll}
							className={cn(
								'text-[10px] px-2 py-0.5',
								autoScrollEnabled
									? 'border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-300 bg-orange-100/70 dark:bg-orange-900/30'
									: 'border-muted-foreground/30 text-muted-foreground bg-background/70',
							)}
							title="Keep view pinned to the latest reasoning line"
						>
							Auto-scroll: {autoScrollEnabled ? 'On' : 'Off'}
						</Button>
					)}
				</div>
			</div>
			{!isOpen ? (
				<div className="px-2 pb-2">
					<div
						ref={collapsedScrollRef}
						className="max-h-[3.25rem] overflow-y-auto rounded border border-orange-200/70 dark:border-orange-900/50 bg-background/80 dark:bg-black/20 p-2 font-mono text-[11px] leading-relaxed"
					>
						{keyedLines.map(({ line, key }, index) => {
							const prefix = index === lines.length - 1 ? '└' : '├'
							return (
								<div key={`collapsed-${key}`} className="flex gap-2">
									<span className="select-none text-orange-500/90 dark:text-orange-400/90">
										{prefix}
									</span>
									<span className="min-w-0 whitespace-pre-wrap break-words text-foreground/85">
										{line}
									</span>
								</div>
							)
						})}
					</div>
				</div>
			) : (
				<div className="px-2 pb-2">
					<div
						ref={scrollRef}
						className="max-h-44 overflow-y-auto rounded border border-orange-200/70 dark:border-orange-900/50 bg-background/80 dark:bg-black/20 p-2 font-mono text-[11px] leading-relaxed"
					>
						{keyedLines.map(({ line, key }, index) => {
							const prefix = index === lines.length - 1 ? '└' : '├'
							return (
								<div key={key} className="flex gap-2">
									<span className="select-none text-orange-500/90 dark:text-orange-400/90">
										{prefix}
									</span>
									<span className="whitespace-pre-wrap break-words text-foreground/85">{line}</span>
								</div>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}

function ToolResultDisclosure({
	content,
	tokenEstimate,
}: {
	content: string
	tokenEstimate: number
}) {
	const [isOpen, setIsOpen] = useState(false)
	const [isBaking, setIsBaking] = useState(false)
	const displayContent = useMemo(() => {
		try {
			const parsed = JSON.parse(content)
			return JSON.stringify(parsed, null, 2)
		} catch {
			return content
		}
	}, [content])
	const geometryAnalysis = useMemo(() => analyzeToolResultGeometryContent(content), [content])
	const lines = displayContent.split(/\r?\n/)
	const previewLines = lines.slice(0, 2)
	const hasMore = lines.length > previewLines.length
	const canBake = geometryAnalysis.canBake && !isBaking

	const handleBakeToEditor = () => {
		setIsBaking(true)
		try {
			const outcome = bakeToolResultContentToEditor(content, false)
			toast.success(
				`Baked ${outcome.importedCount}/${outcome.extractedFeatureCount} feature(s) to editor`,
			)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to bake geometry to editor')
		} finally {
			setIsBaking(false)
		}
	}

	return (
		<div className="rounded-lg px-3 py-2 text-xs bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800">
			<div className="flex items-center justify-between gap-2 mb-1">
				<Button
					type="button"
					variant="ghost"
					onClick={() => setIsOpen((prev) => !prev)}
					className="h-auto p-0 text-left font-medium text-blue-700 dark:text-blue-300"
					aria-expanded={isOpen}
				>
					<span className="mr-1">{isOpen ? '▾' : '▸'}</span>
					Tool Result ({lines.length} lines)
				</Button>
				<div className="flex items-center gap-1.5">
					{geometryAnalysis.canBake && (
						<Button
							type="button"
							variant="outline"
							size="icon-xs"
							onClick={handleBakeToEditor}
							disabled={!canBake}
							title={`Bake ${geometryAnalysis.featureCount} geometry feature(s) to editor`}
							className={cn('h-5 w-5 text-[10px]', !canBake && 'opacity-60 cursor-not-allowed')}
						>
							{isBaking ? (
								<Loader2 className="h-3 w-3 animate-spin" />
							) : (
								<ArrowDownToLine className="h-3 w-3" />
							)}
						</Button>
					)}
					<span className="text-[10px] text-blue-700/80 dark:text-blue-300/80">
						~{tokenEstimate.toLocaleString()} tok
					</span>
					<CopyBubbleButton text={content} title="Copy tool result" compact />
				</div>
			</div>
			{!isOpen ? (
				<div className="rounded border border-blue-200/70 dark:border-blue-800/60 bg-background/70 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
					<pre className="whitespace-pre-wrap break-words">
						{previewLines.join('\n')}
						{hasMore ? '\n...' : ''}
					</pre>
				</div>
			) : (
				<div className="max-h-56 overflow-y-auto rounded border border-blue-200/70 dark:border-blue-800/60 bg-background/70 p-2">
					<pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
						{displayContent}
					</pre>
				</div>
			)}
		</div>
	)
}

function CopyBubbleButton({
	text,
	className,
	title,
	compact = false,
}: {
	text: string
	className?: string
	title: string
	compact?: boolean
}) {
	const [copied, setCopied] = useState(false)
	const canCopy = text.trim().length > 0
	if (!canCopy) return null

	const onCopy = async () => {
		try {
			await navigator.clipboard.writeText(text)
			setCopied(true)
			window.setTimeout(() => setCopied(false), 1500)
		} catch (error) {
			console.error('Failed to copy bubble content', error)
		}
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={onCopy}
			title={title}
			className={cn(
				'h-5 w-5 rounded border text-[10px]',
				compact ? '' : 'bg-background/80',
				'border-border/70',
				className,
			)}
		>
			{copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
		</Button>
	)
}

function buildBubbleCopyText(
	message: ChatMessage,
	parsed: ParsedAssistantContent,
	contentText: string,
): string {
	if (message.role === 'assistant') {
		const parts: string[] = []
		if (parsed.answerText) {
			parts.push(parsed.answerText)
		}
		if (parsed.reasoningBlocks.length > 0) {
			parts.push(`[REASONING]\n${parsed.reasoningBlocks.join('\n\n')}`)
		}
		if (message.tool_calls?.length) {
			parts.push(`[TOOL_CALLS]\n${JSON.stringify(message.tool_calls, null, 2)}`)
		}
		return parts.join('\n\n').trim()
	}
	return contentText
}

function parseAssistantContent(content: string): ParsedAssistantContent {
	const reasoningBlocks: string[] = []
	let answerText = content

	const closedTagPatterns = [
		/\[think\]([\s\S]*?)\[\/think\]/gi,
		/\[reasoning\]([\s\S]*?)\[\/reasoning\]/gi,
		/\[analysis\]([\s\S]*?)\[\/analysis\]/gi,
		/<think>([\s\S]*?)<\/think>/gi,
		/<reasoning>([\s\S]*?)<\/reasoning>/gi,
		/<analysis>([\s\S]*?)<\/analysis>/gi,
	]

	for (const pattern of closedTagPatterns) {
		answerText = answerText.replace(pattern, (_, inner: string) => {
			const normalized = inner.trim()
			if (normalized) reasoningBlocks.push(normalized)
			return ''
		})
	}

	// Streaming responses may include an opening reasoning tag before the closing tag arrives.
	const trailing = extractTrailingReasoning(answerText)
	if (trailing.reasoning) {
		reasoningBlocks.push(trailing.reasoning)
		answerText = trailing.answerText
	}

	return {
		answerText: answerText.replace(/\n{3,}/g, '\n\n').trim(),
		reasoningBlocks,
	}
}

function extractTrailingReasoning(content: string): {
	answerText: string
	reasoning: string | null
} {
	const tagPairs = [
		{ open: '[think]', close: '[/think]' },
		{ open: '[reasoning]', close: '[/reasoning]' },
		{ open: '[analysis]', close: '[/analysis]' },
		{ open: '<think>', close: '</think>' },
		{ open: '<reasoning>', close: '</reasoning>' },
		{ open: '<analysis>', close: '</analysis>' },
	]

	const lower = content.toLowerCase()
	let selected: { index: number; open: string } | null = null

	for (const pair of tagPairs) {
		const openIndex = lower.lastIndexOf(pair.open)
		const closeIndex = lower.lastIndexOf(pair.close)
		if (openIndex !== -1 && closeIndex < openIndex) {
			if (!selected || openIndex > selected.index) {
				selected = { index: openIndex, open: pair.open }
			}
		}
	}

	if (!selected) {
		return { answerText: content, reasoning: null }
	}

	const reasoning = content.slice(selected.index + selected.open.length).trim()
	if (!reasoning) {
		return { answerText: content.slice(0, selected.index), reasoning: null }
	}

	return {
		answerText: content.slice(0, selected.index),
		reasoning,
	}
}
