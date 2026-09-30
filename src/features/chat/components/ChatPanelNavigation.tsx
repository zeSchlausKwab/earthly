import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { DropdownMenu } from '@/components/ui/dropdown-menu'

export type ChatPanelView = 'chat' | 'edit' | 'sources' | 'settings' | 'usage'

export function useChatPanelNavigation(chatId: string | null) {
	const [view, setView] = useState<ChatPanelView>('chat')
	const [menu, setMenu] = useState<string | null>(null)
	const returnFocus = useRef<HTMLElement | null>(null)
	const backRef = useRef<HTMLButtonElement>(null)
	const composerRef = useRef<HTMLTextAreaElement>(null)
	const openView = useCallback(
		(next: ChatPanelView) => {
			if (view === 'chat' && next !== 'chat') {
				returnFocus.current =
					document.activeElement instanceof HTMLElement ? document.activeElement : null
			}
			setMenu(null)
			setView(next)
		},
		[view],
	)
	const previousView = useRef(view)
	useLayoutEffect(() => {
		if (previousView.current === view) return
		if (view === 'chat') {
			const target = returnFocus.current
			;(target?.isConnected && target.getClientRects().length
				? target
				: composerRef.current
			)?.focus({ preventScroll: true })
		} else if (previousView.current === 'chat') backRef.current?.focus({ preventScroll: true })
		previousView.current = view
	}, [view])
	// biome-ignore lint/correctness/useExhaustiveDependencies: a different conversation always starts in its chat view
	useLayoutEffect(() => {
		setView('chat')
		setMenu(null)
	}, [chatId])
	return { view, openView, menu, setMenu, backRef, composerRef }
}

type ChatNavigation = ReturnType<typeof useChatPanelNavigation>
const ChatNavigationContext = createContext<ChatNavigation | null>(null)
export const ChatNavigationProvider = ChatNavigationContext.Provider

export function useChatNavigation() {
	const navigation = useContext(ChatNavigationContext)
	if (!navigation) throw new Error('Chat navigation requires a ChatNavigationProvider')
	return navigation
}

/** A single transient menu can be open anywhere in this chat panel. */
export function ChatMenu({ id, children }: { id: string; children: ReactNode }) {
	const { menu, setMenu } = useChatNavigation()
	return (
		<DropdownMenu
			modal={false}
			open={menu === id}
			onOpenChange={(open) => setMenu((current) => (open ? id : current === id ? null : current))}
		>
			{children}
		</DropdownMenu>
	)
}
