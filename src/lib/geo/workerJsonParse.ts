/**
 * Helper for parsing JSON in a web worker to avoid blocking the main thread.
 * Falls back to synchronous parsing if workers aren't available.
 */

import { workerUrl } from '../workers/workerAssets'
import type { ParseRequest, ParseResponse } from './geoJsonParseWorker'

let worker: Worker | null = null
let workerBroken = false // Track if worker failed to load
let requestId = 0
const pendingRequests = new Map<
	string,
	{ resolve: (data: unknown) => void; reject: (error: Error) => void; text: string }
>()

function getWorker(): Worker | null {
	if (worker) return worker

	// Check if we're in a browser environment with Worker support
	if (typeof Worker === 'undefined') {
		return null
	}

	try {
		// Stable origin-rooted URL served by the dev route / prod build (see workerAssets.ts).
		// The `new Worker(new URL('./x.worker.ts', import.meta.url))` form does NOT resolve to a
		// constructible URL in this app's dev OR prod serving (Bun #17705 / #7534).
		worker = new Worker(workerUrl('geoJsonParse'), { type: 'module' })

		worker.onmessage = (event: MessageEvent<ParseResponse>) => {
			const { id, success, data, error } = event.data
			const pending = pendingRequests.get(id)
			if (!pending) return

			pendingRequests.delete(id)
			if (success) {
				pending.resolve(data)
			} else {
				pending.reject(new Error(error ?? 'Worker parse failed'))
			}
		}

		worker.onerror = (error) => {
			console.warn('GeoJSON parse worker error, falling back to sync parse:', error)
			// Fall back to sync parsing for all pending requests
			for (const [id, pending] of pendingRequests) {
				try {
					const data = JSON.parse(pending.text)
					pending.resolve(data)
				} catch (parseError) {
					pending.reject(parseError as Error)
				}
				pendingRequests.delete(id)
			}
			// Mark worker as broken and terminate
			workerBroken = true
			worker?.terminate()
			worker = null
		}

		return worker
	} catch (error) {
		console.warn('Failed to create GeoJSON parse worker:', error)
		return null
	}
}

/**
 * Parse JSON text using a web worker if available, otherwise synchronously.
 * This prevents UI freezing for large JSON files (10MB+).
 */
export async function parseJsonInWorker<T = unknown>(text: string): Promise<T> {
	// Skip worker entirely if it previously failed to load
	if (workerBroken) {
		return JSON.parse(text) as T
	}

	const w = getWorker()

	// Fall back to sync parsing if worker not available
	if (!w) {
		return JSON.parse(text) as T
	}

	const id = `parse-${++requestId}`

	return new Promise<T>((resolve, reject) => {
		pendingRequests.set(id, {
			resolve: resolve as (data: unknown) => void,
			reject,
			text,
		})

		const request: ParseRequest = { id, text }
		w.postMessage(request)

		// Timeout after 30 seconds - fall back to sync if worker is stuck
		setTimeout(() => {
			if (pendingRequests.has(id)) {
				pendingRequests.delete(id)
				console.warn('Worker parse timeout, falling back to sync')
				try {
					resolve(JSON.parse(text) as T)
				} catch (error) {
					reject(error)
				}
			}
		}, 30000)
	})
}

/**
 * Terminate the worker (useful for cleanup or testing).
 */
export function terminateParseWorker(): void {
	if (worker) {
		worker.terminate()
		worker = null
		pendingRequests.clear()
	}
}
