import { test, expect, describe, beforeEach } from 'bun:test'
import type { EditorFeature } from '@/features/geo-editor/core'
import type { GeoEditor } from '@/features/geo-editor/core/GeoEditor'
import { gateBulkApply, type GateBulkDeps } from './gateBulkEdit'
import { clearPendingDiffs, getPendingDiff } from './pendingDiffStore'

/**
 * Minimal headless editor stub — the gate only touches `getAllFeatures`,
 * `pushDatasetSnapshot`, and `undoLastDatasetSnapshot`. Cast at the test boundary
 * only (mirrors the core test-harness idiom); production GeoEditor types untouched.
 */
function feat(id: string, name: string): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'Point', coordinates: [0, 0] },
		properties: { name },
	} as EditorFeature
}

function makeEditor(): {
	editor: GeoEditor
	features: EditorFeature[]
	snapshots: string[]
} {
	const features: EditorFeature[] = [feat('m1', 'before')]
	const snapshots: string[] = []
	const stub = {
		getAllFeatures: () => [...features],
		pushDatasetSnapshot: (label: string) => {
			snapshots.push(label)
		},
		undoLastDatasetSnapshot: () => {
			snapshots.pop()
		},
	}
	return { editor: stub as unknown as GeoEditor, features, snapshots }
}

beforeEach(() => {
	clearPendingDiffs()
})

describe('gateBulkApply headline threading (D-04b / GEO-02)', () => {
	test('when deps.headline is supplied, the emitted pending entry carries it', async () => {
		const { editor, features } = makeEditor()
		const deps: GateBulkDeps = {
			getSafetyLevel: () => 3, // Level 3 → immediate apply, no await
			label: 'Optimize geometry',
			headline: '12.0MB → 0.9MB · 41k→3.2k pts',
		}
		const apply = () => {
			// real mutation: rename m1 so the diff is a non-noop modify
			features[0] = feat('m1', 'after')
		}
		const outcome = await gateBulkApply(editor, deps, 'modify', apply)
		expect(outcome.status).toBe('applied')
		const entry = getPendingDiff(outcome.diffId)
		expect(entry?.headline).toBe('12.0MB → 0.9MB · 41k→3.2k pts')
	})

	test('when deps.headline is omitted, the emitted entry has no headline (backward-compatible)', async () => {
		const { editor, features } = makeEditor()
		const deps: GateBulkDeps = {
			getSafetyLevel: () => 3,
			label: 'Batch edit features',
		}
		const apply = () => {
			features[0] = feat('m1', 'after')
		}
		const outcome = await gateBulkApply(editor, deps, 'modify', apply)
		expect(outcome.status).toBe('applied')
		const entry = getPendingDiff(outcome.diffId)
		expect(entry?.headline).toBeUndefined()
	})
})
