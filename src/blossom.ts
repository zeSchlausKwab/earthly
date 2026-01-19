/**
 * Dedicated Blossom Server (BUD-01/BUD-02 compliant)
 *
 * Serves and uploads blobs from/to the map-chunks directory via the Blossom protocol.
 * Run with: bun src/blossom.ts
 *
 * Endpoints:
 *   GET    /<sha256>          - Retrieve blob
 *   GET    /<sha256>.<ext>    - Retrieve blob with extension
 *   HEAD   /<sha256>          - Check blob existence
 *   PUT    /upload            - Upload blob (BUD-02)
 *   HEAD   /upload            - Check upload requirements (BUD-06)
 *   DELETE /<sha256>          - Delete blob
 *   OPTIONS /<sha256>         - CORS preflight
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { mkdir, rm } from 'node:fs/promises'
import { serve } from 'bun'

const PORT = process.env.BLOSSOM_PORT ? parseInt(process.env.BLOSSOM_PORT, 10) : 3001
const isProduction = process.env.NODE_ENV === 'production'
const PUBLIC_URL = isProduction ? 'https://blossom.earthly.city' : `http://localhost:${PORT}`

// In production, map-chunks is relative to cwd; in dev, relative to this file
const MAP_CHUNKS_DIR = isProduction
	? join(process.cwd(), 'map-chunks')
	: join(import.meta.dir, '..', 'map-chunks')

// Blossom BUD-01 CORS headers
const BLOSSOM_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-SHA-256, X-Content-Type, X-Content-Length, *',
	'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE, OPTIONS',
	'Access-Control-Max-Age': '86400',
}

// MIME type mapping for common extensions
const MIME_TYPES: Record<string, string> = {
	pmtiles: 'application/octet-stream',
	pdf: 'application/pdf',
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	json: 'application/json',
	txt: 'text/plain',
}

// Reverse lookup: MIME type to extension
const EXT_FROM_MIME: Record<string, string> = {
	'application/octet-stream': 'pmtiles',
	'application/pdf': 'pdf',
	'image/png': 'png',
	'image/jpeg': 'jpg',
	'image/gif': 'gif',
	'image/webp': 'webp',
	'image/svg+xml': 'svg',
	'application/json': 'json',
	'text/plain': 'txt',
}

function getMimeType(ext: string): string {
	return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

function getExtFromMimeType(mimeType: string): string {
	return EXT_FROM_MIME[mimeType] || 'bin'
}

/**
 * Resolve a Blossom blob by SHA-256 hash.
 * Returns the Bun file handle if found, null otherwise.
 */
async function resolveBlob(
	sha256: string,
): Promise<{ file: ReturnType<typeof Bun.file>; ext: string } | null> {
	// Try to find the file with various extensions
	const extensions = ['pmtiles', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'json']

	for (const ext of extensions) {
		const filePath = join(MAP_CHUNKS_DIR, `${sha256}.${ext}`)
		const f = Bun.file(filePath)
		if (await f.exists()) {
			return { file: f, ext }
		}
	}

	// Also try without extension
	const noExtPath = join(MAP_CHUNKS_DIR, sha256)
	const noExtFile = Bun.file(noExtPath)
	if (await noExtFile.exists()) {
		return { file: noExtFile, ext: '' }
	}

	return null
}

function parseRange(rangeHeader: string, size: number): { start: number; end: number } | null {
	const m = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
	if (!m) return null
	const startRaw = m[1]
	const endRaw = m[2]

	if (startRaw === '' && endRaw === '') return null

	if (startRaw === '') {
		const suffixLength = Number(endRaw)
		if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null
		const end = size - 1
		const start = Math.max(0, size - suffixLength)
		return { start, end }
	}

	const start = Number(startRaw)
	const end = endRaw === '' ? size - 1 : Number(endRaw)

	if (!Number.isFinite(start) || !Number.isFinite(end)) return null
	if (start < 0 || end < 0) return null
	if (start > end) return null
	if (start >= size) return null

	return { start, end: Math.min(end, size - 1) }
}

/**
 * Handle Blossom GET/HEAD requests for blobs
 */
async function handleBlossomBlob(
	sha256: string,
	method: 'GET' | 'HEAD',
	rangeHeader: string | null,
): Promise<Response> {
	const resolved = await resolveBlob(sha256)

	if (!resolved) {
		return new Response('Not Found', {
			status: 404,
			headers: {
				...BLOSSOM_CORS_HEADERS,
				'X-Reason': 'Blob not found',
			},
		})
	}

	const { file, ext } = resolved
	const size = file.size
	const contentType = getMimeType(ext)

	const baseHeaders = {
		...BLOSSOM_CORS_HEADERS,
		'Content-Type': contentType,
		'Content-Length': String(size),
		'Accept-Ranges': 'bytes',
	}

	// HEAD request - return headers only
	if (method === 'HEAD') {
		return new Response(null, { headers: baseHeaders })
	}

	// GET request without range
	if (!rangeHeader) {
		return new Response(file, { headers: baseHeaders })
	}

	// GET request with range
	const parsed = parseRange(rangeHeader, size)
	if (!parsed) {
		return new Response('Range Not Satisfiable', {
			status: 416,
			headers: {
				...BLOSSOM_CORS_HEADERS,
				'Content-Range': `bytes */${size}`,
				'Accept-Ranges': 'bytes',
			},
		})
	}

	const { start, end } = parsed
	const body = file.slice(start, end + 1)
	const contentLength = end - start + 1

	return new Response(body, {
		status: 206,
		headers: {
			...BLOSSOM_CORS_HEADERS,
			'Content-Type': contentType,
			'Accept-Ranges': 'bytes',
			'Content-Length': String(contentLength),
			'Content-Range': `bytes ${start}-${end}/${size}`,
		},
	})
}

