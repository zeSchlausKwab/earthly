import { useState } from 'react'
import { BookOpen, Layers, LockKeyhole, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useChatStore } from '../store'
import { mapWorkTarget, newDraftAudience, type ThreadWorkTarget } from '../workingSet'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	getStoryEditorTarget,
	requestOpenStoryEditor,
} from '@/features/geo-editor/storyEditorBridge'
import { navigateToRoute } from '@/features/geo-editor/hooks/useRouting'
import { nip19 } from 'nostr-tools'
import { NEW_STORY_DRAFT_KEY, readStoryDraft } from '@/lib/nostr/story'
import { accounts } from '@/lib/nostr'
import { openChatWorkspace } from '@/features/geo-editor/authoringTaskBridge'

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
	const [pending, setPending] = useState(false)
	const workspaces = useEditorStore((state) => state.workspaces)
	const drafts = useEditorStore((state) => state.geoEditDrafts)
	const activeWorkspaceId = useEditorStore((state) => state.activeWorkspaceId)
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
	const drawingDraftId = activeWorkspaceId ? workspaces[activeWorkspaceId]?.activeDraftId : null
	const drawingTitle = drawingDraftId
		? drafts[drawingDraftId]?.collectionMeta.name || 'Untitled Map'
		: null
	const audience = newDraftAudience(targets)
	const addViewedReference = () => {
		if (!chatId || !viewedKey) return
		const separator = viewedKey.indexOf(':')
		const kind = viewedKey.slice(0, separator)
		const address = viewedKey.slice(separator + 1)
		if (!address || separator < 0) return
		useChatStore.getState().addReferenceToChat(chatId, {
			id: viewedKey,
			name: viewedTitle || 'Reference',
			type: kind === 'story' ? 'story' : kind === 'atlas' ? 'context' : 'dataset',
			...(kind === 'map-draft' ? { localWorkspaceId: address } : { address }),
		})
	}
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
			if (!item) throw new Error('Open the Map working copy before adding it.')
			add(item)
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Map unavailable')
		} finally {
			setPending(false)
		}
	}
	const addStory = () => {
		const target = getStoryEditorTarget()
		if (!target) return toast.info('Open the Story editor using Edit or Propose changes first.')
		const key = target.draftKey ?? target.story?.dTag ?? NEW_STORY_DRAFT_KEY
		add({
			id: `story:${key}`,
			kind: 'story',
			draftKey: key,
			title: target.story?.article.title || 'Untitled Story',
			intent: target.story
				? target.story.pubkey === accounts.active?.pubkey
					? 'edit'
					: 'propose'
				: 'create',
			storyReference: target.story
				? `nostr:${nip19.naddrEncode({ kind: target.story.kind, pubkey: target.story.pubkey, identifier: target.story.dTag! })}`
				: undefined,
		})
	}
	return (
		<details className="shrink-0 border-b px-3 py-2 text-xs">
			<summary
				className="cursor-pointer truncate font-medium"
				title={targets.map((item) => item.title).join(', ')}
			>
				Working on:{' '}
				{targets.length
					? `${targets[0]!.title}${targets.length > 1 ? ` + ${targets.length - 1}` : ''}`
					: session?.allowCreate
						? 'New local drafts'
						: 'Read-only'}{' '}
				· {session?.references.length ?? 0} references
			</summary>
			<div className="mt-2 max-h-[35dvh] space-y-2 overflow-y-auto" aria-label="Thread working set">
				<p className="text-muted-foreground">
					Viewing: {viewedTitle || 'Map'}. Viewing and drawing do not change this Thread’s
					permissions.
				</p>
				{drawingTitle && <p className="text-muted-foreground">Drawing into: {drawingTitle}</p>}
				{targets.map((item) => (
					<div key={item.id} className="flex items-center gap-2">
						{item.kind === 'story' ? (
							<BookOpen className="size-3.5" />
						) : (
							<Layers className="size-3.5" />
						)}
						<button
							type="button"
							className="min-w-0 flex-1 truncate text-left underline"
							onClick={() => {
								if (item.kind === 'story') {
									if (item.storyReference)
										navigateToRoute(`/story/${item.storyReference.replace(/^nostr:/, '')}/edit`)
									else requestOpenStoryEditor(null, item.draftKey, { reveal: true })
								} else {
									void openChatWorkspace(item.workspaceId).catch((error) =>
										toast.error(error.message),
									)
								}
							}}
						>
							{item.title}
						</button>
						<span className="shrink-0 text-muted-foreground">
							{
								{ create: 'New draft', edit: 'Editing', propose: 'Proposal', fork: 'Fork' }[
									item.intent
								]
							}
							{item.featureIds ? ` · only ${item.featureIds.length} features` : ''}
						</span>
						<Button
							size="icon"
							variant="ghost"
							className="size-8"
							aria-label={`Remove ${item.title} from working set`}
							onClick={() =>
								chatId &&
								useChatStore.getState().setWorkingSet(
									chatId,
									targets.filter((other) => other.id !== item.id),
								)
							}
						>
							<X className="size-3.5" />
						</Button>
					</div>
				))}
				<div className="flex flex-wrap gap-1">
					{viewedKey?.includes(':') && (
						<Button size="sm" variant="outline" onClick={addViewedReference}>
							<Plus className="size-3.5" /> Reference viewed object
						</Button>
					)}
					{onAddViewedMap && (
						<Button size="sm" variant="outline" disabled={pending} onClick={() => void addMap()}>
							<Plus className="size-3.5" /> Add Map working copy
						</Button>
					)}
					{getStoryEditorTarget() && (
						<Button size="sm" variant="outline" onClick={addStory}>
							<Plus className="size-3.5" /> Add{' '}
							{getStoryEditorTarget()?.story?.article.title || 'Story draft'} edit
						</Button>
					)}
					<Button size="sm" variant="ghost" onClick={() => useChatStore.getState().createChat()}>
						New Thread
					</Button>
				</div>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={session?.allowCreate ?? false}
						onChange={(event) =>
							chatId && useChatStore.getState().setAllowCreate(chatId, event.target.checked)
						}
					/>{' '}
					Allow requested new local Maps and Stories
				</label>
				{session?.allowCreate && (
					<p className="text-muted-foreground">
						New Maps:{' '}
						{audience.kind === 'public'
							? 'public drafts'
							: audience.kind === 'private-group'
								? 'same private Circle'
								: audience.kind === 'field-session'
									? 'same Nearby session'
									: 'choose an audience first'}
						. New Stories: public drafts. Nothing is published automatically.
					</p>
				)}
				<p className="flex items-center gap-1 text-muted-foreground">
					<LockKeyhole className="size-3" /> References are read-only, including foreign Maps and
					features.
				</p>
				{session?.references.map((reference) => (
					<div
						key={`${reference.id}:${reference.featureId ?? ''}`}
						className="flex items-center gap-2"
					>
						<LockKeyhole className="size-3" />
						<span className="min-w-0 flex-1 truncate">
							{reference.name}
							{reference.featureId ? ' · one feature' : ''}
							{reference.localWorkspaceId ? ' · local draft' : ''}
						</span>
						<Button
							size="icon"
							variant="ghost"
							className="size-8"
							aria-label={`Remove reference ${reference.name}`}
							onClick={() =>
								useChatStore
									.getState()
									.setReferences(session.references.filter((item) => item !== reference))
							}
						>
							<X className="size-3.5" />
						</Button>
					</div>
				))}
				<p className="text-muted-foreground">
					Attached content is sent to your configured AI provider. Removing it affects future turns,
					not earlier messages or existing Story citations.
				</p>
				{sessions.length > 1 && (
					<label className="block">
						Thread{' '}
						<select
							aria-label="Select work Thread"
							value={chatId ?? ''}
							onChange={(event) => useChatStore.getState().switchChat(event.target.value)}
						>
							{sessions.map((chat) => (
								<option key={chat.id} value={chat.id}>
									{chat.title}
								</option>
							))}
						</select>
					</label>
				)}
			</div>
		</details>
	)
}
