import type React from 'react'
import { useEffect, useRef } from 'react'
import { GeoEditor } from '../core'
import { useEditorStore } from '../store'
import { useMap } from './map'

interface EditorProps {
	snapping?: boolean
}

export const Editor: React.FC<EditorProps> = ({ snapping = true }) => {
	const { map, isLoaded } = useMap()
	const editorRef = useRef<GeoEditor | null>(null)

	const setEditor = useEditorStore((state) => state.setEditor)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setMode = useEditorStore((state) => state.setMode)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const clearFocusedMapGeometry = useEditorStore((state) => state.clearFocusedMapGeometry)
	const setCanFinishDrawing = useEditorStore((state) => state.setCanFinishDrawing)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)
	const editor = useEditorStore((state) => state.editor)

	// Subscribe to store changes that should affect the editor instance
	const storeFeatures = useEditorStore((state) => state.features)
	const storeMode = useEditorStore((state) => state.mode)
	const storePanLocked = useEditorStore((state) => state.panLocked)
	const storeSnapping = useEditorStore((state) => state.snappingEnabled)

	// Initialize Editor
	useEffect(() => {
		if (!map || !isLoaded || editorRef.current) return

		const editor = new GeoEditor(map, {
			snapping,
			defaultMode: 'select',
		})

		editorRef.current = editor
		setEditor(editor)

		// Bind events to update store
		const updateFeatures = () => {
			setFeatures(editor.getAllFeatures())
		}

		const updateSelection = () => {
			clearFocusedMapGeometry()
			setSelectedFeatureIds(editor.selection.getSelected())
		}

		const updateHistory = () => {
			setHistoryState(editor.history.canUndo(), editor.history.canRedo())
		}

		const handleDrawChange = () => {
			setCanFinishDrawing(editor.canFinishDrawing())
		}

		const handleModeChange = (e: any) => {
			if (e.mode) setMode(e.mode)
			setCanFinishDrawing(editor.canFinishDrawing())
		}

		editor.on('create', updateFeatures)
		editor.on('update', updateFeatures)
		editor.on('delete', updateFeatures)

		editor.on('mode.change', handleModeChange)
		editor.on('selection.change', updateSelection)
		editor.on('draw.change', handleDrawChange)

		// History events
		editor.on('undo', updateHistory)
		editor.on('redo', updateHistory)
		editor.on('create', updateHistory)
		editor.on('update', updateHistory)
		editor.on('delete', updateHistory)

		// Map Area polygon capture - when drawing for map area, capture bbox and remove the polygon
		editor.on('create', (e: any) => {
			const store = useEditorStore.getState()
			if (!store.isDrawingMapArea) return

			const features = e.features as any[] | undefined
			if (!features || features.length === 0) return

			const polygon = features.find((f) => f.geometry?.type === 'Polygon')
			if (!polygon) return

			// Compute bbox from polygon coordinates
			const coords = polygon.geometry.coordinates[0] as [number, number][]
			if (!coords || coords.length < 4) return

			let west = Infinity,
				south = Infinity,
				east = -Infinity,
				north = -Infinity
			for (const [lon, lat] of coords) {
				if (lon < west) west = lon
				if (lon > east) east = lon
				if (lat < south) south = lat
				if (lat > north) north = lat
			}

			// Calculate area in sqkm
			const R = 6371 // Earth radius in km
			const lat1 = (south * Math.PI) / 180
			const lat2 = (north * Math.PI) / 180
			const lon1 = (west * Math.PI) / 180
			const lon2 = (east * Math.PI) / 180
			const width = R * Math.cos((lat1 + lat2) / 2) * Math.abs(lon2 - lon1)
			const height = R * Math.abs(lat2 - lat1)
			const areaSqKm = width * height

			// Store the map area rect
			store.setMapAreaRect({
				bbox: [west, south, east, north],
				areaSqKm,
			})

			// Remove the polygon from the editor (it's just for visualization)
			setTimeout(() => {
				editor.deleteFeatures([polygon.id])
				store.setIsDrawingMapArea(false)
				store.setMode('select')
			}, 100)
		})

		return () => {
			setEditor(null)
			editor.destroy()
			editorRef.current = null
		}
	}, [map, isLoaded])

	// Sync features from store to editor
	// We need to be careful to avoid loops.
	// If the store update came from the editor event, we shouldn't set it back.
	// But here we are just syncing "external" updates (e.g. loading a dataset).
	// A simple equality check or just relying on the fact that setFeatures in GeoEditor is relatively cheap if ids match might work.
	// However, GeoEditor.setFeatures replaces everything.
	// We can use a ref to track if the update is internal.
	// Actually, for now, let's assume store is the source of truth for "loading" data.
	// If the user draws, the editor emits 'create', we update store.
	// If we update store, this effect runs.
	// We should compare.
	useEffect(() => {
		if (!editorRef.current) return
		const current = editorRef.current.getAllFeatures()
		if (JSON.stringify(current) !== JSON.stringify(storeFeatures)) {
			editorRef.current.setFeatures(storeFeatures)
		}
	}, [storeFeatures, editor])

	// Sync mode
	useEffect(() => {
		if (!editorRef.current) return
		if (editorRef.current.getMode() !== storeMode) {
			editorRef.current.setMode(storeMode)
		}
	}, [storeMode, editor])

	// Sync pan lock
	useEffect(() => {
		if (!editorRef.current) return
		editorRef.current.setPanLocked(storePanLocked)
	}, [storePanLocked, editor])

	// Sync snapping
	useEffect(() => {
		if (!editorRef.current) return
		if (editorRef.current.isSnappingEnabled() !== storeSnapping) {
			editorRef.current.setSnapping(storeSnapping)
		}
	}, [storeSnapping, editor])

	// Sync selection from store to editor (for sidebar → map sync)
	const storeSelectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	useEffect(() => {
		if (!editorRef.current) return

		const currentSelection = editorRef.current.selection.getSelected()
		const storeSet = new Set(storeSelectedFeatureIds)
		const currentSet = new Set(currentSelection)

		// Check if selections are different
		if (storeSet.size !== currentSet.size || ![...storeSet].every((id) => currentSet.has(id))) {
			// Use selectFeature for the first one (clears) then additive for the rest
			if (storeSelectedFeatureIds.length === 0) {
				editorRef.current.selection.clearSelection()
				// Manually trigger render through setFeatures which is public
				// We need to force a re-render - setting the same features triggers it
				const features = editorRef.current.getAllFeatures()
				editorRef.current.setFeatures(features)
			} else {
				// Use public selectFeature API
				storeSelectedFeatureIds.forEach((id, index) => {
					editorRef.current!.selectFeature(id, index > 0)
				})
			}
		}
	}, [storeSelectedFeatureIds, editor])

	return null
}
