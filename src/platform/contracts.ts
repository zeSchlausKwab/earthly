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
	z.object({ state: z.literal('running'), descriptor: nodeDescriptorSchema }),
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

export interface LocalNodeService {
	readonly supported: boolean
	status(): Promise<LocalNodeStatus>
	createInvitation(): Promise<PairingInvitation>
	pendingClaims(): Promise<PendingPairingClaim[]>
	approveClaim(claimId: string): Promise<PendingPairingClaim>
	rejectClaim(claimId: string, reason: string): Promise<void>
	peerGrants(): Promise<PeerGrant[]>
	revokePeer(peerPubkey: string): Promise<boolean>
}

export const nativeSchemas = {
	status: nativeLocalNodeStatusSchema,
	invitation: pairingInvitationSchema,
	pendingClaims: z.array(pendingPairingClaimSchema),
	pendingClaim: pendingPairingClaimSchema,
	peerGrants: z.array(peerGrantSchema),
}
