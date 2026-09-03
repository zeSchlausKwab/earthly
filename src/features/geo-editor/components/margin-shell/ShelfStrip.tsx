import { useState } from 'react'
import type { CSSProperties, DragEvent } from 'react'
import {
	AlertTriangle,
	ArrowLeft,
	ArrowRight,
	Eye,
	EyeOff,
	LockKeyhole,
	Pencil,
	Radio,
	Save,
	X,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ShelfStripItem {
	/** Instance id, not entity address. Duplicate references remain independently addressable. */
	id: string
	title: string
	visible: boolean
	color?: string
	active?: boolean
	editing?: boolean
	running?: boolean
	locked?: boolean
	lockLabel?: string
	warning?: boolean
	warningLabel?: string
	/** Defaults to true. Set false when the layer is required by an active edit. */
	toggleable?: boolean
	/** Explains why the visibility control is disabled to assistive technology. */
	toggleDisabledLabel?: string
	/** Defaults to true. Set false when the layer cannot leave the current canvas. */
	removable?: boolean
	/** Explains why the remove control is disabled to assistive technology. */
	removeDisabledLabel?: string
	/** Defaults to true. False keeps authored presentation layers in their declared order. */
	reorderable?: boolean
}

export interface ShelfLiveItem {
	count: number
	visible: boolean
	onToggle?: () => void
}

export interface ShelfStripProps {
	items: readonly ShelfStripItem[]
	live?: ShelfLiveItem
	onOpenItem?: (item: ShelfStripItem) => void
	onToggleItem?: (item: ShelfStripItem, visible: boolean) => void
	onRemoveItem?: (item: ShelfStripItem) => void
	onHoverItem?: (item: ShelfStripItem | null) => void
	/**
	 * Moves an instance before or after another instance. The explicit placement
	 * keeps keyboard left/right moves and pointer drops semantically identical.
	 */
	onReorderItem?: (draggedId: string, targetId: string, placement: ShelfReorderPlacement) => void
	onOpenShelf?: () => void
	onSaveView?: () => void
	className?: string
}

export type ShelfReorderPlacement = 'before' | 'after'

const SHELF_DRAG_MIME = 'application/x-earthly-shelf-item'

/** Protected items divide the strip into independently reorderable segments. */
export function canReorderShelfItem(
	items: readonly ShelfStripItem[],
	draggedId: string,
	targetId: string,
): boolean {
	const draggedIndex = items.findIndex((item) => item.id === draggedId)
	const targetIndex = items.findIndex((item) => item.id === targetId)
	if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return false
	if (items[draggedIndex]?.reorderable === false || items[targetIndex]?.reorderable === false) {
		return false
	}

	const start = Math.min(draggedIndex, targetIndex) + 1
	const end = Math.max(draggedIndex, targetIndex)
	return !items.slice(start, end).some((item) => item.reorderable === false)
}

export function getShelfKeyboardReorderIntent(
	items: readonly ShelfStripItem[],
	index: number,
	direction: 'left' | 'right',
): { targetId: string; placement: ShelfReorderPlacement } | null {
	const item = items[index]
	const target = items[direction === 'left' ? index - 1 : index + 1]
	if (!item || !target || !canReorderShelfItem(items, item.id, target.id)) return null
	return {
		targetId: target.id,
		placement: direction === 'left' ? 'before' : 'after',
	}
}

/**
 * The always-visible, deliberately shallow representation of what is drawn.
 * Detailed isolate/pin/style controls belong to `/shelf`; this strip preserves
 * open, visibility, remove, ordering, live-layer, and save-view affordances.
 */
export function ShelfStrip({
	items,
	live,
	onOpenItem,
	onToggleItem,
	onRemoveItem,
	onHoverItem,
	onReorderItem,
	onOpenShelf,
	onSaveView,
	className,
}: ShelfStripProps) {
	const [reorderAnnouncement, setReorderAnnouncement] = useState('')
	const moveItem = (item: ShelfStripItem, index: number, direction: 'left' | 'right') => {
		const intent = getShelfKeyboardReorderIntent(items, index, direction)
		if (!intent) return
		onReorderItem?.(item.id, intent.targetId, intent.placement)
		setReorderAnnouncement(`${item.title} moved ${direction}`)
	}

	return (
		<div className={cn('earthly-shelf', className)} data-tour="shelf-strip">
			<button
				type="button"
				className="earthly-shelf__label"
				onClick={onOpenShelf}
				disabled={!onOpenShelf}
				aria-label={`Open Shelf, ${items.length} ${items.length === 1 ? 'map' : 'maps'} on the map`}
			>
				On the map
				<span>{items.length}</span>
			</button>

			<ul className="earthly-shelf__items" aria-label="Maps on the canvas">
				{items.map((item, index) => {
					const reorderable = Boolean(onReorderItem) && item.reorderable !== false
					const moveLeftIntent = onReorderItem
						? getShelfKeyboardReorderIntent(items, index, 'left')
						: null
					const moveRightIntent = onReorderItem
						? getShelfKeyboardReorderIntent(items, index, 'right')
						: null
					const toggleDisabled = !onToggleItem || item.toggleable === false
					const removeDisabled = !onRemoveItem || item.removable === false
					const toggleActionLabel = `${item.visible ? 'Hide' : 'Show'} ${item.title}`
					const removeActionLabel = `Remove ${item.title} from the map`
					const toggleLabel =
						toggleDisabled && item.toggleDisabledLabel
							? `${toggleActionLabel}. ${item.toggleDisabledLabel}`
							: toggleActionLabel
					const removeLabel =
						removeDisabled && item.removeDisabledLabel
							? `${removeActionLabel}. ${item.removeDisabledLabel}`
							: removeActionLabel

					return (
						<li
							key={item.id}
							className={cn(
								'earthly-shelf__chip',
								item.active && 'is-active',
								item.editing && 'is-editing',
								item.running && 'is-running',
								!item.visible && 'is-hidden',
								item.warning && 'has-warning',
							)}
							data-shelf-item={item.id}
							draggable={reorderable}
							onDragStart={(event: DragEvent<HTMLLIElement>) => {
								if (!reorderable) {
									event.preventDefault()
									return
								}
								event.dataTransfer.effectAllowed = 'move'
								event.dataTransfer.setData(SHELF_DRAG_MIME, item.id)
							}}
							onDragOver={(event) => {
								if (!reorderable) return
								event.preventDefault()
								event.dataTransfer.dropEffect = 'move'
							}}
							onDrop={(event) => {
								if (!onReorderItem || !reorderable) return
								event.preventDefault()
								const draggedId = event.dataTransfer.getData(SHELF_DRAG_MIME)
								if (!canReorderShelfItem(items, draggedId, item.id)) return
								const bounds = event.currentTarget.getBoundingClientRect()
								const placement: ShelfReorderPlacement =
									event.clientX >= bounds.left + bounds.width / 2 ? 'after' : 'before'
								onReorderItem(draggedId, item.id, placement)
							}}
							onPointerEnter={() => onHoverItem?.(item)}
							onPointerLeave={() => onHoverItem?.(null)}
							onFocusCapture={() => onHoverItem?.(item)}
							onBlurCapture={(event) => {
								if (!event.currentTarget.contains(event.relatedTarget)) onHoverItem?.(null)
							}}
						>
							<span
								className="earthly-shelf__swatch"
								style={{ '--shelf-swatch': item.color ?? 'var(--text-faint)' } as CSSProperties}
								aria-hidden="true"
							/>
							{item.warning ? (
								<AlertTriangle
									className="earthly-shelf__state earthly-shelf__warning"
									aria-label={item.warningLabel ?? 'Map data did not load'}
								/>
							) : null}
							{item.locked ? (
								<LockKeyhole
									className="earthly-shelf__state"
									aria-label={item.lockLabel ?? 'Private map'}
								/>
							) : null}
							{item.editing ? (
								<Pencil className="earthly-shelf__state" aria-label="Working copy" />
							) : null}
							{moveLeftIntent ? (
								<button
									type="button"
									className="earthly-shelf__icon-button earthly-shelf__reorder"
									onClick={() => moveItem(item, index, 'left')}
									aria-label={`Move ${item.title} left`}
								>
									<ArrowLeft aria-hidden="true" />
								</button>
							) : null}
							{moveRightIntent ? (
								<button
									type="button"
									className="earthly-shelf__icon-button earthly-shelf__reorder"
									onClick={() => moveItem(item, index, 'right')}
									aria-label={`Move ${item.title} right`}
								>
									<ArrowRight aria-hidden="true" />
								</button>
							) : null}
							<button
								type="button"
								className="earthly-shelf__name"
								onClick={() => onOpenItem?.(item)}
								disabled={!onOpenItem}
								title={item.title}
							>
								{item.title}
							</button>
							<button
								type="button"
								className="earthly-shelf__icon-button"
								onClick={() => onToggleItem?.(item, !item.visible)}
								disabled={toggleDisabled}
								aria-disabled={toggleDisabled}
								aria-label={toggleLabel}
								title={toggleDisabled ? item.toggleDisabledLabel : undefined}
								aria-pressed={item.visible}
							>
								{item.visible ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
							</button>
							<button
								type="button"
								className="earthly-shelf__icon-button"
								onClick={() => onRemoveItem?.(item)}
								disabled={removeDisabled}
								aria-disabled={removeDisabled}
								aria-label={removeLabel}
								title={removeDisabled ? item.removeDisabledLabel : undefined}
							>
								<X aria-hidden="true" />
							</button>
						</li>
					)
				})}

				{live ? (
					<li>
						<button
							type="button"
							className={cn(
								'earthly-shelf__chip earthly-shelf__live',
								!live.visible && 'is-hidden',
							)}
							onClick={live.onToggle}
							disabled={!live.onToggle}
							aria-pressed={live.visible}
							aria-label={`${live.visible ? 'Hide' : 'Show'} ${live.count} live map items`}
						>
							<Radio className="earthly-shelf__live-icon" aria-hidden="true" />
							<span>Live · {live.count}</span>
						</button>
					</li>
				) : null}
			</ul>
			<span className="sr-only" aria-live="polite">
				{reorderAnnouncement}
			</span>

			<div className="earthly-shelf__spacer" />
			{onSaveView ? (
				<button type="button" className="earthly-shelf__save" onClick={onSaveView}>
					<Save aria-hidden="true" />
					<span>Save this view</span>
				</button>
			) : null}
		</div>
	)
}
