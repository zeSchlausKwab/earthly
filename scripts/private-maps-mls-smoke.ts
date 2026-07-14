import assert from 'node:assert/strict'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createPrivateEnvelope } from '../src/lib/private-workspace/envelope'
import {
	addWorkspaceMember,
	createWorkspaceApplicationMessage,
	createWorkspaceGroup,
	generateMlsKeyPackage,
	joinWorkspaceGroup,
	memberPubkeysFromState,
	openCoordinatorPayload,
	processWorkspaceMessage,
	removeWorkspaceMember,
	sealCoordinatorPayload,
} from '../src/lib/private-workspace/mls'

const groupId = 'earthly:node-smoke'
const aliceSecretKey = generateSecretKey()
const bobSecretKey = generateSecretKey()
const alicePubkey = getPublicKey(aliceSecretKey)
const bobPubkey = getPublicKey(bobSecretKey)
const aliceSigner = {
	signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
		finalizeEvent(event, aliceSecretKey),
}
const bobSigner = {
	signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
		finalizeEvent(event, bobSecretKey),
}
const aliceKeys = await generateMlsKeyPackage(alicePubkey)
const bobKeys = await generateMlsKeyPackage(bobPubkey)
const aliceInitial = await createWorkspaceGroup({
	groupId,
	keyPackage: aliceKeys.keyPackage,
	privateKeyPackage: aliceKeys.privateKeyPackage,
})
const add = await addWorkspaceMember({ state: aliceInitial, keyPackage: bobKeys.keyPackage })
let aliceState = add.newState
let bobState = await joinWorkspaceGroup({
	welcomeBase64: add.welcomeBase64,
	keyPackage: bobKeys.keyPackage,
	privateKeyPackage: bobKeys.privateKeyPackage,
})
assert.deepEqual(memberPubkeysFromState(bobState), [alicePubkey, bobPubkey])

const forgedSender = await createPrivateEnvelope({
	signer: bobSigner,
	groupId,
	pubkey: bobPubkey,
	kind: 9,
	content: 'forged through Alice state',
})
await assert.rejects(
	() => createWorkspaceApplicationMessage({ state: aliceState, envelope: forgedSender }),
	/local MLS credential/u,
)

const envelope = await createPrivateEnvelope({
	signer: aliceSigner,
	groupId,
	pubkey: alicePubkey,
	kind: 9,
	content: 'private map MLS smoke test',
})
const outbound = await createWorkspaceApplicationMessage({ state: aliceState, envelope })
const sealed = await sealCoordinatorPayload(aliceState, outbound.messageBase64)
aliceState = outbound.newState
const received = await processWorkspaceMessage({
	state: bobState,
	messageBase64: await openCoordinatorPayload(bobState, sealed),
})
assert.equal(received.kind, 'applicationMessage')
if (received.kind === 'applicationMessage') assert.deepEqual(received.envelope, envelope)
bobState = received.newState

const removal = await removeWorkspaceMember({ state: aliceState, pubkey: bobPubkey })
const removalPayload = await sealCoordinatorPayload(aliceState, removal.commitBase64)
const removedBob = await processWorkspaceMessage({
	state: bobState,
	messageBase64: await openCoordinatorPayload(bobState, removalPayload),
})
const futureEnvelope = await createPrivateEnvelope({
	signer: aliceSigner,
	groupId,
	pubkey: alicePubkey,
	kind: 9,
	content: 'future epoch',
})
const future = await createWorkspaceApplicationMessage({
	state: removal.newState,
	envelope: futureEnvelope,
})
const futurePayload = await sealCoordinatorPayload(removal.newState, future.messageBase64)
await assert.rejects(() => openCoordinatorPayload(removedBob.newState, futurePayload))

console.log('private maps MLS smoke test passed')
