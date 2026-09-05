/**
 * ListRow — the single row grammar shared by every entity list rail (Datasets,
 * Contexts, Beacons, Sightings, Stories). Margin spec §5: compact thumbnail,
 * title and metadata, then one primary action and More. Social shortcuts reveal
 * on desktop hover; the same controls remain available in More on touch screens.
 *
 * Selection is an amber left-border + faint amber wash (overridable per entity
 * via `selectedClassName`). The row draws a hairline bottom border so a dense
 * stack reads as a ledger, not a set of floating cards.
 */

import type { ReactNode, Ref } from 'react'
import { Ellipsis, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import './entity-list.css'

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
			className={cn('entity-row-action', ROW_ACTION_BTN, hover, active && activeClassName)}
			onClick={onClick}
			aria-label={label}
			title={label}
		>
			<Icon className={cn('h-4 w-4', filled && 'fill-current')} />
			<span className="entity-row-action-label">{label}</span>
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
	/** 40×28 leading element — geometry preview, cover thumb, glyph, or avatar. */
	leading?: ReactNode
	title: ReactNode
	/** Title click (zoom / open). When omitted the title is inert text. */
	onTitleClick?: () => void
	titleAriaLabel?: string
	titleTitle?: string
	draggable?: boolean
	onDragStart?: (event: React.DragEvent<HTMLButtonElement>) => void
	/** Compact state chips below the metadata. */
	badges?: ReactNode
	/** Author + mono meta line (usually a UserProfile + · + relative time). */
	meta?: ReactNode
	/** Extra sub-line under the meta row (e.g. a curated-child note). */
	note?: ReactNode
	/** Social shortcuts on desktop hover and in the More popover. */
	engage?: ReactNode
	/** Full action collection in the More popover (including destructive confirmation). */
	actions?: ReactNode
	/** Always-visible map toggle or frame action. Everything else lives in More. */
	primaryAction?: ReactNode
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
	primaryAction,
	selected = false,
	selectedClassName = 'border-l-primary bg-primary/[0.08]',
	dimmed = false,
	indentRem,
	rowRef,
	className,
}: ListRowProps) {
	const hasActionBar = Boolean(engage) || Boolean(actions) || Boolean(primaryAction)

	const titleClass =
		'entity-list-row-title min-w-0 flex-1 truncate text-sm font-semibold text-foreground'

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Delegates empty-row clicks to the real title button without nesting the independent action buttons.
		// biome-ignore lint/a11y/useKeyWithClickEvents: The real title button below supplies native keyboard activation for this same action.
		<div
			ref={rowRef}
			onClick={(event) => {
				// The whole ledger row opens the object, except for its independent controls.
				if (
					(event.target as Element).closest(
						'button, a, input, select, textarea, [role="button"], [role="dialog"]',
					)
				)
					return
				onTitleClick?.()
			}}
			className={cn(
				'entity-list-row border-b border-l-2 border-border px-2.5 py-2 transition-colors',
				onTitleClick && 'cursor-pointer',
				// The table owns the resting surface so a glass sheet can show through each row.
				selected ? selectedClassName : 'border-l-transparent bg-transparent hover:bg-muted/40',
				dimmed && 'opacity-60',
				className,
			)}
			style={indentRem ? { paddingLeft: `${0.625 + indentRem}rem` } : undefined}
		>
			<div className="entity-list-row-content flex min-w-0 items-center gap-2">
				{leading ? <div className="entity-list-row-leading shrink-0">{leading}</div> : null}
				<div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
					</div>
					{meta ? (
						<div className="entity-list-row-meta flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
							{meta}
						</div>
					) : null}
					{badges ? (
						<div className="entity-list-row-badges flex min-w-0 items-center gap-1">{badges}</div>
					) : null}
					{note ? <div className="text-[10px] text-muted-foreground">{note}</div> : null}
				</div>
			</div>
			{hasActionBar ? (
				<div className="entity-list-row-controls flex shrink-0 items-center gap-0.5">
					{primaryAction}
					{engage ? <div className="entity-list-row-engage">{engage}</div> : null}
					{actions || engage ? (
						<Popover>
							<PopoverTrigger asChild>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={`More actions${typeof title === 'string' ? ` for ${title}` : ''}`}
									title="More actions"
								>
									<Ellipsis className="h-4 w-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								className="entity-list-row-menu"
								aria-label="Entity actions"
							>
								{engage ? <div className="entity-list-row-menu-social">{engage}</div> : null}
								<div className="entity-list-row-menu-actions">{actions}</div>
							</PopoverContent>
						</Popover>
					) : null}
				</div>
			) : null}
		</div>
	)
}
