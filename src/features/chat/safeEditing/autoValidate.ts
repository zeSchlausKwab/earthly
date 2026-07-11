/**
 * Automatic post-write validation (AI_GEO_AWARENESS §1 — "close the loop
 * automatically"). After every gated AI geometry write, topology + land/water
 * findings are appended to the tool result the model sees, so it can
 * self-correct in the next tool round without being prompted to ask.
 *
 * ADVISORY ONLY: this never blocks or mutates — a coarse 1:50m mask reads
 * narrow canals/straits as land, and land contact is perfectly correct for
 * terrestrial features. The report says so explicitly.
 *
 * Degrades gracefully: when the land mask is not available (offline, layer
 * fetch failed), the land/water section is replaced by a short note and the
 * topology section still runs.
 */

import { validateGeometryFeatures } from '@/features/geo-editor/api/geometryValidation'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import { checkFeaturesAgainstLandMask, type LandWaterReport } from '@/lib/geo/landWater'
import { getLoadedWorldLayer, loadWorldLayer } from '@/lib/geo/worldData'

/** Cap on features validated per write (DoS bound; counts stay honest via `checked`). */
const MAX_VALIDATED_FEATURES = 500

/** How long a write is allowed to wait for a cold land mask before degrading. */
const LAND_MASK_WAIT_MS = 3000

interface FeatureLike {
	id?: string | number
	properties?: Record<string, unknown> | null
	geometry?: GeoJSON.Geometry | null
}

function asEditorFeatures(features: FeatureLike[]): EditorFeature[] {
	return features.map(
		(feature, index) =>
			({
				type: 'Feature',
				...feature,
				id: String(feature.id ?? `written-${index}`),
				properties: feature.properties ?? {},
			}) as EditorFeature,
	)
}

/**
 * The land mask if it resolves within the wait budget, else null. Preloaded at
 * chat start, so the cold path is rare.
 */
async function landMaskOrNull(): Promise<GeoJSON.FeatureCollection | null> {
	const loaded = getLoadedWorldLayer('land_50m')
	if (loaded) return loaded
	try {
		return await Promise.race([
			loadWorldLayer('land_50m'),
			new Promise<null>((resolve) => setTimeout(() => resolve(null), LAND_MASK_WAIT_MS)),
		])
	} catch {
		return null
	}
}

/** Strip the land/water report down when there is nothing actionable in it. */
function compactLandWater(report: LandWaterReport): Record<string, unknown> {
	const hasFindings = report.lines.mixed.length > 0 || report.points.onWater > 0
	if (!hasFindings) {
		return {
			status: 'ok',
			maskResolution: report.maskResolution,
			lines: {
				checked: report.lines.checked,
				fullyOnLand: report.lines.fullyOnLand,
				fullyOnWater: report.lines.fullyOnWater,
			},
			points: report.points,
		}
	}
	return { ...report }
}

/**
 * Build the advisory `validation` block appended to a gated write's tool
 * result. Returns null when there is nothing to validate (no features with
 * geometry) so cancelled/empty writes stay clean.
 */
export async function buildPostWriteValidation(
	features: FeatureLike[],
): Promise<Record<string, unknown> | null> {
	const withGeometry = features.filter((feature) => feature.geometry)
	if (withGeometry.length === 0) return null

	const scoped = asEditorFeatures(withGeometry.slice(0, MAX_VALIDATED_FEATURES))

	const topology = validateGeometryFeatures(scoped, undefined)
	const topologySection =
		topology.issues.length > 0 ? topology : { checked: topology.checked, status: 'ok' as const }

	const mask = await landMaskOrNull()
	const landWaterSection = mask
		? compactLandWater(checkFeaturesAgainstLandMask(mask, scoped))
		: { status: 'unavailable', note: 'land mask not loaded; land/water check skipped' }

	return {
		advisory: true,
		checkedFeatures: scoped.length,
		...(withGeometry.length > scoped.length
			? { skippedFeatures: withGeometry.length - scoped.length }
			: {}),
		topology: topologySection,
		landWater: landWaterSection,
	}
}
