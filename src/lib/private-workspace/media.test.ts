import { describe, expect, test } from 'bun:test'
import { concatBytes } from '@noble/ciphers/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { bytesToHex } from './codec'
import {
	buildEncryptedMediaAad,
	buildEncryptedMediaImetaTag,
	CORDN_ENCRYPTED_MEDIA_VERSION,
	decryptEncryptedMedia,
	downloadAndDecryptMedia,
	EARTHLY_PERSISTENT_MEDIA_VERSION,
	encryptCordnMedia,
	encryptPersistentMapMedia,
	parseEncryptedMediaImetaTagStrict,
	parseEncryptedMediaImetaTags,
	randomizeAttachmentFilename,
	stripImageMetadata,
	uploadEncryptedMediaToBlossom,
	type EncryptedMediaAttachment,
} from './media'

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length)
	const view = new DataView(out.buffer)
	view.setUint32(0, data.length, false)
	for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
	out.set(data, 8)
	// Dummy CRC bytes (stripper preserves chunks byte-for-byte without recomputing CRC)
	out.set([0xde, 0xad, 0xbe, 0xef], 8 + data.length)
	return out
}

describe('cordn-em-v1 and earthly-pm-v1 encrypted media', () => {
	test('matches exact Cordn spec AAD layout and deterministic ChaCha20-Poly1305 test vector', () => {
		const key = hexToBytes('0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20')
		const nonce = hexToBytes('a1a2a3a4a5a6a7a8a9aaabac')
		const mime = 'image/jpeg'
		const filename = 'a1b2c3d4.jpg'
		const plaintext = new TextEncoder().encode('Hello Earthly MLS encrypted media!')

		const plaintextSha256 = sha256(plaintext)
		const aad = buildEncryptedMediaAad(mime, filename, plaintextSha256)
		// AAD = utf8("image/jpeg") || 0x00 || utf8("a1b2c3d4.jpg") || 0x00 || raw 32-byte sha256
		expect(aad.byteLength).toBe(mime.length + 1 + filename.length + 1 + 32)
		expect(aad[mime.length]).toBe(0)
		expect(aad[mime.length + 1 + filename.length]).toBe(0)
		expect(bytesToHex(aad.subarray(aad.byteLength - 32))).toBe(bytesToHex(plaintextSha256))

		const encrypted = encryptCordnMedia({ plaintext, mime, filename, key, nonce })
		// Nonce MUST NOT be prepended: ciphertext is strictly plaintext.length + 16-byte Poly1305 tag
		expect(encrypted.ciphertext.byteLength).toBe(plaintext.byteLength + 16)
		expect(encrypted.nonceHex).toBe('a1a2a3a4a5a6a7a8a9aaabac')
		expect(encrypted.sha256Hex).toBe(bytesToHex(plaintextSha256))
		expect(encrypted.version).toBe(CORDN_ENCRYPTED_MEDIA_VERSION)
		expect(encrypted.keyHex).toBeUndefined()

		const attachment: EncryptedMediaAttachment = {
			url: 'https://blossom.earthly.city/deadbeef',
			mime,
			filename,
			x: encrypted.sha256Hex,
			n: encrypted.nonceHex,
			v: CORDN_ENCRYPTED_MEDIA_VERSION,
			dim: '1200x800',
			alt: 'North ridge panorama',
		}
		const tag = buildEncryptedMediaImetaTag(attachment)
		expect(tag).toEqual([
			'imeta',
			'url https://blossom.earthly.city/deadbeef',
			'm image/jpeg',
			'filename a1b2c3d4.jpg',
			`x ${encrypted.sha256Hex}`,
			'n a1a2a3a4a5a6a7a8a9aaabac',
			'v cordn-em-v1',
			'dim 1200x800',
			'alt North ridge panorama',
		])

		const parsed = parseEncryptedMediaImetaTagStrict(tag)
		expect(parsed).toEqual(attachment)

		const decrypted = decryptEncryptedMedia({
			ciphertext: encrypted.ciphertext,
			attachment: parsed,
			epochMediaKey: key,
		})
		expect(decrypted).toEqual(plaintext)
	})

	test('matches Rust earthly-mls pinned cordn-em-v1 wire vector byte-for-byte', () => {
		const key = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
		const nonce = hexToBytes('a0a1a2a3a4a5a6a7a8a9aaab')
		const plaintext = new TextEncoder().encode('Earthly encrypted photo payload')
		const mime = 'image/jpeg'
		const filename = 'field-photo.jpg'

		const encrypted = encryptCordnMedia({ plaintext, mime, filename, key, nonce })
		expect(encrypted.sha256Hex).toBe(
			'0da9e891b44998a85eaba28923148381990229493d0b42f1bd8e78770e28c919',
		)
		expect(bytesToHex(encrypted.ciphertext)).toBe(
			'49ca0a2b258abb8dc5619066858a899ef97ea3d72c1e0f83c4b9a2dd1e03a7f7f34ccf8d6cebacbd116d478371a5f9',
		)

		const decrypted = decryptEncryptedMedia({
			ciphertext: hexToBytes(
				'49ca0a2b258abb8dc5619066858a899ef97ea3d72c1e0f83c4b9a2dd1e03a7f7f34ccf8d6cebacbd116d478371a5f9',
			),
			attachment: {
				url: 'https://blossom.earthly.city/rust-vector',
				mime,
				filename,
				x: '0da9e891b44998a85eaba28923148381990229493d0b42f1bd8e78770e28c919',
				n: 'a0a1a2a3a4a5a6a7a8a9aaab',
				v: CORDN_ENCRYPTED_MEDIA_VERSION,
			},
			epochMediaKey: key,
		})
		expect(decrypted).toEqual(plaintext)
	})

	test('rejects AAD tampering, ciphertext tampering, wrong key, and missing/unknown versions', () => {
		const key = hexToBytes('11'.repeat(32))
		const nonce = hexToBytes('22'.repeat(12))
		const plaintext = new TextEncoder().encode('trail coordinates photo')
		const encrypted = encryptCordnMedia({
			plaintext,
			mime: 'image/png',
			filename: 'photo.png',
			key,
			nonce,
		})
		const validAttachment: EncryptedMediaAttachment = {
			url: 'https://blossom.earthly.city/blob',
			mime: 'image/png',
			filename: 'photo.png',
			x: encrypted.sha256Hex,
			n: encrypted.nonceHex,
			v: CORDN_ENCRYPTED_MEDIA_VERSION,
		}

		// Tampered filename (AAD mismatch)
		expect(() =>
			decryptEncryptedMedia({
				ciphertext: encrypted.ciphertext,
				attachment: { ...validAttachment, filename: 'other.png' },
				epochMediaKey: key,
			}),
		).toThrow()

		// Tampered MIME (AAD mismatch)
		expect(() =>
			decryptEncryptedMedia({
				ciphertext: encrypted.ciphertext,
				attachment: { ...validAttachment, mime: 'image/jpeg' },
				epochMediaKey: key,
			}),
		).toThrow()

		// Tampered ciphertext byte
		const tamperedCipher = new Uint8Array(encrypted.ciphertext)
		tamperedCipher[0] = (tamperedCipher[0] ?? 0) ^ 0xff
		expect(() =>
			decryptEncryptedMedia({
				ciphertext: tamperedCipher,
				attachment: validAttachment,
				epochMediaKey: key,
			}),
		).toThrow()

		// Wrong key
		expect(() =>
			decryptEncryptedMedia({
				ciphertext: encrypted.ciphertext,
				attachment: validAttachment,
				epochMediaKey: hexToBytes('33'.repeat(32)),
			}),
		).toThrow()

		// Missing or unknown version in imeta tag
		expect(() =>
			parseEncryptedMediaImetaTagStrict([
				'imeta',
				'url https://blossom.earthly.city/blob',
				'm image/png',
				'filename photo.png',
				`x ${encrypted.sha256Hex}`,
				`n ${encrypted.nonceHex}`,
			]),
		).toThrow('Missing or unsupported')
		expect(() =>
			parseEncryptedMediaImetaTagStrict([
				'imeta',
				'url https://blossom.earthly.city/blob',
				'm image/png',
				'filename photo.png',
				`x ${encrypted.sha256Hex}`,
				`n ${encrypted.nonceHex}`,
				'v cordn-em-v99',
			]),
		).toThrow('Missing or unsupported')
	})

	test('supports earthly-pm-v1 persistent map media with inline per-blob key for late joiners', () => {
		const plaintext = new TextEncoder().encode('persistent dataset photo bytes')
		const encrypted = encryptPersistentMapMedia({
			plaintext,
			mime: 'image/webp',
			filename: 'ridge.webp',
		})
		expect(encrypted.version).toBe(EARTHLY_PERSISTENT_MEDIA_VERSION)
		expect(encrypted.keyHex).toMatch(/^[0-9a-f]{64}$/u)

		const attachment: EncryptedMediaAttachment = {
			url: 'https://blossom.earthly.city/persistent',
			mime: 'image/webp',
			filename: 'ridge.webp',
			x: encrypted.sha256Hex,
			n: encrypted.nonceHex,
			v: EARTHLY_PERSISTENT_MEDIA_VERSION,
			k: encrypted.keyHex,
		}
		const tag = buildEncryptedMediaImetaTag(attachment)
		expect(tag).toContain(`k ${encrypted.keyHex}`)

		const parsed = parseEncryptedMediaImetaTags([['d', 'ds-1'], tag])
		expect(parsed).toEqual([attachment])
		const first = parsed[0]
		if (!first) throw new Error('Expected parsed persistent media attachment')

		// Late joiner decrypts WITHOUT needing the historical epoch media key
		const decrypted = decryptEncryptedMedia({
			ciphertext: encrypted.ciphertext,
			attachment: first,
		})
		expect(decrypted).toEqual(plaintext)
	})

	test('randomizes attachment filenames without leaking original names', () => {
		const jpg = randomizeAttachmentFilename('image/jpeg; charset=binary')
		const pdf = randomizeAttachmentFilename('application/pdf')
		const other = randomizeAttachmentFilename('application/x-unknown')
		expect(jpg).toMatch(/^[0-9a-f]{32}\.jpg$/u)
		expect(pdf).toMatch(/^[0-9a-f]{32}\.pdf$/u)
		expect(other).toMatch(/^[0-9a-f]{32}\.bin$/u)
		expect(jpg).not.toBe(randomizeAttachmentFilename('image/jpeg'))
	})

	test('strips JPEG APP1 EXIF/GPS and COM segments while keeping JFIF, DQT, SOF0, SOS, EOI', () => {
		const soi = Uint8Array.from([0xff, 0xd8])
		const app0 = Uint8Array.from([0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00])
		const exifPayload = new TextEncoder().encode('Exif\0\0GPS-SECRET-LOCATION')
		const app1Len = exifPayload.length + 2
		const app1 = concatBytes(
			Uint8Array.from([0xff, 0xe1, (app1Len >> 8) & 0xff, app1Len & 0xff]),
			exifPayload,
		)
		const commentPayload = new TextEncoder().encode('Secret Camera Comment')
		const comLen = commentPayload.length + 2
		const com = concatBytes(
			Uint8Array.from([0xff, 0xfe, (comLen >> 8) & 0xff, comLen & 0xff]),
			commentPayload,
		)
		const dqt = Uint8Array.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x10])
		const sof0 = Uint8Array.from([0xff, 0xc0, 0x00, 0x04, 0x08, 0x01])
		const sosAndEoi = Uint8Array.from([0xff, 0xda, 0x00, 0x03, 0x01, 0xaa, 0xbb, 0xff, 0xd9])

		const dirtyJpeg = concatBytes(soi, app0, app1, com, dqt, sof0, sosAndEoi)
		const cleanJpeg = stripImageMetadata(dirtyJpeg, 'image/jpeg')

		expect(cleanJpeg).toEqual(concatBytes(soi, app0, dqt, sof0, sosAndEoi))
		expect(new TextDecoder('latin1').decode(cleanJpeg)).not.toContain('GPS-SECRET-LOCATION')
		expect(new TextDecoder('latin1').decode(cleanJpeg)).not.toContain('Secret Camera Comment')
	})

	test('strips PNG eXIf, tEXt, iTXt, and tIME chunks while preserving IHDR, IDAT, sRGB, IEND', () => {
		const sig = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		const ihdr = makePngChunk('IHDR', new Uint8Array(13))
		const srgb = makePngChunk('sRGB', Uint8Array.from([0]))
		const exif = makePngChunk('eXIf', new TextEncoder().encode('EXIF-GPS-DATA'))
		const text = makePngChunk('tEXt', new TextEncoder().encode('Author\0Alice'))
		const time = makePngChunk('tIME', Uint8Array.from([0x07, 0xea, 11, 27, 12, 0, 0]))
		const idat = makePngChunk('IDAT', Uint8Array.from([1, 2, 3, 4]))
		const iend = makePngChunk('IEND', new Uint8Array(0))

		const dirtyPng = concatBytes(sig, ihdr, srgb, exif, text, time, idat, iend)
		const cleanPng = stripImageMetadata(dirtyPng, 'image/png')

		expect(cleanPng).toEqual(concatBytes(sig, ihdr, srgb, idat, iend))
		expect(new TextDecoder('latin1').decode(cleanPng)).not.toContain('EXIF-GPS-DATA')
		expect(new TextDecoder('latin1').decode(cleanPng)).not.toContain('Author')
	})

	test('uploads encrypted blob to Blossom as octet-stream and downloads + decrypts it', async () => {
		const secretKey = generateSecretKey()
		const signer = async (draft: Parameters<typeof finalizeEvent>[0]) =>
			finalizeEvent(draft, secretKey)
		const epochKey = hexToBytes('44'.repeat(32))
		const plaintext = new TextEncoder().encode('encrypted blossom round-trip payload')
		const storedBlobs = new Map<string, Uint8Array>()

		const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input)
			if (init?.method === 'PUT') {
				const headers = new Headers(init.headers)
				expect(headers.get('content-type')).toBe('application/octet-stream')
				const bodyBytes = new Uint8Array(await (init.body as Blob).arrayBuffer())
				const cipherHash = bytesToHex(sha256(bodyBytes))
				const blobUrl = `https://blossom.test/${cipherHash}`
				storedBlobs.set(blobUrl, bodyBytes)
				return new Response(
					JSON.stringify({ url: blobUrl, sha256: cipherHash, size: bodyBytes.byteLength }),
					{ status: 200, headers: { 'content-type': 'application/json' } },
				)
			}
			const blob = storedBlobs.get(url)
			if (!blob) return new Response('Not found', { status: 404 })
			return new Response(new Uint8Array(blob), {
				status: 200,
				headers: { 'content-length': String(blob.byteLength) },
			})
		}

		const uploaded = await uploadEncryptedMediaToBlossom({
			bytes: plaintext,
			mime: 'text/plain',
			filename: 'my-secret-notes.txt',
			mode: CORDN_ENCRYPTED_MEDIA_VERSION,
			epochMediaKey: epochKey,
			signer,
			blossomServers: 'https://blossom.test',
			fetchImpl,
		})

		expect(uploaded.attachment.filename).not.toBe('my-secret-notes.txt')
		expect(uploaded.attachment.filename).toMatch(/^[0-9a-f]{32}\.txt$/u)
		expect(uploaded.attachment.v).toBe(CORDN_ENCRYPTED_MEDIA_VERSION)

		const downloaded = await downloadAndDecryptMedia({
			attachment: uploaded.attachment,
			epochMediaKey: epochKey,
			fetchImpl,
		})
		expect(downloaded.bytes).toEqual(plaintext)
		expect(downloaded.mime).toBe('text/plain')
	})
})
