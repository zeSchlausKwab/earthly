import { hexToBytes } from '@noble/hashes/utils.js'
import { expect } from '@playwright/test'
import { finalizeEvent } from 'nostr-tools'
import type { EarthlySession } from '../../core/session'
import type { AiTaskMetadata } from '../../core/task'
import { testIdentities } from '../../test-identities'

export interface InMemoryContextFixtureInput {
	name: string
	description: string
	identifier?: string
}

export const installInMemoryContextFixtureTask: AiTaskMetadata = {
	id: 'setup.in-memory-context-fixture',
	summary: 'Install a signed read-only Context fixture in the current page without publishing it.',
	preconditions: [
		'Local development Earthly page is open',
		'The dev EventStore handle is available',
	],
	sideEffects: [
		'Adds one signed Context event to the current page memory; writes nothing to a relay',
	],
	viewports: 'both',
}

/**
 * Supply a real, signed Context to non-publishing UI contracts. The fixture
 * enters the same reactive EventStore timeline as relay data, but deliberately
 * remains page-local so @editor-contract never writes to a relay.
 */
export async function installInMemoryContextFixture(
	earthly: EarthlySession,
	input: InMemoryContextFixtureInput,
): Promise<{ eventId: string; identifier: string }> {
	const identifier = input.identifier ?? `ai-suite-inspector-${Date.now().toString(36)}`
	const event = finalizeEvent(
		{
			kind: 37518,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['d', identifier]],
			content: JSON.stringify({
				modelVersion: 'earthly/2',
				name: input.name,
				description: input.description,
				descriptionFormat: 'markdown',
				governance: 'open',
			}),
		},
		hexToBytes(testIdentities.owner.secretKeyHex),
	)

	await expect
		.poll(() =>
			earthly.page.evaluate(() =>
				Boolean((window as unknown as { __earthlyEventStore?: unknown }).__earthlyEventStore),
			),
		)
		.toBe(true)
	await earthly.page.evaluate((fixture) => {
		const store = (
			window as unknown as {
				__earthlyEventStore?: { add(event: typeof fixture): unknown }
			}
		).__earthlyEventStore
		if (!store) throw new Error('Earthly event store debug handle is unavailable')
		store.add(fixture)
	}, event)

	return { eventId: event.id, identifier }
}
