import type React from 'react';
import { useEffect, useRef } from 'react';
import { GeoEditor } from '../core';
import { useEditorStore } from '../store';
import { useMap } from './Map';

interface EditorProps {
	snapping?: boolean;
}

export const Editor: React.FC<EditorProps> = ({ snapping = true }) => {
	const { map, isLoaded } = useMap();
	const editorRef = useRef<GeoEditor | null>(null);

	const setEditor = useEditorStore((state) => state.setEditor);
	const setFeatures = useEditorStore((state) => state.setFeatures);
	const setMode = useEditorStore((state) => state.setMode);
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds);
	const setCanFinishDrawing = useEditorStore((state) => state.setCanFinishDrawing);
	const setHistoryState = useEditorStore((state) => state.setHistoryState);
	const editor = useEditorStore((state) => state.editor);

	// Subscribe to store changes that should affect the editor instance
	const storeFeatures = useEditorStore((state) => state.features);
	const storeMode = useEditorStore((state) => state.mode);
	const storePanLocked = useEditorStore((state) => state.panLocked);
	const storeSnapping = useEditorStore((state) => state.snappingEnabled);

	// Initialize Editor
	useEffect(() => {
		if (!map || !isLoaded || editorRef.current) return;

		const editor = new GeoEditor(map, {
			snapping,
			defaultMode: 'select'
		});

		editorRef.current = editor;
		setEditor(editor);

		// Bind events to update store
		const updateFeatures = () => {
			setFeatures(editor.getAllFeatures());
		};

		const updateSelection = () => {
			setSelectedFeatureIds(editor.selection.getSelected());
		};

		const updateHistory = () => {
			setHistoryState(editor.history.canUndo(), editor.history.canRedo());
		};

		const handleDrawChange = () => {
			setCanFinishDrawing(editor.canFinishDrawing());
		};

		const handleModeChange = (e: any) => {
			if (e.mode) setMode(e.mode);
			setCanFinishDrawing(editor.canFinishDrawing());
		};

		editor.on('create', updateFeatures);
		editor.on('update', updateFeatures);
		editor.on('delete', updateFeatures);

		editor.on('mode.change', handleModeChange);
		editor.on('selection.change', updateSelection);
		editor.on('draw.change', handleDrawChange);

		// History events
		editor.on('undo', updateHistory);
		editor.on('redo', updateHistory);
		editor.on('create', updateHistory);
		editor.on('update', updateHistory);
		editor.on('delete', updateHistory);

		return () => {
			setEditor(null);
			editor.destroy();
			editorRef.current = null;
		};
	}, [map, isLoaded]);

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
		if (!editorRef.current) return;
		const current = editorRef.current.getAllFeatures();
		if (JSON.stringify(current) !== JSON.stringify(storeFeatures)) {
			editorRef.current.setFeatures(storeFeatures);
		}
	}, [storeFeatures, editor]);

	// Sync mode
	useEffect(() => {
		if (!editorRef.current) return;
		if (editorRef.current.getMode() !== storeMode) {
			editorRef.current.setMode(storeMode);
		}
	}, [storeMode, editor]);

	// Sync pan lock
	useEffect(() => {
		if (!editorRef.current) return;
		editorRef.current.setPanLocked(storePanLocked);
	}, [storePanLocked, editor]);

	// Sync snapping
	useEffect(() => {
		if (!editorRef.current) return;
		if (editorRef.current.isSnappingEnabled() !== storeSnapping) {
			editorRef.current.setSnapping(storeSnapping);
		}
	}, [storeSnapping, editor]);

	return null;
};
