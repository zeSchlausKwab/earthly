import { z } from 'zod'

export const pairingCapabilitySchema = z.enum([
	'relay-read',
	'relay-write',
	'blob-read',
	'blob-list-own',
	'blob-write',
	'blob-delete-own',
	'blob-mirror',
])

export type PairingCapability = z.infer<typeof pairingCapabilitySchema>

export const nodeDescriptorSchema = z.object({
	version: z.literal(1),
	nodeId: z.string().regex(/^[0-9a-f]{64}$/),
	relayUrl: z.string().url(),
	blossomUrl: z.string().url(),
	scope: z.enum(['loopback', 'local-network']),
	availability: z.enum(['process', 'foreground', 'foreground-service']),
})

export type NodeDescriptor = z.infer<typeof nodeDescriptorSchema>

const nativeLocalNodeStatusSchema = z.discriminatedUnion('state', [
	z.object({ state: z.literal('starting') }),
	z.object({
		state: z.literal('running'),
		descriptor: nodeDescriptorSchema,
		lanExpiresAt: z.number().int().positive().nullable().optional(),
	}),
	z.object({ state: z.literal('failed'), message: z.string().min(1) }),
])

export const localNodeStatusSchema = z.union([
	nativeLocalNodeStatusSchema,
	z.object({ state: z.literal('unsupported'), reason: z.string().min(1) }),
])

export type LocalNodeStatus = z.infer<typeof localNodeStatusSchema>

export const localBlobAccessSchema = z.object({
	url: z.string().url(),
	authorization: z.string().startsWith('Nostr '),
	expiresAt: z.number().int().positive(),
})

export type LocalBlobAccess = z.infer<typeof localBlobAccessSchema>

export const pairingInvitationSchema = z.object({
	version: z.literal(1),
	encoded: z.string().startsWith('earthly-pair-v1:'),
	expiresAt: z.number().int().positive(),
	capabilities: z.array(pairingCapabilitySchema).min(1),
	descriptor: nodeDescriptorSchema,
})

export type PairingInvitation = z.infer<typeof pairingInvitationSchema>

export const pendingPairingClaimSchema = z.object({
	claimId: z.string().regex(/^[0-9a-f]{64}$/),
	peerPubkey: z.string().regex(/^[0-9a-f]{64}$/),
	peerName: z.string().min(1).nullable().optional(),
	requestedCapabilities: z.array(pairingCapabilitySchema).min(1),
})

export type PendingPairingClaim = z.infer<typeof pendingPairingClaimSchema>

export const peerGrantSchema = z.object({
	peerPubkey: z.string().regex(/^[0-9a-f]{64}$/),
	capabilities: z.array(pairingCapabilitySchema).min(1),
})

export type PeerGrant = z.infer<typeof peerGrantSchema>

export const networkAddressSchema = z.object({
	address: z.ipv4(),
	interfaceName: z.string().min(1),
})

export type NetworkAddress = z.infer<typeof networkAddressSchema>

export const pairingStatusSchema = z.discriminatedUnion('state', [
	z.object({ state: z.literal('pending') }),
	z.object({ state: z.literal('accepted') }),
	z.object({ state: z.literal('rejected'), reason: z.string().min(1) }),
])

export type PairingStatus = z.infer<typeof pairingStatusSchema>

export const remoteSyncCheckpointSchema = z.object({
	syncedAt: z.number().int().positive(),
	receivedEvents: z.number().int().nonnegative(),
})

export type RemoteSyncCheckpoint = z.infer<typeof remoteSyncCheckpointSchema>

export const remoteNodeRecordSchema = z.object({
	version: z.literal(1),
	nodeId: z.string().regex(/^[0-9a-f]{64}$/),
	descriptor: nodeDescriptorSchema,
	claimId: z.string().regex(/^[0-9a-f]{64}$/),
	peerPubkey: z.string().regex(/^[0-9a-f]{64}$/),
	peerName: z.string().min(1).nullable().optional(),
	capabilities: z.array(pairingCapabilitySchema).min(1),
	status: pairingStatusSchema,
	updatedAt: z.number().int().positive(),
	lastSync: remoteSyncCheckpointSchema.optional(),
	discoveredBlobHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).default([]),
	mirroredBlobHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).default([]),
})

export type RemoteNodeRecord = z.infer<typeof remoteNodeRecordSchema>

export const syncedNostrEventSchema = z.object({
	id: z.string().regex(/^[0-9a-f]{64}$/),
	pubkey: z.string().regex(/^[0-9a-f]{64}$/),
	created_at: z.number().int().nonnegative(),
	kind: z.number().int().nonnegative(),
	tags: z.array(z.array(z.string()).min(1)),
	content: z.string(),
	sig: z.string().regex(/^[0-9a-f]{128}$/),
})

