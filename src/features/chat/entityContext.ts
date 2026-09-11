import { castEvent } from 'applesauce-core/casts'
import { toast } from 'sonner'
import { accounts, eventStore } from '@/lib/nostr'
import { Article, getArticleContent, isArticle } from '@/lib/nostr/article'
import { GeoDataset } from '@/lib/nostr/geo-event'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { naddrToCoordinate, parseNostrAddressReference } from '@/lib/nostr/references'
import { readStoryDraft, writeStoryDraft, storyContentFingerprint } from '@/lib/nostr/story/draft'
import { prepareChatMap } from '@/features/geo-editor/authoringTaskBridge'
import { useEditorStore } from '@/features/geo-editor/store'
import type { EntityTransfer } from '@/components/entity-list/entityTransfer'
import { useChatStore, type ChatReference } from './store'
import { mapWorkTarget, threadReferenceId, type ThreadWorkTarget } from './workingSet'

function sessionForChange(chatId: string) {
	const state = useChatStore.getState()
	const session = state.chatSessions.find((item) => item.id === chatId)
	if (!session) throw new Error('Open a conversation first, then add this item.')
	if (state.runningChatId === chatId)
		throw new Error('Stop the current response before changing its editing access or references.')
	return session
}

export function referenceFromTransfer(item: EntityTransfer): ChatReference {
	const { workTarget: _target, ...reference } = item
	if (reference.address) {
		const parsed = parseNostrAddressReference(
			reference.address.startsWith('nostr:') ? reference.address : `nostr:${reference.address}`,
		)
		if (!parsed) throw new Error('This reference has no valid address.')
		if (parsed.featureId && reference.featureId && parsed.featureId !== reference.featureId)
			throw new Error('The feature reference is inconsistent.')
		reference.address = parsed.address
		reference.featureId ??= parsed.featureId
	}
	if (reference.type === 'feature' && !reference.featureId)
		throw new Error('This feature has no stable identifier. Add its map explicitly instead.')
	if (reference.type === 'person') {
		if (!reference.pubkey || !/^[a-f0-9]{64}$/i.test(reference.pubkey))
			throw new Error('This person has no valid profile identity.')
	} else if (!reference.address && !reference.localWorkspaceId && !reference.localStoryDraftKey)
		throw new Error('This item has no readable source yet.')
	return reference
}

async function prepareTarget(reference: ChatReference, fork: boolean): Promise<ThreadWorkTarget> {
	if (reference.localWorkspaceId) {
		const target = mapWorkTarget(reference.localWorkspaceId)
		if (!target) throw new Error('This map draft is unavailable.')
		if (reference.featureId) {
			const state = useEditorStore.getState()
			const draft =
				state.geoEditDrafts[state.workspaces[reference.localWorkspaceId]!.activeDraftId!]
			if (!draft?.features.some((feature) => String(feature.id) === reference.featureId))
				throw new Error('This feature is no longer in the draft.')
			return { ...target, featureIds: [reference.featureId] }
		}
		return target
	}
	if (reference.localStoryDraftKey) {
		const draft = readStoryDraft(reference.localStoryDraftKey)
		if (!draft) throw new Error('This Story draft is unavailable.')
		const storyReference = draft.publication?.reference ?? reference.address
		const author = storyReference
			? naddrToCoordinate(storyReference.replace(/^nostr:/, ''))?.split(':')[1]
			: null
		return {
			id: `story:${reference.localStoryDraftKey}`,
			kind: 'story',
			draftKey: reference.localStoryDraftKey,
			title: draft.title || reference.name,
			storyReference,
			intent: author ? (author === accounts.active?.pubkey ? 'edit' : 'propose') : 'create',
		}
	}
	const coordinate = reference.address && naddrToCoordinate(reference.address)
	if (!coordinate) throw new Error('This item cannot be edited.')
	const [kind, pubkey, ...identifier] = coordinate.split(':')
	const event = eventStore.getReplaceable(Number(kind), pubkey!, identifier.join(':'))
	if (!event) throw new Error('This item is not loaded. Open it once, then try again.')
	if (['dataset', 'feature'].includes(reference.type) && event.kind === GEO_EVENT_KIND) {
		const dataset = castEvent(event, GeoDataset, eventStore)
		const workspaceId = await prepareChatMap(dataset, fork)
		let featureId = reference.featureId
		if (featureId) {
			const sourceFeature = dataset.featureCollection.features.find(
				(feature) => String(feature.id) === featureId,
			)
			if (sourceFeature && typeof sourceFeature.id === 'number')
				featureId = `${dataset.datasetId}:${sourceFeature.id}`
		}
		return prepareTarget({ ...reference, localWorkspaceId: workspaceId, featureId }, false)
	}
	if (reference.type === 'story' && isArticle(event)) {
		const story = castEvent(event, Article, eventStore)
		if (!story.dTag) throw new Error('This Story has no identifier.')
		const saved = readStoryDraft(story.dTag)
		const knownReferences = [
			saved?.publication?.reference,
			...useChatStore
				.getState()
				.chatSessions.flatMap((chat) =>
					(chat.workingSet ?? []).flatMap((target) =>
						target.kind === 'story' && target.draftKey === story.dTag
							? [target.storyReference]
							: [],
					),
				),
		].filter((value): value is string => !!value)
		if (
			knownReferences.some(
				(value) => naddrToCoordinate(value.replace(/^nostr:/, '')) !== coordinate,
			)
		)
			throw new Error(
				'A different Story already uses this draft identifier. Keep this Story as a reference to avoid overwriting saved work.',
			)
		if (!saved?.publication) {
			const source = getArticleContent(event)
			writeStoryDraft(story.dTag, {
				...(saved ?? { ...source, updatedAt: Date.now() }),
				publication: {
					reference: `nostr:${reference.address}`,
					eventId: event.id,
					fingerprint: storyContentFingerprint(source),
				},
			})
		}
		return {
			id: `story:${story.dTag}`,
			kind: 'story',
			draftKey: story.dTag,
			title: story.article.title || reference.name,
			storyReference: `nostr:${reference.address}`,
			intent: event.pubkey === accounts.active?.pubkey ? 'edit' : 'propose',
		}
	}
	throw new Error('AI can edit Maps and Stories. Keep this item as a read-only reference.')
}

