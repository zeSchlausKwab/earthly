import Ajv2020 from 'ajv/dist/2020'
import addFormats from 'ajv-formats'
import type { FeatureCollection, Feature } from 'geojson'
import type { GeoDataset } from '@/lib/nostr/geo-event'
import {
	MAP_CONTEXT_GEOMETRY_TYPES,
	type MapContextGeometryType,
	type MapContext,
} from '@/lib/nostr/map-context'

export type ContextFilterMode = 'off' | 'warn' | 'strict'

export interface ContextValidationIssue {
	featureId?: string
	path: string
	message: string
}

export interface ContextValidationResult {
	status: 'valid' | 'invalid' | 'unresolved'
	featureErrorCount: number
	datasetErrorCount: number
	errors: ContextValidationIssue[]
}

const ajv = new Ajv2020({
	allErrors: true,
	strict: false,
	validateSchema: true,
})
addFormats(ajv)

export function getContextCoordinate(context: MapContext): string | null {
	return context.contextCoordinate ?? null
}

export function getEffectiveContextUse(context: MapContext): MapContext['context']['contextUse'] {
	if (!context.context.allowForeignAttachments) return 'taxonomy'
	return context.context.contextUse
}

export function getEffectiveContextValidationMode(
	context: MapContext,
): MapContext['context']['validationMode'] {
	if (!context.context.allowForeignAttachments) return 'none'
	if (getEffectiveContextUse(context) === 'taxonomy') return 'none'
	return context.context.validationMode
}

export function defaultContextFilterMode(context: MapContext): ContextFilterMode {
	const mode = getEffectiveContextValidationMode(context)
	if (mode === 'required') return 'strict'
	if (mode === 'optional') return 'warn'
	return 'off'
}

export function contextCanValidateDatasets(context: MapContext): boolean {
	const use = getEffectiveContextUse(context)
	return use === 'validation' || use === 'hybrid'
}

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

function buildDefaultFromSchemaProperty(definition: Record<string, unknown>): unknown {
	if (definition.default !== undefined) return definition.default

	const type = typeof definition.type === 'string' ? definition.type : undefined
	if (type === 'boolean') return true

	if (type === 'string') {
		const minLength =
			typeof definition.minLength === 'number' && Number.isFinite(definition.minLength)
				? Math.max(0, Math.floor(definition.minLength))
				: 0
		return 'x'.repeat(Math.max(1, Math.min(minLength, 32)))
	}

	if (type === 'integer') {
		let value =
			typeof definition.minimum === 'number'
				? Math.ceil(definition.minimum)
				: typeof definition.maximum === 'number' && definition.maximum < 0
					? Math.floor(definition.maximum)
					: 0
		if (typeof definition.maximum === 'number' && value > definition.maximum) {
			value = Math.floor(definition.maximum)
		}
		return value
	}

	if (type === 'number') {
		let value =
			typeof definition.minimum === 'number'
				? definition.minimum
				: typeof definition.maximum === 'number' && definition.maximum < 0
					? definition.maximum
					: 0
		if (typeof definition.maximum === 'number' && value > definition.maximum) {
			value = definition.maximum
		}
		return value
	}

	return ''
}

function featurePropertiesForValidation(feature: Feature): Record<string, unknown> {
	const base = asRecord(feature.properties) ?? {}
	const custom = asRecord(base.customProperties) ?? {}
	const ignoredFeaturePropertyKeys = new Set([
		'customProperties',
		'name',
		'description',
		'meta',
		'featureId',
		'datasetId',
		'sourceEventId',
		'hashtags',
		'featureType',
		'text',
		'textFontSize',
		'textColor',
		'textHaloColor',
		'textHaloWidth',
		'active',
		'mode',
		'parent',
		'coord_path',
		'color',
		'strokeColor',
		'strokeWidth',
		'radius',
		'fillColor',
		'fillOpacity',
		'strokeOpacity',
		'lineDash',
		'arrowStart',
		'arrowEnd',
		'primitiveShape',
		'label',
		'earthly:callouts',
	])
	const rootDomainProperties: Record<string, unknown> = {}
	Object.entries(base).forEach(([key, value]) => {
		if (ignoredFeaturePropertyKeys.has(key)) return
		rootDomainProperties[key] = value
	})
	const merged = {
		...rootDomainProperties,
		...custom,
	}
	return merged
}

