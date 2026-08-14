import { loadWorldLayer } from '@/lib/geo/worldData'
import type { ToolEntry } from './registry'
import { asFeatureObject, extractMcpToolResult, getGeoClient } from './helpers'

const COUNTRY_ALIASES: Record<string, string> = {
	'czech republic': 'czechia',
	'ivory coast': 'cote d ivoire',
	'russian federation': 'russia',
	'republic of korea': 'south korea',
	'democratic peoples republic of korea': 'north korea',
	usa: 'united states of america',
	us: 'united states of america',
	'united states': 'united states of america',
	uk: 'united kingdom',
}

function normalizeCountryKey(value: unknown): string {
	if (typeof value !== 'string') return ''
	const normalized = value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
	return COUNTRY_ALIASES[normalized] ?? normalized
}

function stringList(value: unknown, max?: number): string[] {
	if (!Array.isArray(value)) return []
	const values = [
		...new Set(
			value
				.filter((item): item is string => typeof item === 'string')
				.map((item) => item.trim())
				.filter(Boolean),
		),
	]
	return max === undefined ? values : values.slice(0, max)
}

export function normalizeReferenceBoundaryNames(
	value: unknown,
	level: 'country' | 'admin1',
): string[] {
	return stringList(value, level === 'country' ? 20 : undefined)
}

export function selectNaturalEarthCountries(
	world: GeoJSON.FeatureCollection,
	names: readonly string[],
	isoA2Codes: readonly string[],
): { features: GeoJSON.Feature[]; missing: string[] } {
	const byName = new Map<string, GeoJSON.Feature>()
	const byCode = new Map<string, GeoJSON.Feature>()
	for (const feature of world.features) {
		const name = normalizeCountryKey(feature.properties?.name)
		const code = String(feature.properties?.iso_a2 ?? '')
			.trim()
			.toUpperCase()
		if (name) byName.set(name, feature)
		if (code) byCode.set(code, feature)
	}

	const selected: GeoJSON.Feature[] = []
	const missing: string[] = []
	const seen = new Set<GeoJSON.Feature>()
	for (const request of names) {
		const match = byName.get(normalizeCountryKey(request))
		if (!match) missing.push(request)
		else if (!seen.has(match)) {
			seen.add(match)
			selected.push(match)
		}
	}
	for (const request of isoA2Codes) {
		const code = request.trim().toUpperCase()
		const match = byCode.get(code)
		if (!match) missing.push(code)
		else if (!seen.has(match)) {
			seen.add(match)
			selected.push(match)
		}
	}

	return {
		features: selected.map((feature) => ({
			...feature,
			properties: {
				...(feature.properties ?? {}),
				sourceDataset: 'Natural Earth countries_110m',
				sourceKind: 'bundled_world_layer',
				geometryPrecision: 'generalized',
				mappingBasis: 'Natural Earth 1:110m present-day country boundary',
			},
		})),
		missing,
	}
}

async function getAdminBoundaries(
	names: readonly string[],
	countryCode: string | undefined,
	adminLevel: number,
): Promise<{ features: GeoJSON.Feature[]; missing: string[] }> {
	const client = getGeoClient()
	const features: GeoJSON.Feature[] = []
	const missing: string[] = []
	for (const name of names) {
		const resolved = extractMcpToolResult(
			'resolve_osm_entity',
			await client.ResolveOsmEntity(name, 3, 'relation', adminLevel, countryCode),
		)
		const candidates = Array.isArray(resolved.candidates) ? resolved.candidates : []
		const candidate = candidates.find((value) => {
			if (!value || typeof value !== 'object') return false
			const record = value as Record<string, unknown>
			return record.osmType === 'relation' && typeof record.osmId === 'number'
		}) as Record<string, unknown> | undefined
		if (!candidate || typeof candidate.osmId !== 'number') {
			missing.push(name)
			continue
		}
		const relationId = Math.floor(candidate.osmId)
		const relation = extractMcpToolResult(
			'get_osm_relation_geometry',
			await client.GetOsmRelationGeometry(relationId, 5, 5_000),
		)
		const feature = asFeatureObject(relation.feature)
		if (!feature) {
			missing.push(name)
			continue
		}
		features.push({
			...feature,
			properties: {
				...(feature.properties ?? {}),
				name: typeof feature.properties?.name === 'string' ? feature.properties.name : name,
				sourceDataset: 'OpenStreetMap administrative relation',
				sourceKind: 'osm_admin_relation',
				sourceRelationId: relationId,
				mappingBasis: `Present-day OSM administrative boundary (admin_level=${adminLevel})`,
			},
		})
	}
	return { features, missing }
}

/** Register the source-selecting facade used instead of exposing boundary plumbing. */
export function registerReferenceBoundaryTools(register: (entry: ToolEntry) => void): void {
	register({
		name: 'get_reference_boundaries',
		kind: 'host-builtin',
		schema: {
			type: 'function',
			function: {
				name: 'get_reference_boundaries',
				description:
					'Get reference boundaries with the host choosing the appropriate source. Country/nation-state boundaries always come from the fast bundled Natural Earth layer. States, provinces, and other admin-1 regions use OSM relations. Request only boundaries that are thematic content; the basemap already supplies surrounding geographic context.',
				parameters: {
					type: 'object',
					properties: {
						level: {
							type: 'string',
							description:
								'Boundary kind. Use country for sovereign states and admin1 for states/provinces/regions.',
							enum: ['country', 'admin1'],
						},
						names: {
							type: 'array',
							description:
								'Boundary names. Country requests may batch up to 20; admin1 requests may include all requested regions in one call.',
						},
						isoA2Codes: {
							type: 'array',
							description: 'Optional ISO alpha-2 codes for country boundaries.',
						},
						countryCode: {
							type: 'string',
							description: 'Optional ISO alpha-2 constraint for admin1 name resolution.',
						},
						adminLevel: {
							type: 'number',
							description: 'OSM admin_level for regional boundaries. Defaults to 4.',
						},
						toEditor: {
							type: 'boolean',
							description: 'Import the returned boundaries into the editor.',
						},
						replaceExisting: {
							type: 'boolean',
							description: 'When toEditor=true, replace existing features instead of appending.',
						},
					},
					required: ['level'],
				},
			},
		},
		handler: async (args) => {
			const level = args.level === 'admin1' ? 'admin1' : args.level === 'country' ? 'country' : null
			if (!level) throw new Error('level must be country or admin1')
			const names = normalizeReferenceBoundaryNames(args.names, level)
			const isoA2Codes = stringList(args.isoA2Codes, 20)
			if (names.length === 0 && (level !== 'country' || isoA2Codes.length === 0)) {
				throw new Error('names must contain at least one boundary name')
			}

			if (level === 'country') {
				const result = selectNaturalEarthCountries(
					await loadWorldLayer('countries_110m'),
					names,
					isoA2Codes,
				)
				return {
					level,
					source: 'natural_earth_countries_110m',
					count: result.features.length,
					...result,
				}
			}

			const countryCode =
				typeof args.countryCode === 'string' ? args.countryCode.trim().toUpperCase() : undefined
			const adminLevel =
				typeof args.adminLevel === 'number' && Number.isFinite(args.adminLevel)
					? Math.max(3, Math.min(10, Math.floor(args.adminLevel)))
					: 4
			const result = await getAdminBoundaries(names, countryCode, adminLevel)
			return {
				level,
				source: 'openstreetmap_admin_relations',
				adminLevel,
				count: result.features.length,
				...result,
			}
		},
	})
}
