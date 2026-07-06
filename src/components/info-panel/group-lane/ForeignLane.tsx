/**
 * ForeignLane (GROUP-08 / GROUP-05 / D-07 / D-08) — the COLLAPSED, subordinate
 * "Community contributions (N)" lane of the NO-MOD MINIMUM Group view.
 *
 * SECURITY-CRITICAL: every `c`-attached coordinate is gated through
 * `gateForeignLane` (kind === 37515 → `verifyEvent` signature → device-local mute) BEFORE
 * it can paint — a wrong-kind / forged / muted event NEVER enters the render set (no chip,
 * no flash). On top of that trust gate, a per-view Off/Warn/Strict schema filter (default
 * Strict for schema Groups) runs OFF-THREAD (`filterForeignAttachment`) and surfaces a
 * legible reason on every hidden/flagged item.
 *
 * The lane is visually SUBORDINATE to the curated lane: a `tone="neutral"` grey collapsible,
 * collapsed by default, rows at `text-muted-foreground`. The only accent here is the active
 * filter segment. Never a co-equal tab, never an accent on the lane chrome (D-08).
 */

import { Eye, Maximize2, MoreVertical } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nip19 } from 'nostr-tools'
import type { NostrEvent } from 'applesauce-core/helpers/event'
import { toast } from 'sonner'
import { castEvent } from 'applesauce-core/casts'
import { eventStore } from '@/lib/nostr'
import { GeoDataset } from '@/lib/nostr/geo-event'
import {
	type GroupFilterMode,
	filterForeignAttachment,
	resolveGroupFilterDefault,
} from '@/lib/group/filterModes'
import { gateForeignLane } from '@/lib/group/noModMinimum'
import type { GroupContent, GroupGovernance } from '@/lib/nostr/group'
import { useMuteStore } from '@/lib/mute/useMuteStore'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../../ui/collapsible'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from '../../ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '../../ui/toggle-group'
import { EntityActionBar } from '../EntityActionBar'
import { EntityPanelSectionHeader, EntityPanelSurface } from '../EntityPanelShell'

export interface ForeignLaneProps {
	/** The Group's parsed governance content (drives schema filtering). */
	group: GroupContent
	/** The Group's governance rung — `closed` suppresses the lane entirely. */
	governance: GroupGovernance
	/** The Group's published `schema-hash` tag (verify-before-validate target). */
	publishedHash?: string
	/** Raw `c`-attached candidate events (untrusted; gated before render). */
	attachments: NostrEvent[]
	/** Whether the current viewer owns the Group (reveals the bless affordance). */
	isOwner: boolean
	getDatasetName: (event: GeoDataset) => string
	onInspectDataset: (event: GeoDataset) => void
	onZoomToDataset: (event: GeoDataset) => void
	/** Owner-only "Add to curated" (bless) — appends the row's coordinate to the `a` lane. */
	onBlessForeign?: (coordinate: string) => void
	/**
	 * The Group's curated (`a`) coordinates. A dataset that has been blessed into the
	 * curated lane MUST NOT also appear here (it would show in both lanes) — these are
	 * excluded from the community lane.
	 */
	curatedCoordinates?: string[]
}

/** A foreign-lane row after the trust gate, carrying its off-thread schema verdict. */
interface GatedRow {
	event: NostrEvent
	/** Whether the schema filter shows this row (off/warn always show; strict may hide). */
	show: boolean
	/** A legible filter reason (warn flag, or the reason a strict row was hidden). */
	reason?: string
}

function shortName(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey)
		return `${npub.slice(0, 12)}…`
	} catch {
		return `${pubkey.slice(0, 8)}…`
	}
}

/** Parse a foreign attachment's first GeoJSON Feature `properties` for schema checking. */
function readAttachmentProperties(event: NostrEvent): unknown {
	try {
		const parsed = JSON.parse(event.content) as {
			features?: Array<{ properties?: unknown }>
		}
		return parsed.features?.[0]?.properties ?? {}
	} catch {
		return {}
	}
}

