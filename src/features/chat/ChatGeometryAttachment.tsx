import type { FeatureCollection } from 'geojson'
import { Check, Edit3, MousePointer2, PencilRuler, Trash2, Type, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { DrawButtonGroup } from '@/features/geo-editor/components/toolbar/DrawButtonGroup'
import type { EditorFeature, EditorMode } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { cn } from '@/lib/utils'

interface EditorSnapshot {
	features: EditorFeature[]
	selectedFeatureIds: string[]
	mode: EditorMode
}

interface ChatGeometryAttachmentProps {
	value: FeatureCollection | null
	onChange: (value: FeatureCollection | null) => void
	layout?: 'inline' | 'detached'
	panelClassName?: string
}

const DRAW_MODES: EditorMode[] = ['draw_point', 'draw_linestring', 'draw_polygon', 'draw_annotation']

export function ChatGeometryAttachment({
	value,
	onChange,
	layout = 'inline',
	panelClassName,
}: ChatGeometryAttachmentProps) {
	const editor = useEditorStore((state) => state.editor)
	const features = useEditorStore((state) => state.features)
	const mode = useEditorStore((state) => state.mode)
	const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
	const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
	const setFeatures = useEditorStore((state) => state.setFeatures)
	const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
	const setMode = useEditorStore((state) => state.setMode)
	const setHistoryState = useEditorStore((state) => state.setHistoryState)

	const [panelOpen, setPanelOpen] = useState(false)
	const [isDraftActive, setIsDraftActive] = useState(false)
	const snapshotRef = useRef<EditorSnapshot | null>(null)
	const restoredRef = useRef(false)
	const annotationInputRef = useRef<HTMLInputElement>(null)
	const previousDraftAnnotationCountRef = useRef(0)

	const draftFeatures = isDraftActive ? features.filter((feature) => feature.geometry !== null) : []
	const draftAnnotationFeatures = useMemo(
		() => draftFeatures.filter((feature) => feature.properties?.featureType === 'annotation'),
		[draftFeatures],
	)
	const draftFeatureCount = draftFeatures.length
	const isDrawingComplexGeometry = mode === 'draw_linestring' || mode === 'draw_polygon'
	const attachedFeatureCount = value?.features.length ?? 0

	const activeDraftAnnotation = useMemo(() => {
		const selectedAnnotation = draftAnnotationFeatures.find((feature) =>
			selectedFeatureIds.includes(feature.id),
		)
		return selectedAnnotation ?? draftAnnotationFeatures[draftAnnotationFeatures.length - 1] ?? null
	}, [draftAnnotationFeatures, selectedFeatureIds])
	const activeDraftAnnotationText =
		typeof activeDraftAnnotation?.properties?.text === 'string'
			? activeDraftAnnotation.properties.text
			: ''

	const restoreEditorState = useCallback(
		(closePanel = true) => {
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
			snapshotRef.current = null
			setIsDraftActive(false)
			if (closePanel) {
				setPanelOpen(false)
			}
		},
		[editor, setFeatures, setHistoryState, setMode, setSelectedFeatureIds],
	)

	const ensureDraftSession = useCallback(
		(nextMode: EditorMode) => {
			if (!DRAW_MODES.includes(nextMode) || !editor) return

			setPanelOpen(true)
			if (!snapshotRef.current) {
				const store = useEditorStore.getState()
				snapshotRef.current = {
					features: editor.getAllFeatures(),
					selectedFeatureIds: store.selectedFeatureIds,
					mode: store.mode,
				}
				restoredRef.current = false

				editor.setFeatures([])
				editor.clearHistory()
				setFeatures([])
				setSelectedFeatureIds([])
				setHistoryState(false, false)
				setIsDraftActive(true)
			}

			setMode(nextMode)
		},
		[editor, setFeatures, setHistoryState, setMode, setSelectedFeatureIds],
	)

	const handleTogglePanel = useCallback(() => {
		if (panelOpen) {
			if (snapshotRef.current) {
				restoreEditorState()
			} else {
				setPanelOpen(false)
			}
			return
		}
		setPanelOpen(true)
	}, [panelOpen, restoreEditorState])

	const handleClearDraftGeometry = useCallback(() => {
		if (!isDraftActive) return
		const allIds = editor?.getAllFeatures().map((feature) => feature.id) ?? []
		if (allIds.length > 0) {
			editor?.deleteFeatures(allIds)
		}
		editor?.setFeatures([])
		editor?.clearHistory()
		setFeatures([])
		setSelectedFeatureIds([])
		setHistoryState(false, false)
	}, [editor, isDraftActive, setFeatures, setHistoryState, setSelectedFeatureIds])

	const handleAttachDraft = useCallback(() => {
		if (draftFeatures.length === 0) return

		const geojson: FeatureCollection = {
			type: 'FeatureCollection',
			features: draftFeatures.map((feature) => ({
				type: 'Feature',
				id: feature.id,
				geometry: feature.geometry,
				properties: feature.properties ?? {},
			})),
		}

		onChange(geojson)
		restoreEditorState()
	}, [draftFeatures, onChange, restoreEditorState])

	const handleClearAttachment = useCallback(() => {
		onChange(null)
	}, [onChange])

	const handleAnnotationTextChange = useCallback(
		(value: string) => {
			if (!editor || !activeDraftAnnotation) return
			editor.updateFeature(activeDraftAnnotation.id, {
				...activeDraftAnnotation,
				properties: {
					...activeDraftAnnotation.properties,
					text: value,
					name: value.trim() || undefined,
				},
			})
		},
		[activeDraftAnnotation, editor],
	)

	useEffect(() => {
		const currentCount = draftAnnotationFeatures.length
		const previousCount = previousDraftAnnotationCountRef.current
		previousDraftAnnotationCountRef.current = currentCount

		if (currentCount <= previousCount || mode !== 'draw_annotation') return

		const latestAnnotation = draftAnnotationFeatures[draftAnnotationFeatures.length - 1]
		if (!latestAnnotation) return

		setSelectedFeatureIds([latestAnnotation.id])
		setMode('select')

		window.requestAnimationFrame(() => {
			annotationInputRef.current?.focus()
			annotationInputRef.current?.select()
		})
	}, [draftAnnotationFeatures, mode, setMode, setSelectedFeatureIds])

	useEffect(
		() => () => {
			if (snapshotRef.current) {
				restoreEditorState(false)
			}
		},
		[restoreEditorState],
	)

	const geometrySummary = useMemo(() => {
		const counts = {
			labels: 0,
			points: 0,
			lines: 0,
			polygons: 0,
		}

		for (const feature of draftFeatures) {
			if (feature.properties?.featureType === 'annotation') {
				counts.labels += 1
				continue
			}
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

		if (value) {
			for (const feature of value.features) {
				if ((feature.properties as Record<string, unknown> | undefined)?.featureType === 'annotation') {
					counts.labels += 1
					continue
				}
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
		}

		return counts
	}, [draftFeatures, value])

	const attachedLabel = attachedFeatureCount > 0 ? `${attachedFeatureCount} attached` : 'Draw'

	const trigger = (
		<div className="flex items-center gap-1">
			<Button
				type="button"
				variant={panelOpen || isDraftActive ? 'default' : 'outline'}
				size="sm"
				className="h-8 gap-1.5 text-xs"
				onClick={handleTogglePanel}
			>
				<PencilRuler className="h-3.5 w-3.5" />
				{isDraftActive ? 'Drafting' : attachedLabel}
			</Button>
		</div>
	)

	const panel =
		panelOpen || isDraftActive ? (
			<div
				className={cn(
					'rounded-lg border bg-background/95 p-2.5 shadow-sm',
					layout === 'detached' ? 'basis-full' : 'mt-2 w-[min(34rem,calc(100vw-8rem))]',
					panelClassName,
				)}
			>
				<div className="flex flex-wrap items-center gap-1.5">
					<DrawButtonGroup mode={mode} onModeChange={ensureDraftSession} small />
					<Button
						type="button"
						size="icon"
						variant={mode === 'draw_annotation' ? 'default' : 'outline'}
						onClick={() => ensureDraftSession('draw_annotation')}
						className="h-8 w-8 rounded-none"
						title="Draw label annotation"
					>
						<Type className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						size="icon"
						variant={mode === 'select' ? 'default' : 'outline'}
						onClick={() => isDraftActive && setMode('select')}
						disabled={!isDraftActive}
						className="h-8 w-8"
					>
						<MousePointer2 className="h-3.5 w-3.5" />
					</Button>
					<Button
						type="button"
						size="icon"
						variant={mode === 'edit' ? 'default' : 'outline'}
						onClick={() => isDraftActive && setMode('edit')}
						disabled={!isDraftActive || draftFeatureCount === 0}
						className="h-8 w-8"
					>
						<Edit3 className="h-3.5 w-3.5" />
					</Button>
					{isDrawingComplexGeometry && (
						<Button
							type="button"
							size="sm"
							variant="outline"
							onClick={() => editor?.finishDrawing()}
							disabled={!canFinishDrawing}
							className="h-8 gap-1 text-xs"
						>
							<Check className="h-3.5 w-3.5" />
							Finish
						</Button>
					)}
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={handleClearDraftGeometry}
						disabled={!isDraftActive || draftFeatureCount === 0}
						className="h-8 gap-1 text-xs"
					>
						<Trash2 className="h-3.5 w-3.5" />
						Clear
					</Button>
					<Button
						type="button"
						size="sm"
						onClick={handleAttachDraft}
						disabled={draftFeatureCount === 0}
						className="h-8 gap-1 text-xs"
					>
						<Check className="h-3.5 w-3.5" />
						Attach
					</Button>
					{attachedFeatureCount > 0 && (
						<Button
							type="button"
							size="sm"
							variant="ghost"
							onClick={handleClearAttachment}
							className="ml-auto h-8 gap-1 text-xs text-muted-foreground"
						>
							<X className="h-3.5 w-3.5" />
							Clear attached
						</Button>
					)}
				</div>

				{mode === 'draw_annotation' && draftAnnotationFeatures.length === 0 && (
					<p className="mt-2 text-[11px] text-muted-foreground">
						Click on the map to place a label, then type the label text here.
					</p>
				)}

				{activeDraftAnnotation && (
					<div className="mt-2">
						<input
							ref={annotationInputRef}
							value={activeDraftAnnotationText}
							onChange={(event) => handleAnnotationTextChange(event.target.value)}
							placeholder="Type label text..."
							className="border-input bg-background placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 h-8 w-full rounded-md border px-3 text-sm outline-none focus-visible:ring-[3px]"
						/>
					</div>
				)}

				{(draftFeatureCount > 0 || attachedFeatureCount > 0) && (
					<div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
						{attachedFeatureCount > 0 && (
							<span className="rounded border bg-background px-2 py-0.5 text-foreground">
								{attachedFeatureCount} attached
							</span>
						)}
						{draftFeatureCount > 0 && <span>{draftFeatureCount} in draft</span>}
						{geometrySummary.labels > 0 && <span>{geometrySummary.labels} labels</span>}
						{geometrySummary.points > 0 && <span>{geometrySummary.points} points</span>}
						{geometrySummary.lines > 0 && <span>{geometrySummary.lines} lines</span>}
						{geometrySummary.polygons > 0 && <span>{geometrySummary.polygons} polygons</span>}
					</div>
				)}
			</div>
		) : null

	if (layout === 'detached') {
		return (
			<>
				{trigger}
				{panel}
			</>
		)
	}

	return (
		<div className="min-w-0">
			{trigger}
			{panel}
		</div>
	)
}
