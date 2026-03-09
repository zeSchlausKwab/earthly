/**
 * Shared helpers for chat tool execution:
 * - Geo client singleton
 * - Serialization & MCP result extraction
 * - Numeric validation & clamping
 * - GeoJSON parsing, normalization, and type guards
 * - JSON repair for truncated tool arguments
 * - Editor import helpers
 * - Tool result baking (geometry import from tool results)
 */

import { EarthlyGeoServerClient } from '@/ctxcn/EarthlyGeoServerClient'
import { useEditorStore } from '@/features/geo-editor/store'
import { toEditorFeature } from '@/features/geo-editor/utils'
import type { EditorFeature } from '@/features/geo-editor/core'
import {
	bbox as turfBbox,
	booleanIntersects,
	booleanPointInPolygon,
	centroid as turfCentroid,
	featureCollection as turfFeatureCollection,
	lineSplit,
	pointOnFeature,
	polygonToLine,
} from '@turf/turf'
import type { GeometryBakeResult } from './types'
import {
	MAX_QUERY_LIMIT,
	DEFAULT_NEARBY_RADIUS_METERS,
	MAX_NEARBY_RADIUS_METERS,
	MAX_GEOJSON_TEXT_CHARS,
	NAME_MATCH_KEYS,
} from './types'

// --- Geo Client Singleton ---

let geoClient: EarthlyGeoServerClient | null = null

export function getGeoClient(): EarthlyGeoServerClient {
	if (!geoClient) {
		geoClient = new EarthlyGeoServerClient()
	}
	return geoClient
}

// --- Serialization ---

export function serializeToolResult(result: unknown): string {
	if (typeof result === 'string') return result
	try {
		return JSON.stringify(result) ?? 'null'
	} catch (error) {
		console.error('Failed to serialize tool result', error)
		return JSON.stringify({ error: 'Tool result serialization failed' })
	}
}

export function extractMcpToolResult(toolName: string, response: unknown): Record<string, unknown> {
	if (!response || typeof response !== 'object') {
		throw new Error(`${toolName}: invalid tool response payload`)
	}

	const envelope = response as Record<string, unknown>
	const error = typeof envelope.error === 'string' ? envelope.error.trim() : null
	if (error) {
		throw new Error(`${toolName}: ${error}`)
	}

	if (!('result' in envelope) || envelope.result === undefined) {
		throw new Error(
			`${toolName}: missing result in tool response. Raw keys: ${
				Object.keys(envelope).join(', ') || '(none)'
			}`,
		)
	}

	if (!envelope.result || typeof envelope.result !== 'object') {
		return { value: envelope.result }
	}

	return envelope.result as Record<string, unknown>
}

// --- Numeric Validation ---

export function toFiniteNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function hasExplicitBbox(args: Record<string, unknown>): boolean {
	return (
		toFiniteNumber(args.west) !== undefined &&
		toFiniteNumber(args.south) !== undefined &&
		toFiniteNumber(args.east) !== undefined &&
		toFiniteNumber(args.north) !== undefined
	)
}

export function hasExplicitPoint(args: Record<string, unknown>): boolean {
	return toFiniteNumber(args.lat) !== undefined && toFiniteNumber(args.lon) !== undefined
}

export function clampLimit(value: unknown, fallback: number): number {
	const numeric = toFiniteNumber(value)
	if (numeric === undefined) return fallback
	return Math.max(1, Math.min(MAX_QUERY_LIMIT, Math.floor(numeric)))
}

export function clampPositiveInt(value: unknown, fallback: number, max: number): number {
	const numeric = toFiniteNumber(value)
	if (numeric === undefined) return fallback
	return Math.max(1, Math.min(max, Math.floor(numeric)))
}

export function clampRadiusMeters(value: unknown): number {
	const numeric = toFiniteNumber(value)
	if (numeric === undefined) return DEFAULT_NEARBY_RADIUS_METERS
	return Math.max(1, Math.min(MAX_NEARBY_RADIUS_METERS, numeric))
}

export function normalizeFilters(value: unknown): Record<string, string | string[]> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined
	}

	const entries = Object.entries(value as Record<string, unknown>)
	const normalized: Record<string, string | string[]> = {}

	for (const [key, raw] of entries) {
		if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
			normalized[key] = String(raw)
			continue
		}
		if (Array.isArray(raw)) {
			const values = raw
				.filter(
					(entry): entry is string | number | boolean =>
						typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean',
				)
				.map((entry) => String(entry))
			if (values.length > 0) {
				normalized[key] = values
			}
		}
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined
}

