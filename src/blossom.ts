/**
 * Dedicated Blossom Server (BUD-01 compliant)
 *
 * Serves blobs from the map-chunks directory via the Blossom protocol.
 * Run with: bun src/blossom.ts
 *
 * Endpoints:
 *   GET  /<sha256>          - Retrieve blob
 *   GET  /<sha256>.<ext>    - Retrieve blob with extension
 *   HEAD /<sha256>          - Check blob existence
 *   OPTIONS /<sha256>       - CORS preflight
 */

import { fileURLToPath } from 'node:url'
import { serve } from 'bun'

const PORT = process.env.BLOSSOM_PORT ? parseInt(process.env.BLOSSOM_PORT, 10) : 3001

// Blossom BUD-01 CORS headers
const BLOSSOM_CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Headers': 'Authorization, *',
	'Access-Control-Allow-Methods': 'GET, HEAD, PUT, DELETE',
	'Access-Control-Max-Age': '86400'
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
	txt: 'text/plain'
}

function getMimeType(ext: string): string {
	return MIME_TYPES[ext.toLowerCase()] || 'application/octet-stream'
}

/**
 * Resolve a Blossom blob by SHA-256 hash.
 * Returns the Bun file handle if found, null otherwise.
 */
async function resolveBlob(
	sha256: string
): Promise<{ file: ReturnType<typeof Bun.file>; ext: string } | null> {
	const mapChunksDir = fileURLToPath(new URL('../map-chunks/', import.meta.url))

	// Try to find the file with various extensions
	const extensions = ['pmtiles', 'pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'json']

	for (const ext of extensions) {
		const filePath = `${mapChunksDir}${sha256}.${ext}`
		const f = Bun.file(filePath)
		if (await f.exists()) {
			return { file: f, ext }
		}
	}

	// Also try without extension
	const noExtPath = `${mapChunksDir}${sha256}`
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
	rangeHeader: string | null
): Promise<Response> {
	const resolved = await resolveBlob(sha256)

	if (!resolved) {
		return new Response('Not Found', {
			status: 404,
			headers: {
				...BLOSSOM_CORS_HEADERS,
				'X-Reason': 'Blob not found'
			}
		})
	}

	const { file, ext } = resolved
	const size = file.size
	const contentType = getMimeType(ext)

	const baseHeaders = {
		...BLOSSOM_CORS_HEADERS,
		'Content-Type': contentType,
		'Content-Length': String(size),
		'Accept-Ranges': 'bytes'
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
				'Accept-Ranges': 'bytes'
			}
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
			'Content-Range': `bytes ${start}-${end}/${size}`
		}
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
				headers: BLOSSOM_CORS_HEADERS
			})
		}

		// Root path - return server info
		if (pathname === '/') {
			return Response.json(
				{
					name: 'map-chunker-blossom',
					version: '1.0.0',
					description: 'Blossom server for map-chunks PMTiles'
				},
				{
					headers: BLOSSOM_CORS_HEADERS
				}
			)
		}

		// Check if this is a Blossom blob request
		const blobMatch = pathname.match(BLOSSOM_BLOB_REGEX)
		if (blobMatch && (method === 'GET' || method === 'HEAD')) {
			const sha256 = blobMatch[1]
			const rangeHeader = req.headers.get('range')
			return handleBlossomBlob(sha256, method, rangeHeader)
		}

		// Unknown route
		return new Response('Not Found', {
			status: 404,
			headers: BLOSSOM_CORS_HEADERS
		})
	}
})

console.log(`🌸 Blossom server running at http://localhost:${PORT}/`)
