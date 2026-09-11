import { ChevronLeft, X } from 'lucide-react'
import { useId, useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '../ui/button'
import { useMobileObjectNavigation } from './MobileObjectNavigation'

/** The inspect header stays put while Details, Comments, and Thread change below it. */
export function ObjectInspectLayout({
	kind,
	title,
	state,
	author,
	meta,
	actions,
	social,
	tabs,
	onBack,
	contained = false,
	children,
}: {
	kind: string
	title: string
	state: ReactNode
	author: ReactNode
	meta?: ReactNode
	actions: ReactNode
	social?: ReactNode
	tabs: ReactNode
	onBack?: () => void
	/** The child owns scrolling, e.g. a discussion with a docked composer. */
	contained?: boolean
	children: ReactNode
}) {
	const mobileNavigation = useMobileObjectNavigation()
	const headingRef = useRef<HTMLHeadingElement>(null)
	useEffect(() => {
		// A removed Browse row leaves focus on body. Announce the new object,
		// without stealing focus from a live input during background updates.
		if (document.activeElement === document.body) headingRef.current?.focus({ preventScroll: true })
	}, [kind, title])
	const contentContained = contained || mobileNavigation?.activeTab === 'thread'
	return (
		<section className="flex h-full min-h-0 flex-col text-sm" aria-label={`${kind} inspection`}>
			<header className="shrink-0 space-y-2 pb-2">
				<div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
					{onBack && (
						<Button
							variant="ghost"
							size="sm"
							onClick={onBack}
							className="min-h-11 shrink-0 gap-1 px-0 md:min-h-0"
						>
							<ChevronLeft className="size-3.5" aria-hidden="true" /> Back
						</Button>
					)}
					<span className="shrink-0 font-mono text-[10px] uppercase tracking-widest">{kind}</span>
					<span className="min-w-0 truncate border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[10px]">
						{state}
					</span>
					<div className="ml-auto flex shrink-0 items-center">
						{mobileNavigation?.headerActions}
					</div>
					{(mobileNavigation || onBack) && (
						<Button
							variant="ghost"
							size="icon-sm"
							onClick={mobileNavigation?.onClose ?? onBack}
							aria-label="Close inspection"
							className="size-11 shrink-0 md:size-8"
						>
							<X className="size-3.5" aria-hidden="true" />
						</Button>
					)}
				</div>
				<h2 ref={headingRef} tabIndex={-1} className="break-words text-lg font-semibold leading-tight tracking-[-0.025em] focus-visible:outline-2 focus-visible:outline-primary md:text-xl">
					{title}
				</h2>
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
					<div className="flex min-w-0 items-center gap-1.5 text-xs">
						{author}
						{meta && <span className="text-muted-foreground">· {meta}</span>}
					</div>
					<div className="flex flex-wrap items-center gap-1.5">{actions}</div>
				</div>
				{social && <div className="border-t border-border pt-1.5">{social}</div>}
			</header>
			<div className="shrink-0">{tabs}</div>
			<div
				className={cn(
					'min-h-0 flex-1',
					contentContained ? 'overflow-hidden' : 'overflow-y-auto [scrollbar-gutter:stable]',
				)}
			>
				<div className={contentContained ? 'h-full min-h-0' : 'space-y-3 py-3 pr-1'}>
					{children}
				</div>
			</div>
		</section>
	)
}

/** Compact, bordered detail box from the Margin sketch. */
export function ObjectDetailsSection({
	title,
	count,
	hint,
	children,
	className,
}: {
	title: string
	count?: number
	hint?: ReactNode
	children: ReactNode
	className?: string
}) {
	const titleId = useId()
	return (
		<section aria-labelledby={titleId} className={cn('border border-border', className)}>
			<div className="flex items-center gap-2 border-b border-border bg-muted/50 px-2.5 py-1.5">
				<h3 id={titleId} className="font-mono text-[10px] font-medium uppercase tracking-[0.14em]">
					{title}
				</h3>
				{count !== undefined && (
					<span className="border border-border px-1 font-mono text-[10px] text-muted-foreground">
						{count}
					</span>
				)}
				{hint && <span className="ml-auto text-[10px] text-muted-foreground">{hint}</span>}
			</div>
			<div className="p-2.5">{children}</div>
		</section>
	)
}
