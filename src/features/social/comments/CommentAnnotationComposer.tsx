import { Check, Edit3, Info, MousePointer2, Send, Trash2, Type, X } from 'lucide-react'
import type { FeatureCollection } from 'geojson'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	GeoRichTextEditor,
	type GeoRichTextEditorRef,
	type GeoFeatureItem,
} from '@/components/editor/GeoRichTextEditor'
import { Button } from '@/components/ui/button'
import { useEditorStore } from '@/features/geo-editor/store'
import type { EditorFeature, EditorMode } from '@/features/geo-editor/core'
import { DrawButtonGroup } from '@/features/geo-editor/components/toolbar/DrawButtonGroup'

interface CommentAnnotationComposerProps {
	onSubmit: (text: string, geojson: FeatureCollection) => Promise<void>
	onCancel: () => void
	availableFeatures?: GeoFeatureItem[]
}

interface EditorSnapshot {
	features: EditorFeature[]
	selectedFeatureIds: string[]
	mode: EditorMode
}

const DRAW_MODES: EditorMode[] = [
	'draw_point',
	'draw_linestring',
	'draw_polygon',
	'draw_annotation',
]

export function CommentAnnotationComposer({
	onSubmit,
	onCancel,
	availableFeatures = [],
}: CommentAnnotationComposerProps) {
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const mode = useEditorStore((state) => state.mode)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setMode = useEditorStore((state) => state.setMode)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)

	const editorRef = useRef<GeoRichTextEditorRef>(null)
	const snapshotRef = useRef<EditorSnapshot | null>(null)
	const restoredRef = useRef(false)
	const [text, setText] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)

	const restoreEditorState = useCallback(() => {
		if (restoredRef.current) return
		const snapshot = snapshotRef.current
		if (!snapshot) return

		editor?.setFeatures(snapshot.features)
		editor?.clearHistory()
		setFeatures(snapshot.features)
		setSelectedFeatureIds(snapshot.selectedFeatureIds)
		setMode(snapshot.mode)
		setHistoryState(false, false)
		restoredRef.current = true
	}, [editor, setFeatures, setHistoryState, setMode, setSelectedFeatureIds])

	useEffect(() => {
		if (snapshotRef.current) return undefined

		const store = useEditorStore.getState()

		snapshotRef.current = {
			features: editor?.getAllFeatures() ?? store.features,
			selectedFeatureIds: store.selectedFeatureIds,
			mode: store.mode,
		}

		editor?.setFeatures([])
		editor?.clearHistory()
		setFeatures([])
		setSelectedFeatureIds([])
		setMode('draw_point')
		setHistoryState(false, false)

		return () => {
			restoreEditorState()
		}
		// Intentionally mount-scoped: this composer owns a temporary editor session.
	}, [])

	const geometryCount = features.length
	const isDrawingComplexGeometry = mode === 'draw_linestring' || mode === 'draw_polygon'
	const canPublish = geometryCount > 0 && text.trim().length > 0 && !isSubmitting

	const geometrySummary = useMemo(() => {
		const counts = {
			points: 0,
			lines: 0,
			polygons: 0,
		}

		for (const feature of features) {
			switch (feature.geometry?.type) {
				case 'Point':
				case 'MultiPoint':
					counts.points += 1
					break
				case 'LineString':
				case 'MultiLineString':
					counts.lines += 1
					break
				case 'Polygon':
				case 'MultiPolygon':
					counts.polygons += 1
					break
				default:
					break
			}
		}

		return counts
	}, [features])

	const handleModeChange = (nextMode: EditorMode) => {
		if (!DRAW_MODES.includes(nextMode)) return
		setMode(nextMode)
	}

	const handleClearGeometry = () => {
		const allIds =
			editor?.getAllFeatures().map((feature) => feature.id) ?? features.map((feature) => feature.id)
		if (allIds.length > 0) {
			editor?.deleteFeatures(allIds)
		}
		editor?.setFeatures([])
		editor?.clearHistory()
		setFeatures([])
		setSelectedFeatureIds([])
		setHistoryState(false, false)
	}

	const handleSubmit = async () => {
		const content = editorRef.current?.getText() ?? text
		const geojson: FeatureCollection = {
			type: 'FeatureCollection',
			features: features
				.filter((feature) => feature.geometry !== null)
				.map((feature) => ({
					type: 'Feature' as const,
					id: feature.id,
					geometry: feature.geometry,
					properties: feature.properties ?? {},
				})),
		}

		if (geojson.features.length === 0 || !content.trim()) return

		setIsSubmitting(true)
		try {
			await onSubmit(content, geojson)
			restoreEditorState()
			onCancel()
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<div className="mb-3 overflow-hidden rounded-2xl border border-primary/40 bg-primary/10 shadow-sm">
			<div className="flex items-center justify-between gap-3 border-b border-primary/40 bg-primary/10 px-4 py-3">
				<div>
					<div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
						Comment Annotation
					</div>
					<div className="text-sm font-medium text-primary">
						Draw geometry on the map, add context, then publish as a comment
					</div>
				</div>
				<Button type="button" variant="ghost" size="icon-sm" onClick={onCancel}>
					<X className="h-4 w-4" />
				</Button>
			</div>

			<div className="space-y-3 px-4 py-4">
				<div className="flex flex-wrap items-center gap-2">
					<DrawButtonGroup mode={mode} onModeChange={handleModeChange} />
					<Button
						type="button"
						size="icon"
						variant={mode === 'draw_annotation' ? 'default' : 'outline'}
						onClick={() => setMode('draw_annotation')}
						className={`h-9 w-9 ${
							mode === 'draw_annotation'
								? 'border-primary/40 bg-primary text-white hover:bg-primary'
								: 'border-primary/40 text-primary hover:bg-primary/10 hover:text-primary'
						}`}
						title="Draw label annotation"
					>
						<Type className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						size="icon"
						variant={mode === 'select' ? 'default' : 'outline'}
						onClick={() => setMode('select')}
						className="h-9 w-9"
					>
						<MousePointer2 className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						size="icon"
						variant={mode === 'edit' ? 'default' : 'outline'}
						onClick={() => setMode('edit')}
						className="h-9 w-9"
						disabled={geometryCount === 0}
					>
						<Edit3 className="h-4 w-4" />
					</Button>
					{isDrawingComplexGeometry && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => editor?.finishDrawing()}
							disabled={!canFinishDrawing}
							className="gap-1 border-ok/40 bg-card text-ok hover:bg-ok/15"
						>
							<Check className="h-3.5 w-3.5" />
							Finish
						</Button>
					)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={handleClearGeometry}
						disabled={geometryCount === 0}
						className="gap-1 bg-card"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Clear
					</Button>
				</div>

				<div className="rounded-xl border border-primary/40 bg-card/80 px-3 py-2 text-xs text-primary">
					<div className="flex flex-wrap items-center gap-3">
						<span>
							{geometryCount} feature{geometryCount === 1 ? '' : 's'} drafted
						</span>
						<span>{geometrySummary.points} pts</span>
						<span>{geometrySummary.lines} lines</span>
						<span>{geometrySummary.polygons} polys</span>
						{mode === 'draw_annotation' && <span>label mode</span>}
					</div>
				</div>

				<div className="rounded-xl border border-info/40 bg-card p-3">
					<GeoRichTextEditor
						ref={editorRef}
						placeholder="Explain what happened here. Links, images, videos, and geo mentions are supported."
						availableFeatures={availableFeatures}
						onChange={setText}
						disabled={isSubmitting}
						rows={4}
					/>
				</div>

				<div className="flex items-start gap-2 rounded-xl border border-transparent bg-card/50 px-3 py-2 text-xs text-muted-foreground">
					<Info className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-primary" />
					<p>
						This publishes a geo comment per the spec: comment text plus an attached GeoJSON
						FeatureCollection. It does not modify the underlying dataset.
					</p>
				</div>

				<div className="flex items-center justify-between gap-2">
					<Button type="button" variant="ghost" onClick={onCancel} disabled={isSubmitting}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={!canPublish}
						className="gap-1 bg-primary text-white hover:bg-primary/15"
					>
						<Send className="h-3.5 w-3.5" />
						Publish annotation
					</Button>
				</div>
			</div>
		</div>
	)
}
