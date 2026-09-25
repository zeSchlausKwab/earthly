import { afterEach, expect, spyOn, test } from 'bun:test'
import { fetchMyMapsKml, myMapsExportUrl } from './myMaps'
import { resolveMapletResource } from './sourceResource'
const fetchOriginal = globalThis.fetch
afterEach(() => {
	globalThis.fetch = fetchOriginal
})
const canonical = 'https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1'
test('normalizes shared viewer, editor and export links to a cookie-free public export', () => {
	for (const path of ['viewer', 'u/0/viewer', 'edit', 'embed', 'kml'])
		expect(
			myMapsExportUrl(`https://www.google.com/maps/d/${path}?ll=45,12&mid=publicMap123&z=11`),
		).toBe(canonical)
})
test.each([
	'https://google.com.evil.test/maps/d/viewer?mid=publicMap123',
	'https://user@www.google.com/maps/d/viewer?mid=publicMap123',
	'http://www.google.com/maps/d/viewer?mid=publicMap123',
	'https://www.google.com/url?mid=publicMap123',
	'https://www.google.com/maps/d/viewer?mid=publicMap123&mid=other',
	'https://127.0.0.1/data',
	'invalid',
])('rejects unsupported URLs before fetching', async (url) => {
	const network = spyOn(globalThis, 'fetch')
	expect(() => myMapsExportUrl(url)).toThrow()
	await expect(resolveMapletResource(url, new AbortController().signal)).rejects.toThrow(
		'has not enabled',
	)
	expect(network).not.toHaveBeenCalled()
})
test('fetches export directly from the client resource grant, with no cookies or backend', async () => {
	const network = spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('<kml/>', { headers: { 'content-type': 'text/xml' } }),
	)
	const signal = new AbortController().signal
	expect(await (await resolveMapletResource(canonical, signal)).text()).toBe('<kml/>')
	expect(network).toHaveBeenCalledWith(canonical, {
		signal,
		credentials: 'omit',
		mode: 'cors',
		redirect: 'error',
		referrerPolicy: 'no-referrer',
	})
})
test('rejects sign-in pages and points to manual KML import', async () => {
	spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response('<html>Sign in</html>', { headers: { 'content-type': 'text/html' } }),
	)
	await expect(fetchMyMapsKml(canonical, new AbortController().signal)).rejects.toThrow(
		'exported KML file',
	)
})
test('CORS or redirect failure explains the client-only fallback', async () => {
	spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'))
	await expect(fetchMyMapsKml(canonical, new AbortController().signal)).rejects.toThrow(
		'Export a KML file',
	)
})
test('limits streamed bodies even without a content-length header and cancels the reader', async () => {
	let cancelled = false
	const body = new ReadableStream({
		pull(controller) {
			controller.enqueue(new Uint8Array(1024 * 1024))
		},
		cancel() {
			cancelled = true
		},
	})
	spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(body, { headers: { 'content-type': 'text/xml' } }),
	)
	await expect(fetchMyMapsKml(canonical, new AbortController().signal)).rejects.toThrow(
		'exceeds 5 MiB',
	)
	expect(cancelled).toBe(true)
})
