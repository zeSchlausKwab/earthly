import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { useChatStore, type ChatSession } from '../store'
import { nip19 } from 'nostr-tools'
import { toast } from 'sonner'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { readGroupEditorDraft } from '@/features/groups/editorDraft'
import { getStoryTargetRequest, clearStoryTargetRequests } from '../storyTargeting/requestStore'
import { releaseRunOutputs, type ThreadWorkTarget } from '../workingSet'
import { createChatDocumentAuthoringContext } from './chatDocumentAuthoring'
import { readDocumentDraft, writeDocumentDraft } from './document-authoring'
import type { ToolExecutionContext, ToolExecutionRunIdentity } from './types'
import { registerStoryTools } from './story-tools'
import { executeToolCall } from './execute'
import { releaseToolExecutionRun } from './executionTarget'
import type { ToolEntry } from './registry'

const backing = new Map<string, string>()
let priorWindow: unknown
let run: ToolExecutionRunIdentity
let session: ChatSession
let oldChats: ChatSession[]
const MAP = `37515:${'a'.repeat(64)}:map`
const ADDRESS = nip19.naddrEncode({ kind: 37515, pubkey: 'a'.repeat(64), identifier: 'map' })
const mention = `nostr:${ADDRESS}`
const target: ThreadWorkTarget = {
	id: 'story:permitted',
	kind: 'story',
	draftKey: 'story-one',
	title: 'User Story',
	intent: 'create',
}
beforeAll(() => {
	priorWindow = globalThis.window
	Object.assign(globalThis, {
		window: {
			localStorage: {
				getItem: (key: string) => backing.get(key) ?? null,
				setItem: (key: string, value: string) => backing.set(key, value),
				removeItem: (key: string) => backing.delete(key),
			},
		},
	})
	oldChats = useChatStore.getState().chatSessions
})
afterAll(() => {
	useChatStore.setState({ chatSessions: oldChats })
	if (priorWindow === undefined) delete (globalThis as Record<string, unknown>).window
	else Object.assign(globalThis, { window: priorWindow })
})
beforeEach(() => {
	backing.clear()
	clearStoryTargetRequests()
	const id = crypto.randomUUID()
	session = {
		id,
		threadKey: `work:${id}`,
		title: 'Authoring',
		readOnly: false,
		messages: [],
		references: [],
		workingSet: [target],
		allowCreate: true,
		targetWorkspaceId: null,
		createdAt: 0,
		updatedAt: 0,
	}
	const executionTarget = {
		entityType: 'story' as const,
		draftId: target.draftKey,
		sourceId: target.draftKey,
		entityId: null,
		baseRevisionId: null,
		draftUpdatedAt: null,
		wasDirty: true,
		workspaceId: null,
	}
	run = {
		runId: 1,
		chatId: id,
		target: executionTarget,
		startedAt: 0,
		allowCreate: true,
		workingSet: [{ ...target, target: executionTarget }],
		references: [],
	}
	useChatStore.setState({ chatSessions: [session], safetyLevel: 3 })
	writeStoryDraft(
		target.draftKey,
		{ title: 'User Story', content: 'Preserve user text', updatedAt: 1 },
		null,
	)
})
afterEach(() => {
	releaseToolExecutionRun()
	releaseRunOutputs(run)
	clearStoryTargetRequests()
})

function adapter(
	name: string,
	args: Record<string, unknown> = {},
	context: Partial<ToolExecutionContext> = {},
) {
	const result = createChatDocumentAuthoringContext({ run, ...context }, name, args)
	if (!result) throw new Error('Expected a local document adapter')
	return result
}
const permittedArgs = { workingTarget: target.id }
async function readStory() {
	await readDocumentDraft('story', permittedArgs, adapter('read_story_draft', permittedArgs))
}