export function normalizeFilterSets(
	value: unknown,
): Array<Record<string, string | string[]>> | undefined {
	if (!Array.isArray(value)) {
		return undefined
	}

	const normalized = value
		.map((entry) => normalizeFilters(entry))
		.filter((entry): entry is Record<string, string | string[]> => entry !== undefined)

	return normalized.length > 0 ? normalized : undefined
}

type OsmFilterObject = Record<string, string | string[]>

interface OsmSemanticExpansionInput {
	concept?: string
	name?: string
	filters?: OsmFilterObject
	filterSets?: OsmFilterObject[]
}

interface OsmSemanticExpansionResult {
	appliedConcept: string | null
	filters?: OsmFilterObject
	filterSets?: OsmFilterObject[]
}

interface OsmConceptExpansionDefinition {
	id: string
	aliases: string[]
	filterSets: OsmFilterObject[]
}

const OSM_CONCEPT_EXPANSIONS: OsmConceptExpansionDefinition[] = [
	{
		id: 'military_installation',
		aliases: [
			'military',
			'military installation',
			'military installations',
			'military base',
			'military bases',
			'air base',
			'air bases',
			'airbase',
			'airbases',
			'air force base',
			'air force bases',
			'airfield',
			'airfields',
			'barracks',
			'garrison',
			'naval base',
			'checkpoint',
		],
		filterSets: [
			{
				military: [
					'base',
					'airfield',
					'air_base',
					'barracks',
					'checkpoint',
					'check_point',
					'naval_base',
					'training_area',
					'range',
					'bunker',
					'office',
					'storage',
				],
			},
			{ landuse: 'military' },
			{ building: 'bunker' },
		],
	},
	{
		id: 'river',
		aliases: ['river', 'rivers', 'waterway', 'waterways', 'watercourse'],
		filterSets: [{ waterway: 'river' }],
	},
	{
		id: 'bench',
		aliases: ['bench', 'benches', 'seat', 'seating'],
		filterSets: [{ amenity: 'bench' }],
	},
]

function uniqueStrings(values: string[]): string[] {
	return [...new Set(values.filter(Boolean))]
}

function cloneFilterObject(filter: OsmFilterObject): OsmFilterObject {
	return Object.fromEntries(
		Object.entries(filter).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]),
	)
}

function dedupeFilterSets(filterSets: OsmFilterObject[]): OsmFilterObject[] {
	const seen = new Set<string>()
	const deduped: OsmFilterObject[] = []

	for (const filterSet of filterSets) {
		const key = JSON.stringify(
			Object.entries(filterSet)
				.sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
				.map(([entryKey, entryValue]) => [
					entryKey,
					Array.isArray(entryValue) ? [...entryValue].sort() : entryValue,
				]),
		)
		if (seen.has(key)) continue
		seen.add(key)
		deduped.push(filterSet)
	}

	return deduped
}

