import { describe, expect, test } from 'bun:test'
import { prepareBundledMaplet } from './artifact'
import { validateMapletCollection } from './collection'
import {
	createMapletDispatcher,
	createMapletSrcdoc,
	getMapletRuntimeDomains,
	startMapletRuntime,
} from './runtime'

const schema = {
	type: 'object' as const,
	properties: { enabled: { type: 'boolean' as const, default: true } },
}
const point = {
	type: 'Feature',
	id: 'point',
	geometry: { type: 'Point', coordinates: [16, 48] },
	properties: { name: 'Test' },
}
const collection = { type: 'FeatureCollection', features: [point] }
const artifact = () =>
	prepareBundledMaplet({
		id: 'test',
		html: '<script>/* fixture */</script>',
		configSchema: schema,
		requires: ['map', 'config'],
	})

describe('maplet host boundary', () => {
	test('validates geometry/properties, rejects duplicate IDs including numeric/string collisions', () => {
		expect(validateMapletCollection(collection).features).toHaveLength(1)
		expect(() =>
			validateMapletCollection({
				...collection,
				features: [{ ...point, geometry: { type: 'Point', coordinates: [Infinity, 0] } }],
			}),
		).toThrow('coordinate')
		expect(() =>
			validateMapletCollection({
				...collection,
				features: [
					{ ...point, id: 1 },
					{ ...point, id: '1' },
				],
			}),
		).toThrow('Duplicate')
		expect(() =>
			validateMapletCollection({
				...collection,
				features: [{ ...point, properties: JSON.parse('{"__proto__":{}}') }],
			}),
		).toThrow('Unsafe')
	})
	test('responds once per request and sends configuration only to active subscribers', async () => {
		const messages: Record<string, unknown>[] = []
		let replacements = 0
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			post: (value) => messages.push(value),
			onCollection: () => {
				replacements++
			},
			onError: () => {},
		})
		dispatcher.handle({ type: 'map.replace', id: 'replace', collection })
		dispatcher.handle({ type: 'map.replace', id: 'replace', collection })
		expect(replacements).toBe(1)
		expect(messages[0]).toMatchObject({ type: 'map.replace.result', id: 'replace', ok: true })
		dispatcher.handle({ type: 'config.subscribe' })
		expect(messages.at(-1)).toEqual({ type: 'config.values', values: { enabled: true } })
		dispatcher.updateConfig({ enabled: false })
		expect(messages.at(-1)).toEqual({ type: 'config.values', values: { enabled: false } })
		dispatcher.handle({ type: 'config.unsubscribe' })
		const count = messages.length
		dispatcher.updateConfig({ enabled: true })
		dispatcher.handle({ type: 'unknown.action', id: 'unknown' })
		expect(messages).toHaveLength(count)
		dispatcher.dispose()
	})
	test('preserves saved values until dynamic schema registration and rejects untrusted schema execution', async () => {
		const messages: Record<string, unknown>[] = []
		const dispatcher = createMapletDispatcher({
			artifact: await prepareBundledMaplet({ id: 'dynamic', html: '' }),
			config: { enabled: false },
			post: (value) => messages.push(value),
			onCollection: () => {},
			onError: () => {},
		})
		dispatcher.handle({ type: 'config.get', id: 'before' })
		expect(messages.some((value) => value.type === 'config.values')).toBe(false)
		dispatcher.handle({ type: 'config.registerSchema', id: 'register', schema })
		dispatcher.handle({ type: 'config.get', id: 'after' })
		expect(messages.at(-1)).toMatchObject({
			type: 'config.values',
			id: 'after',
			values: { enabled: false },
		})
		dispatcher.handle({
			type: 'config.registerSchema',
			id: 'bad',
			schema: { type: 'object', properties: { evil: { $ref: 'https://evil.test/' } } },
		})
		expect(messages.at(-1)).toMatchObject({ type: 'config.schemaError', code: 'ref-not-allowed' })
		dispatcher.dispose()
	})
	test('cancels resources and drops late results after unmount', async () => {
		const messages: Record<string, unknown>[] = []
		let resourceSignal: AbortSignal | undefined
		let finish: ((value: Blob) => void) | undefined
		const task = new Promise<Blob>((resolve) => {
			finish = resolve
		})
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			post: (value) => messages.push(value),
			onCollection: () => {},
			onError: () => {},
			resolveResource: (_url, signal) => {
				resourceSignal = signal
				return task
			},
		})
		dispatcher.handle({ type: 'resource.bytes', id: 'bytes', url: 'https://example.com/data' })
		dispatcher.dispose()
		expect(resourceSignal?.aborted).toBe(true)
		finish?.(new Blob(['{}']))
		await task
		await Promise.resolve()
		expect(messages).toEqual([])
	})
	test('sniffs JSON without trusting upstream MIME and denies active SVG', async () => {
		const artifactValue = await artifact()
		for (const [bytes, mime, expected] of [
			['{}', 'text/html', 'resource.bytes.result'],
			['<svg onload="alert(1)"/>', 'application/json', 'resource.bytes.error'],
		]) {
			let dispatcher: ReturnType<typeof createMapletDispatcher> | undefined
			const response = new Promise<Record<string, unknown>>((resolve) => {
				dispatcher = createMapletDispatcher({
					artifact: artifactValue,
					config: {},
					post: resolve,
					onCollection: () => {},
					onError: () => {},
					resolveResource: async () => new Blob([bytes ?? ''], { type: mime }),
				})
				dispatcher.handle({
					type: 'resource.bytes',
					id: 'request',
					url: 'https://example.com/data',
				})
			})
			const message = await response
			expect(message.type).toBe(expected)
			if (expected?.endsWith('result'))
				expect((message.blob as Blob).type.split(';')[0]).toBe('application/json')
			dispatcher?.dispose()
		}
	})
	test('checks event.source and revokes the session on an unexpected second load', async () => {
		const host = new EventTarget()
		const source = { postMessage: () => {} }
		const frame = Object.assign(new EventTarget(), {
			contentWindow: source,
			ownerDocument: { defaultView: host },
			srcdoc: '',
			setAttribute: () => {},
			removeAttribute: () => {},
		})
		let collections = 0
		const errors: Error[] = []
		const runtime = startMapletRuntime({
			iframe: frame as unknown as HTMLIFrameElement,
			artifact: await artifact(),
			config: {},
			onCollection: () => {
				collections++
			},
			onError: (error) => errors.push(error),
		})
		const message = (sender: unknown, id: string) =>
			host.dispatchEvent(
				Object.assign(new Event('message'), {
					source: sender,
					data: { type: 'map.replace', id, collection },
				}),
			)
		message({}, 'foreign')
		expect(collections).toBe(0)
		message(source, 'ours')
		expect(collections).toBe(1)
		frame.dispatchEvent(new Event('load'))
		frame.dispatchEvent(new Event('load'))
		message(source, 'navigated')
		expect(collections).toBe(1)
		expect(errors[0]?.message).toContain('navigation')
		runtime.dispose()
	})
	test('attaching to a preinstalled verified document does not cause another navigation', async () => {
		const verified = await artifact()
		let document = createMapletSrcdoc(verified, getMapletRuntimeDomains())
		let navigations = 0
		const frame = Object.assign(new EventTarget(), {
			contentWindow: { postMessage: () => {} },
			ownerDocument: { defaultView: new EventTarget() },
			setAttribute: () => {},
			removeAttribute: () => {},
		})
		Object.defineProperty(frame, 'srcdoc', {
			get: () => document,
			set: (value: string) => {
				document = value
				navigations++
			},
		})
		const errors: Error[] = []
		const runtime = startMapletRuntime({
			iframe: frame as unknown as HTMLIFrameElement,
			artifact: verified,
			config: {},
			onCollection: () => {},
			onError: (error) => errors.push(error),
		})
		expect(navigations).toBe(0)
		frame.dispatchEvent(new Event('load'))
		expect(errors).toEqual([])
		frame.dispatchEvent(new Event('load'))
		expect(errors).toHaveLength(1)
		expect(navigations).toBe(1)
		runtime.dispose()
	})
	test('link denials use NAP-LINK result status and do not open forbidden URLs', async () => {
		const messages: Record<string, unknown>[] = []
		let opens = 0
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			post: (value) => messages.push(value),
			onCollection: () => {},
			onError: () => {},
			onOpenLink: () => {
				opens++
				return true
			},
		})
		dispatcher.handle({ type: 'link.open', id: 'bad', url: 'javascript:alert(1)' })
		expect(opens).toBe(0)
		expect(messages[0]).toMatchObject({ type: 'link.open.result', id: 'bad', status: 'denied' })
		dispatcher.dispose()
	})
	test('identity snapshots and mandatory changes report host accounts without granting publishing', async () => {
		const messages: Record<string, unknown>[] = []
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			post: (value) => messages.push(value),
			onCollection: () => {},
			onError: () => {},
		})
		dispatcher.handle({ type: 'identity.getPublicKey', id: 'signed-out' })
		expect(messages.at(-1)).toEqual({
			type: 'identity.getPublicKey.result',
			id: 'signed-out',
			pubkey: '',
		})
		const pubkey = 'ab'.repeat(32)
		dispatcher.updateIdentity(pubkey)
		expect(messages.at(-1)).toEqual({ type: 'identity.changed', pubkey })
		const count = messages.length
		dispatcher.updateIdentity(pubkey)
		expect(messages).toHaveLength(count)
		dispatcher.handle({ type: 'identity.getPublicKey', id: 'signed-in' })
		expect(messages.at(-1)).toEqual({
			type: 'identity.getPublicKey.result',
			id: 'signed-in',
			pubkey,
		})
		dispatcher.handle({ type: 'map.workspace', id: 'denied', action: 'publish' })
		expect(messages.at(-1)).toMatchObject({
			type: 'map.workspace.error',
			id: 'denied',
			error: 'blocked-by-policy',
		})
		dispatcher.updateIdentity('')
		expect(messages.at(-1)).toEqual({ type: 'identity.changed', pubkey: '' })
		dispatcher.dispose()
		const finalCount = messages.length
		dispatcher.updateIdentity(pubkey)
		dispatcher.notifyWorkspaceChanged({ changed: true })
		expect(messages).toHaveLength(finalCount)
	})
	test('workspace requests are bounded, account-cancelled, and cannot deliver late results', async () => {
		const messages: Record<string, unknown>[] = []
		const signals: AbortSignal[] = []
		const resolvers: ((value: unknown) => void)[] = []
		const jobs: Promise<unknown>[] = []
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			identityPubkey: 'ab'.repeat(32),
			post: (value) => messages.push(value),
			onCollection: () => {},
			onError: () => {},
			onWorkspaceRequest: (_action, _payload, signal) => {
				signals.push(signal)
				const job = new Promise<unknown>((resolve) => resolvers.push(resolve))
				jobs.push(job)
				return job
			},
		})
		dispatcher.handle({
			type: 'map.workspace',
			id: 'bad',
			action: 'save',
			payload: JSON.parse('{"__proto__":{}}'),
		})
		expect(signals).toHaveLength(0)
		expect(messages.at(-1)).toMatchObject({ type: 'map.workspace.error', id: 'bad' })
		dispatcher.handle({
			type: 'map.workspace',
			id: 'old-account',
			action: 'save',
			payload: { title: 'Draft' },
		})
		dispatcher.updateIdentity('cd'.repeat(32))
		expect(signals[0]?.aborted).toBe(true)
		expect(messages.at(-2)).toEqual({
			type: 'map.workspace.error',
			id: 'old-account',
			error: 'identity-changed',
		})
		const count = messages.length
		resolvers[0]?.({ private: 'old account' })
		await jobs[0]
		await Promise.resolve()
		expect(messages).toHaveLength(count)
		dispatcher.handle({ type: 'map.workspace', id: 'new-account', action: 'list' })
		resolvers[1]?.({ drafts: [] })
		await jobs[1]
		await Promise.resolve()
		expect(messages.at(-1)).toEqual({
			type: 'map.workspace.result',
			id: 'new-account',
			value: { drafts: [] },
		})
		dispatcher.notifyWorkspaceChanged({ revision: 1 })
		expect(messages.at(-1)).toEqual({ type: 'map.workspaceChanged', value: { revision: 1 } })
		dispatcher.handle({ type: 'map.workspace', id: 'unmounted', action: 'list' })
		dispatcher.dispose()
		expect(signals[2]?.aborted).toBe(true)
		const disposedCount = messages.length
		resolvers[2]?.({ drafts: [] })
		await jobs[2]
		await Promise.resolve()
		expect(messages).toHaveLength(disposedCount)
	})
	test('resize ignores invalid input, clamps size, and coalesces a burst', async () => {
		const heights: number[] = []
		let finish: (() => void) | undefined
		const resized = new Promise<void>((resolve) => {
			finish = resolve
		})
		const dispatcher = createMapletDispatcher({
			artifact: await artifact(),
			config: {},
			post: () => {},
			onCollection: () => {},
			onError: () => {},
			onResize: (height) => {
				heights.push(height)
				if (heights.length === 2) finish?.()
			},
		})
		for (const height of [NaN, Infinity, '999', null])
			dispatcher.handle({ type: 'map.resize', height })
		expect(heights).toEqual([])
		dispatcher.handle({ type: 'map.resize', height: -10 })
		expect(heights).toEqual([160])
		for (let height = 300; height <= 3000; height++)
			dispatcher.handle({ type: 'map.resize', height })
		expect(heights).toEqual([160])
		await resized
		expect(heights).toEqual([160, 1800])
		dispatcher.dispose()
	})
	test('only installed domains are advertised and preinstalled documents use the same list', () => {
		expect(getMapletRuntimeDomains()).toEqual(['map', 'config', 'identity'])
		expect(
			getMapletRuntimeDomains({ resolveResource: async () => new Blob(), onOpenLink: () => true }),
		).toEqual(['map', 'config', 'identity', 'resource', 'link'])
	})
})
