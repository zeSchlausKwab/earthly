export interface TypeDiagnostic {
	file: string
	code: number
	message: string
}

export interface BaselineEntry extends TypeDiagnostic {
	count: number
}

export interface TypecheckBaseline {
	version: 1
	compilerVersion: string
	diagnostics: BaselineEntry[]
}

function normalize(diagnostic: TypeDiagnostic): TypeDiagnostic {
	return {
		file: diagnostic.file.replaceAll('\\', '/'),
		code: diagnostic.code,
		message: diagnostic.message.replace(/\s+/g, ' ').trim(),
	}
}

function key(diagnostic: TypeDiagnostic): string {
	const { file, code, message } = normalize(diagnostic)
	return JSON.stringify([file, code, message])
}

/** Locations may move during a refactor; repeated diagnostics still consume separate entries. */
export function summarizeDiagnostics(diagnostics: TypeDiagnostic[]): BaselineEntry[] {
	const entries = new Map<string, BaselineEntry>()
	for (const diagnostic of diagnostics) {
		const id = key(diagnostic)
		const existing = entries.get(id)
		if (existing) existing.count += 1
		else entries.set(id, { ...normalize(diagnostic), count: 1 })
	}
	return [...entries.values()].sort((left, right) => {
		const a = key(left)
		const b = key(right)
		return a < b ? -1 : a > b ? 1 : 0
	})
}

export function parseBaseline(value: unknown, compilerVersion: string): TypecheckBaseline {
	if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) {
		throw new Error('Invalid TypeScript baseline version')
	}
	if (!('compilerVersion' in value) || value.compilerVersion !== compilerVersion) {
		throw new Error(
			'TypeScript version differs from the baseline; review the compiler upgrade first',
		)
	}
	if (!('diagnostics' in value) || !Array.isArray(value.diagnostics)) {
		throw new Error('Invalid TypeScript baseline diagnostics')
	}
	const seen = new Set<string>()
	const diagnostics: BaselineEntry[] = value.diagnostics.map((entry: unknown) => {
		if (
			!entry ||
			typeof entry !== 'object' ||
			!('file' in entry) ||
			typeof entry.file !== 'string' ||
			!entry.file ||
			!('code' in entry) ||
			typeof entry.code !== 'number' ||
			!Number.isSafeInteger(entry.code) ||
			entry.code <= 0 ||
			!('message' in entry) ||
			typeof entry.message !== 'string' ||
			!entry.message.trim() ||
			!('count' in entry) ||
			typeof entry.count !== 'number' ||
			!Number.isSafeInteger(entry.count) ||
			entry.count <= 0
		) {
			throw new Error('Invalid TypeScript baseline entry')
		}
		const normalized = {
			...normalize({ file: entry.file, code: entry.code, message: entry.message }),
			count: entry.count,
		}
		const id = key(normalized)
		if (seen.has(id)) throw new Error('Duplicate TypeScript baseline entry')
		seen.add(id)
		return normalized
	})
	return { version: 1, compilerVersion, diagnostics }
}

export function compareDiagnostics(current: BaselineEntry[], baseline: BaselineEntry[]) {
	const previous = new Map(baseline.map((entry) => [key(entry), entry.count]))
	const actual = new Map(current.map((entry) => [key(entry), entry.count]))
	const additions = current.flatMap((entry) => {
		const count = entry.count - (previous.get(key(entry)) ?? 0)
		return count > 0 ? [{ ...entry, count }] : []
	})
	const resolved = baseline.reduce(
		(total, entry) => total + Math.max(0, entry.count - (actual.get(key(entry)) ?? 0)),
		0,
	)
	return { additions, resolved }
}