function normalizeLooseSearchText(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/\bairbase\b/g, 'air base')
		.replace(/\bairforce\b/g, 'air force')
		.replace(/\bcheckpoint\b/g, 'check point')
		.replace(/\babdulaziz\b/g, 'abdul aziz')
		.replace(/[^a-z0-9]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function getLooseSearchVariants(value: string): string[] {
	const normalized = normalizeLooseSearchText(value)
	if (!normalized) return []
	return uniqueStrings([
		normalized,
		normalized.replace(/\s+/g, ''),
		normalized.replace(/\bair base\b/g, 'airbase'),
		normalized.replace(/\bcheck point\b/g, 'checkpoint'),
		normalized.replace(/\babdul aziz\b/g, 'abdulaziz'),
	])
}

function splitNameCandidates(value: string): string[] {
	return value
		.split(/[;|/]/)
		.map((entry) => entry.trim())
		.filter(Boolean)
}

function inferOsmConceptFromText(value: string): string | null {
	const normalized = normalizeLooseSearchText(value)
	if (!normalized) return null

	for (const definition of OSM_CONCEPT_EXPANSIONS) {
		if (
			definition.aliases.some((alias) => {
				const normalizedAlias = normalizeLooseSearchText(alias)
				return (
					normalized === normalizedAlias ||
					normalized.includes(normalizedAlias) ||
					normalized.replace(/\s+/g, '').includes(normalizedAlias.replace(/\s+/g, ''))
				)
			})
		) {
			return definition.id
		}
	}

	return null
}

function resolveOsmConceptDefinition(
	concept: string | undefined,
	name: string | undefined,
): OsmConceptExpansionDefinition | null {
	const explicitConcept = concept?.trim() ? inferOsmConceptFromText(concept) : null
	const inferredFromName = !explicitConcept && name?.trim() ? inferOsmConceptFromText(name) : null
	const conceptId = explicitConcept ?? inferredFromName
	if (!conceptId) return null
	return OSM_CONCEPT_EXPANSIONS.find((definition) => definition.id === conceptId) ?? null
}

export function expandOsmSemanticQuery({
	concept,
	name,
	filters,
	filterSets,
}: OsmSemanticExpansionInput): OsmSemanticExpansionResult {
	const definition = resolveOsmConceptDefinition(concept, name)
	let mergedFilters = filters ? cloneFilterObject(filters) : undefined
	let mergedFilterSets = filterSets ? filterSets.map(cloneFilterObject) : undefined

	if (definition) {
		mergedFilterSets = [...(mergedFilterSets ?? []), ...definition.filterSets.map(cloneFilterObject)]
	}

	if (mergedFilters && mergedFilterSets?.length) {
		mergedFilterSets = [mergedFilters, ...mergedFilterSets]
		mergedFilters = undefined
	}

	if (!mergedFilters && mergedFilterSets?.length === 1) {
		mergedFilters = cloneFilterObject(mergedFilterSets[0] as OsmFilterObject)
		mergedFilterSets = undefined
	}

	return {
		appliedConcept: definition?.id ?? null,
		filters: mergedFilters,
		filterSets: mergedFilterSets ? dedupeFilterSets(mergedFilterSets) : undefined,
	}
}

// --- GeoJSON Type Guards ---

export function asFeatureObject(value: unknown): GeoJSON.Feature | null {
	if (!value || typeof value !== 'object') return null
	const candidate = value as GeoJSON.Feature
	if (!candidate.geometry || typeof candidate.geometry !== 'object') return null
	return candidate
}

export function asGeometryObject(value: unknown): GeoJSON.Geometry | null {
	if (!value || typeof value !== 'object') return null
	const geometry = value as GeoJSON.Geometry
	if (!isGeoJsonGeometryType(geometry.type)) return null
	return geometry
}

export function isGeoJsonGeometryType(value: unknown): value is GeoJSON.Geometry['type'] {
	return (
		typeof value === 'string' &&
		[
			'Point',
			'MultiPoint',
			'LineString',
			'MultiLineString',
			'Polygon',
			'MultiPolygon',
			'GeometryCollection',
		].includes(value)
	)
}

export function ensureBbox(value: unknown): [number, number, number, number] | null {
	if (!Array.isArray(value) || value.length !== 4) return null
	const [west, south, east, north] = value
	if (
		typeof west !== 'number' ||
		typeof south !== 'number' ||
		typeof east !== 'number' ||
		typeof north !== 'number'
	) {
		return null
	}
	return [west, south, east, north]
}

// --- Editor Viewport ---

export function getEditorViewportBbox(): [number, number, number, number] | null {
	const { editor } = useEditorStore.getState()
	return editor?.getMapBounds() ?? null
}

export function getSelectedEditorFeatures(): EditorFeature[] {
	const { features, selectedFeatureIds } = useEditorStore.getState()
	if (selectedFeatureIds.length === 0) return []
	const selectedIds = new Set(selectedFeatureIds)
	return features.filter((feature) => selectedIds.has(feature.id))
}

function isPolygonAreaFeature(
	feature: GeoJSON.Feature,
): feature is GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon> {
	return feature.geometry?.type === 'Polygon' || feature.geometry?.type === 'MultiPolygon'
}

export function getSelectedAreaFeatures(): GeoJSON.Feature<
	GeoJSON.Polygon | GeoJSON.MultiPolygon
>[] {
	return getSelectedEditorFeatures().filter(isPolygonAreaFeature)
}

export function extractPolygonAreaFeatures(
	value: unknown,
): GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>[] {
	return extractGeoJsonFeaturesFromUnknown(value).filter(isPolygonAreaFeature)
}

export function getFeatureCollectionBbox(
	features: GeoJSON.Feature[],
): [number, number, number, number] | null {
	if (features.length === 0) return null
	try {
		const bbox = turfBbox(turfFeatureCollection(features)) as [
			number,
			number,
			number,
			number,
		]
		if (bbox.some((value) => !Number.isFinite(value))) return null
		return bbox
	} catch {
		return null
	}
}

// --- Feature Name Matching ---

export function featureMatchesName(feature: GeoJSON.Feature, targetName: string): boolean {
	const targetVariants = getLooseSearchVariants(targetName)
	if (targetVariants.length === 0) return false
	const props = feature.properties
	if (!props || typeof props !== 'object') return false

	for (const key of NAME_MATCH_KEYS) {
		const rawValue = (props as Record<string, unknown>)[key]
		if (typeof rawValue !== 'string') continue

		for (const candidate of splitNameCandidates(rawValue)) {
			const candidateVariants = getLooseSearchVariants(candidate)
			if (
				candidateVariants.some((candidateVariant) =>
					targetVariants.some(
						(targetVariant) =>
							candidateVariant.includes(targetVariant) || targetVariant.includes(candidateVariant),
					),
				)
			) {
				return true
			}
		}
	}

	return false
}

// --- GeoJSON Normalization ---

export function normalizeGeoJsonToFeatures(value: unknown): GeoJSON.Feature[] {
	if (!value || typeof value !== 'object') {
		throw new Error('GeoJSON payload must be an object.')
	}

	const obj = value as Record<string, unknown>
	const type = obj.type

	if (type === 'FeatureCollection') {
		const features = Array.isArray(obj.features) ? obj.features : []
		const normalized = features
			.map(asFeatureObject)
			.filter((feature): feature is GeoJSON.Feature => feature !== null)
		if (normalized.length === 0) {
			throw new Error('FeatureCollection does not contain valid features.')
		}
		return normalized
	}

	if (type === 'Feature') {
		const feature = asFeatureObject(obj)
		if (!feature) {
			throw new Error('Invalid GeoJSON Feature.')
		}
		return [feature]
	}

	if (isGeoJsonGeometryType(type)) {
		return [
			{
				type: 'Feature',
				geometry: obj as unknown as GeoJSON.Geometry,
				properties: {},
			},
		]
	}

	throw new Error('Unsupported GeoJSON. Expected FeatureCollection, Feature, or Geometry.')
}

export function normalizePropertiesArg(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}
	return value as Record<string, unknown>
}

