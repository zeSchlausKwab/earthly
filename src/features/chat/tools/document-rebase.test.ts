import { describe, expect, test } from 'bun:test'
import { finalizeEvent, type NostrEvent } from 'nostr-tools'
import { ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { MODEL_VERSION } from '@/lib/nostr/modelVersion'
import { storyContentFingerprint, type StoryDraft } from '@/lib/nostr/story/draft'
import type { GroupEditorDraft } from '@/features/groups/editorDraft'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import {
	prepareDocumentRebase,
	publishedDocumentDraft,
	resolveDocumentRebase,
} from './document-rebase'

const secret = new Uint8Array(32).fill(72) // Disposable fixture identity.
const MAP = `37515:${'a'.repeat(64)}:source`
let sequence = 1000
function event(
	kind: number,
	content: Record<string, unknown>,
	identifier: string,
	refs: string[] = [],
) {
	return finalizeEvent(
		{
			kind,
			created_at: sequence++,
			tags: [['d', identifier], ...refs.map((ref) => ['a', ref])],
			content: JSON.stringify({ modelVersion: MODEL_VERSION, ...content }),
		},
		secret,
	)
}
function story(content: Record<string, unknown> = {}) {
	const identifier = crypto.randomUUID()
	const base = event(
		ARTICLE_KIND,
		{
			title: 'Original',
			summary: 'Original summary',
			image: '',
			content: 'Original narrative',
			...content,
		},
		identifier,
	)
	const local = publishedDocumentDraft('story', base) as StoryDraft
	local.publication = {
		reference: coordinateToNaddrReference(`${base.kind}:${base.pubkey}:${identifier}`)!,
		eventId: base.id,
		fingerprint: storyContentFingerprint(local),
	}
	return {
		base,
		local,
		latest: (changes: Record<string, unknown>) =>
			event(base.kind, { ...JSON.parse(base.content), ...changes }, identifier),
	}
}
function atlas() {
	const identifier = crypto.randomUUID()
	const base = event(
		MAP_CONTEXT_KIND,
		{ name: 'Atlas', description: 'Original description', governance: 'closed' },
		identifier,
		[MAP],
	)
	const local = publishedDocumentDraft('atlas', base) as GroupEditorDraft
	local.sourceRevisionId = base.id
	return {
		base,
		local,
		latest: (changes: Record<string, unknown>, refs = [MAP]) =>
			event(base.kind, { ...JSON.parse(base.content), ...changes }, identifier, refs),
	}
}

describe('explicit field-level document rebasing', () => {
	test('merges disjoint changes and keeps the public identity with the latest baseline', () => {
		const { base, local, latest } = story()
		local.content = 'Local narrative'
		const remote = latest({ summary: 'Remote summary' })
		const original = structuredClone(local)
		const plan = prepareDocumentRebase('story', local, remote, base)
		expect(plan.fields.find((field) => field.field === 'content')?.status).toBe('local-only')
		expect(plan.fields.find((field) => field.field === 'summary')?.status).toBe('remote-only')
		const after = resolveDocumentRebase(plan, {}) as StoryDraft
		expect(after).toMatchObject({
			title: 'Original',
			content: 'Local narrative',
			summary: 'Remote summary',
			publication: { eventId: remote.id, reference: local.publication?.reference },
		})
		expect(after.publication?.fingerprint).toBe(
			storyContentFingerprint(publishedDocumentDraft('story', remote) as StoryDraft),
		)
		expect(local).toEqual(original)
	})
	test('requires a deliberate whole-field resolution when both sides changed', () => {
		const { base, local, latest } = story()
		local.content = 'Local narrative'
		const plan = prepareDocumentRebase(
			'story',
			local,
			latest({ content: 'Remote narrative' }),
			base,
		)
		expect(plan.fields.find((field) => field.field === 'content')).toMatchObject({
			base: 'Original narrative',
			local: 'Local narrative',
			remote: 'Remote narrative',
			status: 'conflict',
			suggested: null,
		})
		expect(() => resolveDocumentRebase(plan, {})).toThrow("Resolve conflicting field 'content'")
		expect(
			(resolveDocumentRebase(plan, { content: { choice: 'local' } }) as StoryDraft).content,
		).toBe('Local narrative')
		expect(
			(resolveDocumentRebase(plan, { content: { choice: 'remote' } }) as StoryDraft).content,
		).toBe('Remote narrative')
		expect(
			(
				resolveDocumentRebase(plan, {
					content: { choice: 'merged', value: 'Deliberately combined narrative' },
				}) as StoryDraft
			).content,
		).toBe('Deliberately combined narrative')
	})
	test('rejects unknown fields, incomplete merged values, ambiguous values and oversize prose', () => {
		const { local, latest } = story()
		const plan = prepareDocumentRebase('story', local, latest({ title: 'Remote' }))
		expect(() => resolveDocumentRebase(plan, { invented: { choice: 'local' } })).toThrow(
			'outside this rebase',
		)
		expect(() => resolveDocumentRebase(plan, { title: { choice: 'merged' } })).toThrow(
			'complete value',
		)
		expect(() =>
			resolveDocumentRebase(plan, { title: { choice: 'local', value: 'ignored' } }),
		).toThrow('Only a merged')
		expect(() =>
			resolveDocumentRebase(plan, { content: { choice: 'merged', value: 'x'.repeat(100001) } }),
		).toThrow('100000')
	})
	test('uses the retained Story fingerprint when its original event is unavailable', () => {
		const { local, latest } = story()
		local.title = 'Local title'
		const plan = prepareDocumentRebase('story', local, latest({ summary: 'Remote summary' }))
		expect(plan.baseAvailable).toBe(true)
		expect(resolveDocumentRebase(plan, {}) as StoryDraft).toMatchObject({
			title: 'Local title',
			summary: 'Remote summary',
		})
	})
	test('a legacy Story with no base requires resolution for each differing field', () => {
		const { local, latest } = story()
		delete local.publication
		const plan = prepareDocumentRebase(
			'story',
			local,
			latest({ title: 'Remote title', content: 'Remote narrative' }),
		)
		expect(plan.baseAvailable).toBe(false)
		expect(
			plan.fields.filter((field) => field.status === 'conflict').map((field) => field.field),
		).toEqual(['title', 'content'])
		expect(() => resolveDocumentRebase(plan, { title: { choice: 'local' } })).toThrow("'content'")
	})
	test('does not accept an original snapshot from another address or kind', () => {
		const { base, local, latest } = story()
		const remote = latest({ title: 'Remote' })
		const wrongAddress = { ...base, tags: [['d', 'another']] } as NostrEvent
		expect(() => prepareDocumentRebase('story', local, remote, wrongAddress)).toThrow(
			'does not match',
		)
		expect(() => prepareDocumentRebase('atlas', local, remote)).toThrow('matching address or kind')
	})
	test('preserves opaque future presentations from either snapshot but rejects invented invalid roots', () => {
		const { local, latest } = story({ presentation: { version: 9, future: { mode: 'globe' } } })
		const plan = prepareDocumentRebase('story', local, latest({ summary: 'Remote' }))
		expect((resolveDocumentRebase(plan, {}) as StoryDraft).presentation).toEqual(local.presentation)
		expect(() =>
			resolveDocumentRebase(plan, {
				presentation: { choice: 'merged', value: { version: 10, invented: true } },
			}),
		).toThrow('valid supported')
		expect(() =>
			resolveDocumentRebase(plan, { presentation: { choice: 'merged', value: 'invalid' } }),
		).toThrow('valid supported')
		expect(() =>
			resolveDocumentRebase(plan, {
				presentation: {
					choice: 'merged',
					value: { version: 1, layers: [], initialView: { center: [0, 99] } },
				},
			}),
		).toThrow('valid supported')
	})
	test('validates a merged presentation against the chosen Story body', () => {
		const { local, latest } = story()
		const plan = prepareDocumentRebase('story', local, latest({ title: 'Remote' }))
		expect(() =>
			resolveDocumentRebase(plan, {
				presentation: {
					choice: 'merged',
					value: { version: 1, layers: [{ id: 'new', source: MAP }] },
				},
			}),
		).toThrow('mentioned in the Story body')
	})
	test('Atlas policy is one field; remote policy does not overwrite the local description', () => {
		const { base, local, latest } = atlas()
		local.description = 'Local Atlas description'
		const remote = latest({
			governance: 'schema',
			schema: { type: 'object', properties: { year: { type: 'integer' } } },
			geometryConstraints: { allowedTypes: ['Polygon'] },
		})
		const plan = prepareDocumentRebase('atlas', local, remote, base)
		const after = resolveDocumentRebase(plan, {}) as GroupEditorDraft
		expect(plan.fields.find((field) => field.field === 'policy')?.status).toBe('remote-only')
		expect(after).toMatchObject({
			description: 'Local Atlas description',
			governance: 'schema',
			allowedGeometryTypes: ['Polygon'],
			sourceRevisionId: remote.id,
			schemaMode: 'advanced',
		})
		expect(JSON.parse(after.advancedJson)).toEqual(JSON.parse(remote.content).schema)
	})
	test('keeps the local schema builder and sample when local policy wins a conflict', () => {
		const { base, local, latest } = atlas()
		local.governance = 'schema'
		local.schemaMode = 'builder'
		local.rows = [{ name: 'period', type: 'text', required: true }]
		local.allowedGeometryTypes = ['Point']
		local.sampleJson = '{"period":"historical"}'
		const plan = prepareDocumentRebase('atlas', local, latest({ governance: 'open' }), base)
		expect(plan.fields.find((field) => field.field === 'policy')?.status).toBe('conflict')
		const after = resolveDocumentRebase(plan, { policy: { choice: 'local' } }) as GroupEditorDraft
		expect(after).toMatchObject({
			governance: 'schema',
			schemaMode: 'builder',
			rows: local.rows,
			sampleJson: local.sampleJson,
			allowedGeometryTypes: ['Point'],
		})
	})
	test('unavailable Atlas base never guesses which divergent fields changed remotely', () => {
		const { local, latest } = atlas()
		const plan = prepareDocumentRebase(
			'atlas',
			local,
			latest({ name: 'New Atlas', governance: 'open' }),
		)
		expect(plan.baseAvailable).toBe(false)
		expect(
			plan.fields.filter((field) => field.status === 'conflict').map((field) => field.field),
		).toEqual(['name', 'policy'])
		expect(() => resolveDocumentRebase(plan, {})).toThrow("'name'")
	})
	test('Atlas merged layers cannot outlive their curated Map references or invent policy values', () => {
		const { base, local, latest } = atlas()
		const plan = prepareDocumentRebase('atlas', local, latest({ name: 'Remote' }), base)
		expect(() =>
			resolveDocumentRebase(plan, {
				curatedReferences: { choice: 'merged', value: [] },
				presentation: {
					choice: 'merged',
					value: { version: 1, layers: [{ id: 'new', source: MAP }] },
				},
			}),
		).toThrow('curated Map')
		expect(() =>
			resolveDocumentRebase(plan, {
				policy: {
					choice: 'merged',
					value: { governance: 'schema', schema: {}, allowedGeometryTypes: ['Imaginary'] },
				},
			}),
		).toThrow('valid governance')
	})
})
