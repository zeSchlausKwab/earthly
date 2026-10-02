/** Field-level three-way rebasing. Preparation never changes a draft or its publication identity. */
import type { NostrEvent } from 'nostr-tools'
import { ARTICLE_KIND, MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import { getArticleContent } from '@/lib/nostr/article'
import {
	getGroupContent,
	getGroupReferencedAddresses,
	GROUP_GEOMETRY_TYPES,
} from '@/lib/nostr/group'
import { storyContentFingerprint, type StoryDraft } from '@/lib/nostr/story/draft'
import type { GroupEditorDraft } from '@/features/groups/editorDraft'
import {
	compileBuilderSchema,
	decodeAllowedGeometryTypes,
	decodeBuilderSchema,
} from '@/features/groups/schemaBuilder'
import { validateStoryPresentation } from '@/lib/nostr/story/lifecycle'
import {
	parseMapPresentation,
	deriveAtlasPresentationAuthorization,
	authorizePresentationLayer,
} from '@/lib/map-presentation'
import { coordinateToNaddrReference } from '@/lib/nostr/references'
import {
	canonicalDocumentReference,
	type AuthoringDocumentDraft,
	type AuthoringDocumentKind,
} from './document-authoring'

type Fields = Record<string, unknown>
export interface RebaseField {
	field: string
	base: unknown
	local: unknown
	remote: unknown
	status: 'unchanged' | 'local-only' | 'remote-only' | 'conflict'
	suggested: 'local' | 'remote' | null
}
export interface DocumentRebasePlan {
	kind: AuthoringDocumentKind
	before: AuthoringDocumentDraft
	remote: AuthoringDocumentDraft
	reference: string
	baseRevisionId: string | null
	latestRevisionId: string
	baseAvailable: boolean
	fields: RebaseField[]
}
export interface RebaseResolution {
	choice: 'local' | 'remote' | 'merged'
	value?: unknown
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical)
	if (value && typeof value === 'object')
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry)]),
		)
	return value
}
const equal = (a: unknown, b: unknown) =>
	JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