// --- GeoJSON Argument Parsing ---

export function parseGeoJsonArg(args: Record<string, unknown>): unknown {
	if (args.geojson && typeof args.geojson === 'object') {
		return args.geojson
	}

	if (typeof args.geojsonText === 'string') {
		const text = args.geojsonText.trim()
		if (!text) {
			throw new Error('geojsonText must be a non-empty JSON string.')
		}
		if (text.length > MAX_GEOJSON_TEXT_CHARS) {
			throw new Error(
				`geojsonText is too large (${text.length} chars). Maximum is ${MAX_GEOJSON_TEXT_CHARS}.`,
			)
		}
		return JSON.parse(text)
	}

	throw new Error('Provide either geojson (object) or geojsonText (string).')
}

export function parseSingleFeatureArg(args: Record<string, unknown>): GeoJSON.Feature {
	if (args.feature && typeof args.feature === 'object') {
		const feature = asFeatureObject(args.feature)
		if (!feature) {
			throw new Error('feature must be a valid GeoJSON Feature object.')
		}
		return feature
	}

	const geometry = asGeometryObject(args.geometry)
	if (!geometry) {
		throw new Error('Provide either feature (GeoJSON Feature) or geometry (GeoJSON Geometry).')
	}

	const feature: GeoJSON.Feature = {
		type: 'Feature',
		geometry,
		properties: normalizePropertiesArg(args.properties),
	}
	if (typeof args.id === 'string' || typeof args.id === 'number') {
		feature.id = args.id
	}

	return feature
}

// --- JSON Repair & Parsing ---

function stripJsonCodeFence(raw: string): string {
	const trimmed = raw.trim()
	const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
	const fencedBody = match?.[1]
	return fencedBody ? fencedBody.trim() : trimmed
}

function extractFirstJsonObject(raw: string): string | null {
	const start = raw.indexOf('{')
	if (start < 0) return null

	let depth = 0
	let inString = false
	let escaping = false
	for (let i = start; i < raw.length; i++) {
		const ch = raw[i]
		if (inString) {
			if (escaping) {
				escaping = false
			} else if (ch === '\\') {
				escaping = true
			} else if (ch === '"') {
				inString = false
			}
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}
		if (ch === '{') {
			depth += 1
			continue
		}
		if (ch === '}') {
			depth -= 1
			if (depth === 0) {
				return raw.slice(start, i + 1)
			}
		}
	}

	return null
}

