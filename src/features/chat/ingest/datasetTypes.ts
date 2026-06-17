/**
 * The D-11 seam contract: the shapes that make "the model never sees raw rows"
 * a STRUCTURAL guarantee rather than a convention.
 *
 * `ParsedDataset` is the host-side record held in the in-memory ingest store
 * (`ingestStore.ts`). It carries `fullRows` — the complete parsed table — which
 * is reachable ONLY through `getDataset(handleId)` (the tools/sandbox accessor).
 *
 * `IngestSummary` is the ONLY thing the model ever receives (alongside the
 * `handleId`). It carries a column-capped schema and a head/tail/random sample
 * of rows — never `fullRows`. `toModelSummary(handleId)` is the single
 * model-facing accessor and returns `{ handleId, summary }`.
 *
 * Phase 4's sandbox and Phase 5's host-side-over-full-dataset rules plug into
 * this seam: they read `fullRows` via `getDataset`, never via the model path.
 */

/** The five non-image file kinds the ingest store can hold (mirrors `IngestKind`). */
export type DatasetType = 'csv' | 'xlsx' | 'json' | 'geojson' | 'text'

/** A single column descriptor inferred from the parsed rows. */
export interface SchemaField {
	name: string
	type: 'string' | 'number' | 'boolean' | 'mixed'
}

/**
 * Coordinate/geometry columns auto-detected by name heuristic (D-04). The AI
 * confirms or overrides these at placement time; an empty object means
 * "ambiguous — ask the user / AI to pick".
 */
export interface CoordinateColumns {
	lat?: string
	lon?: string
	wkt?: string
	geometry?: string
}

/**
 * Per-type extra summary stats surfaced to the model alongside the sample.
 * - GeoJSON: feature count, geometry types, bbox (via @turf/turf).
 * - text: line + character counts.
 */
export interface DatasetTypeStats {
	/** GeoJSON: number of features in the FeatureCollection. */
	featureCount?: number
	/** GeoJSON: distinct geometry types present. */
	geometryTypes?: string[]
	/** GeoJSON: bounding box [west, south, east, north]. */
	bbox?: [number, number, number, number]
	/** text: number of lines. */
	lineCount?: number
	/** text: number of characters. */
	charCount?: number
}

/**
 * The host-side record. `fullRows` is NEVER serialized to the model — it is
 * reachable only through `getDataset(handleId)`.
 */
export interface ParsedDataset {
	handleId: string
	fileName: string
	type: DatasetType
	schema: SchemaField[]
	rowCount: number
	columnCount: number
	/** The complete parsed table. NEVER handed to the model. */
	fullRows: Record<string, unknown>[]
	coordinateColumns: CoordinateColumns
	bytes: number
	createdAt: number
	/** Optional per-type extras (GeoJSON bbox/geometry types, text counts). */
	typeStats?: DatasetTypeStats
}

/**
 * The ONLY shape the model sees (plus the `handleId`). Schema is column-capped;
 * `sampleRows` is a head/tail/random draw. There is no `fullRows` field here by
 * construction — that is the structural privacy seam.
 */
export interface IngestSummary {
	handleId: string
	fileName: string
	type: DatasetType
	rowCount: number
	columnCount: number
	/** Column-capped schema (≤ MAX_SUMMARY_COLS). */
	schema: SchemaField[]
	/** Count of columns omitted by the cap (0 when nothing was dropped). */
	moreColumns?: number
	/** head + tail + random draw of rows (NEVER the full table). */
	sampleRows: Record<string, unknown>[]
	/** Names of the auto-detected coordinate/geometry columns. */
	detectedCoordinateColumns: string[]
	/** Optional per-type extras (GeoJSON bbox/geometry types, text counts). */
	typeStats?: DatasetTypeStats
}
