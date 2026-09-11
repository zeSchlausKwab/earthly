import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'

export const installIsolatedRelaysTask: AiTaskMetadata = {
	id: 'setup.isolated-relays',
	summary:
		'Keep relay subscriptions and publication acknowledgements entirely inside a test browser.',
	preconditions: ['Fresh loopback Earthly session'],
	sideEffects: ['Intercepts WebSockets; no relay events leave the browser'],
	viewports: 'both',
}

export async function installIsolatedRelays(earthly: EarthlySession) {
	const publishedEvents = new Map<string, number>()
	await earthly.page.routeWebSocket(/wss?:\/\//, (socket) => {
		socket.onMessage((message) => {
			try {
				const frame = JSON.parse(String(message))
				if (frame[0] === 'REQ') socket.send(JSON.stringify(['EOSE', frame[1]]))
				if (frame[0] === 'EVENT') {
					publishedEvents.set(frame[1].id, frame[1].kind)
					socket.send(JSON.stringify(['OK', frame[1].id, true, 'fixture']))
				}
			} catch {
				// Bun HMR is not a relay.
			}
		})
	})
	return publishedEvents
}