function repairLikelyTruncatedJsonObject(raw: string): string | null {
	const start = raw.indexOf('{')
	if (start < 0) return null
	const source = raw.slice(start)
	let output = ''
	const stack: string[] = []
	let inString = false
	let escaping = false

	for (let i = 0; i < source.length; i++) {
		const ch = source[i]
		if (!ch) continue
		output += ch

		if (inString) {
			if (escaping) {
				escaping = false
				continue
			}
			if (ch === '\\') {
				escaping = true
				continue
			}
			if (ch === '"') {
				inString = false
			}
			continue
		}

		if (ch === '"') {
			inString = true
			continue
		}

		if (ch === '{') {
			stack.push('}')
			continue
		}
		if (ch === '[') {
			stack.push(']')
			continue
		}
		if ((ch === '}' || ch === ']') && stack.length > 0) {
			const expected = stack[stack.length - 1]
			if (expected === ch) {
				stack.pop()
			}
		}
	}

	if (inString) {
		output += '"'
	}
	while (stack.length > 0) {
		const close = stack.pop()
		if (close) output += close
	}

	const cleaned = output.replace(/,(\s*[}\]])/g, '$1').trim()
	return cleaned.length > 0 ? cleaned : null
}

export function parseToolCallArguments(rawArguments: string | undefined): Record<string, unknown> {
	const raw = rawArguments?.trim()
	if (!raw) return {}

	const candidates = new Set<string>([raw])
	const fenceStripped = stripJsonCodeFence(raw)
	candidates.add(fenceStripped)
	const extracted = extractFirstJsonObject(fenceStripped)
	if (extracted) {
		candidates.add(extracted)
	}
	const repaired = repairLikelyTruncatedJsonObject(fenceStripped)
	if (repaired) {
		candidates.add(repaired)
	}

	for (const candidate of candidates) {
		try {
			const parsed = JSON.parse(candidate) as unknown
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				continue
			}
			return parsed as Record<string, unknown>
		} catch {
			// try next candidate
		}
	}

	throw new Error(
		`Invalid tool arguments JSON for tool call. Raw arguments prefix: ${raw.slice(0, 200)}`,
	)
}

// --- Editor Import ---

export function importFeaturesToEditor(features: GeoJSON.Feature[], replaceExisting: boolean) {
	const { editor, setFeatures } = useEditorStore.getState()
	if (!editor) {
		throw new Error('Map editor is not ready. Open the map editor first, then try again.')
	}

	const normalized = features.map((f) => toEditorFeature(f, 'chat_tool'))
	if (normalized.length === 0) {
		throw new Error('No valid GeoJSON features available to import.')
	}

	if (replaceExisting) {
		editor.setFeatures(normalized)
		setFeatures(normalized)
		return {
			importedCount: normalized.length,
			skippedDuplicates: 0,
			totalFeaturesInEditor: normalized.length,
		}
	}

	const existingIds = new Set(editor.getAllFeatures().map((feature) => feature.id))
	let importedCount = 0
	let skippedDuplicates = 0

	for (const feature of normalized) {
		if (existingIds.has(feature.id)) {
			skippedDuplicates += 1
			continue
		}

		editor.addFeature(feature)
		existingIds.add(feature.id)
		importedCount += 1
	}

	return {
		importedCount,
		skippedDuplicates,
		totalFeaturesInEditor: editor.getAllFeatures().length,
	}
}

// --- Geometry Extraction & Baking ---

export function countGeometryTypes(features: GeoJSON.Feature[]): Record<string, number> {
	const counts: Record<string, number> = {}
	for (const feature of features) {
		const geometryType = feature.geometry?.type ?? 'Unknown'
		counts[geometryType] = (counts[geometryType] ?? 0) + 1
	}
	return counts
}

export function countFeaturesByGeometry(features: EditorFeature[]) {
	const counts: Record<string, number> = {}
	for (const feature of features) {
		const type = feature.geometry?.type ?? 'Unknown'
		counts[type] = (counts[type] ?? 0) + 1
	}
	return counts
}

export function extractGeoJsonFeaturesFromUnknown(value: unknown): GeoJSON.Feature[] {
	const features: GeoJSON.Feature[] = []

	const visit = (candidate: unknown): void => {
		if (!candidate) return

		if (Array.isArray(candidate)) {
			for (const item of candidate) visit(item)
			return
		}

		if (typeof candidate !== 'object') return
		const objectValue = candidate as Record<string, unknown>
		const objectType = objectValue.type

		if (objectType === 'FeatureCollection' && Array.isArray(objectValue.features)) {
			visit(objectValue.features)
			return
		}

		if (objectType === 'Feature') {
			const feature = asFeatureObject(objectValue)
			if (feature) features.push(feature)
			return
		}

		if (isGeoJsonGeometryType(objectType)) {
			features.push({
				type: 'Feature',
				geometry: objectValue as unknown as GeoJSON.Geometry,
				properties: {},
			})
			return
		}

		if ('feature' in objectValue) {
			visit(objectValue.feature)
		}
		if ('features' in objectValue) {
			visit(objectValue.features)
		}
		if ('featureCollection' in objectValue) {
			visit(objectValue.featureCollection)
		}
	}

	visit(value)
	return features
}

