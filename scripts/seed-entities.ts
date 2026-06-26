/**
 * Seed the local relay (ws://localhost:3334) with a RICH set of v1.2
 * "Geo Entity Model Split" entities so the new features are easy to UAT:
 *
 *   - Groups / Topics (kind 37518, earthly/2) in all three governance postures
 *       • open   ("NO-MOD")  — canonical (`a`) lane + a busy community (`c`) lane
 *       • schema             — JSON-Schema gate; conforming + several violation shapes
 *       • closed             — curated-only; foreign attaches that MUST stay hidden
 *   - Many curated (`a`) + attached/foreign (`c`) datasets (kind 37515) per Group
 *   - A roster of named contributors (each with a kind-0 profile, so "Mute @name"
 *     shows a real display name)
 *   - Stories / Articles (kind 37520), Live Beacons (kind 37521, NIP-40 expiry),
 *     Temporal Sightings (kind 37522, time bounds + NIP-40 expiry, some `c`-attached)
 *
 * Built + signed through the REAL entity factories (authoritative
 * `modelVersion: "earthly/2"` + correct tag shapes), published straight to the
 * local relay through the seed-relay pool.
 *
 * NOT idempotent: each run mints fresh random `d`-tags. Run against a clean relay:
 *   bun relay:reset   # then restart the relay
 *   bun run seed:entities
 *
 * Owner = devUser1 (npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah),
 * the same key handed out for browser UAT — so a tester logged in as that key owns
 * every seeded Group and can exercise owner-only actions (lock-down, curate/bless).
 */

import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import NDK, { NDKPrivateKeySigner } from '@/lib/seed-relay'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { GroupFactory } from '@/lib/nostr/group/factory'
import { ArticleFactory } from '@/lib/nostr/article/factory'
import { LiveBeaconFactory } from '@/lib/nostr/live-beacon/factory'
import { TemporalSightingFactory } from '@/lib/nostr/temporal-sighting/factory'
import { GeoDatasetFactory } from '@/lib/nostr/geo-event/factory'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event/helpers'
import { computeSchemaHash } from '@/lib/group/schemaHash'

const RELAY_URL = 'ws://localhost:3334'
const ndk = new NDK({ explicitRelayUrls: [RELAY_URL] })

// ── Randomness (plain bun script — crypto is fine) ────────────────────────────
function rand(): number {
	const buf = new Uint32Array(1)
	crypto.getRandomValues(buf)
	return buf[0] / 0x100000000
}
function pick<T>(arr: readonly T[]): T {
	return arr[Math.floor(rand() * arr.length)]
}

// ── Geo helpers (Vienna) ──────────────────────────────────────────────────────
const VIENNA_BBOX: GeoBoundingBox = [16.2, 48.1, 16.5, 48.3]
const VIENNA_CENTROID: [number, number] = [16.3738, 48.2082]

function jitter(center: [number, number], spread = 0.05): [number, number] {
	return [center[0] + (rand() - 0.5) * 2 * spread, center[1] + (rand() - 0.5) * 2 * spread]
}

/** A random-shape feature (point / 3-pt line / small quad) near `center`. */
function featureNear(center: [number, number], properties: Record<string, unknown>): Feature<Geometry> {
	const [lon, lat] = jitter(center)
	const shape = rand()
	let geometry: Geometry
	if (shape < 0.6) {
		geometry = { type: 'Point', coordinates: [lon, lat] }
	} else if (shape < 0.85) {
		geometry = {
			type: 'LineString',
			coordinates: [
				[lon, lat],
				[lon + 0.004, lat + 0.002],
				[lon + 0.008, lat - 0.001],
			],
		}
	} else {
		const d = 0.003
		geometry = {
			type: 'Polygon',
			coordinates: [
				[
					[lon, lat],
					[lon + d, lat],
					[lon + d, lat + d],
					[lon, lat + d],
					[lon, lat],
				],
			],
		}
	}
	return { type: 'Feature', geometry, properties }
}

function fc(features: Feature<Geometry>[]): FeatureCollection {
	return { type: 'FeatureCollection', features }
}

// ── Event helpers ────────────────────────────────────────────────────────────
function dTagOf(event: NostrEvent): string {
	return event.tags.find((t) => t[0] === 'd')?.[1] ?? ''
}
function coordOf(event: NostrEvent): string {
	return `${event.kind}:${event.pubkey}:${dTagOf(event)}`
}
const now = () => Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86400

