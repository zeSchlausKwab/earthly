/**
 * THROWAWAY DEV SPIKE — Plan 02-06 Task 1 (A1 gate, checkpoint:human-verify).
 *
 * Calls EarthlyGeoServerClient.listTools() against the LIVE ContextVM geo server
 * (pubkey ceadb7d5…) over the stateless Nostr transport and logs the returned
 * tool manifest. This network-tests the UNVERIFIED assumption A1: does the live
 * server actually implement the `tools/list` MCP method?
 *
 * Run with a configured signer (Bun auto-loads .env → CLIENT_KEY / SERVER_PUBKEY /
 * relays); the relay must be reachable:
 *
 *   bun relay        # in one terminal (or rely on the public relays in DEFAULT_RELAYS)
 *   bun run scripts/spike-list-mcp-tools.ts
 *
 * SUCCESS = a non-empty `tools` array is printed (compare names against the 14
 *           hardcoded MCP tools below) → reply "supported", proceed to Task 2.
 * FAILURE = errors, times out, or returns empty / "method not found"
 *           → reply "unsupported — fall back", drop Task 2, keep the hardcoded list.
 *
 * DELETE this file once the A1 gate is resolved (it is promoted into mcp-sync.ts).
 */
import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'

// The 14 MCP tool names currently hand-transcribed in definitions.ts (via the client),
// for comparison against whatever the live server advertises.
const HARDCODED_MCP_TOOL_NAMES = [
	'search_location',
	'reverse_lookup',
	'query_osm_by_id',
	'query_osm_nearby',
	'query_osm_bbox',
	'resolve_osm_entity',
	'get_osm_relation_geometry',
	'get_country_boundary',
	'valhalla_route',
	'valhalla_isochrone',
	'web_search',
	'fetch_url',
	'wikipedia_lookup',
	'create_map_extract',
] as const

const TIMEOUT_MS = 20_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return Promise.race([
		p,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(`listTools() timed out after ${ms}ms`)), ms),
		),
	])
}

async function main() {
	console.log('[spike] instantiating EarthlyGeoServerClient (auto-connects)…')
	const client = new EarthlyGeoServerClient()

	// Give the constructor's auto-connect a moment to establish the stateless transport.
	await new Promise((r) => setTimeout(r, 1500))

	console.log('[spike] calling listTools() against the live server…')
	try {
		const result = await withTimeout(client.listTools(), TIMEOUT_MS)
		const tools = result?.tools ?? []
		console.log(`[spike] RESULT: server returned ${tools.length} tool(s).`)
		console.log(
			'[spike] tool names:',
			JSON.stringify(
				tools.map((t) => t.name),
				null,
				2,
			),
		)
		console.log('[spike] full manifest:', JSON.stringify(tools, null, 2))

		if (tools.length === 0) {
			console.log('\n[spike] VERDICT: FAILURE — empty tools array. → "unsupported — fall back".')
		} else {
			const returned = new Set(tools.map((t) => t.name))
			const missing = HARDCODED_MCP_TOOL_NAMES.filter((n) => !returned.has(n))
			console.log('\n[spike] VERDICT: SUCCESS — non-empty manifest. → "supported".')
			console.log(
				`[spike] coverage vs hardcoded: ${HARDCODED_MCP_TOOL_NAMES.length - missing.length}/${HARDCODED_MCP_TOOL_NAMES.length} present.`,
			)
			if (missing.length > 0) {
				console.log('[spike] hardcoded names NOT in live manifest:', missing)
			}
		}
	} catch (err) {
		console.error('[spike] VERDICT: FAILURE — listTools() threw/timed out:', err)
		console.error('[spike] → reply "unsupported — fall back" (drop Task 2, keep hardcoded list).')
	} finally {
		await client.disconnect().catch(() => {})
		// Stateless transport / relay sockets can keep the loop alive; exit explicitly.
		process.exit(0)
	}
}

main()
