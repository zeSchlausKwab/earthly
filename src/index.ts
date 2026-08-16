import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { hexToBytes } from '@noble/hashes/utils.js'
import { file, serve } from 'bun'
import type { FeatureCollection } from 'geojson'
import { nip19 } from 'nostr-tools'
import { getPublicKey } from 'nostr-tools/pure'
import { serverConfig } from './config/env.server'
import {
	getBuiltFileHeaders,
	getMissingAssetHeaders,
	isBrowserAssetPath,
} from './lib/http/staticAssetHeaders'
import { GEO_EVENT_KIND } from './lib/nostr/kinds'
import { buildWorkerSource } from './lib/workers/buildWorker'
import { WORKER_ASSETS, type WorkerId } from './lib/workers/workerAssets'
import {
	isCrawler,
	generateHomeOGHtml,
	generateGeoEventOGHtml,
	generateContextOGHtml,
	generateBeaconOGHtml,
	generateSightingOGHtml,
	generateStoryOGHtml,
	fetchCachedGeoEventOGData,
	fetchCachedContextEventOGData,
	fetchCachedBeaconEventOGData,
	fetchCachedSightingEventOGData,
	fetchCachedStoryEventOGData,
	createOGImageVersion,
	getOGImageHeaders,
	getOGRouteHeaders,
	getOrCreateOGImage,
	getPublicBaseUrl,
	generateOGImagePNG,
	OG_IMAGE_RENDER_VERSION,
	parseOGImageVersion,
	resolveOGGeoBlobReferences,
	type GeoEventOGData,
	type OGCacheStatus,
	type OGCacheType,
	type OGImageOptions,
} from './lib/og'

const isProduction = process.env.NODE_ENV === 'production'
const NIP05_DOCUMENT_PATH = join(process.cwd(), 'src', '.well-known', 'nostr.json')
const NIP05_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Cache-Control': 'public, max-age=300',
	'Content-Type': 'application/json; charset=utf-8',
} as const

console.log(`Starting server in ${isProduction ? 'production' : 'development'} mode`)
console.log(`NODE_ENV: ${process.env.NODE_ENV}`)

// Get the expected pubkey for migration auth
const APP_PRIVATE_KEY = process.env.APP_PRIVATE_KEY
const EXPECTED_PUBKEY = APP_PRIVATE_KEY ? getPublicKey(hexToBytes(APP_PRIVATE_KEY)) : undefined

type BunRouteRequest = Request & { params: Record<string, string> }
type BunRouteResponse = Response | Promise<Response>
type BunRoute =
	| ((req: BunRouteRequest) => BunRouteResponse)
	| Partial<
			Record<
				'GET' | 'POST' | 'PUT' | 'DELETE' | 'OPTIONS',
				(req: BunRouteRequest) => BunRouteResponse
			>
	  >

interface ReferencedMapPreview {
	featureCollection?: FeatureCollection
	bbox?: [number, number, number, number]
	eventIds: string[]
}

function datasetAddressToNaddr(address: string): string | null {
	if (address.startsWith('naddr1')) {
		try {
			const decoded = nip19.decode(address)
			return decoded.type === 'naddr' && decoded.data.kind === GEO_EVENT_KIND ? address : null
		} catch {
			return null
		}
	}
	const match = address.match(/^(\d+):([0-9a-f]{64}):(.+)$/u)
	if (!match?.[1] || !match[2] || !match[3] || Number(match[1]) !== GEO_EVENT_KIND) return null
	return nip19.naddrEncode({
		kind: GEO_EVENT_KIND,
		pubkey: match[2],
		identifier: match[3],
		relays: [serverConfig.relayUrl],
	})
}

