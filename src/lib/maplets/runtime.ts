import type { FeatureCollection } from 'geojson'
import { safeHttpsUrl, type VerifiedMaplet } from './artifact'
import { installMapletBridge } from './bridge'
import { validateMapletCollection } from './collection'
import {
	boundedJson,
	isRecord,
	MapletConfigError,
	normalizeMapletConfig,
	saveMapletConfig,
	validateMapletConfigSchema,
	type MapletConfigSchema,
} from './config'
import { cloneMapletWorkspaceJson } from './workspace-json'
import { assertMapletPlatformSupport, prepareMapletHtmlForPlatform } from './nativePolicy'

/** Applied before every byte of applet HTML is parsed. No ambient network or embedded frames. */
export const MAPLET_CSP =
	"default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; worker-src 'none'; child-src 'none'; frame-src 'none'; media-src 'none'; object-src 'none'; manifest-src 'none'; base-uri 'none'; form-action 'none'"
export const MAX_RESOURCE_BYTES = 5 * 1024 * 1024
const RESIZE_INTERVAL_MS = 100
const RESOURCE_ERRORS = new Set([
	'invalid-request',
	'not-found',
	'blocked-by-policy',
	'timeout',
	'too-large',
	'unsupported-scheme',
	'decode-failed',
	'network-error',
	'quota-exceeded',
])

function hasConfigSection(schema: MapletConfigSchema, section: string): boolean {
	return (
		schema['x-napplet-section'] === section ||
		Object.values(schema.properties ?? {}).some((child) => hasConfigSection(child, section))
	)
}

export interface MapletRuntimeOptions {
	iframe: HTMLIFrameElement
	artifact: VerifiedMaplet
	config: Record<string, unknown>
	onCollection: (collection: FeatureCollection, options: { warnings: string[] }) => void
	onError: (error: Error) => void
	/** Must enforce exact source grants and DNS/redirect policy; never a generic browser fetch. */
	resolveResource?: (url: string, signal: AbortSignal) => Promise<Blob>
	onOpenSettings?: (section?: string) => void
	onOpenLink?: (url: string) => boolean | Promise<boolean>
	onConfigSchema?: (schema: MapletConfigSchema, values: Record<string, unknown>) => void
	/** NAP-IDENTITY reports the host account; it never grants signing authority. */
	identityPubkey?: string
	/** Earthly experimental broker. The host must check the signal before account-sensitive writes. */
	onWorkspaceRequest?: (action: string, payload: unknown, signal: AbortSignal) => Promise<unknown>
	onResize?: (height: number) => void
}

export interface MapletRuntime {
	updateConfig(config: Record<string, unknown>): void
	updateIdentity(pubkey: string): void
	notifyWorkspaceChanged(value: unknown): void
	dispose(): void
}

/** Reuse for preinstalled srcdoc and runtime attachment so domain injection stays identical. */
export function getMapletRuntimeDomains(options: Partial<MapletRuntimeOptions> = {}): string[] {
	return [
		'map',
		'config',
		'identity',
		...(options.resolveResource ? ['resource'] : []),
		...(options.onOpenLink ? ['link'] : []),
	]
}

function identityKey(value: string): string {
	if (value !== '' && !/^[0-9a-f]{64}$/i.test(value)) throw new Error('Invalid identity public key')
	return value.toLowerCase()
}

function workspaceValue(value: unknown): unknown {
	return value === undefined ? undefined : cloneMapletWorkspaceJson(value)
}

export function createMapletSrcdoc(
	artifact: VerifiedMaplet,
	domains: string[],
	ownerDocument?: Document,
): string {
	const { html, scriptNonceAttribute } = prepareMapletHtmlForPlatform(artifact, ownerDocument)
	const args = JSON.stringify([domains, artifact.configSchema ?? null]).replaceAll('<', '\\u003c')
	// Starting a host-owned head is intentional: no searching/replacing inside hostile HTML.
	return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${MAPLET_CSP}"><script${scriptNonceAttribute}>(${installMapletBridge.toString()})(...${args})</script></head>${html}`
}

