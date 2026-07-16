import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import {
	fieldSessionConversationPolicySchema,
	fieldSessionInternetPolicySchema,
	type FieldSessionInfo,
	type RemoteNodeRecord,
} from '@/platform/contracts'

const STORAGE_KEY = 'earthly:field-sessions:v1'
const CHANGE_EVENT = 'earthly:field-sessions-changed'

const fieldSessionRecordSchema = z.object({
	version: z.literal(1),
	id: z.string().regex(/^[A-Za-z0-9_-]{1,96}$/),
	name: z.string().trim().min(1).max(120),
	description: z.string().trim().min(1).max(500).optional(),
	role: z.enum(['host', 'participant']),
	hostNodeId: z.string().regex(/^[0-9a-f]{64}$/),
	internetPolicy: fieldSessionInternetPolicySchema,
	conversationPolicy: fieldSessionConversationPolicySchema,
	allowPeerWrites: z.boolean(),
	contextCoordinates: z.array(z.string()).max(16).default([]),
	state: z.enum(['active', 'ended']),
	createdAt: z.number().int().positive(),
	updatedAt: z.number().int().positive(),
})

const fieldSessionRecordsSchema = z.array(fieldSessionRecordSchema)

export type FieldSessionRecord = z.infer<typeof fieldSessionRecordSchema>

let cachedRaw: string | null | undefined
let cachedRecords: FieldSessionRecord[] = []

function readRecords(): FieldSessionRecord[] {
	if (typeof window === 'undefined') return []
	const raw = window.localStorage.getItem(STORAGE_KEY)
	if (raw === cachedRaw) return cachedRecords
	cachedRaw = raw
	if (!raw) {
		cachedRecords = []
		return cachedRecords
	}
	try {
		cachedRecords = fieldSessionRecordsSchema.parse(JSON.parse(raw))
	} catch {
		cachedRecords = []
	}
	return cachedRecords
}

function writeRecords(records: FieldSessionRecord[]): void {
	if (typeof window === 'undefined') return
	const ordered = [...records].sort((left, right) => right.updatedAt - left.updatedAt)
	const raw = JSON.stringify(ordered)
	window.localStorage.setItem(STORAGE_KEY, raw)
	cachedRaw = raw
	cachedRecords = ordered
	window.dispatchEvent(new Event(CHANGE_EVENT))
}

function subscribe(listener: () => void): () => void {
	if (typeof window === 'undefined') return () => {}
	const onStorage = (event: StorageEvent) => {
		if (event.key === STORAGE_KEY) listener()
	}
	window.addEventListener(CHANGE_EVENT, listener)
	window.addEventListener('storage', onStorage)
	return () => {
		window.removeEventListener(CHANGE_EVENT, listener)
		window.removeEventListener('storage', onStorage)
	}
}

export function useFieldSessions(): FieldSessionRecord[] {
	return useSyncExternalStore(subscribe, readRecords, () => [])
}

export function upsertFieldSession(record: FieldSessionRecord): void {
	const records = readRecords()
	const existing = records.find((candidate) => candidate.id === record.id)
	if (existing && JSON.stringify(existing) === JSON.stringify(record)) return
	writeRecords([record, ...records.filter((candidate) => candidate.id !== record.id)])
}

export function updateFieldSession(
	id: string,
	update: Partial<Pick<FieldSessionRecord, 'state' | 'internetPolicy' | 'conversationPolicy'>>,
): void {
	const now = Math.floor(Date.now() / 1000)
	writeRecords(
		readRecords().map((record) =>
			record.id === id ? { ...record, ...update, updatedAt: now } : record,
		),
	)
}

export function removeFieldSession(id: string): void {
	writeRecords(readRecords().filter((record) => record.id !== id))
}

export function fieldSessionInfo(record: FieldSessionRecord): FieldSessionInfo {
	return {
		id: record.id,
		name: record.name,
		description: record.description,
		internetPolicy: record.internetPolicy,
		conversationPolicy: record.conversationPolicy,
		allowPeerWrites: record.allowPeerWrites,
		contextCoordinates: record.contextCoordinates,
	}
}

export function recordFromRemoteNode(remote: RemoteNodeRecord): FieldSessionRecord | null {
	const session = remote.fieldSession
	if (!session) return null
	const now = Math.floor(Date.now() / 1000)
	return {
		version: 1,
		...session,
		role: 'participant',
		hostNodeId: remote.nodeId,
		state: 'active',
		createdAt: Math.min(remote.updatedAt, now),
		updatedAt: remote.updatedAt,
	}
}
