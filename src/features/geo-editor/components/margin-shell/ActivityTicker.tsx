import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Pause, Play } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActivityTickerItem {
	/** Stable identity. Changing it is what restarts the ticker presentation. */
	id: string
	actor: string
	verb: string
	title: string
	ageLabel: string
	icon: ReactNode
	/** Live records sort ahead of dated activity and use a pulse marker. */
	live?: boolean
	href?: string
	onActivate?: () => void
}

export interface ActivityTickerProps {
	items: readonly ActivityTickerItem[]
	intervalMs?: number
	className?: string
}

function activitySignature(items: readonly ActivityTickerItem[]): string {
	return items
		.map(
			(item) =>
				`${item.id}:${item.actor}:${item.verb}:${item.title}:${item.ageLabel}:${item.live ? 1 : 0}:${item.href ?? ''}`,
		)
		.join('\u0000')
}

/**
 * A compact, intentionally quiet public-activity instrument.
 *
 * The timer keys off the semantic item signature instead of the array identity,
 * so ordinary parent renders do not restart the 4.2 second cadence. Hover,
 * keyboard focus, and a hidden document all pause rotation.
 */
export function ActivityTicker({ items, intervalMs = 4_200, className }: ActivityTickerProps) {
	const tickerItems = [
		...items.filter((item) => item.live),
		...items.filter((item) => !item.live),
	].slice(0, 8)
	const signature = activitySignature(tickerItems)
	const [activeIndex, setActiveIndex] = useState(0)
	const [pointerPaused, setPointerPaused] = useState(false)
	const [focusPaused, setFocusPaused] = useState(false)
	const [manuallyPaused, setManuallyPaused] = useState(false)
	const [motionOptIn, setMotionOptIn] = useState(false)
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(
		typeof window !== 'undefined' &&
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(prefers-reduced-motion: reduce)').matches,
	)
	const [documentHidden, setDocumentHidden] = useState(
		typeof document !== 'undefined' ? document.hidden : false,
	)
	const rotationPaused = manuallyPaused || (prefersReducedMotion && !motionOptIn)

	// A changed feed starts at its newest item. A same-value array does not.
	// biome-ignore lint/correctness/useExhaustiveDependencies: signature deliberately represents item semantics
	useEffect(() => setActiveIndex(0), [signature])

	useEffect(() => {
		if (typeof document === 'undefined') return
		const handleVisibilityChange = () => setDocumentHidden(document.hidden)
		document.addEventListener('visibilitychange', handleVisibilityChange)
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
	}, [])

	useEffect(() => {
		if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
		const query = window.matchMedia('(prefers-reduced-motion: reduce)')
		const handleMotionPreference = (event: MediaQueryListEvent) => {
			setPrefersReducedMotion(event.matches)
			if (event.matches) setMotionOptIn(false)
		}
		query.addEventListener('change', handleMotionPreference)
		return () => query.removeEventListener('change', handleMotionPreference)
	}, [])

	useEffect(() => {
		// Restart the cadence only when semantic feed content changes.
		void signature
		if (tickerItems.length < 2 || pointerPaused || focusPaused || documentHidden || rotationPaused)
			return
		const timer = window.setInterval(() => {
			setActiveIndex((index) => (index + 1) % tickerItems.length)
		}, intervalMs)
		return () => window.clearInterval(timer)
	}, [
		tickerItems.length,
		intervalMs,
		pointerPaused,
		focusPaused,
		documentHidden,
		rotationPaused,
		signature,
	])

	const currentIndex = activeIndex % Math.max(tickerItems.length, 1)
	const current = tickerItems[currentIndex]
	const positionLabel =
		tickerItems.length > 0 ? `${currentIndex + 1} of ${tickerItems.length}` : 'No recent activity'

	if (!current) {
		return (
			<section
				className={cn('earthly-activity-ticker', className)}
				aria-label="Recent Earthly activity"
			>
				<span className="earthly-activity-ticker__empty">Listening for activity</span>
			</section>
		)
	}

	const content = (
		<>
			<span className="earthly-activity-ticker__glyph" aria-hidden="true">
				{current.icon}
			</span>
			<span className="earthly-activity-ticker__actor">{current.actor}</span>
			<span className="earthly-activity-ticker__verb">{current.verb}</span>
			<span className="earthly-activity-ticker__title">{current.title}</span>
			<span className="earthly-activity-ticker__age">
				{current.live ? 'now' : current.ageLabel}
			</span>
		</>
	)

	return (
		<section
			className={cn('earthly-activity-ticker', className)}
			onPointerEnter={() => setPointerPaused(true)}
			onPointerLeave={() => setPointerPaused(false)}
			onFocusCapture={() => setFocusPaused(true)}
			onBlurCapture={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) setFocusPaused(false)
			}}
			aria-label="Recent Earthly activity"
		>
			<span
				className={cn('earthly-activity-ticker__pulse', current.live && 'is-live')}
				aria-hidden="true"
			/>
			{current.href ? (
				<a
					key={`${signature}:${currentIndex}`}
					href={current.href}
					onClick={(event) => {
						if (!current.onActivate) return
						event.preventDefault()
						current.onActivate()
					}}
					className="earthly-activity-ticker__item"
					aria-label={`${current.actor} ${current.verb} ${current.title}, ${
						current.live ? 'now' : current.ageLabel
					}`}
				>
					{content}
				</a>
			) : (
				<button
					key={`${signature}:${currentIndex}`}
					type="button"
					onClick={current.onActivate}
					disabled={!current.onActivate}
					className="earthly-activity-ticker__item"
					aria-label={`${current.actor} ${current.verb} ${current.title}, ${
						current.live ? 'now' : current.ageLabel
					}`}
				>
					{content}
				</button>
			)}
			<button
				type="button"
				className="earthly-activity-ticker__pause"
				onClick={() => {
					if (rotationPaused) {
						setManuallyPaused(false)
						setMotionOptIn(true)
					} else {
						setManuallyPaused(true)
					}
				}}
				aria-label={rotationPaused ? 'Resume activity ticker' : 'Pause activity ticker'}
				aria-pressed={rotationPaused}
			>
				{rotationPaused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
			</button>
			<span className="sr-only" aria-live={rotationPaused ? 'off' : 'polite'}>
				{`${current.actor} ${current.verb} ${current.title}, ${
					current.live ? 'now' : current.ageLabel
				}. ${positionLabel}`}
			</span>
			<span className="earthly-activity-ticker__dots" aria-hidden="true">
				{tickerItems.map((item, index) => (
					<span key={item.id} data-active={index === currentIndex || undefined} />
				))}
			</span>
		</section>
	)
}
