import type { Geometry, Position } from 'geojson'
import {
	GEO_CATALOG_KINDS,
	GeoCatalogError,
	type GeoCatalogBbox,
	type GeoCatalogEntry,
	type GeoCatalogJsonValue,
	type GeoCatalogKind,
	type GeoCatalogPoint,
	type GeoCatalogQueryRequest,
	type GeoCatalogSnapshotMetadata,
} from './types'

export const DEFAULT_QUERY_LIMIT = 20
const EARTH_RADIUS_METERS = 6_371_008.8
const SEARCH_SEPARATOR = '\u001f'

export interface PreparedGeoCatalogQuery {
	text: string | null
	textTokens: string[]
	ids: string[]
	kinds: GeoCatalogKind[]
	countryCode: string | null
	bbox: GeoCatalogBbox | null
	near: GeoCatalogPoint | null
	radiusMeters: number | null
	limit: number
	includeGeometry: boolean
}

export interface AdapterQueryResult {
	entries: GeoCatalogEntry[]
	hasMore: boolean
}

export interface GeoCatalogAdapter {
	readonly snapshot: GeoCatalogSnapshotMetadata
	query(request: PreparedGeoCatalogQuery): AdapterQueryResult
}

interface RankedEntry {
	entry: GeoCatalogEntry
	idRank: number
	textRank: number
	distanceMeters: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function isPosition(value: unknown): value is Position {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		value.every((coordinate) => isFiniteNumber(coordinate))
	)
}

function isNestedPositions(value: unknown, depth: number): boolean {
	if (depth === 0) return isPosition(value)
	return Array.isArray(value) && value.every((part) => isNestedPositions(part, depth - 1))
}

export function isGeometry(value: unknown): value is Geometry {
	if (!isRecord(value) || typeof value.type !== 'string') return false

	switch (value.type) {
		case 'Point':
			return isPosition(value.coordinates)
		case 'MultiPoint':
		case 'LineString':
			return isNestedPositions(value.coordinates, 1)
		case 'MultiLineString':
		case 'Polygon':
			return isNestedPositions(value.coordinates, 2)
		case 'MultiPolygon':
			return isNestedPositions(value.coordinates, 3)
		case 'GeometryCollection':
			return Array.isArray(value.geometries) && value.geometries.every(isGeometry)
		default:
			return false
	}
}

export function isJsonValue(value: unknown): value is GeoCatalogJsonValue {
	if (
		value === null ||
		typeof value === 'string' ||
		typeof value === 'boolean' ||
		isFiniteNumber(value)
	) {
		return true
	}
	if (Array.isArray(value)) return value.every(isJsonValue)
	if (!isRecord(value)) return false
	return Object.values(value).every(isJsonValue)
}

export function normalizeSearchText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.toLocaleLowerCase('en-US')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
		.replace(/\s+/g, ' ')
}

export function encodeNormalizedAliases(aliases: readonly string[]): string {
	const normalized = aliases.map(normalizeSearchText).filter(Boolean)
	return `${SEARCH_SEPARATOR}${normalized.join(SEARCH_SEPARATOR)}${SEARCH_SEPARATOR}`
}

function assertNonEmptyString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim().length === 0) {
		throw new GeoCatalogError('snapshot_invalid', `${field} must be a non-empty string`)
	}
	return value.trim()
}

function assertCoordinate(value: unknown, min: number, max: number, field: string): number {
	if (!isFiniteNumber(value) || value < min || value > max) {
		throw new GeoCatalogError(
			'snapshot_invalid',
			`${field} must be a finite number from ${min} to ${max}`,
		)
	}
	return value
}

