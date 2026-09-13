import { LIVE_MAPPER_SOURCE_URL } from './liveMapper'
import { isTauri } from '@/config/platform'

/** Resource grant for the demo: one reviewed feed, acquired by our same-origin backend. */
export async function resolveMapletResource(url: string, signal: AbortSignal): Promise<Blob> {
	if (url !== LIVE_MAPPER_SOURCE_URL)
		throw new Error(
			'Earthly has not enabled this resource. This demo grants access only to the reviewed Live Mapper feed.',
		)
	if (isTauri())
		throw new Error(
			'The source connector is available in the Earthly web app. On this device, choose a JSON file, paste JSON, or follow a published collection.',
		)
	const response = await fetch('/api/maplets/liveuamap-yemen', {
		signal,
		credentials: 'omit',
		headers: { Accept: 'application/json' },
	})
	if (!response.headers.get('content-type')?.includes('application/json')) {
		throw new Error(
			'The Earthly source connector is unavailable on this host. Run the updated Earthly web backend.',
		)
	}
	const data = (await response.json()) as {
		result?: { payload: unknown; fetchedAt: string }
		error?: { message?: string }
	}
	if (!response.ok || !data.result)
		throw new Error(data.error?.message || 'The source request failed.')
	return new Blob([JSON.stringify(data.result.payload)], { type: 'application/json' })
}
