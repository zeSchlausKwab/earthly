/**
 * Seed the local relay (ws://localhost:3334) with a focused, well-varied set of
 * Temporal Sightings (kind 37522) so the new Sighting UI is easy to UAT:
 *
 *   - DISTINCT point/area geometry per sighting (spread across Vienna) so each
 *     renders as its OWN map marker — unlike `seed-entities.ts`, which gives every
 *     sighting the same VIENNA_BBOX and therefore stacks them on one centroid.
 *   - All three observation states (classifyObservationState):
 *       • live      — accent (amber) focal markers
 *       • upcoming  — secondary (blue) markers
 *       • past      — muted (grey) markers
 *   - Varied NIP-40 expiry: long-lived, "fades soon" (<24h), and never-expiring.
 *   - Mixed authorship: several owned by devUser1 (the browser UAT key) so the
 *     owner-gated Edit/Delete buttons show; the rest by named contributors so the
 *     tester can like / zap / comment on someone else's sighting.
 *   - A couple with NO description (exercises the optional-description path in the
 *     row + hover popup).
 *
 * Built + signed through the REAL TemporalSightingFactory (modelVersion
 * "earthly/2"), published straight to the local relay.
 *
 * NOT idempotent: each run mints fresh random `d`-tags (adds to existing data).
 *   bun relay        # ensure the relay is up
 *   bun run seed:sightings
 */

import type { Geometry, Point, Polygon } from 'geojson'
import type { EventTemplate, NostrEvent } from 'nostr-tools'
import NDK, { NDKPrivateKeySigner } from '@/lib/seed-relay'
import { devUser1, devUser2, devUser3, devUser4, devUser5 } from '@/lib/fixtures'
import { bboxFromGeometry } from '@/lib/geo/bbox'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event/helpers'
import { TemporalSightingFactory } from '@/lib/nostr/temporal-sighting/factory'

const RELAY_URL = 'ws://localhost:3334'
const ndk = new NDK({ explicitRelayUrls: [RELAY_URL] })

// ── Randomness / geo (Vienna) ─────────────────────────────────────────────────
function rand(): number {
	const buf = new Uint32Array(1)
	crypto.getRandomValues(buf)
	return buf[0] / 0x100000000
}
const VIENNA: [number, number] = [16.3738, 48.2082]
function jitter(center: [number, number], spread = 0.05): [number, number] {
	return [center[0] + (rand() - 0.5) * 2 * spread, center[1] + (rand() - 0.5) * 2 * spread]
}

const now = () => Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86400

/** A tight bbox around a point so the row's "zoom to" flies in close. */
function tightBox([lon, lat]: [number, number], r = 0.0008): GeoBoundingBox {
	return [lon - r, lat - r, lon + r, lat + r]
}