/** Fail fast (≤4s) with an actionable message if the relay isn't reachable —
 *  otherwise `pool.publish` would hang forever on a down relay. */
function assertRelayReachable(): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const ws = new WebSocket(RELAY_URL)
		const timer = setTimeout(() => {
			try {
				ws.close()
			} catch {}
			reject(new Error(`relay not reachable at ${RELAY_URL} within 4s. Start it with: bun relay`))
		}, 4000)
		ws.onopen = () => {
			clearTimeout(timer)
			try {
				ws.close()
			} catch {}
			resolve()
		}
		ws.onerror = () => {
			clearTimeout(timer)
			reject(new Error(`relay not reachable at ${RELAY_URL}. Start it with: bun relay`))
		}
	})
}

async function publishRaw(event: NostrEvent): Promise<void> {
	// Race the publish against a timeout so a relay that goes away mid-run aborts
	// the seed loudly instead of hanging on an unresolved promise.
	await Promise.race([
		ndk.applesaucePool.publish([RELAY_URL], event),
		new Promise<never>((_resolve, reject) =>
			setTimeout(
				() => reject(new Error(`publish timed out — is the relay running? \`bun relay\``)),
				8000,
			),
		),
	])
}

/** Sign through the real factory, publish, return the signed event. */
async function publish(
	factory: { sign: (signer: NDKPrivateKeySigner) => Promise<NostrEvent> },
	signer: NDKPrivateKeySigner,
	label?: string,
): Promise<NostrEvent> {
	const event = await factory.sign(signer)
	await publishRaw(event)
	if (label) console.log(`  ✓ ${label}`)
	return event
}

async function dataset(
	signer: NDKPrivateKeySigner,
	features: Feature<Geometry>[],
	opts: { hashtags?: string[]; contextRefs?: string[] },
): Promise<NostrEvent> {
	let factory = GeoDatasetFactory.create(fc(features)).withDerivedMetadata()
	if (opts.hashtags) factory = factory.hashtags(opts.hashtags)
	if (opts.contextRefs) factory = factory.contextReferences(opts.contextRefs)
	return publish(factory, signer)
}

// ── Contributor roster (named, with profiles → "Mute @name" shows a real name) ─
interface Person {
	signer: NDKPrivateKeySigner
	name: string
}

function ephemeral(name: string): Person {
	const sk = new Uint8Array(32)
	crypto.getRandomValues(sk)
	return { signer: new NDKPrivateKeySigner(sk), name }
}

const owner = new NDKPrivateKeySigner(devUser1.sk)

const contributors: Person[] = [
	{ signer: new NDKPrivateKeySigner(devUser2.sk), name: 'Mara Holzer' },
	{ signer: new NDKPrivateKeySigner(devUser3.sk), name: 'Tomas Veit' },
	{ signer: new NDKPrivateKeySigner(devUser4.sk), name: 'Lena Brandt' },
	{ signer: new NDKPrivateKeySigner(devUser5.sk), name: 'Jonas Reiter' },
	ephemeral('Ava Sommer'),
	ephemeral('Niko Pichler'),
	ephemeral('Sofia Maier'),
	ephemeral('Felix Wagner'),
	ephemeral('Greta Lindqvist'),
	ephemeral('Bruno Falk'),
]

async function publishProfile(signer: NDKPrivateKeySigner, name: string, about: string): Promise<void> {
	const draft: EventTemplate = {
		kind: 0,
		content: JSON.stringify({ name, display_name: name, about }),
		tags: [],
		created_at: now(),
	}
	await publishRaw(signer.signEvent(draft))
}

// ── Content vocab ─────────────────────────────────────────────────────────────
const TREE_SPECIES = ['Platanus', 'Tilia', 'Acer', 'Quercus', 'Fraxinus', 'Aesculus', 'Betula']
const STREETS = ['Ringstrasse', 'Mariahilfer', 'Praterstrasse', 'Landstrasse', 'Favoritenstrasse', 'Wahringer', 'Donaukanal', 'Schottenring']
const SURFACES = ['asphalt', 'gravel', 'cobblestone', 'concrete']
const ARTKIND = ['mural', 'sculpture', 'mosaic', 'installation', 'graffiti']

