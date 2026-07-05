import type { ColumnDef } from '@tanstack/react-table'
import {
	DebugActionIcon,
	FavoriteActionIcon,
	InspectActionIcon,
	MapStackActionIcon,
} from '@/components/entity-action-icons'
import { Button } from '@/components/ui/button'
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

// Shared resting style for entity row-action icons — kept identical to the
// dataset catalog so the two surfaces stay uniform. Muted-but-present at rest
// with a subtle rounded hover chip so each icon clearly behaves like a button.
const actionButtonClass =
	'rounded-md px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-info'

function ContextBadge({ label, className }: { label: string; className: string }) {
	return (
		<span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', className)}>{label}</span>
	)
}

export const createContextColumns = (
	context: ContextColumnsContext,
): ColumnDef<ContextRowData>[] => [
	{
		accessorKey: 'contextName',
		header: 'Context',
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
			} = row.original
			const image = contextEvent.context.image
			const paddingLeftRem = displayDepth + (isMapActive ? 0.75 : 0)
			return (
				<div
					className="relative flex min-w-0 items-center whitespace-normal"
					style={paddingLeftRem > 0 ? { paddingLeft: `${paddingLeftRem}rem` } : undefined}
				>
					{isMapActive ? (
						<div className="absolute inset-y-1 left-0 w-1 rounded-full bg-ok" />
					) : null}
					{image && (
						<div className="mr-2 h-16 w-16 shrink-0 overflow-hidden rounded-sm">
							<img
								src={image}
								alt={contextName}
								className="h-full w-full object-cover object-center"
							/>
						</div>
					)}
					<div className="min-w-0 flex-1 py-1">
						<div className="flex min-w-0 items-start gap-1.5">
							{displayDepth > 0 && <span className="text-[10px] text-muted-foreground">└</span>}
							<div className="min-w-0 flex-1">
								<div className="flex min-w-0 items-start justify-between gap-3">
									<div className="min-w-0 flex-1">
										<div className="line-clamp-2 break-words text-sm font-semibold leading-snug text-foreground">
											{contextName}
										</div>
										<div className="mt-1 min-w-0">
											<UserProfile
												pubkey={contextEvent.pubkey}
												mode="avatar-name"
												size="xs"
												showNip05Badge={false}
												interactive={false}
											/>
										</div>
									</div>
									<div className="flex max-w-[9rem] shrink-0 flex-wrap justify-end gap-1 pt-0.5">
										<ContextBadge label={contextUse} className="bg-info/15 text-info" />
										{validationMode ? (
											<ContextBadge
												label={validationMode}
												className={
													validationMode === 'required'
														? 'bg-destructive/10 text-destructive'
														: validationMode === 'optional'
															? 'bg-primary/10 text-primary'
															: 'bg-muted text-foreground'
												}
											/>
										) : (
											<ContextBadge label="none" className="bg-muted text-muted-foreground" />
										)}
										<ContextBadge
											label={attachmentPolicy}
											className={
												attachmentPolicy === 'open'
													? 'bg-ok/15 text-ok'
													: 'bg-muted text-foreground'
											}
										/>
									</div>
								</div>
								{isCuratedChild && (
									<div className="mt-1 text-[10px] text-muted-foreground">
										curated child
										{displayParentName ? ` in ${displayParentName}` : ''}
										{attachmentCount > 1 ? ` · ${attachmentCount} contexts` : ''}
									</div>
								)}
								<div className="mt-1 flex min-w-0 items-end justify-between gap-3">
									<GeoSocialActions
										target={contextEvent}
										onReplyClick={() => context.onInspectContext?.(contextEvent)}
										showCommentButton={Boolean(context.onInspectContext)}
										showAnnotateButton={false}
										loadCounts={false}
										compact
										className="-ml-2 shrink-0 gap-0"
									/>
									<div className="flex shrink-0 items-center gap-0.5">
										{context.onToggleContextOnMap ? (
											<Button
												size="icon-sm"
												variant="ghost"
												className={cn(
													actionButtonClass,
													row.original.isInMapStack ? 'text-ok hover:text-ok' : 'hover:text-ok',
												)}
												onClick={() => context.onToggleContextOnMap?.(contextEvent)}
												aria-label={
													row.original.isInMapStack ? 'Remove from map stack' : 'Add to map stack'
												}
												title={
													row.original.isInMapStack ? 'Remove from map stack' : 'Add to map stack'
												}
											>
												<MapStackActionIcon className="h-4 w-4" />
											</Button>
										) : null}
										<Button
											size="icon-sm"
											variant="ghost"
											className={cn(actionButtonClass, 'hover:text-ok')}
											onClick={() => context.onInspectContext?.(contextEvent)}
											aria-label="Inspect context"
											title="Inspect context"
										>
											<InspectActionIcon className="h-4 w-4" />
										</Button>
										{context.onToggleCatalogPin ? (
											// P2.2 (report 6.x): favorites persist per-pubkey, so they're
											// meaningless while logged out. Disable with a sign-in hint
											// rather than silently writing guest-scoped state.
											<Button
												size="icon-sm"
												variant="ghost"
												disabled={!context.currentUserPubkey}
												className={cn(
													actionButtonClass,
													row.original.isCatalogPinned
														? 'text-primary hover:text-primary'
														: 'hover:text-primary',
												)}
												onClick={() => context.onToggleCatalogPin?.(contextEvent)}
												aria-label={
													!context.currentUserPubkey
														? 'Sign in to save favorites'
														: row.original.isCatalogPinned
															? 'Remove from favorites'
															: 'Add to favorites'
												}
												title={
													!context.currentUserPubkey
														? 'Sign in to save favorites'
														: row.original.isCatalogPinned
															? 'Remove from favorites'
															: 'Add to favorites'
												}
											>
												<FavoriteActionIcon
													className={cn('h-4 w-4', row.original.isCatalogPinned && 'fill-primary')}
												/>
											</Button>
										) : null}
										{context.onOpenDebug ? (
											<Button
												size="icon-sm"
												variant="ghost"
												className={cn(actionButtonClass, 'hover:text-primary')}
												aria-label="Open debug dialog"
												title="Open debug dialog"
												onClick={() => context.onOpenDebug?.(contextEvent)}
											>
												<DebugActionIcon className="h-4 w-4" />
											</Button>
										) : null}
									</div>
								</div>
							</div>
						</div>
					</div>
				</div>
			)
		},
	},
]
