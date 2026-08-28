import { createReadStream, readFileSync } from 'node:fs'
import type { Geometry } from 'geojson'
import type {
	GeoCatalogBbox,
	GeoCatalogEntry,
	GeoCatalogJsonValue,
	GeoCatalogKind,
	GeoCatalogSourceRelease,
} from './index'

export const OVERTURE_SOURCE_NAME = 'Overture Maps'
const OVERTURE_RELEASE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.\d+$/u

export const OVERTURE_FEATURE_TYPES = [
	'division_area',
	'place',
	'segment',
	'infrastructure',
	'water',
] as const

export type OvertureFeatureType = (typeof OVERTURE_FEATURE_TYPES)[number]

export interface OvertureInputSpec {
	featureType: OvertureFeatureType
	path: string
}

export interface NormalizeOvertureFeatureOptions {
	release: string
	/** Required for projected exports that omit Overture's `theme` and `type` columns. */
	featureType?: OvertureFeatureType
}

export interface ReadOvertureGeoJsonSequenceOptions {
	release: string
	onRecord?: (record: {
		featureType: OvertureFeatureType
		recordNumber: number
		included: boolean
	}) => void
}

interface OvertureTypeDescriptor {
	theme: 'divisions' | 'places' | 'transportation' | 'base'
	type: OvertureFeatureType
	geometryTypes: readonly Geometry['type'][]
}

const OVERTURE_TYPE_DESCRIPTORS: Record<OvertureFeatureType, OvertureTypeDescriptor> = {
	division_area: {
		theme: 'divisions',
		type: 'division_area',
		geometryTypes: ['Polygon', 'MultiPolygon'],
	},
	place: { theme: 'places', type: 'place', geometryTypes: ['Point'] },
	segment: { theme: 'transportation', type: 'segment', geometryTypes: ['LineString'] },
	infrastructure: {
		theme: 'base',
		type: 'infrastructure',
		geometryTypes: ['Point', 'LineString', 'Polygon', 'MultiPolygon'],
	},
	water: {
		theme: 'base',
		type: 'water',
		geometryTypes: ['Point', 'LineString', 'Polygon', 'MultiPolygon'],
	},
}

const INPUT_TYPE_ALIASES: Readonly<Record<string, OvertureFeatureType>> = {
	division_area: 'division_area',
	'division-area': 'division_area',
	'divisions/division_area': 'division_area',
	place: 'place',
	'places/place': 'place',
	segment: 'segment',
	transportation_segment: 'segment',
	'transportation/segment': 'segment',
	infrastructure: 'infrastructure',
	'base/infrastructure': 'infrastructure',
	water: 'water',
	base_water: 'water',
	'base/water': 'water',
}

/**
 * Infrastructure is intentionally allowlisted. The global Overture base layer
 * is much too broad for a place-oriented catalog, and newly introduced classes
 * should be reviewed before they silently enter a snapshot.
 */
export const SELECTED_OVERTURE_INFRASTRUCTURE_CLASSES = new Set([
	'airport',
	'airport_gate',
	'airstrip',
	'border_control',
	'bridge',
	'bus_station',
	'bus_stop',
	'communication_line',
	'communication_pole',
	'communication_tower',
	'dam',
	'ferry_terminal',
	'fire_hydrant',
	'generator',
	'helipad',
	'heliport',
	'international_airport',
	'military_airport',
	'mobile_phone_tower',
	'municipal_airport',
	'pipeline',
	'plant',
	'platform',
	'power_line',
	'power_pole',
	'power_tower',
	'private_airport',
	'railway_halt',
	'railway_station',
	'regional_airport',
	'runway',
	'seaplane_airport',
	'siren',
	'substation',
	'subway_station',
	'taxiway',
	'terminal',
	'transformer',
	'water_tower',
	'weir',
])

const SELECTED_OVERTURE_WATER_SUBTYPES = new Set([
	'canal',
	'lake',
	'ocean',
	'pond',
	'reservoir',
	'river',
	'spring',
	'stream',
	'water',
])

const SELECTED_PHYSICAL_WATER_CLASSES = new Set(['bay', 'ocean', 'sea', 'strait'])

const LOCALITY_DIVISION_SUBTYPES = new Set([
	'borough',
	'locality',
	'macrohood',
	'microhood',
	'neighborhood',
])

const ADMIN_IMPORTANCE: Readonly<Record<string, number>> = {
	country: 100,
	dependency: 95,
	macroregion: 90,
	region: 85,
	macrocounty: 78,
	county: 72,
	localadmin: 66,
	locality: 60,
	borough: 54,
	macrohood: 48,
	neighborhood: 42,
	microhood: 36,
}

const ROAD_IMPORTANCE: Readonly<Record<string, number>> = {
	motorway: 72,
	trunk: 68,
	primary: 64,
	secondary: 58,
	tertiary: 52,
	residential: 38,
	unclassified: 34,
	service: 28,
	path: 22,
	track: 20,
	unknown: 18,
}

const INFRASTRUCTURE_IMPORTANCE: Readonly<Record<string, number>> = {
	airport: 74,
	international_airport: 74,
	regional_airport: 72,
	municipal_airport: 70,
	military_airport: 68,
	private_airport: 62,
	seaplane_airport: 60,
	plant: 68,
	power_line: 62,
	substation: 60,
	power_tower: 48,
	power_pole: 36,
	railway_station: 64,
	subway_station: 62,
	bus_station: 58,
	ferry_terminal: 58,
	border_control: 56,
	dam: 54,
	bridge: 52,
	communication_tower: 50,
	railway_halt: 48,
	helipad: 46,
	airstrip: 44,
	bus_stop: 38,
	platform: 36,
}

