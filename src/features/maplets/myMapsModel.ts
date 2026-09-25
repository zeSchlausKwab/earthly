import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { myMapsExportUrl } from './myMaps'

/** Earthly experimental public source announcements; not an allocated NIP kind. */
export { MAPLET_SOURCE_KIND } from '@/lib/nostr/kinds'
export const MY_MAPS_PREFERENCES = 'earthly:maplet:my-maps-viewer:sources:v1'

export interface MyMapsSource {
	url: string
	title: string
	description: string
	tags: string[]
	hiddenLayers: string[]
	opacity: number
	visible: boolean
}
export interface MyMapsPreferences {
	version: 1
	sources: MyMapsSource[]
}
export interface MyMapsAnnouncement {
	source: MyMapsSource
	pubkey: string
	id: string
	identifier: string
	createdAt: number
	deleted: boolean
}

/** Serialized into the viewer. Keep the complete source format owned by the Maplet. */
export function createMyMapsModel(canonicalize: (url: string) => string) {
	const kind = 37526
	const preferencesId = 'earthly:maplet:my-maps-viewer:sources:v1'
	function object(value: unknown): Record<string, unknown> {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Invalid source description')
		return value as Record<string, unknown>
	}
	function text(value: unknown, max: number): string {
		if (typeof value !== 'string' || value.length > max) throw new Error('Invalid source text')
		return value.trim()
	}
	function strings(value: unknown, count: number, length: number): string[] {
		if (!Array.isArray(value) || value.length > count) throw new Error('Invalid source list')
		return [...new Set(value.map((entry) => text(entry, length)))]
	}
	function source(value: unknown): MyMapsSource {
		const item = object(value)
		const url = canonicalize(text(item.url, 4096))
		const title = text(item.title, 160)
		if (!title) throw new Error('Give this source a title')
		const opacity = item.opacity ?? 1
		if (typeof opacity !== 'number' || !Number.isFinite(opacity) || opacity < 0 || opacity > 1)
			throw new Error('Invalid opacity')
		if (item.visible !== undefined && typeof item.visible !== 'boolean')
			throw new Error('Invalid source visibility')
		return {
			url,
			title,
			description: text(item.description ?? '', 2000),
			tags: strings(item.tags ?? [], 12, 40),
			hiddenLayers: strings(item.hiddenLayers ?? [], 100, 1000),
			opacity,
			visible: item.visible !== false,
		}
	}
	function preferences(value: unknown): MyMapsPreferences {
		const item = object(value)
		if (item.version !== 1 || !Array.isArray(item.sources) || item.sources.length > 12)
			throw new Error('Saved sources are invalid or exceed the 12-source limit')
		const sources = item.sources.map(source)
		if (new Set(sources.map((entry) => entry.url)).size !== sources.length)
			throw new Error('Duplicate saved source')
		return { version: 1, sources }
	}
	function identifier(url: string) {
		return `my-maps:${new URL(canonicalize(url)).searchParams.get('mid')}`
	}
	function announcement(input: MyMapsSource, deleted = false): EventTemplate {
		const item = source(input)
		return {
			kind,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier(item.url)],
				['t', 'maplet-source'],
				['maplet', 'my-maps-viewer'],
				['r', item.url],
			],
			content: JSON.stringify({
				version: 1,
				maplet: 'my-maps-viewer',
				url: item.url,
				title: item.title,
				description: item.description,
				tags: item.tags,
				deleted,
			}),
		}
	}
	function parseAnnouncement(
		event: Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'pubkey' | 'id' | 'created_at'>,
	): MyMapsAnnouncement {
		if (event.kind !== kind || event.content.length > 8192 || event.tags.length > 20)
			throw new Error('Invalid source announcement')
		const body = object(JSON.parse(event.content))
		if (
			body.version !== 1 ||
			body.maplet !== 'my-maps-viewer' ||
			typeof body.deleted !== 'boolean' ||
			Object.keys(body).some(
				(key) =>
					!['version', 'maplet', 'url', 'title', 'description', 'tags', 'deleted'].includes(key),
			)
		)
			throw new Error('Unsupported source announcement')
		const item = source(body)
		const id = identifier(item.url)
		const expected = announcement(item, body.deleted).tags
		if (JSON.stringify(event.tags) !== JSON.stringify(expected))
			throw new Error('Invalid source tags')
		return {
			source: item,
			identifier: id,
			deleted: body.deleted,
			pubkey: event.pubkey,
			id: event.id,
			createdAt: event.created_at,
		}
	}
	function latest(events: NostrEvent[]): MyMapsAnnouncement[] {
		const entries = new Map<string, MyMapsAnnouncement>()
		for (const event of events) {
			try {
				const item = parseAnnouncement(event)
				const key = `${item.pubkey}:${item.identifier}`
				const old = entries.get(key)
				if (
					!old ||
					item.createdAt > old.createdAt ||
					(item.createdAt === old.createdAt && item.id < old.id)
				)
					entries.set(key, item)
			} catch {
				/* Ignore unrelated or malformed events. The host verifies signatures. */
			}
		}
		return [...entries.values()]
			.filter((entry) => !entry.deleted)
			.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
	}
	return { kind, preferencesId, source, preferences, announcement, parseAnnouncement, latest }
}

export const myMapsModel = createMyMapsModel(myMapsExportUrl)
