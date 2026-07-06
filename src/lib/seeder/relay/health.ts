/**
 * Relay health checks for the seeding pipeline. One implementation — the seed
 * scripts previously carried three near-identical copies.
 */

/**
 * Fail fast with an actionable message if the relay isn't reachable —
 * otherwise a pool publish would hang forever on a down relay.
 */
export function assertRelayReachable(url: string, timeoutMs = 4000): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const ws = new WebSocket(url)
		const close = () => {
			try {
				ws.close()
			} catch {
				// already closed
			}
		}
		const timer = setTimeout(() => {
			close()
			reject(
				new Error(
					`relay not reachable at ${url} within ${Math.round(timeoutMs / 1000)}s. Start it with: bun relay`,
				),
			)
		}, timeoutMs)
		ws.onopen = () => {
			clearTimeout(timer)
			close()
			resolve()
		}
		ws.onerror = () => {
			clearTimeout(timer)
			close()
			reject(new Error(`relay not reachable at ${url}. Start it with: bun relay`))
		}
	})
}

/**
 * Poll until the relay answers a websocket handshake or the deadline passes.
 * Unlike `assertRelayReachable` this never throws — it is the "best effort,
 * publish will fail loudly anyway" variant used between publish retries.
 */
export async function waitForRelay(url: string, timeoutMs = 15_000): Promise<boolean> {
	const start = Date.now()
	while (Date.now() - start < timeoutMs) {
		try {
			await assertRelayReachable(url, 2000)
			return true
		} catch {
			await new Promise((resolve) => setTimeout(resolve, 300))
		}
	}
	return false
}
