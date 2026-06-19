import { beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '../core/test-harness'
import type { GeoEditor } from '../core/GeoEditor'
import {
	dupIdCollection,
	emptyFeatureCollection,
	singlePointCollection,
} from '@/lib/test-fixtures/geo'
import type { Authoring } from './authoring'
import { createAuthoring } from './authoring'

describe('createAuthoring — addFeature (D-10/D-11, T-02-04 reuse)', () => {
	let editor: GeoEditor
	let authoring: Authoring

	beforeEach(() => {
		editor = createHeadlessEditor()
		authoring = createAuthoring(editor)
	})

	it('adds a single feature, returns intent:add + created:1, and preserves importSource', () => {
		const result = authoring.addFeature(singlePointCollection.features[0])

		expect(result.ok).toBe(true)
		expect(result.intent).toBe('add')
		expect(result.featureIds).toEqual(['test-point-1'])
		expect(result.counts.created).toBe(1)

		const stored = editor.getAllFeatures().find((f) => f.id === 'test-point-1')
		expect(stored).toBeDefined()
		// importSource preserved proves toEditorFeature reuse (not reimplementation).
		expect(stored?.properties?.importSource).toBe('chat_tool')
	})

	it('honors an explicit source argument', () => {
		authoring.addFeature(singlePointCollection.features[0], 'manual')
		const stored = editor.getAllFeatures().find((f) => f.id === 'test-point-1')
		expect(stored?.properties?.importSource).toBe('manual')
	})

	it('guards null/undefined feature → { ok:false }', () => {
		// @ts-expect-error — intentionally passing an invalid feature at the boundary
		const result = authoring.addFeature(null)
		expect(result.ok).toBe(false)
		expect(result.counts.created).toBe(0)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	it('wraps a bare Geometry into a Feature → created:1 (model ergonomics)', () => {
		// A frequent model mistake: passing a raw Geometry (no Feature wrapper).
		const result = authoring.addFeature({
			type: 'Point',
			coordinates: [13.4, 52.5],
		} as never)
		expect(result.ok).toBe(true)
		expect(result.counts.created).toBe(1)
		expect(editor.getAllFeatures()).toHaveLength(1)
	})

	it('throws a descriptive error for non-null, non-geometry input (no silent created:0)', () => {
		expect(() => authoring.addFeature({ foo: 'bar' } as never)).toThrow(
			/not a usable GeoJSON Feature/,
		)
		expect(() =>
			authoring.addFeature({ type: 'FeatureCollection', features: [] } as never),
		).toThrow(/FeatureCollection/)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})

	it('reports an accurate created count across a loop of addFeature calls (run_code count fix)', () => {
		for (let i = 0; i < 61; i++) {
			authoring.addFeature({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: [14.5 + i * 0.01, 47.5] },
			})
		}
		expect(editor.getAllFeatures()).toHaveLength(61)
	})

	it('preserves raw style properties (fillColor/strokeColor/color) through the write path (UAT gap)', () => {
		const result = authoring.addFeature({
			type: 'Feature',
			id: 'styled-raw',
			geometry: { type: 'Point', coordinates: [13.4, 52.5] },
			properties: { fillColor: '#ff0000', strokeColor: '#00ff00', color: '#0000ff' },
		})
		expect(result.ok).toBe(true)
		const stored = editor.getFeature('styled-raw')
		expect(stored?.properties?.fillColor).toBe('#ff0000')
		expect(stored?.properties?.strokeColor).toBe('#00ff00')
		expect(stored?.properties?.color).toBe('#0000ff')
	})
})

describe('createAuthoring — writeGeoJSON replace (D-11 replace semantics)', () => {
	it('replaces the editor feature set; counts.created === features.length', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		// Seed an existing feature that replace must drop.
		authoring.addFeature(singlePointCollection.features[0])
		expect(editor.getAllFeatures()).toHaveLength(1)

		const result = authoring.writeGeoJSON(dupIdCollection.features, { replace: true })

		expect(result.ok).toBe(true)
		expect(result.counts.created).toBe(dupIdCollection.features.length)
		// dupIdCollection has two features with the same id → one stored after replace.
		const ids = editor.getAllFeatures().map((f) => f.id)
		expect(ids).toEqual(['dup-id'])
		// The seeded test-point-1 is gone (replace, not append).
		expect(ids).not.toContain('test-point-1')
	})

	it('replace with an empty collection clears the editor', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)
		authoring.addFeature(singlePointCollection.features[0])

		const result = authoring.writeGeoJSON(emptyFeatureCollection.features, { replace: true })
		expect(result.ok).toBe(true)
		expect(result.counts.created).toBe(0)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})
})

