/**
 * Authoring API — shared, AI-free predicate engine (TOOLS-02 D-06 / TOOLS-03 select).
 *
 * `matchesPredicate(feature, predicate)` decides whether a single feature matches a
 * flat AND-list of operator clauses evaluated over `feature.properties.*` ONLY.
 * `selectByPredicate(features, predicate)` returns EVERY matching feature in input
 * order — the FULL set, never a capped/sampled subset (the TOOLS-03 *select* half).
 *
 * This is the ONE targeting vocabulary the Wave-3 consumers (batch-edit, style
 * buckets, dedup/select) all share, so it is sequenced before them. It is a minimal
 * operator set — NOT a query DSL: a flat AND of clauses, no nested and/or/not trees,
 * no dot-path nesting, no regex, no eval. A clause value is only ever COMPARED to a
 * property value; no code path executes from a clause (threat T-06-02b/T-06-02c —
 * hostile clauses can never crash a bulk run).
 *
 * "missing" semantics (A4, inclusive default): a value is missing when it is absent,
 * `null`, `''`, or a whitespace-only string. `exists` is the exact inverse. This is
 * the place that DEFINES fill-if-missing for Plan 04.
 *
 * Boundary (D-07): imports ONLY the `EditorFeature` type from `../core/types` —
 * NOTHING from chat, the tool registry, or Nostr. `boundary.test.ts` auto-scans
 * every `api/*.ts` file and enforces this.
 */

import type { EditorFeature } from '../core/types'

/**
 * A single predicate clause (discriminated union on `op`). `field` always names a
 * key read directly off `feature.properties` — no nested path resolution.
 */
export type PredicateOp =
	| { field: string; op: 'eq' | 'neq'; value: string | number | boolean }
	| { field: string; op: 'exists' | 'missing' }
	| { field: string; op: 'contains'; value: string }
	| { field: string; op: 'in'; value: (string | number | boolean)[] }
	| { field: string; op: 'lt' | 'lte' | 'gt' | 'gte'; value: number }

/**
 * A flat AND of clauses. EVERY clause in `all` must pass for the feature to match.
 * An empty `all: []` matches every feature (vacuous truth) so a style "fallback"
 * bucket can target everything.
 */
export interface Predicate {
	all: PredicateOp[]
}

/**
 * The A4 inclusive "missing" default: absent OR null OR empty OR whitespace-only
 * string all count as missing. Shared by `exists`/`missing` and the fill-if-missing
 * semantics Plan 04 consumes.
 */
function isMissing(value: unknown): boolean {
	if (value === undefined || value === null) return true
	if (typeof value === 'string' && value.trim() === '') return true
	return false
}

/** Evaluate one clause against a feature's properties. */
function matchesClause(properties: EditorFeature['properties'], clause: PredicateOp): boolean {
	const value = properties?.[clause.field]

	switch (clause.op) {
		case 'eq':
			return value === clause.value
		case 'neq':
			return value !== clause.value
		case 'exists':
			return !isMissing(value)
		case 'missing':
			return isMissing(value)
		case 'contains':
			// Case-sensitive substring on a string property; non-string → false (no throw).
			return typeof value === 'string' && value.includes(clause.value)
		case 'in':
			return clause.value.includes(value as string | number | boolean)
		case 'lt':
		case 'lte':
		case 'gt':
		case 'gte': {
			// Coerce to number; a non-finite / non-numeric property never matches (no throw).
			const num = typeof value === 'number' ? value : Number(value)
			if (!Number.isFinite(num)) return false
			if (clause.op === 'lt') return num < clause.value
			if (clause.op === 'lte') return num <= clause.value
			if (clause.op === 'gt') return num > clause.value
			return num >= clause.value
		}
		default:
			return false
	}
}

/**
 * True iff `feature` matches the predicate's flat AND-list, reading values ONLY from
 * `feature.properties`. An empty clause list matches every feature (vacuous truth).
 */
export function matchesPredicate(feature: EditorFeature, predicate: Predicate): boolean {
	return predicate.all.every((clause) => matchesClause(feature.properties, clause))
}

/**
 * Return EVERY matching feature in input order — the FULL set, never capped or
 * sampled (TOOLS-03 select half). This is the only full-set reader; consumer "rules"
 * never take a `features`/`featureIds` array — the host supplies the list.
 */
export function selectByPredicate(
	features: EditorFeature[],
	predicate: Predicate,
): EditorFeature[] {
	return features.filter((f) => matchesPredicate(f, predicate))
}
