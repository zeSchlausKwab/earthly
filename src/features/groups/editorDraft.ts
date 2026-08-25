import { readScopedStorage, writeScopedStorage } from '@/features/geo-editor/store/persistence'
import {
	GROUP_GEOMETRY_TYPES,
	type GroupGeometryType,
	type GroupGovernance,
} from '@/lib/nostr/group'
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
}

export interface GroupEditorDraft extends GroupEditorDraftSnapshot {
	updatedAt: number
}

const GROUP_EDITOR_DRAFTS_STORAGE_KEY = 'earthly:context:editor-drafts:v1'

/** Sentinel for the single retained, unpublished create-Context surface. */
export const NEW_GROUP_EDITOR_DRAFT_KEY = 'new-context'

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