async function seed(): Promise<void> {
	console.log(`\nSeeding RICH v1.2 entities → ${RELAY_URL}\n`)
	await assertRelayReachable()

	// ── Profiles (owner + every contributor) ──────────────────────────────────
	console.log('Profiles:')
	await publishProfile(owner, 'Earthly Curator', 'Owner of the seeded Vienna groups.')
	for (const p of contributors) await publishProfile(p.signer, p.name, `Contributor — ${p.name}.`)
	console.log(`  ✓ ${contributors.length + 1} profiles`)

	// ── Curated owner datasets, grouped by theme (the `a` lane) ────────────────
	console.log('\nCurated owner datasets (`a` lane):')
	const curated = {
		cycling: [] as string[],
		trees: [] as string[],
		heritage: [] as string[],
		art: [] as string[],
	}
	for (let i = 0; i < 6; i++) {
		const ev = await dataset(
			owner,
			[featureNear(VIENNA_CENTROID, { name: `${pick(STREETS)} cycleway #${i + 1}`, surface: pick(SURFACES) })],
			{ hashtags: ['cycling', 'vienna'] },
		)
		curated.cycling.push(coordOf(ev))
	}
	for (let i = 0; i < 5; i++) {
		const ev = await dataset(
			owner,
			[featureNear(VIENNA_CENTROID, { name: `${pick(STREETS)} tree #${i + 1}`, species: pick(TREE_SPECIES) })],
			{ hashtags: ['trees', 'vienna'] },
		)
		curated.trees.push(coordOf(ev))
	}
	for (let i = 0; i < 6; i++) {
		const ev = await dataset(
			owner,
			[featureNear(VIENNA_CENTROID, { name: pick(['Stephansdom', 'Hofburg', 'Belvedere', 'Karlskirche', 'Schönbrunn gate', 'Rathaus']) })],
			{ hashtags: ['heritage', 'vienna'] },
		)
		curated.heritage.push(coordOf(ev))
	}
	for (let i = 0; i < 5; i++) {
		const ev = await dataset(
			owner,
			[featureNear(VIENNA_CENTROID, { name: `${pick(ARTKIND)} on ${pick(STREETS)}`, kind: pick(ARTKIND) })],
			{ hashtags: ['streetart', 'vienna'] },
		)
		curated.art.push(coordOf(ev))
	}
	console.log(`  ✓ ${curated.cycling.length + curated.trees.length + curated.heritage.length + curated.art.length} curated datasets`)

	// ── Groups ──────────────────────────────────────────────────────────────────
	console.log('\nGroups:')
	const md = (h: string, body: string) => `# ${h}\n\n${body}`

	const cyclingGroup = await publish(
		GroupFactory.create({
			name: 'Vienna Cycling Routes',
			description: md('Vienna Cycling Routes', 'Community-mapped cycle paths. **Anyone can contribute** — additions appear in the community lane below the curated picks.'),
			descriptionFormat: 'markdown',
			governance: 'open',
		})
			.hashtags(['cycling', 'vienna', 'community'])
			.labels(['route', 'infrastructure'])
			.bbox(VIENNA_BBOX)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.cycling),
		owner,
		'OPEN (NO-MOD) · Vienna Cycling Routes',
	)
	const cyclingCoord = coordOf(cyclingGroup)

	const artGroup = await publish(
		GroupFactory.create({
			name: 'Vienna Street Art',
			description: md('Vienna Street Art', 'Murals, mosaics and installations across the city. Open contributions.'),
			descriptionFormat: 'markdown',
			governance: 'open',
		})
			.hashtags(['streetart', 'vienna', 'community'])
			.labels(['amenity'])
			.bbox(VIENNA_BBOX)
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
		GroupFactory.create({
			name: 'Vienna Street Trees',
			description: md('Street Trees', 'Contributions must declare a `name` and a `species`. Non-conforming attachments are flagged (Warn) or hidden (Strict).'),
			descriptionFormat: 'markdown',
			governance: 'schema',
			schema: treeSchema,
		})
			.hashtags(['trees', 'vienna', 'schema'])
			.labels(['natural'])
			.bbox(VIENNA_BBOX)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.trees)
			.schemaHash(treeSchemaHash),
		owner,
		'SCHEMA · Vienna Street Trees',
	)
	const treeCoord = coordOf(treeGroup)

	const heritageGroup = await publish(
		GroupFactory.create({
			name: 'Vienna Heritage (curated)',
			description: md('Heritage Sites', 'A **closed**, owner-curated collection. No community lane — only the owner’s picks appear.'),
			descriptionFormat: 'markdown',
			governance: 'closed',
		})
			.hashtags(['heritage', 'vienna'])
			.labels(['boundary'])
			.bbox(VIENNA_BBOX)
			.geohash(VIENNA_CENTROID)
			.referencedAddresses(curated.heritage),
		owner,
		'CLOSED · Vienna Heritage (curated)',
	)
	const heritageCoord = coordOf(heritageGroup)

	// ── Foreign contributions (`c` lane) ─────────────────────────────────────────
	console.log('\nCommunity contributions (`c` lane):')

	// OPEN cycling — 12 valid contributions across many contributors (rich mute target).
	for (let i = 0; i < 12; i++) {
		const p = pick(contributors)
		await dataset(p.signer, [featureNear(VIENNA_CENTROID, { name: `${pick(STREETS)} link by ${p.name}`, surface: pick(SURFACES) })], {
			hashtags: ['cycling'],
			contextRefs: [cyclingCoord],
		})
	}
	// Guarantee ONE prolific contributor with multiple rows in this lane so a tester
	// can prove "Mute @name" is app-wide (removes ALL of that contributor's rows).
	const prolific = contributors[0]
	for (let i = 0; i < 3; i++) {
		await dataset(prolific.signer, [featureNear(VIENNA_CENTROID, { name: `${pick(STREETS)} spur #${i + 1} by ${prolific.name}`, surface: pick(SURFACES) })], {
			hashtags: ['cycling'],
			contextRefs: [cyclingCoord],
		})
	}
	console.log(`  ✓ 15 → OPEN cycling group (3 from ${prolific.name} — mute target)`)

	// OPEN street-art — 10 valid contributions.
	for (let i = 0; i < 10; i++) {
		const p = pick(contributors)
		await dataset(p.signer, [featureNear(VIENNA_CENTROID, { name: `${pick(ARTKIND)} by ${p.name}`, kind: pick(ARTKIND) })], {
			hashtags: ['streetart'],
			contextRefs: [artCoord],
		})
	}
	console.log('  ✓ 10 → OPEN street-art group')

	// SCHEMA trees — mix of conforming + 3 violation shapes (Warn/Strict fodder).
	let conform = 0
	let violate = 0
	for (let i = 0; i < 14; i++) {
		const p = pick(contributors)
		const roll = rand()
		let props: Record<string, unknown>
		if (roll < 0.5) {
			props = { name: `Tree by ${p.name}`, species: pick(TREE_SPECIES) } // conforms
			conform++
		} else if (roll < 0.7) {
			props = { name: `Unidentified tree by ${p.name}` } // missing species
			violate++
		} else if (roll < 0.85) {
			props = { species: pick(TREE_SPECIES) } // missing name
			violate++
		} else {
			props = { note: 'no name, no species' } // missing both
			violate++
		}
		await dataset(p.signer, [featureNear(VIENNA_CENTROID, props)], { hashtags: ['trees'], contextRefs: [treeCoord] })
	}
	console.log(`  ✓ 14 → SCHEMA trees group (${conform} conform, ${violate} violate)`)

	// CLOSED heritage — 4 foreign attaches that MUST stay hidden (no foreign lane).
	for (let i = 0; i < 4; i++) {
		const p = pick(contributors)
		await dataset(p.signer, [featureNear(VIENNA_CENTROID, { name: `Drive-by claim by ${p.name}` })], {
			hashtags: ['heritage'],
			contextRefs: [heritageCoord],
		})
	}
	console.log('  ✓ 4 → CLOSED heritage group (must stay HIDDEN)')

	// ── Temporal Sightings (kind 37522) ─────────────────────────────────────────
	console.log('\nTemporal Sightings:')
	const sightingSpecs = [
		{ title: 'Kingfisher at Donaukanal', desc: 'Diving near Salztorbrücke.', start: now() - HOUR, end: now(), ctx: [cyclingCoord], ttl: 30 * DAY, who: contributors[4] },
		{ title: 'Peregrine on Stephansdom', desc: 'Nesting pair sighted.', start: now() - 2 * HOUR, end: now() - HOUR, ctx: [], ttl: 14 * DAY, who: contributors[5] },
		{ title: 'Naschmarkt night pop-up', desc: 'Temporary food stalls this weekend.', start: now() + DAY, end: now() + DAY + 6 * HOUR, ctx: [], ttl: 7 * DAY, who: contributors[0] },
		{ title: 'Mural unveiling — Gürtel', desc: 'Live painting event.', start: now() + 2 * DAY, end: now() + 2 * DAY + 4 * HOUR, ctx: [artCoord], ttl: 10 * DAY, who: contributors[1] },
		{ title: 'Beaver dam — Lobau', desc: 'Fresh activity observed.', start: now() - 6 * HOUR, end: now() - 5 * HOUR, ctx: [], ttl: 21 * DAY, who: contributors[6] },
		{ title: 'Hedgehog crossing — Prater', desc: 'Recurring nightly crossing.', start: now() - DAY, end: now(), ctx: [cyclingCoord], ttl: 14 * DAY, who: contributors[2] },
	]
	for (const s of sightingSpecs) {
		let f = TemporalSightingFactory.create({ title: s.title, description: s.desc, start: s.start, end: s.end })
			.hashtags(['sighting', 'vienna'])
			.bbox(VIENNA_BBOX)
			.geohash(jitter(VIENNA_CENTROID))
			.expiration(now() + s.ttl)
		if (s.ctx.length) f = f.contextReferences(s.ctx)
		await publish(f, s.who.signer)
	}
	console.log(`  ✓ ${sightingSpecs.length} sightings (2 attached to groups)`)

	// ── Live Beacons (kind 37521) ───────────────────────────────────────────────
	console.log('\nLive Beacons:')
	const beaconSpecs = [
		{ label: 'Field surveyor — live', ttl: HOUR, who: contributors[4] },
		{ label: 'Bike courier — live', ttl: 30 * 60, who: contributors[1] },
		{ label: 'Park ranger — live', ttl: 2 * HOUR, who: contributors[6] },
		{ label: 'Tour guide — live', ttl: 45 * 60, who: contributors[3] },
		{ label: 'Delivery rider — live', ttl: 20 * 60, who: contributors[5] },
	]
	for (const b of beaconSpecs) {
		const pos = jitter(VIENNA_CENTROID)
		await publish(
			LiveBeaconFactory.create({ label: b.label, position: pos })
				.hashtags(['live'])
				.geohash(pos)
				.expiration(now() + b.ttl),
			b.who.signer,
		)
	}
	console.log(`  ✓ ${beaconSpecs.length} beacons`)

	// ── Stories / Articles (kind 37520) ─────────────────────────────────────────
	console.log('\nStories:')
	const storySpecs = [
		{
			title: 'A Ride Through Vienna',
			summary: 'A narrative loop along the Ringstrasse and the Donaukanal.',
			content: '# A Ride Through Vienna\n\nWe started at the **Ringstrasse** and followed the canal north. The curated route is mapped here; the community keeps adding side paths.',
			refs: [curated.cycling[0], cyclingCoord],
			tags: ['narrative', 'cycling'],
			who: contributors[2],
		},
		{
			title: 'Field Notes: Donaukanal Wildlife',
			summary: 'Observations from a morning along the canal.',
			content: '# Field Notes\n\nA quiet morning produced a memorable **kingfisher** sighting near the Salztorbrücke.',
			refs: [curated.trees[0]],
			tags: ['narrative', 'wildlife'],
			who: contributors[2],
		},
		{
			title: 'Walls That Talk',
			summary: 'A walking tour of Vienna’s best murals.',
			content: '# Walls That Talk\n\nFrom the Gürtel to the canal, the city’s **street art** scene keeps shifting. Start with the curated picks.',
			refs: [artCoord, curated.art[0]],
			tags: ['narrative', 'streetart'],
			who: contributors[0],
		},
		{
			title: 'Under the Plane Trees',
			summary: 'Why Vienna’s street trees matter.',
			content: '# Under the Plane Trees\n\nThe **Street Trees** group tracks species block by block — a slow census of the urban canopy.',
			refs: [treeCoord],
			tags: ['narrative', 'trees'],
			who: contributors[3],
		},
	]
	for (const s of storySpecs) {
		await publish(
			ArticleFactory.create({ title: s.title, summary: s.summary, content: s.content })
				.hashtags(s.tags)
				.bbox(VIENNA_BBOX)
				.geohash(jitter(VIENNA_CENTROID))
				.referencedAddresses(s.refs),
			s.who.signer,
		)
	}
	console.log(`  ✓ ${storySpecs.length} stories`)

	// ── Summary ────────────────────────────────────────────────────────────────
	console.log('\n─────────────────────────────────────────────')
	console.log('Seed complete. Owner (devUser1):')
	console.log('  npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah')
	console.log('Groups:')
	console.log(`  OPEN cycling   ${cyclingCoord}`)
	console.log(`  OPEN streetart ${artCoord}`)
	console.log(`  SCHEMA trees   ${treeCoord}`)
	console.log(`  CLOSED heritage ${heritageCoord}`)
	console.log('─────────────────────────────────────────────\n')
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('Seed failed:', err)
		process.exit(1)
	})