export function ForeignLane({
	group,
	governance,
	publishedHash,
	attachments,
	isOwner,
	getDatasetName,
	onInspectDataset,
	onZoomToDataset,
	onBlessForeign,
	curatedCoordinates = [],
}: ForeignLaneProps) {
	// Subscribe to the mute set so muting a contributor re-renders the lane immediately.
	const muted = useMuteStore((state) => state.muted)
	const mute = useMuteStore((state) => state.mute)
	const unmute = useMuteStore((state) => state.unmute)

	const defaultMode = resolveGroupFilterDefault(governance) ?? 'off'
	const [mode, setMode] = useState<GroupFilterMode>(defaultMode)
	const [showAll, setShowAll] = useState(false)
	const [gatedRows, setGatedRows] = useState<GatedRow[]>([])

	// Stable key for the curated-coordinate set so the gate memo only recomputes when
	// the curated lane actually changes (not on every render's fresh array identity).
	const curatedKey = curatedCoordinates.join(',')

	// 1. TRUST GATE (GROUP-08): drop datasets already curated (no double-listing across
	//    lanes), then kind → signature → mute, then sort newest-first + cap.
	const { visible, hasMore } = useMemo(() => {
		const mutedPubkeys = new Set(muted)
		const curated = new Set(curatedKey ? curatedKey.split(',') : [])
		const notCurated =
			curated.size === 0
				? attachments
				: attachments.filter((event) => {
						const coordinate = `37515:${event.pubkey}:${
							event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
						}`
						return !curated.has(coordinate)
					})
		return gateForeignLane(notCurated, { mutedPubkeys })
	}, [attachments, muted, curatedKey])

	const isSchema = governance === 'schema'

	// Stable schema identity. `group` is a fresh `castEvent` content object on every
	// `useGroups` timeline emission, so `group.schema` changes ref constantly even when
	// unchanged. Keying the filter effect on the schema's CONTENT (published hash, else a
	// content hash) instead of the object ref stops incidental re-casts from re-validating
	// every visible attachment off-thread on each emission — the schema-worker CPU/GC storm.
	const schemaKey = useMemo(
		() => (group.schema ? (publishedHash ?? JSON.stringify(group.schema)) : null),
		[group.schema, publishedHash],
	)

	// 2. OFF-THREAD SCHEMA FILTER (GROUP-05): off/warn/strict with legible reasons. Runs
	//    only on the already-trust-gated survivors; never re-validates trust.
	// biome-ignore lint/correctness/useExhaustiveDependencies: group.schema is keyed by schemaKey (content); depending on the raw ref would reintroduce the per-emission re-validation storm.
	useEffect(() => {
		let cancelled = false
		if (!isSchema || mode === 'off' || !group.schema) {
			setGatedRows(visible.map((event) => ({ event, show: true })))
			return
		}
		Promise.all(
			visible.map(async (event) => {
				const verdict = await filterForeignAttachment(
					mode,
					group.schema,
					readAttachmentProperties(event),
					{ publishedHash },
				)
				return { event, show: verdict.show, reason: verdict.reason }
			}),
		).then((rows) => {
			if (!cancelled) setGatedRows(rows)
		})
		return () => {
			cancelled = true
		}
	}, [visible, isSchema, mode, schemaKey, publishedHash])

	const shownRows = useMemo(() => gatedRows.filter((row) => row.show), [gatedRows])

	// Cast each raw attachment event into a real `GeoDataset` ONCE (memoized) so
	// the row name / inspect / zoom actions get a typed dataset with a usable
	// `featureCollection`. Casting the raw NostrEvent with `as unknown as GeoDataset`
	// (the previous approach) produced an object with no `featureCollection`, which
	// crashed `getDatasetName` → `getCollectionName(undefined).name`. A non-castable
	// event is dropped rather than allowed to crash the whole lane.
	const visibleRows = useMemo(() => {
		const list = showAll ? shownRows : shownRows.slice(0, 50)
		return list
			.map((row) => {
				try {
					const dataset = castEvent(row.event, GeoDataset, eventStore)
					const coordinate = `37515:${row.event.pubkey}:${
						row.event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
					}`
					return { row, dataset, coordinate }
				} catch {
					return null
				}
			})
			.filter((entry): entry is NonNullable<typeof entry> => entry !== null)
	}, [shownRows, showAll])

	const handleMute = useCallback(
		(pubkey: string) => {
			const label = shortName(pubkey)
			mute(pubkey)
			// Longer-lived toast (10s) so the undo is actually reachable — the default
			// ~4s expired before testers could click Undo (UAT 2026-06-26).
			toast(`Muted ${label} everywhere.`, {
				duration: 10000,
				action: { label: 'Undo', onClick: () => unmute(pubkey) },
			})
		},
		[mute, unmute],
	)

	// `closed` Groups have no foreign lane at all (D-08 / GROUP-02).
	if (governance === 'closed') return null

	const count = shownRows.length

	return (
		<EntityPanelSurface tone="neutral" className="space-y-3">
			<Collapsible>
				<CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
					<EntityPanelSectionHeader
						eyebrow="Community"
						title={`Community contributions (${count})`}
						description="Attachments from anyone — shown below your curated picks."
					/>
				</CollapsibleTrigger>
				<CollapsibleContent className="space-y-3 pt-3">
					{isSchema && (
						<div className="space-y-1">
							<ToggleGroup
								type="single"
								value={mode}
								onValueChange={(next) => next && setMode(next as GroupFilterMode)}
								className="justify-start"
							>
								<ToggleGroupItem value="off" className="rounded-none text-[11px]">
									Off
								</ToggleGroupItem>
								<ToggleGroupItem value="warn" className="rounded-none text-[11px]">
									Warn
								</ToggleGroupItem>
								<ToggleGroupItem value="strict" className="rounded-none text-[11px]">
									Strict
								</ToggleGroupItem>
							</ToggleGroup>
							<p className="text-[11px] text-muted-foreground">
								Strict hides contributions that don't match the rules. Warn shows them with a
								reason. Off shows everything.
							</p>
						</div>
					)}

					{count === 0 ? (
						<p className="text-[13px] text-muted-foreground">
							{isSchema && mode === 'strict'
								? 'Nothing matches the rules. Switch the filter to Warn to see what was hidden and why.'
								: 'No community contributions yet. Be the first — attach a dataset to this Group from its publish screen.'}
						</p>
					) : (
						<div className="space-y-2">
							{visibleRows.map(({ row, dataset, coordinate }) => {
								return (
									<div
										key={row.event.id}
										className="flex items-center justify-between gap-2 border-b border-border py-2"
									>
										<div className="min-w-0 space-y-1">
											<p className="truncate text-[13px] text-muted-foreground">
												{getDatasetName(dataset)}
											</p>
											{row.reason ? (
												<Badge
													variant="outline"
													className="rounded-none border-l-2 border-l-amber-500 text-[10px] text-primary"
												>
													{row.reason}
												</Badge>
											) : isSchema && mode !== 'off' ? (
												// Positive verdict for conforming rows so a schema-filtered row is never
												// silent about WHY it survived (UAT b: Strict survivors need a chip too).
												<Badge
													variant="outline"
													className="rounded-none border-l-2 border-l-emerald-500 text-[10px] text-ok"
												>
													Matches the rules
												</Badge>
											) : null}
										</div>
										<div className="flex items-center gap-1">
											<EntityActionBar
												actions={[
													{
														icon: <Eye className="h-3.5 w-3.5" />,
														label: 'Inspect dataset',
														onClick: () => onInspectDataset(dataset),
													},
													{
														icon: <Maximize2 className="h-3.5 w-3.5" />,
														label: 'Zoom to dataset',
														onClick: () => onZoomToDataset(dataset),
													},
												]}
											/>
											<DropdownMenu>
												<DropdownMenuTrigger asChild>
													<Button
														type="button"
														size="icon-sm"
														variant="outline"
														className="border-border"
														aria-label="Contribution actions"
													>
														<MoreVertical className="h-3.5 w-3.5" />
													</Button>
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													<DropdownMenuItem onClick={() => onInspectDataset(dataset)}>
														Inspect
													</DropdownMenuItem>
													<DropdownMenuItem onClick={() => onZoomToDataset(dataset)}>
														Zoom to
													</DropdownMenuItem>
													{isOwner && onBlessForeign && (
														<DropdownMenuItem onClick={() => onBlessForeign(coordinate)}>
															Add to curated
														</DropdownMenuItem>
													)}
													<DropdownMenuSeparator />
													<DropdownMenuItem onClick={() => handleMute(row.event.pubkey)}>
														Mute {shortName(row.event.pubkey)}
													</DropdownMenuItem>
												</DropdownMenuContent>
											</DropdownMenu>
										</div>
									</div>
								)
							})}
							{hasMore && !showAll && (
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => setShowAll(true)}
									className="rounded-none border-border bg-card px-2 text-xs"
								>
									Load more
								</Button>
							)}
						</div>
					)}
				</CollapsibleContent>
			</Collapsible>
		</EntityPanelSurface>
	)
}
