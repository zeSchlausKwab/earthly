import { describe, expect, test } from 'bun:test'
import { LIVE_MAPPER_HTML } from '@/features/maplets/liveMapper'
import { MY_MAPS_VIEWER_HTML } from '@/features/maplets/myMapsViewer'
import { prepareBundledMaplet } from './artifact'
import { supportsThirdPartyMaplets } from './nativePolicy'
import { createMapletSrcdoc } from './runtime'

describe('web Maplet policy', () => {
	test('preserves the browser artifact bytes under restrictive sandbox CSP', async () => {
		const html = '<style>body{color:red}</style><script>window.fixture = true</script>'
		const artifact = await prepareBundledMaplet({ id: 'fixture', html })
		expect(supportsThirdPartyMaplets()).toBe(true)
		const srcdoc = createMapletSrcdoc(artifact, ['map'])
		expect(srcdoc).toContain("connect-src 'none'")
		expect(srcdoc).toContain("frame-src 'none'")
		expect(srcdoc).toEndWith(html)
	})

	test('wraps bundled Maplets cleanly without platform nonce rewriting', async () => {
		for (const [id, html] of [
			['live-mapper', LIVE_MAPPER_HTML],
			['my-maps-viewer', MY_MAPS_VIEWER_HTML],
		] as const) {
			const artifact = await prepareBundledMaplet({ id, html })
			const srcdoc = createMapletSrcdoc(artifact, ['map'])
			expect(srcdoc).toContain("connect-src 'none'")
			expect(srcdoc).not.toContain('allow-same-origin')
			expect(srcdoc).toEndWith(html)
		}
	})
})
