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

// --- Feature Name Matching ---

export function featureMatchesName(feature: GeoJSON.Feature, targetName: string): boolean {
	const lowerTarget = targetName.toLowerCase()
	const props = feature.properties
	if (!props || typeof props !== 'object') return false

	for (const key of NAME_MATCH_KEYS) {
		const rawValue = (props as Record<string, unknown>)[key]
		if (typeof rawValue === 'string' && rawValue.toLowerCase().includes(lowerTarget)) {
			return true
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
