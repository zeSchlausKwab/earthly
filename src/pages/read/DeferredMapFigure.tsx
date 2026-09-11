import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Reserve the figure's space, but don't allocate a WebGL context below the fold. */
export function DeferredMapFigure({ children }: { children: ReactNode }) {
	const ref = useRef<HTMLDivElement>(null)
	const [visible, setVisible] = useState(false)
	useEffect(() => {
		if (visible) return
		if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
		const node = ref.current
		if (!node) return
		const observer = new IntersectionObserver((entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return
			setVisible(true)
			observer.disconnect()
		}, { rootMargin: '240px 0px' })
		observer.observe(node)
		return () => observer.disconnect()
	}, [visible])
	return (
		<div ref={ref} className="earthly-reader__figure-map" data-figure-initialized={visible}>
			{visible ? children : <div className="flex h-full items-center justify-center border border-border bg-muted/30 text-xs text-muted-foreground">Map figure · loads as you read</div>}
		</div>
	)
}
