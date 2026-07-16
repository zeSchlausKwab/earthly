export type StoredMapSourcePreference = {
	version: 1
	type: 'default' | 'blossom'
}

export type StoredMapViewport = {
	version: 1
	center: [number, number]
	zoom: number
	bearing: number
	pitch: number
}

export const MAP_SOURCE_PREFERENCE_STORAGE_KEY = 'earthly-map-source-preference-v1'
export const MAP_VIEWPORT_STORAGE_KEY = 'earthly-map-viewport-v1'

function storageOrDefault(storage?: Pick<Storage, 'getItem'>): Pick<Storage, 'getItem'> | null {
	return storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
}

export function parseStoredMapSourcePreference(value: unknown): StoredMapSourcePreference | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Partial<StoredMapSourcePreference>
	if (candidate.version !== 1 || (candidate.type !== 'default' && candidate.type !== 'blossom')) {
		return null
	}
	return { version: 1, type: candidate.type }
}

export function readStoredMapSourcePreference(
	storage?: Pick<Storage, 'getItem'>,
): StoredMapSourcePreference | null {
	const target = storageOrDefault(storage)
	if (!target) return null
	try {
		const raw = target.getItem(MAP_SOURCE_PREFERENCE_STORAGE_KEY)
		return raw ? parseStoredMapSourcePreference(JSON.parse(raw)) : null
	} catch {
		return null
	}
}

export function writeStoredMapSourcePreference(
	preference: StoredMapSourcePreference,
	storage?: Pick<Storage, 'setItem'>,
): void {
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return
	try {
		target.setItem(MAP_SOURCE_PREFERENCE_STORAGE_KEY, JSON.stringify(preference))
	} catch (error) {
		console.warn('Unable to persist the selected map source', error)
	}
}

function validCoordinate(value: unknown, min: number, max: number): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

export function parseStoredMapViewport(value: unknown): StoredMapViewport | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as Partial<StoredMapViewport>
	if (
		candidate.version !== 1 ||
		!Array.isArray(candidate.center) ||
		candidate.center.length !== 2 ||
		!validCoordinate(candidate.center[0], -180, 180) ||
		!validCoordinate(candidate.center[1], -85.051129, 85.051129) ||
		!validCoordinate(candidate.zoom, 0, 22) ||
		!validCoordinate(candidate.bearing, -360, 360) ||
		!validCoordinate(candidate.pitch, 0, 85)
	) {
		return null
	}
	return {
		version: 1,
		center: [candidate.center[0], candidate.center[1]],
		zoom: candidate.zoom,
		bearing: candidate.bearing,
		pitch: candidate.pitch,
	}
}

export function readStoredMapViewport(
	storage?: Pick<Storage, 'getItem'>,
): StoredMapViewport | null {
	const target = storageOrDefault(storage)
	if (!target) return null
	try {
		const raw = target.getItem(MAP_VIEWPORT_STORAGE_KEY)
		return raw ? parseStoredMapViewport(JSON.parse(raw)) : null
	} catch {
		return null
	}
}

export function writeStoredMapViewport(
	viewport: StoredMapViewport,
	storage?: Pick<Storage, 'setItem'>,
): void {
	const target = storage ?? (typeof localStorage === 'undefined' ? null : localStorage)
	if (!target) return
	try {
		target.setItem(MAP_VIEWPORT_STORAGE_KEY, JSON.stringify(viewport))
	} catch (error) {
		console.warn('Unable to persist the map viewport', error)
	}
}
