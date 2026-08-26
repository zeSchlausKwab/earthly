import { useState } from 'react'
import { Crosshair, ListTree, MessageCircle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
	useEditorStore,
	type GeoCollectionEditDraft,
	type GeoEditorWorkspace,
} from '@/features/geo-editor/store'
import {
	resolveChatTargetWorkspace,
	resolveWorkspaceTargetDraft,
	useChatStore,
} from '@/features/chat/store'
import { startDatasetDraftForActiveChat } from '@/features/geo-editor/authoringTaskBridge'
import { cn } from '@/lib/utils'
import type { SafetyLevel } from './AuthoringGate'
import { resolveBinding, type BindingIdentity } from './binding'

const compactActionDividerClassName =
	"relative before:pointer-events-none before:absolute before:inset-y-1.5 before:left-0 before:border-edit/30 before:border-l before:content-['']"

export function bindingChipTargetClassName(compact: boolean) {
	return cn(
		'flex min-w-0 items-center gap-1.5 px-2',
		compact
			? "relative isolate h-11 text-[var(--accent-edit-text)] before:pointer-events-none before:absolute before:inset-x-0 before:inset-y-1.5 before:-z-10 before:rounded-full before:border before:border-edit/40 before:bg-[var(--fill-edit-14)] before:content-['']"
			: 'rounded-full border border-edit/40 bg-edit/15 py-0.5 text-edit',
	)
}

/**
 * BindingChip — the always-visible bound-target indicator in the chat panel
 * (SAFE-01 / D-03) plus the prominent "Just accept" (Level 3) toggle (SAFE-04 /
 * D-12).
 *
 * This is a thin PRESENTATIONAL shell. It takes the already-resolved binding
 * identity (the Plan-03 `resolveBinding` output: `name` / `unsaved` /
 * `featureCount`) and the persisted `safetyLevel` as props; the store reads
 * (useEditorStore + resolveBinding, useChatStore safetyLevel/setSafetyLevel)
 * happen in the `BindingChipContainer` wrapper below, which is what ChatPanel
 * mounts. Keeping the chip presentational lets it be rendered headlessly in the
 * unit test without the live editor store.
 *
 * INVARIANT (SAFE-01): the chip NEVER returns null — visibility is the security
 * property (T-05-20). It distinguishes a conversation with no authoring target
 * from a conversation working against a loaded dataset or local draft.
 */
export interface BindingChipProps {
	/** Display name of the bound dataset ('Untitled draft' fallback supplied by the resolver). */
	name: string
	/** True for an open draft or a dirty dataset. */
	unsaved: boolean
	/** Number of features in the bound target. */
	featureCount: number
	/** True when chat has no current authoring target. */
	targetRequired: boolean
	/** The user's persisted safety posture (SAFE-04). */
	safetyLevel: SafetyLevel
	/**
	 * Called when the "Just accept" toggle flips. The wrapper passes
	 * `setSafetyLevel`; turning ON requests Level 3, OFF requests Level 2 (D-12).
	 */
	onToggleAutoAccept: (nextLevel: SafetyLevel) => void
	/** Opens the editor surface for the concrete target. Omitted while a target is required. */
	onOpenTarget?: () => void
	/** Explicit choices for establishing the editing target. */
	onStartNewTarget?: () => void
	onUseCurrentTarget?: () => void
	/** A New map binding transaction is still creating its durable draft. */
	targetPending?: boolean
	/** Compact two-row maximum presentation for the mobile Chat header. */
	compact?: boolean
}

