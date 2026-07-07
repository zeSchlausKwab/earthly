import type maplibregl from 'maplibre-gl'
import type { RefObject } from 'react'
import { useCallback, useEffect, useRef } from 'react'
import { eventStore } from '@/lib/nostr'
import { coverBboxWithGeohashes, type SearchBBox, searchEntityEvents } from '@/lib/search'
import { useEditorStore } from '../store'
import { GEO_QUERY_KINDS, planGeoQueryEntry, planGeoQueryReconciliation } from './geoQueryPlan'

/**
 * Query-by-view (Map Stack header toggle): while enabled, every pan/zoom
 * (debounced) queries the relay's geo search for entities intersecting the
 * viewport (Lane 2 `bbox:` grammar — docs/GEO_SEARCH_REWRITE.md §4) and
 * reconciles the results into the Map Stack's "Geo query" section.
 *
 * Data flow: relay events → eventStore.add() → the reactive timelines
 * (useGeoDatasets / useSightings / useBeacons) pick them up → the stack
 * entries added here make them render through the existing Phase 13 gates.
 * The hook never builds map layers itself.
 *
 * Transport note: the bbox search (not a `#g` tag filter) is deliberate —
 * client-side filter verification ignores the `search` field, so results
 * survive verifying clients, and old events without multi-precision g tags
 * are still found. The geohash cells are computed only for the transparency
 * readout in the panel.
 */

const MOVE_DEBOUNCE_MS = 500
const QUERY_LIMIT = 100
const QUERY_TIMEOUT_MS = 8000

export function useGeoQueryByView(map: RefObject<maplibregl.Map | null>, mapReady: boolean) {
	const enabled = useEditorStore((state) => state.geoQueryEnabled)

	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
	const lastCellsRef = useRef<string>('')
	const runSeqRef = useRef(0)

	const runQuery = useCallback(
		async (reason: 'enable' | 'move') => {
			const m = map.current
			if (!m || !useEditorStore.getState().geoQueryEnabled) return

			const bounds = m.getBounds()
			// MapLibre bounds exceed ±180/±90 at low zoom (world view) — clamp
			// to valid WGS-84 or the grammar's bbox validation rejects the query.
			const bbox: SearchBBox = [
				Math.max(-180, bounds.getWest()),
				Math.max(-90, bounds.getSouth()),
				Math.min(180, bounds.getEast()),
				Math.min(90, bounds.getNorth()),
			]
			const cells = coverBboxWithGeohashes(bbox)

			// Cells snap to a fixed grid — an unchanged cover means an
			// unchanged query; skip the round-trip on small pans.
			const cellsKey = cells.join(',')
			if (reason === 'move' && cellsKey === lastCellsRef.current) return
			lastCellsRef.current = cellsKey

			const seq = ++runSeqRef.current
			const { setGeoQueryStatus } = useEditorStore.getState()
			setGeoQueryStatus({ cells, loading: true })

			let events: Awaited<ReturnType<typeof searchEntityEvents>> = []
			try {
				events = await searchEntityEvents(
					{ bbox },
					{ kinds: GEO_QUERY_KINDS, limit: QUERY_LIMIT, timeoutMs: QUERY_TIMEOUT_MS },
				)
			} catch {
				// Relay unreachable/timeout: keep whatever is on the map, just
				// stop the spinner. The next move retries naturally.
				if (seq === runSeqRef.current) {
					useEditorStore.getState().setGeoQueryStatus({ loading: false })
				}
				return
			}

			// A newer query superseded this one while it was in flight.
			if (seq !== runSeqRef.current) return

			const state = useEditorStore.getState()
			if (!state.geoQueryEnabled) return

			const now = Math.floor(Date.now() / 1000)
			const fresh = []
			for (const event of events) {
				const plan = planGeoQueryEntry(event, now)
				if (!plan) continue
				// Reactive timelines (datasets/sightings/beacons hooks) read the
				// eventStore — adding here is what makes the entity resolvable.
				eventStore.add(event)
				fresh.push(plan)
			}

			const { toAdd, toRemove } = planGeoQueryReconciliation(state.mapStackEntries, fresh)
			for (const id of toRemove) {
				state.removeMapStackEntry(id)
			}
			for (const plan of toAdd) {
				state.addMapStackEntry({
					entityType: plan.entityType,
					entityKey: plan.entityKey,
					title: plan.title,
					source: 'geo-query',
					visible: true,
					pinned: false,
				})
			}

			state.setGeoQueryStatus({
				loading: false,
				matchCount: fresh.length,
				updatedAt: Date.now(),
			})
		},
		[map],
	)

	useEffect(() => {
		const m = map.current
		if (!enabled || !mapReady || !m) {
			// Disable path: geo-query entries leave the stack (except pinned —
			// the user claimed those), the readout resets via the slice.
			if (!enabled) {
				const state = useEditorStore.getState()
				for (const entry of Object.values(state.mapStackEntries)) {
					if (entry.source === 'geo-query' && !entry.pinned) {
						state.removeMapStackEntry(entry.id)
					}
				}
				lastCellsRef.current = ''
			}
			return
		}

		void runQuery('enable')

		const onMoveEnd = () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
			debounceRef.current = setTimeout(() => {
				void runQuery('move')
			}, MOVE_DEBOUNCE_MS)
		}
		m.on('moveend', onMoveEnd)

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current)
			m.off('moveend', onMoveEnd)
		}
	}, [enabled, mapReady, map, runQuery])
}
