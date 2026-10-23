import { RelayLiveness, RelayPool } from 'applesauce-relay'
import { guardedWebSocketCtor } from './relay-router'

/** One owner for connections and local health evidence. */
export const pool = new RelayPool({ WebSocket: guardedWebSocketCtor() })
export const relayLiveness = new RelayLiveness()
// Apply filtering explicitly to optional reads. Required publication and deletion
// checks must attempt every destination, even while a relay is in cooldown.
relayLiveness.connectToPool(pool)

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		relayLiveness.destroy()
		pool.close()
	})
}
