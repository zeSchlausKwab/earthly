import { invoke } from '@tauri-apps/api/core'
import { platform } from '@tauri-apps/plugin-os'
import {
	nativeSchemas,
	type LocalNodeService,
	type LocalNodeStatus,
	type NetworkAddress,
	type PairingInvitation,
	type PendingPairingClaim,
	type PeerGrant,
	type RemoteNodeRecord,
	type RemoteBlobMirrorResult,
	type RemoteSyncResult,
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
	networkAddresses: (): Promise<NetworkAddress[]> =>
		invokeValidated('local_node_network_addresses_v1', nativeSchemas.networkAddresses),
	enableLan: (address, durationSeconds): Promise<LocalNodeStatus> =>
		invokeValidated('local_node_enable_lan_v1', nativeSchemas.status, {
			address,
			durationSeconds,
		}),
	disableLan: (): Promise<LocalNodeStatus> =>
		invokeValidated('local_node_disable_lan_v1', nativeSchemas.status),
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
	joinInvitation: (invitation, peerName): Promise<RemoteNodeRecord> =>
		invokeValidated('local_node_join_invitation_v1', nativeSchemas.remoteNode, {
			invitation,
			peerName,
		}),
	remoteNodes: (): Promise<RemoteNodeRecord[]> =>
		invokeValidated('local_node_remote_nodes_v1', nativeSchemas.remoteNodes),
	refreshRemoteNode: (nodeId): Promise<RemoteNodeRecord> =>
		invokeValidated('local_node_refresh_remote_node_v1', nativeSchemas.remoteNode, { nodeId }),
	forgetRemoteNode: async (nodeId): Promise<boolean> => {
		try {
			return Boolean(await invoke('local_node_forget_remote_node_v1', { nodeId }))
		} catch (error) {
			throw commandError(error)
		}
	},
	syncRemoteNode: (nodeId): Promise<RemoteSyncResult> =>
		invokeValidated('local_node_sync_remote_node_v1', nativeSchemas.remoteSync, { nodeId }),
	mirrorRemoteBlobs: (nodeId, hashes): Promise<RemoteBlobMirrorResult> =>
		invokeValidated('local_node_mirror_remote_blobs_v1', nativeSchemas.remoteBlobMirror, {
			nodeId,
			hashes,
		}),
	localBlobUrl: async (sha256): Promise<string | null> => {
		if (!/^[0-9a-f]{64}$/.test(sha256)) return null
		const os = platform()
		return os === 'windows' || os === 'android'
			? `http://earthly-blob.localhost/${sha256}`
			: `earthly-blob://localhost/${sha256}`
	},
}
