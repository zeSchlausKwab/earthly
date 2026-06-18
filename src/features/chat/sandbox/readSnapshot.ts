/**
 * D-01 read snapshot — the two read surfaces the sandbox is allowed to see, as a
 * single FROZEN, plain-data, fail-closed view (RESEARCH Pattern 3).
 *
 * Surface 1 — ingest rows BY HANDLE: full parsed rows via `getDataset(handleId)`
 * (the tools/sandbox accessor that returns `fullRows`). This deliberately does
 * NOT route through the model-facing summary accessor — the SANDBOX reads rows,
 * the MODEL still only ever sees the summary (the Phase 3 D-11 privacy seam,
 * T-04-10).
 *
 * Surface 2 — the editor's CURRENT feature set: each live `EditorFeature` is
 * stripped to plain GeoJSON (`{ type, geometry, properties, id }`) so no
 * editor-internal handle crosses the boundary.
 *
 * The whole `{ datasets, features }` object is then run through `structuredClone`
 * so the boundary receives an independent copy (T-04-08: mutating a returned
 * feature cannot reach the live editor) AND so any non-clonable leak (a function,
 * a class instance, a DOM node) THROWS rather than producing a partial silent
 * snapshot (Pitfall 5 — fail closed, never self-correct against a phantom bug).
 *
 * Boundary: this module lives under `chat/` so it legitimately imports the ingest
 * store + a geo-editor TYPE. It imports NOTHING from a key-holding / payment /
 * relay-client module — the sandbox confinement scan (Plan 01 Task 4) covers it.
 */

import type { Feature } from 'geojson'
import { getDataset } from '@/features/chat/ingest/ingestStore'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import type { EditorFeature } from '@/features/geo-editor/core/types'

/** The frozen plain-data view exposed inside the boundary as the `data` global (D-01). */
export interface ReadSnapshot {
	/** Full ingest rows keyed by handle id; `null` for an unknown/evicted handle. */
	datasets: Record<string, Record<string, unknown>[] | null>
	/** The editor's current features as plain GeoJSON (no editor-internal handles). */
	features: Feature[]
}

/** Strip a live `EditorFeature` to a plain GeoJSON feature (no editor internals). */
function toPlainGeoJSON(feature: EditorFeature): Feature {
	return {
		type: 'Feature',
		id: feature.id,
		geometry: feature.geometry,
		properties: feature.properties ?? null,
	}
}

/**
 * Build the D-01 read snapshot: full ingest rows by handle + current editor
 * features, as a single `structuredClone`d (independent, fail-closed) view.
 *
 * @throws if any value in the snapshot is non-clonable (Pitfall 5 — fail closed).
 */
export function buildReadSnapshot(handleIds: string[], editor: GeoEditor): ReadSnapshot {
	const datasets: Record<string, Record<string, unknown>[] | null> = Object.fromEntries(
		handleIds.map((h) => [h, getDataset(h)?.fullRows ?? null]),
	)
	const features = editor.getAllFeatures().map(toPlainGeoJSON)
	// structuredClone makes the boundary copy independent (T-04-08) and fails
	// closed on any non-clonable leak (T-04-08 / Pitfall 5) — never a partial snapshot.
	return structuredClone({ datasets, features })
}
