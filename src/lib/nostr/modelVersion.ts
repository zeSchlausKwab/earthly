/**
 * In-content model-version discriminator (SPEC-03).
 *
 * The Phase 8 entity model carries a `modelVersion` string inside the JSON
 * content of every new-model event. `hasCurrentModelVersion` is the render-set
 * gate: only events whose content declares the current `MODEL_VERSION` enter the
 * render set. Legacy events (no `modelVersion`) and foreign/malformed events
 * (unparseable content) fall out WITHOUT throwing — the defensive `JSON.parse`
 * discipline from `map-context/helpers.ts:75-85` is preserved so a single bad
 * event never crashes a list `filter`/`map` (T-08-03).
 */

import type { NostrEvent } from 'applesauce-core/helpers/event'

/**
 * Current Earthly entity-model version. The clean-break literal (A1): any event
 * not declaring this exact value is treated as legacy/foreign and skipped.
 */
export const MODEL_VERSION = 'earthly/2'

/**
 * True only when `event.content` parses to JSON whose `modelVersion` equals the
 * current `MODEL_VERSION`. Never throws — parse failure or absence ⇒ false.
 */
export function hasCurrentModelVersion(event: NostrEvent): boolean {
	try {
		const parsed = JSON.parse(event.content) as { modelVersion?: unknown }
		return parsed?.modelVersion === MODEL_VERSION
	} catch {
		return false
	}
}
