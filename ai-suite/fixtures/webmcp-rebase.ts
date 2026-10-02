import { finalizeEvent, type NostrEvent } from 'nostr-tools'
import { MODEL_VERSION } from '../../src/lib/nostr/modelVersion'
import { testIdentities } from '../test-identities'

function ownerFixtureSecret() {
	return Uint8Array.from(testIdentities.owner.secretKeyHex.match(/.{2}/g) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	)
}

/** Signed public fixtures remain inside the scenario's isolated relay transport. */
export function documentRebaseFixture(kind: 'story' | 'atlas') {
	const identifier = `native-rebase-${kind}`
	const eventKind = kind === 'story' ? 37520 : 37518
	const createdAt = Math.floor(Date.now() / 1000) - 20
	const owner = testIdentities.owner
	const secret = ownerFixtureSecret()
	const originalContent =
		kind === 'story'
			? {
					modelVersion: MODEL_VERSION,
					title: 'Original Story title',
					summary: 'Original Story summary',
					image: '',
					content: 'Original Story narrative',
				}
			: {
					modelVersion: MODEL_VERSION,
					name: 'Original Atlas name',
					description: 'Original Atlas description',
					image: '',
					governance: 'open',
				}
	const remoteContent =
		kind === 'story'
			? { ...originalContent, title: 'Remote Story title', summary: 'Remote-only Story summary' }
			: { ...originalContent, name: 'Remote Atlas name', governance: 'closed' }
	const sign = (content: Record<string, unknown>, timestamp: number): NostrEvent =>
		finalizeEvent(
			{
				kind: eventKind,
				created_at: timestamp,
				tags: [['d', identifier]],
				content: JSON.stringify(content),
			},
			secret,
		)
	const original = sign(originalContent, createdAt)
	const remote = sign(remoteContent, createdAt + 10)
	return { original, remote, reference: `${eventKind}:${owner.publicKey}:${identifier}`, eventKind }
}

/** Simulate the same test owner updating a delivered Story on a second device. */
export function newerStoryFixture(
	source: NostrEvent,
	changes: Record<string, unknown>,
): NostrEvent {
	if (source.kind !== 37520 || source.pubkey !== testIdentities.owner.publicKey)
		throw new Error('Recovery fixtures require an owned signed Story.')
	return finalizeEvent(
		{
			kind: source.kind,
			created_at: source.created_at + 1,
			tags: source.tags.map((tag) => [...tag]),
			content: JSON.stringify({ ...JSON.parse(source.content), ...changes }),
		},
		ownerFixtureSecret(),
	)
}
