import { type ReactNode, useContext } from 'react'
import { PanelTranslucencyContext } from '@/components/PanelTranslucencyContext'
import { cn } from '@/lib/utils'
import { useMobileObjectNavigation } from './MobileObjectNavigation'

type EntityPanelTone = 'dataset' | 'collection' | 'context' | 'neutral' | 'discussion'

const surfaceToneClasses: Record<EntityPanelTone, string> = {
	dataset: 'border-info/40',
	collection: 'border-ok/40',
	context: 'border-primary/40',
	neutral: 'border-border',
	discussion: 'border-border bg-card px-3 py-3',
}

interface EntityPanelShellProps {
	title: string
	tabs?: ReactNode
	children: ReactNode
	className?: string
	/** Let a child such as Comments own its list/composer scroll boundaries. */
	contained?: boolean
}

interface EntityPanelSurfaceProps {
	tone?: EntityPanelTone
	children: ReactNode
	className?: string
}

interface EntityPanelSectionHeaderProps {
	eyebrow?: string
	title: string
	description?: string
	action?: ReactNode
	className?: string
}

export function EntityPanelShell({
	title,
	tabs,
	children,
	className,
	contained = false,
}: EntityPanelShellProps) {
	const mobileNavigation = useMobileObjectNavigation()
	const contentContained = contained || mobileNavigation?.activeTab === 'thread'
	return (
		<div className={cn('flex h-full min-h-0 flex-col text-sm', className)}>
			<div className="flex-shrink-0 space-y-2 pb-1">
				<h2 className="text-xl font-semibold tracking-[-0.03em] text-foreground">{title}</h2>
				{tabs}
			</div>

			{/* `scrollbar-gutter: stable` reserves the scrollbar track so the (often
			    overlay) scrollbar never paints on top of the panel content. */}
			<div
				className={cn(
					'min-h-0 flex-1',
					contentContained ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]',
				)}
			>
				<div className={contentContained ? 'h-full min-h-0' : 'space-y-3 pb-3 pr-1'}>
					{children}
				</div>
			</div>
		</div>
	)
}

export function EntityPanelSurface({
	tone = 'neutral',
	children,
	className,
}: EntityPanelSurfaceProps) {
	const translucent = useContext(PanelTranslucencyContext)
	return (
		<section
			className={cn(
				tone === 'discussion' ? 'border-t border-border' : 'border-t pt-3',
				surfaceToneClasses[tone],
				tone === 'discussion' && translucent && 'bg-transparent',
				className,
			)}
		>
			{children}
		</section>
	)
}

export function EntityPanelSectionHeader({
	eyebrow,
	title,
	description,
	action,
	className,
}: EntityPanelSectionHeaderProps) {
	return (
		<div className={cn('flex items-start justify-between gap-3', className)}>
			<div className="space-y-1">
				{eyebrow && (
					<div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
						{eyebrow}
					</div>
				)}
				<h3 className="text-sm font-semibold tracking-[-0.02em] text-foreground">{title}</h3>
				{description && <p className="text-xs leading-5 text-muted-foreground">{description}</p>}
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	)
}
