/**
 * Host-side RPC client for the off-thread ingest parse worker.
 *
 * Mirrors `src/lib/geo/workerJsonParse.ts` verbatim in structure — the proven
 * no-freeze machinery that guarantees the parse promise ALWAYS settles:
 *
 *  - a lazy `getWorker()` that guards `typeof Worker === 'undefined'` and builds
 *    `new Worker(new URL('./ingest.worker.ts', import.meta.url), { type: 'module' })`
 *    (the Bun zero-config bundling form — also makes the worker chunk emit under
 *    the html-driven production build, which Plan 01 noted was missing);
 *  - an id-keyed `pendingRequests` Map so concurrent parses never cross-talk;
 *  - an `onerror` handler that sync-parses ALL pending requests, latches
 *    `workerBroken = true`, and terminates (T-03-04: a worker that fails to load
 *    in the prod bundle degrades to sync, never hangs);
 *  - a 30s per-request `setTimeout` that falls back to a synchronous parse
 *    (T-03-03: a stuck/hung worker on a pathological file still settles).
 *
 * The worker and every fallback share a single `parseSync(kind, payload)` so the
 * two code paths can never diverge — the worker (`ingest.worker.ts`) is itself a
 * thin shell over the same pure helpers in `./parse.ts`.
 *
 * xlsx is posted as a **transferable** ArrayBuffer (`postMessage(req, [buffer])`)
 * so the bytes are moved, not copied, main↔worker (T-03-05).
 */

import { workerUrl } from '../../../lib/workers/workerAssets'
import { parseCsv, parseJson, parseText, parseXlsx } from './parse'
import type { IngestKind, IngestParseRequest, IngestParseResponse } from './types'

/** Payload for a parse request: `text` for csv/json/geojson/text, `buffer` for xlsx. */
export interface IngestParsePayload {
	text?: string
	buffer?: ArrayBuffer
}