const WATER_IMPORTANCE: Readonly<Record<string, number>> = {
	ocean: 80,
	sea: 76,
	river: 62,
	lake: 58,
	reservoir: 54,
	canal: 48,
	stream: 40,
	water: 36,
	pond: 32,
	spring: 30,
}

interface FeatureView {
	field(name: string): unknown
	geometry: unknown
	bbox: unknown
	id: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function requiredText(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new Error(`${field} must be a non-empty string`)
	}
	return value.trim()
}

function requiredOvertureRelease(value: unknown): string {
	const release = requiredText(value, 'Overture release')
	const date = OVERTURE_RELEASE_PATTERN.exec(release)?.[1]
	const timestamp = date ? Date.parse(`${date}T00:00:00.000Z`) : Number.NaN
	const canonicalDate = Number.isFinite(timestamp)
		? new Date(timestamp).toISOString().slice(0, 10)
		: undefined
	if (!date || canonicalDate !== date) {
		throw new Error('Overture release must use the dated YYYY-MM-DD.N format')
	}
	return release
}

function optionalText(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function decodeStructuredValue(value: unknown, field: string): unknown {
	if (typeof value !== 'string') return value
	const trimmed = value.trim()
	if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value
	try {
		return JSON.parse(trimmed)
	} catch (error) {
		throw new Error(`${field} contains invalid JSON`, { cause: error })
	}
}

function createFeatureView(value: unknown): FeatureView {
	if (!isRecord(value)) throw new Error('Overture record must be a JSON object')
	const isFeature = value.type === 'Feature'
	let properties: Record<string, unknown>
	if (!isFeature) {
		properties = value
	} else if (value.properties === null || value.properties === undefined) {
		properties = {}
	} else if (isRecord(value.properties)) {
		properties = value.properties
	} else {
		throw new Error('GeoJSON Feature properties must be an object or null')
	}
	return {
		field(name) {
			if (Object.hasOwn(properties, name)) return properties[name]
			// `Feature` is the GeoJSON wrapper type, not Overture's feature type.
			if (isFeature && name === 'type') return undefined
			return value[name]
		},
		geometry: value.geometry,
		bbox: value.bbox ?? properties.bbox,
		id: value.id ?? properties.id,
	}
}

function inferDescriptor(
	view: FeatureView,
	expectedType?: OvertureFeatureType,
): OvertureTypeDescriptor {
	if (expectedType) return OVERTURE_TYPE_DESCRIPTORS[expectedType]
	const theme = optionalText(view.field('theme'))
	const type = optionalText(view.field('type'))
	const descriptor = OVERTURE_FEATURE_TYPES.map(
		(candidate) => OVERTURE_TYPE_DESCRIPTORS[candidate],
	).find((candidate) => candidate.theme === theme && candidate.type === type)
	if (!descriptor) {
		throw new Error(
			'Cannot infer supported Overture feature type; supply division_area, place, ' +
				'segment, infrastructure, or water',
		)
	}
	return descriptor
}

function validateDescriptor(view: FeatureView, descriptor: OvertureTypeDescriptor): void {
	const actualTheme = optionalText(view.field('theme'))
	const actualType = optionalText(view.field('type'))
	if (actualTheme !== undefined && actualTheme !== descriptor.theme) {
		throw new Error(
			`Expected Overture theme ${descriptor.theme}, received ${actualTheme}`,
		)
	}
	if (actualType !== undefined && actualType !== descriptor.type) {
		throw new Error(`Expected Overture type ${descriptor.type}, received ${actualType}`)
	}
}

function isJsonValue(value: unknown): value is GeoCatalogJsonValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		isFiniteNumber(value)
	) {
		return true
	}
	if (Array.isArray(value)) return value.every(isJsonValue)
	return isRecord(value) && Object.values(value).every(isJsonValue)
}

function setJsonProperty(
	target: Record<string, GeoCatalogJsonValue>,
	key: string,
	value: unknown,
	sourceField = key,
): void {
	if (value === undefined || value === null) return
	const decoded = decodeStructuredValue(value, sourceField)
	if (!isJsonValue(decoded)) throw new Error(`${sourceField} is not valid JSON data`)
	target[key] = decoded
}

function visitCoordinates(
	value: unknown,
	depth: number,
	visit: (longitude: number, latitude: number) => void,
): boolean {
	if (depth === 0) {
		if (!Array.isArray(value)) return false
		if (value.length < 2 || !isFiniteNumber(value[0]) || !isFiniteNumber(value[1])) {
			return false
		}
		if (!value.every(isFiniteNumber)) return false
		const longitude = value[0]
		const latitude = value[1]
		if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) return false
		visit(longitude, latitude)
		return true
	}
	if (!Array.isArray(value) || value.length === 0) return false
	for (const child of value) {
		if (!visitCoordinates(child, depth - 1, visit)) return false
	}
	return true
}

function positionsAreEqual(left: unknown, right: unknown): boolean {
	if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
		return false
	}
	return left.every(
		(coordinate, index) => isFiniteNumber(coordinate) && coordinate === right[index],
	)
}

