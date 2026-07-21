import type { Feature, FeatureCollection, Geometry, GeoJsonProperties } from 'geojson'

export const COORDINATE_PRECISION_VALUES = ['exact', 'approximate', 'representative'] as const
export type CoordinatePrecision = (typeof COORDINATE_PRECISION_VALUES)[number]

export interface DatasetValidationOptions {
	requireFeatureProvenance?: boolean
}

export interface DatasetValidationSummary {
	featureCount: number
	provenanceFeatureCount: number
	geometryTypes: Record<string, number>
}

export class DatasetValidationError extends Error {
	readonly issues: string[]

	constructor(issues: string[]) {
		super(`Dataset validation failed:\n- ${issues.join('\n- ')}`)
		this.name = 'DatasetValidationError'
		this.issues = issues
	}
}

const BAD_STRING_SENTINELS = /^(?:undefined|null|nan|infinity|-infinity|\[object Object\])$/iu

function validateUnknown(
	value: unknown,
	path: string,
	issues: string[],
	seen: WeakSet<object>,
): void {
	if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
		issues.push(`${path} is not JSON-serializable`)
		return
	}
	if (value === undefined) {
		issues.push(`${path} is undefined`)
		return
	}
	if (typeof value === 'number' && !Number.isFinite(value)) {
		issues.push(`${path} is not a finite number`)
		return
	}
	if (typeof value === 'string' && BAD_STRING_SENTINELS.test(value.trim())) {
		issues.push(`${path} contains the placeholder "${value}"`)
		return
	}
	if (!value || typeof value !== 'object') return
	const prototype = Object.getPrototypeOf(value)
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
		issues.push(`${path} must be a plain JSON object`)
		return
	}
	if (seen.has(value)) {
		issues.push(`${path} contains a circular reference`)
		return
	}
	seen.add(value)
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			validateUnknown(item, `${path}[${index}]`, issues, seen)
		})
	} else {
		for (const [key, item] of Object.entries(value)) {
			validateUnknown(item, `${path}.${key}`, issues, seen)
		}
	}
	seen.delete(value)
}

function visitCoordinates(
	geometry: Geometry,
	visit: (position: number[], path: string) => void,
	issues: string[],
	geometryPath: string,
): void {
	if (geometry.type === 'GeometryCollection') {
		if (!Array.isArray(geometry.geometries) || geometry.geometries.length === 0) {
			issues.push(`${geometryPath}.geometries must contain at least one geometry`)
			return
		}
		geometry.geometries.forEach((child, index) => {
			visitCoordinates(
				child,
				(position, path) => visit(position, `geometries[${index}].${path}`),
				issues,
				`${geometryPath}.geometries[${index}]`,
			)
		})
		return
	}

	function walk(value: unknown, path: string): void {
		if (!Array.isArray(value)) {
			issues.push(`${geometryPath}.${path} must be a coordinate array`)
			return
		}
		if (value.length === 0) {
			issues.push(`${geometryPath}.${path} must not be empty`)
			return
		}
		if (value.every((coordinate) => typeof coordinate === 'number')) {
			if (value.length < 2) {
				issues.push(`${geometryPath}.${path} must contain longitude and latitude`)
				return
			}
			visit(value as number[], path)
			return
		}
		if (value.some((coordinate) => !Array.isArray(coordinate))) {
			issues.push(`${geometryPath}.${path} mixes positions and coordinate arrays`)
			return
		}
		value.forEach((child, index) => {
			walk(child, `${path}[${index}]`)
		})
	}
	walk(geometry.coordinates, 'coordinates')
}

function hasProvenance(properties: GeoJsonProperties): boolean {
	return Boolean(properties && typeof properties.sourceUrl === 'string')
}

