import { describe, expect, it } from 'bun:test'
import { schemaFor } from './schemas'

const OSM_LAST_RESORT_TOOLS = [
	'search_location',
	'resolve_osm_entity',
	'get_osm_relation_geometry',
	'import_osm_to_editor',
] as const

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
	it('makes remote OSM discovery and import conditional on a catalog gap', () => {
		for (const name of OSM_LAST_RESORT_TOOLS) {
			const description = schemaFor(name).function.description.toLowerCase()
			expect(description).toMatch(/last[- ]resort/)
			expect(description).toContain('query_geography')
			expect(description).toMatch(/no match|no geometry|insufficient/)
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
})
