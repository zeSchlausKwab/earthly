import { concatBytes } from '@noble/ciphers/utils.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { bech32 } from '@scure/base'
import { bytesToHex } from './codec'

export const CORDN_GROUP_REF_HRP = 'cordn'
export const GROUP_REF_TLV_GID = 0
export const GROUP_REF_TLV_RELAY = 1
export const GROUP_REF_TLV_COORDINATOR = 2

const MAX_BECH32_LENGTH = 5_000
const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u
const RELAY_URL_PATTERN = /^wss?:\/\/\S+$/iu
const CORDN_REF_MATCH_PATTERN = /\bcordn1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+\b/iu

const utf8Encoder = new TextEncoder()
const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

export interface CordnGroupRef {
	gid: string
	relays: string[]
	coordinator: string
}

function encodeTlv(type: number, value: Uint8Array): Uint8Array {
	if (value.byteLength === 0 || value.byteLength > 255) {
		throw new Error(`Invalid TLV length ${value.byteLength} for type ${type}`)
	}
	return concatBytes(Uint8Array.from([type, value.byteLength]), value)
}

/**
 * Encode a Cordn group reference per `spec/applications/group-ref.md`:
 * BIP-173 Bech32 with HRP `cordn` carrying TLV entries:
 * - Type 0: `gid` (UTF-8, 1..255 bytes)
 * - Type 1: relay URL (UTF-8, 1..255 bytes, repeatable)
 * - Type 2: coordinator pubkey (32 raw bytes)
 */
export function encodeGroupRef(ref: CordnGroupRef): string {
	const gid = ref.gid.trim()
	if (!gid) throw new Error('Cordn group ref requires a non-empty gid')
	const gidBytes = utf8Encoder.encode(gid)
	if (gidBytes.byteLength > 255) {
		throw new Error('Cordn group ref gid exceeds 255 UTF-8 bytes')
	}

	const coordinator = ref.coordinator.toLowerCase()
	if (!PUBKEY_PATTERN.test(coordinator)) {
		throw new Error('Cordn group ref coordinator must be a 64-char hex pubkey')
	}

	const parts: Uint8Array[] = [encodeTlv(GROUP_REF_TLV_GID, gidBytes)]
	for (const relay of ref.relays) {
		const trimmed = relay.trim()
		if (!RELAY_URL_PATTERN.test(trimmed)) {
			throw new Error(`Invalid relay URL in Cordn group ref: ${relay}`)
		}
		const relayBytes = utf8Encoder.encode(trimmed)
		if (relayBytes.byteLength > 255) {
			throw new Error(`Relay URL in Cordn group ref exceeds 255 UTF-8 bytes: ${trimmed}`)
		}
		parts.push(encodeTlv(GROUP_REF_TLV_RELAY, relayBytes))
	}
	parts.push(encodeTlv(GROUP_REF_TLV_COORDINATOR, hexToBytes(coordinator)))

	const payload = concatBytes(...parts)
	return bech32.encode(CORDN_GROUP_REF_HRP, bech32.toWords(payload), MAX_BECH32_LENGTH)
}

/**
 * Extract a bare `cordn1...` token from a raw string, `cordn:` URI, URL hash
 * fragment (`#cordn1...`), or URL query/path.
 */
export function extractGroupRef(input: string): string | undefined {
	const trimmed = input.trim()
	if (!trimmed) return undefined

	// Reject mixed case on direct bare inputs before matching
	if (/^cordn1/iu.test(trimmed)) {
		return trimmed
	}

	if (/^cordn:/iu.test(trimmed)) {
		const rest = trimmed.slice('cordn:'.length).trim()
		if (/^cordn1/iu.test(rest)) return rest
	}

	try {
		const url = new URL(trimmed)
		const hashCandidate = url.hash.replace(/^#\/?/u, '').trim()
		if (hashCandidate) {
			const fromHash = hashCandidate.match(CORDN_REF_MATCH_PATTERN)?.[0]
			if (fromHash) return fromHash
		}
		for (const value of url.searchParams.values()) {
			const fromParam = value.match(CORDN_REF_MATCH_PATTERN)?.[0]
			if (fromParam) return fromParam
		}
	} catch {
		// Not a URL; fall through to inline token extraction.
	}

	return trimmed.match(CORDN_REF_MATCH_PATTERN)?.[0]
}

/**
 * Decode a `cordn1...` Bech32 TLV group reference per `spec/applications/group-ref.md`.
 * Unknown TLV types are ignored for forward compatibility.
 */
export function decodeGroupRef(input: string): CordnGroupRef {
	const token = extractGroupRef(input)
	if (!token) {
		throw new Error('No cordn1... group reference found')
	}

	const decoded = bech32.decode(token as `${string}1${string}`, MAX_BECH32_LENGTH)
	if (decoded.prefix !== CORDN_GROUP_REF_HRP) {
		throw new Error(`Expected HRP "${CORDN_GROUP_REF_HRP}", got "${decoded.prefix}"`)
	}

	const bytes = bech32.fromWords(decoded.words)
	let offset = 0
	let gid: string | undefined
	let coordinator: string | undefined
	const relays: string[] = []

	while (offset < bytes.byteLength) {
		if (offset + 2 > bytes.byteLength) {
			throw new Error('Truncated TLV header in Cordn group ref')
		}
		const type = bytes[offset]
		const length = bytes[offset + 1]
		if (type === undefined || length === undefined) {
			throw new Error('Truncated TLV header in Cordn group ref')
		}
		offset += 2
		if (offset + length > bytes.byteLength) {
			throw new Error(`Truncated TLV value for type ${type} in Cordn group ref`)
		}
		const value = bytes.subarray(offset, offset + length)
		offset += length

		switch (type) {
			case GROUP_REF_TLV_GID: {
				if (gid !== undefined) {
					throw new Error('Duplicate gid TLV in Cordn group ref')
				}
				if (value.byteLength === 0) {
					throw new Error('Empty gid TLV in Cordn group ref')
				}
				gid = utf8Decoder.decode(value)
				break
			}
			case GROUP_REF_TLV_RELAY: {
				if (value.byteLength === 0) {
					throw new Error('Empty relay TLV in Cordn group ref')
				}
				const relay = utf8Decoder.decode(value)
				if (!RELAY_URL_PATTERN.test(relay)) {
					throw new Error(`Invalid relay URL in Cordn group ref: ${relay}`)
				}
				relays.push(relay)
				break
			}
			case GROUP_REF_TLV_COORDINATOR: {
				if (coordinator !== undefined) {
					throw new Error('Duplicate coordinator TLV in Cordn group ref')
				}
				if (value.byteLength !== 32) {
					throw new Error(`Coordinator TLV must be 32 bytes, got ${value.byteLength}`)
				}
				coordinator = bytesToHex(value)
				break
			}
			default:
				// Ignore unknown TLV types per spec/applications/group-ref.md
				break
		}
	}

	if (!gid) throw new Error('Cordn group ref is missing gid (TLV 0)')
	if (!coordinator) throw new Error('Cordn group ref is missing coordinator pubkey (TLV 2)')

	return { gid, relays, coordinator }
}
