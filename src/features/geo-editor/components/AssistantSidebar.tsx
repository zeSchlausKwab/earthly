import type { GeoFeatureItem } from '@/components/editor/GeoRichTextEditor'
import { useEffect, useState } from 'react'
import { useIsMobile } from '@/lib/hooks/useIsMobile'
import { ChatPanel } from '@/features/chat/DeferredChatPanel.tsx'
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
	onOpenSettings: () => void
	onClose: () => void
	onEnsureAuthoringTarget?: () => Promise<string | null>
	authoringActionLabel?: 'Send' | 'Edit & send' | 'Propose & send'
	threadKey?: string
	threadTitle?: string
	readOnly?: boolean
	initialPrompt?: string
}

export function AssistantSidebar({
	open,
	geoEvents,
	mapContextEvents,
	availableFeatures,
	getDatasetName,
	onOpenSettings,
	onClose,
	onEnsureAuthoringTarget,
	authoringActionLabel,
	threadKey,
	threadTitle,
	readOnly,
	initialPrompt,
}: AssistantSidebarProps) {
	const dock = useEditorStore((state) => state.chatDock)
	const setDock = useEditorStore((state) => state.setChatDock)
	const compact = useIsMobile(1100)
	const dockedLeft = dock === 'left'
	const [visited, setVisited] = useState(open)
	useEffect(() => {
		if (open) setVisited(true)
	}, [open])

	return (
		<aside
			className={cn(
				'hidden flex-col overflow-hidden border-border bg-sidebar text-sidebar-foreground md:flex',
				cn(
					'transition-[width,left,right] duration-200 ease-linear',
					dockedLeft
						? [
								'fixed top-[var(--shell-toolbar-h)] bottom-[var(--shell-statusbar-h)] left-[var(--sidebar-width-icon)] z-20 h-auto min-w-0 max-w-none border-r',
								open
									? 'w-[calc(var(--sidebar-width)-var(--sidebar-width-icon))]'
									: 'w-0 border-r-0',
							]
						: [
								'shrink-0 md:mt-[var(--shell-toolbar-h)] md:mb-[var(--shell-statusbar-h)] md:h-[calc(100svh-var(--shell-toolbar-h)-var(--shell-statusbar-h))]',
								open
									? 'w-[var(--shell-chat-w)] min-w-[var(--shell-chat-w-min)] max-w-[var(--shell-chat-w-max)] border-l'
									: 'w-0 border-l-0',
							],
				),
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
				{(open || visited) && (
					<ChatPanel
						geoEvents={geoEvents}
						mapContextEvents={mapContextEvents}
						availableFeatures={availableFeatures}
						getDatasetName={getDatasetName}
						onOpenSettings={onOpenSettings}
						onClose={onClose}
						threadDock={dock}
						onMoveThread={!compact ? () => setDock(dock === 'left' ? 'right' : 'left') : undefined}
						onEnsureAuthoringTarget={onEnsureAuthoringTarget}
						authoringActionLabel={authoringActionLabel}
						threadKey={threadKey}
						threadTitle={threadTitle}
						readOnly={readOnly}
						initialPrompt={initialPrompt}
					/>
				)}
			</div>
		</aside>
	)
}
