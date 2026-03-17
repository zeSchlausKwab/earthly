import type { StateCreator } from 'zustand'
import type { EditorState, MapSourceSlice } from './types'

export const createMapSourceSlice: StateCreator<EditorState, [], [], MapSourceSlice> = (set) => ({
	mapSource: {
		type: 'default',
		location: 'remote',
		url: 'https://build.protomaps.com/20251202.pmtiles',
	},
	showMapSettings: false,
	pointClusteringEnabled: true,

	mapLayers: [],
	announcementSource: null,

	currentBbox: null,
	mapAreaRect: null,
	isDrawingMapArea: false,

	setMapSource: (mapSource) => set({ mapSource }),
	setShowMapSettings: (showMapSettings) => set({ showMapSettings }),
	setPointClusteringEnabled: (pointClusteringEnabled) => set({ pointClusteringEnabled }),

	setMapLayers: (mapLayers) => set({ mapLayers }),
	updateMapLayerState: (id, updates) =>
		set((state) => ({
			mapLayers: state.mapLayers.map((layer) =>
				layer.id === id ? { ...layer, ...updates } : layer,
			),
		})),
	reorderMapLayers: (fromIndex, toIndex) =>
		set((state) => {
			const layers = [...state.mapLayers]
			const [removed] = layers.splice(fromIndex, 1)
			if (removed) layers.splice(toIndex, 0, removed)
			return { mapLayers: layers }
		}),
	setAnnouncementSource: (announcementSource) => set({ announcementSource }),
	setCurrentBbox: (bbox) => set({ currentBbox: bbox }),
	setMapAreaRect: (rect) => set({ mapAreaRect: rect }),
	clearMapAreaRect: () => set({ mapAreaRect: null, isDrawingMapArea: false }),
	setIsDrawingMapArea: (drawing) => set({ isDrawingMapArea: drawing }),
})
