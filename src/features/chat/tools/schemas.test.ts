import { describe, expect, it } from 'bun:test'
import { schemaFor } from './schemas'
import { TO_EDITOR_COMPATIBLE_TOOLS } from './types'

const OSM_LAST_RESORT_TOOLS = [
	'search_location',
	'query_osm_nearby',
	'query_osm_bbox',
	'query_osm_area',
	'resolve_osm_entity',
	'get_osm_relation_geometry',
	'import_osm_to_editor',
] as const

const OSM_DISCOVERY_TOOLS = ['query_osm_nearby', 'query_osm_bbox', 'query_osm_area'] as const

function collectDescriptions(value: unknown): string[] {
	if (!value || typeof value !== 'object') return []
	if (Array.isArray(value)) return value.flatMap(collectDescriptions)

	const descriptions: string[] = []
	for (const [key, child] of Object.entries(value)) {
		if (key === 'description' && typeof child === 'string') descriptions.push(child)
		descriptions.push(...collectDescriptions(child))
	}
	return descriptions
}

describe('catalog-first geography tool descriptions', () => {
	it('steers human-readable discovery into a host-enforced exact stable-id import', () => {
		const tool = schemaFor('query_geography')
		expect(tool.function.description.toLowerCase()).toMatch(
			/text authoring is always discovered first/,
		)
		expect(tool.function.description.toLowerCase()).toMatch(/unique exact.+selectionrequired/)
		const toEditor = tool.function.parameters.properties.toEditor
		expect(toEditor).toBeDefined()
		if (!toEditor || typeof toEditor.description !== 'string') {
			throw new Error('query_geography.toEditor must have a description')
		}
		expect(toEditor.description.toLowerCase()).toMatch(/stable ids import exactly/)
		expect(toEditor.description.toLowerCase()).toMatch(/leaves the dataset unchanged/)
	})

	it('makes remote OSM discovery and import conditional on a catalog gap', () => {
		for (const name of OSM_LAST_RESORT_TOOLS) {
			const description = schemaFor(name).function.description.toLowerCase()
			expect(description).toMatch(/last[- ]resort/)
			expect(description).toContain('query_geography')
			expect(description).toMatch(/no match|no geometry|insufficient|unavailable|coverage gap/)
		}
	})

	it('allows exact OSM ids without advertising an unconditional OSM-first flow', () => {
		for (const name of [
			'resolve_osm_entity',
			'get_osm_relation_geometry',
			'import_osm_to_editor',
		] as const) {
			const tool = schemaFor(name)
			expect(tool.function.description.toLowerCase()).toMatch(/user explicitly supplied an osm/)
			for (const description of collectDescriptions(tool.function)) {
				expect(description.toLowerCase()).not.toMatch(/\brecommended\b|\bbest first\b/)
			}
		}
	})

	it('keeps broad OSM discovery read-only', () => {
		for (const name of OSM_DISCOVERY_TOOLS) {
			const tool = schemaFor(name)
			expect(tool.function.description.toLowerCase()).toContain('read-only')
			expect(tool.function.parameters.properties).not.toHaveProperty('toEditor')
			expect(tool.function.parameters.properties).not.toHaveProperty('replaceExisting')
			expect(TO_EDITOR_COMPATIBLE_TOOLS.has(name)).toBe(false)
		}
	})
})
