/**
 * Task 2 (TDD) — bounded console capture proof (D-14, Pitfall 4).
 *
 * The sink records console lines up to a byte+line budget; on overflow it stops
 * accumulating and appends a single truncation marker. This bounds the output
 * that reaches BOTH the chat UI (D-10) and the model, preventing a logging loop
 * from flooding the transcript / model context.
 */

import { describe, expect, it } from 'bun:test'
import {
	createOutputCapture,
	OUTPUT_BYTE_CAP,
	OUTPUT_LINE_CAP,
	TRUNCATION_MARKER,
} from './outputCapture'

describe('createOutputCapture (D-14)', () => {
	it('Test 2: returns recorded lines verbatim when under both caps', () => {
		const cap = createOutputCapture()
		cap.push('alpha')
		cap.push('beta')
		cap.push('gamma')
		const { lines, truncated } = cap.drain()
		expect(lines).toEqual(['alpha', 'beta', 'gamma'])
		expect(truncated).toBe(false)
	})

	it('Test 3a: stops accumulating past OUTPUT_LINE_CAP and marks truncated', () => {
		const cap = createOutputCapture()
		for (let i = 0; i < OUTPUT_LINE_CAP + 500; i++) {
			cap.push(`line ${i}`)
		}
		const { lines, truncated } = cap.drain()
		expect(truncated).toBe(true)
		// Bounded: never grows past the cap + the single marker line.
		expect(lines.length).toBeLessThanOrEqual(OUTPUT_LINE_CAP + 1)
		expect(lines[lines.length - 1]).toBe(TRUNCATION_MARKER)
	})

	it('Test 3b: stops accumulating past OUTPUT_BYTE_CAP and marks truncated', () => {
		const cap = createOutputCapture()
		const big = 'x'.repeat(64 * 1024) // 64 KiB per line
		// 5 of these (~320 KiB) blows past the 256 KiB byte cap well before the line cap.
		for (let i = 0; i < 5; i++) cap.push(big)
		const { lines, truncated } = cap.drain()
		expect(truncated).toBe(true)
		expect(lines[lines.length - 1]).toBe(TRUNCATION_MARKER)
		const totalBytes = lines.reduce((n, l) => n + Buffer.byteLength(l, 'utf8'), 0)
		// Bounded near the cap (allow one overshooting line + the marker).
		expect(totalBytes).toBeLessThanOrEqual(OUTPUT_BYTE_CAP + 64 * 1024 + 64)
	})

	it('appends the truncation marker exactly once even with continued pushes', () => {
		const cap = createOutputCapture()
		for (let i = 0; i < OUTPUT_LINE_CAP + 2000; i++) cap.push(`l${i}`)
		const { lines } = cap.drain()
		const markers = lines.filter((l) => l === TRUNCATION_MARKER)
		expect(markers.length).toBe(1)
	})

	it('exposes sane concrete cap values (D-14 planner choice)', () => {
		expect(OUTPUT_LINE_CAP).toBe(1000)
		expect(OUTPUT_BYTE_CAP).toBe(256 * 1024)
	})
})
