import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { concatBytes, randomBytes } from '@noble/ciphers/utils.js'
import {
	clientStateDecoder,
	clientStateEncoder,
	createApplicationMessage,
	createCommit,
	createGroup,
	decode,
	defaultCredentialTypes,
	defaultProposalTypes,
	encode,
	generateKeyPackage,
	getCiphersuiteImpl,
	getGroupMembers,
	getOwnLeafNode,
	isDefaultCredential,
	joinGroup,
	keyPackageDecoder,
	keyPackageEncoder,
	makeKeyPackageRef,
	mlsExporter,
	mlsMessageDecoder,
	mlsMessageEncoder,
	nobleCryptoProvider,
	nodeTypes,
	privateKeyPackageDecoder,
	privateKeyPackageEncoder,
	processMessage,
	type AuthenticationService,
	type ClientState,
	type Credential,
	type IncomingMessageCallback,
	type KeyPackage,
	type PrivateKeyPackage,
	type Welcome,
} from 'ts-mls'
import { base64ToBytes, bytesToBase64, bytesToHex } from './codec'
import {
	assertPrivateEnvelopeAuthorization,
	decodePrivateEnvelope,
	encodePrivateEnvelope,
	type PrivateWorkspaceEnvelope,
} from './envelope'
import {
	createCordnLastResortKeyPackageOptions,
	isCordnLastResortKeyPackage,
} from './last-resort-key-package'

const CIPHERSUITE = 'MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519'
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
let ciphersuitePromise: ReturnType<typeof getCiphersuiteImpl> | undefined

export const nostrCredentialAuthentication: AuthenticationService = {
	async validateCredential(credential) {
		if (
			!isDefaultCredential(credential) ||
			credential.credentialType !== defaultCredentialTypes.basic
		) {
			return false
		}

		return /^[0-9a-f]{64}$/u.test(decoder.decode(credential.identity))
	},
}

export interface MlsKeyPackageArtifacts {
	keyPackage: KeyPackage
	privateKeyPackage: PrivateKeyPackage
	keyPackageRef: string
	keyPackageBase64: string
	privateKeyPackageBase64: string
	lastResort: boolean
}

function getCiphersuite() {
	ciphersuitePromise ??= getCiphersuiteImpl(CIPHERSUITE, nobleCryptoProvider)
	return ciphersuitePromise
}

function getContext(cipherSuite: Awaited<ReturnType<typeof getCiphersuite>>) {
	return { cipherSuite, authService: nostrCredentialAuthentication }
}

export function createNostrCredential(pubkey: string): Credential {
	if (!/^[0-9a-f]{64}$/u.test(pubkey))
		throw new Error('MLS identity must be a lowercase Nostr pubkey')
	return { credentialType: defaultCredentialTypes.basic, identity: encoder.encode(pubkey) }
}

export async function generateMlsKeyPackage(
	pubkey: string,
	options: { lastResort?: boolean } = {},
): Promise<MlsKeyPackageArtifacts> {
	const cipherSuite = await getCiphersuite()
	const lastResortOptions = options.lastResort
		? createCordnLastResortKeyPackageOptions()
		: undefined
	const generated = await generateKeyPackage({
		credential: createNostrCredential(pubkey),
		cipherSuite,
		...(lastResortOptions ?? {}),
	})
	const keyPackageRef = bytesToHex(
		await makeKeyPackageRef(generated.publicPackage, cipherSuite.hash),
	)

	return {
		keyPackage: generated.publicPackage,
		privateKeyPackage: generated.privatePackage,
		keyPackageRef,
		keyPackageBase64: bytesToBase64(encode(keyPackageEncoder, generated.publicPackage)),
		privateKeyPackageBase64: bytesToBase64(
			encode(privateKeyPackageEncoder, generated.privatePackage),
		),
		lastResort: isCordnLastResortKeyPackage(generated.publicPackage),
	}
}

export function decodeKeyPackage(value: string): KeyPackage {
	const decoded = decode(keyPackageDecoder, base64ToBytes(value))
	if (!decoded) throw new Error('Invalid MLS KeyPackage')
	return decoded
}

export function credentialPubkeyFromKeyPackage(keyPackage: KeyPackage): string {
	return credentialPubkey(keyPackage.leafNode.credential, 'MLS KeyPackage')
}

function credentialPubkey(credential: Credential, source: string): string {
	if (
		!isDefaultCredential(credential) ||
		credential.credentialType !== defaultCredentialTypes.basic
	) {
		throw new Error(`Only BasicCredential ${source} identities are supported`)
	}
	const pubkey = decoder.decode(credential.identity)
	if (!/^[0-9a-f]{64}$/u.test(pubkey)) throw new Error(`Invalid Nostr identity in ${source}`)
	return pubkey
}

export function ownPubkeyFromState(state: ClientState): string {
	return credentialPubkey(getOwnLeafNode(state).credential, 'MLS state')
}

