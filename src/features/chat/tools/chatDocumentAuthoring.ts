/** Chat supplies run/working-set authority to the same draft service used by WebMCP. */
import { accounts } from '@/lib/nostr'
import { readStoryDraft } from '@/lib/nostr/story/draft'
import { readGroupEditorDraft } from '@/features/groups/editorDraft'
import { useEditorStore } from '@/features/geo-editor/store'
import {
	getStoryEditorTarget,
	requestOpenStoryEditor,
	clearStoryEditorTarget,
} from '@/features/geo-editor/storyEditorBridge'
import {
	getAtlasEditorTarget,
	requestOpenAtlasEditor,
	clearAtlasEditorTarget,
} from '@/features/groups/atlasEditorBridge'
import { localMapReference } from '@/lib/nostr/story/localReferences'
import { naddrToCoordinate } from '@/lib/nostr/references'
import { toast } from 'sonner'
import { useChatStore } from '../store'
import { reportAiOutputChange } from '../outputAttention'
import { requestStoryTarget, getStoryTargetRequest, cancelStoryTarget } from '../storyTargeting'
import {
	runWorkingSet,
	resolveRunWorkTarget,
	registerRunOutput,
	threadReferenceId,
	type ThreadWorkTarget,
} from '../workingSet'
import { isToolExecutionRunActive } from './executionTarget'
import { suppressDocumentDraftFormSave } from './documentDraftForms'
import type { ToolExecutionContext } from './types'
import {
	documentDraftRevision,
	type AuthoringDocumentKind,
	type DocumentAuthoringContext,
	type DocumentAuthoringSource,
	type PreparedDocumentChange,
} from './document-authoring'

const readRevisions = new Map<string, string | null>()
const readKey = (owner: string | null, chatId: string, kind: AuthoringDocumentKind, key: string) =>
	`${owner ?? 'guest'}:${chatId}:${kind}:${key}`
function rememberRead(key: string, revision: string | null) {
	readRevisions.delete(key)
	readRevisions.set(key, revision)
	if (readRevisions.size > 500) readRevisions.delete(readRevisions.keys().next().value!)
}

function sameTarget(a: ThreadWorkTarget, b: ThreadWorkTarget) {
	return (
		a.id === b.id &&
		a.kind === b.kind &&
		a.intent === b.intent &&
		(a.kind === 'dataset'
			? b.kind === 'dataset' && a.workspaceId === b.workspaceId
			: b.kind !== 'dataset' &&
				a.draftKey === b.draftKey &&
				(a.kind === 'story'
					? b.kind === 'story' && a.storyReference === b.storyReference
					: b.kind === 'atlas' && a.atlasReference === b.atlasReference))
	)
}

function restrictedFeatures(
	captured?: readonly string[],
	current?: readonly string[],
): readonly string[] | undefined {
	return captured ? (current ? captured.filter((id) => current.includes(id)) : captured) : current
}

interface SourceGrant extends DocumentAuthoringSource {
	localWorkspaceId?: string
	localStoryDraftKey?: string
}

