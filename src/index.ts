import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils'
import { file, serve } from 'bun'
import { getPublicKey } from 'nostr-tools/pure'

const isProduction = process.env.NODE_ENV === 'production'

console.log(`Starting server in ${isProduction ? 'production' : 'development'} mode`)
console.log(`NODE_ENV: ${process.env.NODE_ENV}`)

// Get the expected pubkey for migration auth
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY
const EXPECTED_PUBKEY = APP_PRIVATE_KEY ? getPublicKey(hexToBytes(APP_PRIVATE_KEY)) : undefined

// CORS headers for API responses
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

// Helper to create JSON response with CORS headers
function jsonResponse(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		...init,
		headers: {
			...CORS_HEADERS,
			...init?.headers
		}
	})
}

async function readAnnouncement() {
	const jsonPath = new URL('../map-chunks/announcement.json', import.meta.url)

	const jsonFile = Bun.file(jsonPath)
	if (await jsonFile.exists()) return await jsonFile.json()

	return null
}

// Define route handlers that work in both modes
const apiRoutes: Record<string, any> = {
	'/api/hello': {
		async GET(_req) {
			return Response.json({
				message: 'Hello, world!',
				method: 'GET'
			})
		},
		async PUT(_req) {
			return Response.json({
				message: 'Hello, world!',
				method: 'PUT'
			})
		}
	},

	'/api/announcement': {
		async GET() {
			const data = await readAnnouncement()
			if (!data) {
				return jsonResponse({ error: 'Missing announcement file' }, { status: 404 })
			}
			return jsonResponse(data)
		}
	},

	'/api/hello/:name': async (req) => {
		const name = req.params.name
		return Response.json({
			message: `Hello, ${name}!`
		})
	},

	'/api/app-pubkey': {
		async GET() {
			return Response.json({
				pubkey: EXPECTED_PUBKEY || null
			})
		}
	}
}

// Add debug endpoints in development only
if (!isProduction) {
	apiRoutes['/api/debug/pubkey'] = {
		async GET() {
			return Response.json({
				hasPrivateKey: !!APP_PRIVATE_KEY,
				expectedPubkey: EXPECTED_PUBKEY || 'NOT SET',
				nodeEnv: process.env.NODE_ENV
			})
		}
	}
}
// Start server
;(async () => {
	if (isProduction) {
		// Production: Serve static files from dist/ and public/
		const server = serve({
			routes: {
				...apiRoutes,
				'/*': async (req) => {
					const url = new URL(req.url)
					const pathname = url.pathname === '/' ? '/index.html' : url.pathname

					// Try to serve from public/ first (for static assets like images)
					const publicPath = join(process.cwd(), 'public', pathname)
					const publicFile = file(publicPath)

					if (await publicFile.exists()) {
						return new Response(publicFile)
					}

					// Try to serve from dist/ (built assets)
					const filePath = join(process.cwd(), 'dist', pathname)
					const staticFile = file(filePath)

					if (await staticFile.exists()) {
						return new Response(staticFile)
					}

					// If file not found, serve index.html for client-side routing
					return new Response(file(join(process.cwd(), 'dist', 'index.html')))
				}
			}
		})

		console.log(`🚀 Server running at ${server.url} (production)`)
	} else {
		// Development: Use Bun's bundler with HMR
		const index = (await import('./index.html')).default

		const server = serve({
			routes: {
				...apiRoutes,
				// Serve static files from public/ directory
				'/images/*': async (req) => {
					const url = new URL(req.url)
					const filePath = join(process.cwd(), 'public', url.pathname)
					const staticFile = file(filePath)

					if (await staticFile.exists()) {
						return new Response(staticFile)
					}

					return new Response('Not found', { status: 404 })
				},
				// Catch-all for SPA routing
				'/*': index
			},

			development: {
				hmr: true,
				console: true
			}
		})

		console.log(`🚀 Server running at ${server.url} (development)`)
	}
})()
