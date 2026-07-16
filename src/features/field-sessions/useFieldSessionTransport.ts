import { useCallback, useEffect, useRef, useState } from 'react'
import { verifyEvent, type NostrEvent } from 'nostr-tools'
import { eventStore } from '@/lib/nostr'
import { getLocalNodeService } from '@/platform/registry'
import type { LocalNodeService, RemoteNodeRecord } from '@/platform/contracts'
import { fieldSessionIdForEvent } from './events'
import { recordFromRemoteNode, upsertFieldSession, type FieldSessionRecord } from './model'
import { transitionFieldSessionEventScope } from './transportState'

const POLL_INTERVAL_MS = 3_000

function orderEvents(events: NostrEvent[]): NostrEvent[] {
	return [...new Map(events.map((event) => [event.id, event])).values()].sort(
		(left, right) => left.created_at - right.created_at || left.id.localeCompare(right.id),
	)
}

async function acceptedRemote(
	service: LocalNodeService,
	hostNodeId: string,
): Promise<RemoteNodeRecord | null> {
	let remote = (await service.remoteNodes()).find((candidate) => candidate.nodeId === hostNodeId)
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
	const visibleSessionId = useRef<string>()
	const activeSessionId = useRef(session?.id)
	activeSessionId.current = session?.id
	const sessionId = session?.id
	const sessionRole = session?.role
	const hostNodeId = session?.hostNodeId

	const refresh = useCallback(async () => {
		if (!sessionId || !sessionRole || !hostNodeId || refreshInFlight.current) return
		refreshInFlight.current = true
		try {
			const service = await getLocalNodeService()
			if (!service.supported) return
			if (sessionRole === 'participant') {
				const remote = await acceptedRemote(service, hostNodeId)
				if (remote) {
					const sync = await service.syncRemoteNode(hostNodeId)
					for (const event of sync.events as NostrEvent[]) {
						if (verifyEvent(event)) eventStore.add(event)
					}
				}
			}
			const scoped = ((await service.fieldSessionEvents(sessionId)) as NostrEvent[]).filter(
				(event) => verifyEvent(event) && fieldSessionIdForEvent(event) === sessionId,
			)
			if (activeSessionId.current !== sessionId) return
			for (const event of scoped) eventStore.add(event)
			setEvents(orderEvents(scoped))
		} catch {
			// A nearby host may disappear between polls. The explicit refresh and
			// the next interval retry without turning normal offline movement into
			// an unhandled promise rejection or a toast loop.
		} finally {
			refreshInFlight.current = false
		}
	}, [hostNodeId, sessionId, sessionRole])

	const publishEvent = useCallback(
		async (event: NostrEvent) => {
			if (!sessionId || !sessionRole || !hostNodeId) {
				throw new Error('Open a Field session before saving nearby records')
			}
			if (!verifyEvent(event) || fieldSessionIdForEvent(event) !== sessionId) {
				throw new Error('The signed record is not scoped to this Field session')
			}
			const service = await getLocalNodeService()
			if (!service.supported) throw new Error('Field sessions require the Earthly app')
			if (sessionRole === 'host') {
				await service.ingestLocalEvent(event)
			} else {
				const remote = await acceptedRemote(service, hostNodeId)
				if (!remote) throw new Error('The field host has not approved this device yet')
				await service.publishRemoteEvent(hostNodeId, event)
			}
			eventStore.add(event)
			setEvents((current) => orderEvents([...current, event]))
			await refresh()
		},
		[hostNodeId, refresh, sessionId, sessionRole],
	)

	useEffect(() => {
		setEvents((current) => {
			const transition = transitionFieldSessionEventScope(
				current,
				visibleSessionId.current,
				sessionId,
			)
			visibleSessionId.current = transition.sessionId
			return transition.events
		})
		if (!sessionId) return
		void refresh()
		const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS)
		return () => window.clearInterval(timer)
	}, [refresh, sessionId])

	return { events, publishEvent, refresh }
}
