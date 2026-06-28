/**
 * GroupViewPanel — the NO-MOD MINIMUM two-lane Group view (GROUP-05/06/07/08, D-02/03/08).
 *
 * The slimmed successor to `MapContextViewPanel`: it renders the curated `a`-ref lane FIRST
 * (`<CuratedLane>`, expanded, amber, privileged) and the foreign `c`-lane SECOND
 * (`<ForeignLane>`, collapsed, grey, subordinate) — "canon first, contributions second"
 * (D-08). Every foreign coordinate is kind+signature+mute validated BEFORE render inside
 * `ForeignLane` (GROUP-08). The owner gets a one-click "Lock down → Closed" escape hatch
 * (D-02) and pin/bless of curated refs (D-03). The optional Markdown narrative renders
 * through the sanitized `RichContentRenderer` (GROUP-06, no raw HTML). A `CommentsPanel`
 * mounts against the Group coordinate for comment + react (GROUP-07).
 *
 * The store still types `viewContext` as a `MapContext` cast over the kind-37518 event; this
 * panel reads it through the Group helpers via `viewContext.rawEvent()` (both are casts over
 * the same 37518 event) — no store-wide type migration required for this surface.
 */

import { LocateFixed } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { GeoComment } from '@/lib/nostr/geo-comment'
import { useEditorStore } from '@/features/geo-editor/store'
import { useGroupAttachments } from '@/lib/hooks/useGroups'
import {
	getGroupContent,
	getGroupCoordinate,
	getGroupReferencedAddresses,
	getGroupSchemaHash,
	GroupFactory,
	isGroup,
} from '@/lib/nostr/group'
import { accounts, publish } from '@/lib/nostr'
import { MAP_CONTEXT_KIND } from '@/lib/nostr/kinds'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import type { MapContext } from '@/lib/nostr/map-context'
import { CommentsPanel } from '@/features/social/comments'
import { useActiveAccount } from 'applesauce-react/hooks'
import { RichContentRenderer } from '../editor'
import type { GeoFeatureItem } from '../editor/GeoRichTextEditor'
import { Button } from '../ui/button'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '../ui/alert-dialog'
import { ConfirmDeleteAction } from './ConfirmDeleteAction'
import { CuratedLane } from './group-lane/CuratedLane'
import { ForeignLane } from './group-lane/ForeignLane'
import { EntityPanelSectionHeader, EntityPanelShell, EntityPanelSurface } from './EntityPanelShell'

interface GroupViewPanelProps {
	currentUserPubkey?: string
	getDatasetKey: (event: GeoDataset) => string
	getDatasetName: (event: GeoDataset) => string
	onInspectDataset: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	onDeleteContext?: (context: MapContext) => void
	/** Fly the map to this Group's footprint (the inspect-panel "Zoom to" button). */
	onZoomTo?: () => void
	deletingKey?: string | null
	onCommentGeometryVisibility?: (comment: GeoComment, visible: boolean) => void
	onZoomToBounds?: (bounds: [number, number, number, number]) => void
	availableFeatures?: GeoFeatureItem[]
	mapContextEvents?: MapContext[]
	onMentionVisibilityToggle?: (
		address: string,
		featureId: string | undefined,
		visible: boolean,
	) => void
	onMentionZoomTo?: (address: string, featureId: string | undefined) => void
	focusCommentId?: string
}