type AreaSpatialFilter = 'intersects' | 'point_within'
type AreaOutputGeometry = 'native' | 'point_on_feature' | 'centroid'

function pointFeatureWithinAreas(
	pointFeature: GeoJSON.Feature<GeoJSON.Point>,
	areaFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): boolean {
	return areaFeatures.some((area) => {
		try {
			return booleanPointInPolygon(pointFeature, area)
		} catch {
			return false
		}
	})
}

function featureIntersectsAreas(
	feature: GeoJSON.Feature,
	areaFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): boolean {
	return areaFeatures.some((area) => {
		try {
			return booleanIntersects(feature, area)
		} catch {
			return false
		}
	})
}

function getRepresentativePointFeature(
	feature: GeoJSON.Feature,
	outputGeometry: Exclude<AreaOutputGeometry, 'native'>,
): GeoJSON.Feature<GeoJSON.Point> | null {
	try {
		const pointFeature =
			outputGeometry === 'centroid' ? turfCentroid(feature) : pointOnFeature(feature)
		return {
			type: 'Feature',
			id: feature.id,
			geometry: pointFeature.geometry,
			properties: {
				...(feature.properties ?? {}),
				sourceGeometryType: feature.geometry?.type ?? 'Unknown',
			},
		}
	} catch {
		return null
	}
}

function lineFeatureParts(feature: GeoJSON.Feature): GeoJSON.Feature<GeoJSON.LineString>[] {
	if (feature.geometry?.type === 'LineString') {
		return [
			{
				type: 'Feature',
				id: feature.id,
				geometry: feature.geometry,
				properties: feature.properties ?? {},
			},
		]
	}

	if (feature.geometry?.type === 'MultiLineString') {
		return feature.geometry.coordinates.map((coordinates, index) => ({
			type: 'Feature',
			id: `${feature.id ?? 'line'}:${index}`,
			geometry: {
				type: 'LineString',
				coordinates,
			},
			properties: feature.properties ?? {},
		}))
	}

	return []
}

function clipLineFeatureToAreas(
	feature: GeoJSON.Feature,
	areaFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): GeoJSON.Feature<GeoJSON.LineString | GeoJSON.MultiLineString> | null {
	const parts = lineFeatureParts(feature)
	if (parts.length === 0) return null

	const keptSegments: GeoJSON.Feature<GeoJSON.LineString>[] = []
	const seen = new Set<string>()

	for (const part of parts) {
		for (const area of areaFeatures) {
			try {
				const boundary = polygonToLine(area)
				const split = lineSplit(part, boundary)
				const candidates =
					split.features.length > 0
						? (split.features as GeoJSON.Feature<GeoJSON.LineString>[])
						: [part]

				for (const candidate of candidates) {
					const representative = pointOnFeature(candidate)
					if (!pointFeatureWithinAreas(representative, [area])) continue
					const key = JSON.stringify(candidate.geometry.coordinates)
					if (seen.has(key)) continue
					seen.add(key)
					keptSegments.push({
						type: 'Feature',
						geometry: candidate.geometry,
						properties: feature.properties ?? {},
					})
				}
			} catch {
				if (!featureIntersectsAreas(part, [area])) continue
				const key = JSON.stringify(part.geometry.coordinates)
				if (seen.has(key)) continue
				seen.add(key)
				keptSegments.push({
					type: 'Feature',
					geometry: part.geometry,
					properties: feature.properties ?? {},
				})
			}
		}
	}

	if (keptSegments.length === 0) return null
	if (keptSegments.length === 1) {
		return {
			type: 'Feature',
			id: feature.id,
			geometry: keptSegments[0].geometry,
			properties: feature.properties ?? {},
		}
	}

	return {
		type: 'Feature',
		id: feature.id,
		geometry: {
			type: 'MultiLineString',
			coordinates: keptSegments.map((segment) => segment.geometry.coordinates),
		},
		properties: feature.properties ?? {},
	}
}

