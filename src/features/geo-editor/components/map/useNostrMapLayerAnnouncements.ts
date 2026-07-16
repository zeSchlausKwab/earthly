import { useEffect, useMemo, useState } from 'react'
import { config } from '@/config/env.client'
import {
	normalizeMapLayerMirrors,
	parseMapLayerSetContent,
	selectLatestTrustedMapLayerSet,
} from '@/lib/nostr/map-layer-set/trust'
import { MAP_LAYER_SET_KIND } from '@/lib/nostr/kinds'
import { useTimeline } from '@/lib/nostr/hooks'
import { useEditorStore, type MapLayerState } from '../../store'
import { getMirroredPmtiles, setPmworldState } from './pmtilesProtocols'
import type { AnnouncementRecord, MapSource } from './types'

/**
 * Subscribe to NIP 34444 (`MAP_LAYER_SET_KIND`) map-layer-set announcements,
 * populate `useEditorStore.mapLayers` + `announcementSource`, and update the
 * `pmworld://` resolver state.
 *
 * Returns `tileSourceMaxZoom` — the discovered max zoom for the chunked-vector
 * basemap (null while probing). The wrapper uses this to gate the initial
 * blossom style build.
 *
 * Only does work when `mapSource.type === 'blossom'`; otherwise clears state.
 */
export function useNostrMapLayerAnnouncements(mapSource: MapSource): number | null {
	const [tileSourceMaxZoom, setTileSourceMaxZoom] = useState<number | null>(null)

	// IMPORTANT: pre-applesauce NDK required at least one filter; we always
	// subscribe and only *use* the result when mapSource.type === 'blossom'.
	const mapLayerSetEvents = useTimeline([
		{
			kinds: [MAP_LAYER_SET_KIND],
			authors:
				config.trustedMapnoliaPubkeys.length > 0
					? [...config.trustedMapnoliaPubkeys]
					: ['0'.repeat(64)],
			limit: 50,
		},
	])

	// Stable "latest event" so our effect doesn't re-trigger on every render.
	const latestLayerSetEvent = useMemo(
		() => selectLatestTrustedMapLayerSet(mapLayerSetEvents, config.trustedMapnoliaPubkeys),
		[mapLayerSetEvents],
	)

	const latestLayerSetContent = latestLayerSetEvent?.content ?? null
	const payload = useMemo(
		() => (latestLayerSetContent ? parseMapLayerSetContent(latestLayerSetContent) : null),
		[latestLayerSetContent],
	)

	useEffect(() => {
		const { setMapLayers, setAnnouncementSource } = useEditorStore.getState()

		if (mapSource.type !== 'blossom') {
			setPmworldState({ announcement: null })
			setTileSourceMaxZoom(null)
			setMapLayers([])
			setAnnouncementSource(null)
			return
		}

		// Source metadata from event tags.
		if (latestLayerSetEvent) {
			const getTag = (key: string) =>
				latestLayerSetEvent.tags?.find((t: string[]) => t[0] === key)?.[1] ?? null
			setAnnouncementSource({
				name: getTag('name'),
				about: getTag('about'),
				pubkey: latestLayerSetEvent.pubkey ?? null,
				createdAt: latestLayerSetEvent.created_at ?? null,
				trusted: true,
			})
		} else {
			setAnnouncementSource(null)
		}

		const chunkedVectorLayer = payload?.layers.find((l) => l.kind === 'chunked-vector') ?? null

		const announcement = (
			chunkedVectorLayer && 'announcement' in chunkedVectorLayer
				? chunkedVectorLayer.announcement
				: null
		) as AnnouncementRecord | null

		const blossomServers = chunkedVectorLayer
			? normalizeMapLayerMirrors(chunkedVectorLayer, config.blossomServer)
			: [config.blossomServer]
		setPmworldState({ blossomServers })

		// Populate layer state for UI
		if (payload?.layers) {
			const layerStates: MapLayerState[] = payload.layers.map((layer) => ({
				id: layer.id,
				title: layer.title,
				kind: layer.kind,
				enabled: layer.defaultEnabled ?? true,
				opacity: layer.defaultOpacity ?? 1,
				blossomServer: normalizeMapLayerMirrors(layer, config.blossomServer)[0],
				blossomServers: normalizeMapLayerMirrors(layer, config.blossomServer),
				file: 'file' in layer ? layer.file : undefined,
				pmtilesType: 'pmtilesType' in layer ? layer.pmtilesType : undefined,
			}))
			setMapLayers(layerStates)
		} else {
			setMapLayers([])
		}

		setPmworldState({
			announcement: announcement && Object.keys(announcement).length > 0 ? announcement : null,
		})

		let cancelled = false
		;(async () => {
			try {
				const data = announcement
				if (!data || Object.keys(data).length === 0) {
					setTileSourceMaxZoom(null)
					return
				}
				if (cancelled) return

				// For mixed-precision announcements, use the maximum precision.
				const geohashes = Object.keys(data)
				const firstKey = geohashes[0]
				if (geohashes.length > 0) {
					const maxPrecision = Math.max(...geohashes.map((gh) => gh.length))
					setPmworldState({ precision: maxPrecision })
				}

				const announcedMaxZoom = Object.values(data).reduce((acc, v) => Math.max(acc, v.maxZoom), 0)

				const firstRecord = firstKey ? data[firstKey] : undefined
				if (!firstRecord) {
					if (Number.isFinite(announcedMaxZoom) && announcedMaxZoom > 0) {
						setPmworldState({ maxZoom: announcedMaxZoom })
						setTileSourceMaxZoom(announcedMaxZoom)
					} else {
						setTileSourceMaxZoom(null)
					}
					return
				}

				// Probe first PMTiles file for actual maxZoom
				try {
					const pm = getMirroredPmtiles(firstRecord.file, blossomServers)
					const header = await pm.getHeader()
					if (cancelled) return

					const nativeMaxZoom = header.maxZoom
					const effectiveMaxZoom =
						Number.isFinite(nativeMaxZoom) && nativeMaxZoom >= 0
							? nativeMaxZoom
							: Number.isFinite(announcedMaxZoom) && announcedMaxZoom >= 0
								? announcedMaxZoom
								: undefined
					if (effectiveMaxZoom !== undefined) {
						setPmworldState({ maxZoom: effectiveMaxZoom })
						setTileSourceMaxZoom(effectiveMaxZoom)
					}
				} catch {
					if (cancelled) return
					if (Number.isFinite(announcedMaxZoom) && announcedMaxZoom > 0) {
						setPmworldState({ maxZoom: announcedMaxZoom })
						setTileSourceMaxZoom(announcedMaxZoom)
					}
				}
			} catch (error) {
				console.error('Failed to apply announcement:', error)
			}
		})()

		return () => {
			cancelled = true
		}
	}, [mapSource.type, latestLayerSetEvent, payload])

	return tileSourceMaxZoom
}
