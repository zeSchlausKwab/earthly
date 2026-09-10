import { useRef, useState, useSyncExternalStore } from 'react'
import { BookOpen, Check, ChevronDown, Layers, Pencil, Unlink } from 'lucide-react'
import { workPublication } from '../workPublication'
import { DraftRowActions } from '@/components/DraftRowActions'
import { openSavedDraft } from '@/features/geo-editor/draftActions'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useChatStore } from '../store'
import { mapWorkTarget, newDraftAudience, type ThreadWorkTarget } from '../workingSet'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	getStoryEditorTarget,
	subscribeStoryEditorOpenRequests,
} from '@/features/geo-editor/storyEditorBridge'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import { nip19 } from 'nostr-tools'
import {
	NEW_STORY_DRAFT_KEY,
	readStoryDraft,
	getStoryDraftRevision,
	subscribeStoryDrafts,
} from '@/lib/nostr/story'
import { accounts } from '@/lib/nostr'

export function WorkingSetControls({
	chatId,
	onAddViewedMap,
	viewedTitle,
	viewedKey,
}: {
	chatId: string | null
	onAddViewedMap?: () => Promise<string | null>
	viewedTitle?: string
	viewedKey?: string
}) {
	const sessions = useChatStore((state) => state.chatSessions)
	const session = sessions.find((item) => item.id === chatId)
	const [open, setOpen] = useState(false)
	const [pending, setPending] = useState(false)
	const navigating = useRef(false)
	const closeForNavigation = () => {
		navigating.current = true
		setOpen(false)
	}
	useEditorStore((state) => state.geoEditDrafts)
	const workspaces = useEditorStore((state) => state.workspaces)
	useSyncExternalStore(subscribeStoryDrafts, getStoryDraftRevision, getStoryDraftRevision)
	const storyTarget = useSyncExternalStore(
		subscribeStoryEditorOpenRequests,
		getStoryEditorTarget,
		getStoryEditorTarget,
	)
	const targets = (
		session?.workingSet ??
		(session?.targetWorkspaceId
			? [mapWorkTarget(session.targetWorkspaceId)].filter((item): item is ThreadWorkTarget =>
					Boolean(item),
				)
			: [])
	).map((item) => ({
		...item,
		title:
			(item.kind === 'dataset'
				? mapWorkTarget(item.workspaceId)?.title
				: readStoryDraft(item.draftKey)?.title) || item.title,
	}))
	const storyKey = storyTarget?.draftKey ?? storyTarget?.story?.dTag ?? NEW_STORY_DRAFT_KEY
	const storyTitle =
		readStoryDraft(storyKey)?.title || storyTarget?.story?.article.title || 'Untitled Story'
	const audience = newDraftAudience(targets)
	const viewedMapId = viewedKey?.startsWith('map-draft:')
		? viewedKey.slice('map-draft:'.length)
		: null
	const hasViewedMap = targets.some(
		(item) => item.kind === 'dataset' && item.workspaceId === viewedMapId,
	)
	const hasStory = targets.some((item) => item.kind === 'story' && item.draftKey === storyKey)
	const label = targets.length
		? `AI can edit: ${targets[0]!.title}${targets.length > 1 ? ` + ${targets.length - 1}` : ''}`
		: session?.allowCreate
			? 'AI: Create maps & stories'
			: 'AI: Answer questions only'

	const add = (item: ThreadWorkTarget) => {
		if (!chatId) return
		const latest = useChatStore.getState().chatSessions.find((chat) => chat.id === chatId)
		useChatStore
			.getState()
			.setWorkingSet(chatId, [
				...(latest?.workingSet ?? []).filter((target) => target.id !== item.id),
				item,
			])
	}
	const addMap = async () => {
		if (!onAddViewedMap || pending) return
		setPending(true)
		try {
			const id = await onAddViewedMap()
			const item = id ? mapWorkTarget(id) : null
			if (!item) throw new Error('Open this map in the editor, then try again.')
			add(item)
			setOpen(false)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Map unavailable')
		} finally {
			setPending(false)
		}
	}
	const addStory = () => {
		if (!storyTarget) return
		add({
			id: `story:${storyKey}`,
			kind: 'story',
			draftKey: storyKey,
			title: storyTitle,
			intent: storyTarget.story
				? storyTarget.story.pubkey === accounts.active?.pubkey
					? 'edit'
					: 'propose'
				: 'create',
			storyReference: storyTarget.story
				? `nostr:${nip19.naddrEncode({ kind: storyTarget.story.kind, pubkey: storyTarget.story.pubkey, identifier: storyTarget.story.dTag! })}`
				: undefined,
		})
		setOpen(false)
	}
	return (
		<div className="min-w-0 shrink-0 py-1">
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger asChild>
					<button
						type="button"
						aria-label={label}
						className="flex min-h-11 w-full min-w-0 items-center gap-1.5 text-left text-xs md:min-h-7"
						title={targets.map((item) => item.title).join(', ') || label}
					>
						<Pencil className="size-3.5 shrink-0 text-muted-foreground" />
						<span className="min-w-0 truncate">{label}</span>
						<ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
					</button>
				</PopoverTrigger>
				<PopoverContent
					align="start"
					aria-label="AI editing"
					className="z-[80] max-h-[min(65dvh,var(--radix-popover-content-available-height))] w-[min(440px,calc(100vw-24px))] gap-3 overflow-y-auto rounded-none p-3"
					onCloseAutoFocus={(event) => {
						if (navigating.current) event.preventDefault()
						navigating.current = false
					}}
				>
					<div>
						<h3 className="font-semibold">What AI can edit</h3>
						<p className="mt-1 text-xs text-muted-foreground">
							Maps and stories available to this conversation. Published items are marked below;
							further edits stay local until you publish again.
						</p>
					</div>
					{targets.length ? (
						<ul className="space-y-1">
							{targets.map((item) => {
								const publication = workPublication(
									item,
									item.kind === 'dataset' ? workspaces[item.workspaceId] : undefined,
								)
								return (
									<li
										key={item.id}
										className="flex min-w-0 items-center gap-1 border-b border-border/60 py-1 last:border-0"
									>
										{item.kind === 'story' ? (
											<BookOpen className="size-3.5 shrink-0" />
										) : (
											<Layers className="size-3.5 shrink-0" />
										)}
										<div className="min-w-0 flex-1">
											<button
												type="button"
												aria-label={item.title}
												title={item.title}
												className="min-h-7 w-full min-w-0 truncate text-left underline"
												onClick={() => {
													closeForNavigation()
													void openSavedDraft(item).catch((error) => toast.error(error.message))
												}}
											>
												<span className="block truncate">{item.title}</span>
												{publication.href && item.intent === 'fork' && (
													<span className="block text-[11px] text-muted-foreground">Your copy</span>
												)}
												{item.featureIds && (
													<span className="block text-[11px] text-muted-foreground">
														{item.featureIds.length} features
													</span>
												)}
											</button>
											{publication.href ? (
												<button
													type="button"
													className="flex min-h-6 items-center gap-1 text-[11px] text-emerald-700 dark:text-emerald-400"
													title={publication.description}
													aria-label={`View published: ${item.title}`}
													onClick={() => {
														closeForNavigation()
														if (publication.href) navigateToRoute(publication.href)
													}}
												>
													<Check className="size-3" />
													{publication.label}
												</button>
											) : (
												<span
													className="block text-[11px] text-muted-foreground"
													title={publication.description}
												>
													{publication.label}
												</span>
											)}
										</div>
										<DraftRowActions target={item} onNavigate={closeForNavigation} />
										<Button
											size="icon"
											variant="ghost"
											className="size-11 shrink-0 border-l md:size-8"
											aria-label={`Stop AI editing ${item.title}`}
											title="Stop AI editing this; keep the draft"
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
					) : (
						<p className="text-xs text-muted-foreground">No existing maps or stories selected.</p>
					)}
					<Button
						variant="ghost"
						size="sm"
						className="justify-start"
						onClick={() => {
							closeForNavigation()
							navigateToRoute('/drafts', { preserveThread: true })
						}}
					>
						All drafts
					</Button>
					{onAddViewedMap && !hasViewedMap && (
						<Button
							variant="outline"
							size="sm"
							className="h-auto min-h-9 whitespace-normal justify-start text-left"
							disabled={pending}
							title={viewedTitle}
							onClick={() => void addMap()}
						>
							<Pencil className="size-3.5 shrink-0" />
							Edit this map with AI
						</Button>
					)}
					{storyTarget && !hasStory && (
						<Button
							variant="outline"
							size="sm"
							className="h-auto min-h-9 whitespace-normal justify-start text-left"
							onClick={addStory}
						>
							<BookOpen className="size-3.5 shrink-0" />
							Edit {storyTitle} with AI
						</Button>
					)}
					<label className="flex min-h-9 items-center gap-2 border-t pt-2">
						<input
							type="checkbox"
							checked={session?.allowCreate ?? false}
							onChange={(event) =>
								chatId && useChatStore.getState().setAllowCreate(chatId, event.target.checked)
							}
						/>
						Create new maps and stories
					</label>
					{session?.allowCreate && audience.kind !== 'public' && (
						<p className="text-xs text-muted-foreground">
							{audience.kind === 'private-group'
								? 'New maps stay in the same private Circle.'
								: audience.kind === 'field-session'
									? 'New maps stay in the same Nearby session.'
									: 'Choose an audience before creating new maps.'}{' '}
							Stories are public drafts.
						</p>
					)}
				</PopoverContent>
			</Popover>
		</div>
	)
}
