import { useCallback, useEffect, useRef } from 'react'
import { useEditorStore } from '../store'
import { navigateToRoute, type RouteState } from './useRouting'

/** Routes can open a conversation; only an explicit close dismisses desktop chat. */
export function useDesktopThread(route: RouteState, isMobile: boolean) {
	const open = useEditorStore((state) => state.chatOpen)
	const ask = route.sidebarView === 'chat'
	const requested = ask || route.tab === 'thread'
	const previousAsk = useRef(false)
	useEffect(() => {
		if (!isMobile && requested) {
			const state = useEditorStore.getState()
			if (ask && !previousAsk.current) state.setChatDock('left')
			state.setChatOpen(true)
		}
		previousAsk.current = ask
	}, [ask, requested, isMobile])
	const close = useCallback(() => {
		useEditorStore.getState().setChatOpen(false)
		const url = new URL(window.location.href)
		if (url.pathname === '/ask') {
			url.pathname = '/browse/maps'
			url.searchParams.delete('q')
		}
		if (url.searchParams.get('tab') === 'thread') url.searchParams.delete('tab')
		navigateToRoute(`${url.pathname}${url.search}${url.hash}`, { preserveThread: false })
	}, [])
	return { open: !isMobile && open, close }
}