export function decodePrivateKeyPackage(value: string): PrivateKeyPackage {
	const decoded = decode(privateKeyPackageDecoder, base64ToBytes(value))
	if (!decoded) throw new Error('Invalid private MLS KeyPackage')
	return decoded
}

export function serializeClientState(state: ClientState): string {
	return bytesToBase64(encode(clientStateEncoder, state))
}

export function deserializeClientState(value: string): ClientState {
	const decoded = decode(clientStateDecoder, base64ToBytes(value), 16 * 1024 * 1024)
	if (!decoded) throw new Error('Invalid MLS client state')
	return decoded
}

export function groupIdFromState(state: ClientState): string {
	return decoder.decode(state.groupContext.groupId)
}

export function memberPubkeysFromState(state: ClientState): string[] {
	return getGroupMembers(state)
		.map((member) => member.credential)
		.filter(
			(credential): credential is Extract<Credential, { identity: Uint8Array }> =>
				isDefaultCredential(credential) &&
				credential.credentialType === defaultCredentialTypes.basic,
		)
		.map((credential) => decoder.decode(credential.identity))
}

function memberPubkeyAtLeafIndex(state: ClientState, leafIndex: number): string | undefined {
	const node = state.ratchetTree[leafIndex * 2]
	if (!node || node.nodeType !== nodeTypes.leaf) return undefined
	try {
		return credentialPubkey(node.leaf.credential, 'MLS state')
	} catch {
		return undefined
	}
}

function proposalRequiresAdministrator(proposalType: number): boolean {
	return proposalType !== defaultProposalTypes.update
}

export function createWorkspaceAuthorizationCallback(input: {
	state: ClientState
	administratorPubkeys: readonly string[]
}): IncomingMessageCallback {
	const administrators = new Set(input.administratorPubkeys)
	return (incoming) => {
		const proposals = incoming.kind === 'commit' ? incoming.proposals : [incoming.proposal]
		if (!proposals.some(({ proposal }) => proposalRequiresAdministrator(proposal.proposalType))) {
			return 'accept'
		}

		const senderLeafIndex =
			incoming.kind === 'commit' ? incoming.senderLeafIndex : incoming.proposal.senderLeafIndex
		const senderPubkey =
			senderLeafIndex === undefined
				? undefined
				: memberPubkeyAtLeafIndex(input.state, Number(senderLeafIndex))
		if (!senderPubkey || !administrators.has(senderPubkey)) return 'reject'

		for (const { proposal } of proposals) {
			if (proposal.proposalType !== defaultProposalTypes.remove || !('remove' in proposal)) {
				continue
			}
			const removedPubkey = memberPubkeyAtLeafIndex(input.state, proposal.remove.removed)
			if (removedPubkey && administrators.has(removedPubkey)) return 'reject'
		}

		return 'accept'
	}
}

export async function createWorkspaceGroup(input: {
	groupId: string
	keyPackage: KeyPackage
	privateKeyPackage: PrivateKeyPackage
}): Promise<ClientState> {
	const cipherSuite = await getCiphersuite()
	return createGroup({
		context: getContext(cipherSuite),
		groupId: encoder.encode(input.groupId),
		keyPackage: input.keyPackage,
		privateKeyPackage: input.privateKeyPackage,
	})
}

export async function addWorkspaceMember(input: { state: ClientState; keyPackage: KeyPackage }) {
	const cipherSuite = await getCiphersuite()
	const result = await createCommit({
		context: getContext(cipherSuite),
		state: input.state,
		ratchetTreeExtension: true,
		extraProposals: [
			{
				proposalType: defaultProposalTypes.add,
				add: { keyPackage: input.keyPackage },
			},
		],
	})
	if (!result.welcome) throw new Error('MLS add commit did not produce a Welcome')

	return {
		newState: result.newState,
		commitBase64: bytesToBase64(encode(mlsMessageEncoder, result.commit)),
		welcomeBase64: bytesToBase64(encode(mlsMessageEncoder, result.welcome)),
	}
}

export async function removeWorkspaceMember(input: { state: ClientState; pubkey: string }) {
	let leafIndex = -1
	for (let nodeIndex = 0; nodeIndex < input.state.ratchetTree.length; nodeIndex += 2) {
		const node = input.state.ratchetTree[nodeIndex]
		if (!node || node.nodeType !== nodeTypes.leaf) continue
		const credential = node.leaf.credential
		if (
			isDefaultCredential(credential) &&
			credential.credentialType === defaultCredentialTypes.basic &&
			decoder.decode(credential.identity) === input.pubkey
		) {
			leafIndex = nodeIndex / 2
			break
		}
	}
	if (leafIndex < 0) throw new Error('The requested member is not in this private map')

	const cipherSuite = await getCiphersuite()
	const result = await createCommit({
		context: getContext(cipherSuite),
		state: input.state,
		ratchetTreeExtension: true,
		extraProposals: [
			{
				proposalType: defaultProposalTypes.remove,
				remove: { removed: leafIndex },
			},
		],
	})
	return {
		newState: result.newState,
		commitBase64: bytesToBase64(encode(mlsMessageEncoder, result.commit)),
	}
}

