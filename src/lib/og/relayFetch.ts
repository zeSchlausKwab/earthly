/**
 * The raw, applesauce-free WebSocket relay fetch the OG server read path uses.
 *
 * Extracted from `fetchEvent.ts` (where it was module-private) to its own seam so
 * the OG fetchers (`fetchSightingOGData`, `fetchBeaconOGData`, …) share ONE
 * latest-wins fetch and tests can mock it via `mock.module('@/lib/og/relayFetch')`
 * (the Plan-01 `fetchBeacon.test.ts` contract pins this exact import path).
 */

export interface RelayFetchEvent {
	id: string
	pubkey: string
	created_at: number
	kind: number
	tags: string[][]
	content: string
	sig: string
}

/**
 * Fetch a Nostr event from a relay using WebSocket.
 *
 * WR-05: the OG kinds are parameterized-replaceable, so a relay MAY stream an
 * older version before the newest one. We therefore add an explicit `limit: 1` to
 * the filter AND collect every matching EVENT until EOSE, resolving with the
 * highest-`created_at` event (newest-wins) rather than the first frame that
 * arrives. This prevents the OG card from rendering a superseded (e.g. pre-edit or
 * pre-expiry) snapshot.
 */
export async function fetchEventFromRelay(
	relayUrl: string,
	filter: { kinds: number[]; authors: string[]; '#d': string[] },
	timeoutMs = 5000,
): Promise<RelayFetchEvent | null> {
	// Convert ws:// to http:// for comparison, handle both protocols
	const wsUrl = relayUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')

	return new Promise((resolve) => {
		let newest: RelayFetchEvent | null = null

		const finish = () => {
			clearTimeout(timeout)
			try {
				ws.send(JSON.stringify(['CLOSE', subId]))
			} catch {
				// socket may already be closing — ignore
			}
			ws.close()
			resolve(newest)
		}

		const timeout = setTimeout(finish, timeoutMs)

		const ws = new WebSocket(wsUrl)
		const subId = crypto.randomUUID().slice(0, 8)

		ws.onopen = () => {
			ws.send(JSON.stringify(['REQ', subId, { ...filter, limit: 1 }]))
		}

		ws.onmessage = (msg) => {
			try {
				const data = JSON.parse(msg.data as string)
				if (data[0] === 'EVENT' && data[1] === subId) {
					// Collect until EOSE; keep the highest created_at (newest-wins).
					const event = data[2] as RelayFetchEvent
					if (!newest || event.created_at > newest.created_at) {
						newest = event
					}
				} else if (data[0] === 'EOSE' && data[1] === subId) {
					finish()
				}
			} catch {
				// Ignore parse errors
			}
		}

		ws.onerror = () => {
			clearTimeout(timeout)
			resolve(newest)
		}
	})
}
