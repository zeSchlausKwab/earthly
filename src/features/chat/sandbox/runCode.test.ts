/**
 * `run_code` tool proofs.
 *
 * Task 2 ("error feedback"): a script that throws AND a script that runs past the
 * wall-clock deadline both make the handler throw the FULL error, which
 * `registry.dispatch` wraps into a structured `ToolError(handler_error)` fed to
 * the model loop (CODE-03 / D-11 / D-13).
 *
 * Task 3 ("fibonacci" / "overfly"): the two acceptance-bar headline scripts run
 * end-to-end against a real headless editor — handler → runSandbox (direct pure
 * engine, since QuickJS-WASM-in-a-spawned-Worker segfaults under `bun test`) →
 * replay through createAuthoring → real MutationCounts.
 *
 * Editor injection: the handler resolves the editor via `useEditorStore.getState()`.
 * The tests push a `createHeadlessEditor()` into the store with
 * `useEditorStore.setState({ editor })` and inject the direct sandbox transport
 * via `setSandboxTransportForTests` (the only test seam — production never sets it).
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { evictDataset, putDataset, toModelSummary } from '@/features/chat/ingest/ingestStore'
import { createHeadlessEditor } from '@/features/geo-editor/core/test-harness'
import { useEditorStore } from '@/features/geo-editor/store'
import { dispatch, isToolError } from '@/features/chat/tools/registry'
import { directEngineTransport, type SandboxTransport } from './sandboxHost'
import {
	RUN_CODE_RETRY_CAP,
	resetRunCodeFailureCounterForTests,
	setSandboxTransportForTests,
} from './runCode'

const seededHandles: string[] = []
let prevEditor: unknown

beforeEach(() => {
	setSandboxTransportForTests(directEngineTransport)
	// The HARD retry cap (D-06) uses a module-level consecutive-failure counter that
	// persists across a session in production; reset it per test so the deliberate
	// failures in one case don't trip the cap in the next.
	resetRunCodeFailureCounterForTests()
	prevEditor = useEditorStore.getState().editor
})

afterEach(() => {
	setSandboxTransportForTests(undefined)
	useEditorStore.setState({ editor: prevEditor as never })
	for (const h of seededHandles) evictDataset(h)
	seededHandles.length = 0
})

function useHeadlessEditor() {
	const editor = createHeadlessEditor()
	useEditorStore.setState({ editor: editor as never })
	return editor
}

describe('run_code — error feedback (CODE-03 / D-11 / D-13)', () => {
	it('a script that throws surfaces the FULL error as a ToolError(handler_error)', async () => {
		useHeadlessEditor()
		const result = await dispatch('run_code', {
			code: 'throw new Error("boom inside the sandbox")',
		})
		expect(isToolError(result)).toBe(true)
		const err = result as { kind: string; message: string }
		expect(err.kind).toBe('handler_error')
		expect(err.message).toContain('boom inside the sandbox')
	})

	it('a script that runs past the deadline is a retryable timeout fed back to the model (D-13)', async () => {
		useHeadlessEditor()
		const result = await dispatch('run_code', {
			code: 'while (true) {}',
		})
		expect(isToolError(result)).toBe(true)
		const err = result as { kind: string; message: string }
		expect(err.kind).toBe('handler_error')
		// D-13: the model is told the script was terminated for exceeding the deadline.
		expect(err.message.toLowerCase()).toMatch(/exceed|terminat|deadline|interrupt/)
	}, 15_000) // test itself headroom past it. // The run burns the FULL default sandbox deadline (10s) by design — give the
})

describe('run_code — bounded self-correction is a HARD stop (D-06, runaway fix)', () => {
	it('stops INVOKING the sandbox after RUN_CODE_RETRY_CAP consecutive failures (no spawn storm)', async () => {
		useHeadlessEditor()

		// A transport that always fails AND counts how many times the boundary is actually
		// invoked. Each invocation in production is a QuickJS sandbox run on the warm worker
		// — the runaway is unbounded invocations. The breaker must bound them.
		let invocations = 0
		const alwaysFails: SandboxTransport = async () => {
			invocations += 1
			return { id: 'fail', success: false, error: 'deliberate failure', recordedCalls: [] }
		}
		setSandboxTransportForTests(alwaysFails)

		// Drive run_code in a window of (cap + 1) calls: the first `cap` calls fail and
		// invoke the boundary; the (cap+1)th MUST be refused before any sandbox run.
		const window = RUN_CODE_RETRY_CAP + 1
		const messages: string[] = []
		for (let i = 0; i < window; i++) {
			const r = await dispatch('run_code', { code: 'throw new Error("x")' })
			expect(isToolError(r)).toBe(true)
			messages.push((r as { message: string }).message)
		}

		// At most `cap` boundary invocations per (cap+1)-call window — the extra call was
		// refused before any sandbox run, so an unbounded spawn storm is impossible.
		expect(invocations).toBe(RUN_CODE_RETRY_CAP)
		// The breaker call reports the explicit halt, not another sandbox failure.
		expect(messages[window - 1]).toContain('halted')

		// The breaker RESET on trip, so a later legitimate (succeeding) run proceeds again
		// and clears the counter — the model is not permanently bricked.
		setSandboxTransportForTests(directEngineTransport)
		const ok = await dispatch('run_code', { code: '1 + 1' })
		expect(isToolError(ok)).toBe(false)
		expect((ok as { ok: boolean }).ok).toBe(true)
	})
})

describe('run_code — setDatasetMetadata replays (dataset-level metadata in sandbox)', () => {
	it('authoring.setDatasetMetadata from a script sets the store collectionMeta', async () => {
		useHeadlessEditor()
		useEditorStore.setState({
			collectionMeta: { name: '', description: '', color: '#1d4ed8', customProperties: {} },
			activeGeoEditDraftId: null,
		})

		const code = `
			authoring.setDatasetMetadata({ name: 'Sandbox Set', description: 'via run_code', properties: { source: 'osm' } })
			'named'
		`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)

		const meta = useEditorStore.getState().collectionMeta
		expect(meta.name).toBe('Sandbox Set')
		expect(meta.description).toBe('via run_code')
		expect(meta.customProperties).toEqual({ source: 'osm' })
	})
})

describe('run_code — commitDataset replays as one validated authoring operation', () => {
	it('commits a provenance-carrying FeatureCollection and metadata', async () => {
		const editor = useHeadlessEditor()
		const code = `
			authoring.commitDataset({
				featureCollection: { type: 'FeatureCollection', features: [{
					type: 'Feature', id: 'source-row-1',
					geometry: { type: 'Point', coordinates: [14.3, 46.6] },
					properties: {
						sourceUrl: 'https://en.wikipedia.org/wiki/Example', sourceTitle: 'Example',
						sourceRevisionId: 123, sourceSection: 'Cases', sourceTable: 0, sourceRow: 1,
						sourceRetrievedAt: '2026-07-21T00:00:00.000Z', coordinatePrecision: 'representative'
					}
				}] },
				metadata: { name: 'Verified research' },
				requireFeatureProvenance: true
			})
			'done'
		`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		expect(editor.getAllFeatures().map((feature) => feature.id)).toEqual(['source-row-1'])
		expect(useEditorStore.getState().collectionMeta.name).toBe('Verified research')
	})
})

describe('run_code — interceptor-seam invariant (CR-01)', () => {
	it('refuses to replay a non-intercepted authoring op (editorCommand) — defence in depth', async () => {
		const editor = useHeadlessEditor()
		// Forge a recorded batch naming `editorCommand` (the raw passthrough that does
		// NOT route through runInterceptors). The worker no longer exposes it, but a
		// hand-crafted/foreign batch must still be rejected by the host before it can
		// mutate the editor — proving no sandbox-reachable write escapes the seam.
		const maliciousTransport: SandboxTransport = async () => ({
			id: 'malicious',
			success: true,
			recordedCalls: [{ op: 'editorCommand', args: ['clearAll', {}] }],
			consoleLines: [],
			truncated: false,
			returnValue: 'pwned',
		})
		setSandboxTransportForTests(maliciousTransport)

		const result = await dispatch('run_code', { code: 'authoring.editorCommand("clearAll")' })
		expect(isToolError(result)).toBe(true)
		const err = result as { kind: string; message: string }
		expect(err.kind).toBe('handler_error')
		expect(err.message).toContain('CR-01')
		// The forged op never touched the editor.
		expect(editor.getAllFeatures().length).toBe(0)
	})
})

describe('run_code — WR-04 recorded-call write-channel cap (DoS)', () => {
	it('rejects an over-budget recorded batch BEFORE replay — no editor mutation (count budget)', async () => {
		const editor = useHeadlessEditor()
		// A transport that reports the over-budget flag the worker would set once the
		// recorded-call COUNT cap is hit. The host must refuse the WHOLE batch before
		// replaying a single op (T-05-06 / T-05-08).
		const overBudget: SandboxTransport = async () => ({
			id: 'over-budget-count',
			success: true,
			recordedCalls: [
				{ op: 'addFeature', args: [{ type: 'Point', coordinates: [0, 0] }] },
				{ op: 'addFeature', args: [{ type: 'Point', coordinates: [1, 1] }] },
			],
			recordedCallsOverBudget: true,
			consoleLines: [],
			truncated: false,
			returnValue: 'ignored',
		})
		setSandboxTransportForTests(overBudget)

		const result = await dispatch('run_code', {
			code: 'for (let i=0;i<1e6;i++) authoring.addFeature(0)',
		})
		expect(isToolError(result)).toBe(true)
		const err = result as { kind: string; message: string }
		expect(err.kind).toBe('handler_error')
		// Descriptive, model-facing over-budget error (not a silent partial apply).
		expect(err.message.toLowerCase()).toMatch(/budget|cap|too many|over-budget|exceed/)
		// CRITICAL: zero features created — the batch was rejected before any replay.
		expect(editor.getAllFeatures().length).toBe(0)
	})

	it('rejects an over-budget recorded batch BEFORE replay — no editor mutation (byte budget)', async () => {
		const editor = useHeadlessEditor()
		// The byte-budget path sets the SAME flag (the worker stops accumulating once
		// total serialized arg bytes exceed the cap). The host rejection is identical.
		const overBudget: SandboxTransport = async () => ({
			id: 'over-budget-bytes',
			success: true,
			recordedCalls: [{ op: 'writeGeoJSON', args: [{ huge: 'x'.repeat(1024) }] }],
			recordedCallsOverBudget: true,
			consoleLines: [],
			truncated: false,
			returnValue: 'ignored',
		})
		setSandboxTransportForTests(overBudget)

		const result = await dispatch('run_code', { code: 'authoring.writeGeoJSON(huge)' })
		expect(isToolError(result)).toBe(true)
		const err = result as { kind: string; message: string }
		expect(err.kind).toBe('handler_error')
		expect(err.message.toLowerCase()).toMatch(/budget|cap|too many|over-budget|exceed/)
		expect(editor.getAllFeatures().length).toBe(0)
	})

	it('the worker sets the over-budget flag and stops appending once the call-count cap is hit (real engine)', async () => {
		// Drive the REAL pure engine: a script that records far more authoring calls
		// than MAX_RECORDED_CALLS. The worker must (a) stop appending past the cap and
		// (b) flag the response so the host rejects it.
		const { runSandboxCode, MAX_RECORDED_CALLS } = await import('./transport/sandbox.worker')
		const overCount = MAX_RECORDED_CALLS + 50
		const code = `for (let i = 0; i < ${overCount}; i++) { authoring.addFeature({ type: 'Point', coordinates: [0, 0] }) } 'done'`
		const res = await runSandboxCode({ code, readSnapshot: null, deadlineMs: 3000 })
		expect(res.success).toBe(true)
		expect(res.recordedCallsOverBudget).toBe(true)
		// Bounded: never accumulates the full overCount (bounded overshoot of <= 1).
		expect((res.recordedCalls ?? []).length).toBeLessThanOrEqual(MAX_RECORDED_CALLS)
	})

	it('the worker sets the over-budget flag once the serialized-byte cap is hit (real engine)', async () => {
		const { runSandboxCode, MAX_RECORDED_ARG_BYTES } = await import('./transport/sandbox.worker')
		// One writeGeoJSON whose single serialized arg blows the byte budget on its own.
		const bigStringLen = MAX_RECORDED_ARG_BYTES + 1024
		const code = `authoring.writeGeoJSON({ blob: 'x'.repeat(${bigStringLen}) }); 'done'`
		const res = await runSandboxCode({ code, readSnapshot: null, deadlineMs: 3000 })
		expect(res.success).toBe(true)
		expect(res.recordedCallsOverBudget).toBe(true)
	})

	it('a within-budget batch replays unchanged (no false positive)', async () => {
		const editor = useHeadlessEditor()
		const code = `
			for (let i = 0; i < 5; i++) authoring.addFeature(turf.point([14.5 + i * 0.01, 47.5]))
			'ok'
		`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		const out = result as { ok: boolean; counts: { created: number } }
		expect(out.ok).toBe(true)
		expect(out.counts.created).toBe(5)
		expect(editor.getAllFeatures().length).toBe(5)
	})
})

describe('run_code — fibonacci circles headline (CODE-05)', () => {
	it('draws exactly 15 circles and returns the final expression value', async () => {
		const editor = useHeadlessEditor()
		const code = `
			let a = 1, b = 1
			const center = [14.5, 47.5]
			for (let i = 0; i < 15; i++) {
				authoring.circle(center, a * 100, { units: 'meters' })
				;[a, b] = [b, a + b]
			}
			\`drew 15 circles, max radius \${a * 100}m\`
		`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		const out = result as {
			ok: boolean
			counts: { created: number }
			returnValue: unknown
		}
		expect(out.ok).toBe(true)
		expect(out.counts.created).toBe(15)
		expect(editor.getAllFeatures().length).toBe(15)
		expect(typeof out.returnValue).toBe('string')
		expect(out.returnValue as string).toContain('15 circles')
	})
})

describe('run_code — looped addFeature reports accurate created count (count-fix)', () => {
	it('a script calling authoring.addFeature N times returns counts.created === N (not 0)', async () => {
		const editor = useHeadlessEditor()
		const code = `
			const N = 61
			for (let i = 0; i < N; i++) {
				authoring.addFeature(turf.point([14.5 + i * 0.01, 47.5]))
			}
			\`Added \${N} great-circle arc points\`
		`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		const out = result as { ok: boolean; counts: { created: number } }
		expect(out.ok).toBe(true)
		expect(out.counts.created).toBe(61)
		expect(editor.getAllFeatures().length).toBe(61)
	})

	it('a bare Geometry passed to addFeature is wrapped + counted (not a silent created:0)', async () => {
		const editor = useHeadlessEditor()
		// The model often passes a raw geometry instead of a Feature wrapper.
		const code = `authoring.addFeature({ type: 'Point', coordinates: [16.37, 48.21] }); 'done'`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		const out = result as { ok: boolean; counts: { created: number } }
		expect(out.ok).toBe(true)
		expect(out.counts.created).toBe(1)
		expect(editor.getAllFeatures().length).toBe(1)
	})

	it('circle still reports accurate counts (no regression on the circle path)', async () => {
		const editor = useHeadlessEditor()
		const code = `authoring.circle([14.5, 47.5], 500, { units: 'meters' }); 'c'`
		const result = await dispatch('run_code', { code })
		expect(isToolError(result)).toBe(false)
		const out = result as { ok: boolean; counts: { created: number } }
		expect(out.counts.created).toBe(1)
		expect(editor.getAllFeatures().length).toBe(1)
	})
})

describe('run_code — Austria→Bosnia cost-weighted overfly (CODE-06 [C])', () => {
	function seedOverflyFees(): string {
		const handle = putDataset({
			fileName: 'overfly-fees.csv',
			type: 'csv',
			schema: [
				{ name: 'country', type: 'string' },
				{ name: 'eurPerKm', type: 'number' },
			],
			rowCount: 3,
			columnCount: 2,
			fullRows: [
				{ country: 'AT', eurPerKm: 1.0 },
				{ country: 'SI', eurPerKm: 5.0 }, // Slovenia is expensive → favour the direct path
				{ country: 'BA', eurPerKm: 1.0 },
			],
			coordinateColumns: {},
			bytes: 96,
		})
		seededHandles.push(handle)
		return handle
	}

	it('reads handle rows, returns the chosen route + costs, and draws exactly one feature', async () => {
		const editor = useHeadlessEditor()
		const handle = seedOverflyFees()

		// The script reads `data.datasets[handle]` (the overfly fees), computes the
		// cost of a direct Vienna→Sarajevo line vs. a via-Slovenia detour using turf
		// length, picks the cheaper, draws it, and returns the chosen route + costs.
		const code = `
			const fees = data.datasets[${JSON.stringify(handle)}]
			const feeOf = (c) => {
				const row = fees.find((r) => r.country === c)
				return row ? row.eurPerKm : 0
			}
			const direct = turf.lineString([[16.37, 48.21], [17.91, 44.79]])
			const viaSLO = turf.lineString([[16.37, 48.21], [14.5, 46.05], [17.91, 44.79]])
			const km = (line) => turf.length(line, { units: 'kilometers' })
			// Direct crosses AT+BA; the detour additionally crosses SI (expensive).
			const directCost = km(direct) * (feeOf('AT') + feeOf('BA'))
			const sloCost = km(viaSLO) * (feeOf('AT') + feeOf('SI') + feeOf('BA'))
			const chosen = sloCost < directCost ? viaSLO : direct
			const chosenName = sloCost < directCost ? 'viaSLO' : 'direct'
			authoring.addFeature(chosen)
			;({ chosen: chosenName, variants: { direct: directCost, viaSLO: sloCost } })
		`
		const result = await dispatch('run_code', { code, handles: [handle] })
		expect(isToolError(result)).toBe(false)
		const out = result as {
			ok: boolean
			counts: { created: number }
			returnValue: { chosen: string; variants: { direct: number; viaSLO: number } }
		}
		expect(out.ok).toBe(true)
		expect(out.counts.created).toBe(1)
		expect(editor.getAllFeatures().length).toBe(1)
		// The script branched on the seeded fees: SI=5 makes the detour costlier,
		// so the direct path is chosen (proves the handle rows reached the sandbox).
		expect(out.returnValue.chosen).toBe('direct')
		expect(out.returnValue.variants.viaSLO).toBeGreaterThan(out.returnValue.variants.direct)
	})

	it('privacy regression: the model summary for the handle never carries fullRows', () => {
		const handle = seedOverflyFees()
		const summary = toModelSummary(handle)
		expect(summary).toBeDefined()
		expect(summary).not.toHaveProperty('fullRows')
		// The summary projection has no fullRows on its nested summary either.
		expect((summary as { summary: Record<string, unknown> }).summary).not.toHaveProperty('fullRows')
	})
})
