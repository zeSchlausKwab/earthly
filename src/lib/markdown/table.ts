export type MarkdownTableAlignment = 'left' | 'center' | 'right' | null

export interface ParsedMarkdownTable {
	header: string[]
	alignments: MarkdownTableAlignment[]
	rows: string[][]
	/** Index of the final source line consumed by the table. */
	endIndex: number
}

function splitTableRow(line: string): string[] | null {
	const trimmed = line.trim()
	if (!trimmed) return null

	const cells: string[] = []
	let cell = ''
	let sawSeparator = false
	let escaped = false
	let codeFenceLength = 0

	for (let index = 0; index < trimmed.length; index += 1) {
		const character = trimmed[index]
		if (escaped) {
			cell += character
			escaped = false
			continue
		}
		if (character === '\\') {
			escaped = true
			cell += character
			continue
		}
		if (character === '`') {
			let runLength = 1
			while (trimmed[index + runLength] === '`') runLength += 1
			if (codeFenceLength === 0) codeFenceLength = runLength
			else if (codeFenceLength === runLength) codeFenceLength = 0
			cell += '`'.repeat(runLength)
			index += runLength - 1
			continue
		}
		if (character === '|' && codeFenceLength === 0) {
			cells.push(cell.trim().replaceAll('\\|', '|'))
			cell = ''
			sawSeparator = true
			continue
		}
		cell += character
	}
	if (!sawSeparator) return null
	cells.push(cell.trim().replaceAll('\\|', '|'))

	if (trimmed.startsWith('|')) cells.shift()
	if (trimmed.endsWith('|')) cells.pop()
	return cells.length > 0 ? cells : null
}

function delimiterAlignment(cell: string): MarkdownTableAlignment | undefined {
	const delimiter = cell.trim()
	if (!/^:?-{3,}:?$/.test(delimiter)) return undefined
	if (delimiter.startsWith(':') && delimiter.endsWith(':')) return 'center'
	if (delimiter.endsWith(':')) return 'right'
	return 'left'
}

function normalizeRow(cells: string[], width: number): string[] {
	return Array.from({ length: width }, (_, index) => cells[index] ?? '')
}

/**
 * Parse one GFM-style pipe table beginning at `startIndex`.
 *
 * Raw HTML is never interpreted. Escaped pipes and pipes inside inline code do
 * not split cells. Body rows are normalized to the header width so malformed
 * generated Markdown cannot stretch the surrounding sidebar.
 */
export function parseMarkdownTableAt(
	lines: readonly string[],
	startIndex: number,
): ParsedMarkdownTable | null {
	const header = splitTableRow(lines[startIndex] ?? '')
	const delimiter = splitTableRow(lines[startIndex + 1] ?? '')
	if (!header || !delimiter || header.length !== delimiter.length) return null

	const alignments = delimiter.map(delimiterAlignment)
	if (alignments.some((alignment) => alignment === undefined)) return null

	const rows: string[][] = []
	let endIndex = startIndex + 1
	for (let index = startIndex + 2; index < lines.length; index += 1) {
		if (!(lines[index] ?? '').trim()) break
		const row = splitTableRow(lines[index] ?? '')
		if (!row) break
		rows.push(normalizeRow(row, header.length))
		endIndex = index
	}

	return {
		header,
		alignments: alignments as MarkdownTableAlignment[],
		rows,
		endIndex,
	}
}
