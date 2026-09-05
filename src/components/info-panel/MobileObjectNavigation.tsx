import { createContext, useContext, type ReactNode } from 'react'
import type { EarthlyObjectTab } from '@/router/routeContract'

/** Phone-only composition slots; object state and the Thread still belong to the route. */
export interface MobileObjectNavigation {
	headerActions?: ReactNode
	onClose: () => void
	activeTab: EarthlyObjectTab
	threadContent?: ReactNode
	threadWorking?: boolean
	onExpandComposer?: () => void
}

export const MobileObjectNavigationContext = createContext<MobileObjectNavigation | null>(null)
export const useMobileObjectNavigation = () => useContext(MobileObjectNavigationContext)
