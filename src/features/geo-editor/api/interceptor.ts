/**
 * Authoring API — interceptor / middleware-pipeline scaffold (D-12).
 *
 * This is the SHAPE-ONLY seam that Phase 5's safe-editing gate (SAFE-01…SAFE-06)
 * drops into without restructuring the Authoring facade:
 *   - SAFE-01 visible binding chip
 *   - SAFE-02/03 add-vs-modify-vs-delete intent awareness
 *   - SAFE-04 configurable safety level (1 preview+confirm / 2 confirm-destructive / 3 trust+undo)
 *   - SAFE-05 diff / preview
 *   - SAFE-06 undo
 *
 * NONE of that UI, persistence, diff, preview, or undo is built here. This phase
 * ships only the intent enum + a no-op middleware fold so later phases can hook
 * the pipeline. The default chain is empty, so `runInterceptors` is a pure
 * pass-through that returns the classified intent unchanged.
 *
 * Boundary (D-07): this module imports nothing from chat, the tool registry, or
 * Nostr. Keep it that way — `boundary.test.ts` enforces it.
 */

/**
 * The kind of geometry mutation an Authoring call represents. Single source of
 * truth for the intent enum; `results.ts` and `index.ts` re-export this.
 */
export type MutationIntent = 'add' | 'modify' | 'delete'

/** Context observed (and optionally intent-adjusted) by an interceptor. */
export interface InterceptorContext {
	intent: MutationIntent
	featureIds: string[]
}

/**
 * A middleware that observes a mutation before it is applied. It may return a
 * partial context to adjust the intent (Phase 5 will use this for the safety
 * gate); returning nothing leaves the context unchanged. It MUST NOT mutate
 * editor geometry — that is the facade's job.
 */
// biome-ignore lint/suspicious/noConfusingVoidType: `void` here means "may return nothing" so interceptors can be terse `() => {}` — the D-12 scaffold's intended ergonomics.
export type Interceptor = (ctx: InterceptorContext) => void | { intent?: MutationIntent }

/**
 * Fold an interceptor chain over a context. With the default empty chain this
 * is a no-op pass-through returning `ctx` unchanged. An interceptor that returns
 * `{ intent }` replaces the intent for subsequent interceptors and the result.
 */
export function runInterceptors(
	ctx: InterceptorContext,
	chain: Interceptor[] = [],
): InterceptorContext {
	let intent = ctx.intent
	for (const interceptor of chain) {
		const adjustment = interceptor({ intent, featureIds: ctx.featureIds })
		if (adjustment?.intent) {
			intent = adjustment.intent
		}
	}
	return { intent, featureIds: ctx.featureIds }
}
