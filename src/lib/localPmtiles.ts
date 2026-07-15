import { PMTiles, TileType, type Source } from 'pmtiles'

export type PmtilesKind = 'vector' | 'raster'

export interface InspectedPmtiles {
	kind: PmtilesKind
	minZoom: number
	maxZoom: number
	bounds: [number, number, number, number]
}

export interface StoredLocalPmtiles {
	version: 1
	sha256: string
	url: string
	kind: PmtilesKind
}

export const LOCAL_PMTILES_STORAGE_KEY = 'earthly-local-pmtiles-v1'

const SHA256_PATTERN = /^[0-9a-f]{64}$/

export function classifyPmtilesTileType(tileType: TileType): PmtilesKind {
	if (tileType === TileType.Mvt || tileType === TileType.Mlt) return 'vector'
	if (
		tileType === TileType.Png ||
		tileType === TileType.Jpeg ||
		tileType === TileType.Webp ||
		tileType === TileType.Avif
	) {
		return 'raster'
	}
	throw new Error('This PMTiles archive uses an unsupported tile format')
}

/** Read only the PMTiles header and root directory through bounded range requests. */
export async function inspectPmtiles(source: string | Source): Promise<InspectedPmtiles> {
	const header = await new PMTiles(source).getHeader()
	return {
		kind: classifyPmtilesTileType(header.tileType),
		minZoom: header.minZoom,
		maxZoom: header.maxZoom,
		bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
	}
}

function isLocalBlobUrl(url: string, sha256: string): boolean {
	try {
		const parsed = new URL(url)
		if (parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash)
			return false
		if (parsed.pathname !== `/${sha256}`) return false
		return (
			(parsed.protocol === 'earthly-blob:' && parsed.hostname === 'localhost') ||
			(parsed.protocol === 'http:' && parsed.hostname === 'earthly-blob.localhost')
		)
	} catch {
		return false
	}
}

export function parseStoredLocalPmtiles(value: unknown): StoredLocalPmtiles | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Partial<StoredLocalPmtiles>
	if (candidate.version !== 1 || !candidate.sha256 || !SHA256_PATTERN.test(candidate.sha256)) {
		return null
	}
	if (candidate.kind !== 'vector' && candidate.kind !== 'raster') return null
	if (typeof candidate.url !== 'string' || !isLocalBlobUrl(candidate.url, candidate.sha256)) {
		return null
	}
	return {
		version: 1,
		sha256: candidate.sha256,
		url: candidate.url,
		kind: candidate.kind,
	}
}

export function readStoredLocalPmtiles(
	storage?: Pick<Storage, 'getItem'>,
): StoredLocalPmtiles | null {
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return null
	try {
		const raw = target.getItem(LOCAL_PMTILES_STORAGE_KEY)
		return raw ? parseStoredLocalPmtiles(JSON.parse(raw)) : null
	} catch {
		return null
	}
}

export function writeStoredLocalPmtiles(
	selection: StoredLocalPmtiles | null,
	storage?: Pick<Storage, 'setItem' | 'removeItem'>,
): void {
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return
	try {
		if (selection) target.setItem(LOCAL_PMTILES_STORAGE_KEY, JSON.stringify(selection))
		else target.removeItem(LOCAL_PMTILES_STORAGE_KEY)
	} catch (error) {
		console.warn('Unable to persist the selected offline PMTiles archive', error)
	}
}