function mergeBboxes(
	bboxes: Array<[number, number, number, number] | undefined>,
): [number, number, number, number] | undefined {
	const defined = bboxes.filter(
		(bbox): bbox is [number, number, number, number] => bbox !== undefined,
	)
	if (defined.length === 0) return undefined
	return [
		Math.min(...defined.map((bbox) => bbox[0])),
		Math.min(...defined.map((bbox) => bbox[1])),
		Math.max(...defined.map((bbox) => bbox[2])),
		Math.max(...defined.map((bbox) => bbox[3])),
	]
}

async function resolveDatasetPreviewGeometry(
	dataset: GeoEventOGData,
): Promise<FeatureCollection | undefined> {
	if (!dataset.blobReferences?.length) return dataset.featureCollection
	const resolved = await resolveOGGeoBlobReferences(
		dataset.featureCollection ?? { type: 'FeatureCollection', features: [] },
		dataset.blobReferences,
	)
	return resolved.totalFeatureCount > 0 ? resolved.featureCollection : dataset.featureCollection
}

async function resolveReferencedMap(
	addresses: string[],
	resolveExternalGeometry = false,
): Promise<ReferencedMapPreview> {
	const naddrs = addresses
		.map(datasetAddressToNaddr)
		.filter((value): value is string => value !== null)
		.slice(0, 4)
	if (naddrs.length === 0) return { eventIds: [] }

	const resolved = await Promise.all(
		naddrs.map((naddr) =>
			fetchCachedGeoEventOGData(naddr, serverConfig.relayUrl, { waitForFreshMs: 2500 }),
		),
	)
	const datasets = resolved.flatMap(({ data }) => (data ? [data] : []))
	const previewCollections = resolveExternalGeometry
		? await Promise.all(datasets.map(resolveDatasetPreviewGeometry))
		: datasets.map((dataset) => dataset.featureCollection)
	const features = previewCollections
		.flatMap((featureCollection) => featureCollection?.features ?? [])
		.slice(0, 600)

	return {
		featureCollection: features.length > 0 ? { type: 'FeatureCollection', features } : undefined,
		bbox: mergeBboxes(datasets.map((dataset) => dataset.bbox)),
		eventIds: datasets.map((dataset) => dataset.eventId).sort(),
	}
}

function createPreviewIdentity(
	primaryEventId: string | undefined,
	dependencyIds: string[],
): string | undefined {
	if (!primaryEventId || dependencyIds.length === 0) return primaryEventId
	return createHash('sha256')
		.update([primaryEventId, ...dependencyIds].join(':'))
		.digest('hex')
}

/**
 * Get base URL from request for OG tags
 */
function getBaseUrl(req: Request): string {
	return getPublicBaseUrl(req, serverConfig.publicBaseUrl)
}

/**
 * Serve a built file with an explicit `Content-Type` for extensions that browsers
 * are strict about. WebAssembly streaming compilation
 * (`WebAssembly.instantiateStreaming`) REQUIRES `application/wasm` — without it the
 * QuickJS code-interpreter sandbox (Phase 4) fails to instantiate in the browser.
 */
function serveBuiltFile(builtFile: ReturnType<typeof file>, pathname: string): Response {
	return new Response(builtFile, { headers: getBuiltFileHeaders(pathname) })
}

/**
 * Serve a stable metadata document for every clean dataset URL. The document
 * redirects browsers into the hash-based SPA, but does not rely on a brittle
 * crawler user-agent allow-list to decide whether metadata is present.
 */
async function handleGeoEventRoute(req: BunRouteRequest): Promise<Response> {
	const naddr = req.params.naddr ?? ''
	const commentId = req.params.commentId ?? ''
	const baseUrl = getBaseUrl(req)

	if (!naddr) {
		return Response.redirect(baseUrl, 302)
	}

	const { data, cacheStatus } = await fetchCachedGeoEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 3000,
	})
	const redirectUrl = commentId
		? `${baseUrl}/#/datasets/geoevent/${naddr}/comment/${commentId}`
		: undefined
	const html = generateGeoEventOGHtml(
		baseUrl,
		naddr,
		data?.title ?? 'Geographic Dataset',
		data?.description ?? 'View this geographic dataset on Earthly',
		undefined,
		data?.eventId,
		redirectUrl,
	)
	return new Response(html, {
		headers: getOGRouteHeaders(cacheStatus),
	})
}

