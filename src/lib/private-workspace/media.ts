import { chacha20poly1305 } from '@noble/ciphers/chacha.js'
import { concatBytes, equalBytes, randomBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import type { Signer } from 'blossom-client-sdk'
import type { ClientState } from 'ts-mls'
import { getBlossomServerUrl } from '@/features/geo-editor/constants'
import { uploadBlobWithBlossyV02Compat, type BlossomFetch } from '@/lib/blossom/uploadCompat'
import { bytesToHex } from './codec'
import { deriveEncryptedMediaKey } from './mls'

export { deriveEncryptedMediaKey } from './mls'

export const CORDN_ENCRYPTED_MEDIA_VERSION = 'cordn-em-v1' as const
export const EARTHLY_PERSISTENT_MEDIA_VERSION = 'earthly-pm-v1' as const
export const CORDN_EXPORTER_LABEL = 'cordn'
export const CORDN_ENCRYPTED_MEDIA_CONTEXT = 'encrypted-media'
export const MAX_ENCRYPTED_MEDIA_BYTES = 25 * 1024 * 1024

export type EncryptedMediaVersion =
	| typeof CORDN_ENCRYPTED_MEDIA_VERSION
	| typeof EARTHLY_PERSISTENT_MEDIA_VERSION

export interface EncryptedMediaAttachment {
	url: string
	mime: string
	filename: string
	/** 64-char lowercase hex SHA-256 digest of the plaintext bytes. */
	x: string
	/** 24-char lowercase hex 12-byte detached AEAD nonce. */
	n: string
	v: EncryptedMediaVersion
	/** 64-char lowercase hex 32-byte key (required for `earthly-pm-v1`, omitted for `cordn-em-v1`). */
	k?: string
	dim?: string
	blurhash?: string
	alt?: string
}

export interface EncryptedMediaPayload {
	version: EncryptedMediaVersion
	ciphertext: Uint8Array
	nonceHex: string
	sha256Hex: string
	ciphertextSha256Hex: string
	size: number
	mime: string
	filename: string
	/** Present only for `earthly-pm-v1`. */
	keyHex?: string
}

const utf8Encoder = new TextEncoder()
const HEX_64_PATTERN = /^[0-9a-f]{64}$/u
const HEX_24_PATTERN = /^[0-9a-f]{24}$/u
const URL_PATTERN = /^https?:\/\/\S+$/iu

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
	'image/jpeg': 'jpg',
	'image/jpg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif',
	'image/avif': 'avif',
	'image/svg+xml': 'svg',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'application/pdf': 'pdf',
	'audio/mpeg': 'mp3',
	'audio/mp4': 'm4a',
	'audio/ogg': 'ogg',
	'audio/wav': 'wav',
	'audio/webm': 'weba',
	'video/mp4': 'mp4',
	'video/webm': 'webm',
	'video/quicktime': 'mov',
	'text/plain': 'txt',
	'text/markdown': 'md',
	'text/csv': 'csv',
	'application/geo+json': 'geojson',
	'application/json': 'json',
	'application/gpx+xml': 'gpx',
	'application/vnd.google-earth.kml+xml': 'kml',
	'application/zip': 'zip',
}

function assertValidMime(mime: string): string {
	const trimmed = mime.trim()
	if (!trimmed || trimmed.includes('\0') || /[\r\n]/u.test(trimmed)) {
		throw new Error('Invalid encrypted media MIME type')
	}
	return trimmed
}

function assertValidFilename(filename: string): string {
	const trimmed = filename.trim()
	if (!trimmed || trimmed.includes('\0') || /[\r\n]/u.test(trimmed)) {
		throw new Error('Invalid encrypted media filename')
	}
	return trimmed
}

/**
 * Exact Cordn `spec/applications/encrypted-media.md` AAD layout:
 * `utf8(mime) || 0x00 || utf8(filename) || 0x00 || sha256(plaintext)`
 * where `sha256(plaintext)` is the 32 raw digest bytes.
 */
