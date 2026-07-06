/**
 * Derive the model-facing `IngestSummary` from a host-side `ParsedDataset`.
 *
 * STRUCTURAL INVARIANT (D-11 / V5): the returned object structurally only reads
 * `parsed.schema` + a sampled subset of rows. It NEVER materializes `fullRows`
 * into the result — that is what makes "the model never sees raw rows" a
 * guarantee rather than a convention. The store caches this once at ingest time
 * (`putDataset`) and the only model-facing accessor (`toModelSummary`) returns
 * it verbatim.
 *
 * Two discretion choices (D-02), documented here as named constants:
 * - Sampling: head 5 + tail 5 + random 5 = up to 15 representative rows. Enough
 *   for column-mapping inference (first/last/middle), small enough to stay cheap
 *   in tokens. (RESEARCH Open Q2 suggested counts.)
 * - Column cap: MAX_SUMMARY_COLS = 30. Wide tables (T-03-09) are capped to the
 *   first 30 columns with a `moreColumns` remainder, so an 80-column file cannot
 *   blow up the prompt.
 */

import { bbox as turfBbox } from '@turf/turf'
import type { IngestSummary, ParsedDataset } from './datasetTypes'

/** Head/tail/random sample counts (D-02 discretion). */
export const INGEST_SAMPLE = { head: 5, tail: 5, random: 5 } as const

/** Max columns surfaced to the model before "…N more columns" (D-02 / T-03-09). */
export const MAX_SUMMARY_COLS = 30

/**
 * Max GeoJSON features whose `properties`/geometry-type are surfaced in the
 * model-facing sample (D-11). The FULL FeatureCollection lives only host-side in
 * `fullRows[0].__geojson`, reachable via `getDataset(handleId)` — it is NEVER
 * embedded in the summary.
 */
export const MAX_GEOJSON_SAMPLE_FEATURES = 5

/** Max top-level keys surfaced for a JSON dataset preview (D-11). */
export const MAX_JSON_PREVIEW_KEYS = 30

/** Max lines surfaced (first/last) for a text dataset preview (D-11). */
export const TEXT_PREVIEW_LINES = { head: 3, tail: 3 } as const

/**
 * Head + tail + random sample. If the table is already ≤ head+tail+random rows,
 * every row is returned (no padding, no duplication). Otherwise the result is
 * the first `head`, last `tail`, and `random` rows drawn from the middle.
 */
export function sampleRows<T>(
	rows: T[],
	opts: { head?: number; tail?: number; random?: number } = {},
): T[] {
	const head = opts.head ?? INGEST_SAMPLE.head
	const tail = opts.tail ?? INGEST_SAMPLE.tail
	const random = opts.random ?? INGEST_SAMPLE.random

	if (rows.length <= head + tail + random) return [...rows]

	const out = [...rows.slice(0, head), ...rows.slice(rows.length - tail)]
	const mid = rows.slice(head, rows.length - tail)

	// IN-04: draw the middle sample WITHOUT replacement when there are enough
	// distinct middle rows (partial Fisher–Yates: shuffle the first `random`
	// slots, then take them), so the same row can't appear twice while others
	// never appear. When `mid.length < random` (can't happen given the length
	// guard above, but kept for safety) fall back to with-replacement draws.
	if (mid.length >= random) {
		const pool = [...mid]
		for (let i = 0; i < random; i++) {
			const j = i + Math.floor(Math.random() * (pool.length - i))
			;[pool[i], pool[j]] = [pool[j], pool[i]]
			out.push(pool[i])
		}
	} else {
		for (let i = 0; i < random && mid.length > 0; i++) {
			out.push(mid[Math.floor(Math.random() * mid.length)])
		}
	}
	return out
}

/**
 * Per-type extra stats. For GeoJSON, derive feature count + distinct geometry
 * types + bbox via @turf/turf. For text, surface the line/char counts the parse
 * worker already produced (carried on the dataset rows as a single record).
 */
function deriveTypeStats(parsed: ParsedDataset): IngestSummary['typeStats'] {
	if (parsed.type === 'geojson') {
		// GeoJSON datasets carry the parsed FeatureCollection on the first row's
		// `__geojson` slot (set by the ingest pipeline), or directly on typeStats
		// if already computed. Prefer an already-computed value.
		if (parsed.typeStats) return parsed.typeStats

		const collection = (parsed.fullRows[0]?.__geojson ?? parsed.fullRows[0]) as unknown
		const features =
			collection &&
			typeof collection === 'object' &&
			Array.isArray((collection as { features?: unknown }).features)
				? ((collection as { features: unknown[] }).features as Array<{
						geometry?: { type?: string }
					}>)
				: []

		const geometryTypes = Array.from(
			new Set(
				features.map((f) => f.geometry?.type).filter((t): t is string => typeof t === 'string'),
			),
		)

		let bbox: [number, number, number, number] | undefined
		try {
			if (features.length > 0) {
				// biome-ignore lint/suspicious/noExplicitAny: turf bbox accepts a GeoJSON object
				const bb = turfBbox(collection as any)
				if (bb.length >= 4) {
					bbox = [bb[0], bb[1], bb[2], bb[3]]
				}
			}
		} catch {
			bbox = undefined
		}

		return { featureCount: features.length, geometryTypes, ...(bbox ? { bbox } : {}) }
	}

	if (parsed.type === 'text') {
		if (parsed.typeStats) return parsed.typeStats
		const first = parsed.fullRows[0] as { lineCount?: number; charCount?: number } | undefined
		if (first && (typeof first.lineCount === 'number' || typeof first.charCount === 'number')) {
			return {
				...(typeof first.lineCount === 'number' ? { lineCount: first.lineCount } : {}),
				...(typeof first.charCount === 'number' ? { charCount: first.charCount } : {}),
			}
		}
		return undefined
	}

	return parsed.typeStats
}