describe('chat document transport policy', () => {
	test('production execution injects the shared scoped Story transport for read and partial metadata edits', async () => {
		const call = (name: string, args: Record<string, unknown>) => executeToolCall({
			id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) },
		}, { run })
		const read = JSON.parse((await call('read_story_draft', permittedArgs)).content)
		expect(read).toMatchObject({ ok: true, draft: { markdown: 'Preserve user text' } })
		const edited = JSON.parse((await call('write_story_draft', { ...permittedArgs, description: 'From the production executor' })).content)
		expect(edited).toMatchObject({ ok: true, draftKey: target.draftKey })
		expect(readStoryDraft(target.draftKey, null)).toMatchObject({
			title: 'User Story', content: 'Preserve user text', summary: 'From the production executor',
		})
	})

	test('production execution creates then reads and edits an Atlas output within the same run', async () => {
		const call = (name: string, args: Record<string, unknown>) => executeToolCall({
			id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(args) },
		}, { run })
		const created = JSON.parse((await call('write_atlas_draft', { createNew: true, name: 'Atlas from chat', description: 'Original overview' })).content)
		expect(created).toMatchObject({ ok: true, mode: 'create' })
		const workingTarget = `atlas:${created.draftKey}`
		const read = JSON.parse((await call('read_atlas_draft', { workingTarget })).content)
		expect(read).toMatchObject({ ok: true, draft: { name: 'Atlas from chat', description: 'Original overview' } })
		const edited = JSON.parse((await call('write_atlas_draft', { workingTarget, description: 'A revised overview' })).content)
		expect(edited).toMatchObject({ ok: true, draftKey: created.draftKey })
		expect(readGroupEditorDraft(created.draftKey, null)).toMatchObject({ name: 'Atlas from chat', description: 'A revised overview' })
	})
	test('requires reading the local revision and preserves omitted narrative in a partial update', async () => {
		await expect(
			writeDocumentDraft(
				'story',
				{ ...permittedArgs, title: 'AI' },
				adapter('write_story_draft', permittedArgs),
			),
		).rejects.toThrow('Read the latest')
		await readStory()
		await writeDocumentDraft(
			'story',
			{ ...permittedArgs, description: 'A description' },
			adapter('write_story_draft', permittedArgs),
		)
		expect(readStoryDraft(target.draftKey, null)).toMatchObject({
			title: 'User Story',
			content: 'Preserve user text',
			summary: 'A description',
		})
	})

	test('same-id retargeting cannot overwrite either document while a review is pending', async () => {
		await readStory()
		const authoring = adapter('write_story_draft', permittedArgs)
		authoring.review = async () => {
			useChatStore.setState({
				chatSessions: [{ ...session, workingSet: [{ ...target, draftKey: 'other-story' }] }],
			})
			return true
		}
		await expect(
			writeDocumentDraft('story', { ...permittedArgs, title: 'AI' }, authoring),
		).rejects.toThrow('allowed working target')
		expect(readStoryDraft(target.draftKey, null)?.title).toBe('User Story')
		expect(readStoryDraft('other-story', null)).toBeNull()
	})

	test('feature-only published references cannot become whole-map grants', () => {
		const reference = {
			id: 'map-feature',
			name: 'One feature',
			type: 'feature' as const,
			address: ADDRESS,
			featureId: 'relation/7',
		}
		run = { ...run, references: [reference] }
		useChatStore.setState({ chatSessions: [{ ...session, references: [reference] }] })
		const authoring = adapter('write_story_draft', permittedArgs)
		expect(() => authoring.assertReferenceAllowed(MAP)).toThrow('never widen')
		expect(() => authoring.assertReferenceAllowed(`${MAP}#relation%2F7`)).not.toThrow()
		expect(() => authoring.assertReferenceAllowed(`${MAP}#relation%2F8`)).toThrow('never widen')
	})

	test('removing an attached source while review is pending cancels the prepared authoring', async () => {
		const reference = { id: 'map-source', name: 'Map', type: 'dataset' as const, address: ADDRESS }
		run = { ...run, references: [reference] }
		useChatStore.setState({ chatSessions: [{ ...session, references: [reference] }] })
		await readStory()
		const authoring = adapter('write_story_draft', permittedArgs)
		authoring.review = async () => {
			useChatStore.setState({ chatSessions: [{ ...session, references: [] }] })
			return true
		}
		await expect(
			writeDocumentDraft('story', { ...permittedArgs, markdown: mention }, authoring),
		).rejects.toThrow('outside')
		expect(readStoryDraft(target.draftKey, null)?.content).toBe('Preserve user text')
	})

	test('creating an Atlas yields a distinct retained output in Working on without publication', async () => {
		const args = { name: 'New Atlas', description: 'Overview', createNew: true }
		const result = await writeDocumentDraft('atlas', args, adapter('write_atlas_draft', args))
		const key = result.draftKey!
		expect(key).toStartWith(`thread-atlas:${run.chatId}:`)
		expect(readGroupEditorDraft(key, null)?.name).toBe('New Atlas')
		expect(useChatStore.getState().chatSessions[0]?.workingSet).toContainEqual({
			id: `atlas:${key}`,
			kind: 'atlas',
			draftKey: key,
			title: 'New Atlas',
			intent: 'create',
		})
	})

	test('Undo of a new chat Atlas removes its retained output and editing permission together', async () => {
		const args = { name: 'An Atlas to undo', createNew: true }
		const created = await writeDocumentDraft('atlas', args, adapter('write_atlas_draft', args))
		const notification = toast.getHistory().at(-1)
		const action = notification && 'action' in notification ? notification.action : undefined
		if (!action || typeof action !== 'object' || !('onClick' in action)) throw new Error('Expected a reviewed Undo action')
		;(action as { onClick: (event: unknown) => void }).onClick({})
		expect(readGroupEditorDraft(created.draftKey!, null)).toBeNull()
		expect(useChatStore.getState().chatSessions[0]?.workingSet?.some(item => item.id === `atlas:${created.draftKey}`)).toBe(false)
		expect(readStoryDraft(target.draftKey, null)?.title).toBe('User Story')
	})

	test('cancelling the owning signal releases only its pending review and writes nothing', async () => {
		await readStory()
		useChatStore.setState({ safetyLevel: 1 })
		const abort = new AbortController()
		const write = writeDocumentDraft(
			'story',
			{ ...permittedArgs, title: 'AI' },
			adapter('write_story_draft', permittedArgs, { signal: abort.signal }),
		)
		for (let iteration = 0; iteration < 20 && !getStoryTargetRequest(); iteration++)
			await Promise.resolve()
		expect(getStoryTargetRequest()?.chatId).toBe(run.chatId)
		abort.abort()
		expect((await write).ok).toBe(false)
		expect(getStoryTargetRequest()).toBeNull()
		expect(readStoryDraft(target.draftKey, null)?.title).toBe('User Story')
	})

	test('the shared Story path never calls the legacy reference auto-publication gate', async () => {
		await readStory()
		let publicationGateCalled = false
		const tools = new Map<string, ToolEntry>()
		registerStoryTools((entry) => tools.set(entry.name, entry), {
			gateDatasetReferences: async () => {
				publicationGateCalled = true
				throw new Error('No reference publication is permitted')
			},
		})
		await tools.get('write_story_draft')!.handler(
			{ ...permittedArgs, description: 'Local only' },
			{
				run,
				documentAuthoring: adapter('write_story_draft', permittedArgs),
			},
		)
		expect(publicationGateCalled).toBe(false)
		expect(readStoryDraft(target.draftKey, null)?.summary).toBe('Local only')
	})
})
