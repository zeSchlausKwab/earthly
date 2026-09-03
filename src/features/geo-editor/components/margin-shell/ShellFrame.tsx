import type { ReactNode, RefObject } from 'react'
import { cn } from '@/lib/utils'

export interface ShellFrameProps {
	topBar: ReactNode
	banners?: ReactNode
	margin: ReactNode
	canvas: ReactNode
	thread?: ReactNode
	threadOpen: boolean
	threadDock: 'left' | 'right'
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
				<div className="earthly-shell-frame__margin">{margin}</div>
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
	return (
		<main
			className="earthly-canvas-frame"
			aria-label="Map canvas"
			data-has-shelf
			data-has-status={Boolean(status) || undefined}
		>
			<div ref={containerRef} data-tour="map-canvas" className="earthly-canvas-frame__map">
				{children}
			</div>
			{toolbar ? <div className="earthly-canvas-frame__toolbar">{toolbar}</div> : null}
			{status ? <div className="earthly-canvas-frame__status">{status}</div> : null}
			<div className="earthly-canvas-frame__shelf">{shelf}</div>
		</main>
	)
}
