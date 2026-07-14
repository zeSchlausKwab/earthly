import { describe, expect, test } from 'bun:test'
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
			const alicePubkey = 'a'.repeat(64)
			const bobPubkey = 'b'.repeat(64)
			const aliceKeys = await generateMlsKeyPackage(alicePubkey)
			const bobKeys = await generateMlsKeyPackage(bobPubkey)
			const aliceInitial = await createWorkspaceGroup({
				groupId: 'earthly:test-group',
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

			const envelope = createPrivateEnvelope({
				pubkey: alicePubkey,
				kind: 9,
				content: 'Meet at the north trailhead',
				createdAt: 1_700_000_000,
			})
			const outbound = await createWorkspaceApplicationMessage({ state: aliceState, envelope })
			const opaque = await sealCoordinatorPayload(aliceState, outbound.messageBase64)
			aliceState = outbound.newState
			const opened = await openCoordinatorPayload(bobState, opaque)
			const received = await processWorkspaceMessage({ state: bobState, messageBase64: opened })
			expect(received.kind).toBe('applicationMessage')
			if (received.kind === 'applicationMessage') expect(received.envelope).toEqual(envelope)
			bobState = received.newState

			const removal = await removeWorkspaceMember({ state: aliceState, pubkey: bobPubkey })
			const removalPayload = await sealCoordinatorPayload(aliceState, removal.commitBase64)
			const openedRemoval = await openCoordinatorPayload(bobState, removalPayload)
			const removedBob = await processWorkspaceMessage({
				state: bobState,
				messageBase64: openedRemoval,
			})
			expect(removedBob.kind).toBe('newState')
			aliceState = removal.newState

			const future = await createWorkspaceApplicationMessage({
				state: aliceState,
				envelope: createPrivateEnvelope({ pubkey: alicePubkey, kind: 9, content: 'future epoch' }),
			})
			const futurePayload = await sealCoordinatorPayload(aliceState, future.messageBase64)
			await expect(openCoordinatorPayload(removedBob.newState, futurePayload)).rejects.toThrow()
		},
	)
})
