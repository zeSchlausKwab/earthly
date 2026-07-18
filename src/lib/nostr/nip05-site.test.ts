import { describe, expect, test } from 'bun:test'

const EARTHLY_PUBKEY = '6ef777a78b2405fad6b4db2a619116441123b03cf148688084280db15439dac4'
const documentPath = new URL('../../.well-known/nostr.json', import.meta.url)

interface Nip05Document {
	names: Record<string, string>
	relays?: Record<string, string[]>
}

describe('Earthly NIP-05 document', () => {
	test('maps the root identity to the lowercase project pubkey', async () => {
		const document = (await Bun.file(documentPath).json()) as Nip05Document

		expect(document.names._).toBe(EARTHLY_PUBKEY)
		expect(document.names._).toMatch(/^[0-9a-f]{64}$/)
	})

	test('announces a secure relay hint for the project identity', async () => {
		const document = (await Bun.file(documentPath).json()) as Nip05Document

		expect(document.relays?.[EARTHLY_PUBKEY]).toEqual(['wss://relay.earthly.city'])
	})
})
