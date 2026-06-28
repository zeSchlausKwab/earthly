/**
 * Observation-state classifier for kind 37522 (D-06, net-new).
 *
 * A Sighting carries NIP-52 time bounds (`start`, optional `end`) distinct from
 * its publish `created_at` and its NIP-40 `expiration`. `classifyObservationState`
 * derives a single legible state from those bounds against a fixed `now` (epoch
 * seconds, UTC), driving the map paint (LayerManager), the browse-row cue chip,
 * and the view-panel time row.
 *
 *   - 'live'     = now ∈ [start, end]  (or start ≤ now and no `end`, within freshness)
 *   - 'upcoming' = start > now
 *   - 'past'     = end < now  (or an open-ended sighting whose start is past the
 *                  freshness window — it is no longer "happening now")
 *
 * Pure + deterministic + total: undefined inputs never throw. A Sighting with no
 * observation time at all classifies as 'live' (a freshly-placed "I just saw it"
 * with no explicit bounds is treated as happening now), never 'upcoming'.
 */

export type ObservationState = 'live' | 'upcoming' | 'past'

/**
 * Freshness window (seconds) for an open-ended sighting (`start` set, no `end`).
 * Past this much time after `start`, an open-ended observation is treated as
 * 'past' rather than perpetually 'live'. 30 days mirrors the conservative default
 * expiry direction (D-04) so a stale open-ended sighting still ages out of "live".
 */
const OPEN_ENDED_FRESHNESS_SECONDS = 30 * 86_400

/**
 * Classify a Sighting's observation state from its NIP-52 bounds against `now`.
 * Never throws on undefined inputs.
 */
export function classifyObservationState(
	start: number | undefined,
	end: number | undefined,
	now: number,
): ObservationState {
	// No observation time at all ⇒ treat as happening now (never 'upcoming').
	if (start === undefined) {
		if (end !== undefined && end < now) return 'past'
		return 'live'
	}

	// Future start ⇒ upcoming.
	if (start > now) return 'upcoming'

	// start ≤ now from here.
	if (end !== undefined) {
		return end < now ? 'past' : 'live'
	}

	// Open-ended (start set, no end): live within the freshness window, else past.
	return now - start <= OPEN_ENDED_FRESHNESS_SECONDS ? 'live' : 'past'
}
