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
	for (let i = 0; i < random && mid.length > 0; i++) {
		out.push(mid[Math.floor(Math.random() * mid.length)])
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
 * Build the model-facing summary: column-capped schema + head/tail/random row
 * sample + detected coordinate columns + per-type stats. Reads only `schema`
 * and a sampled subset of rows — `fullRows` is never copied into the result.
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
		sampleRows: sampleRows(parsed.fullRows),
		detectedCoordinateColumns,
		...(typeStats ? { typeStats } : {}),
	}
}