export function buildEncryptedMediaAad(
	mime: string,
	filename: string,
	plaintextSha256: Uint8Array,
): Uint8Array {
	const cleanMime = assertValidMime(mime)
	const cleanFilename = assertValidFilename(filename)
	if (plaintextSha256.byteLength !== 32) {
		throw new Error('Plaintext SHA-256 digest must be 32 raw bytes')
	}
	return concatBytes(
		utf8Encoder.encode(cleanMime),
		new Uint8Array([0]),
		utf8Encoder.encode(cleanFilename),
		new Uint8Array([0]),
		plaintextSha256,
	)
}

function encryptWithDetachedNonce(input: {
	version: EncryptedMediaVersion
	plaintext: Uint8Array
	mime: string
	filename: string
	key: Uint8Array
	nonce?: Uint8Array
	includeKeyHex: boolean
}): EncryptedMediaPayload {
	if (input.key.byteLength !== 32) {
		throw new Error('Encrypted media key must be 32 bytes')
	}
	const nonce = input.nonce ?? randomBytes(12)
	if (nonce.byteLength !== 12) {
		throw new Error('Encrypted media nonce must be 12 bytes')
	}
	const mime = assertValidMime(input.mime)
	const filename = assertValidFilename(input.filename)
	const plaintextSha256 = sha256(input.plaintext)
	const aad = buildEncryptedMediaAad(mime, filename, plaintextSha256)
	const ciphertext = chacha20poly1305(input.key, nonce, aad).encrypt(input.plaintext)
	const ciphertextSha256 = sha256(ciphertext)

	return {
		version: input.version,
		ciphertext,
		nonceHex: bytesToHex(nonce),
		sha256Hex: bytesToHex(plaintextSha256),
		ciphertextSha256Hex: bytesToHex(ciphertextSha256),
		size: input.plaintext.byteLength,
		mime,
		filename,
		...(input.includeKeyHex ? { keyHex: bytesToHex(input.key) } : {}),
	}
}

/**
 * Encrypt media under Cordn `cordn-em-v1` using the 32-byte MLS exporter key
 * (`MLS-Exporter("cordn", "encrypted-media", 32)`).
 *
 * The 12-byte random nonce is NEVER prepended to the ciphertext; it is carried
 * solely in the NIP-92 `imeta` `n` field.
 */
export function encryptCordnMedia(input: {
	plaintext: Uint8Array
	mime: string
	filename: string
	key: Uint8Array
	nonce?: Uint8Array
}): EncryptedMediaPayload {
	return encryptWithDetachedNonce({
		version: CORDN_ENCRYPTED_MEDIA_VERSION,
		plaintext: input.plaintext,
		mime: input.mime,
		filename: input.filename,
		key: input.key,
		nonce: input.nonce,
		includeKeyHex: false,
	})
}

/**
 * Encrypt persistent map media under Earthly `earthly-pm-v1` using a fresh
 * 32-byte per-blob random key carried in `imeta` `k <64hex>` inside the
 * MLS-encrypted dataset envelope, enabling late joiners receiving a dataset
 * checkpoint to decrypt historical map photos without re-uploading blobs.
 */
export function encryptPersistentMapMedia(input: {
	plaintext: Uint8Array
	mime: string
	filename: string
	key?: Uint8Array
	nonce?: Uint8Array
}): EncryptedMediaPayload & { keyHex: string } {
	const key = input.key ?? randomBytes(32)
	const result = encryptWithDetachedNonce({
		version: EARTHLY_PERSISTENT_MEDIA_VERSION,
		plaintext: input.plaintext,
		mime: input.mime,
		filename: input.filename,
		key,
		nonce: input.nonce,
		includeKeyHex: true,
	})
	return result as EncryptedMediaPayload & { keyHex: string }
}

/**
 * Decrypt a `cordn-em-v1` or `earthly-pm-v1` ciphertext blob and verify BOTH
 * the ChaCha20-Poly1305 AEAD tag and `sha256(plaintext) === attachment.x`.
 * Rejects missing or unknown `v`.
 */
