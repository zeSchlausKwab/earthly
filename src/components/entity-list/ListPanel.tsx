/**
 * ListPanel — the shared shell around every entity list rail. Redesign §11a:
 * one Panel = header · search · body · footer.
 *
 *   header  — entity glyph · title · count · "+ new" button
 *   search  — the EntitySearchToolbar (passed in via `toolbar`)
 *   body    — the EntityListTable (or an empty / loading state), scrolls
 *   footer  — mono "N shown" on the left, a status hint on the right
 *
 * The four (well, five) rails share this frame so they read as one instrument.
 * The shell fills its container height and scrolls only the body, pinning the
 * header and footer.
 */

import { type ReactNode, useContext } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { EmbeddedListPanelContext } from './EmbeddedContext'

interface ListPanelProps {
	icon: LucideIcon
	title: string
	/** Accent utility for the header glyph + count (e.g. `text-primary`). */
	accent?: string
	/** Right-of-title count chip (mono). */
	count?: ReactNode
	/** The "+ new" affordance. Omit to hide the button. */
	onNew?: () => void
	newLabel?: string
	/** Inline controls sharing the title line (e.g. the All/Favorites/Recent strip),
	 * right-aligned before the "+ new" button. */
	titleAccessory?: ReactNode
	/** Extra header controls on their own row below the title. */
	headerExtra?: ReactNode
	/** The search/sort toolbar. */
	toolbar?: ReactNode
	/** Footer left slot — usually a mono "N shown". */
	footerLeft?: ReactNode
	/** Footer right slot — usually a mono status hint. */
	footerRight?: ReactNode
	children: ReactNode
}

export function ListPanel({
	icon: Icon,
	title,
	accent = 'text-primary',
	count,
	onNew,
	newLabel = 'New',
	titleAccessory,
	headerExtra,
	toolbar,
	footerLeft,
	footerRight,
	children,
}: ListPanelProps) {
	// Inside the mobile sheet the §14a switcher pill is already the header, so the
	// panel's own title row (glyph · title · count · + new) would double it up.
	const embedded = useContext(EmbeddedListPanelContext)
	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Header — glyph · title · count · [inline controls] · + new */}
			<div className="flex shrink-0 flex-col gap-2 border-b border-border pb-2">
				{embedded ? null : (
					<div className="flex items-center gap-2">
						<Icon className={cn('h-3.5 w-3.5 shrink-0', accent)} />
						<span className="truncate text-[13px] font-semibold text-foreground">{title}</span>
						{count != null ? (
							<span className={cn('shrink-0 font-mono text-[10px]', accent)}>{count}</span>
						) : null}
						<div className="ml-auto flex shrink-0 items-center gap-1.5">
							{titleAccessory}
							{onNew ? (
								<Button
									type="button"
									variant="outline"
									size="icon-sm"
									onClick={onNew}
									aria-label={newLabel}
									title={newLabel}
									className="h-6 w-6 rounded-[2px]"
								>
									<span className="text-base leading-none">+</span>
								</Button>
							) : null}
						</div>
					</div>
				)}
				{/* On mobile keep the tab strip (All/Favorites/Recent) — it moves off the
				    hidden title row into its own line. */}
				{embedded ? titleAccessory : null}
				{headerExtra}
				{toolbar}
			</div>

			{/* Body — the list, the only scroll region. */}
			<div className="min-h-0 flex-1 overflow-y-auto py-2 [scrollbar-gutter:stable]">
				{children}
			</div>

			{/* Footer — mono ledger line. */}
			{footerLeft != null || footerRight != null ? (
				<div className="flex shrink-0 items-center gap-2 border-t border-border pt-1.5 font-mono text-[9.5px] text-muted-foreground">
					<span>{footerLeft}</span>
					{footerRight != null ? <span className="ml-auto">{footerRight}</span> : null}
				</div>
			) : null}
		</div>
	)
}
