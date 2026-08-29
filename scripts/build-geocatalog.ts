#!/usr/bin/env bun

/**
 * Build an immutable Earthly GeoCatalog SQLite snapshot from local,
 * pre-exported Overture GeoJSONSeq/NDJSON files. This command never downloads
 * data and requires an explicit dated Overture release.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdtemp, rmdir, stat, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Database, type Statement } from 'bun:sqlite'
import {
	GEO_CATALOG_KINDS,
	type GeoCatalogBbox,
	type GeoCatalogEntry,
	type GeoCatalogJsonValue,
	type GeoCatalogKind,
	type GeoCatalogSnapshotMetadata,
	type GeoCatalogSnapshotSpatialCoverage,
	writeSqliteGeoCatalogSnapshot,
} from '../contextvm/geocatalog/index'
import {
	createOvertureSourceRelease,
	OVERTURE_SOURCE_NAME,
	type OvertureFeatureType,
	type OvertureInputSpec,
	parseOvertureInputSpec,
	readOvertureGeoJsonSequence,
} from '../contextvm/geocatalog/overture'

export interface BuildGeoCatalogOptions {
	release: string
	snapshotId: string
	output: string
	inputs: OvertureInputSpec[]
	createdAt?: string
	/** Declared source extract footprint. Omit only for legacy/unknown-coverage builds. */
	coverage?: GeoCatalogSnapshotSpatialCoverage
	/** Keep source line fragments queryable, or use them only to assemble derived corridors. */
	corridorSourceFragments?: 'retain' | 'staging-only'
	/** Test/embedding seam; the CLI always uses the private OS temporary directory. */
	stagingDirectoryRoot?: string
}

export interface BuildGeoCatalogResult {
	snapshot: GeoCatalogSnapshotMetadata
	output: string
	outputBytes: number
	inputFiles: number
	recordsRead: number
	entriesWritten: number
	sourceFragmentsStagedOnly: number
	corridorsWritten: number
	corridorAssembly: {
		components: number
		paths: number
		stitchedJoins: number
		repeatedSegmentJoinsPrevented: number
		duplicateGeometryMembers: number
		branchPoints: number
		corridorsWithGaps: number
	}
	recordsSkipped: number
	byType: Record<
		OvertureFeatureType,
		{
			recordsRead: number
			entriesWritten: number
			sourceFragmentsStagedOnly: number
			recordsSkipped: number
		}
	>
}

export interface BuildGeoCatalogCliOptions extends BuildGeoCatalogOptions {
	format: 'text' | 'json'
}

const USAGE = `Build an immutable Earthly GeoCatalog snapshot from local Overture exports.

Usage:
  bun run scripts/build-geocatalog.ts \\
    --release <overture-release> \\
    --snapshot-id <snapshot-id> \\
    --output <catalog.sqlite> \\
    --input <type>=<local.geojsonseq> [--input <type>=<local.ndjson> ...]

Input types:
  division | division_area | place | segment | infrastructure | water

Named transport routes and connected base-water fragments with at least two
members also produce derived MultiLineString corridor entries. Exact shared
endpoints are oriented and stitched when unambiguous; branches and real gaps
remain separate parts. Source entries are retained unless the explicit
staging-only corridor-fragment policy is selected.

Options:
  --release <value>           Required Overture release, for example 2026-08-19.0
  --snapshot-id <value>       Required immutable snapshot identifier
  --output <path>             Required new SQLite path; existing paths are refused
  --input <type>=<path>       Repeatable local GeoJSONSeq/NDJSON input (plain or .gz)
  --created-at <ISO date>     Optional reproducible snapshot creation time
  --coverage <global|bbox>    Source footprint: global or west,south,east,north
  --corridor-source-fragments <retain|staging-only>
                              Persist source lines (default) or only derived corridors
  --format <text|json>        Result format (default: text)
  --help                      Show this help

Input specs may also be supplied positionally after the options.`

function requiredText(value: string, flag: string): string {
	const trimmed = value.trim()
	if (!trimmed) throw new Error(`${flag} requires a non-empty value`)
	return trimmed
}

function canonicalIsoDate(value: string): string {
	const timestamp = Date.parse(value)
	if (!Number.isFinite(timestamp)) throw new Error('--created-at must be a valid ISO date')
	return new Date(timestamp).toISOString()
}

function parseCorridorSourceFragmentPolicy(
	value: string,
): NonNullable<BuildGeoCatalogOptions['corridorSourceFragments']> {
	if (value !== 'retain' && value !== 'staging-only') {
		throw new Error('--corridor-source-fragments must be retain or staging-only')
	}
	return value
}

function parseCoverage(value: string): GeoCatalogSnapshotSpatialCoverage {
	const text = requiredText(value, '--coverage')
	if (text === 'global') return { scope: 'global' }
	const coordinates = text.split(',').map((coordinate) => Number(coordinate.trim()))
	if (coordinates.length !== 4 || coordinates.some((coordinate) => !Number.isFinite(coordinate))) {
		throw new Error('--coverage must be global or west,south,east,north')
	}
	const [west, south, east, north] = coordinates as GeoCatalogBbox
	if (
		west < -180 ||
		west > 180 ||
		east < -180 ||
		east > 180 ||
		south < -90 ||
		south > 90 ||
		north < -90 ||
		north > 90 ||
		south > north
	) {
		throw new Error('--coverage contains invalid WGS84 bounds')
	}
	if (west > east) {
		throw new Error(
			'--coverage west must be less than or equal to east; wrapped antimeridian bounds are not supported',
		)
	}
	return { scope: 'bbox', bbox: [west, south, east, north] }
}

const INPUT_CATALOG_KINDS: Readonly<Record<OvertureFeatureType, readonly GeoCatalogKind[]>> = {
	division: ['admin', 'locality'],
	division_area: ['admin', 'locality'],
	place: ['place'],
	segment: ['road', 'rail', 'waterway'],
	infrastructure: ['infrastructure'],
	water: ['waterway'],
}

function installedKinds(inputs: readonly OvertureInputSpec[]): GeoCatalogKind[] {
	const installed = new Set<GeoCatalogKind>()
	for (const input of inputs) {
		for (const kind of INPUT_CATALOG_KINDS[input.featureType]) installed.add(kind)
	}
	return GEO_CATALOG_KINDS.filter((kind) => installed.has(kind))
}

function createTypeCounts(): BuildGeoCatalogResult['byType'] {
	return {
		division: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
		division_area: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
		place: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
		segment: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
		infrastructure: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
		water: {
			recordsRead: 0,
			entriesWritten: 0,
			sourceFragmentsStagedOnly: 0,
			recordsSkipped: 0,
		},
	}
}

async function assertLocalInput(input: OvertureInputSpec): Promise<void> {
	let info
	try {
		info = await stat(input.path)
	} catch (error) {
		throw new Error(`Cannot read ${input.featureType} input at ${input.path}`, { cause: error })
	}
	if (!info.isFile()) {
		throw new Error(`${input.featureType} input is not a file: ${input.path}`)
	}
}

