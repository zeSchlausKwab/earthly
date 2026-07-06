/**
 * Bounded console capture for the sandbox boundary (D-14, Pitfall 4).
 *
 * `console.log`/`warn`/`error` inside the boundary route into a sink built here.
 * Without a cap, a logging loop produces megabytes that bloat the chat
 * transcript, the model's context window, and rendering (RESEARCH Pitfall 4 —
 * "output flooding", STRIDE Denial of Service T-04-04). The sink enforces BOTH a
 * line-count budget and a byte budget; on overflow it stops accumulating and
 * appends a single truncation marker. The capped output is exactly what both the
 * UI (D-10) and the model see.
 *
 * Concrete cap VALUES are planner discretion (D-14). Chosen:
 *  - `OUTPUT_LINE_CAP = 1000` lines
 *  - `OUTPUT_BYTE_CAP = 256 KiB`
 * A few seconds of pathological logging cannot exceed either.
 *
 * PURE module: no DOM, no Worker, no editor import — bundles into the boundary.
 */

/** Max captured lines before truncation (D-14). */
export const OUTPUT_LINE_CAP = 1000
/** Max captured bytes (UTF-8) before truncation (D-14). */
export const OUTPUT_BYTE_CAP = 256 * 1024
/** Appended once when either cap is hit (RESEARCH Pitfall 4). */
export const TRUNCATION_MARKER = '…(output truncated)'

/** Result of draining a capture sink. */
export interface OutputCaptureResult {
	/** Recorded lines, ending with {@link TRUNCATION_MARKER} iff `truncated`. */
	lines: string[]
	/** True once a cap was hit and accumulation stopped. */
	truncated: boolean
}

/** A bounded console sink: `push` lines, `drain` the bounded result. */
export interface OutputCapture {
	push(line: string): void
	drain(): OutputCaptureResult
}

/**
 * Create a fresh bounded capture sink. Once either the line cap or the byte cap
 * is reached, subsequent `push` calls are dropped and a single truncation marker
 * is emitted on drain — the marker is never duplicated.
 */
export function createOutputCapture(): OutputCapture {
	const lines: string[] = []
	let bytes = 0
	let truncated = false

	return {
		push(line: string): void {
			if (truncated) return // already at a cap — drop silently (marker added on drain).
			const lineBytes = Buffer.byteLength(line, 'utf8')
			// Accept this line, THEN check whether we've now crossed a cap. This lets the
			// boundary keep the line that tips us over (bounded overshoot of one line)
			// rather than silently dropping the line that hits the limit.
			lines.push(line)
			bytes += lineBytes
			if (lines.length >= OUTPUT_LINE_CAP || bytes >= OUTPUT_BYTE_CAP) {
				truncated = true
			}
		},
		drain(): OutputCaptureResult {
			if (truncated) {
				return { lines: [...lines, TRUNCATION_MARKER], truncated: true }
			}
			return { lines: [...lines], truncated: false }
		},
	}
}