export function BindingChip({
	name,
	unsaved,
	featureCount,
	targetRequired,
	safetyLevel,
	onToggleAutoAccept,
	onOpenTarget,
	onStartNewTarget,
	onUseCurrentTarget,
	targetPending = false,
	compact = false,
}: BindingChipProps) {
	const autoAcceptOn = safetyLevel === 3
	const featureLabel = featureCount === 1 ? 'feature' : 'features'

	return (
		<div
			className={cn('flex justify-between gap-2 text-xs', compact ? 'items-center' : 'items-start')}
		>
			{/* Bound-target chip — always visible (SAFE-01) */}
			<div className="min-w-0">
				<div
					className={bindingChipTargetClassName(compact)}
					data-binding-chip-density={compact ? 'compact' : 'default'}
				>
					{targetRequired ? (
						<MessageCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
					) : (
						<Crosshair className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
					)}
					<span className="truncate font-medium" title={targetRequired ? undefined : name}>
						{targetRequired ? (compact ? 'Target required' : 'Editing target required') : name}
					</span>
					{compact && targetRequired && onStartNewTarget ? (
						<button
							type="button"
							onClick={onStartNewTarget}
							disabled={targetPending}
							className={cn(
								'ml-0.5 min-h-11 min-w-11 shrink-0 pl-1.5 font-semibold hover:text-foreground',
								compactActionDividerClassName,
							)}
						>
							{targetPending ? 'Creating…' : 'New map'}
						</button>
					) : null}
					{compact && targetRequired && onUseCurrentTarget ? (
						<button
							type="button"
							onClick={onUseCurrentTarget}
							disabled={targetPending}
							className={cn(
								'ml-0.5 min-h-11 min-w-11 shrink-0 pl-1.5 font-semibold hover:text-foreground',
								compactActionDividerClassName,
							)}
						>
							Use current
						</button>
					) : null}
					{!targetRequired && unsaved ? (
						<span
							className={cn(
								'flex-shrink-0 rounded-full bg-primary/10 text-[10px] font-medium uppercase tracking-wide text-primary',
								compact ? 'h-1.5 w-1.5 p-0 text-transparent' : 'px-1',
							)}
							title="Unsaved in-memory edits"
						>
							unsaved
						</span>
					) : null}
					{!targetRequired && !compact ? (
						<span className="flex-shrink-0 text-edit">
							· {featureCount} {featureLabel}
						</span>
					) : null}
					{!targetRequired && onOpenTarget ? (
						<button
							type="button"
							onClick={onOpenTarget}
							className={cn(
								'ml-0.5 inline-flex shrink-0 items-center gap-1 font-semibold hover:text-foreground',
								compact
									? cn('min-h-11 min-w-11 justify-center pl-1.5', compactActionDividerClassName)
									: 'border-edit/30 border-l pl-1.5',
							)}
							aria-label={`Open ${name} in geometry editor`}
							title="Open geometry editor"
						>
							<ListTree className="h-3 w-3" aria-hidden="true" />
							<span className={cn(compact && 'sr-only')}>Open</span>
						</button>
					) : null}
					{!targetRequired && onUseCurrentTarget ? (
						<button
							type="button"
							onClick={onUseCurrentTarget}
							className={cn(
								'ml-0.5 inline-flex shrink-0 items-center font-semibold hover:text-foreground',
								compact
									? cn('min-h-11 min-w-11 pl-1.5', compactActionDividerClassName)
									: 'border-edit/30 border-l pl-1.5',
							)}
							title="Rebind this conversation to the currently visible edit"
						>
							{compact ? 'Use visible' : 'Use current'}
						</button>
					) : null}
				</div>
				{targetRequired && !compact ? (
					<div className={cn('flex items-center gap-1 text-[11px]', 'mt-1 flex-wrap pl-1')}>
						<span className="mr-1 text-muted-foreground">
							Choose New map or Use current edit before sending.
						</span>
						{onStartNewTarget ? (
							<button
								type="button"
								onClick={onStartNewTarget}
								disabled={targetPending}
								className="rounded border border-edit/35 px-1.5 py-0.5 font-semibold text-edit hover:bg-edit/10 disabled:cursor-wait disabled:opacity-60"
							>
								{targetPending ? 'Creating editing target…' : 'New map'}
							</button>
						) : null}
						{onUseCurrentTarget ? (
							<button
								type="button"
								onClick={onUseCurrentTarget}
								disabled={targetPending}
								className="rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60"
							>
								Use current edit
							</button>
						) : null}
					</div>
				) : null}
			</div>

			{/* "Just accept" (Level 3) toggle — prominent, in the header, NOT in settings (D-12) */}
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<div className="flex flex-shrink-0 cursor-pointer items-center gap-1.5 text-muted-foreground">
							<span className="select-none">{compact ? 'Auto' : 'Just accept'}</span>
							<Switch
								checked={autoAcceptOn}
								onCheckedChange={(checked) => onToggleAutoAccept(checked ? 3 : 2)}
								aria-label="Just accept AI edits without confirmation"
							/>
						</div>
					</TooltipTrigger>
					<TooltipContent className="max-w-56 text-xs">
						Applies AI edits without asking — the diff is still shown and every edit stays undoable.
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		</div>
	)
}

