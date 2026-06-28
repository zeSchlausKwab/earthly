import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'
import { fetchContextEventOGData, type ContextEventOGData } from './fetchContextEvent'
import {
	fetchGeoEventOGData,
	fetchSightingOGData,
	fetchStoryOGData,
	type GeoEventOGData,
	type SightingOGData,
	type StoryOGData,
} from './fetchEvent'

export type OGCacheType = 'geoevent' | 'context' | 'story' | 'sighting'
export type OGCacheStatus = 'fresh' | 'stale' | 'refreshed' | 'fallback'

type OGPayloadByType = {
	geoevent: GeoEventOGData
	context: ContextEventOGData
	story: StoryOGData
	sighting: SightingOGData
}

interface CachedOGRecord<T extends OGCacheType = OGCacheType> {
	cacheKey: string
	type: T
	naddr: string
	payload: OGPayloadByType[T]
	fetchedAt: number
	expiresAt: number
	staleUntil: number
}

interface CachedOGRow {
	type: OGCacheType
	naddr: string
	payload_json: string
	fetched_at: number
	expires_at: number
	stale_until: number
}

interface ResolveCachedOGOptions {
	waitForFreshMs?: number
}

interface ResolveCachedOGResult<T extends OGCacheType> {
	data: OGPayloadByType[T] | null
	cacheStatus: OGCacheStatus
}

const OG_CACHE_DB_PATH = join(process.cwd(), 'data', 'og-cache.sqlite')
const FRESH_TTL_MS = 10 * 60 * 1000
const STALE_WHILE_REVALIDATE_MS = 24 * 60 * 60 * 1000
const DEFAULT_WAIT_FOR_FRESH_MS = 750
const CACHE_TIMEOUT = Symbol('og-cache-timeout')

const inMemoryCache = new Map<string, CachedOGRecord>()
const inflightRefreshes = new Map<string, Promise<CachedOGRecord | null>>()

let cacheDb: Database | null | undefined

function getCacheKey(type: OGCacheType, naddr: string): string {
	return `${type}:${naddr}`
}

function getCacheDb(): Database | null {
	if (cacheDb !== undefined) return cacheDb

	try {
		mkdirSync(join(process.cwd(), 'data'), { recursive: true })
		const db = new Database(OG_CACHE_DB_PATH, { create: true })
		db.exec(`
			PRAGMA journal_mode = WAL;
			CREATE TABLE IF NOT EXISTS og_cache (
				cache_key TEXT PRIMARY KEY,
				type TEXT NOT NULL,
				naddr TEXT NOT NULL,
				payload_json TEXT NOT NULL,
				fetched_at INTEGER NOT NULL,
				expires_at INTEGER NOT NULL,
				stale_until INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS idx_og_cache_stale_until ON og_cache(stale_until);
		`)
		db.query('DELETE FROM og_cache WHERE stale_until < ?').run(Date.now())
		cacheDb = db
		return db
	} catch (error) {
		console.error('[OG cache] Failed to initialize SQLite cache:', error)
		cacheDb = null
		return null
	}
}

function deserializeCacheRow<T extends OGCacheType>(
	type: T,
	naddr: string,
	row: CachedOGRow,
): CachedOGRecord<T> | null {
	try {
		const payload = JSON.parse(row.payload_json) as OGPayloadByType[T]
		return {
			cacheKey: getCacheKey(type, naddr),
			type,
			naddr,
			payload,
			fetchedAt: row.fetched_at,
			expiresAt: row.expires_at,
			staleUntil: row.stale_until,
		}
	} catch (error) {
		console.error('[OG cache] Failed to deserialize cached row:', error)
		return null
	}
}

function loadCachedRecord<T extends OGCacheType>(type: T, naddr: string): CachedOGRecord<T> | null {
	const cacheKey = getCacheKey(type, naddr)
	const fromMemory = inMemoryCache.get(cacheKey)
	if (fromMemory) return fromMemory as CachedOGRecord<T>

	const db = getCacheDb()
	if (!db) return null

	const row = db
		.query(
			'SELECT type, naddr, payload_json, fetched_at, expires_at, stale_until FROM og_cache WHERE cache_key = ?',
		)
		.get(cacheKey) as CachedOGRow | null
	if (!row) return null

	const record = deserializeCacheRow(type, naddr, row)
	if (!record) {
		db.query('DELETE FROM og_cache WHERE cache_key = ?').run(cacheKey)
		return null
	}

	inMemoryCache.set(cacheKey, record)
	return record
}

function persistCachedRecord(record: CachedOGRecord): void {
	inMemoryCache.set(record.cacheKey, record)

	const db = getCacheDb()
	if (!db) return

	db.query(
		`INSERT INTO og_cache (
			cache_key, type, naddr, payload_json, fetched_at, expires_at, stale_until
		) VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(cache_key) DO UPDATE SET
			type = excluded.type,
			naddr = excluded.naddr,
			payload_json = excluded.payload_json,
			fetched_at = excluded.fetched_at,
			expires_at = excluded.expires_at,
			stale_until = excluded.stale_until`,
	).run(
		record.cacheKey,
		record.type,
		record.naddr,
		JSON.stringify(record.payload),
		record.fetchedAt,
		record.expiresAt,
		record.staleUntil,
	)
}

function isFresh(record: CachedOGRecord, now: number): boolean {
	return record.expiresAt > now
}

