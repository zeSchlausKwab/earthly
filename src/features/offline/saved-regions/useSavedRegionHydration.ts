import { useEffect, useState } from 'react'
import type { Filter, NostrEvent } from 'nostr-tools'
import { config } from '@/config/env.client'
import { type DeletionIngestResult, eventStore, ingestDeletionEvent, queryCache } from '@/lib/nostr'
import { MAP_LAYER_SET_KIND } from '@/lib/nostr/kinds'
import { readCachedMapLayerSet, writeCachedMapLayerSet } from '@/lib/nostr/map-layer-set/cache'
import {
	deletionFiltersForTargets,
	deletionTargetForEvent,
	deletionTargetsEvent,
	type DeletionTarget,
	normalizeDeletionTargets,
	verifiedDeletionEvent,
} from '@/lib/nostr/deletionCache'
import type { SavedRegionService } from '@/platform/contracts'
import { getSavedRegionService } from '@/platform/registry'

export type SavedRegionHydrationState =
	| { state: 'loading' }
	| { state: 'unsupported' }
	| {
			state: 'ready'
			regions: number
			events: number
			missing: number
			authors: string[]
			deletionTargets: DeletionTarget[]
			incompleteRegionIds: string[]
			deferredRegionIds: string[]
			regionDeletionTargets: Record<string, DeletionTarget[]>
	  }
	| { state: 'failed'; message: string }

const messageFor = (error: unknown) => (error instanceof Error ? error.message : String(error))

export interface SavedRegionHydrationDependencies {
	queryDeletionEvents(filters: Filter[]): Promise<NostrEvent[]>
	ingestDeletion(event: NostrEvent): Promise<DeletionIngestResult>
	ingestNativeDeletion?(event: NostrEvent): Promise<DeletionIngestResult>
	readCachedAnnouncement?(): NostrEvent | null
}

const hydrationDependencies: SavedRegionHydrationDependencies = {
	queryDeletionEvents: queryCache,
	ingestDeletion: ingestDeletionEvent,
	ingestNativeDeletion: (event) => ingestDeletionEvent(event, { retainNative: false }),
	readCachedAnnouncement: () => readCachedMapLayerSet(config.trustedMapnoliaPubkeys),
}

export interface SavedRegionHydrationLimits {
	maxEvents: number
	maxBytes: number
}

const DEFAULT_HYDRATION_LIMITS: SavedRegionHydrationLimits = {
	maxEvents: 20_000,
	maxBytes: 64 * 1024 * 1024,
}
const MAX_HYDRATED_DELETION_EVENTS = 4_096
const MAX_HYDRATED_DELETION_BYTES = 16 * 1024 * 1024
const UTF8_ENCODER = new TextEncoder()

const runtimeSavedDeletionTargets = new Map<string, DeletionTarget[]>()
interface SavedDeletionTargetSnapshot {
	targets: DeletionTarget[]
	byRegion: Record<string, DeletionTarget[]>
}
const savedTargetListeners = new Set<(snapshot: SavedDeletionTargetSnapshot) => void>()

function deletionTargetKey(target: DeletionTarget): string {
	return `${target.pubkey}:${target.eventId}`
}

function storePreferredDeletionTarget(
	targets: Map<string, DeletionTarget>,
	target: DeletionTarget,
): boolean {
	const key = deletionTargetKey(target)
	const current = targets.get(key)
	if (current?.address || (current && !target.address)) return false
	targets.set(key, target)
	return true
}

function mergedSavedDeletionTargets(targets: readonly DeletionTarget[]): DeletionTarget[] {
	const merged = new Map<string, DeletionTarget>()
	for (const regionTargets of runtimeSavedDeletionTargets.values()) {
		for (const target of regionTargets) storePreferredDeletionTarget(merged, target)
	}
	for (const target of normalizeDeletionTargets(targets)) {
		storePreferredDeletionTarget(merged, target)
	}
	return [...merged.values()].sort(
		(left, right) =>
			left.pubkey.localeCompare(right.pubkey) ||
			left.eventId.localeCompare(right.eventId) ||
			(left.address ?? '').localeCompare(right.address ?? ''),
	)
}