/** Undefined deliberately retains the legacy approved published-Story acquisition path. */
export function createChatDocumentAuthoringContext(
	context: ToolExecutionContext,
	toolName: string,
	args: Record<string, unknown> = {},
): DocumentAuthoringContext | undefined {
	const run = context.run
	if (!run?.workingSet) return undefined
	const kind = toolName.includes('atlas') ? 'atlas' : 'story'
	const ownerPubkey = accounts.active?.pubkey ?? null
	let target: ThreadWorkTarget | undefined
	let created = false
	const isRead = toolName.startsWith('read_')
	const candidates = runWorkingSet(run).filter((item) => item.kind === kind)
	if (kind === 'story' && args.createNew !== true) {
		const existing =
			typeof args.workingTarget === 'string'
				? candidates.find((item) => item.id === args.workingTarget)
				: typeof args.draftTarget === 'string'
					? candidates.find((item) => item.kind === 'story' && item.draftKey === args.draftTarget)
					: candidates.length === 1
						? candidates[0]
						: undefined
		if (
			existing?.kind === 'story' &&
			existing.storyReference &&
			!readStoryDraft(existing.draftKey, ownerPubkey)
		)
			return undefined
	}

	const grants = (): SourceGrant[] => {
		const sources: SourceGrant[] = []
		const chat = useChatStore.getState().chatSessions.find((item) => item.id === run.chatId)
		if (!chat) return sources
		for (const item of runWorkingSet(run)) {
			const live = chat.workingSet?.find((current) => sameTarget(current, item))
			if (!live) continue
			const featureIds = restrictedFeatures(item.featureIds, live.featureIds)
			if (item.kind === 'dataset') {
				sources.push({
					kind: 'map',
					title: item.title,
					reference: localMapReference(item.workspaceId),
					localWorkspaceId: item.workspaceId,
					featureIds,
				})
				if (item.target.entityId)
					sources.push({
						kind: 'map',
						title: item.title,
						reference: `37515:${item.target.entityId}`,
						featureIds,
					})
			} else if (item.kind === 'story') {
				sources.push({
					kind: 'story',
					title: item.title,
					reference: `earthly-story-draft:${encodeURIComponent(item.draftKey)}`,
					localStoryDraftKey: item.draftKey,
				})
				const coordinate =
					item.storyReference && naddrToCoordinate(item.storyReference.replace(/^nostr:/u, ''))
				if (coordinate) sources.push({ kind: 'story', title: item.title, reference: coordinate })
			}
		}
		for (const reference of run.references ?? []) {
			if (
				!chat.references.some(
					(current) => threadReferenceId(current) === threadReferenceId(reference),
				)
			)
				continue
			if (reference.localWorkspaceId)
				sources.push({
					kind: 'map',
					title: reference.name,
					reference: localMapReference(reference.localWorkspaceId),
					localWorkspaceId: reference.localWorkspaceId,
					featureIds: reference.featureId ? [reference.featureId] : undefined,
				})
			if (reference.localStoryDraftKey)
				sources.push({
					kind: 'story',
					title: reference.name,
					reference: `earthly-story-draft:${encodeURIComponent(reference.localStoryDraftKey)}`,
					localStoryDraftKey: reference.localStoryDraftKey,
				})
			const coordinate =
				reference.address && naddrToCoordinate(reference.address.replace(/^nostr:/u, ''))
			if (coordinate && /^(37515|37520):/u.test(coordinate))
				sources.push({
					kind: coordinate.startsWith('37515:') ? 'map' : 'story',
					title: reference.name,
					reference: coordinate,
					featureIds: reference.featureId ? [reference.featureId] : undefined,
				})
		}
		return sources
	}

	const assertAuthorized = () => {
		context.assertBeforeCommit?.()
		if (
			context.signal?.aborted ||
			(accounts.active?.pubkey ?? null) !== ownerPubkey ||
			(context.toolCallId && !isToolExecutionRunActive(run))
		)
			throw new Error(
				'This Thread run ended or its account changed. No document changes were applied.',
			)
		const chat = useChatStore.getState().chatSessions.find((item) => item.id === run.chatId)
		if (!chat) throw new Error('The owning Thread is unavailable. No draft changed.')
		if (target) {
			if (created) {
				if (!run.allowCreate || chat.allowCreate === false)
					throw new Error('New local draft permission was removed. No draft changed.')
			} else if (!chat.workingSet?.some((item) => sameTarget(item, target!)))
				throw new Error('The document is no longer an allowed working target. No draft changed.')
		}
	}

	const didCommit = (change: PreparedDocumentChange & { undo: () => boolean }) => {
		if (!target) return
		const title =
			change.kind === 'story'
				? 'title' in change.after
					? change.after.title
					: ''
				: 'name' in change.after
					? change.after.name
					: ''
		target = { ...target, title: title || target.title }
		const chat = useChatStore.getState().chatSessions.find((item) => item.id === run.chatId)
		if (created && !runWorkingSet(run).some((item) => item.id === target!.id))
			registerRunOutput(run, target)
		if (chat)
			useChatStore
				.getState()
				.setWorkingSet(chat.id, [
					...(chat.workingSet ?? []).filter((item) => item.id !== target!.id),
					target,
				])
		rememberRead(
			readKey(ownerPubkey, run.chatId, change.kind, change.draftKey),
			documentDraftRevision(change.after),
		)
		reportAiOutputChange(
			run.chatId,
			change.kind === 'story'
				? {
						kind: 'story',
						draftKey: change.draftKey,
						title: title || 'Untitled Story',
						storyReference: target.kind === 'story' ? target.storyReference : undefined,
					}
				: {
						kind: 'atlas',
						draftKey: change.draftKey,
						title: title || 'Untitled Atlas',
						atlasReference: target.kind === 'atlas' ? target.atlasReference : undefined,
					},
			ownerPubkey,
		)
		const refreshVisibleEditor = () => {
			if (change.kind === 'story' && getStoryEditorTarget()?.draftKey === change.draftKey)
				requestOpenStoryEditor(getStoryEditorTarget()?.story, change.draftKey)
			if (change.kind === 'atlas' && getAtlasEditorTarget()?.draftKey === change.draftKey)
				requestOpenAtlasEditor(change.draftKey, getAtlasEditorTarget()?.context)
		}
		refreshVisibleEditor()
		toast.success(`Updated local ${change.kind === 'story' ? 'Story' : 'Atlas'}: ${title}`, {
			action: {
				label: 'Undo',
				onClick: () => {
					if (!change.undo()) {
						toast.error('The draft changed since this AI edit. Undo was not applied.')
						return
					}
					suppressDocumentDraftFormSave(change.kind, change.draftKey, ownerPubkey)
					readRevisions.delete(readKey(ownerPubkey, run.chatId, change.kind, change.draftKey))
					const currentChat = useChatStore
						.getState()
						.chatSessions.find((item) => item.id === run.chatId)
					if (!change.before) {
						if (currentChat)
							useChatStore.getState().setWorkingSet(
								currentChat.id,
								(currentChat.workingSet ?? []).filter((item) => item.id !== target!.id),
							)
						if (change.kind === 'story' && getStoryEditorTarget()?.draftKey === change.draftKey)
							clearStoryEditorTarget()
						if (change.kind === 'atlas' && getAtlasEditorTarget()?.draftKey === change.draftKey)
							clearAtlasEditorTarget()
					} else {
						const previousTitle =
							'title' in change.before
								? change.before.title
								: 'name' in change.before
									? change.before.name
									: undefined
						if (currentChat)
							useChatStore.getState().setWorkingSet(
								currentChat.id,
								(currentChat.workingSet ?? []).map((item) =>
									item.id === target!.id ? { ...item, title: previousTitle || item.title } : item,
								),
							)
						refreshVisibleEditor()
					}
				},
			},
		})
	}

	return {
		ownerPubkey,
		signal: context.signal,
		assertBeforeCommit: assertAuthorized,
		resolveTarget: (requestedKind, requestedArgs) => {
			if (requestedKind !== kind) throw new Error('The document kind does not match this tool.')
			const permitted = runWorkingSet(run).filter((item) => item.kind === kind)
			const id =
				requestedArgs.workingTarget ??
				(typeof requestedArgs.draftTarget === 'string'
					? permitted.find(
							(item) => item.kind !== 'dataset' && item.draftKey === requestedArgs.draftTarget,
						)?.id
					: undefined)
			if (requestedArgs.draftTarget && !id)
				throw new Error('Name an allowed workingTarget; a draft reference is not write permission.')
			if (requestedArgs.createNew === true || (!isRead && !id && !permitted.length)) {
				if (
					requestedArgs.workingTarget ||
					requestedArgs.draftTarget ||
					requestedArgs.storyReference
				)
					throw new Error('Creating a document cannot also name an existing destination.')
				if (isRead || !run.allowCreate)
					throw new Error('Enable new local drafts in Working on to create a document.')
				const draftKey = `thread-${kind}:${run.chatId}:${crypto.randomUUID()}`
				target =
					kind === 'story'
						? {
								id: `story:${draftKey}`,
								kind: 'story',
								draftKey,
								title: String(requestedArgs.title ?? 'Untitled Story'),
								intent: 'create',
							}
						: {
								id: `atlas:${draftKey}`,
								kind: 'atlas',
								draftKey,
								title: String(requestedArgs.name ?? 'Untitled Atlas'),
								intent: 'create',
							}
				created = true
				return { draftKey, created: true, expectedRevision: null }
			}
			target = resolveRunWorkTarget(run, id, kind)
			if (target.kind === 'dataset') throw new Error('A document target is required.')
			if (
				requestedArgs.storyReference &&
				(target.kind !== 'story' || requestedArgs.storyReference !== target.storyReference)
			)
				throw new Error('This published reference is not the permitted Story target.')
			const draftKey = target.draftKey
			const existing =
				kind === 'story'
					? readStoryDraft(draftKey, ownerPubkey)
					: readGroupEditorDraft(draftKey, ownerPubkey)
			const revisionKey = readKey(ownerPubkey, run.chatId, kind, draftKey)
			if (!isRead && existing && !readRevisions.has(revisionKey))
				throw new Error(
					`Read the latest local ${kind === 'story' ? 'Story' : 'Atlas'} before editing it.`,
				)
			if (
				!isRead &&
				target.intent === 'propose' &&
				(Object.hasOwn(requestedArgs, 'image') || Object.hasOwn(requestedArgs, 'presentation'))
			)
				throw new Error(
					'A Story proposal preserves its cover and opening presentation; create an independent Story to change them.',
				)
			return {
				draftKey,
				created: false,
				...(isRead ? {} : { expectedRevision: readRevisions.get(revisionKey) ?? null }),
			}
		},
		listSources: () =>
			grants().map(({ localWorkspaceId: _map, localStoryDraftKey: _story, ...grant }) => grant),
		assertReferenceAllowed: (reference) => {
			const fragment = reference.lastIndexOf('#')
			const base = fragment === -1 ? reference : reference.slice(0, fragment)
			let featureId: string | undefined
			try {
				featureId = fragment === -1 ? undefined : decodeURIComponent(reference.slice(fragment + 1))
			} catch {
				throw new Error('Malformed feature reference.')
			}
			const allowed = grants().filter(
				(grant) =>
					grant.reference === base &&
					(!grant.featureIds || (featureId !== undefined && grant.featureIds.includes(featureId))),
			)
			const readable = allowed.some((grant) => {
				if (grant.localStoryDraftKey)
					return Boolean(readStoryDraft(grant.localStoryDraftKey, ownerPubkey))
				if (!grant.localWorkspaceId) return true
				const state = useEditorStore.getState()
				const workspace = state.workspaces[grant.localWorkspaceId]
				const draft = workspace?.activeDraftId && state.geoEditDrafts[workspace.activeDraftId]
				return Boolean(
					draft &&
						draft.sourceId === workspace?.sourceId &&
						(!featureId || draft.features.some((feature) => String(feature.id) === featureId)),
				)
			})
			if (!readable)
				throw new Error(
					'This source is outside the Thread’s attached/working scope or is unavailable. Preserve feature-only references; never widen them.',
				)
		},
		review: async (change) => {
			const level = useChatStore.getState().safetyLevel
			if (level === 3 || (level === 2 && !change.before)) return true
			const title =
				change.kind === 'story'
					? 'title' in change.after
						? change.after.title
						: ''
					: 'name' in change.after
						? change.after.name
						: ''
			const pending = requestStoryTarget(
				{
					chatId: run.chatId,
					toolCallId: context.toolCallId ?? '',
					documentKind: change.kind,
					storyTitle: title || 'Untitled document',
					review: {
						before: JSON.stringify(change.before ?? {}, null, 2),
						after: JSON.stringify(change.after, null, 2),
					},
				},
				() => {},
			)
			const request = getStoryTargetRequest()
			const cancel = () => {
				const current = getStoryTargetRequest()
				if (
					request &&
					current?.id === request.id &&
					current.chatId === run.chatId &&
					current.toolCallId === (context.toolCallId ?? '')
				)
					cancelStoryTarget(current.id)
			}
			context.signal?.addEventListener('abort', cancel, { once: true })
			if (context.signal?.aborted) cancel()
			try {
				return (await pending).decision === 'created'
			} finally {
				context.signal?.removeEventListener('abort', cancel)
			}
		},
		didRead: (readKind, draftKey, draft) =>
			rememberRead(
				readKey(ownerPubkey, run.chatId, readKind, draftKey),
				documentDraftRevision(draft),
			),
		didCommit,
	}
}
