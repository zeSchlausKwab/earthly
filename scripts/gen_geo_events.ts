import { faker } from '@faker-js/faker'
import NDK, { NDKEvent, type NDKPrivateKeySigner, type NDKTag } from '@nostr-dev-kit/ndk'
import { simplify, truncate } from '@turf/turf'
import { createHash } from 'crypto'
import type {
	FeatureCollection,
	Feature,
	Point,
	LineString,
	Polygon,
	MultiPolygon,
} from 'geojson'

// Helper to generate a geohash (simplified version)
function generateGeohash(lat: number, lon: number, precision: number = 5): string {
	const base32 = '0123456789bcdefghjkmnpqrstuvwxyz'
	let geohash = ''
	let even = true
	let latRange = [-90, 90]
	let lonRange = [-180, 180]

	for (let i = 0; i < precision; i++) {
		let ch = 0
		for (let bit = 0; bit < 5; bit++) {
			if (even) {
				const mid = (lonRange[0] + lonRange[1]) / 2
				if (lon >= mid) {
					ch |= 1 << (4 - bit)
					lonRange[0] = mid
				} else {
					lonRange[1] = mid
				}
			} else {
				const mid = (latRange[0] + latRange[1]) / 2
				if (lat >= mid) {
					ch |= 1 << (4 - bit)
					latRange[0] = mid
				} else {
					latRange[1] = mid
				}
			}
			even = !even
		}
		geohash += base32[ch]
	}
	return geohash
}

// Helper to calculate bounding box from features
function calculateBbox(features: Feature[]): [number, number, number, number] {
	let minLon = Infinity,
		minLat = Infinity,
		maxLon = -Infinity,
		maxLat = -Infinity

	features.forEach((feature) => {
		if (feature.geometry.type === 'Point') {
			const [lon, lat] = (feature.geometry as Point).coordinates
			minLon = Math.min(minLon, lon)
			maxLon = Math.max(maxLon, lon)
			minLat = Math.min(minLat, lat)
			maxLat = Math.max(maxLat, lat)
		} else if (feature.geometry.type === 'LineString') {
			;(feature.geometry as LineString).coordinates.forEach(([lon, lat]) => {
				minLon = Math.min(minLon, lon)
				maxLon = Math.max(maxLon, lon)
				minLat = Math.min(minLat, lat)
				maxLat = Math.max(maxLat, lat)
			})
		} else if (feature.geometry.type === 'Polygon') {
			;(feature.geometry as Polygon).coordinates[0].forEach(([lon, lat]) => {
				minLon = Math.min(minLon, lon)
				maxLon = Math.max(maxLon, lon)
				minLat = Math.min(minLat, lat)
				maxLat = Math.max(maxLat, lat)
			})
		} else if (feature.geometry.type === 'MultiPolygon') {
			;(feature.geometry as MultiPolygon).coordinates.forEach((polygon) => {
				polygon[0].forEach(([lon, lat]) => {
					minLon = Math.min(minLon, lon)
					maxLon = Math.max(maxLon, lon)
					minLat = Math.min(minLat, lat)
					maxLat = Math.max(maxLat, lat)
				})
			})
		}
	})

	return [minLon, minLat, maxLon, maxLat]
}

export type BlobReferenceSeed =
	| {
			scope: 'collection'
			url: string
			sha256?: string
			size?: number
			mimeType?: string
	  }
	| {
			scope: 'feature'
			featureId: string
			url: string
			sha256?: string
			size?: number
			mimeType?: string
	  }

export interface GenerateGeoEventOptions {
	blobReferences?: BlobReferenceSeed[]
	featureCollection?: FeatureCollection
	bboxOverride?: [number, number, number, number]
	hashtags?: string[]
}

// Helper to generate a circular polygon
function generateCircularPolygon(centerLon: number, centerLat: number, radiusKm: number, points: number = 16): [number, number][] {
	const coordinates: [number, number][] = []
	const radiusDegLat = radiusKm / 111.32 // Rough conversion: 1 degree lat ≈ 111.32 km
	const radiusDegLon = radiusKm / (111.32 * Math.cos((centerLat * Math.PI) / 180))

	for (let i = 0; i <= points; i++) {
		const angle = (i / points) * 2 * Math.PI
		const lat = centerLat + radiusDegLat * Math.sin(angle)
		const lon = centerLon + radiusDegLon * Math.cos(angle)
		coordinates.push([lon, lat])
	}
	return coordinates
}