function validateStoredBbox(value: unknown, field: string): GeoCatalogBbox {
	if (!Array.isArray(value) || value.length !== 4) {
		throw new GeoCatalogError('snapshot_invalid', `${field} must contain four coordinates`)
	}
	const west = assertCoordinate(value[0], -180, 180, `${field}[0]`)
	const south = assertCoordinate(value[1], -90, 90, `${field}[1]`)
	const east = assertCoordinate(value[2], -180, 180, `${field}[2]`)
	const north = assertCoordinate(value[3], -90, 90, `${field}[3]`)
	if (west > east || south > north) {
		throw new GeoCatalogError(
			'snapshot_invalid',
			`${field} must use [west, south, east, north] order`,
		)
	}
	return [west, south, east, north]
}

function validateQueryBbox(value: unknown): GeoCatalogBbox {
	if (!Array.isArray(value) || value.length !== 4) {
		throw new GeoCatalogError('invalid_request', 'bbox must contain four coordinates')
	}
	const coordinates = value as unknown[]
	const west = coordinates[0]
	const south = coordinates[1]
	const east = coordinates[2]
	const north = coordinates[3]
	if (
		!isFiniteNumber(west) ||
		west < -180 ||
		west > 180 ||
		!isFiniteNumber(east) ||
		east < -180 ||
		east > 180 ||
		!isFiniteNumber(south) ||
		south < -90 ||
		south > 90 ||
		!isFiniteNumber(north) ||
		north < -90 ||
		north > 90 ||
		south > north
	) {
		throw new GeoCatalogError(
			'invalid_request',
			'bbox must contain valid [west, south, east, north] coordinates',
		)
	}
	return [west, south, east, north]
}

function validateQueryPoint(value: unknown): GeoCatalogPoint {
	if (!isRecord(value)) {
		throw new GeoCatalogError('invalid_request', 'near must contain longitude and latitude')
	}
	const longitude = value.longitude
	const latitude = value.latitude
	if (
		!isFiniteNumber(longitude) ||
		longitude < -180 ||
		longitude > 180 ||
		!isFiniteNumber(latitude) ||
		latitude < -90 ||
		latitude > 90
	) {
		throw new GeoCatalogError('invalid_request', 'near contains invalid coordinates')
	}
	return { longitude, latitude }
}

export function validateSnapshotMetadata(value: unknown): GeoCatalogSnapshotMetadata {
	if (!isRecord(value)) {
		throw new GeoCatalogError('snapshot_invalid', 'Snapshot metadata is missing')
	}
	const id = assertNonEmptyString(value.id, 'snapshot.id')
	const createdAt = assertNonEmptyString(value.createdAt, 'snapshot.createdAt')
	if (!Number.isFinite(Date.parse(createdAt))) {
		throw new GeoCatalogError('snapshot_invalid', 'snapshot.createdAt must be an ISO date')
	}
	if (value.schemaVersion !== 1) {
		throw new GeoCatalogError('snapshot_invalid', 'Unsupported GeoCatalog schema version')
	}
	if (!Array.isArray(value.sources) || value.sources.length === 0) {
		throw new GeoCatalogError('snapshot_invalid', 'snapshot.sources must not be empty')
	}

	const seen = new Set<string>()
	const sources = value.sources.map((source, index) => {
		if (!isRecord(source)) {
			throw new GeoCatalogError('snapshot_invalid', `snapshot.sources[${index}] is invalid`)
		}
		const name = assertNonEmptyString(source.name, `snapshot.sources[${index}].name`)
		const release = assertNonEmptyString(
			source.release,
			`snapshot.sources[${index}].release`,
		)
		const key = `${name}\u0000${release}`
		if (seen.has(key)) {
			throw new GeoCatalogError('snapshot_invalid', `Duplicate snapshot source ${name}@${release}`)
		}
		seen.add(key)
		const attribution =
			source.attribution === undefined
				? undefined
				: assertNonEmptyString(
						source.attribution,
						`snapshot.sources[${index}].attribution`,
					)
		const license =
			source.license === undefined
				? undefined
				: assertNonEmptyString(source.license, `snapshot.sources[${index}].license`)
		return {
			name,
			release,
			...(attribution ? { attribution } : {}),
			...(license ? { license } : {}),
		}
	})

	return { id, createdAt, schemaVersion: 1, sources }
}

