import { nip19 } from 'nostr-tools'
import { finalizeEvent } from 'nostr-tools/pure'
import { Relay } from 'nostr-tools/relay'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { personas, type PersonaId } from '../../personas'

const LOCAL_RELAY = 'ws://localhost:3334'
const STORY_PROPOSAL_KIND = 37519
const DATASET_KIND = 37515

export const seedStoryProposalTask: AiTaskMetadata = {
	id: 'setup.seed-story-proposal',
	summary:
		'Publish a local Story proposal fixture so owner-side moderation can be audited independently.',
	preconditions: ['Published Story URL', 'Local development relay on port 3334'],
	sideEffects: ['Publishes a disposable proposal event to the local development relay'],
	viewports: 'desktop',
}

export const seedDatasetProposalTask: AiTaskMetadata = {
	id: 'setup.seed-dataset-proposal',
	summary:
		'Publish a local Dataset proposal fixture so preview and owner decisions can be audited independently.',
	preconditions: ['Published Dataset URL', 'Local development relay on port 3334'],
	sideEffects: ['Publishes a disposable proposal event to the local development relay'],
	viewports: 'desktop',
}

function hexToBytes(value: string): Uint8Array {
	const pairs = value.match(/.{2}/g)
	if (pairs?.length !== 32) throw new Error('Persona secret key must be 32 bytes')
	return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)))
}

export async function seedStoryProposal(
	earthly: EarthlySession,
	storyUrl: string,
	proposedBody: string,
	personaId: PersonaId = 'mara',
): Promise<void> {
	if (!earthly.environment.baseURL.startsWith('http://localhost:')) {
		throw new Error('Story proposal fixtures are restricted to the localhost AI-suite target')
	}
	const encoded = new URL(storyUrl).pathname
		.split('/')
		.find((segment) => segment.startsWith('naddr1'))
	if (!encoded) throw new Error(`Story URL does not contain an naddr: ${storyUrl}`)
	const decoded = nip19.decode(encoded)
	if (decoded.type !== 'naddr') throw new Error(`Story URL naddr could not be decoded: ${storyUrl}`)
	const storyCoordinate = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`
	const event = finalizeEvent(
		{
			kind: STORY_PROPOSAL_KIND,
			created_at: Math.floor(Date.now() / 1000),
			content: proposedBody,
			tags: [
				['d', `ai-suite-${Date.now().toString(36)}`],
				['a', storyCoordinate],
				['p', decoded.data.pubkey],
			],
		},
		hexToBytes(personas[personaId].secretKeyHex),
	)
	const relay = await Relay.connect(LOCAL_RELAY)
	try {
		await relay.publish(event)
	} finally {
		relay.close()
	}
}

export async function seedDatasetProposal(
	earthly: EarthlySession,
	datasetUrl: string,
	description: string,
	personaId: PersonaId = 'mara',
): Promise<void> {
	if (!earthly.environment.baseURL.startsWith('http://localhost:')) {
		throw new Error('Dataset proposal fixtures are restricted to the localhost AI-suite target')
	}
	const encoded = new URL(datasetUrl).pathname
		.split('/')
		.find((segment) => segment.startsWith('naddr1'))
	if (!encoded) throw new Error(`Dataset URL does not contain an naddr: ${datasetUrl}`)
	const decoded = nip19.decode(encoded)
	if (decoded.type !== 'naddr' || decoded.data.kind !== DATASET_KIND) {
		throw new Error(`Dataset URL naddr could not be decoded: ${datasetUrl}`)
	}
	const targetCoordinate = `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`
	const featureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates: [16.3738, 48.2082] },
				properties: { name: 'AI suite proposed point' },
			},
		],
	}
	const event = finalizeEvent(
		{
			kind: STORY_PROPOSAL_KIND,
			created_at: Math.floor(Date.now() / 1000),
			content: JSON.stringify(featureCollection),
			tags: [
				['d', `ai-suite-dataset-${Date.now().toString(36)}`],
				['a', targetCoordinate],
				['p', decoded.data.pubkey],
				['description', description],
			],
		},
		hexToBytes(personas[personaId].secretKeyHex),
	)
	const relay = await Relay.connect(LOCAL_RELAY)
	try {
		await relay.publish(event)
	} finally {
		relay.close()
	}
}