// Helper to generate an irregular polygon
function generateIrregularPolygon(centerLon: number, centerLat: number, maxRadius: number, points: number = 8): [number, number][] {
	const coordinates: [number, number][] = []

	for (let i = 0; i <= points; i++) {
		const angle = (i / points) * 2 * Math.PI
		const radius = faker.number.float({ min: maxRadius * 0.3, max: maxRadius })
		const lat = centerLat + radius * Math.sin(angle)
		const lon = centerLon + radius * Math.cos(angle)
		coordinates.push([lon, lat])
	}
	return coordinates
}

// Helper to generate a winding river-like LineString
function generateRiverPath(startLon: number, startLat: number, length: number = 20): [number, number][] {
	const coordinates: [number, number][] = []
	let currentLon = startLon
	let currentLat = startLat
	let direction = faker.number.float({ min: 0, max: 2 * Math.PI })

	coordinates.push([currentLon, currentLat])

	for (let i = 1; i < length; i++) {
		// Add some meandering to the direction
		direction += faker.number.float({ min: -0.5, max: 0.5 })
		const stepSize = faker.number.float({ min: 0.002, max: 0.008 })

		currentLon += stepSize * Math.cos(direction)
		currentLat += stepSize * Math.sin(direction)
		coordinates.push([currentLon, currentLat])
	}

	return coordinates
}

// Helper to generate a polygon with holes
function generatePolygonWithHoles(centerLon: number, centerLat: number, outerRadius: number): [number, number][][] {
	const outer = generateCircularPolygon(centerLon, centerLat, outerRadius, 12)
	const holes: [number, number][][] = []

	// Add 1-2 holes
	const numHoles = faker.number.int({ min: 1, max: 2 })
	for (let i = 0; i < numHoles; i++) {
		const holeRadius = outerRadius * faker.number.float({ min: 0.2, max: 0.4 })
		const holeOffsetLat = faker.number.float({ min: -outerRadius * 0.5, max: outerRadius * 0.5 })
		const holeOffsetLon = faker.number.float({ min: -outerRadius * 0.5, max: outerRadius * 0.5 })

		const hole = generateCircularPolygon(centerLon + holeOffsetLon, centerLat + holeOffsetLat, holeRadius, 8)
		holes.push(hole)
	}

	return [outer, ...holes]
}

// Generate theme-based colors
function getThemeColors(theme: string) {
	const colorSchemes = {
		parks: {
			fill: ['#2d5a27', '#4a7c59', '#22c55e', '#16a34a', '#15803d'],
			stroke: ['#14532d', '#166534', '#15803d', '#166534', '#14532d'],
			opacity: [0.6, 0.7, 0.8],
		},
		trails: {
			fill: ['#92400e', '#a16207', '#d97706', '#f59e0b', '#eab308'],
			stroke: ['#451a03', '#78350f', '#92400e', '#a16207', '#ca8a04'],
			opacity: [0.8, 0.9],
		},
		waterways: {
			fill: ['#0369a1', '#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc'],
			stroke: ['#0c4a6e', '#075985', '#0369a1', '#0284c7', '#0369a1'],
			opacity: [0.7, 0.8, 0.9],
		},
		administrative: {
			fill: ['#7c2d12', '#9a3412', '#dc2626', '#ef4444', '#f87171'],
			stroke: ['#451a03', '#7c2d12', '#991b1b', '#dc2626', '#b91c1c'],
			opacity: [0.3, 0.4, 0.5],
		},
		pois: {
			fill: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe'],
			stroke: ['#4c1d95', '#5b21b6', '#7c3aed', '#8b5cf6', '#7c3aed'],
			opacity: [0.8, 0.9],
		},
	}

	const scheme = colorSchemes[theme as keyof typeof colorSchemes] || colorSchemes.pois
	return {
		fill: faker.helpers.arrayElement(scheme.fill),
		stroke: faker.helpers.arrayElement(scheme.stroke),
		opacity: faker.helpers.arrayElement(scheme.opacity),
	}
}

