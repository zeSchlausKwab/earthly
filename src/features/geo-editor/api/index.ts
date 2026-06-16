/**
 * Authoring API — public surface (INFRA-02 / D-10).
 *
 * The single, pure, AI-agnostic, framework-agnostic geometry-mutation seam.
 * Phases 3–7 route every editor geometry write through this barrel.
 *
 * Boundary (D-07): nothing under `api/` imports from chat, the tool registry,
 * or Nostr — `boundary.test.ts` enforces it so the facade stays shippable as a
 * standalone editor library and confinable as the Phase 4 sandbox boundary.
 */

export type { MutationIntent, MutationResult, MutationCounts } from './results'
export type { Interceptor, InterceptorContext } from './interceptor'
export { runInterceptors } from './interceptor'