/**
 * Build the model-facing `sampleRows` (D-11). For TABULAR kinds (csv/xlsx) this
 * is the existing head/tail/random row draw. For STRUCTURED kinds (geojson/json/
 * text) the raw payload sits in `fullRows[0]` and must NEVER be sampled verbatim
 * (CR-01): sampling a length-1 `fullRows` would copy the entire FeatureCollection
 * / JSON object / text body into the model-facing summary. Instead we emit a
 * compact, size-capped preview:
 *
 * - geojson: at most MAX_GEOJSON_SAMPLE_FEATURES rows of `{ geometryType,
 *   properties }` (feature properties only — never the geometry coordinates).
 *   featureCount/geometryTypes/bbox come from `typeStats`.
 * - json: a single preview row with the top-level keys (capped) — or, for a
 *   top-level array, its length + the keys of its first element.
 * - text: at most a few first/last lines, never the full line array.
 *
 * The full payload remains reachable host-side via `getDataset(handleId)
 * .fullRows[0]` for the placement tool — that path is unchanged.
 */
function deriveSampleRows(parsed: ParsedDataset): Record<string, unknown>[] {
	if (parsed.type === 'csv' || parsed.type === 'xlsx') {
		return sampleRows(parsed.fullRows)
	}

	if (parsed.type === 'geojson') {
		const collection = (parsed.fullRows[0]?.__geojson ?? parsed.fullRows[0]) as unknown
		const features =
			collection &&
			typeof collection === 'object' &&
			Array.isArray((collection as { features?: unknown }).features)
				? ((collection as { features: unknown[] }).features as Array<{
						geometry?: { type?: unknown }
						properties?: unknown
					}>)
				: []
		return features.slice(0, MAX_GEOJSON_SAMPLE_FEATURES).map((f) => ({
			geometryType: typeof f.geometry?.type === 'string' ? f.geometry.type : null,
			properties:
				f.properties && typeof f.properties === 'object' && !Array.isArray(f.properties)
					? (f.properties as Record<string, unknown>)
					: {},
		}))
	}

	if (parsed.type === 'json') {
		// json stores the parsed value directly as fullRows[0]
		// (fileAttachHandler.buildParsedDataset). A top-level array is wrapped by
		// the spread into an object, so recover the array via `length`-keyed shape
		// only when fullRows[0] is genuinely array-like; otherwise treat as object.
		const data: unknown = parsed.fullRows[0]
		if (Array.isArray(data)) {
			const first = data[0]
			const elementKeys =
				first && typeof first === 'object' && !Array.isArray(first)
					? Object.keys(first as Record<string, unknown>).slice(0, MAX_JSON_PREVIEW_KEYS)
					: []
			return [{ jsonShape: 'array', length: data.length, elementKeys }]
		}
		if (data && typeof data === 'object') {
			const keys = Object.keys(data as Record<string, unknown>)
			return [
				{
					jsonShape: 'object',
					topLevelKeys: keys.slice(0, MAX_JSON_PREVIEW_KEYS),
					...(keys.length > MAX_JSON_PREVIEW_KEYS
						? { moreKeys: keys.length - MAX_JSON_PREVIEW_KEYS }
						: {}),
				},
			]
		}
		return [{ jsonShape: typeof data }]
	}

	if (parsed.type === 'text') {
		const first = parsed.fullRows[0] as { lines?: unknown } | undefined
		const lines = Array.isArray(first?.lines) ? (first.lines as unknown[]) : []
		const head = lines.slice(0, TEXT_PREVIEW_LINES.head)
		const tail =
			lines.length > TEXT_PREVIEW_LINES.head + TEXT_PREVIEW_LINES.tail
				? lines.slice(lines.length - TEXT_PREVIEW_LINES.tail)
				: lines.slice(TEXT_PREVIEW_LINES.head)
		return [{ firstLines: head, lastLines: tail }]
	}

	return []
}

/**
 * Build the model-facing summary: column-capped schema + bounded row sample
 * (head/tail/random for tabular kinds; a compact preview for structured kinds —
 * see `deriveSampleRows`) + detected coordinate columns + per-type stats. Reads
 * only `schema` and a bounded subset/derivation of rows — the raw `fullRows`
 * payload is NEVER copied into the result (D-11 / CR-01).
 */
export function deriveIngestSummary(parsed: ParsedDataset): IngestSummary {
	const cappedSchema = parsed.schema.slice(0, MAX_SUMMARY_COLS)
	const moreColumns = Math.max(0, parsed.columnCount - MAX_SUMMARY_COLS)

	const detectedCoordinateColumns = Object.values(parsed.coordinateColumns).filter(
		(v): v is string => typeof v === 'string' && v.length > 0,
	)

	const typeStats = deriveTypeStats(parsed)

	return {
		handleId: parsed.handleId,
		fileName: parsed.fileName,
		type: parsed.type,
		rowCount: parsed.rowCount,
		columnCount: parsed.columnCount,
		schema: cappedSchema,
		...(moreColumns > 0 ? { moreColumns } : {}),
		sampleRows: deriveSampleRows(parsed),
		detectedCoordinateColumns,
		...(typeStats ? { typeStats } : {}),
	}
}
