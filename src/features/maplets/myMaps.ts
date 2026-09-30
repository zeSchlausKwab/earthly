/** Serialized into the Maplet too: accept a shared map link, never an arbitrary fetch URL. */
export function myMapsExportUrl(input: string): string {
	let url: URL
	try {
		url = new URL(input.trim())
	} catch {
		throw new Error('Paste a Google My Maps viewer or KML export link.')
	}
	const ids = url.searchParams.getAll('mid')
	if (
		url.protocol !== 'https:' ||
		url.hostname !== 'www.google.com' ||
		url.port ||
		url.username ||
		url.password ||
		!/^\/maps\/d\/(?:u\/\d+\/)?(?:viewer|edit|embed|kml)\/?$/.test(url.pathname) ||
		ids.length !== 1 ||
		!/^[A-Za-z0-9_-]{10,128}$/.test(ids[0] ?? '')
	)
		throw new Error('Use an HTTPS Google My Maps link containing one valid map ID (mid).')
	return `https://www.google.com/maps/d/kml?mid=${ids[0]}&forcekml=1`
}

/** Browser fetch, with no Earthly proxy, cookies, or redirects to another resource. */
export async function fetchMyMapsKml(url: string, signal: AbortSignal): Promise<Blob> {
	if (url !== myMapsExportUrl(url)) throw new Error('Use the canonical My Maps KML export URL.')
	const maxBytes = 5 * 1024 * 1024
	let response: Response
	try {
		response = await fetch(url, {
			signal,
			credentials: 'omit',
			mode: 'cors',
			redirect: 'error',
			referrerPolicy: 'no-referrer',
		})
	} catch (error) {
		if (signal.aborted) throw error
		throw new Error(
			'Google could not be read directly. Export a KML file from My Maps and choose it here. The map must allow public export.',
		)
	}
	if (!response.ok)
		throw new Error(
			`Google returned HTTP ${response.status}. Check public export access, or choose a downloaded KML file.`,
		)
	if (!/(?:xml|kml)/i.test(response.headers.get('content-type') ?? ''))
		throw new Error('Google returned a page instead of KML. Choose an exported KML file.')
	if (Number(response.headers.get('content-length')) > maxBytes) {
		await response.body?.cancel()
		throw new Error('The KML export exceeds 5 MiB. Export one layer instead.')
	}
	if (!response.body) throw new Error('The KML export was empty.')
	const reader = response.body.getReader()
	const chunks: Uint8Array<ArrayBuffer>[] = []
	let length = 0
	try {
		while (true) {
			const { value, done } = await reader.read()
			if (done) break
			length += value.byteLength
			if (length > maxBytes)
				throw new Error('The KML export exceeds 5 MiB. Export one layer instead.')
			chunks.push(new Uint8Array(value))
		}
	} catch (error) {
		await reader.cancel().catch(() => {})
		throw error
	} finally {
		reader.releaseLock()
	}
	return new Blob(chunks, { type: 'application/vnd.google-earth.kml+xml' })
}