/**
 * BindingChipContainer — the store-reading wrapper ChatPanel mounts in its header
 * region. It reads the editor-store identity, feeds it through the Plan-03
 * `resolveBinding`, reads `safetyLevel` from the chat store, and wires
 * `setSafetyLevel` as the toggle handler. Like the chip, it NEVER returns null
 * (SAFE-01) — it always renders either a target-required state or a concrete
 * authoring identity.
 */
export function resolveWorkspaceBindingIdentity(
	workspace: GeoEditorWorkspace | null,
	draft: GeoCollectionEditDraft | null,
): BindingIdentity {
	const targetDraft =
		workspace &&
		draft &&
		workspace.activeDraftId === draft.id &&
		workspace.sourceId === draft.sourceId
			? draft
			: null
	return resolveBinding({
		collectionMeta: {
			name: targetDraft?.collectionMeta.name || targetDraft?.name || workspace?.label || '',
		},
		featureCount: targetDraft?.features.length ?? 0,
		targetDraftId: targetDraft?.id ?? null,
	})
}

export function BindingChipContainer({
	onOpenTarget,
	onTargetPendingChange,
	compact = false,
}: {
	onOpenTarget?: (workspaceId: string) => void
	onTargetPendingChange?: (chatId: string, pending: boolean) => void
	compact?: boolean
}) {
	const [pendingChatIds, setPendingChatIds] = useState<Set<string>>(() => new Set())
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const workspaces = useEditorStore((state) => state.workspaces)
	const drafts = useEditorStore((state) => state.geoEditDrafts)
	const activeChatId = useChatStore((state) => state.activeChatId)
	const chatSessions = useChatStore((state) => state.chatSessions)
	const safetyLevel = useChatStore((state) => state.safetyLevel)
	const setSafetyLevel = useChatStore((state) => state.setSafetyLevel)
	const setChatTargetWorkspace = useChatStore((state) => state.setChatTargetWorkspace)

	const boundWorkspace = resolveChatTargetWorkspace(activeChatId, chatSessions, workspaces)
	const boundDraft = resolveWorkspaceTargetDraft(boundWorkspace, drafts)
	const binding = resolveWorkspaceBindingIdentity(boundWorkspace, boundDraft)
	const activeWorkspace = activeWorkspaceId ? workspaces[activeWorkspaceId] : null
	const activeDraft = resolveWorkspaceTargetDraft(activeWorkspace, drafts)
	const hasCurrentTarget = Boolean(activeWorkspace && activeDraft)
	const canReassignToCurrent = Boolean(
		activeChatId &&
			activeWorkspaceId &&
			hasCurrentTarget &&
			boundWorkspace?.id !== activeWorkspaceId,
	)
	const targetCreationPending = Boolean(activeChatId && pendingChatIds.has(activeChatId))

	return (
		<BindingChip
			name={binding.name}
			unsaved={binding.unsaved}
			featureCount={binding.featureCount}
			targetRequired={binding.targetRequired}
			targetPending={targetCreationPending}
			safetyLevel={safetyLevel}
			onToggleAutoAccept={setSafetyLevel}
			onOpenTarget={
				binding.targetRequired || !boundWorkspace || !onOpenTarget
					? undefined
					: () => onOpenTarget(boundWorkspace.id)
			}
			onStartNewTarget={
				binding.targetRequired && activeChatId
					? () => {
							if (targetCreationPending) return
							const initiatingChatId = activeChatId
							setPendingChatIds((current) => new Set(current).add(initiatingChatId))
							onTargetPendingChange?.(initiatingChatId, true)
							void startDatasetDraftForActiveChat(initiatingChatId)
								.then((workspaceId) => {
									if (workspaceId) setChatTargetWorkspace(initiatingChatId, workspaceId)
								})
								.finally(() => {
									setPendingChatIds((current) => {
										const next = new Set(current)
										next.delete(initiatingChatId)
										return next
									})
									onTargetPendingChange?.(initiatingChatId, false)
								})
						}
					: undefined
			}
			onUseCurrentTarget={
				!targetCreationPending &&
				activeWorkspaceId &&
				activeChatId &&
				(binding.targetRequired || canReassignToCurrent)
					? () => setChatTargetWorkspace(activeChatId, activeWorkspaceId)
					: undefined
			}
			compact={compact}
		/>
	)
}
