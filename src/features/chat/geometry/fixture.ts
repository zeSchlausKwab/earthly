/**
 * Deterministic "West Pacific Trail" surrogate fixture generator (Phase 7, Wave 0).
 *
 * PROJECT.md user story #5 is the GEO-03 acceptance bar: a ~12MB messy GeoJSON trail
 * (hundreds of polylines, microgaps, superfluous near-collinear vertices, repeated
 * properties) that must be brought UNDER `BLOSSOM_UPLOAD_THRESHOLD_BYTES` (1MB) at the
 * same visual quality, then published. Checking a 12MB blob into the repo would be
 * heavy and opaque; instead this module DETERMINISTICALLY generates an equivalent
 * oversized, messy LineString FeatureCollection at test time so the acceptance test is
 * reproducible and the repo stays light.
 *
 * The generated dataset deliberately exercises every stage of the optimize pipeline:
 *   - SIMPLIFY: each LineString is densified with superfluous near-collinear vertices
 *     that `turf.simplify` can collapse without changing the visible shape.
 *   - STITCH: consecutive lines end/begin within the dissolve tolerance (`0.00001`) so
 *     the microgap stitch joins them (so `report.microgapJoins > 0`).
 *   - MERGE: a ~1/3 subset shares BYTE-IDENTICAL `properties`, so the lossless
 *     identical-props merge-to-multi has real work to do (D-05).
 *
 * PURITY: this file imports NOTHING from turf, the editor core, or any worker — it is
 * pure deterministic data generation (seeded PRNG). Only a TYPE import of `EditorFeature`.
 */

import type { EditorFeature } from '@/features/geo-editor/core/types'

/** Options for {@link makeOversizedTrailFixture}. All optional with deterministic defaults. */
export interface OversizedTrailFixtureOptions {
	/** Number of LineString features to generate (default 300). */
	lineCount?: number
	/** Vertices per LineString, including the superfluous near-collinear infill (default 90). */
	pointsPerLine?: number
	/** PRNG seed — same seed ⇒ byte-identical output (default fixed). */
	seed?: number
}

const DEFAULT_LINE_COUNT = 300
const DEFAULT_POINTS_PER_LINE = 145
const DEFAULT_SEED = 0x5eed_7a11

/** The dissolve/stitch tolerance the optimizer uses (`dissolveSelectedLines` default). */
const DISSOLVE_TOLERANCE = 0.00001

/** A FeatureCollection of EditorFeatures (the shape the optimizer consumes). */
export interface FixtureCollection {
	type: 'FeatureCollection'
	features: EditorFeature[]
}

/**
 * Tiny deterministic PRNG (mulberry32). Seeded so the fixture is byte-reproducible —
 * generating twice with the same seed yields identical output.
 */
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** Round to a fixed precision so the serialized fixture is stable across runs. */
function round(value: number): number {
	return Math.round(value * 1e7) / 1e7
}

/**
 * The handful of identical property bags a ~1/3 subset of features share verbatim, so
 * the lossless identical-props merge can collapse same-type same-props features into a
 * Multi*. Differing-props features stay separate.
 */
const SHARED_PROPS: ReadonlyArray<Record<string, string>> = [
	{ name: 'West Pacific Trail', description: 'Main coastal segment' },
	{ name: 'West Pacific Trail', description: 'Inland connector' },
]

/**
 * Generate a deterministic oversized, messy LineString FeatureCollection — the West
 * Pacific Trail surrogate. See the module docstring for what each stage exercises.
 */
export function makeOversizedTrailFixture(
	opts: OversizedTrailFixtureOptions = {},
): FixtureCollection {
	const lineCount = opts.lineCount ?? DEFAULT_LINE_COUNT
	const pointsPerLine = opts.pointsPerLine ?? DEFAULT_POINTS_PER_LINE
	const rand = mulberry32(opts.seed ?? DEFAULT_SEED)

	const features: EditorFeature[] = []

	// A coarse path meandering across the West Pacific (roughly 130°E..170°E, 0°N..40°N).
	let lon = 130
	let lat = 0
	// The endpoint of the previous line — the next line starts within the dissolve
	// tolerance of it (a deliberate microgap) so the stitch stage joins them.
	let prevEnd: [number, number] | null = null

	for (let i = 0; i < lineCount; i++) {
		// Coarse waypoint anchors for this segment (the "real" shape).
		const startLon = prevEnd ? prevEnd[0] + (rand() - 0.5) * DISSOLVE_TOLERANCE : lon
		const startLat = prevEnd ? prevEnd[1] + (rand() - 0.5) * DISSOLVE_TOLERANCE : lat

		// Each segment advances the coarse path a little east + north with jitter.
		const dLon = 0.08 + rand() * 0.05
		const dLat = 0.05 + rand() * 0.04
		const endLon = startLon + dLon
		const endLat = startLat + dLat

		const coords: [number, number][] = []
		for (let p = 0; p < pointsPerLine; p++) {
			const t = p / (pointsPerLine - 1)
			// Base position along the coarse segment.
			const baseLon = startLon + (endLon - startLon) * t
			const baseLat = startLat + (endLat - startLat) * t
			// Superfluous NEAR-collinear jitter: tiny enough that simplify removes it
			// without changing the visible shape, but present so vertex count is high.
			const jitter = (rand() - 0.5) * 1e-6
			coords.push([round(baseLon + jitter), round(baseLat + jitter * 0.5)])
		}

		// ~1/3 of features share byte-identical properties (the merge target). The rest
		// get a unique property so they stay separate (the lossless-merge negative case).
		const shared = i % 3 === 0
		const properties: Record<string, unknown> = shared
			? { ...SHARED_PROPS[i % SHARED_PROPS.length] }
			: { name: `segment-${i}`, description: `unique segment ${i}`, segmentIndex: i }

		features.push({
			type: 'Feature',
			id: `trail-${i}`,
			geometry: { type: 'LineString', coordinates: coords },
			properties,
		} as EditorFeature)

		prevEnd = [endLon, endLat]
		lon = endLon
		lat = endLat
	}

	return { type: 'FeatureCollection', features }
}

const BYTE_ENCODER = new TextEncoder()

/**
 * Serialized byte size of a FeatureCollection — the EXACT measurement the publish gate
 * (`usePublishing.getCollectionSize`) and `SimplifyDialog` use, so the fixture's size
 * compares apples-to-apples with `BLOSSOM_UPLOAD_THRESHOLD_BYTES`.
 */
export function fixtureBytes(fc: FixtureCollection): number {
	return BYTE_ENCODER.encode(JSON.stringify({ type: 'FeatureCollection', features: fc.features }))
		.length
}
