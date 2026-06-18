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
import { setSandboxTransportForTests } from './runCode'

const seededHandles: string[] = []
let prevEditor: unknown

beforeEach(() => {
	setSandboxTransportForTests(directEngineTransport)
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