describe('createAuthoring — writeGeoJSON append (dedup-by-id, T-02-04 verbatim)', () => {
	it('skips duplicate ids: skippedDuplicates === 1, one stored feature for the dup id', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		const result = authoring.writeGeoJSON(dupIdCollection.features, { replace: false })

		expect(result.ok).toBe(true)
		expect(result.intent).toBe('add')
		expect(result.counts.created).toBe(1)
		expect(result.counts.skippedDuplicates).toBe(1)
		expect(result.featureIds).toEqual(['dup-id'])

		const dupFeatures = editor.getAllFeatures().filter((f) => f.id === 'dup-id')
		expect(dupFeatures).toHaveLength(1)
		// First-write-wins: the surviving feature is the first one (coords [0,0]).
		expect(dupFeatures[0]?.geometry).toEqual({ type: 'Point', coordinates: [0, 0] })
	})

	it('append against existing ids skips them too', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		// Pre-seed dup-id, then append the dupIdCollection — both should be skipped.
		authoring.addFeature(dupIdCollection.features[0])
		const result = authoring.writeGeoJSON(dupIdCollection.features, { replace: false })

		expect(result.counts.created).toBe(0)
		expect(result.counts.skippedDuplicates).toBe(2)
		expect(editor.getAllFeatures().filter((f) => f.id === 'dup-id')).toHaveLength(1)
	})
})

describe('createAuthoring — writeGeoJSON polymorphic input (FeatureCollection no-op fix)', () => {
	const f1: import('geojson').Feature = {
		type: 'Feature',
		id: 'fc-1',
		properties: {},
		geometry: { type: 'Point', coordinates: [13.4, 52.5] },
	}
	const f2: import('geojson').Feature = {
		type: 'Feature',
		id: 'fc-2',
		properties: {},
		geometry: { type: 'Point', coordinates: [13.5, 52.6] },
	}

	it('accepts a FeatureCollection object → creates N (NOT a silent created:0)', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		// The exact bug from the UAT dump: the model passed a FeatureCollection
		// object (with no options bag) and got created:0 twice. It must create 2.
		const result = authoring.writeGeoJSON({ type: 'FeatureCollection', features: [f1, f2] })

		expect(result.ok).toBe(true)
		expect(result.counts.created).toBe(2)
		expect(editor.getAllFeatures()).toHaveLength(2)
	})

	it('FeatureCollection with replace:true clears + sets', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)
		authoring.addFeature(singlePointCollection.features[0])

		const result = authoring.writeGeoJSON(
			{ type: 'FeatureCollection', features: [f1, f2] },
			{ replace: true },
		)
		expect(result.counts.created).toBe(2)
		const ids = editor.getAllFeatures().map((f) => f.id)
		expect(ids.sort()).toEqual(['fc-1', 'fc-2'])
		expect(ids).not.toContain('test-point-1')
	})

	it('accepts a single Feature → creates 1', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		const result = authoring.writeGeoJSON(f1)
		expect(result.counts.created).toBe(1)
		expect(editor.getAllFeatures()).toHaveLength(1)
	})

	it('defaults replace to false (append) when options is omitted', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)
		authoring.addFeature(singlePointCollection.features[0])

		authoring.writeGeoJSON({ type: 'FeatureCollection', features: [f1] })
		// test-point-1 survives because the default is append, not replace.
		const ids = editor.getAllFeatures().map((f) => f.id)
		expect(ids).toContain('test-point-1')
		expect(ids).toContain('fc-1')
	})

	it('throws (not a silent no-op) on genuinely unusable input', () => {
		const editor = createHeadlessEditor()
		const authoring = createAuthoring(editor)

		// @ts-expect-error — intentionally unusable input at the boundary
		expect(() => authoring.writeGeoJSON(null)).toThrow(/not a usable GeoJSON input/)
		// @ts-expect-error — a plain object with no GeoJSON type
		expect(() => authoring.writeGeoJSON({ foo: 'bar' })).toThrow(/not a usable GeoJSON input/)
		expect(editor.getAllFeatures()).toHaveLength(0)
	})
})