function mergedSavedAuthors(
	authors: readonly string[],
	targets: readonly DeletionTarget[],
): string[] {
	return [...new Set([...authors, ...targets.map((target) => target.pubkey)])]
		.filter((pubkey) => /^[0-9a-f]{64}$/u.test(pubkey))
		.sort()
}

function publishSavedRegionDeletionTargets(): void {
	const snapshot = {
		targets: mergedSavedDeletionTargets([]),
		byRegion: Object.fromEntries(runtimeSavedDeletionTargets),
	}
	for (const listener of savedTargetListeners) listener(snapshot)
}

/** Keep process-wide deletion monitoring exact as saved regions are added and removed. */
export function setSavedRegionDeletionTargets(
	regionId: string,
	targets: readonly DeletionTarget[],
): void {
	const normalized = normalizeDeletionTargets(targets)
	const current = runtimeSavedDeletionTargets.get(regionId) ?? []
	if (JSON.stringify(current) === JSON.stringify(normalized)) return
	runtimeSavedDeletionTargets.set(regionId, normalized)
	publishSavedRegionDeletionTargets()
}

export function unregisterSavedRegionDeletionTargets(regionId: string): void {
	if (!runtimeSavedDeletionTargets.delete(regionId)) return
	publishSavedRegionDeletionTargets()
}

/**
 * Hydrate only the signed records named by native saved-region manifests.
 * No relay request and no publish path is involved: the native adapter reads
 * exact immutable snapshots from Earthly's saved-region object store and the
 * web adapter is a truthful no-op.
 */
