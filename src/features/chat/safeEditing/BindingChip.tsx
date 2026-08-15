import { Crosshair, ListTree, MessageCircle } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useEditorStore } from '@/features/geo-editor/store'
import { useChatStore } from '@/features/chat/store'
import { startDatasetDraftForActiveChat } from '@/features/geo-editor/authoringTaskBridge'
import type { SafetyLevel } from './AuthoringGate'
import { resolveBinding } from './binding'

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
	needsAutoCreate: boolean
	/** The user's persisted safety posture (SAFE-04). */
	safetyLevel: SafetyLevel
	/**
	 * Called when the "Just accept" toggle flips. The wrapper passes
	 * `setSafetyLevel`; turning ON requests Level 3, OFF requests Level 2 (D-12).
	 */
	onToggleAutoAccept: (nextLevel: SafetyLevel) => void
	/** Opens the editor surface for the concrete target. Omitted in conversation-only scope. */
	onOpenTarget?: () => void
	/** Explicit conversation-only choices. */
	onStartNewTarget?: () => void
	onUseCurrentTarget?: () => void
}

export function BindingChip({
	name,
	unsaved,
	featureCount,
	needsAutoCreate,
	safetyLevel,
	onToggleAutoAccept,
	onOpenTarget,
	onStartNewTarget,
	onUseCurrentTarget,
}: BindingChipProps) {
	const autoAcceptOn = safetyLevel === 3
	const featureLabel = featureCount === 1 ? 'feature' : 'features'

	return (
		<div className="flex items-start justify-between gap-2 text-xs">
			{/* Bound-target chip — always visible (SAFE-01) */}
			<div className="min-w-0">
				<div className="flex min-w-0 items-center gap-1.5 rounded-full border border-edit/40 bg-edit/15 px-2 py-0.5 text-edit">
					{needsAutoCreate ? (
						<MessageCircle className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
					) : (
						<Crosshair className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
					)}
					<span className="truncate font-medium" title={needsAutoCreate ? undefined : name}>
						{needsAutoCreate ? 'Conversation only' : name}
					</span>
					{!needsAutoCreate && unsaved ? (
						<span
							className="flex-shrink-0 rounded-full bg-primary/10 px-1 text-[10px] font-medium uppercase tracking-wide text-primary"
							title="Unsaved in-memory edits"
						>
							unsaved
						</span>
					) : null}
					{!needsAutoCreate ? (
						<span className="flex-shrink-0 text-edit">
							· {featureCount} {featureLabel}
						</span>
					) : null}
					{!needsAutoCreate && onOpenTarget ? (
						<button
							type="button"
							onClick={onOpenTarget}
							className="ml-0.5 inline-flex shrink-0 items-center gap-1 border-edit/30 border-l pl-1.5 font-semibold hover:text-foreground"
							aria-label={`Open ${name} in geometry editor`}
							title="Open geometry editor"
						>
							<ListTree className="h-3 w-3" aria-hidden="true" />
							<span>Open</span>
						</button>
					) : null}
				</div>
				{needsAutoCreate ? (
					<div className="mt-1 flex flex-wrap items-center gap-1 pl-1 text-[11px]">
						<span className="mr-1 text-muted-foreground">
							Choose a map now, or AI edits will start a new draft.
						</span>
						{onStartNewTarget ? (
							<button
								type="button"
								onClick={onStartNewTarget}
								className="rounded border border-edit/35 px-1.5 py-0.5 font-semibold text-edit hover:bg-edit/10"
							>
								New map
							</button>
						) : null}
						{onUseCurrentTarget ? (
							<button
								type="button"
								onClick={onUseCurrentTarget}
								className="rounded border border-border px-1.5 py-0.5 font-medium text-foreground hover:bg-muted"
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
							<span className="select-none">Just accept</span>
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
 * (SAFE-01) — it always renders either a conversation-only scope or a concrete
 * authoring identity.
 */
export function BindingChipContainer({ onOpenTarget }: { onOpenTarget?: () => void }) {
	const collectionMeta = useEditorStore((state) => state.collectionMeta)
	const featureCount = useEditorStore((state) => state.features.length)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const isDirty = useEditorStore((state) => state.isDirty)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const activeWorkspace = useEditorStore((state) =>
		state.activeWorkspaceId ? state.workspaces[state.activeWorkspaceId] : null,
	)
	const updateWorkspace = useEditorStore((state) => state.updateWorkspace)
	const activeChatId = useChatStore((state) => state.activeChatId)
	const safetyLevel = useChatStore((state) => state.safetyLevel)
	const setSafetyLevel = useChatStore((state) => state.setSafetyLevel)

	const binding = resolveBinding({
		collectionMeta: { name: collectionMeta.name },
		featureCount,
		activeGeoEditDraftId,
		isDirty,
		activeChatId,
		workspaceChatSessionId: activeWorkspace?.chatSessionId ?? null,
	})
	const hasCurrentTarget = Boolean(activeGeoEditDraftId || featureCount > 0)

	return (
		<BindingChip
			name={binding.name}
			unsaved={binding.unsaved}
			featureCount={binding.featureCount}
			needsAutoCreate={binding.needsAutoCreate}
			safetyLevel={safetyLevel}
			onToggleAutoAccept={setSafetyLevel}
			onOpenTarget={binding.needsAutoCreate ? undefined : onOpenTarget}
			onStartNewTarget={
				binding.needsAutoCreate ? () => void startDatasetDraftForActiveChat() : undefined
			}
			onUseCurrentTarget={
				binding.needsAutoCreate && hasCurrentTarget && activeWorkspaceId && activeChatId
					? () => updateWorkspace(activeWorkspaceId, { chatSessionId: activeChatId })
					: undefined
			}
		/>
	)
}
