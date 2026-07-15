import { describe, expect, test } from 'bun:test'
import { isPairingInvitation, normalizePairingInvitation, pairingInvitationLink } from './pairingQr'

const invitation = `earthly-pair-v1:z${'Abc_123-'.repeat(20)}`

describe('Earthly pairing links', () => {
	test('round-trips a signed invitation through the custom scheme', () => {
		const link = pairingInvitationLink(invitation)
		expect(link).toStartWith('earthly://pair?invitation=')
		expect(normalizePairingInvitation(link)).toBe(invitation)
	})

	test('keeps raw invitations compatible with paste and QR import', () => {
		expect(isPairingInvitation(invitation)).toBe(true)
		expect(normalizePairingInvitation(`  ${invitation}\n`)).toBe(invitation)
	})

	test('rejects lookalike routes, duplicate payloads, and malformed encodings', () => {
		expect(normalizePairingInvitation(`earthly://other?invitation=${invitation}`)).toBeNull()
		expect(
			normalizePairingInvitation(
				`earthly://pair?invitation=${invitation}&invitation=${invitation}`,
			),
		).toBeNull()
		expect(normalizePairingInvitation(`earthly://pair/path?invitation=${invitation}`)).toBeNull()
		expect(normalizePairingInvitation('earthly-pair-v1:not base64url')).toBeNull()
	})

	test('rejects oversized input before it reaches the native decoder', () => {
		expect(isPairingInvitation(`earthly-pair-v1:${'a'.repeat(16 * 1024)}`)).toBe(false)
		expect(normalizePairingInvitation(`earthly://pair?invitation=${'a'.repeat(40_000)}`)).toBeNull()
	})
})
