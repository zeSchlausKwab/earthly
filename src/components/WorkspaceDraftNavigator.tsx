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
	type PublishChannel,
} from '@/features/geo-editor/store'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Input } from './ui/input'

export interface WorkspaceDraftNavigatorProps {
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	onLoadDraft?: (workspaceId: string, draftId: string) => void | Promise<void>
	onDeleteDraft?: (workspaceId: string, draftId: string) => void | Promise<void>
	destinationOptions?: LocalDraftDestinationOption[]
	onResolveDraftDestination?: (
		workspaceId: string,
		draftId: string,
		publishChannel: PublishChannel,
	) => void | Promise<void>
	className?: string
	presentation?: 'compact' | 'panel'
	showPanelHeader?: boolean
}

export interface LocalDraftDestinationOption {
	id: string
	label: string
	publishChannel: PublishChannel
}

function isBlankDraft(draft: GeoCollectionEditDraft | null | undefined): boolean {
	if (!draft) return true
	if (draft.features.length > 0) return false
	if (draft.name.trim()) return false
	if (draft.description.trim()) return false
	if (draft.collectionMeta.name.trim()) return false
	if (draft.collectionMeta.description.trim()) return false
	if (Object.keys(draft.collectionMeta.customProperties).length > 0) return false
	if (draft.contextRefs.length > 0) return false
	if (draft.blobReferences.length > 0) return false
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

export function isLocalDraftWorkspaceVisible(
	workspace: GeoEditorWorkspace,
	drafts: GeoCollectionEditDraft[],
	activeWorkspaceId: string | null,
): boolean {
	return workspace.id === activeWorkspaceId || !isBlankScratchWorkspace(workspace, drafts)
}

export function countVisibleLocalDraftWorkspaces(
	workspaces: Record<string, GeoEditorWorkspace>,
	geoEditDrafts: Record<string, GeoCollectionEditDraft>,
	activeWorkspaceId: string | null,
): number {
	const draftsBySourceId = new Map<string, GeoCollectionEditDraft[]>()
	for (const draft of Object.values(geoEditDrafts)) {
		const existing = draftsBySourceId.get(draft.sourceId) ?? []
		existing.push(draft)
		draftsBySourceId.set(draft.sourceId, existing)
	}
	return Object.values(workspaces).filter((workspace) =>
		isLocalDraftWorkspaceVisible(
			workspace,
			draftsBySourceId.get(workspace.sourceId) ?? [],
			activeWorkspaceId,
		),
	).length
}

export function WorkspaceDraftNavigator({
	onStartNewDataset,
	onSwitchWorkspace,
	onDeleteWorkspace,
	onAddDraftToWorkspace,
	onLoadDraft,
	onDeleteDraft,
	destinationOptions = [],
	onResolveDraftDestination,
	className,
	presentation = 'compact',
	showPanelHeader = true,
}: WorkspaceDraftNavigatorProps) {
	const geoEditDrafts = useEditorStore((state) => state.geoEditDrafts)
	const activeGeoEditDraftId = useEditorStore((state) => state.activeGeoEditDraftId)
	const workspaces = useEditorStore((state) => state.workspaces)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
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
			sortedWorkspaces.filter((workspace) =>
				isLocalDraftWorkspaceVisible(
					workspace,
					workspaceDrafts.get(workspace.sourceId) ?? [],
					activeWorkspaceId,
				),
			),
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
	const activeWorkspaceLabel = activeWorkspace
		? getSavedWorkLabel(activeWorkspace.label)
		: 'No saved work open'
	const isActiveProposalWorkspace = activeWorkspace
		? isProposalWorkspace(activeWorkspace, currentUser?.pubkey ?? null)
		: false
	const activeDraftLabel = activeDraft
		? getDraftLabel(activeDraft, 0, activeWorkspace?.kind === 'dataset')
		: 'No draft selected'

	if (presentation === 'panel') {
		return (
			<section
				aria-label="Local drafts"
				className={cn('flex h-full min-h-0 flex-col bg-background', className)}
			>
				{showPanelHeader ? (
					<div className="shrink-0 border-b border-border px-4 py-4">
						<div className="flex items-start justify-between gap-3">
							<div className="min-w-0">
								<h2 className="text-base font-semibold text-foreground">Local drafts</h2>
								<p className="mt-1 text-xs leading-relaxed text-muted-foreground">
									Unpublished drawings and edits are saved on this device so you can return to them
									later.
								</p>
							</div>
							<Button type="button" size="sm" onClick={handleCreateWorkspace} className="shrink-0">
								<Plus className="h-3.5 w-3.5" />
								New draft
							</Button>
						</div>
					</div>
				) : (
					<p className="shrink-0 border-b border-border px-3 py-2 text-xs leading-relaxed text-muted-foreground">
						Unpublished drawings and edits are saved on this device so you can return to them later.
					</p>
				)}
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">{renderDraftGroups()}</div>
			</section>
		)
	}

	return (
		<Collapsible open={open} onOpenChange={setOpen} className={className}>
			<div className="overflow-hidden rounded-lg border border-border bg-card/90">
				<CollapsibleTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						className="flex h-9 w-full items-center gap-2 px-3 text-left justify-start"
						title="Local drafts saved on this device"
					>
						<Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 truncate text-sm font-semibold text-foreground">
							{activeWorkspaceLabel}
						</span>
						{isActiveProposalWorkspace ? (
							<span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-primary">
								Proposal
							</span>
						) : null}
						<span className="shrink-0 text-muted-foreground">/</span>
						<span className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-muted-foreground">
							<FileText className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{activeDraftLabel}</span>
						</span>
						<span
							className="shrink-0 text-xs text-muted-foreground"
							title={`${visibleWorkspaces.length} saved item${visibleWorkspaces.length === 1 ? '' : 's'}`}
						>
							{visibleWorkspaces.length}
						</span>
						{open ? (
							<ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
						) : (
							<ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
						)}
					</Button>
				</CollapsibleTrigger>
				<CollapsibleContent className="border-t border-border px-2.5 py-2">
					<div className="mb-2 flex items-center justify-between gap-3 px-1">
						<p className="text-[11px] leading-snug text-muted-foreground">
							Unpublished work saved on this device.
						</p>
						<Button
							type="button"
							size="icon-sm"
							variant="outline"
							onClick={handleCreateWorkspace}
							title="Start a new local draft"
						>
							<Plus className="h-3.5 w-3.5" />
						</Button>
					</div>

					{renderDraftGroups()}
				</CollapsibleContent>
			</div>
		</Collapsible>
	)

	function renderDraftGroups() {
		return (
			<div className="space-y-2">
				{proposalWorkspaces.length > 0 ? (
					<div className="space-y-1.5">
						<div className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
							Proposal drafts
						</div>
						<div className="px-1 text-[11px] text-muted-foreground">
							Unpublished edits to someone else&apos;s dataset stay grouped here.
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
											? 'border-primary/40 bg-primary/10'
											: 'border-primary/40 bg-card',
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
							<div className="px-1 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
								Saved work
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
										isActiveWorkspace ? 'border-ok/40 bg-ok/15' : 'border-border bg-card',
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
					<div className="rounded-md border border-dashed border-border px-3 py-3 text-[11px] leading-relaxed text-muted-foreground">
						Nothing saved locally yet. Unpublished drawing work will appear here automatically.
					</div>
				) : null}
			</div>
		)
	}

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
			workspaceTone === 'proposal' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
		const activeClassName =
			workspaceTone === 'proposal'
				? 'bg-primary/10 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-primary'
				: 'bg-ok/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-ok'
		const activeDraftClassName =
			workspaceTone === 'proposal' ? 'bg-primary/10 text-primary' : 'bg-ok/15 text-ok'
		const displayLabel = getSavedWorkLabel(workspace.label)

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
						className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
						aria-label={isExpanded ? 'Collapse saved drafts' : 'Expand saved drafts'}
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
								title="Save name"
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
									<span className="truncate text-xs font-medium text-foreground">
										{displayLabel}
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
										<span className={cn('rounded-full', activeClassName)}>Current</span>
									) : null}
								</div>
								<div className="mt-0.5 text-[10px] text-muted-foreground">
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
									title="Add another draft"
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
									title="Rename saved work"
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
									title="Delete saved work"
								>
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</>
					)}
				</div>

				{isConfirmingWorkspaceDelete ? (
					<div className="flex items-center justify-between gap-3 border-t border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
						<span className="min-w-0 flex-1 truncate">
							Delete “{displayLabel}” and its unpublished drafts from this device?
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
					<div className="space-y-1 border-t border-border/80 bg-card/60 px-2 py-1.5">
						{drafts.length > 0 ? (
							drafts.map((draft, index) => {
								const isActiveDraft = isActiveWorkspace && selectedDraftId === draft.id
								const draftLabel = getDraftLabel(draft, index, workspace.kind === 'dataset')
								return (
									<div
										key={draft.id}
										className={cn(
											'w-full rounded-md text-left transition-colors',
											isActiveDraft ? activeDraftClassName : 'hover:bg-muted text-foreground',
										)}
									>
										<div className="flex items-center gap-1 px-2 py-1.5">
											<button
												type="button"
												onClick={() => {
													void onLoadDraft?.(workspace.id, draft.id)
												}}
												className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
											>
												<span className="truncate text-[11px]">{draftLabel}</span>
												<span
													className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-muted-foreground"
													title={getDraftDestinationTitle(draft)}
												>
													{getDraftDestinationLabel(draft)}
												</span>
											</button>
											<span className="shrink-0 text-[10px] text-muted-foreground">
												{draft.id.slice(0, 8)}
											</span>
											<Button
												type="button"
												size="icon-sm"
												variant="ghost"
												className="h-6 w-6 text-destructive hover:text-destructive"
												onClick={(event) => {
													event.stopPropagation()
													void onDeleteDraft?.(workspace.id, draft.id)
												}}
												title="Delete draft"
											>
												<Trash2 className="h-3 w-3" />
											</Button>
										</div>
										{draft.publishChannel.kind === 'unresolved' && destinationOptions.length > 0 ? (
											<label className="block border-t border-border/70 px-2 py-2 text-[10px] font-medium text-muted-foreground">
												Choose where this legacy draft belongs
												<select
													aria-label={`Destination for ${draftLabel}`}
													value=""
													onChange={(event) => {
														const option = destinationOptions.find(
															(candidate) => candidate.id === event.currentTarget.value,
														)
														if (!option) return
														void onResolveDraftDestination?.(
															workspace.id,
															draft.id,
															option.publishChannel,
														)
													}}
													className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[11px] text-foreground"
												>
													<option value="">Select destination…</option>
													{destinationOptions.map((option) => (
														<option key={option.id} value={option.id}>
															{option.label}
														</option>
													))}
												</select>
											</label>
										) : null}
									</div>
								)
							})
						) : (
							<div className="px-2 py-1 text-[11px] text-muted-foreground">
								No saved drafts here yet.
							</div>
						)}
					</div>
				) : null}
			</>
		)
	}
}

