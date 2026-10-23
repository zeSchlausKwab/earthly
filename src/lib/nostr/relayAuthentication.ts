import type { AuthSigner, RelayAuthOptions } from 'applesauce-relay'

export interface RelayIdentity {
	pubkey: string
	signer: AuthSigner
}

/** Bind an operation to its initiating account, including while signing is pending. */
export function createRelayAuthOptions(
	identity: RelayIdentity | undefined,
	isCurrent: () => boolean,
): RelayAuthOptions {
	if (!identity) return { waitForAuth: false }
	return {
		waitForAuth: identity.pubkey,
		authTimeout: 30_000,
		onAuthRequired: async ({ relay }) => {
			if (!isCurrent()) throw new Error('Account changed during relay authentication')
			const response = await relay.authenticate({
				signEvent: async (event) => {
					if (!isCurrent()) throw new Error('Account changed during relay authentication')
					const signed = await identity.signer.signEvent(event)
					if (!isCurrent() || signed.pubkey !== identity.pubkey)
						throw new Error('Account changed during relay authentication')
					return signed
				},
			})
			if (!response.ok) throw new Error(response.message || 'Relay refused authentication')
		},
	}
}
