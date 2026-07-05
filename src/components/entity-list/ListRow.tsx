/**
 * ListRow — the single row grammar shared by every entity list rail (Datasets,
 * Contexts, Beacons, Sightings, Stories). Redesign §11a "Four panels, one row
 * grammar": each row is [leading glyph/thumb/avatar] · [title + state badges] ·
 * [author + mono meta] · [identical action bar: engage on the left, act on the
 * right]. Only the leading element and the badges change per entity, so the
 * rails read as one learnable component.
 *
 * Selection is an amber left-border + faint amber wash (overridable per entity
 * via `selectedClassName`). The row draws a hairline bottom border so a dense
 * stack reads as a ledger, not a set of floating cards.
 */

import type { ReactNode, Ref } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * Resting style for a row action icon — muted-but-present (so the cluster never
 * reads as disabled) with a subtle rounded hover chip so each icon behaves like
 * a button. Per-button hover tints are layered on at the call site.
 */
export const ROW_ACTION_BTN =
	'rounded-[2px] px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-info'

interface RowActionButtonProps {
	icon: LucideIcon
	label: string
	onClick: () => void
	/** Hover tint utility (e.g. `hover:text-ok`). Defaults to info. */
	hover?: string
	/** True when the action is in its "on" state (e.g. already on the map stack). */
	active?: boolean
	/** Class applied while `active` — usually the same tint as `hover`, pinned on. */
	activeClassName?: string
	/** Fill the icon (favorites star). */
	filled?: boolean
	disabled?: boolean
}

/** One act-cluster icon button — the canonical right-side row affordance. */
export function RowActionButton({
	icon: Icon,
	label,
	onClick,
	hover = 'hover:text-info',
	active = false,
	activeClassName,
	filled = false,
	disabled = false,
}: RowActionButtonProps) {
	return (
		<Button
			size="icon-sm"
			variant="ghost"
			disabled={disabled}
			className={cn(ROW_ACTION_BTN, hover, active && activeClassName)}
			onClick={onClick}
			aria-label={label}
			title={label}
		>
			<Icon className={cn('h-4 w-4', filled && 'fill-current')} />
		</Button>
	)
}

/** A compact state badge — the title-row chip (LIVE / Poly / taxonomy / …). */
export function RowBadge({ label, className }: { label: ReactNode; className?: string }) {
	return (
		<span
			className={cn(
				'shrink-0 rounded-[2px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
				className,
			)}
		>
			{label}
		</span>
	)
}

export interface ListRowProps {
	/** 34×34 leading element — type-glyph tile, cover thumb, or avatar. */
	leading?: ReactNode
	title: ReactNode
	/** Title click (zoom / open). When omitted the title is inert text. */
	onTitleClick?: () => void
	titleAriaLabel?: string
	titleTitle?: string
	draggable?: boolean
	onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
	/** Right-aligned chips on the title row. */
	badges?: ReactNode
	/** Author + mono meta line (usually a UserProfile + · + relative time). */
	meta?: ReactNode
	/** Extra sub-line under the meta row (e.g. a curated-child note). */
	note?: ReactNode
	/** Engage cluster — the left side of the action bar (GeoSocialActions). */
	engage?: ReactNode
	/** Act cluster — the right side of the action bar (RowActionButtons). */
	actions?: ReactNode
	selected?: boolean
	/** Override the selected accent (defaults to amber `--primary`). */
	selectedClassName?: string
	/** Fade the row (e.g. a hidden dataset). */
	dimmed?: boolean
	/** Tree indent, in rem (context depth). */
	indentRem?: number
	/** Ref on the scroll container — used to bring a map-selected row into view. */
	rowRef?: Ref<HTMLDivElement>
	className?: string
}

export function ListRow({
	leading,
	title,
	onTitleClick,
	titleAriaLabel,
	titleTitle,
	draggable,
	onDragStart,
	badges,
	meta,
	note,
	engage,
	actions,
	selected = false,
	selectedClassName = 'border-l-primary bg-primary/[0.08]',
	dimmed = false,
	indentRem,
	rowRef,
	className,
}: ListRowProps) {
	const hasActionBar = Boolean(engage) || Boolean(actions)

	const titleClass = 'line-clamp-2 min-w-0 flex-1 break-words text-sm font-semibold text-foreground'

	return (
		<div
			ref={rowRef}
			className={cn(
				'border-b border-l-2 border-border px-2.5 py-2 transition-colors',
				selected ? selectedClassName : 'border-l-transparent hover:bg-muted/40',
				dimmed && 'opacity-60',
				className,
			)}
			style={indentRem ? { paddingLeft: `${0.625 + indentRem}rem` } : undefined}
		>
			<div className="flex min-w-0 items-start gap-2">
				{leading ? <div className="shrink-0">{leading}</div> : null}
				<div className="flex min-w-0 flex-1 flex-col gap-1">
					<div className="flex min-w-0 items-center gap-1.5">
						{onTitleClick ? (
							<button
								type="button"
								className={cn(
									titleClass,
									'cursor-pointer text-left transition-colors hover:text-info',
									draggable && 'cursor-grab active:cursor-grabbing',
								)}
								draggable={draggable}
								onDragStart={onDragStart}
								onClick={onTitleClick}
								aria-label={titleAriaLabel}
								title={titleTitle}
							>
								{title}
							</button>
						) : (
							<span className={titleClass}>{title}</span>
						)}
						{badges ? <div className="flex shrink-0 items-center gap-1">{badges}</div> : null}
					</div>
					{meta ? (
						<div className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
							{meta}
						</div>
					) : null}
					{note ? <div className="text-[10px] text-muted-foreground">{note}</div> : null}
				</div>
			</div>
			{hasActionBar ? (
				<div className="mt-2 flex items-center gap-3">
					{engage ? <div className="flex shrink-0 items-center">{engage}</div> : null}
					<div className="flex-1" />
					{actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
				</div>
			) : null}
		</div>
	)
}