export function decryptEncryptedMedia(input: {
	ciphertext: Uint8Array
	attachment: EncryptedMediaAttachment
	epochMediaKey?: Uint8Array
}): Uint8Array {
	const { ciphertext, attachment } = input
	if (
		attachment.v !== CORDN_ENCRYPTED_MEDIA_VERSION &&
		attachment.v !== EARTHLY_PERSISTENT_MEDIA_VERSION
	) {
		throw new Error(`Unsupported encrypted media version: ${String(attachment.v)}`)
	}

	let key: Uint8Array
	if (attachment.v === CORDN_ENCRYPTED_MEDIA_VERSION) {
		if (attachment.k !== undefined) {
			throw new Error('cordn-em-v1 attachments must not include an inline key')
		}
		const epochKey = input.epochMediaKey
		if (epochKey?.byteLength !== 32) {
			throw new Error('Missing 32-byte MLS epoch media key for cordn-em-v1 attachment')
		}
		key = epochKey
	} else {
		if (!attachment.k || !HEX_64_PATTERN.test(attachment.k)) {
			throw new Error('earthly-pm-v1 attachment is missing a valid 32-byte hex key')
		}
		key = hexToBytes(attachment.k)
	}

	if (!HEX_24_PATTERN.test(attachment.n)) {
		throw new Error('Encrypted media attachment has an invalid 12-byte hex nonce')
	}
	if (!HEX_64_PATTERN.test(attachment.x)) {
		throw new Error('Encrypted media attachment has an invalid SHA-256 hex digest')
	}
	if (ciphertext.byteLength < 16) {
		throw new Error('Encrypted media ciphertext is truncated')
	}

	const nonce = hexToBytes(attachment.n)
	const expectedSha256 = hexToBytes(attachment.x)
	const aad = buildEncryptedMediaAad(attachment.mime, attachment.filename, expectedSha256)
	const plaintext = chacha20poly1305(key, nonce, aad).decrypt(ciphertext)
	const actualSha256 = sha256(plaintext)
	if (!equalBytes(actualSha256, expectedSha256)) {
		throw new Error('Decrypted media SHA-256 digest mismatch')
	}
	return plaintext
}

/**
 * Build a NIP-92 `imeta` tag for `cordn-em-v1` or `earthly-pm-v1`.
 */
export function buildEncryptedMediaImetaTag(attachment: EncryptedMediaAttachment): string[] {
	if (!URL_PATTERN.test(attachment.url)) {
		throw new Error('Encrypted media imeta requires an http(s) url')
	}
	const mime = assertValidMime(attachment.mime)
	const filename = assertValidFilename(attachment.filename)
	const x = attachment.x.toLowerCase()
	const n = attachment.n.toLowerCase()
	if (!HEX_64_PATTERN.test(x)) throw new Error('Encrypted media imeta x must be 64-char hex')
	if (!HEX_24_PATTERN.test(n)) throw new Error('Encrypted media imeta n must be 24-char hex')

	if (
		attachment.v !== CORDN_ENCRYPTED_MEDIA_VERSION &&
		attachment.v !== EARTHLY_PERSISTENT_MEDIA_VERSION
	) {
		throw new Error(`Unsupported encrypted media version: ${String(attachment.v)}`)
	}
	if (attachment.v === CORDN_ENCRYPTED_MEDIA_VERSION && attachment.k !== undefined) {
		throw new Error('cordn-em-v1 imeta tag must not include a k field')
	}
	let normalizedKey: string | undefined
	if (attachment.v === EARTHLY_PERSISTENT_MEDIA_VERSION) {
		if (!attachment.k || !HEX_64_PATTERN.test(attachment.k.toLowerCase())) {
			throw new Error('earthly-pm-v1 imeta tag requires a 64-char hex k field')
		}
		normalizedKey = attachment.k.toLowerCase()
	}

	const tag: string[] = [
		'imeta',
		`url ${attachment.url}`,
		`m ${mime}`,
		`filename ${filename}`,
		`x ${x}`,
		`n ${n}`,
		`v ${attachment.v}`,
	]
	if (normalizedKey) tag.push(`k ${normalizedKey}`)
	if (attachment.dim?.trim()) tag.push(`dim ${attachment.dim.trim()}`)
	if (attachment.blurhash?.trim()) tag.push(`blurhash ${attachment.blurhash.trim()}`)
	if (attachment.alt?.trim()) tag.push(`alt ${attachment.alt.trim()}`)
	return tag
}

/**
 * Strictly parse and validate a NIP-92 `imeta` tag for `cordn-em-v1` or `earthly-pm-v1`.
 * Throws on missing/unknown `v` or malformed cryptographic fields.
 */
