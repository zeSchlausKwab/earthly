import type { MouseEvent, ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'
import squareLogoRose from '@/assets/square_logo_rose.svg'
import { cn } from '@/lib/utils'
import { ActivityTicker, type ActivityTickerItem } from './ActivityTicker'

export interface TopBarAction {
	id: string
	label: string
	ariaLabel?: string
	href?: string
	icon?: ReactNode
	badge?: number | string
	badgeTone?: 'default' | 'warning'
	active?: boolean
	onActivate?: () => void
}

export interface TopBarProps {
	/** Existing search UI is passed through, so its results and keyboard behavior remain intact. */
	search: ReactNode
	activityItems?: readonly ActivityTickerItem[]
	activity?: ReactNode
	/** Custom menu/account controls take precedence over the simple action model. */
	navigation?: ReactNode
	actions?: readonly TopBarAction[]
	brandHref?: string
	brandLabel?: string
	onBrandActivate?: () => void
	className?: string
}

function activateLink(event: MouseEvent<HTMLAnchorElement>, onActivate: (() => void) | undefined) {
	if (!onActivate) return
	event.preventDefault()
	onActivate()
}

export function TopBarActionControl({ action }: { action: TopBarAction }) {
	const content = (
		<>
			{action.icon ? (
				<span className="earthly-topbar__action-icon" aria-hidden="true">
					{action.icon}
				</span>
			) : null}
			<span className="earthly-topbar__action-label">{action.label}</span>
			{action.badge !== undefined && action.badge !== 0 ? (
				<span className="earthly-topbar__badge" data-tone={action.badgeTone ?? 'default'}>
					{action.badge}
				</span>
			) : null}
		</>
	)

	const className = 'earthly-topbar__action'
	const ariaCurrent = action.active ? ('page' as const) : undefined
	if (action.href) {
		return (
			<a
				href={action.href}
				onClick={(event) => activateLink(event, action.onActivate)}
				className={className}
				data-active={action.active || undefined}
				aria-current={ariaCurrent}
				aria-label={action.ariaLabel}
			>
				{content}
			</a>
		)
	}

	return (
		<button
			type="button"
			onClick={action.onActivate}
			disabled={!action.onActivate}
			className={className}
			data-active={action.active || undefined}
			aria-current={ariaCurrent}
			aria-label={action.ariaLabel}
		>
			{content}
		</button>
	)
}

/** The 46px global bar. Its first grid track always shares the Margin width. */
export function TopBar({
	search,
	activityItems = [],
	activity,
	navigation,
	actions = [],
	brandHref = '/',
	brandLabel = 'Earthly',
	onBrandActivate,
	className,
}: TopBarProps) {
	return (
		<header className={cn('earthly-topbar', className)} data-tour="global-topbar">
			<div className="earthly-topbar__lead">
				<a
					href={brandHref}
					onClick={(event) => activateLink(event, onBrandActivate)}
					className="earthly-topbar__brand"
					aria-label={`${brandLabel} home`}
				>
					<img src={squareLogoRose} alt="" className="earthly-topbar__mark" />
					<span>{brandLabel}</span>
				</a>
				{activity ?? <ActivityTicker items={activityItems} />}
			</div>
			<div className="earthly-topbar__search">{search}</div>
			<nav className="earthly-topbar__actions" aria-label="Global navigation">
				{navigation ??
					actions.map((action) => <TopBarActionControl key={action.id} action={action} />)}
				{!navigation && actions.length === 0 ? (
					<a href="/help" className="earthly-topbar__action" aria-label="Help">
						<HelpCircle aria-hidden="true" />
					</a>
				) : null}
			</nav>
		</header>
	)
}
