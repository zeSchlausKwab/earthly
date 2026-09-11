import { describe, expect, test } from 'bun:test'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
import { buildRoutePath, parsePathSegments, routeStateFromEarthlyRoute } from './useRouting'

// XCUT-02 (D-08/D-09): the five per-kind share-form parsers collapsed into one
// SHARE_ROUTES lookup + one generic dispatch body. These assertions pin the
// parse output byte-for-byte so the refactor cannot silently change any URL
// shape. NADDR is passed through OPAQUE — the parser never decodes it, so a
// malformed naddr must not throw (T-13-02-MALNADDR / D-11).

const NADDR = 'naddr1abc123'
const CID = 'comment-d-tag-xyz'
const CTX_NADDR = 'naddr1context456'

describe('parsePathSegments — share forms (D-09 byte-for-byte)', () => {
	test('geoevent → datasets', () => {
		expect(parsePathSegments(['geoevent', NADDR])).toEqual({
			focusType: 'geoevent',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'datasets',
			tab: 'details',
		})
	})

	test('mapcontext → contexts', () => {
		expect(parsePathSegments(['mapcontext', NADDR])).toEqual({
			focusType: 'mapcontext',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'contexts',
			tab: 'details',
		})
	})

	test('story → stories', () => {
		expect(parsePathSegments(['story', NADDR])).toEqual({
			focusType: 'story',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'stories',
			tab: 'details',
		})
	})

	test('read → the same Story focus used by the feature-complete compatibility app', () => {
		expect(parsePathSegments(['read', NADDR])).toEqual({
			focusType: 'story',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'stories',
			tab: 'details',
		})
	})

	test('sighting → sightings', () => {
		expect(parsePathSegments(['sighting', NADDR])).toEqual({
			focusType: 'sighting',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'sightings',
			tab: 'details',
		})
	})

	test('beacon → beacons', () => {
		expect(parsePathSegments(['beacon', NADDR])).toEqual({
			focusType: 'beacon',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'beacons',
			tab: 'details',
		})
	})
})

describe('parsePathSegments — canonical margin routes', () => {
	test('maps and atlases reuse the complete entity controllers', () => {
		expect(parsePathSegments(['map', NADDR])).toMatchObject({
			focusType: 'geoevent',
			naddr: NADDR,
			sidebarView: 'datasets',
		})
		expect(parsePathSegments(['atlas', NADDR])).toMatchObject({
			focusType: 'mapcontext',
			naddr: NADDR,
			sidebarView: 'contexts',
		})
	})

	test('Browse, Shelf, Ask, Inbox, Circles, and Nearby retain existing behavior', () => {
		expect(parsePathSegments(['browse', 'stories']).sidebarView).toBe('stories')
		expect(parsePathSegments(['shelf']).sidebarView).toBe('map-stack')
		expect(parsePathSegments(['ask']).sidebarView).toBe('chat')
		expect(parsePathSegments(['inbox']).sidebarView).toBe('delivery')
		expect(parsePathSegments(['circle', 'circle-id']).privateGroupId).toBe('circle-id')
		expect(parsePathSegments(['nearby', 'survey-id']).fieldSessionId).toBe('survey-id')
	})
})

describe('TanStack route → retained controller adapter', () => {
	test('a focused Map edit route opens the editor rather than its Browse catalog', () => {
		const map = { kind: 'map', id: NADDR, tab: 'details', on: [], live: false } as const
		expect(routeStateFromEarthlyRoute({ ...map, edit: true })).toMatchObject({
			focusType: 'geoevent',
			sidebarView: 'edit',
			naddr: NADDR,
			edit: true,
		})
		expect(routeStateFromEarthlyRoute({ ...map, edit: false })).toMatchObject({
			focusType: 'geoevent',
			sidebarView: 'datasets',
			naddr: NADDR,
		})
	})

	test('carries edit intent, Shelf overlays, Live, and the Atlas lens', () => {
		const result = routeStateFromEarthlyRoute({
			kind: 'story',
			id: NADDR,
			edit: true,
			tab: 'thread',
			on: ['37515:abc:one'],
			live: true,
			in: CTX_NADDR,
		})
		expect(result).toMatchObject({
			focusType: 'story',
			sidebarView: 'stories',
			naddr: NADDR,
			edit: true,
			on: ['37515:abc:one'],
			live: true,
			contextNaddr: CTX_NADDR,
			tab: 'thread',
		})
	})

	test('builds canonical object and lens URLs instead of scoped legacy paths', () => {
		expect(
			buildRoutePath({
				sidebarView: 'stories',
				focusType: 'story',
				naddr: NADDR,
				contextNaddr: CTX_NADDR,
				edit: true,
			}),
		).toBe(`/story/${NADDR}/edit?in=${CTX_NADDR}`)
	})

	test('serializes non-default object tabs while leaving Details canonical', () => {
		expect(
			buildRoutePath({
				sidebarView: 'stories',
				focusType: 'story',
				naddr: NADDR,
				contextNaddr: CTX_NADDR,
				tab: 'thread',
			}),
		).toBe(`/story/${NADDR}?in=${CTX_NADDR}&tab=thread`)
		expect(
			buildRoutePath({
				sidebarView: 'stories',
				focusType: 'story',
				naddr: NADDR,
				tab: 'details',
			}),
		).toBe(`/story/${NADDR}`)
	})
})

