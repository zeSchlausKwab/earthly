import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import type { EditorFeature } from '@/features/geo-editor/core/types'
import {
	clearPendingDiffs,
	getAllPendingDiffs,
	resolvePendingDiff,
} from '@/features/chat/safeEditing/pendingDiffStore'
import { setSafetyLevelProvider } from '@/features/chat/safeEditing/safetyAccess'
import type { SafetyLevel } from '@/features/chat/safeEditing/AuthoringGate'
import { terminateOptimizeWorker } from '@/features/chat/geometry/optimizeClient'
import { isToolError } from './errors'
import { advertise, dispatch, register, registry } from './registry'
// RED (Wave 0): `./geometry-tools` lands in Wave 3. The import itself fails to resolve
// so this file is red on landing (intended). `registerGeometryTools` is the Wave-3 symbol.
import { registerGeometryTools } from './geometry-tools'

/**
 * GEO-01/02/03 `optimize_geometry` tool contract, written FIRST. Driven through the
 * registry dispatch against a headless editor (the bulk-tools.test idiom). Pins:
 *   - registration: `optimize_geometry` is registered + advertised.
 *   - schema (D-04): the ONLY model-facing arg is an optional `targetBytes` — NO
 *     feature/id array (host owns the full bound set, SAFE-05).
 *   - gate: dispatching with a mocked safety level routes the converged result through
 *     the Phase-5/6 gate classified as `'modify'` (one snapshot, one undo).
 */

function lineFeature(id: string, coordinates: [number, number][]): EditorFeature {
	return {
		type: 'Feature',
		id,
		geometry: { type: 'LineString', coordinates },
		properties: { name: 'seg' },
	} as EditorFeature
}

function seedFeatures(features: EditorFeature[]): void {
	const editor = useEditorStore.getState().editor
	if (!editor) throw new Error('no editor — call beforeEach setup first')
	editor.setFeatures(features)
}

function setLevel(level: SafetyLevel): void {
	setSafetyLevelProvider(() => level)
}

// `bun:test` cannot drive a real `new Worker(workerUrl(...))` — there is no dev
// `/workers/:name` route, so the worker fails to load ASYNCHRONOUSLY (well after a
// single tick), and the optimize RPC would not settle within the one-tick window the
// gate-emission assertion below allows. Remove `globalThis.Worker` for the suite so the
// always-settling client takes its synchronous fallback through the SAME pure
// `optimize()` (the established idiom from `ingestClient.test.ts`'s `withoutWorker`).
let savedWorker: unknown
beforeEach(() => {
	savedWorker = (globalThis as { Worker?: unknown }).Worker
	;(globalThis as { Worker?: unknown }).Worker = undefined
	terminateOptimizeWorker()
	const editor = createHeadlessEditor()
	useEditorStore.getState().setEditor(editor)
	registerGeometryTools(register)
	clearPendingDiffs()
	setLevel(2) // require confirm → a gate block is emitted (assertable)
})

afterEach(() => {
	;(globalThis as { Worker?: unknown }).Worker = savedWorker
	terminateOptimizeWorker()
	useEditorStore.getState().setEditor(null)
	clearPendingDiffs()
	setSafetyLevelProvider(() => 2)
})

describe('registerGeometryTools — optimize_geometry registered + advertised', () => {
	it('registers optimize_geometry', () => {
		const names = advertise().map((t) => t.function.name)
		expect(registry.has('optimize_geometry')).toBe(true)
		expect(names).toContain('optimize_geometry')
	})
})

describe('optimize_geometry — schema (D-04, target-only)', () => {
	it('exposes ONLY an optional targetBytes; no feature/id array', () => {
		const tool = advertise().find((t) => t.function.name === 'optimize_geometry')
		const params = (tool?.function.parameters ?? {}) as {
			properties?: Record<string, unknown>
			required?: string[]
		}
		const props = params.properties ?? {}
		const keys = Object.keys(props)
		expect(keys).toContain('targetBytes')
		expect(keys).not.toContain('features')
		expect(keys).not.toContain('featureIds')
		// targetBytes is optional (the default is the publish budget).
		expect(params.required ?? []).not.toContain('targetBytes')
		const serialized = JSON.stringify(tool?.function.parameters ?? {})
		expect(serialized).not.toContain('featureIds')
	})
})

describe('optimize_geometry — gates as modify (one snapshot)', () => {
	it('dispatch emits a pending gate block classified modify', async () => {
		seedFeatures([
			lineFeature('a', [
				[0, 0],
				[1, 0.000001],
				[2, 0],
			]),
			lineFeature('b', [
				[3, 3],
				[4, 4.000001],
				[5, 5],
			]),
		])

		// Level 2 → confirm required → a single pending diff is emitted (not auto-applied).
		const pending = dispatch('optimize_geometry', {})
		// Give the gate a tick to register the pending block.
		await new Promise((r) => setTimeout(r, 0))
		const diffs = getAllPendingDiffs().filter((d) => d.status === 'pending')
		expect(diffs.length).toBe(1)
		expect(diffs[0]?.intent).toBe('modify')

		// Simulate the user clicking Apply on the gated block so the awaited
		// `requestConfirm` resolves and the handler promise settles (a Level-2
		// confirm never resolves on its own — the disclosure's Apply button does).
		resolvePendingDiff(diffs[0]?.id ?? '', 'applied')

		await pending.catch(() => undefined)
		expect(isToolError(await pending.catch((e) => e))).toBe(false)
	})
})
