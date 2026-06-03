import { MessageCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ChatPanel } from '@/features/chat'
import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'

interface AssistantSidebarProps {
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
	geoEvents,
	mapContextEvents,
	availableFeatures,
	getDatasetName,
	onStartNewDataset,
	onSwitchWorkspace,
	onOpenSettings,
	onClose,
}: AssistantSidebarProps) {
	return (
		<aside
			className="hidden h-svh min-w-[20rem] max-w-[32rem] basis-[25vw] shrink-0 flex-col border-l border-border bg-sidebar text-sidebar-foreground md:flex"
			data-tour="assistant-sidebar"
		>
			<header className="flex h-12 shrink-0 items-center justify-between border-b border-sidebar-border px-3">
				<div className="flex min-w-0 items-center gap-2">
					<MessageCircle className="h-4 w-4 shrink-0 text-muted-foreground" />
					<div className="min-w-0">
						<div className="truncate text-sm font-semibold">AI Chat</div>
						<div className="truncate text-[11px] text-muted-foreground">
							Map assistant workspace
						</div>
					</div>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className="h-8 w-8 shrink-0 text-muted-foreground"
					onClick={onClose}
					aria-label="Close AI chat"
					title="Close AI chat"
				>
					<X className="h-4 w-4" />
				</Button>
			</header>
			<div className="min-h-0 flex-1">
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
