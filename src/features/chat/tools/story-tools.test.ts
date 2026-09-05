import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { finalizeEvent, generateSecretKey, nip19 } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { ARTICLE_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { NEW_STORY_DRAFT_KEY, readStoryDraft, writeStoryDraft } from '@/lib/nostr/story'
import {
	parseMapPresentation,
	parseStoryMarkdown,
	reduceStoryMarkdownViews,
	stringifyMapPresentation,
	stringifyStoryViewMarkdownBlock,
	type MapPresentationV1,
	type StoryViewBlockV1,
} from '@/lib/map-presentation'
import {
	clearStoryEditorTarget,
	getStoryEditorTarget,
	getStoryEditorOpenRequest,
	retainStoryEditorTarget,
	resetStoryEditorOpenRequests,
} from '@/features/geo-editor/storyEditorBridge'
import { useEditorStore, type GeoCollectionEditDraft } from '@/features/geo-editor/store'
import {
	cancelReferencePublish,
	clearReferencePublishRequests,
	getReferencePublishRequest,
	setReferencePublishingChatContext,
	setReferencePublishingRunTarget,
	setReferencePublishingToolContext,
} from '@/features/chat/referencePublishing'
import {
	cancelStoryTarget,
	clearStoryTargetRequests,
	confirmStoryTarget,
	getStoryTargetRequest,
} from '@/features/chat/storyTargeting'
import { advertise, registry, type ToolEntry } from './registry'
import { registerStoryTools, resetStoryDraftOwnership } from './story-tools'
import type { ToolExecutionContext } from './types'
import { executeToolCall } from './execute'
import { releaseToolExecutionRun } from './executionTarget'

// readScopedStorage/writeScopedStorage no-op without a window — give the tools a
// map-backed localStorage so draft round-trips are observable.
const backing = new Map<string, string>()
const localStorageStub = {
	getItem: (key: string) => backing.get(key) ?? null,
	setItem: (key: string, value: string) => {
		backing.set(key, value)
	},
	removeItem: (key: string) => {
		backing.delete(key)
	},
}

let hadWindow = false
let previousWindow: unknown

const tools = new Map<string, ToolEntry>()
registerStoryTools((entry) => tools.set(entry.name, entry))

const FOREIGN_MAP_PUBKEY = 'a'.repeat(64)
const FOREIGN_MAP_SOURCE = `37515:${FOREIGN_MAP_PUBKEY}:foreign-map` as const
const FOREIGN_MAP_MENTION = `nostr:${nip19.naddrEncode({ kind: 37515, pubkey: FOREIGN_MAP_PUBKEY, identifier: 'foreign-map' })}`
const opening: MapPresentationV1 = {
	version: 1,
	initialView: { center: [2.3, 48.8], zoom: 6 },
	layers: [
		{
			id: 'battle-sites',
			source: FOREIGN_MAP_SOURCE,
			featureIds: ['relation/62504'],
			visible: true,
			opacityMultiplier: 1,
			style: { color: '#456' },
		},
	],
}
const cue: StoryViewBlockV1 = {
	version: 1,
	type: 'view',
	id: 'first-cue',
	title: 'First battle',
	display: 'cue',
	camera: { center: [2.4, 49], zoom: 9 },
	layers: { 'battle-sites': { opacityMultiplier: 0.6, style: { strokeWidth: 3 } } },
}
const viewFence = (value: unknown) => `\`\`\`earthly-view\n${JSON.stringify(value)}\n\`\`\``

const call = (name: string, args: Record<string, unknown> = {}, context?: ToolExecutionContext) => {
	const entry = tools.get(name)
	if (!entry) throw new Error(`tool not registered: ${name}`)
	return entry.handler(args, context) as Promise<Record<string, unknown>>
}

beforeAll(() => {
	hadWindow = 'window' in globalThis
	previousWindow = (globalThis as Record<string, unknown>).window
	;(globalThis as Record<string, unknown>).window = { localStorage: localStorageStub }
})

afterAll(() => {
	if (hadWindow) {
		;(globalThis as Record<string, unknown>).window = previousWindow
	} else {
		delete (globalThis as Record<string, unknown>).window
	}
})

beforeEach(() => {
	backing.clear()
	resetStoryDraftOwnership()
	resetStoryEditorOpenRequests()
	clearReferencePublishRequests()
	clearStoryTargetRequests()
	useEditorStore.setState({
		geoEditDrafts: {},
		activeGeoEditDraftId: null,
		workspaces: {},
		activeWorkspaceId: null,
		activeDataset: null,
		features: [],
		activeDatasetContextRefs: [],
		blobReferences: [],
		isDirty: false,
	})
})

function installNewDatasetDraft(
	channel: GeoCollectionEditDraft['publishChannel'] = { kind: 'public' },
) {
	const draft: GeoCollectionEditDraft = {
		persistenceVersion: 2,
		id: 'dataset-draft',
		sourceId: 'session:story-dataset',
		name: 'AI survey',
		description: '',
		collectionMeta: {
			name: 'AI survey',
			description: '',
			color: '#334455',
			customProperties: {},
		},
		features: [
			{
				type: 'Feature',
				id: 'site-1',
				geometry: { type: 'Point', coordinates: [16.37, 48.2] },
				properties: { name: 'Site 1' },
			},
		],
		selectedFeatureIds: [],
		publishChannel: channel,
		contextRefs: [],
		blobReferences: [],
		createdAt: 1,
		updatedAt: 2,
	}
	useEditorStore.setState({
		geoEditDrafts: { [draft.id]: draft },
		activeGeoEditDraftId: draft.id,
		workspaces: {
			'workspace-story': {
				id: 'workspace-story',
				sourceId: draft.sourceId,
				label: draft.name,
				kind: 'scratch',
				datasetKey: null,
				activeDraftId: draft.id,
				chatSessionId: 'chat-story',
				createdAt: 1,
				updatedAt: 2,
			},
		},
		activeWorkspaceId: 'workspace-story',
		activeDataset: null,
		features: draft.features,
		collectionMeta: draft.collectionMeta,
		isDirty: true,
	})
	setReferencePublishingChatContext('chat-story')
	setReferencePublishingToolContext('write-story-call')
	const target = {
		entityType: 'dataset' as const,
		workspaceId: 'workspace-story',
		draftId: draft.id,
		sourceId: draft.sourceId,
		entityId: draft.sourceId,
		baseRevisionId: null,
		draftUpdatedAt: draft.updatedAt,
		wasDirty: true,
	}
	setReferencePublishingRunTarget(target)
	return {
		run: {
			runId: 1,
			chatId: 'chat-story',
			target,
			startedAt: 1,
		},
	} satisfies ToolExecutionContext
}

describe('story draft tools', () => {
	it('registers both tools', () => {
		expect(tools.has('read_story_draft')).toBe(true)
		expect(tools.has('write_story_draft')).toBe(true)
	})

	it('dispatches advertised Story presentation tools with bound approval and serialized results', async () => {
		// Use production registration/JSON argument parsing/execution, not the
		// direct handler Map used by the smaller authoring tests below.
		expect(registry.get('write_story_draft')?.kind).toBe('host-builtin')
		expect(
			advertise().find((tool) => tool.function.name === 'write_story_draft')?.function.parameters
				.properties.presentation,
		).toMatchObject({
			type: 'object',
			required: ['version', 'layers'],
		})
		const context: ToolExecutionContext = {
			toolCallId: 'stale-context-id-must-not-own-approval',
			run: {
				runId: 901,
				chatId: 'story-dispatch-thread',
				startedAt: 1,
				target: {
					entityType: 'story',
					draftId: NEW_STORY_DRAFT_KEY,
					entityId: null,
					sourceId: null,
					baseRevisionId: null,
					draftUpdatedAt: null,
					wasDirty: false,
					workspaceId: null,
				},
			},
		}
		const markdown = `${FOREIGN_MAP_MENTION}#relation%2F62504\n\n${viewFence(cue)}`
		const mapDraftsBefore = useEditorStore.getState().geoEditDrafts
		try {
			const writing = executeToolCall(
				{
					id: 'dispatch-write-story-view',
					type: 'function',
					function: {
						name: 'write_story_draft',
						arguments: JSON.stringify({
							title: 'Dispatched Story',
							markdown,
							presentation: opening,
						}),
					},
				},
				context,
			)
			await Promise.resolve()
			const request = getStoryTargetRequest()
			expect(request).toMatchObject({
				chatId: 'story-dispatch-thread',
				toolCallId: 'dispatch-write-story-view',
				status: 'awaiting-confirmation',
			})
			expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toBeNull()
			if (!request) throw new Error('Expected the real Story target approval')
			confirmStoryTarget(request.id)
			const writeResult = await writing
			expect(writeResult).toMatchObject({ role: 'tool', tool_call_id: 'dispatch-write-story-view' })
			expect(JSON.parse(writeResult.content)).toMatchObject({
				ok: true,
				draftKey: NEW_STORY_DRAFT_KEY,
				mode: 'create',
				stats: { viewBlockCount: 1 },
			})
			expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toMatchObject({
				content: markdown,
				presentation: opening,
			})

			const readResult = await executeToolCall(
				{
					id: 'dispatch-read-story-view',
					type: 'function',
					function: { name: 'read_story_draft', arguments: '{}' },
				},
				context,
			)
			expect(readResult).toMatchObject({ role: 'tool', tool_call_id: 'dispatch-read-story-view' })
			expect(JSON.parse(readResult.content)).toMatchObject({
				ok: true,
				draft: {
					markdown,
					presentation: opening,
					mapAuthoring: { viewBlocks: [{ id: cue.id, display: 'cue' }] },
				},
			})

			const persisted = readStoryDraft(NEW_STORY_DRAFT_KEY)
			const failedResult = await executeToolCall(
				{
					id: 'dispatch-invalid-story-view',
					type: 'function',
					function: {
						name: 'write_story_draft',
						arguments: JSON.stringify({
							title: 'Invalid',
							markdown: `${FOREIGN_MAP_MENTION}\n\n${viewFence({ ...cue, layers: { 'battle-sites': { featureIds: ['other'] } } })}`,
						}),
					},
				},
				context,
			)
			expect(failedResult).toMatchObject({
				role: 'tool',
				tool_call_id: 'dispatch-invalid-story-view',
			})
			expect(JSON.parse(failedResult.content)).toMatchObject({
				ok: false,
				toolName: 'write_story_draft',
				code: 'tool_handler_error',
				sideEffectsApplied: false,
				message: expect.stringContaining('unsupported fields: featureIds'),
			})
			expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toEqual(persisted)
			expect(useEditorStore.getState().geoEditDrafts).toBe(mapDraftsBefore)
			expect(getReferencePublishRequest()).toBeNull()
		} finally {
			clearStoryTargetRequests()
			releaseToolExecutionRun(context.run?.runId)
		}
	})

	it('reads an empty draft slot', async () => {
		const result = await call('read_story_draft')
		expect(result.ok).toBe(true)
		expect(result.exists).toBe(false)
		expect(result.draft).toBeNull()
	})

	it('writes then reads back a draft', async () => {
		const write = await call('write_story_draft', {
			title: 'Ras Laffan shipping lanes',
			summary: 'The LNG corridors out of Qatar.',
			markdown: '# Lanes\n\nSee nostr:naddr1example…',
		})
		expect(write.ok).toBe(true)

		const read = await call('read_story_draft')
		expect(read.exists).toBe(true)
		expect(read.authoredByThisSession).toBe(true)
		const draft = read.draft as Record<string, unknown>
		expect(draft.title).toBe('Ras Laffan shipping lanes')
		expect(draft.markdown).toContain('nostr:naddr1example')
	})

	it('parks an AI-authored new Story until the user creates its edit state', async () => {
		const context = {
			...installNewDatasetDraft(),
			toolCallId: 'write-story-call',
		}
		let settled = false
		const writing = call(
			'write_story_draft',
			{
				title: 'Rivers remember',
				markdown: 'A draft that must wait for an explicit Story target.',
			},
			context,
		).then((result) => {
			settled = true
			return result
		})

		await Promise.resolve()
		expect(settled).toBe(false)
		expect(getStoryTargetRequest()).toMatchObject({
			chatId: 'chat-story',
			toolCallId: 'write-story-call',
			storyTitle: 'Rivers remember',
			status: 'awaiting-confirmation',
		})
		expect(getStoryEditorOpenRequest()).toBeNull()
		expect(getStoryEditorTarget()).toBeNull()
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })

		const request = getStoryTargetRequest()
		if (!request) throw new Error('expected Story target request')
		confirmStoryTarget(request.id)

		await expect(writing).resolves.toMatchObject({ ok: true, mode: 'create' })
		expect(getStoryTargetRequest()).toBeNull()
		expect(getStoryEditorTarget()).toMatchObject({ mode: 'create' })
		expect(getStoryEditorOpenRequest()).toMatchObject({ mode: 'create' })
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: true })
	})

	it('cancels a pending new Story target without writing or opening anything', async () => {
		const context = {
			...installNewDatasetDraft(),
			toolCallId: 'write-story-cancel',
		}
		const writing = call(
			'write_story_draft',
			{ title: 'Cancelled Story', markdown: 'This must never be persisted.' },
			context,
		)
		await Promise.resolve()
		const request = getStoryTargetRequest()
		if (!request) throw new Error('expected Story target request')
		cancelStoryTarget(request.id)

		await expect(writing).resolves.toMatchObject({
			ok: false,
			status: 'blocked',
			code: 'story_target_cancelled',
		})
		expect(getStoryEditorOpenRequest()).toBeNull()
		expect(getStoryEditorTarget()).toBeNull()
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })
	})

	it('uses an explicitly retained new Story target without another dialog', async () => {
		retainStoryEditorTarget()
		const result = await call(
			'write_story_draft',
			{ title: 'Already targeted', markdown: 'The author created this edit state first.' },
			{ ...installNewDatasetDraft(), toolCallId: 'write-story-ready' },
		)

		expect(result).toMatchObject({ ok: true, mode: 'create' })
		expect(getStoryTargetRequest()).toBeNull()
	})

	it('revalidates a new Story target after an awaited prerequisite', async () => {
		let releasePrerequisite!: () => void
		let prerequisiteStarted = false
		const prerequisite = new Promise<void>((resolve) => {
			releasePrerequisite = resolve
		})
		const isolatedTools = new Map<string, ToolEntry>()
		registerStoryTools((entry) => isolatedTools.set(entry.name, entry), {
			gateDatasetReferences: async () => {
				prerequisiteStarted = true
				await prerequisite
				return { status: 'ready' }
			},
		})
		const write = isolatedTools.get('write_story_draft')
		if (!write) throw new Error('expected isolated Story writer')
		const context = {
			...installNewDatasetDraft(),
			toolCallId: 'write-story-after-prerequisite',
		}
		const writing = write.handler(
			{ title: 'Still targeted', markdown: 'Do not write after the target closes.' },
			context,
		) as Promise<Record<string, unknown>>

		await Promise.resolve()
		const firstRequest = getStoryTargetRequest()
		if (!firstRequest) throw new Error('expected initial Story target request')
		confirmStoryTarget(firstRequest.id)
		for (let attempt = 0; attempt < 10 && !prerequisiteStarted; attempt += 1) {
			await Promise.resolve()
		}
		expect(prerequisiteStarted).toBe(true)

		clearStoryEditorTarget()
		releasePrerequisite()
		for (let attempt = 0; attempt < 10 && !getStoryTargetRequest(); attempt += 1) {
			await Promise.resolve()
		}
		const replacementRequest = getStoryTargetRequest()
		expect(replacementRequest).toMatchObject({
			chatId: 'chat-story',
			toolCallId: 'write-story-after-prerequisite',
			storyTitle: 'Still targeted',
		})
		expect(replacementRequest?.id).not.toBe(firstRequest.id)
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })

		if (!replacementRequest) throw new Error('expected replacement Story target request')
		cancelStoryTarget(replacementRequest.id)
		await expect(writing).resolves.toMatchObject({
			ok: false,
			code: 'story_target_cancelled',
		})
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })
	})

	it('does not replay a closed Story editor request on a later mount', async () => {
		await call('write_story_draft', { title: 'Transient target', markdown: 'body' })
		expect(getStoryEditorOpenRequest()).not.toBeNull()

		clearStoryEditorTarget()

		expect(getStoryEditorTarget()).toBeNull()
		expect(getStoryEditorOpenRequest()).toBeNull()
	})

	it('refuses to overwrite a draft this session did not write', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		// Simulate a fresh session: the existing draft is no longer AI-owned.
		resetStoryDraftOwnership()

		expect(call('write_story_draft', { title: 'AI draft', markdown: 'new' })).rejects.toThrow(
			/overwrite/,
		)

		// The model cannot authorize itself by proactively setting overwrite:true.
		expect(
			call('write_story_draft', {
				title: 'AI draft',
				markdown: 'new',
				overwrite: true,
			}),
		).rejects.toThrow(/confirm/i)

		const overwritten = await call(
			'write_story_draft',
			{
				title: 'AI draft',
				markdown: 'new',
				overwrite: true,
			},
			{ userMessage: 'yes, overwrite the existing story draft' } as ToolExecutionContext,
		)
		expect(overwritten.ok).toBe(true)
	})

	it('freely rewrites its own draft within a session', async () => {
		await call('write_story_draft', { title: 'v1', markdown: 'one' })
		const second = await call('write_story_draft', { title: 'v2', markdown: 'two' })
		expect(second.ok).toBe(true)
		const read = await call('read_story_draft')
		expect((read.draft as Record<string, unknown>).title).toBe('v2')
	})

	it('preserves opaque presentation data when replacing prose', async () => {
		const futurePresentation = { version: 12, camera: { projection: 'future-globe' } }
		writeStoryDraft(NEW_STORY_DRAFT_KEY, {
			title: 'User-authored draft',
			content: 'old prose',
			presentation: futurePresentation,
		})
		await call('read_story_draft')

		await call(
			'write_story_draft',
			{ title: 'Rewritten prose', markdown: 'new prose', overwrite: true },
			{ userMessage: 'Please overwrite the prose in this draft.' } as ToolExecutionContext,
		)

		const read = await call('read_story_draft')
		expect((read.draft as Record<string, unknown>).presentation).toEqual(futurePresentation)
	})

	it('does not treat an explicit refusal as overwrite confirmation', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		resetStoryDraftOwnership()

		expect(
			call(
				'write_story_draft',
				{ title: 'AI draft', markdown: 'new', overwrite: true },
				{ userMessage: 'Do not overwrite my existing draft.' },
			),
		).rejects.toThrow(/confirm/i)
	})

	it('writes opening layers and cue/figure/both fences atomically into the actual Story draft', async () => {
		const figure: StoryViewBlockV1 = {
			...cue,
			id: 'inline-detail',
			display: 'figure',
			camera: { center: [3, 50], zoom: 12 },
			layers: { 'battle-sites': { opacityMultiplier: 0.2 } },
		}
		const both: StoryViewBlockV1 = {
			...cue,
			id: 'later-cue',
			display: 'both',
			camera: undefined,
			layers: { 'battle-sites': { style: { color: '#c44' } } },
		}
		const markdown = [
			`Only this foreign feature: ${FOREIGN_MAP_MENTION}#relation%2F62504`,
			stringifyStoryViewMarkdownBlock(cue),
			'An inline detail follows.',
			stringifyStoryViewMarkdownBlock(figure),
			'Return to the cumulative main view.',
			stringifyStoryViewMarkdownBlock(both),
		].join('\n\n')
		await expect(
			call('write_story_draft', { title: 'Battle Story', markdown, presentation: opening }),
		).resolves.toMatchObject({ ok: true, stats: { viewBlockCount: 3 } })
		const saved = readStoryDraft(NEW_STORY_DRAFT_KEY)
		expect(saved?.content).toBe(markdown)
		expect(saved?.presentation).toEqual(opening)
		const parsed = parseMapPresentation(JSON.parse(stringifyMapPresentation(saved?.presentation)))
		expect(parsed.status).toBe('valid')
		if (parsed.status !== 'valid') throw new Error('Expected usable presentation')
		const reduced = reduceStoryMarkdownViews(parsed.value, saved?.content ?? '')
		expect(reduced.issues).toEqual([])
		expect(reduced.snapshots[0]?.state.layers[0]).toMatchObject({
			opacityMultiplier: 0.6,
			style: { color: '#456', strokeWidth: 3 },
		})
		expect(reduced.snapshots[1]?.state.layers[0]?.opacityMultiplier).toBe(0.2)
		expect(reduced.snapshots[2]?.state).toMatchObject({
			camera: cue.camera,
			layers: [{ opacityMultiplier: 0.6, style: { color: '#c44', strokeWidth: 3 } }],
		})
		await expect(call('read_story_draft')).resolves.toMatchObject({
			draft: {
				mapAuthoring: {
					presentationStatus: 'valid',
					openingLayerIds: ['battle-sites'],
					viewBlocks: [
						{ id: cue.id, display: 'cue' },
						{ id: figure.id, display: 'figure' },
						{ id: both.id, display: 'both' },
					],
				},
			},
		})
		expect(getReferencePublishRequest()).toBeNull()
	})

	it('updates a physical view in place and preserves the omitted opening presentation', async () => {
		const before = `${FOREIGN_MAP_MENTION}\n\nBefore.\n\n${viewFence(cue)}\n\nAfter.`
		await call('write_story_draft', { title: 'Map Story', markdown: before, presentation: opening })
		const changedCue = {
			...cue,
			title: 'Closer battle view',
			camera: { center: [2.5, 49], zoom: 10 },
		}
		const after = before.replace(viewFence(cue), viewFence(changedCue))
		await call('write_story_draft', { title: 'Map Story', markdown: after })
		const saved = readStoryDraft(NEW_STORY_DRAFT_KEY)
		expect(saved?.presentation).toEqual(opening)
		expect(saved?.content).toBe(after)
		expect(parseStoryMarkdown(saved?.content).views[0]?.result).toMatchObject({
			status: 'valid',
			value: { id: cue.id, title: changedCue.title, camera: changedCue.camera },
		})
	})

	it('preserves untouched future fences byte-for-byte, including opaque reference-like text', async () => {
		const opaqueFence = viewFence({
			version: 12,
			type: 'view',
			reference: `${FOREIGN_MAP_MENTION}#relation/62504`,
		})
		const futurePresentation = { version: 12, futureLayers: ['opaque'] }
		writeStoryDraft(NEW_STORY_DRAFT_KEY, {
			title: 'Future Story',
			content: `Old prose.\n\n${opaqueFence}`,
			presentation: futurePresentation,
		})
		await call('read_story_draft')
		await call(
			'write_story_draft',
			{ title: 'Future Story', markdown: `New prose.\n\n${opaqueFence}`, overwrite: true },
			{ userMessage: 'Please overwrite the prose in this draft.' },
		)
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toMatchObject({
			content: `New prose.\n\n${opaqueFence}`,
			presentation: futurePresentation,
		})
		await call('write_story_draft', {
			title: 'Future Story',
			markdown: `New prose.\n\n${opaqueFence}\n\nMore prose after the unchanged fence.`,
		})
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)?.content).toContain(opaqueFence)
	})

	it('does not strip uninterpreted opening fields during an unrelated prose edit', async () => {
		const presentation = { ...opening, extension: { keep: 'opaque' } }
		writeStoryDraft(NEW_STORY_DRAFT_KEY, {
			title: 'Existing Story',
			content: FOREIGN_MAP_MENTION,
			presentation,
		})
		await call('read_story_draft')
		await call(
			'write_story_draft',
			{
				title: 'Existing Story',
				markdown: `${FOREIGN_MAP_MENTION}\n\nMore context.`,
				overwrite: true,
			},
			{ userMessage: 'Please overwrite the prose in this draft.' },
		)
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)?.presentation).toEqual(presentation)
	})

	it.each([
		[
			'feature-only reference cannot authorize a whole Map',
			`${FOREIGN_MAP_MENTION}#relation%2F62504`,
			{
				...opening,
				layers: [
					{ id: 'battle-sites', source: FOREIGN_MAP_SOURCE, visible: true, opacityMultiplier: 1 },
				],
			},
			/whole Map/,
		],
		[
			'feature selectors cannot exceed body authorization',
			`${FOREIGN_MAP_MENTION}#relation%2F62504`,
			{ ...opening, layers: [{ ...opening.layers[0], featureIds: ['another-feature'] }] },
			/not mentioned/,
		],
		[
			'a code example cannot authorize a source',
			`\`${FOREIGN_MAP_MENTION}\``,
			opening,
			/mentioned in the Story body/,
		],
		[
			'a source embedded only in a view is not authorization',
			viewFence(cue),
			opening,
			/mentioned in the Story body/,
		],
		[
			'invalid camera values are not silently dropped',
			FOREIGN_MAP_MENTION,
			{ ...opening, initialView: { center: [2, 49], zoom: 90 } },
			/valid MapPresentationV1/,
		],
		[
			'legacy scenes are not accepted as opening presentation',
			FOREIGN_MAP_MENTION,
			{ ...opening, scenes: [] },
			/unsupported fields: scenes/,
		],
	] as const)('rejects %s without saving any draft', async (_name, markdown, presentation, message) => {
		await expect(
			call('write_story_draft', { title: 'Invalid', markdown, presentation }),
		).rejects.toThrow(message)
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toBeNull()
	})

	it.each([
		[
			'source retargeting',
			{ ...cue, layers: { 'battle-sites': { source: FOREIGN_MAP_SOURCE } } },
			/unsupported fields: source/,
		],
		[
			'selector retargeting',
			{ ...cue, layers: { 'battle-sites': { featureIds: ['other'] } } },
			/unsupported fields: featureIds/,
		],
		[
			'unknown ambient layer',
			{ ...cue, layers: { ambient: { visible: true } } },
			/unknown opening layer 'ambient'/,
		],
		[
			'invalid style',
			{ ...cue, layers: { 'battle-sites': { style: { opacity: 0.5 } } } },
			/valid StoryViewBlockV1/,
		],
		['future view intent', { ...cue, version: 12 }, /valid StoryViewBlockV1/],
	] as const)('rejects new %s while preserving the previous Story draft', async (_name, view, message) => {
		await call('write_story_draft', {
			title: 'Good',
			markdown: FOREIGN_MAP_MENTION,
			presentation: opening,
		})
		const previous = readStoryDraft(NEW_STORY_DRAFT_KEY)
		await expect(
			call('write_story_draft', {
				title: 'Bad',
				markdown: `${FOREIGN_MAP_MENTION}\n\n${viewFence(view)}`,
			}),
		).rejects.toThrow(message)
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toEqual(previous)
	})

	it('rejects duplicate view ids and newly unclosed view fences', async () => {
		for (const suffix of [
			`${viewFence(cue)}\n\n${viewFence(cue)}`,
			`\`\`\`earthly-view\n${JSON.stringify(cue)}`,
		]) {
			await expect(
				call('write_story_draft', {
					title: 'Invalid',
					markdown: `${FOREIGN_MAP_MENTION}\n\n${suffix}`,
					presentation: opening,
				}),
			).rejects.toThrow(/duplicates view id|fence is not closed/)
			expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toBeNull()
		}
	})

	it('surfaces the draft: a successful write fires a story-editor open request', async () => {
		expect(getStoryEditorOpenRequest()).toBeNull()

		await call('write_story_draft', { title: 'Surfaced', markdown: 'body' })
		const first = getStoryEditorOpenRequest()
		expect(first?.mode).toBe('create')
		expect(first?.nonce).toBe(1)

		// A follow-up write fires a NEW nonce so an already-open panel re-prefills.
		await call('write_story_draft', { title: 'Surfaced v2', markdown: 'body 2' })
		expect(getStoryEditorOpenRequest()?.nonce).toBe(2)
	})

	it('writes an existing published Story into its edit-draft slot', async () => {
		const identifier = 'east-german-travel'
		const event = finalizeEvent(
			{
				kind: ARTICLE_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					modelVersion: MODEL_VERSION,
					title: 'East German travel',
					content: 'Published body',
				}),
			},
			generateSecretKey(),
		)
		const pubkey = event.pubkey
		eventStore.add(event)
		const storyReference = `nostr:${nip19.naddrEncode({
			kind: ARTICLE_KIND,
			pubkey,
			identifier,
		})}`
		const published = await call('read_story_draft', { storyReference })
		expect(published).toMatchObject({ exists: true, source: 'published' })

		const result = await call('write_story_draft', {
			storyReference,
			title: 'East German travel',
			markdown: 'Updated with fine-grained references.',
		})
		expect(result).toMatchObject({ ok: true, draftKey: identifier, mode: 'edit' })
		expect(getStoryEditorOpenRequest()).toMatchObject({
			mode: 'edit',
			story: { dTag: identifier, pubkey },
		})
	})

	it('keeps the resolved Story target while a presentation write waits on a prerequisite', async () => {
		const identifier = 'captured-story-view'
		const event = finalizeEvent(
			{
				kind: ARTICLE_KIND,
				created_at: Math.floor(Date.now() / 1000),
				tags: [['d', identifier]],
				content: JSON.stringify({
					modelVersion: MODEL_VERSION,
					title: 'Captured Story',
					content: 'Published prose',
				}),
			},
			generateSecretKey(),
		)
		eventStore.add(event)
		const storyReference = `${ARTICLE_KIND}:${event.pubkey}:${identifier}`
		await call('read_story_draft', { storyReference })
		const retainedNewDraft = { title: 'Other retained draft', content: 'Do not change this.' }
		writeStoryDraft(NEW_STORY_DRAFT_KEY, retainedNewDraft)
		let releaseGate!: () => void
		const gate = new Promise<void>((resolve) => {
			releaseGate = resolve
		})
		let enteredGate!: () => void
		const entered = new Promise<void>((resolve) => {
			enteredGate = resolve
		})
		const gatedTools = new Map<string, ToolEntry>()
		registerStoryTools((entry) => gatedTools.set(entry.name, entry), {
			gateDatasetReferences: async () => {
				enteredGate()
				await gate
				return { status: 'ready' }
			},
		})
		const markdown = `${FOREIGN_MAP_MENTION}\n\n${viewFence(cue)}`
		const writing = gatedTools
			.get('write_story_draft')
			?.handler({ storyReference, title: 'Captured Story', markdown, presentation: opening })
		await entered
		retainStoryEditorTarget()
		releaseGate()
		await expect(writing).resolves.toMatchObject({ ok: true, draftKey: identifier, mode: 'edit' })
		expect(readStoryDraft(identifier)).toMatchObject({ content: markdown, presentation: opening })
		expect(readStoryDraft(NEW_STORY_DRAFT_KEY)).toMatchObject(retainedNewDraft)
		expect(getStoryEditorOpenRequest()).toMatchObject({
			mode: 'edit',
			story: { dTag: identifier, pubkey: event.pubkey },
		})
	})

	it('does not fire an open request when the overwrite gate rejects the write', async () => {
		await call('write_story_draft', { title: 'User draft', markdown: 'precious user text' })
		resetStoryDraftOwnership()
		resetStoryEditorOpenRequests()

		expect(call('write_story_draft', { title: 'AI draft', markdown: 'new' })).rejects.toThrow(
			/overwrite/,
		)
		expect(getStoryEditorOpenRequest()).toBeNull()
	})

	it('does not durably save or open a Story when Dataset publication is cancelled', async () => {
		const context = installNewDatasetDraft()
		const writing = call(
			'write_story_draft',
			{
				title: 'Survey story',
				markdown: 'The survey found one important site.',
				presentation: { version: 1, initialView: { center: [16.37, 48.2], zoom: 9 }, layers: [] },
				referencesActiveDataset: true,
			},
			context,
		)
		for (let attempt = 0; attempt < 10 && !getReferencePublishRequest(); attempt += 1) {
			await Promise.resolve()
		}
		const request = getReferencePublishRequest()
		expect(request).toMatchObject({
			chatId: 'chat-story',
			toolCallId: 'write-story-call',
			draftId: 'dataset-draft',
		})
		if (!request) throw new Error('expected publish-before-reference request')
		cancelReferencePublish(request.id)

		await expect(writing).resolves.toMatchObject({
			ok: false,
			status: 'blocked',
			code: 'reference_publish_cancelled',
		})
		expect(getStoryEditorOpenRequest()).toBeNull()
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })
	})

	it('does not infer that every Story intends to reference a new working Dataset', async () => {
		const context = installNewDatasetDraft()
		await expect(
			call(
				'write_story_draft',
				{
					title: 'Unrelated Story',
					markdown: 'This prose intentionally has no Dataset reference.',
				},
				context,
			),
		).resolves.toMatchObject({ ok: true })
		expect(getReferencePublishRequest()).toBeNull()
	})

	it('refuses a public Story write that would depend on a private Dataset draft', async () => {
		const context = installNewDatasetDraft({ kind: 'private-group', id: 'group-a' })
		await expect(
			call(
				'write_story_draft',
				{
					title: 'Private survey story',
					markdown: 'The survey found one important site.',
					referencesActiveDataset: true,
				},
				context,
			),
		).resolves.toMatchObject({
			ok: false,
			status: 'blocked',
			code: 'reference_publish_scope_incompatible',
		})
		expect(getReferencePublishRequest()).toBeNull()
		expect(getStoryEditorOpenRequest()).toBeNull()
		await expect(call('read_story_draft')).resolves.toMatchObject({ exists: false, draft: null })
	})

	it('validates required fields', async () => {
		expect(call('write_story_draft', { markdown: 'body' })).rejects.toThrow(/title/)
		expect(call('write_story_draft', { title: 'x' })).rejects.toThrow(/markdown/)
		expect(call('write_story_draft', { title: 'x', markdown: '   ' })).rejects.toThrow(/markdown/)
	})
})
