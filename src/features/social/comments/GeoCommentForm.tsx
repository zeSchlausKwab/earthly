import {
	Check,
	ChevronDown,
	Edit3,
	MapPin,
	MousePointer2,
	Pentagon,
	Route,
	Send,
	Trash2,
	Type,
	X,
} from 'lucide-react'
import { forwardRef, useState, useRef, useCallback, useContext, useEffect, useMemo } from 'react'
import { useActiveAccount } from 'applesauce-react/hooks'
import type { FeatureCollection } from 'geojson'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
	GeoRichTextEditor,
	type GeoRichTextEditorRef,
	type GeoFeatureItem,
} from '@/components/editor/DeferredGeoRichTextEditor'
import { DrawButtonGroup } from '@/features/geo-editor/components/toolbar/DrawButtonGroup'
import type { EditorFeature, EditorMode } from '@/features/geo-editor/core'
import { useEditorStore } from '@/features/geo-editor/store'
import { PanelTranslucencyContext } from '@/components/PanelTranslucencyContext'
import { cn } from '@/lib/utils'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

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
	/** Whether `$` suggestions may query public relays in addition to local features */
	searchRelayMentions?: boolean
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
			searchRelayMentions = true,
			className = '',
		},
		_ref,
	) => {
		const currentUser = useActiveAccount()
		const translucent = useContext(PanelTranslucencyContext)
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
			<form
				onSubmit={handleSubmit}
				aria-label={isReply ? 'Reply composer' : 'Comment composer'}
				data-translucent={translucent}
				className={cn('space-y-2', className)}
				onKeyDown={(event) => {
					if (
						event.key !== 'Enter' ||
						!(event.metaKey || event.ctrlKey) ||
						event.nativeEvent.isComposing
					)
						return
					event.preventDefault()
					if (canSubmit) event.currentTarget.requestSubmit()
				}}
			>
				{/* Editor */}
				<div className="relative">
					<GeoRichTextEditor
						ref={richEditorRef}
						placeholder={effectivePlaceholder}
						availableFeatures={availableFeatures}
						searchRelayMentions={searchRelayMentions}
						onChange={handleRichEditorChange}
						disabled={isSubmitting || !currentUser}
						rows={2}
						translucent={translucent}
						defaultToolbarExpanded={false}
					/>
				</div>

				{currentUser && isGeometryDraftActive && (
					<div className="border-t border-border pt-2">
						<p className="mb-2 border border-amber-600/30 bg-amber-500/10 px-2 py-1 text-[11px] text-foreground">
							{mode === 'draw_point'
								? 'Tap the map to attach a place.'
								: mode === 'draw_linestring' || mode === 'draw_polygon'
									? 'Tap points on the map, then finish the shape.'
									: mode === 'draw_annotation'
										? 'Tap the map to place a label.'
										: 'Adjust the attached geometry, then post your comment.'}
						</p>
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
								aria-label="Select comment geometry"
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
								aria-label="Edit comment geometry"
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
									className={cn(
										'gap-1 rounded-none border-ok/40 text-ok hover:bg-ok/15',
										translucent ? 'bg-transparent' : 'bg-card',
									)}
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
								className={cn(
									'gap-1 rounded-none border-border text-muted-foreground hover:bg-muted/40',
									translucent ? 'bg-transparent' : 'bg-card',
								)}
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
									aria-label="Comment label text"
									className={cn(
										'h-8 rounded-none border-primary/40 px-2 text-sm',
										translucent ? 'bg-transparent' : 'bg-card',
									)}
									disabled={isSubmitting || !currentUser}
									autoFocus
								/>
							</div>
						)}
						{hasAnyGeometry && (
							<div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-foreground">
								<span className="border border-ok/40 bg-ok/10 px-2 py-0.5 font-medium text-ok">
									{totalFeatureCount} {totalFeatureCount === 1 ? 'geometry' : 'geometries'} attached
								</span>
								{geometrySummary.labels > 0 && (
									<span>
										{geometrySummary.labels} {geometrySummary.labels === 1 ? 'label' : 'labels'}
									</span>
								)}
								{geometrySummary.points > 0 && (
									<span>
										{geometrySummary.points} {geometrySummary.points === 1 ? 'point' : 'points'}
									</span>
								)}
								{geometrySummary.lines > 0 && (
									<span>
										{geometrySummary.lines} {geometrySummary.lines === 1 ? 'line' : 'lines'}
									</span>
								)}
								{geometrySummary.polygons > 0 && (
									<span>
										{geometrySummary.polygons}{' '}
										{geometrySummary.polygons === 1 ? 'polygon' : 'polygons'}
									</span>
								)}
							</div>
						)}
					</div>
				)}

				{hasAttachedGeometry && (
					<div className="flex items-center gap-2 border border-ok/40 px-2 py-1 text-[11px] text-ok">
						<MapPin className="h-3.5 w-3.5" />
						<span>
							{attachedFeatures.length} {attachedFeatures.length === 1 ? 'geometry' : 'geometries'}{' '}
							from selection
						</span>
						{onClearAttachment && (
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								onClick={onClearAttachment}
								aria-label="Remove attached selection"
								className="ml-auto h-6 w-6 rounded-none p-0 text-ok hover:text-ok"
							>
								<X className="h-3 w-3" />
							</Button>
						)}
					</div>
				)}

				{/* Action buttons */}
				<div className="flex items-center justify-between gap-2">
					{!currentUser ? (
						<p className="text-[11px] text-muted-foreground">Log in to comment</p>
					) : (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									disabled={!editor || isSubmitting}
									className={cn('gap-1.5 rounded-none', translucent ? 'bg-transparent' : 'bg-card')}
								>
									<MapPin className="h-3.5 w-3.5" />
									{hasAnyGeometry ? 'Add a place' : 'Attach a place'}
									<ChevronDown className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="start" className="min-w-44">
								<DropdownMenuItem onSelect={() => ensureDraftSession('draw_point')}>
									<MapPin />
									Drop a pin
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => ensureDraftSession('draw_linestring')}>
									<Route />
									Draw a line
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => ensureDraftSession('draw_polygon')}>
									<Pentagon />
									Draw an area
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => ensureDraftSession('draw_annotation')}>
									<Type />
									Add a label
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					)}

					<div className="ml-auto flex items-center gap-2">
						{onCancel && (isReply || isGeometryDraftActive) && (
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