export function parseEncryptedMediaImetaTagStrict(
	tag: readonly string[],
): EncryptedMediaAttachment {
	if (tag[0] !== 'imeta') {
		throw new Error('Expected an imeta tag')
	}
	const fields = new Map<string, string>()
	for (let index = 1; index < tag.length; index += 1) {
		const entry = tag[index]
		if (typeof entry !== 'string') continue
		const sep = entry.indexOf(' ')
		if (sep <= 0) continue
		const key = entry.slice(0, sep)
		const value = entry.slice(sep + 1)
		if (!fields.has(key)) fields.set(key, value)
	}

	const v = fields.get('v')
	if (v !== CORDN_ENCRYPTED_MEDIA_VERSION && v !== EARTHLY_PERSISTENT_MEDIA_VERSION) {
		throw new Error(`Missing or unsupported encrypted media version: ${v ?? '(missing)'}`)
	}

	const url = fields.get('url')?.trim()
	const mime = fields.get('m')?.trim()
	const filename = fields.get('filename')?.trim()
	const x = fields.get('x')?.trim()
	const n = fields.get('n')?.trim()
	const k = fields.get('k')?.trim()

	if (!url || !URL_PATTERN.test(url)) throw new Error('Invalid or missing imeta url')
	if (!mime) throw new Error('Missing imeta MIME type (m)')
	if (!filename) throw new Error('Missing imeta filename')
	if (!x || !HEX_64_PATTERN.test(x)) throw new Error('Invalid or missing imeta x digest')
	if (!n || !HEX_24_PATTERN.test(n)) throw new Error('Invalid or missing imeta n nonce')

	if (v === CORDN_ENCRYPTED_MEDIA_VERSION && k !== undefined) {
		throw new Error('cordn-em-v1 imeta tag must not carry an inline key')
	}
	if (v === EARTHLY_PERSISTENT_MEDIA_VERSION && (!k || !HEX_64_PATTERN.test(k))) {
		throw new Error('earthly-pm-v1 imeta tag requires a 64-char lowercase hex key (k)')
	}

	return {
		url,
		mime: assertValidMime(mime),
		filename: assertValidFilename(filename),
		x,
		n,
		v,
		...(k ? { k } : {}),
		...(fields.get('dim')?.trim() ? { dim: fields.get('dim')?.trim() } : {}),
		...(fields.get('blurhash')?.trim() ? { blurhash: fields.get('blurhash')?.trim() } : {}),
		...(fields.get('alt')?.trim() ? { alt: fields.get('alt')?.trim() } : {}),
	}
}

export function parseEncryptedMediaImetaTag(
	tag: readonly string[],
): EncryptedMediaAttachment | undefined {
	if (tag[0] !== 'imeta') return undefined
	try {
		return parseEncryptedMediaImetaTagStrict(tag)
	} catch {
		return undefined
	}
}

export function parseEncryptedMediaImetaTags(
	tags: readonly (readonly string[])[],
): EncryptedMediaAttachment[] {
	const attachments: EncryptedMediaAttachment[] = []
	for (const tag of tags) {
		const parsed = parseEncryptedMediaImetaTag(tag)
		if (parsed) attachments.push(parsed)
	}
	return attachments
}

/**
 * Generate a random privacy-preserving attachment filename derived only from
 * the MIME type, avoiding leaking local file names into AAD or imeta tags.
 */
export function randomizeAttachmentFilename(mime: string): string {
	const baseMime = mime.split(';')[0]?.trim().toLowerCase() ?? ''
	const ext = MIME_EXTENSIONS[baseMime] ?? 'bin'
	return `${bytesToHex(randomBytes(16))}.${ext}`
}

