/**
 * The off-thread schema-validation engine — the one genuinely new trust boundary
 * Phase 8 introduces (SPEC-04, T-08-04).
 *
 * An Ajv JSON Schema fetched from a relay is STRANGER-AUTHORED executable input:
 * a ReDoS `pattern` (CVE-2025-69873 class) validated against a long input can peg
 * a core; a recursive/external `$ref`/`$dynamicRef` can blow the resolver; an
 * oversized/deeply-nested schema can OOM. This module hardens the validator:
 *
 *   - `rejectUnsafeSchema(schema)` runs BEFORE `ajv.compile`: it throws on an
 *     oversized serialized schema (`MAX_SCHEMA_BYTES`), on any `$ref`/`$dynamicRef`
 *     (external resolution is never attempted), and on excessive structural depth
 *     (`MAX_DEPTH`) or keyword/property count (`MAX_KEYWORDS`).
 *   - One module-scope `Ajv2020` instance configured exactly as
 *     `src/lib/context/validation.ts:26-31` (`allErrors:true, strict:false,
 *     validateSchema:true`). `$data` is OFF (the default — we never pass
 *     `$data:true`), so a `{ $data: '...' }` keyword value is an INVALID schema
 *     that fails closed rather than silently enabling cross-field validation.
 *   - A compile-once cache keyed by `schemaHash`: a cache miss runs the gate then
 *     `ajv.compile` and stores the validator; a hit reuses it. A test-observable
 *     compile counter proves compile-once-per-`schemaHash`.
 *   - Every throw (gate rejection, compile error, ReDoS overrun) is caught and
 *     turned into a structured FAIL-CLOSED verdict `{ ok:false, error }` — the
 *     engine NEVER fails open. The hard off-thread TIMEOUT-KILL is the client's
 *     job (schemaWorker.ts host watchdog); this engine bounds its own work.
 *
 * Like `sandbox.worker.ts`, the engine lives in the exported pure
 * `runSchemaValidation` so the hardening proofs stay automated under `bun test`
 * (no live `Worker`) — `schemaWorker.ts` drives this engine synchronously there.
 * This file does NOT import or touch the Group validate-on-fetch pipeline; Phase 9
 * migrates that wiring.
 */

import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type { ValidateFunction } from 'ajv'

/** Max serialized schema size. A relay schema larger than this is rejected (OOM cap). */
export const MAX_SCHEMA_BYTES = 64 * 1024
/** Max structural nesting depth. Deeper schemas are rejected before compile (OOM cap). */
export const MAX_DEPTH = 12
/** Max total keyword/property count. Schemas with more are rejected (OOM cap). */
export const MAX_KEYWORDS = 4096

/** One isolated validation request. */
export interface SchemaValidationRequest {
	/** The untrusted JSON Schema to compile + validate against. */
	schema: unknown
	/** The data instance to validate. */
	data: unknown
	/** Stable content hash of `schema` — the compile-once cache key. */
	schemaHash: string
}

/**
 * One per-rule validation error (D-06). Mirrors the Ajv `ErrorObject` shape so the UI
 * can render exactly which rule failed ("property `name` required") with a "Publish
 * anyway" path. Carried on the FAIL verdict's `errors[]`; never on a DoS/gate-reject
 * path (that stays cheap — see `MAX_ERRORS`).
 */
export interface SchemaRuleError {
	/** JSON Pointer into the data instance where the rule failed (Ajv `instancePath`). */
	instancePath: string
	/** JSON Pointer into the schema for the failed keyword (Ajv `schemaPath`). */
	schemaPath?: string
	/** The failing JSON Schema keyword (e.g. `required`, `type`, `enum`). */
	keyword: string
	/** Human-readable Ajv message (e.g. "must have required property 'name'"). */
	message: string
	/** Keyword-specific params (e.g. `{ missingProperty: 'name' }`). */
	params?: Record<string, unknown>
}

/**
 * Hard cap on the per-rule error array (T-09-03-ERR-DOS). A hostile schema/instance with
 * `allErrors:true` could otherwise emit an unbounded error list that itself OOMs the UI —
 * we surface only the first `MAX_ERRORS`.
 */
export const MAX_ERRORS = 50

/** The structured, always-serializable validation verdict. Fails CLOSED on any error. */
export interface SchemaValidationVerdict {
	/** `true` only when the schema compiled AND the data validated against it. */
	ok: boolean
	/** Present on a fail-closed verdict — a short reason for the failure. */
	error?: string
	/**
	 * Per-rule structured errors (D-06), present on a VALIDATION failure (schema compiled
	 * but data did not conform). Bounded to `MAX_ERRORS`. Absent on a pass and on the
	 * DoS/gate-reject path (that path must not allocate per-rule detail).
	 */
	errors?: SchemaRuleError[]
}

/** The fail-closed verdict every error path resolves to. */
const FAIL_CLOSED_ERROR = 'could not validate'

// ── Ajv instance (mirrors validation.ts:26-31; `$data` deliberately OFF) ──────────
const ajv = new Ajv2020({
	allErrors: true,
	strict: false,
	validateSchema: true,
})
addFormats(ajv)

// ── Compile-once cache + test-observable compile counter ──────────────────────────
const compiledCache = new Map<string, ValidateFunction>()
let compileCount = 0

/** TEST hook: number of `ajv.compile` invocations since the last reset. */
export function __compileCount(): number {
	return compileCount
}

