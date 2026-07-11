import { describe, expect, it } from 'bun:test'
import { LUCIDE_ICON_NAMES, LUCIDE_ICONS } from './lucideIcons'

describe('bundled Lucide icon set (generated module integrity)', () => {
	it('bundles a curated set in the agreed 40-60 icon range', () => {
		expect(LUCIDE_ICON_NAMES.length).toBeGreaterThanOrEqual(40)
		expect(LUCIDE_ICON_NAMES.length).toBeLessThanOrEqual(60)
	})

	it('has unique names and a matching SVG entry for every name', () => {
		expect(new Set(LUCIDE_ICON_NAMES).size).toBe(LUCIDE_ICON_NAMES.length)
		expect(Object.keys(LUCIDE_ICONS).sort()).toEqual([...LUCIDE_ICON_NAMES].sort())
	})

	it('includes the core mapping vocabulary', () => {
		for (const name of ['anchor', 'hospital', 'tent', 'map-pin', 'star', 'circle']) {
			expect(LUCIDE_ICON_NAMES).toContain(name)
		}
	})

	it('uses lowercase kebab-case names (they become `lucide:<name>` ids)', () => {
		for (const name of LUCIDE_ICON_NAMES) {
			expect(name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
		}
	})

	it('every entry is a normalized 24x24 SVG ready for data-URL rasterization', () => {
		for (const name of LUCIDE_ICON_NAMES) {
			const svg = LUCIDE_ICONS[name]
			expect(svg.startsWith('<svg')).toBe(true)
			expect(svg.endsWith('</svg>')).toBe(true)
			// xmlns is required for `data:image/svg+xml` decoding in the browser.
			expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"')
			expect(svg).toContain('viewBox="0 0 24 24"')
			// Lucide glyphs are stroke-based — the rasterizer substitutes
			// currentColor and the picker inherits the text color from the DOM.
			expect(svg).toContain('stroke="currentColor"')
			expect(svg).toContain('fill="none"')
			expect(svg).toContain('stroke-width="2"')
			// The generator strips license comments, class and id attributes.
			expect(svg).not.toContain('<?xml')
			expect(svg).not.toContain('<!--')
			expect(svg).not.toContain(' class="')
			expect(svg).not.toContain(' id="')
		}
	})
})
