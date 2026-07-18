import type { GroupReqMessage } from 'applesauce-relay'
import type { NostrEvent } from 'nostr-tools'
import { useEffect, useMemo, useState } from 'react'
import { eventStore, ingestDeletionEvent, pool, queryCacheStrict } from '@/lib/nostr'
import {
	deletionFiltersForTargets,
	deletionTargetForEvent,
	type DeletionTarget,
	indexDeletionTargets,
	normalizeDeletionTargets,
	verifiedDeletionForTargetIndex,
} from '@/lib/nostr/deletionCache'
import { readRelaysFor } from '@/lib/nostr/relay-router'

const DELETION_EOSE_TIMEOUT_MS = 4_000
const MAX_DELETION_RECORDS = 4_096
const MAX_DELETION_BYTES = 8 * 1024 * 1024
const DELETION_FILTERS_PER_REQUEST = 64
const MAX_DELETION_FILTERS = 512
const MAX_DELETION_FILTER_BYTES = 4 * 1024 * 1024
const UTF8_ENCODER = new TextEncoder()

export function boundedDeletionSyncTimeoutMs(filterCount: number): number {
	const batches = Math.max(1, Math.ceil(filterCount / DELETION_FILTERS_PER_REQUEST))
	return Math.min(30_000, batches * DELETION_EOSE_TIMEOUT_MS)
}

