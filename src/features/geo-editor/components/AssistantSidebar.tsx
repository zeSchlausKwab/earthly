import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { ChatPanel } from '@/features/chat'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { cn } from '@/lib/utils'

interface AssistantSidebarProps {
	/** When false, the panel slides shut (width → 0) but stays mounted so the
	 *  transition — and the chat session — are preserved. */
	open: boolean
	geoEvents: GeoDataset[]
	mapContextEvents: MapContext[]
	availableFeatures: GeoFeatureItem[]
	getDatasetName: (event: GeoDataset) => string
	onStartNewDataset: () => void
	onSwitchWorkspace: (workspaceId: string) => void
	onOpenSettings: () => void
	onClose: () => void
}

export function AssistantSidebar({
	open,
	geoEvents,
	mapContextEvents,
	availableFeatures,
	getDatasetName,
	onStartNewDataset,
	onSwitchWorkspace,
	onOpenSettings,
}: AssistantSidebarProps) {
	return (
		<aside
			className={cn(
				// Slide like the left sidebar: animate width, clip the fixed-width
				// inner so the content doesn't reflow mid-transition.
				'hidden shrink-0 flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear md:flex',
				// Inset between the docked top bar (44px) and bottom status bar (23px).
				'md:mt-[44px] md:mb-[23px] md:h-[calc(100svh-67px)]',
				open ? 'w-[25vw] min-w-[20rem] max-w-[32rem] border-l' : 'w-0 border-l-0',
			)}
			data-tour="assistant-sidebar"
			aria-hidden={!open}
		>
			<div className="flex h-full w-[25vw] min-w-[20rem] max-w-[32rem] min-h-0 flex-col">
				<ChatPanel
					geoEvents={geoEvents}
					mapContextEvents={mapContextEvents}
					availableFeatures={availableFeatures}
					getDatasetName={getDatasetName}
					onStartNewDataset={onStartNewDataset}
					onSwitchWorkspace={onSwitchWorkspace}
					onOpenSettings={onOpenSettings}
				/>
			</div>
		</aside>
	)
}
