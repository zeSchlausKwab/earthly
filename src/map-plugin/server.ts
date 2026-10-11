import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { PublicMapDraftStore, PublicMapSession, type MapGateway } from './service'
import { createMapMcpServer } from './mcp'
import { readPublicMap } from './gateway'
import { decodeMapReference, escapeHtml } from './references'
import { parseViewOptions } from '@/features/public-map/model'

const SESSION_TTL_MS = 2 * 60 * 60 * 1000
const MAX_REQUEST_BYTES = 96 * 1024
interface SessionEntry {
	server: McpServer
	transport: WebStandardStreamableHTTPServerTransport
	maps: PublicMapSession
}
export interface MapServerOptions {
	baseUrl: string
	gateway: MapGateway
	assets: Map<string, { body: Blob | string; type: string }>
	release?: string
}

export function viewerHtml(
	baseUrl: string,
	mode: 'mcp' | 'page' | 'embed',
	reference = '',
): string {
	const origin = escapeHtml(baseUrl)
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Earthly map</title><link rel="stylesheet" href="${origin}/assets/viewer.css"></head><body data-mode="${mode}"><div id="root" data-server="${origin}" data-mode="${mode}" data-reference="${escapeHtml(reference)}"></div><script type="module" src="${origin}/assets/viewer.js"></script></body></html>`
}

export function createMapHttpHandler({
	baseUrl,
	gateway,
	assets,
	release = 'development',
}: MapServerOptions) {
	const sessions = new Map<string, SessionEntry>()
	const drafts = new PublicMapDraftStore()
	const origin = new URL(baseUrl).origin
	if (origin !== baseUrl)
		throw new Error('Map public URL must be an origin without a path or trailing slash')
	const destroy = async (id: string) => {
		const session = sessions.get(id)
		if (!session) return
		sessions.delete(id)
		session.maps.dispose()
		await session.server.close()
	}
	const sweep = setInterval(() => {
		drafts.sweep()
		for (const [id, session] of sessions) if (Date.now() >= session.maps.expiresAt) void destroy(id)
	}, 60_000)
	sweep.unref()
	const publicHeaders = { 'Access-Control-Allow-Origin': '*', 'X-Content-Type-Options': 'nosniff' }
	async function fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)
		if (url.host !== new URL(baseUrl).host)
			return new Response('Unrecognized host', { status: 403 })
		if (url.pathname !== '/mcp') {
			if (request.method !== 'GET' && request.method !== 'HEAD')
				return new Response('Method not allowed', { status: 405 })
			const asset = assets.get(url.pathname)
			if (asset)
				return new Response(request.method === 'HEAD' ? null : asset.body, {
					headers: {
						...publicHeaders,
						'Content-Type': asset.type,
						'Cache-Control': 'public, max-age=300',
					},
				})
			if (url.pathname === '/health')
				return Response.json(
					{ status: 'ok', service: 'earthly-public-maps', release, relays: gateway.relays },
					{ headers: publicHeaders },
				)
			if (url.pathname === '/component')
				return new Response(viewerHtml(baseUrl, 'mcp'), {
					headers: { ...publicHeaders, 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
				})
			try {
				const match = url.pathname.match(/^\/(maps|embed|api\/maps)\/([^/]+)$/)
				if (!match)
					return new Response(
						'Earthly public map plugin. Connect an MCP client to /mcp, or open a published map link.',
						{ status: url.pathname === '/' ? 200 : 404 },
					)
				const reference = decodeURIComponent(match[2]!)
				decodeMapReference(reference)
				parseViewOptions(url.searchParams)
				if (match[1] === 'api/maps')
					return Response.json(await readPublicMap(gateway, baseUrl, reference), {
						headers: { ...publicHeaders, 'Cache-Control': 'no-store' },
					})
				return new Response(
					viewerHtml(baseUrl, match[1] === 'embed' ? 'embed' : 'page', reference),
					{
						headers: { ...publicHeaders, 'Content-Type': 'text/html', 'Cache-Control': 'no-store' },
					},
				)
			} catch (error) {
				return Response.json(
					{ error: error instanceof Error ? error.message : 'Map could not be read' },
					{ status: 400, headers: publicHeaders },
				)
			}
		}
		const requestOrigin = request.headers.get('Origin')
		if (requestOrigin && ![origin, 'https://chatgpt.com'].includes(requestOrigin))
			return new Response('Origin not allowed', { status: 403 })
		const cors = {
			'Access-Control-Allow-Origin': requestOrigin ?? origin,
			'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
			'Access-Control-Allow-Headers':
				'Content-Type, Accept, MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID',
			'Access-Control-Expose-Headers': 'MCP-Session-Id',
			Vary: 'Origin',
			'Cache-Control': 'no-store',
		}
		if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
		try {
			let parsedBody: unknown
			if (request.method === 'POST') {
				if (!request.headers.get('Content-Type')?.includes('application/json'))
					return new Response('Expected application/json', { status: 415 })
				const bytes = await request.arrayBuffer()
				if (bytes.byteLength > MAX_REQUEST_BYTES)
					return new Response('Request exceeds map pilot limit', { status: 413 })
				parsedBody = JSON.parse(new TextDecoder().decode(bytes))
			}
			const id = request.headers.get('mcp-session-id')
			let entry = id ? sessions.get(id) : undefined
			if (entry && Date.now() >= entry.maps.expiresAt) {
				await destroy(id!)
				entry = undefined
			}
			if (id && !entry)
				return Response.json(
					{ error: 'Editing session expired or unknown. Initialize a new session.' },
					{ status: 404, headers: cors },
				)
			if (!entry) {
				if (!isInitializeRequest(parsedBody))
					return Response.json(
						{ error: 'Initialize an MCP session first' },
						{ status: 400, headers: cors },
					)
				if (sessions.size >= 64)
					return new Response('Too many editing sessions; try later', {
						status: 503,
						headers: cors,
					})
				const maps = new PublicMapSession(gateway, baseUrl, Date.now() + SESSION_TTL_MS, drafts)
				const server = createMapMcpServer(maps, gateway, baseUrl, viewerHtml(baseUrl, 'mcp'))
				const transport = new WebStandardStreamableHTTPServerTransport({
					sessionIdGenerator: () => crypto.randomUUID(),
					enableJsonResponse: true,
					onsessioninitialized: (sessionId) => {
						sessions.set(sessionId, { maps, server, transport })
					},
					onsessionclosed: (sessionId) => destroy(sessionId),
				})
				await server.connect(transport)
				entry = { maps, server, transport }
			}
			const response = await entry.transport.handleRequest(request, { parsedBody })
			if (!entry.transport.sessionId) {
				entry.maps.dispose()
				await entry.server.close()
			}
			for (const [name, value] of Object.entries(cors)) response.headers.set(name, value)
			return response
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : 'Invalid MCP request' },
				{ status: 400, headers: cors },
			)
		}
	}
	return {
		fetch,
		close: async () => {
			clearInterval(sweep)
			await Promise.all([...sessions.keys()].map(destroy))
			drafts.dispose()
		},
	}
}
