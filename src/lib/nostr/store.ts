/**
 * The single applesauce EventStore singleton.
 *
 * Extracted from the `@/lib/nostr` barrel so service modules (e.g. the entity
 * lifecycles) can import the store DIRECTLY without pulling — or being defeated
 * by a test mock of — the whole barrel. The barrel (`index.ts`) re-exports this
 * same instance, so `import { eventStore } from '@/lib/nostr'` is unchanged for
 * every existing consumer; only the construction site moved here.
 *
 * One instance owns the reactive event database for the whole app. No other file
 * constructs an EventStore.
 */

import { EventStore } from 'applesauce-core'
import type { NostrEvent } from 'nostr-tools'

/** Reactive event database. Single instance for the whole app. */
export const eventStore = new EventStore()

/**
 * Public, typed read seam for Applesauce's internal DeleteManager.
 *
 * The runtime EventStore intentionally exposes the manager, while its declaration marks the
 * property private. Keeping that version-specific cast here prevents consumers from reaching
 * into the manager directly and gives us one place to adapt if Applesauce adds a public API.
 */
export function isEventDeleted(event: NostrEvent): boolean {
	const store = eventStore as unknown as {
		deletes: { check(candidate: NostrEvent): boolean }
	}
	return store.deletes.check(event)
}
