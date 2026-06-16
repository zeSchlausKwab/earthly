/**
 * BINDING behavior-preservation gate (ROADMAP criterion #2, threat T-02-06).
 *
 * Plan 03 reroutes the chat dual-write (`importFeaturesToEditor`) and the UI import
 * sites through the Authoring API. This gate proves the NEW `authoring.writeGeoJSON`
 * path produces a feature set BYTE-IDENTICAL to the OLD `importFeaturesToEditor`
 * normalization + dedup-by-id — ids, geometry, importSource, customProperties, and
 * skippedDuplicates counts all deep-equal.
 *
 * OLD-path reference construction: we reproduce the EXACT pre-refactor body of
 * `importFeaturesToEditor` (the `toEditorFeature(f, 'chat_tool')` normalization + the
 * verbatim dedup-by-id loop) against a fresh headless editor. This is the captured
 * reference invocation. The NEW path runs `createAuthoring(editor).writeGeoJSON` against
 * a second headless editor. We then deep-equal the two editors' feature sets.
 *
 * Reusing `toEditorFeature` verbatim in BOTH paths is the whole point — if the facade
 * ever reimplemented normalization, this gate goes red.
 */

import { describe, expect, it } from 'bun:test'
import type { EditorFeature } from '../core/types'
import { createHeadlessEditor } from '../core/test-harness'
import { toEditorFeature } from '../utils'
import {
	dupIdCollection,
	emptyFeatureCollection,
	singlePointCollection,
} from '@/lib/test-fixtures/geo'
import { createAuthoring } from './authoring'

/**
 * The OLD `importFeaturesToEditor` body, reproduced verbatim as the reference oracle.
 * Returns the resulting editor feature set + dedup count for deep-equality assertions.
 */
function oldImportPath(
	features: GeoJSON.Feature[],
	replaceExisting: boolean,
): { features: EditorFeature[]; skippedDuplicates: number; importedCount: number } {
	const editor = createHeadlessEditor()
	const normalized = features.map((f) => toEditorFeature(f, 'chat_tool'))

	if (replaceExisting) {
		editor.setFeatures(normalized)
		return {
			features: editor.getAllFeatures(),
			skippedDuplicates: 0,
			importedCount: normalized.length,
		}
	}

	const existingIds = new Set(editor.getAllFeatures().map((feature) => feature.id))
	let importedCount = 0
	let skippedDuplicates = 0
	for (const feature of normalized) {
		if (existingIds.has(feature.id)) {
			skippedDuplicates += 1
			continue
		}
		editor.addFeature(feature)
		existingIds.add(feature.id)
		importedCount += 1
	}
	return { features: editor.getAllFeatures(), skippedDuplicates, importedCount }
}

/** The NEW path: route the same features through the Authoring facade. */
function newAuthoringPath(
	features: GeoJSON.Feature[],
	replaceExisting: boolean,
): { features: EditorFeature[]; skippedDuplicates: number; importedCount: number } {
	const editor = createHeadlessEditor()
	const result = createAuthoring(editor).writeGeoJSON(features, { replace: replaceExisting })
	return {
		features: editor.getAllFeatures(),
		skippedDuplicates: result.counts.skippedDuplicates,
		importedCount: result.counts.created,
	}
}

function assertPathsIdentical(features: GeoJSON.Feature[], replaceExisting: boolean) {
	const oldResult = oldImportPath(features, replaceExisting)
	const newResult = newAuthoringPath(features, replaceExisting)

	// Feature sets byte-identical: ids, geometry, importSource, customProperties, meta.
	expect(newResult.features).toEqual(oldResult.features)
	// Dedup + imported counts identical.
	expect(newResult.skippedDuplicates).toBe(oldResult.skippedDuplicates)
	expect(newResult.importedCount).toBe(oldResult.importedCount)
}

describe('authoring golden gate — OLD vs NEW feature-set equality (criterion #2)', () => {
	it('singlePointCollection — replace path is byte-identical', () => {
		assertPathsIdentical(singlePointCollection.features, true)
	})

	it('singlePointCollection — append path is byte-identical', () => {
		assertPathsIdentical(singlePointCollection.features, false)
	})

	it('dupIdCollection — append dedups identically (first-write-wins)', () => {
		assertPathsIdentical(dupIdCollection.features, false)
		// Sanity: the dup fixture must actually exercise the dedup branch.
		const { skippedDuplicates } = newAuthoringPath(dupIdCollection.features, false)
		expect(skippedDuplicates).toBe(1)
	})

	it('dupIdCollection — replace keeps both (no dedup on replace), identical', () => {
		assertPathsIdentical(dupIdCollection.features, true)
	})

	it('empty collection — both paths yield an empty editor', () => {
		assertPathsIdentical(emptyFeatureCollection.features, false)
		assertPathsIdentical(emptyFeatureCollection.features, true)
	})

	it('preserves importSource tag on the stored features (toEditorFeature reuse)', () => {
		const { features } = newAuthoringPath(singlePointCollection.features, true)
		for (const f of features) {
			expect((f.properties as Record<string, unknown>).importSource).toBe('chat_tool')
		}
	})
})
