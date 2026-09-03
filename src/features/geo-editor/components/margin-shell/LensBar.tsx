import type { ReactNode } from 'react'
import { Info, Share2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface LensBarProps {
	emblem: ReactNode
	title: string
	itemCount: number
	itemNoun: string
	itemNounPlural?: string
	policyLabel: string
	authorLabel?: string
	rule?: string
	onOpenAbout?: () => void
	onShare?: () => void
	onLeave: () => void
	className?: string
}

/** The single 38px signal that Browse and creation are scoped to an Atlas. */
export function LensBar({
	emblem,
	title,
	itemCount,
	itemNoun,
	itemNounPlural,
	policyLabel,
	authorLabel,
	rule,
	onOpenAbout,
	onShare,
	onLeave,
	className,
}: LensBarProps) {
	const pluralNoun = itemCount === 1 ? itemNoun : (itemNounPlural ?? `${itemNoun}s`)
	const meta = `${itemCount} ${pluralNoun} · ${policyLabel}${authorLabel ? ` · by ${authorLabel}` : ''}`

	return (
		<section className={cn('earthly-lensbar', className)} aria-label={`Inside ${title}`}>
			<span className="earthly-lensbar__emblem" aria-hidden="true">
				{emblem}
			</span>
			<span className="earthly-lensbar__identity">
				<strong>{title}</strong>
				<span>{meta}</span>
			</span>
			<span className="earthly-lensbar__rule">
				{rule ?? `Lists show only this atlas. New ${pluralNoun} belong here.`}
			</span>
			{onOpenAbout ? (
				<button type="button" onClick={onOpenAbout} className="earthly-lensbar__action">
					<Info aria-hidden="true" />
					<span>About</span>
				</button>
			) : null}
			{onShare ? (
				<button type="button" onClick={onShare} className="earthly-lensbar__action">
					<Share2 aria-hidden="true" />
					<span>Share app link</span>
				</button>
			) : null}
			<button type="button" onClick={onLeave} className="earthly-lensbar__action">
				<span>Leave</span>
				<X aria-hidden="true" />
			</button>
		</section>
	)
}
