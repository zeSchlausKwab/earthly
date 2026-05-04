import {  } from '@nostr-dev-kit/react'
import { useActiveAccount } from 'applesauce-react/hooks'
import { useEffect, useMemo, useState } from 'react'
import {
	Check,
	ChevronDown,
	ChevronRight,
	FilePenLine,
	FileText,
	Layers,
	Plus,
	Trash2,
	X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
	useEditorStore,
	type GeoCollectionEditDraft,
	type GeoEditorWorkspace,
} from '@/features/geo-editor/store'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Input } from './ui/input'

interface WorkspaceDraftNavigatorProps {
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	className?: string
}

function isBlankDraft(draft: GeoCollectionEditDraft | null | undefined): boolean {
	if (!draft) return true
	if (draft.features.length > 0) return false
	if (draft.name.trim()) return false
	if (draft.description.trim()) return false
	if (draft.collectionMeta.name.trim()) return false
	if (draft.collectionMeta.description.trim()) return false
	if (Object.keys(draft.collectionMeta.customProperties).length > 0) return false
	return true
}

function isBlankScratchWorkspace(
	workspace: GeoEditorWorkspace,
	drafts: GeoCollectionEditDraft[],
): boolean {
	if (workspace.kind !== 'scratch') return false
	const normalizedLabel = workspace.label.trim().toLowerCase()
	if (
		normalizedLabel &&
		normalizedLabel !== 'untitled workspace' &&
		normalizedLabel !== 'untitled'
	) {
		return false
	}
	return drafts.every((draft) => isBlankDraft(draft))
}

