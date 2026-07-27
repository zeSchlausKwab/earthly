import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import type { Dirent, Stats } from 'node:fs'
import { join } from 'node:path'
import type { OGCacheType } from './cache'
import { parseOGImageVersion } from './imageVersion'

export type OGImageCacheStatus = 'hit' | 'miss'

interface GetOrCreateOGImageOptions {
	type: OGCacheType
	version: string
	render: () => Promise<Uint8Array | null>
	root?: string
}

interface OGImageCacheResult {
	png: Uint8Array
	cacheStatus: OGImageCacheStatus
}

interface PruneOGImageCacheOptions {
	now?: number
	maxAgeMs?: number
	maxFiles?: number
	maxBytes?: number
	temporaryMaxAgeMs?: number
}

interface PruneOGImageCacheResult {
	removedImages: number
	removedTemporaryFiles: number
	remainingImages: number
	remainingBytes: number
}

interface CachedImageFile {
	path: string
	mtimeMs: number
	size: number
}

const OG_IMAGE_CACHE_TYPES: OGCacheType[] = ['geoevent', 'context', 'story', 'sighting', 'beacon']
const DEFAULT_MAX_CACHE_AGE_MS = 180 * 24 * 60 * 60 * 1000
const DEFAULT_MAX_CACHE_FILES = 5000
const DEFAULT_MAX_CACHE_BYTES = 512 * 1024 * 1024
const DEFAULT_TEMPORARY_MAX_AGE_MS = 60 * 60 * 1000
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000

const inflightImages = new Map<string, Promise<OGImageCacheResult>>()
const inflightPrunes = new Map<string, Promise<PruneOGImageCacheResult>>()
const lastPruneAt = new Map<string, number>()

function cachePath(root: string, type: OGCacheType, version: string): string {
	if (!parseOGImageVersion(version)) throw new Error('Invalid OG image version')
	return join(root, type, `${version}.png`)
}

async function readCachedImage(path: string): Promise<Uint8Array | null> {
	try {
		return new Uint8Array(await readFile(path))
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
		throw error
	}
}

async function removeCacheFile(path: string): Promise<boolean> {
	try {
		await unlink(path)
		return true
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
		throw error
	}
}

/**
 * Bound the persistent renderer cache without deleting directories or touching
 * anything outside the five known OG cache namespaces. Stale temporary files
 * are removed first, then old images, then the oldest images until both the
 * file-count and byte budgets are satisfied.
 */
export async function pruneOGImageCache(
	root: string,
	options: PruneOGImageCacheOptions = {},
): Promise<PruneOGImageCacheResult> {
	const now = options.now ?? Date.now()
	const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_CACHE_AGE_MS
	const maxFiles = options.maxFiles ?? DEFAULT_MAX_CACHE_FILES
	const maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES
	const temporaryMaxAgeMs = options.temporaryMaxAgeMs ?? DEFAULT_TEMPORARY_MAX_AGE_MS
	const images: CachedImageFile[] = []
	let removedTemporaryFiles = 0

	for (const type of OG_IMAGE_CACHE_TYPES) {
		const directory = join(root, type)
		let entries: Dirent[]
		try {
			entries = await readdir(directory, { withFileTypes: true })
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
			throw error
		}

		for (const entry of entries) {
			if (!entry.isFile()) continue
			const path = join(directory, entry.name)
			let fileStat: Stats
			try {
				fileStat = await stat(path)
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
				throw error
			}
			if (entry.name.endsWith('.tmp')) {
				if (now - fileStat.mtimeMs > temporaryMaxAgeMs && (await removeCacheFile(path))) {
					removedTemporaryFiles += 1
				}
				continue
			}
			if (!entry.name.endsWith('.png')) continue
			const version = entry.name.slice(0, -'.png'.length)
			if (!parseOGImageVersion(version)) continue
			images.push({ path, mtimeMs: fileStat.mtimeMs, size: fileStat.size })
		}
	}

	let removedImages = 0
	const retained: CachedImageFile[] = []
	for (const image of images) {
		if (now - image.mtimeMs > maxAgeMs) {
			if (await removeCacheFile(image.path)) removedImages += 1
		} else {
			retained.push(image)
		}
	}

	retained.sort((left, right) => left.mtimeMs - right.mtimeMs)
	let remainingBytes = retained.reduce((total, image) => total + image.size, 0)
	while (retained.length > maxFiles || remainingBytes > maxBytes) {
		const oldest = retained.shift()
		if (!oldest) break
		if (await removeCacheFile(oldest.path)) removedImages += 1
		remainingBytes -= oldest.size
	}

	return {
		removedImages,
		removedTemporaryFiles,
		remainingImages: retained.length,
		remainingBytes,
	}
}

function scheduleImageCachePrune(root: string): void {
	const now = Date.now()
	if (now - (lastPruneAt.get(root) ?? 0) < PRUNE_INTERVAL_MS) return
	if (inflightPrunes.has(root)) return
	lastPruneAt.set(root, now)
	const pending = pruneOGImageCache(root)
		.catch((error) => {
			console.error('[OG image cache] Maintenance failed:', error)
			return {
				removedImages: 0,
				removedTemporaryFiles: 0,
				remainingImages: 0,
				remainingBytes: 0,
			}
		})
		.finally(() => {
			inflightPrunes.delete(root)
		})
	inflightPrunes.set(root, pending)
}

/**
 * Store a rendered social image under a content-addressed event/render version.
 * The temporary file + rename prevents concurrent crawlers from observing a
 * partially written PNG.
 */
export async function getOrCreateOGImage(
	options: GetOrCreateOGImageOptions,
): Promise<OGImageCacheResult> {
	const root = options.root ?? join(process.cwd(), 'data', 'og-images')
	const path = cachePath(root, options.type, options.version)
	const cached = await readCachedImage(path)
	if (cached) return { png: cached, cacheStatus: 'hit' }

	const inflightKey = `${path}`
	const existing = inflightImages.get(inflightKey)
	if (existing) return existing

	const work = (async () => {
		const raced = await readCachedImage(path)
		if (raced) return { png: raced, cacheStatus: 'hit' as const }

		const png = await options.render()
		if (!png) throw new Error('Image generation failed')

		await mkdir(join(root, options.type), { recursive: true })
		const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`
		await writeFile(temporaryPath, png)
		await rename(temporaryPath, path)
		// Custom roots are used by tests and one-off tooling; only the server's
		// persistent default cache needs opportunistic background maintenance.
		if (!options.root) scheduleImageCachePrune(root)
		return { png, cacheStatus: 'miss' as const }
	})().finally(() => {
		inflightImages.delete(inflightKey)
	})

	inflightImages.set(inflightKey, work)
	return work
}
