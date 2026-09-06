import { describe, expect, test } from 'bun:test'
import { resolveToolbarLayout } from './useResponsiveToolbar'

describe('canvas-width toolbar priorities', () => {
	test('starts compact before measurement and in a two-panel narrow canvas', () => {
		for (const width of [0, 320, 448, 559]) {
			const layout = resolveToolbarLayout(width)
			expect([...layout.expanded]).toEqual([])
			expect(layout.compactSearch).toBe(true)
			expect(layout.compactLabels).toBe(true)
			expect(layout.inlineCallout).toBe(false)
		}
	})
	test('restores publication labels, then search, before expanding drawing', () => {
		expect(resolveToolbarLayout(560).compactLabels).toBe(false)
		expect(resolveToolbarLayout(819).compactSearch).toBe(true)
		expect(resolveToolbarLayout(820).compactSearch).toBe(false)
		expect(resolveToolbarLayout(820).inlineCallout).toBe(true)
		expect([...resolveToolbarLayout(899).expanded]).toEqual([])
		expect([...resolveToolbarLayout(900).expanded]).toEqual(['draw'])
	})
	test('expands Edit last and collapses cleanly when a panel takes space', () => {
		expect([...resolveToolbarLayout(1440).expanded]).toEqual(['draw', 'edit'])
		expect([...resolveToolbarLayout(1199).expanded]).toEqual(['draw'])
		expect([...resolveToolbarLayout(600).expanded]).toEqual([])
	})
})
