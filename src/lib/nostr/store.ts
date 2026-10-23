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
import { DeleteManager } from 'applesauce-core/event-store'
import type { NostrEvent } from 'nostr-tools'

/** Reactive event database. Single instance for the whole app. */
const deletes = new DeleteManager()
export const eventStore = new EventStore({ deleteManager: deletes })

/** Reuse the supported injected deletion manager; no private-store access. */
export function isEventDeleted(event: NostrEvent): boolean {
	return deletes.check(event)
}
