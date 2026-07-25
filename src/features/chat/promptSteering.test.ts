/**
 * Fix #4 — prompt steering invariants.
 *
 * Asserts the high-signal guidance added to (a) the agent map-context system
 * message and (b) the run_code tool description is present and mutually
 * consistent (the run_code return convention + available-globals surface must
 * agree across both, CR-01-style sync). These are string-presence assertions:
 * they pin the steering so a future edit that drops it fails loudly.
 */

import { describe, expect, it } from 'bun:test'
import { createMapContextSystemMessage } from './tools/context'
import { getGeoTools } from './tools/definitions'

function mapContextText(): string {
	const msg = createMapContextSystemMessage()
	expect(msg).not.toBeNull()
	const content = msg?.content
	return typeof content === 'string' ? content : JSON.stringify(content)
}

function runCodeDescription(): string {
	const tool = getGeoTools().find((t) => t.function.name === 'run_code')
	expect(tool).toBeDefined()
	return tool?.function.description ?? ''
}

function styleByAttributeDescription(): string {
	const tool = getGeoTools().find((candidate) => candidate.function.name === 'style_by_attribute')
	expect(tool).toBeDefined()
	return tool?.function.description ?? ''
}

function wikipediaExtractDescription(): string {
	const tool = getGeoTools().find((candidate) => candidate.function.name === 'wikipedia_extract')
	expect(tool).toBeDefined()
	return tool?.function.description ?? ''
}

describe('fix #4 — agent map-context steering', () => {
	const text = mapContextText()

	it('steers toward known coordinates over geocoding', () => {
		expect(text).toMatch(/known coordinates/i)
		expect(text).toMatch(/search_location/i)
	})

	it('prefers spatial fields already present in structured sources before geocoding', () => {
		expect(text).toMatch(/source-provided spatial data/i)
		expect(text).toMatch(/latitude\/longitude|GeoJSON|WKT/i)
		expect(text).toMatch(/geocode only rows whose source.*lacks/i)
	})

	it('defines complete extraction pages independently of prompt-window previews', () => {
		expect(text).toMatch(/pagination\.status/i)
		expect(text).toMatch(/complete.*full table/i)
	})

	it('discourages gratuitous OSM relation/boundary fetches', () => {
		expect(text).toMatch(/OSM relation geometry|query OSM unless/i)
	})

	it('states the run_code return convention (bare expression OR top-level return)', () => {
		expect(text).toMatch(/top-level `return/i)
	})

	it('warns no Node/host globals exist in the sandbox', () => {
		expect(text).toMatch(/no fetch\/Buffer\/process\/require\/window\/document/i)
	})

	it('tells the model to trust authoring write results (no re-verify)', () => {
		expect(text).toMatch(/do NOT re-verify/i)
		expect(text).toMatch(/capture_map_snapshot/i)
	})

	// AI_GEO_AWARENESS: the bench runs showed the model picking slow OSM calls
	// for country-scale work because older OSM-forward lines out-competed the
	// world-layer guidance. The hierarchy must stay explicit and de-conflicted.
	it('states the world-layers-first data source order', () => {
		expect(text).toMatch(/DATA SOURCE ORDER/i)
		expect(text).toMatch(/BUNDLED WORLD LAYERS/i)
		expect(text).toMatch(/OSM tools ONLY for/i)
	})

	it('scopes OSM boundary/line guidance to LOCAL features (no country-scale OSM)', () => {
		expect(text).toMatch(/For LOCAL admin boundaries/i)
		expect(text).toMatch(/NEVER query OSM for a country-scale coastline/i)
		expect(text).toMatch(/world\.get\("countries_110m"\)/)
	})

	it('carries the offshore-offset recipe (buffer → polygonToLine → isOnLand filter)', () => {
		expect(text).toMatch(/offshore offset line/i)
		expect(text).toMatch(/polygonToLine/)
		expect(text).toMatch(/world\.isOnLand/)
	})

	it('frames generalized-data honesty instead of external verification', () => {
		expect(text).toMatch(/GENERALIZED cartography/i)
		expect(text).toMatch(/systematic underestimates/i)
	})

	it('keeps bulk map labels literal and the visible result legible', () => {
		expect(text).toMatch(/MAP LEGIBILITY/i)
		expect(text).toMatch(/label.*literal display text/i)
		expect(text).toMatch(/Do not write `\{name\}`/i)
		expect(text).toMatch(/6–12 nearest or representative/i)
		expect(text).toMatch(/distinct colors\/icons/i)
	})
})

describe('structured extraction steering', () => {
	it('advertises the unambiguous pagination contract on wikipedia_extract', () => {
		const description = wikipediaExtractDescription()
		expect(description).toMatch(/pagination\.status/i)
		expect(description).toMatch(/complete.*full table/i)
		expect(description).toMatch(/more.*nextOffset/i)
	})
})

describe('fix #4 — run_code description steering (advertised surface in sync)', () => {
	const desc = runCodeDescription()

	it('documents the top-level return convention consistent with the agent prompt', () => {
		expect(desc).toMatch(/top-level `return/i)
	})

	it('enumerates the unavailable Node/host globals', () => {
		for (const g of [
			'fetch',
			'Buffer',
			'process',
			'require',
			'localStorage',
			'window',
			'document',
		]) {
			expect(desc).toContain(g)
		}
	})

	it('advertises exactly the four available globals (CR-01 surface sync)', () => {
		for (const g of ['authoring', 'turf', 'data', 'console']) {
			expect(desc).toContain(g)
		}
	})

	it('documents the data shape: data.features is a Feature[] (not a FeatureCollection)', () => {
		// Guards against the UAT crash `data.features.features.find(...)` → TypeError.
		expect(desc).toContain('data.features.find')
		expect(desc).toMatch(/NOT `data\.features\.features`/)
		expect(desc).toMatch(/data\.datasets\[handleId\][^.]*ARRAY/i)
	})

	it('tells the model to trust the returned counts (no re-verify)', () => {
		expect(desc).toMatch(/TRUST the returned `counts`/i)
		expect(desc).toMatch(/do NOT re-verify/i)
	})
})

describe('display-icon authoring steering', () => {
	it('advertises displayIcon and the lucide namespace to the model', () => {
		const description = styleByAttributeDescription()
		expect(description).toContain('displayIcon')
		expect(description).toContain('lucide:')
	})

	it('requires semantic POI points to use icons instead of plain dots', () => {
		const text = mapContextText()
		expect(text).toMatch(/every imported Point.*meaningful category icon/i)
		expect(text).toContain('lucide:store')
		expect(text).toContain('lucide:train-front')
		expect(styleByAttributeDescription()).toMatch(/every Point category.*plain dots/i)
	})

	it('documents labels as literal text in the styling tool itself', () => {
		const description = styleByAttributeDescription()
		expect(description).toMatch(/label.*literal display text/i)
		expect(description).toContain('{name}')
		expect(description).toMatch(/omit labels on dense bulk results/i)
	})
})

describe('travel-time overlay steering', () => {
	it('keeps isochrones cool-colored, transparent, and visually subordinate', () => {
		const text = mapContextText()
		expect(text).toMatch(/TRAVEL-TIME OVERLAYS/i)
		expect(text).toMatch(/never yellow or orange/i)
		expect(text).toMatch(/fillOpacity 0\.08–0\.12/)
	})
})
