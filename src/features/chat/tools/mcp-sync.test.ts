/**
 * Offline tests for poll-based MCP tool hot-reload (D-05 / D-04).
 *
 * `client.listTools()` is MOCKED (deterministic, no network): we assert that
 *  - synced tools register as kind:'remote-mcp' with origin = SERVER_PUBKEY (T-02-17),
 *  - a changed manifest converges via register/unregister (D-05 hot-reload),
 *  - `advertise()` reflects the live manifest (D-04),
 *  - a `listTools()` failure degrades gracefully to the last-known set (T-02-18),
 *  - NO push handler is wired (Pitfall 3) — asserted by source grep.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { advertise, registry } from './registry'
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
	names: Array<{ name: string; description?: string; properties?: Record<string, unknown>; required?: string[] }>,
): ListToolsResult {
	return {
		tools: names.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: { type: 'object', properties: t.properties ?? {}, required: t.required },
		})),
	} as unknown as ListToolsResult
}

afterEach(() => {
	__resetMcpSyncForTests()
})

describe('mcp-sync (poll-based hot-reload)', () => {
	it('registers manifest tools as kind:remote-mcp with origin = SERVER_PUBKEY (T-02-17)', async () => {
		const client = mockClient(() =>
			manifest([
				{ name: 'create_map_upload', description: 'Upload a map extract', properties: { id: { type: 'string', description: 'request id' } }, required: ['id'] },
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
