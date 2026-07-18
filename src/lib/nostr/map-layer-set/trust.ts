import type { NostrEvent } from 'nostr-tools'
import type {
	MapChunkAnnouncementRecord,
	MapLayerDescriptor,
	MapLayerMirrors,
	MapLayerSetAnnouncementPayload,
} from '.'

const PUBKEY_PATTERN = /^[0-9a-f]{64}$/u
const PMTILES_FILE_PATTERN = /^[0-9a-f]{64}(?:\.pmtiles)?$/u
const MAX_ANNOUNCEMENT_BYTES = 5 * 1024 * 1024
const MAX_LAYERS = 64
const MAX_CHUNKS = 50_000
export const MAX_MAP_LAYER_BLOB_BYTES = 2 * 1024 * 1024 * 1024
export const MAX_MAP_LAYER_MIRRORS = 8
export const MAX_MAP_LAYER_MIRROR_URL_BYTES = 2_048
const UTF8_ENCODER = new TextEncoder()

type MapLayerSetCandidate = Pick<NostrEvent, 'id' | 'pubkey' | 'created_at' | 'content' | 'tags'>

function objectValue(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null
}

function validBbox(value: unknown): value is [number, number, number, number] {
	if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return false
	const [west, south, east, north] = value as number[]
	return (
		west !== undefined &&
		south !== undefined &&
		east !== undefined &&
		north !== undefined &&
		west >= -180 &&
		west <= 180 &&
		east >= -180 &&
		east <= 180 &&
		south >= -90 &&
		south <= 90 &&
		north >= -90 &&
		north <= 90 &&
		west <= east &&
		south <= north
	)
}

function normalizeMirrorUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null
	try {
		const trimmed = value.trim()
		if (
			trimmed.length === 0 ||
			UTF8_ENCODER.encode(trimmed).byteLength > MAX_MAP_LAYER_MIRROR_URL_BYTES
		) {
			return null
		}
		const url = new URL(trimmed)
		if (url.username || url.password || url.search || url.hash) return null
		const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)
		if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null
		return url.toString().replace(/\/$/u, '')
	} catch {
		return null
	}
}

/** Return a stable, deduplicated mirror order with the deployment fallback last. */
export function normalizeMapLayerMirrors(layer: MapLayerMirrors, fallback?: string): string[] {
	const normalized: string[] = []
	const seen = new Set<string>()
	const add = (candidate: unknown) => {
		if (normalized.length >= MAX_MAP_LAYER_MIRRORS) return
		const url = normalizeMirrorUrl(candidate)
		if (!url || seen.has(url)) return
		seen.add(url)
		normalized.push(url)
	}
	if (Array.isArray(layer.blossomServers)) {
		for (const candidate of layer.blossomServers) {
			add(candidate)
			if (normalized.length >= MAX_MAP_LAYER_MIRRORS) return normalized
		}
	}
	add(layer.blossomServer)
	add(fallback)
	return normalized
}

function normalizeCommonLayer(value: Record<string, unknown>) {
	if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 128) return null
	if (typeof value.title !== 'string' || value.title.length === 0 || value.title.length > 256) {
		return null
	}
	if (value.defaultEnabled !== undefined && typeof value.defaultEnabled !== 'boolean') return null
	if (
		value.defaultOpacity !== undefined &&
		(typeof value.defaultOpacity !== 'number' ||
			!Number.isFinite(value.defaultOpacity) ||
			value.defaultOpacity < 0 ||
			value.defaultOpacity > 1)
	) {
		return null
	}
	if (
		value.blossomServers !== undefined &&
		(!Array.isArray(value.blossomServers) ||
			value.blossomServers.length > MAX_MAP_LAYER_MIRRORS ||
			value.blossomServers.some((server) => typeof server !== 'string'))
	) {
		return null
	}
	if (value.blossomServer !== undefined && typeof value.blossomServer !== 'string') return null
	const signedMirrorCount =
		(Array.isArray(value.blossomServers) ? value.blossomServers.length : 0) +
		(typeof value.blossomServer === 'string' ? 1 : 0)
	if (signedMirrorCount > MAX_MAP_LAYER_MIRRORS) return null
	const blossomServers = normalizeMapLayerMirrors({
		blossomServers: Array.isArray(value.blossomServers)
			? (value.blossomServers as string[])
			: undefined,
		blossomServer: typeof value.blossomServer === 'string' ? value.blossomServer : undefined,
	})
	return {
		id: value.id,
		title: value.title,
		defaultEnabled: value.defaultEnabled as boolean | undefined,
		defaultOpacity: value.defaultOpacity as number | undefined,
		blossomServers,
		blossomServer: blossomServers[0],
	}
}

