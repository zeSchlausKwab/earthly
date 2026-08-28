/**
 * Offline tests for poll-based MCP tool hot-reload (D-05 / D-04).
 *
 * `client.listTools()` is MOCKED (deterministic, no network): we assert that
 *  - synced tools register as kind:'remote-mcp' with origin = SERVER_PUBKEY (T-02-17),
 *  - a changed manifest converges via register/unregister (D-05 hot-reload),
 *  - `advertise()` reflects the live manifest (D-04),
 *  - a `listTools()` failure degrades gracefully to the last-known set (T-02-18),
 *  - sync PRESERVES bootstrapped/local rich handlers and only adds genuinely-new
 *    remote tools (CR-01) — never clobbering a hand-written handler by name,
 *  - NO push handler is wired (Pitfall 3) — asserted by source grep.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { advertise, register, registry, unregister } from './registry'
import type { ToolEntry } from './registry'
import {
	__resetMcpSyncForTests,
	getSyncedMcpToolNames,
	isMcpSyncActive,
	syncMcpTools,
} from './mcp-sync'

const ORIGIN = EarthlyGeoServerClient.SERVER_PUBKEY

type ListToolsResult = Awaited<ReturnType<EarthlyGeoServerClient['listTools']>>

/** A minimal stand-in for EarthlyGeoServerClient exposing only listTools(). */
function mockClient(
	impl: () => Promise<ListToolsResult> | ListToolsResult,
): Pick<EarthlyGeoServerClient, 'listTools'> {
	return { listTools: async () => impl() }
}

function manifest(
	names: Array<{
		name: string
		description?: string
		properties?: Record<string, unknown>
		required?: string[]
	}>,
): ListToolsResult {
	return {
		tools: names.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: { type: 'object', properties: t.properties ?? {}, required: t.required },
		})),
	} as unknown as ListToolsResult
}

/**
 * Build a sentinel "local" (bootstrapped/non-synced) entry under `name`. Its
 * identity (kind:'host-builtin' + a tagged handler) lets a test prove the sync
 * left the handler untouched.
 */
function makeLocalEntry(name: string): ToolEntry {
	const handler = (() => ({ sentinel: name })) as ToolEntry['handler']
	;(handler as { __local?: true }).__local = true
	return {
		name,
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name,
				description: 'sentinel local handler',
				parameters: { type: 'object', properties: {} },
			},
		},
		handler,
	}
}

/** Names this test seeds as local handlers — cleaned up after each case. */
const seededLocalNames: string[] = []
function seedLocalEntry(name: string): ToolEntry {
	const entry = makeLocalEntry(name)
	register(entry)
	seededLocalNames.push(name)
	return entry
}

afterEach(() => {
	__resetMcpSyncForTests()
	for (const name of seededLocalNames.splice(0)) {
		unregister(name)
	}
})

