/**
 * Tool definitions for AI chat.
 *
 * The advertised tool list is DERIVED from live registry state (D-04/D-06)
 * — `registry.advertise()` is the single source of truth. The registry
 * self-populates on import (built-ins, editor writers, remote-mcp tools, and
 * the self-registered `editor_*` commands), so this module exposes the derived
 * list.
 *
 * D-05 hot-reload: when poll-based MCP sync is active (`mcp-sync.syncMcpTools()`
 * has applied a live manifest), the registry's `remote-mcp` entries reflect the
 * live server manifest, so `getGeoTools()` advertises the synced set. If sync
 * has not run or failed (graceful degradation), the registry still holds the
 * hardcoded `search_location`/`reverse_lookup`/… entries bootstrapped on import,
 * so the fallback list is advertised instead — no crash, no empty list.
 *
 * `geoTools` is retained as the import-time snapshot (back-compat). Prefer
 * `getGeoTools()` at request time so live sync changes propagate to the model.
 */

import { advertise } from './registry'
import type { Tool } from './types'

/**
 * The live advertised tool list. Reads current registry state on every call, so
 * MCP-sync register/unregister changes (D-05) propagate to what the model sees.
 * Falls back to the hardcoded bootstrapped entries when sync is inactive/failed.
 */
export function getGeoTools(): Tool[] {
	return advertise()
}

/** Import-time snapshot of the advertised list (back-compat; prefer getGeoTools()). */
export const geoTools: Tool[] = advertise()
