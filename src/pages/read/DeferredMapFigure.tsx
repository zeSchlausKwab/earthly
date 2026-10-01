import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Keep the figure's space while releasing off-screen maps and their WebGL contexts. */
export function DeferredMapFigure({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		if (typeof IntersectionObserver === 'undefined') {
			setVisible(true)
			return
		}
		const node = ref.current
		if (!node) return
		const observer = new IntersectionObserver(
			(entries) => {
				const entry = entries[entries.length - 1]
				if (entry?.target === node) setVisible(entry.isIntersecting)
			},
			{ rootMargin: '240px 0px' },
		)
		observer.observe(node)
		return () => observer.disconnect()
	}, [])
	return (
		<div ref={ref} className="earthly-reader__figure-map" data-figure-initialized={visible}>
			{visible ? (
				children
			) : (
				<div className="flex h-full items-center justify-center border border-border bg-muted/30 text-xs text-muted-foreground">
					Map figure · loads as you read
				</div>
			)}
		</div>
	)
}