export type SyncedNostrEvent = z.infer<typeof syncedNostrEventSchema>

export const remoteSyncResultSchema = z.object({
	nodeId: z.string().regex(/^[0-9a-f]{64}$/),
	receivedEvents: z.number().int().nonnegative(),
	hydratedEvents: z.number().int().nonnegative(),
	eventsTruncated: z.boolean(),
	events: z.array(syncedNostrEventSchema),
	discoveredBlobHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
	remoteNode: remoteNodeRecordSchema,
})

export type RemoteSyncResult = z.infer<typeof remoteSyncResultSchema>

export const remoteBlobMirrorItemSchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	state: z.enum(['mirrored', 'alreadyPresent']),
})

export const remoteBlobMirrorResultSchema = z.object({
	nodeId: z.string().regex(/^[0-9a-f]{64}$/),
	items: z.array(remoteBlobMirrorItemSchema),
	remoteNode: remoteNodeRecordSchema,
})

export type RemoteBlobMirrorResult = z.infer<typeof remoteBlobMirrorResultSchema>

export const publishRoutingSchema = z.enum(['configured', 'outbox', 'inbox', 'reply'])

export type NativePublishRouting = z.infer<typeof publishRoutingSchema>

export const outboxRelayResultSchema = z.object({
	relayUrl: z.string().url(),
	ok: z.boolean(),
	message: z.string().optional(),
})

export type OutboxRelayResult = z.infer<typeof outboxRelayResultSchema>

export const outboxRelaySchema = z.object({
	relayUrl: z.string().url(),
	required: z.boolean(),
	state: z.enum(['pending', 'acknowledged', 'rejected']),
	attempts: z.number().int().nonnegative(),
	acknowledgedAt: z.number().int().positive().nullable().optional(),
	lastError: z.string().nullable().optional(),
})

export const outboxItemSchema = z.object({
	version: z.literal(1),
	id: z.string().regex(/^[0-9a-f]{64}$/),
	eventJson: z.string().min(1),
	eventId: z.string().regex(/^[0-9a-f]{64}$/),
	eventKind: z.number().int().nonnegative().max(65535),
	routing: publishRoutingSchema,
	targetPubkey: z
		.string()
		.regex(/^[0-9a-f]{64}$/)
		.nullable()
		.optional(),
	state: z.enum([
		'queued',
		'delivering',
		'delivered',
		'partial',
		'retryWait',
		'rejected',
		'discarded',
	]),
	attemptCount: z.number().int().nonnegative(),
	nextAttemptAt: z.number().int().positive().nullable().optional(),
	createdAt: z.number().int().positive(),
	updatedAt: z.number().int().positive(),
	lastError: z.string().nullable().optional(),
	relays: z.array(outboxRelaySchema).min(1),
})

export type OutboxItem = z.infer<typeof outboxItemSchema>

/** Lightweight ledger row for UI/status surfaces. Signed event bytes stay on
 * the native side so a history of large GeoJSON events is never cloned into
 * React merely to render delivery state. */
export const outboxItemSummarySchema = outboxItemSchema.omit({ eventJson: true })

export type OutboxItemSummary = z.infer<typeof outboxItemSummarySchema>

export const savedRegionBlobRoleSchema = z.enum(['basemap', 'overlay', 'style', 'sprite'])
export const savedRegionBlobStateSchema = z.enum(['missing', 'available', 'failed'])
export const savedRegionStatusSchema = z.enum(['planned', 'downloading', 'ready', 'failed'])

export const savedRegionBlobSchema = z.object({
	sha256: z.string().regex(/^[0-9a-f]{64}$/),
	role: savedRegionBlobRoleSchema,
	required: z.boolean(),
	ordinal: z.number().int().nonnegative(),
	expectedSize: z.number().int().positive().nullable(),
	actualSize: z.number().int().nonnegative().nullable(),
	mediaType: z.string().min(1).nullable(),
	state: savedRegionBlobStateSchema,
	mirrorUrls: z.array(z.string().url()).min(1).max(8),
	lastError: z.string().nullable(),
})

export const savedRegionSchema = z.object({
	version: z.literal(1),
	id: z.string().min(1).max(64),
	name: z.string().min(1).max(120),
	bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
	sourcePubkey: z.string().regex(/^[0-9a-f]{64}$/),
	announcementId: z.string().regex(/^[0-9a-f]{64}$/),
	status: savedRegionStatusSchema,
	bytesTotal: z.number().int().nonnegative().nullable(),
	bytesDone: z.number().int().nonnegative(),
	blobsTotal: z.number().int().nonnegative(),
	blobsDone: z.number().int().nonnegative(),
	createdAt: z.number().int().positive(),
	updatedAt: z.number().int().positive(),
	lastError: z.string().nullable(),
	blobs: z.array(savedRegionBlobSchema),
})

