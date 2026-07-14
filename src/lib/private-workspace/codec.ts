import { base64ToBytes, bytesToBase64 } from 'ts-mls'

export { base64ToBytes, bytesToBase64 }

export function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function utf8ToBase64Url(value: string): string {
	return bytesToBase64(new TextEncoder().encode(value))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '')
}

export function base64UrlToUtf8(value: string): string {
	const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
	return new TextDecoder().decode(base64ToBytes(padded))
}