function isValidLineStringCoordinates(value: unknown): boolean {
	return Array.isArray(value) && value.length >= 2
}

function isValidLinearRing(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.length >= 4 &&
		positionsAreEqual(value[0], value[value.length - 1])
	)
}

function isValidPolygonCoordinates(value: unknown): boolean {
	return Array.isArray(value) && value.length > 0 && value.every(isValidLinearRing)
}

function hasValidGeometryCardinality(type: string, coordinates: unknown): boolean {
	switch (type) {
		case 'Point':
			return true
		case 'LineString':
			return isValidLineStringCoordinates(coordinates)
		case 'MultiLineString':
			return (
				Array.isArray(coordinates) &&
				coordinates.length > 0 &&
				coordinates.every(isValidLineStringCoordinates)
			)
		case 'Polygon':
			return isValidPolygonCoordinates(coordinates)
		case 'MultiPolygon':
			return (
				Array.isArray(coordinates) &&
				coordinates.length > 0 &&
				coordinates.every(isValidPolygonCoordinates)
			)
		default:
			return false
	}
}

function parseGeometry(
	value: unknown,
	descriptor: OvertureTypeDescriptor,
): { geometry: Geometry; computedBbox: GeoCatalogBbox } {
	if (!isRecord(value) || typeof value.type !== 'string') {
		throw new Error(`${descriptor.type}.geometry must be GeoJSON geometry`)
	}
	if (!descriptor.geometryTypes.includes(value.type as Geometry['type'])) {
		throw new Error(
			`${descriptor.type}.geometry must be ${descriptor.geometryTypes.join(' or ')}, ` +
				`received ${value.type}`,
		)
	}
	if (!hasValidGeometryCardinality(value.type, value.coordinates)) {
		throw new Error(
			`${descriptor.type}.geometry has invalid GeoJSON cardinality or ring closure`,
		)
	}
	let west = Number.POSITIVE_INFINITY
	let south = Number.POSITIVE_INFINITY
	let east = Number.NEGATIVE_INFINITY
	let north = Number.NEGATIVE_INFINITY
	const coordinateDepth =
		value.type === 'Point'
			? 0
			: value.type === 'LineString'
				? 1
				: value.type === 'Polygon'
					? 2
					: 3
	if (
		!visitCoordinates(value.coordinates, coordinateDepth, (longitude, latitude) => {
			west = Math.min(west, longitude)
			south = Math.min(south, latitude)
			east = Math.max(east, longitude)
			north = Math.max(north, latitude)
		})
	) {
		throw new Error(`${descriptor.type}.geometry contains invalid coordinates`)
	}
	return {
		geometry: value as unknown as Geometry,
		computedBbox: [west, south, east, north],
	}
}

function parseBbox(value: unknown, fallback: GeoCatalogBbox): GeoCatalogBbox {
	if (value === undefined || value === null) return fallback
	const decoded = decodeStructuredValue(value, 'bbox')
	let coordinates: unknown[] | undefined
	if (Array.isArray(decoded)) {
		coordinates =
			decoded.length === 6
				? [decoded[0], decoded[1], decoded[3], decoded[4]]
				: decoded
	} else if (isRecord(decoded)) {
		coordinates = [decoded.xmin, decoded.ymin, decoded.xmax, decoded.ymax]
	}
	if (!coordinates || coordinates.length !== 4 || !coordinates.every(isFiniteNumber)) {
		throw new Error(
			'bbox must contain 2D/3D GeoJSON bounds or {xmin, ymin, xmax, ymax}',
		)
	}
	const [west, south, east, north] = coordinates as [number, number, number, number]
	if (
		west < -180 ||
		west > 180 ||
		east < -180 ||
		east > 180 ||
		south < -90 ||
		south > 90 ||
		north < -90 ||
		north > 90 ||
		west > east ||
		south > north
	) {
		throw new Error('bbox contains invalid or reversed coordinates')
	}
	return [west, south, east, north]
}

function representativeCenter(
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): { longitude: number; latitude: number } {
	if (geometry.type === 'Point') {
		return { longitude: geometry.coordinates[0] ?? 0, latitude: geometry.coordinates[1] ?? 0 }
	}
	return { longitude: (bbox[0] + bbox[2]) / 2, latitude: (bbox[1] + bbox[3]) / 2 }
}

interface ExtractedNames {
	primary?: string
	all: string[]
}

function extractNames(value: unknown, directName: unknown): ExtractedNames {
	const decoded = decodeStructuredValue(value, 'names')
	const names = isRecord(decoded) ? decoded : {}
	const primary = optionalText(names.primary) ?? optionalText(directName)
	const collected: string[] = []
	if (primary) collected.push(primary)

	const common = decodeStructuredValue(names.common, 'names.common')
	if (isRecord(common)) {
		for (const language of Object.keys(common).sort(compareText)) {
			const name = optionalText(common[language])
			if (name) collected.push(name)
		}
	}

	const rules = decodeStructuredValue(names.rules, 'names.rules')
	if (Array.isArray(rules)) {
		for (const rule of rules) {
			if (!isRecord(rule)) continue
			const name = optionalText(rule.value)
			if (name) collected.push(name)
		}
	}

	return {
		primary,
		all: Array.from(new Set(collected)).sort(compareText),
	}
}

