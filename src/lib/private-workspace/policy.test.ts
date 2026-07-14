import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools'
import { createPrivateEnvelope } from './envelope'
import {
	createAdministratorPolicyTransition,
	PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
	reduceAdministratorPolicy,
	type AdministratorPolicyState,
} from './policy'

const groupId = 'earthly:policy-test'

function identity() {
	const secretKey = generateSecretKey()
	return {
		pubkey: getPublicKey(secretKey),
		signer: {
			signEvent: async (event: Parameters<typeof finalizeEvent>[0]) =>
				finalizeEvent(event, secretKey),
		},
	}
}

async function transitionEnvelope(
	account: ReturnType<typeof identity>,
	transition: ReturnType<typeof createAdministratorPolicyTransition>,
) {
	return createPrivateEnvelope({
		signer: account.signer,
		groupId,
		pubkey: account.pubkey,
		kind: PRIVATE_WORKSPACE_ADMIN_POLICY_KIND,
		tags: [['d', 'administrator-policy']],
		content: JSON.stringify(transition),
	})
}

describe('administrator policy', () => {
	test('allows a promoted administrator to authorize the next transition', async () => {
		const alice = identity()
		const bob = identity()
		const carol = identity()
		let state = reduceAdministratorPolicy(alice.pubkey, [])
		const promoteBob = await transitionEnvelope(
			alice,
			createAdministratorPolicyTransition(state, { pubkey: bob.pubkey, administrator: true }),
		)
		state = reduceAdministratorPolicy(alice.pubkey, [promoteBob])
		const promoteCarol = await transitionEnvelope(
			bob,
			createAdministratorPolicyTransition(state, { pubkey: carol.pubkey, administrator: true }),
		)

		state = reduceAdministratorPolicy(alice.pubkey, [promoteBob, promoteCarol])

		expect(state.administrators).toEqual([alice.pubkey, bob.pubkey, carol.pubkey].sort())
		expect(state.revision).toBe(2)
		expect(state.head).toBe(promoteCarol.id)
		expect(state.rejected).toEqual([])
	})

	test('rejects a transition authored by an ordinary member', async () => {
		const alice = identity()
		const member = identity()
		const target = identity()
		const initial = reduceAdministratorPolicy(alice.pubkey, [])
		const forged = await transitionEnvelope(
			member,
			createAdministratorPolicyTransition(initial, {
				pubkey: target.pubkey,
				administrator: true,
			}),
		)

		const state = reduceAdministratorPolicy(alice.pubkey, [forged])

		expect(state.administrators).toEqual([alice.pubkey])
		expect(state.revision).toBe(0)
		expect(state.rejected[0]?.reason).toContain('not an administrator')
	})

	test('uses delivery order to accept only one concurrent transition from a head', async () => {
		const alice = identity()
		const bob = identity()
		const carol = identity()
		const initial = reduceAdministratorPolicy(alice.pubkey, [])
		const promoteBob = await transitionEnvelope(
			alice,
			createAdministratorPolicyTransition(initial, { pubkey: bob.pubkey, administrator: true }),
		)
		const promoteCarol = await transitionEnvelope(
			alice,
			createAdministratorPolicyTransition(initial, {
				pubkey: carol.pubkey,
				administrator: true,
			}),
		)

		const state = reduceAdministratorPolicy(alice.pubkey, [promoteBob, promoteCarol])

		expect(state.administrators).toEqual([alice.pubkey, bob.pubkey].sort())
		expect(state.head).toBe(promoteBob.id)
		expect(state.rejected[0]?.envelopeId).toBe(promoteCarol.id)
		expect(state.rejected[0]?.reason).toContain('revision')
	})

	test('prevents removing the final administrator', () => {
		const alice = identity()
		const state: AdministratorPolicyState = reduceAdministratorPolicy(alice.pubkey, [])

		expect(() =>
			createAdministratorPolicyTransition(state, {
				pubkey: alice.pubkey,
				administrator: false,
			}),
		).toThrow('at least one administrator')
	})
})
