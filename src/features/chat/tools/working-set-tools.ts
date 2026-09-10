import type { ToolEntry } from './registry'
import { useChatStore } from '../store'
import { mapWorkTarget, registerRunOutput, runWorkingSet, threadReferenceId } from '../workingSet'
import { localMapReference } from '@/lib/nostr/story/localReferences'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import { registerEntityTools } from './entity-tools'

export function registerWorkingSetTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'get_view_context',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'get_view_context',
				description:
					'Read the map camera and bounding box captured at Send, including in read-only Threads. This is viewing context, not the device location or permission to edit anything.',
				parameters: { type: 'object', properties: {} },
			},
		},
		handler: (_args, context) => ({ readOnly: true, view: context?.run?.view ?? null }),
	})
	let readEntity: ToolEntry['handler'] | undefined
	registerEntityTools((entry) => {
		if (entry.name === 'read_entity') readEntity = entry.handler
	})
	register({
		name: 'read_thread_reference',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'read_thread_reference',
				description:
					'Read an explicitly attached source by id, preserving its feature-only selector. Returns local draft data without publishing, or reads the referenced public source. Never grants edit rights.',
				parameters: {
					type: 'object',
					properties: { referenceId: { type: 'string' } },
					required: ['referenceId'],
				},
			},
		},
		handler: async (args, context) => {
			const references = context?.run?.references ?? []
			const matches = references.filter((item) => item.id === args.referenceId)
			const source =
				references.find((item) => threadReferenceId(item) === args.referenceId) ??
				(matches.length === 1 ? matches[0] : undefined)
			if (!source)
				throw new Error('Reference not attached to this run. Ask the user to attach it first.')
			if (source.localWorkspaceId) {
				const draft = source.localSnapshot
				if (!draft)
					throw new Error(
						'The referenced local draft was not captured; reattach it before sending.',
					)
				const features = draft.features
				return {
					readOnly: true,
					published: false,
					title: source.name,
					audience: draft.publishChannel,
					featureCount: features.length,
					features: features.slice(0, 100),
					truncated: features.length > 100,
				}
			}
			if (!source.address) throw new Error('This reference has no readable address.')
			return readEntity?.({ reference: source.address, featureId: source.featureId }, context)
		},
	})
	register({
		name: 'get_working_set',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'get_working_set',
				description:
					'Read this run’s allowed outputs. Every output has an id for workingTarget. References are not editable. Navigation never changes these permissions.',
				parameters: { type: 'object', properties: {} },
			},
		},
		handler: (_args, context) => ({
			outputs: context?.run
				? runWorkingSet(context.run).map((item) => ({
						...item,
						...(item.kind === 'dataset'
							? { localReference: localMapReference(item.workspaceId) }
							: {}),
					}))
				: [],
			references:
				context?.run?.references?.map(({ localSnapshot: _snapshot, ...reference }) => ({
					...reference,
					referenceId: threadReferenceId(reference),
					...(reference.localWorkspaceId
						? { localReference: localMapReference(reference.localWorkspaceId, reference.featureId) }
						: {}),
				})) ?? [],
			newMapAudience: context?.run?.newDraftAudience,
			mayCreateLocalDrafts: context?.run?.allowCreate === true,
		}),
	})
	register({
		name: 'create_map_draft',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'create_map_draft',
				description:
					'Create a separate named local Map output in this Thread without publishing or switching the visible map. Requires new-draft permission. Then use its workingTarget id for geometry tools; do not overwrite another Map to represent a new dataset.',
				parameters: {
					type: 'object',
					properties: { title: { type: 'string' } },
					required: ['title'],
				},
			},
		},
		handler: async (args, context) => {
			const run = context?.run
			if (!run?.allowCreate || !run.workingSet)
				throw new Error('Enable new local drafts in Working on first.')
			const title = typeof args.title === 'string' ? args.title.trim() : ''
			if (!title || title.length > 300) throw new Error('Provide a Map title of 1–300 characters.')
			const chat = useChatStore.getState().chatSessions.find((chat) => chat.id === run.chatId)
			if (!chat) throw new Error('The owning Thread was removed.')
			const audience = run.newDraftAudience
			if (!audience || audience.kind === 'unresolved')
				throw new Error(
					'New Map audience is unresolved. Create the Map with the intended audience manually, then add its edit to this Thread.',
				)
			const state = useEditorStore.getState()
			const sourceId = `session:${crypto.randomUUID()}`
			const draftId = state.createGeoEditDraft(
				sourceId,
				{
					name: title,
					description: '',
					collectionMeta: { ...createDefaultCollectionMeta(), name: title },
					features: [],
					selectedFeatureIds: [],
					publishChannel: audience,
					contextRefs: [],
					blobReferences: [],
				},
				{ activate: false },
			)
			const workspaceId = state.createWorkspace({
				sourceId,
				label: title,
				kind: 'scratch',
				activeDraftId: draftId,
				chatSessionId: chat.id,
				activate: false,
			})
			const item = mapWorkTarget(workspaceId)!
			registerRunOutput(run, item)
			useChatStore.getState().setWorkingSet(chat.id, [...(chat.workingSet ?? []), item])
			return {
				ok: true,
				workingTarget: item.id,
				localReference: localMapReference(workspaceId),
				title,
				status: 'local draft',
				audience,
				published: false,
			}
		},
	})
}