function routeNames(value: unknown): string[] {
	const decoded = decodeStructuredValue(value, 'routes')
	if (!Array.isArray(decoded)) return []
	const names: string[] = []
	for (const route of decoded) {
		if (!isRecord(route)) continue
		const directName = optionalText(route.name)
		if (directName) names.push(directName)
		const nestedNames = extractNames(route.names, undefined)
		names.push(...nestedNames.all)
		const reference = optionalText(route.ref)
		if (reference) names.push(reference)
	}
	return Array.from(new Set(names)).sort(compareText)
}

function humanize(value: string): string {
	const text = value.replace(/[_-]+/gu, ' ').trim()
	return text.length === 0 ? text : `${text[0]?.toUpperCase()}${text.slice(1)}`
}

function uniqueCategories(...values: Array<string | undefined>): string[] {
	return Array.from(new Set(values.filter((value): value is string => value !== undefined))).sort(
		compareText,
	)
}

function structuredTextList(value: unknown, field: string): string[] {
	if (value === undefined || value === null) return []
	const decoded = decodeStructuredValue(value, field)
	if (!Array.isArray(decoded)) throw new Error(`${field} must be an array of strings`)
	return decoded.map((candidate, index) => requiredText(candidate, `${field}[${index}]`))
}

function normalizeCountryCode(value: unknown, field: string): string | undefined {
	if (value === undefined || value === null || value === '') return undefined
	const country = requiredText(value, field).toUpperCase()
	if (!/^[A-Z]{2}$/u.test(country)) throw new Error(`${field} must be an ISO alpha-2 code`)
	return country
}

function optionalAdminLevel(value: unknown, field: string): number | undefined {
	if (value === undefined || value === null) return undefined
	if (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 16) {
		throw new Error(`${field} must be an integer from 0 to 16`)
	}
	return value as number
}

function countryFromAddresses(value: unknown): string | undefined {
	const decoded = decodeStructuredValue(value, 'addresses')
	if (!Array.isArray(decoded)) return undefined
	for (const address of decoded) {
		if (!isRecord(address)) continue
		const country = normalizeCountryCode(address.country, 'addresses[].country')
		if (country) return country
	}
	return undefined
}

function countryFromSourceTags(value: unknown): string | undefined {
	const decoded = decodeStructuredValue(value, 'source_tags')
	if (!isRecord(decoded)) return undefined
	const country = optionalText(decoded['addr:country'])?.toUpperCase()
	return country && /^[A-Z]{2}$/u.test(country) ? country : undefined
}

function normalizeDivision(
	view: FeatureView,
	nativeId: string,
	release: string,
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): GeoCatalogEntry {
	const subtype = requiredText(view.field('subtype'), 'division_area.subtype')
	const names = extractNames(view.field('names'), view.field('name'))
	if (!names.primary) throw new Error('division_area.names.primary is required')
	const properties: Record<string, GeoCatalogJsonValue> = {
		overtureTheme: 'divisions',
		overtureType: 'division_area',
		subtype,
	}
	setJsonProperty(properties, 'version', view.field('version'))
	setJsonProperty(properties, 'sources', view.field('sources'))
	setJsonProperty(properties, 'class', view.field('class'))
	setJsonProperty(properties, 'divisionId', view.field('division_id'), 'division_id')
	setJsonProperty(properties, 'region', view.field('region'))
	setJsonProperty(properties, 'adminLevel', view.field('admin_level'), 'admin_level')
	setJsonProperty(properties, 'isLand', view.field('is_land'), 'is_land')
	setJsonProperty(properties, 'isTerritorial', view.field('is_territorial'), 'is_territorial')
	const kind: GeoCatalogKind = LOCALITY_DIVISION_SUBTYPES.has(subtype) ? 'locality' : 'admin'
	const countryCode = normalizeCountryCode(view.field('country'), 'division_area.country')
	const adminLevel = optionalAdminLevel(
		view.field('admin_level'),
		'division_area.admin_level',
	)
	return {
		id: `overture:divisions:division_area:${nativeId}`,
		kind,
		name: names.primary,
		aliases: names.all.filter((name) => name !== names.primary),
		categories: uniqueCategories(subtype),
		...(countryCode ? { countryCode } : {}),
		...(adminLevel !== undefined ? { adminLevel } : {}),
		bbox,
		center: representativeCenter(geometry, bbox),
		importance: ADMIN_IMPORTANCE[subtype] ?? (kind === 'admin' ? 60 : 40),
		source: { name: OVERTURE_SOURCE_NAME, release, recordId: nativeId },
		properties,
		geometry,
	}
}

