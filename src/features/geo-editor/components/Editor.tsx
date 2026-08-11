import type React from 'react'
import { useEffect, useRef, useState } from 'react'
import { GeoEditor } from '../core'
import type { EditorEvent, EditorFeature, SelectionCandidateRequest } from '../core/types'
import { useEditorStore } from '../store'
import { GeometryChoiceMenu } from './GeometryChoiceMenu'
import { useMap } from './map'

interface EditorProps {
	snapping?: boolean
}

export const Editor: React.FC<EditorProps> = ({ snapping = true }) => {
	const { map } = useMap()
	// MapLibre's full `load` event waits for visible basemap tiles. GeoEditor can
	// bind immediately: its core defers layer creation to `style.load`, so slow
	// third-party tiles must not keep Dataset authoring unavailable.
	const editorRef = useRef<GeoEditor | null>(null)
	const [selectionCandidates, setSelectionCandidates] = useState<SelectionCandidateRequest | null>(
		null,
	)
	// Pitfall 2 guard: set true while applying an editor-originated mirror update so
	// the reverse store→editor sync effect skips its push. Without this, the one-way
	// read-mirror (D-09) round-trips: editor event → store.setFeatures → reverse effect
	// → editor.setFeatures → 'features.replace' event → … (render churn / duplicate work).
	const suppressReverseSyncRef = useRef(false)

	const setEditor = useEditorStore((state) => state.setEditor)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setMode = useEditorStore((state) => state.setMode)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const clearFocusedMapGeometry = useEditorStore((state) => state.clearFocusedMapGeometry)
	const setCanFinishDrawing = useEditorStore((state) => state.setCanFinishDrawing)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)
	const setGeometryOperation = useEditorStore((state) => state.setGeometryOperation)
	const editor = useEditorStore((state) => state.editor)

	// Subscribe to store changes that should affect the editor instance
	const storeFeatures = useEditorStore((state) => state.features)
	const storeMode = useEditorStore((state) => state.mode)
	const storePanLocked = useEditorStore((state) => state.panLocked)
	const storeSnapping = useEditorStore((state) => state.snappingEnabled)

	// Initialize Editor
	useEffect(() => {
		if (!map || editorRef.current) return

		const editor = new GeoEditor(map, {
			snapping,
			defaultMode: 'select',
		})

		editorRef.current = editor
		setEditor(editor)

		// Install the dataset-snapshot metadata bridge (SAFE-06 / D-10). The editor
		// core must NOT import the Zustand store (store↔core cycle), so we inject a
		// provider/applier here: snapshot capture reads the current collectionMeta,
		// and snapshot restore on Cmd+Z (or the chat "undo last AI edit" accessor)
		// writes it back through setCollectionMeta — the same path the dataset-info
		// panel + publishing use.
		editor.setMetadataBridge(
			() => useEditorStore.getState().collectionMeta,
			(meta) => useEditorStore.getState().setCollectionMeta(meta),
		)

		// Bind events to update store (the D-09 one-way read-mirror sink). Mark the
		// update editor-originated so the reverse store→editor effect skips its push.
		const updateFeatures = () => {
			suppressReverseSyncRef.current = true
			setFeatures(editor.getAllFeatures())
		}

		const updateSelection = () => {
			setSelectionCandidates(null)
			clearFocusedMapGeometry()
			setSelectedFeatureIds(editor.selection.getSelected())
		}

		const updateHistory = () => {
			setHistoryState(editor.history.canUndo(), editor.history.canRedo())
		}
		const updateFeaturesAndHistory = () => {
			updateFeatures()
			updateHistory()
		}

		const handleDrawChange = () => {
			setCanFinishDrawing(editor.canFinishDrawing())
		}

		const handleModeChange = (e: EditorEvent) => {
			if (e.mode) setMode(e.mode)
			setCanFinishDrawing(editor.canFinishDrawing())
		}
		const handleGeometryOperationChange = (e: EditorEvent) => {
			setGeometryOperation(e.geometryOperation ?? null)
		}
		const handleSelectionCandidates = (event: EditorEvent) => {
			setSelectionCandidates(event.selectionCandidates ?? null)
		}

		editor.on('create', updateFeatures)
		editor.on('update', updateFeatures)
		editor.on('delete', updateFeatures)
		// Bulk replace (editor.setFeatures) now emits 'features.replace' so the mirror
		// catches it too — no more stale sidebar after an Authoring-API replace write.
		editor.on('features.replace', updateFeatures)

		editor.on('mode.change', handleModeChange)
		editor.on('selection.change', updateSelection)
		editor.on('selection.candidates', handleSelectionCandidates)
		editor.on('draw.change', handleDrawChange)
		editor.on('geometry.operation.change', handleGeometryOperationChange)

		// Undo/redo mutate the editor's internal feature map without emitting the
		// create/update/delete events. Mirror both geometry and history so the
		// sidebar, draft persistence, and map core cannot disagree.
		editor.on('undo', updateFeaturesAndHistory)
		editor.on('redo', updateFeaturesAndHistory)
		editor.on('create', updateHistory)
		editor.on('update', updateHistory)
		editor.on('delete', updateHistory)
		editor.on('features.replace', updateHistory)

		// Map Area polygon capture - when drawing for map area, capture bbox and remove the polygon
		editor.on('create', (e: EditorEvent) => {
			const store = useEditorStore.getState()
			if (!store.isDrawingMapArea) return

			const features = e.features as EditorFeature[] | undefined
			if (!features || features.length === 0) return

			const polygon = features.find((f) => f.geometry?.type === 'Polygon')
			if (!polygon) return

			// Compute bbox from polygon coordinates
			if (polygon.geometry.type !== 'Polygon') return
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
			editor.off('selection.candidates', handleSelectionCandidates)
			setSelectionCandidates(null)
			setGeometryOperation(null)
			setEditor(null)
			editor.destroy()
			editorRef.current = null
		}
	}, [
		map,
		snapping,
		setEditor,
		setFeatures,
		setMode,
		setSelectedFeatureIds,
		clearFocusedMapGeometry,
		setCanFinishDrawing,
		setHistoryState,
		setGeometryOperation,
	])

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
		if (!editor) return
		// If this store change originated from an editor event (the one-way mirror),
		// skip the reverse push — pushing it back would round-trip (Pitfall 2). Consume
		// the flag so genuine external store writes (e.g. dataset loads) still sync.
		if (suppressReverseSyncRef.current) {
			suppressReverseSyncRef.current = false
			return
		}
		const current = editor.getAllFeatures()
		if (JSON.stringify(current) !== JSON.stringify(storeFeatures)) {
			editor.setFeatures(storeFeatures)
		}
	}, [storeFeatures, editor])

	// Sync mode
	useEffect(() => {
		if (!editor) return
		if (editor.getMode() !== storeMode) {
			editor.setMode(storeMode)
		}
	}, [storeMode, editor])

	// Sync pan lock
	useEffect(() => {
		if (!editor) return
		editor.setPanLocked(storePanLocked)
	}, [storePanLocked, editor])

	// Sync snapping
	useEffect(() => {
		if (!editor) return
		if (editor.isSnappingEnabled() !== storeSnapping) {
			editor.setSnapping(storeSnapping)
		}
	}, [storeSnapping, editor])

	// Sync selection from store to editor (for sidebar → map sync)
	const storeSelectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)

	useEffect(() => {
		if (!editor) return

		const currentSelection = editor.selection.getSelected()
		const storeSet = new Set(storeSelectedFeatureIds)
		const currentSet = new Set(currentSelection)

		// Check if selections are different
		if (storeSet.size !== currentSet.size || ![...storeSet].every((id) => currentSet.has(id))) {
			// Use selectFeature for the first one (clears) then additive for the rest
			if (storeSelectedFeatureIds.length === 0) {
				editor.selection.clearSelection()
				// Manually trigger render through setFeatures which is public
				// We need to force a re-render - setting the same features triggers it
				const features = editor.getAllFeatures()
				editor.setFeatures(features)
			} else {
				// Use public selectFeature API
				storeSelectedFeatureIds.forEach((id, index) => {
					editor.selectFeature(id, index > 0)
				})
			}
		}
	}, [storeSelectedFeatureIds, editor])

	useEffect(() => {
		if (!selectionCandidates) return
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			editorRef.current?.dismissSelectionCandidates()
			setSelectionCandidates(null)
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [selectionCandidates])

	if (!selectionCandidates || !editor) return null

	const candidates = selectionCandidates.featureIds.flatMap((featureId) => {
		const feature = editor.getFeature(featureId)
		if (!feature) return []
		const isAnnotation = feature.properties?.featureType === 'annotation'
		return [
			{
				id: featureId,
				geometry: feature.geometry,
				isAnnotation,
				name:
					(feature.properties?.name as string | undefined) ||
					(feature.properties?.text as string | undefined) ||
					`${feature.geometry.type} · ${featureId.slice(0, 8)}`,
			},
		]
	})

	return (
		<GeometryChoiceMenu
			items={candidates}
			point={selectionCandidates.point}
			container={map?.getContainer()}
			title="Choose geometry"
			onChoose={(featureId) =>
				editor.chooseSelectionCandidate(featureId, selectionCandidates.additive)
			}
			onClose={() => editor.dismissSelectionCandidates()}
		/>
	)
}
