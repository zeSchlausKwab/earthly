/** Shared, draft-only document mutations. Transports provide permission and review, never persistence. */
import { accounts } from '@/lib/nostr'
import { readStoryDraft, writeStoryDraft, clearStoryDraft } from '@/lib/nostr/story'
import type { StoryDraft } from '@/lib/nostr/story/draft'
import {
	readGroupEditorDraft,
	writeGroupEditorDraft,
	clearGroupEditorDraft,
	listAllGroupEditorDrafts,
	type GroupEditorDraft,
	type GroupEditorDraftSnapshot,
} from '@/features/groups/editorDraft'
import {
	parseMapPresentation,
	authorizePresentationLayer,
	deriveAtlasPresentationAuthorization,
} from '@/lib/map-presentation'
import { extractSemanticStoryAddressReferences } from '@/lib/map-presentation/storyMarkdown'
import { localMapReference, localStoryReferences } from '@/lib/nostr/story/localReferences'
import {
	coordinateToNaddrReference,
	naddrToCoordinate,
	parseNostrAddressReference,
} from '@/lib/nostr/references'
import { listAllStoryDrafts } from '@/lib/nostr/story/draft'
import { prepareStoryMapAuthoring, describeStoryMapContent } from './story-presentation'
import { flushAllDocumentDraftForms, flushDocumentDraftForm } from './documentDraftForms'

export type AuthoringDocumentKind = 'story' | 'atlas'
export type AuthoringDocumentDraft = StoryDraft | GroupEditorDraft
export interface DocumentAuthoringTarget {
	draftKey: string
	created: boolean
	/** Exact stored snapshot from the transport's last authorized read, not a timestamp. */
	expectedRevision?: string | null
}
export interface DocumentAuthoringSource {
	kind: 'map' | 'story'
	reference: string
	title: string
	featureIds?: readonly string[]
}
export interface PreparedDocumentChange {
	kind: AuthoringDocumentKind
	draftKey: string
	created: boolean
	before: AuthoringDocumentDraft | null
	after: AuthoringDocumentDraft
}
export interface DocumentAuthoringContext {
	/** Captured account scope; null is explicitly the guest scope. */
	ownerPubkey: string | null
	signal?: AbortSignal
	resolveTarget(
		kind: AuthoringDocumentKind,
		args: Record<string, unknown>,
	): DocumentAuthoringTarget | Promise<DocumentAuthoringTarget>
	listSources?(): readonly DocumentAuthoringSource[]
	/** A source must already be readable within this transport's account/run scope. */
	assertReferenceAllowed(reference: string): void
	/** Rechecks the captured account, grant, target revision and cancellation at the write boundary. */
	assertBeforeCommit(): void
	review?(change: PreparedDocumentChange): boolean | Promise<boolean>
	didCommit?(change: PreparedDocumentChange & { undo: () => boolean }): void
	didRead?(
		kind: AuthoringDocumentKind,
		draftKey: string,
		draft: AuthoringDocumentDraft | null,
	): void
}

/** Full snapshots are retained privately by callers; they cannot miss same-millisecond edits. */
export function documentDraftRevision(draft: AuthoringDocumentDraft | null): string | null {
	const canonical = (value: unknown): unknown => {
		if (Array.isArray(value)) return value.map(canonical)
		if (value && typeof value === 'object')
			return Object.fromEntries(
				Object.entries(value)
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([key, item]) => [key, canonical(item)]),
			)
		return value
	}
	return draft ? JSON.stringify(canonical(draft)) : null
}

export function listDocumentDrafts(pubkey?: string | null) {
	flushAllDocumentDraftForms(pubkey === undefined ? (accounts.active?.pubkey ?? null) : pubkey)
	return [
		...listAllStoryDrafts(pubkey).map((draft) => ({
			kind: 'story' as const,
			draftKey: draft.draftKey,
			title: draft.title ?? 'Untitled Story',
			updatedAt: draft.updatedAt,
		})),
		...listAllGroupEditorDrafts(pubkey).map((draft) => ({
			kind: 'atlas' as const,
			draftKey: draft.draftKey,
			title: draft.name || 'Untitled Atlas',
			updatedAt: draft.updatedAt,
		})),
	]
}

function assertActive(context: DocumentAuthoringContext): void {
	if (context.signal?.aborted)
		throw new Error('Document authoring was cancelled. No draft changed.')
	context.assertBeforeCommit()
}

function readDraft(kind: AuthoringDocumentKind, draftKey: string, pubkey: string | null) {
	return kind === 'story'
		? readStoryDraft(draftKey, pubkey)
		: readGroupEditorDraft(draftKey, pubkey)
}

