import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createPrivateEnvelope } from './envelope'
import {
	addWorkspaceMember,
	createWorkspaceApplicationMessage,
	createWorkspaceGroup,
	deserializeClientState,
	generateMlsKeyPackage,
	joinWorkspaceGroup,
	memberPubkeysFromState,
	openCoordinatorPayload,
	processWorkspaceMessage,
	removeWorkspaceMember,
	sealCoordinatorPayload,
	serializeClientState,
} from './mls'

// Bun 1.3 advertises X25519 key generation but cannot import the raw keys used
// by @hpke/core. The browser path and the Node smoke test exercise this suite.
const supportsHpkeX25519 = typeof Bun === 'undefined'

describe('private workspace MLS lifecycle', () => {
	test.skipIf(!supportsHpkeX25519)(
		'adds, persists, messages, and removes a member across future epochs',
		async () => {
			const groupId = 'earthly:test-group'
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
			let aliceState = deserializeClientState(serializeClientState(add.newState))
			let bobState = await joinWorkspaceGroup({
				welcomeBase64: add.welcomeBase64,
				keyPackage: bobKeys.keyPackage,
				privateKeyPackage: bobKeys.privateKeyPackage,
			})
			expect(memberPubkeysFromState(aliceState)).toEqual([alicePubkey, bobPubkey])
			expect(memberPubkeysFromState(bobState)).toEqual([alicePubkey, bobPubkey])

			const forgedSender = await createPrivateEnvelope({
				signer: bobSigner,
				groupId,
				pubkey: bobPubkey,
				kind: 9,
				content: 'forged through Alice state',
			})
			await expect(
				createWorkspaceApplicationMessage({ state: aliceState, envelope: forgedSender }),
			).rejects.toThrow('local MLS credential')

			const envelope = await createPrivateEnvelope({
				signer: aliceSigner,
				groupId,
				pubkey: alicePubkey,
				kind: 9,
				content: 'Meet at the north trailhead',
				createdAt: 1_700_000_000,
			})
			const outbound = await createWorkspaceApplicationMessage({ state: aliceState, envelope })
			const opaque = await sealCoordinatorPayload(aliceState, outbound.messageBase64)
			aliceState = outbound.newState
			const opened = await openCoordinatorPayload(bobState, opaque)
			const received = await processWorkspaceMessage({
				state: bobState,
				messageBase64: opened,
				administratorPubkeys: [alicePubkey],
			})
			expect(received.kind).toBe('applicationMessage')
			if (received.kind === 'applicationMessage') expect(received.envelope).toEqual(envelope)
			bobState = received.newState

			const unauthorizedRemoval = await removeWorkspaceMember({
				state: bobState,
				pubkey: alicePubkey,
			})
			const unauthorizedPayload = await sealCoordinatorPayload(
				bobState,
				unauthorizedRemoval.commitBase64,
			)
			const rejected = await processWorkspaceMessage({
				state: aliceState,
				messageBase64: await openCoordinatorPayload(aliceState, unauthorizedPayload),
				administratorPubkeys: [alicePubkey],
			})
			expect(rejected.kind).toBe('rejected')
			expect(memberPubkeysFromState(rejected.newState)).toEqual([alicePubkey, bobPubkey])

			const removal = await removeWorkspaceMember({ state: aliceState, pubkey: bobPubkey })
			const removalPayload = await sealCoordinatorPayload(aliceState, removal.commitBase64)
			const openedRemoval = await openCoordinatorPayload(bobState, removalPayload)
			const removedBob = await processWorkspaceMessage({
				state: bobState,
				messageBase64: openedRemoval,
				administratorPubkeys: [alicePubkey],
			})
			expect(removedBob.kind).toBe('newState')
			aliceState = removal.newState

			const futureEnvelope = await createPrivateEnvelope({
				signer: aliceSigner,
				groupId,
				pubkey: alicePubkey,
				kind: 9,
				content: 'future epoch',
			})
			const future = await createWorkspaceApplicationMessage({
				state: aliceState,
				envelope: futureEnvelope,
			})
			const futurePayload = await sealCoordinatorPayload(aliceState, future.messageBase64)
			await expect(openCoordinatorPayload(removedBob.newState, futurePayload)).rejects.toThrow()
		},
	)
})