function isGeoCatalogKind(value: unknown): value is GeoCatalogKind {
	return typeof value === 'string' && GEO_CATALOG_KINDS.some((kind) => kind === value)
}

export function validateEntry(
	value: unknown,
	snapshot: GeoCatalogSnapshotMetadata,
): GeoCatalogEntry {
	if (!isRecord(value)) {
		throw new GeoCatalogError('snapshot_invalid', 'GeoCatalog entry must be an object')
	}
	const id = assertNonEmptyString(value.id, 'entry.id')
	if (!isGeoCatalogKind(value.kind)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id} has an unsupported kind`)
	}
	const name = assertNonEmptyString(value.name, `entry ${id}.name`)
	if (!Array.isArray(value.aliases) || !value.aliases.every((alias) => typeof alias === 'string')) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.aliases must be strings`)
	}
	const aliases = Array.from(
		new Set(value.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0)),
	)
	const bbox = validateStoredBbox(value.bbox, `entry ${id}.bbox`)
	if (!isRecord(value.center)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.center is invalid`)
	}
	const center = {
		longitude: assertCoordinate(value.center.longitude, -180, 180, `entry ${id}.center.longitude`),
		latitude: assertCoordinate(value.center.latitude, -90, 90, `entry ${id}.center.latitude`),
	}
	if (!isFiniteNumber(value.importance)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.importance must be finite`)
	}
	if (!isRecord(value.source)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.source is invalid`)
	}
	const sourceName = assertNonEmptyString(value.source.name, `entry ${id}.source.name`)
	const sourceRelease = assertNonEmptyString(value.source.release, `entry ${id}.source.release`)
	if (
		!snapshot.sources.some(
			(source) => source.name === sourceName && source.release === sourceRelease,
		)
	) {
		throw new GeoCatalogError(
			'snapshot_invalid',
			`entry ${id} references undeclared source ${sourceName}@${sourceRelease}`,
		)
	}
	const recordId =
		value.source.recordId === undefined
			? undefined
			: assertNonEmptyString(value.source.recordId, `entry ${id}.source.recordId`)
	if (!isRecord(value.properties) || !isJsonValue(value.properties)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.properties must be JSON data`)
	}
	if (value.geometry !== undefined && !isGeometry(value.geometry)) {
		throw new GeoCatalogError('snapshot_invalid', `entry ${id}.geometry is invalid GeoJSON`)
	}
	let countryCode: string | undefined
	if (value.countryCode !== undefined) {
		if (typeof value.countryCode !== 'string' || !/^[a-z]{2}$/i.test(value.countryCode.trim())) {
			throw new GeoCatalogError('snapshot_invalid', `entry ${id}.countryCode is invalid`)
		}
		countryCode = value.countryCode.trim().toUpperCase()
	}

	return {
		id,
		kind: value.kind,
		name,
		aliases,
		...(countryCode ? { countryCode } : {}),
		bbox,
		center,
		importance: value.importance,
		source: {
			name: sourceName,
			release: sourceRelease,
			...(recordId ? { recordId } : {}),
		},
		properties: structuredClone(value.properties),
		...(value.geometry ? { geometry: structuredClone(value.geometry) } : {}),
	}
}