function filterMultiPointFeatureToAreas(
	feature: GeoJSON.Feature<GeoJSON.MultiPoint>,
	areaFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
): GeoJSON.Feature<GeoJSON.Point | GeoJSON.MultiPoint> | null {
	const kept = feature.geometry.coordinates.filter((coordinates) =>
		pointFeatureWithinAreas(
			{
				type: 'Feature',
				geometry: { type: 'Point', coordinates },
				properties: feature.properties ?? {},
			},
			areaFeatures,
		),
	)

	if (kept.length === 0) return null
	if (kept.length === 1) {
		return {
			type: 'Feature',
			id: feature.id,
			geometry: { type: 'Point', coordinates: kept[0] },
			properties: feature.properties ?? {},
		}
	}

	return {
		type: 'Feature',
		id: feature.id,
		geometry: { type: 'MultiPoint', coordinates: kept },
		properties: feature.properties ?? {},
	}
}

export function filterFeaturesToArea(
	features: GeoJSON.Feature[],
	areaFeatures: Array<GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>>,
	options?: {
		spatialFilter?: AreaSpatialFilter
		outputGeometry?: AreaOutputGeometry
		clipLines?: boolean
	},
): GeoJSON.Feature[] {
	const spatialFilter = options?.spatialFilter ?? 'intersects'
	const outputGeometry = options?.outputGeometry ?? 'native'
	const clipLines = options?.clipLines ?? true

	if (areaFeatures.length === 0) return []

	const processed: GeoJSON.Feature[] = []

	for (const feature of features) {
		if (!feature.geometry) continue

		if (outputGeometry !== 'native') {
			const representative = getRepresentativePointFeature(feature, outputGeometry)
			if (!representative) continue
			if (!pointFeatureWithinAreas(representative, areaFeatures)) continue
			processed.push(representative)
			continue
		}

		if (feature.geometry.type === 'Point') {
			if (pointFeatureWithinAreas(feature as GeoJSON.Feature<GeoJSON.Point>, areaFeatures)) {
				processed.push(feature)
			}
			continue
		}

		if (feature.geometry.type === 'MultiPoint') {
			const filtered = filterMultiPointFeatureToAreas(
				feature as GeoJSON.Feature<GeoJSON.MultiPoint>,
				areaFeatures,
			)
			if (filtered) processed.push(filtered)
			continue
		}

		if (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') {
			if (spatialFilter === 'point_within') {
				const representative = getRepresentativePointFeature(feature, 'point_on_feature')
				if (representative && pointFeatureWithinAreas(representative, areaFeatures)) {
					processed.push(feature)
				}
				continue
			}

			if (!clipLines) {
				if (featureIntersectsAreas(feature, areaFeatures)) {
					processed.push(feature)
				}
				continue
			}

			const clipped = clipLineFeatureToAreas(feature, areaFeatures)
			if (clipped) processed.push(clipped)
			continue
		}

		if (spatialFilter === 'point_within') {
			const representative = getRepresentativePointFeature(feature, 'point_on_feature')
			if (representative && pointFeatureWithinAreas(representative, areaFeatures)) {
				processed.push(feature)
			}
			continue
		}

		if (featureIntersectsAreas(feature, areaFeatures)) {
			processed.push(feature)
		}
	}

	return processed
}

function parseToolResultContent(content: string): unknown {
	const trimmed = content.trim()
	if (!trimmed) return null
	try {
		return JSON.parse(trimmed) as unknown
	} catch {
		return null
	}
}

export function toEditorFromToolResultValue(
	resultValue: unknown,
	replaceExisting: boolean,
): GeometryBakeResult {
	const features = extractGeoJsonFeaturesFromUnknown(resultValue)
	if (features.length === 0) {
		throw new Error('No geometry found in tool result to import.')
	}

	const importResult = importFeaturesToEditor(features, replaceExisting)
	return {
		importedCount: importResult.importedCount,
		skippedDuplicates: importResult.skippedDuplicates,
		totalFeaturesInEditor: importResult.totalFeaturesInEditor,
		replaceExisting,
		extractedFeatureCount: features.length,
		geometryTypeCounts: countGeometryTypes(features),
	}
}

export function analyzeToolResultGeometryContent(
	content: string,
): import('./types').GeometryBakeAnalysis {
	const parsed = parseToolResultContent(content)
	if (parsed === null) {
		return {
			canBake: false,
			featureCount: 0,
			geometryTypeCounts: {},
			reason: 'Tool result is not JSON.',
		}
	}
	const features = extractGeoJsonFeaturesFromUnknown(parsed)
	return {
		canBake: features.length > 0,
		featureCount: features.length,
		geometryTypeCounts: countGeometryTypes(features),
		reason: features.length > 0 ? undefined : 'No GeoJSON geometry found in result.',
	}
}

