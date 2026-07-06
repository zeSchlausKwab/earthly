/**
 * StudioShell — the single responsive layout frame for the geo editor.
 *
 * It owns the desktop skeleton ("The skeleton, three widths", redesign §15a):
 * the left panel (navigator + active panel), the map with its floating Map Stack
 * and controls, the right chat, and the bottom status bar. All of its dimensions
 * come from the `--shell-*` CSS variables in `styles/globals.css`, so the widths
 * and insets are tweakable in ONE place instead of being scattered across a
 * 3000-line orchestration component.
 *
 * The map-container contents (the map itself, its overlays, the toolbar, the
 * floating Map Stack, and the mobile sheet + controls) are passed as `children`
 * — those are the editor's domain. The shell only arranges the frame around them
 * and flips between the desktop columns and the mobile (map + one sheet) layout.
 */

import type { CSSProperties, ReactNode, RefObject } from 'react'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useEditorStore } from '../store'

interface StudioShellProps {
	/** Left panel — the AppSidebar (rendered desktop-only). */
	sidebar: ReactNode
	/** Bottom status bar (desktop-only). */
	statusBar: ReactNode
	/** Right chat / assistant panel (desktop-only; self-manages its open width). */
	chat: ReactNode
	/** The map container ref — overlays/popups/magnifier measure against it. */
	mapContainerRef: RefObject<HTMLDivElement | null>
	/** Everything inside the map container: the map, its overlays, the toolbar,
	 *  the floating Map Stack, and (on mobile) the sheet + floating controls. */
	children: ReactNode
}

export function StudioShell({
	sidebar,
	statusBar,
	chat,
	mapContainerRef,
	children,
}: StudioShellProps) {
	const isMobile = useIsMobile()
	const sidebarExpanded = useEditorStore((state) => state.sidebarExpanded)
	const setSidebarExpanded = useEditorStore((state) => state.setSidebarExpanded)

	// Every dimension is a --shell-* CSS var (globals.css). Only the expanded/default
	// width choice and the mobile/desktop branch are decided here in JS.
	const shellStyle = isMobile
		? undefined
		: ({
				'--sidebar-width': sidebarExpanded
					? 'var(--shell-sidebar-w-expanded)'
					: 'var(--shell-sidebar-w)',
				// Keep the fixed sidebar between the docked top bar and the status bar.
				'--sidebar-inset-top': 'var(--shell-toolbar-h)',
				'--sidebar-inset-bottom': 'var(--shell-statusbar-h)',
			} as CSSProperties)

	return (
		<SidebarProvider
			sidebarExpanded={sidebarExpanded}
			onExpandedChange={setSidebarExpanded}
			style={shellStyle}
		>
			{!isMobile && sidebar}

			<SidebarInset>
				<div
					ref={mapContainerRef}
					data-tour="map-canvas"
					className="relative w-full"
					style={
						isMobile
							? { height: '100dvh', minHeight: '100svh' }
							: {
									// Reserve the status-bar band so the map + its floating panels
									// sit above the footer instead of behind it.
									height: 'calc(100dvh - var(--shell-statusbar-h))',
									minHeight: 'calc(100svh - var(--shell-statusbar-h))',
								}
					}
				>
					{children}
				</div>
			</SidebarInset>

			{!isMobile && <div className="fixed right-0 bottom-0 left-0 z-30">{statusBar}</div>}
			{!isMobile && chat}
		</SidebarProvider>
	)
}