function validateProvenance(properties: GeoJsonProperties, path: string, issues: string[]): void {
	if (!properties) {
		issues.push(`${path}.properties must contain source provenance`)
		return
	}
	try {
		const url = new URL(String(properties.sourceUrl || ''))
		if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
	} catch {
		issues.push(`${path}.properties.sourceUrl must be an http(s) URL`)
	}
	if (typeof properties.sourceTitle !== 'string' || !properties.sourceTitle.trim()) {
		issues.push(`${path}.properties.sourceTitle is required`)
	}
	if (!Number.isInteger(properties.sourceRevisionId)) {
		issues.push(`${path}.properties.sourceRevisionId must be an integer`)
	}
	if (typeof properties.sourceSection !== 'string' || !properties.sourceSection.trim()) {
		issues.push(`${path}.properties.sourceSection is required`)
	}
	if (
		(typeof properties.sourceTable !== 'string' || !properties.sourceTable.trim()) &&
		!Number.isInteger(properties.sourceTable)
	) {
		issues.push(`${path}.properties.sourceTable must identify the source table`)
	}
	if (!Number.isInteger(properties.sourceRow) || Number(properties.sourceRow) < 1) {
		issues.push(`${path}.properties.sourceRow must be a positive integer`)
	}
	if (
		typeof properties.sourceRetrievedAt !== 'string' ||
		Number.isNaN(Date.parse(properties.sourceRetrievedAt))
	) {
		issues.push(`${path}.properties.sourceRetrievedAt must be an ISO timestamp`)
	}
	if (
		!COORDINATE_PRECISION_VALUES.includes(properties.coordinatePrecision as CoordinatePrecision)
	) {
		issues.push(
			`${path}.properties.coordinatePrecision must be exact, approximate, or representative`,
		)
	}
}

export function validateDataset(
	featureCollection: FeatureCollection,
	options: DatasetValidationOptions = {},
): DatasetValidationSummary {
	const issues: string[] = []
	if (featureCollection?.type !== 'FeatureCollection') {
		throw new DatasetValidationError(['input must be a GeoJSON FeatureCollection'])
	}
	if (!Array.isArray(featureCollection.features)) {
		throw new DatasetValidationError(['featureCollection.features must be an array'])
	}
	if (featureCollection.features.length === 0)
		issues.push('dataset must contain at least one feature')
	validateUnknown(featureCollection, 'featureCollection', issues, new WeakSet())

	const ids = new Set<string>()
	const geometryTypes: Record<string, number> = {}
	let provenanceFeatureCount = 0
	featureCollection.features.forEach((feature: Feature, index) => {
		const path = `features[${index}]`
		if (feature?.type !== 'Feature') {
			issues.push(`${path} is not a GeoJSON Feature`)
			return
		}
		if (!feature.geometry) {
			issues.push(`${path}.geometry is required`)
			return
		}
		if (
			![
				'Point',
				'MultiPoint',
				'LineString',
				'MultiLineString',
				'Polygon',
				'MultiPolygon',
				'GeometryCollection',
			].includes(feature.geometry.type)
		) {
			issues.push(`${path}.geometry.type is not a supported GeoJSON geometry`)
			return
		}
		geometryTypes[feature.geometry.type] = (geometryTypes[feature.geometry.type] || 0) + 1
		if (feature.id !== undefined) {
			const id = String(feature.id)
			if (!id.trim()) issues.push(`${path}.id must not be empty`)
			else if (ids.has(id)) issues.push(`${path}.id duplicates "${id}"`)
			ids.add(id)
		}
		visitCoordinates(
			feature.geometry,
			(position, coordinatePath) => {
				const [lon, lat] = position
				if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
					issues.push(`${path}.geometry.${coordinatePath} is not finite`)
				} else if (lon < -180 || lon > 180 || lat < -90 || lat > 90) {
					issues.push(`${path}.geometry.${coordinatePath} is outside WGS84 bounds`)
				}
			},
			issues,
			`${path}.geometry`,
		)

		if (hasProvenance(feature.properties)) provenanceFeatureCount += 1
		if (options.requireFeatureProvenance) validateProvenance(feature.properties, path, issues)
	})

	if (issues.length > 0) throw new DatasetValidationError(issues)
	return { featureCount: featureCollection.features.length, provenanceFeatureCount, geometryTypes }
}
