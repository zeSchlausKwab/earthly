/**
 * `seed sightings` — a focused, well-varied set of Temporal Sightings
 * (kind 37522) so the Sighting UI is easy to UAT (port of the retired
 * scripts/seed-sightings.ts, now on the shared seeder layer):
 *
 *   - DISTINCT point/area geometry per sighting (spread across Vienna) so each
 *     renders as its OWN map marker.
 *   - All three observation states (classifyObservationState):
 *       • live      — accent (amber) focal markers
 *       • upcoming  — secondary (blue) markers
 *       • past      — muted (grey) markers
 *   - Varied NIP-40 expiry: long-lived, "fades soon" (<24h), and never-expiring.
 *   - Mixed authorship: several owned by devUser1 (the browser UAT key) so the
 *     owner-gated Edit/Delete buttons show; the rest by named contributors.
 *   - A couple with NO description (exercises the optional-description path).
 *
 * NOT idempotent: each run mints fresh random `d`-tags (adds to existing data).
 */

import type { Geometry, Point } from 'geojson'
import { bboxFromGeometry, pointBbox } from '../geo/bbox'
import type { GeoBoundingBox } from '@/lib/nostr/geo-event/helpers'
import { TemporalSightingFactory } from '@/lib/nostr/temporal-sighting/factory'
import { devIdentities, type SeedIdentity, signProfile } from '../identities'
import { jitter, nth, quadAround, VIENNA_CENTROID } from '../random'
import type { SeederContext } from '../types'

const now = () => Math.floor(Date.now() / 1000)
const HOUR = 3600
const DAY = 86400

interface SightingSpec {
	title: string
	description?: string
	start: number
	end?: number
	/** TTL in seconds from now; undefined = never expires. */
	ttl?: number
	who: SeedIdentity
	/** 'point' (default) or 'area' (small polygon). */
	shape?: 'point' | 'area'
	/**
	 * NIP-92 imeta photo slugs (SPEC §6.1). Rendered from picsum.photos so dev
	 * seeds carry realistic image tags without a local blossom server; first
	 * slug = primary image (the map pin-bubble thumbnail).
	 */
	images?: string[]
}

/** Deterministic dev photo URL — stable per slug across seed runs. */
function seedPhoto(slug: string): { url: string; type: string; dimensions: string } {
	return {
		url: `https://picsum.photos/seed/${slug}/480/360`,
		type: 'image/jpeg',
		dimensions: '480x360',
	}
}

function buildSpecs(owner: SeedIdentity, contributors: SeedIdentity[]): SightingSpec[] {
	const mara = nth(contributors, 0)
	const tomas = nth(contributors, 1)
	const lena = nth(contributors, 2)
	const jonas = nth(contributors, 3)
	return [
		// ── LIVE (start in the past, still ongoing) → amber focal markers ────────
		{
			title: 'Kingfisher at Donaukanal',
			images: ['kingfisher-1', 'kingfisher-2'],
			description: 'Diving near Salztorbrücke — bright blue flash.',
			start: now() - HOUR,
			end: now() + HOUR,
			who: owner,
		}, // never expires
		{
			title: 'Street musicians — Stephansplatz',
			description: 'Brass quartet, big crowd.',
			start: now() - 2 * HOUR,
			end: now() + 30 * 60,
			ttl: 7 * DAY,
			who: mara,
		},
		{
			title: 'Food truck rally — MuseumsQuartier',
			images: ['foodtrucks-1', 'foodtrucks-2', 'foodtrucks-3'],
			description: 'A dozen trucks set up in the courtyard.',
			start: now() - 3 * HOUR,
			end: now() + 4 * HOUR,
			ttl: 2 * DAY,
			who: owner,
		},
		{
			title: 'Red fox — Stadtpark',
			images: ['redfox-1'],
			start: now() - 40 * 60,
			end: now() + 20 * 60,
			ttl: 20 * HOUR,
			who: tomas,
			shape: 'area',
		}, // no description, "fades soon"

		// ── UPCOMING (start in the future) → blue markers ────────────────────────
		{
			title: 'Mural unveiling — Gürtel',
			images: ['mural-1'],
			description: 'Live painting + DJ from 6pm.',
			start: now() + 2 * DAY,
			end: now() + 2 * DAY + 4 * HOUR,
			ttl: 10 * DAY,
			who: owner,
		},
		{
			title: 'Naschmarkt night market',
			description: 'Weekend food + craft stalls.',
			start: now() + DAY,
			end: now() + DAY + 6 * HOUR,
			ttl: 9 * DAY,
			who: lena,
		},
		{
			title: 'Perseids viewing — Kahlenberg',
			description: 'Bring a blanket; best after midnight.',
			start: now() + 3 * DAY,
			end: now() + 3 * DAY + 5 * HOUR,
			ttl: 14 * DAY,
			who: mara,
		},
		{
			title: 'Pop-up gallery — Karlsplatz',
			start: now() + 5 * DAY,
			end: now() + 5 * DAY + 8 * HOUR,
			ttl: 12 * DAY,
			who: jonas,
		}, // no description

		// ── PAST (ended, but not yet NIP-40 expired) → grey markers ──────────────
		{
			title: 'Peregrine on Stephansdom',
			images: ['peregrine-1', 'peregrine-2'],
			description: 'Nesting pair sighted at dawn.',
			start: now() - 2 * DAY,
			end: now() - 2 * DAY + HOUR,
			ttl: 20 * DAY,
			who: tomas,
		},
		{
			title: 'Beaver dam — Lobau',
			images: ['beaverdam-1'],
			description: 'Fresh-cut branches across the side channel.',
			start: now() - 5 * DAY,
			end: now() - 5 * DAY + 30 * 60,
			ttl: 21 * DAY,
			who: owner,
			shape: 'area',
		},
		{
			title: 'Ice formation — Donauinsel',
			images: ['ice-1'],
			description: 'Wind-sculpted ridge along the bank.',
			start: now() - 4 * DAY,
			end: now() - 4 * DAY + 2 * HOUR,
			ttl: 15 * DAY,
			who: lena,
		},
		{
			title: 'Hedgehog crossing — Prater',
			description: 'Same spot two nights running.',
			start: now() - 6 * DAY,
			end: now() - 6 * DAY + 20 * 60,
			ttl: 18 * DAY,
			who: mara,
		},
	]
}

