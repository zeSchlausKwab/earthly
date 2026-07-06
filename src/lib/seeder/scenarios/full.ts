/**
 * `seed full` — the RICH v1.2 "Geo Entity Model Split" seed (port of the
 * retired scripts/seed-entities.ts onto the shared seeder layer) so the app's
 * features are easy to UAT:
 *
 *   - Groups / Topics (kind 37518, earthly/2) in all three governance postures
 *       • open   ("NO-MOD")  — canonical (`a`) lane + a busy community (`c`) lane
 *       • schema             — JSON-Schema gate; conforming + several violation shapes
 *       • closed             — curated-only; foreign attaches that MUST stay hidden
 *   - Many curated (`a`) + attached/foreign (`c`) datasets (kind 37515) per Group
 *   - A roster of named contributors (each with a kind-0 profile, so "Mute @name"
 *     shows a real display name)
 *   - Stories / Articles (kind 37520) and Live Beacons (kind 37521, NIP-40 expiry)
 *   - Realism: threaded comments (kind 37517) WITH geo annotations on a few
 *     datasets, and a handful of kind-7 reactions on datasets + comments
 *
 * Temporal Sightings (kind 37522) live in the `sightings` scenario — the dev
 * script runs both. Keeping them apart avoids duplicate-titled, same-bbox
 * markers stacking on the map.
 *
 * NOT idempotent: each run mints fresh random `d`-tags. Run against a clean relay:
 *   bun relay:reset   # then restart the relay
 *   bun run seed full
 *
 * Owner defaults to devUser1 — the same key handed out for browser UAT — so a
 * tester logged in as that key owns every seeded Group and can exercise
 * owner-only actions (lock-down, curate/bless).
 */

import { ReactionFactory } from 'applesauce-common/factories'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { NostrEvent } from 'nostr-tools'
import { computeSchemaHash } from '@/lib/group/schemaHash'
import { ArticleFactory } from '@/lib/nostr/article/factory'
import { GeoCommentFactory } from '@/lib/nostr/geo-comment/factory'
import { GeoDatasetFactory } from '@/lib/nostr/geo-event/factory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event/helpers'
import { GroupFactory } from '@/lib/nostr/group/factory'
import { LiveBeaconFactory } from '@/lib/nostr/live-beacon/factory'
import {
	coordinateToNaddrReference,
	extractReferencedCoordinates,
	setAddressReferenceTags,
} from '@/lib/nostr/references'
import { devIdentities, ephemeralIdentity, type SeedIdentity, signProfile } from '../identities'
import { pointBbox } from '../geo/bbox'
import type { SeedRelayClient } from '../relay/publish'
import { featureNear, fc, jitter, nth, pick, rand, VIENNA_BBOX, VIENNA_CENTROID } from '../random'
import type { SeederContext } from '../types'

// ── Event helpers ────────────────────────────────────────────────────────────
function dTagOf(event: NostrEvent): string {
	return event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}
function coordOf(event: NostrEvent): string {
	return `${event.kind}:${event.pubkey}:${dTagOf(event)}`
}
const now = () => Math.floor(Date.now() / 1000)
const HOUR = 3600

interface SignAndPublish {
	sign: (signer: SeedIdentity['signer']) => Promise<NostrEvent>
}

/** Sign through the real factory, publish, return the signed event. */
async function publish(
	client: SeedRelayClient,
	factory: SignAndPublish,
	who: SeedIdentity,
	label?: string,
): Promise<NostrEvent> {
	const event = await factory.sign(who.signer)
	await client.publish(event, label)
	if (label && !client.dryRun) console.log(`  ✓ ${label}`)
	return event
}

async function dataset(
	client: SeedRelayClient,
	who: SeedIdentity,
	features: Feature<Geometry>[],
	opts: { hashtags?: string[]; contextRefs?: string[] },
): Promise<NostrEvent> {
	let factory = GeoDatasetFactory.create(fc(features)).withDerivedMetadata()
	if (opts.hashtags) factory = factory.hashtags(opts.hashtags)
	if (opts.contextRefs) factory = factory.contextReferences(opts.contextRefs)
	return publish(client, factory, who)
}