export function WorkspaceDraftNavigator({
	onStartNewDataset,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onAddDraftToWorkspace,
	className,
}: WorkspaceDraftNavigatorProps) {
	const geoEditDrafts = useEditorStore((state) => state.geoEditDrafts)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const workspaces = useEditorStore((state) => state.workspaces)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
	const deleteGeoEditDraft = useEditorStore((state) => state.deleteGeoEditDraft)
	const loadGeoEditDraft = useEditorStore((state) => state.loadGeoEditDraft)
	const updateWorkspace = useEditorStore((state) => state.updateWorkspace)
	const currentUser = useActiveAccount()

	const [open, setOpen] = useState(false)
	const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Record<string, boolean>>({})
	const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null)
	const [workspaceLabelDraft, setWorkspaceLabelDraft] = useState('')
	const [confirmingWorkspaceDeleteId, setConfirmingWorkspaceDeleteId] = useState<string | null>(
		null,
	)

	const activeDraft = useMemo(
		() => (activeGeoEditDraftId ? (geoEditDrafts[activeGeoEditDraftId] ?? null) : null),
		[activeGeoEditDraftId, geoEditDrafts],
	)
	const workspaceDrafts = useMemo(() => {
		const draftsBySourceId = new Map<string, GeoCollectionEditDraft[]>()
		for (const draft of Object.values(geoEditDrafts)) {
			const existing = draftsBySourceId.get(draft.sourceId) ?? []
			existing.push(draft)
			draftsBySourceId.set(draft.sourceId, existing)
		}
		draftsBySourceId.forEach((drafts) => {
			drafts.sort((a, b) => b.updatedAt - a.updatedAt)
		})
		return draftsBySourceId
	}, [geoEditDrafts])
	const sortedWorkspaces = useMemo(
		() => Object.values(workspaces).sort((a, b) => b.updatedAt - a.updatedAt),
		[workspaces],
	)
	const visibleWorkspaces = useMemo(
		() =>
			sortedWorkspaces.filter((workspace) => {
				if (workspace.id === activeWorkspaceId) return true
				const drafts = workspaceDrafts.get(workspace.sourceId) ?? []
				return !isBlankScratchWorkspace(workspace, drafts)
			}),
		[sortedWorkspaces, workspaceDrafts, activeWorkspaceId],
	)
	const currentPubkey = currentUser?.pubkey ?? null
	const proposalWorkspaces = visibleWorkspaces.filter((workspace) =>
		isProposalWorkspace(workspace, currentPubkey),
	)
	const regularWorkspaces = visibleWorkspaces.filter(
		(workspace) => !isProposalWorkspace(workspace, currentPubkey),
	)
	const selectedDraftId = activeDraft?.id

	useEffect(() => {
		if (!activeWorkspaceId) return
		setExpandedWorkspaceIds((current) => {
			if (current[activeWorkspaceId]) return current
			return {
				...current,
				[activeWorkspaceId]: true,
			}
		})
	}, [activeWorkspaceId])

	const handleCreateWorkspace = () => {
		onStartNewDataset?.()
	}

	const handleBeginWorkspaceRename = (workspaceId: string, currentLabel: string) => {
		setConfirmingWorkspaceDeleteId((current) => (current === workspaceId ? null : current))
		setRenamingWorkspaceId(workspaceId)
		setWorkspaceLabelDraft(currentLabel)
	}

	const handleRenameWorkspace = (workspaceId: string, currentLabel: string) => {
		const nextLabel = workspaceLabelDraft.trim()
		if (!nextLabel || nextLabel === currentLabel) return
		updateWorkspace(workspaceId, { label: nextLabel })
		setRenamingWorkspaceId(null)
		setWorkspaceLabelDraft('')
	}

	const handleCancelWorkspaceRename = () => {
		setRenamingWorkspaceId(null)
		setWorkspaceLabelDraft('')
	}

	const handleRequestWorkspaceDelete = (workspaceId: string) => {
		setRenamingWorkspaceId((current) => (current === workspaceId ? null : current))
		setWorkspaceLabelDraft('')
		setConfirmingWorkspaceDeleteId(workspaceId)
	}

	const handleCancelWorkspaceDelete = () => {
		setConfirmingWorkspaceDeleteId(null)
	}

	const handleConfirmWorkspaceDelete = (workspaceId: string) => {
		setConfirmingWorkspaceDeleteId(null)
		void onDeleteWorkspace?.(workspaceId)
	}

	const activeWorkspace = activeWorkspaceId
		? (sortedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null)
		: null
	const activeWorkspaceLabel = activeWorkspace?.label ?? 'No active workspace'
	const isActiveProposalWorkspace = activeWorkspace
		? isProposalWorkspace(activeWorkspace, currentUser?.pubkey ?? null)
		: false
	const activeDraftLabel = activeDraft
		? getDraftLabel(activeDraft, 0, activeWorkspace?.kind === 'dataset')
		: 'No draft selected'
	return (
		<Collapsible open={open} onOpenChange={setOpen} className={className}>
			<div className="overflow-hidden rounded-lg border border-slate-200 bg-white/90">
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="flex h-9 w-full items-center gap-2 px-3 text-left justify-start"
						title="Workspaces & drafts"
					>
						<Layers className="h-3.5 w-3.5 shrink-0 text-slate-400" />
						<span className="min-w-0 truncate text-sm font-semibold text-slate-800">
							{activeWorkspaceLabel}
						</span>
						{isActiveProposalWorkspace ? (
							<span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-800">
								Proposal
							</span>
						) : null}
						<span className="shrink-0 text-slate-300">/</span>
						<span className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-slate-500">
							<FileText className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{activeDraftLabel}</span>
						</span>
						<span
							className="shrink-0 text-xs text-slate-400"
							title={`${visibleWorkspaces.length} workspace${visibleWorkspaces.length === 1 ? '' : 's'}`}
						>
							{visibleWorkspaces.length}
						</span>
						{open ? (
							<ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
						) : (
							<ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
						)}
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent className="border-t border-slate-200 px-2.5 py-2">
					<div className="mb-2 flex items-center justify-end gap-1.5">
						<Button
							type="button"
							size="icon-sm"
							variant="outline"
							onClick={handleCreateWorkspace}
							title="Start a new empty workspace"
						>
							<Plus className="h-3.5 w-3.5" />
						</Button>
					</div>

					<div className="space-y-2">
						{proposalWorkspaces.length > 0 ? (
							<div className="space-y-1.5">
								<div className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-amber-700">
									Proposal drafts
								</div>
								<div className="px-1 text-[11px] text-slate-500">
									Edits to datasets owned by another account stay grouped here.
								</div>
								{proposalWorkspaces.map((workspace) => {
									const drafts = workspaceDrafts.get(workspace.sourceId) ?? []
									const isActiveWorkspace = workspace.id === activeWorkspaceId
									const isExpanded = expandedWorkspaceIds[workspace.id] ?? isActiveWorkspace
									const isRenamingWorkspace = renamingWorkspaceId === workspace.id
									const isConfirmingWorkspaceDelete = confirmingWorkspaceDeleteId === workspace.id

									return (
										<div
											key={workspace.id}
											className={cn(
												'overflow-hidden rounded-md border',
												isActiveWorkspace
													? 'border-amber-200 bg-amber-50/60'
													: 'border-amber-200/70 bg-white',
											)}
										>
											{renderWorkspaceRow({
												workspace,
												drafts,
												isActiveWorkspace,
												isExpanded,
												isRenamingWorkspace,
												isConfirmingWorkspaceDelete,
												workspaceTone: 'proposal',
											})}
										</div>
									)
								})}
							</div>
						) : null}

						{regularWorkspaces.length > 0 ? (
							<div className="space-y-1.5">
								{proposalWorkspaces.length > 0 ? (
									<div className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
										Other workspaces
									</div>
								) : null}
								{regularWorkspaces.map((workspace) => {
									const drafts = workspaceDrafts.get(workspace.sourceId) ?? []
									const isActiveWorkspace = workspace.id === activeWorkspaceId
									const isExpanded = expandedWorkspaceIds[workspace.id] ?? isActiveWorkspace
									const isRenamingWorkspace = renamingWorkspaceId === workspace.id
									const isConfirmingWorkspaceDelete = confirmingWorkspaceDeleteId === workspace.id

									return (
										<div
											key={workspace.id}
											className={cn(
												'overflow-hidden rounded-md border',
												isActiveWorkspace
													? 'border-emerald-200 bg-emerald-50/60'
													: 'border-slate-200 bg-white',
											)}
										>
											{renderWorkspaceRow({
												workspace,
												drafts,
												isActiveWorkspace,
												isExpanded,
												isRenamingWorkspace,
												isConfirmingWorkspaceDelete,
												workspaceTone: 'default',
											})}
										</div>
									)
								})}
							</div>
						) : null}

						{visibleWorkspaces.length === 0 ? (
							<div className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-[11px] text-slate-500">
								No local workspaces yet.
							</div>
						) : null}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)

	function renderWorkspaceRow({
		workspace,
		drafts,
		isActiveWorkspace,
		isExpanded,
		isRenamingWorkspace,
		isConfirmingWorkspaceDelete,
		workspaceTone,
	}: {
		workspace: (typeof sortedWorkspaces)[number]
		drafts: GeoCollectionEditDraft[]
		isActiveWorkspace: boolean
		isExpanded: boolean
		isRenamingWorkspace: boolean
		isConfirmingWorkspaceDelete: boolean
		workspaceTone: 'default' | 'proposal'
	}) {
		const badgeClassName =
			workspaceTone === 'proposal' ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'
		const activeClassName =
			workspaceTone === 'proposal'
				? 'bg-amber-100 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-amber-800'
				: 'bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-700'
		const activeDraftClassName =
			workspaceTone === 'proposal'
				? 'bg-amber-100/80 text-amber-900'
				: 'bg-emerald-100/80 text-emerald-900'

		return (
			<>
				<div className="flex items-center gap-1 px-1.5 py-1.5">
					<Button
						type="button"
						variant="ghost"
						onClick={() =>
							setExpandedWorkspaceIds((current) => ({
								...current,
								[workspace.id]: !current[workspace.id],
							}))
						}
						className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
						aria-label={isExpanded ? 'Collapse workspace drafts' : 'Expand workspace drafts'}
					>
						{isExpanded ? (
							<ChevronDown className="h-3.5 w-3.5" />
						) : (
							<ChevronRight className="h-3.5 w-3.5" />
						)}
					</Button>
					{isRenamingWorkspace ? (
						<form
							className="flex min-w-0 flex-1 items-center gap-1"
							onSubmit={(event) => {
								event.preventDefault()
								handleRenameWorkspace(workspace.id, workspace.label)
							}}
						>
							<Input
								value={workspaceLabelDraft}
								onChange={(event) => setWorkspaceLabelDraft(event.target.value)}
								className="h-8 text-xs"
								autoFocus
								maxLength={120}
							/>
							<Button
								type="submit"
								size="icon-sm"
								variant="outline"
								className="h-7 w-7"
								title="Save workspace name"
							>
								<Check className="h-3.5 w-3.5" />
							</Button>
							<Button
								type="button"
								size="icon-sm"
								variant="ghost"
								className="h-7 w-7"
								onClick={handleCancelWorkspaceRename}
								title="Cancel rename"
							>
								<X className="h-3.5 w-3.5" />
							</Button>
						</form>
					) : (
						<>
							<Button
								type="button"
								variant="ghost"
								onClick={() => onSwitchWorkspace?.(workspace.id)}
								className="min-w-0 flex-1 h-auto px-1 py-1 text-left justify-start"
							>
								<div className="flex min-w-0 items-center gap-2">
									<span className="truncate text-xs font-medium text-slate-900">
										{workspace.label}
									</span>
									<span
										className={cn(
											'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em]',
											badgeClassName,
										)}
									>
										{workspaceTone === 'proposal'
											? 'proposal'
											: workspace.kind === 'scratch'
												? 'draft'
												: 'dataset'}
									</span>
									{isActiveWorkspace ? (
										<span className={cn('rounded-full', activeClassName)}>Active</span>
									) : null}
								</div>
								<div className="mt-0.5 text-[10px] text-slate-500">
									{drafts.length} draft{drafts.length === 1 ? '' : 's'}
								</div>
							</Button>
							<div className="flex shrink-0 items-center gap-1">
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									className="h-7 w-7"
									onClick={(event) => {
										event.stopPropagation()
										void onAddDraftToWorkspace?.(workspace.id)
									}}
									title="Add new draft to this workspace"
								>
									<Plus className="h-3.5 w-3.5" />
								</Button>
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									className="h-7 w-7"
									onClick={(event) => {
										event.stopPropagation()
										handleBeginWorkspaceRename(workspace.id, workspace.label)
									}}
									title="Rename workspace"
								>
									<FilePenLine className="h-3.5 w-3.5" />
								</Button>
								<Button
									type="button"
									size="icon-sm"
									variant="ghost"
									className="h-7 w-7 text-destructive hover:text-destructive"
									onClick={(event) => {
										event.stopPropagation()
										handleRequestWorkspaceDelete(workspace.id)
									}}
									title="Delete workspace"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</>
					)}
				</div>

				{isConfirmingWorkspaceDelete ? (
					<div className="flex items-center justify-between gap-3 border-t border-rose-200 bg-rose-50/90 px-3 py-2 text-[11px] text-rose-900">
						<span className="min-w-0 flex-1 truncate">
							Delete workspace "{workspace.label}" and its linked session state?
						</span>
						<div className="flex shrink-0 items-center gap-1.5">
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="h-7 px-2 text-[11px]"
								onClick={handleCancelWorkspaceDelete}
							>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								variant="destructive"
								className="h-7 px-2 text-[11px]"
								onClick={() => handleConfirmWorkspaceDelete(workspace.id)}
							>
								Delete
							</Button>
						</div>
					</div>
				) : null}

				{isExpanded ? (
					<div className="space-y-1 border-t border-slate-200/80 bg-white/60 px-2 py-1.5">
						{drafts.length > 0 ? (
							drafts.map((draft, index) => {
								const isActiveDraft = isActiveWorkspace && selectedDraftId === draft.id
								return (
									<button
										key={draft.id}
										type="button"
										onClick={() => {
											if (!isActiveWorkspace) {
												onSwitchWorkspace?.(workspace.id)
												return
											}
											loadGeoEditDraft(draft.id)
										}}
										className={cn(
											'flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
											isActiveDraft ? activeDraftClassName : 'hover:bg-slate-100 text-slate-700',
										)}
									>
										<span className="min-w-0 truncate text-[11px]">
											{getDraftLabel(draft, index, workspace.kind === 'dataset')}
										</span>
										<div className="flex shrink-0 items-center gap-1">
											<span className="text-[10px] text-slate-500">{draft.id.slice(0, 8)}</span>
											<Button
												type="button"
												size="icon-sm"
												variant="ghost"
												className="h-6 w-6 text-destructive hover:text-destructive"
												onClick={(event) => {
													event.stopPropagation()
													deleteGeoEditDraft(draft.id)
													if (isActiveDraft) {
														void onSwitchWorkspace?.(workspace.id)
													}
												}}
												title="Delete draft"
											>
												<Trash2 className="h-3 w-3" />
											</Button>
										</div>
									</button>
								)
							})
						) : (
							<div className="px-2 py-1 text-[11px] text-slate-500">
								No local drafts for this workspace yet.
							</div>
						)}
					</div>
				) : null}
			</>
		)
	}
}

function getDraftLabel(
	draft: GeoCollectionEditDraft,
	index: number,
	isDatasetWorkspace: boolean,
): string {
	return (
		draft.collectionMeta.name ||
		draft.name ||
		(isDatasetWorkspace ? `Draft ${index + 1}` : `Untitled ${index + 1}`)
	).trim()
}

function isProposalWorkspace(
	workspace: { kind: 'dataset' | 'scratch'; datasetKey: string | null },
	currentPubkey: string | null,
) {
	if (!currentPubkey || workspace.kind !== 'dataset' || !workspace.datasetKey) return false
	const ownerPubkey = workspace.datasetKey.split(':')[0] ?? null
	return !!ownerPubkey && ownerPubkey !== currentPubkey
}
