/**
 * `seed minimal` — the fast smoke seed: kind-0 profiles for the dev roster
 * plus ONE small dataset (kind 37515) owned by devUser1. Use it when you just
 * need "something on the map" without the full fixture zoo.
 */

import { GeoDatasetFactory } from '@/lib/nostr/geo-event/factory'
import { devIdentities, signProfile } from '../identities'
import { featureNear, fc, VIENNA_CENTROID } from '../random'
import type { SeederContext } from '../types'

export async function runMinimal(ctx: SeederContext): Promise<void> {
	const { client, owner } = ctx
	const { contributors } = devIdentities()
	console.log(`\nSeeding MINIMAL fixtures → ${client.url}\n`)

	console.log('Profiles:')
	await client.publish(await signProfile(owner, 'Dev seed owner.'), `profile ${owner.name}`)
	for (const person of contributors) {
		await client.publish(
			await signProfile(person, `Contributor — ${person.name}.`),
			`profile ${person.name}`,
		)
	}
	console.log(`  ✓ ${contributors.length + 1} profiles`)

	console.log('\nDataset:')
	const dataset = await GeoDatasetFactory.create(
		fc([
			featureNear(VIENNA_CENTROID, { name: 'Stephansplatz marker', note: 'minimal seed' }),
			featureNear(VIENNA_CENTROID, { name: 'Donaukanal marker', note: 'minimal seed' }),
		]),
	)
		.withDerivedMetadata()
		.hashtags(['vienna', 'smoke-test'])
		.sign(owner.signer)
	await client.publish(dataset, 'minimal dataset')
	const dTag = dataset.tags.find((t) => t[0] === 'd')?.[1]
	console.log(`  ✓ dataset 37515:${owner.pubkey.slice(0, 12)}…:${dTag}`)

	console.log(`\nMinimal seed complete: ${client.summary()}`)
}
