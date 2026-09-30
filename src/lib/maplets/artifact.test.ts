import { describe, expect, test } from 'bun:test'
import { finalizeEvent, generateSecretKey } from 'nostr-tools'
import {
	computeMapletAggregate,
	parseMapletManifest,
	prepareBundledMaplet,
	sha256Hex,
	verifyMapletManifest,
} from './artifact'
import { createMapletSrcdoc } from './runtime'

const html =
	'<!doctype html><html><head><script>window.ran = true</script></head><body>Maplet</body></html>'

async function manifest(extra: string[][] = [], kind = 35129, artifactHtml = html) {
	const hash = await sha256Hex(artifactHtml)
	const aggregate = await computeMapletAggregate([['path', '/index.html', hash]])
	return finalizeEvent(
		{
			kind,
			created_at: 100,
			content: '',
			tags: [
				...(kind === 35129 ? [['d', 'test']] : []),
				['t', 'maplet'],
				['requires', 'map'],
				['path', '/index.html', hash],
				['x', aggregate, 'aggregate'],
				...extra,
			],
		},
		generateSecretKey(),
	)
}

describe('verified maplet releases', () => {
	test('hashes UTF-8 lines sorted by complete hash/path line, including trailing newline', async () => {
		const a = 'a'.repeat(64)
		const z = 'f'.repeat(64)
		expect(
			await computeMapletAggregate([
				['path', '/a.html', z],
				['path', '/z.html', a],
			]),
		).toBe(await sha256Hex(`${a} /z.html\n${z} /a.html\n`))
		expect(await computeMapletAggregate([['path', '/a.html', z]])).not.toBe(
			await sha256Hex(`${z} /a.html`),
		)
	})
	test('verifies exact file bytes and signed manifest before srcdoc creation', async () => {
		const signed = await manifest()
		const artifact = await verifyMapletManifest(signed, {
			fetchBlob: async () => new TextEncoder().encode(html),
		})
		expect(artifact.provenance).toBe('signed')
		expect(artifact.html).toBe(html)
		expect(artifact.identity.dTag).toBe('test')
		const srcdoc = createMapletSrcdoc(artifact, ['map'])
		expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('window.ran'))
		expect(srcdoc.indexOf('Object.defineProperty(window')).toBeLessThan(
			srcdoc.indexOf('window.ran'),
		)
		expect(srcdoc).toContain("connect-src 'none'")
	})
	test('rejects changed signature fields even if a previously verified object is reused', async () => {
		const signed = await manifest()
		parseMapletManifest(signed)
		signed.tags.push(['title', 'tampered'])
		expect(() => parseMapletManifest(signed)).toThrow('signature')
	})
	test('rejects file tampering, aggregate mismatch, unsupported capabilities, and multi-file artifacts', async () => {
		await expect(
			verifyMapletManifest(await manifest(), {
				fetchBlob: async () => new TextEncoder().encode('changed'),
			}),
		).rejects.toThrow('file hash')
		await expect(verifyMapletManifest(await manifest([['requires', 'cvm']]))).rejects.toThrow(
			'Unsupported capabilities',
		)
		await expect(
			verifyMapletManifest(await manifest([['path', '/other.js', 'a'.repeat(64)]])),
		).rejects.toThrow('self-contained')
		const event = await manifest()
		event.tags = event.tags.map((tag) =>
			tag[0] === 'x' ? ['x', '0'.repeat(64), 'aggregate'] : tag,
		)
		const resigned = finalizeEvent(
			{ kind: event.kind, tags: event.tags, content: '', created_at: 101 },
			generateSecretKey(),
		)
		await expect(verifyMapletManifest(resigned)).rejects.toThrow('aggregate hash mismatch')
	})
	test('supports root and snapshot kinds; snapshot must reference its parent', async () => {
		const fetchBlob = async () => new TextEncoder().encode(html)
		expect(
			(await verifyMapletManifest(await manifest([], 15129), { fetchBlob })).identity.dTag,
		).toBe('')
		await expect(verifyMapletManifest(await manifest([], 5129), { fetchBlob })).rejects.toThrow(
			'parent reference',
		)
		expect(
			(
				await verifyMapletManifest(await manifest([['a', `35129:${'a'.repeat(64)}:test`]], 5129), {
					fetchBlob,
				})
			).provenance,
		).toBe('signed')
	})
	test('bundled path is explicit and arbitrary fabricated artifacts cannot execute', async () => {
		const bundled = await prepareBundledMaplet({ id: 'sample', html })
		expect(bundled.provenance).toBe('bundled')
		expect(bundled.manifest).toBeUndefined()
		expect(() => createMapletSrcdoc({ ...bundled }, ['map'])).toThrow('verified')
	})
})
