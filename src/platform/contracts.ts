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
	remoteNode: remoteNodeRecordSchema,
})

export type RemoteSyncResult = z.infer<typeof remoteSyncResultSchema>

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
}
