import { Check, Edit3, MapPin, MousePointer2, Send, Trash2, X } from 'lucide-react'
import { forwardRef, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { FeatureCollection } from 'geojson'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
	GeoRichTextEditor,
	type GeoRichTextEditorRef,
	type GeoFeatureItem,
} from '@/components/editor/GeoRichTextEditor'
import { DrawButtonGroup } from '@/features/geo-editor/components/toolbar/DrawButtonGroup'
import type { EditorFeature, EditorMode } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'

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

interface GeoCommentFormProps {
	onSubmit: (text: string, geojson?: FeatureCollection) => Promise<void>
	onCancel?: () => void
	placeholder?: string
	isReply?: boolean
	autoFocus?: boolean
	/** Optional attached GeoJSON (from editor selection) */
	attachedGeojson?: FeatureCollection | null
	onClearAttachment?: () => void
	/** Available features for $ mentions */
	availableFeatures?: GeoFeatureItem[]
	className?: string
}

/**
 * Form for posting geo comments with optional GeoJSON attachments.
 * Supports rich text editing with geo mentions when availableFeatures is provided.
 */
export const GeoCommentForm = forwardRef<HTMLTextAreaElement, GeoCommentFormProps>(
	(
		{
			onSubmit,
			onCancel,
			placeholder = 'Add a comment...',
			isReply = false,
			autoFocus: _autoFocus = false,
			attachedGeojson,
			onClearAttachment,
			availableFeatures = [],
			className = '',
		},
		_ref,
	) => {
		const currentUser = useActiveAccount()
		const editor = useEditorStore((state) => state.editor)
		const features = useEditorStore((state) => state.features)
		const mode = useEditorStore((state) => state.mode)
		const canFinishDrawing = useEditorStore((state) => state.canFinishDrawing)
		const setFeatures = useEditorStore((state) => state.setFeatures)
		const selectedFeatureIds = useEditorStore((state) => state.selectedFeatureIds)
		const setSelectedFeatureIds = useEditorStore((state) => state.setSelectedFeatureIds)
		const setMode = useEditorStore((state) => state.setMode)
		const setHistoryState = useEditorStore((state) => state.setHistoryState)

		const [text, setText] = useState('')
		const [isSubmitting, setIsSubmitting] = useState(false)
		const [isGeometryDraftActive, setIsGeometryDraftActive] = useState(false)
		const richEditorRef = useRef<GeoRichTextEditorRef>(null)
		const annotationInputRef = useRef<HTMLInputElement>(null)
		const snapshotRef = useRef<EditorSnapshot | null>(null)
		const restoredRef = useRef(false)
		const previousDraftAnnotationCountRef = useRef(0)

		// Always use the rich editor so `$` mentions can work in comments.
		// If there are no available features yet, the editor will still open the menu (showing "No matches").
		const useRichEditor = true

		const attachedFeatures = attachedGeojson?.features ?? []
		const hasAttachedGeometry = attachedFeatures.length > 0
		const draftFeatures = isGeometryDraftActive
			? features.filter((feature) => feature.geometry !== null)
			: []
		const draftAnnotationFeatures = useMemo(
			() => draftFeatures.filter((feature) => feature.properties?.featureType === 'annotation'),
			[draftFeatures],
		)
		const draftFeatureCount = draftFeatures.length
		const totalFeatureCount = attachedFeatures.length + draftFeatureCount
		const hasAnyGeometry = totalFeatureCount > 0
		const isDrawingComplexGeometry = mode === 'draw_linestring' || mode === 'draw_polygon'
		const activeDraftAnnotation = useMemo(() => {
			const selectedAnnotation = draftAnnotationFeatures.find((feature) =>
				selectedFeatureIds.includes(feature.id),
			)
			return (
				selectedAnnotation ?? draftAnnotationFeatures[draftAnnotationFeatures.length - 1] ?? null
			)
		}, [draftAnnotationFeatures, selectedFeatureIds])
		const activeDraftAnnotationText =
			typeof activeDraftAnnotation?.properties?.text === 'string'
				? activeDraftAnnotation.properties.text
				: ''

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

		const geometrySummary = useMemo(() => {
			const counts = {
				labels: 0,
				points: attachedFeatures.filter((feature) => feature.geometry?.type === 'Point').length,
				lines: attachedFeatures.filter(
					(feature) =>
						feature.geometry?.type === 'LineString' || feature.geometry?.type === 'MultiLineString',
				).length,
				polygons: attachedFeatures.filter(
					(feature) =>
						feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon',
				).length,
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

			return counts
		}, [attachedFeatures, draftFeatures])

		const restoreEditorState = useCallback(
			(updateDraftFlag = true) => {
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
				if (updateDraftFlag) {
					setIsGeometryDraftActive(false)
				}
			},
			[editor, setFeatures, setHistoryState, setMode, setSelectedFeatureIds],
		)

		const ensureDraftSession = useCallback(
			(nextMode: EditorMode) => {
				if (!DRAW_MODES.includes(nextMode) || !editor || !currentUser) return

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
					setIsGeometryDraftActive(true)
				}

				setMode(nextMode)
			},
			[currentUser, editor, setFeatures, setHistoryState, setMode, setSelectedFeatureIds],
		)

		useEffect(
			() => () => {
				if (snapshotRef.current) {
					restoreEditorState(false)
				}
			},
			[restoreEditorState],
		)

		const handleSubmit = async (e: React.FormEvent) => {
			e.preventDefault()

			// Get text from rich editor or plain textarea
			const submitText = useRichEditor ? (richEditorRef.current?.getText() ?? '') : text

			const mergedFeatures = [
				...attachedFeatures,
				...draftFeatures.map((feature) => ({
					type: 'Feature' as const,
					id: feature.id,
					geometry: feature.geometry,
					properties: feature.properties ?? {},
				})),
			]
			const submissionGeojson =
				mergedFeatures.length > 0
					? ({
							type: 'FeatureCollection',
							features: mergedFeatures,
						} satisfies FeatureCollection)
					: undefined

			if (!submitText.trim() && !submissionGeojson) return

			setIsSubmitting(true)
			try {
				await onSubmit(submitText, submissionGeojson)
				if (useRichEditor) {
					richEditorRef.current?.clear()
				} else {
					setText('')
				}
				restoreEditorState()
				onClearAttachment?.()
				onCancel?.()
			} catch (error) {
				console.error('Error submitting comment:', error)
			} finally {
				setIsSubmitting(false)
			}
		}

		const handleRichEditorChange = useCallback((newText: string) => {
			setText(newText)
		}, [])

		const handleClearDraftGeometry = useCallback(() => {
			if (!isGeometryDraftActive) return
			const allIds = editor?.getAllFeatures().map((feature) => feature.id) ?? []
			if (allIds.length > 0) {
				editor?.deleteFeatures(allIds)
			}
			editor?.setFeatures([])
			editor?.clearHistory()
			setFeatures([])
			setSelectedFeatureIds([])
			setHistoryState(false, false)
		}, [editor, isGeometryDraftActive, setFeatures, setHistoryState, setSelectedFeatureIds])

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

		const handleCancel = () => {
			restoreEditorState()
			onCancel?.()
		}

		const canSubmit = (text.trim().length > 0 || hasAnyGeometry) && !isSubmitting && !!currentUser

		const effectivePlaceholder = currentUser
			? useRichEditor
				? placeholder
				: placeholder
			: 'Log in to comment...'

		return (
			<form onSubmit={handleSubmit} className={`space-y-2 ${className}`}>
				{/* Editor */}
				<div className="relative">
					<GeoRichTextEditor
						ref={richEditorRef}
						placeholder={effectivePlaceholder}
						availableFeatures={availableFeatures}
						onChange={handleRichEditorChange}
						disabled={isSubmitting || !currentUser}
						rows={isReply ? 2 : 3}
					/>
				</div>

				<div className="border-t border-border pt-2">
					{!currentUser ? (
						<p className="text-[10px] text-muted-foreground">Log in to comment &amp; annotate</p>
					) : (
						<>
							{!isGeometryDraftActive && (
								<p className="mb-1 text-[10px] text-muted-foreground">
									Draw a point, line, or polygon on the map to attach it to your comment.
								</p>
							)}
							<div className="flex flex-wrap items-center gap-1">
								{/* The shared DrawButtonGroup already includes the "Draw label"
								    (draw_annotation) action — no second label button (audit P2:
								    two identical-looking label tools read as two concepts). */}
								<DrawButtonGroup mode={mode} onModeChange={ensureDraftSession} />
								<Button
									type="button"
									size="icon-sm"
									variant={mode === 'select' ? 'default' : 'outline'}
									onClick={() => isGeometryDraftActive && setMode('select')}
									disabled={!isGeometryDraftActive}
									className="rounded-none border-border"
								>
									<MousePointer2 className="h-4 w-4" />
								</Button>
								<Button
									type="button"
									size="icon-sm"
									variant={mode === 'edit' ? 'default' : 'outline'}
									onClick={() => isGeometryDraftActive && setMode('edit')}
									disabled={!isGeometryDraftActive || draftFeatureCount === 0}
									className="rounded-none border-border"
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
										className="gap-1 rounded-none border-ok/40 bg-card text-ok hover:bg-ok/15"
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
									disabled={!isGeometryDraftActive || draftFeatureCount === 0}
									className="gap-1 rounded-none border-border bg-card text-muted-foreground hover:bg-muted"
								>
									<Trash2 className="h-3.5 w-3.5" />
									Clear draft
								</Button>
							</div>
							{mode === 'draw_annotation' && draftAnnotationFeatures.length === 0 && (
								<p className="mt-2 text-[11px] text-primary">
									Click on the map to place a label, then type its text here.
								</p>
							)}
							{activeDraftAnnotation && (
								<div className="mt-2 space-y-1">
									<div className="flex items-center justify-between gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-primary">
										<span>Label text</span>
										{draftAnnotationFeatures.length > 1 && (
											<span className="text-[10px] normal-case tracking-normal text-muted-foreground">
												Editing selected/latest label
											</span>
										)}
									</div>
									<Input
										ref={annotationInputRef}
										value={activeDraftAnnotationText}
										onChange={(event) => handleAnnotationTextChange(event.target.value)}
										placeholder="Type label text..."
										className="h-8 rounded-none border-primary/40 bg-card px-2 text-sm"
										disabled={isSubmitting || !currentUser}
										autoFocus
									/>
								</div>
							)}
							{hasAnyGeometry && (
								<div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-foreground">
									<span className="border border-border px-2 py-0.5 font-medium text-foreground">
										{totalFeatureCount} geometry attached
									</span>
									{geometrySummary.labels > 0 && <span>{geometrySummary.labels} labels</span>}
									{geometrySummary.points > 0 && <span>{geometrySummary.points} points</span>}
									{geometrySummary.lines > 0 && <span>{geometrySummary.lines} lines</span>}
									{geometrySummary.polygons > 0 && <span>{geometrySummary.polygons} polygons</span>}
								</div>
							)}
						</>
					)}
				</div>

				{hasAttachedGeometry && (
					<div className="flex items-center gap-2 border border-ok/40 px-2 py-1 text-[11px] text-ok">
						<MapPin className="h-3.5 w-3.5" />
						<span>
							{attachedFeatures.length} geometry{attachedFeatures.length === 1 ? '' : 'ies'} from
							selection
						</span>
						{onClearAttachment && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={onClearAttachment}
								className="ml-auto h-6 w-6 rounded-none p-0 text-ok hover:text-ok"
							>
								<X className="h-3 w-3" />
							</Button>
						)}
					</div>
				)}

				{/* Action buttons */}
				<div className="flex items-center justify-between gap-2">
					{!currentUser && <p className="text-[10px] text-muted-foreground">Log in to comment</p>}

					<div className="ml-auto flex items-center gap-2">
						{onCancel && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								onClick={handleCancel}
								disabled={isSubmitting}
								className="rounded-none px-2 text-xs"
							>
								Cancel
							</Button>
						)}

						<Tooltip>
							<TooltipTrigger asChild>
								<span tabIndex={!canSubmit ? 0 : undefined} className="inline-flex">
									<Button
										type="submit"
										size="sm"
										disabled={!canSubmit}
										className={`gap-1 rounded-none px-2 text-xs ${canSubmit ? 'bg-ok text-white hover:bg-ok/15' : 'bg-muted text-muted-foreground border border-border'}`}
									>
										<Send className="h-3 w-3" />
										{isReply ? 'Reply' : 'Post'}
									</Button>
								</span>
							</TooltipTrigger>
							<TooltipContent>
								{!currentUser
									? 'Log in to comment'
									: !text.trim() && !hasAnyGeometry
										? 'Write something or attach geometry'
										: isReply
											? 'Post reply'
											: 'Post comment'}
							</TooltipContent>
						</Tooltip>
					</div>
				</div>
			</form>
		)
	},
)

GeoCommentForm.displayName = 'GeoCommentForm'
