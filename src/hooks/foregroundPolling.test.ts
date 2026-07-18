import { describe, expect, it } from 'bun:test'
import { startForegroundPolling, type ForegroundPollingEnvironment } from './foregroundPolling'

function environment() {
	let visible = true
	let interval: (() => void) | null = null
	let visibilityListener: (() => void) | null = null
	let onlineListener: (() => void) | null = null
	let cleared = 0
	const value: ForegroundPollingEnvironment = {
		isVisible: () => visible,
		setInterval: (callback) => {
			interval = callback
			return callback
		},
		clearInterval: () => {
			interval = null
			cleared += 1
		},
		onVisibilityChange: (callback) => {
			visibilityListener = callback
			return () => {
				visibilityListener = null
			}
		},
		onOnline: (callback) => {
			onlineListener = callback
			return () => {
				onlineListener = null
			}
		},
	}
	return {
		value,
		interval: () => interval,
		setVisible(next: boolean) {
			visible = next
			visibilityListener?.()
		},
		goOnline: () => onlineListener?.(),
		cleared: () => cleared,
		listeners: () => ({ visibilityListener, onlineListener }),
	}
}

describe('foreground polling', () => {
	it('pauses while hidden and refreshes immediately on resume and network return', () => {
		const fake = environment()
		let polls = 0
		const stop = startForegroundPolling(
			() => {
				polls += 1
			},
			3_000,
			fake.value,
		)

		expect(polls).toBe(1)
		fake.interval()?.()
		expect(polls).toBe(2)

		fake.setVisible(false)
		expect(fake.interval()).toBeNull()
		fake.goOnline()
		expect(polls).toBe(2)

		fake.setVisible(true)
		expect(polls).toBe(3)
		fake.goOnline()
		expect(polls).toBe(4)

		stop()
		expect(fake.interval()).toBeNull()
		expect(fake.listeners()).toEqual({ visibilityListener: null, onlineListener: null })
		expect(fake.cleared()).toBeGreaterThanOrEqual(2)
	})
})
