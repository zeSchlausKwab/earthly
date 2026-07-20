import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const MobilePanelHeaderActionContext = createContext<HTMLElement | null>(null)

export function MobilePanelHeaderActionProvider({
	target,
	children,
}: {
	target: HTMLElement | null
	children: ReactNode
}) {
	return (
		<MobilePanelHeaderActionContext.Provider value={target}>
			{children}
		</MobilePanelHeaderActionContext.Provider>
	)
}

/**
 * Editors own their submit state; the mobile sheet only supplies a persistent
 * place to render that action. A null target means the editor is on desktop or
 * is not currently hosted by the mobile inspection sheet.
 */
export function useMobilePanelHeaderActionTarget(): HTMLElement | null {
	return useContext(MobilePanelHeaderActionContext)
}

export function MobilePanelHeaderActions({ children }: { children: ReactNode }) {
	const target = useMobilePanelHeaderActionTarget()
	return target ? createPortal(children, target) : null
}