/** Optional knobs (timeout is injectable so the stuck-worker path is testable). */
export interface ParseFileOptions {
	/** Per-request timeout before the sync fallback fires (default 30_000ms). */
	timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

interface PendingRequest {
	resolve: (res: IngestParseResponse) => void
	reject: (error: Error) => void
	kind: IngestKind
	payload: IngestParsePayload
	id: string
	/**
	 * True once the payload's ArrayBuffer was *transferred* (moved) to the worker
	 * — xlsx only (T-03-05). A transferred buffer is detached/zero-length on the
	 * main thread, so a sync re-parse would silently read empty bytes (WR-01).
	 * Fallback paths therefore settle such a request with a failure response
	 * instead of re-parsing the detached buffer.
	 */
	transferred: boolean
}

/** A failure response for a transferred-buffer request that can't be re-parsed (WR-01). */
function detachedBufferFailure(id: string, why: string): IngestParseResponse {
	return {
		id,
		success: false,
		error: `Spreadsheet parsing ${why}. Try a smaller spreadsheet or reload the page.`,
	}
}

let worker: Worker | null = null
let workerBroken = false // latched true once the worker fails to load/run
let requestId = 0
const pendingRequests = new Map<string, PendingRequest>()

/**
 * Synchronously parse a payload for `kind`, returning the SAME discriminated
 * response shape the worker posts. Shared by the no-worker path, the `onerror`
 * fallback, and the timeout fallback so the worker and fallback never diverge.
 *
 * Note: `xlsx` parsing is async (ExcelJS `wb.xlsx.load`), so this returns a
 * Promise; the synchronous kinds resolve immediately.
 */
async function parseSync(
	id: string,
	kind: IngestKind,
	payload: IngestParsePayload,
): Promise<IngestParseResponse> {
	try {
		switch (kind) {
			case 'csv': {
				const { rows, schemaFields } = parseCsv(payload.text ?? '')
				return { id, success: true, rows, schemaFields }
			}
			case 'xlsx': {
				if (!payload.buffer) throw new Error('xlsx parse requires an ArrayBuffer')
				const { rows, schemaFields } = await parseXlsx(payload.buffer)
				return { id, success: true, rows, schemaFields }
			}
			case 'json':
			case 'geojson': {
				const data = parseJson(payload.text ?? '')
				return { id, success: true, data }
			}
			case 'text': {
				const data = parseText(payload.text ?? '')
				return { id, success: true, data }
			}
			default: {
				const exhaustive: never = kind
				throw new Error(`Unknown ingest kind: ${String(exhaustive)}`)
			}
		}
	} catch (error) {
		return {
			id,
			success: false,
			error: error instanceof Error ? error.message : 'Ingest parse failed',
		}
	}
}

/** Settle a pending request via the synchronous fallback, then drop it. */
function settleViaSync(pending: PendingRequest): void {
	pendingRequests.delete(pending.id)
	// WR-01: a transferred (detached) xlsx buffer can't be re-parsed synchronously
	// — settle with a clear failure rather than parsing zero-length bytes.
	if (pending.transferred) {
		pending.resolve(detachedBufferFailure(pending.id, 'failed (worker error)'))
		return
	}
	parseSync(pending.id, pending.kind, pending.payload).then(pending.resolve, pending.reject)
}

function getWorker(): Worker | null {
	if (worker) return worker

	// Not a browser environment with Worker support → caller uses the sync path.
	if (typeof Worker === 'undefined') {
		return null
	}

	try {
		// Stable origin-rooted URL served by the dev route / prod build (see workerAssets.ts).
		// The `new Worker(new URL('./x.worker.ts', import.meta.url))` form does NOT work in this
		// app's dev OR prod serving (Bun #17705 / #7534) — it resolved to a file:// (dev) /
		// non-existent .ts (prod) URL, which is why this worker silently sync-fell-back in dev.
		worker = new Worker(workerUrl('ingest'), { type: 'module' })

		worker.onmessage = (event: MessageEvent<IngestParseResponse>) => {
			const res = event.data
			const pending = pendingRequests.get(res.id)
			if (!pending) return
			pendingRequests.delete(res.id)
			pending.resolve(res)
		}

		worker.onerror = (error) => {
			console.warn('Ingest parse worker error, falling back to sync parse:', error)
			// Sync-fallback every pending request before tearing the worker down.
			for (const pending of [...pendingRequests.values()]) {
				settleViaSync(pending)
			}
			// Latch broken + terminate so future calls skip the worker entirely.
			workerBroken = true
			worker?.terminate()
			worker = null
		}

		return worker
	} catch (error) {
		console.warn('Failed to create ingest parse worker:', error)
		return null
	}
}

/**
 * Parse a file off the main thread via the worker when available, otherwise
 * synchronously — the promise ALWAYS settles (no UI freeze, no hang).
 *
 * @param kind    one of csv | xlsx | json | geojson | text
 * @param payload `{ text }` for textual kinds, `{ buffer }` for xlsx
 * @param options `{ timeoutMs }` — per-request sync-fallback timeout (default 30s)
 */
export async function parseFileInWorker(
	kind: IngestKind,
	payload: IngestParsePayload,
	options: ParseFileOptions = {},
): Promise<IngestParseResponse> {
	const id = `ingest-${++requestId}`
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

	// Skip the worker entirely once it has previously failed to load.
	if (workerBroken) {
		return parseSync(id, kind, payload)
	}

	const w = getWorker()

	// No worker available (SSR / unsupported / creation failed) → sync.
	if (!w) {
		return parseSync(id, kind, payload)
	}

	return new Promise<IngestParseResponse>((resolve, reject) => {
		const request: IngestParseRequest = { id, kind, text: payload.text, buffer: payload.buffer }

		// xlsx: transfer the ArrayBuffer (move, not copy) main↔worker (T-03-05).
		// Once transferred, the main-thread buffer is detached, so this request can
		// NOT be sync-re-parsed in a fallback (WR-01) — flag it so the timeout/error
		// paths settle with a clear failure instead of reading empty bytes.
		const transferred = kind === 'xlsx' && !!payload.buffer
		pendingRequests.set(id, { resolve, reject, kind, payload, id, transferred })

		if (transferred && payload.buffer) {
			w.postMessage(request, [payload.buffer])
		} else {
			w.postMessage(request)
		}

		// Stuck/hung worker → fall back to a synchronous parse (T-03-03).
		setTimeout(() => {
			const pending = pendingRequests.get(id)
			if (!pending) return
			pendingRequests.delete(id)
			if (pending.transferred) {
				// WR-01: detached xlsx buffer — fail closed instead of corrupting.
				console.warn('Ingest worker xlsx parse timeout; buffer transferred, cannot sync-fallback')
				resolve(detachedBufferFailure(id, 'timed out'))
				return
			}
			console.warn('Ingest worker parse timeout, falling back to sync')
			parseSync(id, kind, payload).then(resolve, reject)
		}, timeoutMs)
	})
}

/** Terminate the worker and clear pending state (cleanup / testing). */
export function terminateIngestWorker(): void {
	if (worker) {
		worker.terminate()
		worker = null
	}
	pendingRequests.clear()
	workerBroken = false
}
