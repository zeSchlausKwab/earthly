import { lazy, Suspense, type ReactNode } from 'react'

/** Optional surfaces load on first render, while the shell and map remain usable. */
export function deferredSurface<P extends object>(load: () => Promise<{ default: (props: P) => ReactNode }>, label: string) {
	const Surface = lazy(load)
	return function DeferredSurface(props: P) {
		return <Suspense fallback={<div role="status" className="p-3 text-xs text-muted-foreground">Loading {label}…</div>}><Surface {...props} /></Suspense>
	}
}
