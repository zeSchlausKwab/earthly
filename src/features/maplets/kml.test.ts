import { afterEach, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { DOMParser } from 'linkedom'
import { parseMapletKml } from './kml'
import { createMapletImporter } from './importer'
import { mapLiveuamapPayload } from './liveMapper'
import { validateMapletCollection } from '@/lib/maplets/collection'
const original = Object.getOwnPropertyDescriptor(globalThis, 'DOMParser')
afterEach(() => {
	if (original) Object.defineProperty(globalThis, 'DOMParser', original)
	else Reflect.deleteProperty(globalThis, 'DOMParser')
})
function parse(text: string, source = '') {
	Object.defineProperty(globalThis, 'DOMParser', { configurable: true, value: DOMParser })
	return parseMapletKml(text, source)
}
const fixture = readFileSync(
	new URL('../../../ai-suite/fixtures/data/maplet-layers.kml', import.meta.url),
	'utf8',
)
const importer = createMapletImporter(mapLiveuamapPayload, validateMapletCollection)
test('KML preserves folders, holes, style maps, properties and source attribution through the real importer', () => {
	const result = parse(fixture, 'https://www.google.com/maps/d/kml?mid=publicMap123&forcekml=1')
	expect(result.name).toBe('Coastal survey')
	const candidates = importer.discover(result.payload)
	expect(candidates.map((c) => c.count).sort()).toEqual([1, 2])
	const candidate = candidates.find((c) => c.path.includes('Layer: Areas'))
	if (!candidate) throw new Error('Missing area candidate')
	const output = importer.apply(result.payload, {
		version: 1,
		adapter: candidate.adapter,
		path: candidate.path,
	})
	const feature = output.featureCollection.features[0]
	if (!feature) throw new Error('Missing polygon')
	expect(feature).toMatchObject({
		id: 'kml:["Areas"]:a',
		geometry: { type: 'Polygon' },
		properties: {
			name: 'Habitat',
			description: 'Survey area\nSource note',
			fillColor: '#112233',
			strokeColor: '#332211',
			strokeWidth: 3,
			kmlData: { survey: '2026' },
			sourceLayer: 'Areas',
			sourceFormat: 'kml',
		},
	})
	expect((feature.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2)
	expect(feature.properties?.fillOpacity).toBeCloseTo(128 / 255)
	expect(feature.properties?.sourceUrl).toContain('google.com')
})
test('KML feature IDs remain stable after geometry updates when an XML id exists', () => {
	const ids = (text: string) => {
		const result = parse(text)
		return Object.values(result.payload.layers).flatMap((layer) =>
			layer.features.map((feature) => feature.id),
		)
	}
	expect(ids(fixture)).toEqual(ids(fixture.replace('12.5,45.5', '12.6,45.6')))
})
test('KML missing IDs get honest deterministic content IDs from the importer', () => {
	const result = parse(fixture.replaceAll(/ id="[abc]"/g, ''))
	const candidate = importer.discover(result.payload)[0]
	if (!candidate) throw new Error('Missing geographic candidate')
	const output = importer.apply(result.payload, {
		version: 1,
		adapter: candidate.adapter,
		path: candidate.path,
	})
	expect(output.warnings.join(' ')).toContain('have no source ID')
	expect(
		output.featureCollection.features.every((feature) => String(feature.id).startsWith('import:')),
	).toBe(true)
})
test('KML never resolves network links and reports unsupported content', () => {
	const result = parse(
		fixture.replace(
			'</Document>',
			'<NetworkLink><Link><href>https://example.test/private</href></Link></NetworkLink><GroundOverlay/></Document>',
		),
	)
	expect(result.warnings.join(' ')).toContain('NetworkLink')
	expect(result.warnings.join(' ')).toContain('GroundOverlay')
	expect(Object.values(result.payload.layers).flatMap((layer) => layer.features)).toHaveLength(3)
})
test.each([
	['<!DOCTYPE kml [<!ENTITY external SYSTEM "file:///etc/passwd">]><kml/>', 'entities'],
	['<html><body>Sign in</body></html>', 'not valid KML'],
	[
		'<kml><NetworkLink><Link><href>https://example.test</href></Link></NetworkLink></kml>',
		'no supported geometry',
	],
	[fixture.replace('12.5,45.5', '181,45.5'), 'invalid longitude/latitude'],
	[fixture.replace('12.5,45.5', ',45.5'), 'invalid longitude/latitude'],
	[fixture.replace('name="survey"', 'name="__proto__"'), 'Unsafe KML property'],
])('rejects unsafe or unsupported KML input', (input, message) =>
	expect(() => parse(input)).toThrow(message),
)
