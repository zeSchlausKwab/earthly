import { afterEach, describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import { LIVE_MAPPER_HTML } from '@/features/maplets/liveMapper'
import { MY_MAPS_VIEWER_HTML } from '@/features/maplets/myMapsViewer'
import {
	computeMapletAggregate,
	prepareBundledMaplet,
	sha256Hex,
	verifyMapletManifest,
} from './artifact'
import { supportsThirdPartyMaplets } from './nativePolicy'
import { createMapletDispatcher, createMapletSrcdoc, startMapletRuntime } from './runtime'

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
afterEach(() => {
	if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
	else Reflect.deleteProperty(globalThis, 'window')
})

function nativeWindow() {
	Object.defineProperty(globalThis, 'window', {
		configurable: true,
		value: { __TAURI_INTERNALS__: {} },
	})
}

function hostDocument(script?: string, style?: string): Document {
	return {
		querySelector: (selector: string) => ({
			getAttribute: () => (selector.includes('script') ? script : style),
		}),
	} as unknown as Document
}

describe('native Maplet policy', () => {
	test('the reviewed My Maps Viewer receives native nonces without granting downloaded code access', async () => {
		nativeWindow()
		const artifact = await prepareBundledMaplet({ id: 'my-maps-viewer', html: MY_MAPS_VIEWER_HTML })
		const html = createMapletSrcdoc(
			artifact,
			['map', 'resource', 'identity', 'storage', 'relay'],
			hostDocument('1234567', '7654321'),
		)
		expect(html.match(/<script nonce="1234567">/g)).toHaveLength(2)
		expect(html).toContain("connect-src 'none'")
	})
	test('preserves the browser artifact bytes without needing native nonce metadata', async () => {
		Reflect.deleteProperty(globalThis, 'window')
		const html = '<style>body{color:red}</style><script>window.fixture = true</script>'
		const artifact = await prepareBundledMaplet({ id: 'fixture', html })
		expect(supportsThirdPartyMaplets()).toBe(true)
		expect(createMapletSrcdoc(artifact, ['map'])).toEndWith(html)
	})

	test('nonces the actual bundled workbench and bridge under the unchanged restrictive sandbox CSP', async () => {
		nativeWindow()
		const artifact = await prepareBundledMaplet({ id: 'live-mapper', html: LIVE_MAPPER_HTML })
		const srcdoc = createMapletSrcdoc(artifact, ['map'], hostDocument('1234567', '7654321'))
		expect(srcdoc.match(/<script nonce="1234567">/g)).toHaveLength(2)
		expect(srcdoc.match(/<style nonce="7654321">/g)).toHaveLength(1)
		expect(srcdoc).toContain("connect-src 'none'")
		expect(srcdoc).toContain("frame-src 'none'")
		expect(srcdoc).not.toContain('allow-same-origin')
		expect(srcdoc).not.toContain('__TAURI_SCRIPT_NONCE__')
		expect(artifact.html).not.toContain('nonce="1234567"')
	})

	test('rejects missing or injected nonce values and allows the unrewritten mobile dev-server shell', async () => {
		nativeWindow()
		const artifact = await prepareBundledMaplet({
			id: 'live-mapper',
			html: '<style>body{color:red}</style><script>window.fixture = true</script>',
		})
		for (const host of [
			hostDocument(),
			hostDocument('123', '" onload="alert(1)'),
			hostDocument('__TAURI_SCRIPT_NONCE__', '123'),
		])
			expect(() => createMapletSrcdoc(artifact, ['map'], host)).toThrow('updated native app assets')
		expect(
			createMapletSrcdoc(
				artifact,
				['map'],
				hostDocument('__TAURI_SCRIPT_NONCE__', '__TAURI_STYLE_NONCE__'),
			),
		).toEndWith(artifact.html)
	})

	test('blocks even a verified downloaded app with a builtin-looking identifier before native HTML or runtime execution', async () => {
		const html = '<script>window.untrusted = true</script>'
		const hash = await sha256Hex(html)
		const event = finalizeEvent(
			{
				kind: 35129,
				created_at: 100,
				content: '',
				tags: [
					['d', 'bundled:live-mapper'],
					['t', 'maplet'],
					['requires', 'map'],
					['path', '/index.html', hash],
					['x', await computeMapletAggregate([['path', '/index.html', hash]]), 'aggregate'],
				],
			},
			generateSecretKey(),
		)
		const artifact = await verifyMapletManifest(event, {
			fetchBlob: async () => new TextEncoder().encode(html),
		})
		nativeWindow()
		expect(supportsThirdPartyMaplets()).toBe(false)
		expect(() => createMapletSrcdoc(artifact, ['map'])).toThrow('Third-party Maplet apps')
		const options = {
			artifact,
			config: {},
			onCollection: () => {},
			onError: () => {},
		}
		expect(() => startMapletRuntime({ ...options, iframe: {} as HTMLIFrameElement })).toThrow(
			'Third-party Maplet apps',
		)
		expect(() => createMapletDispatcher({ ...options, post: () => {} })).toThrow(
			'Third-party Maplet apps',
		)
	})
})