function normalizePlace(
	view: FeatureView,
	nativeId: string,
	release: string,
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): GeoCatalogEntry {
	const names = extractNames(view.field('names'), view.field('name'))
	const taxonomy = decodeStructuredValue(view.field('taxonomy'), 'taxonomy')
	const categories = decodeStructuredValue(view.field('categories'), 'categories')
	const taxonomyPrimary = isRecord(taxonomy) ? optionalText(taxonomy.primary) : undefined
	const categoryPrimary = isRecord(categories) ? optionalText(categories.primary) : undefined
	const taxonomyHierarchy = isRecord(taxonomy)
		? structuredTextList(taxonomy.hierarchy, 'taxonomy.hierarchy')
		: []
	const taxonomyAlternates = isRecord(taxonomy)
		? structuredTextList(taxonomy.alternates, 'taxonomy.alternates')
		: []
	const categoryAlternates = isRecord(categories)
		? structuredTextList(categories.alternate, 'categories.alternate')
		: []
	const basicCategory = optionalText(view.field('basic_category'))
	const fallbackCategory = basicCategory ?? taxonomyPrimary ?? categoryPrimary
	const name = names.primary ?? (fallbackCategory ? humanize(fallbackCategory) : 'Unnamed place')
	const confidenceValue = view.field('confidence')
	if (
		confidenceValue !== undefined &&
		confidenceValue !== null &&
		(!isFiniteNumber(confidenceValue) || confidenceValue < 0 || confidenceValue > 1)
	) {
		throw new Error('place.confidence must be a number from 0 to 1')
	}
	const confidence = isFiniteNumber(confidenceValue) ? confidenceValue : 0.5
	const normalizedCategories = uniqueCategories(
		basicCategory,
		taxonomyPrimary,
		categoryPrimary,
		...taxonomyHierarchy,
		...taxonomyAlternates,
		...categoryAlternates,
	)
	const properties: Record<string, GeoCatalogJsonValue> = {
		overtureTheme: 'places',
		overtureType: 'place',
	}
	setJsonProperty(properties, 'version', view.field('version'))
	setJsonProperty(properties, 'sources', view.field('sources'))
	setJsonProperty(properties, 'operatingStatus', view.field('operating_status'), 'operating_status')
	setJsonProperty(properties, 'basicCategory', view.field('basic_category'), 'basic_category')
	setJsonProperty(properties, 'taxonomy', taxonomy)
	setJsonProperty(properties, 'categories', categories)
	setJsonProperty(properties, 'confidence', confidenceValue)
	setJsonProperty(properties, 'addresses', view.field('addresses'))
	setJsonProperty(properties, 'websites', view.field('websites'))
	setJsonProperty(properties, 'phones', view.field('phones'))
	setJsonProperty(properties, 'brand', view.field('brand'))
	const directCountry = normalizeCountryCode(view.field('country'), 'place.country')
	const countryCode = directCountry ?? countryFromAddresses(view.field('addresses'))
	const isClosed = view.field('operating_status') === 'permanently_closed'
	return {
		id: `overture:places:place:${nativeId}`,
		kind: 'place',
		name,
		aliases: names.all.filter((candidate) => candidate !== name),
		categories: normalizedCategories.length > 0 ? normalizedCategories : ['place'],
		...(countryCode ? { countryCode } : {}),
		bbox,
		center: representativeCenter(geometry, bbox),
		importance: isClosed ? 5 : Math.round((30 + confidence * 40) * 1000) / 1000,
		source: { name: OVERTURE_SOURCE_NAME, release, recordId: nativeId },
		properties,
		geometry,
	}
}

function normalizeSegment(
	view: FeatureView,
	nativeId: string,
	release: string,
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): GeoCatalogEntry {
	const subtype = requiredText(view.field('subtype'), 'segment.subtype')
	let kind: GeoCatalogKind
	switch (subtype) {
		case 'road':
			kind = 'road'
			break
		case 'rail':
			kind = 'rail'
			break
		case 'water':
			kind = 'waterway'
			break
		default:
			throw new Error(`Unsupported transportation segment subtype ${subtype}`)
	}
	const classification = optionalText(view.field('class'))
	const names = extractNames(view.field('names'), view.field('name'))
	const routes = routeNames(view.field('routes'))
	const name =
		names.primary ??
		routes[0] ??
		(classification
			? humanize(classification)
			: subtype === 'water'
				? 'Unnamed water route'
				: `Unnamed ${subtype}`)
	const aliases = Array.from(new Set([...names.all, ...routes]))
		.filter((candidate) => candidate !== name)
		.sort(compareText)
	const properties: Record<string, GeoCatalogJsonValue> = {
		overtureTheme: 'transportation',
		overtureType: 'segment',
		subtype,
	}
	setJsonProperty(properties, 'version', view.field('version'))
	setJsonProperty(properties, 'sources', view.field('sources'))
	setJsonProperty(properties, 'class', view.field('class'))
	setJsonProperty(properties, 'subclass', view.field('subclass'))
	setJsonProperty(properties, 'names', view.field('names'))
	setJsonProperty(properties, 'nativeName', view.field('name'), 'name')
	setJsonProperty(properties, 'routes', view.field('routes'))
	setJsonProperty(properties, 'connectors', view.field('connectors'))
	setJsonProperty(properties, 'roadFlags', view.field('road_flags'), 'road_flags')
	setJsonProperty(properties, 'railFlags', view.field('rail_flags'), 'rail_flags')
	setJsonProperty(properties, 'roadSurface', view.field('road_surface'), 'road_surface')
	setJsonProperty(
		properties,
		'accessRestrictions',
		view.field('access_restrictions'),
		'access_restrictions',
	)
	setJsonProperty(properties, 'speedLimits', view.field('speed_limits'), 'speed_limits')
	const countryCode = normalizeCountryCode(view.field('country'), 'segment.country')
	const importance =
		kind === 'road'
			? ROAD_IMPORTANCE[classification ?? ''] ?? 30
			: kind === 'rail'
				? 56
				: 46
	return {
		id: `overture:transportation:segment:${nativeId}`,
		kind,
		name,
		aliases,
		categories: uniqueCategories(classification, subtype),
		...(countryCode ? { countryCode } : {}),
		bbox,
		center: representativeCenter(geometry, bbox),
		importance,
		source: { name: OVERTURE_SOURCE_NAME, release, recordId: nativeId },
		properties,
		geometry,
	}
}

