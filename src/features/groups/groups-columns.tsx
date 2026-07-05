/**
 * Table columns for the Group list (Phase 9). The slimmed successor to
 * `contexts-columns.tsx`: repointed to the `Group` cast and the single
 * `governance` enum (the old `contextUse`/`validationMode`/`attachmentPolicy`
 * triad collapses to one governance badge).
 *
 * NOTE (consumer migration, Plans 05/06): the catalog/profile consumers
 * (`GeoDatasetsPanel`, `UserProfilePanel`) still build `MapContext`-typed row
 * data and call `createContextColumns`. Those call sites migrate to `useGroups`
 * / `Group` in Plan 06; this module is the Group-native target they migrate to.
 */

import type { ColumnDef } from '@tanstack/react-table'
import {
	DebugActionIcon,
	FavoriteActionIcon,
	InspectActionIcon,
	MapStackActionIcon,
} from '@/components/entity-action-icons'
import { Button } from '@/components/ui/button'
import { UserProfile } from '@/components/user-profile'
import type { Group, GroupGovernance } from '@/lib/nostr/group'
import { cn } from '@/lib/utils'
import { GeoSocialActions } from '../social/comments/GeoSocialActions'

export interface GroupRowData {
	group: Group
	groupName: string
	governance: GroupGovernance
	displayDepth: number
	displayParentName: string | null
	isCuratedChild: boolean
	attachmentCount: number
	isMapActive: boolean
	/** Whether a `context:<coordinate>` entry is on the map stack. */
	isInMapStack: boolean
	/** Starred in the catalog Favorites tab. Optional — profile view doesn't wire it. */
	isCatalogPinned?: boolean
}

export interface GroupColumnsContext {
	currentUserPubkey?: string
	onInspectGroup?: (group: Group) => void
	onEditGroup?: (group: Group) => void
	/** Add/remove the Group's stack entry (the primary row verb). */
	onToggleGroupOnMap?: (group: Group) => void
	/** Toggle catalog favorite (Star). */
	onToggleCatalogPin?: (group: Group) => void
	onOpenDebug?: (event: Group) => void
}

// Shared resting style for entity row-action icons — kept identical to the
// dataset catalog so the two surfaces stay uniform.
const actionButtonClass =
	'rounded-md px-2 text-xs text-muted-foreground shadow-none hover:bg-muted hover:text-info'

const GOVERNANCE_BADGE_CLASS: Record<GroupGovernance, string> = {
	open: 'bg-ok/15 text-ok',
	schema: 'bg-primary/10 text-primary',
	closed: 'bg-muted text-foreground',
}

function GovernanceBadge({ governance }: { governance: GroupGovernance }) {
	return (
		<span
			className={cn(
				'rounded px-1.5 py-0.5 text-[10px] font-medium',
				GOVERNANCE_BADGE_CLASS[governance],
			)}
		>
			{governance}
		</span>
	)
}

export const createGroupColumns = (context: GroupColumnsContext): ColumnDef<GroupRowData>[] => [
	{
		accessorKey: 'groupName',
		header: 'Group',
		cell: ({ row }) => {
			const {
				group,
				groupName,
				governance,
				displayDepth,
				displayParentName,
				isCuratedChild,
				attachmentCount,
				isMapActive,
			} = row.original
			const image = group.group.image
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
								alt={groupName}
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
											{groupName}
										</div>
										<div className="mt-1 min-w-0">
											<UserProfile
												pubkey={group.pubkey}
												mode="avatar-name"
												size="xs"
												showNip05Badge={false}
												interactive={false}
											/>
										</div>
									</div>
									<div className="flex max-w-[9rem] shrink-0 flex-wrap justify-end gap-1 pt-0.5">
										<GovernanceBadge governance={governance} />
									</div>
								</div>
								{isCuratedChild && (
									<div className="mt-1 text-[10px] text-muted-foreground">
										curated child
										{displayParentName ? ` in ${displayParentName}` : ''}
										{attachmentCount > 1 ? ` · ${attachmentCount} Groups` : ''}
									</div>
								)}
								<div className="mt-1 flex min-w-0 items-end justify-between gap-3">
									<GeoSocialActions
										target={group}
										onReplyClick={() => context.onInspectGroup?.(group)}
										showCommentButton={Boolean(context.onInspectGroup)}
										showAnnotateButton={false}
										loadCounts={false}
										compact
										className="-ml-2 shrink-0 gap-0"
									/>
									<div className="flex shrink-0 items-center gap-0.5">
										{context.onToggleGroupOnMap ? (
											<Button
												size="icon-sm"
												variant="ghost"
												className={cn(
													actionButtonClass,
													row.original.isInMapStack ? 'text-ok hover:text-ok' : 'hover:text-ok',
												)}
												onClick={() => context.onToggleGroupOnMap?.(group)}
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
											onClick={() => context.onInspectGroup?.(group)}
											aria-label="Inspect Group"
											title="Inspect Group"
										>
											<InspectActionIcon className="h-4 w-4" />
										</Button>
										{context.onToggleCatalogPin ? (
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
												onClick={() => context.onToggleCatalogPin?.(group)}
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
												onClick={() => context.onOpenDebug?.(group)}
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
