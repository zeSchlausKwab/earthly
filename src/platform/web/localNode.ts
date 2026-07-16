import type { LocalNodeService } from '../contracts'

const unsupported = (): never => {
	throw new Error('Offline sharing requires the Earthly native application')
}

export const webLocalNodeService: LocalNodeService = {
	supported: false,
	status: async () => ({
		state: 'unsupported',
		reason: 'The browser cannot host Earthly’s embedded relay and Blossom node.',
	}),
	networkAddresses: async () => unsupported(),
	enableLan: async () => unsupported(),
	disableLan: async () => unsupported(),
	createInvitation: async () => unsupported(),
	pendingClaims: async () => unsupported(),
	approveClaim: async () => unsupported(),
	rejectClaim: async () => unsupported(),
	peerGrants: async () => unsupported(),
	revokePeer: async () => unsupported(),
	joinInvitation: async () => unsupported(),
	remoteNodes: async () => unsupported(),
	refreshRemoteNode: async () => unsupported(),
	forgetRemoteNode: async () => unsupported(),
	syncRemoteNode: async () => unsupported(),
	publishRemoteEvent: async () => unsupported(),
	ingestLocalEvent: async () => unsupported(),
	fieldSessionEvents: async () => unsupported(),
	mirrorRemoteBlobs: async () => unsupported(),
	localBlobAccess: async () => null,
	localBlobUrl: async () => null,
}