/**
 * Handle /context/:naddr with stable metadata plus an SPA redirect.
 */
async function handleContextRoute(req: BunRouteRequest): Promise<Response> {
	const naddr = req.params.naddr ?? ''
	const commentId = req.params.commentId ?? ''
	const baseUrl = getBaseUrl(req)

	if (!naddr) {
		return Response.redirect(baseUrl, 302)
	}

	const { data, cacheStatus } = await fetchCachedContextEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 3000,
	})
	const redirectUrl = commentId
		? `${baseUrl}/#/contexts/mapcontext/${naddr}/comment/${commentId}`
		: undefined
	const referencedMap = data?.image
		? { eventIds: [] }
		: await resolveReferencedMap(data?.referencedAddresses ?? [])
	const imageIdentity = createPreviewIdentity(data?.eventId, referencedMap.eventIds)
	const html = generateContextOGHtml(
		baseUrl,
		naddr,
		data?.title ?? 'Map Context',
		data?.description ?? 'Explore this geographic context on Earthly',
		undefined,
		imageIdentity,
		redirectUrl,
	)
	return new Response(html, {
		headers: getOGRouteHeaders(cacheStatus),
	})
}

/**
 * Handle /story/:naddr with stable metadata plus an SPA redirect (D-04).
 */
async function handleStoryRoute(req: BunRouteRequest): Promise<Response> {
	const naddr = req.params.naddr ?? ''
	const commentId = req.params.commentId ?? ''
	const baseUrl = getBaseUrl(req)

	if (!naddr) {
		return Response.redirect(baseUrl, 302)
	}

	const { data, cacheStatus } = await fetchCachedStoryEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 3000,
	})
	const redirectUrl = commentId
		? `${baseUrl}/#/stories/story/${naddr}/comment/${commentId}`
		: undefined
	const referencedMap = data?.image
		? { eventIds: [] }
		: await resolveReferencedMap(data?.referencedAddresses ?? [])
	const imageIdentity = createPreviewIdentity(data?.eventId, referencedMap.eventIds)
	const html = generateStoryOGHtml(
		baseUrl,
		naddr,
		data?.title ?? 'Story',
		data?.description ?? 'Read this story on Earthly',
		undefined,
		imageIdentity,
		redirectUrl,
	)
	return new Response(html, {
		headers: getOGRouteHeaders(cacheStatus),
	})
}

/**
 * Handle /sighting/:naddr — OG HTML for crawlers (D-08), redirect for users.
 *
 * SIGHT-03 (Pitfall P-1): the underlying `fetchSightingOGData` independently
 * checks the NIP-40 `expiration` tag and returns null for an expired sighting, so
 * a crawl of an expired/removed sighting renders the generic fallback card — the
 * sighting's title/description are never leaked.
 */
async function handleSightingRoute(req: BunRouteRequest): Promise<Response> {
	const naddr = req.params.naddr ?? ''
	const commentId = req.params.commentId ?? ''
	const baseUrl = getBaseUrl(req)

	if (!naddr) {
		return Response.redirect(baseUrl, 302)
	}

	const { data, cacheStatus } = await fetchCachedSightingEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 3000,
	})
	const redirectUrl = commentId
		? `${baseUrl}/#/sightings/sighting/${naddr}/comment/${commentId}`
		: undefined
	const html = generateSightingOGHtml(
		baseUrl,
		naddr,
		data?.title ?? 'Sighting',
		data?.description ?? 'See this sighting on Earthly',
		data?.eventId,
		redirectUrl,
	)
	return new Response(html, {
		headers: getOGRouteHeaders(cacheStatus),
	})
}

