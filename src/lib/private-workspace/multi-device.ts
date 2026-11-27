import { randomBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import {
	finalizeEvent,
	getPublicKey,
	verifyEvent,
	type EventTemplate,
	type NostrEvent,
} from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import { bytesToHex } from './codec'
import type { PrivateWorkspaceEnvelope } from './envelope'
import { reduceAdministratorPolicy } from './policy'
import type { PrivateWorkspaceStore, StoredWorkspace, WorkspaceMetadata } from './storage'

export const MULTI_DEVICE_SCHEMA_VERSION = 1 as const
export const MULTI_DEVICE_TIP_KIND = 30078
export const MULTI_DEVICE_TIP_D_TAG = 'cordn-md-tip-v1'

const HEX_64_PATTERN = /^[0-9a-f]{64}$/u
const RELAY_URL_PATTERN = /^wss?:\/\/\S+$/iu
const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export interface MultiDeviceGroupDocument {
	schemaVersion: typeof MULTI_DEVICE_SCHEMA_VERSION
	type: 'group'
	issuedAt: number
	prev: string | null
	gid: string
	coordinator: string
	coordinatorRelays: string[]
	clientState: string
	cursor: number
	/** Optional Earthly extensions carried seamlessly across devices. */
	workspaceId?: string
	adminPubkey?: string
	metadata?: WorkspaceMetadata
	envelopes?: PrivateWorkspaceEnvelope[]
	epochMediaKeys?: Record<string, string>
	envelopeEpochs?: Record<string, number>
	autoApproveJoins?: boolean
}

export interface MultiDeviceRemovedGroup {
	gid: string
	removedAt: number
}

export interface MultiDeviceLastResortKeyPackage {
	kpRef: string
	kp64: string
	privateKp64?: string
	createdAt: number
}

export interface MultiDeviceMetaDocument {
	schemaVersion: typeof MULTI_DEVICE_SCHEMA_VERSION
	type: 'meta'
	issuedAt: number
	removed: MultiDeviceRemovedGroup[]
	lastResortKeyPackage?: MultiDeviceLastResortKeyPackage
}

export type MultiDeviceDocument = MultiDeviceGroupDocument | MultiDeviceMetaDocument

export interface MultiDeviceBlobRef {
	/** 64-char lowercase hex SHA-256 of the sealed document blob. */
	x: string
	urls: string[]
	issuedAt: number
}

/**
 * Opaque self-encrypted tip pointer stored inside the NIP-78 (`kind 30078`,
 * `d: "cordn-md-tip-v1"`) event content. Relays only see NIP-44 ciphertext.
 */
export interface MultiDeviceTipPointer {
	schemaVersion: typeof MULTI_DEVICE_SCHEMA_VERSION
	/** 64-char hex 32-byte per-identity DEK used to seal/unseal Blossom documents. */
	dekHex: string
	blossomServers: string[]
	groups: Record<string, MultiDeviceBlobRef>
	meta?: MultiDeviceBlobRef
	updatedAt?: number
}

export interface MultiDeviceNip44Signer {
	getPublicKey(): Promise<string>
	signEvent(event: EventTemplate): Promise<NostrEvent>
	nip44Encrypt(pubkey: string, plaintext: string): Promise<string>
	nip44Decrypt(pubkey: string, ciphertext: string): Promise<string>
}

export function createLocalMultiDeviceNip44Signer(secretKey: Uint8Array): MultiDeviceNip44Signer {
	const ownPubkey = getPublicKey(secretKey)
	return {
		async getPublicKey() {
			return ownPubkey
		},
		async signEvent(event) {
			return finalizeEvent(event, secretKey)
		},
		async nip44Encrypt(pubkey, plaintext) {
			const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey)
			return nip44.v2.encrypt(plaintext, conversationKey)
		},
		async nip44Decrypt(pubkey, ciphertext) {
			const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey)
			return nip44.v2.decrypt(ciphertext, conversationKey)
		},
	}
}

export function generateMultiDeviceDek(): Uint8Array {
	return randomBytes(32)
}

function assertValidDek(dek: Uint8Array): void {
	if (dek.byteLength !== 32) {
		throw new Error('Multi-device DEK must be 32 bytes')
	}
}