/**
 * Handle PUT /upload - BUD-02 blob upload
 */
async function handleUpload(req: Request): Promise<Response> {
	// Ensure map-chunks directory exists
	await mkdir(MAP_CHUNKS_DIR, { recursive: true })

	// Read the body
	const body = await req.arrayBuffer()
	const bodyBuffer = Buffer.from(body)

	// Compute SHA-256 of the blob
	const hash = createHash('sha256')
	hash.update(bodyBuffer)
	const sha256 = hash.digest('hex')

	// Determine file extension from Content-Type
	const contentType = req.headers.get('Content-Type') || 'application/octet-stream'
	const ext = getExtFromMimeType(contentType)

	// Write the file
	const fileName = `${sha256}.${ext}`
	const filePath = join(MAP_CHUNKS_DIR, fileName)
	await Bun.write(filePath, bodyBuffer)

	console.log(`📤 Uploaded blob: ${sha256} (${(bodyBuffer.byteLength / 1024).toFixed(2)} KB)`)

	// Return BUD-02 compliant response
	return Response.json(
		{
			sha256,
			size: bodyBuffer.byteLength,
			type: contentType,
			url: `${PUBLIC_URL}/${sha256}`,
		},
		{
			status: 200,
			headers: BLOSSOM_CORS_HEADERS,
		}
	)
}

/**
 * Handle HEAD /upload - BUD-06 upload requirements check
 */
async function handleUploadCheck(req: Request): Promise<Response> {
	// In development, we accept all uploads without auth
	// Just return 200 OK
	return new Response(null, {
		status: 200,
		headers: BLOSSOM_CORS_HEADERS,
	})
}

/**
 * Handle DELETE /<sha256> - delete blob
 */
async function handleDelete(sha256: string): Promise<Response> {
	const resolved = await resolveBlob(sha256)

	if (!resolved) {
		return new Response('Not Found', {
			status: 404,
			headers: {
				...BLOSSOM_CORS_HEADERS,
				'X-Reason': 'Blob not found',
			},
		})
	}

	// Delete the file
	const filePath = join(MAP_CHUNKS_DIR, resolved.ext ? `${sha256}.${resolved.ext}` : sha256)
	await rm(filePath, { force: true })

	console.log(`🗑️ Deleted blob: ${sha256}`)

	return new Response(null, {
		status: 200,
		headers: BLOSSOM_CORS_HEADERS,
	})
}

// Regex to match Blossom blob requests: /<sha256> or /<sha256>.<ext>
const BLOSSOM_BLOB_REGEX = /^\/([0-9a-f]{64})(?:\.([a-zA-Z0-9]+))?$/

const _server = serve({
	port: PORT,

	async fetch(req) {
		const url = new URL(req.url)
		const pathname = url.pathname
		const method = req.method

		// Handle CORS preflight for any request
		if (method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: BLOSSOM_CORS_HEADERS,
			})
		}

		// Root path - return server info
		if (pathname === '/') {
			return Response.json(
				{
					name: 'earthly-blossom',
					version: '1.0.0',
					description: 'Blossom server for Earthly map-chunks PMTiles',
					environment: isProduction ? 'production' : 'development',
					mapChunksDir: MAP_CHUNKS_DIR,
					endpoints: {
						'GET /<sha256>': 'Retrieve blob',
						'HEAD /<sha256>': 'Check blob existence',
						'PUT /upload': 'Upload blob (BUD-02)',
						'HEAD /upload': 'Check upload requirements (BUD-06)',
						'DELETE /<sha256>': 'Delete blob',
					},
				},
				{
					headers: BLOSSOM_CORS_HEADERS,
				},
			)
		}

		// Handle /upload endpoint
		if (pathname === '/upload') {
			if (method === 'PUT') {
				return handleUpload(req)
			}
			if (method === 'HEAD') {
				return handleUploadCheck(req)
			}
		}

		// Check if this is a Blossom blob request
		const blobMatch = pathname.match(BLOSSOM_BLOB_REGEX)
		if (blobMatch && blobMatch[1]) {
			const sha256 = blobMatch[1]

			if (method === 'GET' || method === 'HEAD') {
				const rangeHeader = req.headers.get('range')
				return handleBlossomBlob(sha256, method, rangeHeader)
			}

			if (method === 'DELETE') {
				return handleDelete(sha256)
			}
		}

		// Unknown route
		return new Response('Not Found', {
			status: 404,
			headers: BLOSSOM_CORS_HEADERS,
		})
	},
})

console.log(`🌸 Blossom server running at http://localhost:${PORT}/`)
console.log(`📂 Serving map-chunks from: ${MAP_CHUNKS_DIR}`)
console.log(`🌍 Environment: ${isProduction ? 'production' : 'development'}`)
console.log(`📤 Upload endpoint: PUT http://localhost:${PORT}/upload`)