/**
 * Handle /beacon/:naddr — OG HTML for crawlers (D-11), redirect for users. A thin
 * per-kind clone of handleSightingRoute (Phase 13 / XCUT-02 owns generalization).
 *
 * T-12-05-OGLEAK (Pitfall P-1): the underlying `fetchBeaconOGData` independently
 * checks the NIP-40 `expiration` tag and returns null for an expired beacon, so a
 * crawl of an expired/removed beacon renders the generic fallback card — the
 * beacon's label is never leaked. The share naddr carries the THROWAWAY pubkey
 * (the beacon is not under the user's profile, D-05); the fetch resolves it by
 * `{ kind, pubkey, #d }`.
 */
async function handleBeaconRoute(req: BunRouteRequest): Promise<Response> {
	const naddr = req.params.naddr ?? ''
	const commentId = req.params.commentId ?? ''
	const baseUrl = getBaseUrl(req)

	if (!naddr) {
		return Response.redirect(baseUrl, 302)
	}

	const { data, cacheStatus } = await fetchCachedBeaconEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 3000,
	})
	const redirectUrl = commentId
		? `${baseUrl}/#/beacons/beacon/${naddr}/comment/${commentId}`
		: undefined
	const html = generateBeaconOGHtml(
		baseUrl,
		naddr,
		data?.title ?? 'Live location',
		data?.description ?? 'Live location — may have ended. Watch it on Earthly.',
		data?.eventId,
		redirectUrl,
	)
	return new Response(html, {
		headers: getOGRouteHeaders(cacheStatus),
	})
}

/**
 * Handle /og/image/:type/:naddr — generate and serve a PNG OG image
 */
interface OGImageModel {
	primaryEventId?: string
	imageIdentity?: string
	cacheStatus: OGCacheStatus
	options: OGImageOptions
}

class OGImageVersionUnavailableError extends Error {}

function isOGCacheType(value: string): value is OGCacheType {
	return ['context', 'geoevent', 'story', 'sighting', 'beacon'].includes(value)
}

async function resolveOGImageModel(type: OGCacheType, naddr: string): Promise<OGImageModel> {
	if (type === 'context') {
		const { data, cacheStatus } = await fetchCachedContextEventOGData(
			naddr,
			serverConfig.relayUrl,
			{ waitForFreshMs: 1500 },
		)
		const referencedMap = data?.image
			? { eventIds: [] }
			: await resolveReferencedMap(data?.referencedAddresses ?? [], true)
		return {
			primaryEventId: data?.eventId,
			imageIdentity: createPreviewIdentity(data?.eventId, referencedMap.eventIds),
			cacheStatus,
			options: {
				title: data?.title ?? 'Map Context',
				description: data?.description ?? 'Explore this geographic context on Earthly',
				backgroundImageUrl: data?.image,
				featureCollection: referencedMap.featureCollection,
				bbox: referencedMap.bbox ?? data?.bbox,
			},
		}
	}

	if (type === 'geoevent') {
		const { data, cacheStatus } = await fetchCachedGeoEventOGData(naddr, serverConfig.relayUrl, {
			waitForFreshMs: 1500,
		})
		return {
			primaryEventId: data?.eventId,
			imageIdentity: data?.eventId,
			cacheStatus,
			options: {
				title: data?.title ?? 'Geographic Dataset',
				description: data?.description ?? 'View this geographic dataset on Earthly',
				featureCollection: data ? await resolveDatasetPreviewGeometry(data) : undefined,
				bbox: data?.bbox,
			},
		}
	}

	if (type === 'story') {
		const { data, cacheStatus } = await fetchCachedStoryEventOGData(naddr, serverConfig.relayUrl, {
			waitForFreshMs: 1500,
		})
		const referencedMap = data?.image
			? { eventIds: [] }
			: await resolveReferencedMap(data?.referencedAddresses ?? [], true)
		return {
			primaryEventId: data?.eventId,
			imageIdentity: createPreviewIdentity(data?.eventId, referencedMap.eventIds),
			cacheStatus,
			options: {
				title: data?.title ?? 'Story',
				description: data?.description ?? 'Read this story on Earthly',
				backgroundImageUrl: data?.image,
				featureCollection: referencedMap.featureCollection,
				bbox: referencedMap.bbox ?? data?.bbox,
			},
		}
	}

	if (type === 'sighting') {
		const { data, cacheStatus } = await fetchCachedSightingEventOGData(
			naddr,
			serverConfig.relayUrl,
			{ waitForFreshMs: 1500 },
		)
		return {
			primaryEventId: data?.eventId,
			imageIdentity: data?.eventId,
			cacheStatus,
			options: {
				title: data?.title ?? 'Sighting',
				description: data?.description ?? 'See this sighting on Earthly',
			},
		}
	}

	const { data, cacheStatus } = await fetchCachedBeaconEventOGData(naddr, serverConfig.relayUrl, {
		waitForFreshMs: 1500,
	})
	return {
		primaryEventId: data?.eventId,
		imageIdentity: data?.eventId,
		cacheStatus,
		options: {
			title: data?.title ?? 'Live location',
			description: data?.description ?? 'Live location — may have ended.',
		},
	}
}