function validateGroupDocument(candidate: Record<string, unknown>): MultiDeviceGroupDocument {
	const prev = candidate.prev === undefined ? null : candidate.prev
	if (
		candidate.schemaVersion !== MULTI_DEVICE_SCHEMA_VERSION ||
		candidate.type !== 'group' ||
		typeof candidate.issuedAt !== 'number' ||
		!Number.isSafeInteger(candidate.issuedAt) ||
		candidate.issuedAt < 0 ||
		(prev !== null && (typeof prev !== 'string' || !HEX_64_PATTERN.test(prev))) ||
		typeof candidate.gid !== 'string' ||
		candidate.gid.length === 0 ||
		typeof candidate.coordinator !== 'string' ||
		!HEX_64_PATTERN.test(candidate.coordinator) ||
		!Array.isArray(candidate.coordinatorRelays) ||
		candidate.coordinatorRelays.length === 0 ||
		!candidate.coordinatorRelays.every(
			(relay): relay is string => typeof relay === 'string' && RELAY_URL_PATTERN.test(relay),
		) ||
		typeof candidate.clientState !== 'string' ||
		candidate.clientState.length === 0 ||
		typeof candidate.cursor !== 'number' ||
		!Number.isSafeInteger(candidate.cursor) ||
		candidate.cursor < 0
	) {
		throw new Error('Invalid Cordn multi-device group document')
	}

	if (candidate.adminPubkey !== undefined) {
		if (typeof candidate.adminPubkey !== 'string' || !HEX_64_PATTERN.test(candidate.adminPubkey)) {
			throw new Error('Invalid adminPubkey in multi-device group document')
		}
	}

	return {
		schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
		type: 'group',
		issuedAt: candidate.issuedAt,
		prev,
		gid: candidate.gid,
		coordinator: candidate.coordinator,
		coordinatorRelays: [...candidate.coordinatorRelays],
		clientState: candidate.clientState,
		cursor: candidate.cursor,
		...(typeof candidate.workspaceId === 'string' && candidate.workspaceId.length > 0
			? { workspaceId: candidate.workspaceId }
			: {}),
		...(typeof candidate.adminPubkey === 'string' ? { adminPubkey: candidate.adminPubkey } : {}),
		...(candidate.metadata && typeof candidate.metadata === 'object'
			? { metadata: candidate.metadata as WorkspaceMetadata }
			: {}),
		...(Array.isArray(candidate.envelopes)
			? { envelopes: candidate.envelopes as PrivateWorkspaceEnvelope[] }
			: {}),
		...(candidate.epochMediaKeys && typeof candidate.epochMediaKeys === 'object'
			? { epochMediaKeys: { ...(candidate.epochMediaKeys as Record<string, string>) } }
			: {}),
		...(candidate.envelopeEpochs && typeof candidate.envelopeEpochs === 'object'
			? { envelopeEpochs: { ...(candidate.envelopeEpochs as Record<string, number>) } }
			: {}),
		...(typeof candidate.autoApproveJoins === 'boolean'
			? { autoApproveJoins: candidate.autoApproveJoins }
			: {}),
	}
}

function validateMetaDocument(candidate: Record<string, unknown>): MultiDeviceMetaDocument {
	if (
		candidate.schemaVersion !== MULTI_DEVICE_SCHEMA_VERSION ||
		candidate.type !== 'meta' ||
		typeof candidate.issuedAt !== 'number' ||
		!Number.isSafeInteger(candidate.issuedAt) ||
		candidate.issuedAt < 0 ||
		!Array.isArray(candidate.removed) ||
		!candidate.removed.every(
			(item): item is MultiDeviceRemovedGroup =>
				Boolean(item) &&
				typeof item === 'object' &&
				typeof (item as MultiDeviceRemovedGroup).gid === 'string' &&
				(item as MultiDeviceRemovedGroup).gid.length > 0 &&
				typeof (item as MultiDeviceRemovedGroup).removedAt === 'number' &&
				Number.isSafeInteger((item as MultiDeviceRemovedGroup).removedAt) &&
				(item as MultiDeviceRemovedGroup).removedAt >= 0,
		)
	) {
		throw new Error('Invalid Cordn multi-device meta document')
	}

	let lastResortKeyPackage: MultiDeviceLastResortKeyPackage | undefined
	if (candidate.lastResortKeyPackage !== undefined) {
		const lr = candidate.lastResortKeyPackage as Record<string, unknown>
		if (
			!lr ||
			typeof lr !== 'object' ||
			typeof lr.kpRef !== 'string' ||
			typeof lr.kp64 !== 'string' ||
			typeof lr.createdAt !== 'number' ||
			!Number.isSafeInteger(lr.createdAt)
		) {
			throw new Error('Invalid lastResortKeyPackage in multi-device meta document')
		}
		lastResortKeyPackage = {
			kpRef: lr.kpRef,
			kp64: lr.kp64,
			...(typeof lr.privateKp64 === 'string' ? { privateKp64: lr.privateKp64 } : {}),
			createdAt: lr.createdAt,
		}
	}

	return {
		schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
		type: 'meta',
		issuedAt: candidate.issuedAt,
		removed: candidate.removed.map((item) => ({ gid: item.gid, removedAt: item.removedAt })),
		...(lastResortKeyPackage ? { lastResortKeyPackage } : {}),
	}
}

