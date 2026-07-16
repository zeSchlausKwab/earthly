import type { MapLayerState } from '@/features/geo-editor/store'
import type { SavedRegionCreateRequest } from '@/platform/contracts'

const SHA256_FILE = /^([0-9a-f]{64})(?:\.pmtiles)?$/u
const MAX_REGION_BLOBS = 2_048

export interface SavedRegionPlan {
	request: SavedRegionCreateRequest
	chunkCount: number
	bytesTotal: number | null
	unknownSizeCount: number
}

export interface PlanSavedRegionInput {
	id: string
	name: string
	bbox: [number, number, number, number]
	sourcePubkey: string
	announcementId: string
	layer: MapLayerState
}

function intersects(
	left: [number, number, number, number],
	right: [number, number, number, number],
): boolean {
	return !(left[2] < right[0] || left[0] > right[2] || left[3] < right[1] || left[1] > right[3])
}

function validateBbox(bbox: [number, number, number, number]): void {
	const [west, south, east, north] = bbox
	if (
		bbox.some((value) => !Number.isFinite(value)) ||
		west < -180 ||
		east > 180 ||
		south < -90 ||
		north > 90 ||
		west > east ||
		south > north
	) {
		throw new Error('The visible map crosses the date line or has invalid bounds')
	}
}

/** Build a deterministic, content-addressed native download plan from a trusted announcement. */
export function planSavedRegion(input: PlanSavedRegionInput): SavedRegionPlan {
	validateBbox(input.bbox)
	if (!input.layer.announcement) {
		throw new Error('The selected map layer does not publish downloadable regions')
	}
	const mirrors = input.layer.blossomServers ?? []
	if (mirrors.length === 0) throw new Error('The selected map layer has no trusted download mirror')

	const chunks = Object.entries(input.layer.announcement)
		.filter(([, chunk]) => intersects(input.bbox, chunk.bbox))
		.sort(([left], [right]) => left.localeCompare(right))
	if (chunks.length === 0) throw new Error('No map files intersect the selected area')
	if (chunks.length > MAX_REGION_BLOBS) {
		throw new Error(`This area requires more than ${MAX_REGION_BLOBS} map files`)
	}

	let knownBytes = 0
	let unknownSizeCount = 0
	const blobs = chunks.map(([, chunk], ordinal) => {
		const match = chunk.file.match(SHA256_FILE)
		if (!match?.[1]) throw new Error('A map file is not bound to a SHA-256 identity')
		if (chunk.size === undefined) unknownSizeCount += 1
		else knownBytes += chunk.size
		return {
			sha256: match[1],
			role: 'basemap' as const,
			required: true,
			ordinal,
			...(chunk.size === undefined ? {} : { expectedSize: chunk.size }),
			mirrorUrls: mirrors.map((mirror) => `${mirror.replace(/\/$/u, '')}/${chunk.file}`),
		}
	})

	return {
		request: {
			version: 1,
			id: input.id,
			name: input.name.trim(),
			bbox: input.bbox,
			sourcePubkey: input.sourcePubkey,
			announcementId: input.announcementId,
			blobs,
		},
		chunkCount: blobs.length,
		bytesTotal: unknownSizeCount === 0 ? knownBytes : null,
		unknownSizeCount,
	}
}
