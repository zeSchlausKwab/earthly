/**
 * Shared display formatters for Temporal Sighting (kind 37522) surfaces (IN-03).
 *
 * `formatRelativeDate` and `formatExpiryCountdown` were copy-pasted between the
 * browse row (`SightingsPanel`) and the read view (`SightingViewPanel`), and
 * `formatObservationRange` lived only on the view. Two copies of the same
 * epoch-seconds arithmetic risked drifting (e.g. the `< 86_400` "Fades soon"
 * threshold) on future edits — extracted here so both surfaces import one copy.
 *
 * All three are pure + total: they never throw on undefined input, take epoch
 * SECONDS (UTC), and accept an injected `now` (epoch seconds) where a comparison
 * is needed so callers stay deterministic and never reach for `Date.now()` ms.
 */

/** A short "x ago" relative label for an epoch-seconds timestamp; '' when absent. */
export function formatRelativeDate(createdAt?: number): string {
	if (!createdAt) return ''
	const date = new Date(createdAt * 1000)
	const diffMs = Date.now() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMs / 3600000)
	const diffDays = Math.floor(diffMs / 86400000)
	if (diffMins < 1) return 'just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 7) return `${diffDays}d ago`
	return date.toLocaleDateString()
}

/**
 * The expiry countdown copy ("Fades in 6 days" / "Fades soon" if < 24h), or null
 * when the Sighting never expires (`expiresAt` undefined) or is already past
 * expiry (`remaining <= 0`).
 */
export function formatExpiryCountdown(expiresAt: number | undefined, now: number): string | null {
	if (expiresAt === undefined) return null
	const remaining = expiresAt - now
	if (remaining <= 0) return null
	if (remaining < 86_400) return 'Fades soon'
	const days = Math.round(remaining / 86_400)
	return `Fades in ${days} day${days === 1 ? '' : 's'}`
}

/** A full local timestamp ("M/D/YYYY, h:mm:ss") for an epoch-seconds value. */
function formatTimestamp(epochSeconds: number): string {
	const date = new Date(epochSeconds * 1000)
	return date.toLocaleString()
}

/**
 * The observation-time range rows for the view ("Observed …" / "Until …"). A
 * Sighting with no observation time at all yields two nulls (the form may omit
 * the row entirely). Pure + total — never throws on undefined input.
 */
export function formatObservationRange(
	start: number | undefined,
	end: number | undefined,
): { observed: string | null; until: string | null } {
	return {
		observed: start !== undefined ? formatTimestamp(start) : null,
		until: end !== undefined ? formatTimestamp(end) : null,
	}
}
