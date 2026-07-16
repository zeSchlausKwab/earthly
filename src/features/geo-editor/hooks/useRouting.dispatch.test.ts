import { describe, expect, test } from 'bun:test'
import { DEFAULT_SIDEBAR_VIEW } from '../defaults'
import { buildRoutePath, parsePathSegments } from './useRouting'

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
		})
	})

	test('mapcontext → contexts', () => {
		expect(parsePathSegments(['mapcontext', NADDR])).toEqual({
			focusType: 'mapcontext',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'contexts',
		})
	})

	test('story → stories', () => {
		expect(parsePathSegments(['story', NADDR])).toEqual({
			focusType: 'story',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'stories',
		})
	})

	test('sighting → sightings', () => {
		expect(parsePathSegments(['sighting', NADDR])).toEqual({
			focusType: 'sighting',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'sightings',
		})
	})

	test('beacon → beacons', () => {
		expect(parsePathSegments(['beacon', NADDR])).toEqual({
			focusType: 'beacon',
			naddr: NADDR,
			commentId: undefined,
			sidebarView: 'beacons',
		})
	})
})

describe('parsePathSegments — /comment/:id suffix', () => {
	test('a complete /comment/:id suffix parses the comment d-tag', () => {
		expect(parsePathSegments(['beacon', NADDR, 'comment', CID]).commentId).toBe(CID)
	})

	test('a /comment segment with no id leaves commentId undefined', () => {
		expect(parsePathSegments(['beacon', NADDR, 'comment']).commentId).toBeUndefined()
	})

	test('the comment suffix works identically for every share prefix', () => {
		for (const prefix of ['geoevent', 'mapcontext', 'story', 'sighting', 'beacon']) {
			expect(parsePathSegments([prefix, NADDR, 'comment', CID]).commentId).toBe(CID)
		}
	})
})

describe('parsePathSegments — private groups', () => {
	test('/private-groups opens the collection panel', () => {
		expect(parsePathSegments(['private-groups'])).toEqual({
			focusType: 'none',
			sidebarView: 'private-groups',
		})
	})

	test('/privategroup/:id opens one opaque local MLS workspace', () => {
		expect(parsePathSegments(['privategroup', 'workspace-123'])).toEqual({
			focusType: 'none',
			sidebarView: 'private-groups',
			privateGroupId: 'workspace-123',
		})
	})

	test('/privategroup/:id/edit keeps the encrypted scope while authoring', () => {
		expect(parsePathSegments(['privategroup', 'workspace-123', 'edit'])).toEqual({
			focusType: 'none',
			sidebarView: 'edit',
			privateGroupId: 'workspace-123',
		})
		expect(buildRoutePath({ sidebarView: 'edit', privateGroupId: 'workspace-123' })).toBe(
			'/privategroup/workspace-123/edit',
		)
	})

	test('private-group detail navigation builds the canonical route', () => {
		expect(buildRoutePath({ sidebarView: 'private-groups', privateGroupId: 'workspace 123' })).toBe(
			'/privategroup/workspace%20123',
		)
	})

	test('the hyphenated preview route remains readable', () => {
		expect(parsePathSegments(['private-group', 'workspace-123']).privateGroupId).toBe(
			'workspace-123',
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
	test('/delivery opens the native delivery ledger', () => {
		expect(parsePathSegments(['delivery'])).toEqual({
			focusType: 'none',
			sidebarView: 'delivery',
		})
	})

	test('an empty landing path opens the default sightings feed', () => {
		expect(parsePathSegments([])).toEqual({
			focusType: 'none',
			sidebarView: DEFAULT_SIDEBAR_VIEW,
		})
	})
})
