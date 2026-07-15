import { describe, expect, test } from 'bun:test'
import { buildPmtilesStyle } from './buildStyles'

describe('buildPmtilesStyle', () => {
	test('uses the Protomaps vector style for vector archives', () => {
		const style = buildPmtilesStyle('http://earthly-blob.localhost/hash', 'vector')
		const source = style.sources.protomaps
		expect(source).toBeDefined()
		expect(source?.type).toBe('vector')
		expect(source && 'url' in source ? source.url : null).toBe(
			'pmtiles://http://earthly-blob.localhost/hash',
		)
	})

	test('uses one raster layer for image-tile archives', () => {
		const style = buildPmtilesStyle('http://earthly-blob.localhost/hash', 'raster')
		const source = style.sources.pmtiles
		expect(source).toBeDefined()
		expect(source?.type).toBe('raster')
		expect(source && 'tiles' in source ? source.tiles : null).toEqual([
			'pmtiles://http://earthly-blob.localhost/hash/{z}/{x}/{y}',
		])
		expect(style.layers).toEqual([{ id: 'pmtiles-raster', type: 'raster', source: 'pmtiles' }])
	})
})
