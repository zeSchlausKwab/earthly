import { z } from 'zod'

/** A single reviewed feed; callers cannot choose hosts, query strings or credentials. */
export const MAPLET_FEED_SOURCE_URL =
	'https://yemen.liveuamap.com/ajax/do?act=acornice&time=1789297855&resid=53&lang=en&isUserReg=0'
export const MAPLET_FEED_MAX_BYTES = 2 * 1024 * 1024
const CACHE_MS = 60_000
const FAILURE_CACHE_MS = 15_000
const TIMEOUT_MS = 15_000

export const mapletFeedInputSchema = { feed: z.literal('liveuamap-yemen') }
export const mapletFeedOutputSchema = {
	result: z.object({
		feed: z.literal('liveuamap-yemen'),
		sourceUrl: z.literal(MAPLET_FEED_SOURCE_URL),
		payload: z.record(z.string(), z.unknown()),
		fetchedAt: z.string(),
		capturedAt: z.null(),
		attribution: z.literal('Liveuamap'),
		cached: z.boolean(),
	}).optional(),
	error: z.object({ code: z.string(), message: z.string(), retryable: z.boolean() }).optional(),
}

export type MapletFeedResult = {
	feed: 'liveuamap-yemen'
	sourceUrl: typeof MAPLET_FEED_SOURCE_URL
	payload: Record<string, unknown>
	/** Acquisition time only. The meaning of the source's fixed time parameter is unverified. */
	fetchedAt: string
	capturedAt: null
	attribution: 'Liveuamap'
	cached: boolean
}

export class MapletFeedError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly retryable = false,
	) {
		super(message)
		this.name = 'MapletFeedError'
	}
}

type FetchFeed = (url: string, init: RequestInit) => Promise<Response>

/** Dependency injection keeps tests entirely local and gives each test its own cache. */
export function createMapletFeedConnector(options: {
	fetch?: FetchFeed
	now?: () => number
	timeoutMs?: number
} = {}) {
	const fetchFeed = options.fetch ?? fetch
	const now = options.now ?? Date.now
	let cached: { result: MapletFeedResult; expiresAt: number } | undefined
	let failure: { error: MapletFeedError; expiresAt: number } | undefined
	let pending: Promise<MapletFeedResult> | undefined

	async function acquire(): Promise<MapletFeedResult> {
		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS)
		try {
			const response = await fetchFeed(MAPLET_FEED_SOURCE_URL, {
				method: 'GET',
				headers: { Accept: 'application/json', 'User-Agent': 'Earthly Maplet Feed Connector' },
				redirect: 'manual',
				credentials: 'omit',
				signal: controller.signal,
			})
			if (response.status >= 300 && response.status < 400) {
				await response.body?.cancel()
				throw new MapletFeedError('redirect_denied', 'The configured feed redirected. Its new endpoint must be reviewed before use.')
			}
			if (response.headers.get('cf-mitigated') === 'challenge') {
				await response.body?.cancel()
				throw new MapletFeedError('upstream_challenge', 'Liveuamap requires a browser challenge. The connector cannot fetch this feed; use the captured sample or an authorized data endpoint.')
			}
			const length = Number(response.headers.get('content-length'))
			if (Number.isFinite(length) && length > MAPLET_FEED_MAX_BYTES) {
				await response.body?.cancel()
				throw new MapletFeedError('response_too_large', 'The feed exceeds the 2 MiB limit. No partial data was returned.')
			}
			const reader = response.body?.getReader()
			const chunks: Uint8Array[] = []
			let total = 0
			if (reader) {
				try {
					while (true) {
						const { done, value } = await reader.read()
						if (done) break
						total += value.byteLength
						if (total > MAPLET_FEED_MAX_BYTES) {
							await reader.cancel()
							throw new MapletFeedError('response_too_large', 'The feed exceeds the 2 MiB limit. No partial data was returned.')
						}
						chunks.push(value)
					}
				} finally {
					reader.releaseLock()
				}
			}
			const bytes = new Uint8Array(total)
			let offset = 0
			for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
			const body = new TextDecoder().decode(bytes)
			if (/^\s*</u.test(body) && /cloudflare|cf-chl-|just a moment|challenge-platform/iu.test(body)) {
				throw new MapletFeedError('upstream_challenge', 'Liveuamap requires a browser challenge. The connector cannot fetch this feed; use the captured sample or an authorized data endpoint.')
			}
			if (!response.ok) {
				throw new MapletFeedError('upstream_http_error', `Liveuamap returned HTTP ${response.status}.`, response.status === 429 || response.status >= 500)
			}
			let payload: unknown
			try { payload = JSON.parse(body) } catch {
				throw new MapletFeedError('invalid_json', 'Liveuamap returned a non-JSON response. No partial data was returned.')
			}
			if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
				throw new MapletFeedError('invalid_payload', 'Liveuamap returned an unexpected feed structure; a keyed record object is required.')
			}
			return {
				feed: 'liveuamap-yemen', sourceUrl: MAPLET_FEED_SOURCE_URL,
				payload: payload as Record<string, unknown>, fetchedAt: new Date(now()).toISOString(),
				capturedAt: null, attribution: 'Liveuamap', cached: false,
			}
		} catch (error) {
			if (error instanceof MapletFeedError) throw error
			if (controller.signal.aborted) throw new MapletFeedError('timeout', 'Liveuamap did not respond within the connector timeout.', true)
			throw new MapletFeedError('network_error', 'The backend could not reach Liveuamap.', true)
		} finally {
			clearTimeout(timer)
		}
	}

	return async function getMapletFeed(input: { feed: 'liveuamap-yemen' }): Promise<MapletFeedResult> {
		if (input.feed !== 'liveuamap-yemen') throw new MapletFeedError('unsupported_feed', 'This connector only supports the Liveuamap Yemen feed.')
		if (cached && now() < cached.expiresAt) return structuredClone({ ...cached.result, cached: true })
		if (failure && now() < failure.expiresAt) throw failure.error
		if (!pending) {
			pending = acquire().then(result => {
				cached = { result, expiresAt: now() + CACHE_MS }
				failure = undefined
				return result
			}).catch((error: MapletFeedError) => {
				failure = { error, expiresAt: now() + FAILURE_CACHE_MS }
				throw error
			}).finally(() => { pending = undefined })
		}
		return structuredClone(await pending)
	}
}

export const getMapletFeed = createMapletFeedConnector()
