import { useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { cn } from '@/lib/utils'

export interface ShellFrameProps {
	topBar: ReactNode
	banners?: ReactNode
	margin: ReactNode
	canvas: ReactNode
	thread?: ReactNode
	threadOpen: boolean
	threadDock: 'left' | 'right'
	marginCovered?: boolean
	mobileTop?: ReactNode
	mobileMargin?: ReactNode
	mobileDock?: ReactNode
	translucent?: boolean
	className?: string
}

export function ShellFrame({
	topBar,
	banners,
	margin,
	canvas,
	thread,
	threadOpen,
	threadDock,
	marginCovered = false,
	mobileTop,
	mobileMargin,
	mobileDock,
	translucent = false,
	className,
}: ShellFrameProps) {
	return (
		<div
			className={cn('earthly-shell-frame', className)}
			data-thread-open={threadOpen || undefined}
			data-thread-dock={threadDock}
			data-translucent={translucent || undefined}
		>
			<div className="earthly-shell-frame__top">{topBar}</div>
			{banners ? <div className="earthly-shell-frame__banners">{banners}</div> : null}
			<div className="earthly-shell-frame__stage">
				<div
					className="earthly-shell-frame__margin"
					aria-hidden={marginCovered || undefined}
					inert={marginCovered || undefined}
				>
					{margin}
				</div>
				{canvas}
				<section
					className="earthly-shell-frame__thread"
					aria-label="Thread"
					aria-hidden={!threadOpen}
					inert={!threadOpen ? true : undefined}
				>
					{thread}
				</section>
			</div>
			{mobileTop ? <div className="earthly-shell-frame__mobile-top">{mobileTop}</div> : null}
			{mobileMargin ? (
				<div className="earthly-shell-frame__mobile-margin">{mobileMargin}</div>
			) : null}
			{mobileDock ? <div className="earthly-shell-frame__mobile-dock">{mobileDock}</div> : null}
		</div>
	)
}

export interface CanvasFrameProps {
	containerRef: RefObject<HTMLDivElement | null>
	children: ReactNode
	toolbar?: ReactNode
	status?: ReactNode
	shelf: ReactNode
}

export function CanvasFrame({ containerRef, children, toolbar, status, shelf }: CanvasFrameProps) {
	const frameRef = useRef<HTMLElement | null>(null)
	const toolbarRef = useRef<HTMLDivElement | null>(null)
	const hasToolbar = Boolean(toolbar)
	useEffect(() => {
		const frame = frameRef.current
		const bar = toolbarRef.current
		if (!frame || !bar) return
		const measure = () =>
			frame.style.setProperty(
				'--canvas-toolbar-clearance',
				`${bar.offsetTop + bar.offsetHeight + 12}px`,
			)
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(bar)
		return () => {
			observer.disconnect()
			frame.style.removeProperty('--canvas-toolbar-clearance')
		}
	}, [hasToolbar])
	return (
		<main
			ref={frameRef}
			className="earthly-canvas-frame"
			aria-label="Map canvas"
			data-has-shelf
			data-has-status={Boolean(status) || undefined}
		>
			<div ref={containerRef} data-tour="map-canvas" className="earthly-canvas-frame__map">
				{children}
			</div>
			{toolbar ? (
				<div ref={toolbarRef} className="earthly-canvas-frame__toolbar">
					{toolbar}
				</div>
			) : null}
			{status ? <div className="earthly-canvas-frame__status">{status}</div> : null}
			<div className="earthly-canvas-frame__shelf">{shelf}</div>
		</main>
	)
}
