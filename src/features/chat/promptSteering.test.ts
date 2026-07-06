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

describe('fix #4 — agent map-context steering', () => {
	const text = mapContextText()

	it('steers toward known coordinates over geocoding', () => {
		expect(text).toMatch(/known coordinates/i)
		expect(text).toMatch(/search_location/i)
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