// Real-world datasets: East German Bundesländer
const EAST_GERMAN_STATES = [
	{
		name: 'Mecklenburg-Vorpommern',
		file: './data/east-germany/mecklenburg-vorpommern.geojson',
		capital: 'Schwerin',
		population: 1610774,
		area_km2: 23294,
	},
	{
		name: 'Brandenburg',
		file: './data/east-germany/brandenburg.geojson',
		capital: 'Potsdam',
		population: 2531071,
		area_km2: 29654,
	},
	{
		name: 'Sachsen-Anhalt',
		file: './data/east-germany/sachsen-anhalt.geojson',
		capital: 'Magdeburg',
		population: 2180684,
		area_km2: 20454,
	},
	{
		name: 'Thüringen',
		file: './data/east-germany/thueringen.geojson',
		capital: 'Erfurt',
		population: 2120237,
		area_km2: 16202,
	},
]

const MAX_INLINE_GEOJSON_BYTES = 480_000 // keep events under typical relay limits (~500 KB)
const SIMPLIFY_TOLERANCES = [0.0001, 0.0002, 0.0005, 0.001, 0.0025, 0.005]

function sizeOfFeatureCollection(fc: FeatureCollection): number {
	return Buffer.byteLength(JSON.stringify(fc), 'utf8')
}

function clampFeatureCollectionSize(
	featureCollection: FeatureCollection,
	maxBytes: number = MAX_INLINE_GEOJSON_BYTES,
): { featureCollection: FeatureCollection; originalSize: number; finalSize: number; simplified: boolean } {
	const truncated = truncate(featureCollection as any, { precision: 5, mutate: false }) as FeatureCollection
	const originalSize = sizeOfFeatureCollection(truncated)
	if (originalSize <= maxBytes) {
		return { featureCollection: truncated, originalSize, finalSize: originalSize, simplified: false }
	}

	let current = truncated
	let finalSize = originalSize
	let simplified = false

	for (const tolerance of SIMPLIFY_TOLERANCES) {
		const simplifiedFeatures = current.features.map((feature) => {
			try {
				return simplify(feature as any, { tolerance, highQuality: false, mutate: false }) as Feature
			} catch {
				return feature
			}
		})

		current = { ...current, features: simplifiedFeatures }
		finalSize = sizeOfFeatureCollection(current)
		simplified = true

		if (finalSize <= maxBytes) break
	}

	return { featureCollection: current, originalSize, finalSize, simplified }
}

// Helper to load real-world GeoJSON data
async function loadEastGermanState(stateName: string): Promise<FeatureCollection | null> {
	const state = EAST_GERMAN_STATES.find((s) => s.name === stateName)
	if (!state) return null

	try {
		const file = Bun.file(state.file)
		const content = await file.text()
		const geoJSON: FeatureCollection = JSON.parse(content)

		// Enhance properties with state metadata
		geoJSON.features = geoJSON.features.map((feature) => ({
			...feature,
			properties: {
				...feature.properties,
				name: state.name,
				capital: state.capital,
				population: state.population,
				area_km2: state.area_km2,
				country: 'Germany',
				historical_context: 'Former East Germany (GDR/DDR, 1949-1990)',
				admin_level: 4,
				type: 'Bundesland',
				founded: 1990,
			},
		}))

		return geoJSON
	} catch (error) {
		console.error(`Failed to load ${stateName}:`, error)
		return null
	}
}

