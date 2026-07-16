export interface ForegroundPollingEnvironment {
	isVisible(): boolean
	setInterval(callback: () => void, intervalMs: number): unknown
	clearInterval(handle: unknown): void
	onVisibilityChange(callback: () => void): () => void
	onOnline(callback: () => void): () => void
}

export type ForegroundPoll = () => void | Promise<void>

function browserEnvironment(): ForegroundPollingEnvironment {
	return {
		isVisible: () => document.visibilityState !== 'hidden',
		setInterval: (callback, intervalMs) => window.setInterval(callback, intervalMs),
		clearInterval: (handle) => window.clearInterval(handle as number),
		onVisibilityChange: (callback) => {
			document.addEventListener('visibilitychange', callback)
			return () => document.removeEventListener('visibilitychange', callback)
		},
		onOnline: (callback) => {
			window.addEventListener('online', callback)
			return () => window.removeEventListener('online', callback)
		},
	}
}

export function startForegroundPolling(
	poll: ForegroundPoll,
	intervalMs: number,
	environment: ForegroundPollingEnvironment = browserEnvironment(),
): () => void {
	let timer: unknown = null
	const stopTimer = () => {
		if (timer !== null) environment.clearInterval(timer)
		timer = null
	}
	const run = () => {
		try {
			void Promise.resolve(poll()).catch(() => undefined)
		} catch {
			// Polling is best effort. User-triggered actions surface their own errors.
		}
	}
	const startTimer = () => {
		stopTimer()
		if (!environment.isVisible()) return
		run()
		timer = environment.setInterval(run, intervalMs)
	}
	const unsubscribeVisibility = environment.onVisibilityChange(startTimer)
	const unsubscribeOnline = environment.onOnline(() => {
		if (environment.isVisible()) run()
	})
	startTimer()

	return () => {
		stopTimer()
		unsubscribeVisibility()
		unsubscribeOnline()
	}
}
