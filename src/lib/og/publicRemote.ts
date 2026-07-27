import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/**
 * Reject IPv4 literals in private, loopback, link-local (including the
 * 169.254.169.254 cloud-metadata endpoint), CGNAT, and reserved/multicast
 * ranges.
 */
export function isBlockedPublicRemoteIPv4(ip: string): boolean {
	const parts = ip.split('.').map(Number)
	if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
		return true
	}
	const [a, b, c] = parts as [number, number, number, number]
	if (a === 0 || a === 10 || a === 127) return true
	if (a === 169 && b === 254) return true
	if (a === 172 && b >= 16 && b <= 31) return true
	if (a === 192 && b === 168) return true
	if (a === 192 && b === 0) return true
	if (a === 100 && b >= 64 && b <= 127) return true
	if (a === 198 && (b === 18 || b === 19)) return true
	if (a === 198 && b === 51 && c === 100) return true
	if (a === 203 && b === 0 && c === 113) return true
	if (a >= 224) return true
	return false
}

function parseIPv6Bytes(ip: string): Uint8Array | null {
	let address = ip.toLowerCase().split('%')[0] ?? ''
	if (address.includes('.')) {
		const lastColon = address.lastIndexOf(':')
		const dotted = address.slice(lastColon + 1)
		const parts = dotted.split('.').map(Number)
		if (
			parts.length !== 4 ||
			parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
		) {
			return null
		}
		const [a, b, c, d] = parts as [number, number, number, number]
		address = `${address.slice(0, lastColon)}:${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
	}

	const halves = address.split('::')
	if (halves.length > 2) return null
	const left = halves[0] ? halves[0].split(':') : []
	const right = halves[1] ? halves[1].split(':') : []
	const missing = 8 - left.length - right.length
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
	const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
	if (groups.length !== 8) return null

	const bytes = new Uint8Array(16)
	for (const [index, group] of groups.entries()) {
		if (!/^[0-9a-f]{1,4}$/u.test(group)) return null
		const value = Number.parseInt(group, 16)
		bytes[index * 2] = value >> 8
		bytes[index * 2 + 1] = value & 0xff
	}
	return bytes
}

/** Reject IPv6 loopback, ULA, link-local, and IPv4-mapped internal addresses. */
export function isBlockedPublicRemoteIPv6(ip: string): boolean {
	const bytes = parseIPv6Bytes(ip)
	if (!bytes) return true
	const allZeroPrefix = bytes.slice(0, 12).every((byte) => byte === 0)
	const allZero = bytes.every((byte) => byte === 0)
	const loopback =
		allZeroPrefix && bytes[12] === 0 && bytes[13] === 0 && bytes[14] === 0 && bytes[15] === 1
	if (allZero || loopback) return true
	if ((bytes[0] ?? 0) >= 0xfc && (bytes[0] ?? 0) <= 0xfd) return true
	if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0x80) === 0x80) return true
	if (bytes[0] === 0xff) return true

	const isV4Mapped =
		bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff
	const isV4Compatible = allZeroPrefix
	if (isV4Mapped || isV4Compatible) {
		return isBlockedPublicRemoteIPv4(
			`${bytes[12] ?? 0}.${bytes[13] ?? 0}.${bytes[14] ?? 0}.${bytes[15] ?? 0}`,
		)
	}
	return false
}

function isBlockedAddress(ip: string): boolean {
	const kind = isIP(ip)
	if (kind === 4) return isBlockedPublicRemoteIPv4(ip)
	if (kind === 6) return isBlockedPublicRemoteIPv6(ip)
	return true
}

/**
 * Validate an event-controlled URL before the OG server fetches it. Only
 * public HTTP(S) destinations are allowed; every DNS answer must be public.
 * Fetch callers must also use `redirect: "error"` so a public endpoint cannot
 * redirect the server into a private network.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<URL | null> {
	let parsed: URL
	try {
		parsed = new URL(rawUrl)
	} catch {
		return null
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
	if (parsed.username || parsed.password) return null

	const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
	try {
		if (isIP(hostname)) {
			if (isBlockedAddress(hostname)) return null
		} else {
			const resolved = await lookup(hostname, { all: true })
			if (resolved.length === 0 || resolved.some((entry) => isBlockedAddress(entry.address))) {
				return null
			}
		}
	} catch {
		return null
	}
	return parsed
}
