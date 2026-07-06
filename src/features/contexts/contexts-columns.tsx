import type { ColumnDef } from '@tanstack/react-table'
import { Globe } from 'lucide-react'
import {
	DebugActionIcon,
	FavoriteActionIcon,
	InspectActionIcon,
	MapStackActionIcon,
} from '@/components/entity-action-icons'
import { CoverThumb, ListRow, RowActionButton, RowBadge } from '@/components/entity-list'
import { UserProfile } from '@/components/user-profile'
import { cn } from '@/lib/utils'
import type { MapContext } from '@/lib/nostr/map-context'
import { GeoSocialActions } from '../social/comments/GeoSocialActions'

export interface ContextRowData {
	context: MapContext
	contextName: string
	contextUse: string
	validationMode: string | null
	attachmentPolicy: string
	displayDepth: number
	displayParentName: string | null
	isCuratedChild: boolean
	attachmentCount: number
	isMapActive: boolean
	/** Round F.3: whether a `context:<coordinate>` entry is on the map stack. */
	isInMapStack: boolean
	/** Round G.2: starred in the catalog Favorites tab. Optional — profile view doesn't wire it. */
	isCatalogPinned?: boolean
}

export interface ContextColumnsContext {
	currentUserPubkey?: string
	onInspectContext?: (context: MapContext) => void
	onEditContext?: (context: MapContext) => void
	/** Round F.3: add/remove the context's stack entry (the primary row verb). */
	onToggleContextOnMap?: (context: MapContext) => void
	/** Round G.2: toggle catalog favorite (Star). */
	onToggleCatalogPin?: (context: MapContext) => void
	onOpenDebug?: (event: MapContext) => void
}

export const createContextColumns = (
	context: ContextColumnsContext,
): ColumnDef<ContextRowData>[] => [
	{
		accessorKey: 'contextName',
		cell: ({ row }) => {
			const {
				context: contextEvent,
				contextName,
				contextUse,
				validationMode,
				attachmentPolicy,
				displayDepth,
				displayParentName,
				isCuratedChild,
				attachmentCount,
				isMapActive,
				isInMapStack,
				isCatalogPinned,
			} = row.original
			const image = contextEvent.context.image

			return (
				<ListRow
					leading={
						<CoverThumb
							src={image}
							alt={contextName}
							fallbackIcon={Globe}
							fallbackClassName="bg-info/15 text-info"
						/>
					}
					title={contextName}
					selected={isMapActive}
					indentRem={displayDepth > 0 ? displayDepth * 0.75 : undefined}
					onTitleClick={
						context.onInspectContext ? () => context.onInspectContext?.(contextEvent) : undefined
					}
					titleAriaLabel={`Inspect context ${contextName}`}
					titleTitle="Inspect context"
					badges={
						<>
							<RowBadge label={contextUse} className="bg-info/15 text-info" />
							{validationMode ? (
								<RowBadge
									label={validationMode}
									className={cn(
										validationMode === 'required'
											? 'bg-destructive/10 text-destructive'
											: validationMode === 'optional'
												? 'bg-primary/10 text-primary'
												: 'bg-muted text-foreground',
									)}
								/>
							) : (
								<RowBadge label="none" className="bg-muted text-muted-foreground" />
							)}
							<RowBadge
								label={attachmentPolicy}
								className={cn(
									attachmentPolicy === 'open' ? 'bg-ok/15 text-ok' : 'bg-muted text-foreground',
								)}
							/>
						</>
					}
					meta={
						<UserProfile
							pubkey={contextEvent.pubkey}
							mode="avatar-name"
							size="xs"
							showNip05Badge={false}
							interactive={false}
						/>
					}
					note={
						isCuratedChild
							? `curated child${displayParentName ? ` in ${displayParentName}` : ''}${
									attachmentCount > 1 ? ` · ${attachmentCount} contexts` : ''
								}`
							: undefined
					}
					engage={
						<GeoSocialActions
							target={contextEvent}
							onReplyClick={() => context.onInspectContext?.(contextEvent)}
							showCommentButton={Boolean(context.onInspectContext)}
							showAnnotateButton={false}
							loadCounts={false}
							compact
							className="-ml-2 shrink-0 gap-0"
						/>
					}
					actions={
						<>
							{context.onToggleContextOnMap ? (
								<RowActionButton
									icon={MapStackActionIcon}
									label={isInMapStack ? 'Remove from map stack' : 'Add to map stack'}
									hover="hover:text-ok"
									active={isInMapStack}
									activeClassName="text-ok hover:text-ok"
									onClick={() => context.onToggleContextOnMap?.(contextEvent)}
								/>
							) : null}
							<RowActionButton
								icon={InspectActionIcon}
								label="Inspect context"
								hover="hover:text-ok"
								onClick={() => context.onInspectContext?.(contextEvent)}
							/>
							{context.onToggleCatalogPin ? (
								// P2.2: favorites persist per-pubkey — disable with a sign-in hint
								// rather than silently writing guest-scoped state.
								<RowActionButton
									icon={FavoriteActionIcon}
									label={
										!context.currentUserPubkey
											? 'Sign in to save favorites'
											: isCatalogPinned
												? 'Remove from favorites'
												: 'Add to favorites'
									}
									hover="hover:text-primary"
									active={Boolean(isCatalogPinned)}
									activeClassName="text-primary hover:text-primary"
									filled={Boolean(isCatalogPinned)}
									disabled={!context.currentUserPubkey}
									onClick={() => context.onToggleCatalogPin?.(contextEvent)}
								/>
							) : null}
							{context.onOpenDebug ? (
								<RowActionButton
									icon={DebugActionIcon}
									label="Open debug dialog"
									hover="hover:text-primary"
									onClick={() => context.onOpenDebug?.(contextEvent)}
								/>
							) : null}
						</>
					}
				/>
			)
		},
	},
]