type JsonObject = { [key: string]: GeoCatalogJsonValue }
type CorridorScope = 'route' | 'connected-route' | 'connected-name'

interface CorridorMembership {
	corridorKey: string
	scope: CorridorScope
	identity: JsonObject
	displayName: string
	aliases: string[]
	coordinates: number[][]
	connectionKeys: string[]
	subtype: 'road' | 'rail' | 'water'
}

interface CorridorSourceFragment {
	featureType: 'segment' | 'water'
	subtype: 'road' | 'rail' | 'water'
}

interface StagedMemberRow {
	corridorKey: string
	scope: CorridorScope
	identityJson: string
	memberId: string
	kind: GeoCatalogKind
	displayName: string
	aliasesJson: string
	categoriesJson: string
	countryCode: string | null
	west: number
	south: number
	east: number
	north: number
	importance: number
	coordinatesJson: string
}

interface CorridorKeyRow {
	corridorKey: string
	scope: CorridorScope
}

interface MemberIdRow {
	memberId: string
}

interface ParsedCorridorMember {
	memberId: string
	coordinates: number[][]
}

interface AssembledCorridorPath {
	memberIds: string[]
	coordinates: number[][]
}

interface AssembledCorridorGeometry {
	coordinates: number[][][]
	componentCount: number
	pathCount: number
	stitchedJoinCount: number
	repeatedSegmentJoinCount: number
	branchPointCount: number
	duplicateGeometryMemberCount: number
}

function jsonObject(value: GeoCatalogJsonValue | undefined): JsonObject | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? value
		: undefined
}

function jsonText(value: GeoCatalogJsonValue | undefined): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function canonicalCorridorText(value: string): string {
	return value.normalize('NFKC').trim().toLocaleLowerCase('und').replace(/\s+/gu, ' ')
}

const GENERIC_WATER_NAMES = new Set([
	'brook',
	'canal',
	'creek',
	'ditch',
	'drain',
	'khola',
	'nadi',
	'nadī',
	'river',
	'rivière',
	'stream',
	'नदी',
])

/**
 * Normalize display variants without transliterating across scripts. Common-name
 * aliases provide that bridge when upstream has one; punctuation and spacing do
 * not need to match byte-for-byte.
 */