export async function readDocumentDraft(
	kind: AuthoringDocumentKind,
	args: Record<string, unknown>,
	context: DocumentAuthoringContext,
) {
	assertActive(context)
	const target = await context.resolveTarget(kind, args)
	assertActive(context)
	flushDocumentDraftForm(kind, target.draftKey, context.ownerPubkey)
	const draft = readDraft(kind, target.draftKey, context.ownerPubkey)
	context.didRead?.(kind, target.draftKey, draft)
	return {
		ok: true,
		exists: Boolean(draft),
		draftKey: target.draftKey,
		source: draft ? 'local' : 'empty',
		draft: draft && kind === 'story' ? describeStoryDraft(draft as StoryDraft) : draft,
		...(context.listSources ? { sources: context.listSources() } : {}),
	}
}

function boundedText(value: unknown, field: string, max: number, nonempty = false): string {
	if (typeof value !== 'string') throw new Error(`${field} must be a string.`)
	if (value.length > max) throw new Error(`${field} exceeds ${max} characters.`)
	if (nonempty && !value.trim()) throw new Error(`${field} must be a non-empty string.`)
	return value
}

function assertKeys(args: Record<string, unknown>, allowed: readonly string[]) {
	const unknown = Object.keys(args).filter((key) => !allowed.includes(key))
	if (unknown.length) throw new Error(`Unsupported document fields: ${unknown.join(', ')}.`)
	if (args.createNew !== undefined && typeof args.createNew !== 'boolean')
		throw new Error('createNew must be a boolean.')
}

const targetKeys = ['draftTarget', 'workingTarget', 'createNew', 'overwrite'] as const

function storyReferences(draft: StoryDraft): string[] {
	return [
		...extractSemanticStoryAddressReferences(draft.content).map((reference) => {
			const coordinate = naddrToCoordinate(reference.address)
			if (!coordinate) throw new Error('The Story contains a malformed published reference.')
			return `${coordinate}${reference.featureId ? `#${encodeURIComponent(reference.featureId)}` : ''}`
		}),
		...localStoryReferences(draft.content ?? '').map((reference) =>
			localMapReference(reference.workspaceId, reference.featureId),
		),
	]
}

/** Canonical draft references; local authoring never resolves or publishes sources. */
export function canonicalDocumentReference(raw: unknown): string {
	const reference = boundedText(raw, 'reference', 2_000, true).trim()
	const local = reference.match(/^(earthly-draft|earthly-story-draft):([a-zA-Z0-9_%~-]+)$/u)
	if (local) {
		let key: string
		try {
			key = decodeURIComponent(local[2]!)
		} catch {
			throw new Error('Malformed local draft reference.')
		}
		if (!key || key.length > 500) throw new Error('Malformed local draft reference.')
		return `${local[1]}:${encodeURIComponent(key)}`
	}
	const published = parseNostrAddressReference(
		reference.startsWith('nostr:') ? reference : `nostr:${reference}`,
	)
	const coordinate = published ? naddrToCoordinate(published.address) : reference
	if (
		published?.featureId ||
		!coordinate ||
		!/^(37515|37520):[a-fA-F0-9]{64}:.+$/u.test(coordinate)
	)
		throw new Error(
			'Atlas references must name a whole Map or Story, using a local reference or published address.',
		)
	return coordinate
}

function documentReferences(kind: AuthoringDocumentKind, draft: AuthoringDocumentDraft): string[] {
	return kind === 'story'
		? storyReferences(draft as StoryDraft)
		: (draft as GroupEditorDraft).curatedReferences.map(canonicalDocumentReference)
}

function isPublishedDocumentReference(reference: string): boolean {
	return /^(37515|37520):[a-fA-F0-9]{64}:.+$/u.test(reference)
}

/** A read preserves existing published bindings, never grants a new source or selector. */
function assertReferenceScope(
	context: DocumentAuthoringContext,
	kind: AuthoringDocumentKind,
	draft: AuthoringDocumentDraft,
	before: AuthoringDocumentDraft | null,
	preservePublishedBindings: boolean,
) {
	const retainedReferences = new Set(
		preservePublishedBindings && before
			? documentReferences(kind, before).filter(isPublishedDocumentReference)
			: [],
	)
	for (const reference of documentReferences(kind, draft)) {
		if (!retainedReferences.has(reference)) context.assertReferenceAllowed(reference)
	}
	const priorPresentation =
		preservePublishedBindings && before ? parseMapPresentation(before.presentation) : null
	const retainedLayers = new Set(
		priorPresentation?.status === 'valid'
			? priorPresentation.value.layers
					.filter(
						(layer) =>
							typeof layer.source === 'string' && isPublishedDocumentReference(layer.source),
					)
					.map((layer) => JSON.stringify([layer.id, layer.source, layer.featureIds ?? null]))
			: [],
	)
	const presentation = parseMapPresentation(draft.presentation)
	if (presentation.status !== 'valid') return
	for (const layer of presentation.value.layers) {
		const source: unknown = layer.source
		const reference =
			typeof source === 'string'
				? source
				: source && typeof source === 'object' && 'workspaceId' in source
					? localMapReference(String(source.workspaceId))
					: ''
		if (!reference) throw new Error('The presentation contains an invalid source.')
		if (
			isPublishedDocumentReference(reference) &&
			retainedLayers.has(JSON.stringify([layer.id, layer.source, layer.featureIds ?? null]))
		)
			continue
		if (layer.featureIds !== undefined) {
			for (const featureId of layer.featureIds)
				context.assertReferenceAllowed(`${reference}#${encodeURIComponent(featureId)}`)
		} else context.assertReferenceAllowed(reference)
	}
}

