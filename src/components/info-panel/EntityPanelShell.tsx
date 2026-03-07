import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type EntityPanelTone = 'dataset' | 'collection' | 'context' | 'neutral' | 'discussion'

const surfaceToneClasses: Record<EntityPanelTone, string> = {
	dataset: 'border-sky-200/80',
	collection: 'border-emerald-200/80',
	context: 'border-amber-200/80',
	neutral: 'border-slate-200',
	discussion: 'border-stone-200 bg-white px-3 py-3',
}

interface EntityPanelShellProps {
	title: string
	tabs?: ReactNode
	children: ReactNode
	className?: string
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
}: EntityPanelShellProps) {
	return (
		<div className={cn('flex h-full flex-col text-sm', className)}>
			<div className="flex-shrink-0 space-y-2 pb-1">
				<h2 className="text-xl font-semibold tracking-[-0.03em] text-slate-950">{title}</h2>
				{tabs}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="space-y-3 pb-3">{children}</div>
			</div>
		</div>
	)
}

export function EntityPanelSurface({
	tone = 'neutral',
	children,
	className,
}: EntityPanelSurfaceProps) {
	return (
		<section
			className={cn(
				tone === 'discussion' ? 'border-t border-stone-200' : 'border-t pt-3',
				surfaceToneClasses[tone],
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
					<div className="text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">
						{eyebrow}
					</div>
				)}
				<h3 className="text-sm font-semibold tracking-[-0.02em] text-slate-950">{title}</h3>
				{description && <p className="text-xs leading-5 text-slate-600">{description}</p>}
			</div>
			{action && <div className="shrink-0">{action}</div>}
		</div>
	)
}