export async function runSightings(ctx: SeederContext): Promise<void> {
	const { client, owner } = ctx
	const { contributors } = devIdentities()
	// If a custom --key was provided the owner replaces devUser1 in the roster.
	const everyone = [owner, ...contributors]
	const specs = buildSpecs(owner, contributors)

	console.log(`\nSeeding ${specs.length} Temporal Sightings → ${client.url}\n`)

	console.log('Profiles:')
	for (const person of everyone) {
		await client.publish(
			await signProfile(person, `Sighting contributor — ${person.name}.`),
			`profile ${person.name}`,
		)
	}
	console.log(`  ✓ ${everyone.length} profiles`)

	console.log('\nSightings:')
	let live = 0
	let upcoming = 0
	let past = 0
	for (const spec of specs) {
		const center = jitter(VIENNA_CENTROID, 0.055)
		const geometry: Geometry =
			spec.shape === 'area' ? quadAround(center) : ({ type: 'Point', coordinates: center } as Point)

		let factory = TemporalSightingFactory.create({
			title: spec.title,
			description: spec.description,
			start: spec.start,
			end: spec.end,
			geometry,
		})
			.hashtags(['sighting', 'vienna'])
			// bbox MUST bound the actual geometry so "zoom to" lands on the marker
			// (the runtime also prefers content.geometry, but keep the tag consistent).
			.bbox((bboxFromGeometry(geometry) as GeoBoundingBox) ?? pointBbox(center, 0.0008))
			.geohash(center)
		if (spec.ttl !== undefined) factory = factory.expiration(now() + spec.ttl)
		// NIP-92 imeta photos (SPEC §6.1) — first = primary (map pin-bubble thumbnail).
		if (spec.images?.length) factory = factory.images(spec.images.map(seedPhoto))

		const signed = await factory.sign(spec.who.signer)
		await client.publish(signed, spec.title)

		const state =
			spec.start > now() ? 'upcoming' : (spec.end ?? spec.start) < now() ? 'past' : 'live'
		if (state === 'live') live++
		else if (state === 'upcoming') upcoming++
		else past++
		const fade = spec.ttl === undefined ? 'never' : `${Math.round(spec.ttl / DAY) || '<1'}d`
		console.log(`  ✓ [${state.padEnd(8)}] ${spec.title}  (by ${spec.who.name}, fades: ${fade})`)
	}

	console.log('\n─────────────────────────────────────────────')
	console.log(
		`Sightings complete: ${specs.length} sightings — ${live} live · ${upcoming} upcoming · ${past} past`,
	)
	console.log('Owner authored several — log in as that key to test Edit/Delete.')
}
