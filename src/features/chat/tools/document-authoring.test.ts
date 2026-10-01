import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { readStoryDraft, writeStoryDraft } from '@/lib/nostr/story/draft'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import {
	readGroupEditorDraft,
	writeGroupEditorDraft,
	type GroupEditorDraftSnapshot,
} from '@/features/groups/editorDraft'
import {
	canonicalDocumentReference,
	documentDraftRevision,
	listDocumentDrafts,
	prepareAtlasDocument,
	prepareStoryDocument,
	readDocumentDraft,
	writeDocumentDraft,
	type DocumentAuthoringContext,
	type PreparedDocumentChange,
} from './document-authoring'
import { registerDocumentDraftForm, suppressDocumentDraftFormSave } from './documentDraftForms'

const backing = new Map<string, string>()
let priorWindow: unknown
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
})
afterAll(() => {
	if (priorWindow === undefined) delete (globalThis as Record<string, unknown>).window
	else Object.assign(globalThis, { window: priorWindow })
})
beforeEach(() => backing.clear())

const MAP = `37515:${'a'.repeat(64)}:a-map`
const STORY = `37520:${'a'.repeat(64)}:a-story`
const source = { kind: 'local-map', workspaceId: 'permitted-map' }
const localReference = 'earthly-draft:permitted-map'
const atlas: GroupEditorDraftSnapshot = {
	name: 'User Atlas',
	description: '**Keep this**',
	curatedReferences: [MAP],
	image: 'https://example.org/atlas.jpg',
	governance: 'schema',
	schemaMode: 'advanced',
	allowedGeometryTypes: ['Polygon'],
	rows: [{ name: 'period', type: 'text', required: true, allowedValues: [] }],
	advancedJson: '{"type":"object"}',
	sampleJson: '{"period":"historical"}',
	presentation: { version: 9, future: { renderMode: 'globe' } },
}

function context(
	draftKey: string,
	overrides: Partial<DocumentAuthoringContext> = {},
): DocumentAuthoringContext {
	return {
		ownerPubkey: null,
		resolveTarget: (kind, args) => ({
			draftKey,
			created: args.createNew === true,
			expectedRevision: documentDraftRevision(
				kind === 'story' ? readStoryDraft(draftKey, null) : readGroupEditorDraft(draftKey, null),
			),
		}),
		assertBeforeCommit: () => {},
		assertReferenceAllowed: (reference) => {
			if (![MAP, STORY, localReference, 'earthly-story-draft:story%3Aone'].includes(reference))
				throw new Error('Source is outside the granted account/run scope.')
		},
		...overrides,
	}
}

