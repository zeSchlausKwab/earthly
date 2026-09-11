export const EARTHLY_BROWSE_KINDS = ['maps', 'stories', 'atlases', 'sightings', 'people'] as const

export type EarthlyBrowseKind = (typeof EARTHLY_BROWSE_KINDS)[number]
export type EarthlyObjectKind =
	| 'map'
	| 'story'
	| 'atlas'
	| 'sighting'
	| 'person'
	| 'circle'
	| 'nearby'
	| 'live'

export type EarthlyRouteKind =
	| 'browse'
	| EarthlyObjectKind
	| 'reader'
	| 'ask'
	| 'shelf'
	| 'inbox'
	| 'me'
	| 'legacy'
	| 'not-found'

export type EarthlyObjectTab = 'details' | 'comments' | 'thread'

/** The complete route state consumed by the desktop and phone compositions. */
export interface EarthlyRouteState {
	readonly kind: EarthlyRouteKind
	readonly id?: string
	readonly browseKind?: EarthlyBrowseKind
	/** Explicit catalog destination; `/` keeps the phone canvas unobstructed. */
	readonly browseOpen?: boolean
	readonly meSection?: 'circles' | 'nearby'
	readonly edit: boolean
	readonly tab: EarthlyObjectTab
	readonly commentId?: string
	/** Ordered route-local Shelf overlays. They are never persisted in content. */
	readonly on: readonly string[]
	readonly live: boolean
	readonly in?: string
	readonly legacyPath?: string
}

export interface EarthlyRouteSearch {
	readonly on?: string
	readonly live?: string
	readonly in?: string
	readonly tab?: string
}

const MAX_ON_ENTRIES = 64
const MAX_ON_ENTRY_LENGTH = 512
const BROWSE_KIND_SET = new Set<string>(EARTHLY_BROWSE_KINDS)
const OBJECT_KIND_SET = new Set<string>([
	'map',
	'story',
	'atlas',
	'sighting',
	'person',
	'circle',
	'nearby',
	'live',
])

function decodeSegment(value: string | undefined): string | undefined {
	if (!value) return undefined
	try {
		return decodeURIComponent(value)
	} catch {
		return value
	}
}

function normalizeTab(value: unknown): EarthlyObjectTab {
	return value === 'comments' || value === 'thread' ? value : 'details'
}

export function parseOnSearch(value: unknown): readonly string[] {
	if (typeof value !== 'string' || value.length === 0) return Object.freeze([])
	const seen = new Set<string>()
	const entries: string[] = []
	for (const rawEntry of value.split(',')) {
		const entry = rawEntry.trim()
		if (
			entry.length === 0 ||
			entry.length > MAX_ON_ENTRY_LENGTH ||
			seen.has(entry) ||
			entries.length >= MAX_ON_ENTRIES
		) {
			continue
		}
		seen.add(entry)
		entries.push(entry)
	}
	return Object.freeze(entries)
}

export function normalizeEarthlySearch(search: Record<string, unknown>): Record<string, unknown> {
	const normalized = { ...search }
	if (typeof search.on !== 'string' || parseOnSearch(search.on).length === 0) delete normalized.on
	else normalized.on = parseOnSearch(search.on).join(',')
	if (search.live !== '1') delete normalized.live
	if (typeof search.in !== 'string' || search.in.trim().length === 0) delete normalized.in
	else normalized.in = search.in.trim()
	if (search.tab !== 'comments' && search.tab !== 'thread') delete normalized.tab
	return normalized
}

function baseRouteState(
	search: EarthlyRouteSearch,
): Pick<EarthlyRouteState, 'edit' | 'tab' | 'on' | 'live' | 'in'> {
	return {
		edit: false,
		tab: normalizeTab(search.tab),
		on: parseOnSearch(search.on),
		live: search.live === '1',
		...(typeof search.in === 'string' && search.in.trim() ? { in: search.in.trim() } : {}),
	}
}

/** Parse the public route grammar without touching browser globals. */
export function parseEarthlyRoute(
	pathname: string,
	search: EarthlyRouteSearch = {},
): EarthlyRouteState {
	const base = baseRouteState(search)
	const segments = pathname.split('/').filter(Boolean)
	if (segments.length === 0) {
		return Object.freeze({ kind: 'browse', browseKind: 'maps', ...base })
	}

	const [first, rawSecond, third, fourth] = segments
	const id = decodeSegment(rawSecond)

	if (first === 'browse' && id && BROWSE_KIND_SET.has(id)) {
		return Object.freeze({
			kind: 'browse',
			browseKind: id as EarthlyBrowseKind,
			browseOpen: true,
			...base,
		})
	}

	if (first === 'read' && id) {
		return Object.freeze({
			kind: 'reader',
			id,
			commentId: third === 'comment' ? decodeSegment(fourth) : undefined,
			...base,
		})
	}

	if (first && OBJECT_KIND_SET.has(first) && id) {
		return Object.freeze({
			kind: first as EarthlyObjectKind,
			id,
			edit: third === 'edit',
			commentId: third === 'comment' ? decodeSegment(fourth) : undefined,
			tab: third === 'comment' ? 'comments' : base.tab,
			on: base.on,
			live: first === 'live' || first === 'sighting' ? true : base.live,
			...(base.in ? { in: base.in } : {}),
		})
	}

	if (first === 'ask' || first === 'shelf' || first === 'inbox') {
		return Object.freeze({ kind: first, ...base })
	}

	if (first === 'me') {
		const meSection = id === 'circles' || id === 'nearby' ? id : undefined
		return Object.freeze({ kind: 'me', ...(meSection ? { meSection } : {}), ...base })
	}

	if (first === 'in' && id) {
		return Object.freeze({ kind: 'browse', browseKind: 'maps', browseOpen: true, ...base, in: id })
	}

	return Object.freeze({
		kind: 'legacy',
		legacyPath: pathname,
		...base,
	})
}

export function serializeOnSearch(entries: readonly string[]): string | undefined {
	const normalized = parseOnSearch(entries.join(','))
	return normalized.length > 0 ? normalized.join(',') : undefined
}