export function prepareQuery(request: GeoCatalogQueryRequest): PreparedGeoCatalogQuery {
	if (!isRecord(request)) {
		throw new GeoCatalogError('invalid_request', 'GeoCatalog query must be an object')
	}

	let text: string | null = null
	let textTokens: string[] = []
	if (request.text !== undefined) {
		if (typeof request.text !== 'string' || request.text.trim().length === 0) {
			throw new GeoCatalogError('invalid_request', 'text must be a non-empty string')
		}
		text = normalizeSearchText(request.text)
		if (text.length === 0) {
			throw new GeoCatalogError(
				'invalid_request',
				'text must contain at least one letter or number',
			)
		}
		textTokens = text.split(' ').filter(Boolean)
	}

	let ids: string[] = []
	if (request.ids !== undefined) {
		if (!Array.isArray(request.ids) || !request.ids.every((id) => typeof id === 'string')) {
			throw new GeoCatalogError('invalid_request', 'ids must be an array of strings')
		}
		ids = Array.from(new Set(request.ids.map((id) => id.trim()).filter(Boolean)))
		if (ids.length === 0) {
			throw new GeoCatalogError('invalid_request', 'ids must not be empty')
		}
	}

	let kinds: GeoCatalogKind[] = []
	if (request.kinds !== undefined) {
		if (!Array.isArray(request.kinds) || !request.kinds.every(isGeoCatalogKind)) {
			throw new GeoCatalogError('invalid_request', 'kinds contains an unsupported kind')
		}
		kinds = Array.from(new Set(request.kinds))
		if (kinds.length === 0) {
			throw new GeoCatalogError('invalid_request', 'kinds must not be empty')
		}
	}

	let countryCode: string | null = null
	if (request.countryCode !== undefined) {
		if (typeof request.countryCode !== 'string' || !/^[a-z]{2}$/i.test(request.countryCode.trim())) {
			throw new GeoCatalogError('invalid_request', 'countryCode must be an ISO alpha-2 code')
		}
		countryCode = request.countryCode.trim().toUpperCase()
	}

	const bbox = request.bbox === undefined ? null : validateQueryBbox(request.bbox)
	const near = request.near === undefined ? null : validateQueryPoint(request.near)
	let radiusMeters: number | null = null
	if (request.radiusMeters !== undefined) {
		if (!isFiniteNumber(request.radiusMeters) || request.radiusMeters <= 0) {
			throw new GeoCatalogError('invalid_request', 'radiusMeters must be a positive number')
		}
		radiusMeters = request.radiusMeters
	}
	if ((near === null) !== (radiusMeters === null)) {
		throw new GeoCatalogError(
			'invalid_request',
			'near and radiusMeters must be supplied together',
		)
	}

	let limit = DEFAULT_QUERY_LIMIT
	if (request.limit !== undefined) {
		if (
			!isFiniteNumber(request.limit) ||
			!Number.isSafeInteger(request.limit) ||
			request.limit <= 0
		) {
			throw new GeoCatalogError('invalid_request', 'limit must be a positive integer')
		}
		limit = request.limit
	}
	let includeGeometry = false
	if (request.includeGeometry !== undefined) {
		if (typeof request.includeGeometry !== 'boolean') {
			throw new GeoCatalogError('invalid_request', 'includeGeometry must be a boolean')
		}
		includeGeometry = request.includeGeometry
	}

	return {
		text,
		textTokens,
		ids,
		kinds,
		countryCode,
		bbox,
		near,
		radiusMeters,
		limit,
		includeGeometry,
	}
}

function longitudeRanges(bbox: GeoCatalogBbox): Array<readonly [number, number]> {
	return bbox[0] <= bbox[2]
		? [[bbox[0], bbox[2]]]
		: [
				[bbox[0], 180],
				[-180, bbox[2]],
			]
}

export function bboxIntersects(left: GeoCatalogBbox, right: GeoCatalogBbox): boolean {
	if (left[1] > right[3] || left[3] < right[1]) return false
	return longitudeRanges(left).some(([leftWest, leftEast]) =>
		longitudeRanges(right).some(
			([rightWest, rightEast]) => leftWest <= rightEast && leftEast >= rightWest,
		),
	)
}

function toRadians(value: number): number {
	return (value * Math.PI) / 180
}

export function distanceMeters(left: GeoCatalogPoint, right: GeoCatalogPoint): number {
	const latitudeDelta = toRadians(right.latitude - left.latitude)
	const longitudeDelta = toRadians(right.longitude - left.longitude)
	const leftLatitude = toRadians(left.latitude)
	const rightLatitude = toRadians(right.latitude)
	const haversine =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitudeDelta / 2) ** 2
	return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(haversine)))
}

