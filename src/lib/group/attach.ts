/**
 * Attach-discovery + governance lane gate + the warn-not-block publish entrypoint.
 *
 * Datasets self-attach to a Group via a `c` tag; the Group's foreign (contribution)
 * lane is discovered with `{ kinds:[37515], '#c':[groupCoord] }`. This is the rewrite of
 * `context/scope.ts`'s `allowForeignAttachments` branch — the lane gate becomes
 * `governance !== 'closed'` (GROUP-02).
 *
 * GROUP-04 HARD INVARIANT: schema validation WARNS but NEVER BLOCKS a standalone-valid
 * publish. `validateAttachment` returns advisory warnings; `canPublishStandalone` is
 * invariantly `true` — there is NO code path here that disables publish on schema failure
 * (T-09-03-BLOCK-BYPASS).
 */

import type { GroupGovernance } from '@/lib/nostr/group'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import type { SchemaValidationVerdict } from '@/lib/validation/schema.worker'
import { validateSchema, type ValidateSchemaOptions } from '@/lib/validation/schemaWorker'

/** The Nostr filter that discovers datasets `c`-attached to a Group coordinate. */
export interface AttachDiscoveryFilter {
	'#c': [string]
	kinds: [typeof GEO_EVENT_KIND]
}

/**
 * Build the attach-discovery filter for a Group coordinate:
 * `{ '#c':[coord], kinds:[37515] }`. Used to subscribe the foreign (contribution) lane.
 */
export function buildAttachDiscoveryFilter(groupCoordinate: string): AttachDiscoveryFilter {
	return { '#c': [groupCoordinate], kinds: [GEO_EVENT_KIND] }
}

/**
 * Resolve the foreign-lane filter for a Group, GATED on governance (GROUP-02): `closed`
 * suppresses the lane entirely (returns `null` — no `#c` subscription); `open`/`schema`
 * produce the discovery filter. This is the rewrite of `scope.ts`'s
 * `allowForeignAttachments` branch into `governance !== 'closed'`.
 */
export function resolveForeignLaneFilter(
	groupCoordinate: string,
	governance: GroupGovernance,
): AttachDiscoveryFilter | null {
	if (governance === 'closed') return null
	return buildAttachDiscoveryFilter(groupCoordinate)
}

/**
 * Validate a dataset's properties against a Group schema OFF-THREAD, returning the
 * worker's structured verdict (advisory warnings on failure). This NEVER throws on a
 * non-conforming dataset and NEVER carries a block flag — the publish decision is owned
 * by `canPublishStandalone`.
 */
export async function validateAttachment(
	schema: unknown,
	attachmentProperties: unknown,
	options: ValidateSchemaOptions,
): Promise<SchemaValidationVerdict> {
	return validateSchema(schema, attachmentProperties, options)
}

/**
 * GROUP-04 HARD INVARIANT: a standalone-valid dataset can ALWAYS be published, regardless
 * of the schema verdict. Validation is advisory — there is no code path that returns
 * `false` here. The argument is accepted for call-site symmetry but never gates the result.
 */
export function canPublishStandalone(_verdict: SchemaValidationVerdict): boolean {
	return true
}