export function bakeToolResultContentToEditor(
	content: string,
	replaceExisting = false,
): GeometryBakeResult {
	const parsed = parseToolResultContent(content)
	if (parsed === null) {
		throw new Error('Tool result is not valid JSON.')
	}
	return toEditorFromToolResultValue(parsed, replaceExisting)
}

export function compactToolResultAfterBake(resultValue: unknown): Record<string, unknown> {
	const base: Record<string, unknown> =
		resultValue && typeof resultValue === 'object'
			? { ...(resultValue as Record<string, unknown>) }
			: { value: resultValue }

	delete base.feature
	delete base.features
	delete base.featureCollection

	if (typeof base.preview === 'string' && base.preview.length > 280) {
		base.preview = `${base.preview.slice(0, 280)}...`
	}

	return base
}

function simplifyObjectForPrompt(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return value
	const objectValue = value as Record<string, unknown>
	const preferredKeys = [
		'id',
		'@id',
		'name',
		'displayName',
		'title',
		'osmType',
		'osmId',
		'type',
		'class',
		'geometryType',
		'military',
		'amenity',
		'waterway',
		'landuse',
		'building',
	]
	const simplifiedEntries = preferredKeys
		.filter((key) => key in objectValue)
		.map((key) => [key, objectValue[key]])
	return simplifiedEntries.length > 0 ? Object.fromEntries(simplifiedEntries) : objectValue
}

function getFeatureDisplayName(feature: GeoJSON.Feature): string | null {
	const props = feature.properties
	if (!props || typeof props !== 'object') return null
	for (const key of NAME_MATCH_KEYS) {
		const value = (props as Record<string, unknown>)[key]
		if (typeof value === 'string' && value.trim()) {
			return splitNameCandidates(value)[0] ?? value.trim()
		}
	}
	return null
}

function getFeatureSubtype(feature: GeoJSON.Feature): string | null {
	const props = feature.properties
	if (!props || typeof props !== 'object') return null
	const typedProps = props as Record<string, unknown>
	for (const key of ['military', 'amenity', 'waterway', 'landuse', 'building', 'natural', 'aeroway']) {
		const value = typedProps[key]
		if (typeof value === 'string' && value.trim()) {
			return `${key}=${value}`
		}
	}
	return null
}

function summarizeFeaturesForPrompt(features: GeoJSON.Feature[]): Record<string, unknown> {
	const geometryTypes = countGeometryTypes(features)
	const subtypeCounts: Record<string, number> = {}
	const sampleNames: string[] = []
	const sampleIds: string[] = []

	for (const feature of features) {
		const subtype = getFeatureSubtype(feature)
		if (subtype) {
			subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + 1
		}

		const name = getFeatureDisplayName(feature)
		if (name && sampleNames.length < 8 && !sampleNames.includes(name)) {
			sampleNames.push(name)
		}

		const featureId =
			feature.id != null
				? String(feature.id)
				: typeof feature.properties?.['@id'] === 'string'
					? feature.properties['@id']
					: null
		if (featureId && sampleIds.length < 6 && !sampleIds.includes(featureId)) {
			sampleIds.push(featureId)
		}
	}

	return {
		featureCount: features.length,
		geometryTypes,
		subtypeCounts,
		sampleNames,
		sampleIds,
	}
}

function summarizeLargeArraysForPrompt(base: Record<string, unknown>): Record<string, unknown> {
	const next = { ...base }
	for (const key of ['results', 'candidates', 'pages', 'hits']) {
		const value = next[key]
		if (!Array.isArray(value)) continue
		next[`${key}Count`] = value.length
		next[`sample${key[0].toUpperCase()}${key.slice(1)}`] = value.slice(0, 5).map(simplifyObjectForPrompt)
		delete next[key]
	}
	return next
}

function summarizeToolResultForPromptValue(resultValue: unknown): unknown {
	if (!resultValue || typeof resultValue !== 'object') return resultValue

	const features = extractGeoJsonFeaturesFromUnknown(resultValue)
	if (features.length > 0) {
		const compacted = compactToolResultAfterBake(resultValue)
		return summarizeLargeArraysForPrompt({
			...compacted,
			featureSummary: summarizeFeaturesForPrompt(features),
			featuresOmittedForPrompt: features.length,
		})
	}

	return summarizeLargeArraysForPrompt(
		resultValue && typeof resultValue === 'object'
			? { ...(resultValue as Record<string, unknown>) }
			: { value: resultValue },
	)
}

export function compactToolMessageContentForPrompt(content: string): string {
	const parsed = parseToolResultContent(content)
	if (parsed === null) {
		return content
	}

	return serializeToolResult(summarizeToolResultForPromptValue(parsed))
}