function canonicalWaterIdentityText(value: string): string {
	return value
		.normalize('NFKC')
		.trim()
		.toLocaleLowerCase('und')
		.replace(/[\p{P}\p{S}]+/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
}

function waterNameIdentityTokens(entry: GeoCatalogEntry, nativeName: string): string[] {
	const tokens = new Set<string>()
	for (const candidate of [nativeName, entry.name, ...entry.aliases]) {
		const normalized = canonicalWaterIdentityText(candidate)
		if (!normalized || GENERIC_WATER_NAMES.has(normalized)) continue
		tokens.add(`name:${normalized}`)
		const words = normalized.split(' ')
		const suffix = words.at(-1)
		if (!suffix || !GENERIC_WATER_NAMES.has(suffix)) continue
		const stem = words.slice(0, -1).join(' ')
		if (stem && !GENERIC_WATER_NAMES.has(stem)) tokens.add(`name:${stem}`)
	}
	return Array.from(tokens).sort()
}

function upstreamSourceIdentityTokens(entry: GeoCatalogEntry): string[] {
	const tokens = new Set<string>()
	const addStrongIdentifier = (namespace: string, value: string | undefined): void => {
		if (!value) return
		const normalized = canonicalWaterIdentityText(value)
		if (normalized) tokens.add(`${namespace}:${normalized}`)
	}

	addStrongIdentifier('wikidata', jsonText(entry.properties.wikidata))
	const sourceTags = jsonObject(entry.properties.sourceTags)
	addStrongIdentifier('wikidata', jsonText(sourceTags?.wikidata))
	addStrongIdentifier('wikipedia', jsonText(sourceTags?.wikipedia))

	const sources = entry.properties.sources
	if (Array.isArray(sources)) {
		for (const sourceValue of sources) {
			const source = jsonObject(sourceValue)
			const recordId = jsonText(source?.record_id)?.replace(/@[^@]+$/u, '')
			if (!recordId) continue
			const provider =
				jsonText(source?.provider) ?? jsonText(source?.dataset) ?? 'unknown-provider'
			addStrongIdentifier(
				`source:${canonicalWaterIdentityText(provider)}`,
				recordId,
			)
		}
	}
	return Array.from(tokens).sort()
}

function identityScopedConnections(
	connectionKeys: readonly string[],
	identityTokens: readonly string[],
): string[] {
	const scoped: string[] = []
	for (const connectionKey of connectionKeys) {
		for (const identityToken of identityTokens) {
			scoped.push(`${connectionKey}\u0000${identityToken}`)
		}
	}
	return scoped.sort()
}

function sha256(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

function lineDistance(left: number[], right: number[]): number {
	const leftLongitude = (left[0] ?? 0) * (Math.PI / 180)
	const leftLatitude = (left[1] ?? 0) * (Math.PI / 180)
	const rightLongitude = (right[0] ?? 0) * (Math.PI / 180)
	const rightLatitude = (right[1] ?? 0) * (Math.PI / 180)
	const latitudeDelta = rightLatitude - leftLatitude
	const longitudeDelta = rightLongitude - leftLongitude
	const haversine =
		Math.sin(latitudeDelta / 2) ** 2 +
		Math.cos(leftLatitude) *
			Math.cos(rightLatitude) *
			Math.sin(longitudeDelta / 2) ** 2
	return 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
}

function interpolatePosition(left: number[], right: number[], ratio: number): number[] {
	return left.map((coordinate, index) => {
		const rightCoordinate = right[index]
		return rightCoordinate === undefined
			? coordinate
			: coordinate + (rightCoordinate - coordinate) * ratio
	})
}

function positionAtDistance(
	coordinates: number[][],
	cumulative: number[],
	distance: number,
): number[] | undefined {
	const first = coordinates[0]
	const last = coordinates[coordinates.length - 1]
	const total = cumulative[cumulative.length - 1]
	if (!first || !last || total === undefined) return undefined
	if (distance <= 0) return [...first]
	if (distance >= total) return [...last]
	for (let index = 1; index < coordinates.length; index += 1) {
		const previousDistance = cumulative[index - 1]
		const currentDistance = cumulative[index]
		const previous = coordinates[index - 1]
		const current = coordinates[index]
		if (
			previousDistance === undefined ||
			currentDistance === undefined ||
			!previous ||
			!current ||
			distance > currentDistance
		) {
			continue
		}
		const span = currentDistance - previousDistance
		return interpolatePosition(
			previous,
			current,
			span === 0 ? 0 : (distance - previousDistance) / span,
		)
	}
	return [...last]
}

function sliceLineString(
	coordinates: number[][],
	start: number,
	end: number,
): number[][] | undefined {
	if (start < 0 || end > 1 || start >= end || coordinates.length < 2) return undefined
	if (start === 0 && end === 1) return coordinates.map((position) => [...position])
	const cumulative = [0]
	for (let index = 1; index < coordinates.length; index += 1) {
		const previous = coordinates[index - 1]
		const current = coordinates[index]
		if (!previous || !current) return undefined
		cumulative.push((cumulative[index - 1] ?? 0) + lineDistance(previous, current))
	}
	const total = cumulative[cumulative.length - 1]
	if (total === undefined || total === 0) return undefined
	const startDistance = total * start
	const endDistance = total * end
	const first = positionAtDistance(coordinates, cumulative, startDistance)
	const last = positionAtDistance(coordinates, cumulative, endDistance)
	if (!first || !last) return undefined
	const sliced = [first]
	for (let index = 1; index < coordinates.length - 1; index += 1) {
		const distance = cumulative[index]
		const position = coordinates[index]
		if (
			distance !== undefined &&
			position &&
			distance > startDistance &&
			distance < endDistance
		) {
			sliced.push([...position])
		}
	}
	sliced.push(last)
	return sliced
}

function routeCoordinates(
	coordinates: number[][],
	route: JsonObject,
): { coordinates: number[][]; between?: [number, number] } | undefined {
	if (route.between === undefined || route.between === null) {
		return { coordinates: coordinates.map((position) => [...position]) }
	}
	if (
		!Array.isArray(route.between) ||
		route.between.length !== 2 ||
		typeof route.between[0] !== 'number' ||
		!Number.isFinite(route.between[0]) ||
		typeof route.between[1] !== 'number' ||
		!Number.isFinite(route.between[1])
	) {
		return undefined
	}
	const between: [number, number] = [route.between[0], route.between[1]]
	const sliced = sliceLineString(coordinates, between[0], between[1])
	return sliced ? { coordinates: sliced, between } : undefined
}

function lineBbox(coordinates: number[][]): GeoCatalogBbox {
	let west = Number.POSITIVE_INFINITY
	let south = Number.POSITIVE_INFINITY
	let east = Number.NEGATIVE_INFINITY
	let north = Number.NEGATIVE_INFINITY
	for (const position of coordinates) {
		const longitude = position[0]
		const latitude = position[1]
		if (longitude === undefined || latitude === undefined) continue
		west = Math.min(west, longitude)
		south = Math.min(south, latitude)
		east = Math.max(east, longitude)
		north = Math.max(north, latitude)
	}
	return [west, south, east, north]
}

function connectorKeys(
	entry: GeoCatalogEntry,
	coordinates: number[][],
	between?: [number, number],
): string[] {
	const keys = new Set<string>()
	const first = coordinates[0]
	const last = coordinates[coordinates.length - 1]
	if (first) keys.add(`position:${JSON.stringify(first)}`)
	if (last) keys.add(`position:${JSON.stringify(last)}`)
	const connectors = entry.properties.connectors
	if (Array.isArray(connectors)) {
		for (const connectorValue of connectors) {
			const connector = jsonObject(connectorValue)
			const connectorId = connector ? jsonText(connector.connector_id) : undefined
			if (!connectorId) continue
			const at = connector?.at
			if (
				between &&
				typeof at === 'number' &&
				(at < between[0] || at > between[1])
			) {
				continue
			}
			keys.add(`connector:${connectorId}`)
		}
	}
	return Array.from(keys).sort()
}

function corridorSourceFragment(entry: GeoCatalogEntry): CorridorSourceFragment | undefined {
	if (entry.geometry?.type !== 'LineString') return undefined
	const overtureTheme = jsonText(entry.properties.overtureTheme)
	const overtureType = jsonText(entry.properties.overtureType)
	if (overtureTheme === 'base' && overtureType === 'water') {
		return { featureType: 'water', subtype: 'water' }
	}
	if (overtureTheme !== 'transportation' || overtureType !== 'segment') return undefined
	const subtype = jsonText(entry.properties.subtype)
	return subtype === 'road' || subtype === 'rail' || subtype === 'water'
		? { featureType: 'segment', subtype }
		: undefined
}

function corridorMemberships(entry: GeoCatalogEntry): CorridorMembership[] {
	const sourceFragment = corridorSourceFragment(entry)
	if (!sourceFragment || entry.geometry?.type !== 'LineString') return []
	const isTransportationSegment = sourceFragment.featureType === 'segment'
	const isBaseWater = sourceFragment.featureType === 'water'
	const subtype = sourceFragment.subtype
	const baseCoordinates = entry.geometry.coordinates.map((position) => [...position])
	const memberships: CorridorMembership[] = []
	const seen = new Set<string>()
	const routes = entry.properties.routes
	if (isTransportationSegment && Array.isArray(routes)) {
		for (const routeValue of routes) {
			const route = jsonObject(routeValue)
			if (!route) continue
			const name = jsonText(route.name)
			const network = jsonText(route.network)
			const reference = jsonText(route.ref)
			const wikidata = jsonText(route.wikidata)
			const sliced = routeCoordinates(baseCoordinates, route)
			if (!sliced) continue

			let scope: CorridorScope
			let keyParts: string[]
			const identity: JsonObject = { type: 'route', subtype }
			if (wikidata) {
				scope = 'route'
				keyParts = ['route', subtype, 'wikidata', canonicalCorridorText(wikidata)]
				identity.wikidata = wikidata
			} else if (network && reference) {
				scope = 'route'
				keyParts = [
					'route',
					subtype,
					'network-ref',
					canonicalCorridorText(network),
					canonicalCorridorText(reference),
				]
				identity.network = network
				identity.ref = reference
			} else if (reference) {
				scope = 'connected-route'
				keyParts = [
					'route',
					subtype,
					'ref',
					entry.countryCode ?? '',
					canonicalCorridorText(reference),
				]
				identity.ref = reference
			} else if (name) {
				scope = 'connected-route'
				keyParts = [
					'route',
					subtype,
					'name',
					entry.countryCode ?? '',
					canonicalCorridorText(network ?? ''),
					canonicalCorridorText(name),
				]
				identity.name = name
				if (network) identity.network = network
			} else {
				continue
			}
			if (name) identity.name = name
			if (network) identity.network = network
			if (reference) identity.ref = reference
			const corridorKey = JSON.stringify(keyParts)
			if (seen.has(corridorKey)) continue
			seen.add(corridorKey)
			const networkReference =
				network && reference ? `${network} ${reference}` : reference ?? network
			const displayName = name ?? networkReference ?? wikidata
			if (!displayName) continue
			const aliases = Array.from(
				new Set(
					[
						entry.name,
						...entry.aliases,
						name,
						networkReference,
						reference,
					].filter((value): value is string => value !== undefined),
				),
			)
				.filter((value) => value !== displayName)
				.sort()
			memberships.push({
				corridorKey,
				scope,
				identity,
				displayName,
				aliases,
				coordinates: sliced.coordinates,
				connectionKeys: connectorKeys(entry, sliced.coordinates, sliced.between),
				subtype,
			})
		}
	}

	// Avoid producing a second, name-derived copy when the segment already has
	// an explicit route identity.
	if (memberships.length > 0) return memberships
	const nativeNames = jsonObject(entry.properties.names)
	const nativeName = isBaseWater
		? entry.name
		: jsonText(nativeNames?.primary) ?? jsonText(entry.properties.nativeName)
	if (!nativeName) return []
	const classification =
		jsonText(entry.properties.subtype) ?? jsonText(entry.properties.class)
	const wikidata = jsonText(entry.properties.wikidata)
	if (isBaseWater) {
		const identityTokens = Array.from(
			new Set([
				...waterNameIdentityTokens(entry, nativeName),
				...upstreamSourceIdentityTokens(entry),
			]),
		).sort()
		if (identityTokens.length === 0) return []
		const corridorKey = JSON.stringify([
			'base-water',
			subtype,
			canonicalCorridorText(classification ?? ''),
		])
		return [
			{
				corridorKey,
				scope: 'connected-name',
				identity: {
					type: 'connected-identity',
					subtype,
					sourceFeatureType: 'water',
					matchBasis: 'normalized-name-alias-or-source-identity',
					...(classification ? { class: classification } : {}),
				},
				displayName: nativeName,
				aliases: Array.from(new Set([entry.name, ...entry.aliases]))
					.filter((value) => value !== nativeName)
					.sort(),
				coordinates: baseCoordinates,
				connectionKeys: identityScopedConnections(
					connectorKeys(entry, baseCoordinates),
					identityTokens,
				),
				subtype,
			},
		]
	}
	const corridorKey = JSON.stringify([
		'name',
		subtype,
		entry.countryCode ?? '',
		canonicalCorridorText(classification ?? ''),
		canonicalCorridorText(nativeName),
	])
	return [
		{
			corridorKey,
			scope: 'connected-name',
			identity: {
				type: 'name',
				subtype,
				name: nativeName,
				...(wikidata ? { wikidata } : {}),
				...(classification ? { class: classification } : {}),
				...(entry.countryCode ? { countryCode: entry.countryCode } : {}),
			},
			displayName: nativeName,
			aliases: Array.from(new Set([entry.name, ...entry.aliases]))
				.filter((value) => value !== nativeName)
				.sort(),
			coordinates: baseCoordinates,
			connectionKeys: connectorKeys(entry, baseCoordinates),
			subtype,
		},
	]
}

function parseStagedJson(value: string, field: string): GeoCatalogJsonValue {
	let parsed: unknown
	try {
		parsed = JSON.parse(value)
	} catch (error) {
		throw new Error(`Corridor staging ${field} contains invalid JSON`, { cause: error })
	}
	return parsed as GeoCatalogJsonValue
}

function positionKey(position: number[]): string {
	return JSON.stringify(position)
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0
}

function reversedCoordinates(coordinates: readonly number[][]): number[][] {
	return coordinates.map((position) => [...position]).reverse()
}

function canonicalLineCoordinates(coordinates: readonly number[][]): {
	key: string
	coordinates: number[][]
} {
	const forward = coordinates.map((position) => [...position])
	const reversed = reversedCoordinates(coordinates)
	const forwardKey = JSON.stringify(forward)
	const reversedKey = JSON.stringify(reversed)
	return reversedKey < forwardKey
		? { key: reversedKey, coordinates: reversed }
		: { key: forwardKey, coordinates: forward }
}

interface CorridorAssemblyEdge {
	memberId: string
	coordinates: number[][]
	startKey: string
	endKey: string
}

function canonicalSegmentKey(start: number[], end: number[]): string {
	const startKey = positionKey(start)
	const endKey = positionKey(end)
	return startKey < endKey ? `${startKey}\u0000${endKey}` : `${endKey}\u0000${startKey}`
}

function lineSegmentKeys(coordinates: readonly number[][]): string[] {
	const keys: string[] = []
	for (let index = 1; index < coordinates.length; index += 1) {
		const start = coordinates[index - 1]
		const end = coordinates[index]
		if (!start || !end) throw new Error('Corridor member contains an invalid segment')
		keys.push(canonicalSegmentKey(start, end))
	}
	return keys
}

const CORRIDOR_MEMBER_ID_SAMPLE_LIMIT = 12

function assembleCorridorGeometry(members: readonly StagedMemberRow[]): AssembledCorridorGeometry {
	const parsedMembers: ParsedCorridorMember[] = members.map((member) => {
		const coordinates = parseStagedJson(member.coordinatesJson, 'coordinates')
		if (!Array.isArray(coordinates)) {
			throw new Error('Corridor staging coordinates must be an array')
		}
		return {
			memberId: member.memberId,
			coordinates: coordinates as number[][],
		}
	})
	parsedMembers.sort((left, right) => compareText(left.memberId, right.memberId))

	// Preserve every source member in provenance, but emit byte-identical reversed
	// duplicates only once in the derived geometry. The raw catalog entries remain
	// untouched and queryable by their own ids.
	const edgeByGeometry = new Map<string, CorridorAssemblyEdge>()
	let duplicateGeometryMemberCount = 0
	for (const member of parsedMembers) {
		const canonical = canonicalLineCoordinates(member.coordinates)
		const existing = edgeByGeometry.get(canonical.key)
		if (existing) {
			duplicateGeometryMemberCount += 1
			continue
		}
		const first = canonical.coordinates[0]
		const last = canonical.coordinates.at(-1)
		if (!first || !last) throw new Error('Corridor member must contain at least two positions')
		edgeByGeometry.set(canonical.key, {
			memberId: member.memberId,
			coordinates: canonical.coordinates,
			startKey: positionKey(first),
			endKey: positionKey(last),
		})
	}

	const edges = Array.from(edgeByGeometry.values()).sort((left, right) =>
		compareText(left.memberId, right.memberId),
	)
	const parent = new Map<string, string>()
	for (const edge of edges) parent.set(edge.memberId, edge.memberId)
	const find = (memberId: string): string => {
		let root = memberId
		while (parent.get(root) && parent.get(root) !== root) root = parent.get(root) as string
		let current = memberId
		while (current !== root) {
			const next = parent.get(current)
			parent.set(current, root)
			if (!next) break
			current = next
		}
		return root
	}
	const union = (left: string, right: string): void => {
		const leftRoot = find(left)
		const rightRoot = find(right)
		if (leftRoot === rightRoot) return
		if (leftRoot < rightRoot) parent.set(rightRoot, leftRoot)
		else parent.set(leftRoot, rightRoot)
	}
	const endpointOwner = new Map<string, string>()
	for (const edge of edges) {
		for (const endpoint of new Set([edge.startKey, edge.endKey])) {
			const owner = endpointOwner.get(endpoint)
			if (owner) union(owner, edge.memberId)
			else endpointOwner.set(endpoint, edge.memberId)
		}
	}

	const edgesByComponent = new Map<string, CorridorAssemblyEdge[]>()
	for (const edge of edges) {
		const root = find(edge.memberId)
		const componentEdges = edgesByComponent.get(root) ?? []
		componentEdges.push(edge)
		edgesByComponent.set(root, componentEdges)
	}
	const sortedComponentEdges = Array.from(edgesByComponent.values())
		.map((componentEdges) =>
			componentEdges.sort((left, right) => compareText(left.memberId, right.memberId)),
		)
		.sort((left, right) => {
			const leftId = left[0]?.memberId ?? ''
			const rightId = right[0]?.memberId ?? ''
			return compareText(leftId, rightId)
		})

	const paths: AssembledCorridorPath[] = []
	let stitchedJoinCount = 0
	let repeatedSegmentJoinCount = 0
	let branchPointCount = 0
	for (const componentEdges of sortedComponentEdges) {
		const incident = new Map<string, CorridorAssemblyEdge[]>()
		const degree = new Map<string, number>()
		const addIncident = (endpoint: string, edge: CorridorAssemblyEdge, contribution = 1): void => {
			const endpointEdges = incident.get(endpoint) ?? []
			endpointEdges.push(edge)
			incident.set(endpoint, endpointEdges)
			degree.set(endpoint, (degree.get(endpoint) ?? 0) + contribution)
		}
		for (const edge of componentEdges) {
			if (edge.startKey === edge.endKey) addIncident(edge.startKey, edge, 2)
			else {
				addIncident(edge.startKey, edge)
				addIncident(edge.endKey, edge)
			}
		}
		for (const endpointEdges of incident.values()) {
			endpointEdges.sort((left, right) => compareText(left.memberId, right.memberId))
		}

		const componentBranchPoints = Array.from(degree.values()).filter(
			(value) => value > 2,
		).length
		branchPointCount += componentBranchPoints
		const used = new Set<string>()
		const componentPaths: AssembledCorridorPath[] = []
		const walk = (initialEndpoint: string, initialEdge: CorridorAssemblyEdge): void => {
			let endpoint = initialEndpoint
			let edge: CorridorAssemblyEdge | undefined = initialEdge
			const memberIds: string[] = []
			const pathSegmentKeys = new Set<string>()
			let coordinates: number[][] = []
			while (edge && !used.has(edge.memberId)) {
				const oriented =
					edge.startKey === endpoint
						? edge.coordinates.map((position) => [...position])
						: reversedCoordinates(edge.coordinates)
				const segmentKeys = lineSegmentKeys(oriented)
				if (
					coordinates.length > 0 &&
					segmentKeys.some((segmentKey) => pathSegmentKeys.has(segmentKey))
				) {
					repeatedSegmentJoinCount += 1
					break
				}
				used.add(edge.memberId)
				if (coordinates.length === 0) coordinates = oriented
				else coordinates.push(...oriented.slice(1))
				for (const segmentKey of segmentKeys) pathSegmentKeys.add(segmentKey)
				memberIds.push(edge.memberId)
				endpoint = edge.startKey === endpoint ? edge.endKey : edge.startKey
				if ((degree.get(endpoint) ?? 0) !== 2) break
				const candidates = (incident.get(endpoint) ?? []).filter(
					(candidate) => !used.has(candidate.memberId),
				)
				if (candidates.length !== 1) break
				edge = candidates[0]
			}
			if (coordinates.length < 2) return
			const reversed = reversedCoordinates(coordinates)
			if (JSON.stringify(reversed) < JSON.stringify(coordinates)) {
				coordinates = reversed
				memberIds.reverse()
			}
			componentPaths.push({ memberIds, coordinates })
		}

		// Starting at every non-degree-two endpoint produces maximal, unambiguous
		// paths and deliberately stops at branches instead of choosing a direction.
		const endpoints = Array.from(incident.keys()).sort()
		for (const endpoint of endpoints) {
			if ((degree.get(endpoint) ?? 0) === 2) continue
			for (const edge of incident.get(endpoint) ?? []) {
				if (!used.has(edge.memberId)) walk(endpoint, edge)
			}
		}
		// Closed rings have no terminal endpoint. Seed each remaining ring from its
		// smallest member id and canonical endpoint so output is input-order stable.
		for (const edge of componentEdges) {
			if (used.has(edge.memberId)) continue
			walk(edge.startKey < edge.endKey ? edge.startKey : edge.endKey, edge)
		}
		componentPaths.sort((left, right) => {
			const coordinateOrder = compareText(
				JSON.stringify(left.coordinates),
				JSON.stringify(right.coordinates),
			)
			return (
				coordinateOrder || compareText(JSON.stringify(left.memberIds), JSON.stringify(right.memberIds))
			)
		})
		paths.push(...componentPaths)
		stitchedJoinCount += componentPaths.reduce(
			(total, path) => total + Math.max(0, path.memberIds.length - 1),
			0,
		)
	}

	return {
		coordinates: paths.map((path) => path.coordinates),
		componentCount: sortedComponentEdges.length,
		pathCount: paths.length,
		stitchedJoinCount,
		repeatedSegmentJoinCount,
		branchPointCount,
		duplicateGeometryMemberCount,
	}
}

function createCorridorEntry(
	corridorKey: string,
	scope: CorridorScope,
	members: StagedMemberRow[],
	release: string,
): GeoCatalogEntry | undefined {
	if (members.length < 2) return undefined
	const first = members[0]
	if (!first) return undefined
	const memberIds = members.map((member) => member.memberId).sort()
	const membershipDigest = sha256(JSON.stringify(memberIds))
	const identityDigest = sha256(
		JSON.stringify([corridorKey, scope === 'route' ? null : membershipDigest]),
	)
	const displayNames = Array.from(new Set(members.map((member) => member.displayName))).sort()
	const name = displayNames[0]
	if (!name) return undefined
	const aliases = new Set<string>(displayNames.slice(1))
	const categories = new Set<string>(
		scope === 'connected-name' ? ['corridor'] : ['corridor', 'route'],
	)
	const assembly = assembleCorridorGeometry(members)
	const countries = new Set<string>()
	let everyMemberHasCountry = true
	let west = Number.POSITIVE_INFINITY
	let south = Number.POSITIVE_INFINITY
	let east = Number.NEGATIVE_INFINITY
	let north = Number.NEGATIVE_INFINITY
	let importance = Number.NEGATIVE_INFINITY
	for (const member of members) {
		const memberAliases = parseStagedJson(member.aliasesJson, 'aliases')
		if (Array.isArray(memberAliases)) {
			for (const alias of memberAliases) if (typeof alias === 'string') aliases.add(alias)
		}
		const memberCategories = parseStagedJson(member.categoriesJson, 'categories')
		if (Array.isArray(memberCategories)) {
			for (const category of memberCategories) {
				if (typeof category === 'string') categories.add(category)
			}
		}
		west = Math.min(west, member.west)
		south = Math.min(south, member.south)
		east = Math.max(east, member.east)
		north = Math.max(north, member.north)
		importance = Math.max(importance, member.importance)
		if (member.countryCode) countries.add(member.countryCode)
		else everyMemberHasCountry = false
	}
	aliases.delete(name)
	const countryCode =
		everyMemberHasCountry && countries.size === 1 ? countries.values().next().value : undefined
	const identity = parseStagedJson(first.identityJson, 'identity')
	const identityObject = jsonObject(identity)
	const sourceFeatureType =
		jsonText(identityObject?.sourceFeatureType) === 'water' ? 'water' : 'segment'
	const sourceTheme = sourceFeatureType === 'water' ? 'base' : 'transportation'
	const derivedType = sourceFeatureType === 'water' ? 'water_corridor' : 'corridor'
	const gapCount = Math.max(0, assembly.componentCount - 1)
	const properties: JsonObject = {
		overtureTheme: sourceTheme,
		overtureType: derivedType,
		corridorScope: scope,
		geometrySemantics:
			'exact-endpoint-stitched source centerlines; repeated source segments, branches, and disconnected components remain separate; no inferred connections',
		memberCount: members.length,
		memberIdSample: memberIds.slice(0, CORRIDOR_MEMBER_ID_SAMPLE_LIMIT),
		memberIdSampleTruncated: memberIds.length > CORRIDOR_MEMBER_ID_SAMPLE_LIMIT,
		membershipDigest: `sha256:${membershipDigest}`,
		componentCount: assembly.componentCount,
		gapCount,
		pathCount: assembly.pathCount,
		stitchedJoinCount: assembly.stitchedJoinCount,
		repeatedSegmentJoinCount: assembly.repeatedSegmentJoinCount,
		branchPointCount: assembly.branchPointCount,
		duplicateGeometryMemberCount: assembly.duplicateGeometryMemberCount,
		identity,
		derivedFrom: {
			name: OVERTURE_SOURCE_NAME,
			release,
			featureType: sourceFeatureType,
		},
	}
	return {
		id: `overture:${sourceTheme}:${derivedType}:${identityDigest}`,
		kind: first.kind,
		name,
		aliases: Array.from(aliases).sort(),
		categories: Array.from(categories).sort(),
		...(countryCode ? { countryCode } : {}),
		bbox: [west, south, east, north],
		center: { longitude: (west + east) / 2, latitude: (south + north) / 2 },
		// Prefer the useful whole-corridor result over any equally named raw
		// member while keeping the source feature's relative ranking intact.
		importance: importance + 1,
		source: {
			name: OVERTURE_SOURCE_NAME,
			release,
			recordId: `corridor:${identityDigest}`,
		},
		properties,
		geometry: { type: 'MultiLineString', coordinates: assembly.coordinates },
	}
}

type InsertMemberParameters = [
	string,
	CorridorScope,
	string,
	string,
	GeoCatalogKind,
	string,
	string,
	string,
	string | null,
	number,
	number,
	number,
	number,
	number,
	string,
]

class CorridorStaging {
	private transactionOpen = false
	private readonly insertMember: Statement<never, InsertMemberParameters>
	private readonly insertConnection: Statement<never, [string, string, string]>

	private constructor(
		private readonly directory: string,
		private readonly path: string,
		private readonly database: Database,
	) {
		database.exec(`
			PRAGMA journal_mode = DELETE;
			PRAGMA synchronous = OFF;
			CREATE TABLE corridor_members (
				corridor_key TEXT NOT NULL,
				scope TEXT NOT NULL,
				identity_json TEXT NOT NULL,
				member_id TEXT NOT NULL,
				kind TEXT NOT NULL,
				display_name TEXT NOT NULL,
				aliases_json TEXT NOT NULL,
				categories_json TEXT NOT NULL,
				country_code TEXT,
				west REAL NOT NULL,
				south REAL NOT NULL,
				east REAL NOT NULL,
				north REAL NOT NULL,
				importance REAL NOT NULL,
				coordinates_json TEXT NOT NULL,
				PRIMARY KEY (corridor_key, member_id)
			) STRICT;
			CREATE TABLE corridor_connections (
				corridor_key TEXT NOT NULL,
				member_id TEXT NOT NULL,
				connection_key TEXT NOT NULL,
				PRIMARY KEY (corridor_key, member_id, connection_key)
			) STRICT;
			CREATE INDEX corridor_connections_lookup
				ON corridor_connections(corridor_key, connection_key, member_id);
			CREATE TABLE processed_members (
				corridor_key TEXT NOT NULL,
				member_id TEXT NOT NULL,
				PRIMARY KEY (corridor_key, member_id)
			) STRICT;
			CREATE TABLE active_component (
				member_id TEXT PRIMARY KEY
			) STRICT;
		`)
		this.insertMember = database.query<never, InsertMemberParameters>(`
			INSERT OR IGNORE INTO corridor_members(
				corridor_key, scope, identity_json, member_id, kind, display_name,
				aliases_json, categories_json, country_code, west, south, east, north,
				importance, coordinates_json
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`)
		this.insertConnection = database.query<never, [string, string, string]>(`
			INSERT OR IGNORE INTO corridor_connections(
				corridor_key, member_id, connection_key
			) VALUES (?, ?, ?)
		`)
	}

	static async create(root = tmpdir()): Promise<CorridorStaging> {
		const directory = await mkdtemp(join(root, 'earthly-geocatalog-corridors-'))
		const path = join(directory, 'corridors.sqlite')
		let database: Database | undefined
		try {
			database = new Database(path, { strict: true })
			return new CorridorStaging(directory, path, database)
		} catch (error) {
			database?.close()
			await cleanupStagingFiles(directory, path)
			throw error
		}
	}

	begin(): void {
		this.database.exec('BEGIN IMMEDIATE')
		this.transactionOpen = true
	}

	commit(): void {
		this.database.exec('COMMIT')
		this.transactionOpen = false
	}

	rollback(): void {
		if (!this.transactionOpen) return
		this.database.exec('ROLLBACK')
		this.transactionOpen = false
	}

	stage(entry: GeoCatalogEntry): void {
		for (const membership of corridorMemberships(entry)) {
			const bbox = lineBbox(membership.coordinates)
			this.insertMember.run(
				membership.corridorKey,
				membership.scope,
				JSON.stringify(membership.identity),
				entry.id,
				entry.kind,
				membership.displayName,
				JSON.stringify(membership.aliases),
				JSON.stringify(entry.categories),
				entry.countryCode ?? null,
				bbox[0],
				bbox[1],
				bbox[2],
				bbox[3],
				entry.importance,
				JSON.stringify(membership.coordinates),
			)
			for (const connectionKey of membership.connectionKeys) {
				this.insertConnection.run(membership.corridorKey, entry.id, connectionKey)
			}
		}
	}

	*entries(release: string): Generator<GeoCatalogEntry> {
		const nextCorridor = this.database.query<CorridorKeyRow, [string]>(`
			SELECT corridor_key AS corridorKey, MIN(scope) AS scope
			FROM corridor_members
			WHERE corridor_key > ?
			GROUP BY corridor_key
			ORDER BY corridor_key
			LIMIT 1
		`)
		const membersForRoute = this.database.query<StagedMemberRow, [string]>(`
			SELECT
				corridor_key AS corridorKey, scope, identity_json AS identityJson,
				member_id AS memberId, kind, display_name AS displayName,
				aliases_json AS aliasesJson, categories_json AS categoriesJson,
				country_code AS countryCode, west, south, east, north, importance,
				coordinates_json AS coordinatesJson
			FROM corridor_members
			WHERE corridor_key = ?
			ORDER BY member_id
		`)
		const nextUnprocessed = this.database.query<MemberIdRow, [string, string]>(`
			SELECT member_id AS memberId
			FROM corridor_members AS member
			WHERE corridor_key = ?
				AND NOT EXISTS (
					SELECT 1 FROM processed_members AS processed
					WHERE processed.corridor_key = ?
						AND processed.member_id = member.member_id
				)
			ORDER BY member_id
			LIMIT 1
		`)
		const seedComponent = this.database.query<never, [string]>(
			'INSERT INTO active_component(member_id) VALUES (?)',
		)
		const expandComponent = this.database.query<never, [string, string]>(`
			INSERT OR IGNORE INTO active_component(member_id)
			SELECT adjacent.member_id
			FROM active_component AS component
			JOIN corridor_connections AS origin
				ON origin.corridor_key = ? AND origin.member_id = component.member_id
			JOIN corridor_connections AS adjacent
				ON adjacent.corridor_key = ?
					AND adjacent.connection_key = origin.connection_key
		`)
		const componentMembers = this.database.query<StagedMemberRow, [string]>(`
			SELECT
				member.corridor_key AS corridorKey, member.scope,
				member.identity_json AS identityJson, member.member_id AS memberId,
				member.kind, member.display_name AS displayName,
				member.aliases_json AS aliasesJson,
				member.categories_json AS categoriesJson,
				member.country_code AS countryCode, member.west, member.south,
				member.east, member.north, member.importance,
				member.coordinates_json AS coordinatesJson
			FROM active_component AS component
			JOIN corridor_members AS member ON member.member_id = component.member_id
			WHERE member.corridor_key = ?
			ORDER BY member.member_id
		`)
		const markProcessed = this.database.query<never, [string]>(`
			INSERT OR IGNORE INTO processed_members(corridor_key, member_id)
			SELECT ?, member_id FROM active_component
		`)

		let afterKey = ''
		while (true) {
			const corridor = nextCorridor.get(afterKey)
			if (!corridor) break
			afterKey = corridor.corridorKey
			if (corridor.scope === 'route') {
				const entry = createCorridorEntry(
					corridor.corridorKey,
					corridor.scope,
					membersForRoute.all(corridor.corridorKey),
					release,
				)
				if (entry) yield entry
				continue
			}

			while (true) {
				const seed = nextUnprocessed.get(corridor.corridorKey, corridor.corridorKey)
				if (!seed) break
				this.database.exec('DELETE FROM active_component')
				seedComponent.run(seed.memberId)
				while (
					expandComponent.run(corridor.corridorKey, corridor.corridorKey).changes > 0
				) {
					// Expand until the on-disk component reaches a fixed point.
				}
				const members = componentMembers.all(corridor.corridorKey)
				markProcessed.run(corridor.corridorKey)
				const entry = createCorridorEntry(
					corridor.corridorKey,
					corridor.scope,
					members,
					release,
				)
				if (entry) yield entry
			}
		}
	}

	async cleanup(): Promise<void> {
		const errors: unknown[] = []
		try {
			this.rollback()
		} catch (error) {
			errors.push(error)
		}
		try {
			this.database.close()
		} catch (error) {
			errors.push(error)
		}
		try {
			await cleanupStagingFiles(this.directory, this.path)
		} catch (error) {
			errors.push(error)
		}
		if (errors.length > 0) throw new AggregateError(errors, 'Failed to clean corridor staging')
	}
}

async function unlinkIfPresent(path: string): Promise<void> {
	try {
		await unlink(path)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
}

async function cleanupStagingFiles(directory: string, path: string): Promise<void> {
	const errors: unknown[] = []
	const results = await Promise.allSettled([
		unlinkIfPresent(path),
		unlinkIfPresent(`${path}-journal`),
		unlinkIfPresent(`${path}-wal`),
		unlinkIfPresent(`${path}-shm`),
	])
	for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
	try {
		await rmdir(directory)
	} catch (error) {
		errors.push(error)
	}
	if (errors.length > 0) throw new AggregateError(errors, 'Failed to remove corridor staging files')
}

/**
 * Build a snapshot while retaining at most one input record and one derived
 * corridor in memory. Corridor membership and connectivity are staged on disk.
 */
export async function buildOvertureGeoCatalogSnapshot(
	options: BuildGeoCatalogOptions,
): Promise<BuildGeoCatalogResult> {
	const release = requiredText(options.release, '--release')
	const snapshotId = requiredText(options.snapshotId, '--snapshot-id')
	const output = requiredText(options.output, '--output')
	const corridorSourceFragments = parseCorridorSourceFragmentPolicy(
		options.corridorSourceFragments ?? 'retain',
	)
	if (options.inputs.length === 0) throw new Error('At least one --input spec is required')
	if (existsSync(output)) {
		throw new Error(`Refusing to replace existing GeoCatalog snapshot at ${output}`)
	}
	await Promise.all(options.inputs.map(assertLocalInput))

	const snapshot: GeoCatalogSnapshotMetadata = {
		id: snapshotId,
		createdAt: options.createdAt
			? canonicalIsoDate(options.createdAt)
			: new Date().toISOString(),
		schemaVersion: 1,
		...(options.coverage
			? { coverage: { spatial: options.coverage, kinds: installedKinds(options.inputs) } }
			: {}),
		sources: [
			createOvertureSourceRelease(
				release,
				options.inputs.map((input) => input.featureType),
			),
		],
	}
	const byType = createTypeCounts()
	let recordsRead = 0
	let sourceEntriesWritten = 0
	let sourceFragmentsStagedOnly = 0
	let corridorsWritten = 0
	const corridorAssembly: BuildGeoCatalogResult['corridorAssembly'] = {
		components: 0,
		paths: 0,
		stitchedJoins: 0,
		repeatedSegmentJoinsPrevented: 0,
		duplicateGeometryMembers: 0,
		branchPoints: 0,
		corridorsWithGaps: 0,
	}
	let recordsSkipped = 0
	const staging = await CorridorStaging.create(options.stagingDirectoryRoot)

	async function* entries(): AsyncGenerator<GeoCatalogEntry> {
		staging.begin()
		try {
			for (const input of options.inputs) {
				for await (const entry of readOvertureGeoJsonSequence(input, {
					release,
					onRecord(record) {
						recordsRead += 1
						byType[record.featureType].recordsRead += 1
						if (!record.included) {
							recordsSkipped += 1
							byType[record.featureType].recordsSkipped += 1
						}
					},
				})) {
					staging.stage(entry)
					if (
						corridorSourceFragments === 'staging-only' &&
						corridorSourceFragment(entry)
					) {
						sourceFragmentsStagedOnly += 1
						byType[input.featureType].sourceFragmentsStagedOnly += 1
						continue
					}
					sourceEntriesWritten += 1
					byType[input.featureType].entriesWritten += 1
					yield entry
				}
			}
			staging.commit()
		} catch (error) {
			staging.rollback()
			throw error
		}
		for (const corridor of staging.entries(release)) {
			corridorsWritten += 1
			const componentCount = corridor.properties.componentCount
			const pathCount = corridor.properties.pathCount
			const stitchedJoinCount = corridor.properties.stitchedJoinCount
			const repeatedSegmentJoinCount = corridor.properties.repeatedSegmentJoinCount
			const duplicateGeometryMemberCount = corridor.properties.duplicateGeometryMemberCount
			const branchPointCount = corridor.properties.branchPointCount
			const gapCount = corridor.properties.gapCount
			if (typeof componentCount === 'number') corridorAssembly.components += componentCount
			if (typeof pathCount === 'number') corridorAssembly.paths += pathCount
			if (typeof stitchedJoinCount === 'number') {
				corridorAssembly.stitchedJoins += stitchedJoinCount
			}
			if (typeof repeatedSegmentJoinCount === 'number') {
				corridorAssembly.repeatedSegmentJoinsPrevented += repeatedSegmentJoinCount
			}
			if (typeof duplicateGeometryMemberCount === 'number') {
				corridorAssembly.duplicateGeometryMembers += duplicateGeometryMemberCount
			}
			if (typeof branchPointCount === 'number') {
				corridorAssembly.branchPoints += branchPointCount
			}
			if (typeof gapCount === 'number' && gapCount > 0) {
				corridorAssembly.corridorsWithGaps += 1
			}
			yield corridor
		}
	}

	try {
		await writeSqliteGeoCatalogSnapshot({ path: output, snapshot, entries: entries() })
	} finally {
		await staging.cleanup()
	}
	const outputBytes = (await stat(output)).size
	return {
		snapshot,
		output,
		outputBytes,
		inputFiles: options.inputs.length,
		recordsRead,
		entriesWritten: sourceEntriesWritten + corridorsWritten,
		sourceFragmentsStagedOnly,
		corridorsWritten,
		corridorAssembly,
		recordsSkipped,
		byType,
	}
}

function splitLongOption(argument: string): { name: string; inlineValue?: string } | undefined {
	if (!argument.startsWith('--')) return undefined
	const separator = argument.indexOf('=')
	return separator < 0
		? { name: argument }
		: { name: argument.slice(0, separator), inlineValue: argument.slice(separator + 1) }
}

export function parseBuildGeoCatalogArgs(argv: string[]): BuildGeoCatalogCliOptions | null {
	let release: string | undefined
	let snapshotId: string | undefined
	let output: string | undefined
	let createdAt: string | undefined
	let coverage: GeoCatalogSnapshotSpatialCoverage | undefined
	let corridorSourceFragments: NonNullable<
		BuildGeoCatalogOptions['corridorSourceFragments']
	> = 'retain'
	let format: 'text' | 'json' = 'text'
	const inputValues: string[] = []
	const seen = new Set<string>()

	const assignOnce = (name: string, value: string): string => {
		if (seen.has(name)) throw new Error(`${name} may only be supplied once`)
		seen.add(name)
		return requiredText(value, name)
	}

	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (!argument) continue
		if (argument === '--help' || argument === '-h') return null
		const option = splitLongOption(argument)
		if (!option) {
			if (argument.startsWith('-')) throw new Error(`Unknown option ${argument}`)
			inputValues.push(argument)
			continue
		}
		const value =
			option.inlineValue ??
			(() => {
				const following = argv[index + 1]
				if (!following || following.startsWith('--')) {
					throw new Error(`${option.name} requires a value`)
				}
				index += 1
				return following
			})()
		switch (option.name) {
			case '--release':
				release = assignOnce(option.name, value)
				break
			case '--snapshot-id':
				snapshotId = assignOnce(option.name, value)
				break
			case '--output':
				output = assignOnce(option.name, value)
				break
			case '--created-at':
				createdAt = canonicalIsoDate(assignOnce(option.name, value))
				break
			case '--coverage':
				coverage = parseCoverage(assignOnce(option.name, value))
				break
			case '--corridor-source-fragments':
				corridorSourceFragments = parseCorridorSourceFragmentPolicy(
					assignOnce(option.name, value),
				)
				break
			case '--format': {
				const parsed = assignOnce(option.name, value)
				if (parsed !== 'text' && parsed !== 'json') {
					throw new Error('--format must be text or json')
				}
				format = parsed
				break
			}
			case '--input':
				inputValues.push(requiredText(value, '--input'))
				break
			default:
				throw new Error(`Unknown option ${option.name}`)
		}
	}

	if (!release) throw new Error('--release is required')
	if (!snapshotId) throw new Error('--snapshot-id is required')
	if (!output) throw new Error('--output is required')
	if (inputValues.length === 0) throw new Error('At least one --input spec is required')
	if (/^[a-z][a-z\d+.-]*:\/\//iu.test(output)) {
		throw new Error('--output must be a local file path')
	}
	const inputs = inputValues.map(parseOvertureInputSpec).map((input) => ({
		...input,
		path: resolve(input.path),
	}))
	createOvertureSourceRelease(
		release,
		inputs.map((input) => input.featureType),
	)
	return {
		release,
		snapshotId,
		output: resolve(output),
		inputs,
		...(createdAt ? { createdAt } : {}),
		...(coverage ? { coverage } : {}),
		corridorSourceFragments,
		format,
	}
}

async function main(): Promise<void> {
	const options = parseBuildGeoCatalogArgs(process.argv.slice(2))
	if (!options) {
		console.log(USAGE)
		return
	}
	const result = await buildOvertureGeoCatalogSnapshot(options)
	if (options.format === 'json') {
		console.log(JSON.stringify(result, null, 2))
		return
	}
	console.log(
		`Built ${result.snapshot.id}: ${result.entriesWritten} entries from ` +
			`${result.recordsRead} records (${result.corridorsWritten} assembled corridors, ` +
			`${result.corridorAssembly.paths} stitched/branch-preserving paths, ` +
			`${result.sourceFragmentsStagedOnly} staging-only source fragments, ` +
			`${result.recordsSkipped} skipped, ${result.outputBytes} bytes) at ${result.output}`,
	)
}

if (import.meta.main) {
	main().catch((error: unknown) => {
		console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
		process.exitCode = 1
	})
}
