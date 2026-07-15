import { invoke } from '@tauri-apps/api/core'
import {
	nativeSchemas,
	type LocalNodeService,
	type PairingInvitation,
	type PendingPairingClaim,
	type PeerGrant,
} from '../contracts'

function commandError(error: unknown): Error {
	if (typeof error === 'object' && error !== null && 'message' in error) {
		return new Error(String(error.message))
	}
	return new Error(String(error))
}

async function invokeValidated<T>(
	command: string,
	schema: { parse(value: unknown): T },
	args?: Record<string, unknown>,
): Promise<T> {
	try {
		return schema.parse(await invoke(command, args))
	} catch (error) {
		throw commandError(error)
	}
}

export const tauriLocalNodeService: LocalNodeService = {
	supported: true,
	status: () => invokeValidated('local_node_status_v1', nativeSchemas.status),
	createInvitation: (): Promise<PairingInvitation> =>
		invokeValidated('local_node_create_invitation_v1', nativeSchemas.invitation),
	pendingClaims: (): Promise<PendingPairingClaim[]> =>
		invokeValidated('local_node_pending_claims_v1', nativeSchemas.pendingClaims),
	approveClaim: (claimId): Promise<PendingPairingClaim> =>
		invokeValidated('local_node_approve_claim_v1', nativeSchemas.pendingClaim, { claimId }),
	rejectClaim: async (claimId, reason): Promise<void> => {
		try {
			await invoke('local_node_reject_claim_v1', { claimId, reason })
		} catch (error) {
			throw commandError(error)
		}
	},
	peerGrants: (): Promise<PeerGrant[]> =>
		invokeValidated('local_node_peer_grants_v1', nativeSchemas.peerGrants),
	revokePeer: async (peerPubkey): Promise<boolean> => {
		try {
			return Boolean(await invoke('local_node_revoke_peer_v1', { peerPubkey }))
		} catch (error) {
			throw commandError(error)
		}
	},
}
