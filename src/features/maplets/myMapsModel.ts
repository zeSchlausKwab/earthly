import type { EventTemplate, NostrEvent } from 'nostr-tools'
import { myMapsExportUrl } from './myMaps'

/** Earthly experimental public configuration announcements; not an allocated NIP kind. */
export { MAPLET_SOURCE_KIND } from '@/lib/nostr/kinds'
/** Retain the original address so old account backups migrate in place. */
export const MY_MAPS_PREFERENCES = 'earthly:maplet:my-maps-viewer:sources:v1'

export interface MyMapsView {
	hiddenLayers: string[]
	opacity: number
	layerColors: Record<string, string>
}
export interface MyMapsPublication {
	pubkey: string
	identifier: string
	eventId: string
	createdAt: number
}
export interface MyMapsSource extends MyMapsView {
	/** Local identity. A consumer's copy can differ from its publication identifier. */
	id: string
	url: string
	/** Private draft input; may be incomplete while url remains the last validated source. */
	inputUrl?: string
	title: string
	description: string
	tags: string[]
	visible: boolean
	active: boolean
	owner?: string
	published?: boolean
	publication?: MyMapsPublication
	/** Personal choices do not alter the author's published defaults. */
	view?: Partial<MyMapsView>
}
export interface MyMapsPreferences {
	version: 2
	sources: MyMapsSource[]
	drafts: MyMapsSource[]
}
export interface MyMapsAnnouncement {
	source: MyMapsSource
	pubkey: string
	id: string
	identifier: string
	createdAt: number
	deleted: boolean
}

