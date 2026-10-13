/** Small MCP Apps bridge; website embeds never listen for host tool messages. */
export function connectMapHost(
	onResult: (result: unknown) => void,
	onError: (message: string) => void,
) {
	let sequence = 0
	let hostOrigin = '*'
	let ready = false
	const pending = new Map<
		number,
		{
			resolve: (value: unknown) => void
			reject: (error: Error) => void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	const notify = (method: string, params?: unknown) =>
		window.parent.postMessage({ jsonrpc: '2.0', method, params }, hostOrigin)
	const request = (method: string, params: unknown): Promise<unknown> =>
		new Promise((resolve, reject) => {
			const id = ++sequence
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error('The chat host did not respond'))
			}, 10000)
			pending.set(id, { resolve, reject, timer })
			window.parent.postMessage({ jsonrpc: '2.0', id, method, params }, hostOrigin)
		})
	const receive = (event: MessageEvent) => {
		if (event.source !== window.parent || (hostOrigin !== '*' && event.origin !== hostOrigin))
			return
		const message = event.data
		if (!message || message.jsonrpc !== '2.0') return
		const waiting = pending.get(message.id)
		if (waiting && !message.method) {
			if (hostOrigin === '*' && event.origin !== 'null') hostOrigin = event.origin
			clearTimeout(waiting.timer)
			pending.delete(message.id)
			if (message.error) waiting.reject(new Error(message.error.message ?? 'Host request failed'))
			else waiting.resolve(message.result)
			return
		}
		if (!ready) return
		if (message.method === 'ui/notifications/tool-result') onResult(message.params)
		if (message.method === 'ui/notifications/host-context-changed') {
			if (message.params?.displayMode)
				document.body.dataset.displayMode = message.params.displayMode
		}
		if (message.id !== undefined && ['ping', 'ui/resource-teardown'].includes(message.method)) {
			window.parent.postMessage({ jsonrpc: '2.0', id: message.id, result: {} }, hostOrigin)
		}
	}
	window.addEventListener('message', receive)
	void request('ui/initialize', {
		appInfo: { name: 'Earthly map', version: '0.1.0' },
		appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
		protocolVersion: '2026-01-26',
	})
		.then(() => {
			ready = true
			notify('ui/notifications/initialized')
			notify('ui/notifications/size-changed', { height: 560 })
		})
		.catch((error: Error) => onError(error.message))
	return {
		select: (context: Record<string, unknown>) =>
			request('ui/update-model-context', { structuredContent: context }),
		fullscreen: () => request('ui/request-display-mode', { mode: 'fullscreen' }),
		dispose: () => {
			window.removeEventListener('message', receive)
			for (const waiting of pending.values()) {
				clearTimeout(waiting.timer)
				waiting.reject(new Error('Map closed'))
			}
			pending.clear()
		},
	}
}