/** Exported pure dispatch seam also enables sender/lifecycle regression tests without a browser. */
export function createMapletDispatcher(
	options: Omit<MapletRuntimeOptions, 'iframe'> & { post(message: Record<string, unknown>): void },
): {
	handle(data: unknown): void
	updateConfig(config: Record<string, unknown>): void
	updateIdentity(pubkey: string): void
	notifyWorkspaceChanged(value: unknown): void
	dispose(): void
} {
	assertMapletPlatformSupport(options.artifact)
	let disposed = false
	let subscribed = false
	let schema = options.artifact.configSchema
	let config = schema
		? normalizeMapletConfig(schema, options.config)
		: (boundedJson(options.config) as Record<string, unknown>)
	let lastLink = 0
	let rateStart = Date.now()
	let resourcesStarted = 0
	let pubkey = identityKey(options.identityPubkey ?? '')
	let lastResize = -Infinity
	let nextHeight = 160
	let resizeTimer: ReturnType<typeof setTimeout> | undefined
	const requests = new Map<string, AbortController>()
	const workspaceRequests = new Set<string>()
	const completed = new Set<string>()
	const post = (message: Record<string, unknown>) => {
		if (!disposed) options.post(message)
	}
	const failure = (error: unknown) =>
		error instanceof Error ? error : new Error('Maplet operation failed')
	const applyResize = () => {
		resizeTimer = undefined
		if (disposed) return
		lastResize = Date.now()
		options.onResize?.(nextHeight)
	}
	const resource = async (url: unknown, signal: AbortSignal): Promise<Blob> => {
		if (typeof url !== 'string' || url.length > 4096) throw new Error('invalid-request')
		if (new URL(url).protocol !== 'https:') throw new Error('unsupported-scheme')
		safeHttpsUrl(url)
		if (!options.resolveResource) throw new Error('blocked-by-policy')
		if (Date.now() - rateStart > 60_000) {
			rateStart = Date.now()
			resourcesStarted = 0
		}
		if (++resourcesStarted > 60) throw new Error('quota-exceeded')
		const blob = await options.resolveResource(url, signal)
		signal.throwIfAborted()
		if (blob.size > MAX_RESOURCE_BYTES) throw new Error('too-large')
		// This first map-data profile permits JSON only. Do not trust upstream MIME or deliver SVG.
		const bytes = await blob.arrayBuffer()
		try {
			JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
		} catch {
			throw new Error('decode-failed')
		}
		return new Blob([bytes], { type: 'application/json' })
	}
	const getValues = (id?: string) => {
		if (!schema) {
			post({
				type: 'config.schemaError',
				code: 'no-schema',
				error: 'No configuration schema is registered',
			})
			if (id) post({ type: 'config.get.error', id, error: 'no-schema' })
			return
		}
		post({ type: 'config.values', ...(id ? { id } : {}), values: config })
	}
	const handle = (data: unknown) => {
		if (disposed || !isRecord(data) || typeof data.type !== 'string') return
		const type = data.type
		if (type === 'map.resize') {
			if (!options.onResize || typeof data.height !== 'number' || !Number.isFinite(data.height))
				return
			nextHeight = Math.min(1800, Math.max(160, Math.ceil(data.height)))
			const delay = RESIZE_INTERVAL_MS - (Date.now() - lastResize)
			if (delay <= 0) {
				if (resizeTimer) clearTimeout(resizeTimer)
				applyResize()
			} else if (!resizeTimer) resizeTimer = setTimeout(applyResize, delay)
			return
		}
		if (type === 'map.error') {
			if (typeof data.message === 'string') options.onError(new Error(data.message.slice(0, 1000)))
			return
		}
		if (type === 'config.subscribe') {
			subscribed = true
			getValues()
			return
		}
		if (type === 'config.unsubscribe') {
			subscribed = false
			return
		}
		if (type === 'config.openSettings') {
			const section = typeof data.section === 'string' ? data.section.slice(0, 128) : undefined
			if (section && (!schema || !hasConfigSection(schema, section))) return
			options.onOpenSettings?.(section)
			return
		}
		if (type === 'resource.cancel') {
			if (typeof data.id === 'string' && requests.has(data.id)) {
				requests.get(data.id)?.abort()
				requests.delete(data.id)
				completed.add(data.id)
			}
			return
		}
		if (
			![
				'map.replace',
				'map.workspace',
				'identity.getPublicKey',
				'config.get',
				'config.registerSchema',
				'resource.bytes',
				'resource.bytesMany',
				'resource.info',
				'link.open',
			].includes(type)
		)
			return
		const id = data.id
		if (typeof id !== 'string' || !id || id.length > 128 || completed.has(id) || requests.has(id))
			return
		// NAP-IDENTITY's startup snapshot always succeeds, including when signed out.
		if (type === 'identity.getPublicKey') {
			post({ type: 'identity.getPublicKey.result', id, pubkey })
			return
		}
		if (requests.size >= 10 || completed.size >= 10_000) {
			post({ type: `${type}.error`, id, error: 'quota-exceeded' })
			return
		}
		const controller = new AbortController()
		requests.set(id, controller)
		if (type === 'map.workspace') workspaceRequests.add(id)
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
		const respond = (message: Record<string, unknown>) => {
			if (!signal.aborted && requests.get(id) === controller) post({ ...message, id })
		}
		void (async () => {
			try {
				switch (type) {
					case 'map.workspace': {
						if (!options.onWorkspaceRequest) throw new Error('blocked-by-policy')
						if (typeof data.action !== 'string' || !data.action || data.action.length > 128)
							throw new Error('invalid-request')
						const value = await options.onWorkspaceRequest(
							data.action,
							workspaceValue(data.payload),
							signal,
						)
						signal.throwIfAborted()
						respond({ type: 'map.workspace.result', value: workspaceValue(value) })
						break
					}
					case 'map.replace': {
						const collection = validateMapletCollection(data.collection)
						if (
							!Array.isArray(data.warnings ?? []) ||
							(data.warnings as unknown[] | undefined)?.some(
								(warning) => typeof warning !== 'string',
							)
						)
							throw new Error('Warnings must be text')
						const warnings = ((data.warnings ?? []) as string[])
							.slice(0, 20)
							.map((value) => value.slice(0, 500))
						options.onCollection(collection, { warnings })
						respond({ type: 'map.replace.result', ok: true })
						break
					}
					case 'config.get':
						getValues(id)
						break
					case 'config.registerSchema': {
						const next = validateMapletConfigSchema(data.schema)
						const values = normalizeMapletConfig(next, config)
						schema = next
						config = values
						options.onConfigSchema?.(next, values)
						respond({ type: 'config.registerSchema.result', ok: true })
						if (subscribed) getValues()
						break
					}
					case 'resource.info':
						respond({
							type: 'resource.info.result',
							info: {
								schemes: [{ scheme: 'https', enabled: !!options.resolveResource }],
								maxBytes: MAX_RESOURCE_BYTES,
								maxUrls: 10,
							},
						})
						break
					case 'resource.bytes': {
						const blob = await resource(data.url, signal)
						respond({ type: 'resource.bytes.result', blob, mime: blob.type })
						break
					}
					case 'resource.bytesMany': {
						if (!Array.isArray(data.urls) || !data.urls.length || data.urls.length > 10)
							throw new Error('invalid-request')
						const items = []
						for (const url of data.urls) {
							try {
								const blob = await resource(url, signal)
								items.push({ url, ok: true, blob, mime: blob.type })
							} catch (error) {
								const message = failure(error).message
								items.push({
									url,
									ok: false,
									error: RESOURCE_ERRORS.has(message) ? message : 'network-error',
									message,
								})
							}
						}
						respond({ type: 'resource.bytesMany.result', items })
						break
					}
					case 'link.open': {
						if (typeof data.url !== 'string') throw new Error('invalid-request')
						const url = safeHttpsUrl(data.url).href
						let opened = false
						if (Date.now() - lastLink > 5000 && options.onOpenLink) {
							lastLink = Date.now()
							opened = await options.onOpenLink(url)
						}
						respond({ type: 'link.open.result', status: opened ? 'opened' : 'denied' })
						break
					}
				}
			} catch (error) {
				if (signal.aborted || disposed) return
				const message = failure(error).message.slice(0, 1000)
				if (type === 'config.registerSchema') {
					const code = error instanceof MapletConfigError ? error.code : 'invalid-schema'
					respond({ type: 'config.registerSchema.result', ok: false, code, error: message })
					post({ type: 'config.schemaError', code, error: message })
				} else if (type === 'link.open')
					respond({ type: 'link.open.result', status: 'denied', error: 'blocked-by-policy' })
				else
					respond({
						type: `${type}.error`,
						error:
							type.startsWith('resource.') && !RESOURCE_ERRORS.has(message)
								? 'network-error'
								: message,
						message,
					})
			} finally {
				if (requests.get(id) === controller) requests.delete(id)
				workspaceRequests.delete(id)
				completed.add(id)
			}
		})()
	}
	return {
		handle,
		updateIdentity(value) {
			if (disposed) return
			const next = identityKey(value)
			if (next === pubkey) return
			pubkey = next
			for (const id of workspaceRequests) {
				requests.get(id)?.abort()
				requests.delete(id)
				completed.add(id)
				post({ type: 'map.workspace.error', id, error: 'identity-changed' })
			}
			workspaceRequests.clear()
			post({ type: 'identity.changed', pubkey })
		},
		notifyWorkspaceChanged(value) {
			if (!disposed && options.onWorkspaceRequest)
				post({ type: 'map.workspaceChanged', value: workspaceValue(value) })
		},
		updateConfig(values) {
			if (disposed) return
			boundedJson(values)
			config = schema
				? normalizeMapletConfig(schema, values)
				: (boundedJson(values) as Record<string, unknown>)
			try {
				saveMapletConfig(options.artifact.identity, config, schema)
			} catch {
				/* In-memory settings remain usable without storage. */
			}
			if (subscribed) getValues()
		},
		dispose() {
			disposed = true
			subscribed = false
			for (const controller of requests.values()) controller.abort()
			requests.clear()
			workspaceRequests.clear()
			completed.clear()
			if (resizeTimer) clearTimeout(resizeTimer)
		},
	}
}

