import { castEvent } from 'applesauce-core/casts'
import { accounts, eventStore } from '@/lib/nostr'
import { Article, getArticleContent, isArticle } from '@/lib/nostr/article'
import {
	clearStoryDraft,
	readStoryDraft,
	storyContentFingerprint,
	writeStoryDraft,
	type StoryDraft,
} from '@/lib/nostr/story/draft'
import { editStory, publishStory, validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import { naddrToCoordinate, coordinateToNaddrReference } from '@/lib/nostr/references'
import { resolveLocalStoryDependencies } from '@/features/chat/referencePublishing/localStoryDependencies'
import { getStoryEditorTarget, requestOpenStoryEditor } from './storyEditorBridge'
import { useEditorStore } from './store'
import type { DraftActionTarget } from './draftActions'

type StoryTarget = Extract<DraftActionTarget, { kind: 'story' }>
type MountedStory = {
	flush: () => void
	published: () => void
	resolvedBody: (body: string) => void
}
const mounted = new Map<string, MountedStory>()
export function registerStoryPublicationEditor(key: string, editor: MountedStory) {
	mounted.set(key, editor)
	return () => {
		if (mounted.get(key) === editor) mounted.delete(key)
	}
}

export function savedStorySource(target: StoryTarget) {
	const draft = readStoryDraft(target.draftKey)
	const reference = draft?.publication?.reference ?? target.storyReference
	if (!reference) return null
	const coordinate = naddrToCoordinate(reference.replace(/^nostr:/, ''))
	if (!coordinate)
		throw new Error('This Story’s published address is invalid. Reopen it before publishing.')
	const [kind, pubkey, ...identifier] = coordinate.split(':')
	const event = draft?.publication?.eventId
		? eventStore.getEvent(draft.publication.eventId)
		: eventStore.getReplaceable(Number(kind), pubkey!, identifier.join(':'))
	if (!event || !isArticle(event))
		throw new Error(
			'The published Story is not loaded yet. Open its published version, then try again.',
		)
	if (
		`${event.kind}:${event.pubkey}:${event.tags.find((tag) => tag[0] === 'd')?.[1]}` !== coordinate
	)
		throw new Error('This Story no longer matches its published source.')
	return event
}

/** A proposal stays in its explicit Send proposal flow; it can never overwrite its author. */
export function canPublishSavedStory(target: StoryTarget, owner?: string): boolean {
	if (!owner) return false
	const reference = readStoryDraft(target.draftKey)?.publication?.reference ?? target.storyReference
	if (!reference) return true
	return naddrToCoordinate(reference.replace(/^nostr:/, ''))?.split(':')[1] === owner
}

export function savedStoryHasChanges(target: StoryTarget): boolean | undefined {
	const draft = readStoryDraft(target.draftKey)
	if (draft?.publication) return storyContentFingerprint(draft) !== draft.publication.fingerprint
	if (!target.storyReference) return undefined
	if (!draft) return false
	try {
		const base = savedStorySource(target)
		return base
			? storyContentFingerprint(draft) !== storyContentFingerprint(getArticleContent(base))
			: undefined
	} catch {
		return undefined
	}
}

/** Publish the clicked Story, without navigation, chat closure, or editor activation. */
export async function publishSavedStory(target: StoryTarget): Promise<Article> {
	if (useEditorStore.getState().isPublishing)
		throw new Error('Another publication is in progress. Please wait.')
	const account = accounts.active
	const signer = accounts.signer
	if (!account || !signer) throw new Error('Sign in before publishing this Story.')
	if (!canPublishSavedStory(target, account.pubkey))
		throw new Error('Use Send proposal for someone else’s Story.')
	mounted.get(target.draftKey)?.flush()
	const base = savedStorySource(target)
	const captured =
		readStoryDraft(target.draftKey) ?? (base ? { ...getArticleContent(base), updatedAt: 0 } : null)
	if (!captured) throw new Error('This Story draft is unavailable.')
	if (!captured.title?.trim()) throw new Error('Add a title before publishing this Story.')
	if (!captured.content?.trim()) throw new Error('Add some narrative before publishing this Story.')
	const content = {
		title: captured.title.trim(),
		summary: captured.summary?.trim() || undefined,
		image: captured.image?.trim() || undefined,
		content: captured.content,
		presentation: captured.presentation,
	}
	validateStoryPresentation(content, { allowLocalDraftReferences: true })
	let expected = storyContentFingerprint(captured)
	const validate = () => {
		if (accounts.active !== account)
			throw new Error('The account changed. Nothing further was published.')
		mounted.get(target.draftKey)?.flush()
		const latest = readStoryDraft(target.draftKey)
		if (latest && storyContentFingerprint(latest) !== expected)
			throw new Error(
				'This Story changed during publication. Completed Map publications are kept; review the Story and retry.',
			)
		if (!latest && captured.updatedAt !== 0)
			throw new Error('The Story draft was removed. Nothing further was published.')
	}
	useEditorStore.getState().setIsPublishing(true)
	try {
		content.content = await resolveLocalStoryDependencies(content.content, {
			storyDraftKey: target.draftKey,
			storyTitle: content.title,
			validate,
			onProgress: (body) => {
				const latest = readStoryDraft(target.draftKey) ?? captured
				writeStoryDraft(target.draftKey, { ...latest, content: body }, account.pubkey)
				expected = storyContentFingerprint({ ...content, content: body })
				mounted.get(target.draftKey)?.resolvedBody(body)
			},
		})
		validate()
		const signed = base
			? await editStory(base, content, signer, validate)
			: await publishStory(content, signer, validate)
		const story = castEvent(signed, Article, eventStore)
		const reference = coordinateToNaddrReference(`${story.kind}:${story.pubkey}:${story.dTag}`)
		if (!reference || !story.dTag)
			throw new Error('The published Story did not return a usable address.')
		if (accounts.active !== account) return story
		// Changes made while the relay acknowledgement was pending remain local.
		mounted.get(target.draftKey)?.flush()
		const latest = readStoryDraft(target.draftKey) ?? captured
		const retained: StoryDraft = {
			...latest,
			publication: { reference, eventId: signed.id, fingerprint: storyContentFingerprint(content) },
		}
		mounted.get(target.draftKey)?.published()
		if (target.draftKey !== story.dTag) clearStoryDraft(target.draftKey, account.pubkey)
		writeStoryDraft(story.dTag, retained, account.pubkey)
		const { reconcileStoryThreadTarget } = await import('@/features/chat/store')
		if (accounts.active !== account) return story
		reconcileStoryThreadTarget(target.draftKey, {
			draftKey: story.dTag,
			reference,
			title: content.title,
		})
		const active = getStoryEditorTarget()
		if (active && (active.draftKey ?? active.story?.dTag) === target.draftKey)
			requestOpenStoryEditor(story, story.dTag)
		return story
	} finally {
		useEditorStore.getState().setIsPublishing(false)
	}
}