/** A small quad polygon around a point (the "area where I saw it" case). */
function quadAround([lon, lat]: [number, number], d = 0.0015): Polygon {
	return {
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

// ── Relay plumbing (mirrors seed-entities.ts) ─────────────────────────────────
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
	await Promise.race([
		ndk.applesaucePool.publish([RELAY_URL], event),
		new Promise<never>((_resolve, reject) =>
			setTimeout(() => reject(new Error('publish timed out — is the relay running? `bun relay`')), 8000),
		),
	])
}

async function publishProfile(signer: NDKPrivateKeySigner, name: string): Promise<void> {
	const draft: EventTemplate = {
		kind: 0,
		content: JSON.stringify({ name, display_name: name, about: `Sighting contributor — ${name}.` }),
		tags: [],
		created_at: now(),
	}
	await publishRaw(signer.signEvent(draft))
}

// ── Authors (devUser1 = browser UAT key, owns the "owned" rows) ────────────────
const owner = { signer: new NDKPrivateKeySigner(devUser1.sk), name: 'Earthly Curator' }
const mara = { signer: new NDKPrivateKeySigner(devUser2.sk), name: 'Mara Holzer' }
const tomas = { signer: new NDKPrivateKeySigner(devUser3.sk), name: 'Tomas Veit' }
const lena = { signer: new NDKPrivateKeySigner(devUser4.sk), name: 'Lena Brandt' }
const jonas = { signer: new NDKPrivateKeySigner(devUser5.sk), name: 'Jonas Reiter' }
const everyone = [owner, mara, tomas, lena, jonas]

interface SightingSpec {
	title: string
	description?: string
	start: number
	end?: number
	/** TTL in seconds from now; undefined = never expires. */
	ttl?: number
	who: { signer: NDKPrivateKeySigner; name: string }
	/** 'point' (default) or 'area' (small polygon). */
	shape?: 'point' | 'area'
}

const specs: SightingSpec[] = [
	// ── LIVE (start in the past, still ongoing) → amber focal markers ──────────
	{ title: 'Kingfisher at Donaukanal', description: 'Diving near Salztorbrücke — bright blue flash.', start: now() - HOUR, end: now() + HOUR, who: owner }, // never expires
	{ title: 'Street musicians — Stephansplatz', description: 'Brass quartet, big crowd.', start: now() - 2 * HOUR, end: now() + 30 * 60, ttl: 7 * DAY, who: mara },
	{ title: 'Food truck rally — MuseumsQuartier', description: 'A dozen trucks set up in the courtyard.', start: now() - 3 * HOUR, end: now() + 4 * HOUR, ttl: 2 * DAY, who: owner },
	{ title: 'Red fox — Stadtpark', start: now() - 40 * 60, end: now() + 20 * 60, ttl: 20 * HOUR, who: tomas, shape: 'area' }, // no description, "fades soon"

	// ── UPCOMING (start in the future) → blue markers ──────────────────────────
	{ title: 'Mural unveiling — Gürtel', description: 'Live painting + DJ from 6pm.', start: now() + 2 * DAY, end: now() + 2 * DAY + 4 * HOUR, ttl: 10 * DAY, who: owner },
	{ title: 'Naschmarkt night market', description: 'Weekend food + craft stalls.', start: now() + DAY, end: now() + DAY + 6 * HOUR, ttl: 9 * DAY, who: lena },
	{ title: 'Perseids viewing — Kahlenberg', description: 'Bring a blanket; best after midnight.', start: now() + 3 * DAY, end: now() + 3 * DAY + 5 * HOUR, ttl: 14 * DAY, who: mara },
	{ title: 'Pop-up gallery — Karlsplatz', start: now() + 5 * DAY, end: now() + 5 * DAY + 8 * HOUR, ttl: 12 * DAY, who: jonas }, // no description

	// ── PAST (ended, but not yet NIP-40 expired) → grey markers ────────────────
	{ title: 'Peregrine on Stephansdom', description: 'Nesting pair sighted at dawn.', start: now() - 2 * DAY, end: now() - 2 * DAY + HOUR, ttl: 20 * DAY, who: tomas },
	{ title: 'Beaver dam — Lobau', description: 'Fresh-cut branches across the side channel.', start: now() - 5 * DAY, end: now() - 5 * DAY + 30 * 60, ttl: 21 * DAY, who: owner, shape: 'area' },
	{ title: 'Ice formation — Donauinsel', description: 'Wind-sculpted ridge along the bank.', start: now() - 4 * DAY, end: now() - 4 * DAY + 2 * HOUR, ttl: 15 * DAY, who: lena },
	{ title: 'Hedgehog crossing — Prater', description: 'Same spot two nights running.', start: now() - 6 * DAY, end: now() - 6 * DAY + 20 * 60, ttl: 18 * DAY, who: mara },
]

async function seed(): Promise<void> {
	console.log(`\nSeeding ${specs.length} Temporal Sightings → ${RELAY_URL}\n`)
	await assertRelayReachable()

	console.log('Profiles:')
	for (const p of everyone) await publishProfile(p.signer, p.name)
	console.log(`  ✓ ${everyone.length} profiles`)

	console.log('\nSightings:')
	let live = 0
	let upcoming = 0
	let past = 0
	for (const s of specs) {
		const center = jitter(VIENNA, 0.055)
		const geometry: Geometry =
			s.shape === 'area' ? quadAround(center) : ({ type: 'Point', coordinates: center } as Point)

		let f = TemporalSightingFactory.create({
			title: s.title,
			description: s.description,
			start: s.start,
			end: s.end,
			geometry,
		})
			.hashtags(['sighting', 'vienna'])
			// bbox MUST bound the actual geometry so "zoom to" lands on the marker
			// (the runtime also prefers content.geometry, but keep the tag consistent).
			.bbox((bboxFromGeometry(geometry) as GeoBoundingBox) ?? tightBox(center))
			.geohash(center)
		if (s.ttl !== undefined) f = f.expiration(now() + s.ttl)

		const signed = await f.sign(s.who.signer)
		await publishRaw(signed)

		const state = s.start > now() ? 'upcoming' : (s.end ?? s.start) < now() ? 'past' : 'live'
		if (state === 'live') live++
		else if (state === 'upcoming') upcoming++
		else past++
		const fade = s.ttl === undefined ? 'never' : `${Math.round(s.ttl / DAY) || '<1'}d`
		console.log(`  ✓ [${state.padEnd(8)}] ${s.title}  (by ${s.who.name}, fades: ${fade})`)
	}

	console.log('\n─────────────────────────────────────────────')
	console.log(`Seed complete: ${specs.length} sightings — ${live} live · ${upcoming} upcoming · ${past} past`)
	console.log('Owner (devUser1) authored several — log in as that key to test Edit/Delete:')
	console.log('  npub1s65ze2cck2fl20964t5vmjlw8alvgflal8uujv7mw7qqhd008zsqd2nnah')
	console.log('─────────────────────────────────────────────\n')
}

seed()
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('Seed failed:', err)
		process.exit(1)
	})