function record(value: unknown): value is Fields {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** Exact public snapshots, including opaque future presentation values. */
export function publishedDocumentDraft(
	kind: AuthoringDocumentKind,
	event: NostrEvent,
): AuthoringDocumentDraft {
	if (kind === 'story') {
		const content = getArticleContent(event)
		return {
			title: content.title,
			summary: content.summary,
			image: content.image,
			content: content.content,
			...(Object.hasOwn(content, 'presentation')
				? { presentation: structuredClone(content.presentation) }
				: {}),
			updatedAt: 0,
		}
	}
	const content = getGroupContent(event)
	return {
		name: content.name,
		description: content.description ?? '',
		image: content.image ?? '',
		curatedReferences: [...getGroupReferencedAddresses(event)],
		governance: content.governance,
		schemaMode: 'advanced',
		allowedGeometryTypes:
			content.geometryConstraints?.allowedTypes ?? decodeAllowedGeometryTypes(content.schema),
		rows: decodeBuilderSchema(content.schema),
		advancedJson: JSON.stringify(content.schema ?? {}, null, 2),
		sampleJson: '{}',
		...(Object.hasOwn(content, 'presentation')
			? { presentation: structuredClone(content.presentation) }
			: {}),
		updatedAt: 0,
	}
}

function semanticFields(kind: AuthoringDocumentKind, draft: AuthoringDocumentDraft): Fields {
	if (kind === 'story') {
		const story = draft as StoryDraft
		return {
			title: story.title?.trim() ?? '',
			summary: story.summary?.trim() ?? '',
			image: story.image?.trim() ?? '',
			content: story.content ?? '',
			presentation: story.presentation ?? null,
		}
	}
	const atlas = draft as GroupEditorDraft
	return {
		name: atlas.name.trim(),
		description: atlas.description,
		image: atlas.image.trim(),
		curatedReferences: atlas.curatedReferences.map(canonicalDocumentReference),
		presentation: atlas.presentation ?? null,
		// Governance and its schema are one conflict unit; mixing them independently can change policy.
		policy: {
			governance: atlas.governance,
			schema:
				atlas.governance !== 'schema'
					? {}
					: atlas.schemaMode === 'builder'
						? compileBuilderSchema(atlas.rows, atlas.allowedGeometryTypes)
						: JSON.parse(atlas.advancedJson),
			allowedGeometryTypes: [...atlas.allowedGeometryTypes].sort(),
		},
	}
}

function retainedStoryBase(story: StoryDraft): Fields | null {
	try {
		const value: unknown = JSON.parse(story.publication?.fingerprint ?? '')
		if (
			!record(value) ||
			!['title', 'summary', 'image', 'content'].every((key) => typeof value[key] === 'string')
		)
			return null
		return {
			title: value.title,
			summary: value.summary,
			image: value.image,
			content: value.content,
			presentation: value.presentation ?? null,
		}
	} catch {
		return null
	}
}

export function prepareDocumentRebase(
	kind: AuthoringDocumentKind,
	before: AuthoringDocumentDraft,
	latest: NostrEvent,
	original?: NostrEvent,
): DocumentRebasePlan {
	const identifier = latest.tags.find((tag) => tag[0] === 'd')?.[1]
	if (!identifier || latest.kind !== (kind === 'story' ? ARTICLE_KIND : MAP_CONTEXT_KIND))
		throw new Error('The published document has no matching address or kind.')
	const reference = `${latest.kind}:${latest.pubkey}:${identifier}`
	const baseRevisionId =
		kind === 'story'
			? ((before as StoryDraft).publication?.eventId ?? null)
			: ((before as GroupEditorDraft).sourceRevisionId ?? null)
	if (
		original &&
		(original.id !== baseRevisionId ||
			original.kind !== latest.kind ||
			original.pubkey !== latest.pubkey ||
			original.tags.find((tag) => tag[0] === 'd')?.[1] !== identifier)
	)
		throw new Error('The original snapshot does not match the retained base revision.')
	const remote = publishedDocumentDraft(kind, latest)
	const localFields = semanticFields(kind, before)
	const remoteFields = semanticFields(kind, remote)
	const baseFields = original
		? semanticFields(kind, publishedDocumentDraft(kind, original))
		: kind === 'story'
			? retainedStoryBase(before as StoryDraft)
			: null
	const fields = Object.keys(localFields).map((field): RebaseField => {
		const local = localFields[field],
			remote = remoteFields[field],
			base = baseFields?.[field] ?? null
		const status = equal(local, remote)
			? 'unchanged'
			: !baseFields
				? 'conflict'
				: equal(local, base)
					? 'remote-only'
					: equal(remote, base)
						? 'local-only'
						: 'conflict'
		return {
			field,
			base,
			local,
			remote,
			status,
			suggested: status === 'conflict' ? null : status === 'remote-only' ? 'remote' : 'local',
		}
	})
	return {
		kind,
		before: structuredClone(before),
		remote,
		reference,
		baseRevisionId,
		latestRevisionId: latest.id,
		baseAvailable: Boolean(baseFields),
		fields,
	}
}

function text(value: unknown, field: string, max: number, required = false): string {
	if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
		throw new Error(
			`${field} must be ${required ? 'nonempty ' : ''}text of at most ${max} characters.`,
		)
	return value
}

/** Explicit conflicting choices only; no line-level merge is guessed for narrative or view data. */
export function resolveDocumentRebase(
	plan: DocumentRebasePlan,
	resolutions: Record<string, RebaseResolution>,
): AuthoringDocumentDraft {
	if (!record(resolutions)) throw new Error('resolutions must name document fields.')
	if (Object.keys(resolutions).some((key) => !plan.fields.some((field) => field.field === key)))
		throw new Error('A resolution names a field outside this rebase preview.')
	const values: Fields = {}
	for (const field of plan.fields) {
		const resolution = resolutions[field.field]
		if (!resolution && field.status === 'conflict')
			throw new Error(`Resolve conflicting field '${field.field}' explicitly.`)
		const choice = resolution?.choice ?? field.suggested
		if (choice !== 'local' && choice !== 'remote' && choice !== 'merged')
			throw new Error(`Invalid resolution for '${field.field}'.`)
		if (choice === 'merged' && (!resolution || !Object.hasOwn(resolution, 'value')))
			throw new Error(`A merged resolution for '${field.field}' needs its complete value.`)
		if (choice !== 'merged' && resolution && Object.hasOwn(resolution, 'value'))
			throw new Error(`Only a merged resolution can provide a value for '${field.field}'.`)
		values[field.field] = structuredClone(
			choice === 'local' ? field.local : choice === 'remote' ? field.remote : resolution?.value,
		)
	}
	if (new TextEncoder().encode(JSON.stringify(values)).byteLength > 512 * 1024)
		throw new Error('The merged document exceeds the rebase budget.')
	const presentationField = plan.fields.find((field) => field.field === 'presentation')
	const retainedPresentation =
		equal(values.presentation, presentationField?.local) ||
		equal(values.presentation, presentationField?.remote)
	const mergedPresentation = parseMapPresentation(values.presentation ?? undefined)
	if (
		!retainedPresentation &&
		mergedPresentation.status !== 'absent' &&
		(mergedPresentation.status !== 'valid' || mergedPresentation.issues.length)
	)
		throw new Error(
			'A new merged presentation must use valid supported presentation fields. Opaque local or remote snapshots can be preserved verbatim.',
		)
	if (plan.kind === 'story') {
		const after: StoryDraft = {
			...(plan.before as StoryDraft),
			title: text(values.title, 'title', 300, true).trim(),
			summary: text(values.summary, 'summary', 2_000).trim(),
			image: text(values.image, 'image', 2_000).trim(),
			content: text(values.content, 'content', 100_000),
			presentation: values.presentation ?? undefined,
			updatedAt: Date.now(),
		}
		validateStoryPresentation(after, { allowLocalDraftReferences: true })
		const reference = coordinateToNaddrReference(plan.reference)
		if (!reference) throw new Error('The published Story has no valid citation address.')
		after.publication = {
			reference,
			eventId: plan.latestRevisionId,
			fingerprint: storyContentFingerprint(plan.remote as StoryDraft),
		}
		return after
	}
	if (!Array.isArray(values.curatedReferences) || values.curatedReferences.length > 200)
		throw new Error('curatedReferences must contain at most 200 whole Map or Story references.')
	const curatedReferences = values.curatedReferences.map(canonicalDocumentReference)
	const policy = values.policy
	if (
		!record(policy) ||
		!['open', 'schema', 'closed'].includes(String(policy.governance)) ||
		!record(policy.schema) ||
		!Array.isArray(policy.allowedGeometryTypes) ||
		policy.allowedGeometryTypes.some((type) => !GROUP_GEOMETRY_TYPES.includes(type))
	)
		throw new Error(
			'policy must contain valid governance, an object schema and allowedGeometryTypes.',
		)
	const before = plan.before as GroupEditorDraft
	const policyField = plan.fields.find((field) => field.field === 'policy')
	const keepLocalPolicy = equal(values.policy, policyField?.local)
	const after: GroupEditorDraft = {
		...before,
		name: text(values.name, 'name', 300, true).trim(),
		description: text(values.description, 'description', 100_000),
		image: text(values.image, 'image', 2_000).trim(),
		curatedReferences,
		presentation: values.presentation ?? undefined,
		...(keepLocalPolicy
			? {}
			: {
					governance: policy.governance as GroupEditorDraft['governance'],
					schemaMode: 'advanced' as const,
					allowedGeometryTypes:
						policy.allowedGeometryTypes as GroupEditorDraft['allowedGeometryTypes'],
					rows: decodeBuilderSchema(policy.schema),
					advancedJson: JSON.stringify(policy.schema, null, 2),
				}),
		sourceRevisionId: plan.latestRevisionId,
		updatedAt: Date.now(),
	}
	const parsed = parseMapPresentation(after.presentation)
	if (parsed.status === 'valid') {
		if (parsed.issues.length) throw new Error('The merged Atlas presentation has invalid fields.')
		const authorization = deriveAtlasPresentationAuthorization(curatedReferences, {
			allowLocalDraftReferences: true,
		})
		for (const layer of parsed.value.layers)
			if (authorizePresentationLayer(layer, authorization).status !== 'authorized')
				throw new Error(`Merged Atlas layer '${layer.id}' must reference a curated Map.`)
	}
	return after
}
