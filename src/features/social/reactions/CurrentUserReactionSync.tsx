import { useActiveAccount } from 'applesauce-react/hooks'
import { useTimelineWithEose } from '@/lib/nostr/hooks'

/**
 * Hydrate the signed-in user's reactions once for the whole application.
 * Dense entity lists can then answer "did I like this?" from the shared
 * EventStore without opening one relay subscription per row.
 */
export function CurrentUserReactionSync() {
	const currentUser = useActiveAccount()

	useTimelineWithEose(
		currentUser?.pubkey
			? {
					kinds: [7, 5],
					authors: [currentUser.pubkey],
				}
			: null,
	)

	return null
}
