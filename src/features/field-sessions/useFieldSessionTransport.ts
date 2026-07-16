import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { getLocalNodeService } from '@/platform/registry'
import type { LocalNodeService, RemoteNodeRecord } from '@/platform/contracts'
import { fieldSessionIdForEvent } from './events'
import { recordFromRemoteNode, upsertFieldSession, type FieldSessionRecord } from './model'

const POLL_INTERVAL_MS = 3_000

function orderEvents(events: NostrEvent[]): NostrEvent[] {
	return [...new Map(events.map((event) => [event.id, event])).values()].sort(
		(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
	)
}

async function acceptedRemote(
	service: LocalNodeService,
	session: FieldSessionRecord,
): Promise<RemoteNodeRecord | null> {
	let remote = (await service.remoteNodes()).find(
		(candidate) => candidate.nodeId === session.hostNodeId,
	)
	if (remote?.status.state === 'pending') {
		try {
			remote = await service.refreshRemoteNode(remote.nodeId)
			const refreshedSession = recordFromRemoteNode(remote)
			if (refreshedSession) upsertFieldSession(refreshedSession)
		} catch {
			return remote
		}
	}
	return remote?.status.state === 'accepted' ? remote : null
}

export function useFieldSessionTransport(session?: FieldSessionRecord) {
	const [events, setEvents] = useState<NostrEvent[]>([])
	const refreshInFlight = useRef(false)

	const refresh = useCallback(async () => {
		if (!session || refreshInFlight.current) return
		refreshInFlight.current = true
		try {
			const service = await getLocalNodeService()
			if (!service.supported) return
			if (session.role === 'participant') {
				const remote = await acceptedRemote(service, session)
				if (remote) {
					const sync = await service.syncRemoteNode(session.hostNodeId)
					for (const event of sync.events as NostrEvent[]) {
						if (verifyEvent(event)) eventStore.add(event)
					}
				}
			}
			const scoped = ((await service.fieldSessionEvents(session.id)) as NostrEvent[]).filter(
				(event) => verifyEvent(event) && fieldSessionIdForEvent(event) === session.id,
			)
			for (const event of scoped) eventStore.add(event)
			setEvents(orderEvents(scoped))
		} catch {
			// A nearby host may disappear between polls. The explicit refresh and
			// the next interval retry without turning normal offline movement into
			// an unhandled promise rejection or a toast loop.
		} finally {
			refreshInFlight.current = false
		}
	}, [session])

	const publishEvent = useCallback(
		async (event: NostrEvent) => {
			if (!session) throw new Error('Open a Field session before saving nearby records')
			if (!verifyEvent(event) || fieldSessionIdForEvent(event) !== session.id) {
				throw new Error('The signed record is not scoped to this Field session')
			}
			const service = await getLocalNodeService()
			if (!service.supported) throw new Error('Field sessions require the Earthly app')
			if (session.role === 'host') {
				await service.ingestLocalEvent(event)
			} else {
				const remote = await acceptedRemote(service, session)
				if (!remote) throw new Error('The field host has not approved this device yet')
				await service.publishRemoteEvent(session.hostNodeId, event)
			}
			eventStore.add(event)
			setEvents((current) => orderEvents([...current, event]))
			await refresh()
		},
		[refresh, session],
	)

	useEffect(() => {
		setEvents([])
		if (!session) return
		void refresh()
		const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [refresh, session])

	return { events, publishEvent, refresh }
}