export function encodeMultiDeviceDocument(doc: MultiDeviceDocument): string {
	const validated =
		doc.type === 'group'
			? validateGroupDocument(doc as unknown as Record<string, unknown>)
			: validateMetaDocument(doc as unknown as Record<string, unknown>)
	return JSON.stringify(validated)
}

export function decodeMultiDeviceDocument(json: string): MultiDeviceDocument {
	let parsed: unknown
	try {
		parsed = JSON.parse(json) as unknown
	} catch {
		throw new Error('Invalid multi-device document JSON')
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Invalid multi-device document')
	}
	const candidate = parsed as Record<string, unknown>
	if (candidate.type === 'group') return validateGroupDocument(candidate)
	if (candidate.type === 'meta') return validateMetaDocument(candidate)
	throw new Error(`Unsupported multi-device document type: ${String(candidate.type)}`)
}

/**
 * Seal a Group or Meta document with NIP-44 v2 using the per-identity 32-byte DEK.
 */
export function sealMultiDeviceDocument(
	doc: MultiDeviceDocument,
	dek: Uint8Array,
	nonce?: Uint8Array,
): string {
	assertValidDek(dek)
	const plaintext = encodeMultiDeviceDocument(doc)
	return nip44.v2.encrypt(plaintext, dek, nonce)
}

export function sealMultiDeviceDocumentBytes(
	doc: MultiDeviceDocument,
	dek: Uint8Array,
	nonce?: Uint8Array,
): { bytes: Uint8Array; sha256Hex: string } {
	const payload = sealMultiDeviceDocument(doc, dek, nonce)
	const bytes = utf8Encoder.encode(payload)
	return { bytes, sha256Hex: bytesToHex(sha256(bytes)) }
}

/**
 * Unseal and validate a NIP-44 v2 sealed multi-device document.
 */
export function unsealMultiDeviceDocument(
	sealed: string | Uint8Array,
	dek: Uint8Array,
): MultiDeviceDocument {
	assertValidDek(dek)
	const encoded = typeof sealed === 'string' ? sealed : utf8Decoder.decode(sealed)
	const plaintext = nip44.v2.decrypt(encoded, dek)
	return decodeMultiDeviceDocument(plaintext)
}

function validateBlobRef(value: unknown): MultiDeviceBlobRef {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid blob reference in multi-device tip pointer')
	}
	const ref = value as Record<string, unknown>
	const issuedAt = ref.issuedAt === undefined ? 0 : ref.issuedAt
	if (
		typeof ref.x !== 'string' ||
		!HEX_64_PATTERN.test(ref.x) ||
		typeof issuedAt !== 'number' ||
		!Number.isSafeInteger(issuedAt) ||
		issuedAt < 0
	) {
		throw new Error('Invalid blob reference in multi-device tip pointer')
	}

	let urls: string[]
	if (ref.urls !== undefined) {
		if (
			!Array.isArray(ref.urls) ||
			!ref.urls.every((item): item is string => typeof item === 'string' && item.length > 0)
		) {
			throw new Error('Invalid urls in multi-device blob reference')
		}
		urls = [...ref.urls]
	} else if (typeof ref.url === 'string' && ref.url.length > 0) {
		urls = [ref.url]
	} else {
		urls = []
	}

	return {
		x: ref.x,
		urls,
		issuedAt,
	}
}