export function prepareStoryDocument(
	args: Record<string, unknown>,
	before: StoryDraft | null,
): StoryDraft {
	assertKeys(args, [
		...targetKeys,
		'storyReference',
		'title',
		'summary',
		'description',
		'markdown',
		'image',
		'presentation',
	])
	if (
		args.summary !== undefined &&
		args.description !== undefined &&
		args.summary !== args.description
	)
		throw new Error('summary and description name the same Story field; provide one value.')
	const title = Object.hasOwn(args, 'title')
		? boundedText(args.title, 'title', 300, true).trim()
		: before?.title
	if (!title?.trim()) throw new Error('A new Story needs a title.')
	const content = Object.hasOwn(args, 'markdown')
		? boundedText(args.markdown, 'markdown', 100_000)
		: (before?.content ?? '')
	const summaryValue = Object.hasOwn(args, 'summary') ? args.summary : args.description
	const summary =
		Object.hasOwn(args, 'summary') || Object.hasOwn(args, 'description')
			? boundedText(summaryValue, 'summary', 2_000).trim()
			: before?.summary
	const image = Object.hasOwn(args, 'image')
		? boundedText(args.image, 'image', 2_000).trim()
		: before?.image
	const mapContent = prepareStoryMapAuthoring({
		markdown: content,
		previousMarkdown: before?.content,
		presentation: Object.hasOwn(args, 'presentation') ? args.presentation : before?.presentation,
		replacePresentation: Object.hasOwn(args, 'presentation'),
	})
	return { ...before, title, summary, image, ...mapContent, updatedAt: Date.now() }
}

export function prepareAtlasDocument(
	args: Record<string, unknown>,
	before: GroupEditorDraft | null,
): GroupEditorDraft {
	assertKeys(args, [
		...targetKeys,
		'name',
		'description',
		'curatedReferences',
		'image',
		'presentation',
	])
	const name = Object.hasOwn(args, 'name')
		? boundedText(args.name, 'name', 300, true).trim()
		: before?.name
	if (!name?.trim()) throw new Error('A new Atlas needs a name.')
	const base: GroupEditorDraftSnapshot = before ?? {
		name: '',
		description: '',
		curatedReferences: [],
		image: '',
		governance: 'closed',
		schemaMode: 'builder',
		allowedGeometryTypes: [],
		rows: [],
		advancedJson: '{}',
		sampleJson: '{}',
	}
	const after = {
		...base,
		name,
		description: Object.hasOwn(args, 'description')
			? boundedText(args.description, 'description', 100_000)
			: base.description,
		image: Object.hasOwn(args, 'image')
			? boundedText(args.image, 'image', 2_000).trim()
			: base.image,
		curatedReferences: [...base.curatedReferences],
		updatedAt: Date.now(),
	}
	if (Object.hasOwn(args, 'curatedReferences')) {
		if (!Array.isArray(args.curatedReferences) || args.curatedReferences.length > 200)
			throw new Error('curatedReferences must be an array with at most 200 Map/Story references.')
		after.curatedReferences = [...new Set(args.curatedReferences.map(canonicalDocumentReference))]
	}
	if (Object.hasOwn(args, 'presentation')) {
		// Reuse the strict opening schema and camera/style validation; Story body authorization
		// belongs to Story authoring, so Atlas grants are checked separately below.
		const mapContent = prepareStoryMapAuthoring({
			markdown: after.curatedReferences
				.map(canonicalDocumentReference)
				.map((reference) => coordinateToNaddrReference(reference) ?? reference)
				.join('\n'),
			presentation: args.presentation,
			replacePresentation: true,
		})
		after.presentation = mapContent.presentation
	}
	const parsed = parseMapPresentation(after.presentation)
	if (
		parsed.status === 'valid' &&
		(Object.hasOwn(args, 'presentation') || Object.hasOwn(args, 'curatedReferences'))
	) {
		const authorization = deriveAtlasPresentationAuthorization(
			after.curatedReferences.map(canonicalDocumentReference),
			{ allowLocalDraftReferences: true },
		)
		for (const layer of parsed.value.layers)
			if (authorizePresentationLayer(layer, authorization).status !== 'authorized')
				throw new Error(`Atlas layer '${layer.id}' must reference a Map in curatedReferences.`)
	}
	return after
}