function oldestFirst(events: Iterable<NostrEvent>): NostrEvent[] {
	return [...events].sort(
		(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
	)
}

function relayFailureMessage(message: GroupReqMessage): string | null {
	if (message.type === 'CLOSED') {
		return `A relay closed the deletion check before confirming it${message.reason ? `: ${message.reason}` : ''}`
	}
	if (message.type === 'ERROR') return 'A relay failed while checking deleted Earthly records'
	return null
}

/**
 * Restore NIP-09 state for the exact records represented in a saved-region candidate set.
 *
 * Cache records and relay records received before the local cache completes are buffered
 * and applied oldest-first so multiple address tombstones settle on the newest timestamp.
 * Later relay records join the persistence queue immediately; full readiness still waits
 * for relay EOSE. Requests are constrained by signer and `#e`/`#a` targets, then guarded
 * by a total record/byte ceiling.
 */
export interface SavedRegionDeletionSyncState {
	ready: boolean
	localReady: boolean
	deletions: NostrEvent[]
	error: string | null
}

export function useSavedRegionDeletionSync(
	candidates: readonly NostrEvent[],
	enabled: boolean,
	additionalTargets: readonly DeletionTarget[] = [],
): SavedRegionDeletionSyncState {
	// Canonicalize through a primitive key. Callers frequently construct empty arrays
	// inline; depending on their object identity would restart this effect after every
	// state update and can create a self-sustaining request/render loop.
	const targetKey = useMemo(
		() =>
			JSON.stringify(
				normalizeDeletionTargets([...candidates.map(deletionTargetForEvent), ...additionalTargets]),
			),
		[candidates, additionalTargets],
	)
	const targets = useMemo(() => JSON.parse(targetKey) as DeletionTarget[], [targetKey])
	const filters = useMemo(() => deletionFiltersForTargets(targets), [targets])
	const targetIndex = useMemo(() => indexDeletionTargets(targets), [targets])
	const filterKey = useMemo(() => JSON.stringify(filters), [filters])
	const inputError = useMemo(() => {
		if (filters.length > MAX_DELETION_FILTERS) {
			return 'This area has too many deletion lookups; save a smaller area'
		}
		if (UTF8_ENCODER.encode(filterKey).byteLength > MAX_DELETION_FILTER_BYTES) {
			return 'This area has too much deletion metadata; save a smaller area'
		}
		return null
	}, [filterKey, filters.length])
	const [result, setResult] = useState<{
		key: string
		ready: boolean
		localReady: boolean
		deletions: NostrEvent[]
		error: string | null
	}>({ key: '', ready: false, localReady: false, deletions: [], error: null })

	useEffect(() => {
		const activeFilters = JSON.parse(filterKey) as typeof filters
		if (!enabled || activeFilters.length === 0) {
			setResult({ key: targetKey, ready: true, localReady: true, deletions: [], error: null })
			return undefined
		}
		if (inputError) {
			setResult({
				key: targetKey,
				ready: false,
				localReady: false,
				deletions: [],
				error: inputError,
			})
			return undefined
		}
		const filterBatches = [] as (typeof activeFilters)[]
		for (let offset = 0; offset < activeFilters.length; offset += DELETION_FILTERS_PER_REQUEST) {
			filterBatches.push(activeFilters.slice(offset, offset + DELETION_FILTERS_PER_REQUEST))
		}

		let active = true
		let cacheDone = false
		let cacheFailed = false
		let relaysDone = false
		let localFlushed = false
		let initialFlushed = false
		let syncError: string | null = null
		let receivedRecords = 0
		let receivedBytes = 0
		let queue = Promise.resolve()
		const initialEvents = new Map<string, NostrEvent>()
		const acceptedEvents = new Map<string, NostrEvent>()
		const seenIds = new Set<string>()
		const relays = readRelaysFor('content')
		setResult({
			key: targetKey,
			ready: false,
			localReady: false,
			deletions: [],
			error: null,
		})
		const subscriptions: Array<{ unsubscribe(): void }> = []

		const publishResult = (
			ready: boolean,
			localReady = localFlushed && cacheDone && !cacheFailed,
		) => {
			if (!active) return
			setResult({
				key: targetKey,
				ready,
				localReady,
				deletions: oldestFirst(acceptedEvents.values()),
				error: syncError,
			})
		}

		const fail = (message: string) => {
			if (syncError) return
			syncError = message
			relaysDone = true
			for (const subscription of subscriptions) subscription.unsubscribe()
			publishResult(false)
		}

		const reserve = (event: NostrEvent): boolean => {
			if (seenIds.has(event.id)) return false
			const bytes = UTF8_ENCODER.encode(JSON.stringify(event)).byteLength
			if (
				receivedRecords + 1 > MAX_DELETION_RECORDS ||
				receivedBytes + bytes > MAX_DELETION_BYTES
			) {
				fail('The deletion check exceeded its bounded response budget')
				console.warn('[nostr] targeted deletion sync exceeded its bounded response budget')
				return false
			}
			seenIds.add(event.id)
			receivedRecords += 1
			receivedBytes += bytes
			return true
		}

		const acceptIncoming = (event: NostrEvent): NostrEvent | null => {
			const verified = verifiedDeletionForTargetIndex(event, targetIndex)
			if (!verified || !reserve(verified)) return null
			return verified
		}

		const replayAcceptedOldestFirst = () => {
			// Applesauce's DeleteManager currently overwrites address tombstone timestamps.
			// Replaying every accepted tombstone oldest-first leaves the newest timestamp in
			// memory even when an older relay record arrives after a newer cached record.
			for (const accepted of oldestFirst(acceptedEvents.values())) eventStore.add(accepted)
		}

		const handleQueueFailure = (error: unknown) => {
			fail('Deleted-record state could not be applied safely on this device')
			console.warn('[nostr] deletion sync failed', error)
		}

		const enqueue = (
			event: NostrEvent,
			updateReadiness: boolean,
			replayAfter = updateReadiness,
		) => {
			if (updateReadiness) publishResult(false)
			queue = queue
				.then(() => ingestDeletionEvent(event))
				.then((result) => {
					if (result === 'applied' || result === 'cache-error') {
						acceptedEvents.set(event.id, event)
						if (replayAfter) replayAcceptedOldestFirst()
					}
					if (result === 'cache-error') {
						fail('Deleted-record state could not be stored safely on this device')
					} else if (result === 'invalid') {
						fail('Deleted-record state could not be verified safely on this device')
					}
				})
				.catch(handleQueueFailure)
			const current = queue
			if (updateReadiness) {
				void current.finally(() => {
					if (active && queue === current) publishResult(initialFlushed && syncError === null)
				})
			}
		}

		const enqueueBuffered = (events: readonly NostrEvent[]) => {
			if (events.length === 0) return
			for (const event of events) enqueue(event, false, false)
			queue = queue.then(replayAcceptedOldestFirst).catch(handleQueueFailure)
		}

		const takeInitialEvents = () => {
			const events = oldestFirst(initialEvents.values())
			initialEvents.clear()
			return events
		}

		const flushLocal = () => {
			if (!active || localFlushed || !cacheDone) return
			localFlushed = true
			enqueueBuffered(takeInitialEvents())
			const current = queue
			void current.finally(() => {
				if (active && queue === current) publishResult(false)
			})
		}

		const finishInitial = () => {
			if (!active || initialFlushed || !cacheDone || !relaysDone) return
			flushLocal()
			initialFlushed = true
			enqueueBuffered(takeInitialEvents())
			const current = queue
			void current.finally(() => {
				if (active && queue === current) publishResult(syncError === null)
			})
		}

		if (relays.length > 0) {
			let nextRelayBatch = 0
			const startNextRelayBatch = () => {
				if (!active || syncError) return
				if (nextRelayBatch >= filterBatches.length) {
					relaysDone = true
					finishInitial()
					return
				}
				const batch = filterBatches[nextRelayBatch++] as typeof activeFilters
				const doneRelays = new Set<string>()
				let batchDone = false
				let subscription: { unsubscribe(): void } | null = null
				const finishBatch = () => {
					if (batchDone) return
					batchDone = true
					startNextRelayBatch()
				}
				subscription = pool.req(relays, batch).subscribe({
					next: (message) => {
						if (message.type === 'EVENT') {
							const verified = acceptIncoming(message.event)
							if (!verified) return
							if (localFlushed) enqueue(verified, true)
							else initialEvents.set(verified.id, verified)
							return
						}
						const failure = relayFailureMessage(message)
						if (failure) {
							fail(failure)
							finishInitial()
							return
						}
						if (message.type !== 'EOSE') return
						doneRelays.add(message.from)
						if (doneRelays.size >= relays.length) finishBatch()
					},
					error: (error) => {
						console.warn('[nostr] targeted deletion relay check failed', error)
						fail('A relay failed while checking deleted Earthly records')
						finishInitial()
					},
				})
				if (subscription) subscriptions.push(subscription)
			}
			startNextRelayBatch()
		} else {
			relaysDone = true
		}

		void (async () => {
			try {
				for (const batch of filterBatches) {
					const events = await queryCacheStrict(batch)
					if (!active) return
					for (const event of events) {
						const verified = acceptIncoming(event)
						if (verified) initialEvents.set(verified.id, verified)
					}
					if (syncError) break
				}
			} catch (error) {
				cacheFailed = true
				fail('The local deleted-record cache could not be checked')
				console.warn('[nostr] deletion cache lookup failed', error)
			} finally {
				if (active) {
					cacheDone = true
					flushLocal()
					finishInitial()
				}
			}
		})()

		const timeoutId = setTimeout(() => {
			if (!relaysDone) fail('Timed out while checking deleted Earthly records')
			finishInitial()
		}, boundedDeletionSyncTimeoutMs(activeFilters.length))

		return () => {
			active = false
			clearTimeout(timeoutId)
			for (const subscription of subscriptions) subscription.unsubscribe()
		}
	}, [enabled, filterKey, inputError, targetIndex, targetKey])

	return {
		ready: !enabled || targets.length === 0 || (result.key === targetKey && result.ready),
		localReady: !enabled || targets.length === 0 || (result.key === targetKey && result.localReady),
		deletions: result.key === targetKey ? result.deletions : [],
		error: result.key === targetKey ? result.error : null,
	}
}
