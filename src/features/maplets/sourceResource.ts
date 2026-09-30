import { LIVE_MAPPER_SOURCE_URL } from './liveMapper'
import { isTauri } from '@/config/platform'
import { fetchMyMapsKml, myMapsExportUrl } from './myMaps'

/** Narrow grants: browser-only My Maps exports and the fixed Liveuamap backend feed. */
export async function resolveMapletResource(url: string, signal: AbortSignal): Promise<Blob> {
	// This grant goes directly from the user's browser to Google's public export.
	// It does not use the Liveuamap backend connector or weaken the iframe CSP.
	let googleExport = false
	try {
		googleExport = url === myMapsExportUrl(url)
	} catch {
		/* Not a My Maps export. */
	}
	if (googleExport) return fetchMyMapsKml(url, signal)
	if (url !== LIVE_MAPPER_SOURCE_URL)
		throw new Error(
			'Earthly has not enabled this resource. Use a supported My Maps export or the reviewed Live Mapper feed.',
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
