import maplibregl from 'maplibre-gl'
import { PMTiles, Protocol, TileType } from 'pmtiles'
import { config } from '@/config/env.client'
import { lonLatToWorldGeohash, tileCenterLonLat } from '@/lib/worldGeohash'
import type { AnnouncementRecord } from './types'

/**
 * Module-level state for the `pmworld://` protocol.
 *
 * The custom `pmworld://` URLs are resolved by:
 *   1. Computing the tile center's lon/lat
 *   2. Encoding to a geohash at `precision`
 *   3. Longest-prefix-matching against `announcement` to find a PMTiles file
 *   4. Fetching the file from `blossomServer` and serving the requested z/x/y
 *
 * State is module-level so the protocol handler (also module-level) can read
 * the latest values without hot-loading.
 */
const pmworldState = {
	announcement: null as AnnouncementRecord | null,
	precision: 1,
	maxZoom: 8,
	blossomServer: config.blossomServer as string,
}

/** Cache for PMTiles instances. Shared across remounts (intentional). */
export const pmtilesCache: Record<string, PMTiles> = {}

let pmworldProtocolRegistered = false
let pmtilesProtocolRegistered = false
let pmtilesProtocolInstance: Protocol | null = null

/**
 * Longest-prefix match against the announcement record.
 *
 * Supports mixed-precision announcements where some geohashes are subdivided
 * (e.g. "u0", "u1", ..., "uz") and others are not (e.g. "v", "w").
 */
function findLongestPrefixMatch(
	announcement: AnnouncementRecord | null,
	geohash: string,
): AnnouncementRecord[string] | undefined {
	if (!announcement) return undefined
	for (let len = geohash.length; len >= 1; len--) {
		const prefix = geohash.slice(0, len)
		if (announcement[prefix]) return announcement[prefix]
	}
	return undefined
}

/**
 * Register the `pmtiles://` and `pmworld://` MapLibre protocols.
 *
 * Idempotent. Safe to call from multiple component mounts; the underlying
 * MapLibre protocol registration is global.
 */
export function ensurePmtilesProtocolsRegistered(): void {
	if (!pmtilesProtocolInstance) {
		pmtilesProtocolInstance = new Protocol()
	}
	const protocol = pmtilesProtocolInstance

	if (!pmtilesProtocolRegistered) {
		maplibregl.addProtocol('pmtiles', protocol.tile)
		pmtilesProtocolRegistered = true
	}

	if (!pmworldProtocolRegistered) {
		maplibregl.addProtocol('pmworld', async (params, abortController) => {
			if (params.type === 'json') {
				const maxzoom = pmworldState.maxZoom
				return {
					data: {
						tiles: [`${params.url}/{z}/{x}/{y}`],
						minzoom: 0,
						maxzoom,
						bounds: [-180, -90, 180, 90],
					},
				}
			}

			const m = params.url.match(/^pmworld:\/\/.+\/(\d+)\/(\d+)\/(\d+)$/)
			if (!m) throw new Error('Invalid pmworld URL')
			const z = Number(m[1])
			const x = Number(m[2])
			const y = Number(m[3])

			const center = tileCenterLonLat(z, x, y)
			const gh = lonLatToWorldGeohash(pmworldState.precision, center.lon, center.lat)
			const record = findLongestPrefixMatch(pmworldState.announcement, gh)
			if (!record) return { data: new Uint8Array() }

			const pmtilesUrl = `${pmworldState.blossomServer}/${record.file}`
			let pm = pmtilesCache[pmtilesUrl]
			if (!pm) {
				pm = new PMTiles(pmtilesUrl)
				pmtilesCache[pmtilesUrl] = pm
			}

			const header = await pm.getHeader()
			const resp = await pm.getZxy(z, x, y, abortController.signal)
			if (resp) {
				return {
					data: new Uint8Array(resp.data),
					cacheControl: resp.cacheControl,
					expires: resp.expires,
				}
			}
			if (header.tileType === TileType.Mvt) return { data: new Uint8Array() }
			return { data: null }
		})
		pmworldProtocolRegistered = true
	}
}

/** Update the announcement/precision/server used by the `pmworld://` resolver. */
export function setPmworldState(next: {
	announcement?: AnnouncementRecord | null
	precision?: number
	maxZoom?: number
	blossomServer?: string
}): void {
	if (next.announcement !== undefined) pmworldState.announcement = next.announcement
	if (next.precision !== undefined) pmworldState.precision = next.precision
	if (next.maxZoom !== undefined) pmworldState.maxZoom = next.maxZoom
	if (next.blossomServer !== undefined) pmworldState.blossomServer = next.blossomServer
}

export function getPmworldMaxZoom(): number {
	return pmworldState.maxZoom
}