// Generate sample GeoJSON features for different themes
function generateGeoJSONFeatures(theme: string, count: number = faker.number.int({ min: 3, max: 8 })): Feature[] {
	const features: Feature[] = []

	// Base coordinates around major cities for realistic data
	const cities = [
		{ name: 'Vienna', lat: 48.2082, lon: 16.3738 },
		{ name: 'Berlin', lat: 52.52, lon: 13.405 },
		{ name: 'Paris', lat: 48.8566, lon: 2.3522 },
		{ name: 'London', lat: 51.5074, lon: -0.1278 },
		{ name: 'Barcelona', lat: 41.3851, lon: 2.1734 },
	]

	const city = faker.helpers.arrayElement(cities)
	const spread = 0.1 // Degree spread around city center

	for (let i = 0; i < count; i++) {
		const lat = city.lat + faker.number.float({ min: -spread, max: spread })
		const lon = city.lon + faker.number.float({ min: -spread, max: spread })
		const colors = getThemeColors(theme)

		let feature: Feature

		switch (theme) {
			case 'parks':
				// Mix of different park geometries
				const parkType = faker.helpers.arrayElement(['simple', 'circular', 'irregular', 'with_holes', 'multi'])

				if (parkType === 'circular') {
					const radius = faker.number.float({ min: 0.003, max: 0.015 })
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Circle Park`,
							type: 'park',
							shape: 'circular',
							area: faker.number.int({ min: 2000, max: 15000 }),
							amenities: faker.helpers.arrayElements(
								['playground', 'benches', 'fountain', 'walking_paths', 'pond'],
								faker.number.int({ min: 2, max: 4 }),
							),
						},
						geometry: {
							type: 'Polygon',
							coordinates: [generateCircularPolygon(lon, lat, radius)],
						},
					}
				} else if (parkType === 'irregular') {
					const maxRadius = faker.number.float({ min: 0.005, max: 0.02 })
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Nature Park`,
							type: 'park',
							shape: 'irregular',
							area: faker.number.int({ min: 5000, max: 50000 }),
							amenities: faker.helpers.arrayElements(
								['hiking_trails', 'picnic_areas', 'wildlife_viewing', 'parking'],
								faker.number.int({ min: 2, max: 3 }),
							),
						},
						geometry: {
							type: 'Polygon',
							coordinates: [generateIrregularPolygon(lon, lat, maxRadius, 10)],
						},
					}
				} else if (parkType === 'with_holes') {
					const radius = faker.number.float({ min: 0.008, max: 0.025 })
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Complex Park`,
							type: 'park',
							shape: 'complex',
							area: faker.number.int({ min: 10000, max: 80000 }),
							amenities: faker.helpers.arrayElements(
								['lake', 'islands', 'bridges', 'gardens', 'pathways'],
								faker.number.int({ min: 3, max: 5 }),
							),
						},
						geometry: {
							type: 'Polygon',
							coordinates: generatePolygonWithHoles(lon, lat, radius),
						},
					}
				} else if (parkType === 'multi') {
					// MultiPolygon for park systems
					const numPolygons = faker.number.int({ min: 2, max: 4 })
					const polygons: [number, number][][][] = []

					for (let j = 0; j < numPolygons; j++) {
						const offsetLat = faker.number.float({ min: -0.02, max: 0.02 })
						const offsetLon = faker.number.float({ min: -0.02, max: 0.02 })
						const radius = faker.number.float({ min: 0.003, max: 0.01 })

						polygons.push([generateCircularPolygon(lon + offsetLon, lat + offsetLat, radius, 8)])
					}

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Park System`,
							type: 'park_system',
							shape: 'multiple',
							area: faker.number.int({ min: 15000, max: 100000 }),
							sections: numPolygons,
							amenities: faker.helpers.arrayElements(
								['distributed_facilities', 'connecting_paths', 'varied_landscapes'],
								faker.number.int({ min: 2, max: 3 }),
							),
						},
						geometry: {
							type: 'MultiPolygon',
							coordinates: polygons,
						},
					}
				} else {
					// Simple rectangular park
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} ${faker.word.noun()} Park`,
							type: 'park',
							shape: 'rectangular',
							area: faker.number.int({ min: 1000, max: 25000 }),
							amenities: faker.helpers.arrayElements(
								['playground', 'benches', 'fountain', 'walking_paths'],
								faker.number.int({ min: 1, max: 3 }),
							),
						},
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[lon, lat],
									[lon + 0.01, lat],
									[lon + 0.01, lat + 0.01],
									[lon, lat + 0.01],
									[lon, lat],
								],
							],
						},
					}
				}
				break

			case 'trails':
				const trailType = faker.helpers.arrayElement(['simple', 'winding', 'branched'])

				if (trailType === 'winding') {
					// Generate a meandering river-like trail
					const pathLength = faker.number.int({ min: 15, max: 30 })
					const coordinates = generateRiverPath(lon, lat, pathLength)

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} River Trail`,
							type: 'nature_trail',
							difficulty: faker.helpers.arrayElement(['easy', 'moderate']),
							length_km: faker.number.float({ min: 2.0, max: 8.5, fractionDigits: 1 }),
							surface: faker.helpers.arrayElement(['boardwalk', 'natural', 'gravel']),
							features: ['river_views', 'wildlife', 'bridges'],
						},
						geometry: {
							type: 'LineString',
							coordinates,
						},
					}
				} else if (trailType === 'branched') {
					// Generate a trail system with multiple branches
					const mainPath = generateRiverPath(lon, lat, 12)
					const branch1Start = Math.floor(mainPath.length / 3)
					const branch2Start = Math.floor((mainPath.length * 2) / 3)

					const branch1 = generateRiverPath(mainPath[branch1Start][0], mainPath[branch1Start][1], 8)
					const branch2 = generateRiverPath(mainPath[branch2Start][0], mainPath[branch2Start][1], 6)

					// Note: For true multi-line representation, we'd use MultiLineString, but for simplicity,
					// we'll create the main trail and note branches in properties
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Trail Network`,
							type: 'trail_system',
							difficulty: faker.helpers.arrayElement(['moderate', 'hard']),
							length_km: faker.number.float({ min: 5.0, max: 15.0, fractionDigits: 1 }),
							surface: faker.helpers.arrayElement(['mixed', 'dirt', 'rocky']),
							branches: 2,
							features: ['scenic_views', 'elevation_gain', 'loop_options'],
						},
						geometry: {
							type: 'LineString',
							coordinates: mainPath,
						},
					}
				} else {
					// Simple straight-ish trail
					const pathLength = faker.number.int({ min: 8, max: 15 })
					const coordinates: [number, number][] = []
					let currentLat = lat,
						currentLon = lon

					for (let j = 0; j < pathLength; j++) {
						coordinates.push([currentLon, currentLat])
						currentLat += faker.number.float({ min: -0.005, max: 0.005 })
						currentLon += faker.number.float({ min: -0.005, max: 0.005 })
					}

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Trail`,
							type: 'hiking_trail',
							difficulty: faker.helpers.arrayElement(['easy', 'moderate', 'hard']),
							length_km: faker.number.float({ min: 0.5, max: 12.0, fractionDigits: 1 }),
							surface: faker.helpers.arrayElement(['paved', 'gravel', 'dirt', 'mixed']),
						},
						geometry: {
							type: 'LineString',
							coordinates,
						},
					}
				}
				break

			case 'waterways':
				// Rivers, lakes, coastal areas
				const waterType = faker.helpers.arrayElement(['river', 'lake', 'coastline'])

				if (waterType === 'river') {
					const riverLength = faker.number.int({ min: 20, max: 40 })
					const coordinates = generateRiverPath(lon, lat, riverLength)

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} River`,
							type: 'river',
							width_m: faker.number.int({ min: 5, max: 200 }),
							navigable: faker.datatype.boolean(),
							flow_direction: faker.helpers.arrayElement(['north', 'south', 'east', 'west', 'northeast', 'southeast']),
						},
						geometry: {
							type: 'LineString',
							coordinates,
						},
					}
				} else if (waterType === 'lake') {
					const lakeRadius = faker.number.float({ min: 0.008, max: 0.03 })
					const hasIslands = faker.datatype.boolean(0.3)

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Lake`,
							type: 'lake',
							area_hectares: faker.number.int({ min: 50, max: 5000 }),
							depth_max_m: faker.number.int({ min: 5, max: 150 }),
							has_islands: hasIslands,
							activities: faker.helpers.arrayElements(
								['fishing', 'boating', 'swimming', 'bird_watching'],
								faker.number.int({ min: 1, max: 3 }),
							),
						},
						geometry: {
							type: 'Polygon',
							coordinates: hasIslands
								? generatePolygonWithHoles(lon, lat, lakeRadius)
								: [generateIrregularPolygon(lon, lat, lakeRadius, 12)],
						},
					}
				} else {
					// Coastline
					const coastLength = faker.number.int({ min: 25, max: 50 })
					const coordinates = generateRiverPath(lon, lat, coastLength)

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} Coast`,
							type: 'coastline',
							length_km: faker.number.float({ min: 3.0, max: 25.0, fractionDigits: 1 }),
							shore_type: faker.helpers.arrayElement(['sandy', 'rocky', 'cliff', 'mixed']),
							features: faker.helpers.arrayElements(
								['beaches', 'harbors', 'lighthouses', 'tide_pools'],
								faker.number.int({ min: 1, max: 3 }),
							),
						},
						geometry: {
							type: 'LineString',
							coordinates,
						},
					}
				}
				break

			case 'administrative':
				// Administrative boundaries, districts
				const adminType = faker.helpers.arrayElement(['district', 'zone', 'ward'])
				const boundaryComplexity = faker.helpers.arrayElement(['simple', 'complex', 'multi'])

				if (boundaryComplexity === 'multi') {
					// Multi-polygon for non-contiguous administrative areas
					const numPolygons = faker.number.int({ min: 2, max: 3 })
					const polygons: [number, number][][][] = []

					for (let j = 0; j < numPolygons; j++) {
						const offsetLat = faker.number.float({ min: -0.05, max: 0.05 })
						const offsetLon = faker.number.float({ min: -0.05, max: 0.05 })
						const radius = faker.number.float({ min: 0.01, max: 0.03 })

						polygons.push([generateIrregularPolygon(lon + offsetLon, lat + offsetLat, radius, 8)])
					}

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} ${adminType} Complex`,
							type: adminType,
							admin_level: faker.number.int({ min: 4, max: 8 }),
							population: faker.number.int({ min: 5000, max: 250000 }),
							area_km2: faker.number.float({ min: 25.0, max: 500.0, fractionDigits: 1 }),
							sections: numPolygons,
						},
						geometry: {
							type: 'MultiPolygon',
							coordinates: polygons,
						},
					}
				} else if (boundaryComplexity === 'complex') {
					const radius = faker.number.float({ min: 0.02, max: 0.08 })
					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} ${adminType}`,
							type: adminType,
							admin_level: faker.number.int({ min: 5, max: 9 }),
							population: faker.number.int({ min: 10000, max: 500000 }),
							area_km2: faker.number.float({ min: 50.0, max: 1200.0, fractionDigits: 1 }),
						},
						geometry: {
							type: 'Polygon',
							coordinates: [generateIrregularPolygon(lon, lat, radius, 16)],
						},
					}
				} else {
					// Simple rectangular district
					const width = faker.number.float({ min: 0.02, max: 0.06 })
					const height = faker.number.float({ min: 0.02, max: 0.06 })

					feature = {
						type: 'Feature',
						id: faker.string.uuid(),
						properties: {
							name: `${faker.word.adjective()} ${adminType}`,
							type: adminType,
							admin_level: faker.number.int({ min: 6, max: 10 }),
							population: faker.number.int({ min: 2000, max: 100000 }),
							area_km2: faker.number.float({ min: 10.0, max: 200.0, fractionDigits: 1 }),
						},
						geometry: {
							type: 'Polygon',
							coordinates: [
								[
									[lon, lat],
									[lon + width, lat],
									[lon + width, lat + height],
									[lon, lat + height],
									[lon, lat],
								],
							],
						},
					}
				}
				break

			case 'pois':
			default:
				feature = {
					type: 'Feature',
					id: faker.string.uuid(),
					properties: {
						name: faker.company.name(),
						type: faker.helpers.arrayElement(['restaurant', 'shop', 'museum', 'landmark', 'viewpoint', 'hospital', 'school']),
						rating: faker.number.float({ min: 3.0, max: 5.0, fractionDigits: 1 }),
						address: faker.location.streetAddress(),
						amenities: faker.helpers.arrayElements(
							['parking', 'wheelchair_access', 'wifi', 'restrooms'],
							faker.number.int({ min: 0, max: 3 }),
						),
					},
					geometry: {
						type: 'Point',
						coordinates: [lon, lat],
					},
				}
				break
		}

		// Add colors to all features
		if (feature.properties) {
			feature.properties = {
				...feature.properties,
				...colors,
			}
		}

		features.push(feature)
	}

	return features
}

export async function generateGeoEventData(
	collectionRef?: string,
	options?: GenerateGeoEventOptions & { useRealData?: boolean; stateName?: string },
): Promise<{
	kind: 31991
	content: string
	tags: NDKTag[]
	created_at: number
}> {
	let featureCollection: FeatureCollection & Record<string, any>
	let theme: string | undefined

	// Use real-world data if requested
	if (options?.useRealData) {
		const state = options.stateName
			? EAST_GERMAN_STATES.find(s => s.name === options.stateName)
			: faker.helpers.arrayElement(EAST_GERMAN_STATES)
		if (!state) {
			throw new Error(`State not found: ${options.stateName}`)
		}
		const realData = await loadEastGermanState(state.name)
		if (realData) {
			featureCollection = {
				...realData,
				name: state.name,
			}
			theme = 'germany'
		} else {
			// Fallback to fake data if loading fails
			theme = 'administrative'
			featureCollection = {
				type: 'FeatureCollection',
				name: `${faker.location.city()} ${theme} dataset`,
				features: generateGeoJSONFeatures(theme),
			}
		}
	} else {
		// Original fake data generation
		theme = options?.featureCollection
			? undefined
			: faker.helpers.arrayElement(['parks', 'trails', 'waterways', 'administrative', 'pois'])
		featureCollection =
			(options?.featureCollection as FeatureCollection & Record<string, any>) ??
			{
				type: 'FeatureCollection',
				name: `${faker.location.city()} ${theme} dataset`,
				features: generateGeoJSONFeatures(theme || 'parks'),
			}
	}
	const sizeInfo = clampFeatureCollectionSize(featureCollection)
	featureCollection = sizeInfo.featureCollection

	if (sizeInfo.simplified) {
		const label = featureCollection.name || 'geo-event'
		console.log(
			`  - Simplified ${label} payload ${sizeInfo.originalSize.toLocaleString()}B → ${sizeInfo.finalSize.toLocaleString()}B to fit relay limits`,
		)
	}

	const bbox = options?.bboxOverride ?? calculateBbox(featureCollection.features as Feature[])

	// Calculate centroid for geohash
	const centroidLat = (bbox[1] + bbox[3]) / 2
	const centroidLon = (bbox[0] + bbox[2]) / 2
	const geohash = generateGeohash(centroidLat, centroidLon)

	const content = JSON.stringify(featureCollection)
	const contentSize = Buffer.byteLength(content, 'utf8')
	const checksum = createHash('sha256').update(content).digest('hex')
	const datasetId = faker.string.uuid()

	const baseHashtags =
		options?.hashtags ??
		[
			theme ?? 'external',
			faker.helpers.arrayElement(['public', 'community', 'municipal']),
		]

	const tags: NDKTag[] = [
		['d', datasetId],
		['bbox', `${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]}`],
		['g', geohash],
		['crs', 'EPSG:4326'],
		['checksum', checksum],
		['size', contentSize.toString()],
		['v', '1'],
	]

	baseHashtags.forEach(tag => tags.push(['t', tag]))

	// Add collection reference if provided
	if (collectionRef) {
		tags.push(['collection', collectionRef])
	}

	if (options?.blobReferences) {
		options.blobReferences.forEach(blob => {
			const scope =
				blob.scope === 'collection' ? 'collection' : `feature:${blob.featureId}`
			const tag: NDKTag = ['blob', scope, blob.url]
			if (blob.sha256) tag.push(`sha256=${blob.sha256}`)
			if (typeof blob.size === 'number') tag.push(`size=${blob.size}`)
			if (blob.mimeType) tag.push(`mime=${blob.mimeType}`)
			tags.push(tag)
		})
	}

	return {
		kind: 31991,
		content,
		tags,
		created_at: Math.floor(Date.now() / 1000),
	}
}

export async function createGeoEventEvent(signer: NDKPrivateKeySigner, ndk: NDK, geoEventData: ReturnType<typeof generateGeoEventData>) {
	const event = new NDKEvent(ndk)
	event.kind = geoEventData.kind
	event.content = geoEventData.content
	event.tags = geoEventData.tags
	event.created_at = geoEventData.created_at

	try {
		await event.sign(signer)
		await event.publish()

		const datasetName = JSON.parse(geoEventData.content).name
		console.log(`Published geo-event: ${datasetName}`)
		return event.id
	} catch (error) {
		console.error(`Failed to publish geo-event`, error)
		return null
	}
}
