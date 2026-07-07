import type { StateCreator } from 'zustand'
import type { EditorState, GeoQuerySlice, GeoQueryStatus } from './types'

/**
 * Query-by-view mode + transparency status (see GeoQuerySlice in types.ts).
 * The relay query loop that feeds this lives in hooks/useGeoQueryByView.
 */

const initialStatus: GeoQueryStatus = {
	cells: [],
	loading: false,
	matchCount: 0,
	updatedAt: null,
}

export const createGeoQuerySlice: StateCreator<EditorState, [], [], GeoQuerySlice> = (set) => ({
	geoQueryEnabled: false,
	geoQueryStatus: initialStatus,

	setGeoQueryEnabled: (enabled) =>
		set((state) => ({
			geoQueryEnabled: enabled,
			// Reset the transparency readout on disable so a re-enable never
			// shows stale cells/counts.
			geoQueryStatus: enabled ? state.geoQueryStatus : initialStatus,
		})),

	setGeoQueryStatus: (status) =>
		set((state) => ({
			geoQueryStatus: { ...state.geoQueryStatus, ...status },
		})),
})
