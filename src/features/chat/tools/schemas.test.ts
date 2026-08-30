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
	it('documents the baseline catalog and optional transport packs', () => {
		const description = schemaFor('query_geography').function.description.toLowerCase()
		expect(description).toContain(
			'baseline snapshot covers administrative areas, localities, places, waterways, and infrastructure',
		)
		expect(description).toContain('road and rail are optional coverage packs')
		expect(description).toMatch(/unavailable road or rail.+not a remote osm fallback signal/)
	})

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
			expect(description).toMatch(
				/no match|no geometry|insufficient|unavailable|coverage gap|local-detail gap/,
			)
			expect(description).toMatch(/optional road or rail packs? is not a fallback signal/)
		}
	})

	it('allows exact OSM ids without advertising an unconditional OSM-first flow', () => {
		expect(schemaFor('query_osm_by_id').function.description.toLowerCase()).toMatch(
			/use directly when the user supplied that osm id/,
		)
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

	it('limits Valhalla to supported coordinate routing and keeps rail explicit', () => {
		const tool = schemaFor('valhalla_route')
		const description = tool.function.description.toLowerCase()
		expect(description).toContain('2 to 25 coordinate waypoints')
		expect(description).toContain('not a road-name search')
		expect(description).toContain('full-relation retrieval')
		expect(description).toContain('does not route rail')
		expect(description).toContain('route_over_network')
		expect(description).toMatch(/otherwise report it as unsupported/)
		expect(tool.function.parameters.properties.locations.description).toContain(
			'2 to 25 coordinates',
		)
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

describe('feature predicate descriptions', () => {
	it('advertises host feature ids instead of implying ids live in properties', () => {
		for (const name of [
			'find_features',
			'select_features',
			'validate_geometry',
			'batch_edit_features',
			'dedup_features',
			'style_by_attribute',
		] as const) {
			const descriptions = collectDescriptions(schemaFor(name).function).join(' ')
			expect(descriptions).toContain('$id')
			expect(descriptions).toContain('$geometryType')
		}
	})
})
