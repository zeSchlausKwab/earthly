import { useCallback, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Check, Hexagon, MapPin, Pencil, Sparkles, Spline, Type, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { executeEditorCommand } from '../commands'
import { useEditorStore } from '../store'
import { mobileDrawingCanFinish, mobileDrawingHint } from './mobileDrawingPresentation'
import './mobileDrawing.css'

export interface MobileDrawingChromeProps {
	showStatus?: boolean
	onDone: () => void
	onAsk: () => void
	moreTools: ReactNode
	onMoveSelection?: () => void
	onRenameSelection?: () => void
}

/** Phone composition of the existing editor: no duplicate feature or draft state. */
export function MobileDrawingChrome({
	showStatus = true,
	onDone,
	onAsk,
	moreTools,
	onMoveSelection,
	onRenameSelection,
}: MobileDrawingChromeProps) {
	const editor = useEditorStore((state) => state.editor)
	const mode = useEditorStore((state) => state.mode)
	const title = useEditorStore((state) => state.collectionMeta.name.trim() || 'Untitled map')
	const authoringIntent = useEditorStore((state) =>
		state.activeGeoEditDraftId
			? state.geoEditDrafts[state.activeGeoEditDraftId]?.authoringIntent
			: undefined,
	)
	const selectedIds = useEditorStore((state) => state.selectedFeatureIds)
	const canUndo = useEditorStore((state) => state.history.canUndo)
	const [renameOpen, setRenameOpen] = useState(false)
	const [newName, setNewName] = useState('')
	const subscribe = useCallback(
		(notify: () => void) => {
			if (!editor) return () => {}
			editor.on('draw.change', notify)
			editor.on('mode.change', notify)
			return () => {
				editor.off('draw.change', notify)
				editor.off('mode.change', notify)
			}
		},
		[editor],
	)
	const getPointCount = useCallback(() => editor?.getDrawingPointCount() ?? 0, [editor])
	const pointCount = useSyncExternalStore(subscribe, getPointCount, () => 0)
	const drawing = pointCount > 0
	const done = () => {
		editor?.cancelDrawing()
		onDone()
	}
	const rename = () => {
		if (onRenameSelection) {
			onRenameSelection()
			return
		}
		const feature = editor?.getSelectedFeatures()[0]
		if (!feature) return
		setNewName(typeof feature.properties?.name === 'string' ? feature.properties.name : '')
		setRenameOpen(true)
	}

	return (
		<>
			{showStatus ? (
				<section className="mobile-drawing-status" aria-label="Editing Map">
					<Pencil className="size-4 shrink-0 text-primary" aria-hidden="true" />
					<strong className="min-w-0 truncate text-sm">{title}</strong>
					<span className="mobile-drawing-hint">
						{authoringIntent === 'propose'
							? 'Proposing · '
							: authoringIntent === 'fork'
								? 'Your copy · '
								: ''}
						{mobileDrawingHint(mode, pointCount, selectedIds.length)}
					</span>
					<button
						type="button"
						onClick={done}
						className="mobile-drawing-exit"
						aria-label="Exit editing"
					>
						Exit
					</button>
				</section>
			) : null}
			{selectedIds.length > 0 && !drawing ? (
				<section className="mobile-drawing-selection" aria-label="Selection actions">
					<span className="whitespace-nowrap text-xs">{selectedIds.length} selected</span>
					<Button
						variant="outline"
						size="sm"
						onClick={onMoveSelection ?? (() => executeEditorCommand('set_mode', { mode: 'edit' }))}
					>
						Move
					</Button>
					{selectedIds.length === 1 ? (
						<Button variant="outline" size="sm" onClick={rename}>
							Rename
						</Button>
					) : null}
					<Button
						variant="ghost"
						size="sm"
						className="text-destructive"
						onClick={() => executeEditorCommand('delete_selected_features')}
					>
						Delete
					</Button>
					<button
						type="button"
						className="ml-auto min-h-11 min-w-11"
						aria-label="Clear selection"
						onClick={() => editor?.selectFeatures([])}
					>
						<X className="mx-auto size-4" />
					</button>
				</section>
			) : null}
			<nav
				aria-label="Map drawing"
				className={cn('mobile-drawing-dock', drawing && 'mobile-drawing-dock--active')}
			>
				{drawing ? (
					<>
						<button
							type="button"
							className="mobile-drawing-tool mobile-drawing-done"
							disabled={!mobileDrawingCanFinish(mode, pointCount)}
							onClick={() => executeEditorCommand('finish_drawing')}
						>
							<Check className="size-5" />
							<span>Finish · {pointCount}</span>
						</button>
						<button
							type="button"
							className="mobile-drawing-tool"
							onClick={() => editor?.undoDrawingPoint()}
						>
							<Undo2 className="size-5" />
							<span>Undo point</span>
						</button>
						<span className="flex-1" />
						<button
							type="button"
							className="mobile-drawing-tool"
							onClick={() => editor?.cancelDrawing()}
						>
							<X className="size-5" />
							<span>Cancel</span>
						</button>
					</>
				) : (
					<>
						{(
							[
								{ mode: 'draw_point', label: 'Point', icon: MapPin },
								{ mode: 'draw_linestring', label: 'Line', icon: Spline },
								{ mode: 'draw_polygon', label: 'Area', icon: Hexagon },
								{ mode: 'draw_annotation', label: 'Label', icon: Type },
							] as const
						).map((tool) => (
							<button
								key={tool.mode}
								type="button"
								className="mobile-drawing-tool"
								aria-label={
									tool.mode === 'draw_polygon' ? 'Draw polygon' : `Draw ${tool.label.toLowerCase()}`
								}
								aria-pressed={mode === tool.mode}
								onClick={() => {
									executeEditorCommand('set_mode', {
										mode: mode === tool.mode ? 'select' : tool.mode,
									})
									useEditorStore.getState().setMobilePanelSnap('peek')
								}}
							>
								<tool.icon className="size-5" />
								<span>{tool.label}</span>
							</button>
						))}
						<button
							type="button"
							className="mobile-drawing-tool mobile-drawing-undo"
							disabled={!canUndo}
							onClick={() => executeEditorCommand('undo')}
						>
							<Undo2 className="size-5" />
							<span>Undo</span>
						</button>
						{moreTools}
						<button type="button" className="mobile-drawing-tool" onClick={onAsk}>
							<Sparkles className="size-5" />
							<span>Ask</span>
						</button>
						<button
							type="button"
							className="mobile-drawing-tool mobile-drawing-done"
							onClick={done}
						>
							<strong>Done</strong>
							<span>keeps draft</span>
						</button>
					</>
				)}
			</nav>
			<Dialog open={renameOpen} onOpenChange={setRenameOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Rename feature</DialogTitle>
					</DialogHeader>
					<form
						onSubmit={(event) => {
							event.preventDefault()
							const feature = editor?.getSelectedFeatures()[0]
							if (feature)
								editor?.updateFeature(feature.id, {
									...feature,
									properties: { ...feature.properties, name: newName.trim() },
								})
							setRenameOpen(false)
						}}
					>
						<Input
							aria-label="Feature name"
							value={newName}
							onChange={(event) => setNewName(event.target.value)}
							autoFocus
						/>
						<DialogFooter className="mt-4">
							<Button type="button" variant="ghost" onClick={() => setRenameOpen(false)}>
								Cancel
							</Button>
							<Button type="submit">Save name</Button>
						</DialogFooter>
					</form>
				</DialogContent>
			</Dialog>
		</>
	)
}