/** A role change never navigates, publishes, or deletes saved work. */
export async function setConversationEntityRole(
	chatId: string,
	item: EntityTransfer,
	role: 'edit' | 'reference',
	fork = false,
) {
	const account = accounts.active
	sessionForChange(chatId)
	const reference = referenceFromTransfer(item)
	if (role === 'edit' && !account) throw new Error('Sign in before adding an editable draft.')
	let target = role === 'edit' ? await prepareTarget(reference, fork) : null
	if (target && item.workTarget?.featureIds) {
		if (target.kind !== 'dataset')
			throw new Error('Only Maps can have feature-only editing access.')
		const state = useEditorStore.getState()
		const draft = state.geoEditDrafts[state.workspaces[target.workspaceId]?.activeDraftId ?? '']
		if (
			!item.workTarget.featureIds.length ||
			!item.workTarget.featureIds.every((id) =>
				draft?.features.some((feature) => String(feature.id) === id),
			)
		)
			throw new Error('Some of these features are no longer available.')
		target = { ...target, featureIds: item.workTarget.featureIds }
	}
	if (accounts.active !== account) throw new Error('The account changed. Please try again.')
	const session = sessionForChange(chatId)
	const current =
		session.workingSet ??
		(session.targetWorkspaceId
			? [mapWorkTarget(session.targetWorkspaceId)].filter(
					(item): item is ThreadWorkTarget => !!item,
				)
			: [])
	let targets = current
	let references = session.references ?? []
	if (target) {
		const existing = targets.find((item) => item.id === target.id)
		// Explicitly selecting another feature unions only those selected features.
		const next =
			existing && !existing.featureIds
				? existing
				: existing?.featureIds && target.featureIds
					? { ...target, featureIds: [...new Set([...existing.featureIds, ...target.featureIds])] }
					: target
		targets = [...targets.filter((item) => item.id !== target.id), next]
		references = references.filter(
			(item) => threadReferenceId(item) !== threadReferenceId(reference),
		)
	} else {
		if (item.workTarget) targets = targets.filter((target) => target.id !== item.workTarget!.id)
		const additions = item.workTarget?.featureIds?.map((featureId) => ({
			...reference,
			type: 'feature' as const,
			featureId,
			id: `${reference.id}#${featureId}`,
		})) ?? [reference]
		const seen = new Set(references.map(threadReferenceId))
		references = [
			...references,
			...additions.filter((item) => {
				const key = threadReferenceId(item)
				if (seen.has(key)) return false
				seen.add(key)
				return true
			}),
		]
	}
	useChatStore.setState((state) => ({
		chatSessions: state.chatSessions.map((chat) =>
			chat.id === chatId
				? {
						...chat,
						workingSet: targets,
						references,
						readOnly: !targets.length && !chat.allowCreate,
						targetWorkspaceId: targets.find((item) => item.kind === 'dataset')?.workspaceId ?? null,
						updatedAt: Date.now(),
					}
				: chat,
		),
		...(state.activeChatId === chatId ? { references } : {}),
	}))
	toast.success(
		role === 'reference'
			? `Added read-only reference: ${reference.name}`
			: target?.intent === 'propose'
				? `AI can propose changes to ${target.title}`
				: `AI can edit ${target?.title}`,
	)
}

export async function addEntityToActiveConversation(
	item: EntityTransfer,
	role: 'edit' | 'reference',
	fork = false,
) {
	const chatId = useChatStore.getState().activeChatId
	if (!chatId) throw new Error('Open a conversation first, then add this item.')
	await setConversationEntityRole(chatId, item, role, fork)
}

export function removeConversationReference(chatId: string, reference: ChatReference) {
	const session = sessionForChange(chatId)
	const references = (session.references ?? []).filter(
		(item) => threadReferenceId(item) !== threadReferenceId(reference),
	)
	useChatStore.setState((state) => ({
		chatSessions: state.chatSessions.map((chat) =>
			chat.id === chatId ? { ...chat, references } : chat,
		),
		...(state.activeChatId === chatId ? { references } : {}),
	}))
}
