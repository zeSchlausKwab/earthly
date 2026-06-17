/**
 * Handle-keyed, session-only ingest store — the D-11 structural privacy seam.
 *
 * A module-level `Map<handleId, ParsedDataset>` (mirroring the `registry` Map +
 * accessor idiom in `src/features/chat/tools/registry.ts` and the in-memory
 * snapshot cache pattern). The model is only ever handed `{ handleId, summary }`
 * via `toModelSummary` — `fullRows` is reachable solely through `getDataset`
 * (the tools/sandbox accessor).
 *
 * Session-only by design (D-12): purely in-memory, with no browser storage
 * back-end and no on-disk write path. The store lives for the page session and
 * is cleared by `evictDataset` or reload. This bounds the lifetime of an
 * untrusted in-memory file (T-03-07).
 *
 * The `IngestSummary` is derived ONCE at `putDataset` time and cached alongside
 * the dataset, so the model path can never accidentally recompute over (or
 * expose) `fullRows`.
 */

import type { IngestSummary, ParsedDataset } from './datasetTypes'
import { deriveIngestSummary } from './parseSummary'

/** The live store. Module-level so any host module can put/get by handle. */
const ingestStore = new Map<string, ParsedDataset>()

/**
 * Cached model-facing summaries, keyed by the same handle. Derived once at
 * `putDataset` time. Kept in a separate Map (rather than on `ParsedDataset`) so
 * the host-side record and the model-facing projection stay distinct shapes.
 */
const summaryCache = new Map<string, IngestSummary>()

/**
 * Hold a parsed dataset. Assigns a `crypto.randomUUID()` handle, stamps
 * `createdAt`, derives + caches the `IngestSummary`, and stores the full
 * record. Returns the handle id.
 */
export function putDataset(parsed: Omit<ParsedDataset, 'handleId' | 'createdAt'>): string {
	const handleId = crypto.randomUUID()
	const record: ParsedDataset = {
		...parsed,
		handleId,
		createdAt: Date.now(),
	}
	ingestStore.set(handleId, record)
	summaryCache.set(handleId, deriveIngestSummary(record))
	return handleId
}

/**
 * The tools/sandbox accessor — the ONLY function that returns `fullRows`.
 * Returns the full `ParsedDataset`, or `undefined` if the handle is unknown
 * (already evicted / never existed).
 */
export function getDataset(handleId: string): ParsedDataset | undefined {
	return ingestStore.get(handleId)
}

/** Remove a dataset (and its cached summary) by handle. */
export function evictDataset(handleId: string): void {
	ingestStore.delete(handleId)
	summaryCache.delete(handleId)
}

/**
 * The SINGLE model-facing accessor. Returns `{ handleId, summary }` only —
 * structurally NEVER `fullRows`. Returns `undefined` for an unknown handle.
 */
export function toModelSummary(handleId: string): { handleId: string; summary: IngestSummary } | undefined {
	const summary = summaryCache.get(handleId)
	if (!summary) return undefined
	return { handleId, summary }
}
