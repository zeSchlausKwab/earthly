import { expect, test } from 'bun:test'
import { Relay, type RelayAuthContext } from 'applesauce-relay'
import { PrivateKeySigner } from 'applesauce-signers'
import { createRelayAuthOptions } from './relayAuthentication'

async function fixture(accepted: boolean) {
	const signer = new PrivateKeySigner()
	const pubkey = await signer.getPublicKey()
	let sent = 0
	const relay = new Relay('ws://127.0.0.1:1')
	relay.authenticate = async (authSigner) => {
		await authSigner.signEvent({ kind: 22242, created_at: 1, tags: [], content: '' })
		sent++
		return { from: relay.url, ok: accepted, message: accepted ? '' : 'blocked: denied' }
	}
	const context = { relay } as RelayAuthContext
	return { signer, pubkey, relay, context, sent: () => sent }
}

test('negative AUTH acknowledgements are failures, not successful authentication', async () => {
	const f = await fixture(false)
	const auth = createRelayAuthOptions(f, () => true)
	expect(auth.waitForAuth).toBe(f.pubkey)
	await expect(Promise.resolve(auth.onAuthRequired?.(f.context))).rejects.toThrow('blocked: denied')
	f.relay.close()
})

test('switching account during signing prevents the old AUTH from being sent', async () => {
	const f = await fixture(true)
	let current = true
	const auth = createRelayAuthOptions(
		{
			pubkey: f.pubkey,
			signer: {
				signEvent: async (event) => {
					const signed = await f.signer.signEvent(event)
					current = false
					return signed
				},
			},
		},
		() => current,
	)
	await expect(Promise.resolve(auth.onAuthRequired?.(f.context))).rejects.toThrow('Account changed')
	expect(f.sent()).toBe(0)
	f.relay.close()
})

test('anonymous requests do not borrow an account signer', () => {
	expect(createRelayAuthOptions(undefined, () => true)).toEqual({ waitForAuth: false })
})
