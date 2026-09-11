import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChevronDown, Link2, Loader2, Pencil, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { EntitySearchPopover } from '@/components/entity-search/EntitySearchPopover'
import type { EntitySearchSources, EntitySearchResult } from '@/components/entity-search/types'
import { EntityDragHandle } from '@/components/entity-list/EntityDragHandle'
import {
	getEntityDrag,
	subscribeEntityDrag,
	readEntityDrop,
	endEntityDrag,
	transferFromResult,
	transferFromTarget,
	type EntityTransfer,
} from '@/components/entity-list/entityTransfer'
import { DraftRowActions } from '@/components/DraftRowActions'
import { openSavedDraft } from '@/features/geo-editor/draftActions'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import { useEditorStore } from '@/features/geo-editor/store'
import { readStoryDraft, getStoryDraftRevision, subscribeStoryDrafts } from '@/lib/nostr/story'
import { useChatStore } from '../store'
import {
	mapWorkTarget,
	newDraftAudience,
	threadReferenceId,
	type ThreadWorkTarget,
} from '../workingSet'
import { workPublication } from '../workPublication'
import { removeConversationReference, setConversationEntityRole } from '../entityContext'

export function WorkingSetControls({
	chatId,
	sources,
	getDatasetName,
	suggestedReferences = [],
}: {
	chatId: string | null
	sources: EntitySearchSources
	getDatasetName?: (event: import('@/lib/nostr/geo-event').GeoDataset) => string
	suggestedReferences?: EntitySearchResult[]
}) {
	const sessions = useChatStore((state) => state.chatSessions)
	const runningChatId = useChatStore((state) => state.runningChatId)
	const session = sessions.find((item) => item.id === chatId)
	const busy = runningChatId === chatId && !!chatId
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const [over, setOver] = useState<'edit' | 'reference' | null>(null)
	const dragging = useSyncExternalStore(subscribeEntityDrag, getEntityDrag, getEntityDrag)
	useEffect(() => {
		if (dragging && chatId) setOpen(true)
	}, [dragging, chatId])
	const drafts = useEditorStore((state) => state.geoEditDrafts)
	const workspaces = useEditorStore((state) => state.workspaces)
	useSyncExternalStore(subscribeStoryDrafts, getStoryDraftRevision, getStoryDraftRevision)
	const targets = (
		session?.workingSet ??
		(session?.targetWorkspaceId
			? [mapWorkTarget(session.targetWorkspaceId)].filter(
					(item): item is ThreadWorkTarget => !!item,
				)
			: [])
	).map((item) => ({
		...item,
		title:
			(item.kind === 'dataset'
				? mapWorkTarget(item.workspaceId)?.title
				: readStoryDraft(item.draftKey)?.title) || item.title,
	}))
	const references = session?.references ?? []
	const audience = newDraftAudience(targets)
	const apply = async (item: EntityTransfer, role: 'edit' | 'reference') => {
		if (!chatId || pending) return
		setPending(true)
		try {
			await setConversationEntityRole(chatId, item, role)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not add this item.')
		} finally {
			setPending(false)
		}
	}
	const dropProps = (role: 'edit' | 'reference') => ({
		onDragOver: (event: React.DragEvent) => {
			if (!dragging || busy || pending) return
			event.preventDefault()
			event.stopPropagation()
			event.dataTransfer.dropEffect = 'copy'
			setOver(role)
		},
		onDragLeave: (event: React.DragEvent) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null)
		},
		onDrop: (event: React.DragEvent) => {
			const item = readEntityDrop(event.dataTransfer)
			if (!item) return
			event.preventDefault()
			event.stopPropagation()
			setOver(null)
			endEntityDrag()
			void apply(item, role)
		},
	})
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="flex min-h-0 min-w-0 flex-col overflow-hidden border-t border-border/60"
		>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					aria-label="AI editing and references"
					className="flex min-h-10 w-full shrink-0 items-center gap-2 text-left text-xs md:min-h-8"
				>
					{pending ? (
						<Loader2 className="size-3.5 animate-spin" />
					) : (
						<Pencil className="size-3.5 shrink-0 text-muted-foreground" />
					)}
					<span className="min-w-0 flex-1 truncate">
						AI can edit {targets.length}{' '}
						<span className="text-muted-foreground">· References {references.length}</span>
					</span>
					<ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent
				className="max-h-[48dvh] min-h-0 overflow-y-auto overscroll-contain pb-2"
				role="region"
				aria-label="AI editing and references"
			>
				<section
					{...dropProps('edit')}
					aria-label="AI can edit"
					className={`border p-2 ${over === 'edit' ? 'border-primary bg-primary/10' : 'border-border'}`}
				>
					<div className="mb-1 flex items-center justify-between gap-2">
						<h3 className="text-xs font-semibold">AI can edit</h3>
						<Button
							variant="ghost"
							size="sm"
							className="h-7 text-xs"
							onClick={() => navigateToRoute('/drafts', { preserveThread: true })}
						>
							All drafts
						</Button>
					</div>
					<p className="mb-2 text-[11px] text-muted-foreground">
						Changes stay in drafts until you publish. Other people’s maps and stories become
						proposals.
					</p>
					{!targets.length && (
						<p className="py-3 text-xs text-muted-foreground">
							Drop a map or Story here, or add a reference below and choose “Let AI edit”.
						</p>
					)}
					<ul className="max-h-[16dvh] overflow-y-auto overscroll-contain">
						{targets.map((item) => {
							const publication = workPublication(
								item,
								item.kind === 'dataset' ? workspaces[item.workspaceId] : undefined,
								item.kind === 'dataset'
									? drafts[workspaces[item.workspaceId]?.activeDraftId ?? '']
									: undefined,
								sources.datasets,
							)
							return (
								<li
									key={item.id}
									className="flex min-w-0 items-center gap-1 border-b border-border/60 py-1 last:border-0"
								>
									<EntityDragHandle item={transferFromTarget(item)} />
									<div className="min-w-0 flex-1">
										<button
											type="button"
											className="block min-h-7 w-full truncate text-left text-xs font-medium hover:underline"
											title={item.title}
											onClick={() =>
												void openSavedDraft(item).catch((error) => toast.error(error.message))
											}
										>
											{item.title}
										</button>
										{publication.href ? (
											<button
												type="button"
												aria-label={`View published: ${item.title}`}
												title={publication.description}
												className={`block min-h-6 text-[11px] ${publication.modified ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400'}`}
												onClick={() => navigateToRoute(publication.href!, { preserveThread: true })}
											>
												{publication.label}
											</button>
										) : (
											<span className="text-[11px] text-muted-foreground">{publication.label}</span>
										)}
										{item.featureIds && (
											<span className="block text-[11px] text-muted-foreground">
												Only {item.featureIds.length} selected features
											</span>
										)}
									</div>
									<DraftRowActions target={item} />
									<Button
										size="icon"
										variant="ghost"
										className="size-9 shrink-0"
										aria-label={`Stop AI editing ${item.title}`}
										title="Stop AI editing; keep the draft"
										disabled={busy || pending}
										onClick={() =>
											chatId &&
											useChatStore.getState().setWorkingSet(
												chatId,
												targets.filter((other) => other.id !== item.id),
											)
										}
									>
										<Unlink className="size-3.5" />
									</Button>
								</li>
							)
						})}
					</ul>
					<label className="mt-1 flex min-h-9 items-center gap-2 border-t text-xs">
						<input
							type="checkbox"
							disabled={!chatId || busy}
							checked={session?.allowCreate ?? false}
							onChange={(event) =>
								chatId && useChatStore.getState().setAllowCreate(chatId, event.target.checked)
							}
						/>
						Create new maps and stories
					</label>
					{session?.allowCreate && audience.kind !== 'public' && (
						<p className="text-[11px] text-muted-foreground">
							New maps retain this conversation’s audience; new Stories are public drafts.
						</p>
					)}
				</section>
				<section
					{...dropProps('reference')}
					aria-label="Read-only references"
					className={`mt-2 border p-2 ${over === 'reference' ? 'border-primary bg-primary/10' : 'border-border'}`}
				>
					<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
						<Link2 className="size-3.5" />
						References <span className="font-normal text-muted-foreground">· Read-only</span>
					</h3>
					<EntitySearchPopover
						dragHandles={false}
						sources={sources}
						getDatasetName={getDatasetName}
						searchMode="both"
						entityTypes={['dataset', 'story', 'context', 'feature', 'beacon', 'sighting', 'person']}
						placeholder="Search maps, stories, atlases…"
						onSelect={(result) => void apply(transferFromResult(result), 'reference')}
					/>
					{!references.length && (
						<p className="py-2 text-[11px] text-muted-foreground">
							Search or drop sources here. Reading them does not let AI change them.
						</p>
					)}
					{!references.length &&
						suggestedReferences.slice(0, 1).map((result) => (
							<Button
								key={result.id}
								size="sm"
								variant="ghost"
								className="max-w-full justify-start text-xs"
								disabled={busy || pending}
								onClick={() => void apply(transferFromResult(result), 'reference')}
							>
								<Link2 className="size-3.5" />
								<span className="truncate">Reference {result.name}</span>
							</Button>
						))}
					<ul className="max-h-[16dvh] overflow-y-auto overscroll-contain">
						{references.map((reference) => (
							<li
								key={threadReferenceId(reference)}
								className="flex min-w-0 items-center gap-1 border-b border-border/60 py-1 last:border-0"
							>
								<EntityDragHandle item={reference} />
								<div className="min-w-0 flex-1 text-xs">
									<span className="block truncate" title={reference.name}>
										{reference.name}
									</span>
									<span className="block truncate text-[11px] text-muted-foreground">
										{reference.featureId ? 'One feature · ' : ''}
										{reference.localWorkspaceId || reference.localStoryDraftKey
											? 'Local draft · '
											: ''}
										Read-only
									</span>
								</div>
								{['dataset', 'story', 'feature'].includes(reference.type) && (
									<Button
										size="icon"
										variant="ghost"
										className="size-9 shrink-0"
										aria-label={`Let AI edit ${reference.name}`}
										title="Let AI edit"
										disabled={busy || pending}
										onClick={() => void apply(reference, 'edit')}
									>
										<Pencil className="size-3.5" />
									</Button>
								)}
								<Button
									size="icon"
									variant="ghost"
									className="size-9 shrink-0"
									aria-label={`Remove reference ${reference.name}`}
									disabled={busy || pending}
									onClick={() => {
										try {
											if (chatId) removeConversationReference(chatId, reference)
										} catch (error) {
											toast.error((error as Error).message)
										}
									}}
								>
									<X className="size-3.5" />
								</Button>
							</li>
						))}
					</ul>
					<p className="mt-2 text-[11px] text-muted-foreground">
						Sources are sent to your AI provider. Removing them affects future messages, not earlier
						messages or Story citations.
					</p>
				</section>
				{busy && (
					<p className="pt-2 text-[11px] text-muted-foreground">
						Stop the response to change editing access or references.
					</p>
				)}
			</CollapsibleContent>
		</Collapsible>
	)
}
