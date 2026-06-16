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