function isStaleButUsable(record: CachedOGRecord, now: number): boolean {
	return record.staleUntil > now
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | typeof CACHE_TIMEOUT> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve(CACHE_TIMEOUT), timeoutMs)
		void promise.then(
			(value) => {
				clearTimeout(timeout)
				resolve(value)
			},
			() => {
				clearTimeout(timeout)
				resolve(CACHE_TIMEOUT)
			},
		)
	})
}

async function fetchAndCacheRecord<T extends OGCacheType>(
	type: T,
	naddr: string,
	relayUrl: string,
): Promise<CachedOGRecord<T> | null> {
	const payload =
		type === 'geoevent'
			? ((await fetchGeoEventOGData(naddr, relayUrl)) as OGPayloadByType[T] | null)
			: type === 'story'
				? ((await fetchStoryOGData(naddr, relayUrl)) as OGPayloadByType[T] | null)
				: type === 'sighting'
					? ((await fetchSightingOGData(naddr, relayUrl)) as OGPayloadByType[T] | null)
					: ((await fetchContextEventOGData(naddr, relayUrl)) as OGPayloadByType[T] | null)

	if (!payload) return null

	const now = Date.now()
	const record: CachedOGRecord<T> = {
		cacheKey: getCacheKey(type, naddr),
		type,
		naddr,
		payload,
		fetchedAt: now,
		expiresAt: now + FRESH_TTL_MS,
		staleUntil: now + FRESH_TTL_MS + STALE_WHILE_REVALIDATE_MS,
	}
	persistCachedRecord(record)
	return record
}

function refreshCachedRecord<T extends OGCacheType>(
	type: T,
	naddr: string,
	relayUrl: string,
): Promise<CachedOGRecord<T> | null> {
	const cacheKey = getCacheKey(type, naddr)
	const existing = inflightRefreshes.get(cacheKey)
	if (existing) {
		return existing as Promise<CachedOGRecord<T> | null>
	}

	const refreshPromise = fetchAndCacheRecord(type, naddr, relayUrl)
		.catch((error) => {
			console.error(`[OG cache] Failed to refresh ${cacheKey}:`, error)
			return null
		})
		.finally(() => {
			inflightRefreshes.delete(cacheKey)
		})

	inflightRefreshes.set(cacheKey, refreshPromise as Promise<CachedOGRecord | null>)
	return refreshPromise
}

async function resolveCachedOGData<T extends OGCacheType>(
	type: T,
	naddr: string,
	relayUrl: string,
	options?: ResolveCachedOGOptions,
): Promise<ResolveCachedOGResult<T>> {
	const now = Date.now()
	const cached = loadCachedRecord(type, naddr)

	if (cached && isFresh(cached, now)) {
		return {
			data: cached.payload,
			cacheStatus: 'fresh',
		}
	}

	if (cached && isStaleButUsable(cached, now)) {
		void refreshCachedRecord(type, naddr, relayUrl)
		return {
			data: cached.payload,
			cacheStatus: 'stale',
		}
	}

	const refreshed = await withTimeout(
		refreshCachedRecord(type, naddr, relayUrl),
		options?.waitForFreshMs ?? DEFAULT_WAIT_FOR_FRESH_MS,
	)
	if (refreshed !== CACHE_TIMEOUT && refreshed?.payload) {
		return {
			data: refreshed.payload,
			cacheStatus: 'refreshed',
		}
	}

	if (cached?.payload) {
		return {
			data: cached.payload,
			cacheStatus: 'stale',
		}
	}

	return {
		data: null,
		cacheStatus: 'fallback',
	}
}

export function getOGRouteHeaders(cacheStatus: OGCacheStatus): Record<string, string> {
	return {
		'Content-Type': 'text/html; charset=utf-8',
		'Cache-Control': 'public, max-age=60, s-maxage=300',
		'X-Earthly-OG-Cache': cacheStatus,
	}
}

export function getOGImageHeaders(cacheStatus: OGCacheStatus): Record<string, string> {
	return {
		'Content-Type': 'image/png',
		'Cache-Control': 'public, max-age=300, s-maxage=300',
		'X-Earthly-OG-Cache': cacheStatus,
	}
}

export function warmOGCache(type: OGCacheType, naddr: string, relayUrl: string): void {
	void refreshCachedRecord(type, naddr, relayUrl)
}

export async function fetchCachedGeoEventOGData(
	naddr: string,
	relayUrl: string,
	options?: ResolveCachedOGOptions,
): Promise<ResolveCachedOGResult<'geoevent'>> {
	return resolveCachedOGData('geoevent', naddr, relayUrl, options)
}

export async function fetchCachedContextEventOGData(
	naddr: string,
	relayUrl: string,
	options?: ResolveCachedOGOptions,
): Promise<ResolveCachedOGResult<'context'>> {
	return resolveCachedOGData('context', naddr, relayUrl, options)
}

export async function fetchCachedStoryEventOGData(
	naddr: string,
	relayUrl: string,
	options?: ResolveCachedOGOptions,
): Promise<ResolveCachedOGResult<'story'>> {
	return resolveCachedOGData('story', naddr, relayUrl, options)
}

export async function fetchCachedSightingEventOGData(
	naddr: string,
	relayUrl: string,
	options?: ResolveCachedOGOptions,
): Promise<ResolveCachedOGResult<'sighting'>> {
	return resolveCachedOGData('sighting', naddr, relayUrl, options)
}
