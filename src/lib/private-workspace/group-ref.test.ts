import { describe, expect, test } from 'bun:test'
import { concatBytes } from '@noble/ciphers/utils.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { bech32 } from '@scure/base'
import {
	CORDN_GROUP_REF_HRP,
	decodeGroupRef,
	encodeGroupRef,
	extractGroupRef,
	GROUP_REF_TLV_COORDINATOR,
	GROUP_REF_TLV_GID,
	GROUP_REF_TLV_RELAY,
} from './group-ref'

describe('Cordn group-ref (cordn1...) Bech32 TLV codec', () => {
	const coordinator = '0123456789abcdef'.repeat(4)

	test('round-trips gid, multiple relays, and 32-byte coordinator pubkey', () => {
		const ref = {
			gid: 'earthly:alp-expedition-2026',
			relays: ['wss://relay.earthly.city', 'ws://127.0.0.1:3334'],
			coordinator,
		}
		const encoded = encodeGroupRef(ref)
		expect(encoded.startsWith('cordn1')).toBe(true)
		expect(decodeGroupRef(encoded)).toEqual(ref)
	})

	test('matches Rust earthly-mls pinned cordn1... vector char-for-char', () => {
		const rustRef = {
			gid: 'earthly:danube-survey-42',
			relays: ['wss://relay.earthly.city', 'wss://nos.lol'],
			coordinator: 'fd5431a3f02dda33d9278adc2d95e007db7edf0cd4374508a3eb1a92c0c65e37',
		}
		const expected =
			'cordn1qqvx2ctjw35xc7f6v3skuatzv5khxatjwejhjtf5xgq3samnwvaz7tmjv4kxz7fwv4shyargd3ujucmfw3uszrthwden5te0dehhxtnvdakqyg8a2sc68updmgeajfu2msketcq8mdld7rx5xazs3gltr2fvp3j7xu22mhrl'
		expect(encodeGroupRef(rustRef)).toBe(expected)
		expect(decodeGroupRef(expected)).toEqual(rustRef)
	})

	test('extracts cordn1... from URL fragments, query params, and cordn: URIs', () => {
		const ref = {
			gid: 'earthly:fragment-group',
			relays: ['wss://relay.example.com'],
			coordinator,
		}
		const token = encodeGroupRef(ref)

		expect(extractGroupRef(`https://earthly.city/circle#${token}`)).toBe(token)
		expect(extractGroupRef(`https://earthly.city/join?ref=${token}`)).toBe(token)
		expect(extractGroupRef(`cordn:${token}`)).toBe(token)
		expect(decodeGroupRef(`https://earthly.city/#${token}`)).toEqual(ref)
	})

	test('ignores unknown future TLV types during decoding', () => {
		const enc = new TextEncoder()
		const gidBytes = enc.encode('earthly:future')
		const relayBytes = enc.encode('wss://relay.earthly.city')
		const coordBytes = hexToBytes(coordinator)
		const unknownTlv = Uint8Array.from([99, 3, 0xde, 0xad, 0xbe])

		const raw = concatBytes(
			Uint8Array.from([GROUP_REF_TLV_GID, gidBytes.length]),
			gidBytes,
			unknownTlv,
			Uint8Array.from([GROUP_REF_TLV_RELAY, relayBytes.length]),
			relayBytes,
			Uint8Array.from([GROUP_REF_TLV_COORDINATOR, 32]),
			coordBytes,
		)
		const encoded = bech32.encode(CORDN_GROUP_REF_HRP, bech32.toWords(raw), 5_000)

		expect(decodeGroupRef(encoded)).toEqual({
			gid: 'earthly:future',
			relays: ['wss://relay.earthly.city'],
			coordinator,
		})
	})

	test('rejects invalid HRP, missing required TLVs, and bad coordinator lengths', () => {
		const enc = new TextEncoder()
		const gidBytes = enc.encode('earthly:only-gid')
		const onlyGid = concatBytes(Uint8Array.from([GROUP_REF_TLV_GID, gidBytes.length]), gidBytes)
		const missingCoordinator = bech32.encode(CORDN_GROUP_REF_HRP, bech32.toWords(onlyGid), 5_000)
		expect(() => decodeGroupRef(missingCoordinator)).toThrow('missing coordinator')

		const wrongHrp = bech32.encode('npub', bech32.toWords(hexToBytes(coordinator)), 5_000)
		expect(() => decodeGroupRef(wrongHrp)).toThrow('No cordn1')

		const shortCoord = concatBytes(
			Uint8Array.from([GROUP_REF_TLV_GID, gidBytes.length]),
			gidBytes,
			Uint8Array.from([GROUP_REF_TLV_COORDINATOR, 16]),
			new Uint8Array(16),
		)
		const badCoordToken = bech32.encode(CORDN_GROUP_REF_HRP, bech32.toWords(shortCoord), 5_000)
		expect(() => decodeGroupRef(badCoordToken)).toThrow('32 bytes')
	})
})
