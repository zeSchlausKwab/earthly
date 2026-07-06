import { describe, expect, it } from 'bun:test'
import { getGeoTools } from '../tools/definitions'
import type { Tool } from '../tools/types'
import { gateToolsForVision, VISION_ONLY_TOOLS } from './gateToolsForVision'

function tool(name: string): Tool {
	return {
		type: 'function',
		function: { name, description: '', parameters: { type: 'object', properties: {} } },
	}
}

describe('gateToolsForVision (D-08/D-09 advertised-surface gate)', () => {
	const sample = [tool('search_location'), tool('capture_map_snapshot'), tool('run_code')]

	it('drops capture_map_snapshot when the model cannot use vision', () => {
		const gated = gateToolsForVision(sample, false)
		const names = gated.map((t) => t.function.name)
		expect(names).not.toContain('capture_map_snapshot')
		expect(names).toContain('search_location')
		expect(names).toContain('run_code')
	})

	it('passes the full list through when vision is confirmed', () => {
		const gated = gateToolsForVision(sample, true)
		expect(gated.map((t) => t.function.name)).toContain('capture_map_snapshot')
		expect(gated).toHaveLength(sample.length)
	})

	it('treats every VISION_ONLY_TOOLS entry as gated', () => {
		const all = [...VISION_ONLY_TOOLS].map(tool)
		expect(gateToolsForVision(all, false)).toHaveLength(0)
	})

	it('gates capture_map_snapshot out of the REAL advertised tool list for a no-vision model', () => {
		const advertised = getGeoTools()
		// capture_map_snapshot must actually be in the advertised set (otherwise this
		// test would pass vacuously) before we assert the gate removes it.
		expect(advertised.some((t) => t.function.name === 'capture_map_snapshot')).toBe(true)
		const gated = gateToolsForVision(advertised, false)
		expect(gated.some((t) => t.function.name === 'capture_map_snapshot')).toBe(false)
	})
})