function stripJpegMetadata(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes
	const segments: Uint8Array[] = [bytes.subarray(0, 2)]
	let offset = 2

	while (offset < bytes.length) {
		if (bytes[offset] !== 0xff) return bytes
		while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
		if (offset >= bytes.length) return bytes
		const marker = bytes[offset]
		if (marker === undefined) return bytes
		offset += 1

		// EOI (0xD9)
		if (marker === 0xd9) {
			segments.push(Uint8Array.from([0xff, 0xd9]))
			return concatBytes(...segments)
		}
		// Standalone markers without length (TEM 0x01, RST0..RST7 0xD0..0xD7, SOI 0xD8)
		if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
			segments.push(Uint8Array.from([0xff, marker]))
			continue
		}
		// Start of Scan (0xDA): copy SOS header + entropy-coded scan + EOI verbatim
		if (marker === 0xda) {
			segments.push(bytes.subarray(offset - 2))
			return concatBytes(...segments)
		}

		if (offset + 2 > bytes.length) return bytes
		const high = bytes[offset]
		const low = bytes[offset + 1]
		if (high === undefined || low === undefined) return bytes
		const length = (high << 8) | low
		if (length < 2 || offset + length > bytes.length) return bytes

		// Strip APP1..APP15 (EXIF/XMP/ICC/IPTC/Adobe) and COM (0xFE); keep APP0 (JFIF), DQT, DHT, DRI, SOF*, etc.
		const isMetadataSegment = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe
		if (!isMetadataSegment) {
			segments.push(bytes.subarray(offset - 2, offset + length))
		}
		offset += length
	}

	return concatBytes(...segments)
}

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const SAFE_PNG_ANCILLARY_CHUNKS = new Set([
	'tRNS',
	'gAMA',
	'cHRM',
	'sRGB',
	'bKGD',
	'pHYs',
	'acTL',
	'fcTL',
	'fdAT',
])

function stripPngMetadata(bytes: Uint8Array): Uint8Array {
	if (bytes.length < 8 || !equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE)) return bytes
	const chunks: Uint8Array[] = [bytes.subarray(0, 8)]
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	let offset = 8
	let sawIend = false

	while (offset + 12 <= bytes.length) {
		const dataLength = view.getUint32(offset, false)
		const chunkEnd = offset + 12 + dataLength
		if (chunkEnd > bytes.length) return bytes

		const typeBytes = bytes.subarray(offset + 4, offset + 8)
		const chunkType = String.fromCharCode(
			typeBytes[0] ?? 0,
			typeBytes[1] ?? 0,
			typeBytes[2] ?? 0,
			typeBytes[3] ?? 0,
		)
		const firstChar = typeBytes[0] ?? 0
		const isCritical = (firstChar & 0x20) === 0
		if (isCritical || SAFE_PNG_ANCILLARY_CHUNKS.has(chunkType)) {
			chunks.push(bytes.subarray(offset, chunkEnd))
		}
		offset = chunkEnd
		if (chunkType === 'IEND') {
			sawIend = true
			break
		}
	}

	return sawIend ? concatBytes(...chunks) : bytes
}

/**
 * Strip EXIF/XMP/IPTC/comment metadata from JPEG and non-critical text/eXIf/tIME
 * chunks from PNG before encryption and Blossom upload.
 */
export function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
	const normalizedMime = mime.split(';')[0]?.trim().toLowerCase() ?? ''
	if (
		normalizedMime === 'image/jpeg' ||
		normalizedMime === 'image/jpg' ||
		(bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8)
	) {
		return stripJpegMetadata(bytes)
	}
	if (
		normalizedMime === 'image/png' ||
		(bytes.length >= 8 && equalBytes(bytes.subarray(0, 8), PNG_SIGNATURE))
	) {
		return stripPngMetadata(bytes)
	}
	return bytes
}

export interface UploadEncryptedMediaOptions {
	bytes: Uint8Array
	mime: string
	filename?: string
	mode: EncryptedMediaVersion
	/** Required for `cordn-em-v1` unless `epochMediaKey` is supplied directly. */
	state?: ClientState
	/** Optional pre-derived 32-byte key for `cordn-em-v1` (or test key for `earthly-pm-v1`). */
	epochMediaKey?: Uint8Array
	signer: Signer
	blossomServers?: string | readonly string[]
	stripMetadata?: boolean
	randomizeFilename?: boolean
	dim?: string
	blurhash?: string
	alt?: string
	fetchImpl?: BlossomFetch
	signal?: AbortSignal
}

export interface UploadedEncryptedMedia {
	attachment: EncryptedMediaAttachment
	imetaTag: string[]
	ciphertextSha256Hex: string
	url: string
	size: number
}

/**
 * Strip image metadata, randomize filename (by default), encrypt with
 * `cordn-em-v1` or `earthly-pm-v1`, upload opaque ciphertext bytes to Blossom,
 * and return the ready-to-embed NIP-92 `imeta` tag.
 */