function validateTipPointer(value: unknown): MultiDeviceTipPointer {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Invalid multi-device tip pointer')
	}
	const candidate = value as Record<string, unknown>
	if (
		candidate.schemaVersion !== MULTI_DEVICE_SCHEMA_VERSION ||
		typeof candidate.dekHex !== 'string' ||
		!HEX_64_PATTERN.test(candidate.dekHex) ||
		!Array.isArray(candidate.blossomServers) ||
		!candidate.blossomServers.every((s): s is string => typeof s === 'string' && s.length > 0) ||
		!candidate.groups ||
		typeof candidate.groups !== 'object' ||
		Array.isArray(candidate.groups)
	) {
		throw new Error('Invalid multi-device tip pointer')
	}
	if (
		candidate.updatedAt !== undefined &&
		(typeof candidate.updatedAt !== 'number' ||
			!Number.isSafeInteger(candidate.updatedAt) ||
			candidate.updatedAt < 0)
	) {
		throw new Error('Invalid updatedAt in multi-device tip pointer')
	}
	const groups: Record<string, MultiDeviceBlobRef> = {}
	for (const [gid, ref] of Object.entries(candidate.groups as Record<string, unknown>)) {
		if (!gid) throw new Error('Invalid empty gid in multi-device tip pointer')
		groups[gid] = validateBlobRef(ref)
	}
	return {
		schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
		dekHex: candidate.dekHex,
		blossomServers: [...candidate.blossomServers],
		groups,
		...(candidate.meta !== undefined && candidate.meta !== null
			? { meta: validateBlobRef(candidate.meta) }
			: {}),
		...(candidate.updatedAt !== undefined ? { updatedAt: candidate.updatedAt } : {}),
	}
}

/**
 * Create a NIP-78 (`kind 30078`, `d: "cordn-md-tip-v1"`) opaque tip pointer event
 * whose content is NIP-44 v2 self-encrypted to the owner's pubkey.
 */
export async function createMultiDeviceTipEvent(
	signer: MultiDeviceNip44Signer,
	pointer: MultiDeviceTipPointer,
	createdAt = Math.floor(Date.now() / 1000),
): Promise<NostrEvent> {
	const validated = validateTipPointer({
		...pointer,
		updatedAt: pointer.updatedAt ?? createdAt,
	})
	const ownerPubkey = await signer.getPublicKey()
	const content = await signer.nip44Encrypt(ownerPubkey, JSON.stringify(validated))
	return signer.signEvent({
		kind: MULTI_DEVICE_TIP_KIND,
		created_at: createdAt,
		tags: [['d', MULTI_DEVICE_TIP_D_TAG]],
		content,
	})
}

/**
 * Verify and self-decrypt a NIP-78 (`kind 30078`, `d: "cordn-md-tip-v1"`) tip pointer event.
 */
export async function openMultiDeviceTipEvent(
	signer: MultiDeviceNip44Signer,
	event: NostrEvent,
): Promise<MultiDeviceTipPointer> {
	if (!verifyEvent(event)) {
		throw new Error('Invalid multi-device tip event signature')
	}
	const ownerPubkey = await signer.getPublicKey()
	if (event.pubkey !== ownerPubkey) {
		throw new Error('Multi-device tip event does not belong to the active account')
	}
	if (event.kind !== MULTI_DEVICE_TIP_KIND) {
		throw new Error(`Expected kind ${MULTI_DEVICE_TIP_KIND} for multi-device tip event`)
	}
	const dTag = event.tags.find((tag) => tag[0] === 'd')?.[1]
	if (dTag !== MULTI_DEVICE_TIP_D_TAG) {
		throw new Error(`Expected d tag "${MULTI_DEVICE_TIP_D_TAG}" on multi-device tip event`)
	}
	const decrypted = await signer.nip44Decrypt(ownerPubkey, event.content)
	return validateTipPointer(JSON.parse(decrypted) as unknown)
}

export function multiDeviceDekFromPointer(pointer: MultiDeviceTipPointer): Uint8Array {
	const validated = validateTipPointer(pointer)
	return hexToBytes(validated.dekHex)
}

