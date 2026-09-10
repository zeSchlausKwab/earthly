import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { useEditorStore } from '@/features/geo-editor/store'
import { createDefaultCollectionMeta } from '@/features/geo-editor/utils'
import { readStoryDraft, writeStoryDraft, NEW_STORY_DRAFT_KEY } from '@/lib/nostr/story'
import { useChatStore } from './store'
import {
	assertThreadStoryReferenceScope,
	captureThreadReferences,
	mapWorkTarget,
	newDraftAudience,
	normalizeWorkingSet,
	resolveRunWorkTarget,
	runWorkingSet,
	threadReferenceId,
	workTargetIdentity,
	type ThreadWorkTarget,
} from './workingSet'
import {
	localMapReference,
	localStoryReferences,
	resolveLocalStoryReference,
} from '@/lib/nostr/story/localReferences'
import { resolveLocalStoryDependencies } from './referencePublishing/localStoryDependencies'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import { executeToolCall } from './tools/execute'
import { releaseToolExecutionRun } from './tools/executionTarget'
import { registerStoryTools } from './tools/story-tools'
import type { ToolExecutionRunIdentity } from './tools/types'
import type { ToolEntry } from './tools/registry'
import {
	clearStoryTargetRequests,
	confirmStoryTarget,
	getStoryTargetRequest,
	subscribeStoryTargetRequest,
} from './storyTargeting/requestStore'

const originalEditor = useEditorStore.getState()
const originalChat = useChatStore.getState()
const previousWindow = globalThis.window
const storage = new Map<string, string>()
const localStorage = {
	getItem: (key: string) => storage.get(key) ?? null,
	setItem: (key: string, value: string) => storage.set(key, value),
	removeItem: (key: string) => storage.delete(key),
}
let runId = 8000

beforeEach(() => {
	storage.clear()
	Object.assign(globalThis, {
		window: {
			localStorage,
			addEventListener() {},
			removeEventListener() {},
			setTimeout,
			clearTimeout,
		},
	})
	useEditorStore.setState({
		geoEditDrafts: {},
		workspaces: {},
		activeWorkspaceId: null,
		activeGeoEditDraftId: null,
		editor: null,
		features: [],
	})
	useChatStore.setState({
		chatSessions: [],
		activeChatId: null,
		activeRun: null,
		isStreaming: false,
		safetyLevel: 3,
	})
	useChatStore.getState().createChat()
})
afterEach(() => {
	clearStoryTargetRequests()
	releaseToolExecutionRun()
	useEditorStore.setState(originalEditor, true)
	useChatStore.setState(originalChat, true)
	if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window
	else Object.assign(globalThis, { window: previousWindow })
})

function map(title: string): ThreadWorkTarget {
	const state = useEditorStore.getState()
	const sourceId = `session:${crypto.randomUUID()}`
	const draftId = state.createGeoEditDraft(
		sourceId,
		{
			name: title,
			collectionMeta: { ...createDefaultCollectionMeta(), name: title },
			features: [],
			selectedFeatureIds: [],
			publishChannel: { kind: 'public' },
			contextRefs: [],
			blobReferences: [],
		},
		{ activate: false },
	)
	return mapWorkTarget(
		state.createWorkspace({
			sourceId,
			label: title,
			kind: 'scratch',
			activeDraftId: draftId,
			activate: false,
		}),
	)!
}
function run(targets: ThreadWorkTarget[] = [], allowCreate = false): ToolExecutionRunIdentity {
	const chatId = useChatStore.getState().activeChatId!
	useChatStore.getState().setWorkingSet(chatId, targets)
	const workingSet = targets.map((item) => ({ ...item, target: workTargetIdentity(item) }))
	return {
		chatId,
		runId: ++runId,
		startedAt: Date.now(),
		workingSet,
		allowCreate,
		newDraftAudience: newDraftAudience(targets),
		references: [],
		target: workingSet[0]?.target ?? {
			entityType: null,
			draftId: null,
			entityId: null,
			sourceId: null,
			baseRevisionId: null,
			draftUpdatedAt: null,
			wasDirty: false,
			workspaceId: null,
		},
	}
}
async function call(
	identity: ToolExecutionRunIdentity,
	name: string,
	args: Record<string, unknown> = {},
) {
	const result = await executeToolCall(
		{
			id: crypto.randomUUID(),
			type: 'function',
			function: { name, arguments: JSON.stringify(args) },
		},
		{ run: identity },
	)
	return JSON.parse(result.content)
}