export type LocalDraftsPanelProps = Omit<WorkspaceDraftNavigatorProps, 'presentation'>

/** Flat, full-height local-draft browser for a mobile sidebar or drawer. */
export function LocalDraftsPanel(props: LocalDraftsPanelProps) {
	return <WorkspaceDraftNavigator {...props} presentation="panel" />
}

function getSavedWorkLabel(label: string): string {
	const normalized = label.trim().toLowerCase()
	if (!normalized || normalized === 'untitled workspace' || normalized === 'untitled') {
		return 'Untitled draft'
	}
	return label
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

function getDraftDestinationLabel(draft: GeoCollectionEditDraft): string {
	if (draft.publishChannel.kind === 'private-group') return 'Private'
	if (draft.publishChannel.kind === 'field-session') return 'Nearby'
	if (draft.publishChannel.kind === 'unresolved') return 'Destination needed'
	return draft.contextRefs.length > 0 ? 'Public · context' : 'Public'
}

function getDraftDestinationTitle(draft: GeoCollectionEditDraft): string {
	if (draft.publishChannel.kind === 'private-group') {
		return `Private group destination: ${draft.publishChannel.id}`
	}
	if (draft.publishChannel.kind === 'field-session') {
		return `Field session destination: ${draft.publishChannel.id}`
	}
	if (draft.publishChannel.kind === 'unresolved') {
		return 'Destination needed before this draft can be published'
	}
	return draft.contextRefs.length > 0
		? `${draft.contextRefs.length} public context attachment${draft.contextRefs.length === 1 ? '' : 's'}`
		: 'Public, unattached'
}

function isProposalWorkspace(
	workspace: { kind: 'dataset' | 'scratch'; datasetKey: string | null },
	currentPubkey: string | null,
) {
	if (!currentPubkey || workspace.kind !== 'dataset' || !workspace.datasetKey) return false
	const ownerPubkey = workspace.datasetKey.split(':')[0] ?? null
	return !!ownerPubkey && ownerPubkey !== currentPubkey
}