/** Serialized into the viewer. Keep the complete configuration format owned by the Maplet. */
export function createMyMapsModel(canonicalize: (url: string) => string) {
	const kind = 37526
	const preferencesId = 'earthly:maplet:my-maps-viewer:sources:v1'
	const configPrefix = 'my-maps-config:'
	function object(value: unknown): Record<string, unknown> {
		if (!value || typeof value !== 'object' || Array.isArray(value))
			throw new Error('Invalid configuration description')
		return value as Record<string, unknown>
	}
	function text(value: unknown, max: number): string {
		if (typeof value !== 'string' || value.length > max)
			throw new Error('Invalid configuration text')
		return value.trim()
	}
	function strings(value: unknown, count: number, length: number): string[] {
		if (!Array.isArray(value) || value.length > count) throw new Error('Invalid configuration list')
		return [...new Set(value.map((entry) => text(entry, length)))]
	}
	function configurationId(value: unknown): string {
		const result = text(value, 160)
		if (!/^[a-zA-Z0-9_-]{1,160}$/.test(result)) throw new Error('Invalid configuration ID')
		return result
	}
	function opacity(value: unknown): number {
		if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
			throw new Error('Invalid opacity')
		return value
	}
	function colors(value: unknown): Record<string, string> {
		const result: Record<string, string> = Object.create(null)
		const entries = Object.entries(object(value))
		if (entries.length > 100) throw new Error('Too many layer colors')
		for (const [name, color] of entries) {
			if (
				!name ||
				name.length > 1000 ||
				typeof color !== 'string' ||
				!/^#[a-f0-9]{6}$/i.test(color)
			)
				throw new Error('Invalid layer color')
			Object.defineProperty(result, name, {
				value: color.toLowerCase(),
				enumerable: true,
				writable: true,
				configurable: true,
			})
		}
		return result
	}
	function publicKey(value: unknown): string {
		if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
			throw new Error('Invalid configuration owner')
		return value
	}
	function legacyIdentifier(url: string) {
		return `my-maps:${new URL(canonicalize(url)).searchParams.get('mid')}`
	}
	function legacyId(url: string) {
		return `legacy-${new URL(canonicalize(url)).searchParams.get('mid')}`
	}
	function publication(value: unknown): MyMapsPublication {
		const item = object(value)
		const identifier = text(item.identifier, 200)
		if (identifier.startsWith(configPrefix)) {
			configurationId(identifier.slice(configPrefix.length))
		} else if (!/^my-maps:[a-zA-Z0-9_-]+$/.test(identifier)) {
			throw new Error('Invalid configuration reference')
		}
		if (
			typeof item.eventId !== 'string' ||
			(item.eventId !== '' && !/^[a-f0-9]{64}$/.test(item.eventId)) ||
			typeof item.createdAt !== 'number' ||
			!Number.isSafeInteger(item.createdAt) ||
			item.createdAt < 0
		)
			throw new Error('Invalid configuration reference')
		return {
			pubkey: publicKey(item.pubkey),
			identifier,
			eventId: item.eventId,
			createdAt: item.createdAt,
		}
	}
	function view(value: unknown): Partial<MyMapsView> {
		const item = object(value)
		if (Object.keys(item).some((key) => !['hiddenLayers', 'opacity', 'layerColors'].includes(key)))
			throw new Error('Invalid personal view')
		return {
			...(item.hiddenLayers !== undefined
				? { hiddenLayers: strings(item.hiddenLayers, 100, 1000) }
				: {}),
			...(item.opacity !== undefined ? { opacity: opacity(item.opacity) } : {}),
			...(item.layerColors !== undefined ? { layerColors: colors(item.layerColors) } : {}),
		}
	}
	function source(value: unknown): MyMapsSource {
		const item = object(value)
		const url = canonicalize(text(item.url, 4096))
		const title = text(item.title, 160)
		if (!title) throw new Error('Give this configuration a title')
		for (const key of ['visible', 'active', 'published']) {
			if (item[key] !== undefined && typeof item[key] !== 'boolean')
				throw new Error(`Invalid configuration ${key}`)
		}
		const ref = item.publication !== undefined ? publication(item.publication) : undefined
		const owner = item.owner !== undefined ? publicKey(item.owner) : undefined
		if (ref && owner && ref.pubkey !== owner) throw new Error('Configuration ownership mismatch')
		return {
			id: item.id === undefined ? crypto.randomUUID() : configurationId(item.id),
			url,
			...(item.inputUrl !== undefined ? { inputUrl: text(item.inputUrl, 4096) } : {}),
			title,
			description: text(item.description ?? '', 2000),
			tags: strings(item.tags ?? [], 12, 40),
			hiddenLayers: strings(item.hiddenLayers ?? [], 100, 1000),
			opacity: opacity(item.opacity ?? 1),
			layerColors: colors(item.layerColors ?? {}),
			visible: item.visible !== false,
			active: item.active !== false,
			...(owner ? { owner } : {}),
			...(item.published !== undefined ? { published: item.published as boolean } : {}),
			...(ref ? { publication: ref } : {}),
			...(item.view !== undefined ? { view: view(item.view) } : {}),
		}
	}
	function preferences(value: unknown): MyMapsPreferences {
		const item = object(value)
		if (
			(item.version !== 1 && item.version !== 2) ||
			!Array.isArray(item.sources) ||
			item.sources.length > 12 ||
			(item.drafts !== undefined && (!Array.isArray(item.drafts) || item.drafts.length > 12))
		)
			throw new Error('Saved configurations are invalid or exceed the 12-source limit')
		const sources = item.sources.map((entry) => {
			if (item.version !== 1) {
				configurationId(object(entry).id)
				return source(entry)
			}
			const old = object(entry)
			return source({
				...old,
				id: old.id ?? legacyId(text(old.url, 4096)),
				active: old.active ?? true,
			})
		})
		if (item.version === 1 && new Set(sources.map((entry) => entry.url)).size !== sources.length)
			throw new Error('Duplicate saved source')
		const drafts = ((item.drafts as unknown[] | undefined) ?? []).map((entry) => {
			const draft = object(entry)
			configurationId(draft.id)
			return source({ ...draft, active: false })
		})
		// An edit draft keeps its saved configuration ID so publication updates
		// and resumed edits retain the same identity. Each list stays unique.
		for (const entries of [sources, drafts]) {
			if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
				throw new Error('Duplicate saved configuration ID')
		}
		return { version: 2, sources, drafts }
	}
	function announcement(input: MyMapsSource, deleted = false): EventTemplate {
		if (typeof deleted !== 'boolean') throw new Error('Invalid configuration withdrawal')
		const item = source(input)
		const ref = item.publication?.identifier
		const id = ref?.startsWith(configPrefix)
			? configurationId(ref.slice(configPrefix.length))
			: ref?.startsWith('my-maps:')
				? legacyId(item.url)
				: item.id
		// Existing publications can gain defaults without leaving an older discoverable entry behind.
		const identifier = ref?.startsWith('my-maps:') ? ref : `${configPrefix}${id}`
		if (identifier.startsWith('my-maps:') && identifier !== legacyIdentifier(item.url))
			throw new Error('Legacy configuration reference does not match its source')
		return {
			kind,
			created_at: Math.floor(Date.now() / 1000),
			tags: [
				['d', identifier],
				['t', 'maplet-source'],
				['maplet', 'my-maps-viewer'],
				['r', item.url],
			],
			content: JSON.stringify({
				version: 2,
				maplet: 'my-maps-viewer',
				id,
				url: item.url,
				title: item.title,
				description: item.description,
				tags: item.tags,
				hiddenLayers: item.hiddenLayers,
				opacity: item.opacity,
				layerColors: item.layerColors,
				deleted,
			}),
		}
	}
	function parseAnnouncement(
		event: Pick<NostrEvent, 'kind' | 'content' | 'tags' | 'pubkey' | 'id' | 'created_at'>,
	): MyMapsAnnouncement {
		if (event.kind !== kind || event.content.length > 60_000 || event.tags.length > 20)
			throw new Error('Invalid configuration announcement')
		const body = object(JSON.parse(event.content))
		const allowed = ['version', 'maplet', 'url', 'title', 'description', 'tags', 'deleted']
		if (body.version === 2) allowed.push('id', 'hiddenLayers', 'opacity', 'layerColors')
		if (
			(body.version !== 1 && body.version !== 2) ||
			body.maplet !== 'my-maps-viewer' ||
			typeof body.deleted !== 'boolean' ||
			Object.keys(body).some((key) => !allowed.includes(key))
		)
			throw new Error('Unsupported configuration announcement')
		if (
			body.version === 2 &&
			(body.id === undefined ||
				body.hiddenLayers === undefined ||
				body.opacity === undefined ||
				body.layerColors === undefined)
		)
			throw new Error('Missing published configuration defaults')
		const canonicalUrl = canonicalize(text(body.url, 4096))
		const item = source({ ...body, id: body.version === 1 ? legacyId(canonicalUrl) : body.id })
		const oldIdentifier = legacyIdentifier(item.url)
		const taggedIdentifier = event.tags[0]?.[1]
		const identifier =
			body.version === 1 || (taggedIdentifier === oldIdentifier && item.id === legacyId(item.url))
				? oldIdentifier
				: `${configPrefix}${item.id}`
		const expected = [
			['d', identifier],
			['t', 'maplet-source'],
			['maplet', 'my-maps-viewer'],
			['r', item.url],
		]
		if (JSON.stringify(event.tags) !== JSON.stringify(expected))
			throw new Error('Invalid configuration tags')
		const ref = publication({
			pubkey: event.pubkey,
			identifier,
			eventId: event.id,
			createdAt: event.created_at,
		})
		return {
			source: { ...item, owner: event.pubkey, published: !body.deleted, publication: ref },
			identifier,
			deleted: body.deleted,
			pubkey: event.pubkey,
			id: event.id,
			createdAt: event.created_at,
		}
	}
	function latest(events: NostrEvent[], includeDeleted = false): MyMapsAnnouncement[] {
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
			.filter((entry) => includeDeleted || !entry.deleted)
			.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
	}
	function effectiveView(input: MyMapsSource): MyMapsView {
		const item = source(input)
		return {
			hiddenLayers: item.view?.hiddenLayers ?? item.hiddenLayers,
			opacity: item.view?.opacity ?? item.opacity,
			layerColors: { ...item.layerColors, ...item.view?.layerColors },
		}
	}
	function mergeAnnouncement(input: MyMapsSource, incoming: MyMapsAnnouncement): MyMapsSource {
		const item = source(input)
		if (
			!item.publication ||
			item.publication.pubkey !== incoming.pubkey ||
			item.publication.identifier !== incoming.identifier
		)
			throw new Error('Configuration update belongs to another publication')
		if (
			incoming.createdAt < item.publication.createdAt ||
			(incoming.createdAt === item.publication.createdAt && incoming.id >= item.publication.eventId)
		)
			return item
		return source({
			...incoming.source,
			id: item.id,
			view: item.view,
			active: item.active,
			visible: item.visible,
		})
	}
	function copy(input: MyMapsSource): MyMapsSource {
		const item = source(input)
		return source({
			...item,
			...effectiveView(item),
			id: crypto.randomUUID(),
			owner: undefined,
			published: false,
			publication: undefined,
			inputUrl: undefined,
			view: undefined,
			active: false,
		})
	}
	return {
		kind,
		preferencesId,
		source,
		preferences,
		announcement,
		parseAnnouncement,
		latest,
		effectiveView,
		mergeAnnouncement,
		copy,
	}
}

export const myMapsModel = createMyMapsModel(myMapsExportUrl)
