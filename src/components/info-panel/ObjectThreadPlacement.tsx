import { createContext, useContext, useEffect, useRef } from 'react'
import type { EarthlyObjectTab } from '@/router/routeContract'

/** Placement belongs to the shell; entity panels do not duplicate breakpoint logic. */
export const ObjectThreadBesideContext = createContext(false)

export function useObjectContentTab(tab: EarthlyObjectTab): EarthlyObjectTab {
	const beside = useContext(ObjectThreadBesideContext)
	const previous = useRef<EarthlyObjectTab>('details')
	useEffect(() => { if (tab !== 'thread') previous.current = tab }, [tab])
	return beside && tab === 'thread' ? previous.current : tab
}
