const D_TAG_ALPHABET = '0123456789abcdefghijklmnopqrstuv'
export const DEFAULT_D_TAG_LENGTH = 8

/**
 * Generate a compact random identifier suitable for Nostr "d" tags.
 * Uses base32 symbols for URL-safe, lowercase identifiers.
 */
export function generateShortDTag(length = DEFAULT_D_TAG_LENGTH): string {
	if (!Number.isFinite(length) || length <= 0) {
		throw new Error('d-tag length must be a positive number.')
	}

	if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
		const bytes = new Uint8Array(length)
		crypto.getRandomValues(bytes)
		let id = ''
		for (let index = 0; index < length; index += 1) {
			const byte = bytes[index]
			if (byte === undefined) continue
			id += D_TAG_ALPHABET[byte & 31]
		}
		return id
	}

	let fallback = ''
	for (let index = 0; index < length; index += 1) {
		const nextIndex = Math.floor(Math.random() * D_TAG_ALPHABET.length)
		fallback += D_TAG_ALPHABET[nextIndex]
	}
	return fallback
}
