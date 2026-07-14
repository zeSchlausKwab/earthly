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
	type KeyPackage,
	type PrivateKeyPackage,
	type Welcome,
} from 'ts-mls'
import { base64ToBytes, bytesToBase64, bytesToHex } from './codec'
import {
	decodePrivateEnvelope,
	encodePrivateEnvelope,
	type PrivateWorkspaceEnvelope,
} from './envelope'

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

export async function generateMlsKeyPackage(pubkey: string): Promise<MlsKeyPackageArtifacts> {
	const cipherSuite = await getCiphersuite()
	const generated = await generateKeyPackage({
		credential: createNostrCredential(pubkey),
		cipherSuite,
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
	}
}

export function decodeKeyPackage(value: string): KeyPackage {
	const decoded = decode(keyPackageDecoder, base64ToBytes(value))
	if (!decoded) throw new Error('Invalid MLS KeyPackage')
	return decoded
}

export function credentialPubkeyFromKeyPackage(keyPackage: KeyPackage): string {
	const credential = keyPackage.leafNode.credential
	if (
		!isDefaultCredential(credential) ||
		credential.credentialType !== defaultCredentialTypes.basic
	) {
		throw new Error('Only BasicCredential MLS KeyPackages are supported')
	}
	const pubkey = decoder.decode(credential.identity)
	if (!/^[0-9a-f]{64}$/u.test(pubkey)) throw new Error('Invalid Nostr identity in MLS KeyPackage')
	return pubkey
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

export async function createWorkspaceApplicationMessage(input: {
	state: ClientState
	envelope: PrivateWorkspaceEnvelope
}) {
	const cipherSuite = await getCiphersuite()
	const result = await createApplicationMessage({
		context: getContext(cipherSuite),
		state: input.state,
		message: encodePrivateEnvelope(input.envelope),
		authenticatedData: encoder.encode(input.envelope.pubkey),
	})
	return {
		newState: result.newState,
		messageBase64: bytesToBase64(encode(mlsMessageEncoder, result.message)),
	}
}

export async function processWorkspaceMessage(input: {
	state: ClientState
	messageBase64: string
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
	})

	if (result.kind === 'applicationMessage') {
		const sender = decoder.decode(result.aad)
		const envelope = decodePrivateEnvelope(result.message)
		if (sender !== envelope.pubkey) throw new Error('MLS sender does not match envelope pubkey')
		return { kind: 'applicationMessage' as const, newState: result.newState, envelope }
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
