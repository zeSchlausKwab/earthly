import { expect, test } from 'bun:test'
import { CATALOG_PAGE_SIZE, createCatalogWindows } from './catalogWindow'

test('initial catalog is bounded and older windows grow without timestamp gaps', () => {
	const windows = createCatalogWindows()
	expect(windows.get(37515).limit).toBe(CATALOG_PAGE_SIZE)
	windows.more(37515)
	expect(windows.get(37515).limit).toBe(CATALOG_PAGE_SIZE)
	windows.settled(37515, CATALOG_PAGE_SIZE, CATALOG_PAGE_SIZE, true)
	windows.more(37515)
	expect(windows.get(37515)).toEqual({ limit: 200, hasMore: true, loading: true })
	windows.settled(37515, 100, 0, true)
	expect(windows.get(37515).loading).toBe(true)
	windows.settled(37515, 200, 120, true)
	windows.more(37515)
	expect(windows.get(37515)).toEqual({ limit: 200, hasMore: false, loading: false })
})

test('full historical reach is explicit, sticky for the session and kind-specific', () => {
	const windows = createCatalogWindows()
	windows.all(37515)
	expect(windows.get(37515).limit).toBeNull()
	expect(windows.get(37520).limit).toBe(CATALOG_PAGE_SIZE)
	windows.settled(37515, null, 2000, true)
	windows.all(37515)
	expect(windows.get(37515)).toEqual({ limit: null, hasMore: false, loading: false })
})
