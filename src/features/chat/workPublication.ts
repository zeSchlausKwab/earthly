import type { ThreadWorkTarget } from './workingSet'
import type { GeoEditorWorkspace, GeoCollectionEditDraft } from '@/features/geo-editor/store'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import { datasetDraftHasChanges } from '@/features/geo-editor/draftContent'
import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'
import { savedStoryHasChanges } from '@/features/geo-editor/storyPublication'

/** Publication and AI permission are independent. A published Map keeps a local draft. */
export function workPublication(
	target: ThreadWorkTarget,
	workspace?: GeoEditorWorkspace,
	draft?: GeoCollectionEditDraft,
	geoEvents: GeoDataset[] = [],
): {
	label: 'Published' | 'Unpublished changes' | 'Unpublished' | 'Proposal draft' | 'Copy draft'
	modified?: boolean
	description: string
	href?: string
} {
	if (target.intent === 'propose')
		return {
			label: 'Proposal draft',
			description: 'Local proposed changes, not the author’s published content.',
		}
	let address: string | undefined
	if (target.kind === 'story') address = target.storyReference?.replace(/^nostr:/, '')
	else if (
		workspace?.kind === 'dataset' &&
		workspace.sourceId.startsWith('dataset:') &&
		workspace.datasetKey
	) {
		const [pubkey, ...identifier] = workspace.datasetKey.split(':')
		if (pubkey && /^[0-9a-f]{64}$/i.test(pubkey) && identifier.join(':')) {
			address = nip19.naddrEncode({
				kind: GEO_EVENT_KIND,
				pubkey,
				identifier: identifier.join(':'),
			})
		}
	}
	if (address) {
		const modified =
			target.kind === 'dataset' && workspace && draft
				? datasetDraftHasChanges(workspace, draft, geoEvents)
				: target.kind === 'story' ? savedStoryHasChanges(target) : undefined
		return {
			label: modified ? 'Unpublished changes' : 'Published',
			modified,
			description: modified
				? 'This draft differs from its last publication. Publish changes to share the update, or open the published version to compare.'
				: modified === false
					? 'This draft matches its last publication. Open the published version.'
					: 'Open the published item. Further draft edits stay local until you publish again. Changes have not been compared with the published content.',
			href: `/${target.kind === 'story' ? 'story' : 'map'}/${address}`,
		}
	}
	return {
		label: target.intent === 'fork' ? 'Copy draft' : 'Unpublished',
		description: 'Saved on this device. This draft has not been published.',
	}
}