// ── Content vocab ─────────────────────────────────────────────────────────────
const TREE_SPECIES = ['Platanus', 'Tilia', 'Acer', 'Quercus', 'Fraxinus', 'Aesculus', 'Betula']
const STREETS = [
	'Ringstrasse',
	'Mariahilfer',
	'Praterstrasse',
	'Landstrasse',
	'Favoritenstrasse',
	'Wahringer',
	'Donaukanal',
	'Schottenring',
]
const SURFACES = ['asphalt', 'gravel', 'cobblestone', 'concrete']
const ARTKIND = ['mural', 'sculpture', 'mosaic', 'installation', 'graffiti']

// ── Realism: comment threads with geo annotations ─────────────────────────────

interface CommentThreadSpec {
	text: string
	geojson?: FeatureCollection
	replies: { text: string; geojson?: FeatureCollection }[]
}

/** An annotation FeatureCollection near the dataset — label + marker, discussion-only. */
function annotationNear(center: [number, number], label: string): FeatureCollection {
	const [lon, lat] = jitter(center, 0.01)
	return fc([
		{
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [lon, lat] },
			properties: { name: label, role: 'annotation' },
		},
		{
			type: 'Feature',
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[lon - 0.002, lat - 0.002],
						[lon + 0.002, lat - 0.002],
						[lon + 0.002, lat + 0.002],
						[lon - 0.002, lat + 0.002],
						[lon - 0.002, lat - 0.002],
					],
				],
			},
			properties: { name: `${label} (review area)`, role: 'annotation' },
		},
	])
}

function commentThreadsFor(datasetName: string): CommentThreadSpec[] {
	return [
		{
			text: `Field note on ${datasetName}: surveyed this stretch on foot — the attached marker and review area are discussion-only, not canonical geometry.`,
			geojson: annotationNear(VIENNA_CENTROID, `Field note — ${datasetName}`),
			replies: [
				{
					text: `Agreed, the condition looked the same last week. Keeping the annotation visible until someone verifies on site.`,
				},
				{
					text: `Added a second checkpoint where the surface changes.`,
					geojson: annotationNear(VIENNA_CENTROID, `Checkpoint — ${datasetName}`),
				},
			],
		},
		{
			text: `Coverage gap around ${datasetName}: the polygon marks roughly where another mapping pass would help.`,
			geojson: annotationNear(VIENNA_CENTROID, `Coverage gap — ${datasetName}`),
			replies: [
				{
					text: `This envelope is intentionally rough — treat it as conversation, not a proposed edit.`,
				},
			],
		},
	]
}

/** Publish threaded, geo-annotated comments on a dataset; returns comment events. */
async function publishCommentThreads(
	client: SeedRelayClient,
	target: NostrEvent,
	targetName: string,
	authors: SeedIdentity[],
): Promise<NostrEvent[]> {
	const rootAddress = coordOf(target)
	const published: NostrEvent[] = []
	const specs = commentThreadsFor(targetName)

	for (const [threadIndex, spec] of specs.entries()) {
		const author = nth(authors, threadIndex)
		const rootCreatedAt = now() - (specs.length - threadIndex) * 1800
		const root = await GeoCommentFactory.root(
			{ text: spec.text, geojson: spec.geojson },
			{ kind: target.kind, address: rootAddress, authorPubkey: target.pubkey },
		)
			.modifyPublicTags(setAddressReferenceTags(extractReferencedCoordinates(spec.text)))
			.withDerivedMetadata()
			.created(rootCreatedAt)
			.sign(author.signer)
		await client.publish(root, `comment on ${targetName}`)
		published.push(root)

		const rootCommentId = dTagOf(root)
		if (!rootCommentId) continue

		for (const [replyIndex, replySpec] of spec.replies.entries()) {
			const replyAuthor = nth(authors, threadIndex + replyIndex + 1)
			const reply = await GeoCommentFactory.reply(
				{ text: replySpec.text, geojson: replySpec.geojson },
				{
					rootKind: target.kind,
					rootAddress,
					rootPubkey: target.pubkey,
					parent: { id: root.id, pubkey: root.pubkey, commentId: rootCommentId },
				},
			)
				.withDerivedMetadata()
				.created(rootCreatedAt + (replyIndex + 1) * 300)
				.sign(replyAuthor.signer)
			await client.publish(reply, `reply on ${targetName}`)
			published.push(reply)
		}
	}
	return published
}

