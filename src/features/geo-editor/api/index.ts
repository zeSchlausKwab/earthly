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
export type {
	Authoring,
	CommitDatasetInput,
	CommitDatasetResult,
	DatasetMetadataInput,
	DatasetMetadataResult,
} from './authoring'
export { createAuthoring } from './authoring'
export type {
	CoordinatePrecision,
	DatasetValidationOptions,
	DatasetValidationSummary,
} from './datasetValidation'
export {
	COORDINATE_PRECISION_VALUES,
	DatasetValidationError,
	validateDataset,
} from './datasetValidation'
export type {
	MakeBufferOptions,
	MakeCircleOptions,
	PrimitiveUnits,
} from './primitives'
export {
	DEFAULT_UNITS,
	InvalidPrimitiveArgError,
	MAX_DISTANCE_METERS,
	makeBuffer,
	makeCircle,
} from './primitives'
export type { FeatureStyleOptions } from './styleOptions'
export {
	CANONICAL_STYLE_KEYS,
	InvalidStyleOptionError,
	normalizeStyleOptions,
} from './styleOptions'
