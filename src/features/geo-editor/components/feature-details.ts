import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { PRESENTATION_PROPERTY_KEYS } from '../map-presentation/ids'

const rendererProperties = new Set<string>([
	...Object.values(PRESENTATION_PROPERTY_KEYS),
	'datasetId',
	'sourceEventId',
	'featureId',
	'proxyFeature',
	'proxySourceBbox',
])
const summaryProperties = new Set([
	'name',
	'title',
	'description',
	'desc',
	'summary',
	'customProperties',
])

/** Prefer the complete source geometry and typed properties over a rendered tile fragment. */
export function resolveInspectedFeature(
	rendered: Feature<Geometry>,
	collection: FeatureCollection<Geometry | null> | null | undefined,
	sourceFeatureId?: string,
): Feature<Geometry | null> {
	const id =
		sourceFeatureId ?? rendered.properties?.featureId ?? rendered.properties?.id ?? rendered.id
	if (id != null) {
		const source = collection?.features.find(
			(feature, index) =>
				String(feature.id ?? feature.properties?.featureId ?? feature.properties?.id ?? index) ===
				String(id),
		)
		if (source) return source
	}
	return rendered
}

function text(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim()) return value.trim()
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	return undefined
}

export function featureDetailName(feature: Feature<Geometry | null>): string {
	const props = feature.properties ?? {}
	return (
		[props.name, props.title, props.label, props.text, feature.id, props.id]
			.map(text)
			.find(Boolean) ?? `Unnamed ${feature.geometry?.type ?? 'feature'}`
	)
}

export function featureDetailDescription(feature: Feature<Geometry | null>): string | undefined {
	const props = feature.properties ?? {}
	return text(props.description) ?? text(props.desc) ?? text(props.summary)
}

export function featureDetailProperties(
	feature: Feature<Geometry | null>,
): Array<[string, unknown]> {
	const props = feature.properties ?? {}
	const custom = props.customProperties
	const merged = {
		...props,
		...(custom && typeof custom === 'object' && !Array.isArray(custom) ? custom : {}),
	}
	return Object.entries(merged).filter(
		([key]) => !summaryProperties.has(key) && !rendererProperties.has(key),
	)
}

export function formatFeatureProperty(value: unknown): string {
	if (typeof value === 'string') return value || '—'
	if (value === undefined) return '—'
	return JSON.stringify(value, null, 2) ?? String(value)
}

export function countGeometryVertices(geometry: Geometry | null): number {
	if (!geometry) return 0
	if (geometry.type === 'GeometryCollection') {
		return geometry.geometries.reduce((count, child) => count + countGeometryVertices(child), 0)
	}
	const walk = (coords: unknown): number => {
		if (!Array.isArray(coords) || coords.length === 0) return 0
		if (typeof coords[0] === 'number') return 1
		return coords.reduce((count, child) => count + walk(child), 0)
	}
	return walk(geometry.coordinates)
}