// ── The scenario ──────────────────────────────────────────────────────────────

export async function runFull(ctx: SeederContext): Promise<void> {
	const { client, owner } = ctx
	console.log(`\nSeeding RICH v1.2 entities → ${client.url}\n`)

	const contributors: SeedIdentity[] = [
		...devIdentities().contributors,
		ephemeralIdentity('Ava Sommer'),
		ephemeralIdentity('Niko Pichler'),
		ephemeralIdentity('Sofia Maier'),
		ephemeralIdentity('Felix Wagner'),
		ephemeralIdentity('Greta Lindqvist'),
		ephemeralIdentity('Bruno Falk'),
	]

	// ── Profiles (owner + every contributor) ──────────────────────────────────
	console.log('Profiles:')
	await client.publish(
		await signProfile(owner, 'Owner of the seeded Vienna groups.'),
		`profile ${owner.name}`,
	)
	for (const person of contributors) {
		await client.publish(
			await signProfile(person, `Contributor — ${person.name}.`),
			`profile ${person.name}`,
		)
	}
	console.log(`  ✓ ${contributors.length + 1} profiles`)

	// ── Curated owner datasets, grouped by theme (the `a` lane) ────────────────
	console.log('\nCurated owner datasets (`a` lane):')
	const curated = {
		cycling: [] as string[],
		trees: [] as string[],
		heritage: [] as string[],
		art: [] as string[],
	}
	const curatedEvents: NostrEvent[] = []
	for (let i = 0; i < 6; i++) {
		const ev = await dataset(
			client,
			owner,
			[
				featureNear(VIENNA_CENTROID, {
					name: `${pick(STREETS)} cycleway #${i + 1}`,
					surface: pick(SURFACES),
				}),
			],
			{ hashtags: ['cycling', 'vienna'] },
		)
		curated.cycling.push(coordOf(ev))
		curatedEvents.push(ev)
	}
	for (let i = 0; i < 5; i++) {
		const ev = await dataset(
			client,
			owner,
			[
				featureNear(VIENNA_CENTROID, {
					name: `${pick(STREETS)} tree #${i + 1}`,
					species: pick(TREE_SPECIES),
				}),
			],
			{ hashtags: ['trees', 'vienna'] },
		)
		curated.trees.push(coordOf(ev))
		curatedEvents.push(ev)
	}
	for (let i = 0; i < 6; i++) {
		const ev = await dataset(
			client,
			owner,
			[
				featureNear(VIENNA_CENTROID, {
					name: pick([
						'Stephansdom',
						'Hofburg',
						'Belvedere',
						'Karlskirche',
						'Schönbrunn gate',
						'Rathaus',
					]),
				}),
			],
			{ hashtags: ['heritage', 'vienna'] },
		)
		curated.heritage.push(coordOf(ev))
		curatedEvents.push(ev)
	}
	for (let i = 0; i < 5; i++) {
		const ev = await dataset(
			client,
			owner,
			[
				featureNear(VIENNA_CENTROID, {
					name: `${pick(ARTKIND)} on ${pick(STREETS)}`,
					kind: pick(ARTKIND),
				}),
			],
			{ hashtags: ['streetart', 'vienna'] },
		)
		curated.art.push(coordOf(ev))
		curatedEvents.push(ev)
	}
	console.log(
		`  ✓ ${curated.cycling.length + curated.trees.length + curated.heritage.length + curated.art.length} curated datasets`,
	)

	// ── Groups ──────────────────────────────────────────────────────────────────
	console.log('\nGroups:')
	const md = (heading: string, body: string) => `# ${heading}\n\n${body}`

	const cyclingGroup = await publish(
		client,
		GroupFactory.create({
			name: 'Vienna Cycling Routes',
			description: md(
				'Vienna Cycling Routes',
				'Community-mapped cycle paths. **Anyone can contribute** — additions appear in the community lane below the curated picks.',
			),
			descriptionFormat: 'markdown',
			governance: 'open',
		})
			.hashtags(['cycling', 'vienna', 'community'])
			.labels(['route', 'infrastructure'])
			.bbox(VIENNA_BBOX as GeoBoundingBox)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.cycling),
		owner,
		'OPEN (NO-MOD) · Vienna Cycling Routes',
	)
	const cyclingCoord = coordOf(cyclingGroup)

	const artGroup = await publish(
		client,
		GroupFactory.create({
			name: 'Vienna Street Art',
			description: md(
				'Vienna Street Art',
				'Murals, mosaics and installations across the city. Open contributions.',
			),
			descriptionFormat: 'markdown',
			governance: 'open',
		})
			.hashtags(['streetart', 'vienna', 'community'])
			.labels(['amenity'])
			.bbox(VIENNA_BBOX as GeoBoundingBox)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.art),
		owner,
		'OPEN (NO-MOD) · Vienna Street Art',
	)
	const artCoord = coordOf(artGroup)

	const treeSchema = {
		$schema: 'https://json-schema.org/draft/2020-12/schema',
		type: 'object',
		required: ['name', 'species'],
		properties: { name: { type: 'string' }, species: { type: 'string' } },
	}
	const treeSchemaHash = await computeSchemaHash(treeSchema)
	const treeGroup = await publish(
		client,
		GroupFactory.create({
			name: 'Vienna Street Trees',
			description: md(
				'Street Trees',
				'Contributions must declare a `name` and a `species`. Non-conforming attachments are flagged (Warn) or hidden (Strict).',
			),
			descriptionFormat: 'markdown',
			governance: 'schema',
			schema: treeSchema,
		})
			.hashtags(['trees', 'vienna', 'schema'])
			.labels(['natural'])
			.bbox(VIENNA_BBOX as GeoBoundingBox)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.trees)
			.schemaHash(treeSchemaHash),
		owner,
		'SCHEMA · Vienna Street Trees',
	)
	const treeCoord = coordOf(treeGroup)

	const heritageGroup = await publish(
		client,
		GroupFactory.create({
			name: 'Vienna Heritage (curated)',
			description: md(
				'Heritage Sites',
				'A **closed**, owner-curated collection. No community lane — only the owner’s picks appear.',
			),
			descriptionFormat: 'markdown',
			governance: 'closed',
		})
			.hashtags(['heritage', 'vienna'])
			.labels(['boundary'])
			.bbox(VIENNA_BBOX as GeoBoundingBox)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.heritage),
		owner,
		'CLOSED · Vienna Heritage (curated)',
	)
	const heritageCoord = coordOf(heritageGroup)

	// ── Foreign contributions (`c` lane) ─────────────────────────────────────────
	console.log('\nCommunity contributions (`c` lane):')

	// OPEN cycling — 12 valid contributions across many contributors (rich mute target).
	const communityDatasets: NostrEvent[] = []
	for (let i = 0; i < 12; i++) {
		const person = pick(contributors)
		communityDatasets.push(
			await dataset(
				client,
				person,
				[
					featureNear(VIENNA_CENTROID, {
						name: `${pick(STREETS)} link by ${person.name}`,
						surface: pick(SURFACES),
					}),
				],
				{ hashtags: ['cycling'], contextRefs: [cyclingCoord] },
			),
		)
	}
	// Guarantee ONE prolific contributor with multiple rows in this lane so a tester
	// can prove "Mute @name" is app-wide (removes ALL of that contributor's rows).
	const prolific = nth(contributors, 0)
	for (let i = 0; i < 3; i++) {
		await dataset(
			client,
			prolific,
			[
				featureNear(VIENNA_CENTROID, {
					name: `${pick(STREETS)} spur #${i + 1} by ${prolific.name}`,
					surface: pick(SURFACES),
				}),
			],
			{ hashtags: ['cycling'], contextRefs: [cyclingCoord] },
		)
	}
	console.log(`  ✓ 15 → OPEN cycling group (3 from ${prolific.name} — mute target)`)

	// OPEN street-art — 10 valid contributions.
	for (let i = 0; i < 10; i++) {
		const person = pick(contributors)
		communityDatasets.push(
			await dataset(
				client,
				person,
				[
					featureNear(VIENNA_CENTROID, {
						name: `${pick(ARTKIND)} by ${person.name}`,
						kind: pick(ARTKIND),
					}),
				],
				{ hashtags: ['streetart'], contextRefs: [artCoord] },
			),
		)
	}
	console.log('  ✓ 10 → OPEN street-art group')

	// SCHEMA trees — mix of conforming + 3 violation shapes (Warn/Strict fodder).
	let conform = 0
	let violate = 0
	for (let i = 0; i < 14; i++) {
		const person = pick(contributors)
		const roll = rand()
		let props: Record<string, unknown>
		if (roll < 0.5) {
			props = { name: `Tree by ${person.name}`, species: pick(TREE_SPECIES) } // conforms
			conform++
		} else if (roll < 0.7) {
			props = { name: `Unidentified tree by ${person.name}` } // missing species
			violate++
		} else if (roll < 0.85) {
			props = { species: pick(TREE_SPECIES) } // missing name
			violate++
		} else {
			props = { note: 'no name, no species' } // missing both
			violate++
		}
		await dataset(client, person, [featureNear(VIENNA_CENTROID, props)], {
			hashtags: ['trees'],
			contextRefs: [treeCoord],
		})
	}
	console.log(`  ✓ 14 → SCHEMA trees group (${conform} conform, ${violate} violate)`)

	// CLOSED heritage — 4 foreign attaches that MUST stay hidden (no foreign lane).
	for (let i = 0; i < 4; i++) {
		const person = pick(contributors)
		await dataset(
			client,
			person,
			[featureNear(VIENNA_CENTROID, { name: `Drive-by claim by ${person.name}` })],
			{ hashtags: ['heritage'], contextRefs: [heritageCoord] },
		)
	}
	console.log('  ✓ 4 → CLOSED heritage group (must stay HIDDEN)')

	// ── Live Beacons (kind 37521) ───────────────────────────────────────────────
	// A GeoJSON `geometry` Point + a `status` discriminator; lossy `bbox`/`g`
	// discovery tags derived from the point. We cover ALL FOUR marker states:
	//   - live  : status:'live', fresh created_at — accent focal dot
	//   - stale : status:'live' but created_at backdated past the 120s staleness
	//             threshold (BEACON_STALE_THRESHOLD_S) — greyed, honest age
	//   - ended : status:'ended' (the terminal Stop) — hollow grey outline
	//   - expired: NIP-40 expiration already in the past — dropped at every read path
	// PLUS one LINK-ONLY beacon (no geohash, no hashtags, no bbox → no `t:'live'`)
	// proving the discovery-gating: it MUST NOT appear in the Beacons list nor on
	// the discovery map layer (T-12-04-LINKLEAK / D-10).
	console.log('\nLive Beacons:')

	const beaconSpecs: {
		label: string
		ttl: number
		who: SeedIdentity
		status: 'live' | 'ended'
		/** Seconds to subtract from `created_at` to simulate a frozen/stale tab. */
		backdate?: number
	}[] = [
		{ label: 'Field surveyor — live', ttl: HOUR, who: nth(contributors, 4), status: 'live' },
		{ label: 'Bike courier — live', ttl: 30 * 60, who: nth(contributors, 1), status: 'live' },
		// Stale: claims status:'live' but its last heartbeat is well past the 120s
		// staleness threshold — the map greys it out honestly (P-3 / BEACON-03).
		{
			label: 'Park ranger — stale (frozen tab)',
			ttl: 2 * HOUR,
			who: nth(contributors, 6),
			status: 'live',
			backdate: 300,
		},
		// Ended: the terminal Stop event — hollow grey, still placed until expiry.
		{ label: 'Tour guide — ended', ttl: 45 * 60, who: nth(contributors, 3), status: 'ended' },
	]

	for (const spec of beaconSpecs) {
		const pos = jitter(VIENNA_CENTROID)
		const createdAt = spec.backdate ? now() - spec.backdate : undefined
		let factory = LiveBeaconFactory.create({
			label: spec.label,
			geometry: { type: 'Point', coordinates: pos },
			status: spec.status,
		})
			.hashtags(['live'])
			.geohash(pos)
			.bbox(pointBbox(pos) as GeoBoundingBox)
			.expiration(now() + spec.ttl)
		// WR-03: the factory is IMMUTABLE — `.created()` returns a NEW instance, so
		// the backdate is lost unless we reassign. Without this the "stale" fixture
		// publishes with a fresh created_at and renders LIVE instead of STALE.
		if (createdAt !== undefined) factory = factory.created(createdAt)
		await publish(client, factory, spec.who, spec.label)
	}

	// Expired beacon: NIP-40 expiration already in the past. Every read path drops
	// it via dropExpired so it must NOT render on the map nor in the list.
	{
		const pos = jitter(VIENNA_CENTROID)
		await publish(
			client,
			LiveBeaconFactory.create({
				label: 'Ghost beacon — expired',
				geometry: { type: 'Point', coordinates: pos },
				status: 'live',
			})
				.hashtags(['live'])
				.geohash(pos)
				.bbox(pointBbox(pos) as GeoBoundingBox)
				.expiration(now() - 60),
			nth(contributors, 5),
			'Ghost beacon — expired',
		)
	}

	// LINK-ONLY beacon: NO geohash, NO hashtags, NO bbox → no `t:'live'` marker, so
	// it is invisible to the `#t:['live']` discovery surface. Reachable only by its
	// direct /beacon/:naddr share link.
	{
		const pos = jitter(VIENNA_CENTROID)
		await publish(
			client,
			LiveBeaconFactory.create({
				label: 'Private rendezvous — link-only',
				geometry: { type: 'Point', coordinates: pos },
				status: 'live',
			}).expiration(now() + HOUR),
			nth(contributors, 2),
			'Private rendezvous — link-only',
		)
	}

	console.log(`  ✓ ${beaconSpecs.length + 2} beacons (live/stale/ended/expired + link-only)`)

	// ── Stories / Articles (kind 37520) ─────────────────────────────────────────
	console.log('\nStories:')
	// Encode a dataset coordinate as an inline `nostr:naddr…` body reference. The
	// Story bodies weave these in so the reading panel renders the inline ref
	// chips (eye-toggle / fly-to) AND the map stack auto-shows the geometry.
	// `a` tags are re-derived FROM the body (STORY-03, body = single source of
	// truth) instead of being set by hand.
	const ref = (coord: string | undefined): string =>
		(coord && coordinateToNaddrReference(coord)) || ''

	const storySpecs = [
		{
			title: 'A Ride Through Vienna',
			summary: 'A narrative loop along the Ringstrasse and the Donaukanal.',
			content: `# A Ride Through Vienna\n\nWe started at the **Ringstrasse** and followed the canal north. The curated cycling route is mapped here — ${ref(curated.cycling[0])} — and a second leg picks up further along: ${ref(curated.cycling[1])}.\n\nThe community keeps adding side paths; open the references above to drop them on the map.`,
			tags: ['narrative', 'cycling'],
			who: nth(contributors, 2),
		},
		{
			title: 'Field Notes: Donaukanal Wildlife',
			summary: 'Observations from a morning along the canal.',
			content: `# Field Notes\n\nA quiet morning produced a memorable **kingfisher** sighting near the Salztorbrücke. The street-tree census nearby is mapped here: ${ref(curated.trees[0])}.`,
			tags: ['narrative', 'wildlife'],
			who: nth(contributors, 2),
		},
		{
			title: 'Walls That Talk',
			summary: 'A walking tour of Vienna’s best murals.',
			content: `# Walls That Talk\n\nFrom the Gürtel to the canal, the city’s **street art** scene keeps shifting. Start with the curated picks — ${ref(curated.art[0])} and ${ref(curated.art[1])} — then wander.`,
			tags: ['narrative', 'streetart'],
			who: nth(contributors, 0),
		},
		{
			title: 'Under the Plane Trees',
			summary: 'Why Vienna’s street trees matter.',
			content: `# Under the Plane Trees\n\nThe **Street Trees** census tracks species block by block — a slow inventory of the urban canopy. Two of the mapped blocks: ${ref(curated.trees[1])} and ${ref(curated.heritage[0])}.`,
			tags: ['narrative', 'trees'],
			who: nth(contributors, 3),
		},
	]
	for (const spec of storySpecs) {
		const refs = extractReferencedCoordinates(spec.content)
		await publish(
			client,
			ArticleFactory.create({ title: spec.title, summary: spec.summary, content: spec.content })
				.hashtags(spec.tags)
				.bbox(VIENNA_BBOX as GeoBoundingBox)
				.geohash(jitter(VIENNA_CENTROID))
				.referencedAddresses(refs),
			spec.who,
			spec.title,
		)
	}
	console.log(`  ✓ ${storySpecs.length} stories (with inline geo-refs → map-stack)`)

	// ── Realism: comment threads with geo annotations (kind 37517) ─────────────
	console.log('\nComment threads (geo-annotated):')
	const commentTargets = [
		{ event: curatedEvents.at(0), name: 'the Ringstrasse cycleway' },
		{ event: curatedEvents.at(6), name: 'the street-tree census' },
		{ event: curatedEvents.at(11), name: 'the heritage site' },
	].filter((t): t is { event: NostrEvent; name: string } => t.event !== undefined)
	const allComments: NostrEvent[] = []
	for (const target of commentTargets) {
		const comments = await publishCommentThreads(client, target.event, target.name, contributors)
		allComments.push(...comments)
		console.log(`  ✓ ${comments.length} comments on ${target.name}`)
	}

	// ── Realism: a handful of kind-7 reactions on datasets + comments ──────────
	console.log('\nReactions:')
	const reactionEmojis = ['❤️', '+', '🔥', '👀', '🌳']
	let reactions = 0
	const reactionTargets: NostrEvent[] = [
		...curatedEvents.slice(0, 4),
		...communityDatasets.slice(0, 3),
		...allComments.slice(0, 3),
	]
	for (const target of reactionTargets) {
		const person = pick(contributors)
		const reaction = await ReactionFactory.create(target, pick(reactionEmojis)).sign(person.signer)
		await client.publish(reaction, `reaction on kind ${target.kind}`)
		reactions++
	}
	// The owner hearts the busiest group, too.
	const groupHeart = await ReactionFactory.create(cyclingGroup, '❤️').sign(
		nth(contributors, 1).signer,
	)
	await client.publish(groupHeart, `reaction on kind ${cyclingGroup.kind}`)
	reactions++
	console.log(`  ✓ ${reactions} reactions (datasets, comments, one group)`)

	// ── Summary ────────────────────────────────────────────────────────────────
	console.log('\n─────────────────────────────────────────────')
	console.log(`Seed complete. Owner: ${owner.name} (${owner.pubkey.slice(0, 16)}…)`)
	console.log('Groups:')
	console.log(`  OPEN cycling    ${cyclingCoord}`)
	console.log(`  OPEN streetart  ${artCoord}`)
	console.log(`  SCHEMA trees    ${treeCoord}`)
	console.log(`  CLOSED heritage ${heritageCoord}`)
	console.log('─────────────────────────────────────────────')
}
