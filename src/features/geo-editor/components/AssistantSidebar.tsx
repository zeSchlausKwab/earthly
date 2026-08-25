import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { ChatPanel } from '@/features/chat/ChatPanel'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { cn } from '@/lib/utils'
import { useEditorStore } from '../store'

interface AssistantSidebarProps {
	/** When false, the panel slides shut (width → 0) but stays mounted so the
	 *  transition — and the chat session — are preserved. */
	open: boolean
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	availableFeatures: GeoFeatureItem[]
	getDatasetName: (event: GeoDataset) => string
	onOpenAuthoringTarget: (workspaceId: string) => void
	onOpenSettings: () => void
	onClose: () => void
}

export function AssistantSidebar({
	open,
	geoEvents,
	mapContextEvents,
	availableFeatures,
	getDatasetName,
	onOpenAuthoringTarget,
	onOpenSettings,
}: AssistantSidebarProps) {
	const dock = useEditorStore((state) => state.chatDock)
	const dockedLeft = dock === 'left'

	return (
		<aside
			className={cn(
				// The ONE Chat tree changes only its CSS placement. Keeping this node
				// mounted preserves the composer, scroll position, approvals and run UI.
				'hidden flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground transition-[width,left,right] duration-200 ease-linear md:flex',
				dockedLeft
					? [
							// Cover the existing sidebar content column, never the icon rail and
							// never an additional slice of the map.
							'fixed top-[var(--shell-toolbar-h)] bottom-[var(--shell-statusbar-h)] left-[var(--sidebar-width-icon)] z-20 h-auto min-w-0 max-w-none border-r',
							open ? 'w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]' : 'w-0 border-r-0',
						]
					: [
							'shrink-0 md:mt-[var(--shell-toolbar-h)] md:mb-[var(--shell-statusbar-h)] md:h-[calc(100svh-var(--shell-toolbar-h)-var(--shell-statusbar-h))]',
							open
								? 'w-[var(--shell-chat-w)] min-w-[var(--shell-chat-w-min)] max-w-[var(--shell-chat-w-max)] border-l'
								: 'w-0 border-l-0',
						],
			)}
			data-tour="assistant-sidebar"
			data-side={dock}
			aria-hidden={!open}
			inert={!open ? true : undefined}
		>
			<div
				className={cn(
					'flex h-full min-h-0 flex-col',
					dockedLeft
						? 'w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))] min-w-0 max-w-none'
						: 'w-[var(--shell-chat-w)] min-w-[var(--shell-chat-w-min)] max-w-[var(--shell-chat-w-max)]',
				)}
			>
				<ChatPanel
					geoEvents={geoEvents}
					mapContextEvents={mapContextEvents}
					availableFeatures={availableFeatures}
					getDatasetName={getDatasetName}
					onOpenAuthoringTarget={onOpenAuthoringTarget}
					onOpenSettings={onOpenSettings}
				/>
			</div>
		</aside>
	)
}
