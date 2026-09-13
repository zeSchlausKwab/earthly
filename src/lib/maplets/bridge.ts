/** This function is serialized into the iframe. It must have no closure dependencies. */
export function installMapletBridge(available: string[], initialSchema: unknown) {
	type Payload = Record<string, unknown>
	const pending = new Map<
		string,
		{
			types: string[]
			resolve(value: Payload): void
			reject(error: Error): void
			timer: ReturnType<typeof setTimeout>
			stop?: () => void
		}
	>()
	const configListeners = new Set<(values: Record<string, unknown>) => void>()
	const schemaListeners = new Set<(error: unknown) => void>()
	const identityListeners = new Set<(pubkey: string) => void>()
	const workspaceListeners = new Set<(value: unknown) => void>()
	let schema = initialSchema
	let sequence = 0
	const send = (message: Payload) => window.parent.postMessage(message, '*')
	const request = (
		type: string,
		payload: Payload = {},
		responseTypes = [`${type}.result`, `${type}.error`],
		signal?: AbortSignal,
	): Promise<Payload> => {
		if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
		const id = `m${++sequence}`
		return new Promise((resolve, reject) => {
			const cancel = () => {
				const entry = pending.get(id)
				if (!entry) return
				pending.delete(id)
				clearTimeout(entry.timer)
				entry.stop?.()
				if (type.startsWith('resource.')) send({ type: 'resource.cancel', id })
				reject(new DOMException('Aborted', 'AbortError'))
			}
			const timer = setTimeout(() => {
				pending.delete(id)
				signal?.removeEventListener('abort', cancel)
				if (type.startsWith('resource.')) send({ type: 'resource.cancel', id })
				reject(new Error('Maplet request timed out'))
			}, 30_000)
			pending.set(id, {
				resolve,
				reject,
				types: responseTypes,
				timer,
				stop: () => signal?.removeEventListener('abort', cancel),
			})
			signal?.addEventListener('abort', cancel, { once: true })
			send({ ...payload, type, id })
		})
	}
	window.addEventListener('message', (event) => {
		if (event.source !== window.parent || !event.data || typeof event.data !== 'object') return
		const message = event.data as Payload
		if (message.type === 'identity.changed' && typeof message.pubkey === 'string') {
			for (const callback of identityListeners) callback(message.pubkey)
			return
		}
		if (message.type === 'map.workspaceChanged') {
			for (const callback of workspaceListeners) callback(message.value)
			return
		}
		if (message.type === 'config.values' && !message.id) {
			for (const callback of configListeners) callback(message.values as Record<string, unknown>)
			return
		}
		if (message.type === 'config.schemaError') {
			for (const callback of schemaListeners)
				callback({ code: message.code, message: message.error })
			return
		}
		const entry = typeof message.id === 'string' ? pending.get(message.id) : undefined
		if (!entry || typeof message.type !== 'string' || !entry.types.includes(message.type)) return
		pending.delete(message.id as string)
		clearTimeout(entry.timer)
		entry.stop?.()
		if ((message.error && message.type !== 'link.open.result') || message.ok === false)
			entry.reject(new Error(String(message.message ?? message.error ?? 'Maplet operation failed')))
		else entry.resolve(message)
	})
	const subscription = (close: () => void) => Object.assign(close, { close })
	const napplet: Payload = {}
	if (available.includes('map'))
		napplet.map = Object.freeze({
			replace: (collection: unknown, options?: { warnings?: string[] }) =>
				request('map.replace', { collection, warnings: options?.warnings ?? [] }).then(
					() => undefined,
				),
			/** Earthly experimental host broker; not a Nostr signing API. */
			workspace: (action: string, payload?: unknown) =>
				request('map.workspace', { action, ...(payload === undefined ? {} : { payload }) }).then(
					(result) => result.value,
				),
			onWorkspaceChanged: (callback: (value: unknown) => void) => {
				workspaceListeners.add(callback)
				return subscription(() => {
					workspaceListeners.delete(callback)
				})
			},
			resize: (height: number) => send({ type: 'map.resize', height }),
		})
	if (available.includes('identity'))
		napplet.identity = Object.freeze({
			getPublicKey: () =>
				request('identity.getPublicKey').then((result) => result.pubkey as string),
			onChanged: (callback: (pubkey: string) => void) => {
				identityListeners.add(callback)
				return subscription(() => {
					identityListeners.delete(callback)
				})
			},
		})
	if (available.includes('config'))
		napplet.config = Object.freeze({
			get: () =>
				request('config.get', {}, ['config.values', 'config.get.error']).then(
					(result) => result.values,
				),
			get schema() {
				return schema
			},
			registerSchema: (next: unknown, version?: number) =>
				request('config.registerSchema', {
					schema: next,
					...(version === undefined ? {} : { version }),
				}).then(() => {
					schema = next
				}),
			subscribe: (callback: (values: Record<string, unknown>) => void) => {
				configListeners.add(callback)
				send({ type: 'config.subscribe' })
				return subscription(() => {
					configListeners.delete(callback)
					if (!configListeners.size) send({ type: 'config.unsubscribe' })
				})
			},
			onSchemaError: (callback: (error: unknown) => void) => {
				schemaListeners.add(callback)
				return subscription(() => {
					schemaListeners.delete(callback)
				})
			},
			openSettings: (options?: { section?: string }) =>
				send({
					type: 'config.openSettings',
					...(options?.section ? { section: options.section } : {}),
				}),
		})
	if (available.includes('resource')) {
		const bytes = (url: string, options?: { signal?: AbortSignal }) =>
			request('resource.bytes', { url }, undefined, options?.signal).then(
				(result) => result.blob as Blob,
			)
		napplet.resource = Object.freeze({
			info: () => request('resource.info').then((result) => result.info),
			bytes,
			bytesMany: (urls: string[], options?: { signal?: AbortSignal }) =>
				request('resource.bytesMany', { urls }, undefined, options?.signal).then(
					(result) => result.items,
				),
			bytesAsObjectURL: async (url: string) => {
				const value = URL.createObjectURL(await bytes(url))
				return { url: value, revoke: () => URL.revokeObjectURL(value) }
			},
		})
	}
	if (available.includes('link'))
		napplet.link = Object.freeze({
			open: (url: string, options?: { label?: string }) =>
				request('link.open', { url, ...(options ? { options } : {}) }).then((result) => ({
					status: result.status,
				})),
		})
	Object.defineProperty(window, 'napplet', {
		value: Object.freeze(napplet),
		writable: false,
		configurable: false,
	})
	window.addEventListener('error', (event) =>
		send({ type: 'map.error', message: String(event.message).slice(0, 1000) }),
	)
	window.addEventListener('unhandledrejection', (event) =>
		send({
			type: 'map.error',
			message: String(event.reason instanceof Error ? event.reason.message : event.reason).slice(
				0,
				1000,
			),
		}),
	)
}