export function startMapletRuntime(options: MapletRuntimeOptions): MapletRuntime {
	assertMapletPlatformSupport(options.artifact)
	const iframe = options.iframe
	const hostWindow = iframe.ownerDocument.defaultView
	if (!hostWindow || !iframe.contentWindow)
		throw new Error('Mount the maplet iframe before starting it')
	const domains = getMapletRuntimeDomains(options)
	const unsupported = options.artifact.requires.filter((domain) => !domains.includes(domain))
	if (unsupported.length)
		throw new Error(`Unsupported maplet capabilities: ${unsupported.join(', ')}`)
	const source = iframe.contentWindow
	const dispatcher = createMapletDispatcher({
		...options,
		post: (message) => source.postMessage(message, '*'),
	})
	const receive = (event: MessageEvent) => {
		if (event.source === source && iframe.contentWindow === source) dispatcher.handle(event.data)
	}
	let disposed = false
	let loaded = false
	const dispose = () => {
		if (disposed) return
		disposed = true
		hostWindow.removeEventListener('message', receive)
		iframe.removeEventListener('load', onLoad)
		dispatcher.dispose()
		iframe.srcdoc = '<!doctype html><title>Maplet stopped</title>'
	}
	const onLoad = () => {
		if (disposed) return
		if (!loaded) {
			loaded = true
			return
		}
		dispose()
		options.onError(new Error('Maplet navigation or reload ended its verified session'))
	}
	hostWindow.addEventListener('message', receive)
	iframe.addEventListener('load', onLoad)
	iframe.setAttribute('sandbox', 'allow-scripts')
	iframe.setAttribute('referrerpolicy', 'no-referrer')
	iframe.removeAttribute('src')
	const srcdoc = createMapletSrcdoc(options.artifact, domains, iframe.ownerDocument)
	// React hosts may preinstall verified srcdoc before insertion to avoid an
	// initial about:blank navigation. Assigning it again would restart that load.
	if (iframe.srcdoc !== srcdoc) iframe.srcdoc = srcdoc
	return {
		updateConfig: dispatcher.updateConfig,
		updateIdentity: dispatcher.updateIdentity,
		notifyWorkspaceChanged: dispatcher.notifyWorkspaceChanged,
		dispose,
	}
}