export async function hydrateSavedRegionEvents(
	service: SavedRegionService,
	dependencies: SavedRegionHydrationDependencies = hydrationDependencies,
	limits: SavedRegionHydrationLimits = DEFAULT_HYDRATION_LIMITS,
): Promise<Exclude<SavedRegionHydrationState, { state: 'loading' }>> {
	if (!service.supported) return { state: 'unsupported' }
	const regions = await service.list()
	let events = 0
	let missing = 0
	const seenEventIds = new Set<string>()
	const durablyIngestedDeletionIds = new Set<string>()
	const verifiedDeletionsByAuthor = new Map<string, NostrEvent[]>()
	const retainedDeletionIds = new Set<string>()
	let retainedDeletionBytes = 0
	const savedAuthors = new Set<string>()
	const savedDeletionTargets = new Map<string, DeletionTarget>()
	const incompleteRegionIds: string[] = []
	const deferredRegionIds: string[] = []
	const regionDeletionTargets: Record<string, DeletionTarget[]> = {}
	let hydratedEventObjects = 0
	let hydratedEventBytes = 0
	const retainVerifiedDeletion = (verified: NostrEvent) => {
		if (retainedDeletionIds.has(verified.id)) return
		const bytes = UTF8_ENCODER.encode(JSON.stringify(verified)).byteLength
		if (
			retainedDeletionIds.size + 1 > MAX_HYDRATED_DELETION_EVENTS ||
			retainedDeletionBytes + bytes > MAX_HYDRATED_DELETION_BYTES
		) {
			throw new Error('Saved-content deletion state exceeds the safe startup memory budget')
		}
		retainedDeletionIds.add(verified.id)
		retainedDeletionBytes += bytes
		const authorDeletions = verifiedDeletionsByAuthor.get(verified.pubkey) ?? []
		authorDeletions.push(verified)
		verifiedDeletionsByAuthor.set(verified.pubkey, authorDeletions)
	}
	const restoreDeletion = async (deletion: NostrEvent, nativePinned = false) => {
		if (durablyIngestedDeletionIds.has(deletion.id)) {
			// Replay only in memory: Applesauce currently overwrites address tombstone
			// timestamps, but native/IDB durability for this exact id is already done.
			eventStore.add(deletion)
			return
		}
		const result = await (nativePinned && dependencies.ingestNativeDeletion
			? dependencies.ingestNativeDeletion(deletion)
			: dependencies.ingestDeletion(deletion))
		if (result !== 'applied') {
			throw new Error('Could not durably restore saved-content deletion state')
		}
		durablyIngestedDeletionIds.add(deletion.id)
	}
	for (const region of regions) {
		const currentRegionTargets = new Map<string, DeletionTarget>()
		const retainRegionTarget = (target: DeletionTarget) => {
			storePreferredDeletionTarget(savedDeletionTargets, target)
			storePreferredDeletionTarget(currentRegionTargets, target)
		}
		const recordRegionTargets = () => {
			regionDeletionTargets[region.id] = [...currentRegionTargets.values()].sort(
				(left, right) =>
					left.pubkey.localeCompare(right.pubkey) ||
					left.eventId.localeCompare(right.eventId) ||
					(left.address ?? '').localeCompare(right.address ?? ''),
			)
		}
		const sourcePubkey = /^[0-9a-f]{64}$/u.test(region.sourcePubkey) ? region.sourcePubkey : null
		const cachedAnnouncement = (
			dependencies.readCachedAnnouncement ?? hydrationDependencies.readCachedAnnouncement
		)?.()
		const sourceDeletionTarget =
			sourcePubkey &&
			cachedAnnouncement?.id === region.announcementId &&
			cachedAnnouncement.pubkey === sourcePubkey
				? deletionTargetForEvent(cachedAnnouncement)
				: sourcePubkey
					? { pubkey: sourcePubkey, eventId: region.announcementId }
					: null
		if (sourcePubkey) {
			savedAuthors.add(sourcePubkey)
			if (sourceDeletionTarget) retainRegionTarget(sourceDeletionTarget)
		}
		const regionHydrations = [] as Awaited<ReturnType<SavedRegionService['events']>>[]
		const nativeRegionDeletions = new Map<string, NostrEvent>()
		const stagedEventIds = new Set<string>()
		let stagedEventBytes = 0
		let cursor = 0
		let deferRegion = false
		while (true) {
			const hydration = await service.events(region.id, cursor)
			const pageEvents = hydration.events as NostrEvent[]
			for (const event of pageEvents) {
				if (event.kind === 5) nativeRegionDeletions.set(event.id, event)
				else retainRegionTarget(deletionTargetForEvent(event))
				if (/^[0-9a-f]{64}$/u.test(event.pubkey)) savedAuthors.add(event.pubkey)
			}
			if (!deferRegion) {
				regionHydrations.push(hydration)
				for (const event of pageEvents) {
					if (seenEventIds.has(event.id) || stagedEventIds.has(event.id)) continue
					stagedEventIds.add(event.id)
					stagedEventBytes += UTF8_ENCODER.encode(JSON.stringify(event)).byteLength
				}
				if (
					hydratedEventObjects + stagedEventIds.size > limits.maxEvents ||
					hydratedEventBytes + stagedEventBytes > limits.maxBytes
				) {
					deferRegion = true
					regionHydrations.length = 0
					stagedEventIds.clear()
					stagedEventBytes = 0
				}
			}
			if (hydration.nextCursor === null) break
			cursor = hydration.nextCursor
			await new Promise<void>((resolve) => setTimeout(resolve, 0))
		}
		// Native-pinned tombstones are independent of the ordinary startup memory
		// budget. Restore every one before any target from this manifest, even when
		// the region itself must remain deferred.
		for (const deletion of [...nativeRegionDeletions.values()].sort(
			(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
		)) {
			if (seenEventIds.has(deletion.id)) continue
			const verified = verifiedDeletionEvent(deletion)
			if (!verified) {
				throw new Error('A retained saved-content deletion has an invalid signature')
			}
			seenEventIds.add(verified.id)
			retainVerifiedDeletion(verified)
			await restoreDeletion(verified, true)
		}
		if (deferRegion) {
			deferredRegionIds.push(region.id)
			recordRegionTargets()
			continue
		}
		hydratedEventObjects += stagedEventIds.size
		hydratedEventBytes += stagedEventBytes

		let regionMissing = 0
		for (const hydration of regionHydrations) {
			missing += hydration.missingEventIds.length
			regionMissing += hydration.missingEventIds.length
			const pageEvents = hydration.events as NostrEvent[]
			const pageAuthors = [
				...new Set([
					...pageEvents.map((event) => event.pubkey),
					...(sourcePubkey ? [sourcePubkey] : []),
				]),
			]
				.filter((pubkey) => /^[0-9a-f]{64}$/u.test(pubkey))
				.sort()
			for (const author of pageAuthors) savedAuthors.add(author)
			const pageDeletionTargets = pageEvents
				.filter((event) => event.kind !== 5)
				.map(deletionTargetForEvent)
			if (sourceDeletionTarget) pageDeletionTargets.push(sourceDeletionTarget)
			for (const target of pageDeletionTargets) {
				retainRegionTarget(target)
			}

			const deletionFilters = deletionFiltersForTargets(pageDeletionTargets)
			const cachedDeletions =
				deletionFilters.length > 0 ? await dependencies.queryDeletionEvents(deletionFilters) : []
			for (const deletion of cachedDeletions) {
				const verified = verifiedDeletionEvent(deletion)
				if (!verified) continue
				retainVerifiedDeletion(verified)
			}
			// Replay the complete known set for these authors oldest-first. Applesauce
			// currently overwrites address-tombstone timestamps, so a newly-discovered
			// older deletion must always be followed by the newer one before page events.
			for (const deletion of pageAuthors
				.flatMap((author) => verifiedDeletionsByAuthor.get(author) ?? [])
				.sort(
					(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
				)) {
				await restoreDeletion(deletion)
			}

			for (const event of pageEvents) {
				if (seenEventIds.has(event.id)) continue
				seenEventIds.add(event.id)
				if (
					verifiedDeletionsByAuthor
						.get(event.pubkey)
						?.some((deletion) => deletionTargetsEvent(deletion, event))
				) {
					continue
				}
				eventStore.add(event)
				// EventStore.add returns its input even when DeleteManager rejects it. Read
				// the store back before counting it or promoting an announcement to cache.
				const stored = eventStore.getEvent(event.id)
				if (stored?.id !== event.id) continue
				events += 1
				if (event.kind === MAP_LAYER_SET_KIND && event.id === region.announcementId) {
					writeCachedMapLayerSet(stored, config.trustedMapnoliaPubkeys)
				}
			}
		}
		if (regionMissing > 0) incompleteRegionIds.push(region.id)
		recordRegionTargets()
	}
	return {
		state: 'ready',
		regions: regions.length,
		events,
		missing,
		authors: [...savedAuthors].sort(),
		deletionTargets: [...savedDeletionTargets.values()].sort(
			(left, right) =>
				left.pubkey.localeCompare(right.pubkey) ||
				left.eventId.localeCompare(right.eventId) ||
				(left.address ?? '').localeCompare(right.address ?? ''),
		),
		incompleteRegionIds,
		deferredRegionIds,
		regionDeletionTargets,
	}
}

let startupHydration: Promise<Exclude<SavedRegionHydrationState, { state: 'loading' }>> | null =
	null

function startHydration() {
	startupHydration ??= getSavedRegionService()
		.then(hydrateSavedRegionEvents)
		.then((result) => {
			if (result.state !== 'ready') return result
			for (const [regionId, targets] of Object.entries(result.regionDeletionTargets)) {
				setSavedRegionDeletionTargets(regionId, targets)
			}
			const deletionTargets = mergedSavedDeletionTargets(result.deletionTargets)
			return {
				...result,
				authors: mergedSavedAuthors(result.authors, deletionTargets),
				deletionTargets,
			}
		})
		.catch((error) => ({ state: 'failed' as const, message: messageFor(error) }))
	return startupHydration
}

/** Run native saved-content hydration once per app process. */
export function useSavedRegionHydration(): SavedRegionHydrationState {
	const [state, setState] = useState<SavedRegionHydrationState>({ state: 'loading' })
	useEffect(() => {
		let active = true
		const updateTargets = (snapshot: SavedDeletionTargetSnapshot) => {
			if (!active) return
			setState((current) => {
				if (current.state !== 'ready') return current
				const deletionTargets = normalizeDeletionTargets(snapshot.targets)
				return {
					...current,
					authors: mergedSavedAuthors(current.authors, deletionTargets),
					deletionTargets,
					regionDeletionTargets: snapshot.byRegion,
				}
			})
		}
		savedTargetListeners.add(updateTargets)
		void startHydration().then((result) => {
			if (!active) return
			if (result.state !== 'ready') {
				setState(result)
				return
			}
			const deletionTargets = mergedSavedDeletionTargets(result.deletionTargets)
			setState({
				...result,
				authors: mergedSavedAuthors(result.authors, deletionTargets),
				deletionTargets,
			})
		})
		return () => {
			active = false
			savedTargetListeners.delete(updateTargets)
		}
	}, [])
	return state
}
