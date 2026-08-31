import { describe, expect, test } from 'bun:test'
import { parseMarkdownTableAt } from './table'

describe('parseMarkdownTableAt', () => {
	test('parses GFM cells, alignment, and body rows', () => {
		const table = parseMarkdownTableAt(
			[
				'| Time | Event | Place |',
				'| :--- | :---: | ---: |',
				'| 08:37 | **Collapse** | Syabrubesi |',
				'| 08:44 | CCTV | Gyirong |',
			],
			0,
		)

		expect(table).toEqual({
			header: ['Time', 'Event', 'Place'],
			alignments: ['left', 'center', 'right'],
			rows: [
				['08:37', '**Collapse**', 'Syabrubesi'],
				['08:44', 'CCTV', 'Gyirong'],
			],
			endIndex: 3,
		})
	})

	test('keeps escaped and inline-code pipes inside one cell', () => {
		const table = parseMarkdownTableAt(
			['Name | Value', '--- | ---', 'A \\| B | `x|y`', 'path\\ | trailing slash'],
			0,
		)

		expect(table?.rows).toEqual([
			['A | B', '`x|y`'],
			['path\\', 'trailing slash'],
		])
	})

	test('normalizes body width and stops before ordinary prose', () => {
		const table = parseMarkdownTableAt(
			['A | B', '--- | ---', 'one | two | ignored', 'three |', 'After the table'],
			0,
		)

		expect(table?.rows).toEqual([
			['one', 'two'],
			['three', ''],
		])
		expect(table?.endIndex).toBe(3)
	})

	test('requires a matching delimiter row', () => {
		expect(parseMarkdownTableAt(['A | B', 'not | a delimiter'], 0)).toBeNull()
		expect(parseMarkdownTableAt(['A | B', '--- | --- | ---'], 0)).toBeNull()
	})
})
