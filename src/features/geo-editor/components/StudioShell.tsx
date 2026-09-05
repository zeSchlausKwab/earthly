/**
 * StudioShell is Earthly's single application composition root.
 *
 * Domain surfaces arrive as slots; this component only owns their placement.
 * That keeps the existing toolbar, Margin panels, Thread, mobile controls and
 * map overlays mounted while the layout changes around them.
 */

import type { ReactNode, RefObject } from 'react'
import { ObjectThreadBesideContext } from '../../../components/info-panel/ObjectThreadPlacement.tsx'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { useEditorStore } from '../store'
import { CanvasFrame, ShellFrame } from './margin-shell'

export interface StudioShellProps {
	/** The active object/catalog surface. Use `<AppSidebar layout="margin" />`. */
	sidebar: ReactNode
	/** Existing map instrument status. It sits just above the Shelf. */
	statusBar?: ReactNode
	/** Existing single mounted Chat tree; retained as the compatibility prop name. */
	chat?: ReactNode
	/** Preferred semantic alias for `chat` in new integrations. */
	thread?: ReactNode
	/** Route-owned Thread visibility. Falls back to the legacy editor-store flag. */
	threadOpen?: boolean
	/** The map container ref — overlays/popups/magnifier measure against it. */
	mapContainerRef: RefObject<HTMLDivElement | null>
	/** Map, map-owned overlays, dialogs, and the existing mobile composition. */
	children: ReactNode
	/** Global 46px application bar (`TopBar`). Required by the production frame. */
	topBar: ReactNode
	/** Lens/live/offline bars. Each surface owns its own height. */
	banners?: ReactNode
	/** Existing desktop toolbar, positioned as a canvas overlay when provided. */
	canvasToolbar?: ReactNode
	/** The always-present 42px `ShelfStrip`. */
	shelf: ReactNode
	/** Optional phone-only slots. Existing MobilePanel controls can remain in children. */
	mobileTop?: ReactNode
	mobileMargin?: ReactNode
	mobileDock?: ReactNode
	/** "See the map through panels" presentation; ownership remains with the host setting. */
	translucent?: boolean
	className?: string
}

export function StudioShell({
	sidebar,
	statusBar,
	chat,
	thread,
	threadOpen: threadOpenOverride,
	mapContainerRef,
	children,
	topBar,
	banners,
	canvasToolbar,
	shelf,
	mobileTop,
	mobileMargin,
	mobileDock,
	translucent = false,
	className,
}: StudioShellProps) {
	const storedThreadOpen = useEditorStore((state) => state.chatOpen)
	const storedThreadDock = useEditorStore((state) => state.chatDock)
	const threadOpen = threadOpenOverride ?? storedThreadOpen
	const threadDock = storedThreadDock
	const compact = useIsMobile(1100)

	return (
		<ShellFrame
			className={className}
			translucent={translucent}
			topBar={topBar}
			banners={banners}
			margin={
				<ObjectThreadBesideContext.Provider
					value={threadOpen && threadDock === 'right' && !compact}
				>
					{sidebar}
				</ObjectThreadBesideContext.Provider>
			}
			thread={thread ?? chat}
			threadOpen={threadOpen}
			threadDock={threadDock}
			marginCovered={threadOpen && (threadDock === 'left' || compact)}
			mobileTop={mobileTop}
			mobileMargin={mobileMargin}
			mobileDock={mobileDock}
			canvas={
				<CanvasFrame
					containerRef={mapContainerRef}
					toolbar={canvasToolbar}
					status={statusBar}
					shelf={shelf}
				>
					{children}
				</CanvasFrame>
			}
		/>
	)
}