export function isSelectedOvertureInfrastructure(value: unknown): boolean {
	if (!isRecord(value)) return false
	const properties =
		value.type === 'Feature' && isRecord(value.properties) ? value.properties : value
	const classification = optionalText(properties.class)
	return classification !== undefined && SELECTED_OVERTURE_INFRASTRUCTURE_CLASSES.has(classification)
}

function normalizeInfrastructure(
	view: FeatureView,
	nativeId: string,
	release: string,
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): GeoCatalogEntry | null {
	const subtype = requiredText(view.field('subtype'), 'infrastructure.subtype')
	const classification = requiredText(view.field('class'), 'infrastructure.class')
	if (!SELECTED_OVERTURE_INFRASTRUCTURE_CLASSES.has(classification)) return null
	const names = extractNames(view.field('names'), view.field('name'))
	const name = names.primary ?? humanize(classification)
	const properties: Record<string, GeoCatalogJsonValue> = {
		overtureTheme: 'base',
		overtureType: 'infrastructure',
		subtype,
		class: classification,
	}
	setJsonProperty(properties, 'version', view.field('version'))
	setJsonProperty(properties, 'sources', view.field('sources'))
	setJsonProperty(properties, 'height', view.field('height'))
	setJsonProperty(properties, 'surface', view.field('surface'))
	setJsonProperty(properties, 'level', view.field('level'))
	setJsonProperty(properties, 'wikidata', view.field('wikidata'))
	setJsonProperty(properties, 'sourceTags', view.field('source_tags'), 'source_tags')
	const directCountry = normalizeCountryCode(view.field('country'), 'infrastructure.country')
	const countryCode = directCountry ?? countryFromSourceTags(view.field('source_tags'))
	return {
		id: `overture:base:infrastructure:${nativeId}`,
		kind: 'infrastructure',
		name,
		aliases: names.all.filter((candidate) => candidate !== name),
		categories: uniqueCategories(classification, subtype),
		...(countryCode ? { countryCode } : {}),
		bbox,
		center: representativeCenter(geometry, bbox),
		importance: INFRASTRUCTURE_IMPORTANCE[classification] ?? 44,
		source: { name: OVERTURE_SOURCE_NAME, release, recordId: nativeId },
		properties,
		geometry,
	}
}

function isSelectedWaterView(view: FeatureView): boolean {
	const names = extractNames(view.field('names'), view.field('name'))
	if (!names.primary && names.all.length === 0) return false
	const subtype = optionalText(view.field('subtype'))
	const classification = optionalText(view.field('class'))
	if (subtype && SELECTED_OVERTURE_WATER_SUBTYPES.has(subtype)) return true
	if (classification && SELECTED_OVERTURE_WATER_SUBTYPES.has(classification)) return true
	return (
		subtype === 'physical' &&
		!!classification &&
		SELECTED_PHYSICAL_WATER_CLASSES.has(classification)
	)
}

export function isSelectedOvertureWater(value: unknown): boolean {
	try {
		return isSelectedWaterView(createFeatureView(value))
	} catch {
		return false
	}
}

function normalizeWater(
	view: FeatureView,
	nativeId: string,
	release: string,
	geometry: Geometry,
	bbox: GeoCatalogBbox,
): GeoCatalogEntry | null {
	if (!isSelectedWaterView(view)) return null
	const subtype = optionalText(view.field('subtype'))
	const classification = optionalText(view.field('class'))
	const names = extractNames(view.field('names'), view.field('name'))
	const name = names.primary ?? names.all[0]
	if (!name) return null
	const properties: Record<string, GeoCatalogJsonValue> = {
		overtureTheme: 'base',
		overtureType: 'water',
	}
	setJsonProperty(properties, 'version', view.field('version'))
	setJsonProperty(properties, 'sources', view.field('sources'))
	setJsonProperty(properties, 'subtype', subtype)
	setJsonProperty(properties, 'class', classification)
	setJsonProperty(properties, 'isIntermittent', view.field('is_intermittent'), 'is_intermittent')
	setJsonProperty(properties, 'isSalt', view.field('is_salt'), 'is_salt')
	setJsonProperty(properties, 'level', view.field('level'))
	setJsonProperty(properties, 'wikidata', view.field('wikidata'))
	setJsonProperty(properties, 'sourceTags', view.field('source_tags'), 'source_tags')
	const directCountry = normalizeCountryCode(view.field('country'), 'water.country')
	const countryCode = directCountry ?? countryFromSourceTags(view.field('source_tags'))
	const importanceKey = subtype ?? classification ?? ''
	return {
		id: `overture:base:water:${nativeId}`,
		kind: 'waterway',
		name,
		aliases: names.all.filter((candidate) => candidate !== name),
		categories: uniqueCategories(classification, subtype),
		...(countryCode ? { countryCode } : {}),
		bbox,
		center: representativeCenter(geometry, bbox),
		importance: WATER_IMPORTANCE[importanceKey] ?? 38,
		source: { name: OVERTURE_SOURCE_NAME, release, recordId: nativeId },
		properties,
		geometry,
	}
}