export function exportWorkspaceToGroupDocument(
	workspace: StoredWorkspace,
	options: { prev?: string | null; issuedAt?: number } = {},
): MultiDeviceGroupDocument {
	return {
		schemaVersion: MULTI_DEVICE_SCHEMA_VERSION,
		type: 'group',
		issuedAt: options.issuedAt ?? Math.floor(Date.now() / 1000),
		prev: options.prev ?? null,
		gid: workspace.groupId,
		coordinator: workspace.coordinatorPubkey,
		coordinatorRelays: [...workspace.relays],
		clientState: workspace.stateBase64,
		cursor: workspace.cursor,
		workspaceId: workspace.workspaceId,
		adminPubkey: workspace.adminPubkey,
		...(workspace.metadata ? { metadata: { ...workspace.metadata } } : {}),
		envelopes: [...workspace.envelopes],
		...(workspace.epochMediaKeys ? { epochMediaKeys: { ...workspace.epochMediaKeys } } : {}),
		...(workspace.envelopeEpochs ? { envelopeEpochs: { ...workspace.envelopeEpochs } } : {}),
		...(workspace.autoApproveJoins !== undefined
			? { autoApproveJoins: workspace.autoApproveJoins }
			: {}),
	}
}

export type MultiDeviceReconcileAction = 'adopted' | 'updated' | 'merged-envelopes' | 'kept-local'

export interface MultiDeviceReconcileResult {
	action: MultiDeviceReconcileAction
	workspace: StoredWorkspace
}

function mergeEnvelopes(
	local: readonly PrivateWorkspaceEnvelope[],
	remote: readonly PrivateWorkspaceEnvelope[],
): { merged: PrivateWorkspaceEnvelope[]; addedCount: number } {
	const known = new Set(local.map((env) => env.id))
	const merged = [...local]
	let addedCount = 0
	for (const env of remote) {
		if (known.has(env.id)) continue
		known.add(env.id)
		merged.push(env)
		addedCount += 1
	}
	return { merged, addedCount }
}

function mergeStringRecord(
	local?: Record<string, string>,
	remote?: Record<string, string>,
): { merged?: Record<string, string>; changed: boolean } {
	if (!remote) return { merged: local, changed: false }
	const next: Record<string, string> = { ...(local ?? {}) }
	let changed = false
	for (const [key, value] of Object.entries(remote)) {
		if (next[key] === undefined) {
			next[key] = value
			changed = true
		}
	}
	return { merged: Object.keys(next).length > 0 ? next : undefined, changed }
}

function mergeNumberRecord(
	local?: Record<string, number>,
	remote?: Record<string, number>,
): { merged?: Record<string, number>; changed: boolean } {
	if (!remote) return { merged: local, changed: false }
	const next: Record<string, number> = { ...(local ?? {}) }
	let changed = false
	for (const [key, value] of Object.entries(remote)) {
		if (next[key] === undefined) {
			next[key] = value
			changed = true
		}
	}
	return { merged: Object.keys(next).length > 0 ? next : undefined, changed }
}

/**
 * Reconcile a remote Cordn Multi-Device Group Document into the local workspace store.
 *
 * - Adopts workspaces not yet present on this device.
 * - Advances local MLS state and cursor when the remote document is strictly ahead.
 * - Always merges unseen envelopes, epoch media keys, and envelope epoch metadata
 *   without regressing a newer local MLS ratchet state.
 */