export function getContextAllowedGeometryTypes(context: MapContext): MapContextGeometryType[] {
	const constraints = asRecord(context.context.geometryConstraints)
	const allowedTypesRaw = Array.isArray(constraints?.allowedTypes) ? constraints.allowedTypes : []
	const allowedTypeSet = new Set<MapContextGeometryType>()
	allowedTypesRaw.forEach((entry) => {
		if (typeof entry !== 'string') return
		if ((MAP_CONTEXT_GEOMETRY_TYPES as readonly string[]).includes(entry)) {
			allowedTypeSet.add(entry as MapContextGeometryType)
		}
	})
	return Array.from(allowedTypeSet.values())
}

export function getContextRequiredPropertyDefaults(context: MapContext): Record<string, unknown> {
	if (!contextCanValidateDatasets(context)) return {}

	const schema = asRecord(context.context.schema)
	if (!schema) return {}

	const properties = asRecord(schema.properties)
	if (!properties) return {}

	const required = Array.isArray(schema.required)
		? schema.required.filter((entry): entry is string => typeof entry === 'string')
		: []
	if (required.length === 0) return {}

	const defaults: Record<string, unknown> = {}
	required.forEach((propertyName) => {
		const definition = asRecord(properties[propertyName])
		if (!definition) return
		defaults[propertyName] = buildDefaultFromSchemaProperty(definition)
	})
	return defaults
}

function toFeatureId(feature: Feature, index: number): string | undefined {
	if (typeof feature.id === 'string') return feature.id
	if (typeof feature.id === 'number') return String(feature.id)
	return index >= 0 ? String(index) : undefined
}

export function validateDatasetForContext(
	dataset: GeoDataset | null | undefined,
	context: MapContext,
	featureCollection?: FeatureCollection,
	mode: ContextFilterMode = 'strict',
): ContextValidationResult {
	if (mode === 'off') {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	if (!contextCanValidateDatasets(context)) {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	const allowedGeometryTypes = getContextAllowedGeometryTypes(context)
	const hasGeometryConstraints = allowedGeometryTypes.length > 0
	const schema = context.context.schema
	const hasSchema = Boolean(schema && typeof schema === 'object')
	let validate: ReturnType<typeof ajv.compile> | null = null
	if (hasSchema) {
		try {
			validate = ajv.compile(schema as Record<string, unknown>)
		} catch (error) {
			return {
				status: 'unresolved',
				featureErrorCount: 0,
				datasetErrorCount: 1,
				errors: [
					{
						path: '$',
						message: error instanceof Error ? error.message : 'Invalid context schema.',
					},
				],
			}
		}
	}
	if (!validate && !hasGeometryConstraints) {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 1,
			errors: [{ path: '$', message: 'Context has no validation constraints.' }],
		}
	}
	const collection = featureCollection ?? dataset?.featureCollection
	const features = collection?.features ?? []

	if (features.length === 0) {
		return {
			status: 'unresolved',
			featureErrorCount: 0,
			datasetErrorCount: 1,
			errors: [{ path: '$', message: 'Dataset has no geometries to validate.' }],
		}
	}

	let invalidFeatureCount = 0
	const errors: ContextValidationIssue[] = []

	features.forEach((feature, index) => {
		let featureInvalid = false
		const properties = featurePropertiesForValidation(feature)
		const featureId = toFeatureId(feature, index)

		if (hasGeometryConstraints) {
			const geometryType = feature.geometry?.type
			if (!geometryType || !allowedGeometryTypes.includes(geometryType as MapContextGeometryType)) {
				featureInvalid = true
				errors.push({
					featureId,
					path: '/geometry/type',
					message: `Geometry type "${geometryType ?? 'unknown'}" is not allowed.`,
				})
			}
		}

		if (validate) {
			const valid = validate(properties)
			if (!valid) {
				featureInvalid = true
				;(validate.errors ?? []).forEach((error) => {
					errors.push({
						featureId,
						path: error.instancePath || '/',
						message: error.message ?? 'Schema validation error',
					})
				})
			}
		}

		if (featureInvalid) {
			invalidFeatureCount += 1
		}
	})

	if (invalidFeatureCount === 0) {
		return {
			status: 'valid',
			featureErrorCount: 0,
			datasetErrorCount: 0,
			errors: [],
		}
	}

	return {
		status: 'invalid',
		featureErrorCount: invalidFeatureCount,
		datasetErrorCount: 1,
		errors,
	}
}

export function isDatasetAllowedByContextFilter(
	result: ContextValidationResult,
	mode: ContextFilterMode,
): boolean {
	if (mode === 'off' || mode === 'warn') return true
	return result.status === 'valid'
}