/** TEST hook: reset the compile counter (and the cache) between assertions. */
export function __resetCompileCount(): void {
	compileCount = 0
	compiledCache.clear()
}

/**
 * Reject an untrusted schema BEFORE it ever reaches `ajv.compile`. Throws on the
 * mitigated DoS shapes (T-08-04-REF / T-08-04-OOM): oversized serialized schema,
 * any `$ref`/`$dynamicRef`, excessive depth, or excessive keyword count.
 */
function rejectUnsafeSchema(schema: unknown): void {
	const json = JSON.stringify(schema)
	if (typeof json !== 'string') {
		throw new Error('schema is not serializable')
	}
	if (json.length > MAX_SCHEMA_BYTES) {
		throw new Error(`schema exceeds ${MAX_SCHEMA_BYTES} bytes`)
	}
	// `$ref`/`$dynamicRef` are rejected outright — external resolution is never attempted.
	if (/"\$ref"|"\$dynamicRef"/.test(json)) {
		throw new Error('schema uses $ref/$dynamicRef')
	}

	// Bounded structural walk: enforce depth + total keyword/property caps.
	let keywordCount = 0
	const walk = (node: unknown, depth: number): void => {
		if (depth > MAX_DEPTH) {
			throw new Error(`schema nesting exceeds depth ${MAX_DEPTH}`)
		}
		if (Array.isArray(node)) {
			for (const item of node) walk(item, depth + 1)
			return
		}
		if (node && typeof node === 'object') {
			for (const value of Object.values(node as Record<string, unknown>)) {
				keywordCount++
				if (keywordCount > MAX_KEYWORDS) {
					throw new Error(`schema exceeds ${MAX_KEYWORDS} keywords`)
				}
				walk(value, depth + 1)
			}
		}
	}
	walk(schema, 0)
}

/**
 * Compile (once per `schemaHash`) and validate. The gate runs BEFORE `ajv.compile`;
 * a cache hit skips both the gate and the compile. The counter increments only on an
 * actual compile so `schemaWorker.test.ts` can assert compile-once-per-`schemaHash`
 * and `$ref`-rejected-before-compile (counter stays 0 when the gate throws).
 */
function compileOnce(schema: unknown, schemaHash: string): ValidateFunction {
	const cached = compiledCache.get(schemaHash)
	if (cached) return cached

	// Gate FIRST — a rejection here means `ajv.compile` is never reached (counter stays 0).
	rejectUnsafeSchema(schema)

	const validate = ajv.compile(schema as object)
	compileCount++
	compiledCache.set(schemaHash, validate)
	return validate
}

/**
 * The pure, fail-closed validation engine. Any throw (gate rejection, compile error,
 * ReDoS overrun) is caught and returned as `{ ok:false, error }` — it NEVER fails open
 * and NEVER propagates. The off-thread hard timeout-kill is the client's job.
 */
export async function runSchemaValidation(
	request: SchemaValidationRequest,
): Promise<SchemaValidationVerdict> {
	try {
		const validate = compileOnce(request.schema, request.schemaHash)
		const valid = validate(request.data)
		if (valid) return { ok: true }
		// Map Ajv's `allErrors` list into bounded, serializable per-rule errors (D-06).
		// The cap (`MAX_ERRORS`) keeps a hostile schema/instance from OOMing the error
		// channel itself (T-09-03-ERR-DOS).
		const errors: SchemaRuleError[] = (validate.errors ?? []).slice(0, MAX_ERRORS).map((e) => ({
			instancePath: e.instancePath ?? '',
			schemaPath: e.schemaPath,
			keyword: e.keyword ?? '',
			message: e.message ?? 'validation failed',
			params: e.params as Record<string, unknown> | undefined,
		}))
		return { ok: false, error: FAIL_CLOSED_ERROR, errors }
	} catch {
		// Gate rejection / ReDoS overrun / compile failure: fail closed WITHOUT per-rule
		// detail — the DoS path must stay cheap (no allocation of an error list).
		return { ok: false, error: FAIL_CLOSED_ERROR }
	}
}

// ── Worker message shell ──────────────────────────────────────────────────────────
// Only registers when running as an actual Worker (self.onmessage exists). Under
// `bun test` this module is imported for `runSchemaValidation` directly, so guarding
// avoids touching `self` where it isn't a worker global (mirrors sandbox.worker.ts).
declare const self:
	| {
			onmessage: ((event: MessageEvent<SchemaWorkerRequest>) => void) | null
			postMessage: (message: SchemaWorkerResponse) => void
	  }
	| undefined

/** The `{ id, ... }` request posted to the worker. */
export interface SchemaWorkerRequest extends SchemaValidationRequest {
	id: string
}

/** The `{ id, ... }` response posted back from the worker. */
export interface SchemaWorkerResponse extends SchemaValidationVerdict {
	id: string
}

if (typeof self !== 'undefined' && self) {
	self.onmessage = async (event: MessageEvent<SchemaWorkerRequest>) => {
		const { id, schema, data, schemaHash } = event.data
		try {
			const verdict = await runSchemaValidation({ schema, data, schemaHash })
			self.postMessage({ id, ...verdict })
		} catch {
			// Defence in depth: the engine already fails closed, but never let a throw
			// escape the handler — that would leave the host watchdog as the only settle.
			self.postMessage({ id, ok: false, error: FAIL_CLOSED_ERROR })
		}
	}
}
