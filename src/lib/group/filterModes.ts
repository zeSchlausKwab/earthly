/**
 * The off/warn/strict foreign-lane filter for schema Groups (GROUP-05). The rewrite of
 * the deprecated in-thread context-validation mode resolvers — gating runs EXCLUSIVELY
 * through the Phase-8 off-thread `validateSchema` worker (T-09-03-DOS-SCHEMA). The
 * in-thread `ajv.compile` path is NEVER imported here for gating: a ReDoS/recursive/
 * oversized relay schema cannot freeze the UI thread.
 *
 * Mode semantics:
 *   - `strict`: a non-conforming attachment is HIDDEN, carrying a legible reason.
 *   - `warn`:   a non-conforming attachment is SHOWN, carrying a reason (badge).
 *   - `off`:    everything is shown.
 *
 * Schema-hash divergence (Pitfall 3): when a schema-hash is supplied, the viewer FIRST
 * `verifySchemaHash`. A mismatch returns shown-with-warn-reason ("schema could not be
 * verified") — never a silent strict-hide against a possibly-different schema.
 */

import type { GroupGovernance } from '@/lib/nostr/group'
import type { SchemaRuleError } from '@/lib/validation/schema.worker'
import { validateSchema } from '@/lib/validation/schemaWorker'
import { verifySchemaHash } from './schemaHash'

/** The three foreign-lane filter modes (GROUP-05). */
export type GroupFilterMode = 'off' | 'warn' | 'strict'

/** The verdict a foreign-lane filter returns for one attachment. */
export interface ForeignFilterVerdict {
	/** Whether the attachment is shown in the lane. */
	show: boolean
	/** A legible reason for a hide (strict) or a flag (warn) — absent when cleanly shown. */
	reason?: string
}

/** Options for one `filterForeignAttachment` call. */
export interface FilterForeignOptions {
	/**
	 * The compile-once cache key handed to the off-thread worker. NOT itself verified
	 * against the schema (it is an opaque key) — use `publishedHash` for verify-before-validate.
	 */
	schemaHash?: string
	/**
	 * The Group's PUBLISHED `schema-hash` tag, when present. Verified against the inline
	 * schema BEFORE validating (Pitfall 3): a mismatch surfaces shown-with-warn ("schema
	 * could not be verified"), never a silent strict-hide against a possibly-different schema.
	 */
	publishedHash?: string
}

/**
 * The default filter mode for a governance ladder rung (GROUP-05):
 *   - `schema` → `strict` (untrusted attachments are gated by default).
 *   - `open`   → `off` (the foreign lane is unfiltered).
 *   - `closed` → `null` (there is NO foreign lane to filter).
 */
export function resolveGroupFilterDefault(governance: GroupGovernance): GroupFilterMode | null {
	switch (governance) {
		case 'schema':
			return 'strict'
		case 'open':
			return 'off'
		case 'closed':
			return null
	}
}

/**
 * Turn the worker's per-rule `errors[]` into a single legible sentence the UI can show
 * (e.g. "missing required `name`", "value at `/geometry/type` failed `enum`"). Bounded
 * by the worker's own `MAX_ERRORS` cap.
 */
function describeErrors(errors: SchemaRuleError[]): string {
	if (errors.length === 0) return 'does not conform to the Group schema'
	const parts = errors.slice(0, 3).map((e) => {
		if (e.keyword === 'required') {
			const missing = (e.params as { missingProperty?: string } | undefined)?.missingProperty
			return missing ? `missing required \`${missing}\`` : 'missing a required property'
		}
		const where = e.instancePath ? `\`${e.instancePath}\` ` : ''
		return `${where}${e.message}`.trim()
	})
	return parts.join('; ')
}

/**
 * Resolve whether a foreign attachment is shown under `mode`, validating its properties
 * against the Group's schema OFF-THREAD. A worker failure fails OPEN for the view's
 * legibility ONLY (the DoS protection is the worker's timeout-kill, not a hide) — the
 * attachment is shown with a "couldn't check" reason rather than silently hidden.
 *
 * @param mode      off/warn/strict.
 * @param schema    the Group's untrusted JSON Schema.
 * @param attachmentProperties the attachment's GeoJSON Feature `properties` to validate.
 * @param options   `{ schemaHash }` — verified before validating (Pitfall 3).
 */
export async function filterForeignAttachment(
	mode: GroupFilterMode,
	schema: unknown,
	attachmentProperties: unknown,
	options: FilterForeignOptions = {},
): Promise<ForeignFilterVerdict> {
	// `off` shows everything — no validation, no reason.
	if (mode === 'off') return { show: true }

	// Pitfall 3: when a PUBLISHED hash is supplied, verify it against the inline schema
	// BEFORE validating. A mismatch never strict-hides silently — it surfaces shown-with-warn
	// so the viewer knows the schema is unverifiable.
	if (options.publishedHash) {
		const verified = await verifySchemaHash(schema, options.publishedHash)
		if (!verified) {
			return { show: true, reason: 'Schema could not be verified' }
		}
	}

	let verdict: Awaited<ReturnType<typeof validateSchema>>
	try {
		verdict = await validateSchema(schema, attachmentProperties, {
			schemaHash: options.schemaHash ?? 'sha256:unhashed',
		})
	} catch {
		// Fail OPEN for legibility only — the worker's timeout-kill is the real DoS guard.
		return { show: true, reason: 'Attachment could not be checked against the schema' }
	}

	if (verdict.ok) return { show: true }

	const reason = describeErrors(verdict.errors ?? [])
	// strict hides; warn shows-with-reason.
	return mode === 'strict' ? { show: false, reason } : { show: true, reason }
}
