import type { EntitySearchResult } from './types'

const QUESTION_START = /^(how|what|where|which|why|who|when)\b/i

/** Match the intentionally small question grammar from the rewrite contract. */
export function isQuestionQuery(query: string): boolean {
	const trimmed = query.trim()
	return Boolean(trimmed) && (trimmed.endsWith('?') || QUESTION_START.test(trimmed))
}

export type SearchEnterTarget =
	| { kind: 'ask'; query: string }
	| { kind: 'result'; result: EntitySearchResult }
	| null

/**
 * Resolve Enter against the exact visual row order: Ask first, then entities.
 * With no highlighted row, a question falls back to Ask Earthly; highlighted
 * entity results always keep their ordinary selection behavior.
 */
export function resolveSearchEnterTarget(
	query: string,
	canAsk: boolean,
	selectedIndex: number,
	results: readonly EntitySearchResult[],
): SearchEnterTarget {
	const trimmed = query.trim()
	const hasAskRow = canAsk && isQuestionQuery(trimmed)
	if (selectedIndex < 0) return hasAskRow ? { kind: 'ask', query: trimmed } : null
	if (hasAskRow && selectedIndex === 0) return { kind: 'ask', query: trimmed }

	const resultIndex = selectedIndex - (hasAskRow ? 1 : 0)
	const result = results[resultIndex]
	return result ? { kind: 'result', result } : null
}