describe('shared draft-only document authoring', () => {
	test('read flushes pending mounted human input before returning the authorized snapshot', async () => {
		writeStoryDraft('story-one', { title: 'Story', content: 'Old body' }, null)
		const unregister = registerDocumentDraftForm({
			kind: 'story',
			draftKey: 'story-one',
			ownerPubkey: null,
			flush: () =>
				writeStoryDraft('story-one', { title: 'Story', content: 'Pending human body' }, null),
			suppress: () => {},
		})
		try {
			const result = await readDocumentDraft('story', {}, context('story-one'))
			expect(result.draft).toMatchObject({ content: 'Pending human body' })
		} finally {
			unregister()
		}
	})

	test('pending form changes invalidate an old read before an AI write or Undo', async () => {
		writeStoryDraft('story-one', { title: 'Story', content: 'Body' }, null)
		const oldRevision = documentDraftRevision(readStoryDraft('story-one', null))
		let pending = true
		const unregister = registerDocumentDraftForm({
			kind: 'story',
			draftKey: 'story-one',
			ownerPubkey: null,
			flush: () => {
				if (pending) {
					pending = false
					writeStoryDraft('story-one', { title: 'Human title', content: 'Body' }, null)
				}
			},
			suppress: () => {},
		})
		try {
			await expect(
				writeDocumentDraft(
					'story',
					{ title: 'AI title' },
					context('story-one', {
						resolveTarget: () => ({
							draftKey: 'story-one',
							created: false,
							expectedRevision: oldRevision,
						}),
					}),
				),
			).rejects.toThrow('Read its latest draft')
			expect(readStoryDraft('story-one', null)?.title).toBe('Human title')
			let undo: (() => boolean) | undefined
			await writeDocumentDraft(
				'story',
				{ title: 'AI after a new read' },
				context('story-one', {
					didCommit: (change) => {
						undo = change.undo
					},
				}),
			)
			pending = true
			expect(undo?.()).toBe(false)
			expect(readStoryDraft('story-one', null)?.title).toBe('Human title')
		} finally {
			unregister()
		}
	})

	test('flushing a mounted Atlas after review preserves human edits rather than overwriting them', async () => {
		writeGroupEditorDraft('atlas-one', atlas, null)
		let pending = false
		const unregister = registerDocumentDraftForm({
			kind: 'atlas',
			draftKey: 'atlas-one',
			ownerPubkey: null,
			flush: () => {
				if (pending) {
					pending = false
					writeGroupEditorDraft('atlas-one', { ...atlas, name: 'Pending human Atlas' }, null)
				}
			},
			suppress: () => {},
		})
		try {
			await expect(
				writeDocumentDraft(
					'atlas',
					{ name: 'AI' },
					context('atlas-one', {
						review: async () => {
							pending = true
							return true
						},
					}),
				),
			).rejects.toThrow('while the AI was working')
			expect(readGroupEditorDraft('atlas-one', null)?.name).toBe('Pending human Atlas')
		} finally {
			unregister()
		}
	})

	test('form flush/suppression is exact-account and cannot clear persisted content', async () => {
		writeStoryDraft('story-one', { title: 'Story', content: 'Body', updatedAt: 10 }, null)
		let flushed = 0
		let suppressed = 0
		const unregister = registerDocumentDraftForm({
			kind: 'story',
			draftKey: 'story-one',
			ownerPubkey: null,
			flush: () => {
				flushed++
			},
			suppress: () => {
				suppressed++
			},
		})
		try {
			listDocumentDrafts('b'.repeat(64))
			expect(flushed).toBe(0)
			suppressDocumentDraftFormSave('story', 'story-one', 'b'.repeat(64))
			expect(suppressed).toBe(0)
			suppressDocumentDraftFormSave('story', 'story-one', null)
			expect(suppressed).toBe(1)
			expect(readStoryDraft('story-one', null)?.updatedAt).toBe(10)
		} finally {
			unregister()
		}
	})

	test('an unsaved human-input storage failure blocks an AI edit', async () => {
		writeStoryDraft('story-one', { title: 'Story', content: 'Body' }, null)
		const unregister = registerDocumentDraftForm({
			kind: 'story',
			draftKey: 'story-one',
			ownerPubkey: null,
			flush: () => {
				throw new Error('Human input could not be saved')
			},
			suppress: () => {},
		})
		try {
			await expect(
				writeDocumentDraft('story', { title: 'AI' }, context('story-one')),
			).rejects.toThrow('Human input')
			expect(readStoryDraft('story-one', null)?.title).toBe('Story')
		} finally {
			unregister()
		}
	})
	test('an exact read permits metadata changes while preserving published references and layer selectors', async () => {
		writeStoryDraft(
			'story-one',
			{
				title: 'Existing Story',
				content: `Source: ${coordinateToNaddrReference(MAP)}.`,
				presentation: {
					version: 1,
					layers: [{ id: 'selected', source: MAP, featureIds: ['one'] }],
				},
			},
			null,
		)
		writeGroupEditorDraft(
			'atlas-one',
			{
				...atlas,
				presentation: {
					version: 1,
					layers: [{ id: 'selected', source: MAP, featureIds: ['one'] }],
				},
			},
			null,
		)
		const denied = {
			assertReferenceAllowed: () => {
				throw new Error('No new source grant.')
			},
		}
		expect(
			(await writeDocumentDraft('story', { title: 'Renamed Story' }, context('story-one', denied)))
				.ok,
		).toBe(true)
		expect(
			(
				await writeDocumentDraft(
					'atlas',
					{ description: 'Edited description' },
					context('atlas-one', denied),
				)
			).ok,
		).toBe(true)
		expect(readStoryDraft('story-one', null)?.presentation).toEqual({
			version: 1,
			layers: [{ id: 'selected', source: MAP, featureIds: ['one'] }],
		})
	})

	test('preserved citations cannot grant new layers, layer ids, selectors, or additional sources', async () => {
		writeStoryDraft(
			'story-one',
			{
				title: 'Existing Story',
				content: `Source: ${coordinateToNaddrReference(MAP)}.`,
				presentation: {
					version: 1,
					layers: [{ id: 'selected', source: MAP, featureIds: ['one'] }],
				},
			},
			null,
		)
		const denied = {
			assertReferenceAllowed: () => {
				throw new Error('No new source grant.')
			},
		}
		for (const layer of [
			{ id: 'new-layer', source: MAP, featureIds: ['one'] },
			{ id: 'selected', source: MAP, featureIds: ['two'] },
			{ id: 'selected', source: MAP },
		]) {
			await expect(
				writeDocumentDraft(
					'story',
					{ presentation: { version: 1, layers: [layer] } },
					context('story-one', denied),
				),
			).rejects.toThrow('No new source grant')
		}
		await expect(
			writeDocumentDraft(
				'story',
				{
					markdown: `Source: ${coordinateToNaddrReference(MAP)}. New source: ${coordinateToNaddrReference(STORY)}.`,
				},
				context('story-one', denied),
			),
		).rejects.toThrow('No new source grant')
		writeStoryDraft(
			'citation-only',
			{ title: 'Citation only', content: `Source: ${coordinateToNaddrReference(MAP)}.` },
			null,
		)
		await expect(
			writeDocumentDraft(
				'story',
				{ presentation: { version: 1, layers: [{ id: 'new-layer', source: MAP }] } },
				context('citation-only', denied),
			),
		).rejects.toThrow('No new source grant')
	})

	test('preservation requires an exact authorized read and never bypasses local source existence', async () => {
		writeGroupEditorDraft('atlas-one', atlas, null)
		await expect(
			writeDocumentDraft(
				'atlas',
				{ name: 'Renamed' },
				context('atlas-one', {
					resolveTarget: () => ({ draftKey: 'atlas-one', created: false }),
					assertReferenceAllowed: () => {
						throw new Error('No authorized read.')
					},
				}),
			),
		).rejects.toThrow('No authorized read')
		writeStoryDraft('local-story', { title: 'Local source', content: localReference }, null)
		await expect(
			writeDocumentDraft(
				'story',
				{ title: 'Renamed' },
				context('local-story', {
					assertReferenceAllowed: () => {
						throw new Error('Local source unavailable.')
					},
				}),
			),
		).rejects.toThrow('Local source unavailable')
	})

	test('partial Story edits preserve body, cover, publication and opaque presentation', async () => {
		const before = {
			title: 'User title',
			summary: 'User summary',
			content: 'Keep user prose',
			image: 'https://example.org/cover.jpg',
			presentation: { version: 9, future: true },
			publication: { reference: STORY, eventId: 'published', fingerprint: 'baseline' },
			bodyTab: 'preview' as const,
		}
		writeStoryDraft('story-one', before, null)
		const result = await writeDocumentDraft('story', { title: 'New title' }, context('story-one'))
		expect(result.ok).toBe(true)
		expect(readStoryDraft('story-one', null)).toMatchObject({ ...before, title: 'New title' })
	})

	test('description is a Story summary alias, and empty values remove it', async () => {
		writeStoryDraft('story-one', { title: 'Story', content: 'Body', summary: 'Old' }, null)
		await writeDocumentDraft('story', { description: '' }, context('story-one'))
		expect(readStoryDraft('story-one', null)?.summary).toBe('')
		expect(() =>
			prepareStoryDocument({ summary: 'A', description: 'B' }, readStoryDraft('story-one', null)),
		).toThrow('same Story field')
	})

	test('no-op updates skip review, writes, history and timestamps', async () => {
		writeStoryDraft('story-one', { title: 'Same', content: 'Body', updatedAt: 10 }, null)
		const before = readStoryDraft('story-one', null)
		let reviewed = false
		let committed = false
		const result = await writeDocumentDraft(
			'story',
			{ title: 'Same' },
			context('story-one', {
				review: () => {
					reviewed = true
					return true
				},
				didCommit: () => {
					committed = true
				},
			}),
		)
		expect(result.status).toBe('unchanged')
		expect(reviewed).toBe(false)
		expect(committed).toBe(false)
		expect(readStoryDraft('story-one', null)).toEqual(before)
	})

	test('partial Atlas edits retain schema, governance, curated lane and opaque future data', async () => {
		writeGroupEditorDraft('atlas-one', atlas, null)
		await writeDocumentDraft('atlas', { name: 'Named Atlas' }, context('atlas-one'))
		expect(readGroupEditorDraft('atlas-one', null)).toMatchObject({ ...atlas, name: 'Named Atlas' })
	})

	test('creates separate Story and Atlas slots and lists them without replacing sentinels', async () => {
		writeStoryDraft('new-story', { title: 'Human draft', content: 'Human prose' }, null)
		writeGroupEditorDraft('new-context', atlas, null)
		await writeDocumentDraft(
			'story',
			{
				title: 'AI Story',
				markdown: localReference,
				createNew: true,
				presentation: {
					version: 1,
					initialView: { center: [44, 33], zoom: 5 },
					layers: [{ id: 'map', source }],
				},
			},
			context('thread-story:desktop:one'),
		)
		await writeDocumentDraft(
			'atlas',
			{
				name: 'AI Atlas',
				curatedReferences: [localReference, 'earthly-story-draft:story%3Aone'],
				createNew: true,
				presentation: {
					version: 1,
					initialView: { center: [44, 33], zoom: 5 },
					layers: [{ id: 'map', source }],
				},
			},
			context('thread-atlas:desktop:one'),
		)
		expect(readStoryDraft('new-story', null)?.title).toBe('Human draft')
		expect(readGroupEditorDraft('new-context', null)?.name).toBe('User Atlas')
		expect(listDocumentDrafts(null)).toHaveLength(4)
		expect(readStoryDraft('thread-story:desktop:one', null)?.publication).toBeUndefined()
	})

	test('account-scoped reads cannot see the same key in another account', async () => {
		writeStoryDraft('story-one', { title: 'Private', content: 'Private prose' }, 'b'.repeat(64))
		const result = await readDocumentDraft('story', {}, context('story-one'))
		expect(result.exists).toBe(false)
		expect(result.draft).toBeNull()
	})

	test('rejects a stale authorized read before review or mutation', async () => {
		writeStoryDraft('story-one', { title: 'Before', content: 'Body' }, null)
		const stale = documentDraftRevision(readStoryDraft('story-one', null))
		writeStoryDraft('story-one', { title: 'Human edit', content: 'Updated prose' }, null)
		const authoring = context('story-one', {
			resolveTarget: () => ({ draftKey: 'story-one', created: false, expectedRevision: stale }),
		})
		await expect(writeDocumentDraft('story', { title: 'AI overwrite' }, authoring)).rejects.toThrow(
			'Read its latest draft',
		)
		expect(readStoryDraft('story-one', null)?.title).toBe('Human edit')
	})

	test('CAS catches human edits made while review is pending', async () => {
		writeGroupEditorDraft('atlas-one', atlas, null)
		const authoring = context('atlas-one', {
			review: async () => {
				writeGroupEditorDraft(
					'atlas-one',
					{ ...atlas, description: 'Human edit during review' },
					null,
				)
				return true
			},
		})
		await expect(writeDocumentDraft('atlas', { name: 'AI name' }, authoring)).rejects.toThrow(
			'while the AI was working',
		)
		expect(readGroupEditorDraft('atlas-one', null)?.description).toBe('Human edit during review')
	})

	test('cancellation and revoked transport permission discard prepared changes', async () => {
		const abort = new AbortController()
		await expect(
			writeDocumentDraft(
				'story',
				{ title: 'AI', createNew: true },
				context('story-one', {
					signal: abort.signal,
					review: async () => {
						abort.abort()
						return true
					},
				}),
			),
		).rejects.toThrow('cancelled')
		expect(readStoryDraft('story-one', null)).toBeNull()
		let granted = true
		await expect(
			writeDocumentDraft(
				'atlas',
				{ name: 'AI', createNew: true },
				context('atlas-one', {
					assertBeforeCommit: () => {
						if (!granted) throw new Error('Permission revoked')
					},
					review: async () => {
						granted = false
						return true
					},
				}),
			),
		).rejects.toThrow('Permission revoked')
		expect(readGroupEditorDraft('atlas-one', null)).toBeNull()
	})

	test('review receives concrete before/after snapshots and rejection leaves storage unchanged', async () => {
		writeGroupEditorDraft('atlas-one', atlas, null)
		let change: PreparedDocumentChange | undefined
		const result = await writeDocumentDraft(
			'atlas',
			{ description: 'Changed description' },
			context('atlas-one', {
				review: async (value) => {
					change = value
					return false
				},
			}),
		)
		expect(result.ok).toBe(false)
		expect(change?.before).toMatchObject({ description: '**Keep this**' })
		expect(change?.after).toMatchObject({ description: 'Changed description' })
		expect(readGroupEditorDraft('atlas-one', null)).toMatchObject(atlas)
	})

	test('Undo restores the exact old snapshot and refuses to clobber a subsequent edit', async () => {
		writeStoryDraft('story-one', { title: 'Human', content: 'Original', updatedAt: 10 }, null)
		const before = readStoryDraft('story-one', null)
		let undo: (() => boolean) | undefined
		await writeDocumentDraft(
			'story',
			{ title: 'AI' },
			context('story-one', {
				didCommit: (change) => {
					undo = change.undo
				},
			}),
		)
		expect(undo?.()).toBe(true)
		expect(readStoryDraft('story-one', null)).toEqual(before)
		await writeDocumentDraft(
			'story',
			{ title: 'AI again' },
			context('story-one', {
				didCommit: (change) => {
					undo = change.undo
				},
			}),
		)
		writeStoryDraft('story-one', { title: 'Human changed', content: 'New user prose' }, null)
		expect(undo?.()).toBe(false)
		expect(readStoryDraft('story-one', null)?.title).toBe('Human changed')
	})

	test('source permission is checked again at commit and never substitutes an implicit active Map', async () => {
		let sourceReadable = true
		await expect(
			writeDocumentDraft(
				'story',
				{ title: 'AI', markdown: localReference, createNew: true },
				context('story-one', {
					assertReferenceAllowed: () => {
						if (!sourceReadable) throw new Error('Source unavailable')
					},
					review: async () => {
						sourceReadable = false
						return true
					},
				}),
			),
		).rejects.toThrow('Source unavailable')
		expect(readStoryDraft('story-one', null)).toBeNull()
		await expect(
			writeDocumentDraft(
				'atlas',
				{ name: 'AI', curatedReferences: ['earthly-draft:hidden-map'], createNew: true },
				context('atlas-one'),
			),
		).rejects.toThrow('outside')
	})

	test('rejects malformed cameras, unknown authored fields, uncurated layers and non-document references', () => {
		expect(() =>
			prepareAtlasDocument(
				{
					name: 'Atlas',
					curatedReferences: [localReference],
					presentation: { version: 1, initialView: { center: [44, 99], zoom: 4 }, layers: [] },
				},
				null,
			),
		).toThrow()
		expect(() =>
			prepareAtlasDocument(
				{
					name: 'Atlas',
					curatedReferences: [localReference],
					presentation: { version: 1, layers: [{ id: 'map', source, imaginary: true }] },
				},
				null,
			),
		).toThrow('unsupported fields')
		expect(() =>
			prepareAtlasDocument(
				{ name: 'Atlas', presentation: { version: 1, layers: [{ id: 'map', source }] } },
				null,
			),
		).toThrow()
		expect(() => prepareAtlasDocument({ name: 'Atlas', governance: 'open' }, null)).toThrow(
			'Unsupported document fields',
		)
		expect(() => canonicalDocumentReference(`0:${'a'.repeat(64)}:profile`)).toThrow(
			'whole Map or Story',
		)
		expect(() => canonicalDocumentReference('earthly-draft:%GG')).toThrow('Malformed')
	})
})