function normalizeAnnouncement(value: unknown): MapChunkAnnouncementRecord | null {
	const record = objectValue(value)
	if (!record || Object.keys(record).length === 0 || Object.keys(record).length > MAX_CHUNKS) {
		return null
	}
	const normalized: MapChunkAnnouncementRecord = {}
	for (const [geohash, rawChunk] of Object.entries(record)) {
		if (!/^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/u.test(geohash)) return null
		const chunk = objectValue(rawChunk)
		if (!chunk || !validBbox(chunk.bbox)) return null
		if (typeof chunk.file !== 'string' || !PMTILES_FILE_PATTERN.test(chunk.file)) return null
		if (
			typeof chunk.maxZoom !== 'number' ||
			!Number.isInteger(chunk.maxZoom) ||
			chunk.maxZoom < 0 ||
			chunk.maxZoom > 24
		) {
			return null
		}
		if (
			chunk.size !== undefined &&
			(typeof chunk.size !== 'number' ||
				!Number.isSafeInteger(chunk.size) ||
				chunk.size <= 0 ||
				chunk.size > MAX_MAP_LAYER_BLOB_BYTES)
		) {
			return null
		}
		normalized[geohash] = {
			bbox: chunk.bbox,
			file: chunk.file,
			maxZoom: chunk.maxZoom,
			...(typeof chunk.size === 'number' ? { size: chunk.size } : {}),
		}
	}
	return normalized
}

function normalizeLayer(value: unknown): MapLayerDescriptor | null {
	const layer = objectValue(value)
	if (!layer) return null
	const common = normalizeCommonLayer(layer)
	if (!common || common.blossomServers.length === 0) return null

	if (layer.kind === 'chunked-vector') {
		const announcement = normalizeAnnouncement(layer.announcement)
		return announcement ? { ...common, kind: layer.kind, announcement } : null
	}
	if (layer.kind === 'pmtiles' || layer.kind === 'file') {
		if (typeof layer.file !== 'string' || !PMTILES_FILE_PATTERN.test(layer.file)) return null
		if (layer.pmtilesType !== undefined && typeof layer.pmtilesType !== 'string') return null
		return {
			...common,
			kind: layer.kind,
			file: layer.file,
			pmtilesType: layer.pmtilesType as string | undefined,
		}
	}
	return null
}

/** Parse and bound untrusted event content before it reaches map or download state. */
export function parseMapLayerSetContent(content: string): MapLayerSetAnnouncementPayload | null {
	if (!content || content.length > MAX_ANNOUNCEMENT_BYTES) return null
	try {
		const value = objectValue(JSON.parse(content))
		if (value?.version !== 1 || !Array.isArray(value.layers) || value.layers.length > MAX_LAYERS) {
			return null
		}
		const layers = value.layers.map(normalizeLayer)
		if (layers.some((layer) => layer === null)) return null
		return { version: 1, layers: layers as MapLayerDescriptor[] }
	} catch {
		return null
	}
}

/** Select latest only after an explicit author allow-list check. */
export function selectLatestTrustedMapLayerSet<T extends MapLayerSetCandidate>(
	events: readonly T[],
	trustedPubkeys: readonly string[],
): T | null {
	const trusted = new Set(trustedPubkeys.filter((key) => PUBKEY_PATTERN.test(key)))
	let best: T | null = null
	for (const event of events) {
		if (!trusted.has(event.pubkey) || !parseMapLayerSetContent(event.content)) continue
		if (
			!best ||
			event.created_at > best.created_at ||
			(event.created_at === best.created_at && event.id < best.id)
		) {
			best = event
		}
	}
	return best
}