/** Normalize one Overture GeoJSON Feature (or flattened exported row). */
export function normalizeOvertureFeature(
	value: unknown,
	options: NormalizeOvertureFeatureOptions,
): GeoCatalogEntry | null {
	const release = requiredOvertureRelease(options.release)
	const view = createFeatureView(value)
	const descriptor = inferDescriptor(view, options.featureType)
	validateDescriptor(view, descriptor)

	// Reject broad base-layer records before decoding potentially large geometry.
	if (descriptor.type === 'infrastructure') {
		const classification = requiredText(view.field('class'), 'infrastructure.class')
		requiredText(view.field('subtype'), 'infrastructure.subtype')
		if (!SELECTED_OVERTURE_INFRASTRUCTURE_CLASSES.has(classification)) return null
	}
	if (descriptor.type === 'water' && !isSelectedWaterView(view)) return null

	const nativeId = requiredText(view.id, `${descriptor.type}.id`)
	const parsedGeometry = parseGeometry(view.geometry, descriptor)
	const bbox = parseBbox(view.bbox, parsedGeometry.computedBbox)

	switch (descriptor.type) {
		case 'division_area':
			return normalizeDivision(view, nativeId, release, parsedGeometry.geometry, bbox)
		case 'place':
			return normalizePlace(view, nativeId, release, parsedGeometry.geometry, bbox)
		case 'segment':
			return normalizeSegment(view, nativeId, release, parsedGeometry.geometry, bbox)
		case 'infrastructure':
			return normalizeInfrastructure(view, nativeId, release, parsedGeometry.geometry, bbox)
		case 'water':
			return normalizeWater(view, nativeId, release, parsedGeometry.geometry, bbox)
	}
}

const ODBL_THEME_FEATURE_TYPES = new Set<OvertureFeatureType>([
	'division_area',
	'segment',
	'infrastructure',
	'water',
])

const OVERTURE_ATTRIBUTION_URL = 'https://docs.overturemaps.org/attribution/'
const ODBL_LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/'
const FOURSQUARE_NOTICE_URL = 'https://opensource.foursquare.com/places-notice-txt/'
const APACHE_2_LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0.txt'
const APACHE_2_LICENSE = readFileSync(
	new URL('../../docs/legal/Apache-2.0.txt', import.meta.url),
	'utf8',
).trim()
const CDLA_PERMISSIVE_2_LICENSE_URL = 'https://cdla.dev/permissive-2-0/'
const CC0_LICENSE_URL = 'https://creativecommons.org/publicdomain/zero/1.0/'
const OVERTURE_FOURSQUARE_ATTRIBUTION =
	'Copyright 2024 Foursquare Labs, Inc. All rights reserved. Foursquare data was transformed to the Overture schema. Changed: 2026-03-18.'
const EARTHLY_PLACES_MODIFICATION_NOTICE =
	'Earthly modification notice: Overture Places records were filtered and normalized into GeoCatalog and editor fields; native record identifiers and per-feature source records were retained.'
const FOURSQUARE_NOTICE = `© 2026 Foursquare Labs, Inc. All rights reserved.
The Foursquare OS Places dataset (the “Data”) is licensed under the Apache License, Version 2.0 (the “License”). You may not use, modify, or distribute the Data except in compliance with the License.
As set forth more fully in the License, if you use, modify, or distribute the Data, you must:
– provide recipients with a copy of the License.
– if applicable, include prominent notices to the extent you’ve changed the Data.
– preserve attribution to Foursquare, including preserving the full content of this NOTICE.txt file.
To ensure appropriate attribution to Foursquare, we recommend the following:
– if using/distributing the Data in flat file form as-is or after making changes/modifications: include this NOTICE.txt file, which may be modified to include an additional notice of your changes/modifications, if any.
– if using/distributing the Data in API form as-is or after making changes/modifications: include a copy of the content from this NOTICE.txt file prominently in your developer documentation for such API, which may be modified to include an additional notice of your changes/modifications, if any.
You may obtain a copy of the License at: http://www.apache.org/licenses/LICENSE-2.0. Unless required by applicable law or agreed to in writing, the Data distributed under the License is distributed on an “AS IS” BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and limitations under the License.
We also encourage you to join our Placemaker community where you can contribute and provide suggestions to improve the accuracy of the Data for future releases for yourself and others.`

/**
 * Describe only the source families that can occur in the supplied inputs.
 * Exact per-feature provenance and licensing remain available in
 * `entry.properties.sources`.
 */
