import type { ThreadWorkTarget } from './workingSet'
import type { GeoEditorWorkspace } from '@/features/geo-editor/store'
import { nip19 } from 'nostr-tools'
import { GEO_EVENT_KIND } from '@/lib/nostr/kinds'

/** Publication and AI permission are independent. A published Map keeps a local draft. */
export function workPublication(
	target: ThreadWorkTarget,
	workspace?: GeoEditorWorkspace,
): {
	label: 'Published' | 'Unpublished' | 'Proposal draft' | 'Copy draft'
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
	if (address)
		return {
			label: 'Published',
			description:
				'Open the published item. Further draft edits stay local until you publish again.',
			href: `/${target.kind === 'story' ? 'story' : 'map'}/${address}`,
		}
	return {
		label: target.intent === 'fork' ? 'Copy draft' : 'Unpublished',
		description: 'Saved on this device. This draft has not been published.',
	}
}
