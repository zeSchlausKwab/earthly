import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { viewOptionsSchema, type ViewOptions } from '@/features/public-map/model'

export function decodeMapReference(reference: string) {
	const decoded = nip19.decode(reference)
	if (
		decoded.type !== 'naddr' ||
		decoded.data.kind !== GEO_EVENT_KIND ||
		!decoded.data.identifier
	) {
		throw new Error('Expected a kind-37515 map naddr reference')
	}
	return decoded.data
}

export function mapUrl(baseUrl: string, reference: string, embed = false): URL {
	decodeMapReference(reference)
	return new URL(`/${embed ? 'embed' : 'maps'}/${encodeURIComponent(reference)}`, baseUrl)
}

export function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll("'", '&#39;')
}

export function createMapEmbed(
	baseUrl: string,
	reference: string,
	options: Partial<ViewOptions> = {},
	height = 480,
) {
	if (!Number.isInteger(height) || height < 200 || height > 2000)
		throw new Error('Height must be 200–2000 pixels')
	const view = viewOptionsSchema.parse(options)
	const url = mapUrl(baseUrl, reference, true)
	url.searchParams.set('v', '1')
	for (const [key, value] of Object.entries(view)) url.searchParams.set(key, String(value))
	return {
		reference,
		shareUrl: mapUrl(baseUrl, reference).href,
		embedUrl: url.href,
		html: `<iframe src="${escapeHtml(url.href)}" title="Earthly map" width="100%" height="${height}" style="border:0" loading="lazy" allowfullscreen></iframe>`,
		view,
	}
}