function textWords(entry: GeoCatalogEntry): string[] {
	return [entry.name, ...entry.aliases]
		.map(normalizeSearchText)
		.join(' ')
		.split(' ')
		.filter(Boolean)
}

function getTextRank(entry: GeoCatalogEntry, request: PreparedGeoCatalogQuery): number {
	if (request.text === null) return 0
	const normalizedName = normalizeSearchText(entry.name)
	if (normalizedName === request.text) return 0
	if (entry.aliases.some((alias) => normalizeSearchText(alias) === request.text)) return 1
	if (normalizedName.startsWith(request.text)) return 2
	return 3
}

function rankEntry(
	entry: GeoCatalogEntry,
	request: PreparedGeoCatalogQuery,
): RankedEntry | null {
	const idRank = request.ids.length === 0 ? 0 : request.ids.indexOf(entry.id)
	if (idRank < 0) return null
	if (request.kinds.length > 0 && !request.kinds.includes(entry.kind)) return null
	if (request.countryCode !== null && entry.countryCode !== request.countryCode) return null
	if (request.bbox !== null && !bboxIntersects(entry.bbox, request.bbox)) return null

	if (request.textTokens.length > 0) {
		const words = textWords(entry)
		if (!request.textTokens.every((token) => words.some((word) => word.startsWith(token)))) {
			return null
		}
	}

	const distance = request.near === null ? 0 : distanceMeters(request.near, entry.center)
	if (request.radiusMeters !== null && distance > request.radiusMeters) return null

	return {
		entry,
		idRank,
		textRank: getTextRank(entry, request),
		distanceMeters: distance,
	}
}

function compareStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function compareRankedEntries(
	left: RankedEntry,
	right: RankedEntry,
	request: PreparedGeoCatalogQuery,
): number {
	if (request.ids.length > 0 && left.idRank !== right.idRank) return left.idRank - right.idRank
	if (request.text !== null && left.textRank !== right.textRank) {
		return left.textRank - right.textRank
	}
	if (request.near !== null && left.distanceMeters !== right.distanceMeters) {
		return left.distanceMeters - right.distanceMeters
	}
	if (left.entry.importance !== right.entry.importance) {
		return right.entry.importance - left.entry.importance
	}
	const nameOrder = compareStrings(
		normalizeSearchText(left.entry.name),
		normalizeSearchText(right.entry.name),
	)
	return nameOrder !== 0 ? nameOrder : compareStrings(left.entry.id, right.entry.id)
}

export function queryEntries(
	entries: readonly GeoCatalogEntry[],
	request: PreparedGeoCatalogQuery,
): AdapterQueryResult {
	const ranked = entries
		.map((entry) => rankEntry(entry, request))
		.filter((entry): entry is RankedEntry => entry !== null)
		.sort((left, right) => compareRankedEntries(left, right, request))
	const hasMore = ranked.length > request.limit
	return {
		entries: ranked.slice(0, request.limit).map(({ entry }) => entry),
		hasMore,
	}
}

export function cloneEntry(entry: GeoCatalogEntry, includeGeometry: boolean): GeoCatalogEntry {
	return {
		id: entry.id,
		kind: entry.kind,
		name: entry.name,
		aliases: [...entry.aliases],
		...(entry.countryCode ? { countryCode: entry.countryCode } : {}),
		bbox: [entry.bbox[0], entry.bbox[1], entry.bbox[2], entry.bbox[3]],
		center: { ...entry.center },
		importance: entry.importance,
		source: { ...entry.source },
		properties: structuredClone(entry.properties),
		...(includeGeometry && entry.geometry
			? { geometry: structuredClone(entry.geometry) }
			: {}),
	}
}

export function parseJson(value: string, field: string): unknown {
	try {
		return JSON.parse(value) as unknown
	} catch (error) {
		throw new GeoCatalogError('snapshot_invalid', `${field} contains invalid JSON`, { cause: error })
	}
}
