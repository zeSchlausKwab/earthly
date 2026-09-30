import { expect, test } from 'bun:test'
import type { Feature, FeatureCollection } from 'geojson'
import { MAPLET_LIMITS } from './collection'
import { validateMapletOutputs } from './outputs'

function point(id: string | number = 'one', description = ''): Feature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [16, 48] },
		properties: { description },
	}
}
function collection(features: Feature[] = []): FeatureCollection {
	return { type: 'FeatureCollection', features }
}
function output(id = 'first', features: Feature[] = []) {
	return { id, title: 'Configuration', collection: collection(features) }
}
function line(count: number): Feature {
	return {
		type: 'Feature',
		id: 'line',
		geometry: { type: 'LineString', coordinates: Array.from({ length: count }, () => [16, 48]) },
		properties: {},
	}
}

test('independent outputs keep titles and visibility while allowing shared upstream feature IDs', () => {
	const result = validateMapletOutputs([
		{ ...output('first', [point('same')]), title: ' First ', visible: false, preview: true },
		output('second', [point('same')]),
	])
	expect(result).toHaveLength(2)
	expect(result[0]).toMatchObject({
		id: 'first',
		title: 'First',
		visible: false,
		preview: true,
		warnings: [],
	})
	expect(result[1]).toMatchObject({ visible: true, preview: false })
	expect(result.map((item) => item.collection.features[0]?.id)).toEqual(['same', 'same'])
	expect(validateMapletOutputs([])).toEqual([])
})

test('output identities are unique and metadata has bounded, explicit types', () => {
	expect(() => validateMapletOutputs([output(), output()])).toThrow('configuration output')
	for (const patch of [
		{ id: '' },
		{ id: 1 },
		{ id: 'a'.repeat(201) },
		{ title: '' },
		{ title: '  ' },
		{ title: 'a'.repeat(161) },
		{ title: 5 },
		{ visible: 1 },
		{ visible: null },
		{ preview: 'true' },
		{ warnings: 'warning' },
		{ warnings: [null] },
	])
		expect(() => validateMapletOutputs([{ ...output(), ...patch }])).toThrow('configuration output')
	expect(() => validateMapletOutputs({})).toThrow('output limit')
	expect(() => validateMapletOutputs([null])).toThrow('configuration output')
	expect(
		validateMapletOutputs(Array.from({ length: 16 }, (_, index) => output(String(index)))),
	).toHaveLength(16)
	expect(() =>
		validateMapletOutputs(Array.from({ length: 17 }, (_, index) => output(String(index)))),
	).toThrow('output limit')
})

test('warnings are bounded and defaults are normalized without mutating the incoming array', () => {
	const warnings = Array.from({ length: 25 }, () => 'x'.repeat(600))
	const result = validateMapletOutputs([{ ...output(), warnings }])
	expect(result[0]?.warnings).toHaveLength(20)
	expect(result[0]?.warnings.every((warning) => warning.length === 500)).toBe(true)
	expect(warnings).toHaveLength(25)
	expect(warnings[0]?.length).toBe(600)
})

test('each collection is independently validated before it reaches map rendering', () => {
	expect(() => validateMapletOutputs([output('one', [point(), point()])])).toThrow(
		'Duplicate feature id',
	)
	expect(() =>
		validateMapletOutputs([
			{
				...output(),
				collection: {
					type: 'FeatureCollection',
					features: [{ ...point(), geometry: { type: 'Point', coordinates: [190, 48] } }],
				},
			},
		]),
	).toThrow('Invalid geographic')
	expect(() =>
		validateMapletOutputs([
			output(
				'one',
				Array.from({ length: MAPLET_LIMITS.features + 1 }, (_, index) => point(index)),
			),
		]),
	).toThrow('feature limit')
	const excessiveCoordinates: Feature = {
		type: 'Feature',
		id: 'many',
		properties: {},
		geometry: {
			type: 'MultiLineString',
			coordinates: [
				Array.from({ length: 25_001 }, () => [16, 48]),
				Array.from({ length: 25_000 }, () => [16, 48]),
			],
		},
	}
	expect(() => validateMapletOutputs([output('one', [excessiveCoordinates])])).toThrow(
		'coordinate limit',
	)
	expect(() =>
		validateMapletOutputs([
			output(
				'one',
				Array.from({ length: 600 }, (_, index) => point(index, 'x'.repeat(10_000))),
			),
		]),
	).toThrow('size limit')
})

test('the aggregate feature budget includes all hidden and preview configurations', () => {
	const first = output(
		'first',
		Array.from({ length: 2500 }, (_, index) => point(index)),
	)
	const second = {
		...output(
			'second',
			Array.from({ length: 2501 }, (_, index) => point(index)),
		),
		visible: false,
		preview: true,
	}
	expect(() => validateMapletOutputs([first, second])).toThrow('feature limit')
})

test('aggregate coordinate and byte budgets cannot be bypassed with several valid outputs', () => {
	expect(() =>
		validateMapletOutputs([
			output('first', [line(30_000)]),
			{ ...output('second', [line(30_000)]), visible: false },
		]),
	).toThrow('coordinate limit')
	const features = Array.from({ length: 550 }, (_, index) => point(index, 'x'.repeat(5000)))
	expect(validateMapletOutputs([output('single', features)])).toHaveLength(1)
	expect(() =>
		validateMapletOutputs([output('first', features), output('second', features)]),
	).toThrow('size limit')
})

test('aggregate byte budgeting includes original feature IDs rather than shorter temporary validation IDs', () => {
	const features = Array.from({ length: 2000 }, (_, index) =>
		point(`${String(index).padStart(4, '0')}${'x'.repeat(251)}`, 'x'.repeat(1000)),
	)
	const first = output('first', features),
		second = output('second', features)
	expect(JSON.stringify(first.collection).length).toBeLessThan(MAPLET_LIMITS.bytes)
	expect(
		JSON.stringify(first.collection).length + JSON.stringify(second.collection).length,
	).toBeGreaterThan(MAPLET_LIMITS.bytes)
	expect(validateMapletOutputs([first])).toHaveLength(1)
	expect(() => validateMapletOutputs([first, second])).toThrow('size limit')
})

test('a preview can replace another same-runtime output without requiring the original to be active', () => {
	const result = validateMapletOutputs([
		output('saved'),
		{ ...output('preview:saved'), preview: true, previewOf: 'saved' },
	])
	expect(result[0]).toMatchObject({ id: 'saved', visible: true, preview: false })
	expect(result[0]).not.toHaveProperty('previewOf')
	expect(result[1]).toMatchObject({
		id: 'preview:saved',
		visible: true,
		preview: true,
		previewOf: 'saved',
	})
	expect(
		validateMapletOutputs([
			{ ...output('preview:draft'), preview: true, previewOf: 'not-on-map' },
		])[0]?.previewOf,
	).toBe('not-on-map')
})

test('preview references are bounded and cannot masquerade as an active output or replace themselves', () => {
	for (const patch of [
		{ preview: true, previewOf: '' },
		{ preview: true, previewOf: 1 },
		{ preview: true, previewOf: 'x'.repeat(201) },
		{ preview: true, previewOf: 'first' },
		{ preview: false, previewOf: 'other' },
		{ previewOf: 'other' },
	])
		expect(() => validateMapletOutputs([{ ...output(), ...patch }])).toThrow('configuration output')
})