async function handleOGImageRoute(req: BunRouteRequest): Promise<Response> {
	const { type: rawType, naddr, version } = req.params
	if (!naddr || !rawType || !isOGCacheType(rawType)) {
		return new Response('Not found', { status: 404 })
	}
	const type = rawType
	const requestedVersion = version ? parseOGImageVersion(version) : null
	if (version && !requestedVersion) return new Response('Not found', { status: 404 })

	try {
		if (requestedVersion && version) {
			let metadataCacheStatus: OGCacheStatus | undefined
			const result = await getOrCreateOGImage({
				type,
				version,
				render: async () => {
					const model = await resolveOGImageModel(type, naddr)
					metadataCacheStatus = model.cacheStatus
					if (
						(model.imageIdentity !== requestedVersion.eventId &&
							model.primaryEventId !== requestedVersion.eventId) ||
						requestedVersion.rendererVersion !== OG_IMAGE_RENDER_VERSION
					) {
						throw new OGImageVersionUnavailableError()
					}
					return generateOGImagePNG(model.options)
				},
			})
			return new Response(new Uint8Array(result.png).buffer, {
				headers: getOGImageHeaders(metadataCacheStatus, result.cacheStatus),
			})
		}

		const model = await resolveOGImageModel(type, naddr)
		const currentVersion = createOGImageVersion(model.imageIdentity)
		if (currentVersion) {
			const result = await getOrCreateOGImage({
				type,
				version: currentVersion,
				render: () => generateOGImagePNG(model.options),
			})
			return new Response(new Uint8Array(result.png).buffer, {
				headers: getOGImageHeaders(model.cacheStatus, result.cacheStatus),
			})
		}

		const png = await generateOGImagePNG(model.options)
		if (!png) return new Response('Image generation failed', { status: 500 })
		return new Response(new Uint8Array(png).buffer, {
			headers: getOGImageHeaders(model.cacheStatus),
		})
	} catch (err) {
		if (err instanceof OGImageVersionUnavailableError) {
			return new Response('Image version is not available', { status: 404 })
		}
		console.error('[OG image route] Error:', err)
		return new Response('Internal server error', { status: 500 })
	}
}

// Define route handlers that work in both modes
const apiRoutes: Record<string, BunRoute> = {
	// NIP-05 (§ "Allowing access from JavaScript apps") requires wildcard CORS.
	// Keeping this as an exact route also guarantees that the well-known request
	// never falls through to the SPA index or an HTTP redirect.
	'/.well-known/nostr.json': async () => {
		const document = file(NIP05_DOCUMENT_PATH)
		if (!(await document.exists())) {
			return new Response('Not found', { status: 404, headers: NIP05_HEADERS })
		}
		return new Response(document, { headers: NIP05_HEADERS })
	},
	'/api/hello': {
		async GET(_req: BunRouteRequest) {
			return Response.json({
				message: 'Hello, world!',
				method: 'GET',
			})
		},
		async PUT(_req: BunRouteRequest) {
			return Response.json({
				message: 'Hello, world!',
				method: 'PUT',
			})
		},
	},

	'/api/app-pubkey': {
		async GET() {
			return Response.json({
				pubkey: EXPECTED_PUBKEY || null,
			})
		},
	},
}