describe('explicit Thread working sets', () => {
	test('navigation and publication entry points keep the selected Thread, including an empty new Thread', () => {
		const id = useChatStore.getState().activeChatId
		expect(
			useChatStore.getState().openThread({ threadKey: 'map:published', continueActive: true }),
		).toBe(id)
		useChatStore.getState().createChat()
		const next = useChatStore.getState().activeChatId
		expect(next).not.toBe(id)
		expect(
			useChatStore.getState().openThread({ threadKey: 'story:other', continueActive: true }),
		).toBe(next)
	})
	test('a reference never grants a write target and multiple targets require a destination', () => {
		const first = map('1914'),
			second = map('1916')
		const identity = run([first, second])
		expect(() => resolveRunWorkTarget(identity, undefined, 'dataset')).toThrow('Name an allowed')
		expect(() => resolveRunWorkTarget(identity, 'foreign-reference', 'dataset')).toThrow(
			'not writable',
		)
		expect(resolveRunWorkTarget(identity, second.id).title).toBe('1916')
	})
	test('edits two different Maps in one run without changing the visible workspace', async () => {
		const first = map('1914'),
			second = map('1916'),
			visible = map('Visible')
		const identity = run([first, second])
		if (visible.kind === 'dataset')
			useEditorStore.getState().setActiveWorkspaceId(visible.workspaceId)
		expect(
			(
				await call(identity, 'set_dataset_metadata', {
					workingTarget: first.id,
					name: 'Front 1914',
				})
			).ok,
		).toBe(true)
		expect(
			(
				await call(identity, 'set_dataset_metadata', {
					workingTarget: second.id,
					name: 'Front 1916',
				})
			).ok,
		).toBe(true)
		expect(
			(
				await call(identity, 'set_dataset_metadata', {
					workingTarget: first.id,
					description: 'first',
				})
			).ok,
		).toBe(true)
		expect(
			useEditorStore.getState().geoEditDrafts[workTargetIdentity(first).draftId!]!.collectionMeta
				.name,
		).toBe('Front 1914')
		expect(
			useEditorStore.getState().geoEditDrafts[workTargetIdentity(second).draftId!]!.collectionMeta
				.name,
		).toBe('Front 1916')
		expect(useEditorStore.getState().activeWorkspaceId).toBe(
			visible.kind === 'dataset' ? visible.workspaceId : '',
		)
	})
	test('read-only tools remain available but writes and editor imports fail closed', async () => {
		const identity = run()
		expect((await call(identity, 'get_working_set')).outputs).toEqual([])
		expect((await call(identity, 'set_dataset_metadata', { name: 'Not allowed' })).ok).toBe(false)
		expect((await call(identity, 'query_osm_by_id', { toEditor: true })).ok).toBe(false)
		expect((await call(identity, 'create_map_draft', { title: 'Not allowed' })).ok).toBe(false)
		expect(Object.keys(useEditorStore.getState().geoEditDrafts)).toHaveLength(0)
	})
	test('creates multiple named local outputs using the captured audience', async () => {
		const identity = {
			...run([], true),
			newDraftAudience: { kind: 'private-group' as const, id: 'circle-one' },
		}
		const first = await call(identity, 'create_map_draft', { title: 'First output' })
		const second = await call(identity, 'create_map_draft', { title: 'Second output' })
		expect(first.ok).toBe(true)
		expect(first.workingTarget).not.toBe(second.workingTarget)
		expect(second.audience).toEqual(identity.newDraftAudience)
		expect(runWorkingSet(identity)).toHaveLength(2)
		expect(useEditorStore.getState().activeWorkspaceId).toBeNull()
		expect(
			(
				await call(identity, 'set_dataset_metadata', {
					workingTarget: first.workingTarget,
					description: 'First only',
				})
			).ok,
		).toBe(true)
	})
	test('captures only the attached local feature and does not follow a changed editor or draft', async () => {
		const source = map('Private source')
		if (source.kind !== 'dataset') throw new Error('Map expected')
		const identity = workTargetIdentity(source)
		const feature = {
			id: 'selected',
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [1, 2] },
			properties: {},
		}
		useEditorStore
			.getState()
			.saveGeoEditDraft(identity.draftId!, {
				features: [feature, { ...feature, id: 'not-selected' }],
			})
		const references = captureThreadReferences([
			{
				id: 'reference-one',
				name: 'One place',
				type: 'feature',
				featureId: 'selected',
				localWorkspaceId: source.workspaceId,
			},
		])
		useEditorStore.getState().saveGeoEditDraft(identity.draftId!, { features: [] })
		const result = await call({ ...run(), references }, 'read_thread_reference', {
			referenceId: 'reference-one',
		})
		expect(result.features.map((item: { id: string }) => item.id)).toEqual(['selected'])
		expect(result.published).toBe(false)
		expect(
			(await call({ ...run(), references }, 'read_thread_reference', { referenceId: 'unattached' }))
				.ok,
		).toBe(false)
	})
	test('keeps two feature references from the same source distinct', () => {
		const state = useChatStore.getState()
		for (const featureId of ['one', 'two'])
			state.addReferenceToChat(state.activeChatId!, {
				id: 'same-map',
				name: featureId,
				type: 'feature',
				featureId,
			})
		expect(useChatStore.getState().references).toHaveLength(2)
		state.createChat()
		expect(useChatStore.getState().references).toHaveLength(0)
	})
	test('two Story outputs use independent slots and do not touch the manually retained new Story', async () => {
		writeStoryDraft(NEW_STORY_DRAFT_KEY, { title: 'Manual', content: 'Keep me' })
		const identity = run([], true)
		const first = await call(identity, 'write_story_draft', {
			title: 'One',
			markdown: 'First narrative',
		})
		const second = await call(identity, 'write_story_draft', {
			title: 'Two',
			markdown: 'Second narrative',
			createNew: true,
		})
		expect(first.ok).toBe(true)
		expect(second.ok).toBe(true)
		expect(first.draftKey).not.toBe(second.draftKey)
		expect(readStoryDraft(first.draftKey)?.content).toBe('First narrative')
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)?.content).toBe('Keep me')
		expect((await call(run(), 'read_story_draft')).ok).toBe(false)
	})
	test('scope-aware Story authoring never enters the legacy reference-publishing gate', async () => {
		let gateCalls = 0
		const entries = new Map<string, ToolEntry>()
		registerStoryTools((entry) => entries.set(entry.name, entry), {
			gateDatasetReferences: async () => {
				gateCalls++
				throw new Error('Must not publish')
			},
		})
		await entries
			.get('write_story_draft')!
			.handler({ title: 'Story', markdown: 'Read-only sources.' }, { run: run([], true) })
		expect(gateCalls).toBe(0)
	})
	test('Story approval cannot overwrite a newer manual draft', async () => {
		writeStoryDraft('story-one', { title: 'Original', content: 'Original' })
		const identity = run([
			{
				id: 'story:one',
				kind: 'story',
				draftKey: 'story-one',
				title: 'Original',
				intent: 'create',
			},
		])
		await call(identity, 'read_story_draft', { workingTarget: 'story:one' })
		useChatStore.setState({ safetyLevel: 1 })
		const ready = new Promise<void>((resolve) => {
			const unsubscribe = subscribeStoryTargetRequest(() => {
				if (getStoryTargetRequest()) {
					unsubscribe()
					resolve()
				}
			})
		})
		const pending = call(identity, 'write_story_draft', {
			title: 'AI',
			markdown: 'AI replacement',
			workingTarget: 'story:one',
		})
		await ready
		writeStoryDraft('story-one', { title: 'Manual', content: 'New manual text' })
		confirmStoryTarget(getStoryTargetRequest()!.id)
		expect((await pending).ok).toBe(false)
		expect(readStoryDraft('story-one')?.content).toBe('New manual text')
	})
	test('malformed persisted feature restrictions do not turn into whole-Map permission', () => {
		const item = map('Restricted')
		expect(
			normalizeWorkingSet([
				{ ...item, featureIds: 'one' },
				{ ...item, featureIds: [] },
			]),
		).toEqual([])
		expect(normalizeWorkingSet([{ ...item, featureIds: ['one'] }])).toHaveLength(1)
	})
	test('foreign feature citations remain feature-scoped and unambiguous', () => {
		const address = coordinateToNaddrReference(`37515:${'a'.repeat(64)}:foreign`)!
		const references = captureThreadReferences([
			{ id: 'same', name: 'One', type: 'feature', address: `${address}#one` },
			{ id: 'same', name: 'Two', type: 'feature', address: `${address}#two` },
		])
		expect(threadReferenceId(references[0]!)).not.toBe(threadReferenceId(references[1]!))
		const identity = { ...run(), references }
		expect(() => assertThreadStoryReferenceScope(`${address}#one`, identity)).not.toThrow()
		expect(() => assertThreadStoryReferenceScope(address, identity)).toThrow('feature-only')
		expect(() => assertThreadStoryReferenceScope(`${address}#three`, identity)).toThrow(
			'feature-only',
		)
	})
	test('local Story references preserve arbitrary feature ids and ignore code examples', () => {
		const reference = localMapReference('workspace.a', 'relation/1.somewhere')
		const body = `😀 ${reference}. Example: \`${reference}\`\n\n\`\`\`earthly-view\n${reference}\n\`\`\``
		expect(localStoryReferences(body)).toHaveLength(1)
		expect(localStoryReferences(body)[0]?.featureId).toBe('relation/1.somewhere')
		expect(resolveLocalStoryReference(body, 'workspace.a', 'nostr:naddr1example')).toContain(
			'nostr:naddr1example#relation%2F1%2Esomewhere.',
		)
		expect(() => validateStoryPresentation({ content: body })).toThrow('local Map drafts')
		expect(() =>
			validateStoryPresentation({ content: body }, { allowLocalDraftReferences: true }),
		).not.toThrow()
	})
	test('local dependencies preflight all audiences before publishing and preserve completed addresses on retry', async () => {
		const first = map('Public'),
			second = map('Private')
		if (first.kind !== 'dataset' || second.kind !== 'dataset') throw new Error('Maps expected')
		const feature = {
			id: 'one',
			type: 'Feature' as const,
			geometry: { type: 'Point' as const, coordinates: [1, 2] },
			properties: {},
		}
		for (const target of [first, second])
			useEditorStore
				.getState()
				.saveGeoEditDraft(workTargetIdentity(target).draftId!, { features: [feature] })
		useEditorStore
			.getState()
			.saveGeoEditDraft(workTargetIdentity(second).draftId!, {
				publishChannel: { kind: 'private-group', id: 'circle' },
			})
		let body = `${localMapReference(first.workspaceId)} ${localMapReference(second.workspaceId)}`
		let published = 0
		const publisher = async (
			captured: Parameters<
				NonNullable<Parameters<typeof resolveLocalStoryDependencies>[1]['publishDependency']>
			>[0],
		) => {
			published++
			if (published === 2) throw new Error('Offline')
			return {
				mode: 'new' as const,
				addressChanged: true,
				datasetMention: coordinateToNaddrReference(`37515:${'b'.repeat(64)}:${captured.title}`)!,
				datasetCoordinate: `37515:${'b'.repeat(64)}:${captured.title}`,
				eventId: 'receipt',
				featureIds: ['one'],
			}
		}
		await expect(
			resolveLocalStoryDependencies(body, {
				storyDraftKey: 'test',
				onProgress: (next) => {
					body = next
				},
				publishDependency: publisher,
			}),
		).rejects.toThrow('private')
		expect(published).toBe(0)
		useEditorStore
			.getState()
			.saveGeoEditDraft(workTargetIdentity(second).draftId!, { publishChannel: { kind: 'public' } })
		await expect(
			resolveLocalStoryDependencies(body, {
				storyDraftKey: 'test',
				onProgress: (next) => {
					body = next
				},
				publishDependency: publisher,
			}),
		).rejects.toThrow('Offline')
		expect(localStoryReferences(body)).toHaveLength(1)
		await resolveLocalStoryDependencies(body, {
			storyDraftKey: 'test',
			onProgress: (next) => {
				body = next
			},
			publishDependency: publisher,
		})
		expect(published).toBe(3)
		expect(localStoryReferences(body)).toHaveLength(0)
	})
})