export function createOvertureSourceRelease(
	releaseInput: string,
	featureTypes: readonly OvertureFeatureType[],
): GeoCatalogSourceRelease {
	const release = requiredOvertureRelease(releaseInput)
	if (featureTypes.length === 0) {
		throw new Error('At least one Overture feature type is required for source metadata')
	}
	const featureTypeSet = new Set<OvertureFeatureType>()
	for (const featureType of featureTypes) {
		if (!OVERTURE_FEATURE_TYPES.includes(featureType)) {
			throw new Error(`Unsupported Overture feature type ${JSON.stringify(featureType)}`)
		}
		featureTypeSet.add(featureType)
	}

	const includesOdblThemes = Array.from(featureTypeSet).some((featureType) =>
		ODBL_THEME_FEATURE_TYPES.has(featureType),
	)
	const includesPlaces = featureTypeSet.has('place')
	const attribution = ['Overture Maps Foundation']
	const licenses: string[] = []
	const documents: NonNullable<GeoCatalogSourceRelease['documents']> = [
		{
			name: 'Overture attribution and licensing',
			url: OVERTURE_ATTRIBUTION_URL,
		},
	]
	if (includesOdblThemes) {
		attribution.push('© OpenStreetMap contributors, Overture Maps Foundation')
		licenses.push('ODbL-1.0')
		documents.push({ name: 'Open Database License 1.0', url: ODBL_LICENSE_URL })
	}
	if (includesPlaces) {
		attribution.push(
			OVERTURE_FOURSQUARE_ATTRIBUTION,
			'Data from AllThePlaces',
			EARTHLY_PLACES_MODIFICATION_NOTICE,
		)
		licenses.push('CDLA-Permissive-2.0', 'Apache-2.0', 'CC0-1.0')
		documents.push(
			{
				name: 'Foursquare OS Places NOTICE.txt',
				url: FOURSQUARE_NOTICE_URL,
				content: FOURSQUARE_NOTICE,
			},
			{
				name: 'Apache License 2.0',
				url: APACHE_2_LICENSE_URL,
				content: APACHE_2_LICENSE,
			},
			{ name: 'CDLA Permissive 2.0', url: CDLA_PERMISSIVE_2_LICENSE_URL },
			{ name: 'CC0 1.0', url: CC0_LICENSE_URL },
		)
	}
	attribution.push(
		'Per-feature provenance is retained in properties.sources; consult the release attribution manifest',
	)
	return {
		name: OVERTURE_SOURCE_NAME,
		release,
		attribution: attribution.join('; '),
		attributionUrl: OVERTURE_ATTRIBUTION_URL,
		license: `${licenses.join(', ')} (varies by theme and source)`,
		documents,
	}
}

export function parseOvertureInputSpec(value: string): OvertureInputSpec {
	const separator = value.indexOf('=')
	if (separator <= 0 || separator === value.length - 1) {
		throw new Error(
			`Invalid input spec ${JSON.stringify(value)}; expected <type>=<local-path>`,
		)
	}
	const typeValue = value.slice(0, separator).trim().toLowerCase()
	const featureType = INPUT_TYPE_ALIASES[typeValue]
	if (!featureType) {
		throw new Error(
			`Unsupported Overture input type ${JSON.stringify(typeValue)}; expected ` +
				'division_area, place, segment, infrastructure, or water',
		)
	}
	const path = value.slice(separator + 1).trim()
	if (!path || /^[a-z][a-z\d+.-]*:\/\//iu.test(path)) {
		throw new Error('Overture input must be an explicit local file path, not a URL')
	}
	return { featureType, path }
}

interface SequenceTextRecord {
	recordNumber: number
	text: string
}

async function* readSequenceTextRecords(
	path: string,
): AsyncGenerator<SequenceTextRecord> {
	const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 64 * 1024 })
	let buffer = ''
	let mode: 'unknown' | 'lines' | 'record-separator' = 'unknown'
	let recordNumber = 0
	let firstChunk = true

	const emit = (raw: string): SequenceTextRecord | undefined => {
		const text = raw.trim()
		if (!text) return undefined
		recordNumber += 1
		return { recordNumber, text }
	}

	for await (const chunk of stream) {
		let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
		if (firstChunk) {
			text = text.replace(/^\uFEFF/u, '')
			firstChunk = false
		}
		buffer += text

		if (mode === 'unknown') {
			const firstContent = buffer.search(/\S/u)
			if (firstContent >= 0) {
				if (buffer[firstContent] === '\u001e') {
					mode = 'record-separator'
					buffer = buffer.slice(firstContent + 1)
				} else {
					mode = 'lines'
				}
			}
		}

		const delimiter = mode === 'record-separator' ? '\u001e' : mode === 'lines' ? '\n' : ''
		if (delimiter) {
			let next = buffer.indexOf(delimiter)
			while (next >= 0) {
				const record = emit(buffer.slice(0, next))
				buffer = buffer.slice(next + 1)
				if (record) yield record
				next = buffer.indexOf(delimiter)
			}
		}
	}

	const finalRecord = emit(buffer)
	if (finalRecord) yield finalRecord
}

/**
 * Stream a local NDJSON or RFC 8142-style GeoJSON text sequence. Memory is
 * bounded by one record (plus the fixed 64 KiB read chunk), independent of
 * the total number of records in the source files.
 */
export async function* readOvertureGeoJsonSequence(
	input: OvertureInputSpec,
	options: ReadOvertureGeoJsonSequenceOptions,
): AsyncGenerator<GeoCatalogEntry> {
	for await (const record of readSequenceTextRecords(input.path)) {
		let parsed: unknown
		try {
			parsed = JSON.parse(record.text)
		} catch (error) {
			throw new Error(`${input.path}: record ${record.recordNumber} is not valid JSON`, {
				cause: error,
			})
		}
		let entry: GeoCatalogEntry | null
		try {
			entry = normalizeOvertureFeature(parsed, {
				release: options.release,
				featureType: input.featureType,
			})
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			throw new Error(`${input.path}: record ${record.recordNumber}: ${message}`, {
				cause: error,
			})
		}
		options.onRecord?.({
			featureType: input.featureType,
			recordNumber: record.recordNumber,
			included: entry !== null,
		})
		if (entry) yield entry
	}
}
