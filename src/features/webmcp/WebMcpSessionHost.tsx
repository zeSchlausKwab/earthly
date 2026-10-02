import { lazy, Suspense, useEffect, useState } from 'react'
import { getModelContext } from './platform'
import { useWebMcpStore } from './state'

const LazyRuntimeHost = lazy(() =>
	import('./WebMcpRuntimeHost').then((module) => ({ default: module.WebMcpRuntimeHost })),
)

/** Load the service only when usable, then retain its tab session across routes. */
export function WebMcpSessionHost() {
	const enabled = useWebMcpStore((state) => state.enabled)
	const supported = typeof document !== 'undefined' && getModelContext() !== null
	const [activated, setActivated] = useState(supported && enabled)
	useEffect(() => {
		if (!supported) {
			useWebMcpStore.setState({ status: 'unsupported', toolCount: 0 })
		} else if (!activated) {
			if (enabled) setActivated(true)
			else useWebMcpStore.setState({ status: 'off', toolCount: 0 })
		}
	}, [supported, enabled, activated])
	// Once loaded, the runtime handles registration teardown, reviews and activity
	// even while access is off. Disabling must not discard that cleanup boundary.
	return activated ? (
		<Suspense fallback={null}>
			<LazyRuntimeHost />
		</Suspense>
	) : null
}
