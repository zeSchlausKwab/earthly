import { useEffect, useMemo, useState } from 'react'
import {
	ChevronDown,
	ChevronRight,
	FilePenLine,
	FileText,
	Layers,
	Plus,
	Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useEditorStore, type GeoCollectionEditDraft } from '@/features/geo-editor/store'
import { Button } from './ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'

interface WorkspaceDraftNavigatorProps {
	onStartNewDataset?: () => void
	onSwitchWorkspace?: (workspaceId: string) => void
	onDeleteWorkspace?: (workspaceId: string) => void | Promise<void>
	onAddDraftToWorkspace?: (workspaceId: string) => void | Promise<void>
	className?: string
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

	const [open, setOpen] = useState(false)
	const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Record<string, boolean>>({})

	const activeDraft = useMemo(
		() => (activeGeoEditDraftId ? (geoEditDrafts[activeGeoEditDraftId] ?? null) : null),
		[activeGeoEditDraftId, geoEditDrafts],
	)
	const sortedWorkspaces = useMemo(
		() => Object.values(workspaces).sort((a, b) => b.updatedAt - a.updatedAt),
		[workspaces],
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

	const handleRenameWorkspace = (workspaceId: string, currentLabel: string) => {
		const nextLabel = window.prompt('Rename workspace', currentLabel)?.trim()
		if (!nextLabel || nextLabel === currentLabel) return
		updateWorkspace(workspaceId, { label: nextLabel })
	}

	const activeWorkspace = activeWorkspaceId
		? (sortedWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null)
		: null
	const activeWorkspaceLabel = activeWorkspace?.label ?? 'No active workspace'
	const activeDraftLabel = activeDraft
		? getDraftLabel(activeDraft, 0, activeWorkspace?.kind === 'dataset')
		: 'No draft selected'
	return (
		<Collapsible open={open} onOpenChange={setOpen} className={className}>
			<div className="overflow-hidden rounded-lg border border-slate-200 bg-white/90">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors hover:bg-slate-50"
					>
						<Layers className="h-3.5 w-3.5 shrink-0 text-slate-500" />
						<span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
							Sessions
						</span>
						<span className="min-w-0 truncate text-sm font-medium text-slate-900">
							{activeWorkspaceLabel}
						</span>
						<span className="shrink-0 text-slate-300">/</span>
						<span className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-sm text-slate-600">
							<FileText className="h-3.5 w-3.5 shrink-0" />
							<span className="truncate">{activeDraftLabel}</span>
						</span>
						<span className="shrink-0 text-xs text-slate-500">{sortedWorkspaces.length}</span>
						{open ? (
							<ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
						) : (
							<ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
						)}
					</button>
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

					<div className="space-y-1.5">
						{sortedWorkspaces.map((workspace) => {
							const drafts = Object.values(geoEditDrafts)
								.filter((draft) => draft.sourceId === workspace.sourceId)
								.sort((a, b) => b.updatedAt - a.updatedAt)
							const isActiveWorkspace = workspace.id === activeWorkspaceId
							const isExpanded = expandedWorkspaceIds[workspace.id] ?? isActiveWorkspace

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
									<div className="flex items-center gap-1 px-1.5 py-1.5">
										<button
											type="button"
											onClick={() =>
												setExpandedWorkspaceIds((current) => ({
													...current,
													[workspace.id]: !current[workspace.id],
												}))
											}
											className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
											aria-label={
												isExpanded ? 'Collapse workspace drafts' : 'Expand workspace drafts'
											}
										>
											{isExpanded ? (
												<ChevronDown className="h-3.5 w-3.5" />
											) : (
												<ChevronRight className="h-3.5 w-3.5" />
											)}
										</button>
										<button
											type="button"
											onClick={() => onSwitchWorkspace?.(workspace.id)}
											className="min-w-0 flex-1 rounded px-1 py-1 text-left transition-colors hover:bg-black/5"
										>
											<div className="flex min-w-0 items-center gap-2">
												<span className="truncate text-xs font-medium text-slate-900">
													{workspace.label}
												</span>
												<span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-slate-500">
													{workspace.kind === 'scratch' ? 'draft' : 'dataset'}
												</span>
												{isActiveWorkspace ? (
													<span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-emerald-700">
														Active
													</span>
												) : null}
											</div>
											<div className="mt-0.5 text-[10px] text-slate-500">
												{drafts.length} draft{drafts.length === 1 ? '' : 's'}
											</div>
										</button>
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
													handleRenameWorkspace(workspace.id, workspace.label)
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
													const confirmed = window.confirm(`Delete workspace "${workspace.label}"?`)
													if (!confirmed) return
													void onDeleteWorkspace?.(workspace.id)
												}}
												title="Delete workspace"
											>
												<Trash2 className="h-3.5 w-3.5" />
											</Button>
										</div>
									</div>

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
																isActiveDraft
																	? 'bg-emerald-100/80 text-emerald-900'
																	: 'hover:bg-slate-100 text-slate-700',
															)}
														>
															<span className="min-w-0 truncate text-[11px]">
																{getDraftLabel(draft, index, workspace.kind === 'dataset')}
															</span>
															<div className="flex shrink-0 items-center gap-1">
																<span className="text-[10px] text-slate-500">
																	{draft.id.slice(0, 8)}
																</span>
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
								</div>
							)
						})}
					</div>
				</CollapsibleContent>
			</div>
		</Collapsible>
	)
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
