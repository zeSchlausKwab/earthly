/**
 * Regenerate `public/static/world/` — the bundled world reference layers
 * (docs/AI_GEO_AWARENESS.md §4, ATTRIBUTION.md in the target dir).
 *
 * Downloads Natural Earth themes (GeoJSON conversions from
 * martynafford/natural-earth-geojson) + the Eurostat searoute maritime network
 * (GeoJSON via genthalili/searoute-py), slims properties to what the app
 * needs, and rounds coordinates to 4 decimals (~11 m).
 *
 * Usage: bun scripts/fetch-world-data.ts
 */

import { join } from 'node:path'

const NE_BASE = 'https://raw.githubusercontent.com/martynafford/natural-earth-geojson/master'
const MARNET_URL =
	'https://raw.githubusercontent.com/genthalili/searoute-py/main/searoute/data/marnet_searoute.geojson'

const OUT_DIR = join(import.meta.dir, '..', 'public', 'static', 'world')

type Props = Record<string, unknown>
type Keep = (props: Props) => Props

/** source path → { output filename, property slimmer } */
const THEMES: Record<string, { out: string; keep: Keep }> = {
	'110m/physical/ne_110m_land.json': { out: 'land_110m.json', keep: () => ({}) },
	'50m/physical/ne_50m_land.json': { out: 'land_50m.json', keep: () => ({}) },
	'110m/physical/ne_110m_coastline.json': { out: 'coastline_110m.json', keep: () => ({}) },
	'110m/cultural/ne_110m_admin_0_countries.json': {
		out: 'countries_110m.json',
		keep: (p) => ({
			name: p.NAME ?? p.name,
			iso_a2: p.ISO_A2_EH ?? p.ISO_A2 ?? p.iso_a2,
			continent: p.CONTINENT ?? p.continent,
		}),
	},
	'110m/cultural/ne_110m_admin_0_boundary_lines_land.json': {
		out: 'borders_110m.json',
		keep: () => ({}),
	},
	// Rivers keep name_en over name: NE splits long rivers into per-stretch
	// features with LOCAL names ("Donau", "Dunav") — name_en is the consistent
	// English name the AI filters by ("Danube" must match the whole course).
	'110m/physical/ne_110m_rivers_lake_centerlines.json': {
		out: 'rivers_110m.json',
		keep: (p) => ({ name: p.name_en ?? p.name ?? null }),
	},
	// 50m rivers: ~450 NAMED major rivers at traceable fidelity ("trace the Danube").
	'50m/physical/ne_50m_rivers_lake_centerlines.json': {
		out: 'rivers_50m.json',
		keep: (p) => ({ name: p.name_en ?? p.name ?? null }),
	},
	'110m/physical/ne_110m_lakes.json': {
		out: 'lakes_110m.json',
		keep: (p) => ({ name: p.name ?? null }),
	},
	'110m/cultural/ne_110m_populated_places_simple.json': {
		out: 'cities_110m.json',
		keep: (p) => ({
			name: p.name,
			country: p.adm0name,
			pop: p.pop_max,
			capital: p.featurecla === 'Admin-0 capital' ? true : undefined,
		}),
	},
}

function roundCoords(coords: unknown): unknown {
	if (typeof coords === 'number') return Math.round(coords * 1e4) / 1e4
	if (Array.isArray(coords)) return coords.map(roundCoords)
	return coords
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
	return (await response.json()) as Record<string, unknown>
}

function slim(fc: Record<string, unknown>, keep: Keep): string {
	const features = fc.features as {
		properties?: Props
		geometry: { coordinates: unknown }
		bbox?: unknown
	}[]
	for (const feature of features) {
		feature.properties = JSON.parse(JSON.stringify(keep(feature.properties ?? {}))) as Props
		feature.geometry.coordinates = roundCoords(feature.geometry.coordinates)
		delete feature.bbox
	}
	delete fc.bbox
	return JSON.stringify(fc)
}

for (const [source, { out, keep }] of Object.entries(THEMES)) {
	const fc = await fetchJson(`${NE_BASE}/${source}`)
	const json = slim(fc, keep)
	await Bun.write(join(OUT_DIR, out), json)
	console.log(`${out} ← ${source} (${(json.length / 1024).toFixed(0)} KB)`)
}

const marnet = await fetchJson(MARNET_URL)
const marnetJson = JSON.stringify(marnet)
await Bun.write(join(OUT_DIR, 'maritime_network.json'), marnetJson)
console.log(`maritime_network.json ← searoute-py marnet (${(marnetJson.length / 1024).toFixed(0)} KB)`)
