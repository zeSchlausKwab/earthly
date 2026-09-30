import { naddrToCoordinate } from '@/lib/nostr/references'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { useState, useSyncExternalStore } from 'react'
import { Ellipsis, Link2, Loader2, Pencil, Unlink, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DraftRowActions } from '@/components/DraftRowActions'
import {
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { ChatMenu, useChatNavigation } from './ChatPanelNavigation'

export function WorkingSetControls({
	chatId,
	view,
	sources,
	getDatasetName,
	suggestedReferences = [],
}: {
	chatId: string | null
	view: 'edit' | 'sources'
	sources: EntitySearchSources
	getDatasetName?: (event: import('@/lib/nostr/geo-event').GeoDataset) => string
	suggestedReferences?: EntitySearchResult[]
}) {
	const sessions = useChatStore((state) => state.chatSessions)
	const runningChatId = useChatStore((state) => state.runningChatId)
	const session = sessions.find((item) => item.id === chatId)
	const busy = runningChatId === chatId && !!chatId
	const [pending, setPending] = useState(false)
	const [over, setOver] = useState(false)
	const { openView } = useChatNavigation()
	const dragging = useSyncExternalStore(subscribeEntityDrag, getEntityDrag, getEntityDrag)
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
	const role = view === 'edit' ? 'edit' : 'reference'
	const suggestions = suggestedReferences.filter(
		(result) =>
			(view === 'edit' ||
				!references.some(
					(reference) =>
						threadReferenceId(reference) === threadReferenceId(transferFromResult(result)),
				)) &&
			!targets.some((target) =>
				target.kind === 'dataset'
					? target.workspaceId === result.localWorkspaceId ||
						(!!result.address &&
							naddrToCoordinate(result.address.replace(/^nostr:/, '')) ===
								`${GEO_EVENT_KIND}:${workspaces[target.workspaceId]?.datasetKey}`)
					: target.draftKey === result.localStoryDraftKey ||
						(!!result.address &&
							target.storyReference?.replace(/^nostr:/, '') ===
								result.address.replace(/^nostr:/, '')),
			),
	)
	const apply = async (item: EntityTransfer, nextRole: 'edit' | 'reference') => {
		if (!chatId || busy || pending) return
		setPending(true)
		try {
			await setConversationEntityRole(chatId, item, nextRole)
			if (nextRole === 'edit') openView('edit')
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not add this item.')
		} finally {
			setPending(false)
		}
	}
	const runAction = async (action: () => Promise<void>) => {
		try {
			await action()
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Could not open this item.')
		}
	}
	return (
		<section
			aria-label={view === 'edit' ? 'AI can edit' : 'Read-only sources'}
			className={over ? 'bg-primary/10 outline-2 outline-primary' : undefined}
			onDragOver={(event) => {
				if (!dragging || busy || pending) return
				event.preventDefault()
				event.stopPropagation()
				event.dataTransfer.dropEffect = 'copy'
				setOver(true)
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(false)
			}}
			onDrop={(event) => {
				const item = readEntityDrop(event.dataTransfer)
				if (!item || busy || pending) return
				event.preventDefault()
				event.stopPropagation()
				setOver(false)
				endEntityDrag()
				void apply(item, role)
			}}
		>
			<div className="flex items-center justify-between gap-2">
				<h2 className="flex items-center gap-2 text-sm font-semibold">
					{view === 'edit' ? 'AI can edit' : 'Sources'}
					{pending && <Loader2 className="size-4 animate-spin" />}
				</h2>
				{view === 'edit' && (
					<Button
						variant="ghost"
						className="min-h-11 rounded-none px-2 text-xs md:min-h-8"
						onClick={() => navigateToRoute('/drafts', { preserveThread: true })}
					>
						All drafts
					</Button>
				)}
			</div>
			<p className="mb-5 mt-1 text-xs text-muted-foreground">
				{view === 'edit'
					? 'Changes stay in drafts until you publish. Other people’s work becomes a proposal.'
					: 'Read-only information for this conversation. Sources do not grant editing access.'}
			</p>
			{view === 'edit' ? (
				<>
					<ul className="divide-y">
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
								<li key={item.id} className="flex min-w-0 flex-wrap items-start gap-1 py-3">
									<EntityDragHandle item={transferFromTarget(item)} />
									<div className="min-w-[min(100%,12rem)] flex-1 py-1">
										<button
											type="button"
											className="block w-full break-words text-left text-xs font-medium hover:underline"
											onClick={() => void runAction(() => openSavedDraft(item))}
										>
											{item.title}
										</button>
										<p
											className={`mt-1 text-[11px] ${publication.href ? (publication.modified ? 'text-amber-700 dark:text-amber-400' : 'text-emerald-700 dark:text-emerald-400') : 'text-muted-foreground'}`}
										>
											{publication.href ? (
												<button
													type="button"
													aria-label={`View published: ${item.title}`}
													title={publication.description}
													className="min-h-6 text-left hover:underline"
													onClick={() => {
														if (publication.href)
															navigateToRoute(publication.href, { preserveThread: true })
													}}
												>
													{publication.label}
												</button>
											) : (
												<span>{publication.label}</span>
											)}{' '}
											· {item.kind === 'dataset' ? 'Map' : 'Story'}
										</p>
										{item.featureIds && (
											<p className="mt-1 text-[11px] text-muted-foreground">
												Only {item.featureIds.length} selected features
											</p>
										)}
									</div>
									<div className="ml-auto flex shrink-0 items-center gap-1">
										<DraftRowActions target={item} />
										<ChatMenu id={`target:${item.id}`}>
											<DropdownMenuTrigger asChild>
												<Button
													variant="ghost"
													size="icon"
													className="size-11 shrink-0 rounded-none md:size-9"
													aria-label={`Actions for ${item.title}`}
												>
													<Ellipsis className="size-4" />
												</Button>
											</DropdownMenuTrigger>
											<DropdownMenuContent align="end" className="z-[80] w-60 rounded-none">
												<DropdownMenuItem
													className="min-h-11"
													disabled={busy || pending}
													onSelect={() => {
														if (chatId)
															useChatStore.getState().setWorkingSet(
																chatId,
																targets.filter((other) => other.id !== item.id),
															)
													}}
												>
													<Unlink />
													Remove editing access
												</DropdownMenuItem>
											</DropdownMenuContent>
										</ChatMenu>
									</div>
								</li>
							)
						})}
					</ul>
					{!targets.length && (
						<p className="mb-4 text-xs text-muted-foreground">No editable maps or stories yet.</p>
					)}
				</>
			) : (
				<ul className="mb-4 divide-y">
					{references.map((reference) => (
						<li key={threadReferenceId(reference)} className="flex min-w-0 items-start gap-1 py-3">
							<EntityDragHandle item={reference} />
							<div className="min-w-0 flex-1 py-1">
								<span className="block break-words text-xs font-medium">{reference.name}</span>
								<span className="text-[11px] text-muted-foreground">
									{reference.featureId ? 'One feature · ' : ''}Read-only
								</span>
							</div>
							<ChatMenu id={`source:${threadReferenceId(reference)}`}>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										size="icon"
										className="size-11 shrink-0 rounded-none md:size-9"
										aria-label={`Actions for source ${reference.name}`}
									>
										<Ellipsis className="size-4" />
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="z-[80] w-60 rounded-none">
									{['dataset', 'story', 'feature'].includes(reference.type) && (
										<DropdownMenuItem
											disabled={busy || pending}
											className="min-h-11"
											onSelect={() => void apply(reference, 'edit')}
										>
											<Pencil />
											Let AI edit
										</DropdownMenuItem>
									)}
									<DropdownMenuItem
										disabled={busy || pending}
										className="min-h-11"
										onSelect={() => {
											try {
												if (chatId) removeConversationReference(chatId, reference)
											} catch (error) {
												toast.error((error as Error).message)
											}
										}}
									>
										<X />
										Remove source
									</DropdownMenuItem>
								</DropdownMenuContent>
							</ChatMenu>
						</li>
					))}
				</ul>
			)}
			<fieldset
				disabled={busy || pending || !chatId}
				className="my-4 min-w-0 space-y-2 disabled:opacity-60"
			>
				<legend className="mb-2 text-xs font-medium">
					{view === 'edit' ? 'Add map or story' : 'Add source'}
				</legend>
				<EntitySearchPopover
					key={view}
					dragHandles={false}
					sources={sources}
					getDatasetName={getDatasetName}
					searchMode="both"
					entityTypes={
						view === 'edit'
							? ['dataset', 'story', 'feature']
							: ['dataset', 'story', 'context', 'feature', 'beacon', 'sighting', 'person']
					}
					placeholder={
						view === 'edit' ? 'Search maps and stories…' : 'Search maps, stories, atlases…'
					}
					onSelect={(result) => void apply(transferFromResult(result), role)}
				/>
				{suggestions.slice(0, 1).map((result) => (
					<Button
						key={result.id}
						variant="ghost"
						className="h-auto min-h-11 w-full justify-start whitespace-normal rounded-none px-1 text-left text-xs"
						onClick={() => void apply(transferFromResult(result), role)}
					>
						{view === 'edit' ? (
							<Pencil className="size-3.5 shrink-0" />
						) : (
							<Link2 className="size-3.5 shrink-0" />
						)}
						<span>
							{view === 'edit' ? 'Let AI edit' : 'Reference'} {result.name}
						</span>
					</Button>
				))}
			</fieldset>
			{view === 'edit' ? (
				<>
					<label className="flex min-h-14 items-center justify-between gap-3 border-t py-3 text-xs">
						<span>
							<span className="block font-medium">Create new maps and stories</span>
							<span className="text-muted-foreground">Allow new outputs in this conversation.</span>
						</span>
						<input
							aria-label="Create new maps and stories"
							type="checkbox"
							className="size-4 shrink-0"
							disabled={!chatId || busy}
							checked={session?.allowCreate ?? false}
							onChange={(event) => {
								if (chatId) useChatStore.getState().setAllowCreate(chatId, event.target.checked)
							}}
						/>
					</label>
					{session?.allowCreate && audience.kind !== 'public' && (
						<p className="text-xs text-muted-foreground">
							New maps retain this conversation’s audience; new Stories are public drafts.
						</p>
					)}
					<p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
						Removing editing access keeps your work.
					</p>
				</>
			) : (
				<p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
					Sources are sent to your AI provider. Removing one affects future messages, not earlier
					replies or Story citations.
				</p>
			)}
			{busy && (
				<p className="pt-3 text-xs text-muted-foreground">
					Stop the response to change editing access or sources.
				</p>
			)}
		</section>
	)
}
