import type { GeoJsonProperties } from 'geojson'

export const PRESENTATION_MAP_ID_PREFIX = 'earthly-presentation'

export function isPresentationMapLayerId(id: string | undefined): boolean {
	return typeof id === 'string' && id.startsWith(`${PRESENTATION_MAP_ID_PREFIX}:`)
}

/**
 * Reserved GeoJSON property names written after source properties are copied.
 * Source Maps cannot spoof presentation provenance because materialization
 * always overwrites these keys.
 */
export const PRESENTATION_PROPERTY_KEYS = Object.freeze({
	carrierId: 'earthlyPresentationCarrierId',
	layerId: 'earthlyPresentationLayerId',
	source: 'earthlyPresentationSource',
	sourceFeatureId: 'earthlyPresentationSourceFeatureId',
	occurrence: 'earthlyPresentationOccurrence',
	renderId: 'earthlyPresentationRenderId',
	opacityMultiplier: 'earthlyPresentationOpacityMultiplier',
	dataAuthor: 'earthlyPresentationDataAuthor',
	presentationAuthor: 'earthlyPresentationAuthor',
} as const)

export type PresentationLayerRole =
	| 'fill'
	| 'polygon-stroke'
	| 'line'
	| 'line-dashed'
	| 'line-dotted'
	| 'line-arrow'
	| 'point'
	| 'point-icon'
	| 'annotation-anchor'
	| 'annotation-text'
	| 'label'
	| 'line-label'

/** The order within one instance's complete MapLibre layer bundle. */
export const PRESENTATION_LAYER_ROLE_ORDER: readonly PresentationLayerRole[] = Object.freeze([
	'fill',
	'polygon-stroke',
	'line',
	'line-dashed',
	'line-dotted',
	'line-arrow',
	'point',
	'point-icon',
	'annotation-anchor',
	'annotation-text',
	'label',
	'line-label',
])

/**
 * Layers that form the geometry hit surface. Symbol/icon duplicates are
 * intentionally excluded; their corresponding line/point/annotation geometry
 * remains clickable and avoids duplicate query results before de-duplication.
 */
export const PRESENTATION_INTERACTIVE_LAYER_ROLES: readonly PresentationLayerRole[] = Object.freeze(
	[
		'fill',
		'polygon-stroke',
		'line',
		'line-dashed',
		'line-dotted',
		'point',
		'annotation-anchor',
		'annotation-text',
	],
)

function encodeIdPart(value: string): string {
	return encodeURIComponent(value)
}

export function presentationInstanceId(carrierId: string, layerId: string): string {
	return `${PRESENTATION_MAP_ID_PREFIX}:instance:${encodeIdPart(carrierId)}:${encodeIdPart(layerId)}`
}

export function presentationSourceId(carrierId: string, layerId: string): string {
	return `${presentationInstanceId(carrierId, layerId)}:source`
}

export function presentationStyleLayerId(
	carrierId: string,
	layerId: string,
	role: PresentationLayerRole,
): string {
	return `${presentationInstanceId(carrierId, layerId)}:${role}`
}

export function presentationFeatureRenderId(input: {
	carrierId: string
	layerId: string
	sourceFeatureId: string
	occurrence: number
}): string {
	return `${presentationInstanceId(input.carrierId, input.layerId)}:feature:${encodeIdPart(input.sourceFeatureId)}:${input.occurrence}`
}

export interface PresentationFeatureProvenance {
	readonly carrierId: string
	readonly layerId: string
	readonly source: string
	readonly sourceFeatureId: string
	readonly occurrence: number
	readonly renderId: string
	readonly dataAuthor?: string
	readonly presentationAuthor?: string
}

/**
 * Geometry-query identity: all visual sublayers for one source occurrence
 * collapse, while another authored instance remains an explicit choice.
 */
export function presentationGeometryChoiceId(
	provenance: Pick<
		PresentationFeatureProvenance,
		'carrierId' | 'layerId' | 'sourceFeatureId' | 'occurrence'
	>,
): string {
	return JSON.stringify([
		provenance.carrierId,
		provenance.layerId,
		provenance.sourceFeatureId,
		provenance.occurrence,
	])
}

function nonEmptyString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read trusted renderer provenance from a materialized feature. */
export function readPresentationFeatureProvenance(
	properties: GeoJsonProperties | Record<string, unknown> | null | undefined,
): PresentationFeatureProvenance | null {
	if (!properties) return null
	const carrierId = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.carrierId])
	const layerId = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.layerId])
	const source = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.source])
	const sourceFeatureId = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.sourceFeatureId])
	const renderId = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.renderId])
	const occurrence = properties[PRESENTATION_PROPERTY_KEYS.occurrence]
	if (
		!carrierId ||
		!layerId ||
		!source ||
		!sourceFeatureId ||
		!renderId ||
		typeof occurrence !== 'number' ||
		!Number.isSafeInteger(occurrence) ||
		occurrence < 0
	) {
		return null
	}

	const dataAuthor = nonEmptyString(properties[PRESENTATION_PROPERTY_KEYS.dataAuthor])
	const presentationAuthor = nonEmptyString(
		properties[PRESENTATION_PROPERTY_KEYS.presentationAuthor],
	)
	return {
		carrierId,
		layerId,
		source,
		sourceFeatureId,
		occurrence,
		renderId,
		...(dataAuthor ? { dataAuthor } : {}),
		...(presentationAuthor ? { presentationAuthor } : {}),
	}
}

/** Copy only renderer-owned provenance, for derived arrow/proxy features. */
export function copyPresentationProvenanceProperties(
	properties: GeoJsonProperties | Record<string, unknown> | null | undefined,
): Record<string, string | number> {
	if (!properties) return {}
	const copied: Record<string, string | number> = {}
	for (const key of Object.values(PRESENTATION_PROPERTY_KEYS)) {
		const value = properties[key]
		if (typeof value === 'string' || typeof value === 'number') copied[key] = value
	}
	return copied
}