export function GroupViewPanel({
	currentUserPubkey,
	getDatasetName,
	onInspectDataset,
	onZoomToDataset,
	onDeleteContext,
	onZoomTo,
	deletingKey,
	onCommentGeometryVisibility,
	onZoomToBounds,
	availableFeatures = [],
	onMentionVisibilityToggle,
	onMentionZoomTo,
	focusCommentId,
}: GroupViewPanelProps) {
	const viewContext = useEditorStore((state) => state.viewContext)
	const activeAccount = useActiveAccount()
	const [lockingDown, setLockingDown] = useState(false)

	// Bridge: the store's MapContext cast wraps the same kind-MAP_CONTEXT_KIND (37518) event the
	// Group helpers read. CommentsPanel roots GROUP-07 comments at `target.kind === MAP_CONTEXT_KIND`.
	const groupEvent = useMemo(() => {
		const raw = viewContext?.rawEvent()
		return raw && raw.kind === MAP_CONTEXT_KIND && isGroup(raw) ? raw : null
	}, [viewContext])

	const group = useMemo(() => (groupEvent ? getGroupContent(groupEvent) : null), [groupEvent])
	const groupCoordinate = useMemo(
		() => (groupEvent ? (getGroupCoordinate(groupEvent) ?? null) : null),
		[groupEvent],
	)
	const referencedAddresses = useMemo(
		() => (groupEvent ? getGroupReferencedAddresses(groupEvent) : []),
		[groupEvent],
	)
	const publishedHash = useMemo(
		() => (groupEvent ? getGroupSchemaHash(groupEvent) : undefined),
		[groupEvent],
	)

	// Foreign-lane discovery — gated on `governance !== 'closed'` (no `#c` sub when closed).
	const foreignCoordinate = group?.governance === 'closed' ? null : groupCoordinate
	const { events: attachments } = useGroupAttachments(foreignCoordinate)

	const isOwner = !!currentUserPubkey && currentUserPubkey === viewContext?.pubkey

	const handleLockDown = useCallback(async () => {
		if (!groupEvent) return
		const signer = accounts.signer
		if (!signer) {
			toast.error('No active account')
			return
		}
		setLockingDown(true)
		try {
			const signed = await GroupFactory.modify(groupEvent)
				.group({ governance: 'closed' })
				.sign(signer)
			await publish(signed, { routing: 'outbox' })
			toast.success('Group locked down. Only your curated references show now.')
		} catch {
			toast.error("Couldn't publish — check your connection and try again.")
		} finally {
			setLockingDown(false)
		}
	}, [groupEvent])

	const handleBlessForeign = useCallback(
		async (coordinate: string) => {
			if (!groupEvent) return
			const signer = accounts.signer
			if (!signer) {
				toast.error('No active account')
				return
			}
			try {
				const { appendCuratedReference } = await import('./group-lane/CuratedLane')
				await appendCuratedReference(groupEvent, coordinate, signer)
				toast.success('Added to curated references.')
			} catch {
				toast.error("Couldn't publish — check your connection and try again.")
			}
		},
		[groupEvent],
	)

	if (!viewContext || !groupEvent || !group) {
		return <div className="text-sm text-gray-500">No Group selected.</div>
	}

	const groupKey = viewContext.contextId ?? viewContext.dTag ?? viewContext.id ?? null
	const isDeleting = groupKey ? deletingKey === `context:${groupKey}` : false

	return (
		<EntityPanelShell title={group.name || viewContext.contextId || 'Untitled Group'}>
			<div className="space-y-3 text-[13px]">
				<EntityPanelSurface tone="context" className="space-y-3">
					<EntityPanelSectionHeader
						eyebrow="Group"
						title={group.name || viewContext.contextId || 'Untitled Group'}
						description={`Governance: ${group.governance}`}
						action={
							onZoomTo || isOwner ? (
								<div className="flex items-center gap-2">
									{onZoomTo && (
										<Button
											type="button"
											variant="outline"
											size="sm"
											onClick={onZoomTo}
											className="gap-1 rounded-none px-2 text-[11px]"
											title="Zoom to on map"
										>
											<LocateFixed className="h-3 w-3" />
											Zoom
										</Button>
									)}
									{isOwner && group.governance !== 'closed' && (
										<AlertDialog>
											<AlertDialogTrigger asChild>
												<Button
													type="button"
													variant="destructive"
													size="sm"
													disabled={lockingDown}
													className="rounded-none px-2 text-[11px]"
												>
													Lock down → Closed
												</Button>
											</AlertDialogTrigger>
											<AlertDialogContent>
												<AlertDialogHeader>
													<AlertDialogTitle>Lock this Group down?</AlertDialogTitle>
													<AlertDialogDescription>
														Switching to Closed hides all community contributions immediately and
														only your curated references will show. You can reopen it later by
														editing the Group.
													</AlertDialogDescription>
												</AlertDialogHeader>
												<AlertDialogFooter>
													<AlertDialogCancel>Keep open</AlertDialogCancel>
													<AlertDialogAction onClick={handleLockDown}>Lock down</AlertDialogAction>
												</AlertDialogFooter>
											</AlertDialogContent>
										</AlertDialog>
									)}
									{isOwner && onDeleteContext && (
										<ConfirmDeleteAction
											label="Group"
											isDeleting={isDeleting}
											onConfirm={() => onDeleteContext(viewContext)}
										/>
									)}
								</div>
							) : null
						}
					/>
					{group.description && (
						<RichContentRenderer
							content={group.description}
							availableFeatures={availableFeatures}
							onMentionVisibilityToggle={onMentionVisibilityToggle}
							onMentionZoomTo={onMentionZoomTo}
							className="text-sm text-gray-600"
						/>
					)}
				</EntityPanelSurface>

				{/* Curated lane FIRST — privileged, expanded, amber (D-08). */}
				<CuratedLane
					groupEvent={groupEvent}
					referencedAddresses={referencedAddresses}
					isOwner={isOwner}
					signer={activeAccount ? accounts.signer : null}
					onInspectCoordinate={(coord) => onMentionZoomTo?.(coord, undefined)}
					onZoomToCoordinate={(coord) => onMentionZoomTo?.(coord, undefined)}
				/>

				{/* Foreign lane SECOND — subordinate, collapsed, grey; gated before render. */}
				<ForeignLane
					group={group}
					governance={group.governance}
					publishedHash={publishedHash}
					attachments={attachments}
					isOwner={isOwner}
					getDatasetName={getDatasetName}
					onInspectDataset={onInspectDataset}
					onZoomToDataset={onZoomToDataset}
					onBlessForeign={handleBlessForeign}
					curatedCoordinates={referencedAddresses}
				/>

				{/* Comment + react on the Group coordinate (GROUP-07). The `viewContext` cast is a
				    kind-MAP_CONTEXT_KIND (37518) event, so CommentsPanel/GeoSocialActions root the
				    comment at `target.kind === MAP_CONTEXT_KIND` directly — no K/k widening needed
				    here (full widening across all kinds stays Phase 13). */}
				<EntityPanelSurface tone="discussion" className="space-y-4">
					<EntityPanelSectionHeader eyebrow="Discussion" title="Comments" />
					<CommentsPanel
						key={viewContext.id ?? viewContext.dTag ?? 'no-group'}
						target={viewContext}
						onCommentGeojsonVisibilityChange={(comment, visible) =>
							onCommentGeometryVisibility?.(comment, visible)
						}
						onZoomToCommentGeojson={(comment) => {
							if (comment.boundingBox && onZoomToBounds) onZoomToBounds(comment.boundingBox)
						}}
						availableFeatures={availableFeatures}
						onMentionVisibilityToggle={onMentionVisibilityToggle}
						onMentionZoomTo={onMentionZoomTo}
						focusCommentId={focusCommentId}
					/>
				</EntityPanelSurface>
			</div>
		</EntityPanelShell>
	)
}
