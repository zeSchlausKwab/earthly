import { expect, test } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { NostrEvent } from 'nostr-tools'
import { createMapHttpHandler } from './server'
import { MAP_RESOURCE_URI } from './mcp'
import { DEMO_MAP } from './fixtures'
import type { MapGateway } from './service'

test('real MCP client discovers UI, previews, publishes, reopens and embeds with isolated sessions', async () => {
	let event: NostrEvent | null = null
	const gateway: MapGateway = {
		relays: ['ws://127.0.0.1:3334'],
		read: async () => event,
		publish: async (value) => {
			event = value
			return [{ from: 'ws://127.0.0.1:3334', ok: true }]
		},
	}
	const handler = createMapHttpHandler({
		baseUrl: 'http://127.0.0.1:3337',
		gateway,
		assets: new Map(),
		release: 'release-under-test',
	})
	const connect = async () => {
		const client = new Client({ name: 'test-client', version: '1.0.0' })
		const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:3337/mcp'), {
			fetch: async (input, init) => handler.fetch(new Request(input, init)),
		})
		await client.connect(transport)
		return { client, transport }
	}
	const first = await connect()
	const second = await connect()
	try {
		const tools = (await first.client.listTools()).tools
		expect(tools.map((tool) => tool.name)).toContain('get_map_embed')
		// Regression: ChatGPT rejects tuple-style items and oneOf in tool schemas.
		const checkSchema = (value: unknown) => {
			if (!value || typeof value !== 'object') return
			const schema = value as Record<string, unknown>
			if (schema.type === 'array') {
				expect(schema.items).toBeDefined()
				expect(Array.isArray(schema.items)).toBe(false)
			}
			expect(schema).not.toHaveProperty('oneOf')
			for (const child of Object.values(schema)) checkSchema(child)
		}
		for (const tool of tools) checkSchema(tool.inputSchema)
		const invalidPreview = await first.client.callTool({
			name: 'preview_map',
			arguments: {
				title: 'Invalid point',
				data: {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: {},
							geometry: { type: 'Point', coordinates: [10, 100] },
						},
					],
				},
			},
		})
		expect(invalidPreview.isError).toBe(true)
		expect(event).toBeNull()
		const health = await handler.fetch(new Request('http://127.0.0.1:3337/health'))
		expect(await health.json()).toMatchObject({
			service: 'earthly-public-maps',
			release: 'release-under-test',
		})
		const resource = await first.client.readResource({ uri: MAP_RESOURCE_URI })
		expect(resource.contents[0]!.mimeType).toBe('text/html;profile=mcp-app')
		const preview = await first.client.callTool({
			name: 'preview_map',
			arguments: { title: 'Map contract', data: DEMO_MAP },
		})
		expect(preview.isError).toBeUndefined()
		expect(event).toBeNull()
		const { draftId, revision } = preview.structuredContent as { draftId: string; revision: number }
		const args = { draftId, revision, visibility: 'public' }
		const forbidden = await second.client.callTool({ name: 'publish_map', arguments: args })
		expect(forbidden.isError).toBe(true)
		const result = await first.client.callTool({ name: 'publish_map', arguments: args })
		expect(result.isError).toBeUndefined()
		const { reference } = result.structuredContent as { reference: string }
		const reopened = await second.client.callTool({ name: 'read_map', arguments: { reference } })
		expect(reopened.isError).toBeUndefined()
		const embedded = await first.client.callTool({
			name: 'get_map_embed',
			arguments: { reference, view: { theme: 'dark', legend: false } },
		})
		expect(embedded.isError).toBeUndefined()
		expect(embedded.structuredContent).toHaveProperty('html')
		const api = await handler.fetch(new Request(`http://127.0.0.1:3337/api/maps/${reference}`))
		expect(api.status).toBe(200)
		expect((await api.json()).data.features).toHaveLength(3)
		const page = await handler.fetch(
			new Request(`http://127.0.0.1:3337/embed/${reference}?legend=false`),
		)
		expect(await page.text()).toContain('data-mode="embed"')
		await first.transport.terminateSession()
		expect(
			(await handler.fetch(new Request(`http://127.0.0.1:3337/api/maps/${reference}`))).status,
		).toBe(200)
	} finally {
		await first.client.close()
		await second.client.close()
		await handler.close()
	}
})

test('HTTP boundary rejects cross-origin writes and invalid publication requests', async () => {
	const gateway: MapGateway = {
		relays: [],
		read: async () => null,
		publish: async () => {
			throw new Error('Must not publish')
		},
	}
	const handler = createMapHttpHandler({
		baseUrl: 'http://127.0.0.1:3337',
		gateway,
		assets: new Map(),
	})
	try {
		expect(
			(
				await handler.fetch(
					new Request('http://127.0.0.1:3337/mcp', {
						method: 'POST',
						headers: { Origin: 'https://unrelated.example' },
					}),
				)
			).status,
		).toBe(403)
		expect((await handler.fetch(new Request('http://evil.example/mcp'))).status).toBe(403)
		expect(
			(
				await handler.fetch(
					new Request('http://127.0.0.1:3337/mcp', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ method: 'tools/call' }),
					}),
				)
			).status,
		).toBe(400)
	} finally {
		await handler.close()
	}
})