function describeStoryDraft(draft: StoryDraft) {
	return {
		...draft,
		markdown: draft.content ?? '',
		description: draft.summary ?? '',
		mapAuthoring: describeStoryMapContent(draft.presentation, draft.content),
	}
}

export async function writeDocumentDraft(
	kind: AuthoringDocumentKind,
	args: Record<string, unknown>,
	context: DocumentAuthoringContext,
) {
	assertActive(context)
	const target = await context.resolveTarget(kind, args)
	assertActive(context)
	flushDocumentDraftForm(kind, target.draftKey, context.ownerPubkey)
	const before = readDraft(kind, target.draftKey, context.ownerPubkey)
	const revision = documentDraftRevision(before)
	if (target.created && before) throw new Error('A new document cannot replace an existing draft.')
	if (target.expectedRevision !== undefined && target.expectedRevision !== revision)
		throw new Error(
			'The document changed. Read its latest draft before editing; nothing was overwritten.',
		)
	const preservePublishedBindings = target.expectedRevision !== undefined
	const after =
		kind === 'story'
			? prepareStoryDocument(args, before as StoryDraft | null)
			: prepareAtlasDocument(args, before as GroupEditorDraft | null)
	assertReferenceScope(context, kind, after, before, preservePublishedBindings)
	if (
		before &&
		documentDraftRevision({ ...before, updatedAt: 0 }) ===
			documentDraftRevision({ ...after, updatedAt: 0 })
	) {
		return {
			ok: true,
			status: 'unchanged',
			draftKey: target.draftKey,
			mode: 'edit',
			draft: kind === 'story' ? describeStoryDraft(before as StoryDraft) : before,
			note: 'The local draft already has these values. No content changed.',
		}
	}
	const change: PreparedDocumentChange = {
		kind,
		draftKey: target.draftKey,
		created: target.created,
		before: structuredClone(before),
		after: structuredClone(after),
	}
	if (context.review && !(await context.review(change)))
		return {
			ok: false,
			status: 'cancelled',
			message: 'Document changes discarded. No draft changed.',
		}
	// No await may intervene between this permission/CAS check and synchronous persistence.
	assertActive(context)
	flushDocumentDraftForm(kind, target.draftKey, context.ownerPubkey)
	assertActive(context)
	if (documentDraftRevision(readDraft(kind, target.draftKey, context.ownerPubkey)) !== revision)
		throw new Error('The document changed while the AI was working. Nothing was overwritten.')
	assertReferenceScope(context, kind, after, before, preservePublishedBindings)
	if (kind === 'story') writeStoryDraft(target.draftKey, after as StoryDraft, context.ownerPubkey)
	else writeGroupEditorDraft(target.draftKey, after as GroupEditorDraft, context.ownerPubkey)
	const saved = readDraft(kind, target.draftKey, context.ownerPubkey)
	if (!saved || documentDraftRevision(saved) !== documentDraftRevision(after))
		throw new Error('The local draft could not be saved. Check browser storage and try again.')
	const savedRevision = documentDraftRevision(saved)
	const undo = () => {
		if ((accounts.active?.pubkey ?? null) !== context.ownerPubkey) return false
		try {
			flushDocumentDraftForm(kind, target.draftKey, context.ownerPubkey)
		} catch {
			return false
		}
		if (
			documentDraftRevision(readDraft(kind, target.draftKey, context.ownerPubkey)) !== savedRevision
		)
			return false
		if (kind === 'story') {
			if (before) writeStoryDraft(target.draftKey, before as StoryDraft, context.ownerPubkey)
			else clearStoryDraft(target.draftKey, context.ownerPubkey)
		} else if (before)
			writeGroupEditorDraft(target.draftKey, before as GroupEditorDraft, context.ownerPubkey)
		else clearGroupEditorDraft(target.draftKey, context.ownerPubkey)
		return true
	}
	try {
		context.didCommit?.({ ...change, undo })
	} catch (error) {
		console.warn('The local document was saved, but its UI notification failed.', error)
	}
	return {
		ok: true,
		draftKey: target.draftKey,
		mode: target.created ? 'create' : 'edit',
		draft: kind === 'story' ? describeStoryDraft(saved as StoryDraft) : saved,
		note: 'Saved a local draft. Publishing remains an explicit user action.',
	}
}
