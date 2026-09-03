import { readScopedStorage, writeScopedStorage } from '@/features/geo-editor/store/persistence'
import {
	GROUP_GEOMETRY_TYPES,
	type GroupGeometryType,
	type GroupGovernance,
} from '@/lib/nostr/group'
import {
	authorizePresentationLayer,
	deriveAtlasPresentationAuthorization,
	getUsableMapPresentation,
	parseMapPresentation,
	type MapPresentationIssue,
} from '@/lib/map-presentation'
import type { SchemaBuilderRow, SchemaFieldType } from './schemaBuilder'

export type GroupSchemaAuthorMode = 'builder' | 'advanced'

/** Complete user-editable Context form state; transient validation/publish state is excluded. */
export interface GroupEditorDraftSnapshot {
	name: string
	description: string
	curatedReferences: string[]
	image: string
	governance: GroupGovernance
	schemaMode: GroupSchemaAuthorMode
	allowedGeometryTypes: GroupGeometryType[]
	rows: SchemaBuilderRow[]
	advancedJson: string
	sampleJson: string
	/** Raw embedded value; unsupported future versions survive unrelated edits. */
	presentation?: unknown
}

export interface GroupEditorDraft extends GroupEditorDraftSnapshot {
	updatedAt: number
}

const GROUP_EDITOR_DRAFTS_STORAGE_KEY = 'earthly:context:editor-drafts:v1'

/** Sentinel for the single retained, unpublished create-Context surface. */
export const NEW_GROUP_EDITOR_DRAFT_KEY = 'new-context'

export class AtlasPresentationValidationError extends Error {
	readonly layerId?: string
	readonly issues: readonly MapPresentationIssue[]

	constructor(
		message: string,
		options: { layerId?: string; issues?: readonly MapPresentationIssue[] } = {},
	) {
		super(message)
		this.name = 'AtlasPresentationValidationError'
		this.layerId = options.layerId
		this.issues = Object.freeze([...(options.issues ?? [])])
	}
}

/**
 * Normalize a usable V1 before publish and prove every source is in the owner's
 * accepted/curated `a` lane. Malformed and future raw values remain opaque so a
 * routine metadata edit never rewrites data this client cannot interpret.
 */
export function normalizeAtlasPresentationForPublish(
	raw: unknown,
	acceptedAddresses: readonly string[],
): unknown {
	const parsed = parseMapPresentation(raw)
	if (parsed.status !== 'valid') return raw
	if (parsed.issues.length > 0) {
		throw new AtlasPresentationValidationError(
			'The Atlas default view contains invalid presentation fields. Fix or remove it before publishing.',
			{ issues: parsed.issues },
		)
	}
	const presentation = getUsableMapPresentation(parsed)
	if (!presentation) {
		throw new AtlasPresentationValidationError(
			'The Atlas default view has an invalid layer list. Recreate it before publishing.',
			{ issues: parsed.issues },
		)
	}

	const authorization = deriveAtlasPresentationAuthorization(acceptedAddresses)
	for (const layer of presentation.layers) {
		if (authorizePresentationLayer(layer, authorization).status === 'authorized') continue
		throw new AtlasPresentationValidationError(
			`Default-view layer '${layer.id}' must reference a Map in the Atlas's curated lane.`,
			{ layerId: layer.id },
		)
	}
	return presentation
}

const GOVERNANCE_VALUES = new Set<GroupGovernance>(['open', 'schema', 'closed'])
const SCHEMA_MODES = new Set<GroupSchemaAuthorMode>(['builder', 'advanced'])
const GEOMETRY_TYPES = new Set<string>(GROUP_GEOMETRY_TYPES)
const FIELD_TYPES = new Set<SchemaFieldType>(['text', 'number', 'integer', 'boolean', 'enum'])

function stringList(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === 'string')
		: []
}

function readRows(value: unknown): SchemaBuilderRow[] {
	if (!Array.isArray(value)) return []
	return value.flatMap((raw) => {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
		const row = raw as Record<string, unknown>
		if (typeof row.name !== 'string' || !FIELD_TYPES.has(row.type as SchemaFieldType)) return []
		return [
			{
				name: row.name,
				type: row.type as SchemaFieldType,
				required: row.required === true,
				allowedValues: stringList(row.allowedValues),
			},
		]
	})
}

function parseDraft(raw: unknown): GroupEditorDraft | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
	const value = raw as Record<string, unknown>
	const governance = GOVERNANCE_VALUES.has(value.governance as GroupGovernance)
		? (value.governance as GroupGovernance)
		: 'open'
	const schemaMode = SCHEMA_MODES.has(value.schemaMode as GroupSchemaAuthorMode)
		? (value.schemaMode as GroupSchemaAuthorMode)
		: 'builder'

	return {
		name: typeof value.name === 'string' ? value.name : '',
		description: typeof value.description === 'string' ? value.description : '',
		curatedReferences: stringList(value.curatedReferences),
		image: typeof value.image === 'string' ? value.image : '',
		governance,
		schemaMode,
		allowedGeometryTypes: stringList(value.allowedGeometryTypes).filter(
			(type): type is GroupGeometryType => GEOMETRY_TYPES.has(type),
		),
		rows: readRows(value.rows),
		advancedJson: typeof value.advancedJson === 'string' ? value.advancedJson : '{}',
		sampleJson: typeof value.sampleJson === 'string' ? value.sampleJson : '{}',
		...(Object.hasOwn(value, 'presentation') ? { presentation: value.presentation } : {}),
		updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0,
	}
}

function readDraftMap(pubkey?: string | null): Record<string, GroupEditorDraft> {
	const parsed = readScopedStorage<unknown>(GROUP_EDITOR_DRAFTS_STORAGE_KEY, null, pubkey)
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

	const drafts: Record<string, GroupEditorDraft> = {}
	for (const [identity, raw] of Object.entries(parsed as Record<string, unknown>)) {
		const draft = parseDraft(raw)
		if (draft) drafts[identity] = draft
	}
	return drafts
}

export function readGroupEditorDraft(
	identity: string,
	pubkey?: string | null,
): GroupEditorDraft | null {
	return readDraftMap(pubkey)[identity] ?? null
}

export function writeGroupEditorDraft(
	identity: string,
	draft: GroupEditorDraftSnapshot & Partial<Pick<GroupEditorDraft, 'updatedAt'>>,
	pubkey?: string | null,
): void {
	const drafts = readDraftMap(pubkey)
	drafts[identity] = { ...draft, updatedAt: draft.updatedAt ?? Date.now() }
	writeScopedStorage(GROUP_EDITOR_DRAFTS_STORAGE_KEY, drafts, pubkey)
}

export function clearGroupEditorDraft(identity: string, pubkey?: string | null): void {
	const drafts = readDraftMap(pubkey)
	if (!(identity in drafts)) return
	delete drafts[identity]
	writeScopedStorage(GROUP_EDITOR_DRAFTS_STORAGE_KEY, drafts, pubkey)
}
