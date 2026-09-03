import { createContext, type ReactNode, useContext } from 'react'
import type { EarthlyRouteState } from './routeContract'

const RouteStateContext = createContext<EarthlyRouteState | null>(null)

export function EarthlyRouteStateProvider({
	state,
	children,
}: {
	state: EarthlyRouteState
	children: ReactNode
}) {
	return <RouteStateContext.Provider value={state}>{children}</RouteStateContext.Provider>
}

/** Route state shared by desktop, phone, and reader compositions. */
export function useEarthlyRouteState(): EarthlyRouteState {
	const state = useContext(RouteStateContext)
	if (!state) throw new Error('useEarthlyRouteState must be used inside the Earthly router.')
	return state
}
