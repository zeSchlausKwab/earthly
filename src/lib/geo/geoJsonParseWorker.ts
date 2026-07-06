/**
 * Web Worker for parsing large GeoJSON blobs off the main thread.
 * This prevents UI freezing during JSON.parse() of multi-MB files.
 */

import { isWorkerScope } from '@/lib/isWorkerScope'

export interface ParseRequest {
	id: string
	text: string
}

export interface ParseResponse {
	id: string
	success: boolean
	data?: unknown
	error?: string
}

// Only register when running as an actual Worker. On the main thread `self === window`,
// so an unconditional `self.onmessage = …` would install `window.onmessage` and create a
// message → postMessage runaway loop if this module is ever value-imported there. See
// `isWorkerScope`.
if (isWorkerScope()) {
	self.onmessage = (event: MessageEvent<ParseRequest>) => {
		const { id, text } = event.data

		try {
			const data = JSON.parse(text)
			const response: ParseResponse = { id, success: true, data }
			self.postMessage(response)
		} catch (error) {
			const response: ParseResponse = {
				id,
				success: false,
				error: error instanceof Error ? error.message : 'JSON parse failed',
			}
			self.postMessage(response)
		}
	}
}