export const savedRegionProgressSchema = savedRegionSchema
	.pick({
		status: true,
		bytesTotal: true,
		bytesDone: true,
		blobsTotal: true,
		blobsDone: true,
	})
	.extend({
		regionId: z.string().min(1).max(64),
		currentHash: z
			.string()
			.regex(/^[0-9a-f]{64}$/)
			.nullable(),
		errorCode: z.string().min(1).nullable(),
		message: z.string().nullable(),
	})

export type SavedRegion = z.infer<typeof savedRegionSchema>
export type SavedRegionProgress = z.infer<typeof savedRegionProgressSchema>
export type SavedRegionBlobRole = z.infer<typeof savedRegionBlobRoleSchema>

export interface SavedRegionBlobInput {
	sha256: string
	role: SavedRegionBlobRole
	required: boolean
	ordinal: number
	expectedSize?: number
	mirrorUrls: string[]
}

export interface SavedRegionCreateRequest {
	version: 1
	id: string
	name: string
	bbox: [number, number, number, number]
	sourcePubkey: string
	announcementId: string
	blobs: SavedRegionBlobInput[]
}

export interface SavedRegionService {
	readonly supported: boolean
	create(input: SavedRegionCreateRequest): Promise<SavedRegion>
	list(): Promise<SavedRegion[]>
	download(id: string): Promise<SavedRegion>
	cancel(id: string): Promise<boolean>
	remove(id: string): Promise<boolean>
	listenProgress(listener: (progress: SavedRegionProgress) => void): Promise<() => void>
}

export interface OutboxEnqueueRequest {
	version: 1
	eventJson: string
	routing: NativePublishRouting
	targetPubkey?: string
	relayUrls: string[]
	requiredRelayUrls: string[]
}

export interface PublishOutboxService {
	enqueue(input: OutboxEnqueueRequest): Promise<OutboxItem>
	list(): Promise<OutboxItem[]>
	listSummaries(): Promise<OutboxItemSummary[]>
	flush(): Promise<OutboxItem[]>
	recordResults(id: string, results: OutboxRelayResult[]): Promise<OutboxItem>
	retry(id: string): Promise<OutboxItem>
	discard(id: string): Promise<OutboxItem>
}

export interface LocalNodeService {
	readonly supported: boolean
	status(): Promise<LocalNodeStatus>
	networkAddresses(): Promise<NetworkAddress[]>
	enableLan(address: string, durationSeconds: number): Promise<LocalNodeStatus>
	disableLan(): Promise<LocalNodeStatus>
	createInvitation(): Promise<PairingInvitation>
	pendingClaims(): Promise<PendingPairingClaim[]>
	approveClaim(claimId: string): Promise<PendingPairingClaim>
	rejectClaim(claimId: string, reason: string): Promise<void>
	peerGrants(): Promise<PeerGrant[]>
	revokePeer(peerPubkey: string): Promise<boolean>
	joinInvitation(invitation: string, peerName?: string): Promise<RemoteNodeRecord>
	remoteNodes(): Promise<RemoteNodeRecord[]>
	refreshRemoteNode(nodeId: string): Promise<RemoteNodeRecord>
	forgetRemoteNode(nodeId: string): Promise<boolean>
	syncRemoteNode(nodeId: string): Promise<RemoteSyncResult>
	mirrorRemoteBlobs(nodeId: string, hashes: string[]): Promise<RemoteBlobMirrorResult>
	localBlobAccess(sha256: string): Promise<LocalBlobAccess | null>
	localBlobUrl(sha256: string): Promise<string | null>
}

export const nativeSchemas = {
	status: nativeLocalNodeStatusSchema,
	invitation: pairingInvitationSchema,
	pendingClaims: z.array(pendingPairingClaimSchema),
	pendingClaim: pendingPairingClaimSchema,
	peerGrants: z.array(peerGrantSchema),
	networkAddresses: z.array(networkAddressSchema),
	remoteNode: remoteNodeRecordSchema,
	remoteNodes: z.array(remoteNodeRecordSchema),
	remoteSync: remoteSyncResultSchema,
	remoteBlobMirror: remoteBlobMirrorResultSchema,
	localBlobAccess: localBlobAccessSchema,
	outboxItem: outboxItemSchema,
	outboxItems: z.array(outboxItemSchema),
	outboxItemSummaries: z.array(outboxItemSummarySchema),
	savedRegion: savedRegionSchema,
	savedRegions: z.array(savedRegionSchema),
	savedRegionProgress: savedRegionProgressSchema,
}
