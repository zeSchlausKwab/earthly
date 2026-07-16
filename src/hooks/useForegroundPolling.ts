import { useEffect, useRef } from 'react'
import { startForegroundPolling, type ForegroundPoll } from './foregroundPolling'

/**
 * Poll only while the app is visible, then refresh immediately when it returns
 * to the foreground or regains network connectivity. The callback lives in a
 * ref so changing component state does not tear down a healthy timer.
 */
export function useForegroundPolling(
	poll: ForegroundPoll,
	intervalMs: number,
	enabled = true,
): void {
	const pollRef = useRef(poll)

	useEffect(() => {
		pollRef.current = poll
	}, [poll])

	useEffect(() => {
		if (!enabled) return
		return startForegroundPolling(() => pollRef.current(), intervalMs)
	}, [enabled, intervalMs])
}
