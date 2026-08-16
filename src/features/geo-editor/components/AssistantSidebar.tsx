import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { ChatPanel } from '@/features/chat/ChatPanel'
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
	onOpenAuthoringTarget: () => void
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
	return (
		<aside
			className={cn(
				// Slide like the left sidebar: animate width, clip the fixed-width
				// inner so the content doesn't reflow mid-transition.
				'hidden shrink-0 flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-linear md:flex',
				// Inset between the docked top bar and bottom status bar — dims from the
				// shared --shell-* layout knobs (styles/globals.css).
				'md:mt-[var(--shell-toolbar-h)] md:mb-[var(--shell-statusbar-h)] md:h-[calc(100svh-var(--shell-toolbar-h)-var(--shell-statusbar-h))]',
				open
					? 'w-[var(--shell-chat-w)] min-w-[var(--shell-chat-w-min)] max-w-[var(--shell-chat-w-max)] border-l'
					: 'w-0 border-l-0',
			)}
			data-tour="assistant-sidebar"
			aria-hidden={!open}
		>
			<div className="flex h-full w-[var(--shell-chat-w)] min-w-[var(--shell-chat-w-min)] max-w-[var(--shell-chat-w-max)] min-h-0 flex-col">
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
