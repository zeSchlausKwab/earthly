/**
 * Pre-parse file-size caps (D-12 discretion; V5/V12 DoS guard, T-03-07).
 *
 * `assertFileWithinCaps` MUST be called BEFORE `parseFileInWorker` (Plan 02) and
 * before the dataset is held in the in-memory store (Plan 03 / `ingestStore`):
 * an oversized multi-GB drop must be rejected before it is parsed or held. Plan
 * 01's worker has no size guard by design — this is that guard.
 *
 * Cap choices (D-12 discretion, documented per the plan):
 * - tabular 50 MB: comfortably ≥ Phase 7's ~12 MB West Pacific Trail GeoJSON
 *   (Assumption A4) with headroom, while still bounding worst-case memory. The
 *   cap applies to the RAW byte length (xlsx zip decompression amplifies row
 *   count well beyond bytes — Plan 01 handoff), so the cap is on `file.size`.
 * - image 25 MB: large enough for a high-resolution photo/screenshot, small
 *   enough to bound a base64-inflated vision payload.
 */

import { clampPositiveInt } from '../tools/helpers'

export const INGEST_SIZE_CAPS = {
	/** Max raw bytes for csv/xlsx/json/geojson/text (≥ 12MB per A4). */
	tabularBytes: 50 * 1024 * 1024,
	/** Max raw bytes for an image attachment. */
	imageBytes: 25 * 1024 * 1024,
} as const

export type FileWithinCapsResult = { ok: true } | { ok: false; reason: string }

function formatMb(bytes: number): string {
	return `${Math.round(bytes / (1024 * 1024))} MB`
}

/**
 * Reject a file that exceeds its applicable cap BEFORE parse/hold. Returns a
 * structured result (`{ ok: false, reason }` carrying UI-SPEC "file too large"
 * copy, or `{ ok: true }`). Pure — no throw, no side effects.
 */
export function assertFileWithinCaps(file: {
	size: number
	isImage: boolean
}): FileWithinCapsResult {
	const cap = file.isImage ? INGEST_SIZE_CAPS.imageBytes : INGEST_SIZE_CAPS.tabularBytes

	// Mirror the clamp idiom: normalize a (possibly absurd / non-finite) size to a
	// bounded positive int before comparison, so a NaN/Infinity size can't slip
	// past the cap.
	const size = clampPositiveInt(file.size, 0, Number.MAX_SAFE_INTEGER)

	if (size > cap) {
		return {
			ok: false,
			reason: `This file is too large (max ${formatMb(cap)} for ${file.isImage ? 'images' : 'data files'}).`,
		}
	}

	return { ok: true }
}