export async function joinWorkspaceGroup(input: {
	welcomeBase64: string
	keyPackage: KeyPackage
	privateKeyPackage: PrivateKeyPackage
}): Promise<ClientState> {
	const decoded = decode(mlsMessageDecoder, base64ToBytes(input.welcomeBase64))
	if (decoded?.wireformat !== 3) throw new Error('Invalid MLS Welcome')
	const cipherSuite = await getCiphersuite()
	return joinGroup({
		context: getContext(cipherSuite),
		welcome: decoded.welcome as Welcome,
		keyPackage: input.keyPackage,
		privateKeys: input.privateKeyPackage,
	})
}

async function createApplicationEnvelopeMessage(input: {
	state: ClientState
	envelope: PrivateWorkspaceEnvelope
	allowForwardedAuthor: boolean
}) {
	const groupId = groupIdFromState(input.state)
	assertPrivateEnvelopeAuthorization(input.envelope, groupId)
	if (!input.allowForwardedAuthor && ownPubkeyFromState(input.state) !== input.envelope.pubkey) {
		throw new Error('Private envelope author does not match the local MLS credential')
	}
	const cipherSuite = await getCiphersuite()
	const result = await createApplicationMessage({
		context: getContext(cipherSuite),
		state: input.state,
		message: encodePrivateEnvelope(input.envelope),
		authenticatedData: encoder.encode(input.envelope.authorization.event.id),
	})
	return {
		newState: result.newState,
		messageBase64: bytesToBase64(encode(mlsMessageEncoder, result.message)),
	}
}

export function createWorkspaceApplicationMessage(input: {
	state: ClientState
	envelope: PrivateWorkspaceEnvelope
}) {
	return createApplicationEnvelopeMessage({ ...input, allowForwardedAuthor: false })
}

/**
 * Re-encrypt an already authenticated envelope into the current epoch. This is
 * only for replaying accepted policy history to newly joined members; normal
 * authoring must use createWorkspaceApplicationMessage.
 */
export function createForwardedWorkspaceApplicationMessage(input: {
	state: ClientState
	envelope: PrivateWorkspaceEnvelope
}) {
	return createApplicationEnvelopeMessage({ ...input, allowForwardedAuthor: true })
}

export async function processWorkspaceMessage(input: {
	state: ClientState
	messageBase64: string
	administratorPubkeys: readonly string[]
}) {
	const message = decode(mlsMessageDecoder, base64ToBytes(input.messageBase64))
	if (!message || (message.wireformat !== 1 && message.wireformat !== 2)) {
		throw new Error('Expected an MLS framed message')
	}
	const cipherSuite = await getCiphersuite()
	const result = await processMessage({
		context: getContext(cipherSuite),
		state: input.state,
		message,
		callback: createWorkspaceAuthorizationCallback({
			state: input.state,
			administratorPubkeys: input.administratorPubkeys,
		}),
	})

	if (result.kind === 'applicationMessage') {
		const authorizationId = decoder.decode(result.aad)
		const envelope = decodePrivateEnvelope(result.message, groupIdFromState(input.state))
		if (authorizationId !== envelope.authorization.event.id) {
			throw new Error('MLS authenticated data does not match the envelope authorization')
		}
		return { kind: 'applicationMessage' as const, newState: result.newState, envelope }
	}
	if (result.actionTaken === 'reject') {
		return { kind: 'rejected' as const, newState: result.newState }
	}

	return { kind: 'newState' as const, newState: result.newState }
}

async function deriveOuterKey(state: ClientState): Promise<Uint8Array> {
	const cipherSuite = await getCiphersuite()
	return mlsExporter(
		state.keySchedule.exporterSecret,
		'cordn',
		encoder.encode('group-payload'),
		32,
		cipherSuite,
	)
}

export async function sealCoordinatorPayload(state: ClientState, messageBase64: string) {
	const nonce = randomBytes(12)
	const key = await deriveOuterKey(state)
	const ciphertext = chacha20poly1305(key, nonce, new Uint8Array()).encrypt(
		base64ToBytes(messageBase64),
	)
	return bytesToBase64(concatBytes(nonce, ciphertext))
}

export async function openCoordinatorPayload(state: ClientState, encryptedBase64: string) {
	const payload = base64ToBytes(encryptedBase64)
	if (payload.length < 29) throw new Error('Invalid coordinator payload')
	const key = await deriveOuterKey(state)
	const plaintext = chacha20poly1305(key, payload.subarray(0, 12), new Uint8Array()).decrypt(
		payload.subarray(12),
	)
	return bytesToBase64(plaintext)
}