export async function uploadEncryptedMediaToBlossom(
	options: UploadEncryptedMediaOptions,
): Promise<UploadedEncryptedMedia> {
	if (options.bytes.byteLength > MAX_ENCRYPTED_MEDIA_BYTES) {
		throw new Error(
			`Attachment exceeds maximum size of ${Math.round(MAX_ENCRYPTED_MEDIA_BYTES / (1024 * 1024))} MB`,
		)
	}

	const mime = assertValidMime(options.mime)
	const preparedBytes =
		options.stripMetadata === false ? options.bytes : stripImageMetadata(options.bytes, mime)
	const filename =
		options.randomizeFilename === false && options.filename?.trim()
			? assertValidFilename(options.filename)
			: randomizeAttachmentFilename(mime)

	let encrypted: EncryptedMediaPayload
	if (options.mode === CORDN_ENCRYPTED_MEDIA_VERSION) {
		const key =
			options.epochMediaKey ??
			(options.state ? await deriveEncryptedMediaKey(options.state) : undefined)
		if (!key) {
			throw new Error('cordn-em-v1 upload requires an MLS state or 32-byte epoch media key')
		}
		encrypted = encryptCordnMedia({
			plaintext: preparedBytes,
			mime,
			filename,
			key,
		})
	} else {
		encrypted = encryptPersistentMapMedia({
			plaintext: preparedBytes,
			mime,
			filename,
			key: options.epochMediaKey,
		})
	}

	const servers = options.blossomServers ?? getBlossomServerUrl()
	const ciphertextCopy = new Uint8Array(encrypted.ciphertext.byteLength)
	ciphertextCopy.set(encrypted.ciphertext)
	const blob = new Blob([ciphertextCopy], { type: 'application/octet-stream' })
	const descriptor = await uploadBlobWithBlossyV02Compat(servers, blob, {
		signer: options.signer,
		message: 'Upload encrypted media',
		expiration: Math.floor(Date.now() / 1000) + 5 * 60,
		fetchImpl: options.fetchImpl,
		signal: options.signal,
	})

	const attachment: EncryptedMediaAttachment = {
		url: descriptor.url,
		mime,
		filename,
		x: encrypted.sha256Hex,
		n: encrypted.nonceHex,
		v: encrypted.version,
		...(encrypted.keyHex ? { k: encrypted.keyHex } : {}),
		...(options.dim ? { dim: options.dim } : {}),
		...(options.blurhash ? { blurhash: options.blurhash } : {}),
		...(options.alt ? { alt: options.alt } : {}),
	}
	const imetaTag = buildEncryptedMediaImetaTag(attachment)

	return {
		attachment,
		imetaTag,
		ciphertextSha256Hex: encrypted.ciphertextSha256Hex,
		url: descriptor.url,
		size: encrypted.size,
	}
}

export async function downloadAndDecryptMedia(input: {
	attachment: EncryptedMediaAttachment
	epochMediaKey?: Uint8Array
	fetchImpl?: BlossomFetch
	signal?: AbortSignal
}): Promise<{ bytes: Uint8Array; mime: string; filename: string }> {
	const fetchImpl = input.fetchImpl ?? globalThis.fetch
	const response = await fetchImpl(input.attachment.url, {
		method: 'GET',
		signal: input.signal,
	})
	if (!response.ok) {
		throw new Error(`Failed to fetch encrypted media (${response.status})`)
	}
	const contentLength = Number(response.headers.get('content-length') ?? '0')
	if (Number.isFinite(contentLength) && contentLength > MAX_ENCRYPTED_MEDIA_BYTES + 16) {
		throw new Error('Encrypted media blob exceeds maximum permitted size')
	}
	const ciphertext = new Uint8Array(await response.arrayBuffer())
	if (ciphertext.byteLength > MAX_ENCRYPTED_MEDIA_BYTES + 16) {
		throw new Error('Encrypted media blob exceeds maximum permitted size')
	}
	const bytes = decryptEncryptedMedia({
		ciphertext,
		attachment: input.attachment,
		epochMediaKey: input.epochMediaKey,
	})
	return {
		bytes,
		mime: input.attachment.mime,
		filename: input.attachment.filename,
	}
}