describe('mcp-sync (poll-based hot-reload)', () => {
	it('cannot remove the permanent query_geography handler when a live manifest omits it', async () => {
		const local = registry.get('query_geography')
		expect(local?.kind).toBe('remote-mcp')

		await syncMcpTools(mockClient(() => manifest([{ name: 'manifest_only_tool' }])))

		expect(registry.get('query_geography')).toBe(local)
		expect(getSyncedMcpToolNames()).not.toContain('query_geography')
	})

	it('registers manifest tools as kind:remote-mcp with origin = SERVER_PUBKEY (T-02-17)', async () => {
		const client = mockClient(() =>
			manifest([
				{
					name: 'create_map_upload',
					description: 'Upload a map extract',
					properties: { id: { type: 'string', description: 'request id' } },
					required: ['id'],
				},
				{ name: 'spike_only_tool', description: 'A tool only the live server knows' },
			]),
		)

		const result = await syncMcpTools(client)

		expect(result.ok).toBe(true)
		expect(result.registered).toBe(2)
		expect(isMcpSyncActive()).toBe(true)

		const uploaded = registry.get('create_map_upload')
		expect(uploaded).toBeDefined()
		expect(uploaded?.kind).toBe('remote-mcp')
		expect(uploaded?.origin).toBe(ORIGIN)
		// Schema projected from inputSchema.
		expect(uploaded?.schema.function.name).toBe('create_map_upload')
		expect(uploaded?.schema.function.parameters.properties.id?.type).toBe('string')
		expect(uploaded?.schema.function.parameters.required).toEqual(['id'])

		// D-04: advertise() reflects the live manifest.
		const advertised = advertise().map((t) => t.function.name)
		expect(advertised).toContain('create_map_upload')
		expect(advertised).toContain('spike_only_tool')
	})

	it('preserves a bootstrapped/local handler matching a manifest name — does NOT clobber it (CR-01)', async () => {
		// A bootstrapped rich handler is registered locally under a name that the
		// live manifest ALSO advertises (the real-world collision: query_osm_bbox etc.).
		const local = seedLocalEntry('query_osm_bbox')
		expect(registry.get('query_osm_bbox')).toBe(local)

		const client = mockClient(() =>
			manifest([
				{ name: 'query_osm_bbox', description: 'live manifest version' },
				{ name: 'spike_only_tool', description: 'genuinely new remote tool' },
			]),
		)
		const result = await syncMcpTools(client)

		expect(result.ok).toBe(true)
		// The local handler was preserved (not registered), the new tool was registered.
		expect(result.preserved).toBe(1)
		expect(result.registered).toBe(1)

		// The local entry's identity is unchanged — same object, host-builtin kind,
		// tagged sentinel handler (NOT the bare remote-mcp passthrough).
		const after = registry.get('query_osm_bbox')
		expect(after).toBe(local)
		expect(after?.kind).toBe('host-builtin')
		expect((after?.handler as { __local?: true }).__local).toBe(true)

		// This module never claims ownership of the preserved local name.
		expect(getSyncedMcpToolNames()).not.toContain('query_osm_bbox')
		expect(getSyncedMcpToolNames()).toContain('spike_only_tool')

		// advertise() still reflects manifest membership for both.
		const advertised = advertise().map((t) => t.function.name)
		expect(advertised).toContain('query_osm_bbox')
		expect(advertised).toContain('spike_only_tool')
	})

	it('registers a genuinely-new manifest tool as kind:remote-mcp (not previously in registry)', async () => {
		expect(registry.has('brand_new_remote_tool')).toBe(false)
		const client = mockClient(() => manifest([{ name: 'brand_new_remote_tool' }]))

		const result = await syncMcpTools(client)

		expect(result.registered).toBe(1)
		expect(result.preserved).toBe(0)
		const entry = registry.get('brand_new_remote_tool')
		expect(entry?.kind).toBe('remote-mcp')
		expect(entry?.origin).toBe(ORIGIN)
		expect(getSyncedMcpToolNames()).toContain('brand_new_remote_tool')
	})

	it('never unregisters a local handler even when it is absent from a later manifest (CR-01)', async () => {
		const local = seedLocalEntry('query_osm_area')
		// First sync: manifest includes the local-name + a synced-only tool.
		const first = mockClient(() => manifest([{ name: 'query_osm_area' }, { name: 'synced_only' }]))
		await syncMcpTools(first)
		expect(registry.get('query_osm_area')).toBe(local) // preserved
		expect(registry.has('synced_only')).toBe(true)

		// Later manifest drops BOTH names. Only the synced-only tool is unregistered.
		const second = mockClient(() => manifest([{ name: 'something_else' }]))
		const result = await syncMcpTools(second)

		expect(result.unregistered).toBe(1) // synced_only only
		expect(registry.get('query_osm_area')).toBe(local) // local handler untouched
		expect(registry.has('synced_only')).toBe(false)
		expect(registry.has('something_else')).toBe(true)
	})

	it('converges via register + unregister when the manifest changes (D-05)', async () => {
		const client = mockClient(() => manifest([{ name: 'tool_a' }, { name: 'tool_b' }]))
		await syncMcpTools(client)
		expect(getSyncedMcpToolNames().sort()).toEqual(['tool_a', 'tool_b'])
		expect(registry.has('tool_a')).toBe(true)
		expect(registry.has('tool_b')).toBe(true)

		// Manifest drops tool_b, adds tool_c.
		const changed = mockClient(() => manifest([{ name: 'tool_a' }, { name: 'tool_c' }]))
		const result = await syncMcpTools(changed)

		expect(result.unregistered).toBe(1)
		expect(registry.has('tool_a')).toBe(true)
		expect(registry.has('tool_b')).toBe(false) // unregistered — vanished from manifest
		expect(registry.has('tool_c')).toBe(true) // newly registered
		expect(getSyncedMcpToolNames().sort()).toEqual(['tool_a', 'tool_c'])
	})

	it('degrades gracefully on listTools() failure — keeps the last-known set (T-02-18)', async () => {
		const good = mockClient(() => manifest([{ name: 'tool_a' }, { name: 'tool_b' }]))
		await syncMcpTools(good)
		expect(registry.has('tool_a')).toBe(true)
		expect(registry.has('tool_b')).toBe(true)

		const failing = mockClient(() => {
			throw new Error('listTools timed out')
		})
		const result = await syncMcpTools(failing)

		expect(result.ok).toBe(false)
		expect(result.error).toContain('timed out')
		expect(isMcpSyncActive()).toBe(false)
		// Last-known entries remain — no crash, no registry wipe.
		expect(registry.has('tool_a')).toBe(true)
		expect(registry.has('tool_b')).toBe(true)
		expect(getSyncedMcpToolNames().sort()).toEqual(['tool_a', 'tool_b'])
	})

	it('ignores malformed manifest entries (T-02-19 tampering guard)', async () => {
		const client = mockClient(
			() =>
				({
					tools: [
						{ name: 'valid_tool', inputSchema: { type: 'object', properties: {} } },
						{ name: '', inputSchema: { type: 'object' } }, // empty name → rejected
						{ inputSchema: { type: 'object' } }, // no name → rejected
					],
				}) as unknown as ListToolsResult,
		)
		const result = await syncMcpTools(client)
		expect(result.registered).toBe(1)
		expect(registry.has('valid_tool')).toBe(true)
	})

	it('does NOT wire a push notification handler (Pitfall 3 — poll only)', async () => {
		const source = await Bun.file(new URL('./mcp-sync.ts', import.meta.url)).text()
		expect(source).not.toContain('setNotificationHandler')
		expect(source).not.toContain('notifications/tools/list_changed')
	})
})