export async function reconcileRemoteGroupDocument(
	store: PrivateWorkspaceStore,
	ownerPubkey: string,
	doc: MultiDeviceGroupDocument,
	options: { now?: number } = {},
): Promise<MultiDeviceReconcileResult> {
	if (!HEX_64_PATTERN.test(ownerPubkey)) {
		throw new Error('Invalid owner pubkey for multi-device reconciliation')
	}
	const validated = validateGroupDocument(doc as unknown as Record<string, unknown>)
	const existingList = await store.listWorkspaces(ownerPubkey)
	const local = existingList.find(
		(ws) =>
			ws.groupId === validated.gid ||
			(validated.workspaceId !== undefined && ws.workspaceId === validated.workspaceId),
	)

	if (!local) {
		const envelopes = validated.envelopes ? [...validated.envelopes] : []
		const adminPubkey = validated.adminPubkey ?? ownerPubkey
		const policy = reduceAdministratorPolicy(adminPubkey, envelopes)
		const adopted: StoredWorkspace = {
			workspaceId: validated.workspaceId ?? validated.gid,
			groupId: validated.gid,
			ownerPubkey,
			adminPubkey,
			coordinatorPubkey: validated.coordinator,
			relays: [...validated.coordinatorRelays],
			role: policy.administrators.includes(ownerPubkey) ? 'administrator' : 'member',
			status: 'active',
			stateBase64: validated.clientState,
			cursor: validated.cursor,
			...(validated.metadata ? { metadata: { ...validated.metadata } } : {}),
			envelopes,
			...(validated.epochMediaKeys ? { epochMediaKeys: { ...validated.epochMediaKeys } } : {}),
			...(validated.envelopeEpochs ? { envelopeEpochs: { ...validated.envelopeEpochs } } : {}),
			...(validated.autoApproveJoins !== undefined
				? { autoApproveJoins: validated.autoApproveJoins }
				: {}),
			consecutiveDecryptErrors: 0,
			syncHealth: 'healthy',
			createdAt: options.now ?? validated.issuedAt * 1000,
		}
		await store.putWorkspace(adopted)
		return { action: 'adopted', workspace: adopted }
	}

	const { merged: mergedEnvelopes, addedCount } = mergeEnvelopes(
		local.envelopes,
		validated.envelopes ?? [],
	)
	const { merged: mergedMediaKeys, changed: mediaKeysChanged } = mergeStringRecord(
		local.epochMediaKeys,
		validated.epochMediaKeys,
	)
	const { merged: mergedEnvelopeEpochs, changed: envelopeEpochsChanged } = mergeNumberRecord(
		local.envelopeEpochs,
		validated.envelopeEpochs,
	)

	const remoteAhead = validated.cursor > local.cursor
	const shouldAdoptMetadata = !local.metadata && Boolean(validated.metadata)
	const shouldAdoptAutoApprove =
		local.autoApproveJoins === undefined && validated.autoApproveJoins !== undefined

	if (
		!remoteAhead &&
		addedCount === 0 &&
		!mediaKeysChanged &&
		!envelopeEpochsChanged &&
		!shouldAdoptMetadata &&
		!shouldAdoptAutoApprove
	) {
		return { action: 'kept-local', workspace: local }
	}

	const policy = reduceAdministratorPolicy(local.adminPubkey, mergedEnvelopes)
	const updated: StoredWorkspace = {
		...local,
		role: policy.administrators.includes(ownerPubkey) ? 'administrator' : 'member',
		envelopes: mergedEnvelopes,
		epochMediaKeys: mergedMediaKeys,
		envelopeEpochs: mergedEnvelopeEpochs,
		...(remoteAhead
			? {
					stateBase64: validated.clientState,
					cursor: validated.cursor,
					coordinatorPubkey: validated.coordinator,
					relays: [...validated.coordinatorRelays],
					consecutiveDecryptErrors: 0,
					syncHealth: local.status === 'removed' ? 'removed' : 'healthy',
				}
			: {}),
		...(remoteAhead && validated.metadata
			? { metadata: { ...validated.metadata } }
			: shouldAdoptMetadata && validated.metadata
				? { metadata: { ...validated.metadata } }
				: {}),
		...(remoteAhead && validated.autoApproveJoins !== undefined
			? { autoApproveJoins: validated.autoApproveJoins }
			: shouldAdoptAutoApprove
				? { autoApproveJoins: validated.autoApproveJoins }
				: {}),
	}
	await store.putWorkspace(updated)
	return {
		action: remoteAhead ? 'updated' : 'merged-envelopes',
		workspace: updated,
	}
}

/**
 * Apply a remote Multi-Device Meta Document by removing workspaces tombstoned
 * after their local creation timestamp.
 */
export async function reconcileRemoteMetaDocument(
	store: PrivateWorkspaceStore,
	ownerPubkey: string,
	meta: MultiDeviceMetaDocument,
): Promise<string[]> {
	const validated = validateMetaDocument(meta as unknown as Record<string, unknown>)
	const existing = await store.listWorkspaces(ownerPubkey)
	const removedWorkspaceIds: string[] = []
	for (const tombstone of validated.removed) {
		const target = existing.find((ws) => ws.groupId === tombstone.gid)
		if (!target) continue
		const createdAtSeconds = Math.floor(target.createdAt / 1000)
		if (tombstone.removedAt >= createdAtSeconds) {
			await store.deleteWorkspace(ownerPubkey, target.workspaceId)
			removedWorkspaceIds.push(target.workspaceId)
		}
	}
	return removedWorkspaceIds
}
