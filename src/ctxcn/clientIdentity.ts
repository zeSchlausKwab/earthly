const PRIVATE_KEY_BYTES = 32
const SECP256K1_ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')

let sessionPrivateKey: string | undefined

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function randomPrivateKey(): string {
	if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
		throw new Error('Secure randomness is required to create the ContextVM session identity')
	}

	for (;;) {
		const bytes = new Uint8Array(PRIVATE_KEY_BYTES)
		crypto.getRandomValues(bytes)
		const candidate = bytesToHex(bytes)
		const scalar = BigInt(`0x${candidate}`)

		if (scalar > 0n && scalar < SECP256K1_ORDER) return candidate
	}
}

/**
 * Return the process-local credential used to authenticate ContextVM transport messages.
 *
 * This is intentionally an ephemeral transport identity: it is shared by ContextVM clients
 * created during one app session, but is never bundled, logged, or persisted. It is not the
 * user's Nostr signer and it is not the native local-node identity.
 */
export function getContextVmSessionPrivateKey(): string {
	if (!sessionPrivateKey) sessionPrivateKey = randomPrivateKey()
	return sessionPrivateKey
}
