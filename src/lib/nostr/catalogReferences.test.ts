import { expect, test } from 'bun:test'
import type { MapStackEntry } from '@/features/geo-editor/store/types'
import { publicCatalogStackFilters } from './catalogReferences'

const key = `${'a'.repeat(64)}:old:map`
const entry = (source: MapStackEntry['source']): MapStackEntry => ({
	id: source, entityType: 'dataset', entityKey: key, source, title: 'Old map',
	visible: true, pinned: false, isolated: false, exclusions: [], addedAt: 1,
})
test('retained public maps resolve exactly once, including identifiers containing colons', () => {
	expect(publicCatalogStackFilters([entry('manual'), entry('route')])).toEqual([
		{ kinds: [37515], authors: ['a'.repeat(64)], '#d': ['old:map'], limit: 1 },
	])
})
test('private, nearby and working-copy identities never become public relay requests', () => {
	expect(publicCatalogStackFilters([entry('private-group'), entry('field-session'), entry('workspace')])).toEqual([])
	expect(publicCatalogStackFilters([{ ...entry('manual'), entityType: 'draft' }, { ...entry('manual'), entityKey: 'invalid' }])).toEqual([])
})