describe('parsePathSegments — /comment/:id suffix', () => {
	test('a complete /comment/:id suffix parses the comment d-tag', () => {
		expect(parsePathSegments(['beacon', NADDR, 'comment', CID])).toMatchObject({
			commentId: CID,
			tab: 'comments',
		})
	})

	test('a /comment segment with no id leaves commentId undefined', () => {
		expect(parsePathSegments(['beacon', NADDR, 'comment']).commentId).toBeUndefined()
	})

	test('the comment suffix works identically for every share prefix', () => {
		for (const prefix of ['geoevent', 'mapcontext', 'read', 'story', 'sighting', 'beacon']) {
			expect(parsePathSegments([prefix, NADDR, 'comment', CID]).commentId).toBe(CID)
		}
	})
})

describe('parsePathSegments — private groups', () => {
	test('/private-groups opens the collection panel', () => {
		expect(parsePathSegments(['private-groups'])).toEqual({
			focusType: 'none',
			sidebarView: 'private-groups',
			tab: 'details',
		})
	})

	test('/privategroup/:id opens one opaque local MLS workspace', () => {
		expect(parsePathSegments(['privategroup', 'workspace-123'])).toEqual({
			focusType: 'none',
			sidebarView: 'private-groups',
			privateGroupId: 'workspace-123',
			tab: 'details',
		})
	})

	test('/privategroup/:id/edit keeps the encrypted scope while authoring', () => {
		expect(parsePathSegments(['privategroup', 'workspace-123', 'edit'])).toEqual({
			focusType: 'none',
			sidebarView: 'edit',
			privateGroupId: 'workspace-123',
			tab: 'details',
		})
		expect(buildRoutePath({ sidebarView: 'edit', privateGroupId: 'workspace-123' })).toBe(
			'/circle/workspace-123/edit',
		)
	})

	test('private-group detail navigation builds the canonical route', () => {
		expect(buildRoutePath({ sidebarView: 'private-groups', privateGroupId: 'workspace 123' })).toBe(
			'/circle/workspace%20123',
		)
	})

	test('the hyphenated preview route remains readable', () => {
		expect(parsePathSegments(['private-group', 'workspace-123']).privateGroupId).toBe(
			'workspace-123',
		)
	})
})

describe('parsePathSegments — Field sessions', () => {
	test('/field-sessions opens the collection panel', () => {
		expect(parsePathSegments(['field-sessions'])).toEqual({
			focusType: 'none',
			sidebarView: 'field-sessions',
			tab: 'details',
		})
	})

	test('/fieldsession/:id opens one nearby collaboration space', () => {
		expect(parsePathSegments(['fieldsession', 'survey-123'])).toEqual({
			focusType: 'none',
			sidebarView: 'field-sessions',
			fieldSessionId: 'survey-123',
			tab: 'details',
		})
		expect(buildRoutePath({ sidebarView: 'field-sessions', fieldSessionId: 'survey 123' })).toBe(
			'/nearby/survey%20123',
		)
	})

	test('a nested route keeps the Field-session scope', () => {
		expect(buildRoutePath({ sidebarView: 'edit', fieldSessionId: 'survey-123' })).toBe(
			'/nearby/survey-123/edit',
		)
	})
})

describe('parsePathSegments — scoped /context branch is UNCHANGED', () => {
	test('/context/:naddr/:view stays a context-scoped RouteState (not a share match)', () => {
		const result = parsePathSegments(['context', CTX_NADDR, 'datasets'])
		// contextNaddr set ⇒ this went through the /context scoped branch, NOT the
		// share-form dispatcher (which never sets contextNaddr).
		expect(result.contextNaddr).toBe(CTX_NADDR)
		expect(result.sidebarView).toBe('datasets')
	})

	test('/context/:naddr (share form) resolves to a mapcontext focus without a scope', () => {
		const result = parsePathSegments(['context', CTX_NADDR])
		expect(result.focusType).toBe('mapcontext')
		expect(result.naddr).toBe(CTX_NADDR)
		expect(result.contextNaddr).toBeUndefined()
	})
})

describe('parsePathSegments — malformed naddr does not crash (D-11 / T-13-02-MALNADDR)', () => {
	test('an invalid naddr string is passed through opaque without throwing', () => {
		let result: ReturnType<typeof parsePathSegments> | undefined
		expect(() => {
			result = parsePathSegments(['beacon', 'not-a-valid-naddr'])
		}).not.toThrow()
		expect(result?.focusType).toBe('beacon')
		expect(result?.naddr).toBe('not-a-valid-naddr')
	})

	test('an unknown prefix does NOT match SHARE_ROUTES (T-13-02-MISROUTE)', () => {
		// A prefix outside the closed table falls through to the default; no
		// arbitrary focusType/sidebarView can be injected from the URL.
		const result = parsePathSegments(['totally-unknown-kind', NADDR])
		expect(result.focusType).toBe('none')
		expect(result.sidebarView).toBe(DEFAULT_SIDEBAR_VIEW)
	})
})

describe('parsePathSegments — landing default', () => {
	test('/drafts opens local drafts and round-trips through the canonical route', () => {
		expect(parsePathSegments(['drafts'])).toEqual({
			focusType: 'none',
			sidebarView: 'drafts',
			tab: 'details',
		})
		expect(buildRoutePath({ sidebarView: 'drafts' })).toBe('/drafts')
	})

	test('/delivery opens the native delivery ledger', () => {
		expect(parsePathSegments(['delivery'])).toEqual({
			focusType: 'none',
			sidebarView: 'delivery',
			tab: 'details',
		})
	})

	test('an empty landing path opens the default datasets catalog', () => {
		expect(parsePathSegments([])).toEqual({
			focusType: 'none',
			sidebarView: DEFAULT_SIDEBAR_VIEW,
			tab: 'details',
		})
	})
})
