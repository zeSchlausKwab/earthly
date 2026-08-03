import type { StateCreator } from 'zustand'
import { readStoredLocalPmtiles, writeStoredLocalPmtiles } from '@/lib/localPmtiles'
import { readStoredMapSourcePreference, writeStoredMapSourcePreference } from '@/lib/mapSession'
import type { EditorState, MapSourceSlice } from './types'

function initialMapSource(): MapSourceSlice['mapSource'] {
	const stored = readStoredLocalPmtiles()
	if (stored) {
		return {
			type: 'pmtiles',
			location: 'local',
			url: stored.url,
			localBlobHash: stored.sha256,
			pmtilesKind: stored.kind,
			boundsLocked: true,
		}
	}
	if (readStoredMapSourcePreference()?.type === 'blossom') {
		return {
			type: 'blossom',
			location: 'remote',
		}
	}
	return {
		type: 'default',
		location: 'remote',
		url: 'https://build.protomaps.com/20251202.pmtiles',
	}
}

export const createMapSourceSlice: StateCreator<EditorState, [], [], MapSourceSlice> = (set) => ({
	mapSource: initialMapSource(),
	showMapSettings: false,
	pointClusteringEnabled: false,
	calloutsEnabled: true,
	geometryPointProxyEnabled: false,

	mapLayers: [],
	announcementSource: null,

	currentBbox: null,
	mapAreaRect: null,
	isDrawingMapArea: false,

	setMapSource: (mapSource) => {
		if (
			mapSource.type === 'pmtiles' &&
			mapSource.location === 'local' &&
			mapSource.localBlobHash &&
			mapSource.url &&
			mapSource.pmtilesKind
		) {
			writeStoredLocalPmtiles({
				version: 1,
				sha256: mapSource.localBlobHash,
				url: mapSource.url,
				kind: mapSource.pmtilesKind,
			})
		} else {
			writeStoredLocalPmtiles(null)
		}
		writeStoredMapSourcePreference({
			version: 1,
			type: mapSource.type === 'blossom' ? 'blossom' : 'default',
		})
		set({ mapSource })
	},
	setShowMapSettings: (showMapSettings) => set({ showMapSettings }),
	setPointClusteringEnabled: (pointClusteringEnabled) => set({ pointClusteringEnabled }),
	setCalloutsEnabled: (calloutsEnabled) => set({ calloutsEnabled }),
	setGeometryPointProxyEnabled: (geometryPointProxyEnabled) => set({ geometryPointProxyEnabled }),

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
