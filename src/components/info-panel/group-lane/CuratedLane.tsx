/**
 * CuratedLane (D-03 / D-08) — the EXPANDED, privileged "Canonical references" lane of the
 * NO-MOD MINIMUM Group view. It renders the Group's owner-pinned `a`-refs FIRST, above the
 * subordinate foreign lane, with the privileged `tone="context"` (amber) treatment and a
 * "Canonical" `Badge variant="secondary"`.
 *
 * Owner affordances:
 *   - "Add curated reference" search picker (D-03b, reuses `EntitySearchPopover`) appends a
 *     coordinate to the Group's `a` refs.
 *   - `blessFromForeign(coord)` (D-03a, "Add to curated") does the same append from a
 *     foreign-lane row — wired by the parent panel into `<ForeignLane onBlessForeign>`.
 *
 * Both append paths republish via `GroupFactory.modify(group).referencedAddresses([...])`
 * so the Group's `d` (lineage) is preserved — comments/reactions stay attached.
 */

import { useCallback } from 'react'
import { toast } from 'sonner'
import type { EventSigner } from 'applesauce-core/factories/types'
import { EntitySearchPopover } from '@/components/entity-search'
import type { EntitySearchResult } from '@/components/entity-search/types'
import { GroupFactory } from '@/lib/nostr/group'
import type { GroupEvent } from '@/lib/nostr/group'
import { publish } from '@/lib/nostr'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { EntityPanelSectionHeader, EntityPanelSurface } from '../EntityPanelShell'

export interface CuratedLaneProps {
	/** The raw Group event (modify target for pin/bless; preserves `d`). */
	groupEvent: GroupEvent
	/** The Group's curated `a`-ref coordinates (the privileged lane). */
	referencedAddresses: string[]
	/** Whether the current viewer owns the Group (reveals the picker). */
	isOwner: boolean
	/** The active account signer (required to publish a pin). */
	signer?: EventSigner | null
	/** Inspect/Zoom by addressable coordinate (delegated to the parent's map actions). */
	onInspectCoordinate?: (coordinate: string) => void
	onZoomToCoordinate?: (coordinate: string) => void
}

/**
 * Append `coordinate` to the Group's curated `a` refs and republish (modify preserves `d`).
 * Shared by the search-picker path and the foreign-lane bless path.
 */
export async function appendCuratedReference(
	groupEvent: GroupEvent,
	coordinate: string,
	signer: EventSigner,
): Promise<void> {
	const existing = groupEvent.tags
		.filter((tag) => tag[0] === 'a')
		.map((tag) => tag[1])
		.filter((value): value is string => Boolean(value))
	if (existing.includes(coordinate)) return
	const signed = await GroupFactory.modify(groupEvent)
		.referencedAddresses([...existing, coordinate])
		.sign(signer)
	await publish(signed, { routing: 'outbox' })
}

export function CuratedLane({
	groupEvent,
	referencedAddresses,
	isOwner,
	signer,
	onInspectCoordinate,
	onZoomToCoordinate,
}: CuratedLaneProps) {
	const handlePick = useCallback(
		async (result: EntitySearchResult) => {
			const coordinate = result.address
			if (!coordinate) return
			if (!signer) {
				toast.error('No active account')
				return
			}
			try {
				await appendCuratedReference(groupEvent, coordinate, signer)
				toast.success('Added to curated references.')
			} catch {
				toast.error("Couldn't publish — check your connection and try again.")
			}
		},
		[groupEvent, signer],
	)

	return (
		<EntityPanelSurface tone="context" className="space-y-3">
			<EntityPanelSectionHeader
				eyebrow="Curated"
				title="Canonical references"
				description="The owner's pinned references — shown first."
				action={
					isOwner ? (
						<EntitySearchPopover
							onSelect={handlePick}
							searchMode="both"
							compact
							placeholder="Add curated reference"
						/>
					) : null
				}
			/>

			{referencedAddresses.length === 0 ? (
				<p className="text-[13px] text-foreground/70">
					No canonical references yet. The owner hasn't pinned any references. Conforming community
					contributions appear below.
				</p>
			) : (
				<div className="space-y-2">
					{referencedAddresses.map((coordinate) => (
						<div
							key={coordinate}
							className="flex items-center justify-between gap-2 border-b border-amber-200/60 py-2"
						>
							<div className="min-w-0 space-y-1">
								<p className="truncate font-mono text-xs text-foreground">{coordinate}</p>
								<Badge variant="secondary" className="rounded-none text-[10px]">
									Canonical
								</Badge>
							</div>
							<div className="flex items-center gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => onInspectCoordinate?.(coordinate)}
									className="rounded-none border-stone-200 bg-white px-2 text-xs"
								>
									Inspect
								</Button>
								<Button
									size="sm"
									variant="outline"
									onClick={() => onZoomToCoordinate?.(coordinate)}
									className="rounded-none border-stone-200 bg-white px-2 text-xs"
								>
									Zoom
								</Button>
							</div>
						</div>
					))}
				</div>
			)}
		</EntityPanelSurface>
	)
}