// Add debug endpoints in development only
if (!isProduction) {
	apiRoutes['/api/debug/pubkey'] = {
		async GET(_req: BunRouteRequest) {
			return Response.json({
				hasPrivateKey: !!APP_PRIVATE_KEY,
				expectedPubkey: EXPECTED_PUBKEY || 'NOT SET',
				nodeEnv: process.env.NODE_ENV,
			})
		},
	}
}
// Start server
;(async () => {
	// Serve static files from public/static/ (stable URLs, no hashing)
	const serveStaticFile = async (req: Request): Promise<Response> => {
		const url = new URL(req.url)
		const staticFile = file(join(process.cwd(), 'public', url.pathname))
		if (await staticFile.exists()) {
			return serveBuiltFile(staticFile, url.pathname)
		}
		return new Response('Not found', { status: 404, headers: getMissingAssetHeaders() })
	}

	if (isProduction) {
		// Stable public entity/OG routes (production only).
		const ogRoutes: Record<string, BunRoute> = {
			'/geoevent/:naddr': handleGeoEventRoute,
			'/geoevent/:naddr/comment/:commentId': handleGeoEventRoute,
			'/context/:naddr': handleContextRoute,
			'/context/:naddr/comment/:commentId': handleContextRoute,
			'/story/:naddr': handleStoryRoute,
			'/story/:naddr/comment/:commentId': handleStoryRoute,
			'/sighting/:naddr': handleSightingRoute,
			'/sighting/:naddr/comment/:commentId': handleSightingRoute,
			'/beacon/:naddr': handleBeaconRoute,
			'/beacon/:naddr/comment/:commentId': handleBeaconRoute,
			'/og/image/:type/:naddr/:version': handleOGImageRoute,
			'/og/image/:type/:naddr': handleOGImageRoute,
		}

		// Production: Serve static files from dist/ and public/
		const port = Number.parseInt(process.env.PORT ?? '3000', 10)
		const server = serve({
			port: Number.isFinite(port) ? port : 3000,
			routes: {
				...apiRoutes,
				...ogRoutes,
				// Explicit static file route for stable URLs
				'/static/*': serveStaticFile,
				'/*': async (req) => {
					const url = new URL(req.url)

					// Check for crawler on home page
					if (url.pathname === '/' && isCrawler(req)) {
						const baseUrl = getBaseUrl(req)
						const html = generateHomeOGHtml(baseUrl)
						return new Response(html, {
							headers: getBuiltFileHeaders('/index.html'),
						})
					}

					const pathname = url.pathname === '/' ? '/index.html' : url.pathname

					// Try to serve from public/ first (for static assets like images)
					const publicPath = join(process.cwd(), 'public', pathname)
					const publicFile = file(publicPath)

					if (await publicFile.exists()) {
						return serveBuiltFile(publicFile, pathname)
					}

					// Try to serve from dist/ (built assets)
					const filePath = join(process.cwd(), 'dist', pathname)
					const staticFile = file(filePath)

					if (await staticFile.exists()) {
						return serveBuiltFile(staticFile, pathname)
					}

					// Assets that must NEVER fall through to the SPA index.html: a missing
					// script/wasm/style served as text/html produces the opaque
					// "Expected a JavaScript-or-Wasm module script" failure instead of a
					// debuggable 404. Route paths (naddr segments, d-tags) never end in
					// these extensions, so this cannot shadow client-side routes.
					if (isBrowserAssetPath(pathname)) {
						return new Response('Not found', {
							status: 404,
							headers: getMissingAssetHeaders(),
						})
					}

					// If file not found, serve index.html for client-side routing
					return serveBuiltFile(file(join(process.cwd(), 'dist', 'index.html')), '/index.html')
				},
			},
		})

		console.log(`🚀 Server running at ${server.url} (production)`)
	} else {
		// Development: Use Bun's bundler with HMR
		// Assets in src/assets/ are bundled automatically by Bun
		const index = (await import('./index.html')).default

		// Web Workers (sandbox / ingest / geoJsonParse). Bun's HTML-import dev server
		// does NOT bundle/serve workers spawned via `new Worker(new URL('./x.worker.ts',
		// import.meta.url))` (Bun #17705): `import.meta.url` becomes a file:// source path
		// the browser blocks cross-origin. Spawn sites instead request a stable URL
		// (`/workers/<name>.js`, see workerAssets.ts); here we build that worker on demand
		// and serve it as a JS module. Cached per served-name (the sandbox spawns a fresh
		// Worker PER RUN, so an uncached rebuild-per-spawn would be far too slow).
		const devWorkerCache = new Map<string, Promise<string>>()
		const workerSourceByServedName = new Map<string, string>(
			(Object.keys(WORKER_ASSETS) as WorkerId[]).map((id) => [
				WORKER_ASSETS[id].servedName,
				WORKER_ASSETS[id].sourcePath,
			]),
		)

		const serveDevWorker = async (req: BunRouteRequest): Promise<Response> => {
			const servedName = req.params.name ?? ''
			const sourcePath = workerSourceByServedName.get(servedName)
			if (!sourcePath) {
				return new Response('Unknown worker', {
					status: 404,
					headers: getMissingAssetHeaders(),
				})
			}
			try {
				let pending = devWorkerCache.get(servedName)
				if (!pending) {
					// dev: unminified for readable stack traces.
					pending = buildWorkerSource(sourcePath, false)
					devWorkerCache.set(servedName, pending)
				}
				const js = await pending
				return new Response(js, {
					headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
				})
			} catch (err) {
				devWorkerCache.delete(servedName)
				console.error(`[dev worker] build failed for ${servedName}:`, err)
				return new Response(`/* worker build failed: ${String(err)} */`, {
					status: 500,
					headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
				})
			}
		}

		// The QuickJS code-interpreter sandbox (Phase 4) loads its `.wasm` from a
		// stable root URL. In production `build.ts` emits it to `dist/`; in dev there
		// is no build, so serve it straight from node_modules with the correct MIME.
		const serveQuickjsWasm = (): Response => {
			const wasmFile = file(
				join(
					process.cwd(),
					'node_modules',
					'@jitl',
					'quickjs-wasmfile-release-sync',
					'dist',
					'emscripten-module.wasm',
				),
			)
			return new Response(wasmFile, {
				headers: {
					'Content-Type': 'application/wasm',
					// Cache the fixed wasm blob so a worker (re)spawn never re-downloads it
					// (defence-in-depth against the Phase 4 wasm re-fetch runaway).
					'Cache-Control': 'public, max-age=31536000, immutable',
				},
			})
		}

		const port = Number.parseInt(process.env.PORT ?? '3000', 10)
		const server = serve({
			port: Number.isFinite(port) ? port : 3000,
			routes: {
				...apiRoutes,
				// Serve static files from public/static/ (stable URLs for OG images, etc.)
				'/static/*': serveStaticFile,
				// Web Workers built on demand (Bun dev server doesn't bundle workers itself).
				'/workers/:name': serveDevWorker,
				// QuickJS sandbox WASM (served from node_modules in dev).
				'/emscripten-module.wasm': serveQuickjsWasm,
				// Catch-all for SPA routing (Bun handles assets from src/assets/)
				'/*': index,
			},

			development: {
				hmr: true,
				console: true,
			},
		})

		console.log(`🚀 Server running at ${server.url} (development)`)
	}
})()
